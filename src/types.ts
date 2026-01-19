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
  /** Custom cache strategy */
  cacheControl?: {
    [method: string]: number; // Cache time in seconds per method
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

// Extended viem PublicClient type
export type ProxyPublicClient<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined
> = PublicClient<TTransport, TChain> & {
  /** Proxy config */
  proxy?: ProxyConfig;
  /** Get cache stats */
  getCacheStats?: () => Promise<{
    hitRate: number;
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
  }>;
  /** Clear cache */
  clearCache?: () => Promise<void>;
  /** Preheat cache */
  preheatCache?: (requests: RpcRequest[]) => Promise<RpcResponse[]>;
  /** Get metrics */
  getMetrics?: () => Promise<PerformanceMetrics>;
  /** Clear metrics */
  clearMetrics?: () => Promise<boolean>;
};

// Middleware type
export type ProxyMiddleware = (
  request: RpcRequest,
  next: (request: RpcRequest) => Promise<RpcResponse>
) => Promise<RpcResponse>;

// Compression result type
export type CompressionResult = {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
};

// Hash storage type
export type HashStorage = {
  get: (hash: string) => Promise<string | null>;
  set: (hash: string, data: string, ttl?: number) => Promise<void>;
  delete: (hash: string) => Promise<void>;
};

// Metrics data type
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
