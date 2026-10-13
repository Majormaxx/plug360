'use client';

import { ArrowUUpLeft, Gavel, ShieldCheck, Timer } from '@phosphor-icons/react';
import { dealEscrowAbi, DealStatus, escrowedAmount, MULTICALL3FROM, USDC, validateTerms, type Deal } from '@plug360/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { erc20Abi, getAddress, isAddress, type Address, type PublicClient } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import { useEscrowStatus, usePlugLevel, useUsdc } from '@/hooks/useEscrow';
import { contractStep, useTx, type Step } from '@/hooks/useTx';
import { network } from '@/lib/config';
import type { Draft } from '@/lib/draft';
import { dealIdToHex, duration } from '@/lib/format';
import { multicall3FromAbi, oneClickCalls, type PayInput } from '@/lib/pay';
import { rememberTitle } from '@/lib/storage';
import { Amount } from '../ui/Amount';
import { Button, ButtonLink } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { Skeleton } from '../ui/Skeleton';
import { Switch } from '../ui/Switch';
import { TxStatus } from './TxStatus';

type Mode = 'one' | 'two';

/**
 * Arc's one-prompt path (Multicall3From + Memo) needs the transaction to come straight from the person's
 * key. Plain accounts have no code; EIP-7702 accounts carry a 0xef0100 delegation marker and still send
 * as themselves. Anything else is a contract wallet and pays in two steps.
 */
function useCanOneClick(publicClient: PublicClient | undefined, account: Address | undefined) {
  return useQuery({
    queryKey: ['code', account],
    enabled: !!publicClient && !!account,
    staleTime: 60_000,
    queryFn: async () => {
      const code = await publicClient!.getCode({ address: account! });
      return !code || code === '0x' || code.toLowerCase().startsWith('0xef0100');
    },
  });
}

export function PayPanel({ draft, dealId, disabled }: { draft: Draft; dealId: bigint; disabled: boolean }) {
  const router = useRouter();
  const { terms, job } = draft;
  const { address } = useAccount();
  const publicClient = usePublicClient() as PublicClient | undefined;
  const { balance, allowance, isLoading: usdcLoading } = useUsdc(address);
  const { paused, totalHeld } = useEscrowStatus();
  const { level } = usePlugLevel(terms.plug);
  const canOneClick = useCanOneClick(publicClient, address);
  const { state, run, recheck, reset, busy } = useTx();

  const [customRefund, setCustomRefund] = useState(false);
  const [refundInput, setRefundInput] = useState('');
  const [modeChoice, setModeChoice] = useState<Mode | undefined>(undefined);
  const mode: Mode = canOneClick.data === false ? 'two' : (modeChoice ?? 'one');

  const escrowed = escrowedAmount(terms.price, terms.plugFee);
  const refundTo = customRefund ? (isAddress(refundInput) ? getAddress(refundInput) : undefined) : address;
  const short = balance !== undefined && balance < escrowed;
  const needsApproval = allowance === undefined || allowance < escrowed;

  const violations = useMemo(() => {
    if (!address || level === undefined || !refundTo) return [];
    return validateTerms(terms, {
      now: BigInt(Math.floor(Date.now() / 1000)),
      plugLevel: level,
      buyer: address,
      refundTo,
      ...(totalHeld !== undefined ? { totalHeld } : {}),
    }).filter((v) => v.error !== 'TermsExpired');
  }, [terms, address, level, refundTo, totalHeld]);

  if (!address) return null;

  const input: PayInput | undefined =
    refundTo && draft.sellerSig && draft.plugSig
      ? { escrow: network.escrow, terms, sellerSig: draft.sellerSig, plugSig: draft.plugSig, refundTo, escrowed }
      : undefined;

  const idHex = dealIdToHex(dealId);
  // Paying twice is impossible (the order id is single-use), so "is the deal funded?" settles an unknown outcome.
  const isFunded = async () => {
    const d = (await publicClient?.readContract({ address: network.escrow, abi: dealEscrowAbi, functionName: 'getDeal', args: [dealId] })) as Deal | undefined;
    return d !== undefined && d.status !== DealStatus.None;
  };
  const openReceipt = () => {
    rememberTitle(idHex, job.title);
    router.push(`/r/${idHex}`);
  };

  function pay() {
    if (!input) return;
    const steps: Step[] =
      mode === 'one'
        ? [
            contractStep(needsApproval ? 'Approve and pay' : 'Pay', {
              address: MULTICALL3FROM,
              abi: multicall3FromAbi,
              functionName: 'aggregate3',
              args: [oneClickCalls(input, needsApproval)],
            }),
          ]
        : [
            ...(needsApproval
              ? [contractStep('Approve USDC', { address: USDC, abi: erc20Abi, functionName: 'approve', args: [network.escrow, escrowed] })]
              : []),
            contractStep('Pay', {
              address: network.escrow,
              abi: dealEscrowAbi,
              functionName: 'pay',
              args: [input.terms, input.sellerSig, input.plugSig, input.refundTo],
            }),
          ];
    void run({ label: 'Payment', steps, dealIdHex: idHex, verify: isFunded, onDone: openReceipt });
  }

  const blocked = disabled || paused === true || short || !refundTo || violations.length > 0 || usdcLoading;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">You pay</p>
        <Amount value={escrowed} className="font-display text-3xl font-semibold tracking-tight" />
        {terms.plugFee > 0n && <p className="mt-0.5 text-sm text-muted">Includes your half of the plug fee.</p>}
      </div>

      <ul className="space-y-3 rounded-[16px] bg-bg p-4 text-sm">
        <Protection icon={<Timer className="size-[18px]" />}>
          {terms.windowSeconds === 0 ? (
            <>No money-back window: the seller can be paid as soon as you pay.</>
          ) : (
            <>For <strong className="font-medium">{duration(terms.windowSeconds)}</strong> after you pay, you can open a dispute if the job isn&apos;t done.</>
          )}
        </Protection>
        <Protection icon={<Gavel className="size-[18px]" />}>
          In a dispute your plug decides within 7 days. If they don&apos;t, you get everything back.
        </Protection>
        <Protection icon={<ArrowUUpLeft className="size-[18px]" />}>Refunds can only go to the address below. Nobody can redirect them.</Protection>
        <Protection icon={<ShieldCheck className="size-[18px]" />}>The money sits in the escrow contract. Plug360, the seller and the plug can&apos;t withdraw it for themselves.</Protection>
      </ul>

      <div className="space-y-3">
        <Switch
          checked={customRefund}
          onChange={setCustomRefund}
          label="Send refunds somewhere else"
          description={customRefund ? 'Use an address you control, never the seller or the plug.' : 'Refunds go back to this wallet.'}
        />
        {customRefund && (
          <Field label="Refund address" error={refundInput && !refundTo ? 'That is not a valid address.' : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="font-mono text-[15px]" placeholder="0x…" spellCheck={false} autoCapitalize="off" value={refundInput} onChange={(e) => setRefundInput(e.target.value.trim())} />
            )}
          </Field>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">How to pay</p>
        {canOneClick.isLoading ? (
          <Skeleton className="h-10 rounded-full" />
        ) : (
          <Segmented<Mode>
            label="Payment method"
            size="sm"
            value={mode}
            onChange={setModeChoice}
            options={[
              { value: 'one', label: 'One step', disabled: canOneClick.data === false },
              { value: 'two', label: needsApproval ? 'Two steps' : 'Direct' },
            ]}
          />
        )}
        <p className="text-xs leading-relaxed text-muted">
          {canOneClick.data === false
            ? 'This is a smart-contract wallet, so it approves USDC first and then pays.'
            : mode === 'one'
              ? 'One wallet prompt. Arc tags the payment with this deal so it shows up clearly in your history.'
              : needsApproval
                ? 'Approve the escrow to take this amount, then pay. Use this if your wallet has trouble with one-step payments.'
                : 'The escrow is already approved, so this is a single payment.'}
        </p>
      </div>

      {paused && <Notice tone="warn" title="New deals are paused">Open deals still work. Try again later.</Notice>}
      {short && balance !== undefined && (
        <Notice tone="warn" title="Not enough USDC" action={<ButtonLink href="/add-usdc" size="sm" variant="ink">Add USDC</ButtonLink>}>
          You have <Amount value={balance} /> and need <Amount value={escrowed} />, plus a little for gas.
        </Notice>
      )}
      {violations.map((v) => (
        <Notice key={v.error + v.field} tone="danger" title={v.message.charAt(0).toUpperCase() + v.message.slice(1)} />
      ))}

      <TxStatus state={state} onRecheck={() => recheck({ label: 'Payment', steps: [], verify: isFunded, onDone: openReceipt })} onDismiss={reset} />

      <Button size="lg" className="w-full" onClick={pay} loading={busy} disabled={blocked || state.phase === 'unknown'}>
        {busy ? (state.phase === 'wallet' ? 'Confirm in wallet' : 'Working') : <>Pay <Amount value={escrowed} unit={false} className="font-semibold" /> USDC</>}
      </Button>
      <p className="text-center text-xs text-faint">Gas on Arc is paid in USDC and costs a fraction of a cent.</p>
    </div>
  );
}

function Protection({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-mint-ink">{icon}</span>
      <span className="leading-relaxed text-muted">{children}</span>
    </li>
  );
}
