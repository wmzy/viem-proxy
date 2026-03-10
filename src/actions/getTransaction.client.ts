import type { Client, Chain, Transport, Transaction } from "viem";
import { getTransaction as viemGetTransaction } from "viem/actions";
import { getProxyConfig } from "../proxy";
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
  args: GetTransactionParameters
): Promise<GetTransactionReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetTransaction(client, args as any) as Promise<GetTransactionReturnType>;
  }

  try {
    const result = await makeProxyRequest<GetTransactionReturnType>(
      "getTransaction",
      chainId,
      { hash: args.hash },
      proxy
    );
    return result;
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetTransaction(client, args as any) as Promise<GetTransactionReturnType>;
    }
    throw error;
  }
};
