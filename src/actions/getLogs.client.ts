import type { Client, Chain, Transport, Log } from "viem";
import { getLogs as viemGetLogs } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest } from "./utils";

export type GetLogsParameters = {
  address?: `0x${string}` | `0x${string}`[];
  event?: unknown;
  fromBlock?: bigint | string;
  toBlock?: bigint | string;
};

export type GetLogsReturnType = Log[];

/**
 * Get logs through proxy
 */
export const getLogs = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args?: GetLogsParameters
): Promise<GetLogsReturnType> => {
  const proxy = getProxyConfig(client);
  const params = args ?? {};
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetLogs(client, params as any);
  }

  try {
    const result = await makeProxyRequest<GetLogsReturnType>(
      "getLogs",
      chainId,
      {
        address: params.address,
        fromBlock: params.fromBlock?.toString(),
        toBlock: params.toBlock?.toString(),
      },
      proxy
    );
    return result;
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetLogs(client, params as any);
    }
    throw error;
  }
};
