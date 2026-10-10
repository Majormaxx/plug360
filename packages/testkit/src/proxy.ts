import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type JsonRpcRequest = { jsonrpc: '2.0'; id: number | string | null; method: string; params?: unknown[] };

export type ArcProxyOptions = {
  /** Largest eth_getLogs range accepted, in blocks (inclusive). Arc's limit is 10,000. */
  maxLogBlocks?: number;
};

export type ArcProxy = {
  url: string;
  /** Every numeric eth_getLogs range forwarded upstream, in order. */
  logRanges: Array<{ from: bigint; to: bigint }>;
  /** Count of JSON-RPC calls received, by method. */
  calls: Map<string, number>;
  /** The next `count` calls to `method` (or any method when omitted) fail with JSON-RPC error `code`. */
  failNext: (count: number, options?: { code?: number; method?: string }) => void;
  /** While down, every request gets HTTP 503. */
  setDown: (down: boolean) => void;
  stop: () => Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function asBlock(value: unknown): bigint | undefined {
  return typeof value === 'string' && value.startsWith('0x') ? BigInt(value) : undefined;
}

/**
 * A JSON-RPC proxy in front of anvil that behaves like Arc's public RPC where it matters to the keeper:
 * eth_getLogs over 10,000 blocks is rejected, and tests can inject -32014 errors or take the endpoint down.
 */
export async function startArcProxy(upstream: string, options: ArcProxyOptions = {}): Promise<ArcProxy> {
  const maxLogBlocks = BigInt(options.maxLogBlocks ?? 10_000);
  const logRanges: ArcProxy['logRanges'] = [];
  const calls = new Map<string, number>();
  const faults: Array<{ code: number; method?: string }> = [];
  let down = false;

  async function handleOne(call: JsonRpcRequest): Promise<unknown> {
    calls.set(call.method, (calls.get(call.method) ?? 0) + 1);
    const faultIndex = faults.findIndex((f) => f.method === undefined || f.method === call.method);
    if (faultIndex >= 0) {
      const [fault] = faults.splice(faultIndex, 1);
      return { jsonrpc: '2.0', id: call.id, error: { code: fault!.code, message: 'injected fault' } };
    }
    if (call.method === 'eth_getLogs') {
      const filter = (call.params?.[0] ?? {}) as { fromBlock?: unknown; toBlock?: unknown };
      const from = asBlock(filter.fromBlock);
      const to = asBlock(filter.toBlock);
      if (from !== undefined && to !== undefined) {
        if (to - from + 1n > maxLogBlocks) {
          return {
            jsonrpc: '2.0',
            id: call.id,
            error: { code: -32614, message: `eth_getLogs is limited to a ${maxLogBlocks} block range` },
          };
        }
        logRanges.push({ from, to });
      }
    }
    const res = await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(call),
    });
    return res.json();
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (down) {
      res.writeHead(503).end('down');
      return;
    }
    try {
      const parsed = JSON.parse(await readBody(req)) as JsonRpcRequest | JsonRpcRequest[];
      const result = Array.isArray(parsed) ? await Promise.all(parsed.map(handleOne)) : await handleOne(parsed);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('proxy has no port');

  return {
    url: `http://127.0.0.1:${address.port}`,
    logRanges,
    calls,
    failNext: (count, opts = {}) => {
      for (let i = 0; i < count; i++) faults.push({ code: opts.code ?? -32014, method: opts.method });
    },
    setDown: (value) => (down = value),
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
