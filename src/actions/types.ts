import type { Client, Chain, Transport } from "viem";

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
