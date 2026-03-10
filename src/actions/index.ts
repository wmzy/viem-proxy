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
