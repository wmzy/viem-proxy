# Delta: Per-IP Rate Limiting

## ADDED Requirements

### Requirement: Per-IP Rate Limit Enforcement
The Worker SHALL enforce a per-client request budget on `/api/v1/*` proxy endpoints, counted in fixed 60-second UTC windows by a dedicated `RateLimiter` Durable Object with one instance per client id, so the count is globally accurate across isolates and PoPs (isolate-local counting is not acceptable). The client id SHALL be the `CF-Connecting-IP` request header, falling back to a shared `"unknown"` bucket when the header is absent. The limit SHALL default to 60 requests/minute and be configurable via the `RATE_LIMIT_PER_MINUTE` env var, where the exact value `"0"` disables limiting entirely and unset/empty/invalid/negative values fall back to the default (invalid configuration must never silently disable the guard).

#### Scenario: Over-limit request rejected with 429 and Retry-After
```typescript
// RATE_LIMIT_PER_MINUTE = "2", third POST /api/v1/1/getBalance within one minute
const res = await post()
res.status // 429
res.headers.get("Retry-After") // /^\d+$/, 1..60 (seconds to window rollover)
await res.json() // { error: { code: -32005, message: "Rate limit exceeded", data: { retryAfterSeconds } } }
```

#### Scenario: Budgets are per IP and requests without an IP header share one bucket
```typescript
// RATE_LIMIT_PER_MINUTE = "1": one request each from 198.51.100.1 and 198.51.100.2
// both pass; the second request from each IP is 429
// a request with no CF-Connecting-IP header is charged to "unknown"
```

#### Scenario: Setting "0" disables limiting without touching the Durable Object
```typescript
// RATE_LIMIT_PER_MINUTE = "0": five consecutive requests all pass
// and the RATE_LIMITER namespace is never called
```

### Requirement: Rate Limiting Runs Before Authentication
The rate-limit middleware SHALL execute before the authentication middleware, so unauthenticated or invalid-key floods are rejected without authentication work and those 401 responses still consume the caller's per-IP budget.

#### Scenario: 401 responses consume the caller's budget
```typescript
// RATE_LIMIT_PER_MINUTE = "1", API_KEY set, two requests with a wrong X-API-Key:
// first -> 401, second -> 429 (upstream never called)
```

### Requirement: Monitoring Endpoint Exemption
Read-only monitoring endpoints `/api/v1/stats` and `/api/v1/health` SHALL be exempt from rate limiting so an operator can observe the instance while it is being flooded. Rate-limit exemption SHALL NOT imply auth exemption: these paths remain authenticated when `API_KEY` is configured.

#### Scenario: Stats and health stay available while the proxy surface is exhausted
```typescript
// RATE_LIMIT_PER_MINUTE = "1": after the proxied endpoint returns 429,
GET "/api/v1/stats" // 200
GET "/api/v1/health" // 200
```

### Requirement: Rate-Limit Failure Isolation and 429 Statistics
Rate limiting SHALL fail open: a missing `RATE_LIMITER` binding, an unreachable Durable Object, or a non-OK DO response MUST let the request proceed — limiting is a protection add-on, never a hard dependency of the proxy path. Rejected (429) requests SHALL NOT count as successes in server statistics: each SHALL be recorded to the Statistics Durable Object as an error under `method = "rate_limit"`, `chainId = 0`, keeping `/api/v1/stats` `errorCount`/`errorRate` semantics intact.

#### Scenario: DO failure never blocks a request
```typescript
// RATE_LIMITER stub whose fetch() throws, or returns 500:
POST "/api/v1/1/getBalance" // still 200 (upstream result)
```

#### Scenario: 429 recorded as an error statistic
```typescript
// RATE_LIMIT_PER_MINUTE = "1", STATISTICS binding recording /record calls:
// after one allowed + one rejected request, exactly one record exists with
// { method: "rate_limit", chainId: 0, cacheStatus: "MISS", error: true }
```
