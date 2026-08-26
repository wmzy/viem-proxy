import type { Context } from "hono";
import type { Env } from "../types";
import { getRpcUrls, getSupportedChainIds } from "../actions/utils";
import { parseRateLimitPerMinute } from "../utils/rate-limit";

/**
 * Service version reported by GET /api/v1/health. Kept in sync with the
 * `version` field in workers/package.json (also duplicated by the `GET /`
 * stub). Not imported from package.json: a JSON import would leak the whole
 * manifest into the bundle when a constant is all that is needed.
 */
export const SERVICE_VERSION = "0.2.0";

/** Upper bound on chains probed in deep mode (`?deep=1`). */
export const HEALTH_DEEP_MAX_CHAINS = 5;

/** Timeout for each upstream probe in deep mode. */
export const HEALTH_DEEP_TIMEOUT_MS = 2500;

export type ChainHealth = {
  chainId: number;
  /** Number of configured upstream RPC URLs. Full URLs are never exposed. */
  upstreams: number;
};

export type DeepChainCheck = {
  chainId: number;
  ok: boolean;
  /** Round-trip latency in ms; null when the probe failed outright. */
  latencyMs: number | null;
};

export type HealthResponse = {
  status: "ok" | "degraded";
  version: string;
  environment: string | undefined;
  chains: ChainHealth[];
  durableObjects: {
    proxyState: boolean;
    statistics: boolean;
    paramStore: boolean;
  };
  rateLimit: { enabled: boolean; limitPerMinute: number };
  deep?: { checked: number; chains: DeepChainCheck[] };
};

/**
 * Effective rate-limit configuration derived from the same parser the
 * middleware enforces (utils/rate-limit.ts), so the reported value can
 * never contradict what is enforced: unset/invalid → default (enabled,
 * 60), "0" → disabled.
 */
export const parseRateLimit = (
  raw: string | undefined
): { enabled: boolean; limitPerMinute: number } => {
  const limitPerMinute = parseRateLimitPerMinute(raw);
  return { enabled: limitPerMinute > 0, limitPerMinute };
};

/**
 * Probe one chain's first upstream with a cheap eth_chainId call. Bypasses
 * the per-chain concurrency queue on purpose (health checks must not
 * displace real traffic) and never throws: timeout/failure degrades to
 * `ok: false`.
 */
const probeUpstream = async (chainId: number): Promise<DeepChainCheck> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_DEEP_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(getRpcUrls(chainId)[0], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: controller.signal,
    });
    // Drain the body so the connection can be reused, ignoring body errors.
    await response.arrayBuffer().catch(() => undefined);
    return { chainId, ok: response.ok, latencyMs: Date.now() - startedAt };
  } catch {
    return { chainId, ok: false, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * GET /api/v1/health — deployment-facing liveness & configuration snapshot.
 *
 * Cheap by design: no upstream RPC calls unless `?deep=1` is requested
 * (then at most HEALTH_DEEP_MAX_CHAINS chains, each bounded by
 * HEALTH_DEEP_TIMEOUT_MS) so the endpoint cannot be abused to burn upstream
 * quota. The response reports upstream URL counts only — never the URLs,
 * which may embed provider API keys.
 */
export const handleHealthRequest = async (
  c: Context<{ Bindings: Env }>
): Promise<Response> => {
  const chains: ChainHealth[] = getSupportedChainIds().map((chainId) => ({
    chainId,
    upstreams: getRpcUrls(chainId).length,
  }));

  let deepChecks: DeepChainCheck[] | undefined;
  if (c.req.query("deep") === "1") {
    deepChecks = await Promise.all(
      chains
        .slice(0, HEALTH_DEEP_MAX_CHAINS)
        .map(({ chainId }) => probeUpstream(chainId))
    );
  }

  // Degraded when no chain is servable at all, or when deep probing ran and
  // every probed upstream failed. Partial failures keep status "ok": the
  // failover list may still serve traffic through the remaining upstreams.
  const degraded =
    chains.length === 0 ||
    (deepChecks !== undefined &&
      deepChecks.length > 0 &&
      deepChecks.every((check) => !check.ok));

  const body: HealthResponse = {
    status: degraded ? "degraded" : "ok",
    version: SERVICE_VERSION,
    environment: c.env.ENVIRONMENT,
    chains,
    durableObjects: {
      proxyState: Boolean(c.env.PROXY_STATE),
      statistics: Boolean(c.env.STATISTICS),
      paramStore: Boolean(c.env.PARAM_STORE),
    },
    rateLimit: parseRateLimit(c.env.RATE_LIMIT_PER_MINUTE),
    ...(deepChecks !== undefined
      ? { deep: { checked: deepChecks.length, chains: deepChecks } }
      : {}),
  };
  return c.json(body);
};
