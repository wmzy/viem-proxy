import type { Client, Chain, Transport } from "viem";
import { getBalance as viemGetBalance } from "viem/actions";
import type { ProxyActionConfig } from "./types";
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
 * // Standalone usage
 * import { getBalance } from 'viem-proxy/actions'
 * const balance = await getBalance(client, {
 *   address: '0x...',
 *   proxy: { endpoint: 'https://proxy.example.com' }
 * })
 */
export const getBalance = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetBalanceParameters & { proxy?: ProxyActionConfig }
): Promise<GetBalanceReturnType> => {
  const { proxy, ...params } = args;
  const chainId = client.chain?.id ?? 1;

  // If no proxy config, use direct viem call
  if (!proxy?.endpoint) {
    return viemGetBalance(client, params as any);
  }

  try {
    const result = await makeProxyRequest<string>(
      "getBalance",
      chainId,
      {
        address: params.address,
        blockTag: params.blockTag,
        blockNumber: params.blockNumber?.toString(),
      },
      proxy
    );
    return BigInt(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetBalance(client, params as any);
    }
    throw error;
  }
};
