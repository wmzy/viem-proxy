# Delta: Origin Allowlist

## ADDED Requirements

### Requirement: Origin Allowlist Enforcement
The Worker SHALL support an `ALLOWED_ORIGINS` env var (comma-separated hosts, `scheme://` prefixes stripped, ports honored, `*.example.com` wildcards matching the apex and all subdomains). When unset or empty, the Worker SHALL behave exactly as before (no Origin check; permissive `Access-Control-Allow-Origin: *`). When set, any request carrying an `Origin` header that does not match the allowlist SHALL be rejected with HTTP 403 and a JSON-RPC error `{ code: -32000, message: "Origin not allowed" }`; requests without an `Origin` header (server-side/mobile callers) SHALL pass through unchanged, remaining protected by `API_KEY` and rate limiting. An allowlist value that parses to zero rules SHALL fail closed (all Origin-carrying requests rejected), mirroring `ALLOWED_CHAIN_IDS`: a broken allowlist must never silently widen access.

#### Scenario: Unset allowlist leaves behavior unchanged
```typescript
// no ALLOWED_ORIGINS in env:
POST "/api/v1/1/getBalance" with Origin: "https://evil.example.net" // 200
response.headers.get("Access-Control-Allow-Origin") // "*" (previous behavior)
OPTIONS "/api/v1/1/getBalance" with Origin: "https://evil.example.net" // 204 + ACAO "*"
```

#### Scenario: Non-matching browser origin rejected with 403 before auth
```typescript
// ALLOWED_ORIGINS = "app.example.com", API_KEY set, no X-API-Key provided:
POST "/api/v1/1/getBalance" with Origin: "https://evil.example.net"
// 403 (not 401: the origin check runs before the auth middleware),
// error.code === -32000, no Access-Control-Allow-Origin header,
// upstream fetch never called
```

#### Scenario: Wildcards match apex and subdomains, not lookalikes
```typescript
// ALLOWED_ORIGINS = "*.example.com":
Origin "https://example.com"        // 200
Origin "https://app.example.com"    // 200
Origin "https://deep.sub.example.com" // 200
Origin "https://notexample.com"     // 403 (suffix collision, not a subdomain)
Origin "https://example.com.evil.net" // 403
```

#### Scenario: Exact match is port-sensitive and scheme-insensitive
```typescript
// ALLOWED_ORIGINS = "https://App.Example.com:8443":
Origin "https://app.example.com:8443" // 200
Origin "https://app.example.com:3000" // 403
```

#### Scenario: Requests without Origin are never blocked
```typescript
// ALLOWED_ORIGINS = "app.example.com":
POST "/api/v1/1/getBalance" with no Origin header // 200 (server-side caller)
```

#### Scenario: Zero-rule allowlist fails closed
```typescript
// ALLOWED_ORIGINS = ", ,":
POST with Origin "https://app.example.com" // 403
POST without Origin                        // 200
```

#### Scenario: Unmatchable origins never match
```typescript
// ALLOWED_ORIGINS = "app.example.com":
POST with Origin "null" (sandboxed iframe) // 403
```

### Requirement: Origin Check Ordering and Exemptions
The origin check middleware SHALL run after the trace middleware (403s carry `X-Trace-Id`/`X-Cache`) and before rate limiting and authentication, so browser abuse is rejected without budget or config work. The check SHALL apply to every path except `ORIGIN_CHECK_EXEMPT_PATHS` (`/dashboard` only — an unauthenticated, read-only operator page that serves no RPC and is needed most while observing a flood); monitoring API endpoints (`/api/v1/stats`, `/api/v1/health`) SHALL NOT be exempt: browsers reach them from allowlisted domains or not at all.

#### Scenario: Monitoring endpoints are guarded; the operator page is not
```typescript
// ALLOWED_ORIGINS = "app.example.com":
GET "/api/v1/stats"  with Origin "https://evil.example.net" // 403
GET "/api/v1/health" with Origin "https://evil.example.net" // 403
GET "/dashboard"     with Origin "https://evil.example.net" // 200 (text/html)
```

### Requirement: Allowlist-Aware CORS Responses
When `ALLOWED_ORIGINS` is set, the CORS layer SHALL echo the matched request origin verbatim in `Access-Control-Allow-Origin` (never `*`) and add `Vary: Origin`; non-matching or absent origins SHALL receive no ACAO header on either actual responses or preflight `OPTIONS` responses, so browsers reject cross-origin reads and preflights from outside the allowlist. When unset, the previous permissive behavior (`*`, no `Vary: Origin`) SHALL be preserved exactly.

#### Scenario: Matching origin echoed with Vary on actual responses
```typescript
// ALLOWED_ORIGINS = "app.example.com":
POST "/api/v1/1/getBalance" with Origin "https://app.example.com"
// 200, ACAO "https://app.example.com", Vary includes "Origin"
```

#### Scenario: Preflights echo when matching and stay silent otherwise
```typescript
// ALLOWED_ORIGINS = "app.example.com":
OPTIONS "/api/v1/1/getBalance"
  Origin: "https://app.example.com", Access-Control-Request-Method: "POST"
// 204, ACAO "https://app.example.com", Allow-Methods/Allow-Headers present

OPTIONS "/api/v1/1/getBalance"
  Origin: "https://evil.example.net", Access-Control-Request-Method: "POST"
// 204 but NO Access-Control-Allow-Origin header (browser rejects the preflight)
```
