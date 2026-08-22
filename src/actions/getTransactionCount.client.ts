import type { Client, Chain, Transport } from "viem";
import { getTransactionCount as viemGetTransactionCount } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetTransactionCountParameters = {
  address: string;
  blockTag?: string;
  blockNumber?: bigint;
};

export type GetTransactionCountReturnType = number;

/**
 * Decode a raw `eth_getTransactionCount` hex quantity to a number.
 * Shared with the batch path so both return the same viem value for the
 * same wire value.
 */
export const decodeGetTransactionCountResult = (result: string): number =>
  Number(BigInt(result));

/**
 * Get the transaction count (nonce) of an address through proxy
 */
export const getTransactionCount = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetTransactionCountParameters
): Promise<GetTransactionCountReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetTransactionCount(client, args as any);
  }

  try {
    const result = await makeProxyRequest<string>(
      "getTransactionCount",
      chainId,
      {
        address: args.address,
        blockTag: args.blockTag,
        blockNumber: args.blockNumber?.toString(),
      },
      proxy
    );
    return decodeGetTransactionCountResult(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getTransactionCount", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetTransactionCount(client, args as any);
    }
    throw error;
  }
};
