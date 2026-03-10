import type { Client, Chain, Transport, Transaction } from "viem";
import { getTransaction as viemGetTransaction } from "viem/actions";
import type { ProxyActionConfig } from "./types";
import { makeProxyRequest } from "./utils";

export type GetTransactionParameters = {
  hash: `0x${string}`;
};

export type GetTransactionReturnType = Transaction;

/**
 * Get a transaction by hash through proxy
 */
export const getTransaction = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetTransactionParameters & { proxy?: ProxyActionConfig }
): Promise<GetTransactionReturnType> => {
  const { proxy, ...params } = args;
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetTransaction(client, params as any) as Promise<GetTransactionReturnType>;
  }

  try {
    const result = await makeProxyRequest<GetTransactionReturnType>(
      "getTransaction",
      chainId,
      { hash: params.hash },
      proxy
    );
    return result;
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetTransaction(client, params as any) as Promise<GetTransactionReturnType>;
    }
    throw error;
  }
};
