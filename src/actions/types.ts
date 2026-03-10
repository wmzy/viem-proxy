import type { Client, Chain, Transport } from "viem";

/**
 * Proxy configuration for actions
 */
export type ProxyActionConfig = {
  /** Proxy server endpoint */
  endpoint: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Enable fallback to direct RPC on proxy failure */
  fallback?: boolean;
  /** Enable debug logging */
  debug?: boolean;
};

/**
 * Proxy response from server
 */
export type ProxyResponse<T> = {
  result: T;
  blockNumber?: string;
  timestamp: number;
};

/**
 * Proxy error response
 */
export type ProxyErrorResponse = {
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

/**
 * Action handler context for server-side
 */
export type ActionContext = {
  chainId: number;
  args: Record<string, unknown>;
  env: {
    PROXY_STATE: unknown;
  };
};

/**
 * Action handler result
 */
export type ActionResult<T = unknown> = {
  result: T;
  blockNumber?: string;
};

/**
 * Server action handler type
 */
export type ServerActionHandler<TArgs = unknown, TResult = unknown> = (
  ctx: ActionContext & { args: TArgs }
) => Promise<ActionResult<TResult>>;

/**
 * Client type for actions
 */
export type ActionClient = Client<Transport, Chain | undefined>;
