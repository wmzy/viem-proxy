import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

/**
 * Server handler for getBlockNumber
 */
export const getBlockNumberHandler = async (
  ctx: ActionContext
): Promise<ActionResult<string>> => {
  const { chainId } = ctx;

  const result = await executeRpcCall(chainId, "eth_blockNumber", []);

  return {
    result: result.result as string,
    blockNumber: result.result as string,
  };
};
