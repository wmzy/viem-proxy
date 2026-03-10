import type { Client, Chain, Transport } from "viem";
import { getBalance as viemGetBalance } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest } from "./utils";

export type GetBalanceParameters = {
  address: string;
  blockTag?: string;
  blockNumber?: bigint;
};

export type GetBalanceReturnType = bigint;

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
    return BigInt(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetBalance(client, args as any);
    }
    throw error;
  }
};
