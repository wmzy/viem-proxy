# Tasks

## 1. Smoke Script
- [x] 1.1 Create `workers/scripts/smoke.mjs` (Node >= 18, native fetch, zero deps): health → getBlockNumber ×3 → getBalance → stats, Chinese report with ✅/❌ summary, exit codes 0/1/2
- [x] 1.2 Tolerant health check: 404/405 skipped with "older version" hint; `status: degraded` counts as failure
- [x] 1.3 Stats check optional: 401/404/network failures reported as skipped, never fail the run
- [x] 1.4 Per-call latency, `X-Cache` (HIT/MISS) and `X-Trace-Id` in the getBlockNumber/getBalance report
- [x] 1.5 `--help`/`-h` prints usage and exits 0; CLI validation errors exit 2 with Chinese messages
- [x] 1.6 Export pure helpers (`parseArgs`, `buildUrl`, `formatEther`) and `runSmoke` with injectable fetch/log

## 2. Package Script
- [x] 2.1 Add `"smoke": "node scripts/smoke.mjs"` to `workers/package.json`

## 3. Tests
- [x] 3.1 `workers/test/smoke.test.ts` (new file with header note): parseArgs (defaults, `--flag value` and `--flag=value`, all rejection cases), buildUrl trailing-slash tolerance, formatEther
- [x] 3.2 `runSmoke` end-to-end via fetch mock mirroring real response shapes/headers: success, health 404 skip, degraded failure, action 5xx failures, network errors, stats optional, request sequence + `X-API-Key` on every request

## 4. Documentation
- [x] 4.1 README: 「部署后验证」 subsection at the end of 方式 A with usage and sample output
- [x] 4.2 GETTING_STARTED: 「### 4. 部署后验证（冒烟脚本）」 after the deploy steps

## 5. Verification
- [x] 5.1 `npx vitest run test/smoke.test.ts` green (21 tests)
- [x] 5.2 `--help` exits 0; success/old/fail/auth modes verified against a temporary node:http mock server (exit codes 0/0/1/0), usage errors exit 2
- [x] 5.3 `pnpm smoke --help` works from `workers/`
- [x] 5.4 `pnpm typecheck` clean
