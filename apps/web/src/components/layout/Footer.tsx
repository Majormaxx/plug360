import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { explorerAddress, network } from '@/lib/config';
import { SITE } from '@/lib/site';
import { Logo } from './Logo';

type FooterLink = { label: string; href: string; external?: boolean };

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Use',
    links: [
      { label: 'New deal', href: '/new' },
      { label: 'My deals', href: '/me' },
      { label: 'Add USDC', href: '/add-usdc' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { label: 'Contract', href: explorerAddress(network.escrow), external: true },
      { label: 'Source code', href: SITE.source, external: true },
      { label: 'Security', href: SITE.security, external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Contact', href: `mailto:${SITE.contactEmail}`, external: true },
    ],
  },
];

const linkClass = 'inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink';

export function Footer() {
  return (
    <footer className="border-t border-line">
      {/* On phones the fixed bottom nav covers the last ~6rem, so the footer pads past it. */}
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-10">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
          <div className="max-w-xs space-y-3">
            <Logo />
            <p className="text-sm leading-relaxed text-muted">USDC escrow for deals between people who know each other. A friend you both trust settles disputes.</p>
          </div>
          <div className="grid grid-cols-3 gap-6 md:contents">
            {GROUPS.map((g) => (
              <nav key={g.title} aria-label={g.title}>
                <p className="text-sm font-medium text-ink">{g.title}</p>
                <ul className="mt-3 space-y-2.5">
                  {g.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a href={l.href} className={linkClass} {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>
                          {l.label}
                          {l.href.startsWith('http') && <ArrowUpRight className="size-3 text-faint" />}
                        </a>
                      ) : (
                        <Link href={l.href} className={linkClass}>
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} {SITE.name}</p>
          <p>{network.testnet ? 'Running on Arc testnet with test USDC. The contract is unaudited.' : 'Built on Arc. The contract is unaudited and limited to 100 USDC per deal.'}</p>
        </div>
      </div>
    </footer>
  );
}
