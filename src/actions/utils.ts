import type {
  ProxyActionConfig,
  ProxyResponse,
  ProxyErrorResponse,
  ProxyRetryOptions,
} from "./types";
import type { CacheStatus, RequestStrategy, RpcRequest, RpcResponse } from "../types";
import { compressParams } from "../utils/compression";
import { getSharedCollector, readCacheStatus } from "../utils/metrics";
import { applyMiddlewareChain } from "./middleware";

/** Requests slower than this (ms) get a debug warning carrying the trace id */
export const SLOW_REQUEST_MS = 1000;

/**
 * Default params-size threshold for the hash-reference flow. Keep in sync
 * with the server's COMPRESSION_THRESHOLD default so both sides derive the
 * same cache keys.
 */
export const DEFAULT_COMPRESSION_THRESHOLD = 1500;

/** Error code the worker answers with when a cached-URL hash is unknown. */
export const PARAMS_NOT_FOUND_CODE = -32004;

export const DEFAULT_RETRY_OPTIONS: Required<ProxyRetryOptions> = {
  attempts: 3,
  delay: 500,
};

export const DEFAULT_PROXY_CONFIG: Required<ProxyActionConfig> = {
  endpoint: "",
  timeout: 30000,
  fallback: true,
  debug: false,
  apiKey: "",
  retryOptions: { ...DEFAULT_RETRY_OPTIONS },
  compressionThreshold: DEFAULT_COMPRESSION_THRESHOLD,
};

/** Reason category for a proxy failure that fell back to direct RPC */
export type FallbackReason =
  | "network"
  | "timeout"
  | "5xx"
  | "429"
  | "abort"
  | "other";

/**
 * Marker for transient failures worth retrying (network errors, timeouts,
 * 5xx and 429 responses). Any other error aborts the retry loop.
 * Exported so batch requests can reuse the same retry classification.
 * `reason` tags the failure category at the send path so fallback
 * metrics can classify without guessing from the message.
 */
export class RetryableError extends Error {
  /** Failure category set where the failure is known precisely */
  readonly reason?: FallbackReason;

  constructor(
    message: string,
    options?: { cause?: unknown; reason?: FallbackReason }
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    if (options?.reason !== undefined) this.reason = options.reason;
  }
}

/** HTTP statuses that are safe to retry: 429 and all 5xx */
export const isRetryableStatus = (status: number | undefined): boolean =>
  status === 429 || (status !== undefined && status >= 500);

/** Map a raw fetch() rejection to a fallback reason category */
const fetchFailureReason = (error: unknown): FallbackReason => {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") return "timeout";
  if (name === "AbortError") return "abort";
  return "network";
};

/**
 * Classify why a proxy failure fell back to direct RPC. Prefers the
 * reason tag attached where the failure is known precisely
 * (`RetryableError.reason` from the send path); falls back to message
 * heuristics for errors raised elsewhere (middleware throws, proxy
 * JSON errors, decode failures).
 */
export const classifyFallbackReason = (error: unknown): FallbackReason => {
  if (error instanceof RetryableError && error.reason) return error.reason;
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = /^HTTP (\d{3})$/.exec(message);
  if (httpStatus) {
    const status = Number(httpStatus[1]);
    if (status === 429) return "429";
    if (status >= 500) return "5xx";
  }
  const lower = message.toLowerCase();
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "timeout";
  }
  if (lower.includes("abort")) return "abort";
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("socket")
  ) {
    return "network";
  }
  return "other";
};

/**
 * Record that `method` fell back to the original RPC after the proxy
 * call failed with `error`. Called from every action's fallback path —
 * covering both requests whose retries were exhausted and requests that
 * failed directly — so `getCacheStats()` exposes how often the proxy
 * delivers no value, and why.
 */
export const recordFallback = (method: string, error: unknown): void => {
  getSharedCollector().recordFallback({
    method,
    reason: classifyFallbackReason(error),
  });
};

/** Generate a short random trace id (12 hex chars) for request correlation */
export const generateTraceId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2, 14).padEnd(12, "0");
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run an async operation with exponential backoff.
 * Only `RetryableError` failures trigger a retry; backoff is `delay * 2^attempt`.
 */
export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: Required<ProxyRetryOptions>,
  onRetry?: (error: Error, attempt: number, backoff: number) => void
): Promise<T> => {
  const attempt = async (n: number): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RetryableError) || n >= options.attempts - 1) {
        throw error;
      }
      const backoff = options.delay * 2 ** n;
      onRetry?.(error as Error, n + 1, backoff);
      await sleep(backoff);
      return attempt(n + 1);
    }
  };
  return attempt(0);
};

export const makeProxyRequest = async <T>(
  functionName: string,
  chainId: number,
  args: Record<string, unknown>,
  config: ProxyActionConfig
): Promise<T> => {
  const { endpoint, timeout = 30000, debug = false, apiKey } = config;
  const retryOptions: Required<ProxyRetryOptions> = {
    ...DEFAULT_RETRY_OPTIONS,
    ...config.retryOptions,
  };
  const traceId = generateTraceId();
  const startedAt = Date.now();
  const elapsed = () => `${Date.now() - startedAt}ms`;

  if (debug) {
    console.log(`[viem-proxy][trace:${traceId}] ${functionName} request:`, args);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trace-Id": traceId,
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  // Cache status of the most recent attempt, read from the `X-Cache`
  // response header; "unknown" until a response with the header arrives.
  let lastCacheStatus: CacheStatus = "unknown";
  // Strategy of the most recent send: compressed for GET, direct for POST.
  let strategy: RequestStrategy = "direct";
  const collector = getSharedCollector();

  // SHA-256 of the raw params JSON, hex-encoded — the same digest the
  // worker recomputes in POST /api/v1/store, so both sides agree on the
  // hash→params binding and the /api/v1/cached cache key.
  const sha256Hex = async (input: string): Promise<string> => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input)
    );
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
  };

  const fetchJson = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new RetryableError(
        error instanceof Error ? error.message : String(error),
        { cause: error, reason: fetchFailureReason(error) }
      );
    }
  };

  /**
   * Large-payload path: probe the fixed-length cached URL first (CDN-
   * cacheable), register the params via POST /api/v1/store when the server
   * reports an unknown hash (-32004), then re-probe. Servers without these
   * endpoints answer 400/404/405 with a different code; the resulting
   * plain error falls through to the caller's direct-RPC fallback.
   */
  const sendViaHashReference = async (
    chainId: number,
    functionName: string,
    argsJson: string
  ): Promise<T> => {
    strategy = "cached";
    const paramHash = await sha256Hex(argsJson);
    const cachedUrl =
      `${endpoint}/api/v1/cached/${chainId}:${functionName}:${paramHash}`;
    const cachedInit = (): RequestInit => ({
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeout),
    });

    if (debug) {
      console.log(
        `[viem-proxy][trace:${traceId}] ${functionName} hash-ref lookup: ${paramHash.slice(0, 12)} (${argsJson.length} chars)`
      );
    }

    return withRetry(
      async () => {
        let response = await fetchJson(cachedUrl, cachedInit());

        if (response.status === 404) {
          const errBody = (await response.json().catch(() => undefined)) as
            | ProxyErrorResponse
            | undefined;
          if (errBody?.error?.code === PARAMS_NOT_FOUND_CODE) {
            const stored = await fetchJson(`${endpoint}/api/v1/store`, {
              method: "POST",
              headers,
              body: JSON.stringify({ hash: paramHash, params: argsJson }),
              signal: AbortSignal.timeout(timeout),
            });
            if (!stored.ok && !isRetryableStatus(stored.status)) {
              throw new Error(`Store request failed: HTTP ${stored.status}`);
            }
            response = await fetchJson(cachedUrl, cachedInit());
          } else {
            throw new Error("Cached lookup failed: HTTP 404");
          }
        }

        lastCacheStatus = readCacheStatus(response);

        if (isRetryableStatus(response.status)) {
          throw new RetryableError(`HTTP ${response.status}`, {
            reason: response.status === 429 ? "429" : "5xx",
          });
        }

        const data = (await response.json()) as
          | ProxyResponse<T>
          | ProxyErrorResponse;

        if ("error" in data) {
          throw new Error(`Proxy error: ${data.error.message}`);
        }

        return data.result;
      },
      retryOptions,
      debug
        ? (error, attemptNo, backoff) => {
            console.warn(
              `[viem-proxy][trace:${traceId}] ${functionName} hash-ref retry ${attemptNo} in ${backoff}ms:`,
              error.message
            );
          }
        : undefined
    );
  };

  // Core sender: performs the actual HTTP round trip for `request`. It is
  // a function of the request so the middleware chain can modify the
  // action, chain and args before anything is built; URL construction,
  // compression and the GET/POST decision all derive from the
  // possibly-modified values.
  const send = async (request: RpcRequest): Promise<T> => {
    const argsJson = JSON.stringify(request.args);

    if (
      argsJson.length >=
      (config.compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD)
    ) {
      return sendViaHashReference(request.chainId, request.functionName, argsJson);
    }

    const compressed = compressParams(argsJson);
    const getUrl = `${endpoint}/api/v1/${request.chainId}/${request.functionName}?p=${compressed.compressed}`;

    const useGet = getUrl.length <= 2048;
    strategy = useGet ? "compressed" : "direct";
    const requestOptions = useGet
      ? {
          method: "GET" as const,
          headers,
          signal: AbortSignal.timeout(timeout),
        }
      : {
          method: "POST" as const,
          headers,
          body: argsJson,
          signal: AbortSignal.timeout(timeout),
        };

    const sendOnce = async (): Promise<T> => {
      let response: Response;
      try {
        response = await fetch(
          useGet
            ? getUrl
            : `${endpoint}/api/v1/${request.chainId}/${request.functionName}`,
          requestOptions
        );
      } catch (error) {
        // Network or timeout failure: retry with the same trace id.
        // fetch() only rejects for network-level failures; classify by
        // the underlying error name so fallback metrics can tell
        // timeouts and aborts apart from unreachable hosts.
        throw new RetryableError(
          error instanceof Error ? error.message : String(error),
          { cause: error, reason: fetchFailureReason(error) }
        );
      }

      lastCacheStatus = readCacheStatus(response);

      if (isRetryableStatus(response.status)) {
        throw new RetryableError(`HTTP ${response.status}`, {
          reason: response.status === 429 ? "429" : "5xx",
        });
      }

      const data = (await response.json()) as
        | ProxyResponse<T>
        | ProxyErrorResponse;

      if ("error" in data) {
        throw new Error(`Proxy error: ${data.error.message}`);
      }

      return data.result;
    };

    return withRetry(
      sendOnce,
      retryOptions,
      debug
        ? (error, attemptNo, backoff) => {
            console.warn(
              `[viem-proxy][trace:${traceId}] ${request.functionName} retry ${attemptNo} in ${backoff}ms:`,
              error.message
            );
          }
        : undefined
    );
  };

  // Innermost layer of the middleware onion: run the send and lift its
  // result into the middleware response shape.
  const core = async (request: RpcRequest): Promise<RpcResponse<T>> => ({
    result: await send(request),
  });

  const recordMetrics = (success: boolean, error?: string): void => {
    const responseTime = Date.now() - startedAt;
    collector.record({
      method: functionName,
      chainId,
      strategy,
      success,
      responseTime,
      cacheStatus: lastCacheStatus,
      ...(error !== undefined ? { error } : {}),
    });
    if (debug && responseTime > SLOW_REQUEST_MS) {
      console.warn(
        `[viem-proxy][trace:${traceId}] ${functionName} slow request` +
          `${success ? "" : " (failed)"}: ${responseTime}ms`
      );
    }
  };

  try {
    // Registered middlewares wrap the core onion style (first registered
    // outermost); a middleware throw aborts the request and lands in the
    // catch below like any other proxy failure.
    const response = await applyMiddlewareChain(core)({
      functionName,
      chainId,
      args,
    });

    if (response.error) {
      throw new Error(`Proxy error: ${response.error.message}`);
    }
    if (response.result === undefined) {
      throw new Error("Proxy response carried neither result nor error");
    }
    const result = response.result;

    recordMetrics(true);

    if (debug) {
      console.log(
        `[viem-proxy][trace:${traceId}] ${functionName} result:`,
        result,
        `(${elapsed()})`
      );
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordMetrics(false, message);

    if (debug) {
      console.log(
        `[viem-proxy][trace:${traceId}] ${functionName} error:`,
        error,
        `(${elapsed()})`
      );
    }
    throw error;
  }
};

export const mergeProxyConfig = (
  config?: Partial<ProxyActionConfig>
): ProxyActionConfig => ({
  ...DEFAULT_PROXY_CONFIG,
  ...config,
});

export const isProxyEnabled = (config?: ProxyActionConfig): boolean => {
  return !!config?.endpoint;
};
