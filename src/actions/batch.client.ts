import type { Chain, Client, Transport } from "viem";
import { getProxyConfig } from "../proxy";
import { getMetricsCollector, readCacheStatus } from "../utils/metrics";
import type { CacheStatus } from "../types";
import type { ProxyActionConfig } from "./types";
import {
  DEFAULT_RETRY_OPTIONS,
  generateTraceId,
  isRetryableStatus,
  makeProxyRequest,
  RetryableError,
  withRetry,
} from "./utils";
import { getBalance } from "./getBalance.client";
import { getBlock } from "./getBlock.client";
import { getBlockNumber } from "./getBlockNumber.client";
import { getTransaction } from "./getTransaction.client";
import { getTransactionReceipt } from "./getTransactionReceipt.client";
import { readContract } from "./readContract.client";
import { call } from "./call.client";
import { estimateGas } from "./estimateGas.client";
import { getGasPrice } from "./getGasPrice.client";
import { getLogs } from "./getLogs.client";
import { getCode } from "./getCode.client";
import { getChainId } from "./getChainId.client";
import { getTransactionCount } from "./getTransactionCount.client";
import { getStorageAt } from "./getStorageAt.client";
import { getFeeHistory } from "./getFeeHistory.client";
import { getBlobBaseFee } from "./getBlobBaseFee.client";

/** Action names accepted in a batch request */
export type BatchActionName =
  | "getBalance"
  | "getBlock"
  | "getBlockNumber"
  | "getTransaction"
  | "getTransactionReceipt"
  | "readContract"
  | "call"
  | "estimateGas"
  | "getGasPrice"
  | "getLogs"
  | "getCode"
  | "getChainId"
  | "getTransactionCount"
  | "getStorageAt"
  | "getFeeHistory"
  | "getBlobBaseFee";

/** One item of a batch request */
export type BatchRequest = {
  /** Caller-supplied correlation id, echoed back in the matching result */
  id: string | number;
  action: BatchActionName;
  args?: Record<string, unknown>;
  /** Overrides the chain the item targets (defaults to the batch chain) */
  chainId?: number;
};

/** Error entry of a failed batch item */
export type BatchItemError = {
  code: number;
  message: string;
};

/** One entry of a batch response; `result` or `error` is present */
export type BatchResult = {
  id: string | number;
  result?: unknown;
  blockNumber?: string;
  error?: BatchItemError;
};

type BatchEndpointEntry = {
  id: string | number;
  result?: unknown;
  blockNumber?: string;
  error?: BatchItemError;
};

type BatchEndpointResponse =
  | { results: BatchEndpointEntry[] }
  | { error: { message: string } };

const toBatchResult = (entry: BatchEndpointEntry): BatchResult => ({
  id: entry.id,
  ...(entry.result !== undefined ? { result: entry.result } : {}),
  ...(entry.blockNumber !== undefined ? { blockNumber: entry.blockNumber } : {}),
  ...(entry.error !== undefined ? { error: entry.error } : {}),
});

/**
 * Send all items to the batch endpoint in a single POST.
 *
 * Transient failures (network errors, timeouts, 5xx, 429) are retried with
 * the same backoff policy as single requests; any final failure rejects so
 * the caller can degrade to serial requests.
 */
const sendBatchRequest = async (
  actions: BatchRequest[],
  config: ProxyActionConfig,
  defaultChainId: number
): Promise<{ results: BatchResult[]; cacheStatus: CacheStatus }> => {
  const { endpoint, timeout = 30000, apiKey, debug = false } = config;
  const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...config.retryOptions };
  const traceId = generateTraceId();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trace-Id": traceId,
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const body = JSON.stringify({
    requests: actions.map((action) => ({
      id: action.id,
      chainId: action.chainId ?? defaultChainId,
      action: action.action,
      args: action.args ?? {},
    })),
  });

  // Cache status of the most recent attempt, read from the `X-Cache`
  // response header; "unknown" until a response with the header arrives.
  let lastCacheStatus: CacheStatus = "unknown";

  const sendOnce = async (): Promise<BatchResult[]> => {
    let response: Response;
    try {
      response = await fetch(`${endpoint}/api/v1/batch`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      // Network or timeout failure: retry with the same trace id
      throw new RetryableError(
        error instanceof Error ? error.message : String(error),
        { cause: error }
      );
    }

    lastCacheStatus = readCacheStatus(response);

    if (isRetryableStatus(response.status)) {
      throw new RetryableError(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as BatchEndpointResponse;

    if ("error" in data) {
      throw new Error(`Proxy error: ${data.error.message}`);
    }
    if (!Array.isArray(data.results)) {
      throw new Error("Malformed batch response");
    }
    return data.results.map(toBatchResult);
  };

  const results = await withRetry(
    sendOnce,
    retryOptions,
    debug
      ? (error, attempt, backoff) => {
          console.warn(
            `[viem-proxy][trace:${traceId}] batch retry ${attempt} in ${backoff}ms:`,
            error.message
          );
        }
      : undefined
  );

  return { results, cacheStatus: lastCacheStatus };
};

/**
 * Execute batch items serially through `makeProxyRequest`, preserving
 * per-item isolation: a failing item yields an `error` entry and the loop
 * continues.
 */
const runSerialBatch = async (
  actions: BatchRequest[],
  config: ProxyActionConfig,
  defaultChainId: number
): Promise<BatchResult[]> => {
  const results: BatchResult[] = [];
  for (const action of actions) {
    const chainId = action.chainId ?? defaultChainId;
    try {
      const result = await makeProxyRequest<unknown>(
        action.action,
        chainId,
        action.args ?? {},
        config
      );
      results.push({ id: action.id, result });
    } catch (error) {
      results.push({
        id: action.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return results;
};

/**
 * Record one metrics entry per item of a completed batch round trip. All
 * items shared the same request, so they share its observed latency and
 * cache status; per-item failures are recorded as errors.
 */
const recordBatchMetrics = (
  actions: BatchRequest[],
  defaultChainId: number,
  results: BatchResult[],
  cacheStatus: CacheStatus,
  responseTime: number
): void => {
  const collector = getMetricsCollector();
  const byId = new Map(results.map((result) => [result.id, result]));
  for (const action of actions) {
    const outcome = byId.get(action.id);
    collector.record({
      method: action.action,
      chainId: action.chainId ?? defaultChainId,
      strategy: "direct",
      success: outcome?.error === undefined,
      responseTime,
      cacheStatus,
      ...(outcome?.error !== undefined ? { error: outcome.error.message } : {}),
    });
  }
};

/**
 * Execute multiple proxy actions in one batch request.
 *
 * Sends `{ requests }` to `POST /api/v1/batch`; when the batch endpoint is
 * unavailable or fails (after transient retries), degrades to serial
 * `makeProxyRequest` calls with identical semantics (same retry policy,
 * metrics and per-item isolation). Batch requests are POSTs and therefore
 * never served from the CDN cache — caching stays the single-request GET
 * path's responsibility.
 *
 * @example
 * import { batchActions } from 'viem-proxy/actions'
 * const results = await batchActions(
 *   [
 *     { id: 1, action: 'getBalance', args: { address: '0x...' } },
 *     { id: 2, action: 'getBlockNumber' },
 *   ],
 *   { endpoint: 'https://proxy.example.com' }
 * )
 */
export const batchActions = async (
  actions: BatchRequest[],
  config: ProxyActionConfig,
  defaultChainId = 1
): Promise<BatchResult[]> => {
  if (actions.length === 0) return [];

  const startedAt = Date.now();
  try {
    const { results, cacheStatus } = await sendBatchRequest(
      actions,
      config,
      defaultChainId
    );
    recordBatchMetrics(
      actions,
      defaultChainId,
      results,
      cacheStatus,
      Date.now() - startedAt
    );
    return results;
  } catch (error) {
    if (config.debug) {
      console.warn(
        "[viem-proxy] Batch endpoint failed, falling back to serial requests:",
        error
      );
    }
    return runSerialBatch(actions, config, defaultChainId);
  }
};

/**
 * Run batch items natively through the per-action client functions (each
 * falls back to viem's own actions), used when the client carries no proxy
 * config — mirroring how single actions behave without a proxy.
 */
const nativeActionRunners: Record<
  BatchActionName,
  (
    client: Client<Transport, Chain | undefined>,
    args: Record<string, unknown> | undefined
  ) => Promise<unknown>
> = {
  getBalance: (client, args) => getBalance(client, args as never),
  getBlock: (client, args) => getBlock(client, args as never),
  getBlockNumber: (client) => getBlockNumber(client),
  getTransaction: (client, args) => getTransaction(client, args as never),
  getTransactionReceipt: (client, args) =>
    getTransactionReceipt(client, args as never),
  readContract: (client, args) => readContract(client, args as never),
  call: (client, args) => call(client, args as never),
  estimateGas: (client, args) => estimateGas(client, args as never),
  getGasPrice: (client) => getGasPrice(client),
  getLogs: (client, args) => getLogs(client, args as never),
  getCode: (client, args) => getCode(client, args as never),
  getChainId: (client) => getChainId(client),
  getTransactionCount: (client, args) => getTransactionCount(client, args as never),
  getStorageAt: (client, args) => getStorageAt(client, args as never),
  getFeeHistory: (client, args) => getFeeHistory(client, args as never),
  getBlobBaseFee: (client) => getBlobBaseFee(client),
};

export const runNativeBatch = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  actions: BatchRequest[]
): Promise<BatchResult[]> => {
  const results: BatchResult[] = [];
  for (const action of actions) {
    try {
      const result = await nativeActionRunners[action.action](
        client as Client<Transport, Chain | undefined>,
        action.args
      );
      results.push({ id: action.id, result });
    } catch (error) {
      results.push({
        id: action.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return results;
};

/**
 * Batch entry point bound to a proxied client: resolves the proxy config
 * and chain from the client itself. Without a proxy config, items run
 * natively like any other action.
 */
export const batchClientActions = <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
): ((requests: BatchRequest[]) => Promise<BatchResult[]>) => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;
  if (!proxy?.endpoint) {
    return (requests) => runNativeBatch(client, requests);
  }
  return (requests) => batchActions(requests, proxy, chainId);
};
