import type { Address } from 'viem';
import { toJson, type Logger } from './log.js';

export type Severity = 'info' | 'warning' | 'critical';

export type Alert = {
  severity: Severity;
  kind:
    | 'insolvent'
    | 'solvency-restored'
    | 'owner-action'
    | 'payout-deferred'
    | 'dispute-deadline-near'
    | 'low-gas'
    | 'low-sponsor'
    | 'gas-restored'
    | 'tick-failed';
  message: string;
  dealId?: string;
  data?: Record<string, unknown>;
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/**
 * Logs every alert and, when a webhook is configured, POSTs it as JSON. A failed delivery is logged
 * and never stops the tick.
 */
export class AlertSink {
  readonly sent: Alert[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly meta: { chainId: number; escrow: Address },
    private readonly webhookUrl?: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async emit(alert: Alert): Promise<void> {
    this.sent.push(alert);
    this.logger({
      level: alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warn' : 'info',
      job: 'alert',
      outcome: alert.kind,
      msg: alert.message,
      ...(alert.dealId ? { dealId: alert.dealId } : {}),
      ...(alert.data ? { data: alert.data } : {}),
    });
    if (!this.webhookUrl) return;
    const body = toJson({
      source: 'plug360-keeper',
      chainId: this.meta.chainId,
      escrow: this.meta.escrow,
      at: new Date().toISOString(),
      ...alert,
    });
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`webhook returned HTTP ${res.status}`);
    } catch (err) {
      this.logger({ level: 'error', job: 'alert', outcome: 'delivery-failed', kind: alert.kind, error: String(err) });
    }
  }
}
