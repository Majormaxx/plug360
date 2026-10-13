'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { network } from '@/lib/config';
import { ConnectButton } from '../wallet/ConnectButton';
import { cn } from '../ui/cn';
import { Logo } from './Logo';

export const NAV = [
  { href: '/new', label: 'New deal' },
  { href: '/me', label: 'My deals' },
  { href: '/add-usdc', label: 'Add USDC' },
] as const;

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                path.startsWith(n.href) ? 'bg-raised text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {network.testnet && (
            <span className="hidden h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs font-medium text-muted sm:inline-flex">
              <span className="size-1.5 rounded-full bg-gold" />
              Testnet
            </span>
          )}
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
