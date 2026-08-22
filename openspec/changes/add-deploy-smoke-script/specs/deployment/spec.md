# Delta: Deployment verification

## ADDED Requirements

### Requirement: Post-deploy Smoke Verification Script
The package SHALL provide `workers/scripts/smoke.mjs`, a zero-dependency
Node >= 18 script using native fetch, that verifies a deployed proxy via
four sequential checks — health, three `getBlockNumber` calls, one
`getBalance` call, and stats — printing a Chinese, human-readable report
(latency, `X-Cache` HIT/MISS, `X-Trace-Id`) ending with a ✅/❌ summary.
Exit codes SHALL be 0 when every critical request passed, 1 when any
critical request failed, and 2 on usage errors. `GET /api/v1/stats` SHALL be
optional: any of its failures is reported as skipped and SHALL NOT affect
the exit code. A missing health endpoint (HTTP 404/405 on
`GET /api/v1/health`) SHALL be skipped with an "older version" hint rather
than counted as a failure, so the script works against old deployments; a
health body with `status: "degraded"` SHALL count as a failure.

#### Scenario: Help output
```bash
node workers/scripts/smoke.mjs --help
# Prints usage (endpoint, --chain, --key, --address, exit codes) and exits 0
```

#### Scenario: Successful verification run
```bash
node workers/scripts/smoke.mjs https://your-proxy.workers.dev --key k1
# ① health ✅ status=ok  ② three getBlockNumber calls with cache=MISS/HIT
# ③ getBalance ✅ balance=2411.641970 ETH  ④ stats ✅
# → "✅ 验证通过：代理工作正常（区块请求缓存命中 2/3 …）", exit code 0
```

#### Scenario: Older deployment without health endpoint
```bash
# Deployment answers 404 on /api/v1/health:
# "⏭ HTTP 404：该部署未提供 /api/v1/health（版本较旧），跳过" — not a failure
# Remaining checks still run; exit code reflects only the critical requests
```

#### Scenario: Critical request failure fails the run
```bash
# getBlockNumber returns 500 three times:
# "❌ 验证失败：3 项关键检查未通过" + one bullet per failure, exit code 1
```

#### Scenario: Optional stats never fails the run
```bash
# /api/v1/stats answers 401 (key rejected) or 404 (no STATISTICS binding):
# "⏭ …，跳过" — exit code stays 0 when all critical checks passed
```

### Requirement: Smoke Script Configuration
The script SHALL accept a positional `<endpoint>` (http/https URL) plus
`--chain <id>` (positive integer, default 1), `--key <API_KEY>` (sent as
`X-API-Key` on every request, including health and stats), and
`--address <0x..>` (getBalance target, defaulting to a well-known public
address `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`); both
`--flag value` and `--flag=value` forms SHALL work, invalid input SHALL
produce a Chinese error plus usage on stderr with exit code 2. The workers
package SHALL expose the script as `pnpm smoke`. Argument parsing and URL
building SHALL live in exported pure helpers covered by tests.

#### Scenario: Flags reach the wire
```bash
node workers/scripts/smoke.mjs https://x.dev --chain 137 --key k1 --address 0xabc
# Requests hit /api/v1/137/getBlockNumber and /api/v1/137/getBalance with
# body {"address":"0xabc"}; every request carries X-API-Key: k1
```

#### Scenario: pnpm smoke alias
```bash
cd workers && pnpm smoke https://your-proxy.workers.dev
# Equivalent to `node scripts/smoke.mjs https://your-proxy.workers.dev`
```

#### Scenario: Usage errors
```bash
node workers/scripts/smoke.mjs                      # 缺少 <endpoint>, exit 2
node workers/scripts/smoke.mjs https://x.dev --chain abc   # 非正整数, exit 2
node workers/scripts/smoke.mjs https://x.dev --wat          # 未知参数, exit 2
```

#### Scenario: Exported helpers under test
```typescript
import { parseArgs, buildUrl, formatEther } from "../scripts/smoke.mjs";
// workers/test/smoke.test.ts covers defaults, both flag forms, every
// rejection case, trailing-slash-tolerant URL joining, and wei formatting
```
