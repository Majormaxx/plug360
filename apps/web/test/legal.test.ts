import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE } from '@/lib/site';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const LEGAL = ['src/app/privacy/page.tsx', 'src/app/terms/page.tsx', 'src/components/layout/Footer.tsx'];

describe('legal pages and footer', () => {
  it('exist at the URLs Google OAuth branding points to', () => {
    expect(existsSync(join(root, 'src/app/privacy/page.tsx'))).toBe(true);
    expect(existsSync(join(root, 'src/app/terms/page.tsx'))).toBe(true);
  });

  it('give a way to contact us', () => {
    expect(SITE.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
    for (const f of LEGAL.slice(0, 2)) expect(read(f)).toContain('SITE.contactEmail');
  });

  it('use no em or en dashes', () => {
    for (const f of LEGAL) expect(read(f), f).not.toMatch(/[–—]/);
  });

  it('link only to routes that exist', () => {
    const hrefs = [...read('src/components/layout/Footer.tsx').matchAll(/href: '(\/[^']*)'/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(existsSync(join(root, 'src/app', h, 'page.tsx')), h).toBe(true);
  });
});
