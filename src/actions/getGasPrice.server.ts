import type { ActionContext, ActionResult } from "./types";

/**
 * Server handler for getGasPrice
 */
export const getGasPriceHandler = async (
  ctx: ActionContext
): Promise<ActionResult<string>> => {
  const { chainId } = ctx;

  const rpcRequest = {
    jsonrpc: "2.0" as const,
    id: Date.now(),
    method: "eth_gasPrice",
    params: [],
  };

  const rpcUrl = getRpcUrl(chainId);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpcRequest),
  });

  const data = await response.json() as { result?: string; error?: { message: string } };

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return { result: data.result! };
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
