import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';
import { PLUG_PATH } from '@/lib/brand';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p));
const pngSize = (buf: Buffer) => {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

describe('brand mark', () => {
  it('uses the same Phosphor bold plug the header logo renders', () => {
    const require = createRequire(join(root, 'package.json'));
    const defs = readFileSync(join(dirname(require.resolve('@phosphor-icons/react')), 'defs/Plug.es.js'), 'utf8');
    const bold = defs.match(/"bold",[\s\S]*?d: "([^"]+)"/)![1];
    expect(PLUG_PATH).toBe(bold);
    expect(read('src/app/icon.svg').toString()).toContain(`d="${PLUG_PATH}"`);
  });

  it('has generated icons that are current with icon.svg (run `pnpm brand` if this fails)', () => {
    const sha = createHash('sha256').update(read('src/app/icon.svg')).digest('hex');
    expect(JSON.parse(read('brand.lock.json').toString()).iconSvgSha256).toBe(sha);
  });

  it('ships a favicon.ico holding 16, 32 and 48px PNGs', () => {
    const ico = read('src/app/favicon.ico');
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const sizes = [0, 1, 2].map((i) => {
      const e = 6 + 16 * i;
      const [len, off] = [ico.readUInt32LE(e + 8), ico.readUInt32LE(e + 12)];
      expect(off + len).toBeLessThanOrEqual(ico.length);
      const [w, h] = pngSize(ico.subarray(off, off + len));
      expect([ico.readUInt8(e), ico.readUInt8(e + 1)]).toEqual([w, h]);
      return w;
    });
    expect(sizes).toEqual([16, 32, 48]);
  });

  it('ships a 180px apple-icon and every manifest icon at its declared size', () => {
    expect(pngSize(read('src/app/apple-icon.png'))).toEqual([180, 180]);
    for (const icon of manifest().icons!) {
      const file = join('public', icon.src);
      expect(existsSync(join(root, file))).toBe(true);
      expect(pngSize(read(file)).join('x')).toBe(icon.sizes);
    }
  });
});
