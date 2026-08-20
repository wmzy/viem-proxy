# Delta: Cache Preheat

## ADDED Requirements

### Requirement: Cache Preheat API
`preheatCache(requests: PreheatRequest[], config?, defaultChainId = 1)` SHALL warm the CDN cache by firing every item through the existing `makeProxyRequest` compressed GET path (`GET /api/v1/{chainId}/{action}?p=…`), so the Workers/CDN edge fills exactly the way real traffic would — with no server-side changes. Items SHALL run in a bounded pool of at most `PREHEAT_CONCURRENCY` (5) concurrent requests. The function SHALL never throw: per-item failures are swallowed and counted, and it SHALL resolve `{ submitted, failed }` where `submitted` is the number of items handed to the pool and `failed` the number that errored. Transient retries SHALL default to a single attempt per item (`attempts: 1`), since preheat is best-effort cache warming; an explicitly provided `config.retryOptions` SHALL be honored. An empty request list or a config without an endpoint SHALL resolve `{ submitted: 0, failed: 0 }` without issuing any request.

#### Scenario: Items warm through the cacheable compressed GET path
```typescript
global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ result: "0x1" }) })

const result = await preheatCache(
  [
    { action: "getBalance", args: { address: "0x123…" } },
    { action: "getBlockNumber" },
  ],
  { endpoint: "https://proxy.example.com" }
)
// result === { submitted: 2, failed: 0 }
// fetch called twice with method "GET" and URLs matching
// /api/v1/1/getBalance?p=… and /api/v1/1/getBlockNumber?p=…
```

#### Scenario: Concurrency is capped at 5
```typescript
// 12 preheat items against a fetch mock that tracks in-flight requests:
// the observed maximum in-flight count is exactly 5 and fetch is called 12 times
const result = await preheatCache(twelveItems, { endpoint: "https://proxy.example.com" })
// result === { submitted: 12, failed: 0 }
```

#### Scenario: Failures are counted, never thrown
```typescript
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ error: { code: -32000, message: "boom" } }),
})
const result = await preheatCache([item, otherItem], { endpoint: "https://proxy.example.com" })
// no exception; result === { submitted: 2, failed: 2 }; one fetch per item (no default retries)
```

#### Scenario: Empty list or missing endpoint resolves zero counters
```typescript
await preheatCache([], { endpoint: "https://proxy.example.com" }) // { submitted: 0, failed: 0 }
await preheatCache([{ action: "getBlockNumber" }], { endpoint: "" }) // { submitted: 0, failed: 0 }
```

### Requirement: Client-Bound Preheat
The `proxyActions(client)` extension object and `createPublicClient` clients SHALL expose `preheatCache(requests: PreheatRequest[]): Promise<PreheatResult>`, resolving the proxy config and chain id from the client itself (falling back to chain id 1). Without a proxy config there is nothing to preheat and the zero counters SHALL be returned without issuing any request. The legacy JSON-RPC `POST /api/v1/direct` preheat helper is removed; `PreheatRequest` reuses the batch action names (`BatchActionName`).

#### Scenario: Extension object uses the client's chain and config
```typescript
const ext = proxyActions(withProxy(client, { endpoint: "https://proxy.example.com" })) // mainnet
const result = await ext.preheatCache([{ action: "getBalance", args: { address: "0x…" } }])
// fetch URL contains /api/v1/1/getBalance?p=… ; result === { submitted: 1, failed: 0 }
```

#### Scenario: Proxyless client resolves zero counters
```typescript
const result = await proxyActions(plainClient).preheatCache([{ action: "getBlockNumber" }])
// result === { submitted: 0, failed: 0 }; fetch never called
```
