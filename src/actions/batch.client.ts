import type { Chain, Client, Transport } from "viem";
import { getProxyConfig } from "../proxy";
import { getSharedCollector, readCacheStatus } from "../utils/metrics";
import type { CacheStatus } from "../types";
import type { ProxyActionConfig } from "./types";
import { resolveProxyConfig } from "./config";
import {
  DEFAULT_RETRY_OPTIONS,
  generateTraceId,
  isRetryableStatus,
  makeProxyRequest,
  RetryableError,
  withRetry,
} from "./utils";
import { getBalance, decodeGetBalanceResult } from "./getBalance.client";
import { getBlock } from "./getBlock.client";
import { getBlockNumber, decodeGetBlockNumberResult } from "./getBlockNumber.client";
import { getTransaction } from "./getTransaction.client";
import { getTransactionReceipt } from "./getTransactionReceipt.client";
import {
  readContract,
  decodeReadContractResult,
} from "./readContract.client";
import { call } from "./call.client";
import { estimateGas, decodeEstimateGasResult } from "./estimateGas.client";
import { getGasPrice, decodeGetGasPriceResult } from "./getGasPrice.client";
import { getLogs } from "./getLogs.client";
import { getCode } from "./getCode.client";
import { getChainId, decodeGetChainIdResult } from "./getChainId.client";
import {
  getTransactionCount,
  decodeGetTransactionCountResult,
} from "./getTransactionCount.client";
import { getStorageAt } from "./getStorageAt.client";
import {
  getFeeHistory,
  formatFeeHistory,
} from "./getFeeHistory.client";
import type { RpcFeeHistory } from "./getFeeHistory.client";
import { getBlobBaseFee, decodeGetBlobBaseFeeResult } from "./getBlobBaseFee.client";
import type { GetBalanceParameters } from "./getBalance.client";
import type { GetBlockParameters } from "./getBlock.client";
import type { GetTransactionParameters } from "./getTransaction.client";
import type { GetTransactionReceiptParameters } from "./getTransactionReceipt.client";
import type { ReadContractParameters } from "./readContract.client";
import type { CallParameters } from "./call.client";
import type { EstimateGasParameters } from "./estimateGas.client";
import type { GetLogsParameters } from "./getLogs.client";
import type { GetCodeParameters } from "./getCode.client";
import type { GetTransactionCountParameters } from "./getTransactionCount.client";
import type { GetStorageAtParameters } from "./getStorageAt.client";
import type { GetFeeHistoryParameters } from "./getFeeHistory.client";

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

/**
 * Parameter types of each batch action, mirroring the per-action client
 * functions. Parameterless actions map to `undefined` (`args` omitted).
 */
type BatchActionParameterMap = {
  getBalance: GetBalanceParameters;
  getBlock: GetBlockParameters;
  getBlockNumber: undefined;
  getTransaction: GetTransactionParameters;
  getTransactionReceipt: GetTransactionReceiptParameters;
  readContract: ReadContractParameters;
  call: CallParameters;
  estimateGas: EstimateGasParameters;
  getGasPrice: undefined;
  getLogs: GetLogsParameters;
  getCode: GetCodeParameters;
  getChainId: undefined;
  getTransactionCount: GetTransactionCountParameters;
  getStorageAt: GetStorageAtParameters;
  getFeeHistory: GetFeeHistoryParameters;
  getBlobBaseFee: undefined;
};

/**
 * Result types of each batch action, derived from the per-action client
 * functions (each falls back to viem's own actions, so these match the
 * types viem users expect).
 */
type BatchActionReturnMap = {
  getBalance: Awaited<ReturnType<typeof getBalance>>;
  getBlock: Awaited<ReturnType<typeof getBlock>>;
  getBlockNumber: Awaited<ReturnType<typeof getBlockNumber>>;
  getTransaction: Awaited<ReturnType<typeof getTransaction>>;
  getTransactionReceipt: Awaited<ReturnType<typeof getTransactionReceipt>>;
  readContract: Awaited<ReturnType<typeof readContract>>;
  call: Awaited<ReturnType<typeof call>>;
  estimateGas: Awaited<ReturnType<typeof estimateGas>>;
  getGasPrice: Awaited<ReturnType<typeof getGasPrice>>;
  getLogs: Awaited<ReturnType<typeof getLogs>>;
  getCode: Awaited<ReturnType<typeof getCode>>;
  getChainId: Awaited<ReturnType<typeof getChainId>>;
  getTransactionCount: Awaited<ReturnType<typeof getTransactionCount>>;
  getStorageAt: Awaited<ReturnType<typeof getStorageAt>>;
  getFeeHistory: Awaited<ReturnType<typeof getFeeHistory>>;
  getBlobBaseFee: Awaited<ReturnType<typeof getBlobBaseFee>>;
};

/** `args` type of a batch item for a given action */
export type BatchActionParameters<
  TAction extends BatchActionName = BatchActionName
> = BatchActionParameterMap[TAction];

/** Result type a batch item produces for a given action */
export type BatchActionReturnType<
  TAction extends BatchActionName = BatchActionName
> = BatchActionReturnMap[TAction];

/** One item of a batch request */
export type BatchRequest<TAction extends BatchActionName = BatchActionName> = {
  /** Caller-supplied correlation id, echoed back in the matching result */
  id: string | number;
  action: TAction;
  /** Action arguments; omit for actions that take none */
  args?: BatchActionParameters<TAction>;
  /** Overrides the chain the item targets (defaults to the batch chain) */
  chainId?: number;
};

/** Error entry of a failed batch item */
export type BatchItemError = {
  code: number;
  message: string;
};

/**
 * One entry of a batch response; `result` or `error` is present. The
 * `result` type follows the item's action, matching the corresponding
 * single-action client function.
 */
export type BatchResult<TAction extends BatchActionName = BatchActionName> = {
  id: string | number;
  result?: BatchActionReturnType<TAction>;
  blockNumber?: string;
  error?: BatchItemError;
};

/**
 * Result list of a batch call: one entry per request item, in request
 * order, each typed by the corresponding item's action.
 */
export type BatchResults<T extends readonly BatchRequest[]> = {
  [K in keyof T]: BatchResult<T[K]["action"]>;
};

/**
 * Request list of a batch call as seen by the type system: one typed
 * entry per item, in call order. Used as a parameter constraint so each
 * item's `args` are validated against its own action while the naked
 * type parameter drives positional result inference.
 */
export type BatchRequests<T extends readonly BatchRequest[]> = {
  [K in keyof T]: BatchRequest<T[K]["action"]>;
};

/**
 * Untyped batch result entry: the runtime shape before per-action types
 * are applied. Proxy-path success entries are normalized through their
 * action's decoder (`normalizeBatchResults`) before reaching the public
 * API; internally they are accumulated unchecked and typed only there.
 */
type RawBatchResult = {
  id: string | number;
  result?: unknown;
  blockNumber?: string;
  error?: BatchItemError;
};

type BatchEndpointResponse =
  | { results: RawBatchResult[] }
  | { error: { message: string } };

const toBatchResult = (entry: RawBatchResult): RawBatchResult => ({
  id: entry.id,
  ...(entry.result !== undefined ? { result: entry.result } : {}),
  ...(entry.blockNumber !== undefined ? { blockNumber: entry.blockNumber } : {}),
  ...(entry.error !== undefined ? { error: entry.error } : {}),
});

/**
 * Per-action result decoders for the proxy path: turn raw JSON-RPC wire
 * values into the viem values the corresponding single-action client
 * function returns (hex quantities to bigint/number, `eth_call` output
 * decoded against the item's ABI, fee history formatted). Actions whose
 * single-action proxy path passes the payload through untouched
 * (getBlock, getTransaction, getLogs, …) have no entry; their items stay
 * as-is. Native-path items are already produced by the per-action client
 * functions and are never re-decoded.
 */
const batchResultDecoders: Partial<
  Record<BatchActionName, (result: unknown, args: unknown) => unknown>
> = {
  getBalance: (result) => decodeGetBalanceResult(result as string),
  getBlockNumber: (result) => decodeGetBlockNumberResult(result as string),
  estimateGas: (result) => decodeEstimateGasResult(result as string),
  getGasPrice: (result) => decodeGetGasPriceResult(result as string),
  getBlobBaseFee: (result) => decodeGetBlobBaseFeeResult(result as string),
  getChainId: (result) => decodeGetChainIdResult(result as string),
  getTransactionCount: (result) =>
    decodeGetTransactionCountResult(result as string),
  getFeeHistory: (result) => formatFeeHistory(result as RpcFeeHistory),
  readContract: (result, args) => {
    const params = args as ReadContractParameters;
    // Decoding needs the item's ABI; without one (wire-style `data` args)
    // there is nothing to decode against, so pass the value through.
    if (!params?.abi || !params?.functionName) return result;
    return decodeReadContractResult(result as `0x${string}`, params);
  },
};

/**
 * Normalize proxy-path results so each success entry holds the same viem
 * value the corresponding single-action client would return, keeping the
 * runtime shape aligned with `BatchActionReturnType`. Items stay isolated:
 * an entry that already failed, an action without a decoder, and a decode
 * failure (converted to that item's `error` entry) never affect the rest
 * of the batch.
 */
const normalizeBatchResults = (
  actions: readonly BatchRequest[],
  results: RawBatchResult[]
): RawBatchResult[] =>
  results.map((entry, index) => {
    const decode = batchResultDecoders[actions[index]?.action];
    if (entry.error !== undefined || entry.result === undefined || !decode) {
      return entry;
    }
    try {
      return { ...entry, result: decode(entry.result, actions[index].args) };
    } catch (error) {
      return {
        id: entry.id,
        ...(entry.blockNumber !== undefined
          ? { blockNumber: entry.blockNumber }
          : {}),
        error: {
          code: -32603,
          message: `Failed to decode ${actions[index].action} result: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      };
    }
  });

/**
 * Send all items to the batch endpoint in a single POST.
 *
 * Transient failures (network errors, timeouts, 5xx, 429) are retried with
 * the same backoff policy as single requests; any final failure rejects so
 * the caller can degrade to serial requests.
 */
const sendBatchRequest = async (
  actions: readonly BatchRequest[],
  config: ProxyActionConfig,
  defaultChainId: number
): Promise<{ results: RawBatchResult[]; cacheStatus: CacheStatus }> => {
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

  const sendOnce = async (): Promise<RawBatchResult[]> => {
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
  actions: readonly BatchRequest[],
  config: ProxyActionConfig,
  defaultChainId: number
): Promise<RawBatchResult[]> => {
  const results: RawBatchResult[] = [];
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
  actions: readonly BatchRequest[],
  defaultChainId: number,
  results: RawBatchResult[],
  cacheStatus: CacheStatus,
  responseTime: number
): void => {
  const collector = getSharedCollector();
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
 * Batch orchestration with per-action result normalization on the proxy
 * paths: one batch POST when the endpoint is available, serial
 * `makeProxyRequest` fallback otherwise; both carry raw wire values that
 * are decoded to viem values before returning.
 */
const executeBatch = async (
  actions: readonly BatchRequest[],
  config: ProxyActionConfig,
  defaultChainId: number
): Promise<RawBatchResult[]> => {
  if (actions.length === 0) return [];

  const startedAt = Date.now();
  try {
    const { results, cacheStatus } = await sendBatchRequest(
      actions,
      config,
      defaultChainId
    );
    // Normalize before metrics so decode failures are recorded as errors
    const normalized = normalizeBatchResults(actions, results);
    recordBatchMetrics(
      actions,
      defaultChainId,
      normalized,
      cacheStatus,
      Date.now() - startedAt
    );
    return normalized;
  } catch (error) {
    if (config.debug) {
      console.warn(
        "[viem-proxy] Batch endpoint failed, falling back to serial requests:",
        error
      );
    }
    const serial = await runSerialBatch(actions, config, defaultChainId);
    return normalizeBatchResults(actions, serial);
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
 * Results return in request order, each typed by its item's action and
 * normalized to the matching viem value — the same value the
 * corresponding single-action client returns for the same wire value
 * (e.g. `getBalance` decodes its hex quantity to `bigint`):
 *
 * @example
 * import { batchActions } from 'viem-proxy/actions'
 * const [balance, blockNumber] = (
 *   await batchActions(
 *     [
 *       { id: 1, action: 'getBalance', args: { address: '0x...' } },
 *       { id: 2, action: 'getBlockNumber' },
 *     ],
 *     { endpoint: 'https://proxy.example.com' }
 *   )
 * ).map((item) => item.result)
 * // balance: bigint | undefined, blockNumber: bigint | undefined
 */
export const batchActions = async <const T extends readonly BatchRequest[]>(
  actions: T & BatchRequests<T>,
  config?: Partial<ProxyActionConfig>,
  defaultChainId = 1
): Promise<BatchResults<T>> =>
  executeBatch(
    actions,
    resolveProxyConfig(config),
    defaultChainId
  ) as Promise<BatchResults<T>>;

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

export const runNativeBatch = async <
  TChain extends Chain | undefined,
  const T extends readonly BatchRequest[]
>(
  client: Client<Transport, TChain>,
  actions: T & BatchRequests<T>
): Promise<BatchResults<T>> => {
  const results: RawBatchResult[] = [];
  for (const action of actions) {
    try {
      const result = await nativeActionRunners[action.action](
        client as Client<Transport, Chain | undefined>,
        action.args as Record<string, unknown> | undefined
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
  return results as BatchResults<T>;
};

/**
 * Batch entry point bound to a proxied client: resolves the proxy config
 * and chain from the client itself. Without a proxy config, items run
 * natively like any other action. The returned closure preserves the
 * item-type inference of `batchActions`/`runNativeBatch`.
 */
export const batchClientActions = <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
) => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;
  const run = <const T extends readonly BatchRequest[]>(
    requests: T & BatchRequests<T>
  ): Promise<BatchResults<T>> =>
    proxy?.endpoint
      ? batchActions<T>(requests, proxy, chainId)
      : runNativeBatch<TChain, T>(client, requests);
  return run;
};
