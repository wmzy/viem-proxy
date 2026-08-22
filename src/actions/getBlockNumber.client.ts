import type { Client, Chain, Transport } from "viem";
import { getBlockNumber as viemGetBlockNumber } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetBlockNumberReturnType = bigint;

/**
 * Decode a raw `eth_blockNumber` hex quantity. Shared with the batch
 * path so both return the same viem value for the same wire value.
 */
export const decodeGetBlockNumberResult = (result: string): bigint =>
  BigInt(result);

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
    return decodeGetBlockNumberResult(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getBlockNumber", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetBlockNumber(client);
    }
    throw error;
  }
};
