## 1. Metrics Collector
- [x] 1.1 Create `src/utils/metrics.ts`: `createMetricsCollector(maxSamples = 200)`, ring-buffer duration sampling, nearest-rank `percentile`, `getSnapshot`, `reset`
- [x] 1.2 Module-level singleton API: `getMetricsCollector()` / `resetMetrics()`
- [x] 1.3 `readCacheStatus(response)`: `X-Cache` header → hit/miss, absent or unreadable → unknown
- [x] 1.4 Extend `src/types.ts`: `CacheStatus`, `MethodMetrics`, `MetricsData` (+`cacheStatus`/`success`), `PerformanceMetrics` (+`errorCount`, `cacheHits`/`cacheMisses`, `responseTimeP50/P95/P99`, `chainIds`, richer `methodStats`)

## 2. Request Instrumentation
- [x] 2.1 `makeProxyRequest` records `{method, chainId, strategy, success, responseTime, cacheStatus}` on success and failure (duration includes retries; strategy = compressed for GET, direct for POST)
- [x] 2.2 Capture `X-Cache` from the most recent attempt's response; network failures stay unknown
- [x] 2.3 Debug warning for slow requests (>1000ms) with trace id, on success and failure paths

## 3. Extension Methods
- [x] 3.1 `proxyActions` object exposes `getCacheStats(): PerformanceMetrics` and `clearCache(): void`
- [x] 3.2 `ProxyPublicClient` type updated: synchronous `getCacheStats`/`clearCache` (replacing placeholder async signatures)
- [x] 3.3 `createPublicClient` helper methods wired to the real collector (`getCacheStats`, `clearCache`, `getMetrics`, `clearMetrics`); `clearCache` documents the CDN-purge-requires-server constraint
- [x] 3.4 Export metrics utilities and types from `src/index.ts`

## 4. Tests
- [x] 4.1 Collector: per-method/global count, errorCount, cacheHits/cacheMisses aggregation; empty snapshot shape
- [x] 4.2 Percentiles from fixed data (nearest-rank) and ring truncation (capacity 3 and default 200 keeps last samples)
- [x] 4.3 Reset drops all stats; module singleton shared and reset via `resetMetrics`
- [x] 4.4 `makeProxyRequest`: X-Cache HIT/MISS/missing (unknown) recording, error recording, POST/direct strategy counting
- [x] 4.5 Slow-request debug warning (fake timers, 1500ms) and no warning for fast requests
- [x] 4.6 `getCacheStats` structure on client, live stats after proxied request, reset via `clearCache`; exposure on the `proxyActions` extension object

## 5. Verification
- [x] 5.1 `npm run test` all green (213 tests)
- [x] 5.2 `npm run typecheck` clean
- [x] 5.3 `openspec validate add-client-metrics --strict --no-interactive` passes
