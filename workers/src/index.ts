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
import { setCustomRpcUrls } from "./actions/utils";

export { ProxyState } from "./durable-objects/proxy-state";

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

app.use("/api/*", async (c, next) => {
  const rpcUrlsJson = c.env.RPC_URLS;
  if (rpcUrlsJson) {
    try {
      setCustomRpcUrls(JSON.parse(rpcUrlsJson));
    } catch {
      // ignore parse errors, use defaults
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

// Stats endpoint
app.get("/api/v1/stats", async (c) => {
  // TODO: Implement stats from DO
  return c.json({
    totalRequests: 0,
    cacheHitRate: 0,
    averageResponseTime: 0,
    errorRate: 0,
  });
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
