# Change: Add Client-Side Performance Metrics

## Why
The README promises `getCacheStats()`/`clearCache()` extension methods, but the client currently returns hardcoded zero placeholders. There is no visibility into cache hit rate, response-time percentiles (P50/P95/P99), error rate, or per-method call counts — the exact monitoring PRD 3.1 (「性能监控」) requires for the client side.

## What Changes
- Add `src/utils/metrics.ts` with a functional metrics collector: `createMetricsCollector(maxSamples = 200)`, plus module-level `getMetricsCollector()`/`resetMetrics()`. Aggregates per method and globally: `count`, `errorCount`, `cacheHits`, `cacheMisses`, strategy counts, distinct chain ids
- Response-time statistics (average, P50/P95/P99 via nearest-rank percentile) are derived from a ring sample of the most recent 200 durations per scope, keeping memory bounded
- Instrument `makeProxyRequest`: every proxied request records `{method, chainId, strategy, success, responseTime, cacheStatus}`; `cacheStatus` is read from the response `X-Cache` header (`HIT` → hit, `MISS` → miss, absent → unknown — server-side header lands in a later workers task)
- Debug mode warns on slow requests (>1000ms) with the trace id: `[viem-proxy][trace:xxxx] <method> slow request: Nms`
- Extend `MetricsData`/`PerformanceMetrics` types (naming-compatible: existing fields kept, new fields added: `errorCount`, `cacheHits`/`cacheMisses`, `responseTimeP50/P95/P99`, `chainIds`, richer `methodStats` via new `MethodMetrics`) and add `CacheStatus`
- **BREAKING** (signature change of previously placeholder methods): `ProxyPublicClient.getCacheStats()` now returns a synchronous `PerformanceMetrics` snapshot instead of `Promise<{hitRate, totalRequests, cacheHits, cacheMisses}>`; `clearCache()` is now synchronous `void` instead of `Promise<void>`. Both are exposed on the `proxyActions(client)` extension object and on `createPublicClient` clients
- `clearCache()` resets local metric statistics only — purging the CDN cache requires server-side support and will be provided in a later version (documented in code)
- `getMetrics()`/`clearMetrics()` (already in `ProxyPublicClient`) are wired to the same real collector instead of placeholders

## Impact
- Affected specs: new `client-metrics` capability
- Affected code:
  - `src/utils/metrics.ts` — new collector, ring buffer, percentile, `X-Cache` header reader
  - `src/actions/utils.ts` — `makeProxyRequest` instrumentation + `SLOW_REQUEST_MS` debug warning
  - `src/types.ts` — `CacheStatus`, `MethodMetrics`, extended `MetricsData`/`PerformanceMetrics`, updated `ProxyPublicClient`
  - `src/actions/proxyActions.ts`, `src/client.ts` — expose/wire `getCacheStats`/`clearCache` (+ real `getMetrics`/`clearMetrics`)
  - `src/index.ts` — export metrics utilities and new types
  - `src/test/utils.test.ts`, `src/test/client.test.ts`, `src/test/actions.test.ts` — collector unit tests, instrumentation tests, updated signatures
- Not in scope: server-side statistics and CDN cache purge (workers task), README doc updates
