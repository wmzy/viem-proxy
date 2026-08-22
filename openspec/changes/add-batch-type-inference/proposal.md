# Change: Add Batch Type Inference

## Why
`BatchResult.result` is `unknown`, so TypeScript users migrating from viem's typed actions lose type safety when using batch requests — item results must be cast manually (`as unknown`, manual assertions) before use. This violates the PRD promise of "保持类型安全" (preserve type safety).

## What Changes
- `BatchRequest<TAction>` and `BatchResult<TAction>` become generic over the batch action name (default `BatchActionName`, so existing unparameterized usages keep compiling):
  - `BatchRequest<TAction>.args` is typed by the per-action parameter type (`GetBalanceParameters`, `GetLogsParameters`, …) via a new action → parameters map; parameterless actions map to `undefined` (`args` omitted).
  - `BatchResult<TAction>.result` is typed by the corresponding per-action client function's return type (derived via `Awaited<ReturnType<...>>`, e.g. `getBalance` → `bigint`, `getChainId` → `number`, `getGasPrice` → `bigint`), so batch item results match single-action results exactly.
- New exported mapped types: `BatchResults<T>` (result list typed per item) and `BatchRequests<T>` (request list typed per item, used as a parameter constraint for per-item `args` validation).
- `batchActions` / `runNativeBatch` use `<const T extends readonly BatchRequest[]>` with an intersection parameter `T & BatchRequests<T>`: the `const` modifier preserves per-item literal action names in tuples (positional result inference: `results[0]` follows item 0's action), while the mapped member validates each item's `args` against its own action. Pre-typed arrays (`BatchRequest[]`, `BatchRequest<'getBalance'>[]`) remain accepted with union / per-action result types.
- `batchClientActions` returns a closure preserving the same inference; the `batchProxy` methods (`ProxyActions` object, `ProxyPublicClient` type) expose the same generic signature.
- Runtime behavior is unchanged (pure type-layer work): batch orchestration moves into a private `executeBatch` operating on untyped entries, typed once at the public API boundary via a single `as` cast per public entry point.
- Docs: README.md (方式 2 / 方式 3 / 扩展方法) and GETTING_STARTED.md (批量请求) examples now use `client.batchProxy` and demonstrate the inferred per-item result types without `as unknown`.
- New exports from `viem-proxy` and `viem-proxy/actions`: `BatchResults`, `BatchRequests`, `BatchActionParameters`, `BatchActionReturnType`.

## Impact
- Affected specs: `actions`
- Affected code:
  - `src/actions/batch.client.ts` — generic `BatchRequest`/`BatchResult`, `BatchRequests`/`BatchResults` mapped types, `BatchActionParameters`/`BatchActionReturnType`, parameter/return maps, `executeBatch` extraction, generic `batchActions`/`runNativeBatch`/`batchClientActions`
  - `src/actions/proxyActions.ts` — `batchProxy` generic signature
  - `src/types.ts` — `ProxyPublicClient.batchProxy` generic signature
  - `src/actions/index.ts`, `src/index.ts` — new type exports
  - `src/test/actions.test.ts` — type-level assertions (`expectTypeOf` + `@ts-expect-error`) and a runtime regression case
  - `README.md`, `GETTING_STARTED.md` — batch examples show type inference
- No breaking API changes: all existing call shapes (literals, pre-typed arrays, `readonly` arrays) compile unchanged; only the previously-`unknown` result types become precise.
