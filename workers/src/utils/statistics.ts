import type { Context } from "hono";
import type { CacheStatus, Env } from "../types";

/** Number of most recent upstream latency samples kept per bucket. */
export const SAMPLE_LIMIT = 200;

export const HOUR_MS = 3_600_000;

/** Default aggregation window (hours) for GET /api/v1/stats. */
export const DEFAULT_STATS_HOURS = 24;

/** Maximum aggregation window (hours) for GET /api/v1/stats (30 days). */
export const MAX_STATS_HOURS = 720;

/** Statistics rows older than this are purged by the DO retention alarm. */
export const STATS_RETENTION_MS = 30 * 24 * HOUR_MS;

/**
 * A single global DO instance keeps cross-chain aggregation within one
 * object (ProxyState is sharded per chain, which would force a fan-out).
 */
export const STATISTICS_DO_NAME = "global";

/**
 * One request observation emitted by a request handler.
 * `durationMs` is the upstream RPC duration and is only meaningful for
 * cacheStatus "MISS" (HIT means no upstream call happened).
 */
export type StatsRecord = {
  method: string;
  chainId: number;
  cacheStatus: CacheStatus;
  error: boolean;
  durationMs: number;
  /** Defaults to Date.now() when omitted. */
  timestamp?: number;
};

/** Persisted per-bucket row; snake_case mirrors the SQLite columns. */
export type StatsRow = {
  method: string;
  chain_id: number;
  cache_status: CacheStatus;
  period_bucket: string;
  count: number;
  error_count: number;
  total_ms: number;
  /** JSON array of the most recent upstream durations (max SAMPLE_LIMIT). */
  samples: string;
};

export type PeriodStats = {
  bucket: string;
  count: number;
  errorCount: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

export type StatsSummary = {
  totalRequests: number;
  cacheHits: number;
  cacheHitRate: number;
  averageResponseTime: number;
  errorCount: number;
  errorRate: number;
  periods: PeriodStats[];
};

/** Floor a timestamp to its UTC hour bucket (lexicographically sortable). */
export const hourBucket = (timestamp: number): string =>
  new Date(Math.floor(timestamp / HOUR_MS) * HOUR_MS).toISOString();

/** Bucket cutoff for a window of `hours` ending at `now`. */
export const bucketCutoff = (now: number, hours: number): string =>
  hourBucket(now - Math.max(1, hours) * HOUR_MS);

/** Nearest-rank percentile over raw samples; null when there are none. */
export const percentile = (samples: number[], p: number): number | null => {
  if (samples.length === 0 || p <= 0 || p > 100) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
};

const parseSamples = (samples: string): number[] => {
  try {
    const parsed: unknown = JSON.parse(samples);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is number => typeof v === "number")
      : [];
  } catch {
    return [];
  }
};

/** Append a duration, keeping only the most recent `limit` samples. */
export const appendSample = (
  samples: number[],
  durationMs: number,
  limit = SAMPLE_LIMIT
): number[] => {
  const next = [...samples, durationMs];
  return next.length > limit ? next.slice(next.length - limit) : next;
};

/**
 * Merge one record into its bucket row (creating the row when absent).
 * Only upstream calls (MISS) contribute duration and latency samples;
 * dedup hits (HIT) only bump the request counter.
 */
export const mergeRecord = (
  row: StatsRow | undefined,
  record: StatsRecord,
  bucket: string
): StatsRow => {
  const base: StatsRow = row ?? {
    method: record.method,
    chain_id: record.chainId,
    cache_status: record.cacheStatus,
    period_bucket: bucket,
    count: 0,
    error_count: 0,
    total_ms: 0,
    samples: "[]",
  };

  const durationMs = Math.max(0, record.durationMs);
  const fromUpstream = record.cacheStatus === "MISS";
  const samples = fromUpstream
    ? appendSample(parseSamples(base.samples), durationMs)
    : parseSamples(base.samples);

  return {
    ...base,
    count: base.count + 1,
    error_count: base.error_count + (record.error ? 1 : 0),
    total_ms: base.total_ms + (fromUpstream ? durationMs : 0),
    samples: JSON.stringify(samples),
  };
};

/**
 * Aggregate bucket rows into per-hour period stats (sorted ascending by
 * bucket) plus a summary. Percentiles come from the merged upstream
 * latency samples; `averageResponseTime` averages upstream calls only.
 */
export const aggregatePeriods = (rows: StatsRow[]): StatsSummary => {
  const buckets = new Map<
    string,
    { count: number; errorCount: number; samples: number[] }
  >();

  let totalRequests = 0;
  let cacheHits = 0;
  let errorCount = 0;
  let upstreamCount = 0;
  let totalMs = 0;

  for (const row of rows) {
    const entry = buckets.get(row.period_bucket) ?? {
      count: 0,
      errorCount: 0,
      samples: [],
    };

    entry.count += row.count;
    entry.errorCount += row.error_count;
    totalRequests += row.count;
    errorCount += row.error_count;

    if (row.cache_status === "MISS") {
      entry.samples = entry.samples.concat(parseSamples(row.samples));
      upstreamCount += row.count;
      totalMs += row.total_ms;
    } else {
      cacheHits += row.count;
    }

    buckets.set(row.period_bucket, entry);
  }

  const periods: PeriodStats[] = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, entry]) => ({
      bucket,
      count: entry.count,
      errorCount: entry.errorCount,
      p50: percentile(entry.samples, 50),
      p95: percentile(entry.samples, 95),
      p99: percentile(entry.samples, 99),
    }));

  return {
    totalRequests,
    cacheHits,
    cacheHitRate: totalRequests > 0 ? cacheHits / totalRequests : 0,
    averageResponseTime: upstreamCount > 0 ? totalMs / upstreamCount : 0,
    errorCount,
    errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
    periods,
  };
};

/**
 * Fire-and-forget statistics write. Never throws and never blocks the
 * main request: failures (including a missing binding or a broken DO)
 * are swallowed. Uses `waitUntil` when an execution context is available
 * so the write survives the response in production.
 */
export const recordRequestStats = (
  c: Context<{ Bindings: Env }>,
  record: StatsRecord
): void => {
  if (!c.env.STATISTICS) return;

  try {
    const id = c.env.STATISTICS.idFromName(STATISTICS_DO_NAME);
    const write = c.env.STATISTICS.get(id)
      .fetch(
        new Request("http://statistics/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record),
        })
      )
      .then(
        () => undefined,
        () => undefined
      );

    try {
      c.executionCtx.waitUntil(write);
    } catch {
      // No execution context available (e.g. tests): let the promise float.
    }
  } catch {
    // Statistics must never affect the proxied request.
  }
};
