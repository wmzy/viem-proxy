import { type Context } from "hono";
import type {
  Env,
  RpcRequest,
  RpcResponse,
  RequestInfo,
  GetBalanceArgs,
  ReadContractArgs,
  GetBlockArgs,
  CallArgs,
} from "../types";
import { decompressParams, generateParamHash } from "../utils/compression";
import {
  getCacheStrategy,
  setCacheHeaders,
} from "../utils/cache";

/**
 * Get the Durable Object stub for proxy state
 */
const getProxyState = (c: Context<{ Bindings: Env }>) => {
  const id = c.env.PROXY_STATE.idFromName("global");
  return c.env.PROXY_STATE.get(id);
};

/**
 * Generate request hash for deduplication
 */
const generateRequestHash = async (
  chainId: number,
  method: string,
  params: unknown
): Promise<string> => {
  const key = `${chainId}:${method}:${JSON.stringify(params)}`;
  return generateParamHash(key);
};

/**
 * Execute RPC call with deduplication
 */
const executeWithDeduplication = async (
  c: Context<{ Bindings: Env }>,
  requestInfo: RequestInfo
): Promise<{ result: unknown; blockNumber?: string }> => {
  const proxyState = getProxyState(c);
  const requestHash = await generateRequestHash(
    requestInfo.chainId,
    requestInfo.method,
    requestInfo.params
  );

  // Check if request is already pending
  const checkResponse = await proxyState.fetch(
    new Request("http://do/requests", {
      method: "POST",
      body: JSON.stringify({ requestHash }),
    })
  );
  const checkResult = await checkResponse.json<{
    exists: boolean;
    request?: { status: string; result?: string; error?: string };
    created?: boolean;
  }>();

  // If request exists and is completed, return cached result
  if (checkResult.exists && checkResult.request) {
    if (checkResult.request.status === "completed" && checkResult.request.result) {
      return JSON.parse(checkResult.request.result);
    }
    if (checkResult.request.status === "failed" && checkResult.request.error) {
      throw new Error(checkResult.request.error);
    }
    // If pending, wait for it
    if (checkResult.request.status === "pending") {
      const waitResponse = await proxyState.fetch(
        new Request(`http://do/requests/${requestHash}/wait?timeout=30000`)
      );
      if (waitResponse.ok) {
        const waitResult = await waitResponse.json<{
          status: string;
          result?: string;
          error?: string;
        }>();
        if (waitResult.status === "completed" && waitResult.result) {
          return JSON.parse(waitResult.result);
        }
        if (waitResult.status === "failed" && waitResult.error) {
          throw new Error(waitResult.error);
        }
      }
      throw new Error("Request timeout");
    }
  }

  // Execute the RPC call
  try {
    const result = await executeRpcCall(requestInfo, c.env);

    // Mark request as completed
    await proxyState.fetch(
      new Request(`http://do/requests/${requestHash}/complete`, {
        method: "PUT",
        body: JSON.stringify({ result: JSON.stringify(result) }),
      })
    );

    return result;
  } catch (error) {
    // Mark request as failed
    await proxyState.fetch(
      new Request(`http://do/requests/${requestHash}/fail`, {
        method: "PUT",
        body: JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      })
    );
    throw error;
  }
};

/**
 * Handle compressed parameter GET requests
 */
export const handleCompressedRequest = async (
  c: Context<{ Bindings: Env }>
) => {
  try {
    const { chainId, method } = c.req.param();
    const compressedParams = c.req.query("p");

    if (!compressedParams) {
      return c.json(
        { error: { code: -32602, message: "Missing compressed parameters" } },
        400
      );
    }

    // Decompress parameters
    const paramsStr = decompressParams(compressedParams);
    const params = JSON.parse(paramsStr);

    // Build request info
    const requestInfo: RequestInfo = {
      chainId: parseInt(chainId),
      method,
      params,
      strategy: "compressed",
    };

    // Execute RPC call with deduplication
    const result = await executeWithDeduplication(c, requestInfo);

    // Set cache strategy
    const cacheStrategy = getCacheStrategy(
      requestInfo.chainId,
      method,
      params,
      300,
      result.blockNumber ? parseInt(result.blockNumber, 16) : undefined
    );

    const response = c.json({
      result: result.result,
      blockNumber: result.blockNumber,
      timestamp: Date.now(),
    });

    return setCacheHeaders(response, cacheStrategy.ttl);
  } catch (error) {
    console.error("Compressed request error:", error);
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
};

/**
 * Handle hash reference GET requests
 */
export const handleHashReferenceRequest = async (
  c: Context<{ Bindings: Env }>
) => {
  try {
    const cacheKey = c.req.param("cacheKey");
    const [chainIdStr, method, paramHash] = cacheKey.split(":");

    if (!chainIdStr || !method || !paramHash) {
      return c.json(
        { error: { code: -32602, message: "Invalid cache key format" } },
        400
      );
    }

    const chainId = parseInt(chainIdStr);
    const proxyState = getProxyState(c);

    // Try to get params from DO
    const paramsResponse = await proxyState.fetch(
      new Request(`http://do/params/${paramHash}`)
    );

    let storedParams: string | null = null;
    if (paramsResponse.ok) {
      const paramsResult = await paramsResponse.json<{ data: string }>();
      storedParams = paramsResult.data;
    }

    if (!storedParams) {
      // Check request header for original params (first request)
      const originalParams = c.req.header("X-Original-Params");

      if (originalParams) {
        // Store params in DO
        await proxyState.fetch(
          new Request("http://do/params", {
            method: "POST",
            body: JSON.stringify({ hash: paramHash, data: originalParams }),
          })
        );

        const params = JSON.parse(originalParams);
        const requestInfo: RequestInfo = {
          chainId,
          method,
          params,
          strategy: "hash-reference",
        };

        const result = await executeWithDeduplication(c, requestInfo);
        const cacheStrategy = getCacheStrategy(chainId, method, params);

        const response = c.json({
          result: result.result,
          blockNumber: result.blockNumber,
          timestamp: Date.now(),
        });

        return setCacheHeaders(response, cacheStrategy.ttl);
      }

      return c.json(
        { error: { code: -32601, message: "Parameters not found" } },
        404
      );
    }

    // Use stored params
    const params = JSON.parse(storedParams);
    const requestInfo: RequestInfo = {
      chainId,
      method,
      params,
      strategy: "hash-reference",
    };

    const result = await executeWithDeduplication(c, requestInfo);
    const cacheStrategy = getCacheStrategy(chainId, method, params);

    const response = c.json({
      result: result.result,
      blockNumber: result.blockNumber,
      timestamp: Date.now(),
    });

    return setCacheHeaders(response, cacheStrategy.ttl);
  } catch (error) {
    console.error("Hash reference request error:", error);
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
};

/**
 * Handle parameter storage requests
 */
export const handleStoreParams = async (c: Context<{ Bindings: Env }>) => {
  try {
    const { hash, params } = await c.req.json();

    if (!hash || !params) {
      return c.json(
        { error: { code: -32602, message: "Missing hash or params" } },
        400
      );
    }

    // Verify hash
    const expectedHash = await generateParamHash(params);
    if (hash !== expectedHash) {
      return c.json({ error: { code: -32602, message: "Hash mismatch" } }, 400);
    }

    // Store params in DO
    const proxyState = getProxyState(c);
    await proxyState.fetch(
      new Request("http://do/params", {
        method: "POST",
        body: JSON.stringify({ hash, data: params }),
      })
    );

    return c.json({ success: true });
  } catch (error) {
    console.error("Store params error:", error);
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
};

/**
 * Handle direct RPC calls
 */
export const handleDirectRequest = async (c: Context<{ Bindings: Env }>) => {
  try {
    const { chainId, method } = c.req.param();
    const rpcRequest: RpcRequest = await c.req.json();

    const requestInfo: RequestInfo = {
      chainId: parseInt(chainId),
      method,
      params: rpcRequest.params,
      strategy: "direct",
    };

    const result = await executeRpcCall(requestInfo, c.env);

    // Direct requests don't set cache
    return c.json({
      result: result.result,
      blockNumber: result.blockNumber,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Direct request error:", error);
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
};

/**
 * Handle function-based requests (new endpoint)
 */
export const handleFunctionRequest = async (c: Context<{ Bindings: Env }>) => {
  try {
    const { chainId, functionName } = c.req.param();
    const args = await c.req.json();

    // Convert function call to RPC method and params
    const { method, params } = convertFunctionToRpc(functionName, args);

    const requestInfo: RequestInfo = {
      chainId: parseInt(chainId),
      method,
      params,
      strategy: "function",
    };

    const result = await executeWithDeduplication(c, requestInfo);
    const cacheStrategy = getCacheStrategy(
      requestInfo.chainId,
      method,
      params,
      300,
      result.blockNumber ? parseInt(result.blockNumber, 16) : undefined
    );

    const response = c.json({
      result: result.result,
      blockNumber: result.blockNumber,
      timestamp: Date.now(),
    });

    return setCacheHeaders(response, cacheStrategy.ttl);
  } catch (error) {
    console.error("Function request error:", error);
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
};

/**
 * Convert function name and args to RPC method and params
 */
const convertFunctionToRpc = (
  functionName: string,
  args: Record<string, unknown>
): { method: string; params: unknown[] } => {
  switch (functionName) {
    case "getBalance": {
      const { address, blockTag = "latest" } = args as GetBalanceArgs;
      return {
        method: "eth_getBalance",
        params: [address, blockTag],
      };
    }

    case "getBlock": {
      const { blockHash, blockNumber, blockTag = "latest", includeTransactions = false } =
        args as GetBlockArgs;
      if (blockHash) {
        return {
          method: "eth_getBlockByHash",
          params: [blockHash, includeTransactions],
        };
      }
      const blockParam = blockNumber ? `0x${blockNumber.toString(16)}` : blockTag;
      return {
        method: "eth_getBlockByNumber",
        params: [blockParam, includeTransactions],
      };
    }

    case "getBlockNumber": {
      return {
        method: "eth_blockNumber",
        params: [],
      };
    }

    case "getTransaction": {
      const { hash } = args as { hash: string };
      return {
        method: "eth_getTransactionByHash",
        params: [hash],
      };
    }

    case "getTransactionReceipt": {
      const { hash } = args as { hash: string };
      return {
        method: "eth_getTransactionReceipt",
        params: [hash],
      };
    }

    case "call": {
      const { to, data, from, gas, gasPrice, value, blockTag = "latest" } =
        args as CallArgs;
      const callObject: Record<string, unknown> = { to };
      if (data) callObject.data = data;
      if (from) callObject.from = from;
      if (gas) callObject.gas = `0x${gas.toString(16)}`;
      if (gasPrice) callObject.gasPrice = `0x${gasPrice.toString(16)}`;
      if (value) callObject.value = `0x${value.toString(16)}`;
      return {
        method: "eth_call",
        params: [callObject, blockTag],
      };
    }

    case "readContract": {
      // For readContract, client should encode the data
      // Server just executes eth_call
      const { address, data, blockTag = "latest" } = args as {
        address: string;
        data: string;
        blockTag?: string;
      };
      return {
        method: "eth_call",
        params: [{ to: address, data }, blockTag],
      };
    }

    case "estimateGas": {
      const { to, data, from, gas, gasPrice, value } = args as CallArgs;
      const callObject: Record<string, unknown> = {};
      if (to) callObject.to = to;
      if (data) callObject.data = data;
      if (from) callObject.from = from;
      if (gas) callObject.gas = `0x${gas.toString(16)}`;
      if (gasPrice) callObject.gasPrice = `0x${gasPrice.toString(16)}`;
      if (value) callObject.value = `0x${value.toString(16)}`;
      return {
        method: "eth_estimateGas",
        params: [callObject],
      };
    }

    case "getGasPrice": {
      return {
        method: "eth_gasPrice",
        params: [],
      };
    }

    case "getLogs": {
      const { address, topics, fromBlock, toBlock } = args as {
        address?: string | string[];
        topics?: (string | string[] | null)[];
        fromBlock?: string;
        toBlock?: string;
      };
      return {
        method: "eth_getLogs",
        params: [{ address, topics, fromBlock, toBlock }],
      };
    }

    case "getCode": {
      const { address, blockTag = "latest" } = args as {
        address: string;
        blockTag?: string;
      };
      return {
        method: "eth_getCode",
        params: [address, blockTag],
      };
    }

    default:
      throw new Error(`Unsupported function: ${functionName}`);
  }
};

/**
 * Execute single RPC call
 */
const executeSingleRpcCall = async (
  requestInfo: RequestInfo,
  rpcUrl: string
): Promise<{ result: unknown; blockNumber?: string }> => {
  const rpcRequest: RpcRequest = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: requestInfo.method,
    params: requestInfo.params,
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

  if (requestInfo.method === "eth_blockNumber") {
    blockNumber = rpcResponse.result as string;
  } else if (
    requestInfo.method.includes("Block") &&
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
};

/**
 * Get RPC URLs for chain
 */
const getRpcUrls = (chainId: number): string[] => {
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
 * Execute RPC call with load balancing
 */
const executeRpcCall = async (
  requestInfo: RequestInfo,
  _env: Env
): Promise<{ result: unknown; blockNumber?: string }> => {
  const rpcUrls = getRpcUrls(requestInfo.chainId);

  for (let i = 0; i < rpcUrls.length; i++) {
    const rpcUrl = rpcUrls[i];

    try {
      return await executeSingleRpcCall(requestInfo, rpcUrl);
    } catch (error) {
      console.error(`[RPC] Failed to call ${rpcUrl}:`, error);
      if (i === rpcUrls.length - 1) {
        throw new Error(
          `All RPC endpoints failed for chain ${requestInfo.chainId}`
        );
      }
    }
  }

  throw new Error(`No working RPC endpoint for chain ${requestInfo.chainId}`);
};
