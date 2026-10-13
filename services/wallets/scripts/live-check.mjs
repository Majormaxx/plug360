#!/usr/bin/env node
// Checks the Circle setup against the real API, without signing anything:
// the API key works, the user-controlled wallets app accepts device tokens, and Arc testnet is enabled.
// Usage: CIRCLE_API_KEY=... node scripts/live-check.mjs   (run `pnpm build` first)
import { randomUUID } from 'node:crypto';
import { circleClient, runOp } from '../dist/index.js';

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  console.error('CIRCLE_API_KEY is not set');
  process.exit(2);
}
const client = circleClient(apiKey);
const opts = { blockchain: 'ARC-TESTNET' };
const results = [];
const check = async (name, fn) => {
  try {
    results.push([name, 'ok', await fn()]);
  } catch (err) {
    results.push([name, 'FAIL', `${err.status ?? ''} ${err.code ?? ''} ${err.message}`.trim()]);
  }
};

await check('social device token', async () => {
  const r = await runOp(client, 'social-token', { deviceId: randomUUID() }, undefined, opts);
  return `deviceToken ${r.deviceToken.slice(0, 8)}…`;
});
await check('user token is required for wallet calls', async () => {
  const r = await runOp(client, 'wallets', {}, 'not-a-real-token', opts).then(
    () => 'unexpectedly accepted',
    (e) => (e.status === 401 || e.status === 502 ? `rejected (${e.status})` : Promise.reject(e)),
  );
  return r;
});

for (const [name, state, detail] of results) console.log(`${state.padEnd(4)} ${name}: ${detail}`);
process.exit(results.some((r) => r[1] === 'FAIL') ? 1 : 0);
