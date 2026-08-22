# Delta: Benchmark

## ADDED Requirements

### Requirement: Reproducible Latency Benchmark Script
The package SHALL provide `scripts/benchmark.mjs`, a zero-dependency
Node >= 18 script using native fetch (importing no library build output),
that measures the same logical read through two HTTP paths — a direct
JSON-RPC POST to the upstream RPC (`--rpc`) and the proxy's action
endpoint `POST /api/v1/{chain}/{action}` — for the scenarios
`getBalance` (vs `eth_getBalance`), `getBlockNumber` (vs
`eth_blockNumber`), and `readContract` (vs `eth_call` on `name()`
calldata). Each path SHALL be warmed up once per scenario without entering
the statistics. The report SHALL include, per scenario and path, the
nearest-rank P50/P95/P99 plus mean/min/max over successful requests and a
failure count; for the proxy path additionally the `X-Cache` hit rate, the
cold first response latency versus the subsequent mean, and an estimated
upstream-RPC-call saving (direct request count versus proxy MISS count,
null when no `X-Cache` status is available). A cross-scenario P50 summary
SHALL close the human report; `--json` SHALL emit a machine-readable
report that never contains the API key.

#### Scenario: Help output
```bash
node scripts/benchmark.mjs --help
# Prints usage (required flags, scenarios, options, exit codes) and exits 0
```

#### Scenario: Comparative run
```bash
node scripts/benchmark.mjs --proxy https://your-proxy.workers.dev \
  --rpc https://eth.llamarpc.com --key k1
# Per scenario: warmup (untimed), then alternating direct/proxy timed pairs.
# Human report shows the two-row latency table, 缓存命中 HIT/MISS ratio,
# 首次响应（冷）→ 后续均值, and 上游 RPC 调用估算, then the P50 summary
```

#### Scenario: Failed requests are data, not aborts
```bash
# Some timed requests fail (e.g. upstream 429):
# Failures are excluded from latency statistics, counted in the 失败 column,
# and the run still completes with exit code 0
```

#### Scenario: Machine-readable output
```bash
node scripts/benchmark.mjs --proxy ... --rpc ... --json | jq .ok
# stdout is pure JSON (progress goes to stderr); contains options (with
# hasKey: true, never the key itself), per-scenario summaries, cache
# metrics and savings
```

#### Scenario: Comparison impossible
```bash
# The proxy answers 404 for every request of a scenario:
# Report marks that path 全部失败; exit code is 1 and stderr names the
# broken scenario and path
```

### Requirement: Benchmark Script Configuration
The script SHALL require `--proxy <url>` and `--rpc <url>` (http/https
URLs) and accept `--chain <id>` (positive integer, default 1), `--key`
(sent as `X-API-Key` on every request), `--iterations <n>` (1~1000,
default 20), `--address <0x..>` (getBalance account, defaulting to a
well-known public address; also retargeting the readContract contract
whose calldata is `name()`), `--scenario <list>` (comma-separated subset
of the three scenarios, defaults to all), and the `--json` switch; both
`--flag value` and `--flag=value` forms SHALL work, invalid input SHALL
produce a Chinese error plus usage on stderr with exit code 2. The root
package SHALL expose the script as `pnpm benchmark`. Argument/scenario
parsing, URL building, percentile math, summaries, request construction
and report aggregation SHALL live in exported pure helpers covered by
tests; the request loop SHALL accept an injectable fetch so tests exercise
it without real network calls.

#### Scenario: Flags reach the wire
```bash
node scripts/benchmark.mjs --proxy https://x.dev --rpc https://r.dev \
  --chain 137 --key k1 --scenario getBalance --address 0xabc
# Timed requests hit POST /api/v1/137/getBalance with body
# {"address":"0xabc"} and header X-API-Key: k1; direct requests send
# eth_getBalance with params ["0xabc","latest"]
```

#### Scenario: pnpm benchmark alias
```bash
pnpm benchmark --help
# Equivalent to `node scripts/benchmark.mjs --help`
```

#### Scenario: Usage errors
```bash
node scripts/benchmark.mjs --rpc https://r.dev        # 缺少 --proxy, exit 2
node scripts/benchmark.mjs --proxy https://x.dev --chain abc  # exit 2
node scripts/benchmark.mjs --proxy https://x.dev --rpc https://r.dev --scenario nope  # exit 2
```

#### Scenario: Exported helpers under test
```typescript
import { parseArgs, percentile, buildScenarioRequests, runBenchmark }
  from "./benchmark.mjs";
// scripts/benchmark.test.ts covers parsing rejections, nearest-rank
// percentiles, per-scenario request bodies, aggregation edge cases and
// the full request loop via a fetch mock mirroring real response shapes
```
