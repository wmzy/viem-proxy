import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import type { Env } from "./types";
import {
  handleCompressedRequest,
  handleDirectRequest,
} from "./handlers/proxy";
import { handleActionRequest } from "./handlers/actions";
import { handleBatchRequest } from "./handlers/batch";
import { handleStoreRequest } from "./handlers/store";
import { handleCachedRequest } from "./handlers/cached";
import { handleHealthRequest } from "./handlers/health";
import { handlePurgeRequest } from "./handlers/purge";
import { handleDashboardRequest } from "./handlers/dashboard";
import {
  setAllowedChainIds,
  setCustomRpcUrls,
  setMaxRpcConcurrency,
} from "./actions/utils";
import { PUBLIC_API_PATHS, timingSafeEqualString } from "./utils/auth";
import {
  matchOrigin,
  ORIGIN_CHECK_EXEMPT_PATHS,
  parseOriginAllowlist,
} from "./utils/origin";
import { resolveTraceId } from "./utils/cache";
import {
  parseRateLimitPerMinute,
  RATE_LIMIT_EXEMPT_PATHS,
  resolveClientId,
  type RateLimitVerdict,
} from "./utils/rate-limit";
import {
  aggregatePeriods,
  DEFAULT_STATS_HOURS,
  MAX_STATS_HOURS,
  recordRequestStats,
  STATISTICS_DO_NAME,
  type StatsSummary,
} from "./utils/statistics";

export { ProxyState } from "./durable-objects/proxy-state";
export { RateLimiter } from "./durable-objects/rate-limiter";
export { ParamStore } from "./durable-objects/param-store";
export { Statistics } from "./durable-objects/statistics";

const app = new Hono<{ Bindings: Env }>();

// CORS response policy. Default (ALLOWED_ORIGINS unset) is deliberately
// permissive — `Access-Control-Allow-Origin: *` on a read-only,
// credential-free, CDN-cacheable RPC surface — documented to be paired
// with API_KEY and rate limiting. When ALLOWED_ORIGINS is configured the
// allowlist also tightens this layer: a matching Origin is echoed verbatim
// instead of `*` (hono adds `Vary: Origin` so shared caches key per
// origin), and a non-matching or absent Origin gets no ACAO header at all,
// so browsers reject cross-origin reads — and preflights — from outside
// the allowlist before any proxied work happens. hono's cors() only takes
// static options, but the rules come from env, so the configured
// middleware is cached per isolate keyed by the raw var (constant per
// isolate; see parseOriginAllowlist's parse cache).
const corsAllowMethods = ["GET", "POST", "OPTIONS"];
const corsAllowHeaders = ["Content-Type", "X-API-Key"];
const permissiveCors = cors({
  origin: "*",
  allowMethods: corsAllowMethods,
  allowHeaders: corsAllowHeaders,
});
let allowlistCorsCache:
  | { raw: string; handler: ReturnType<typeof cors> }
  | undefined;

// Reject malformed percent-encoding before anything touches the URL: Hono's
// internal query decoding throws URIError on sequences like "%%%", which
// would otherwise bubble to app.onError as a framework-level 500 instead of
// the caller-error 400 the API contract calls for.
app.use("/api/*", async (c, next) => {
  try {
    decodeURIComponent(new URL(c.req.url).search);
  } catch {
    return c.json(
      {
        error: {
          code: -32602,
          message: "Malformed percent-encoding in query string",
        },
      },
      400
    );
  }
  await next();
});

app.use("*", (c, next) => {
  const raw = c.env.ALLOWED_ORIGINS;
  if (raw === undefined || raw === "") return permissiveCors(c, next);

  if (allowlistCorsCache?.raw !== raw) {
    const rules = parseOriginAllowlist(raw);
    allowlistCorsCache = {
      raw,
      handler: cors({
        allowMethods: corsAllowMethods,
        allowHeaders: corsAllowHeaders,
        origin: (origin) => (matchOrigin(rules, origin) ? origin : undefined),
      }),
    };
  }
  return allowlistCorsCache.handler(c, next);
});

app.use("*", logger());
app.use("*", prettyJSON());

// Observability headers on every API response (registered before the auth
// middleware so 401s are covered too): echo or mint an X-Trace-Id and
// default X-Cache to "MISS". Handlers that know the worker-level cache
// decision override these via setCacheHeaders (e.g. dedup hit -> "HIT").
app.use("/api/v1/*", async (c, next) => {
  const traceId = resolveTraceId(c.req.header("X-Trace-Id"));
  await next();

  const headers = new Headers(c.res.headers);
  if (!headers.has("X-Trace-Id")) {
    headers.set("X-Trace-Id", traceId);
  }
  if (!headers.has("X-Cache")) {
    headers.set("X-Cache", "MISS");
  }
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});

// Origin allowlist (browser-scoped abuse guard). Browser requests carry an
// Origin header; server-side/mobile callers never do. When ALLOWED_ORIGINS
// is set, an Origin-carrying request that does not match the allowlist is
// rejected with 403 here — before rate limiting and auth, because browser
// abuse is cheapest to stop at the door (and a leaked-frontend origin
// cannot be revoked via API_KEY). Requests without Origin pass through and
// remain protected by API_KEY + rate limiting. Registered after the trace
// middleware so 403s carry X-Trace-Id/X-Cache like other guards. Only
// ORIGIN_CHECK_EXEMPT_PATHS (/dashboard — the unauthenticated read-only
// operator page) is exempt; API endpoints including /api/v1/stats and
// /api/v1/health are NOT: browsers reach them from allowlisted domains or
// not at all. A 403 here never touches upstream or Durable Objects.
app.use("*", async (c, next) => {
  const rules = parseOriginAllowlist(c.env.ALLOWED_ORIGINS);
  if (rules === null || ORIGIN_CHECK_EXEMPT_PATHS.has(c.req.path)) {
    return next();
  }
  const origin = c.req.header("Origin");
  if (origin === undefined || origin === "" || matchOrigin(rules, origin)) {
    return next();
  }
  return c.json(
    { error: { code: -32000, message: "Origin not allowed" } },
    403
  );
});

// Per-IP rate limiting on the proxied API surface, enforced by the
// RateLimiter Durable Object (fixed 60s windows, one instance per client)
// so the budget is accurate across isolates and PoPs — an isolate-local
// counter would undercount. Registered BEFORE the auth middleware on
// purpose: it is the outermost abuse guard, so floods of unauthenticated
// or invalid-key requests are rejected without any config/auth work, and
// those 401s still consume the attacker's own per-IP budget. Read-only
// monitoring endpoints (RATE_LIMIT_EXEMPT_PATHS: /api/v1/stats,
// /api/v1/health) are exempt so an operator can always observe a flood.
// Fails open: limiting is a protection add-on, never a hard dependency.
app.use("/api/v1/*", async (c, next) => {
  const limit = parseRateLimitPerMinute(c.env.RATE_LIMIT_PER_MINUTE);
  if (limit === 0 || !c.env.RATE_LIMITER) {
    // Disabled by config, or the binding is missing (misconfiguration).
    return next();
  }
  if (RATE_LIMIT_EXEMPT_PATHS.has(c.req.path)) return next();

  const clientId = resolveClientId(c.req.header("CF-Connecting-IP"));
  const stub = c.env.RATE_LIMITER.get(c.env.RATE_LIMITER.idFromName(clientId));

  let verdict: RateLimitVerdict | undefined;
  try {
    const response = await stub.fetch(
      new Request(`http://rate-limiter/consume?limit=${limit}`)
    );
    if (response.ok) {
      verdict = await response.json<RateLimitVerdict>();
    }
  } catch {
    // DO unreachable: fail open.
  }
  if (verdict === undefined || verdict.allowed) return next();

  // Rejected requests are never successes: record them as errors under the
  // "rate_limit" method (filterable via GET /api/v1/stats?method=rate_limit).
  recordRequestStats(c, {
    method: "rate_limit",
    chainId: 0,
    cacheStatus: "MISS",
    error: true,
    durationMs: 0,
  });

  return c.json(
    {
      error: {
        code: -32005,
        message: "Rate limit exceeded",
        data: { retryAfterSeconds: verdict.retryAfterSeconds },
      },
    },
    429,
    { "Retry-After": String(verdict.retryAfterSeconds) }
  );
});

app.use("/api/*", async (c, next) => {
  const rpcUrlsJson = c.env.RPC_URLS;
  if (rpcUrlsJson) {
    try {
      setCustomRpcUrls(JSON.parse(rpcUrlsJson));
    } catch {
      // ignore parse errors, use defaults
    }
  }

  // Optional explicit chain allowlist. When ALLOWED_CHAIN_IDS is unset,
  // every chain with a configured upstream RPC URL (DEFAULT_RPC_URLS ∪
  // RPC_URLS) is servable; when set, only the listed IDs are. Unparseable
  // entries are dropped, so an allowlist that parses to nothing serves
  // nothing — fail closed rather than silently widening access.
  const allowedChainIdsRaw = c.env.ALLOWED_CHAIN_IDS;
  if (allowedChainIdsRaw) {
    const ids = new Set<number>();
    for (const part of allowedChainIdsRaw.split(",")) {
      const id = Number.parseInt(part.trim(), 10);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
    setAllowedChainIds(ids);
  } else {
    setAllowedChainIds(null);
  }

  const maxConcurrency = c.env.MAX_RPC_CONCURRENCY;
  if (maxConcurrency) {
    const limit = Number(maxConcurrency);
    if (Number.isInteger(limit) && limit > 0) {
      setMaxRpcConcurrency(limit);
    }
  }

  // Authentication: the X-API-Key header only. Query-string keys (`?key=`)
  // are deliberately not accepted — they would leak into CDN cache keys and
  // access logs. The comparison is constant-time so response latency does
  // not reveal the expected key. Paths in PUBLIC_API_PATHS (health & co.)
  // stay credential-free so uptime monitors can probe the service.
  const apiKey = c.env.API_KEY;
  if (apiKey && !PUBLIC_API_PATHS.has(c.req.path)) {
    const provided = c.req.header("X-API-Key");
    if (provided === undefined || !timingSafeEqualString(provided, apiKey)) {
      return c.json(
        { error: { code: -32600, message: "Unauthorized" } },
        401
      );
    }
  }

  await next();
});

app.get("/", (c) => {
  return c.json({
    name: "viem-proxy-workers",
    version: "0.2.0",
    status: "healthy",
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
    features: ["durable-objects", "request-deduplication", "function-proxy"],
  });
});

// Batch action requests (POST: never CDN-cached by design; per-item
// isolation with the same dedup/stats path as single actions)
app.post("/api/v1/batch", handleBatchRequest);

// Parameter storage for the large-parameter hash-reference flow
app.post("/api/v1/store", handleStoreRequest);

// Hash-referenced large-parameter requests (GET for CDN caching). Must be
// registered before the `/:chainId/:method` wildcard below, which would
// otherwise capture `cached` as a chain ID.
app.get("/api/v1/cached/:cacheKey", handleCachedRequest);

// Action-based requests (modular actions)
app.post("/api/v1/:chainId/:actionName", handleActionRequest);

// Compressed parameter requests (GET for CDN caching)
app.get("/api/v1/:chainId/:method", handleCompressedRequest);

// Direct requests
app.post("/api/v1/direct/:chainId/:method", handleDirectRequest);

// Health endpoint: unauthenticated liveness & configuration snapshot for
// deployers and uptime monitors. Reports upstream URL counts only (never
// the URLs) and performs no upstream RPC calls unless `?deep=1` probes at
// most 5 chains with a per-probe timeout. Exempt from the API key via
// PUBLIC_API_PATHS; not recorded in statistics (it proxies nothing).
app.get("/api/v1/health", handleHealthRequest);

// Cache purge: an admin operation, so it deliberately does NOT join the
// PUBLIC_API_PATHS / RATE_LIMIT_EXEMPT_PATHS exemptions — with API_KEY
// configured it is authenticated (401 without a valid key) and always
// charged against the caller's rate-limit budget. Without API_KEY the
// handler refuses with 501 rather than running unauthenticated.
app.post("/api/v1/purge", handlePurgeRequest);

// Stats endpoint: aggregated server-side statistics from the Statistics DO.
// Supports ?chainId=&method=&hours= (hours defaults to 24, max 720).
// The response keeps the previous stub shape (totalRequests, cacheHitRate,
// averageResponseTime, errorRate) and adds cacheHits/errorCount/periods.
app.get("/api/v1/stats", async (c) => {
  const chainIdParam = c.req.query("chainId");
  const methodParam = c.req.query("method");
  const hoursParam = c.req.query("hours");

  let hours = DEFAULT_STATS_HOURS;
  if (hoursParam !== undefined) {
    hours = Number(hoursParam);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_STATS_HOURS) {
      return c.json(
        {
          error: {
            code: -32602,
            message: `Invalid hours (expected integer between 1 and ${MAX_STATS_HOURS})`,
          },
        },
        400
      );
    }
  }

  let chainId: number | undefined;
  if (chainIdParam !== undefined && chainIdParam !== "") {
    chainId = Number(chainIdParam);
    if (!Number.isInteger(chainId) || chainId < 0) {
      return c.json(
        {
          error: {
            code: -32602,
            message: "Invalid chainId (expected non-negative integer)",
          },
        },
        400
      );
    }
  }

  const method =
    methodParam !== undefined && methodParam.length > 0 ? methodParam : undefined;

  if (!c.env.STATISTICS) {
    // Binding not configured: return a well-formed empty summary.
    return c.json(aggregatePeriods([]));
  }

  const stub = c.env.STATISTICS.get(
    c.env.STATISTICS.idFromName(STATISTICS_DO_NAME)
  );
  const url = new URL("http://statistics/stats");
  if (chainId !== undefined) url.searchParams.set("chainId", String(chainId));
  if (method !== undefined) url.searchParams.set("method", method);
  url.searchParams.set("hours", String(hours));

  try {
    const response = await stub.fetch(new Request(url.toString()));
    if (!response.ok) {
      return c.json(
        { error: { code: -32603, message: "Statistics unavailable" } },
        502
      );
    }
    return c.json(await response.json<StatsSummary>());
  } catch {
    return c.json(
      { error: { code: -32603, message: "Statistics unavailable" } },
      502
    );
  }
});

// Dashboard page: a single inline-HTML monitoring UI over /api/v1/stats
// (summary cards, per-hour bar chart, bucket table, filters, auto-refresh).
// The shell itself carries no data and stays credential-free — every number
// is fetched browser-side through the stats endpoint, which keeps its own
// auth and rate-limit rules. Registered in PUBLIC_API_PATHS and
// RATE_LIMIT_EXEMPT_PATHS as a read-only monitoring surface; the path also
// sits outside the /api/* middleware scopes, so those entries are defensive.
app.get("/dashboard", handleDashboardRequest);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  const isDebug = c.env.ENVIRONMENT !== "production";
  return c.json(
    {
      error: {
        code: -32603,
        message: "Internal server error",
        ...(isDebug ? { data: err.message } : {}),
      },
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: -32601,
        message: "Method not found",
      },
    },
    404
  );
});

export default app;
