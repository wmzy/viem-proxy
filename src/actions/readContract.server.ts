import type { ActionContext, ActionResult } from "./types";

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

  const blockParam = blockNumber ? `0x${BigInt(blockNumber).toString(16)}` : blockTag;

  const rpcRequest = {
    jsonrpc: "2.0" as const,
    id: Date.now(),
    method: "eth_call",
    params: [{ to: address, data }, blockParam],
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
