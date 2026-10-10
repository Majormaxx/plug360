#!/usr/bin/env node
import { main } from './main.js';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());

main(process.argv.slice(2), { env: process.env, stderr: (t) => console.error(t), signal: controller.signal }).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
