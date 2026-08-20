import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import {
  aggregatePeriods,
  bucketCutoff,
  DEFAULT_STATS_HOURS,
  hourBucket,
  HOUR_MS,
  MAX_STATS_HOURS,
  mergeRecord,
  STATS_RETENTION_MS,
  type StatsRecord,
  type StatsRow,
  type StatsSummary,
} from "../utils/statistics";

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Validate an incoming record payload; null when malformed.
 */
const parseRecord = (data: unknown): StatsRecord | null => {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  if (typeof d.method !== "string" || d.method.length === 0) return null;
  if (typeof d.chainId !== "number" || !Number.isInteger(d.chainId)) return null;
  if (d.cacheStatus !== "HIT" && d.cacheStatus !== "MISS") return null;
  if (typeof d.error !== "boolean") return null;
  if (typeof d.durationMs !== "number" || !Number.isFinite(d.durationMs))
    return null;
  if (
    d.timestamp !== undefined &&
    (typeof d.timestamp !== "number" || !Number.isFinite(d.timestamp))
  )
    return null;

  return {
    method: d.method,
    chainId: d.chainId,
    cacheStatus: d.cacheStatus,
    error: d.error,
    durationMs: d.durationMs,
    ...(d.timestamp !== undefined ? { timestamp: d.timestamp } : {}),
  };
};

/**
 * Statistics Durable Object
 *
 * Aggregates per-method/per-chain request counters and upstream latency
 * samples into hourly SQLite buckets. A single global instance is used
 * (see STATISTICS_DO_NAME) so cross-chain queries stay within one object.
 */
export class Statistics extends DurableObject<Env> {
  private initialized = false;

  /**
   * Initialize SQL schema on first access and schedule the retention alarm.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS statistics (
        method TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        cache_status TEXT NOT NULL,
        period_bucket TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        total_ms REAL NOT NULL DEFAULT 0,
        samples TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (method, chain_id, cache_status, period_bucket)
      )
    `);

    this.ctx.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_statistics_bucket ON statistics(period_bucket)`
    );

    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * HOUR_MS);
    }

    this.initialized = true;
  }

  /**
   * Handle alarm for retention cleanup (once a day).
   */
  async alarm(): Promise<void> {
    await this.ensureInitialized();

    this.ctx.storage.sql.exec(
      `DELETE FROM statistics WHERE period_bucket < ?`,
      hourBucket(Date.now() - STATS_RETENTION_MS)
    );

    await this.ctx.storage.setAlarm(Date.now() + 24 * HOUR_MS);
  }

  private selectByKey(
    method: string,
    chainId: number,
    cacheStatus: string,
    bucket: string
  ): StatsRow | undefined {
    const result = this.ctx.storage.sql.exec<StatsRow>(
      `SELECT * FROM statistics WHERE method = ? AND chain_id = ? AND cache_status = ? AND period_bucket = ?`,
      method,
      chainId,
      cacheStatus,
      bucket
    );
    const rows = [...result];
    return rows.length > 0 ? rows[0] : undefined;
  }

  /**
   * Merge one request record into its hourly bucket (read-modify-write,
   * safe inside the single-threaded DO with synchronous SQL).
   */
  async record(entry: StatsRecord): Promise<void> {
    await this.ensureInitialized();

    const bucket = hourBucket(entry.timestamp ?? Date.now());
    const existing = this.selectByKey(
      entry.method,
      entry.chainId,
      entry.cacheStatus,
      bucket
    );
    const row = mergeRecord(existing, entry, bucket);

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO statistics (method, chain_id, cache_status, period_bucket, count, error_count, total_ms, samples) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.method,
      row.chain_id,
      row.cache_status,
      row.period_bucket,
      row.count,
      row.error_count,
      row.total_ms,
      row.samples
    );
  }

  /**
   * Aggregate rows over the requested window into period stats.
   */
  async getStats(
    options: { chainId?: number; method?: string; hours?: number } = {}
  ): Promise<StatsSummary> {
    await this.ensureInitialized();

    const hours = Math.min(
      Math.max(options.hours ?? DEFAULT_STATS_HOURS, 1),
      MAX_STATS_HOURS
    );
    const cutoff = bucketCutoff(Date.now(), hours);

    let sql = `SELECT * FROM statistics WHERE period_bucket >= ?`;
    const params: unknown[] = [cutoff];
    if (options.method !== undefined) {
      sql += ` AND method = ?`;
      params.push(options.method);
    }
    if (options.chainId !== undefined) {
      sql += ` AND chain_id = ?`;
      params.push(options.chainId);
    }

    const rows = [...this.ctx.storage.sql.exec<StatsRow>(sql, ...params)];
    return aggregatePeriods(rows);
  }

  /**
   * Handle HTTP requests to the Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);

    try {
      // Record one request observation: POST /record
      if (request.method === "POST" && url.pathname === "/record") {
        const parsed = parseRecord(await request.json().catch(() => null));
        if (!parsed) {
          return jsonResponse({ error: "Invalid record payload" }, 400);
        }
        await this.record(parsed);
        return jsonResponse({ success: true });
      }

      // Aggregated statistics: GET /stats?chainId=&method=&hours=
      if (request.method === "GET" && url.pathname === "/stats") {
        const hoursRaw = url.searchParams.get("hours");
        let hours = DEFAULT_STATS_HOURS;
        if (hoursRaw !== null) {
          const parsed = Number(hoursRaw);
          if (Number.isInteger(parsed) && parsed >= 1) {
            hours = Math.min(parsed, MAX_STATS_HOURS);
          }
        }

        const chainIdRaw = url.searchParams.get("chainId");
        let chainId: number | undefined;
        if (chainIdRaw !== null && chainIdRaw !== "") {
          const parsed = Number(chainIdRaw);
          if (Number.isInteger(parsed) && parsed >= 0) chainId = parsed;
        }

        const methodRaw = url.searchParams.get("method");

        return jsonResponse(
          await this.getStats({
            chainId,
            method:
              methodRaw !== null && methodRaw.length > 0 ? methodRaw : undefined,
            hours,
          })
        );
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
}
