import type { Client, Chain, Transport } from "viem";
import { getCode as viemGetCode } from "viem/actions";
import type { ProxyActionConfig } from "./types";
import { makeProxyRequest } from "./utils";

export type GetCodeParameters = {
  address: `0x${string}`;
  blockTag?: string;
  blockNumber?: bigint;
};

export type GetCodeReturnType = `0x${string}` | undefined;

/**
 * Get contract code through proxy
 */
export const getCode = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetCodeParameters & { proxy?: ProxyActionConfig }
): Promise<GetCodeReturnType> => {
  const { proxy, ...params } = args;
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetCode(client, params as any);
  }

  try {
    const result = await makeProxyRequest<GetCodeReturnType>(
      "getCode",
      chainId,
      {
        address: params.address,
        blockTag: params.blockTag,
        blockNumber: params.blockNumber?.toString(),
      },
      proxy
    );
    return result;
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetCode(client, params as any);
    }
    throw error;
  }
};
