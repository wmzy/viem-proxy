import type { Client, Chain, Transport } from "viem";
import { call as viemCall } from "viem/actions";
import type { ProxyActionConfig } from "./types";
import { makeProxyRequest } from "./utils";

export type CallParameters = {
  to?: `0x${string}`;
  data?: `0x${string}`;
  gas?: bigint;
  gasPrice?: bigint;
  value?: bigint;
  blockTag?: string;
  blockNumber?: bigint;
  account?: { address: `0x${string}` } | `0x${string}`;
};

export type CallReturnType = { data: `0x${string}` | undefined };

/**
 * Execute a call through proxy
 */
export const call = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: CallParameters & { proxy?: ProxyActionConfig }
): Promise<CallReturnType> => {
  const { proxy, ...params } = args;
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemCall(client, params as any);
  }

  const from =
    typeof params.account === "string"
      ? params.account
      : params.account?.address;

  try {
    const result = await makeProxyRequest<CallReturnType>(
      "call",
      chainId,
      {
        to: params.to,
        data: params.data,
        from,
        gas: params.gas?.toString(),
        gasPrice: params.gasPrice?.toString(),
        value: params.value?.toString(),
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
      return viemCall(client, params as any);
    }
    throw error;
  }
};
