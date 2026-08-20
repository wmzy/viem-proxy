# Delta: Client-Side Performance Metrics

## ADDED Requirements

### Requirement: Client-Side Metrics Collection
`makeProxyRequest` SHALL record every proxied request into a module-level, resettable metrics collector. Each record SHALL capture the action method, chain id, request strategy (compressed for GET, direct for POST), success/failure, total response time in ms (including retries), and the cache status read from the response `X-Cache` header (`HIT` → hit, `MISS` → miss, absent or network failure → unknown). The collector SHALL aggregate per method and globally: count, errorCount, cacheHits, cacheMisses, strategy counts, and distinct chain ids. Response-time statistics (average, P50/P95/P99, nearest-rank) SHALL be derived from a ring sample of the most recent 200 durations per scope so memory stays bounded. When `debug` is enabled, requests slower than 1000ms SHALL produce a warning carrying the trace id.

#### Scenario: Successful request with X-Cache HIT
```typescript
resetMetrics()
global.fetch = vi.fn().mockResolvedValueOnce({
  headers: new Headers({ "X-Cache": "HIT" }),
  json: () => Promise.resolve({ result: "0x1" }),
})

await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
  endpoint: "https://proxy.example.com",
})

const snapshot = getMetricsCollector().getSnapshot()
// snapshot.totalRequests === 1, snapshot.cacheHits === 1,
// snapshot.cacheHitRate === 1, snapshot.methodStats.getBalance.count === 1,
// snapshot.strategyCounts.compressed === 1, snapshot.chainIds === [1]
```

#### Scenario: Missing X-Cache header recorded as unknown
```typescript
// A response without the header (server-side header not deployed yet)
// counts toward neither cacheHits nor cacheMisses; hit-rate denominator
// only counts explicit HIT/MISS responses
global.fetch = vi.fn().mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) })
// snapshot.cacheHits === 0 && snapshot.cacheMisses === 0
```

#### Scenario: Failed request counted as error
```typescript
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ error: { code: -32000, message: "execution reverted" } }),
})
// makeProxyRequest rejects; snapshot.errorCount === 1, snapshot.errorRate === 1
```

#### Scenario: Slow request warning in debug mode
```typescript
vi.useFakeTimers()
// With 1500ms elapsed before the fetch resolves and debug: true:
// console.warn("[viem-proxy][trace:a1b2c3d4e5f6] getBalance slow request: 1500ms")
```

### Requirement: Percentile Sampling Bounds
The metrics collector SHALL compute response-time statistics from the most recent `maxSamples` (default 200) durations per method and globally using a fixed-capacity ring buffer. Total request counts SHALL keep the full history; only response-time statistics are sampled.

#### Scenario: Ring buffer keeps the most recent samples
```typescript
const collector = createMetricsCollector(3)
for (let i = 1; i <= 5; i++) {
  collector.record({ method: "getBlock", chainId: 1, strategy: "direct",
    success: true, responseTime: i, cacheStatus: "miss" })
}
const snapshot = collector.getSnapshot()
// snapshot.totalRequests === 5 (full history)
// statistics over the last 3 samples (3, 4, 5):
// snapshot.averageResponseTime === 4, responseTimeP50 === 4, P95 === 5, P99 === 5
```

#### Scenario: Default capacity of 200
```typescript
// Recording durations 1..250 keeps 51..250 for statistics:
// totalRequests === 250, averageResponseTime === 150.5,
// responseTimeP50 === 150, responseTimeP95 === 240, responseTimeP99 === 248
```

### Requirement: Cache Stats Extension Methods
The `proxyActions(client)` extension object and `ProxyPublicClient` (from `createPublicClient`) SHALL expose `getCacheStats(): PerformanceMetrics` and `clearCache(): void`. `getCacheStats` SHALL return a synchronous snapshot of the locally collected metrics including total requests, error count/rate, cache hits/misses and hit rate, average and P50/P95/P99 response times, distinct chain ids, strategy counts, and a per-method breakdown. `clearCache` SHALL reset the local metric statistics; it SHALL NOT purge the CDN cache, which requires server-side support to be provided in a later version (documented in code).

#### Scenario: Snapshot reflects live proxy traffic
```typescript
const ext = proxyActions(withProxy(client, { endpoint: "https://proxy.example.com" }))
await ext.getBalance({ address: "0x..." })

const stats = ext.getCacheStats()
// stats.totalRequests === 1, stats.methodStats.getBalance.count === 1
```

#### Scenario: clearCache resets local metrics
```typescript
ext.clearCache()
const stats = ext.getCacheStats()
// stats.totalRequests === 0 && stats.methodStats deep-equals {}
```

#### Scenario: Exposed on createPublicClient clients
```typescript
const client = createPublicClient({ chain: mainnet, proxy: { endpoint: "https://proxy.example.com" } })
// typeof client.getCacheStats === "function" && typeof client.clearCache === "function"
```
