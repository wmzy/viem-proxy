# Delta: Cache Purge

## ADDED Requirements

### Requirement: Authenticated Purge Endpoint
The Worker SHALL expose `POST /api/v1/purge` as an administrative cache-invalidation endpoint. It SHALL require the `X-API-Key` credential via the existing auth middleware whenever `API_KEY` is configured (401 otherwise) and SHALL NOT be exempt from per-IP rate limiting (the caller's budget is charged like any other `/api/v1/*` request). When `API_KEY` is not configured, the endpoint SHALL respond `501` with a message instructing the operator to configure the key first, rather than running as an unauthenticated admin surface; no Durable Object or cache mutation SHALL occur on that path.

#### Scenario: 501 without an API key configured
```typescript
// env without API_KEY
const res = await app.request("/api/v1/purge", { method: "POST", body: '{"requests":[]}' }, env)
res.status // 501
await res.json() // { error: { code: -32601, message: "...set the API_KEY environment variable..." } }
// PROXY_STATE stub and caches.default.delete never called
```

#### Scenario: wrong key rejected with 401 before the handler runs
```typescript
// API_KEY = "test-secret-key", X-API-Key: "wrong-key"
const res = await app.request("/api/v1/purge", { method: "POST", headers: { "X-API-Key": "wrong-key" }, body: '{"chainId":1}' }, env)
res.status // 401
```

#### Scenario: purge requests consume the rate-limit budget
```typescript
// RATE_LIMIT_PER_MINUTE = "1", valid key: first purge -> 200, second purge -> 429
```

### Requirement: Purge Granularity
The endpoint SHALL support two granularities of the JSON body. Per-request: `requests: [{ chainId?, action, args? }]` — each item SHALL resolve its chain id (per-item, falling back to the top-level `chainId`) and SHALL reconstruct the exact dedup hash (`SHA-256` of `${chainId}:${action}:${JSON.stringify(args ?? {})}`, identical to the dedup write path) and the exact compressed GET URL (client-identical `compressParams`), then delete the matching Durable Object record and the matching `caches.default` entry. Chain-level: `chainId` alone SHALL clear the entire `chain-${chainId}` ProxyState DO store via a new `POST /purge` DO route and SHALL NOT attempt CDN deletion (entries cannot be enumerated). `method`-level purge SHALL be rejected with `400` and an explanatory message (opaque hashes, no cache enumeration). Invalid input (empty body, non-positive/non-integer chain ids, unknown actions, more than `MAX_PURGE_REQUESTS = 50` items, malformed JSON) SHALL be rejected with `400` before any deletion occurs. A failing ProxyState DO SHALL produce `502`.

#### Scenario: per-request purge deletes the DO record and the colo cache entry
```typescript
// seeded DO store contains the hash of `1:getBalance:{"address":"0x…"}`,
// caches.default.delete answers true for the reconstructed URL:
const res = await app.request("/api/v1/purge", { method: "POST", headers, body: '{"requests":[{"chainId":1,"action":"getBalance","args":{"address":"0x…"}}]}' }, env)
res.status // 200
await res.json() // { purged: { dedup: 1, cache: 1 }, scope: "colo", limitations: [...] }
// DO received DELETE /requests/<hash>; cache.delete received
// GET http://<origin>/api/v1/1/getBalance?p=<client-identical compressed args>
```

#### Scenario: chain-level purge clears the chain's DO store and touches no cache URL
```typescript
// DO store for chain-1 has 3 rows:
const res = await app.request("/api/v1/purge", { method: "POST", headers, body: '{"chainId":1}' }, env)
await res.json() // { purged: { dedup: 3, cache: 0 }, scope: "colo", limitations: [<colo scope>, <enumeration>] }
// DO received POST /purge; caches.default.delete never called
```

#### Scenario: method-level and invalid bodies rejected with 400
```typescript
'{"method":"eth_getBalance"}'   // 400 "Method-level purge is not supported…"
'{}'                            // 400 "Nothing to purge…"
'{"chainId":0}'                 // 400 "Invalid chainId…"
'{"requests":[{"chainId":1,"action":"nope"}]}' // 400 "Unknown action: nope"
'{"requests":[51 items]}'       // 400 "Too many purge requests (51); limit is 50"
'{not json'                     // 400 "Invalid JSON body"
```

### Requirement: Honest Purge Scope Reporting
Every successful purge response SHALL report what was actually deleted as `purged: { dedup: <number>, cache: <number> }` and SHALL carry `"scope": "colo"` plus a `limitations` array stating that `caches.default.delete` only affects the colo serving the request (other PoPs' entries expire by TTL; global CDN invalidation requires Cloudflare's zone-level purge API, out of scope). Chain-level responses SHALL additionally disclose that CDN entries cannot be enumerated per chain. The response SHALL NOT imply global invalidation.

#### Scenario: response shape discloses the colo scope
```typescript
const body = await res.json()
body.scope // "colo"
body.limitations[0] // contains "colo"
body.limitations[0] // contains "zone-level purge API"
```

### Requirement: Client Purge Action
`viem-proxy/actions` SHALL export `purgeCache(requests: PurgeRequest[], config: ProxyActionConfig): Promise<PurgeResult>` where `PurgeRequest = { chainId: number; action: string; args?: Record<string, unknown> }` and `PurgeResult` mirrors the server report (`{ purged: { dedup, cache }, scope: "colo", limitations }`). It SHALL be a standalone top-level function (no client-instance method added). It SHALL POST `{ requests }` to `${endpoint}/api/v1/purge` with `X-API-Key` (when configured) and `X-Trace-Id` headers, retry transient failures (network/timeout/5xx/429) per `config.retryOptions`, throw the server message for non-retryable error responses, and resolve zero deletions without a round trip for an empty list or missing endpoint.

#### Scenario: request shape and returned report
```typescript
global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve(report) })
const result = await purgeCache(
  [{ chainId: 1, action: "getBalance", args: { address: "0x…" } }],
  { endpoint: "https://proxy.example.com", apiKey: "secret" }
)
// single fetch: POST https://proxy.example.com/api/v1/purge,
// headers include X-API-Key and a 12-hex X-Trace-Id, body is { requests: [...] }
// result === report
```

#### Scenario: transient failure retried, business error thrown once
```typescript
// first attempt resolves { status: 502 }, second resolves the report, retryOptions { attempts: 2 }: result === report
// a { error: { message } } body throws `Proxy error: <message>` and is not retried
```

#### Scenario: empty list or missing endpoint resolves zero deletions
```typescript
await purgeCache([], { endpoint: "https://proxy.example.com" })
// { purged: { dedup: 0, cache: 0 }, scope: "colo", limitations: [] }; fetch never called
```
