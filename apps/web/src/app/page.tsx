import { ArrowDown, ArrowRight, CheckCircle, Gavel, HandCoins, LockKey, SealCheck, Timer } from '@phosphor-icons/react/dist/ssr';
import { HeroCard } from '@/components/landing/HeroCard';
import { ButtonLink } from '@/components/ui/Button';
import { explorerAddress, network } from '@/lib/config';
import { levelCap, MAX_LEVEL } from '@plug360/shared';
import { usdc } from '@/lib/format';
import { circleEnabled } from '@/lib/circle/config';

const STEPS = [
  { title: 'Agree the job', body: 'Write what needs doing, set a price, and name a plug: someone you both know and trust.' },
  { title: 'Sign one link', body: 'The seller signs the terms, then the plug accepts. Nothing moves yet, and signing is free.' },
  { title: 'Pay into escrow', body: 'The buyer pays from the same link. The USDC waits in the contract while the work gets done.' },
  { title: 'Release, or ask the plug', body: 'Happy? Release it. Not happy? Open a dispute before the window closes and the plug decides.' },
];

const USE_CASES = [
  { title: 'Logo for a small business', price: '25', window: '3-day money-back window' },
  { title: 'Phone screen repair', price: '40', window: '1-day window after pickup' },
  { title: 'Concert ticket resale', price: '60', window: 'Window runs past the show date' },
  { title: 'Four maths tutoring sessions', price: '30', window: '7-day window' },
];

const PLUG_REQUEST =
  'https://github.com/Majormaxx/plug360/issues/new?title=Plug%20listing%20request&body=Wallet%20address%3A%0ACommunity%20or%20group%20you%20referee%20for%3A%0ALargest%20deal%20size%20you%20expect%3A';

const FAQ = [
  {
    q: "What's a plug?",
    a: "A friend or community lead both sides already trust. They only act when there's a dispute, and the contract limits them to two moves: refund the buyer, or pay the seller. They can't send the money anywhere else.",
  },
  {
    q: 'What if the plug sides with the seller unfairly?',
    a: "Their ruling is final, which is why the plug should be someone you both know. Be aware that a plug earns the full fee when the seller is paid and half of it when the buyer is refunded. Plugs are listed one at a time, and one who rules dishonestly can be removed for new deals. They can never take the money for themselves.",
  },
  {
    q: 'What does it cost?',
    a: "Plug360 takes nothing. The plug fee, up to 5%, is set per deal and split evenly between buyer and seller. Gas on Arc is paid in USDC and costs a fraction of a cent per action.",
  },
  {
    q: 'What if the plug disappears?',
    a: 'They get 7 days to rule on a dispute. After that, the buyer can be refunded in full, and anyone can trigger it.',
  },
  ...(circleEnabled
    ? [
        {
          q: "I've never used crypto. Can I still use it?",
          a: 'Yes. Sign in with Google and you get your own Arc wallet, secured by Circle. Only you can approve payments from it.',
        },
      ]
    : []),
  {
    q: 'Which wallets work?',
    a: circleEnabled
      ? 'Sign in with Google for a wallet made for you, or use any wallet that runs in your browser, like Rabby or MetaMask. Plug360 adds the Arc network for you.'
      : 'Any wallet that runs in your browser, like Rabby or MetaMask, or the in-app browser of a mobile wallet. Plug360 adds the Arc network for you.',
  },
  {
    q: 'How do I turn USDC into cash?',
    a: 'Send it to an exchange that accepts USDC on the Arc network, sell it there and withdraw to your bank. The Add USDC page lists exchanges that support Arc today.',
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
            <span className="size-1.5 rounded-full bg-mint" /> Escrow for gigs between people who know each other
          </p>
          <h1 className="font-display text-[2.75rem] font-semibold leading-[1.04] tracking-[-0.03em] text-balance sm:text-6xl lg:text-[4.25rem]">
            <span className="block">Pay for the gig.</span>
            <span className="block text-muted">Hold it till it&apos;s done.</span>
          </h1>
          <p className="max-w-[46ch] text-lg leading-relaxed text-muted">
            Paying someone you half-know means one of you goes first. With Plug360, neither of you has to. The buyer&apos;s USDC waits in escrow until the job is done, and if you disagree, a friend you both trust, your plug, makes the call.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/new" size="lg" icon={<ArrowRight weight="bold" className="size-4" />} className="flex-row-reverse">
              Start a deal
            </ButtonLink>
            <ButtonLink href="#how" size="lg" variant="ghost" icon={<ArrowDown className="size-4" />} className="flex-row-reverse">
              How it works
            </ButtonLink>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
            <li className="inline-flex items-center gap-1.5">
              <CheckCircle weight="fill" className="size-4 text-mint" />
              <a href={`https://sourcify.dev/#/lookup/${network.escrow}`} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
                Contract verified
              </a>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <CheckCircle weight="fill" className="size-4 text-mint" /> 0% platform fee
            </li>
            <li className="inline-flex items-center gap-1.5">
              <CheckCircle weight="fill" className="size-4 text-mint" /> Up to 100 USDC per deal
            </li>
          </ul>
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
            In a dispute, the contract gives the plug two choices: money back to the buyer, or payment to the seller. There is no option that sends the money to the plug or anyone else. That&apos;s why the plug should be someone you both trust.
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

      <section className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="max-w-[18ch] font-display text-3xl font-semibold tracking-tight md:text-4xl">Made for the deals you already do.</h2>
          <p className="max-w-[40ch] text-muted">Anything where one side pays and the other delivers later.</p>
        </div>
        <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
          {USE_CASES.map((u) => (
            <li key={u.title} className="w-[72%] shrink-0 snap-start space-y-3 rounded-[20px] border border-line bg-surface p-5 md:w-auto">
              <p className="tabular font-display text-2xl font-semibold">
                {u.price}
                <span className="ml-1 text-sm font-medium text-muted">USDC</span>
              </p>
              <p className="font-medium">{u.title}</p>
              <p className="text-sm text-muted">{u.window}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="plugs" className="grid scroll-mt-24 gap-10 rounded-[28px] border border-line bg-surface p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="space-y-5">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-gold-ink">
            <SealCheck weight="fill" className="size-4" /> For plugs
          </p>
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">People already trust you to vouch. Get paid for it.</h2>
          <p className="max-w-[48ch] leading-relaxed text-muted">
            If people in your group chats already ask you who to trust, you&apos;re a plug. You earn up to 5% of every deal you referee, paid when the deal pays out, and most deals never need you at all.
          </p>
          <ButtonLink href={PLUG_REQUEST} target="_blank" rel="noreferrer" variant="ink" size="lg" icon={<ArrowRight weight="bold" className="size-4" />} className="flex-row-reverse">
            Ask to be listed
          </ButtonLink>
          <p className="text-xs text-faint">Plugs are listed by hand while the contract is new. Your level sets the largest deal you can referee.</p>
        </div>
        <dl className="divide-y divide-line rounded-[20px] border border-line bg-bg">
          {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((lvl) => (
            <div key={lvl} className="flex items-center justify-between px-5 py-3.5">
              <dt className="inline-flex items-center gap-2 text-sm font-medium">
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-gold-soft px-2 text-xs text-gold-ink">
                  <SealCheck weight="fill" className="size-3.5" /> Level {lvl}
                </span>
              </dt>
              <dd className="tabular text-sm text-muted">deals up to {usdc(levelCap(lvl))} USDC</dd>
            </div>
          ))}
        </dl>
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
