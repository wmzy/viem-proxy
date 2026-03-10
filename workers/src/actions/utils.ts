import type { RpcRequest, RpcResponse } from "./types";

/**
 * Get RPC URLs for chain
 */
export const getRpcUrls = (chainId: number): string[] => {
  switch (chainId) {
    case 1: // Ethereum Mainnet
      return [
        "https://eth.llamarpc.com",
        "https://rpc.ankr.com/eth",
        "https://ethereum.publicnode.com",
      ];
    case 137: // Polygon
      return [
        "https://polygon.llamarpc.com",
        "https://rpc.ankr.com/polygon",
        "https://polygon-rpc.com",
      ];
    case 42161: // Arbitrum One
      return [
        "https://arb1.arbitrum.io/rpc",
        "https://rpc.ankr.com/arbitrum",
        "https://arbitrum.publicnode.com",
      ];
    case 10: // Optimism
      return [
        "https://mainnet.optimism.io",
        "https://rpc.ankr.com/optimism",
        "https://optimism.publicnode.com",
      ];
    case 56: // BSC
      return [
        "https://bsc-dataseed.binance.org",
        "https://rpc.ankr.com/bsc",
        "https://bsc.publicnode.com",
      ];
    default:
      throw new Error(`Unsupported chain ID: ${chainId}`);
  }
};

/**
 * Execute single RPC call
 */
export const executeRpcCall = async (
  chainId: number,
  method: string,
  params: unknown[]
): Promise<{ result: unknown; blockNumber?: string }> => {
  const rpcUrls = getRpcUrls(chainId);

  for (let i = 0; i < rpcUrls.length; i++) {
    const rpcUrl = rpcUrls[i];

    try {
      const rpcRequest: RpcRequest = {
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      };

      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "viem-proxy/1.0",
        },
        body: JSON.stringify(rpcRequest),
      });

      if (!response.ok) {
        throw new Error(
          `RPC request failed: ${response.status} ${response.statusText}`
        );
      }

      const rpcResponse: RpcResponse = await response.json();

      if (rpcResponse.error) {
        throw new Error(`RPC error: ${rpcResponse.error.message}`);
      }

      // Try to get related block number
      let blockNumber: string | undefined;

      if (method === "eth_blockNumber") {
        blockNumber = rpcResponse.result as string;
      } else if (
        method.includes("Block") &&
        typeof rpcResponse.result === "object" &&
        rpcResponse.result !== null &&
        "number" in rpcResponse.result
      ) {
        blockNumber = (rpcResponse.result as { number: string }).number;
      }

      return {
        result: rpcResponse.result,
        blockNumber,
      };
    } catch (error) {
      console.error(`[RPC] Failed to call ${rpcUrl}:`, error);
      if (i === rpcUrls.length - 1) {
        throw new Error(`All RPC endpoints failed for chain ${chainId}`);
      }
    }
  }

  throw new Error(`No working RPC endpoint for chain ${chainId}`);
};
