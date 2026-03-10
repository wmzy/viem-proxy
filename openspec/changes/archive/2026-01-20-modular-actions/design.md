# Design: Modular Actions

## Context
viem-proxy 需要支持模块化的 actions 导入，与 viem 的设计模式保持一致。

### 当前架构
```typescript
// 所有 actions 硬编码在 createPublicClient 中
const client = createPublicClient({
  chain: mainnet,
  proxy: { endpoint: "..." }
})
// 无法单独导入 action
```

### 目标架构
```typescript
// 方式 1: 使用 extend 模式
import { createPublicClient } from 'viem-proxy'
import { proxyActions } from 'viem-proxy/actions'

const client = createPublicClient({ chain: mainnet })
  .extend(proxyActions({ endpoint: "..." }))

// 方式 2: 单独导入 action
import { createPublicClient } from 'viem'
import { getBalance } from 'viem-proxy/actions'

const balance = await getBalance(client, { 
  address: "0x...",
  proxy: { endpoint: "..." }
})
```

## Goals / Non-Goals

### Goals
- 支持从 `viem-proxy/actions` 单独导入 actions
- 支持 `client.extend(proxyActions(config))` 模式
- 支持 tree-shaking
- 保持向后兼容（现有 API 继续工作）

### Non-Goals
- 不改变 Workers 端实现
- 不改变缓存策略

## Decisions

### Decision 1: Action 函数签名
**选择**: 遵循 viem 的签名模式

**实现**:
```typescript
// 独立使用
export async function getBalance(
  client: Client,
  args: GetBalanceParameters & { proxy?: ProxyConfig }
): Promise<GetBalanceReturnType>

// extend 模式
export function proxyActions(config: ProxyConfig) {
  return (client: Client) => ({
    getBalance: (args) => getBalance(client, { ...args, proxy: config }),
    // ... other actions
  })
}
```

**原因**:
- 与 viem 保持一致
- 支持两种使用模式
- 类型安全

### Decision 2: 文件结构
**选择**: 每个 action 使用 `.client.ts` / `.server.ts` 后缀区分

```
src/actions/
├── index.ts                    # 导出所有 client actions
├── types.ts                    # 共享类型定义
├── utils.ts                    # 共享工具函数
├── getBalance.client.ts        # 客户端实现
├── getBalance.server.ts        # 服务端实现 (Workers handler)
├── getBlock.client.ts
├── getBlock.server.ts
├── getBlockNumber.client.ts
├── getBlockNumber.server.ts
├── getTransaction.client.ts
├── getTransaction.server.ts
├── getTransactionReceipt.client.ts
├── getTransactionReceipt.server.ts
├── readContract.client.ts
├── readContract.server.ts
├── call.client.ts
├── call.server.ts
├── estimateGas.client.ts
├── estimateGas.server.ts
├── getGasPrice.client.ts
├── getGasPrice.server.ts
├── getLogs.client.ts
├── getLogs.server.ts
├── getCode.client.ts
├── getCode.server.ts
└── proxyActions.ts             # extend 辅助函数

workers/src/
├── index.ts                    # 导入 server actions
└── handlers/
    └── actions.ts              # 统一注册 server actions
```

**原因**:
- 清晰区分 client/server 代码
- 同一个 action 的两端实现放在一起，便于维护
- 支持 tree-shaking (client 端不会打包 server 代码)
- Workers 可以按需导入 server actions

### Decision 3: Package Exports
**选择**: 添加 `/actions` 子路径

```json
{
  "exports": {
    ".": { ... },
    "./actions": {
      "types": "./dist/actions/index.d.ts",
      "import": "./dist/actions/index.mjs",
      "require": "./dist/actions/index.js"
    }
  }
}
```

**原因**:
- 与 viem 的 `viem/actions` 保持一致
- 支持按需导入

### Decision 4: 向后兼容
**选择**: 保留 `createPublicClient` 的 `proxy` 配置

```typescript
// 旧方式继续工作
const client = createPublicClient({
  chain: mainnet,
  proxy: { endpoint: "..." }
})

// 新方式
const client = createPublicClient({ chain: mainnet })
  .extend(proxyActions({ endpoint: "..." }))
```

**原因**:
- 不破坏现有用户代码
- 渐进式迁移

## Risks / Trade-offs

### Risk 1: Bundle Size
- **风险**: 多文件可能增加总 bundle size
- **缓解**: 使用 tree-shaking，只打包使用的 actions

### Risk 2: 类型复杂性
- **风险**: 泛型类型可能变得复杂
- **缓解**: 使用 `any` 类型断言简化，保持 API 类型安全

## Migration Plan

### Phase 1: 创建 actions 模块
1. 创建 `src/actions/` 目录
2. 拆分 `proxy-actions.ts` 为独立文件
3. 创建 `proxyActions` extend 函数

### Phase 2: 更新构建配置
1. 更新 `vite.config.ts` 添加 actions 入口
2. 更新 `package.json` exports

### Phase 3: 更新 client
1. 更新 `createPublicClient` 使用 extend 模式
2. 保持向后兼容

### Rollback
- 保留旧的 `proxy-actions.ts` 直到确认新架构稳定
