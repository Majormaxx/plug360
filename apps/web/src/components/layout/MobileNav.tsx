'use client';

import { House, Plus, Stack } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../ui/cn';

const TABS = [
  { href: '/', label: 'Home', Icon: House, exact: true },
  { href: '/new', label: 'New deal', Icon: Plus, primary: true },
  { href: '/me', label: 'My deals', Icon: Stack },
] as const;

/** Thumb-reach navigation on phones. Hidden from md up, where the header nav takes over. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/92 backdrop-blur-md md:hidden">
      <ul className="mx-auto grid h-16 max-w-md grid-cols-3 items-center px-4">
        {TABS.map(({ href, label, Icon, ...t }) => {
          const active = 'exact' in t ? path === href : path.startsWith(href);
          if ('primary' in t) {
            return (
              <li key={href} className="flex justify-center">
                <Link href={href} className="press flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">
                  <Icon weight="bold" className="size-4" />
                  {label}
                </Link>
              </li>
            );
          }
          return (
            <li key={href} className="flex justify-center">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn('press flex flex-col items-center gap-0.5 px-3 py-1 text-[11px] font-medium', active ? 'text-ink' : 'text-faint')}
              >
                <Icon weight={active ? 'fill' : 'regular'} className="size-[22px]" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
