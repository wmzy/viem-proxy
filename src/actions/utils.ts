import type {
  ProxyActionConfig,
  ProxyResponse,
  ProxyErrorResponse,
  ProxyRetryOptions,
} from "./types";
import type { CacheStatus, RequestStrategy, RpcRequest, RpcResponse } from "../types";
import { compressParams } from "../utils/compression";
import { getMetricsCollector, readCacheStatus } from "../utils/metrics";
import { applyMiddlewareChain } from "./middleware";

/** Requests slower than this (ms) get a debug warning carrying the trace id */
export const SLOW_REQUEST_MS = 1000;

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
};

/**
 * Marker for transient failures worth retrying (network errors, timeouts,
 * 5xx and 429 responses). Any other error aborts the retry loop.
 * Exported so batch requests can reuse the same retry classification.
 */
export class RetryableError extends Error {}

/** HTTP statuses that are safe to retry: 429 and all 5xx */
export const isRetryableStatus = (status: number | undefined): boolean =>
  status === 429 || (status !== undefined && status >= 500);

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
  const collector = getMetricsCollector();

  // Core sender: performs the actual HTTP round trip for `request`. It is
  // a function of the request so the middleware chain can modify the
  // action, chain and args before anything is built; URL construction,
  // compression and the GET/POST decision all derive from the
  // possibly-modified values.
  const send = async (request: RpcRequest): Promise<T> => {
    const argsJson = JSON.stringify(request.args);
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
        // Network or timeout failure: retry with the same trace id
        throw new RetryableError(
          error instanceof Error ? error.message : String(error),
          { cause: error }
        );
      }

      lastCacheStatus = readCacheStatus(response);

      if (isRetryableStatus(response.status)) {
        throw new RetryableError(`HTTP ${response.status}`);
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
