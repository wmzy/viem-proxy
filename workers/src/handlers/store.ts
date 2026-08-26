import { type Context } from "hono";
import type { Env } from "../types";
import { generateParamHash } from "../utils/compression";

/**
 * Parameter storage for the large-parameter hash-reference flow.
 *
 * POST /api/v1/store  body {"hash": "<sha256-hex>", "params": "<json-string>"}
 *
 * The server re-computes the digest and rejects mismatches, so a stored
 * mapping is always a faithful hash→content binding — a caller can trust
 * that `GET /api/v1/cached/{chainId}:{method}:{hash}` executes exactly the
 * params whose hash it holds, and abuse of the store as a KV dump requires
 * preimages, not arbitrary pairs.
 */

/** Upper bound on the stored params payload (32 KiB). */
export const MAX_STORED_PARAM_BYTES = 32 * 1024;

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export const handleStoreRequest = async (c: Context<{ Bindings: Env }>) => {
  let body: { hash?: unknown; params?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: -32600, message: "Invalid JSON body" } },
      400
    );
  }

  const { hash, params } = body;
  if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) {
    return c.json(
      {
        error: {
          code: -32602,
          message: "hash must be a lowercase SHA-256 hex digest",
        },
      },
      400
    );
  }
  if (typeof params !== "string") {
    return c.json(
      { error: { code: -32602, message: "params must be a JSON string" } },
      400
    );
  }
  if (params.length > MAX_STORED_PARAM_BYTES) {
    return c.json(
      {
        error: {
          code: -32602,
          message: `params exceeds the ${MAX_STORED_PARAM_BYTES}-byte limit`,
        },
      },
      413
    );
  }

  // Enforce the hash↔content binding before anything is stored.
  const computed = await generateParamHash(params);
  if (computed !== hash) {
    return c.json(
      { error: { code: -32602, message: "hash does not match params" } },
      400
    );
  }

  // The consuming endpoint parses this back into an object/array; reject
  // scalars up front so the store only ever holds shapes it can serve.
  let parsed: unknown;
  try {
    parsed = JSON.parse(params);
  } catch {
    return c.json(
      { error: { code: -32602, message: "params must be valid JSON" } },
      400
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    return c.json(
      {
        error: {
          code: -32602,
          message: "params must encode a JSON object or array",
        },
      },
      400
    );
  }

  const stub = c.env.PARAM_STORE.get(c.env.PARAM_STORE.idFromName("global"));
  await stub.fetch(
    new Request("http://do/params", {
      method: "PUT",
      body: JSON.stringify({ hash, params }),
    })
  );

  return c.json({ stored: true });
};
