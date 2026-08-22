import type { Client, Chain, Transport } from "viem";
import { getChainId as viemGetChainId } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetChainIdReturnType = number;

/**
 * Decode a raw `eth_chainId` hex quantity to a number. Shared with the
 * batch path so both return the same viem value for the same wire value.
 */
export const decodeGetChainIdResult = (result: string): number =>
  Number(BigInt(result));

/**
 * Get the chain ID through proxy
 */
export const getChainId = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
): Promise<GetChainIdReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetChainId(client);
  }

  try {
    const result = await makeProxyRequest<string>(
      "getChainId",
      chainId,
      {},
      proxy
    );
    return decodeGetChainIdResult(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getChainId", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetChainId(client);
    }
    throw error;
  }
};
