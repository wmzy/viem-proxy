import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetBlockArgs = {
  blockHash?: string;
  blockNumber?: string;
  blockTag?: string;
  includeTransactions?: boolean;
};

/**
 * Server handler for getBlock
 */
export const getBlockHandler = async (
  ctx: ActionContext & { args: GetBlockArgs }
): Promise<ActionResult<unknown>> => {
  const { chainId, args } = ctx;
  const {
    blockHash,
    blockNumber,
    blockTag = "latest",
    includeTransactions = false,
  } = args;

  let result;

  if (blockHash) {
    result = await executeRpcCall(chainId, "eth_getBlockByHash", [
      blockHash,
      includeTransactions,
    ]);
  } else {
    const blockParam = blockNumber
      ? `0x${BigInt(blockNumber).toString(16)}`
      : blockTag;
    result = await executeRpcCall(chainId, "eth_getBlockByNumber", [
      blockParam,
      includeTransactions,
    ]);
  }

  const block = result.result as { number?: string } | null;
  return {
    result: result.result,
    blockNumber: block?.number,
  };
};
