# Tasks

## 1. Benchmark Script
- [x] 1.1 Create `scripts/benchmark.mjs` (root, Node >= 18, native fetch, zero deps, no library imports): three scenarios × two paths (direct JSON-RPC vs proxy action POST), one untimed warmup per path per scenario
- [x] 1.2 Per-scenario latency table: P50/P95/P99 (nearest-rank), mean, min, max, failure count for both paths; failed requests excluded from stats but counted
- [x] 1.3 Proxy-path cache metrics: X-Cache hit rate (HIT/MISS counts), cold first response (warmup latency, falling back to the first successful timed sample) vs subsequent mean
- [x] 1.4 Upstream-RPC-call savings estimate (direct N vs proxy MISS count, null when no X-Cache info is available) plus a cross-scenario P50 summary table
- [x] 1.5 Chinese human report; `--json` machine-readable output that never contains the API key (only `hasKey`)
- [x] 1.6 `--help`/`-h` prints usage and exits 0; usage errors exit 2 with Chinese messages; exit 1 when a scenario has zero successful samples on one path
- [x] 1.7 Export pure helpers (`parseScenarios`, `parseArgs`, `buildUrl`, `percentile`, `summarize`, `buildScenarioRequests`, `aggregateScenario`, `formatReport`) and `runBenchmark`/`toJsonReport` with injectable fetch/now/log

## 2. Package Script
- [x] 2.1 Add `"benchmark": "node scripts/benchmark.mjs"` to root `package.json`

## 3. Tests
- [x] 3.1 `scripts/benchmark.test.ts` (new file with header note, picked up by the root vitest default include): parseScenarios (trim/dedupe/rejections), parseArgs (defaults, both flag forms, all rejection cases, --help skips validation), buildUrl, percentile (nearest-rank, unsorted input, single/empty), summarize (rounding, null on empty)
- [x] 3.2 buildScenarioRequests (proxy URL + body per scenario, direct JSON-RPC equivalents, USDC default + --address retarget), aggregateScenario (hit rate, savings, improvement, unknown status tolerance, failed paths, null savings without X-Cache)
- [x] 3.3 runBenchmark via injectable fetch/now mock: warmup-then-iteration request order, X-API-Key on every request, hit counting, warmup-as-cold-reference, warmup-failure fallback, all-failed counting, JSON report key masking

## 4. Documentation
- [x] 4.1 README: rewrite 「📊 性能对比」— keep the illustrative table clearly marked, add 「用基准脚本复现」（usage + realistic sample output）and 「怎么解读」（hit rate / cold vs cached / percentiles / savings / environment caveats）; remove the 「即将提供」 promise
- [x] 4.2 GETTING_STARTED: add 「### 5. 性能基准（可选）」 after the smoke-script section

## 5. Verification
- [x] 5.1 `npx vitest run scripts/benchmark.test.ts` green (41 tests)
- [x] 5.2 `node scripts/benchmark.mjs --help` exits 0; `pnpm benchmark --help` works
- [x] 5.3 End-to-end against a temporary node:http mock (proxy + upstream): human report exit 0 with cache-hit/savings lines, JSON mode parses and masks the key, usage errors exit 2, all-proxy-failed exits 1 with an explanatory stderr
- [x] 5.4 `pnpm typecheck` clean
