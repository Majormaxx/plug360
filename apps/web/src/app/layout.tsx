import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { MobileNav } from '@/components/layout/MobileNav';
import { Footer } from '@/components/layout/Footer';
import { NetworkBanner } from '@/components/wallet/NetworkBanner';
import { Providers } from '@/components/providers/Providers';
import { themeScript } from '@/components/providers/ThemeProvider';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', weight: ['500', '600', '700'] });

export const metadata: Metadata = {
  title: { default: 'Plug360', template: '%s · Plug360' },
  description: 'Pay for gigs between friends in USDC. The money waits in escrow, and a friend you both trust settles any dispute.',
  applicationName: 'Plug360',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6efe4' },
    { media: '(prefers-color-scheme: dark)', color: '#17141f' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} ${bricolage.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-[100dvh] antialiased">
        <Providers>
          <div className="flex min-h-[100dvh] flex-col">
            <Header />
            <NetworkBanner />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-16 md:pt-8">{children}</main>
            <Footer />
          </div>
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
