# Change: Sync Docs with Implementation Truth

## Why
The docs had drifted from the code and were missing contributor-facing artifacts: the README cache strategy table documented TTL tiers (`≥ 2 epoch → 1 天`, `≥ 1 epoch → 1 小时`) that `workers/src/utils/cache.ts` can never produce (any block with confirmations ≥ epoch is classified finalized → 30 days, making the 1-day/1-hour branches unreachable); the PRD cache strategy bullets (`近期数据 10 分钟`, `合约常量 1 小时`) never matched the implementation; `README.md` links to `CONTRIBUTING.md` which did not exist; the perf comparison table presented illustrative numbers without saying so; and publishing npm releases required a manual process.

## What Changes
- **README cache table fixed**: the two unreachable tiers are removed; block-scoped methods are documented as the two-tier behavior cache.ts actually produces (`finalized` 标签或确认数 ≥ epoch → 30 天；< epoch → 5 分钟), with the per-chain epoch note extended and a pointer to the drift guard
- **Drift guard test**: `workers/test/handlers.test.ts` gains `README cache strategy drift guard` inside the existing `Cache Utilities` describe block. Nine probes re-derive each documented row's TTL via `getCacheStrategy` and compare it to the parsed root `README.md` table (`| 数据类型 | 方法 | TTL |`); a second test fails when the table has a row no probe verifies. Changing `cache.ts` TTLs or editing the table without syncing the other side fails the workers suite
- **PRD aligned**: the `1.1 客户端代理库` 缓存策略 bullets now enumerate the implemented tiers with methods and the epoch note, matching `cache.ts` as the single source of truth
- **README positioning section**: new `🔍 为什么不用 Alchemy/Infura/dRPC 官方端点` section after `🚀 特性` — self-hosted/no vendor lock-in, fully customizable cache policy, per-request billing savings (CDN hits never touch the upstream quota), and the distinction from viem's official `batch` (request merging) / `fallback` (failover) transports, which cache nothing
- **Perf table honesty**: the `📊 性能对比` table is kept but marked as 示意值 with a forward reference to the upcoming reproducible `scripts/benchmark.mjs` (next wave)
- **CONTRIBUTING.md**: new Chinese contributing guide covering the dev environment (pnpm, Node >= 18), the two-package layout (root client library + private `workers/` sub-package), common commands per package, the test placement rule (append to existing describe blocks; new files only when nothing fits, with a header note), the openspec change flow, Conventional Commits, and the PR checklist
- **Release workflow**: new `.github/workflows/release.yml` mirroring `ci.yml` style — on push of a `v*` tag, the root package publishes to npm (`pnpm install --frozen-lockfile` → `pnpm build` → `npm publish` with `secrets.NPM_TOKEN` via `NODE_AUTH_TOKEN`, node 20, `pnpm/action-setup@v4`, `actions/setup-node@v4`). The `workers/` package is private and is deployed with wrangler, never published

## Impact
- Affected specs: `documentation` (new capability)
- Affected files: `README.md` (cache table + note, new positioning section, perf table annotation), `PRD.md` (缓存策略 bullets only), `workers/test/handlers.test.ts` (+`node:fs` import, +drift guard describe), `CONTRIBUTING.md` (new), `.github/workflows/release.yml` (new)
- No source symbols in `src/` or `workers/src/` are touched; no runtime behavior changes
