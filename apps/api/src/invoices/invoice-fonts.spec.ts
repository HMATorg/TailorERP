import { inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { AR, FONT_FILES, assertFontsPresent, registerInvoiceFonts } from './invoice-fonts';

// fontkit ships no type declarations; it is pulled in directly here only to
// assert on the shaping PDFKit already performs through it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('fontkit');

/**
 * Guards the Arabic text pipeline itself, below the invoice layout.
 *
 * These assertions exist because the failure mode here is close to invisible:
 * Arabic letterforms abut, so a dropped word space or an unshaped run looks
 * plausible at a glance, and reading a rendered page by eye gave the wrong
 * answer twice while chasing this down. Measuring is the only reliable check.
 */
describe('invoice fonts', () => {
  it('ships both faces', () => {
    expect(() => assertFontsPresent()).not.toThrow();
  });

  it('shapes Arabic into contextual forms rather than isolated letters', () => {
    const font: any = fontkit.openSync(FONT_FILES[AR]);
    const text = 'خياطة الأنوار';
    const run = font.layout(text);

    const shaped = run.glyphs.map((g: any) => g.id);
    const naive = [...text].map((c) => font.glyphForCodePoint(c.codePointAt(0)!).id);

    // Shaping substitutes initial/medial/final forms and ligates lam-alef, so
    // the result must differ from a plain per-character cmap lookup.
    expect(shaped).not.toEqual(naive);
    expect(run.direction).toBe('rtl');
  });

  it('keeps the word space, with the advance the face defines', () => {
    const font: any = fontkit.openSync(FONT_FILES[AR]);
    const spaceAdvance = font.layout(' ').positions[0].xAdvance;
    // A too-narrow space is what makes Arabic words look run together; Tajawal
    // is 0.240 em where Noto Naskh Arabic is 0.108 em (D-040).
    expect(spaceAdvance / font.unitsPerEm).toBeGreaterThan(0.2);

    const withSpace = font.layout('خياطة الأنوار').glyphs;
    const without = font.layout('خياطةالأنوار').glyphs;
    expect(withSpace.length).toBe(without.length + 1);
  });

  it('emits the space into the PDF with the correct advance', () => {
    const SIZE = 40;
    const measure = (s: string) => {
      const doc = new PDFDocument({ size: 'A4' });
      registerInvoiceFonts(doc);
      doc.font(AR).fontSize(SIZE);
      return doc.widthOfString(s);
    };
    const delta = measure('خياطة الأنوار') - measure('خياطةالأنوار');
    const font: any = fontkit.openSync(FONT_FILES[AR]);
    const expected = (font.layout(' ').positions[0].xAdvance / font.unitsPerEm) * SIZE;
    expect(delta).toBeCloseTo(expected, 1);
  });

  it('writes glyph widths a renderer will agree with', async () => {
    // PDFKit measures with the real font metrics but a reader lays out using
    // the /W table written into the embedded subset. If those disagree, the
    // page renders differently from everything our tests measure.
    const SIZE = 40;
    const S = 'خياطة الأنوار';
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));
    registerInvoiceFonts(doc);
    doc.font(AR).fontSize(SIZE);
    const measured = doc.widthOfString(S);
    doc.text(S, 50, 100, { lineBreak: false });
    doc.end();

    const raw = (await done).toString('latin1');
    const widths = new Map<number, number>();
    const wRaw = raw.match(/\/W\s*\[([\s\S]*?)\]\s*(?:\/|>>)/)?.[1] ?? '';
    for (const m of wRaw.matchAll(/(\d+)\s*\[([^\]]*)\]/g)) {
      const start = Number(m[1]);
      m[2].trim().split(/\s+/).filter(Boolean).forEach((w, i) => widths.set(start + i, Number(w)));
    }

    const cids: number[] = [];
    for (const s of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
      let data = Buffer.from(s[1], 'latin1');
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
      for (const tj of data.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        for (const hex of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) {
          const h = hex[1];
          for (let i = 0; i < h.length; i += 4) cids.push(parseInt(h.slice(i, i + 4), 16));
        }
      }
    }

    const fromTable = (cids.reduce((sum, c) => sum + (widths.get(c) ?? 0), 0) * SIZE) / 1000;
    expect(cids.length).toBe(12);
    expect(fromTable).toBeCloseTo(measured, 1);
  });
});
