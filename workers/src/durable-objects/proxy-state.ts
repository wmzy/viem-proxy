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

type StoredParam = {
  hash: string;
  data: string;
  created_at: number;
  expires_at: number;
};

/**
 * ProxyState Durable Object
 * Handles parameter storage and request deduplication
 */
export class ProxyState extends DurableObject<Env> {
  private initialized = false;

  /**
   * Initialize SQL schema on first access
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Create params table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS params (
        hash TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

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
      CREATE INDEX IF NOT EXISTS idx_params_expires ON params(expires_at)
    `);
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

    // Delete expired params (7 days)
    this.ctx.storage.sql.exec(
      `DELETE FROM params WHERE expires_at < ?`,
      now
    );

    // Delete old pending requests (5 minutes)
    const pendingTimeout = now - 5 * 60 * 1000;
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_requests WHERE status = 'pending' AND created_at < ?`,
      pendingTimeout
    );

    // Delete completed requests (30 seconds)
    const completedTimeout = now - 30 * 1000;
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_requests WHERE status IN ('completed', 'failed') AND completed_at < ?`,
      completedTimeout
    );
  }

  /**
   * Store parameter hash mapping
   */
  async storeParams(hash: string, data: string): Promise<void> {
    await this.ensureInitialized();

    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO params (hash, data, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      hash,
      data,
      now,
      expiresAt
    );
  }

  /**
   * Get stored parameters by hash
   */
  async getParams(hash: string): Promise<string | null> {
    await this.ensureInitialized();

    const result = this.ctx.storage.sql.exec<StoredParam>(
      `SELECT data FROM params WHERE hash = ? AND expires_at > ?`,
      hash,
      Date.now()
    );

    const rows = [...result];
    return rows.length > 0 ? rows[0].data : null;
  }

  /**
   * Check if a request is pending or completed
   * Returns the pending request info if found
   */
  async checkPendingRequest(requestHash: string): Promise<PendingRequest | null> {
    await this.ensureInitialized();

    const result = this.ctx.storage.sql.exec<PendingRequest>(
      `SELECT * FROM pending_requests WHERE request_hash = ?`,
      requestHash
    );

    const rows = [...result];
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create a pending request record
   */
  async createPendingRequest(requestHash: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_requests (request_hash, status, created_at) VALUES (?, 'pending', ?)`,
        requestHash,
        Date.now()
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
   * Wait for a pending request to complete
   */
  async waitForRequest(requestHash: string, timeoutMs = 30000): Promise<PendingRequest | null> {
    const startTime = Date.now();
    const pollInterval = 50; // 50ms

    while (Date.now() - startTime < timeoutMs) {
      const request = await this.checkPendingRequest(requestHash);
      if (request && request.status !== "pending") {
        return request;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return null;
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Store params: POST /params
      if (request.method === "POST" && path === "/params") {
        const { hash, data } = await request.json<{ hash: string; data: string }>();
        await this.storeParams(hash, data);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get params: GET /params/:hash
      if (request.method === "GET" && path.startsWith("/params/")) {
        const hash = path.slice("/params/".length);
        const data = await this.getParams(hash);
        if (data) {
          return new Response(JSON.stringify({ data }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

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

      // Wait for request: GET /requests/:hash/wait
      if (request.method === "GET" && path.includes("/wait")) {
        const requestHash = path.split("/")[2];
        const timeout = parseInt(url.searchParams.get("timeout") || "30000");
        const result = await this.waitForRequest(requestHash, timeout);
        if (result) {
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Timeout" }), {
          status: 408,
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
