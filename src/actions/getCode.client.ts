import type { Client, Chain, Transport } from "viem";
import { getCode as viemGetCode } from "viem/actions";
import { getProxyConfig } from "../proxy";
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
  args: GetCodeParameters
): Promise<GetCodeReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetCode(client, args as any);
  }

  try {
    const result = await makeProxyRequest<GetCodeReturnType>(
      "getCode",
      chainId,
      {
        address: args.address,
        blockTag: args.blockTag,
        blockNumber: args.blockNumber?.toString(),
      },
      proxy
    );
    return result;
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetCode(client, args as any);
    }
    throw error;
  }
};
