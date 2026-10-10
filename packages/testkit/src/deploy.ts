import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Chain,
  type HDAccount,
} from 'viem';
import { anvilAccount, roles } from './accounts.js';
import { loadArtifact } from './artifacts.js';

/** The MockUSDC functions tests call (6 decimals, open mint, blocklist toggle). */
export const mockUsdcAbi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function setBlocked(address account, bool isBlocked)',
  'function blocked(address) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

export function clientsFor(rpcUrl: string, chain: Chain) {
  const transport = http(rpcUrl, { retryCount: 0 });
  const publicClient = createPublicClient({ chain, transport, pollingInterval: 50 });
  const testClient = createTestClient({ chain, transport, mode: 'anvil' });
  const wallet = (account: HDAccount) => createWalletClient({ chain, transport, account });
  return { publicClient, testClient, wallet };
}

export type Fixture = ReturnType<typeof clientsFor> & {
  chain: Chain;
  rpcUrl: string;
  escrow: Address;
  usdc: Address;
  deployBlock: bigint;
  accounts: { [K in keyof typeof roles]: HDAccount };
};

/**
 * Deploys MockUSDC and DealEscrow from the compiled Foundry artifacts, owned by the anvil owner account,
 * and lists `plugLevels` (address -> level) when given.
 */
export async function deployFixture(
  rpcUrl: string,
  chain: Chain,
  plugLevels: Array<[Address, number]> = [],
): Promise<Fixture> {
  const clients = clientsFor(rpcUrl, chain);
  const { publicClient, wallet } = clients;
  const accounts = Object.fromEntries(
    Object.entries(roles).map(([name, index]) => [name, anvilAccount(index)]),
  ) as Fixture['accounts'];
  const owner = wallet(accounts.owner);

  const usdcArtifact = loadArtifact('MockUSDC');
  const usdcHash = await owner.deployContract({ abi: usdcArtifact.abi, bytecode: usdcArtifact.bytecode });
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcHash });
  if (!usdcReceipt.contractAddress) throw new Error('MockUSDC deployment failed');

  const escrowArtifact = loadArtifact('DealEscrow');
  const escrowHash = await owner.deployContract({
    abi: escrowArtifact.abi,
    bytecode: escrowArtifact.bytecode,
    args: [usdcReceipt.contractAddress, accounts.owner.address],
  });
  const escrowReceipt = await publicClient.waitForTransactionReceipt({ hash: escrowHash });
  if (!escrowReceipt.contractAddress) throw new Error('DealEscrow deployment failed');

  for (const [plug, level] of plugLevels) {
    const hash = await owner.writeContract({
      address: escrowReceipt.contractAddress,
      abi: parseAbi(['function setPlugLevel(address plug, uint8 level)']),
      functionName: 'setPlugLevel',
      args: [plug, level],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  return {
    ...clients,
    chain,
    rpcUrl,
    escrow: getAddress(escrowReceipt.contractAddress),
    usdc: getAddress(usdcReceipt.contractAddress),
    deployBlock: escrowReceipt.blockNumber,
    accounts,
  };
}
