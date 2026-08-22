import type { Client, Chain, Transport, Abi } from "viem";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import { readContract as viemReadContract } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type ReadContractParameters = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockTag?: string;
  blockNumber?: bigint;
};

/**
 * Decode a raw `eth_call` return value against the request's ABI, giving
 * the same decoded value `readContract` returns. Shared with the batch
 * path so both return the same viem value for the same wire value.
 */
export const decodeReadContractResult = (
  data: `0x${string}`,
  args: Pick<ReadContractParameters, "abi" | "functionName">
): unknown =>
  decodeFunctionResult({
    abi: args.abi,
    functionName: args.functionName,
    data,
  });

/**
 * Read a contract through proxy
 */
export const readContract = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: ReadContractParameters
): Promise<unknown> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemReadContract(client, args as any);
  }

  try {
    const data = encodeFunctionData({
      abi: args.abi,
      functionName: args.functionName,
      args: args.args ?? [],
    });

    const result = await makeProxyRequest<string>(
      "readContract",
      chainId,
      {
        address: args.address,
        data,
        blockTag: args.blockTag,
        blockNumber: args.blockNumber?.toString(),
      },
      proxy
    );

    return decodeReadContractResult(result as `0x${string}`, args);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("readContract", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemReadContract(client, args as any);
    }
    throw error;
  }
};
