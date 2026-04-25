#!/usr/bin/env node
/**
 * Take a single full-viewport screenshot for the docs.
 *
 *   node screenshot.js <url> <width>x<height> <outPath> [mockRole]
 *
 * Ex: node screenshot.js http://localhost:3010/ 1600x900 docs/operations/screenshots/erp-layout.png admin
 *
 * Sets the gg_erp_mock_role localStorage key via an init script before the
 * app bootstraps so mock-mode apps render signed in.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const [, , url, wh, outPath, mockRole] = process.argv;
if (!url || !wh || !outPath) {
  console.error('usage: node screenshot.js <url> <WxH> <outPath> [mockRole]');
  process.exit(1);
}
const [w, h] = wh.split('x').map(Number);
if (!w || !h) throw new Error(`bad WxH: ${wh}`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
  });
  if (mockRole) {
    await context.addInitScript((role) => {
      try { localStorage.setItem('gg_erp_mock_role', role); } catch {}
    }, mockRole);
  }
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  // Small pause for any client-side auth resolution to flip loading=false.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: outPath, fullPage: false, type: 'png' });
  console.log(`wrote ${outPath}`);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
