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
  resolveTraceId,
  setCacheHeaders,
} from "../utils/cache";
import { recordRequestStats } from "../utils/statistics";
import type { CacheStatus } from "../types";
import { getRpcUrls, executeRpcCall as sharedExecuteRpcCall } from "../actions/utils";

const getProxyState = (c: Context<{ Bindings: Env }>, chainId: number) => {
  const id = c.env.PROXY_STATE.idFromName(`chain-${chainId}`);
  return c.env.PROXY_STATE.get(id);
};

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
): Promise<{ result: unknown; blockNumber?: string; cacheStatus: CacheStatus }> => {
  const proxyState = getProxyState(c, requestInfo.chainId);
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
      recordRequestStats(c, {
        method: requestInfo.method,
        chainId: requestInfo.chainId,
        cacheStatus: "HIT",
        error: false,
        durationMs: 0,
      });
      return { ...JSON.parse(checkResult.request.result), cacheStatus: "HIT" };
    }
    if (checkResult.request.status === "failed" && checkResult.request.error) {
      recordRequestStats(c, {
        method: requestInfo.method,
        chainId: requestInfo.chainId,
        cacheStatus: "HIT",
        error: true,
        durationMs: 0,
      });
      throw new Error(checkResult.request.error);
    }
    if (checkResult.request.status === "pending") {
      const maxWait = 30000;
      const start = Date.now();
      let interval = 50;
      while (Date.now() - start < maxWait) {
        await new Promise((r) => setTimeout(r, interval));
        interval = Math.min(interval * 2, 500);
        const statusRes = await proxyState.fetch(
          new Request(`http://do/requests/${requestHash}/status`)
        );
        if (!statusRes.ok) continue;
        const status = await statusRes.json<{
          status: string;
          result?: string;
          error?: string;
        }>();
        if (status.status === "completed" && status.result) {
          return JSON.parse(status.result);
        }
        if (status.status === "failed" && status.error) {
          throw new Error(status.error);
        }
      }
      recordRequestStats(c, {
        method: requestInfo.method,
        chainId: requestInfo.chainId,
        cacheStatus: "HIT",
        error: true,
        durationMs: 0,
      });
      throw new Error("Request timeout");
    }
  }

  // Execute the RPC call
  const upstreamStart = Date.now();
  try {
    const result = await executeRpcCall(requestInfo, c.env);
    recordRequestStats(c, {
      method: requestInfo.method,
      chainId: requestInfo.chainId,
      cacheStatus: "MISS",
      error: false,
      durationMs: Date.now() - upstreamStart,
    });

    // Mark request as completed
    await proxyState.fetch(
      new Request(`http://do/requests/${requestHash}/complete`, {
        method: "PUT",
        body: JSON.stringify({ result: JSON.stringify(result) }),
      })
    );

    return { ...result, cacheStatus: "MISS" };
  } catch (error) {
    recordRequestStats(c, {
      method: requestInfo.method,
      chainId: requestInfo.chainId,
      cacheStatus: "MISS",
      error: true,
      durationMs: Date.now() - upstreamStart,
    });
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
    const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
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

    return setCacheHeaders(response, cacheStrategy.ttl, {
      cacheStatus: result.cacheStatus,
      traceId,
    });
  } catch (error) {
    console.error("Compressed request error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          ...(isDebug ? { data: error instanceof Error ? error.message : "Unknown error" } : {}),
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
    const proxyState = getProxyState(c, chainId);

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

        const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
        const result = await executeWithDeduplication(c, requestInfo);
        const cacheStrategy = getCacheStrategy(chainId, method, params);

        const response = c.json({
          result: result.result,
          blockNumber: result.blockNumber,
          timestamp: Date.now(),
        });

        return setCacheHeaders(response, cacheStrategy.ttl, {
          cacheStatus: result.cacheStatus,
          traceId,
        });
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

    const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
    const result = await executeWithDeduplication(c, requestInfo);
    const cacheStrategy = getCacheStrategy(chainId, method, params);

    const response = c.json({
      result: result.result,
      blockNumber: result.blockNumber,
      timestamp: Date.now(),
    });

    return setCacheHeaders(response, cacheStrategy.ttl, {
      cacheStatus: result.cacheStatus,
      traceId,
    });
  } catch (error) {
    console.error("Hash reference request error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          ...(isDebug ? { data: error instanceof Error ? error.message : "Unknown error" } : {}),
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

    const id = c.env.PROXY_STATE.idFromName("params-store");
    const proxyState = c.env.PROXY_STATE.get(id);
    await proxyState.fetch(
      new Request("http://do/params", {
        method: "POST",
        body: JSON.stringify({ hash, data: params }),
      })
    );

    return c.json({ success: true });
  } catch (error) {
    console.error("Store params error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          ...(isDebug ? { data: error instanceof Error ? error.message : "Unknown error" } : {}),
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

    const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
    const upstreamStart = Date.now();
    let result: { result: unknown; blockNumber?: string };
    try {
      result = await executeRpcCall(requestInfo, c.env);
      recordRequestStats(c, {
        method,
        chainId: requestInfo.chainId,
        cacheStatus: "MISS",
        error: false,
        durationMs: Date.now() - upstreamStart,
      });
    } catch (error) {
      recordRequestStats(c, {
        method,
        chainId: requestInfo.chainId,
        cacheStatus: "MISS",
        error: true,
        durationMs: Date.now() - upstreamStart,
      });
      throw error;
    }

    // Direct requests bypass the cache but still carry observability headers
    const response = c.json({
      result: result.result,
      blockNumber: result.blockNumber,
      timestamp: Date.now(),
    });

    return setCacheHeaders(response, 0, { cacheStatus: "MISS", traceId });
  } catch (error) {
    console.error("Direct request error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          ...(isDebug ? { data: error instanceof Error ? error.message : "Unknown error" } : {}),
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

    const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
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

    return setCacheHeaders(response, cacheStrategy.ttl, {
      cacheStatus: result.cacheStatus,
      traceId,
    });
  } catch (error) {
    console.error("Function request error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          code: -32603,
          message: "Internal error",
          ...(isDebug ? { data: error instanceof Error ? error.message : "Unknown error" } : {}),
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

const executeRpcCall = async (
  requestInfo: RequestInfo,
  _env: Env
): Promise<{ result: unknown; blockNumber?: string }> => {
  return sharedExecuteRpcCall(requestInfo.chainId, requestInfo.method, requestInfo.params);
};
