# Change: Update Batch Method Name

## Why
viem clients carry a core `batch` multicall config property, and viem's `client.extend()` strips any extension key that collides with a core client property (and type-rejects it under strict TypeScript via the `Extended` guard, which pins `batch?: undefined`). As a result, the proxy batch method exposed as `batch` was unusable in the extend pattern — the documented "方式 2" usage — which violates the project's core promise of full viem compatibility. Renaming the client-facing method to `batchProxy` removes the collision in every usage pattern. The package is unreleased (no npm publication), so this is a clean cutover with no aliases or deprecation paths.

## What Changes
- Client instance method `batch(requests)` → `batchProxy(requests)` in all three wiring points:
  - `src/client.ts` — `helperMethods` key on the `createPublicClient` wrapper (present on the returned client in both proxy-enabled and proxy-disabled paths)
  - `src/actions/proxyActions.ts` — `buildProxyActions` object key, therefore also the `ProxyActions` type
  - `src/types.ts` — `ProxyPublicClient` property
- Top-level function `batchActions(requests, config, chainId?)` keeps its name (it does not live on a viem client and never collided).
- Clean cutover: every `client.batch(...)` / `actions.batch(...)` usage across tests, examples, and docs is renamed; no alias, no deprecated path.
- Docs: README.md 方式 2 now shows `client.batchProxy(...)` working in extend mode and the long extend/batch conflict warning block is deleted; 扩展方法 and 批量与并发控制 sections, GETTING_STARTED.md, `examples/basic-usage.ts`, `examples/migration-guide.ts` updated.
- Tests: existing batch cases in `src/test/client.test.ts` and `src/test/actions.test.ts` renamed to `batchProxy`, plus new coverage that `batchProxy` survives viem's runtime extend-key stripping (the exact defect this change fixes).

## Impact
- Affected specs: `actions` (extend-pattern batch capability)
- Affected code: `src/client.ts`, `src/actions/proxyActions.ts`, `src/types.ts`, `src/test/client.test.ts`, `src/test/actions.test.ts`, `examples/basic-usage.ts`, `examples/migration-guide.ts`, `README.md`, `GETTING_STARTED.md`, `CLAUDE.md`
- Breaking: yes, but the package is unreleased (registry 404), so no migration surface exists
- `batchActions`, `BatchRequest`, `BatchResult`, `batchClientActions`, `runNativeBatch` and the workers `POST /api/v1/batch` endpoint are unchanged apart from reference-site key renames
