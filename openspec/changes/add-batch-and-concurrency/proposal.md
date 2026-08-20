# Change: Add Batch Requests and RPC Concurrency Control

## Why
Clients currently fire one HTTP request per action; reading N balances costs N round trips even though all of them hit the same Worker. On the server side nothing caps how many upstream RPC calls a single chain executes concurrently, so one hot chain can saturate its upstream endpoints (and hit provider rate limits) while other chains are throttled by noise. This implements the remaining two items of PRD 2.2 (批量请求支持, RPC 并发控制) across client and Workers server.

## What Changes
- Workers: new `POST /api/v1/batch` endpoint accepting `{ requests: [{ id, chainId, action, args }] }` (max 50 items per batch, oversized batches get 400). Each item runs through the exact single-action path (DO deduplication + action handler + statistics) and is isolated per item: a failing item yields an `error` entry while the rest of the batch resolves. Response: `{ results: [{ id, result?, blockNumber?, error? }] }` in request order.
- Workers: per-chain upstream concurrency limiter on the `executeRpcCall` path. Default cap 10 concurrent upstream calls per chain, configurable via `MAX_RPC_CONCURRENCY` env var (parsed by the existing `/api/*` middleware alongside `RPC_URLS`). Excess calls queue FIFO; a call waiting longer than 10s fails with a queue-timeout error before any upstream request is made. One slot covers the whole endpoint-failover sequence (one logical call = one slot). Limits are per chain, so chains never block each other.
- Client: new `batchActions(actions, config, defaultChainId?)` in `src/actions/batch.client.ts` plus `batch()` on the `proxyActions` extension object. `BatchRequest = { id, action, args?, chainId? }`. The batch POST gets the same transient-retry policy (network errors, timeouts, 5xx, 429) as single requests; when the batch endpoint is unavailable or fails after retries, the call degrades to serial `makeProxyRequest` calls with identical semantics (retry, metrics, per-item isolation). Without a proxy config, items run through the native per-action clients, matching single-action behavior.
- Client metrics: a successful batch round trip records one metrics entry per item (shared latency and cache status of the single request); serial-fallback items record via `makeProxyRequest` as usual.
- Caching trade-off (intentional): batch requests are POSTs and never served from the CDN cache; `Cache-Control: no-store` is set explicitly. CDN caching remains the single-request GET path's responsibility. Server-side DO deduplication still applies per batch item.

## Impact
- Affected specs: `actions`, `workers-backend`
- Affected code:
  - `workers/src/handlers/batch.ts` — new batch handler (`handleBatchRequest`, `MAX_BATCH_SIZE`)
  - `workers/src/handlers/actions.ts` — export `executeWithDeduplication` for reuse
  - `workers/src/actions/utils.ts` — per-chain FIFO semaphore (`acquireRpcSlot`/`releaseRpcSlot`), `setMaxRpcConcurrency`/`getMaxRpcConcurrency`/`resetRpcConcurrency`, `DEFAULT_MAX_RPC_CONCURRENCY = 10`, `RPC_QUEUE_TIMEOUT_MS = 10_000`; failover loop extracted to `executeWithFailover`
  - `workers/src/index.ts` — `POST /api/v1/batch` route, `MAX_RPC_CONCURRENCY` env parsing
  - `workers/src/types.ts`, `workers/wrangler.toml` — `MAX_RPC_CONCURRENCY` binding/var
  - `src/actions/batch.client.ts` — new: `batchActions`, `runNativeBatch`, batch types
  - `src/actions/proxyActions.ts` — `batch()` action
  - `src/actions/utils.ts` — export `RetryableError`, `isRetryableStatus`, `generateTraceId` for batch reuse
  - `src/actions/index.ts`, `src/index.ts` — exports
- No breaking API changes: all additions are new endpoints/functions/optional env vars with defaults preserving current behavior
