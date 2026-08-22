import { type Context } from "hono";
import type { Env } from "../types";
import { actionHandlers } from "../actions";
import { compressParams, generateParamHash } from "../utils/compression";

/**
 * Cache purge: POST /api/v1/purge
 *
 * Administrative cache invalidation. Two granularities:
 * - `{ chainId }` — clears the whole Durable Object dedup store for that
 *   chain. CDN (Cache API) entries cannot be enumerated, so nothing is
 *   deleted from the colo cache at this granularity (disclosed in the
 *   response limitations).
 * - `{ requests: [{ chainId, action, args }] }` — reconstructs the exact
 *   dedup hash and the exact compressed GET URL the client used, then
 *   deletes both the DO record and the colo cache entry.
 *
 * `method`-level purge is deliberately unsupported (400): dedup hashes are
 * opaque SHA-256 digests and Cache API entries cannot be listed, so there
 * is nothing true to report — rejecting is more honest than pretending.
 *
 * Contract with the middleware chain: NOT in PUBLIC_API_PATHS (requires
 * the API key when one is configured) and NOT rate-limit exempt, because
 * purge is an admin operation, not a read-only monitor.
 */

/** Upper bound on per-call request items, mirroring the batch endpoint */
export const MAX_PURGE_REQUESTS = 50;

const COLO_SCOPE_LIMITATION =
  "caches.default.delete only affects the Cloudflare colo serving this request; entries cached in other PoPs expire by their TTL. Global CDN invalidation requires the zone-level purge API, which is out of scope.";

const CHAIN_ENUMERATION_LIMITATION =
  "chain-level purge clears the Durable Object dedup store only: CDN cache entries cannot be enumerated per chain, so deleting them requires per-request purges (exact URLs).";

export type PurgeRequestItem = {
  chainId?: number;
  action: string;
  args?: Record<string, unknown>;
};

export type PurgeBody = {
  chainId?: number;
  method?: string;
  requests?: PurgeRequestItem[];
};

const getProxyState = (c: Context<{ Bindings: Env }>, chainId: number) => {
  const id = c.env.PROXY_STATE.idFromName(`chain-${chainId}`);
  return c.env.PROXY_STATE.get(id);
};

/** cache.delete() target: the Cache API bound to the worker (absent in Node tests) */
const getColoCache = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default;

/** A resolved, validated purge target: everything needed to rebuild keys */
type PurgeTarget = {
  chainId: number;
  action: string;
  argsJson: string;
};

const resolveTargets = (
  requests: PurgeRequestItem[],
  fallbackChainId: number | undefined
): PurgeTarget[] | string => {
  const targets: PurgeTarget[] = [];
  for (const item of requests) {
    const chainId = item.chainId ?? fallbackChainId;
    if (!Number.isInteger(chainId) || (chainId as number) <= 0) {
      return "Each purge request needs a positive integer chainId (per item or top-level)";
    }
    if (typeof item.action !== "string" || !(item.action in actionHandlers)) {
      return `Unknown action: ${String(item.action)}`;
    }
    targets.push({
      chainId: chainId as number,
      action: item.action,
      argsJson: JSON.stringify(item.args ?? {}),
    });
  }
  return targets;
};

/** Purge specific entries: one DO record + one colo cache entry per item */
const purgeByRequests = async (
  c: Context<{ Bindings: Env }>,
  targets: PurgeTarget[]
) => {
  const cache = getColoCache();
  const origin = new URL(c.req.url).origin;

  let dedup = 0;
  let cacheEntries = 0;

  for (const target of targets) {
    // Same hash the dedup path stores under (handlers/actions.ts):
    // SHA-256 of `${chainId}:${actionName}:${JSON.stringify(args)}`.
    const requestHash = await generateParamHash(
      `${target.chainId}:${target.action}:${target.argsJson}`
    );
    const proxyState = getProxyState(c, target.chainId);
    const response = await proxyState.fetch(
      new Request(`http://do/requests/${requestHash}`, { method: "DELETE" })
    );
    if (!response.ok) {
      throw new Error(`ProxyState DO returned ${response.status}`);
    }
    const { deleted } = await response.json<{ deleted: boolean }>();
    if (deleted) dedup += 1;

    // Same URL the client's compressed GET used, so this must compress
    // exactly like src/utils/compression.ts (client).
    const url =
      `${origin}/api/v1/${target.chainId}/${target.action}` +
      `?p=${compressParams(target.argsJson)}`;
    if (cache && (await cache.delete(new Request(url)))) {
      cacheEntries += 1;
    }
  }

  return c.json({
    purged: { dedup, cache: cacheEntries },
    scope: "colo",
    limitations: [COLO_SCOPE_LIMITATION],
  });
};

/** Purge a whole chain: clear its dedicated ProxyState DO store */
const purgeChain = async (c: Context<{ Bindings: Env }>, chainId: number) => {
  const proxyState = getProxyState(c, chainId);
  const response = await proxyState.fetch(
    new Request("http://do/purge", { method: "POST" })
  );
  if (!response.ok) {
    throw new Error(`ProxyState DO returned ${response.status}`);
  }
  const { deleted } = await response.json<{ deleted: number }>();

  return c.json({
    purged: { dedup: deleted, cache: 0 },
    scope: "colo",
    limitations: [COLO_SCOPE_LIMITATION, CHAIN_ENUMERATION_LIMITATION],
  });
};

export const handlePurgeRequest = async (c: Context<{ Bindings: Env }>) => {
  // Refuse to run unauthenticated: the auth middleware only enforces the
  // key when API_KEY is configured, so without one this admin endpoint
  // would be a public cache-wipe button. Disabled with guidance instead.
  if (!c.env.API_KEY) {
    return c.json(
      {
        error: {
          code: -32601,
          message:
            "Purge is disabled: set the API_KEY environment variable to enable POST /api/v1/purge. Without an API key this admin endpoint would be open to anyone.",
        },
      },
      501
    );
  }

  let body: PurgeBody;
  try {
    body = (await c.req.json()) as PurgeBody;
  } catch {
    return c.json(
      { error: { code: -32602, message: "Invalid JSON body" } },
      400
    );
  }

  const { chainId, method, requests } = body ?? {};

  if (method !== undefined) {
    return c.json(
      {
        error: {
          code: -32602,
          message:
            "Method-level purge is not supported: dedup hashes are opaque SHA-256 digests and Cache API entries cannot be enumerated by method. Purge a whole chain (chainId only) or list explicit requests.",
        },
      },
      400
    );
  }

  try {
    if (Array.isArray(requests) && requests.length > 0) {
      if (requests.length > MAX_PURGE_REQUESTS) {
        return c.json(
          {
            error: {
              code: -32602,
              message: `Too many purge requests (${requests.length}); limit is ${MAX_PURGE_REQUESTS}`,
            },
          },
          400
        );
      }

      const targets = resolveTargets(requests, chainId);
      if (typeof targets === "string") {
        return c.json({ error: { code: -32602, message: targets } }, 400);
      }
      return await purgeByRequests(c, targets);
    }

    if (chainId !== undefined) {
      if (!Number.isInteger(chainId) || chainId <= 0) {
        return c.json(
          {
            error: {
              code: -32602,
              message: "Invalid chainId (expected positive integer)",
            },
          },
          400
        );
      }
      return await purgeChain(c, chainId);
    }
  } catch (error) {
    console.error("Purge request error:", error);
    const isDebug = c.env.ENVIRONMENT !== "production";
    return c.json(
      {
        error: {
          code: -32603,
          message: "Purge failed: Durable Object unavailable",
          ...(isDebug
            ? { data: error instanceof Error ? error.message : "Unknown error" }
            : {}),
        },
      },
      502
    );
  }

  return c.json(
    {
      error: {
        code: -32602,
        message:
          "Nothing to purge: provide `chainId` (whole chain) or `requests: [{ chainId, action, args }]` (specific entries)",
      },
    },
    400
  );
};
