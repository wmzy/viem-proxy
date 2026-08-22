import type { Client, Chain, Transport } from "viem";
import { withProxy } from "../proxy";
import type { ProxyActionConfig } from "./types";
import { resolveProxyConfig } from "./config";
import type { PerformanceMetrics, ProxyMiddleware } from "../types";
import { getSharedCollector, resetMetrics } from "../utils/metrics";
import { addMiddleware } from "./middleware";
import { preheatClientCache } from "./preheat.client";
import type { PreheatRequest, PreheatResult } from "./preheat.client";
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
import { batchClientActions } from "./batch.client";
import type { BatchRequest, BatchRequests } from "./batch.client";

/**
 * Build the proxy actions object bound to a client.
 *
 * Each action resolves its proxy configuration from the client itself
 * (attached via `withProxy`) and falls back to native viem behavior
 * when no configuration is present.
 */
const buildProxyActions = <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
) => ({
  /**
   * Get the balance of an address
   */
  getBalance: (args: GetBalanceParameters) => getBalance(client, args),

  /**
   * Get a block
   */
  getBlock: (args?: GetBlockParameters) => getBlock(client, args),

  /**
   * Get the current block number
   */
  getBlockNumber: () => getBlockNumber(client),

  /**
   * Get a transaction by hash
   */
  getTransaction: (args: GetTransactionParameters) =>
    getTransaction(client, args),

  /**
   * Get a transaction receipt by hash
   */
  getTransactionReceipt: (args: GetTransactionReceiptParameters) =>
    getTransactionReceipt(client, args),

  /**
   * Read a contract
   */
  readContract: (args: ReadContractParameters) => readContract(client, args),

  /**
   * Execute a call
   */
  call: (args: CallParameters) => call(client, args),

  /**
   * Estimate gas
   */
  estimateGas: (args: EstimateGasParameters) => estimateGas(client, args),

  /**
   * Get the current gas price
   */
  getGasPrice: () => getGasPrice(client),

  /**
   * Get logs
   */
  getLogs: (args?: GetLogsParameters) => getLogs(client, args),

  /**
   * Get contract code
   */
  getCode: (args: GetCodeParameters) => getCode(client, args),

  /**
   * Get the chain ID of the client's chain
   */
  getChainId: () => getChainId(client),

  /**
   * Get the transaction count (nonce) of an address
   */
  getTransactionCount: (args: GetTransactionCountParameters) =>
    getTransactionCount(client, args),

  /**
   * Get the value of a storage slot at an address
   */
  getStorageAt: (args: GetStorageAtParameters) => getStorageAt(client, args),

  /**
   * Get historical gas information
   */
  getFeeHistory: (args: GetFeeHistoryParameters) => getFeeHistory(client, args),

  /**
   * Get the current blob base fee
   */
  getBlobBaseFee: () => getBlobBaseFee(client),

  /**
   * Execute multiple actions in one batch request against the proxy
   * (POST /api/v1/batch). Items are isolated per-entry: a failing item
   * yields an `error` result while the rest resolve. When the batch
   * endpoint is unavailable the call degrades to serial single requests;
   * without a proxy config items run through the native actions.
   *
   * Named `batchProxy` (not `batch`) because viem clients already carry
   * a `batch` multicall config property: viem's `extend` strips any
   * extension key that exists on the core client, so a `batch` action
   * would be type-rejected under strict TypeScript and silently removed
   * at runtime in extend mode.
   */
  batchProxy: <const T extends readonly BatchRequest[]>(
    requests: T & BatchRequests<T>
  ) => batchClientActions(client)<T>(requests),

  /**
   * Preheat the CDN cache for the given requests. Each item fires through
   * the regular compressed GET path in a bounded pool (5 concurrent), so
   * the edge cache fills exactly like real traffic. Failures are counted,
   * never thrown: the result is `{ submitted, failed }`.
   */
  preheatCache: (requests: PreheatRequest[]): Promise<PreheatResult> =>
    preheatClientCache(client, requests),

  /**
   * Register a proxy middleware applied to every proxied request, onion
   * style: the first registered middleware runs outermost. A middleware
   * that throws aborts the request, which then follows the usual
   * fallback/error path.
   */
  use: (middleware: ProxyMiddleware): void => {
    addMiddleware(middleware);
  },

  /**
   * Get a snapshot of locally collected performance metrics: request
   * counts, cache hit rate, error rate, response-time percentiles
   * (P50/P95/P99) and fallback observability (fallbackCount /
   * fallbackRate / fallbackReasons — a fallback means the proxy
   * delivered no value for that request), with a per-method breakdown.
   */
  getCacheStats: (): PerformanceMetrics => getSharedCollector().getSnapshot(),

  /**
   * Reset the locally collected metrics. This only clears client-side
   * statistics — it does not purge the CDN cache, which requires
   * server-side support and will be provided in a later version.
   */
  resetStats: (): void => {
    resetMetrics();
  },
});

/**
 * Proxy actions for extending a viem client. Two call signatures:
 *
 * 1. `proxyActions(config?)` returns an extension function for viem's
 *    `client.extend(...)`. The config (a partial) is merged over the
 *    module defaults set by `configureProxy` and attached to the client
 *    when the extension runs; omitted keys inherit module defaults,
 *    then built-in defaults.
 * 2. `proxyActions(client)` returns the actions object directly. The
 *    client resolves its config via `getProxyConfig` (client-mounted
 *    values win over module defaults); without any proxy config every
 *    action falls back to native viem behavior.
 *
 * @example
 * import { createPublicClient, http } from 'viem'
 * import { proxyActions } from 'viem-proxy/actions'
 * import { mainnet } from 'viem/chains'
 *
 * const client = createPublicClient({
 *   chain: mainnet,
 *   transport: http()
 * }).extend(proxyActions({
 *   endpoint: 'https://proxy.example.com',
 *   fallback: true
 * }))
 *
 * const balance = await client.getBalance({ address: '0x...' })
 *
 * @example
 * import { configureProxy, withProxy } from 'viem-proxy'
 *
 * // endpoint/timeout set once, inherited everywhere below
 * configureProxy({ endpoint: 'https://proxy.example.com', timeout: 10000 })
 * const actions = proxyActions(withProxy(client))
 * const balance = await actions.getBalance({ address: '0x...' })
 */
export function proxyActions<TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
): ProxyActions;
export function proxyActions(
  config?: Partial<ProxyActionConfig>
): <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
) => ProxyActions;
export function proxyActions(
  clientOrConfig?:
    | Client<Transport, Chain | undefined>
    | Partial<ProxyActionConfig>
):
  | ProxyActions
  | ((client: Client<Transport, Chain | undefined>) => ProxyActions) {
  // A viem client always carries a `transport`; anything else (including
  // an empty object) is a config form. The config is merged over module
  // defaults (configureProxy) and attached to the extended client, so
  // actions resolve it via getProxyConfig.
  if (clientOrConfig === undefined || !("transport" in clientOrConfig)) {
    const config = resolveProxyConfig(
      clientOrConfig as Partial<ProxyActionConfig> | undefined
    );
    return <TChain extends Chain | undefined>(
      client: Client<Transport, TChain>
    ) => buildProxyActions(withProxy(client, config));
  }

  // Client form: config (if any) already attached via withProxy.
  return buildProxyActions(clientOrConfig);
}

/**
 * The proxy actions object returned by `proxyActions(client)` or by the
 * extension function produced by `proxyActions(config)`.
 */
export type ProxyActions = ReturnType<typeof buildProxyActions>;

/**
 * Type for a client extended with proxy actions
 */
export type ProxyActionsReturnType = ProxyActions;
