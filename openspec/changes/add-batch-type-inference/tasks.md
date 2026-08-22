## 1. Type Layer
- [x] 1.1 Build the action → parameters map from the per-action `*.client.ts` `Parameters` types (parameterless actions map to `undefined`) and the action → return map from each client action's return type (`Awaited<ReturnType<...>>`)
- [x] 1.2 Genericize `BatchRequest<TAction>` (`args?: BatchActionParameters<TAction>`) and `BatchResult<TAction>` (`result?: BatchActionReturnType<TAction>`), defaulting `TAction` to `BatchActionName` for backward compatibility
- [x] 1.3 Add mapped tuple types `BatchRequests<T>` / `BatchResults<T>`; evaluate mapped-tuple inference and land it via `<const T extends readonly BatchRequest[]>` + intersection parameter `T & BatchRequests<T>` (positional result inference + per-item args validation)
- [x] 1.4 Export `BatchResults`, `BatchRequests`, `BatchActionParameters`, `BatchActionReturnType` from `src/actions/index.ts` and `src/index.ts`

## 2. Signatures
- [x] 2.1 `batchActions(actions, config, defaultChainId?)`: generic signature with unchanged runtime behavior (orchestration extracted into private `executeBatch`, typed at the boundary with a single cast)
- [x] 2.2 `runNativeBatch(client, actions)`: same generic signature (native path)
- [x] 2.3 `batchClientActions(client)`: returned closure preserves item-type inference
- [x] 2.4 `batchProxy` on the `ProxyActions` object and `ProxyPublicClient` type: same generic signature (keeps the `batchProxy` naming contract)

## 3. Tests
- [x] 3.1 `expectTypeOf` cases in the existing batch describe of `src/test/actions.test.ts`: `getBalance` item → `bigint`, `getBlockNumber` item → `bigint`, `getChainId` item → `number`, mapped-tuple shape, negative assertion via `@ts-expect-error`, per-item args validation, pre-typed array fallback, bound `batchProxy` inference
- [x] 3.2 Runtime regression case: happy path + serial fallback round trip unchanged after genericization

## 4. Docs
- [x] 4.1 README.md: 方式 2 / 方式 3 / 扩展方法 batch examples use `client.batchProxy` and show inferred per-item result types (no `as unknown`)
- [x] 4.2 GETTING_STARTED.md: 批量请求 section shows per-item type inference

## 5. Verification
- [x] 5.1 `pnpm typecheck` clean
- [x] 5.2 `pnpm vitest run src/test/actions.test.ts` green (133 tests)
- [x] 5.3 openspec change directory `add-batch-type-inference` created with checked tasks

## 6. Runtime Normalization (proxy path)
- [x] 6.1 Extract each single-action client's proxy-path decode into an exported pure function (`decodeGetBalanceResult`, `decodeGetBlockNumberResult`, `decodeEstimateGasResult`, `decodeGetGasPriceResult`, `decodeGetBlobBaseFeeResult`, `decodeGetChainIdResult`, `decodeGetTransactionCountResult`, `decodeReadContractResult`, exported `formatFeeHistory` + `RpcFeeHistory`) and use it inside the original functions — single-action behavior unchanged
- [x] 6.2 In `batch.client.ts`, normalize proxy-path success items (batch endpoint + serial fallback) through a per-action decoder map; error items, actions without a decoder (passthrough single-action paths), and the native path stay untouched
- [x] 6.3 Keep per-item isolation: a decode failure turns only that item into an `error` entry (`Failed to decode <action> result: …`), and metrics record it as a failure (normalize before `recordBatchMetrics`)
- [x] 6.4 Tests in the existing batch describe of `src/test/actions.test.ts`: per-action normalization (getBalance → bigint, readContract → ABI-decoded value, getFeeHistory → formatted shape, getChainId → number), ABI-less readContract passthrough, per-item decode-failure isolation; update the existing wire-value assertions to normalized values
- [x] 6.5 `src/test/client.test.ts` batchProxy assertion migrated to the normalized value
