import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type ReadContractArgs = {
  address: string;
  data: string;
  blockTag?: string;
  blockNumber?: string;
};

/**
 * Server handler for readContract
 * Note: Client encodes the calldata, server just executes eth_call
 */
export const readContractHandler = async (
  ctx: ActionContext & { args: ReadContractArgs }
): Promise<ActionResult<string>> => {
  const { chainId, args } = ctx;
  const { address, data, blockTag = "latest", blockNumber } = args;

  const blockParam = blockNumber
    ? `0x${BigInt(blockNumber).toString(16)}`
    : blockTag;

  const result = await executeRpcCall(chainId, "eth_call", [
    { to: address, data },
    blockParam,
  ]);

  return { result: result.result as string };
};
