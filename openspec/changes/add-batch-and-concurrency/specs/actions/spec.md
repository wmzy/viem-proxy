# Delta: Client Batch Requests

## ADDED Requirements

### Requirement: Batch Action Requests
`batchActions(actions, config, defaultChainId?)` SHALL execute multiple proxy actions in a single `POST /api/v1/batch` request carrying `{ requests: [{ id, chainId, action, args }] }`. The `ProxyActions` extension object SHALL expose the same capability as `batch(requests)`, defaulting each item's chain to the client's chain (falling back to chain id 1). An empty batch SHALL resolve to an empty result array without issuing a request.

#### Scenario: Multiple actions in one round trip
```typescript
const results = await batchActions(
  [
    { id: 1, action: "getBalance", args: { address: "0x..." } },
    { id: 2, action: "getBlockNumber" },
  ],
  { endpoint: "https://proxy.example.com" }
)
// fetch called once with POST https://proxy.example.com/api/v1/batch
// body.requests === [
//   { id: 1, chainId: 1, action: "getBalance", args: { address: "0x..." } },
//   { id: 2, chainId: 1, action: "getBlockNumber", args: {} },
// ]
// results echoes server entries in request order
```

#### Scenario: Per-item chain override
```typescript
await batchActions(
  [{ id: "a", action: "getBalance", args: { address: "0x..." }, chainId: 137 }],
  { endpoint: "https://proxy.example.com" }
)
// body.requests[0].chainId === 137
```

### Requirement: Batch Fallback to Serial Requests
When the batch endpoint is unavailable or fails — network error, timeout, retryable HTTP status exhausted, non-2xx response, or malformed response — `batchActions` SHALL degrade to serial `makeProxyRequest` calls, one per item, preserving single-request semantics (shared retry policy, metrics, compressed GET path). Item failures SHALL be isolated: a failing item yields an `error` entry and the remaining items still execute.

#### Scenario: Batch endpoint failure degrades to serial requests
```typescript
// Batch POST rejects, then two single-action proxies answer:
const results = await batchActions(
  [{ id: 1, action: "getBalance", args }, { id: 2, action: "getBalance", args }],
  { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } }
)
// fetch called 3 times: 1 batch attempt + 2 GET /api/v1/1/getBalance requests
// results === [{ id: 1, result: "0x11" }, { id: 2, result: "0x22" }]
```

#### Scenario: Item failure isolation in the fallback
```typescript
// Batch fails; item 1 succeeds; item 2's single request returns a proxy error body
// results[1].error.message === "Proxy error: upstream boom"; results[0].result defined
```

### Requirement: Batch Result and Error Shape
Batch results SHALL be an array of `{ id, result?, blockNumber?, error? }` entries where each `id` echoes the matching request's id. Server-side per-item errors SHALL be preserved as `{ code, message }`. A successful batch round trip SHALL record one client metrics entry per item (shared response time and cache status of the single request).

#### Scenario: Per-item errors preserved in order
```typescript
// Server responds { results: [{ id: 1, result: "0x1" }, { id: 2, error: { code: -32603, message: "boom" } }] }
// results[0] === { id: 1, result: "0x1" }
// results[1].result === undefined; results[1].error.message === "boom"
```

#### Scenario: Per-item metrics recording
```typescript
resetMetrics()
await batchActions(
  [{ id: 1, action: "getBalance", args }, { id: 2, action: "getBlockNumber" }],
  { endpoint: "https://proxy.example.com" }
)
getMetricsCollector().getSnapshot().totalRequests === 2
```

### Requirement: Native Batch Without Proxy Config
`batch()` on a client without proxy configuration SHALL execute items natively through the per-action client functions (which fall back to viem's own actions), mirroring how single actions behave without a proxy.

#### Scenario: No proxy config runs items natively
```typescript
const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
const results = await proxyActions(client).batch([
  { id: 1, action: "getBalance", args: { address: "0x..." } },
])
// one direct eth_getBalance to the client transport; results[0].result is a bigint
```

### Requirement: Batch Requests Are Not CDN-Cached
Batch requests SHALL use POST and therefore never rely on the CDN cache; this is an intentional trade-off documented in the client and server handlers (caching remains the single-request GET path's responsibility).

#### Scenario: Batch uses POST only
```typescript
// Every batch attempt is a POST to /api/v1/batch; no GET-with-?p= variant is used
```
