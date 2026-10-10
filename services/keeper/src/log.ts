export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One structured log line. `job` names the step; `outcome` says what happened. */
export type LogEntry = {
  level: LogLevel;
  job: string;
  msg?: string;
  dealId?: bigint | string;
  tx?: string;
  outcome?: string;
  [key: string]: unknown;
};

export type Logger = (entry: LogEntry) => void;

/** JSON with bigints written as decimal strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Writes one JSON object per line, with an ISO timestamp first. */
export function jsonLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  return (entry) => write(toJson({ ts: new Date().toISOString(), ...entry }));
}

/** Collects entries in memory. Used by tests and by callers that ship logs elsewhere. */
export function memoryLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger = ((entry: LogEntry) => {
    entries.push(entry);
  }) as Logger & { entries: LogEntry[] };
  logger.entries = entries;
  return logger;
}
