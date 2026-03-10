import { type Context } from "hono";
import type { Env } from "../types";
import { actionHandlers, type ActionName, type ActionContext } from "../actions";
import { getCacheStrategy, setCacheHeaders } from "../utils/cache";
import { generateParamHash } from "../utils/compression";

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
  actionName: string,
  args: unknown
): Promise<string> => {
  const key = `${chainId}:${actionName}:${JSON.stringify(args)}`;
  return generateParamHash(key);
};

/**
 * Execute action with deduplication
 */
const executeWithDeduplication = async <T>(
  c: Context<{ Bindings: Env }>,
  chainId: number,
  actionName: ActionName,
  args: Record<string, unknown>
): Promise<{ result: T; blockNumber?: string }> => {
  const proxyState = getProxyState(c);
  const requestHash = await generateRequestHash(chainId, actionName, args);

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

  // Execute the action
  try {
    const handler = actionHandlers[actionName];
    const ctx: ActionContext = {
      chainId,
      args,
      env: c.env,
    };

    const result = await handler(ctx as any);

    // Mark request as completed
    await proxyState.fetch(
      new Request(`http://do/requests/${requestHash}/complete`, {
        method: "PUT",
        body: JSON.stringify({ result: JSON.stringify(result) }),
      })
    );

    return result as { result: T; blockNumber?: string };
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
 * Handle action requests
 */
export const handleActionRequest = async (c: Context<{ Bindings: Env }>) => {
  try {
    const { chainId, actionName } = c.req.param();
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

    const chainIdNum = parseInt(chainId);
    const result = await executeWithDeduplication(
      c,
      chainIdNum,
      actionName as ActionName,
      args
    );

    // Get cache strategy
    const cacheStrategy = getCacheStrategy(
      chainIdNum,
      actionName,
      args,
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
    console.error("Action request error:", error);
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
