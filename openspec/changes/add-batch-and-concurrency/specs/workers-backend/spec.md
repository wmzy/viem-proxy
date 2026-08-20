# Delta: Workers Batch Endpoint and RPC Concurrency

## ADDED Requirements

### Requirement: Batch Action Endpoint
The Workers API SHALL accept `POST /api/v1/batch` with body `{ requests: [{ id, chainId, action, args? }] }` and respond `{ results: [{ id, result?, blockNumber?, error? }] }` with entries in request order. A batch SHALL accept at most 50 items; larger batches (and structurally invalid bodies — unparseable JSON, missing/empty/non-array `requests`, items lacking an `id`, integer `chainId`, or string `action`) SHALL receive a 400 error without executing any item.

#### Scenario: Batch executes all items in order
```typescript
const response = await app.request("/api/v1/batch", {
  method: "POST",
  body: JSON.stringify({
    requests: [
      { id: "a", chainId: 1, action: "getBalance", args: { address: "0x..." } },
      { id: "b", chainId: 1, action: "getBlockNumber" },
    ],
  }),
}, env)
// 200; data.results.map(r => r.id) === ["a", "b"]; both entries carry results
```

#### Scenario: Oversized batch rejected
```typescript
// 51 items -> 400, error.code -32602, message mentions the limit; no upstream fetch
```

#### Scenario: Invalid body rejected
```typescript
// "{not json" -> 400 -32600 "Invalid JSON body"
// {} or { requests: [] } -> 400 -32602
// item without id -> 400 -32602 mentioning "index 0"
```

### Requirement: Batch Item Isolation
Each batch item SHALL execute through the same path as the single-action route (DO request deduplication, action handler dispatch, statistics recording) and be isolated: an unknown action SHALL yield a `-32601` error entry, an execution failure (e.g. unsupported chain, all upstream endpoints failing, queue timeout) SHALL yield a `-32603` error entry, and the remaining items SHALL still resolve. Each item SHALL record exactly one statistics observation.

#### Scenario: Failing items do not affect the rest
```typescript
const response = await app.request("/api/v1/batch", {
  method: "POST",
  body: JSON.stringify({
    requests: [
      { id: "ok", chainId: 1, action: "getBalance", args: { address: "0x..." } },
      { id: "bad-chain", chainId: 99999, action: "getBalance", args: { address: "0x..." } },
      { id: "bad-action", chainId: 1, action: "doesNotExist" },
    ],
  }),
}, env)
// 200; "ok" has a result; "bad-chain" error mentions "Unsupported chain ID";
// "bad-action" error.code === -32601
```

#### Scenario: Per-item statistics recording
```typescript
// Batch of getBalance + getBlockNumber (dedup MISS) records two stats writes:
// eth_getBalance and eth_blockNumber, one each
```

### Requirement: Batch Responses Are Not CDN-Cached
Batch responses SHALL carry `Cache-Control: no-store`. Batch requests are POSTs and therefore never served from the CDN cache; this is an intentional trade-off — caching is the single-request GET path's responsibility. DO-level request deduplication still applies per batch item.

#### Scenario: Explicit no-store on batch responses
```typescript
const response = await app.request("/api/v1/batch", { method: "POST", body: validBatch }, env)
response.headers.get("Cache-Control") === "no-store"
```

### Requirement: Per-Chain Upstream Concurrency Limit
The Workers server SHALL cap concurrent upstream RPC calls per chain on the `executeRpcCall` path. The default cap SHALL be 10, configurable via the `MAX_RPC_CONCURRENCY` environment variable (positive integer; invalid values fall back to the current limit). One logical call — including its endpoint-failover sequence — SHALL occupy exactly one slot. Limits SHALL be independent per chain: a saturated chain SHALL NOT delay calls to other chains.

#### Scenario: Excess calls queue FIFO per chain
```typescript
setMaxRpcConcurrency(1)
const first = executeRpcCall(1, "eth_gasPrice", [])   // holds the only slot
const second = executeRpcCall(1, "eth_gasPrice", [])  // queued
const third = executeRpcCall(1, "eth_gasPrice", [])   // queued behind second
// while first is in flight, upstream fetch called exactly once
// after first settles: second then third run in queue order
```

#### Scenario: Chains do not block each other
```typescript
setMaxRpcConcurrency(1)
const held = executeRpcCall(1, "eth_gasPrice", [])     // chain 1 saturated
const other = await executeRpcCall(137, "eth_gasPrice", [])
// chain 137 call completes without waiting for chain 1
```

#### Scenario: Environment configuration
```typescript
// Request handled with env MAX_RPC_CONCURRENCY = "3"
getMaxRpcConcurrency() === 3
```

### Requirement: Concurrency Queue Timeout
Calls waiting for a per-chain slot longer than 10 seconds SHALL fail with a queue-timeout error before any upstream request is made, and SHALL NOT consume or leak a slot; subsequent calls SHALL proceed normally once a slot frees.

#### Scenario: Queue timeout rejects and does not leak the slot
```typescript
vi.useFakeTimers()
setMaxRpcConcurrency(1)
const first = executeRpcCall(1, "eth_gasPrice", [])    // holds the slot indefinitely
const queued = executeRpcCall(1, "eth_gasPrice", [])
await vi.advanceTimersByTimeAsync(10_000)
await expect(queued).rejects.toThrow(/queue timeout/i)
// settle first; the next call starts immediately (slot not leaked)
```
