import type { ProxyActionConfig, ProxyErrorResponse } from "./types";
import { resolveProxyConfig } from "./config";
import {
  DEFAULT_RETRY_OPTIONS,
  generateTraceId,
  isRetryableStatus,
  RetryableError,
  withRetry,
} from "./utils";

/** One cache-purge target: must describe the original request exactly */
export type PurgeRequest = {
  /** Chain the cached entries belong to */
  chainId: number;
  /**
   * Action name whose entries should be invalidated (e.g. "getBalance").
   * Must be an action the server knows, otherwise the purge is rejected.
   */
  action: string;
  /**
   * Arguments exactly as the original request sent them — the server
   * rebuilds the cache key from them, so key order matters too.
   */
  args?: Record<string, unknown>;
};

/** Purge report returned by the server (POST /api/v1/purge) */
export type PurgeResult = {
  /** Durable Object dedup entries deleted */
  purged: {
    dedup: number;
    /** Cache API (CDN colo) entries deleted */
    cache: number;
  };
  /** Always "colo": Workers can only purge the cache of the colo serving the request */
  scope: "colo";
  limitations: string[];
};

/**
 * Invalidate cached entries on the proxy server (POST /api/v1/purge).
 *
 * An administrative operation: it requires the server's `API_KEY` (pass it
 * via `config.apiKey`) and consumes the caller's rate-limit budget like any
 * other request. Each item is resolved to the exact dedup hash and the
 * exact compressed GET URL the original request used, so `args` must match
 * the original call — including JSON key order. This is a standalone
 * function by design (no client instance involved).
 *
 * Honest limitation, surfaced verbatim by the server in `scope` and
 * `limitations`: Workers can only delete cache entries in the colo serving
 * the purge request; entries in other PoPs expire by their TTL. Global CDN
 * invalidation would require Cloudflare's zone-level purge API.
 *
 * Retries transient failures (network errors, timeouts, 5xx, 429) with the
 * same policy as proxied actions (`config.retryOptions`); non-retryable
 * errors (e.g. 400/401/501 responses) throw immediately with the server's
 * message.
 *
 * @example
 * import { purgeCache } from 'viem-proxy/actions'
 * const report = await purgeCache(
 *   [
 *     { chainId: 1, action: 'getBalance', args: { address: '0x...' } },
 *     { chainId: 1, action: 'getBlockNumber' },
 *   ],
 *   { endpoint: 'https://proxy.example.com', apiKey: 'secret' }
 * )
 * // report.purged.dedup / report.purged.cache / report.scope === 'colo'
 */
export const purgeCache = async (
  requests: PurgeRequest[],
  config?: Partial<ProxyActionConfig>
): Promise<PurgeResult> => {
  const resolved = resolveProxyConfig(config);
  const { endpoint, timeout = 30000, apiKey, debug = false } = resolved;
  const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...resolved.retryOptions };
  const traceId = generateTraceId();

  // Nothing to purge without targets or an endpoint: report zero deletions
  // without a round trip (mirrors preheatCache's early return).
  if (requests.length === 0 || !endpoint) {
    return { purged: { dedup: 0, cache: 0 }, scope: "colo", limitations: [] };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trace-Id": traceId,
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const sendOnce = async (): Promise<PurgeResult> => {
    let response: Response;
    try {
      response = await fetch(`${endpoint}/api/v1/purge`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      // Network or timeout failure: retry with the same trace id
      throw new RetryableError(
        error instanceof Error ? error.message : String(error),
        { cause: error }
      );
    }

    if (isRetryableStatus(response.status)) {
      throw new RetryableError(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as PurgeResult | ProxyErrorResponse;
    if ("error" in data) {
      throw new Error(`Proxy error: ${data.error.message}`);
    }
    return data;
  };

  return withRetry(
    sendOnce,
    retryOptions,
    debug
      ? (error, attemptNo, backoff) => {
          console.warn(
            `[viem-proxy][trace:${traceId}] purgeCache retry ${attemptNo} in ${backoff}ms:`,
            error.message
          );
        }
      : undefined
  );
};
