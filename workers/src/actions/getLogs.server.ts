import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetLogsArgs = {
  address?: string | string[];
  topics?: (string | string[] | null)[];
  fromBlock?: string;
  toBlock?: string;
};

/**
 * Server handler for getLogs
 */
export const getLogsHandler = async (
  ctx: ActionContext & { args: GetLogsArgs }
): Promise<ActionResult<unknown[]>> => {
  const { chainId, args } = ctx;
  const { address, topics, fromBlock, toBlock } = args;

  const filterObject: Record<string, unknown> = {};
  if (address) filterObject.address = address;
  if (topics) filterObject.topics = topics;
  if (fromBlock) filterObject.fromBlock = fromBlock;
  if (toBlock) filterObject.toBlock = toBlock;

  const result = await executeRpcCall(chainId, "eth_getLogs", [filterObject]);

  return { result: (result.result as unknown[]) ?? [] };
};
