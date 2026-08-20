import type { RpcRequest, RpcResponse } from "./types";

const DEFAULT_RPC_URLS: Record<number, string[]> = {
  1: [
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum.publicnode.com",
  ],
  137: [
    "https://polygon.llamarpc.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon-rpc.com",
  ],
  42161: [
    "https://arb1.arbitrum.io/rpc",
    "https://rpc.ankr.com/arbitrum",
    "https://arbitrum.publicnode.com",
  ],
  10: [
    "https://mainnet.optimism.io",
    "https://rpc.ankr.com/optimism",
    "https://optimism.publicnode.com",
  ],
  56: [
    "https://bsc-dataseed.binance.org",
    "https://rpc.ankr.com/bsc",
    "https://bsc.publicnode.com",
  ],
};

let customRpcUrls: Record<number, string[]> = {};

export const setCustomRpcUrls = (urls: Record<number, string[]>): void => {
  customRpcUrls = urls;
};

export const getRpcUrls = (chainId: number): string[] => {
  const urls = customRpcUrls[chainId] ?? DEFAULT_RPC_URLS[chainId];
  if (!urls || urls.length === 0) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return urls;
};

/**
 * Default cap on concurrent upstream RPC calls per chain. Configurable at
 * runtime through the `MAX_RPC_CONCURRENCY` environment variable.
 */
export const DEFAULT_MAX_RPC_CONCURRENCY = 10;

/** Max time a call may wait in the per-chain FIFO queue before failing. */
export const RPC_QUEUE_TIMEOUT_MS = 10_000;

type QueueWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ChainLimiter = {
  /** Calls currently holding a slot */
  active: number;
  /** FIFO of calls waiting for a slot */
  queue: QueueWaiter[];
};

let maxRpcConcurrency = DEFAULT_MAX_RPC_CONCURRENCY;
const chainLimiters = new Map<number, ChainLimiter>();

/**
 * Set the per-chain upstream concurrency limit. Throws on invalid values so
 * misconfiguration is visible (callers parsing env vars validate first).
 */
export const setMaxRpcConcurrency = (limit: number): void => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid RPC concurrency limit: ${limit}`);
  }
  maxRpcConcurrency = limit;
};

export const getMaxRpcConcurrency = (): number => maxRpcConcurrency;

/** Reset limiter state to defaults (used by middleware re-config and tests). */
export const resetRpcConcurrency = (): void => {
  maxRpcConcurrency = DEFAULT_MAX_RPC_CONCURRENCY;
  for (const limiter of chainLimiters.values()) {
    for (const waiter of limiter.queue) {
      clearTimeout(waiter.timer);
    }
  }
  chainLimiters.clear();
};

/**
 * Acquire an upstream call slot for the chain, queueing FIFO when the chain
 * is at its concurrency cap. Rejects with a queue-timeout error after
 * `RPC_QUEUE_TIMEOUT_MS` spent waiting.
 */
const acquireRpcSlot = (chainId: number): Promise<void> => {
  let limiter = chainLimiters.get(chainId);
  if (!limiter) {
    limiter = { active: 0, queue: [] };
    chainLimiters.set(chainId, limiter);
  }

  if (limiter.active < maxRpcConcurrency) {
    limiter.active++;
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        // Give up: leave the queue without ever holding a slot.
        const index = limiter.queue.indexOf(waiter);
        if (index !== -1) limiter.queue.splice(index, 1);
        reject(
          new Error(
            `RPC concurrency limit reached for chain ${chainId} (queue timeout after ${RPC_QUEUE_TIMEOUT_MS}ms)`
          )
        );
      }, RPC_QUEUE_TIMEOUT_MS),
    };
    limiter.queue.push(waiter);
  });
};

/** Release a slot, handing it directly to the head of the queue (FIFO). */
const releaseRpcSlot = (chainId: number): void => {
  const limiter = chainLimiters.get(chainId);
  if (!limiter) return;

  const next = limiter.queue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
    return;
  }

  limiter.active = Math.max(0, limiter.active - 1);
  if (limiter.active === 0) {
    chainLimiters.delete(chainId);
  }
};

let rpcIdCounter = 0;

const executeWithFailover = async (
  chainId: number,
  method: string,
  params: unknown[]
): Promise<{ result: unknown; blockNumber?: string }> => {
  const rpcUrls = getRpcUrls(chainId);

  for (let i = 0; i < rpcUrls.length; i++) {
    const rpcUrl = rpcUrls[i];

    try {
      const rpcRequest: RpcRequest = {
        jsonrpc: "2.0",
        id: ++rpcIdCounter,
        method,
        params,
      };

      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "viem-proxy/1.0",
        },
        body: JSON.stringify(rpcRequest),
      });

      if (!response.ok) {
        throw new Error(
          `RPC request failed: ${response.status} ${response.statusText}`
        );
      }

      const rpcResponse: RpcResponse = await response.json();

      if (rpcResponse.error) {
        throw new Error(`RPC error: ${rpcResponse.error.message}`);
      }

      let blockNumber: string | undefined;

      if (method === "eth_blockNumber") {
        blockNumber = rpcResponse.result as string;
      } else if (
        method.includes("Block") &&
        typeof rpcResponse.result === "object" &&
        rpcResponse.result !== null &&
        "number" in rpcResponse.result
      ) {
        blockNumber = (rpcResponse.result as { number: string }).number;
      }

      return {
        result: rpcResponse.result,
        blockNumber,
      };
    } catch (error) {
      console.error(`[RPC] Failed to call ${rpcUrl}:`, error);
      if (i === rpcUrls.length - 1) {
        throw new Error(`All RPC endpoints failed for chain ${chainId}`);
      }
    }
  }

  throw new Error(`No working RPC endpoint for chain ${chainId}`);
};

/**
 * Execute one upstream RPC call for the chain under the per-chain
 * concurrency limiter. A slot is held for the whole endpoint-failover
 * sequence, so one logical call counts as one concurrent upstream call.
 * Calls waiting beyond `RPC_QUEUE_TIMEOUT_MS` fail with a queue-timeout
 * error before any upstream request is made.
 */
export const executeRpcCall = async (
  chainId: number,
  method: string,
  params: unknown[]
): Promise<{ result: unknown; blockNumber?: string }> => {
  await acquireRpcSlot(chainId);
  try {
    return await executeWithFailover(chainId, method, params);
  } finally {
    releaseRpcSlot(chainId);
  }
};
