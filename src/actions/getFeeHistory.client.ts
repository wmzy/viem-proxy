import type { Client, Chain, Transport } from "viem";
import { getFeeHistory as viemGetFeeHistory } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest, recordFallback } from "./utils";

export type GetFeeHistoryParameters = {
  blockCount: number;
  blockTag?: string;
  blockNumber?: bigint;
  rewardPercentiles?: number[];
};

export type GetFeeHistoryReturnType = {
  baseFeePerGas: bigint[];
  gasUsedRatio: number[];
  oldestBlock: bigint;
  reward?: bigint[][];
};

/** Raw eth_feeHistory payload (hex quantities) as returned upstream */
export type RpcFeeHistory = {
  oldestBlock: string;
  baseFeePerGas: string[];
  gasUsedRatio: number[];
  reward?: string[][];
};

/** Convert the raw RPC payload to viem's bigint-based fee history shape.
 * Exported for the batch path, which normalizes its items the same way. */
export const formatFeeHistory = (history: RpcFeeHistory): GetFeeHistoryReturnType => ({
  baseFeePerGas: history.baseFeePerGas.map((fee) => BigInt(fee)),
  gasUsedRatio: history.gasUsedRatio,
  oldestBlock: BigInt(history.oldestBlock),
  ...(history.reward
    ? { reward: history.reward.map((rewards) => rewards.map((fee) => BigInt(fee))) }
    : {}),
});

/**
 * Get historical gas information through proxy
 */
export const getFeeHistory = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetFeeHistoryParameters
): Promise<GetFeeHistoryReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetFeeHistory(client, args as any) as Promise<GetFeeHistoryReturnType>;
  }

  try {
    const result = await makeProxyRequest<RpcFeeHistory>(
      "getFeeHistory",
      chainId,
      {
        blockCount: args.blockCount,
        blockTag: args.blockTag,
        blockNumber: args.blockNumber?.toString(),
        rewardPercentiles: args.rewardPercentiles,
      },
      proxy
    );
    return formatFeeHistory(result);
  } catch (error) {
    if (proxy.fallback !== false) {
      recordFallback("getFeeHistory", error);
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetFeeHistory(client, args as any) as Promise<GetFeeHistoryReturnType>;
    }
    throw error;
  }
};
