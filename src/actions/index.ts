// Client actions
export { getBalance } from "./getBalance.client";
export { getBlock } from "./getBlock.client";
export { getBlockNumber } from "./getBlockNumber.client";
export { getTransaction } from "./getTransaction.client";
export { getTransactionReceipt } from "./getTransactionReceipt.client";
export { readContract } from "./readContract.client";
export { call } from "./call.client";
export { estimateGas } from "./estimateGas.client";
export { getGasPrice } from "./getGasPrice.client";
export { getLogs } from "./getLogs.client";
export { getCode } from "./getCode.client";
export { getChainId } from "./getChainId.client";
export { getTransactionCount } from "./getTransactionCount.client";
export { getStorageAt } from "./getStorageAt.client";
export { getFeeHistory } from "./getFeeHistory.client";
export { getBlobBaseFee } from "./getBlobBaseFee.client";

// Batch API
export { batchActions, runNativeBatch } from "./batch.client";
export type {
  BatchActionName,
  BatchRequest,
  BatchResult,
  BatchResults,
  BatchItemError,
  BatchActionParameters,
  BatchActionReturnType,
} from "./batch.client";

// Cache preheat API
export { preheatCache, preheatClientCache, PREHEAT_CONCURRENCY } from "./preheat.client";
export type { PreheatRequest, PreheatResult } from "./preheat.client";

// Cache purge API (standalone: no client instance involved)
export { purgeCache } from "./purge.client";
export type { PurgeRequest, PurgeResult } from "./purge.client";

// Middleware API
export { addMiddleware, clearMiddlewares, getMiddlewares } from "./middleware";

// Global proxy configuration
export {
  configureProxy,
  getProxyDefaults,
  resetProxyDefaults,
} from "./config";

// Extend helper
export { proxyActions } from "./proxyActions";
export type { ProxyActionsReturnType } from "./proxyActions";

// Types
export type { ProxyActionConfig, ProxyResponse, ProxyErrorResponse } from "./types";

// Re-export parameter types
export type { GetBalanceParameters, GetBalanceReturnType } from "./getBalance.client";
export type { GetBlockParameters, GetBlockReturnType } from "./getBlock.client";
export type { GetBlockNumberReturnType } from "./getBlockNumber.client";
export type { GetTransactionParameters, GetTransactionReturnType } from "./getTransaction.client";
export type { GetTransactionReceiptParameters, GetTransactionReceiptReturnType } from "./getTransactionReceipt.client";
export type { ReadContractParameters } from "./readContract.client";
export type { CallParameters, CallReturnType } from "./call.client";
export type { EstimateGasParameters, EstimateGasReturnType } from "./estimateGas.client";
export type { GetGasPriceReturnType } from "./getGasPrice.client";
export type { GetLogsParameters, GetLogsReturnType } from "./getLogs.client";
export type { GetCodeParameters, GetCodeReturnType } from "./getCode.client";
export type { GetChainIdReturnType } from "./getChainId.client";
export type { GetTransactionCountParameters, GetTransactionCountReturnType } from "./getTransactionCount.client";
export type { GetStorageAtParameters, GetStorageAtReturnType } from "./getStorageAt.client";
export type { GetFeeHistoryParameters, GetFeeHistoryReturnType } from "./getFeeHistory.client";
export type { GetBlobBaseFeeReturnType } from "./getBlobBaseFee.client";
