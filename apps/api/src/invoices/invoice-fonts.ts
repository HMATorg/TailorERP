import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tajawal, embedded so invoices can be issued in Arabic as KSA VAT rules
 * require. PDFKit's built-in fonts are WinAnsi-encoded and have no Arabic
 * glyphs at all; given a real OpenType face, the fontkit layout engine PDFKit
 * already ships does the contextual shaping and right-to-left reordering itself
 * (measured — see D-040). No separate shaping or bidi pass is needed.
 *
 * Tajawal over Noto Naskh Arabic for two reasons: it is the typeface the admin
 * SPA and PWA already use, so a customer sees one face across the product; and
 * its word space is 0.240 em against Noto Naskh's 0.108 em, which at invoice
 * body sizes is the difference between separated words and a single run-on
 * block. It is a third the size, too (56 KB a face against 200 KB).
 *
 * The files live under `src/assets` so `nest build` copies them into `dist`
 * (see nest-cli.json `assets`), which makes this path identical in dev and in
 * the built output: `<src|dist>/invoices/..` -> `<src|dist>/assets/fonts`.
 */
export const FONT_DIR = join(__dirname, '..', 'assets', 'fonts');

/** Registered names used with `doc.font(...)`. */
export const AR = 'Tajawal';
export const AR_BOLD = 'Tajawal-Bold';

export const FONT_FILES: Record<string, string> = {
  [AR]: join(FONT_DIR, 'Tajawal-Regular.ttf'),
  [AR_BOLD]: join(FONT_DIR, 'Tajawal-Bold.ttf'),
};

/**
 * Fails loudly rather than falling back to a Latin-only face. A silent fallback
 * is how this went unnoticed the first time: the PDF still rendered, it just
 * turned every Arabic name into boxes. An invoice that cannot show Arabic is
 * not a valid KSA tax invoice, so it is better for the build to be obviously
 * broken than for the invoices to be quietly non-compliant.
 */
export function assertFontsPresent(): void {
  const missing = Object.values(FONT_FILES).filter((p) => !existsSync(p));
  if (missing.length) {
    throw new Error(
      `Invoice fonts missing: ${missing.join(', ')}. ` +
        `They ship in apps/api/src/assets/fonts and are copied to dist by the ` +
        `"assets" entry in nest-cli.json — check that step ran.`,
    );
  }
}

/** Registers both faces on a document. Call once per PDFDocument. */
export function registerInvoiceFonts(doc: PDFKit.PDFDocument): void {
  for (const [name, file] of Object.entries(FONT_FILES)) doc.registerFont(name, file);
}
