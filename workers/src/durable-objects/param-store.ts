import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

/**
 * How long a stored hash→params mapping stays readable. The CDN cache TTLs
 * for cached-URL entries are bounded by the per-method cache strategy (max:
 * MAX_CACHE_TTL, 1 year for immutable history), but a re-request of an
 * evicted cache entry only needs the mapping again while some caller still
 * holds the URL — 30 days covers realistic reuse windows without pinning
 * storage forever.
 */
const PARAM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Cleanup runs hourly via alarm; expired rows are also skipped on read. */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

type StoredParamsRow = {
  hash: string;
  params: string;
};

/**
 * ParamStore Durable Object
 *
 * Backing store for the large-parameter hash-reference flow
 * (`POST /api/v1/store` + `GET /api/v1/cached/{chainId}:{method}:{hash}`):
 * maps a SHA-256 hex hash of the raw params JSON to the params themselves,
 * so repeat requests can carry a fixed-length, CDN-cacheable path instead
 * of an oversized query string.
 *
 * A single global instance serves every chain: the mapping is keyed by the
 * content hash alone and never contains chain-specific data.
 */
export class ParamStore extends DurableObject<Env> {
  private initialized = false;

  /**
   * Initialize SQL schema on first access and schedule periodic cleanup.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS stored_params (
         hash TEXT PRIMARY KEY,
         params TEXT NOT NULL,
         size INTEGER NOT NULL,
         created_at INTEGER NOT NULL
       )`
    );
    this.initialized = true;

    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    }
  }

  /**
   * Hourly alarm: purge expired mappings, then reschedule.
   */
  async alarm(): Promise<void> {
    await this.ensureInitialized();
    this.ctx.storage.sql.exec(
      `DELETE FROM stored_params WHERE created_at <= ?`,
      Date.now() - PARAM_TTL_MS
    );
    await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
  }

  /**
   * Store (or refresh) a hash→params mapping. Idempotent: re-storing a
   * known hash only bumps its freshness so the TTL window restarts.
   */
  async putParams(hash: string, params: string): Promise<void> {
    await this.ensureInitialized();
    this.ctx.storage.sql.exec(
      `INSERT INTO stored_params (hash, params, size, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET created_at = excluded.created_at`,
      hash,
      params,
      params.length,
      Date.now()
    );
  }

  /**
   * Fetch the params for a hash, or null when absent/expired. Expired rows
   * are treated as nonexistent on the read path (the hourly alarm deletes
   * them eventually).
   */
  async getParams(hash: string): Promise<string | null> {
    await this.ensureInitialized();
    const result = this.ctx.storage.sql.exec<StoredParamsRow>(
      `SELECT hash, params FROM stored_params WHERE hash = ? AND created_at > ?`,
      hash,
      Date.now() - PARAM_TTL_MS
    );
    return result.toArray()[0]?.params ?? null;
  }

  /**
   * Delete one mapping by hash (cache purge). Returns whether a row was
   * actually present.
   */
  async deleteParams(hash: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = this.ctx.storage.sql.exec(
      `DELETE FROM stored_params WHERE hash = ?`,
      hash
    );
    return result.rowsWritten > 0;
  }

  /**
   * Handle HTTP requests from the worker:
   * - PUT /params            body {hash, params}
   * - GET /params/:hash
   * - DELETE /params/:hash
   */
  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "PUT" && path === "/params") {
      const { hash, params } = await request.json<{
        hash: string;
        params: string;
      }>();
      await this.putParams(hash, params);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && path.startsWith("/params/")) {
      const hash = path.slice("/params/".length);
      const params = await this.getParams(hash);
      return new Response(JSON.stringify({ found: params !== null, params }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "DELETE" && path.startsWith("/params/")) {
      const hash = path.slice("/params/".length);
      const deleted = await this.deleteParams(hash);
      return new Response(JSON.stringify({ deleted }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }
}
