import { type Context } from "hono";
import type { CacheStatus, Env } from "../types";
import { actionHandlers, type ActionName, type ActionContext } from "../actions";
import { parseChainIdParam } from "../actions/utils";
import { getCacheStrategy, resolveTraceId, setCacheHeaders } from "../utils/cache";
import { recordRequestStats } from "../utils/statistics";
import { responseErrorMessage } from "../utils/errors";
import { generateParamHash } from "../utils/compression";

export const ACTION_TO_RPC_METHOD: Record<string, string> = {
  getBalance: "eth_getBalance",
  getBlock: "eth_getBlockByNumber",
  getBlockNumber: "eth_blockNumber",
  getTransaction: "eth_getTransactionByHash",
  getTransactionReceipt: "eth_getTransactionReceipt",
  readContract: "eth_call",
  call: "eth_call",
  estimateGas: "eth_estimateGas",
  getGasPrice: "eth_gasPrice",
  getLogs: "eth_getLogs",
  getCode: "eth_getCode",
  getChainId: "eth_chainId",
  getTransactionCount: "eth_getTransactionCount",
  getStorageAt: "eth_getStorageAt",
  getFeeHistory: "eth_feeHistory",
  getBlobBaseFee: "eth_blobBaseFee",
};

const getProxyState = (c: Context<{ Bindings: Env }>, chainId: number) => {
  const id = c.env.PROXY_STATE.idFromName(`chain-${chainId}`);
  return c.env.PROXY_STATE.get(id);
};

const generateRequestHash = async (
  chainId: number,
  actionName: string,
  args: unknown
): Promise<string> => {
  const key = `${chainId}:${actionName}:${JSON.stringify(args)}`;
  return generateParamHash(key);
};

/**
 * Execute action with deduplication
 *
 * Shared by the single-action route and the batch endpoint: performs DO
 * request deduplication, invokes the action handler, and records stats.
 */
export const executeWithDeduplication = async <T>(
  c: Context<{ Bindings: Env }>,
  chainId: number,
  actionName: ActionName,
  args: Record<string, unknown>
): Promise<{ result: T; blockNumber?: string; cacheStatus: CacheStatus }> => {
  const proxyState = getProxyState(c, chainId);
  const requestHash = await generateRequestHash(chainId, actionName, args);

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

  if (checkResult.exists && checkResult.request) {
    if (checkResult.request.status === "completed" && checkResult.request.result) {
      recordRequestStats(c, {
        method: ACTION_TO_RPC_METHOD[actionName] ?? actionName,
        chainId,
        cacheStatus: "HIT",
        error: false,
        durationMs: 0,
      });
      return { ...JSON.parse(checkResult.request.result), cacheStatus: "HIT" };
    }
    if (checkResult.request.status === "failed" && checkResult.request.error) {
      recordRequestStats(c, {
        method: ACTION_TO_RPC_METHOD[actionName] ?? actionName,
        chainId,
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
          recordRequestStats(c, {
            method: ACTION_TO_RPC_METHOD[actionName] ?? actionName,
            chainId,
            cacheStatus: "HIT",
            error: false,
            durationMs: 0,
          });
          return { ...JSON.parse(status.result), cacheStatus: "HIT" };
        }
        if (status.status === "failed" && status.error) {
          recordRequestStats(c, {
            method: ACTION_TO_RPC_METHOD[actionName] ?? actionName,
            chainId,
            cacheStatus: "HIT",
            error: true,
            durationMs: 0,
          });
          throw new Error(status.error);
        }
      }
      recordRequestStats(c, {
        method: ACTION_TO_RPC_METHOD[actionName] ?? actionName,
        chainId,
        cacheStatus: "HIT",
        error: true,
        durationMs: 0,
      });
      throw new Error("Request timeout");
    }
  }

  const upstreamStart = Date.now();
  try {
    const handler = actionHandlers[actionName];
    const ctx: ActionContext = {
      chainId,
      args,
      env: c.env,
    };

    const result = await handler(ctx as any);
    recordRequestStats(c, {
      method: ACTION_TO_RPC_METHOD[actionName] ?? actionName,
      chainId,
      cacheStatus: "MISS",
      error: false,
      durationMs: Date.now() - upstreamStart,
    });

    await proxyState.fetch(
      new Request(`http://do/requests/${requestHash}/complete`, {
        method: "PUT",
        body: JSON.stringify({ result: JSON.stringify(result) }),
      })
    );

    return { ...result, cacheStatus: "MISS" } as {
      result: T;
      blockNumber?: string;
      cacheStatus: CacheStatus;
    };
  } catch (error) {
    recordRequestStats(c, {
      method: ACTION_TO_RPC_METHOD[actionName] ?? actionName,
      chainId,
      cacheStatus: "MISS",
      error: true,
      durationMs: Date.now() - upstreamStart,
    });
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
 * Handle action requests
 */
export const handleActionRequest = async (c: Context<{ Bindings: Env }>) => {
  try {
    const { chainId, actionName } = c.req.param();

    // Reject unsupported chain IDs before any Durable Object is created:
    // each unique `chain-${chainId}` name provisions a distinct PROXY_STATE
    // instance, so unvalidated IDs let outsiders mint DO instances at will.
    const chainIdNum = parseChainIdParam(chainId);
    if (chainIdNum === null) {
      return c.json(
        {
          error: {
            code: -32602,
            message: `Unsupported chain ID: ${chainId}`,
          },
        },
        400
      );
    }

    const args = await c.req.json();

    // Validate action name
    if (!(actionName in actionHandlers)) {
      return c.json(
        {
          error: {
            code: -32601,
            message: `Unknown action: ${actionName}`,
          },
        },
        400
      );
    }

    const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
    const result = await executeWithDeduplication(
      c,
      chainIdNum,
      actionName as ActionName,
      args
    );

    const rpcMethod = ACTION_TO_RPC_METHOD[actionName] ?? actionName;
    const cacheStrategy = getCacheStrategy(
      chainIdNum,
      rpcMethod,
      args,
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
    console.error("Action request error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          ...responseErrorMessage(error),
          ...(isDebug ? { data: error instanceof Error ? error.message : "Unknown error" } : {}),
        },
      },
      500
    );
  }
};
