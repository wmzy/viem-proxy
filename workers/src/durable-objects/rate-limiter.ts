import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import type { RateLimitVerdict } from "../utils/rate-limit";

const MINUTE_MS = 60_000;

/**
 * Minute buckets older than this are purged on write. Only the current
 * minute is ever read; a small slack avoids deleting a bucket that a
 * request started in right before a rollover.
 */
const RETAINED_MINUTES = 2;

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * RateLimiter Durable Object
 *
 * Fixed-window per-minute counter. One instance per client id
 * (`RATE_LIMITER.idFromName(clientId)`), so each client's budget lives in
 * a single single-threaded object — the count is globally accurate across
 * isolates and PoPs (an isolate-local counter would undercount), and one
 * flooding client cannot hot-spot the object that tracks another client.
 *
 * A fixed window (vs. sliding) deliberately trades up-to-2x burst at a
 * minute boundary for O(1) storage and a single read-modify-write.
 */
export class RateLimiter extends DurableObject<Env> {
  private initialized = false;

  /**
   * Initialize SQL schema on first access.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        minute INTEGER PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.initialized = true;
  }

  /**
   * Charge one request to the current UTC minute bucket and report whether
   * it still fits the limit. Read-modify-write is safe inside the
   * single-threaded DO with synchronous SQL.
   */
  async consume(limit: number): Promise<RateLimitVerdict> {
    await this.ensureInitialized();

    const now = Date.now();
    const minute = Math.floor(now / MINUTE_MS);

    this.ctx.storage.sql.exec(
      `INSERT INTO rate_limit_counters (minute, count) VALUES (?, 1)
       ON CONFLICT(minute) DO UPDATE SET count = count + 1`,
      minute
    );

    // Purge stale buckets: each instance only tracks one client, so the
    // table holds at most a handful of rows and this stays O(tiny).
    this.ctx.storage.sql.exec(
      `DELETE FROM rate_limit_counters WHERE minute < ?`,
      minute - RETAINED_MINUTES
    );

    const rows = [
      ...this.ctx.storage.sql.exec<{ count: number }>(
        `SELECT count FROM rate_limit_counters WHERE minute = ?`,
        minute
      ),
    ];
    const count = rows.length > 0 ? rows[0].count : 1;

    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((MINUTE_MS - (now % MINUTE_MS)) / 1000)
      ),
    };
  }

  /**
   * Handle HTTP requests to the Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);

    try {
      // Charge one request: GET /consume?limit=N
      if (url.pathname === "/consume") {
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw === null ? Number.NaN : Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 0) {
          return jsonResponse({ error: "Invalid limit" }, 400);
        }
        return jsonResponse(await this.consume(limit));
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
