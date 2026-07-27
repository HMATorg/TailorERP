#!/usr/bin/env node
/**
 * Drives the real Print Center end to end and captures what a "Save as PDF"
 * would actually produce, for each of the three documents.
 *
 * Why this exists (D-049): the MCP browser tool this project's assistant
 * sessions use for live verification does not treat synthetic clicks as a
 * trusted user gesture at all — window.open() returns null even from a bare
 * <button onclick>, proven by an isolated test. That made an earlier "fix" to
 * the A4 download impossible to verify visually, and separately let two real
 * print-CSS bugs (the app's nav bar bleeding into every print job, and an
 * invalid `@page { size: 80mm auto }` causing content to render onto a full
 * default-size page with a spurious blank second page) ship unnoticed, because
 * nothing had ever captured actual print output — only screenshots of the
 * on-screen confirmation view, which looked fine.
 *
 * `page.pdf()` calls Chromium's real print-to-PDF pipeline — the same
 * `@media print` / `@page` handling a physical "Save as PDF" uses — so it is
 * a faithful, fully automatable substitute for standing at a real printer.
 * `page.click()` on this non-headless Chrome is also what let a real popup
 * open, which the MCP harness's synthetic click could not do.
 *
 * Requires: docker services + `npm run db:seed` (needs the
 * cashier.jeddah@alanwar.example seed account and a customer named
 * "Ahmed Al-Ghamdi" — see apps/api/test/customers.e2e-spec.ts for how one is
 * created if the fixture is missing), the API on :3000, and the POS dev
 * server on :5176 (`npm run dev:pos`).
 *
 *   node apps/pos/scripts/verify-print-center.mjs <output-dir>
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2];
if (!OUT) {
  console.error('Usage: node verify-print-center.mjs <output-dir>');
  process.exit(1);
}

const POS = process.env.POS_URL ?? 'http://localhost:5176';
const CASHIER_EMAIL = process.env.CASHIER_EMAIL ?? 'cashier.jeddah@alanwar.example';
const CASHIER_PASSWORD = process.env.CASHIER_PASSWORD ?? 'Tailonix@Dev1';
const CUSTOMER_SEARCH = process.env.CUSTOMER_SEARCH ?? 'Ghamdi';

const log = (...a) => console.log(...a);

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

await page.goto(POS);
await page.fill('input[placeholder="Email"]', CASHIER_EMAIL);
await page.fill('input[placeholder="Password"]', CASHIER_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForSelector('input[placeholder*="Search"]', { timeout: 15000 });
log('logged in as', CASHIER_EMAIL);

await page.fill('input[placeholder*="Search"]', CUSTOMER_SEARCH);
await page.waitForTimeout(500);
// force:true because the picker's own search input sits in the same stacking
// context and AntD's List.Item hit-testing intercepts a plain click here.
await page.locator('.ant-list-item').first().click({ force: true });
await page.waitForSelector('text=Change customer', { timeout: 10000 });
log('opened customer matching', CUSTOMER_SEARCH);

await page.click('text=Select a roll', { force: true });
await page.waitForTimeout(400);
await page.click('.ant-select-item-option', { force: true });
await page.waitForTimeout(300);
const checkoutBtn = page.locator('button:has-text("Checkout")');
await checkoutBtn.waitFor({ state: 'visible', timeout: 5000 });
await checkoutBtn.click();
await page.waitForSelector('text=Print Center', { timeout: 15000 });
log('checked out an order; Print Center visible');

/** Reproduces printSection(mode) from src/print.ts exactly, then rasterises. */
async function capture(mode, pageSize, outFile) {
  await page.evaluate(
    ({ mode, pageSize }) => {
      let styleEl = document.getElementById('print-center-page-size');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'print-center-page-size';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `@page { size: ${pageSize}; margin: 3mm; }`;
      document.body.classList.add(`printing-${mode}`);
    },
    { mode, pageSize },
  );
  await page.pdf({ path: `${OUT}/${outFile}`, printBackground: true, preferCSSPageSize: true });
  await page.evaluate((mode) => document.body.classList.remove(`printing-${mode}`), mode);
  log('captured', outFile);
}

await capture('thermal', '80mm 297mm', 'thermal.pdf');
await capture('tags', '62mm 100mm', 'tags.pdf');

let popupUrl = null;
page.on('popup', (p) => {
  popupUrl = p.url();
  log('A4 popup opened:', popupUrl);
});
await page.locator('button:has-text("A4 tax invoice")').click();
await page.waitForTimeout(2000);

const openPages = browser.contexts()[0].pages().map((p) => p.url());
writeFileSync(
  `${OUT}/a4-result.json`,
  JSON.stringify({ popupDetected: !!popupUrl, popupUrl, openPages }, null, 2),
);
log('A4 result:', { popupDetected: !!popupUrl, openPages });

await browser.close();
log('done — inspect thermal.pdf / tags.pdf / a4-result.json in', OUT);
