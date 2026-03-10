import type { Client, Chain, Transport } from "viem";
import { getGasPrice as viemGetGasPrice } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest } from "./utils";

export type GetGasPriceReturnType = bigint;

/**
 * Get the current gas price through proxy
 */
export const getGasPrice = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
): Promise<GetGasPriceReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetGasPrice(client);
  }

  try {
    const result = await makeProxyRequest<string>(
      "getGasPrice",
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
      return viemGetGasPrice(client);
    }
    throw error;
  }
};
