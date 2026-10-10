import { describe, expect, it } from 'vitest';
import { parseUnits } from 'viem';
import { ConfigError, loadConfig } from '../src/index.js';

const KEY = `0x${'11'.repeat(32)}`;
const valid = {
  RPC_URL: 'https://rpc.mainnet.arc.io',
  CHAIN_ID: '5042',
  ESCROW_ADDRESS: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  DEPLOY_BLOCK: '123',
  KEEPER_PRIVATE_KEY: KEY,
  STATE_FILE: '/var/lib/keeper/state.json',
};

function issues(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
}

describe('loadConfig', () => {
  it('parses a complete environment with defaults', () => {
    const c = loadConfig(valid);
    expect(c).toMatchObject({
      rpcUrl: valid.RPC_URL,
      chainId: 5042,
      escrow: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      deployBlock: 123n,
      privateKey: KEY,
      stateFile: valid.STATE_FILE,
      pollIntervalSeconds: 60,
      retryBackoffSeconds: 3600,
      minGasBalance: parseUnits('1', 18),
      receiptTimeoutMs: 30_000,
      deadlineWarningSeconds: 86_400,
    });
    expect(c.rpcFallbackUrl).toBeUndefined();
    expect(c.alertWebhookUrl).toBeUndefined();
  });

  it('reads optional values', () => {
    const c = loadConfig({
      ...valid,
      RPC_FALLBACK_URL: 'https://rpc.backup.example',
      ALERT_WEBHOOK_URL: 'https://hooks.example/abc',
      MIN_GAS_BALANCE_USDC: '0.5',
      RETRY_BACKOFF_SECONDS: '600',
      RECEIPT_TIMEOUT_SECONDS: '45',
      KEEPER_PRIVATE_KEY: KEY.slice(2),
    });
    expect(c.rpcFallbackUrl).toBe('https://rpc.backup.example');
    expect(c.alertWebhookUrl).toBe('https://hooks.example/abc');
    expect(c.minGasBalance).toBe(parseUnits('0.5', 18));
    expect(c.retryBackoffSeconds).toBe(600);
    expect(c.receiptTimeoutMs).toBe(45_000);
    expect(c.privateKey).toBe(KEY);
  });

  it('defaults STATE_FILE', () => {
    const { STATE_FILE: _, ...rest } = valid;
    expect(loadConfig(rest).stateFile).toBe('.keeper-state.json');
  });

  it('lists every missing required variable at once', () => {
    expect(issues({})).toEqual([
      'RPC_URL is required',
      'CHAIN_ID is required',
      'ESCROW_ADDRESS is required',
      'DEPLOY_BLOCK is required',
      'KEEPER_PRIVATE_KEY is required',
    ]);
  });

  it('rejects malformed values', () => {
    expect(issues({ ...valid, RPC_URL: 'ftp://x' })).toEqual(['RPC_URL must be an http(s) URL']);
    expect(issues({ ...valid, RPC_FALLBACK_URL: 'not a url' })).toEqual(['RPC_FALLBACK_URL must be an http(s) URL']);
    expect(issues({ ...valid, ALERT_WEBHOOK_URL: 'nope' })).toEqual(['ALERT_WEBHOOK_URL must be an http(s) URL']);
    expect(issues({ ...valid, CHAIN_ID: '0' })).toEqual(['CHAIN_ID must be an integer >= 1']);
    expect(issues({ ...valid, CHAIN_ID: 'arc' })).toEqual(['CHAIN_ID must be an integer >= 1']);
    expect(issues({ ...valid, ESCROW_ADDRESS: '0x1234' })).toEqual(['ESCROW_ADDRESS must be a non-zero address']);
    expect(issues({ ...valid, ESCROW_ADDRESS: `0x${'0'.repeat(40)}` })).toEqual(['ESCROW_ADDRESS must be a non-zero address']);
    expect(issues({ ...valid, DEPLOY_BLOCK: '-1' })).toEqual(['DEPLOY_BLOCK must be a block number']);
    expect(issues({ ...valid, KEEPER_PRIVATE_KEY: '0x1234' })).toEqual(['KEEPER_PRIVATE_KEY must be 32 bytes of hex']);
    expect(issues({ ...valid, MIN_GAS_BALANCE_USDC: '1e3' })).toEqual(['MIN_GAS_BALANCE_USDC must be a decimal USDC amount']);
    expect(issues({ ...valid, POLL_INTERVAL_SECONDS: '0' })).toEqual(['POLL_INTERVAL_SECONDS must be an integer >= 1']);
  });
});
