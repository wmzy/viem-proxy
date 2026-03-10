import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetTransactionArgs = {
  hash: string;
};

/**
 * Server handler for getTransaction
 */
export const getTransactionHandler = async (
  ctx: ActionContext & { args: GetTransactionArgs }
): Promise<ActionResult<unknown>> => {
  const { chainId, args } = ctx;
  const { hash } = args;

  const result = await executeRpcCall(chainId, "eth_getTransactionByHash", [
    hash,
  ]);

  const tx = result.result as { blockNumber?: string } | null;
  return {
    result: result.result,
    blockNumber: tx?.blockNumber,
  };
};
