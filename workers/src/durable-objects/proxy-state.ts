import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

type RequestStatus = "pending" | "completed" | "failed";

type PendingRequest = {
  request_hash: string;
  status: RequestStatus;
  result: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
};

/** How long a completed/failed result stays valid for dedup hits */
const RESULT_TTL_MS = 30 * 1000;
/** How long a pending record is considered active before it is treated as gone */
const PENDING_TTL_MS = 5 * 60 * 1000;

/**
 * ProxyState Durable Object
 * Handles request deduplication
 */
export class ProxyState extends DurableObject<Env> {
  private initialized = false;

  /**
   * Initialize SQL schema on first access
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Create pending_requests table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_requests (
        request_hash TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    // Create indexes for efficient cleanup
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_requests_created ON pending_requests(created_at)
    `);

    // Schedule cleanup alarm (every hour)
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    }

    this.initialized = true;
  }

  /**
   * Handle alarm for periodic cleanup
   */
  async alarm(): Promise<void> {
    await this.cleanup();
    // Schedule next alarm
    await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  }

  /**
   * Clean up expired data
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();

    // Delete old pending requests (5 minutes)
    const pendingTimeout = now - PENDING_TTL_MS;
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_requests WHERE status = 'pending' AND created_at < ?`,
      pendingTimeout
    );

    // Delete completed requests (30 seconds)
    const completedTimeout = now - RESULT_TTL_MS;
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_requests WHERE status IN ('completed', 'failed') AND completed_at < ?`,
      completedTimeout
    );
  }

  /**
   * Check if a request is pending or completed
   * Returns the pending request info if found
   *
   * Freshness filtering mirrors cleanup() so stale rows are treated as
   * nonexistent on the read path instead of waiting for the hourly alarm:
   * completed/failed results are served for RESULT_TTL_MS and pending
   * entries for PENDING_TTL_MS. This bounds the stale-result and cached-
   * error poisoning window to the designed TTLs.
   */
  async checkPendingRequest(requestHash: string): Promise<PendingRequest | null> {
    await this.ensureInitialized();

    const now = Date.now();
    const result = this.ctx.storage.sql.exec<PendingRequest>(
      `SELECT * FROM pending_requests
       WHERE request_hash = ?
         AND (
           (status = 'pending' AND created_at > ?)
           OR (status IN ('completed', 'failed') AND completed_at > ?)
         )`,
      requestHash,
      now - PENDING_TTL_MS,
      now - RESULT_TTL_MS
    );

    const rows = [...result];
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create a pending request record
   */
  async createPendingRequest(requestHash: string): Promise<boolean> {
    await this.ensureInitialized();

    const now = Date.now();
    // Drop the previous record for this hash if it is stale (expired
    // completed/failed result or abandoned pending entry) so the hash can
    // be reused; fresh records are left untouched. This complements the
    // freshness filter in checkPendingRequest: expired records are treated
    // as nonexistent, which includes allowing the hash to be re-registered.
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_requests
       WHERE request_hash = ?
         AND (
           (status = 'pending' AND created_at <= ?)
           OR (status IN ('completed', 'failed') AND completed_at <= ?)
         )`,
      requestHash,
      now - PENDING_TTL_MS,
      now - RESULT_TTL_MS
    );

    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_requests (request_hash, status, created_at) VALUES (?, 'pending', ?)`,
        requestHash,
        now
      );
      return true;
    } catch {
      // Request already exists
      return false;
    }
  }

  /**
   * Complete a pending request with result
   */
  async completeRequest(requestHash: string, result: string): Promise<void> {
    await this.ensureInitialized();

    this.ctx.storage.sql.exec(
      `UPDATE pending_requests SET status = 'completed', result = ?, completed_at = ? WHERE request_hash = ?`,
      result,
      Date.now(),
      requestHash
    );
  }

  /**
   * Fail a pending request with error
   */
  async failRequest(requestHash: string, error: string): Promise<void> {
    await this.ensureInitialized();

    this.ctx.storage.sql.exec(
      `UPDATE pending_requests SET status = 'failed', error = ?, completed_at = ? WHERE request_hash = ?`,
      error,
      Date.now(),
      requestHash
    );
  }

  /**
   * Check request status (non-blocking, caller handles retry)
   */
  async getRequestStatus(requestHash: string): Promise<PendingRequest | null> {
    return this.checkPendingRequest(requestHash);
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Check/create pending request: POST /requests
      if (request.method === "POST" && path === "/requests") {
        const { requestHash } = await request.json<{ requestHash: string }>();
        
        // Check if request already exists
        const existing = await this.checkPendingRequest(requestHash);
        if (existing) {
          return new Response(JSON.stringify({ exists: true, request: existing }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Create new pending request
        await this.createPendingRequest(requestHash);
        return new Response(JSON.stringify({ exists: false, created: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Complete request: PUT /requests/:hash/complete
      if (request.method === "PUT" && path.includes("/complete")) {
        const requestHash = path.split("/")[2];
        const { result } = await request.json<{ result: string }>();
        await this.completeRequest(requestHash, result);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Fail request: PUT /requests/:hash/fail
      if (request.method === "PUT" && path.includes("/fail")) {
        const requestHash = path.split("/")[2];
        const { error } = await request.json<{ error: string }>();
        await this.failRequest(requestHash, error);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Check request status: GET /requests/:hash/status
      if (request.method === "GET" && path.includes("/status")) {
        const requestHash = path.split("/")[2];
        const result = await this.getRequestStatus(requestHash);
        if (result) {
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
}
