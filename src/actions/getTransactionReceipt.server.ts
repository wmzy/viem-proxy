import type { ActionContext, ActionResult } from "./types";

export type GetTransactionReceiptArgs = {
  hash: string;
};

/**
 * Server handler for getTransactionReceipt
 */
export const getTransactionReceiptHandler = async (
  ctx: ActionContext & { args: GetTransactionReceiptArgs }
): Promise<ActionResult<unknown>> => {
  const { chainId, args } = ctx;
  const { hash } = args;

  const rpcRequest = {
    jsonrpc: "2.0" as const,
    id: Date.now(),
    method: "eth_getTransactionReceipt",
    params: [hash],
  };

  const rpcUrl = getRpcUrl(chainId);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpcRequest),
  });

  const data = await response.json() as { result?: unknown; error?: { message: string } };

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const receipt = data.result as { blockNumber?: string } | null;
  return {
    result: data.result,
    blockNumber: receipt?.blockNumber,
  };
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
