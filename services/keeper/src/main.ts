import { ConfigError, loadConfig } from './config.js';
import { createKeeper, type KeeperDeps } from './keeper.js';

export const USAGE = `Usage: plug360-keeper run [--once]

  run          tick every POLL_INTERVAL_SECONDS until SIGINT or SIGTERM
  run --once   run a single tick and exit (exit code 1 if the tick failed)

Configuration comes from environment variables; see .env.example.`;

export type MainIo = {
  env: Record<string, string | undefined>;
  stderr: (text: string) => void;
  /** Aborting stops loop mode after the current tick. */
  signal?: AbortSignal;
  deps?: KeeperDeps;
};

/** CLI entry point without process side effects. Returns the exit code. */
export async function main(argv: string[], io: MainIo): Promise<number> {
  const [command, ...flags] = argv;
  if (command !== 'run' || flags.some((f) => f !== '--once')) {
    io.stderr(USAGE);
    return command === undefined || command === '--help' || command === '-h' ? 0 : 2;
  }

  let config;
  try {
    config = loadConfig(io.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      io.stderr(err.message);
      return 2;
    }
    throw err;
  }

  const keeper = createKeeper(config, io.deps);
  if (flags.includes('--once')) {
    const report = await keeper.tick();
    return report.ok ? 0 : 1;
  }
  await keeper.loop(io.signal ?? new AbortController().signal);
  return 0;
}
