#!/usr/bin/env node
// Loads every route at phone and desktop widths in light and dark mode against a running server.
// Fails on console errors, uncaught page errors, failed same-origin requests or horizontal page scroll.
// Usage: node scripts/smoke.mjs [base-url]   (default http://localhost:3360)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:3360';
const out = new URL('../test-results/smoke/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const routes = [
  ['home', '/'],
  ['new', '/new'],
  ['deal-empty', '/deal'],
  ['deal-broken', '/deal#not-a-real-link'],
  ['receipt-missing', `/r/0x${'0'.repeat(63)}1`],
  ['receipt-bad-id', '/r/nope'],
  ['me', '/me'],
  ['add-usdc', '/add-usdc'],
];
const viewports = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };
const failures = [];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

for (const [vpName, viewport] of Object.entries(viewports)) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 2 });
    for (const [name, path] of routes) {
      const page = await ctx.newPage();
      const tag = `${name}@${vpName}/${scheme}`;
      page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && failures.push(`${tag} console: ${m.text().slice(0, 200)}`));
      page.on('pageerror', (e) => failures.push(`${tag} pageerror: ${e.message.slice(0, 200)}`));
      page.on('response', (r) => r.url().startsWith(base) && r.status() >= 500 && failures.push(`${tag} http ${r.status()} ${r.url()}`));
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      if (theme !== scheme) failures.push(`${tag} theme is ${theme}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`${tag} scrolls sideways by ${overflow}px`);
      await page.screenshot({ path: `${out}${name}-${vpName}-${scheme}.png`, fullPage: true });
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();

if (failures.length) {
  console.error(`SMOKE FAILED (${failures.length})\n - ` + failures.join('\n - '));
  process.exit(1);
}
console.log(`SMOKE PASSED: ${routes.length} routes x 2 viewports x 2 themes, screenshots in ${out}`);
