import type { ActionContext, ActionResult } from "./types";

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

  const rpcRequest = {
    jsonrpc: "2.0" as const,
    id: Date.now(),
    method: "eth_getLogs",
    params: [filterObject],
  };

  const rpcUrl = getRpcUrl(chainId);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpcRequest),
  });

  const data = await response.json() as { result?: unknown[]; error?: { message: string } };

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return { result: data.result ?? [] };
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
