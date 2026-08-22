import type { Client, Chain, Transport } from "viem";
import { getBalance as viemGetBalance } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetBalanceParameters = {
  address: string;
  blockTag?: string;
  blockNumber?: bigint;
};

export type GetBalanceReturnType = bigint;

/**
 * Decode a raw `eth_getBalance` hex quantity into wei. Shared with the
 * batch path so both return the same viem value for the same wire value.
 */
export const decodeGetBalanceResult = (result: string): bigint =>
  BigInt(result);

/**
 * Get the balance of an address through proxy
 *
 * @example
 * // Standalone usage (client must have proxy config via withProxy)
 * import { getBalance } from 'viem-proxy/actions'
 * const balance = await getBalance(client, { address: '0x...' })
 */
export const getBalance = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetBalanceParameters
): Promise<GetBalanceReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetBalance(client, args as any);
  }

  try {
    const result = await makeProxyRequest<string>(
      "getBalance",
      chainId,
      {
        address: args.address,
        blockTag: args.blockTag,
        blockNumber: args.blockNumber?.toString(),
      },
      proxy
    );
    return decodeGetBalanceResult(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getBalance", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetBalance(client, args as any);
    }
    throw error;
  }
};
