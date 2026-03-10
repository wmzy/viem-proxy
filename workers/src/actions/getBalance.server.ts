import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetBalanceArgs = {
  address: string;
  blockTag?: string;
  blockNumber?: string;
};

/**
 * Server handler for getBalance
 */
export const getBalanceHandler = async (
  ctx: ActionContext & { args: GetBalanceArgs }
): Promise<ActionResult<string>> => {
  const { chainId, args } = ctx;
  const { address, blockTag = "latest", blockNumber } = args;

  const blockParam = blockNumber
    ? `0x${BigInt(blockNumber).toString(16)}`
    : blockTag;

  const result = await executeRpcCall(chainId, "eth_getBalance", [
    address,
    blockParam,
  ]);

  return { result: result.result as string };
};
