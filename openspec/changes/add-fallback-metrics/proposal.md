# Change: Add Fallback Metrics

## Why
With `fallback: true` (the default), a failed proxy request silently retries on the original RPC. The caller never learns the fallback happened — the result is correct, so nothing surfaces. A proxy whose traffic is 100% fallback delivers zero value while appearing healthy: every request still "works", cache hit rate looks fine on the handful that survive, and operators have no signal that the Workers endpoint is down or being rate-limited. Fallback observability is therefore the key metric for whether the proxy is actually producing value.

## What Changes
- **Failure classification** (`src/actions/utils.ts`): `RetryableError` gains an optional readonly `reason: FallbackReason` set at the send path where the failure is known precisely — `timeout`/`abort`/`network` from the fetch rejection's error name (`TimeoutError`/`AbortError`/other), `429` vs `5xx` from the HTTP status. New export `classifyFallbackReason(error): FallbackReason` prefers that tag and falls back to message heuristics for failures raised elsewhere (middleware throws, proxy JSON errors): `HTTP <status>` messages, timeout/abort/network wording → their categories, everything else → `other`. New export `recordFallback(method, error)` writes a fallback event into the shared metrics collector.
- **Recording** (all 16 action files: `getBalance`, `getBlock`, `getBlockNumber`, `getTransaction`, `getTransactionReceipt`, `readContract`, `call`, `estimateGas`, `getGasPrice`, `getLogs`, `getCode`, `getChainId`, `getTransactionCount`, `getStorageAt`, `getFeeHistory`, `getBlobBaseFee`): the fallback path (`proxy.fallback !== false` in the action's catch) calls `recordFallback(<actionName>, error)` before the direct-RPC call. Both entry paths are covered — retries exhausted and direct failure — and a request counts exactly once because `recordFallback` fires after the retry loop has already thrown.
- **Collector** (`src/utils/metrics.ts`): new `FallbackEntry { method, reason }` type; `MetricsCollector` gains `recordFallback(entry)`. The collector keeps `fallbackCount` plus per-reason counts (`fallbackReasons`, only reasons that occurred) globally, and `fallbackCount` per method in `MethodState`.
- **Types** (`src/types.ts`): `PerformanceMetrics` gains `fallbackCount: number`, `fallbackRate: number` (`fallbackCount / totalRequests`, 0 when no requests) and `fallbackReasons: Record<string, number>`; `MethodMetrics` gains per-method `fallbackCount`. Doc comments state that a fallback means the proxy delivered no value for that request and that this is the metric to watch for proxy effectiveness. `resetStats()` clears the fallback counters along with everything else (no semantic change to reset).
- **Docs**: README「重试配置」gains a「回退观测（fallback 指标）」sub-section (field table, reason taxonomy, sample output, interpretation guidance: sustained high `fallbackCount` = traffic bypassing the proxy); the `getCacheStats` field list in「扩展方法」mentions the three fields. GETTING_STARTED's metrics example reads `fallbackRate`/`fallbackReasons` with an alerting threshold example.
- Tests: `src/test/utils.test.ts` (`MetricsCollector` describe + new `classifyFallbackReason` describe) covers counting/reason categorization/rate computation/reset-to-zero/no-fallback-stays-zero; `src/test/actions.test.ts` gains a「fallback metrics」describe covering one-event-per-request-after-retry-exhaustion, network/5xx/429 classification end-to-end, zero fallback on success and on `fallback: false`, and `getCacheStats()`/`resetStats()` surface. `src/test/client.test.ts`'s all-zero snapshot fixture gains the three fields.

## Impact
- Affected specs: `client-metrics` (new fallback observability requirement)
- Affected code:
  - `src/utils/metrics.ts` — `FallbackEntry`, `recordFallback`, fallback counters in state/snapshot/reset
  - `src/actions/utils.ts` — `FallbackReason`, `RetryableError.reason`, `fetchFailureReason`, `classifyFallbackReason`, `recordFallback`, send-path reason tagging
  - `src/actions/*.client.ts` (16 files) — import + one `recordFallback(...)` call each in the fallback branch
  - `src/types.ts` — `PerformanceMetrics`/`MethodMetrics` fields, `getCacheStats` doc comments
  - `src/actions/proxyActions.ts` — `getCacheStats` doc comment
  - `src/test/utils.test.ts`, `src/test/actions.test.ts`, `src/test/client.test.ts` — fixtures + new describes
  - `README.md`, `GETTING_STARTED.md` — fallback metrics documentation
- No breaking API changes: purely additive fields/exports; `RetryableError`'s constructor signature stays call-compatible (optional second argument gains a `reason` key).
- Not in scope: batch/purge/middleware symbols; global default configuration (`configureProxy`, owned by a sibling task this wave); server-side anything.
