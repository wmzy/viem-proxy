import type { Chain, Transport, PublicClient } from "viem";
import type {
  BatchRequest,
  BatchRequests,
  BatchResults,
} from "./actions/batch.client";
import type { PreheatRequest, PreheatResult } from "./actions/preheat.client";

export type ProxyConfig = {
  /** Enable proxy */
  enabled: boolean;
  /** Workers endpoint */
  endpoint: string;
  /** Request timeout (ms) */
  timeout?: number;
  /** Enable fallback to original RPC */
  fallback?: boolean;
  /** Debug mode */
  debug?: boolean;
  /** API key for authentication */
  apiKey?: string;
  /** Retry options */
  retryOptions?: {
    attempts: number;
    delay: number;
  };
  /** Compression threshold */
  compressionThreshold?: number;
};

export type ProxyTransportConfig = {
  /** Original transport */
  transport: Transport;
  /** Proxy config */
  proxy?: Partial<ProxyConfig>;
};

export type RequestStrategy = "compressed" | "direct";

export type CompressedRequest = {
  strategy: RequestStrategy;
  url: string;
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
};

export type CacheInfo = {
  hit: boolean;
  strategy: RequestStrategy;
  key?: string;
  ttl?: number;
};

export type ProxyResponse<T = unknown> = {
  result: T;
  blockNumber?: string;
  timestamp?: number;
  cache?: CacheInfo;
};

export type ProxyError = {
  code: number;
  message: string;
  data?: unknown;
};

/**
 * A proxy request as observed by middleware, aligned with
 * `makeProxyRequest`: the action name, the target chain id and the action
 * arguments. Middleware may inspect and replace these fields; the modified
 * request is what gets sent to the proxy.
 */
export type RpcRequest = {
  functionName: string;
  chainId: number;
  args: Record<string, unknown>;
};

/**
 * A proxy response as observed by middleware: either a `result` or an
 * `error`. Middleware may inspect or replace it on the way out.
 */
export type RpcResponse<T = unknown> = {
  result?: T;
  error?: ProxyError | null;
};

export type ProxyPublicClient<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined
> = PublicClient<TTransport, TChain> & {
  proxy: ProxyConfig;
  /**
   * Execute multiple actions in one batch request against the proxy
   * (POST /api/v1/batch). Items are isolated per-entry; without a proxy
   * config items run through the native actions. Named `batchProxy`
   * because viem clients already carry a `batch` multicall config
   * property, and viem's `extend` strips extension keys that collide
   * with core client properties — `batchProxy` is therefore the one
   * name that survives every usage pattern, extend mode included.
   */
  batchProxy: <const T extends readonly BatchRequest[]>(
    requests: T & BatchRequests<T>
  ) => Promise<BatchResults<T>>;
  /**
   * Snapshot of locally collected performance metrics: request counts,
   * cache hit rate, error rate, response-time percentiles (P50/P95/P99)
   * and fallback observability (fallbackCount / fallbackRate /
   * fallbackReasons — a fallback means the proxy delivered no value for
   * that request), with a per-method breakdown.
   */
  getCacheStats: () => PerformanceMetrics;
  /**
   * Reset the locally collected metrics. This only clears client-side
   * statistics — it does not purge the CDN cache, which requires
   * server-side support and will be provided in a later version.
   */
  resetStats: () => void;
  /**
   * Preheat the CDN cache for the given requests. Each item fires through
   * the regular compressed GET path in a bounded pool (5 concurrent), so
   * the edge cache fills exactly like real traffic. Failures are counted,
   * never thrown.
   */
  preheatCache: (requests: PreheatRequest[]) => Promise<PreheatResult>;
  /**
   * Register a proxy middleware applied to every proxied request, onion
   * style: the first registered middleware runs outermost. A middleware
   * that throws aborts the request, which then follows the usual
   * fallback/error path.
   */
  use: (middleware: ProxyMiddleware) => void;
};

export type ProxyMiddleware = (
  request: RpcRequest,
  next: (request: RpcRequest) => Promise<RpcResponse>
) => Promise<RpcResponse>;

export type CompressionResult = {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
};

export type HashStorage = {
  get: (hash: string) => Promise<string | null>;
  set: (hash: string, data: string, ttl?: number) => Promise<void>;
  delete: (hash: string) => Promise<void>;
};

/**
 * Cache status of a proxied response, read from the `X-Cache` response
 * header: "HIT" → "hit", "MISS" → "miss", absent → "unknown" (the
 * server-side header is delivered by a later workers task).
 */
export type CacheStatus = "hit" | "miss" | "unknown";

/** Raw per-request metric record captured by the client instrumentation */
export type MetricsData = {
  timestamp: number;
  method: string;
  chainId: number;
  strategy: RequestStrategy;
  cacheStatus: CacheStatus;
  /** Convenience alias: true only when `cacheStatus` is "hit" */
  cacheHit: boolean;
  success: boolean;
  responseTime: number;
  error?: string;
};

/**
 * Per-method aggregate metrics. Response-time statistics (average,
 * P50/P95/P99) are computed over the most recent sampled durations,
 * not necessarily over the full request history.
 */
export type MethodMetrics = {
  count: number;
  errorCount: number;
  errorRate: number;
  /** Requests of this method that fell back to the original RPC */
  fallbackCount: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  averageResponseTime: number;
  responseTimeP50: number;
  responseTimeP95: number;
  responseTimeP99: number;
};

export type PerformanceMetrics = {
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  /**
   * Proxy requests that failed and fell back to the original RPC. A
   * fallback means the proxy delivered no value for that request (the
   * answer came from the RPC provider directly), so this — not the
   * error rate — is the key metric for whether the proxy is actually
   * being used: a sustained high fallback count means traffic is
   * silently bypassing the proxy.
   */
  fallbackCount: number;
  /** `fallbackCount / totalRequests`; 0 when no requests were recorded */
  fallbackRate: number;
  /**
   * Fallback counts by failure reason: `"network"` (fetch rejected,
   * proxy unreachable), `"timeout"` (request timed out), `"5xx"`,
   * `"429"` (rate limited), `"abort"`, `"other"` (proxy-level or
   * middleware errors). Only reasons that actually occurred appear.
   */
  fallbackReasons: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  averageResponseTime: number;
  responseTimeP50: number;
  responseTimeP95: number;
  responseTimeP99: number;
  /** Distinct chain ids observed across recorded requests */
  chainIds: number[];
  strategyCounts: Record<RequestStrategy, number>;
  methodStats: Record<string, MethodMetrics>;
};
