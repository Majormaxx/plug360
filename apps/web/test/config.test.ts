import { describe, expect, it } from 'vitest';
import { resolveNetwork } from '../src/lib/config';
import deployment from '../../../contracts/deployments/5042002.json';

describe('resolveNetwork', () => {
  it('defaults to the committed testnet deployment', () => {
    const n = resolveNetwork({});
    expect(n.chain.id).toBe(5042002);
    expect(n.escrow.toLowerCase()).toBe(deployment.escrow.toLowerCase());
    expect(n.deployBlock).toBe(BigInt(deployment.deployBlock));
    expect(n.rpcUrls[0]).toBe('https://rpc.drpc.testnet.arc.io');
    expect(n.chain.rpcUrls.default.http).toEqual(n.rpcUrls);
  });

  it('treats blank env values as unset', () => {
    expect(resolveNetwork({ NEXT_PUBLIC_CHAIN_ID: ' ', NEXT_PUBLIC_ESCROW: '' }).chain.id).toBe(5042002);
  });

  it('applies overrides and checksums the escrow', () => {
    const n = resolveNetwork({
      NEXT_PUBLIC_CHAIN_ID: '5042',
      NEXT_PUBLIC_ESCROW: '0x3df58effc292d5043075d71e6705df6b7348171d',
      NEXT_PUBLIC_DEPLOY_BLOCK: '7',
      NEXT_PUBLIC_RPC_URLS: 'https://a.example, https://b.example',
    });
    expect(n.chain.id).toBe(5042);
    expect(n.escrow).toBe('0x3df58eFFC292D5043075d71e6705dF6b7348171D');
    expect(n.deployBlock).toBe(7n);
    expect(n.rpcUrls).toEqual(['https://a.example', 'https://b.example']);
  });

  it('refuses mainnet without an escrow address, and unknown chains', () => {
    expect(() => resolveNetwork({ NEXT_PUBLIC_CHAIN_ID: '5042' })).toThrow(/NEXT_PUBLIC_ESCROW/);
    expect(() => resolveNetwork({ NEXT_PUBLIC_CHAIN_ID: '1' })).toThrow();
    expect(() => resolveNetwork({ NEXT_PUBLIC_ESCROW: '0x123' })).toThrow();
  });
});
