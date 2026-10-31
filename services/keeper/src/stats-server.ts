/**
 * Tiny HTTP server that exposes keeper stats (plug reputation data, solvency).
 * Runs alongside the keeper loop when KEEPER_STATS_PORT is set (default 3099).
 *
 * GET /stats/plugs          → PlugStats[]
 * GET /stats/plugs/:address → PlugStats
 * GET /health               → { ok: true }
 *
 * The server reads from an in-memory store that the keeper updates on every tick.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isAddress } from 'viem';
import type { PlugStats } from '@plug360/shared';

export type StatsStore = {
  plugStats: Map<string, PlugStats>;
  /** Latest known IPFS profile CID per plug (lowercase address → CID). */
  plugCids: Map<string, string>;
};

export function createStatsServer(store: StatsStore, port = 3099): { close: () => void } {
  function send(res: ServerResponse, status: number, body: unknown) {
    let json: string;
    try {
      json = JSON.stringify(body);
    } catch {
      json = '{"error":"serialisation error"}';
      status = 500;
    }
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(json);
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const path = url.pathname;

      if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });

      if (path === '/health') return send(res, 200, { ok: true });

      if (path === '/stats/plugs') {
        const all = Array.from(store.plugStats.values()).map((s) => ({
          ...s,
          profileCid: store.plugCids.get(s.address.toLowerCase()) ?? null,
        }));
        return send(res, 200, all);
      }

      const match = path.match(/^\/stats\/plugs\/(0x[0-9a-fA-F]{40})$/i);
      if (match) {
        const address = match[1]!;
        if (!isAddress(address)) return send(res, 400, { error: 'invalid address' });
        const key = address.toLowerCase();
        const stats = store.plugStats.get(key);
        if (!stats) return send(res, 404, { error: 'not found' });
        return send(res, 200, {
          ...stats,
          profileCid: store.plugCids.get(key) ?? null,
        });
      }

      return send(res, 404, { error: 'not found' });
    } catch (err) {
      process.stderr.write(`[stats-server] unhandled error: ${String(err)}\n`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    process.stderr.write(`[stats-server] error: ${err.message} (code=${err.code ?? '?'})\n`);
  });

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`[stats-server] listening on port ${port}\n`);
  });

  return { close: () => server.close() };
}
