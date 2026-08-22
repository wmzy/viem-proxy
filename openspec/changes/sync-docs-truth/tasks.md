# 1. Documentation Sync

- [x] 1.1 Fix README「自动缓存策略」table: remove the unreachable `≥ 2 epoch → 1 天` / `≥ 1 epoch → 1 小时` tiers, document the two-tier block behavior cache.ts produces (finalized ≥ epoch → 30 天, < epoch → 5 分钟), extend the epoch note with the two-tier rule and a pointer to the drift guard
- [x] 1.2 Align PRD `1.1 客户端代理库` 缓存策略 bullets with `workers/src/utils/cache.ts` (fix `近期数据 10 分钟` / `合约常量 1 小时` drift, enumerate all implemented tiers with methods)
- [x] 1.3 Add README cache strategy drift guard to `workers/test/handlers.test.ts` (`Cache Utilities` describe): 9 probes re-derive documented TTLs via `getCacheStrategy` against the parsed README table; unprobed rows fail; verified the guard fails on the pre-fix table before fixing it

# 2. README Positioning & Honesty

- [x] 2.1 Add `🔍 为什么不用 Alchemy/Infura/dRPC 官方端点` section after `🚀 特性`: self-hosting/no lock-in, customizable cache policy, per-request billing savings, difference from viem `batch`/`fallback` transports
- [x] 2.2 Mark the `📊 性能对比` table as 示意值 and reference the upcoming `scripts/benchmark.mjs` (table kept)

# 3. Contributor & Release Infrastructure

- [x] 3.1 Create `CONTRIBUTING.md` (中文): dev environment, two-package layout, common commands, test placement rule, openspec flow, Conventional Commits, PR checklist
- [x] 3.2 Create `.github/workflows/release.yml`: publish root package on `v*` tags (`pnpm install --frozen-lockfile` → `pnpm build` → `npm publish` with `secrets.NPM_TOKEN`, node 20, pnpm/action-setup@v4, actions/setup-node@v4); workers stays unpublished (private)

# 4. Verification

- [x] 4.1 `cd workers && pnpm vitest run` green (121 tests, including the new drift guard)
- [x] 4.2 `cd workers && pnpm typecheck` clean
- [x] 4.3 `release.yml` parses as valid YAML (python3 yaml.safe_load; jobs/trigger verified)
- [x] 4.4 README local links resolve (`CONTRIBUTING.md`, `LICENSE`); no other dead local links
