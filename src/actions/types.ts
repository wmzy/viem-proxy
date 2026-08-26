import type { Client, Chain, Transport } from "viem";

export type ProxyRetryOptions = {
  /** Total number of attempts including the initial request */
  attempts: number;
  /** Base delay in ms between attempts, doubled after each retry */
  delay: number;
};

export type ProxyActionConfig = {
  /** Proxy server endpoint */
  endpoint: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Enable fallback to direct RPC on proxy failure */
  fallback?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** API key for authentication */
  apiKey?: string;
  /** Retry policy for transient failures (network errors, timeouts, 5xx, 429) */
  retryOptions?: ProxyRetryOptions;
  /**
   * Params size (JSON chars) at or above which requests use the large-
   * parameter hash-reference flow (`/api/v1/cached/{chain}:{method}:{hash}`)
   * instead of a compressed query string. Must match the server's
   * COMPRESSION_THRESHOLD for cache-key parity; default 1500.
   */
  compressionThreshold?: number;
};

export type ProxyResponse<T> = {
  result: T;
  blockNumber?: string;
  timestamp: number;
};

export type ProxyErrorResponse = {
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type ActionClient = Client<Transport, Chain | undefined>;
