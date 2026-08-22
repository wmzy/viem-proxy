# Tasks

## 1. Implementation

- [x] 1.1 `src/utils/metrics.ts`: `FallbackEntry` type; `MetricsCollector.recordFallback`; global `fallbackCount` + `fallbackReasons` (sorted keys, only reasons that occurred) and per-method `fallbackCount` in `MethodState`; all three surfaced in `getSnapshot()`; cleared in `reset()`
- [x] 1.2 `src/actions/utils.ts`: `FallbackReason` union; `RetryableError` optional readonly `reason` (constructor stays call-compatible); `fetchFailureReason` maps fetch rejections by error name (`TimeoutError`/`AbortError`/else `network`); send path tags reasons (fetch catch → `fetchFailureReason`, retryable status → `429`/`5xx`); export `classifyFallbackReason` (tag first, then `HTTP <status>`/timeout/abort/network message heuristics, else `other`) and `recordFallback(method, error)`
- [x] 1.3 All 16 action files: `recordFallback(<actionName>, error)` as the first statement of the `proxy.fallback !== false` branch (covers both retry-exhausted and direct-failure paths; exactly once per logical request)
- [x] 1.4 `src/types.ts`: `PerformanceMetrics.fallbackCount`/`fallbackRate`/`fallbackReasons` + `MethodMetrics.fallbackCount` with doc comments (fallback = proxy delivered no value); `getCacheStats` doc comments in `src/types.ts` and `src/actions/proxyActions.ts` list the fallback fields
- [x] 1.5 `src/test/client.test.ts`: all-zero snapshot fixture gains `fallbackCount: 0`, `fallbackRate: 0`, `fallbackReasons: {}`

## 2. Tests

- [x] 2.1 `src/test/utils.test.ts` `MetricsCollector` describe: fallback counting with per-reason and per-method breakdown; `fallbackRate` = fallbackCount/totalRequests; zero fallback fields when none occurred; reset drops fallback counters; zero-snapshot fixture updated
- [x] 2.2 `src/test/utils.test.ts` new `classifyFallbackReason` describe: reason tag preferred over message heuristics; message heuristics for untagged errors (HTTP status/abort/timeout/network wording); proxy business + middleware errors → `other`
- [x] 2.3 `src/test/actions.test.ts` new「fallback metrics」describe: 3 proxy attempts collapse into ONE fallback event; network failure → `network`; 500 → `5xx` and 429 → `429` end-to-end; successful request keeps all fallback fields zero; `fallback: false` throw records nothing; `getCacheStats()` exposes the three fields and `resetStats()` clears them

## 3. Docs

- [x] 3.1 README「重试配置」: new「回退观测（fallback 指标）」sub-section — field table, reason taxonomy, sample output, interpretation guidance, `resetStats` note
- [x] 3.2 README「扩展方法」: `getCacheStats` field list mentions `fallbackCount/fallbackRate/fallbackReasons`
- [x] 3.3 GETTING_STARTED metrics example: `fallbackRate`/`fallbackReasons` read with a 5% alerting threshold example

## 4. Verification

- [x] 4.1 `pnpm typecheck` passes
- [x] 4.2 `pnpm vitest run src/test/utils.test.ts src/test/actions.test.ts` passes (195 tests, incl. new fallback cases)
- [x] 4.3 openspec CLI unavailable locally (no binaries published) — delta hand-verified against conventions (ADDED header, `#### Scenario:` per requirement)
