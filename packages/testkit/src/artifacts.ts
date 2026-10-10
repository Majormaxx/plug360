import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Abi, Hex } from 'viem';
import { foundryPath } from './anvil.js';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const contractsDir = resolve(repoRoot, 'contracts');

export type Artifact = { abi: Abi; bytecode: Hex };

export function artifactPath(name: string): string {
  return resolve(contractsDir, 'out', `${name}.sol`, `${name}.json`);
}

/** Reads a Foundry artifact from contracts/out, running `forge build` once if it is missing. */
export function loadArtifact(name: string): Artifact {
  const path = artifactPath(name);
  if (!existsSync(path)) {
    execFileSync('forge', ['build'], { cwd: contractsDir, env: { ...process.env, PATH: foundryPath() }, stdio: 'inherit' });
  }
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  if (!json.bytecode?.object || json.bytecode.object === '0x') throw new Error(`${name} artifact has no bytecode`);
  return { abi: json.abi, bytecode: json.bytecode.object };
}
