import type { Client, Chain, Transport } from "viem";
import { estimateGas as viemEstimateGas } from "viem/actions";
import type { ProxyActionConfig } from "./types";
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
  args: EstimateGasParameters & { proxy?: ProxyActionConfig }
): Promise<EstimateGasReturnType> => {
  const { proxy, ...params } = args;
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemEstimateGas(client, params as any);
  }

  const from =
    typeof params.account === "string"
      ? params.account
      : params.account?.address;

  try {
    const result = await makeProxyRequest<string>(
      "estimateGas",
      chainId,
      {
        to: params.to,
        data: params.data,
        from,
        gas: params.gas?.toString(),
        gasPrice: params.gasPrice?.toString(),
        value: params.value?.toString(),
      },
      proxy
    );
    return BigInt(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemEstimateGas(client, params as any);
    }
    throw error;
  }
};
