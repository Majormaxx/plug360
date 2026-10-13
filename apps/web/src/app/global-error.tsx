'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6efe4', color: '#17141f', display: 'grid', placeItems: 'center', minHeight: '100dvh', margin: 0, padding: 16 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22 }}>Plug360 couldn&apos;t load</h1>
          <p style={{ color: '#5b5563', lineHeight: 1.6 }}>No money moved because of this. Your deals are safe in the escrow contract.</p>
          <button onClick={reset} style={{ marginTop: 12, height: 44, padding: '0 20px', borderRadius: 999, border: 0, background: '#f2663b', color: '#17141f', fontWeight: 600 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
