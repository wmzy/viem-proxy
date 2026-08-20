import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

/**
 * Server handler for getChainId
 */
export const getChainIdHandler = async (
  ctx: ActionContext
): Promise<ActionResult<string>> => {
  const { chainId } = ctx;

  const result = await executeRpcCall(chainId, "eth_chainId", []);

  return { result: result.result as string };
};
