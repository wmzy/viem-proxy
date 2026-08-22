# Change: Add Benchmark Tool

## Why
The README performance table is illustrative, not measured — users have no
way to verify the claimed cache-hit latency win in their own environment,
which undercuts trust in the product's core value proposition. A
reproducible, zero-dependency benchmark script turns those numbers into
something every deployer can reproduce in a minute and turns the README
table into a documented starting point rather than a marketing claim.

## What Changes
- Add `scripts/benchmark.mjs` (root, Node >= 18, native fetch, zero deps,
  imports no library build output): for each scenario it times the same
  logical read through two HTTP paths — direct JSON-RPC POST to the
  upstream (`--rpc`) vs the proxy's action endpoint
  (`POST /api/v1/{chain}/{action}`) — with one untimed warmup request per
  path per scenario (connection setup removed, proxy cache filled)
- Three scenarios: `getBalance` (vs `eth_getBalance`), `getBlockNumber`
  (vs `eth_blockNumber`), `readContract` (vs `eth_call` on `name()`
  calldata, defaulting to the USDC mainnet contract)
- Chinese human report per scenario: P50/P95/P99/mean/min/max table for
  both paths, `X-Cache` hit rate (HIT/MISS counts), cold first response vs
  subsequent mean latency, estimated upstream-RPC-call saving
  (direct N calls vs proxy MISS count), plus a cross-scenario P50 summary;
  `--json` emits a machine-readable report that never contains the API key
- CLI: `node scripts/benchmark.mjs --proxy <url> --rpc <url> [--chain 1]
  [--key KEY] [--iterations 20] [--address 0x...] [--scenario list]
  [--json]`; `--help`/`-h` prints usage and exits 0; `--address` overrides
  both the getBalance account and the readContract contract target
- Exit codes: 0 completed (per-request failures reported in output),
  1 any scenario had zero successful samples on one of the two paths,
  2 usage error
- Root `package.json` gains `"benchmark": "node scripts/benchmark.mjs"`
- README「📊 性能对比」rewritten: the illustrative table stays but is
  explicitly marked as such and points at the script; new subsections
  「用基准脚本复现」（usage + sample output）and「怎么解读」(hit rate,
  cold-vs-cached, percentile and savings reading); the previous
  「即将提供」 promise is removed. GETTING_STARTED gains
  「### 5. 性能基准（可选）」 after the smoke-script section

## Impact
- Affected specs: `benchmark` (new capability)
- Affected code:
  - `scripts/benchmark.mjs` — new script (the only runtime artifact)
  - `scripts/benchmark.test.ts` — new test file (pure helpers + runBenchmark
    through an injectable fetch mock mirroring real response shapes)
  - `package.json` — `benchmark` script
  - `README.md`, `GETTING_STARTED.md` — performance-reproduction docs
- No library or Workers API changes; the script only consumes the existing
  public proxy action endpoints and any JSON-RPC upstream
