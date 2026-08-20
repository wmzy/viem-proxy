import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type GetFeeHistoryArgs = {
  blockCount: number;
  blockTag?: string;
  blockNumber?: string;
  rewardPercentiles?: number[];
};

/** Raw eth_feeHistory payload (hex quantities) as returned upstream */
export type RpcFeeHistory = {
  oldestBlock: string;
  baseFeePerGas: string[];
  gasUsedRatio: number[];
  reward?: string[][];
};

/**
 * Server handler for getFeeHistory
 */
export const getFeeHistoryHandler = async (
  ctx: ActionContext & { args: GetFeeHistoryArgs }
): Promise<ActionResult<RpcFeeHistory>> => {
  const { chainId, args } = ctx;
  const {
    blockCount = 1,
    blockTag = "latest",
    blockNumber,
    rewardPercentiles = [],
  } = args;

  const blockParam = blockNumber
    ? `0x${BigInt(blockNumber).toString(16)}`
    : blockTag;

  const result = await executeRpcCall(chainId, "eth_feeHistory", [
    `0x${BigInt(blockCount).toString(16)}`,
    blockParam,
    rewardPercentiles,
  ]);

  const history = result.result as RpcFeeHistory | null;
  return {
    result: result.result as RpcFeeHistory,
    blockNumber: history?.oldestBlock,
  };
};
