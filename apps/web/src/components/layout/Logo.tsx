import { Plug } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/" className="group inline-flex items-center gap-2" aria-label="Plug360 home">
      <span className="grid size-8 place-items-center rounded-full bg-accent text-accent-ink transition-transform duration-200 ease-out group-active:scale-95">
        <Plug weight="bold" className="size-[18px] -rotate-45" />
      </span>
      <span className="font-display text-[19px] font-semibold tracking-tight">
        plug<span className="text-muted">360</span>
      </span>
    </Link>
  );
}
