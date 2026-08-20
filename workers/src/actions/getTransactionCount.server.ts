import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetTransactionCountArgs = {
  address: string;
  blockTag?: string;
  blockNumber?: string;
};

/**
 * Server handler for getTransactionCount
 */
export const getTransactionCountHandler = async (
  ctx: ActionContext & { args: GetTransactionCountArgs }
): Promise<ActionResult<string>> => {
  const { chainId, args } = ctx;
  const { address, blockTag = "latest", blockNumber } = args;

  const blockParam = blockNumber
    ? `0x${BigInt(blockNumber).toString(16)}`
    : blockTag;

  const result = await executeRpcCall(chainId, "eth_getTransactionCount", [
    address,
    blockParam,
  ]);

  return { result: result.result as string };
};
