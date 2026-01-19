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
  ProxyResponse,
  ProxyError,
  CompressionResult,
  HashStorage,
  MetricsData,
  PerformanceMetrics,
  RpcRequest,
  RpcResponse,
} from "./types";

export { createPublicClient } from "./client";

// Export compression utilities
export {
  compressParams,
  decompressParams,
  generateParamHash,
  shouldCompress,
  shouldUseHashReference,
} from "./utils/compression";
