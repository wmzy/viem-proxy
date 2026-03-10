import type { ActionContext, ActionResult } from "./types";

export type GetBlockArgs = {
  blockHash?: string;
  blockNumber?: string;
  blockTag?: string;
  includeTransactions?: boolean;
};

/**
 * Server handler for getBlock
 */
export const getBlockHandler = async (
  ctx: ActionContext & { args: GetBlockArgs }
): Promise<ActionResult<unknown>> => {
  const { chainId, args } = ctx;
  const { blockHash, blockNumber, blockTag = "latest", includeTransactions = false } = args;

  const rpcUrl = getRpcUrl(chainId);
  let rpcRequest;

  if (blockHash) {
    rpcRequest = {
      jsonrpc: "2.0" as const,
      id: Date.now(),
      method: "eth_getBlockByHash",
      params: [blockHash, includeTransactions],
    };
  } else {
    const blockParam = blockNumber ? `0x${BigInt(blockNumber).toString(16)}` : blockTag;
    rpcRequest = {
      jsonrpc: "2.0" as const,
      id: Date.now(),
      method: "eth_getBlockByNumber",
      params: [blockParam, includeTransactions],
    };
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpcRequest),
  });

  const data = await response.json() as { result?: unknown; error?: { message: string } };

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const block = data.result as { number?: string } | null;
  return {
    result: data.result,
    blockNumber: block?.number,
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
