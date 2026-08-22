import type { ProxyState } from "./durable-objects/proxy-state";
import type { RateLimiter } from "./durable-objects/rate-limiter";
import type { Statistics } from "./durable-objects/statistics";

export type Env = {
  PROXY_STATE: DurableObjectNamespace<ProxyState>;
  STATISTICS: DurableObjectNamespace<Statistics>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  ENVIRONMENT: string;
  MAX_CACHE_TTL: string;
  DEFAULT_CACHE_TTL: string;
  COMPRESSION_THRESHOLD: string;
  FINALIZED_BLOCK_CACHE_TTL: string;
  API_KEY?: string;
  RPC_URLS?: string;
  /**
   * Optional comma-separated allowlist of servable chain IDs (e.g. "1,137").
   * Unset = every chain with a configured upstream RPC URL is allowed.
   */
  ALLOWED_CHAIN_IDS?: string;
  /** Per-chain upstream RPC concurrency cap (default 10) */
  MAX_RPC_CONCURRENCY?: string;
  /**
   * Per-IP rate limit in requests/minute (default 60; "0" disables).
   * Enforced by the rate-limit middleware; reported by /api/v1/health.
   */
  RATE_LIMIT_PER_MINUTE?: string;
  /**
   * Optional comma-separated allowlist of browser origins, with
   * `*.example.com` wildcards, e.g. "app.example.com,*.dapp.dev".
   * Entries are hosts: `scheme://` prefixes are stripped, ports are
   * honored. Unset = permissive (no Origin check; pair with API_KEY and
   * rate limiting). When set, requests carrying an Origin header must
   * match the allowlist or are rejected with 403; requests without Origin
   * (server-side callers) pass. `/dashboard` is exempt.
   */
  ALLOWED_ORIGINS?: string;
};

/**
 * Worker-level cache serving decision, exposed via the `X-Cache` response
 * header. "HIT" means the Worker answered from its own cache (DO
 * deduplication store); "MISS" means an upstream RPC call was executed.
 * CDN hits never invoke the Worker, so they are invisible here by design.
 */
export type CacheStatus = "HIT" | "MISS";

export type RpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: any[];
};

export type RpcResponse<T = any> = {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
};

export type ProxyResponse<T = any> = {
  result: T;
  blockNumber?: string;
  timestamp: number;
};

export type CacheStrategy = {
  ttl: number;
  key: string;
  shouldCache: boolean;
};

export type RequestInfo = {
  chainId: number;
  method: string;
  params: any[];
  strategy: "compressed" | "direct" | "function";
};

// Function-based request types
export type FunctionRequest = {
  functionName: string;
  args: Record<string, unknown>;
};

export type GetBalanceArgs = {
  address: string;
  blockTag?: string;
  blockNumber?: bigint;
};

export type ReadContractArgs = {
  address: string;
  abi: unknown[];
  functionName: string;
  args?: unknown[];
  blockTag?: string;
  blockNumber?: bigint;
};

export type GetBlockArgs = {
  blockHash?: string;
  blockNumber?: bigint;
  blockTag?: string;
  includeTransactions?: boolean;
};

export type CallArgs = {
  to: string;
  data?: string;
  from?: string;
  gas?: bigint;
  gasPrice?: bigint;
  value?: bigint;
  blockTag?: string;
  blockNumber?: bigint;
};
