import type { ActionContext, ActionResult } from "./types";
import { executeRpcCall } from "./utils";

export type EstimateGasArgs = {
  to?: string;
  data?: string;
  from?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
};

/**
 * Server handler for estimateGas
 */
export const estimateGasHandler = async (
  ctx: ActionContext & { args: EstimateGasArgs }
): Promise<ActionResult<string>> => {
  const { chainId, args } = ctx;
  const { to, data, from, gas, gasPrice, value } = args;

  const callObject: Record<string, unknown> = {};
  if (to) callObject.to = to;
  if (data) callObject.data = data;
  if (from) callObject.from = from;
  if (gas) callObject.gas = `0x${BigInt(gas).toString(16)}`;
  if (gasPrice) callObject.gasPrice = `0x${BigInt(gasPrice).toString(16)}`;
  if (value) callObject.value = `0x${BigInt(value).toString(16)}`;

  const result = await executeRpcCall(chainId, "eth_estimateGas", [callObject]);

  return { result: result.result as string };
};
