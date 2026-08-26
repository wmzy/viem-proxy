import { type Context } from "hono";
import type { Env } from "../types";
import { parseChainIdParam } from "../actions/utils";
import { resolveTraceId } from "../utils/cache";
import { responseErrorMessage } from "../utils/errors";
import { executeAndRespond } from "./proxy";

/**
 * Hash-referenced large-parameter requests:
 *
 * GET /api/v1/cached/{chainId}:{method}:{paramHash}
 *
 * Resolves the params previously stored via `POST /api/v1/store`, then runs
 * the exact same dispatch/cache pipeline as the compressed-query path. The
 * fixed-length path keeps oversized payloads out of the query string while
 * staying CDN-cacheable.
 */

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export const PARAMS_NOT_FOUND_CODE = -32004;

export const paramsNotFoundResponse = (
  c: Context<{ Bindings: Env }>,
  paramHash: string
) =>
  c.json(
    {
      error: {
        code: PARAMS_NOT_FOUND_CODE,
        message: `Stored params not found for hash ${paramHash}`,
      },
    },
    404
  );

export const handleCachedRequest = async (c: Context<{ Bindings: Env }>) => {
  try {
    const cacheKey = c.req.param("cacheKey");

    // method names never contain ':', but tolerate extra segments by
    // treating everything between chainId and the final hash as the method.
    const parts = cacheKey.split(":");
    if (parts.length < 3) {
      return c.json(
        {
          error: {
            code: -32602,
            message:
              "Malformed cache key; expected {chainId}:{method}:{paramHash}",
          },
        },
        400
      );
    }
    const [chainIdRaw] = parts;
    const paramHash = parts[parts.length - 1];
    const method = parts.slice(1, -1).join(":");

    const chainIdNum = parseChainIdParam(chainIdRaw);
    if (chainIdNum === null) {
      return c.json(
        {
          error: {
            code: -32602,
            message: `Unsupported chain ID: ${chainIdRaw}`,
          },
        },
        400
      );
    }
    if (!HASH_PATTERN.test(paramHash)) {
      return c.json(
        {
          error: {
            code: -32602,
            message: "paramHash must be a lowercase SHA-256 hex digest",
          },
        },
        400
      );
    }

    const stub = c.env.PARAM_STORE.get(
      c.env.PARAM_STORE.idFromName("global")
    );
    const lookup = await stub.fetch(
      new Request(`http://do/params/${paramHash}`)
    );
    const { found, params: paramsStr } = await lookup.json<{
      found: boolean;
      params: string | null;
    }>();

    // A miss here is a normal step of the client flow (probe cached first,
    // store on miss), so it gets a dedicated code clients can branch on.
    if (!found || typeof paramsStr !== "string") {
      return paramsNotFoundResponse(c, paramHash);
    }

    // Stored payloads were validated at write time; treat any parse failure
    // as a miss rather than poisoning the read path with a 500.
    let params: unknown;
    try {
      params = JSON.parse(paramsStr);
    } catch (error) {
      console.error("Corrupt stored params:", error);
      return paramsNotFoundResponse(c, paramHash);
    }

    const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
    return await executeAndRespond(c, chainIdNum, method, params, traceId);
  } catch (error) {
    console.error("Cached request error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          ...responseErrorMessage(error),
          ...(isDebug
            ? { data: error instanceof Error ? error.message : "Unknown error" }
            : {}),
        },
      },
      500
    );
  }
};
