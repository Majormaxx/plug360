import { ImageResponse } from 'next/og';
import { BRAND, GLYPH_RATIO, PLUG_PATH } from '@/lib/brand';

export const alt = 'Plug360: pay for the gig, hold it till it’s done';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The card WhatsApp, X and iMessage show when someone shares a deal link. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#F6EFE4', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ width: 64, height: 64, borderRadius: 32, background: BRAND.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={64 * GLYPH_RATIO} height={64 * GLYPH_RATIO} viewBox="0 0 256 256" style={{ transform: 'rotate(-45deg)' }}>
                <path d={PLUG_PATH} fill={BRAND.ink} />
              </svg>
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, color: '#17141F' }}>plug360</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 76, fontWeight: 700, color: '#17141F', letterSpacing: -2 }}>Pay for the gig.</div>
            <div style={{ fontSize: 76, fontWeight: 700, color: '#5B5563', letterSpacing: -2 }}>Hold it till it’s done.</div>
          </div>
          <div style={{ fontSize: 30, color: '#5B5563' }}>USDC escrow between people you know. Your plug settles disputes.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 330, gap: 16 }}>
          {['Seller signed', 'Plug accepted', 'Buyer paid'].map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#FFFAF2', borderRadius: 20, padding: '20px 24px', border: '1px solid rgba(23,20,31,0.1)' }}>
              <div style={{ width: 26, height: 26, borderRadius: 13, background: '#3BB273' }} />
              <div style={{ fontSize: 28, color: '#17141F' }}>{t}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
