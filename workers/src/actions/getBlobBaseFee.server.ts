import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

/**
 * Server handler for getBlobBaseFee
 */
export const getBlobBaseFeeHandler = async (
  ctx: ActionContext
): Promise<ActionResult<string>> => {
  const { chainId } = ctx;

  const result = await executeRpcCall(chainId, "eth_blobBaseFee", []);

  return { result: result.result as string };
};
