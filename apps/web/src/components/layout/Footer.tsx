import Link from 'next/link';
import { explorerAddress, network } from '@/lib/config';

export function Footer() {
  return (
    <footer className="hidden border-t border-line md:block">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-muted">
        <p>
          Built on Arc. Escrow contract{' '}
          <a className="font-mono text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href={explorerAddress(network.escrow)} target="_blank" rel="noreferrer">
            {network.escrow}
          </a>
        </p>
        <nav className="flex gap-5">
          <Link href="/add-usdc" className="hover:text-ink">Add USDC</Link>
          <a href="https://github.com/Majormaxx/plug360" target="_blank" rel="noreferrer" className="hover:text-ink">Source</a>
        </nav>
      </div>
    </footer>
  );
}
