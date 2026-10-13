import { describe, expect, it } from 'vitest';
import { addressFromQr } from '../src/lib/qr';

const a = '0xc98AA1601B5c088EFc73Ae71706A10343a5c642c';

describe('addressFromQr', () => {
  it.each([a, a.toLowerCase(), `ethereum:${a}`, `ethereum:${a}@5042002`, `ethereum:${a}@5042002/transfer?value=1`])('reads %s', (t) =>
    expect(addressFromQr(t)).toBe(a),
  );
  it('ignores anything without an address', () => {
    expect(addressFromQr('https://example.com')).toBeUndefined();
    expect(addressFromQr('0x1234')).toBeUndefined();
  });
});
