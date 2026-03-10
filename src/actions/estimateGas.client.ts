import type { Client, Chain, Transport } from "viem";
import { estimateGas as viemEstimateGas } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest } from "./utils";

export type EstimateGasParameters = {
  to?: `0x${string}`;
  data?: `0x${string}`;
  gas?: bigint;
  gasPrice?: bigint;
  value?: bigint;
  account?: { address: `0x${string}` } | `0x${string}`;
};

export type EstimateGasReturnType = bigint;

/**
 * Estimate gas through proxy
 */
export const estimateGas = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: EstimateGasParameters
): Promise<EstimateGasReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  const from =
    typeof args.account === "string"
      ? args.account
      : args.account?.address;

  if (!proxy?.endpoint) {
    return viemEstimateGas(client, args as any);
  }

  try {
    const result = await makeProxyRequest<string>(
      "estimateGas",
      chainId,
      {
        to: args.to,
        data: args.data,
        from,
        gas: args.gas?.toString(),
        gasPrice: args.gasPrice?.toString(),
        value: args.value?.toString(),
      },
      proxy
    );
    return BigInt(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemEstimateGas(client, args as any);
    }
    throw error;
  }
};
