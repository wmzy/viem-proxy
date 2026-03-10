import type { Client, Chain, Transport } from "viem";
import { call as viemCall } from "viem/actions";
import { getProxyConfig } from "../proxy";
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
  args: CallParameters
): Promise<CallReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemCall(client, args as any);
  }

  const from =
    typeof args.account === "string"
      ? args.account
      : args.account?.address;

  try {
    const result = await makeProxyRequest<CallReturnType>(
      "call",
      chainId,
      {
        to: args.to,
        data: args.data,
        from,
        gas: args.gas?.toString(),
        gasPrice: args.gasPrice?.toString(),
        value: args.value?.toString(),
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
      return viemCall(client, args as any);
    }
    throw error;
  }
};
