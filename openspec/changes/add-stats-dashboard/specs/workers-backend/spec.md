# Delta: Stats Dashboard

## ADDED Requirements

### Requirement: Stats Dashboard Page
The Worker SHALL expose `GET /dashboard` returning a single self-contained HTML document (`text/html`) that renders `GET /api/v1/stats` in the browser. All styles and scripts SHALL be inline — the document SHALL NOT reference any external script, stylesheet, or other network resource. The page SHALL be served without credentials even when `API_KEY` is configured, and serving it SHALL NOT contact any Durable Object or upstream RPC (the shell carries no data; numbers are fetched browser-side through `/api/v1/stats`, which keeps its own auth and rate-limit rules).

#### Scenario: Serves HTML with rendering hooks
```typescript
const res = await GET "/dashboard"
res.status        // 200
res.headers["content-type"] // contains "text/html"
res.body          // contains id="stats-container", id="stats-chart",
                  // id="stats-table-body", id="summary-cards",
                  // id="auth-hint", id="error-banner", and "/api/v1/stats"
```

#### Scenario: No external network dependencies
```typescript
const html = await GET "/dashboard"
html // matches no <script src=…>, no <link rel=stylesheet …>,
     // and no http(s):// URL reference — fully self-contained
```

#### Scenario: Accessible without credentials
```typescript
// Worker configured with API_KEY: "secret"
const res = await GET "/dashboard" // no X-API-Key header
res.status // 200, text/html
```

#### Scenario: Serving the shell proxies nothing
```typescript
// STATISTICS DO and global fetch instrumented
const res = await GET "/dashboard"
res.status // 200; the DO stub and fetch were never called
```

### Requirement: Dashboard Rendering Features
The dashboard page SHALL render the stats summary (total requests, cache hit rate, error rate, average upstream latency) as cards, the per-hour `periods` as a bar chart switchable across `count` / `errorCount` / `p50` / `p95` / `p99`, and a bucket detail table. The page SHALL provide a 24h/7d window toggle, `chainId` / `method` filter inputs forwarded to the stats endpoint, and an optional 30-second auto-refresh switch. When the stats endpoint responds 401, the page SHALL display a guidance banner explaining that the endpoint is key-protected and SHALL send any operator-supplied key strictly as the `X-API-Key` request header (never in the URL or persistent storage).

#### Scenario: 401 renders guidance, not a blank page
```typescript
// Worker configured with API_KEY, page fetched /api/v1/stats without a key
// the "auth-hint" banner becomes visible with the explanation text
```

#### Scenario: Filters and window are forwarded to the stats endpoint
```typescript
// operator picks 近 7 天, enters chainId=1, method=getBalance
// the browser issues GET /api/v1/stats?hours=168&chainId=1&method=getBalance
```

### Requirement: Dashboard Exemption Registration
The `/dashboard` path SHALL be registered in `PUBLIC_API_PATHS` (`workers/src/utils/auth.ts`) and `RATE_LIMIT_EXEMPT_PATHS` (`workers/src/utils/rate-limit.ts`) as a read-only monitoring surface. This registration is defense-in-depth: the route also sits outside the `/api/*` middleware mount scopes, so the entries guard against future scope changes rather than being the operative exemption. The stats endpoint itself SHALL remain fully authenticated and rate-limited per its existing rules.

#### Scenario: Registered in both monitoring registries
```typescript
PUBLIC_API_PATHS.has("/dashboard")          // true
RATE_LIMIT_EXEMPT_PATHS.has("/dashboard")   // true
```
