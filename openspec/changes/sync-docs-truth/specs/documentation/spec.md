# Delta: Documentation Truth Sync

## ADDED Requirements

### Requirement: README Cache Strategy Table Stays in Sync with cache.ts
The README「自动缓存策略」table SHALL document exactly the TTL tiers that `workers/src/utils/cache.ts` produces for each method class, and SHALL be guarded by a workers-suite drift test that parses the root `README.md` table, re-derives every documented row's TTL through `getCacheStrategy`, and fails when (a) a documented row's TTL differs from the value cache.ts produces, (b) a documented row has no matching probe, or (c) a tier cache.ts produces is undocumented.

#### Scenario: Changing a cache.ts TTL without updating README fails the workers suite
```bash
# Long-term cache changed from 30 days to 7 days in cache.ts:
cd workers && pnpm vitest run test/handlers.test.ts -t "README cache strategy drift guard"
# -> FAIL: README row "Finalized 区块" drifted from cache.ts (eth_getBlockByNumber -> 604800s)
```

#### Scenario: Documented tiers match reachable behavior
```typescript
// Block-scoped methods are documented as the two tiers cache.ts can produce:
getCacheStrategy(1, "eth_getBlockByNumber", ["0x1", true], 300, 0x100).ttl  // 2592000 -> README "Finalized 区块 | 30 天"
getCacheStrategy(1, "eth_getBlockByNumber", ["0x1f0", true], 300, 0x200).ttl // 300 -> README "较新区块 | 5 分钟"
// Unreachable tiers (e.g. "≥ 2 epoch -> 1 天") must not be documented.
```

#### Scenario: Adding a README row without a probe fails coverage
```markdown
<!-- A new row "| 新档位 | eth_newThing | 3 分钟 |" added to the table
     without a matching probe in the drift guard ->
     "has no documented row left unverified by a probe" FAILS -->
```

### Requirement: PRD Cache Strategy Matches Implementation
The PRD cache strategy description SHALL enumerate the same TTL tiers as `workers/src/utils/cache.ts` (the single source of truth), naming the methods behind each tier; it SHALL NOT describe TTL values or confirmation thresholds the implementation cannot produce.

#### Scenario: PRD bullets agree with cache.ts tiers
```markdown
<!-- PRD 1.1 缓存策略 lists: 历史交易数据 1 年, Finalized 区块 30 天, 较新区块 5 分钟,
     最新数据 12 秒, 账户状态 30 秒, 合约代码 5 分钟, 网络信息 1 小时, 日志查询 1 分钟,
     其他方法默认 5 分钟 — matching getCacheTtlByMethod case values;
     the pre-fix "近期数据 10 分钟" / "合约常量 1 小时" bullets are gone -->
```

### Requirement: README Positioning and Benchmark Honesty
README SHALL include a `🔍 为什么不用 Alchemy/Infura/dRPC 官方端点` section after `🚀 特性` covering self-hosted deployment without vendor lock-in, customizability of the cache policy, per-request billing savings from CDN hits that bypass the upstream quota, and the distinction from viem's official `batch`/`fallback` transports (request merging / failover, not CDN caching). The performance comparison table SHALL be kept but explicitly marked as 示意值 with a reference to the reproducible benchmark script `scripts/benchmark.mjs`.

#### Scenario: Positioning section distinguishes transport features from caching
```markdown
<!-- The section states that viem batch merges calls into one JSON-RPC request
     and fallback fails over upstreams — neither caches — while viem-proxy turns
     JSON-RPC POST into cacheable HTTP GET served at the CDN edge. -->
```

#### Scenario: Perf table marked illustrative
```markdown
<!-- "## 📊 性能对比" is preceded by a note calling the values 示意值 and
     referencing `scripts/benchmark.mjs`; the table itself is unchanged. -->
```

### Requirement: Contributing Guide
A `CONTRIBUTING.md` SHALL exist at the repository root (Chinese, consistent with README) covering the development environment (pnpm, Node >= 18), the two-package structure (root client library + private `workers/` sub-package), common commands for both packages, the test placement rule (append to existing describe blocks; new files only when nothing fits, with a header note), the openspec change flow, and Conventional Commits. The README 贡献 section SHALL link to it and the link SHALL resolve.

#### Scenario: README contributing link resolves
```bash
test -f CONTRIBUTING.md && grep -q 'CONTRIBUTING.md' README.md # both succeed
```

### Requirement: Tag-Triggered npm Release Workflow
A `.github/workflows/release.yml` SHALL publish the root package to npm when a `v*` tag is pushed, running `pnpm install --frozen-lockfile`, `pnpm build`, then `npm publish` authenticated with `secrets.NPM_TOKEN` (`NODE_AUTH_TOKEN`), on node 20 with `pnpm/action-setup@v4` and `actions/setup-node@v4`. The private `workers/` package SHALL NOT be published.

#### Scenario: Pushing a release tag publishes the root package
```bash
git tag v0.1.0 && git push origin v0.1.0
# -> Release workflow: install (frozen lockfile) -> build -> npm publish of viem-proxy
```

#### Scenario: Regular pushes never trigger a release
```bash
git push origin main # Release workflow does not run (tag trigger only)
```
