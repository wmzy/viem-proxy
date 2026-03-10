import type { ActionContext, ActionResult } from "./types";

export type GetCodeArgs = {
  address: string;
  blockTag?: string;
  blockNumber?: string;
};

/**
 * Server handler for getCode
 */
export const getCodeHandler = async (
  ctx: ActionContext & { args: GetCodeArgs }
): Promise<ActionResult<string | undefined>> => {
  const { chainId, args } = ctx;
  const { address, blockTag = "latest", blockNumber } = args;

  const blockParam = blockNumber ? `0x${BigInt(blockNumber).toString(16)}` : blockTag;

  const rpcRequest = {
    jsonrpc: "2.0" as const,
    id: Date.now(),
    method: "eth_getCode",
    params: [address, blockParam],
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

  // Return undefined if code is empty (0x)
  const code = data.result;
  return { result: code === "0x" ? undefined : code };
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
