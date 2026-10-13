import { getAddress, isAddress, isHex, parseUnits, type Address, type Hex } from 'viem';

export type KeeperConfig = {
  rpcUrl: string;
  rpcFallbackUrl?: string;
  chainId: number;
  escrow: Address;
  deployBlock: bigint;
  privateKey: Hex;
  alertWebhookUrl?: string;
  stateFile: string;
  /** Seconds between ticks in loop mode. */
  pollIntervalSeconds: number;
  /** First wait before retrying a parked payout again; doubles per failed attempt up to 24 hours. */
  retryBackoffSeconds: number;
  /** Alert when the keeper's native gas balance falls below this. Native USDC uses 18 decimals. */
  minGasBalance: bigint;
  /** A sent transaction without a receipt after this long is treated as unknown. */
  receiptTimeoutMs: number;
  /** Warn about a dispute this many seconds before the plug's deadline. */
  deadlineWarningSeconds: number;
  /** Pay out released deals and deals whose window closed, so sellers never need gas or a button press. */
  autoPayout: boolean;
  /** The gas sponsor's hot wallet; the keeper alerts when it runs low. */
  sponsorAddress?: Address;
  minSponsorBalance: bigint;
};

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid keeper configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Reads and validates the keeper configuration from environment variables. Reports every problem at once. */
export function loadConfig(env: Env = process.env): KeeperConfig {
  const issues: string[] = [];
  const str = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v === undefined || v === '' ? undefined : v;
  };
  const required = (name: string): string => {
    const v = str(name);
    if (v === undefined) issues.push(`${name} is required`);
    return v ?? '';
  };
  const url = (name: string, value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    try {
      const u = new URL(value);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
      return value;
    } catch {
      issues.push(`${name} must be an http(s) URL`);
      return undefined;
    }
  };
  const int = (name: string, value: string | undefined, fallback: number, min: number): number => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min || !Number.isSafeInteger(Number(value))) {
      issues.push(`${name} must be an integer >= ${min}`);
      return fallback;
    }
    return Number(value);
  };

  const rpcUrlRaw = required('RPC_URL');
  const rpcUrl = rpcUrlRaw === '' ? undefined : url('RPC_URL', rpcUrlRaw);
  const rpcFallbackUrl = url('RPC_FALLBACK_URL', str('RPC_FALLBACK_URL'));
  const alertWebhookUrl = url('ALERT_WEBHOOK_URL', str('ALERT_WEBHOOK_URL'));

  const chainIdRaw = required('CHAIN_ID');
  const chainId = chainIdRaw === '' ? 0 : int('CHAIN_ID', chainIdRaw, 0, 1);

  const escrowRaw = required('ESCROW_ADDRESS');
  let escrow: Address = '0x0000000000000000000000000000000000000000';
  if (escrowRaw !== '') {
    if (isAddress(escrowRaw, { strict: false }) && !/^0x0{40}$/i.test(escrowRaw)) escrow = getAddress(escrowRaw);
    else issues.push('ESCROW_ADDRESS must be a non-zero address');
  }

  const deployBlockRaw = required('DEPLOY_BLOCK');
  let deployBlock = 0n;
  if (deployBlockRaw !== '') {
    if (/^\d+$/.test(deployBlockRaw)) deployBlock = BigInt(deployBlockRaw);
    else issues.push('DEPLOY_BLOCK must be a block number');
  }

  const keyRaw = required('KEEPER_PRIVATE_KEY');
  let privateKey: Hex = '0x';
  if (keyRaw !== '') {
    const key = keyRaw.startsWith('0x') ? keyRaw : `0x${keyRaw}`;
    if (isHex(key) && key.length === 66) privateKey = key;
    else issues.push('KEEPER_PRIVATE_KEY must be 32 bytes of hex');
  }

  let minGasBalance = parseUnits('1', 18);
  const minGasRaw = str('MIN_GAS_BALANCE_USDC');
  if (minGasRaw !== undefined) {
    if (/^\d+(\.\d{1,18})?$/.test(minGasRaw)) minGasBalance = parseUnits(minGasRaw, 18);
    else issues.push('MIN_GAS_BALANCE_USDC must be a decimal USDC amount');
  }

  let minSponsorBalance = parseUnits('0.5', 18);
  const minSponsorRaw = str('MIN_SPONSOR_BALANCE_USDC');
  if (minSponsorRaw !== undefined) {
    if (/^\d+(\.\d{1,18})?$/.test(minSponsorRaw)) minSponsorBalance = parseUnits(minSponsorRaw, 18);
    else issues.push('MIN_SPONSOR_BALANCE_USDC must be a decimal USDC amount');
  }
  const sponsorRaw = str('SPONSOR_ADDRESS');
  if (sponsorRaw !== undefined && !isAddress(sponsorRaw)) issues.push('SPONSOR_ADDRESS must be an address');
  const autoPayoutRaw = str('AUTO_PAYOUT');
  if (autoPayoutRaw !== undefined && autoPayoutRaw !== 'true' && autoPayoutRaw !== 'false') issues.push('AUTO_PAYOUT must be true or false');

  const config: KeeperConfig = {
    rpcUrl: rpcUrl ?? '',
    chainId,
    escrow,
    deployBlock,
    privateKey,
    stateFile: str('STATE_FILE') ?? '.keeper-state.json',
    pollIntervalSeconds: int('POLL_INTERVAL_SECONDS', str('POLL_INTERVAL_SECONDS'), 60, 1),
    retryBackoffSeconds: int('RETRY_BACKOFF_SECONDS', str('RETRY_BACKOFF_SECONDS'), 3600, 1),
    minGasBalance,
    receiptTimeoutMs: int('RECEIPT_TIMEOUT_SECONDS', str('RECEIPT_TIMEOUT_SECONDS'), 30, 1) * 1000,
    deadlineWarningSeconds: int('DEADLINE_WARNING_SECONDS', str('DEADLINE_WARNING_SECONDS'), 86_400, 0),
    autoPayout: autoPayoutRaw !== 'false',
    minSponsorBalance,
  };
  if (sponsorRaw !== undefined && isAddress(sponsorRaw)) config.sponsorAddress = getAddress(sponsorRaw);
  if (rpcFallbackUrl !== undefined) config.rpcFallbackUrl = rpcFallbackUrl;
  if (alertWebhookUrl !== undefined) config.alertWebhookUrl = alertWebhookUrl;

  if (issues.length > 0) throw new ConfigError(issues);
  return config;
}
