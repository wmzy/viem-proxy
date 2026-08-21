import { type Context } from "hono";
import type { Env } from "../types";
import { actionHandlers, type ActionName } from "../actions";
import { isSupportedChainId } from "../actions/utils";
import { executeWithDeduplication } from "./actions";

/** Upper bound on items accepted in one batch request. */
export const MAX_BATCH_SIZE = 50;

/** One item of a batch request body. */
export type BatchItem = {
  id: string | number;
  chainId: number;
  action: string;
  args?: Record<string, unknown>;
};

/** One entry of a batch response; `result` or `error` is present. */
export type BatchItemResult = {
  id: string | number;
  result?: unknown;
  blockNumber?: string;
  error?: { code: number; message: string };
};

const isBatchItem = (value: unknown): value is BatchItem => {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (typeof item.id === "string" || typeof item.id === "number") &&
    typeof item.chainId === "number" &&
    Number.isInteger(item.chainId) &&
    typeof item.action === "string"
  );
};

/**
 * Handle batch action requests: POST /api/v1/batch with
 * `{ requests: [{ id, chainId, action, args }] }` (max 50 items).
 *
 * Every item is executed through the same path as the single-action route
 * (deduplication + action handler + stats) and isolated per item: a failing
 * item yields an `error` entry while the rest of the batch still resolves.
 *
 * Batch requests are POST and therefore never hit the CDN cache — that is
 * an intentional trade-off; caching remains the single-request GET path's
 * responsibility.
 */
export const handleBatchRequest = async (c: Context<{ Bindings: Env }>) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: -32600, message: "Invalid JSON body" } },
      400
    );
  }

  const requests = (body as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(requests) || requests.length === 0) {
    return c.json(
      {
        error: { code: -32602, message: "requests must be a non-empty array" },
      },
      400
    );
  }
  if (requests.length > MAX_BATCH_SIZE) {
    return c.json(
      {
        error: {
          code: -32602,
          message: `Batch size ${requests.length} exceeds limit of ${MAX_BATCH_SIZE}`,
        },
      },
      400
    );
  }
  for (let i = 0; i < requests.length; i++) {
    if (!isBatchItem(requests[i])) {
      return c.json(
        {
          error: {
            code: -32602,
            message: `Invalid batch item at index ${i} (expected { id, chainId, action, args? })`,
          },
        },
        400
      );
    }
  }

  const items = requests as BatchItem[];

  const results: BatchItemResult[] = await Promise.all(
    items.map(async (item): Promise<BatchItemResult> => {
      // Validate before executing: an unsupported chain ID must never reach
      // executeWithDeduplication, which provisions a Durable Object per
      // unique `chain-${chainId}` name.
      if (!isSupportedChainId(item.chainId)) {
        return {
          id: item.id,
          error: {
            code: -32602,
            message: `Unsupported chain ID: ${item.chainId}`,
          },
        };
      }
      if (!(item.action in actionHandlers)) {
        return {
          id: item.id,
          error: { code: -32601, message: `Unknown action: ${item.action}` },
        };
      }
      try {
        const executed = await executeWithDeduplication(
          c,
          item.chainId,
          item.action as ActionName,
          item.args ?? {}
        );
        return {
          id: item.id,
          result: executed.result,
          ...(executed.blockNumber !== undefined
            ? { blockNumber: executed.blockNumber }
            : {}),
        };
      } catch (error) {
        return {
          id: item.id,
          error: {
            code: -32603,
            message:
              error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    })
  );

  // POST is never CDN-cached; state it explicitly.
  c.header("Cache-Control", "no-store");
  return c.json({ results });
};
