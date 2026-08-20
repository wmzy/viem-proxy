import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetStorageAtArgs = {
  address: string;
  slot: string;
  blockTag?: string;
  blockNumber?: string;
};

/**
 * Server handler for getStorageAt
 */
export const getStorageAtHandler = async (
  ctx: ActionContext & { args: GetStorageAtArgs }
): Promise<ActionResult<string>> => {
  const { chainId, args } = ctx;
  const { address, slot, blockTag = "latest", blockNumber } = args;

  const blockParam = blockNumber
    ? `0x${BigInt(blockNumber).toString(16)}`
    : blockTag;

  const result = await executeRpcCall(chainId, "eth_getStorageAt", [
    address,
    slot,
    blockParam,
  ]);

  return { result: result.result as string };
};
