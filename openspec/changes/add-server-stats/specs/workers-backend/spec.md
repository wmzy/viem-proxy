# Delta: Server-Side Performance Statistics

## ADDED Requirements

### Requirement: Server-Side Request Statistics Storage
The Worker SHALL record every proxied request it handles into hourly buckets persisted by a dedicated `Statistics` Durable Object, keyed by `(method, chain_id, cache_status, period_bucket)` and storing `count`, `error_count`, `total_ms` and the most recent 200 upstream latency samples per bucket. Statistics writes SHALL be fire-and-forget: a write failure (missing binding, DO error, serialization failure) MUST NOT fail, delay, or alter the proxied response.

#### Scenario: Upstream call recorded as MISS with duration
```typescript
// POST /api/v1/direct/1/eth_getBalance with a healthy upstream
// -> one record reaches the Statistics DO:
{ method: "eth_getBalance", chainId: 1, cacheStatus: "MISS", error: false, durationMs: >= 0 }
```

#### Scenario: Dedup hit recorded as HIT without upstream duration
```typescript
// The DO dedup store already holds a completed result:
// upstream fetch is never called, and the record carries cacheStatus "HIT",
// durationMs 0, error false
```

#### Scenario: Statistics write failure never breaks the request
```typescript
// STATISTICS namespace whose idFromName() throws:
// POST /api/v1/direct/1/eth_getBalance still returns 200 with the RPC result
```

### Requirement: Cache-Status Semantics Boundary
Cache status recorded by the Worker SHALL reflect only the Worker-level serving decision: `HIT` when the response was served from the Worker's own dedup store without an upstream call, `MISS` when an upstream RPC call was executed. CDN cache hits SHALL NOT be observable in Worker-side statistics because the Worker is never invoked for them; true CDN HIT statistics SHALL be sourced from client-side metrics or CDN layer logs.

#### Scenario: CDN hits are invisible to the Worker
```typescript
// A response served by the Cloudflare CDN cache never executes the Worker,
// so no record is written; the server-side cacheHitRate only measures
// Worker-level (DO dedup) hits, and the proposal documents this boundary.
```

### Requirement: Statistics Query Endpoint
`GET /api/v1/stats` SHALL return aggregated statistics from the `Statistics` Durable Object with optional `chainId`, `method` and `hours` (default 24, max 720) query filters. The response SHALL contain `periods: [{ bucket, count, errorCount, p50, p95, p99 }]` sorted ascending by hourly bucket plus the summary fields `totalRequests`, `cacheHitRate`, `averageResponseTime` and `errorRate` (the fields of the previous stub response), with percentiles computed by nearest rank from the stored latency samples. Invalid `hours` or `chainId` values SHALL be rejected with HTTP 400.

#### Scenario: Aggregated periods with percentiles
```typescript
// After recording two eth_getBalance upstream calls (10ms, 20ms) in one hour:
const body = await GET "/api/v1/stats"
body.periods[0] // { bucket: "<hour>", count: 2, errorCount: 0, p50: 10, p95: 20, p99: 20 }
body.totalRequests // 2
```

#### Scenario: Filters are forwarded to the DO
```typescript
const res = await GET "/api/v1/stats?chainId=1&method=eth_getBalance&hours=48"
// the Statistics DO receives /stats?chainId=1&method=eth_getBalance&hours=48
// and only matching rows are aggregated
```

#### Scenario: Invalid parameters rejected
```typescript
await GET "/api/v1/stats?hours=abc" // 400
await GET "/api/v1/stats?chainId=x" // 400
```

### Requirement: Proxy Response Observability Headers
Every proxied response SHALL carry an `X-Cache: HIT|MISS` header reflecting the Worker-level cache decision (HIT only when served from the Worker's dedup store, MISS otherwise, including error responses) and an `X-Trace-Id` header that echoes the incoming `X-Trace-Id` request header when present and is a generated 12-hex-character id otherwise. These headers SHALL be additive and SHALL NOT change response caching behavior.

#### Scenario: Trace id echoed when provided
```typescript
const res = await fetch(url, { headers: { "X-Trace-Id": "trace-echo-1" } })
res.headers.get("X-Trace-Id") // "trace-echo-1"
```

#### Scenario: Trace id generated and X-Cache defaulted
```typescript
const res = await POST "/api/v1/direct/1/eth_getBalance" // no trace header
res.headers.get("X-Trace-Id") // matches /^[0-9a-f]{12}$/
res.headers.get("X-Cache") // "MISS" (upstream executed)
```

#### Scenario: Dedup hit surfaces X-Cache HIT
```typescript
const res = await GET "/api/v1/1/eth_getBalance?p=..." // dedup store hit
res.headers.get("X-Cache") // "HIT"
```
