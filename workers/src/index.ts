import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import type { Env } from "./types";
import {
  handleCompressedRequest,
  handleHashReferenceRequest,
  handleStoreParams,
  handleDirectRequest,
} from "./handlers/proxy";
import { handleActionRequest } from "./handlers/actions";
import { handleBatchRequest } from "./handlers/batch";
import { setCustomRpcUrls, setMaxRpcConcurrency } from "./actions/utils";
import { resolveTraceId } from "./utils/cache";
import {
  aggregatePeriods,
  DEFAULT_STATS_HOURS,
  MAX_STATS_HOURS,
  STATISTICS_DO_NAME,
  type StatsSummary,
} from "./utils/statistics";

export { ProxyState } from "./durable-objects/proxy-state";
export { Statistics } from "./durable-objects/statistics";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Param-Hash", "X-Original-Params", "X-API-Key"],
  })
);

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

app.use("/api/*", async (c, next) => {
  const rpcUrlsJson = c.env.RPC_URLS;
  if (rpcUrlsJson) {
    try {
      setCustomRpcUrls(JSON.parse(rpcUrlsJson));
    } catch {
      // ignore parse errors, use defaults
    }
  }

  const maxConcurrency = c.env.MAX_RPC_CONCURRENCY;
  if (maxConcurrency) {
    const limit = Number(maxConcurrency);
    if (Number.isInteger(limit) && limit > 0) {
      setMaxRpcConcurrency(limit);
    }
  }

  const apiKey = c.env.API_KEY;
  if (apiKey) {
    const provided = c.req.header("X-API-Key") ?? c.req.query("key");
    if (provided !== apiKey) {
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

// Action-based requests (modular actions)
app.post("/api/v1/:chainId/:actionName", handleActionRequest);

// Compressed parameter requests (GET for CDN caching)
app.get("/api/v1/:chainId/:method", handleCompressedRequest);

// Hash reference requests
app.get("/api/v1/cached/:cacheKey", handleHashReferenceRequest);

// Parameter storage
app.post("/api/v1/store", handleStoreParams);

// Direct requests
app.post("/api/v1/direct/:chainId/:method", handleDirectRequest);

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
