import type { Client, Chain, Transport, Abi } from "viem";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import { readContract as viemReadContract } from "viem/actions";
import type { ProxyActionConfig } from "./types";
import { makeProxyRequest } from "./utils";

export type ReadContractParameters = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockTag?: string;
  blockNumber?: bigint;
};

/**
 * Read a contract through proxy
 */
export const readContract = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: ReadContractParameters & { proxy?: ProxyActionConfig }
): Promise<unknown> => {
  const { proxy, ...params } = args;
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemReadContract(client, params as any);
  }

  try {
    // Encode the call data on client side
    const data = encodeFunctionData({
      abi: params.abi,
      functionName: params.functionName,
      args: params.args ?? [],
    });

    const result = await makeProxyRequest<string>(
      "readContract",
      chainId,
      {
        address: params.address,
        data,
        blockTag: params.blockTag,
        blockNumber: params.blockNumber?.toString(),
      },
      proxy
    );

    // Decode the result on client side
    return decodeFunctionResult({
      abi: params.abi,
      functionName: params.functionName,
      data: result as `0x${string}`,
    });
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemReadContract(client, params as any);
    }
    throw error;
  }
};
