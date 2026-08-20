## 1. Workers Server Handlers
- [x] 1.1 Create `workers/src/actions/getChainId.server.ts` mapping to `eth_chainId` (no params)
- [x] 1.2 Create `workers/src/actions/getTransactionCount.server.ts` mapping to `eth_getTransactionCount` with `blockTag`/hex-encoded `blockNumber` (default `latest`)
- [x] 1.3 Create `workers/src/actions/getStorageAt.server.ts` mapping to `eth_getStorageAt` with `[address, slot, blockParam]`
- [x] 1.4 Create `workers/src/actions/getFeeHistory.server.ts` mapping to `eth_feeHistory` with `[hex(blockCount), blockParam, rewardPercentiles]`; pass through the raw RPC payload and surface `oldestBlock` as `blockNumber`
- [x] 1.5 Create `workers/src/actions/getBlobBaseFee.server.ts` mapping to `eth_blobBaseFee` (no params)
- [x] 1.6 Register all 5 handlers in `actionHandlers` (`workers/src/actions/index.ts`) and `ACTION_TO_RPC_METHOD` (`workers/src/handlers/actions.ts`)

## 2. Workers Cache TTL Policy
- [x] 2.1 Extract the block-aware confirmation-tier logic shared by `eth_getBlockByNumber` into `getBlockParamTtl` (finalized → 30 days, 2+ epochs → 1 day, 1 epoch → 1 hour, recent → 5 min, `latest`/`pending` → 12s, fallback 300s)
- [x] 2.2 `eth_getStorageAt`: replace the flat 300s TTL with `getBlockParamTtl(params[2], ...)` block-aware tiers
- [x] 2.3 `eth_chainId`: 3600s (network info group); `eth_getTransactionCount`: keep 30s; `eth_feeHistory` and `eth_blobBaseFee`: 12s (latest-data group)

## 3. Client Actions
- [x] 3.1 Create the 5 `.client.ts` actions following the `getBalance.client.ts` pattern (withProxy config read, proxy GET via `makeProxyRequest`, fallback to the native viem action unless `fallback: false`)
- [x] 3.2 Type conversions: `getChainId`/`getTransactionCount` hex → number; `getStorageAt` slot number/bigint → hex, result passthrough; `getFeeHistory` → bigint-based `{ baseFeePerGas, gasUsedRatio, oldestBlock, reward? }` (reward omitted when absent); `getBlobBaseFee` → bigint
- [x] 3.3 Export actions + parameter/return types from `src/actions/index.ts`
- [x] 3.4 Add the 5 actions to the `proxyActions` extension object (`src/actions/proxyActions.ts`)
- [x] 3.5 Extend `BatchActionName` and the native action runners in `src/actions/batch.client.ts`
- [x] 3.6 Leave `src/index.ts` unchanged, matching the existing convention (per-action exports live under `viem-proxy/actions` only)

## 4. Tests
- [x] 4.1 Workers `test/handlers.test.ts`: per-handler execution + RPC method/params mapping (`eth_chainId`, `eth_getTransactionCount` incl. blockNumber encoding, `eth_getStorageAt`, `eth_feeHistory` incl. percentile params and `oldestBlock` bubble-up, `eth_blobBaseFee`)
- [x] 4.2 Workers cache strategy: TTLs for `eth_chainId` (3600), `eth_getTransactionCount` (30), `eth_feeHistory` (12), `eth_blobBaseFee` (12), `eth_getStorageAt` block-aware (latest → 12, recent → 300, finalized → 2592000)
- [x] 4.3 Client `src/test/actions.test.ts`: proxy-path mocks with type-conversion assertions (extend pattern + standalone), fallback-on-error per action, throw-when-fallback-disabled per action, direct viem path per action

## 5. Verification
- [x] 5.1 `workers`: `npx vitest run` all green (89 tests) and `npx tsc --noEmit` clean
- [x] 5.2 root: `npm run test` all green (311 tests) and `npm run typecheck` clean
- [x] 5.3 `openspec validate add-p2-actions --strict --no-interactive` passes
