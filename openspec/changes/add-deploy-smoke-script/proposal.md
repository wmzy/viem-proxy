# Change: Add Deploy Smoke Script

## Why
Users deploy the Workers backend (one-click or manual) and then have no
immediate signal that the proxy actually works — they must hand-write curl
commands, guess request shapes, and know which endpoints are optional.
A single zero-dependency script that runs the four canonical checks and
prints a readable ✅/❌ summary turns "deploy and pray" into a 1-minute
verification step, and its non-zero exit code on failure makes it usable in
CI and deploy hooks.

## What Changes
- Add `workers/scripts/smoke.mjs` (Node >= 18, native fetch, zero deps):
  1. `GET /api/v1/health` — display `status`/`version`/servable chain count;
     `degraded` counts as a failure; HTTP 404/405 means "older deployment,
     no health endpoint" and is skipped, never failed
  2. `POST /api/v1/{chain}/getBlockNumber` ×3 sequentially — per-call
     latency, `X-Cache` (dedup HIT/MISS) and `X-Trace-Id`; repeat calls are
     expected to hit the dedup cache
  3. `POST /api/v1/{chain}/getBalance` on `--address` (defaults to a
     well-known public address), result formatted as ETH
  4. `GET /api/v1/stats` — optional; 401/404/network errors are reported as
     skipped and never fail the run
- Chinese human-readable report with a ✅/❌ summary; exit codes
  0 = all critical checks passed, 1 = at least one failed, 2 = usage error
- CLI: `node workers/scripts/smoke.mjs <endpoint> [--chain 1] [--key API_KEY]
  [--address 0x...]`; `--help`/`-h` prints usage and exits 0
- Pure helpers (`parseArgs`, `buildUrl`, `formatEther`) and the full flow
  (`runSmoke` with injectable fetch/log) are exported for tests
- `workers/package.json` gains `"smoke": "node scripts/smoke.mjs"`
- README「部署后验证」subsection at the end of 方式 A + GETTING_STARTED
  「### 4. 部署后验证（冒烟脚本）」 with usage and sample output

## Impact
- Affected specs: `deployment` (new capability)
- Affected code:
  - `workers/scripts/smoke.mjs` — new script (the only runtime artifact)
  - `workers/package.json` — `smoke` script
  - `workers/test/smoke.test.ts` — new test file (helpers + runSmoke via a
    fetch mock that mirrors the real response shapes and headers)
  - `README.md`, `GETTING_STARTED.md` — post-deploy verification docs
- No library or Workers API changes; the script only consumes existing
  public endpoints and tolerates older deployments without them
