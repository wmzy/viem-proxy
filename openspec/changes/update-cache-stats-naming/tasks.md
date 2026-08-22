## 1. API Rename
- [x] 1.1 `ProxyPublicClient` (src/types.ts): rename `clearCache(): void` → `resetStats(): void` with a comment clarifying it resets local statistics only and does not purge the CDN cache
- [x] 1.2 `createPublicClient` helper methods (src/client.ts): rename to `resetStats`, debug log `[viem-proxy] Stats reset`
- [x] 1.3 `proxyActions` extension object (src/actions/proxyActions.ts): rename to `resetStats`
- [x] 1.4 Rename module-level `getMetricsCollector()` → `getSharedCollector()` in src/utils/metrics.ts; update the src/index.ts re-export and imports in src/client.ts, src/actions/proxyActions.ts, src/actions/utils.ts, src/actions/batch.client.ts

## 2. Remove Async Aliases
- [x] 2.1 Delete `getMetrics()`/`clearMetrics()` from `ProxyPublicClient` (src/types.ts) and the `createPublicClient` helpers (src/client.ts) — clean cutover, no aliases remain

## 3. Tests
- [x] 3.1 src/test/client.test.ts: presence/reset/debug-log cases use `resetStats`; remove the `getMetrics`/`clearMetrics` cases
- [x] 3.2 src/test/actions.test.ts: extension-object cases use `resetStats`; collector import renamed
- [x] 3.3 src/test/utils.test.ts: collector import/usage renamed

## 4. Docs
- [x] 4.1 README.md「扩展方法」节: `resetStats()` with stats-only note; remove the `getMetrics()`/`clearMetrics()` async-alias note
- [x] 4.2 GETTING_STARTED.md「指标采集」节: `resetStats()`
- [x] 4.3 examples/basic-usage.ts and examples/migration-guide.ts: `resetStats()`
- [x] 4.4 CLAUDE.md helper-method list updated

## 5. Verification
- [x] 5.1 `pnpm typecheck` passes
- [x] 5.2 `pnpm vitest run src/test/client.test.ts src/test/actions.test.ts` passes
- [x] 5.3 `grep -rn 'clearCache\|getMetrics\|clearMetrics' src README.md GETTING_STARTED.md examples` returns nothing
- [x] 5.4 openspec CLI unavailable locally (no binaries published) — delta format hand-verified against `openspec/AGENTS.md` conventions (ADDED/REMOVED headers, `#### Scenario:` per requirement)
