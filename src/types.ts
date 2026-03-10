import type { Chain, Transport, PublicClient } from "viem";

export type ProxyConfig = {
  /** Enable proxy */
  enabled: boolean;
  /** Workers endpoint */
  endpoint: string;
  /** Workers endpoints list (for load balancing) */
  endpoints?: string[];
  /** Request timeout (ms) */
  timeout?: number;
  /** Enable fallback to original RPC */
  fallback?: boolean;
  /** Debug mode */
  debug?: boolean;
  /** API key for authentication */
  apiKey?: string;
  /** Custom cache strategy */
  cacheControl?: {
    [method: string]: number;
  };
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

export type RequestStrategy = "compressed" | "hash-reference" | "direct";

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

export type RpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: unknown[];
};

export type RpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: ProxyError | null;
};

export type ProxyPublicClient<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined
> = PublicClient<TTransport, TChain> & {
  proxy: ProxyConfig;
  getCacheStats: () => Promise<{
    hitRate: number;
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
  }>;
  clearCache: () => Promise<void>;
  preheatCache: (requests: RpcRequest[]) => Promise<RpcResponse[]>;
  getMetrics: () => Promise<PerformanceMetrics>;
  clearMetrics: () => Promise<boolean>;
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

export type MetricsData = {
  timestamp: number;
  method: string;
  chainId: number;
  strategy: RequestStrategy;
  cacheHit: boolean;
  responseTime: number;
  error?: string;
};

export type PerformanceMetrics = {
  totalRequests: number;
  cacheHitRate: number;
  averageResponseTime: number;
  errorRate: number;
  strategyCounts: Record<RequestStrategy, number>;
  methodStats: Record<
    string,
    {
      count: number;
      cacheHitRate: number;
      averageResponseTime: number;
    }
  >;
};
