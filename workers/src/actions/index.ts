// Server action handlers
export { getBalanceHandler } from "./getBalance.server";
export { getBlockHandler } from "./getBlock.server";
export { getBlockNumberHandler } from "./getBlockNumber.server";
export { getTransactionHandler } from "./getTransaction.server";
export { getTransactionReceiptHandler } from "./getTransactionReceipt.server";
export { readContractHandler } from "./readContract.server";
export { callHandler } from "./call.server";
export { estimateGasHandler } from "./estimateGas.server";
export { getGasPriceHandler } from "./getGasPrice.server";
export { getLogsHandler } from "./getLogs.server";
export { getCodeHandler } from "./getCode.server";

// Types
export type {
  ActionContext,
  ActionResult,
  ServerActionHandler,
} from "./types";

// Utilities
export { getRpcUrls, executeRpcCall } from "./utils";

import { getBalanceHandler } from "./getBalance.server";
import { getBlockHandler } from "./getBlock.server";
import { getBlockNumberHandler } from "./getBlockNumber.server";
import { getTransactionHandler } from "./getTransaction.server";
import { getTransactionReceiptHandler } from "./getTransactionReceipt.server";
import { readContractHandler } from "./readContract.server";
import { callHandler } from "./call.server";
import { estimateGasHandler } from "./estimateGas.server";
import { getGasPriceHandler } from "./getGasPrice.server";
import { getLogsHandler } from "./getLogs.server";
import { getCodeHandler } from "./getCode.server";

// Action registry for dynamic dispatch
export const actionHandlers = {
  getBalance: getBalanceHandler,
  getBlock: getBlockHandler,
  getBlockNumber: getBlockNumberHandler,
  getTransaction: getTransactionHandler,
  getTransactionReceipt: getTransactionReceiptHandler,
  readContract: readContractHandler,
  call: callHandler,
  estimateGas: estimateGasHandler,
  getGasPrice: getGasPriceHandler,
  getLogs: getLogsHandler,
  getCode: getCodeHandler,
} as const;

export type ActionName = keyof typeof actionHandlers;
