# Change: Add Server-Side Performance Statistics

## Why
PRD 3.1 (「性能监控」) requires server-side visibility: request counts, cache hit/miss, error counts and upstream RPC latency percentiles (P50/P95/P99) per method and chain. `GET /api/v1/stats` currently returns hardcoded zeros (`TODO: Implement stats from DO`), and proxy responses carry no `X-Cache`/`X-Trace-Id` headers even though the client metrics feature (add-client-metrics) already reads `X-Cache` from every response.

## What Changes
- New `Statistics` Durable Object (`workers/src/durable-objects/statistics.ts`) persisting hourly buckets in SQLite: `statistics(method, chain_id, cache_status, period_bucket, count, error_count, total_ms, samples)` with `cache_status` added as a key dimension so Worker-visible hits (DO dedup) are distinguishable from upstream calls; `samples` keeps the most recent 200 upstream latencies per bucket; a daily alarm purges buckets older than 30 days
- **Why a separate DO instead of extending `ProxyState`**: `ProxyState` is sharded per chain (`chain-${chainId}`), so cross-chain stats queries would require a fan-out across shards; statistics also have different write volume, retention and failure-isolation concerns than the dedup hot path. A single global instance (`STATISTICS_DO_NAME = "global"`) keeps aggregation in one query
- Request handlers (`workers/src/handlers/proxy.ts`, `workers/src/handlers/actions.ts`) record every proxied request fire-and-forget: `method`, `chainId`, `cacheStatus`, `error`, upstream `durationMs`. Writes use `waitUntil` when available and are fully swallowed on failure — a broken statistics path can never fail or delay a proxied request. Action names are mapped to their RPC method (`getBalance` → `eth_getBalance`) for a uniform `eth_*` method dimension
- **Cache-status semantics boundary (by design)**: a CDN cache hit never invokes the Worker at all, so everything the Worker records is either an upstream call (`MISS`) or a Worker-level dedup/cache hit (`HIT`). True CDN HIT statistics must come from client-side metrics (the `X-Cache`/`CF-Cache-Status` observed by add-client-metrics) or CDN layer logs — the Worker cannot see them
- `GET /api/v1/stats` returns real aggregates with `?chainId=&method=&hours=` filters (hours default 24, max 720): `{ totalRequests, cacheHits, cacheHitRate, averageResponseTime, errorCount, errorRate, periods: [{ bucket, count, errorCount, p50, p95, p99 }] }`. The four fields of the previous stub shape (`totalRequests`, `cacheHitRate`, `averageResponseTime`, `errorRate`) are kept, so the response is a strict superset
- All proxy responses carry `X-Cache: HIT|MISS` (the Worker-level serving decision: HIT = served from the DO dedup store, MISS = upstream executed) and `X-Trace-Id` (echoed from the request header when present — the client already sends one on every request — generated as 12 hex chars otherwise). Implemented via an extended `setCacheHeaders(response, ttl, { cacheStatus, traceId })` plus a middleware fallback that covers error paths and endpoints that bypass `setCacheHeaders`
- Env binding `STATISTICS` (`workers/src/types.ts`) + wrangler migration `v2` with `new_sqlite_classes = ["Statistics"]`; `Statistics` exported from the worker entrypoint

## Impact
- Affected specs: `workers-backend` (new requirements; capability currently only exists in the archive)
- Affected code:
  - `workers/src/utils/statistics.ts` — new pure helpers: `hourBucket`/`bucketCutoff`, nearest-rank `percentile`, `appendSample` (cap 200), `mergeRecord`, `aggregatePeriods`, fire-and-forget `recordRequestStats`
  - `workers/src/durable-objects/statistics.ts` — new DO (hourly SQLite buckets, `POST /record`, `GET /stats`, retention alarm)
  - `workers/src/utils/cache.ts` — `setCacheHeaders` options + `generateTraceId`/`resolveTraceId`
  - `workers/src/handlers/proxy.ts`, `workers/src/handlers/actions.ts` — instrumentation on every request-processing path (dedup hit, dedup failure/timeout, upstream success/failure)
  - `workers/src/index.ts` — real `/api/v1/stats`, observability-header middleware, `Statistics` export
  - `workers/src/types.ts`, `workers/wrangler.toml`, `workers/package.json` (test script)
  - `workers/test/handlers.test.ts` (setCacheHeaders header cases), `workers/test/statistics.test.ts` (new)
- No breaking API changes: `/api/v1/stats` response is a superset of the stub shape; new headers are additive; `setCacheHeaders` third parameter is optional
