import type { Client, Chain, Transport } from "viem";
import { estimateGas as viemEstimateGas } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

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
 * Decode a raw `eth_estimateGas` hex quantity. Shared with the batch
 * path so both return the same viem value for the same wire value.
 */
export const decodeEstimateGasResult = (result: string): bigint =>
  BigInt(result);

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
    return decodeEstimateGasResult(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("estimateGas", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemEstimateGas(client, args as any);
    }
    throw error;
  }
};
