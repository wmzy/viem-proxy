import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetTransactionReceiptArgs = {
  hash: string;
};

/**
 * Server handler for getTransactionReceipt
 */
export const getTransactionReceiptHandler = async (
  ctx: ActionContext & { args: GetTransactionReceiptArgs }
): Promise<ActionResult<unknown>> => {
  const { chainId, args } = ctx;
  const { hash } = args;

  const result = await executeRpcCall(chainId, "eth_getTransactionReceipt", [
    hash,
  ]);

  const receipt = result.result as { blockNumber?: string } | null;
  return {
    result: result.result,
    blockNumber: receipt?.blockNumber,
  };
};
