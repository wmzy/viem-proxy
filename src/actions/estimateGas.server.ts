import type { ActionContext, ActionResult } from "./types";

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

  const rpcRequest = {
    jsonrpc: "2.0" as const,
    id: Date.now(),
    method: "eth_estimateGas",
    params: [callObject],
  };

  const rpcUrl = getRpcUrl(chainId);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpcRequest),
  });

  const rpcData = await response.json() as { result?: string; error?: { message: string } };

  if (rpcData.error) {
    throw new Error(`RPC error: ${rpcData.error.message}`);
  }

  return { result: rpcData.result! };
};

const getRpcUrl = (chainId: number): string => {
  const urls: Record<number, string> = {
    1: "https://eth.llamarpc.com",
    137: "https://polygon.llamarpc.com",
    42161: "https://arb1.arbitrum.io/rpc",
    10: "https://mainnet.optimism.io",
    56: "https://bsc-dataseed.binance.org",
  };
  return urls[chainId] ?? urls[1];
};
