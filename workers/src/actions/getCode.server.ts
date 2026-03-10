import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetCodeArgs = {
  address: string;
  blockTag?: string;
  blockNumber?: string;
};

/**
 * Server handler for getCode
 */
export const getCodeHandler = async (
  ctx: ActionContext & { args: GetCodeArgs }
): Promise<ActionResult<string | undefined>> => {
  const { chainId, args } = ctx;
  const { address, blockTag = "latest", blockNumber } = args;

  const blockParam = blockNumber
    ? `0x${BigInt(blockNumber).toString(16)}`
    : blockTag;

  const result = await executeRpcCall(chainId, "eth_getCode", [
    address,
    blockParam,
  ]);

  // Return undefined if code is empty (0x)
  const code = result.result as string;
  return { result: code === "0x" ? undefined : code };
};
