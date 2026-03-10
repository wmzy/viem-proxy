import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

/**
 * Server handler for getGasPrice
 */
export const getGasPriceHandler = async (
  ctx: ActionContext
): Promise<ActionResult<string>> => {
  const { chainId } = ctx;

  const result = await executeRpcCall(chainId, "eth_gasPrice", []);

  return { result: result.result as string };
};
