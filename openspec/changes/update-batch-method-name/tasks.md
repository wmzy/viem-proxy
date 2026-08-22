## 1. Rename the client batch method
- [x] 1.1 `src/client.ts`: rename the `helperMethods` key `batch` → `batchProxy` (wired via `batchClientActions(actionClient)`) and update the surrounding comment
- [x] 1.2 `src/actions/proxyActions.ts`: rename the `buildProxyActions` key `batch` → `batchProxy` (flows into the `ProxyActions` type)
- [x] 1.3 `src/types.ts`: rename the `ProxyPublicClient` property `batch` → `batchProxy`
- [x] 1.4 Keep the top-level function `batchActions(requests, config, chainId?)` unchanged

## 2. Clean cutover
- [x] 2.1 Rename all `client.batch(...)` / `actions.batch(...)` usages in `src/test/actions.test.ts` and `src/test/client.test.ts`; no aliases left behind
- [x] 2.2 Add tests: `batchProxy` survives viem's runtime `extend` key-stripping (extend mode) and is present on the `createPublicClient` wrapper
- [x] 2.3 `grep -r '\.batch(' src examples README.md GETTING_STARTED.md` returns no client-method usages (`batchActions(` / `batchProxy(` unaffected)

## 3. Documentation
- [x] 3.1 README.md: 方式 2 shows `client.batchProxy(...)` in extend mode; delete the extend/batch conflict warning block; update 扩展方法 and 批量与并发控制 sections
- [x] 3.2 GETTING_STARTED.md: batch example uses `client.batchProxy(...)`
- [x] 3.3 `examples/basic-usage.ts` / `examples/migration-guide.ts`: rename usages and refresh the extend-pattern comments

## 4. Verification
- [x] 4.1 `pnpm typecheck` passes
- [x] 4.2 `pnpm vitest run src/test/client.test.ts src/test/actions.test.ts` passes
- [x] 4.3 openspec CLI unavailable (`npx openspec` cannot resolve the executable) — validation skipped per convention; delta follows the ADDED/REMOVED + Scenario format
