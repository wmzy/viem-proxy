# Change: Add P2 Read Actions

## Why
PRD 阶段 2「支持所有 viem 读操作 API」目前覆盖 11 个 actions；剩余高频 P2 读操作（getChainId、getTransactionCount、getStorageAt、getFeeHistory、getBlobBaseFee）仍会绕过 proxy 直连 RPC，无法享受 CDN 缓存、请求去重与观测能力。本变更按既有 action 模式成对补齐客户端与 Workers 服务端实现。

## What Changes
- Workers：新增 5 个 server handler 并注册进 `actionHandlers` 与 `ACTION_TO_RPC_METHOD`：
  - `getChainId` → `eth_chainId`（无参数）
  - `getTransactionCount` → `eth_getTransactionCount`（`[address, blockTag|hex(blockNumber)]`）
  - `getStorageAt` → `eth_getStorageAt`（`[address, slot, blockTag|hex(blockNumber)]`）
  - `getFeeHistory` → `eth_feeHistory`（`[hex(blockCount), blockTag|hex(blockNumber), rewardPercentiles]`，响应透传原始 RPC 结构，`oldestBlock` 冒泡为 `blockNumber`）
  - `getBlobBaseFee` → `eth_blobBaseFee`（无参数）
- Workers 缓存策略（`getCacheTtlByMethod`）：`eth_chainId` 1 小时；`eth_getTransactionCount` 30 秒（既有条目）；`eth_getStorageAt` 从固定 300 秒改为按块参数走区块感知逻辑（抽取 `getBlockParamTtl` 与 `eth_getBlockByNumber` 共享：finalized → 30 天、确认数分档、`latest`/`pending` → 12 秒、兜底 300 秒）；`eth_feeHistory`、`eth_blobBaseFee` 12 秒。
- Client：新增 5 个 `.client.ts` action，模式与 `getBalance.client.ts` 同构（withProxy 配置读取、代理 GET 请求、fallback 回退 viem 原生 action）：
  - `getChainId()` → `number`（hex → number）
  - `getTransactionCount({ address, blockTag?, blockNumber? })` → `number`
  - `getStorageAt({ address, slot, blockTag?, blockNumber? })` → hex string（`slot` 接受 hex/number/bigint，number/bigint 序列化为 hex）
  - `getFeeHistory({ blockCount, blockTag?, blockNumber?, rewardPercentiles? })` → `{ baseFeePerGas: bigint[], gasUsedRatio: number[], oldestBlock: bigint, reward?: bigint[][] }`
  - `getBlobBaseFee()` → `bigint`
- Client 聚合：`src/actions/index.ts` 导出 action 与参数/返回类型；`proxyActions` 扩展对象新增 5 个方法；`BatchActionName` 联合类型与 native runner 补充 5 个 action（batch/无 proxy 原生路径自动可用）。
- 不修改 `src/index.ts`：与既有 11 个 action 的约定一致，per-action 函数与类型仅从 `viem-proxy/actions` 子路径导出，避免与 `export * from "viem"` 的同名导出冲突。

## Impact
- Affected specs: `actions`, `workers-backend`
- Affected code:
  - `workers/src/actions/{getChainId,getTransactionCount,getStorageAt,getFeeHistory,getBlobBaseFee}.server.ts` — 新增
  - `workers/src/actions/index.ts` — 导出与 `actionHandlers` 注册
  - `workers/src/handlers/actions.ts` — `ACTION_TO_RPC_METHOD` 映射
  - `workers/src/utils/cache.ts` — 抽取 `getBlockParamTtl` 共享助手；新 TTL 条目
  - `src/actions/{getChainId,getTransactionCount,getStorageAt,getFeeHistory,getBlobBaseFee}.client.ts` — 新增
  - `src/actions/index.ts`、`src/actions/proxyActions.ts`、`src/actions/batch.client.ts` — 聚合导出/扩展
  - `workers/test/handlers.test.ts`、`src/test/actions.test.ts` — 既有 describe 内追加用例
- No breaking API changes：全部为新增 action/TTL 条目；唯一行为调整是 `eth_getStorageAt` 的缓存 TTL 从固定 300 秒变为区块感知分档（finalized 块缓存更久，`latest` 缓存更短）。
