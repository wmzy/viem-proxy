import type { Client, Chain, Transport, TransactionReceipt } from "viem";
import { getTransactionReceipt as viemGetTransactionReceipt } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest } from "./utils";

export type GetTransactionReceiptParameters = {
  hash: `0x${string}`;
};

export type GetTransactionReceiptReturnType = TransactionReceipt;

/**
 * Get a transaction receipt by hash through proxy
 */
export const getTransactionReceipt = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetTransactionReceiptParameters
): Promise<GetTransactionReceiptReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetTransactionReceipt(client, args as any) as Promise<GetTransactionReceiptReturnType>;
  }

  try {
    const result = await makeProxyRequest<GetTransactionReceiptReturnType>(
      "getTransactionReceipt",
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
      return viemGetTransactionReceipt(client, args as any) as Promise<GetTransactionReceiptReturnType>;
    }
    throw error;
  }
};
