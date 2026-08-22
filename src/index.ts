// Re-export all viem exports
export * from "viem";

// Export proxy-related types and functions, overriding viem's same-name exports
export type {
  ProxyConfig,
  ProxyTransportConfig,
  ProxyPublicClient,
  ProxyMiddleware,
  RequestStrategy,
  CompressedRequest,
  CacheInfo,
  CacheStatus,
  ProxyResponse,
  ProxyError,
  CompressionResult,
  HashStorage,
  MetricsData,
  MethodMetrics,
  PerformanceMetrics,
  RpcRequest,
  RpcResponse,
} from "./types";

// Export metrics collection utilities
export {
  createMetricsCollector,
  getSharedCollector,
  resetMetrics,
  DEFAULT_MAX_SAMPLES,
} from "./utils/metrics";
export type { MetricsCollector, MetricsEntry } from "./utils/metrics";

export { createPublicClient } from "./client";

// Export proxy utilities
export { withProxy, getProxyConfig } from "./proxy";

// Export proxyActions for extend pattern
export { proxyActions } from "./actions/proxyActions";
export type { ProxyActionsReturnType } from "./actions/proxyActions";
export type { ProxyActionConfig } from "./actions/types";
export { batchActions } from "./actions/batch.client";
export type {
  BatchActionName,
  BatchRequest,
  BatchResult,
  BatchResults,
  BatchItemError,
  BatchActionParameters,
  BatchActionReturnType,
} from "./actions/batch.client";
export { preheatCache, PREHEAT_CONCURRENCY } from "./actions/preheat.client";
export type { PreheatRequest, PreheatResult } from "./actions/preheat.client";
export { addMiddleware, clearMiddlewares, getMiddlewares } from "./actions/middleware";

// Global proxy configuration (module-level defaults, see README)
export {
  configureProxy,
  getProxyDefaults,
  resetProxyDefaults,
} from "./actions/config";

// Export compression utilities
export { compressParams } from "./utils/compression";
