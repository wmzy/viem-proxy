import type { Client, Chain, Transport } from "viem";
import { getBlockNumber as viemGetBlockNumber } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest } from "./utils";

export type GetBlockNumberReturnType = bigint;

/**
 * Get the current block number through proxy
 */
export const getBlockNumber = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
): Promise<GetBlockNumberReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetBlockNumber(client);
  }

  try {
    const result = await makeProxyRequest<string>(
      "getBlockNumber",
      chainId,
      {},
      proxy
    );
    return BigInt(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetBlockNumber(client);
    }
    throw error;
  }
};
