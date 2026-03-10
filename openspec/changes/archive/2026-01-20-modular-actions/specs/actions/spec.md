# Spec: Actions Module

## Overview
模块化的 proxy actions，支持单独导入和 tree-shaking。

## ADDED Requirements

### Requirement: Individual Action Import
每个 proxy action SHALL 可以从 `viem-proxy/actions` 单独导入。

#### Scenario: Import single action
```typescript
import { getBalance } from 'viem-proxy/actions'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const client = createPublicClient({
  chain: mainnet,
  transport: http()
})

const balance = await getBalance(client, {
  address: '0x...',
  proxy: { endpoint: 'https://proxy.example.com' }
})
```

### Requirement: Extend Pattern Support
库 SHALL 提供 `proxyActions` 函数用于 `client.extend()` 模式。

#### Scenario: Extend client with proxy actions
```typescript
import { createPublicClient, http } from 'viem'
import { proxyActions } from 'viem-proxy/actions'
import { mainnet } from 'viem/chains'

const client = createPublicClient({
  chain: mainnet,
  transport: http()
}).extend(proxyActions({ 
  endpoint: 'https://proxy.example.com',
  fallback: true
}))

// All proxy actions are now available
const balance = await client.getBalance({ address: '0x...' })
const block = await client.getBlock()
```

### Requirement: Action Function Signature
每个 action 函数 SHALL 接受 client 作为第一个参数，args 作为第二个参数。

#### Scenario: Action function signature
```typescript
// Function signature
async function getBalance(
  client: Client,
  args: GetBalanceParameters & { proxy?: ProxyConfig }
): Promise<GetBalanceReturnType>

// Usage
const balance = await getBalance(client, {
  address: '0x...',
  proxy: { endpoint: '...' }
})
```

### Requirement: Fallback Behavior
当 proxy 请求失败且 `fallback: true` 时，action SHALL 回退到原始 viem action。

#### Scenario: Fallback on proxy failure
```typescript
const balance = await getBalance(client, {
  address: '0x...',
  proxy: { 
    endpoint: 'https://failing-proxy.com',
    fallback: true  // Will fallback to direct RPC
  }
})
// Returns balance from direct RPC call
```

### Requirement: Tree-Shaking Support
未使用的 actions SHALL NOT 被包含在最终 bundle 中。

#### Scenario: Only import used actions
```typescript
// Only getBalance is bundled
import { getBalance } from 'viem-proxy/actions'

// Other actions like getBlock, readContract are NOT bundled
```

### Requirement: Backward Compatibility
现有的 `createPublicClient` with `proxy` 配置 SHALL 继续工作。

#### Scenario: Existing API still works
```typescript
import { createPublicClient } from 'viem-proxy'
import { mainnet } from 'viem/chains'

// Old API continues to work
const client = createPublicClient({
  chain: mainnet,
  proxy: {
    endpoint: 'https://proxy.example.com'
  }
})

const balance = await client.getBalance({ address: '0x...' })
```

### Requirement: Type Safety
所有 actions SHALL 保持完整的 TypeScript 类型支持。

#### Scenario: Type inference works
```typescript
import { getBalance, readContract } from 'viem-proxy/actions'

// Return type is inferred as bigint
const balance = await getBalance(client, { address: '0x...' })

// Return type is inferred from ABI
const result = await readContract(client, {
  address: '0x...',
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: ['0x...']
})
// result type is bigint (from ABI)
```

### Requirement: Client Server Separation
每个 action SHALL 分为 `.client.ts` 和 `.server.ts` 两个文件。

#### Scenario: File naming convention
```
src/actions/
├── getBalance.client.ts   # 客户端: 发送请求到 proxy server
├── getBalance.server.ts   # 服务端: Workers 处理请求
├── getBlock.client.ts
├── getBlock.server.ts
└── ...
```

### Requirement: Server Action Registration
Server actions SHALL 可以在 Workers 中统一注册。

#### Scenario: Register server actions in Workers
```typescript
// workers/src/handlers/actions.ts
import { getBalanceHandler } from '../../src/actions/getBalance.server'
import { getBlockHandler } from '../../src/actions/getBlock.server'

export const actionHandlers = {
  getBalance: getBalanceHandler,
  getBlock: getBlockHandler,
  // ...
}

// workers/src/index.ts
app.post('/api/v1/:chainId/:action', async (c) => {
  const handler = actionHandlers[c.req.param('action')]
  return handler(c)
})
```

## Supported Actions

P0 (High Priority):
- `getBalance` (`.client.ts` + `.server.ts`)
- `getBlock` (`.client.ts` + `.server.ts`)
- `getBlockNumber` (`.client.ts` + `.server.ts`)
- `getTransaction` (`.client.ts` + `.server.ts`)
- `getTransactionReceipt` (`.client.ts` + `.server.ts`)
- `readContract` (`.client.ts` + `.server.ts`)

P1 (Medium Priority):
- `call` (`.client.ts` + `.server.ts`)
- `estimateGas` (`.client.ts` + `.server.ts`)
- `getGasPrice` (`.client.ts` + `.server.ts`)
- `getLogs` (`.client.ts` + `.server.ts`)
- `getCode` (`.client.ts` + `.server.ts`)
