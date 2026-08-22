# Change: Update Cache Stats API Naming

## Why
`clearCache()` is misleading API naming: the method only resets the locally collected client-side metrics and never purges the CDN cache (purging requires server-side support, a later-version capability). The async aliases `getMetrics()`/`clearMetrics()` duplicate `getCacheStats()`/reset under inconsistent names. The package is unpublished (npm registry 404), so a clean cutover with no aliases or deprecated paths is safe.

## What Changes
- **BREAKING** Rename `clearCache()` → `resetStats()` (still synchronous `void`) on `ProxyPublicClient` (`src/types.ts`), the `createPublicClient` helper methods (`src/client.ts`) and the `proxyActions(client)` extension object (`src/actions/proxyActions.ts`). Code comments and docs state explicitly that it resets local statistics only and does not purge the CDN cache; the debug log line becomes `[viem-proxy] Stats reset`.
- **BREAKING** Remove the async aliases `getMetrics(): Promise<PerformanceMetrics>` and `clearMetrics(): Promise<boolean>` from `ProxyPublicClient` and `createPublicClient`. The synchronous `getCacheStats(): PerformanceMetrics` remains the single canonical metrics reader.
- Rename the module-level metrics accessor `getMetricsCollector()` → `getSharedCollector()` in `src/utils/metrics.ts` (re-exported from `src/index.ts`) so no public export carries the removed `getMetrics` prefix; internal call sites in `src/client.ts`, `src/actions/proxyActions.ts`, `src/actions/utils.ts`, `src/actions/batch.client.ts` and tests follow.
- Update tests in `src/test/client.test.ts` and `src/test/actions.test.ts`; sync docs: README.md（扩展方法节，删除 async 别名说明）, GETTING_STARTED.md, examples/basic-usage.ts, examples/migration-guide.ts, CLAUDE.md.

## Impact
- Affected specs: `client-metrics`
- Affected code:
  - `src/types.ts` — `ProxyPublicClient`: `clearCache` → `resetStats`; drop `getMetrics`/`clearMetrics`
  - `src/client.ts` — helper methods rename/removal, collector import rename
  - `src/actions/proxyActions.ts` — extension object rename, collector import rename
  - `src/utils/metrics.ts`, `src/index.ts`, `src/actions/utils.ts`, `src/actions/batch.client.ts` — `getSharedCollector` rename
  - `src/test/client.test.ts`, `src/test/actions.test.ts`, `src/test/utils.test.ts` — updated usages
- Docs: README.md, GETTING_STARTED.md, examples/basic-usage.ts, examples/migration-guide.ts, CLAUDE.md
- Not in scope: server-side cache purge API and fallback metrics (later wave); batch symbols and `BatchRequest`/`BatchResult` types (owned by sibling tasks)
