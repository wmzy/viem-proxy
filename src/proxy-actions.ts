import type { PublicClient } from "viem";
import type { ProxyConfig } from "./types";

type ProxyRequestOptions = {
  endpoint: string;
  chainId: number;
  timeout?: number;
  debug?: boolean;
};

type ProxyResponse<T> = {
  result: T;
  blockNumber?: string;
  timestamp: number;
};

type ProxyErrorResponse = {
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

/**
 * Make a proxy request to the server
 */
const makeProxyRequest = async <T>(
  functionName: string,
  args: Record<string, unknown>,
  options: ProxyRequestOptions
): Promise<T> => {
  const { endpoint, chainId, timeout = 30000, debug = false } = options;
  const url = `${endpoint}/api/v1/${chainId}/${functionName}`;

  if (debug) {
    console.log(`[viem-proxy] ${functionName}:`, args);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeout),
  });

  const data = (await response.json()) as ProxyResponse<T> | ProxyErrorResponse;

  if ("error" in data) {
    throw new Error(`Proxy error: ${data.error.message}`);
  }

  if (debug) {
    console.log(`[viem-proxy] ${functionName} result:`, data.result);
  }

  return data.result;
};

/**
 * Create proxy action for getBalance
 */
export const createProxyGetBalance = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args: { address: string; blockTag?: string; blockNumber?: bigint }) => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<string>(
        "getBalance",
        {
          address: args.address,
          blockTag: args.blockTag,
          blockNumber: args.blockNumber?.toString(),
        },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return BigInt(result);
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getBalance(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for getBlock
 */
export const createProxyGetBlock = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args?: {
    blockHash?: string;
    blockNumber?: bigint;
    blockTag?: string;
    includeTransactions?: boolean;
  }) => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<any>(
        "getBlock",
        {
          blockHash: args?.blockHash,
          blockNumber: args?.blockNumber?.toString(),
          blockTag: args?.blockTag,
          includeTransactions: args?.includeTransactions,
        },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return result;
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getBlock(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for getBlockNumber
 */
export const createProxyGetBlockNumber = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async () => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<string>(
        "getBlockNumber",
        {},
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return BigInt(result);
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getBlockNumber();
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for getTransaction
 */
export const createProxyGetTransaction = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args: { hash: string }) => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<any>(
        "getTransaction",
        { hash: args.hash },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return result;
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getTransaction(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for getTransactionReceipt
 */
export const createProxyGetTransactionReceipt = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args: { hash: string }) => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<any>(
        "getTransactionReceipt",
        { hash: args.hash },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return result;
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getTransactionReceipt(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for call
 */
export const createProxyCall = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args: {
    to?: string;
    data?: string;
    gas?: bigint;
    gasPrice?: bigint;
    value?: bigint;
    blockTag?: string;
    blockNumber?: bigint;
    account?: { address: string } | string;
  }) => {
    const chainId = client.chain?.id ?? 1;
    const from = typeof args.account === "string" 
      ? args.account 
      : args.account?.address;

    try {
      const result = await makeProxyRequest<{ data: string }>(
        "call",
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
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return result;
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.call(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for readContract
 */
export const createProxyReadContract = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args: {
    address: string;
    abi: any[];
    functionName: string;
    args?: any[];
    blockTag?: string;
    blockNumber?: bigint;
  }) => {
    const chainId = client.chain?.id ?? 1;

    try {
      // Encode the call data on client side
      const { encodeFunctionData, decodeFunctionResult } = await import("viem");
      const data = encodeFunctionData({
        abi: args.abi,
        functionName: args.functionName,
        args: args.args ?? [],
      });

      const result = await makeProxyRequest<string>(
        "readContract",
        {
          address: args.address,
          data,
          blockTag: args.blockTag,
          blockNumber: args.blockNumber?.toString(),
        },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );

      // Decode the result on client side
      return decodeFunctionResult({
        abi: args.abi,
        functionName: args.functionName,
        data: result as `0x${string}`,
      });
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.readContract(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for estimateGas
 */
export const createProxyEstimateGas = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args: {
    to?: string;
    data?: string;
    gas?: bigint;
    gasPrice?: bigint;
    value?: bigint;
    account?: { address: string } | string;
  }) => {
    const chainId = client.chain?.id ?? 1;
    const from = typeof args.account === "string" 
      ? args.account 
      : args.account?.address;

    try {
      const result = await makeProxyRequest<string>(
        "estimateGas",
        {
          to: args.to,
          data: args.data,
          from,
          gas: args.gas?.toString(),
          gasPrice: args.gasPrice?.toString(),
          value: args.value?.toString(),
        },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return BigInt(result);
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.estimateGas(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for getGasPrice
 */
export const createProxyGetGasPrice = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async () => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<string>(
        "getGasPrice",
        {},
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return BigInt(result);
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getGasPrice();
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for getLogs
 */
export const createProxyGetLogs = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args?: {
    address?: string | string[];
    event?: any;
    fromBlock?: bigint | string;
    toBlock?: bigint | string;
  }) => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<any[]>(
        "getLogs",
        {
          address: args?.address,
          fromBlock: args?.fromBlock?.toString(),
          toBlock: args?.toBlock?.toString(),
        },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return result;
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getLogs(args as any);
      }
      throw error;
    }
  };
};

/**
 * Create proxy action for getCode
 */
export const createProxyGetCode = (
  client: PublicClient,
  config: ProxyConfig
) => {
  return async (args: {
    address: string;
    blockTag?: string;
    blockNumber?: bigint;
  }) => {
    const chainId = client.chain?.id ?? 1;

    try {
      const result = await makeProxyRequest<string | undefined>(
        "getCode",
        {
          address: args.address,
          blockTag: args.blockTag,
          blockNumber: args.blockNumber?.toString(),
        },
        {
          endpoint: config.endpoint,
          chainId,
          timeout: config.timeout,
          debug: config.debug,
        }
      );
      return result as `0x${string}` | undefined;
    } catch (error) {
      if (config.fallback) {
        if (config.debug) {
          console.warn("[viem-proxy] Fallback to direct RPC:", error);
        }
        return client.getCode(args as any);
      }
      throw error;
    }
  };
};
