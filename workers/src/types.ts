import type { ProxyState } from "./durable-objects/proxy-state";

export type Env = {
  PROXY_STATE: DurableObjectNamespace<ProxyState>;
  ENVIRONMENT: string;
  MAX_CACHE_TTL: string;
  DEFAULT_CACHE_TTL: string;
  COMPRESSION_THRESHOLD: string;
  FINALIZED_BLOCK_CACHE_TTL: string;
  API_KEY?: string;
  RPC_URLS?: string;
};

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
  strategy: "compressed" | "hash-reference" | "direct" | "function";
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
