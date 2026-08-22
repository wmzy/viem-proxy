import type { Client, Chain, Transport } from "viem";
import { getBlobBaseFee as viemGetBlobBaseFee } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetBlobBaseFeeReturnType = bigint;

/**
 * Decode the raw blob base fee hex quantity. Shared with the batch path
 * so both return the same viem value for the same wire value.
 */
export const decodeGetBlobBaseFeeResult = (result: string): bigint =>
  BigInt(result);

/**
 * Get the current blob base fee through proxy
 */
export const getBlobBaseFee = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>
): Promise<GetBlobBaseFeeReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetBlobBaseFee(client);
  }

  try {
    const result = await makeProxyRequest<string>(
      "getBlobBaseFee",
      chainId,
      {},
      proxy
    );
    return decodeGetBlobBaseFeeResult(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getBlobBaseFee", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetBlobBaseFee(client);
    }
    throw error;
  }
};
