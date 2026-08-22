import type { Client, Chain, Transport } from "viem";
import { getGasPrice as viemGetGasPrice } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetGasPriceReturnType = bigint;

/**
 * Decode a raw `eth_gasPrice` hex quantity. Shared with the batch path
 * so both return the same viem value for the same wire value.
 */
export const decodeGetGasPriceResult = (result: string): bigint =>
  BigInt(result);

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
    return decodeGetGasPriceResult(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getGasPrice", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetGasPrice(client);
    }
    throw error;
  }
};
