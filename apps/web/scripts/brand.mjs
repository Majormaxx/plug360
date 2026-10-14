#!/usr/bin/env node
// Renders every Plug360 logo file from src/app/icon.svg, the one source of the mark.
// App icons go into the app (favicon.ico, apple-icon.png, PWA icons); logo files for decks and
// forms go to the output folder. Run after any change to icon.svg; test/brand.test.ts fails until you do.
// Usage: node scripts/brand.mjs [outDir]   (default ~/Downloads/plug360-brand)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(homedir(), 'Downloads', 'plug360-brand'));
const iconSvg = readFileSync(join(web, 'src/app/icon.svg'), 'utf8');

const plugPath = iconSvg.match(/<path[^>]*\sd="([^"]+)"/)[1];
const [accent, ink] = [...iconSvg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
const cream = '#F6EFE4';
const muted = '#5B5563';
const mutedDark = '#B3ABBD';

/** The mark on a full-bleed square, for icons the OS crops (iOS, Android maskable). */
const squareSvg = (glyph) => {
  const off = (64 - 64 * glyph) / 2;
  const scale = (64 * glyph) / 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${accent}"/><g transform="translate(${off} ${off}) scale(${scale}) rotate(-45 128 128)"><path fill="${ink}" d="${plugPath}"/></g></svg>`;
};

/** The circle mark with a custom glyph size; 16px favicons need a bigger glyph to stay legible. */
const circleSvg = (glyph) => {
  const off = (64 - 64 * glyph) / 2;
  const scale = (64 * glyph) / 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${accent}"/><g transform="translate(${off} ${off}) scale(${scale}) rotate(-45 128 128)"><path fill="${ink}" d="${plugPath}"/></g></svg>`;
};

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage();

/** Renders an SVG to a PNG of exactly size×size pixels, transparent outside the drawing. */
const svgPng = async (svg, size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};

/** PNG-in-ICO container (supported by every browser since IE Vista era). */
const ico = (pngs) => {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
};

const written = [];
const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  written.push(path);
};

// App icons.
const favicon = [];
for (const size of [16, 32, 48]) favicon.push({ size, png: await svgPng(size === 16 ? circleSvg(0.74) : iconSvg, size) });
write(join(web, 'src/app/favicon.ico'), ico(favicon));
write(join(web, 'src/app/apple-icon.png'), await svgPng(squareSvg(0.5), 180));
write(join(web, 'public/icon-192.png'), await svgPng(iconSvg, 192));
write(join(web, 'public/icon-512.png'), await svgPng(iconSvg, 512));
// Maskable icons keep the glyph inside the central 80% circle Android may crop to.
write(join(web, 'public/icon-maskable-512.png'), await svgPng(squareSvg(0.42), 512));
write(join(web, 'brand.lock.json'), `${JSON.stringify({ iconSvgSha256: createHash('sha256').update(iconSvg).digest('hex') }, null, 2)}\n`);

// Files for decks and submission forms.
write(join(outDir, 'plug360-mark.svg'), iconSvg);
write(join(outDir, 'plug360-mark.png'), await svgPng(iconSvg, 1024));
write(join(outDir, 'plug360-app-icon.png'), await svgPng(squareSvg(0.5), 1024));

/** Mark plus "plug360" wordmark, laid out like the site header (32px mark, 8px gap, 19px type) at 4×. */
const logoHtml = (text, sub, bg) => `<html><head>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&display=block" rel="stylesheet">
<style>body{margin:0;background:${bg}}#logo{display:inline-flex;align-items:center;gap:24px;padding:56px 64px;background:${bg}}
span.word{font-family:'Bricolage Grotesque';font-weight:600;font-size:57px;letter-spacing:-0.025em;color:${text};line-height:1}
span.sub{color:${sub}}</style></head>
<body><div id="logo">${iconSvg.replace('<svg ', '<svg width="96" height="96" style="display:block" ')}<span class="word">plug<span class="sub">360</span></span></div></body></html>`;

const logo = async (name, { text, sub, bg }) => {
  const ctx = await browser.newContext({ deviceScaleFactor: 4 });
  const p = await ctx.newPage();
  for (const [ext, fill] of [['png', 'transparent'], ['jpg', bg]]) {
    await p.setContent(logoHtml(text, sub, fill), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    const loaded = await p.evaluate(() => document.fonts.check("600 57px 'Bricolage Grotesque'"));
    if (!loaded) throw new Error('Bricolage Grotesque did not load from Google Fonts; refusing to export a fallback font');
    const el = p.locator('#logo');
    write(join(outDir, `${name}.${ext}`), ext === 'png' ? await el.screenshot({ omitBackground: true }) : await el.screenshot({ type: 'jpeg', quality: 95 }));
  }
  await ctx.close();
};

await logo('plug360-logo', { text: ink, sub: muted, bg: cream });
await logo('plug360-logo-dark', { text: cream, sub: mutedDark, bg: ink });

// JPG versions of the square marks, on the site's cream background.
const markJpg = await browser.newPage();
await markJpg.setViewportSize({ width: 1024, height: 1024 });
await markJpg.setContent(`<html><body style="margin:0;background:${cream}">${iconSvg.replace('<svg ', '<svg width="1024" height="1024" style="display:block" ')}</body></html>`);
write(join(outDir, 'plug360-mark.jpg'), await markJpg.screenshot({ type: 'jpeg', quality: 95 }));

await browser.close();
for (const f of written) console.log(f);
