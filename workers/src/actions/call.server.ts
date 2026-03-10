import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type CallArgs = {
  to?: string;
  data?: string;
  from?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  blockTag?: string;
  blockNumber?: string;
};

/**
 * Server handler for call
 */
export const callHandler = async (
  ctx: ActionContext & { args: CallArgs }
): Promise<ActionResult<{ data: string | undefined }>> => {
  const { chainId, args } = ctx;
  const {
    to,
    data,
    from,
    gas,
    gasPrice,
    value,
    blockTag = "latest",
    blockNumber,
  } = args;

  const blockParam = blockNumber
    ? `0x${BigInt(blockNumber).toString(16)}`
    : blockTag;

  const callObject: Record<string, unknown> = {};
  if (to) callObject.to = to;
  if (data) callObject.data = data;
  if (from) callObject.from = from;
  if (gas) callObject.gas = `0x${BigInt(gas).toString(16)}`;
  if (gasPrice) callObject.gasPrice = `0x${BigInt(gasPrice).toString(16)}`;
  if (value) callObject.value = `0x${BigInt(value).toString(16)}`;

  const result = await executeRpcCall(chainId, "eth_call", [
    callObject,
    blockParam,
  ]);

  return { result: { data: result.result as string | undefined } };
};
