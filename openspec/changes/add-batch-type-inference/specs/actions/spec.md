# Delta: Batch Type Inference

## ADDED Requirements

### Requirement: Batch Result Type Inference
`batchActions`, `runNativeBatch`, and `batchProxy(requests)` SHALL infer each result entry's `result` type from the corresponding request item's `action` literal, using the return type of the matching per-action client function (e.g. `getBalance` → `bigint`, `getBlockNumber` → `bigint`, `getChainId` → `number`). The result list SHALL be a mapped tuple aligned with the request items, so positional access yields the item's exact result type without manual casts.

The runtime SHALL match these types on the proxy path: each successful item's raw JSON-RPC wire value SHALL be decoded by the same logic the corresponding single-action client function uses (hex quantities → `bigint`/`number`, `readContract` output decoded against the item's ABI, `eth_feeHistory` payload formatted), and items whose single-action proxy path passes the wire value through untouched (e.g. `getBlock`, `getLogs`) SHALL keep passing it through. Error entries SHALL never be decoded.

#### Scenario: Proxy-path results are normalized viem values
```typescript
const results = await batchActions(
  [
    { id: 1, action: "getBalance", args: { address: "0x..." } },
    { id: 2, action: "getChainId" },
    { id: 3, action: "getBlockNumber" },
  ],
  { endpoint: "https://proxy.example.com" }
)
// Proxy returned "0xde0b6b3a7640000", "0x89", "0xff":
typeof results[0].result === "bigint" // true (1e18 wei), not a hex string
results[1].result === 137 // number decoded from "0x89"
results[2].result === 255n // bigint decoded from "0xff"
```

#### Scenario: Per-item decode failure isolation
```typescript
const results = await batchActions(
  [
    { id: 1, action: "getBalance", args: { address: "0x..." } },
    { id: 2, action: "getBalance", args: { address: "0x..." } }, // undecodable result
    { id: 3, action: "getBlockNumber" },
  ],
  { endpoint: "https://proxy.example.com" }
)
// A decode failure only affects its own item; the rest of the batch is unaffected:
results[0].result === 1n
results[1].error?.message // "Failed to decode getBalance result: …"
results[2].result === 255n
```

#### Scenario: readContract items decode against the item's ABI
```typescript
const results = await batchActions(
  [
    {
      id: 1,
      action: "readContract",
      args: { address: "0x...", abi: erc20Abi, functionName: "decimals" },
    },
  ],
  { endpoint: "https://proxy.example.com" }
)
results[0].result === 18 // decoded uint8, not the raw eth_call hex
// Items without an ABI (pre-encoded `data` args) pass the raw hex through.
```

#### Scenario: Positional result inference
```typescript
const results = await batchActions(
  [
    { id: 1, action: "getBalance", args: { address: "0x..." } },
    { id: 2, action: "getChainId" },
  ],
  { endpoint: "https://proxy.example.com" }
)
// results[0].result: bigint | undefined
// results[1].result: number | undefined
const balance: bigint | undefined = results[0].result
// @ts-expect-error getBalance results are bigint, not number
const wrong: number = results[0].result
```

#### Scenario: Pre-typed request arrays
```typescript
const items: BatchRequest<"getGasPrice">[] = [{ id: 1, action: "getGasPrice" }]
const results = await batchActions(items, config)
// results[0].result: bigint | undefined
```

### Requirement: Batch Item Argument Validation
Each batch request item's `args` SHALL be typed by the per-action parameter type (`GetBalanceParameters`, `GetLogsParameters`, …; parameterless actions map to `undefined`). Type-level violations SHALL be rejected at compile time per item, not as a whole-array union.

#### Scenario: Per-item args checking
```typescript
await batchActions(
  [
    // @ts-expect-error getBalance requires an address
    { id: 1, action: "getBalance", args: {} },
    // @ts-expect-error getBlockNumber takes no args
    { id: 2, action: "getBlockNumber", args: { blockTag: "latest" } },
  ],
  config
)
```

### Requirement: Generic Batch Types Without Breaking Existing Shapes
`BatchRequest` and `BatchResult` SHALL be generic with `BatchActionName` as the default parameter, so existing unparameterized usages (`BatchRequest`, `BatchResult`, arrays and readonly arrays of them, pre-typed variables, spread-built arrays) keep compiling. The genericization SHALL NOT change runtime behavior: request wire format, result shapes, fallback semantics, metrics recording, and empty-batch handling stay identical.

#### Scenario: Runtime behavior unchanged
```typescript
// Batch POST fails once; serial fallback serves both items (same as before):
const results = await batchActions(
  [
    { id: 1, action: "getBalance", args: { address: "0x..." } },
    { id: 2, action: "getGasPrice" },
  ],
  { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } }
)
// fetch called 3 times (1 batch attempt + 2 serial GETs); results in request order
```

### Requirement: Batch Type Exports
The library SHALL export the batch type helpers `BatchResults`, `BatchRequests`, `BatchActionParameters`, and `BatchActionReturnType` from both `viem-proxy` and `viem-proxy/actions` alongside the existing batch types.

#### Scenario: Importing type helpers
```typescript
import type { BatchRequest, BatchResults, BatchResult } from "viem-proxy/actions"

const items = [
  { id: 1, action: "getBalance", args: { address: "0x..." } },
] as const satisfies readonly BatchRequest[]
type Results = BatchResults<typeof items> // readonly BatchResult<"getBalance">[]
```
