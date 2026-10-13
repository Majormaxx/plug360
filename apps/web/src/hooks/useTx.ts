'use client';

import { feeOverrides, type FeeOverrides } from '@plug360/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useReducer, useRef } from 'react';
import { toast } from 'sonner';
import type { Abi, Address, Hash, PublicClient, SimulateContractParameters, WalletClient, WriteContractParameters } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { explorerTx, network } from '@/lib/config';
import { toFriendlyError } from '@/lib/errors';
import { logActivity } from '@/lib/storage';
import { requestGas, SponsorApiError } from '@/lib/sponsor';
import { ensureGasFor } from '@/lib/gas';
import type { SponsoredAction } from '@plug360/sponsor/contract';
import { idleTx, isBusy, txReducer } from '@/lib/tx';

export type StepContext = { account: Address; publicClient: PublicClient; walletClient: WalletClient; fees: FeeOverrides };

/**
 * One transaction. `prepare` runs checks and simulates (no wallet prompt) and returns the function that
 * opens the wallet. A failing simulation therefore shows the contract's reason before anyone signs.
 */
export type Step = { label: string; prepare: (ctx: StepContext) => Promise<() => Promise<Hash>> };

type ContractCall = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };

/**
 * Makes sure a plain-key wallet can pay gas for a sponsored action. If it holds too little USDC for gas,
 * the gas sponsor tops it up first; smart wallets are skipped because Circle's Gas Station covers them.
 */
async function ensureGas(ctx: StepContext, call: ContractCall, sponsor: { dealId: bigint; action: SponsoredAction }) {
  const { account, publicClient, fees } = ctx;
  await ensureGasFor(
    account,
    fees.maxFeePerGas,
    {
      getCode: (a) => publicClient.getCode({ address: a }),
      estimateGas: () => publicClient.estimateContractGas({ ...call, account } as never),
      getBalance: (a) => publicClient.getBalance({ address: a }),
      requestGas: () => requestGas(account, sponsor.dealId, sponsor.action),
    },
    (err) => err instanceof SponsorApiError && err.reason === 'unconfigured',
  );
}

/** A step that calls one contract function: simulated first, then sent with Arc's fee floor. */
export function contractStep(label: string, call: ContractCall, opts: { sponsor?: { dealId: bigint; action: SponsoredAction } } = {}): Step {
  return {
    label,
    prepare: async (ctx) => {
      const { account, publicClient, walletClient, fees } = ctx;
      if (opts.sponsor) await ensureGas(ctx, call, opts.sponsor);
      await publicClient.simulateContract({ ...call, account } as unknown as SimulateContractParameters);
      return () => walletClient.writeContract({ ...call, account, chain: network.chain, ...fees } as unknown as WriteContractParameters);
    },
  };
}

export type RunOptions = {
  label: string;
  /** Wallet steps, or a builder that runs first (during "checking") for work that must happen before them. */
  steps: Step[] | (() => Promise<Step[]>);
  /** Number of wallet steps when `steps` is a builder, for the progress display. */
  stepCount?: number;
  dealIdHex?: string;
  /** Asked when a receipt does not arrive in time: true means the intended state change is visible on-chain. */
  verify?: () => Promise<boolean>;
  onDone?: (hashes: Hash[]) => void;
};

const RECEIPT_TIMEOUT_MS = 60_000;

export function useTx() {
  const [state, dispatch] = useReducer(txReducer, idleTx);
  const stateRef = useRef(state);
  stateRef.current = state;
  const publicClient = usePublicClient() as PublicClient | undefined;
  const { data: walletClient } = useWalletClient();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();

  const settle = useCallback(
    (opts: RunOptions, hashes: Hash[]) => {
      void queryClient.invalidateQueries();
      const last = hashes.at(-1);
      toast.success(`${opts.label} confirmed`, {
        ...(last ? { action: { label: 'View', onClick: () => window.open(explorerTx(last), '_blank', 'noopener') } } : {}),
      });
      opts.onDone?.(hashes);
    },
    [queryClient],
  );

  const run = useCallback(
    async (opts: RunOptions) => {
      if (isBusy(stateRef.current)) return;
      dispatch({ type: 'start', label: opts.label, steps: Array.isArray(opts.steps) ? opts.steps.length : (opts.stepCount ?? 1) });
      const hashes: Hash[] = [];
      let toastId: string | number | undefined;
      try {
        if (!address || !walletClient || !publicClient) throw new Error('Connect a wallet first.');
        if (chainId !== network.chain.id) await switchChainAsync({ chainId: network.chain.id });

        const steps = Array.isArray(opts.steps) ? opts.steps : await opts.steps();
        for (const step of steps) {
          const fees = await feeOverrides(publicClient);
          const send = await step.prepare({ account: address, publicClient, walletClient, fees });
          dispatch({ type: 'prompt' });
          const hash = await send();
          hashes.push(hash);
          dispatch({ type: 'sent', hash });
          if (opts.dealIdHex) logActivity({ dealId: opts.dealIdHex, label: step.label, hash, at: Date.now() });
          toastId = toast.loading(`${step.label}: waiting for Arc`, { id: toastId });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
          if (receipt.status !== 'success') {
            throw Object.assign(new Error('reverted'), { reverted: true });
          }
          dispatch({ type: 'confirmed' });
        }
        toast.dismiss(toastId);
        settle(opts, hashes);
      } catch (err) {
        toast.dismiss(toastId);
        if ((err as { reverted?: boolean }).reverted) {
          const error = { kind: 'revert' as const, title: 'The transaction failed on-chain. No funds moved.' };
          dispatch({ type: 'fail', error });
          toast.error(error.title);
          return;
        }
        const error = toFriendlyError(err);
        if (error.kind === 'timeout' && hashes.length > 0) {
          dispatch({ type: 'lost', error });
          toast.warning(error.title, { description: error.detail });
          return;
        }
        dispatch({ type: 'fail', error });
        if (error.kind === 'cancelled') toast(error.title);
        else toast.error(error.title, error.detail ? { description: error.detail } : undefined);
      }
    },
    [address, walletClient, publicClient, chainId, switchChainAsync, settle],
  );

  /** After an unknown outcome: ask the chain whether the change landed. */
  const recheck = useCallback(
    async (opts: RunOptions) => {
      const s = stateRef.current;
      if (s.phase !== 'unknown') return;
      const hash = s.hash;
      try {
        const receipt = hash && publicClient ? await publicClient.getTransactionReceipt({ hash }).catch(() => undefined) : undefined;
        const landed = receipt?.status === 'success' || (receipt === undefined && (await opts.verify?.()) === true);
        if (landed && s.step < s.steps) {
          // An earlier step (the approval) landed; the remaining steps start fresh on the next tap.
          dispatch({ type: 'confirmed' });
          dispatch({ type: 'fail', error: { kind: 'unknown', title: `Step ${s.step} confirmed. Tap again to finish.` } });
          void queryClient.invalidateQueries();
        } else if (landed) {
          dispatch({ type: 'confirmed' });
          settle(opts, s.hashes);
        } else if (receipt?.status === 'reverted') {
          dispatch({ type: 'reset' });
          toast.error('That transaction failed on-chain. No funds moved.');
        } else {
          toast('Still not confirmed. It can take a little longer when Arc is busy.');
        }
      } catch (err) {
        toast.error(toFriendlyError(err).title);
      }
    },
    [publicClient, settle, queryClient],
  );

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { state, run, recheck, reset, busy: isBusy(state) };
}
