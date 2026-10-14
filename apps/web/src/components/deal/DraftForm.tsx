'use client';

import { ArrowRight, Handshake, Storefront } from '@phosphor-icons/react';
import { MAX_LEVEL, validateTerms, type TermsViolation } from '@plug360/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { getAddress, isAddress, isAddressEqual, zeroAddress } from 'viem';
import { useAccount } from 'wagmi';
import { usePlugLevel } from '@/hooks/useEscrow';
import { network } from '@/lib/config';
import {
  encodeDraft,
  EXPIRY_PRESETS,
  FEE_PRESETS_BPS,
  feeForBps,
  jobHash,
  newOrderId,
  NOTE_MAX,
  parseUsdcInput,
  TITLE_MAX,
  WINDOW_PRESETS,
} from '@/lib/draft';
import { duration } from '@/lib/format';
import { Button } from '../ui/Button';
import { Field, Input, TextArea } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Panel } from '../ui/Panel';
import { Segmented } from '../ui/Segmented';
import { ConnectButton } from '../wallet/ConnectButton';
import { FeeBreakdown } from './FeeBreakdown';
import { PlugCheck } from './PlugCheck';
import { PlugPicker } from './PlugPicker';
import { QrScanButton } from './QrScan';
import { NairaHint } from './NairaHint';
import { rememberPlug } from '@/lib/storage';
import { lookalikeOf } from '@/lib/lookalike';
import { knownAddresses, lookalikeMessage } from '@/lib/knownAddresses';

type Role = 'seller' | 'buyer';
type PlugMode = 'known' | 'open';
type Form = {
  role: Role;
  title: string;
  note: string;
  price: string;
  seller: string;
  plug: string;
  plugMode: PlugMode;
  feeBps: number;
  windowSeconds: number;
  expirySeconds: number;
};

const initial: Form = {
  role: 'seller',
  title: '',
  note: '',
  price: '',
  seller: '',
  plug: '',
  plugMode: 'known',
  feeBps: 200,
  windowSeconds: 3 * 86_400,
  expirySeconds: 7 * 86_400,
};

type Touched = Partial<Record<keyof Form, boolean>>;

/** Field-level message for a contract rule, phrased for the person filling the form. */
function messageFor(v: TermsViolation, role: Role): string | undefined {
  switch (v.error) {
    case 'SameParty':
      return v.field === 'seller' && role === 'buyer' ? 'You are the buyer, so the seller must be someone else.' : 'The plug must be a third person, not the buyer or the seller.';
    case 'PlugNotListed':
      return 'This address is not a listed plug. Ask them to get listed, or pick someone who is.';
    case 'ZeroAddress':
      return 'Enter a real address.';
    default:
      return v.message.charAt(0).toUpperCase() + v.message.slice(1) + '.';
  }
}

export function DraftForm() {
  const router = useRouter();
  const { address } = useAccount();
  const [form, set] = useReducer((s: Form, p: Partial<Form>) => ({ ...s, ...p }), initial);
  const [touched, touch] = useReducer((s: Touched, k: keyof Form) => ({ ...s, [k]: true }), {});
  const [submitted, setSubmitted] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const seller = form.role === 'seller' ? address : isAddress(form.seller) ? getAddress(form.seller) : undefined;
  const open = form.plugMode === 'open';
  const plugAddr = open ? undefined : isAddress(form.plug) ? getAddress(form.plug) : undefined;
  const price = parseUsdcInput(form.price);
  const fee = price !== undefined ? feeForBps(price, form.feeBps) : 0n;
  const { level: plugLevel, isLoading: plugLoading } = usePlugLevel(plugAddr);
  // With an open seat the plug is checked when they claim it; until then the highest level's limits apply.
  const level = open ? MAX_LEVEL : plugLevel;
  const checkPlug = open ? ('0x0000000000000000000000000000000000000001' as const) : plugAddr;

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!form.title.trim()) e.title = 'Say what the deal is for.';
    if (form.price && price === undefined) e.price = 'Enter an amount like 25 or 12.50.';
    if (!form.price) e.price = 'Enter a price.';
    if (form.role === 'buyer' && !form.seller) e.seller = "Enter the seller's wallet address.";
    else if (form.role === 'buyer' && !isAddress(form.seller)) e.seller = 'That is not a valid address.';
    if (!open && !form.plug) e.plug = "Choose your plug, or paste their address.";
    else if (!open && !plugAddr) e.plug = 'That is not a valid address.';

    // Address poisoning: block any pasted address that mimics one this person has really used.
    const known = knownAddresses(address);
    const plugLookalike = !open && plugAddr ? lookalikeOf(plugAddr, known) : undefined;
    if (plugLookalike) e.plug = lookalikeMessage(plugLookalike);
    const sellerLookalike = form.role === 'buyer' && seller ? lookalikeOf(seller, known) : undefined;
    if (sellerLookalike) e.seller = lookalikeMessage(sellerLookalike);

    if (seller && checkPlug && price !== undefined && level !== undefined) {
      const terms = {
        seller,
        plug: checkPlug,
        orderId: `0x${'00'.repeat(32)}` as const,
        price,
        plugFee: fee,
        windowSeconds: form.windowSeconds,
        expiry: BigInt(now + form.expirySeconds),
        metadataHash: `0x${'00'.repeat(32)}` as const,
      };
      const buyer = form.role === 'buyer' ? address : undefined;
      for (const v of validateTerms(terms, { now: BigInt(now), plugLevel: level, ...(buyer ? { buyer } : {}) })) {
        const field: keyof Form = v.field === 'plugFee' ? 'feeBps' : v.field === 'price' ? 'price' : v.field === 'seller' ? 'seller' : 'plug';
        if (open && field === 'plug') continue;
        e[field] ??= messageFor(v, form.role);
      }
    }
    return e;
  }, [form, price, fee, seller, checkPlug, open, level, now, address]);

  const show = (k: keyof Form) => (submitted || touched[k] ? errors[k] : undefined);
  const needsWallet = form.role === 'seller' && !address;
  const ready = Object.keys(errors).length === 0 && !needsWallet && level !== undefined && (open || !plugLoading);

  function create() {
    setSubmitted(true);
    if (!ready || !seller || (!open && !plugAddr) || price === undefined) return;
    if (plugAddr) rememberPlug(plugAddr);
    const job = { title: form.title.trim(), note: form.note.trim() };
    const encoded = encodeDraft({
      chainId: network.chain.id,
      escrow: network.escrow,
      job,
      terms: {
        seller,
        plug: plugAddr ?? zeroAddress,
        orderId: newOrderId(),
        price,
        plugFee: fee,
        windowSeconds: form.windowSeconds,
        expiry: BigInt(Math.floor(Date.now() / 1000) + form.expirySeconds),
        metadataHash: jobHash(job),
      },
    });
    router.push(`/deal#${encoded}`);
  }

  const youAreTheSellerToo = form.role === 'buyer' && address && seller && isAddressEqual(address, seller);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start"
    >
      <div className="space-y-6">
        <Panel className="space-y-5 p-5 sm:p-6">
          <Field label="I am the" hint={form.role === 'seller' ? 'You do the job and get paid. You sign the terms first.' : 'You pay for the job. The seller signs, then you pay from the same link.'}>
            {() => (
              <Segmented<Role>
                label="Your role"
                value={form.role}
                onChange={(role) => set({ role })}
                options={[
                  { value: 'seller', label: <span className="inline-flex items-center gap-2"><Storefront className="size-4" />Seller</span> },
                  { value: 'buyer', label: <span className="inline-flex items-center gap-2"><Handshake className="size-4" />Buyer</span> },
                ]}
              />
            )}
          </Field>

          <Field label="What's the job?" error={show('title')} aside={<span className="tabular text-xs text-faint">{form.title.length}/{TITLE_MAX}</span>}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                maxLength={TITLE_MAX}
                placeholder="Logo for Ada's bakery"
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                onBlur={() => touch('title')}
                autoComplete="off"
              />
            )}
          </Field>

          <Field label="Details" hint="Optional. What counts as done? Both of you sign over this text, so it can't be changed later." aside={<span className="tabular text-xs text-faint">{form.note.length}/{NOTE_MAX}</span>}>
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                maxLength={NOTE_MAX}
                placeholder="Two concepts, one round of changes, files as SVG."
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            )}
          </Field>
        </Panel>

        <Panel className="space-y-5 p-5 sm:p-6">
          <Field label="Price" error={show('price')} hint="At least 1 USDC. Your plug's level sets the maximum." aside={<NairaHint usdc={price === undefined ? undefined : Number(price) / 1e6} detail />}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                inputMode="decimal"
                placeholder="25.00"
                leading={<span className="font-medium">$</span>}
                trailing="USDC"
                className="tabular text-lg font-medium"
                value={form.price}
                onChange={(e) => set({ price: e.target.value })}
                onBlur={() => touch('price')}
              />
            )}
          </Field>

          {form.role === 'buyer' && (
            <Field label="Who's doing the job?" error={show('seller')} hint="Paste the seller's wallet address. They can copy it from the account button at the top once they've signed in.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  placeholder="Seller's address, 0x…"
                  className="font-mono text-[15px]"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  value={form.seller}
                  onChange={(e) => set({ seller: e.target.value.trim() })}
                  onBlur={() => touch('seller')}
                />
              )}
            </Field>
          )}
          {youAreTheSellerToo && <Notice tone="warn" title="This is your own wallet">The seller has to be a different person from the buyer.</Notice>}

          <Field
            label="Your plug, the person in the middle"
            hint={
              open
                ? "Send the link to your plug. They sign in when they open it, and you check it's them before you sign."
                : 'Someone you both know and trust. They only step in if there is a dispute, and they can never take the money for themselves.'
            }
          >
            {() => (
              <Segmented<PlugMode>
                label="How to add the plug"
                size="sm"
                value={form.plugMode}
                onChange={(plugMode) => set({ plugMode })}
                options={[
                  { value: 'known', label: 'Choose my plug' },
                  { value: 'open', label: 'Invite my plug' },
                ]}
              />
            )}
          </Field>
          {!open && (
            <Field label="Who's your plug?" error={show('plug')} aside={plugAddr ? <PlugCheck plug={plugAddr} /> : <QrScanButton onAddress={(a) => (set({ plug: a }), touch('plug'))} />}>
              {({ id, describedBy, invalid }) => (
                <div className="space-y-2.5">
                  <PlugPicker value={form.plug} {...(seller ? { exclude: seller } : {})} onPick={(a) => (set({ plug: a }), touch('plug'))} />
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    placeholder="Your plug's address, 0x…"
                    className="font-mono text-[15px]"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    value={form.plug}
                    onChange={(e) => set({ plug: e.target.value.trim() })}
                    onBlur={() => touch('plug')}
                  />
                </div>
              )}
            </Field>
          )}

          <Field label="Plug fee" error={show('feeBps')} hint="Split evenly between buyer and seller. Paid to the plug only when the deal pays out.">
            {() => (
              <Segmented<number>
                label="Plug fee"
                size="sm"
                value={form.feeBps}
                onChange={(feeBps) => set({ feeBps })}
                options={FEE_PRESETS_BPS.map((b) => ({ value: b, label: b === 0 ? 'None' : `${b / 100}%` }))}
              />
            )}
          </Field>

          <Field label="Money-back window" hint={WINDOW_PRESETS.find((w) => w.seconds === form.windowSeconds)?.hint || `The buyer can open a dispute for ${duration(form.windowSeconds)} after paying. After that, the seller can be paid out.`}>
            {() => (
              <Segmented<number>
                label="Money-back window"
                size="sm"
                value={form.windowSeconds}
                onChange={(windowSeconds) => set({ windowSeconds })}
                options={WINDOW_PRESETS.map((w) => ({ value: w.seconds, label: w.label }))}
              />
            )}
          </Field>

          <Field label="Link stays valid for" hint="After this, nobody can pay with the link and you'd make a new one.">
            {() => (
              <Segmented<number>
                label="Link lifetime"
                size="sm"
                value={form.expirySeconds}
                onChange={(expirySeconds) => set({ expirySeconds })}
                options={EXPIRY_PRESETS.map((x) => ({ value: x.seconds, label: x.label }))}
              />
            )}
          </Field>
        </Panel>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24">
        <Panel className="space-y-4 p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-faint">Summary</p>
            <p className="mt-1 truncate font-display text-xl font-semibold tracking-tight">{form.title.trim() || 'Untitled deal'}</p>
          </div>
          <FeeBreakdown price={price ?? 0n} plugFee={fee} highlight={form.role === 'seller' ? 'seller' : 'buyer'} />
          <ul className="space-y-1.5 text-sm text-muted">
            <li>Money-back window: <span className="text-ink">{form.windowSeconds === 0 ? 'none' : duration(form.windowSeconds)}</span></li>
            <li>If disputed, the plug has <span className="text-ink">7 days</span> to rule, or the buyer is refunded in full.</li>
          </ul>
          {needsWallet ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">Sign in to create the deal. If you're the seller, you get paid to the account you sign in with.</p>
              <ConnectButton size="lg" />
            </div>
          ) : (
            <Button type="submit" size="lg" className="w-full" disabled={submitted && !ready} icon={<ArrowRight weight="bold" className="size-4" />}>
              Create deal link
            </Button>
          )}
          {submitted && !ready && Object.keys(errors).length > 0 && (
            <p role="alert" className="text-sm text-danger-ink">Fix the highlighted fields to continue.</p>
          )}
          <p className="text-xs leading-relaxed text-faint">
            Nothing is sent yet. The link carries the terms;{' '}
            {open
              ? 'your plug adds their wallet and accepts first, then the seller signs.'
              : form.role === 'seller'
                ? 'you sign next, then your plug.'
                : 'the seller signs, then your plug, then you pay.'}
          </p>
        </Panel>
      </aside>
    </form>
  );
}

