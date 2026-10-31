import { describe, expect, it } from 'vitest';
import { updatePlugStatsFromEvents, finalisePlugStats, type DisputeTimestamps, type RawEvent } from '../src/plug-stats.js';
// RawEvent used in type cast below — imported above.

// ── helpers ──────────────────────────────────────────────────────────────────

const PLUG_A = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PLUG_B = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const DEAL_1 = '101';
const DEAL_2 = '102';
const DEAL_3 = '103';

const NOW = 1_800_000_000; // fixed reference epoch
const DAY = 86_400;

function blockTs(ts: number): Map<bigint, number> {
  return new Map([[1n, ts]]);
}

function funded(plug: string, dealId: string, ts: number, price = '5000000'): RawEvent {
  return { eventName: 'DealFunded', blockNumber: 1n, transactionHash: '0x', args: { plug, dealId, price }, timestamp: ts };
}

function disputed(dealId: string, ts: number): RawEvent {
  return { eventName: 'DisputeOpened', blockNumber: 1n, transactionHash: '0x', args: { dealId }, timestamp: ts };
}

function plugRuled(plug: string, dealId: string, ts: number, forBuyer: boolean): RawEvent {
  return { eventName: 'PlugRuled', blockNumber: 1n, transactionHash: '0x', args: { plug, dealId, forBuyer }, timestamp: ts };
}

// ── basic accumulation ────────────────────────────────────────────────────────

describe('updatePlugStatsFromEvents — basic accumulation', () => {
  it('counts funded deals per plug', () => {
    const statsMap = new Map();
    const dt: DisputeTimestamps = new Map();
    updatePlugStatsFromEvents(statsMap, [
      funded(PLUG_A, DEAL_1, NOW),
      funded(PLUG_A, DEAL_2, NOW + 100),
      funded(PLUG_B, DEAL_3, NOW + 200),
    ], new Map(), dt);

    const stats = finalisePlugStats(statsMap, NOW);
    expect(stats.get(PLUG_A.toLowerCase())!.totalDeals).toBe(2);
    expect(stats.get(PLUG_B.toLowerCase())!.totalDeals).toBe(1);
  });

  it('accumulates totalUsdcRefereed correctly', () => {
    const statsMap = new Map();
    updatePlugStatsFromEvents(statsMap, [
      funded(PLUG_A, DEAL_1, NOW, '3000000'),
      funded(PLUG_A, DEAL_2, NOW, '7000000'),
    ], new Map(), new Map());

    const stats = finalisePlugStats(statsMap, NOW);
    expect(stats.get(PLUG_A.toLowerCase())!.totalUsdcRefereed).toBe('10000000');
  });

  it('records firstDealAt as the earliest funded timestamp', () => {
    const statsMap = new Map();
    updatePlugStatsFromEvents(statsMap, [
      funded(PLUG_A, DEAL_1, NOW + 500),
      funded(PLUG_A, DEAL_2, NOW + 100),
      funded(PLUG_A, DEAL_3, NOW + 200),
    ], new Map(), new Map());

    const stats = finalisePlugStats(statsMap, NOW + 600);
    expect(stats.get(PLUG_A.toLowerCase())!.firstDealAt).toBe(NOW + 100);
  });

  it('empty event list produces empty stats', () => {
    const stats = finalisePlugStats(new Map(), NOW);
    expect(stats.size).toBe(0);
  });

  it('address normalisation: mixed-case plug key is lowercased in output', () => {
    const statsMap = new Map();
    const mixedPlug = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
    updatePlugStatsFromEvents(statsMap, [funded(mixedPlug, DEAL_1, NOW)], new Map(), new Map());
    const stats = finalisePlugStats(statsMap, NOW);
    expect(stats.has(mixedPlug.toLowerCase())).toBe(true);
  });
});

// ── recentDeals cutoff ────────────────────────────────────────────────────────

describe('finalisePlugStats — recentDeals 90-day cutoff', () => {
  it('counts a deal exactly at the 90-day boundary as recent', () => {
    const statsMap = new Map();
    const cutoff = NOW - 90 * DAY;
    updatePlugStatsFromEvents(statsMap, [funded(PLUG_A, DEAL_1, cutoff)], new Map(), new Map());
    const stats = finalisePlugStats(statsMap, NOW);
    expect(stats.get(PLUG_A.toLowerCase())!.recentDeals).toBe(1);
  });

  it('does not count a deal one second before the cutoff', () => {
    const statsMap = new Map();
    updatePlugStatsFromEvents(statsMap, [funded(PLUG_A, DEAL_1, NOW - 90 * DAY - 1)], new Map(), new Map());
    const stats = finalisePlugStats(statsMap, NOW);
    expect(stats.get(PLUG_A.toLowerCase())!.recentDeals).toBe(0);
  });

  it('counts only recent deals when a mix exists', () => {
    const statsMap = new Map();
    updatePlugStatsFromEvents(statsMap, [
      funded(PLUG_A, DEAL_1, NOW - 95 * DAY),   // old
      funded(PLUG_A, DEAL_2, NOW - 45 * DAY),   // recent
      funded(PLUG_A, DEAL_3, NOW - 1 * DAY),    // recent
    ], new Map(), new Map());
    const stats = finalisePlugStats(statsMap, NOW);
    const s = stats.get(PLUG_A.toLowerCase())!;
    expect(s.totalDeals).toBe(3);
    expect(s.recentDeals).toBe(2);
  });
});

// ── disputes and rulings ──────────────────────────────────────────────────────

describe('updatePlugStatsFromEvents — disputes and rulings', () => {
  it('counts a ruled-for-buyer dispute correctly', () => {
    const statsMap = new Map();
    const dt: DisputeTimestamps = new Map();
    updatePlugStatsFromEvents(statsMap, [
      funded(PLUG_A, DEAL_1, NOW),
      disputed(DEAL_1, NOW + 100),
      plugRuled(PLUG_A, DEAL_1, NOW + 1000, true),
    ], blockTs(NOW), dt);

    const stats = finalisePlugStats(statsMap, NOW + 2000);
    const s = stats.get(PLUG_A.toLowerCase())!;
    expect(s.totalDisputes).toBe(1);
    expect(s.ruledForBuyer).toBe(1);
    expect(s.ruledForSeller).toBe(0);
    expect(s.timedOut).toBe(0);
  });

  it('counts a ruled-for-seller dispute correctly', () => {
    const statsMap = new Map();
    const dt: DisputeTimestamps = new Map();
    updatePlugStatsFromEvents(statsMap, [
      funded(PLUG_A, DEAL_1, NOW),
      disputed(DEAL_1, NOW + 100),
      plugRuled(PLUG_A, DEAL_1, NOW + 2000, false),
    ], blockTs(NOW), dt);

    const stats = finalisePlugStats(statsMap, NOW + 3000);
    const s = stats.get(PLUG_A.toLowerCase())!;
    expect(s.ruledForBuyer).toBe(0);
    expect(s.ruledForSeller).toBe(1);
    expect(s.timedOut).toBe(0);
  });

  it('timedOut = disputedDealIds.size - rulings.size when plug misses deadline', () => {
    const statsMap = new Map();
    const dt: DisputeTimestamps = new Map();
    const dealToPlug = new Map();
    // Deal 1: disputed but NOT ruled (timeout)
    // Deal 2: disputed and ruled
    // funded events must come first so dealToPlug is populated before DisputeOpened.
    updatePlugStatsFromEvents(statsMap, [
      funded(PLUG_A, DEAL_1, NOW),
      funded(PLUG_A, DEAL_2, NOW),
      disputed(DEAL_1, NOW + 100),
      disputed(DEAL_2, NOW + 100),
      plugRuled(PLUG_A, DEAL_2, NOW + 500, false),
    ], blockTs(NOW), dt, dealToPlug);

    const stats = finalisePlugStats(statsMap, NOW + 2000);
    const s = stats.get(PLUG_A.toLowerCase())!;
    expect(s.totalDisputes).toBe(2);
    expect(s.timedOut).toBe(1);
  });

  it('computes medianRulingHours correctly for odd count', () => {
    // Three rulings where dispute opened 10s after fund, ruled at 1h/3h/5h after dispute open.
    // Each event has a unique block number so the blockTs map resolves the right timestamp.
    const statsMap = new Map();
    const dt: DisputeTimestamps = new Map();
    const dealToPlug = new Map();

    function evWithBlock(ev: RawEvent, block: bigint): RawEvent {
      return { ...ev, blockNumber: block };
    }

    const cases = [
      { dealId: DEAL_1, ruled: NOW + 10 + 3_600 },   // 1h
      { dealId: DEAL_2, ruled: NOW + 10 + 10_800 },  // 3h
      { dealId: DEAL_3, ruled: NOW + 10 + 18_000 },  // 5h
    ];

    let blk = 10n;
    for (const { dealId, ruled } of cases) {
      const bFund = blk++;
      const bOpen = blk++;
      const bRule = blk++;
      const bts = new Map<bigint, number>([
        [bFund, NOW],
        [bOpen, NOW + 10],
        [bRule, ruled],
      ]);
      updatePlugStatsFromEvents(statsMap, [
        evWithBlock(funded(PLUG_A, dealId, NOW), bFund),
        evWithBlock(disputed(dealId, NOW + 10), bOpen),
        evWithBlock(plugRuled(PLUG_A, dealId, ruled, true), bRule),
      ], bts, dt, dealToPlug);
    }

    const stats = finalisePlugStats(statsMap, NOW + 100_000);
    const s = stats.get(PLUG_A.toLowerCase())!;
    expect(s.medianRulingHours).toBeCloseTo(3, 1);
  });

  it('medianRulingHours is null when there are no rulings', () => {
    const statsMap = new Map();
    updatePlugStatsFromEvents(statsMap, [funded(PLUG_A, DEAL_1, NOW)], new Map(), new Map());
    const stats = finalisePlugStats(statsMap, NOW);
    expect(stats.get(PLUG_A.toLowerCase())!.medianRulingHours).toBeNull();
  });
});

// ── DisputeTimestamps first-seen wins ─────────────────────────────────────────

describe('DisputeTimestamps — first-seen wins', () => {
  it('replaying the same DisputeOpened does not change the stored timestamp', () => {
    const statsMap = new Map();
    const dt: DisputeTimestamps = new Map();
    updatePlugStatsFromEvents(statsMap, [disputed(DEAL_1, NOW + 100)], new Map(), dt);
    updatePlugStatsFromEvents(statsMap, [disputed(DEAL_1, NOW + 9999)], new Map(), dt);
    expect(dt.get(DEAL_1)).toBe(NOW + 100);
  });

  it('different dealIds are stored independently', () => {
    const statsMap = new Map();
    const dt: DisputeTimestamps = new Map();
    updatePlugStatsFromEvents(statsMap, [
      disputed(DEAL_1, NOW + 100),
      disputed(DEAL_2, NOW + 200),
    ], new Map(), dt);
    expect(dt.get(DEAL_1)).toBe(NOW + 100);
    expect(dt.get(DEAL_2)).toBe(NOW + 200);
  });

  it('separate caller-owned DisputeTimestamps maps are fully isolated', () => {
    const dt1: DisputeTimestamps = new Map();
    const dt2: DisputeTimestamps = new Map();
    updatePlugStatsFromEvents(new Map(), [disputed(DEAL_1, NOW + 111)], new Map(), dt1);
    updatePlugStatsFromEvents(new Map(), [disputed(DEAL_1, NOW + 999)], new Map(), dt2);
    expect(dt1.get(DEAL_1)).toBe(NOW + 111);
    expect(dt2.get(DEAL_1)).toBe(NOW + 999);
  });
});
