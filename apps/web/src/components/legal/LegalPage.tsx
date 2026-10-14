import type { ReactNode } from 'react';

export type LegalSection = { id: string; title: string; body: ReactNode };

/** Shared layout for the privacy policy and terms: a short summary up top, then the sections, with an in-page index on wide screens. */
export function LegalPage({ title, updated, summary, sections }: { title: string; updated: string; summary: ReactNode; sections: LegalSection[] }) {
  return (
    <div className="mx-auto max-w-5xl py-4 md:py-10">
      <header className="max-w-[65ch]">
        <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-muted">Last updated {updated}</p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-2.5 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted transition-colors hover:text-ink">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="max-w-[65ch]">
          <div className="rounded-[20px] bg-raised/60 p-5 text-[15px] leading-relaxed md:p-6">
            <p className="mb-3 font-display text-base font-semibold tracking-tight">The short version</p>
            <div className="space-y-2 text-muted [&_strong]:font-medium [&_strong]:text-ink">{summary}</div>
          </div>

          <div className="legal mt-12 space-y-12">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <h2 className="font-display text-xl font-semibold tracking-tight">{s.title}</h2>
                <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted [&_a]:text-ink [&_a]:underline [&_a]:decoration-line-strong [&_a]:underline-offset-4 hover:[&_a]:decoration-ink [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                  {s.body}
                </div>
              </section>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
