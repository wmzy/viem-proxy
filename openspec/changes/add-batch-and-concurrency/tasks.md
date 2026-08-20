## 1. Workers Batch Endpoint
- [x] 1.1 Create `workers/src/handlers/batch.ts` with `handleBatchRequest` and `MAX_BATCH_SIZE = 50`; export `executeWithDeduplication` from `handlers/actions.ts` so batch items reuse the dedup + action handler + stats path
- [x] 1.2 Validate body: JSON parse errors → 400 `-32600`; missing/empty/non-array `requests` → 400 `-32602`; `> 50` items → 400 mentioning the limit; structurally invalid items (missing `id`/integer `chainId`/string `action`) → 400 naming the index
- [x] 1.3 Per-item isolation: unknown action → `-32601` error entry; execution failure → `-32603` error entry; successful items still resolve, results returned in request order
- [x] 1.4 Set `Cache-Control: no-store` on batch responses (POST is never CDN-cached by design)
- [x] 1.5 Register `app.post("/api/v1/batch", handleBatchRequest)` in `workers/src/index.ts`

## 2. Workers RPC Concurrency Control
- [x] 2.1 Extract the endpoint-failover loop into `executeWithFailover` and wrap `executeRpcCall` with a per-chain slot acquire/release (one slot per logical call incl. failover)
- [x] 2.2 FIFO queue for excess calls; slot handed directly to the queue head on release; limiter entry dropped when idle
- [x] 2.3 Queue timeout 10s (`RPC_QUEUE_TIMEOUT_MS`): waiting call rejects with a queue-timeout error and never consumes a slot
- [x] 2.4 Default limit 10 (`DEFAULT_MAX_RPC_CONCURRENCY`); `setMaxRpcConcurrency` validates integers ≥ 1; parse `MAX_RPC_CONCURRENCY` env var in the `/api/*` middleware; add binding to `workers/src/types.ts` and `wrangler.toml`

## 3. Client Batch API
- [x] 3.1 Create `src/actions/batch.client.ts`: `BatchRequest`/`BatchResult`/`BatchItemError` types and `batchActions(actions, config, defaultChainId = 1)`
- [x] 3.2 Batch POST to `/api/v1/batch` with `X-Trace-Id`/`X-API-Key` headers and the shared transient-retry policy (`withRetry` + `RetryableError`/`isRetryableStatus` exported from `actions/utils.ts`)
- [x] 3.3 Degrade to serial `makeProxyRequest` per item when the batch endpoint is unavailable or fails; per-item errors isolated
- [x] 3.4 Record one metrics entry per item on a successful batch round trip (shared latency/cache status)
- [x] 3.5 Add `batch()` to `proxyActions` (`batchClientActions`): client chain as default item chain; native per-action execution when no proxy config
- [x] 3.6 Export `batchActions` + batch types from `src/actions/index.ts` and `src/index.ts`

## 4. Tests
- [x] 4.1 Workers batch: success order, 400 on >50/invalid body/invalid items, per-item failure isolation (unsupported chain, unknown action), per-item stats recording, real-app routing + observability headers, `MAX_RPC_CONCURRENCY` env plumbing
- [x] 4.2 Workers concurrency: FIFO handover with real timers, per-chain independence, queue-timeout rejection with fake timers (incl. no slot leak), limit validation
- [x] 4.3 Client batch: single POST shape (URL/headers/body), chain overrides, per-item errors, serial degradation on failure, item isolation in fallback, empty batch, per-item metrics, `batch()` on the extended object, native execution without proxy config

## 5. Verification
- [x] 5.1 `workers`: `npx vitest run` all green (78 tests) and `npx tsc --noEmit` clean
- [x] 5.2 root: `npm run test` all green (273 tests) and `npm run typecheck` clean
- [x] 5.3 `openspec validate add-batch-and-concurrency --strict --no-interactive` passes
