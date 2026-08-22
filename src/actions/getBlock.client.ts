import type { Client, Chain, Transport, Block } from "viem";
import { getBlock as viemGetBlock } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetBlockParameters = {
  blockHash?: string;
  blockNumber?: bigint;
  blockTag?: string;
  includeTransactions?: boolean;
};

export type GetBlockReturnType = Block;

/**
 * Get a block through proxy
 */
export const getBlock = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args?: GetBlockParameters
): Promise<GetBlockReturnType> => {
  const proxy = getProxyConfig(client);
  const params = args ?? {};
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetBlock(client, params as any) as Promise<GetBlockReturnType>;
  }

  try {
    const result = await makeProxyRequest<GetBlockReturnType>(
      "getBlock",
      chainId,
      {
        blockHash: params.blockHash,
        blockNumber: params.blockNumber?.toString(),
        blockTag: params.blockTag,
        includeTransactions: params.includeTransactions,
      },
      proxy
    );
    return result;
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getBlock", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetBlock(client, params as any) as Promise<GetBlockReturnType>;
    }
    throw error;
  }
};
