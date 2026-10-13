import { ArrowDown, ArrowRight, Gavel, HandCoins, LockKey, Timer } from '@phosphor-icons/react/dist/ssr';
import { HeroCard } from '@/components/landing/HeroCard';
import { ButtonLink } from '@/components/ui/Button';
import { explorerAddress, network } from '@/lib/config';

const STEPS = [
  { title: 'Agree the job', body: 'Write what needs doing, set a price, and name a plug: someone you both know and trust.' },
  { title: 'Sign one link', body: 'The seller signs the terms, then the plug accepts. Nothing moves yet, and signing is free.' },
  { title: 'Pay into escrow', body: 'The buyer pays from the same link. The USDC waits in the contract while the work gets done.' },
  { title: 'Release, or ask the plug', body: 'Happy? Release it. Not happy? Open a dispute before the window closes and the plug decides.' },
];

const FAQ = [
  {
    q: "What's a plug?",
    a: "A friend or community lead both sides already trust. They only act when there's a dispute, and the contract limits them to two moves: refund the buyer, or pay the seller. They can't send the money anywhere else.",
  },
  {
    q: 'What does it cost?',
    a: "Plug360 takes nothing. The plug fee, up to 5%, is set per deal and split evenly between buyer and seller. Gas on Arc is paid in USDC and costs a fraction of a cent per action.",
  },
  {
    q: 'What if the plug disappears?',
    a: 'They get 7 days to rule on a dispute. After that, the buyer can be refunded in full, and anyone can trigger it.',
  },
  {
    q: 'Which wallets work?',
    a: 'Any wallet that runs in your browser, like Rabby or MetaMask, or the in-app browser of a mobile wallet. Plug360 adds the Arc network for you.',
  },
  {
    q: 'Has the contract been audited?',
    a: 'Not yet. Until it is, the contract caps each deal at 100 USDC and everything it holds at 2,500 USDC. The source is public and verified.',
  },
];

export default function Home() {
  return (
    <div className="space-y-24 md:space-y-32">
      <section className="grid min-h-[calc(100dvh-14rem)] items-center gap-12 pt-4 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
        <div className="space-y-7">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted">
            <span className="size-1.5 rounded-full bg-mint" /> USDC escrow for gigs in your circle
          </p>
          <h1 className="font-display text-[2.75rem] font-semibold leading-[1.04] tracking-[-0.03em] text-balance sm:text-6xl lg:text-[4.25rem]">
            <span className="block">Pay for the gig.</span>
            <span className="block text-muted">Hold it till it&apos;s done.</span>
          </h1>
          <p className="max-w-[46ch] text-lg leading-relaxed text-muted">
            Plug360 keeps the USDC in escrow while the work happens. If something goes wrong, a friend you both trust decides who gets it, and they can&apos;t keep it for themselves.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/new" size="lg" icon={<ArrowRight weight="bold" className="size-4" />} className="flex-row-reverse">
              Start a deal
            </ButtonLink>
            <ButtonLink href="#how" size="lg" variant="ghost" icon={<ArrowDown className="size-4" />} className="flex-row-reverse">
              How it works
            </ButtonLink>
          </div>
        </div>
        <HeroCard />
      </section>

      <section id="how" className="grid scroll-mt-24 gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-3 lg:sticky lg:top-28 lg:self-start">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Three people, one link.</h2>
          <p className="max-w-[38ch] leading-relaxed text-muted">No accounts and no sign-up. Everything a deal needs travels in the link you send each other.</p>
        </div>
        <ol className="divide-y divide-line border-y border-line">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[3rem_1fr] gap-4 py-6">
              <span className="tabular font-display text-3xl font-semibold text-faint">{i + 1}</span>
              <div className="space-y-1">
                <h3 className="text-lg font-medium">{s.title}</h3>
                <p className="leading-relaxed text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-8">
        <h2 className="max-w-[20ch] font-display text-3xl font-semibold tracking-tight md:text-4xl">Fair by design, enforced by the contract.</h2>
        <div className="grid gap-4 md:grid-cols-6">
          <Fact className="md:col-span-4" icon={<Gavel className="size-5" />} title="The plug referees. That's all.">
            In a dispute, the plug picks between two outcomes the contract allows: money back to the buyer, or payment to the seller. There is no third option, so there&apos;s nothing to gain by ruling badly.
          </Fact>
          <Fact className="md:col-span-2" icon={<Timer className="size-5" />} title="Silence refunds the buyer">
            If the plug doesn&apos;t rule within 7 days, the buyer gets everything back.
          </Fact>
          <Fact className="md:col-span-2" icon={<HandCoins className="size-5" />} title="Refunds have one address">
            The buyer picks it when paying. Nobody can change it afterwards.
          </Fact>
          <Fact className="md:col-span-4" icon={<LockKey className="size-5" />} title="Nobody holds your money but the contract">
            Plug360 never takes custody. The escrow contract is public, verified on Sourcify and{' '}
            <a href={explorerAddress(network.escrow)} target="_blank" rel="noreferrer" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              readable on the Arc explorer
            </a>
            .
          </Fact>
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Questions</h2>
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">
                {f.q}
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-muted transition-transform duration-200 ease-out group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-[60ch] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="grain relative overflow-hidden rounded-[28px] bg-ink px-6 py-12 text-bg sm:px-12 sm:py-16 dark:bg-raised dark:text-ink">
        <div className="relative max-w-xl space-y-5">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Got a gig lined up?</h2>
          <p className="leading-relaxed opacity-75">Set it up in a minute and send the link. Your plug only hears from you if something goes wrong.</p>
          <ButtonLink href="/new" size="lg" icon={<ArrowRight weight="bold" className="size-4" />} className="flex-row-reverse">
            Start a deal
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

function Fact({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-3 rounded-[20px] border border-line bg-surface p-6 ${className ?? ''}`}>
      <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-ink">{icon}</span>
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="leading-relaxed text-muted">{children}</p>
    </div>
  );
}
