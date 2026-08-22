# Delta: Health Endpoint

## ADDED Requirements

### Requirement: Health Endpoint
The Worker SHALL expose `GET /api/v1/health` returning a lightweight status and configuration snapshot: `status` ("ok" | "degraded"), `version`, `environment`, `chains` (one `{ chainId, upstreams }` entry per currently servable chain, sorted ascending), `durableObjects` (binding availability booleans), and `rateLimit` (`{ enabled, limitPerMinute }`). The endpoint SHALL require no authentication even when `API_KEY` is configured, SHALL emit no statistics record, and SHALL perform no upstream RPC calls in the default (shallow) mode.

#### Scenario: Default lightweight response
```typescript
const body = await GET "/api/v1/health"
body.status    // "ok"
body.version   // semantic version string matching workers/package.json
body.chains    // [{ chainId: 1, upstreams: 3 }, ...] sorted ascending by chainId
body.durableObjects // { proxyState: true, statistics: <binding presence> }
body.rateLimit // { enabled: true, limitPerMinute: 60 }
// global fetch was never called: shallow mode is free
```

#### Scenario: Accessible without credentials
```typescript
// Worker configured with API_KEY: "secret"
const res = await GET "/api/v1/health" // no X-API-Key header
res.status // 200, body.status === "ok"
```

#### Scenario: Upstream URLs are never disclosed
```typescript
// RPC_URLS: '{"1":["https://secret.example/v2/key-do-not-leak"]}'
const body = await GET "/api/v1/health"
body.chains // [{ chainId: 1, upstreams: 1 }]
JSON.stringify(body) // contains no upstream host, path, or API key — counts only
```

#### Scenario: Degraded when no chain is servable
```typescript
// ALLOWED_CHAIN_IDS: "999" (no upstream configured for chain 999)
const body = await GET "/api/v1/health"
body.status // "degraded"
body.chains // []
```

#### Scenario: Rate-limit configuration reflected
```typescript
// RATE_LIMIT_PER_MINUTE unset -> { enabled: true, limitPerMinute: 60 }
// RATE_LIMIT_PER_MINUTE: "120" -> { enabled: true, limitPerMinute: 120 }
// RATE_LIMIT_PER_MINUTE: "0" -> { enabled: false, limitPerMinute: 0 }
// RATE_LIMIT_PER_MINUTE: "abc" -> { enabled: true, limitPerMinute: 60 } (invalid falls back to default)
```

### Requirement: Bounded Deep Health Probing
`GET /api/v1/health?deep=1` MAY probe upstream connectivity by sending one `eth_chainId` call to the first configured upstream of at most 5 servable chains, each bounded by a 2.5-second timeout enforced via `AbortController`. Probe results SHALL be reported as `deep: { checked, chains: [{ chainId, ok, latencyMs }] }` where `latencyMs` is null on failure. Probe failures and timeouts SHALL degrade the individual result to `ok: false` without failing the response; when every probed chain fails, `status` SHALL be "degraded", otherwise partial failures keep `status` "ok".

#### Scenario: Successful probes report latency
```typescript
// RPC_URLS configures chains 1 and 10, deep fetches succeed
const body = await GET "/api/v1/health?deep=1"
body.deep.checked // 2
body.deep.chains  // [{ chainId: 1, ok: true, latencyMs: >= 0 }, { chainId: 10, ok: true, ... }]
body.status       // "ok"
```

#### Scenario: All probes failing yields degraded, not an error
```typescript
// every upstream fetch rejects
const res = await GET "/api/v1/health?deep=1"
res.status // 200
body.deep.chains // [{ chainId: 1, ok: false, latencyMs: null }]
body.status      // "degraded"
```

#### Scenario: Probe timeout cannot hang the response
```typescript
// upstream fetch never settles on its own
// advancing timers past the 2.5s probe timeout settles the response
const res = await GET "/api/v1/health?deep=1"
res.status // 200 with the probe marked { ok: false, latencyMs: null }
```

#### Scenario: Probe count is capped
```typescript
// 10 chains servable
const body = await GET "/api/v1/health?deep=1"
body.deep.checked // 5 (HEALTH_DEEP_MAX_CHAINS cap) — deep mode cannot be abused to fan out unbounded upstream traffic
```
