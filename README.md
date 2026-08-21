# viem-proxy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

高性能的 Web3 RPC 缓存代理库，通过 Cloudflare CDN 优化区块链数据读取性能。

## 🚀 特性

- **🔄 完全兼容 viem**：零学习成本，直接替换即可使用
- **⚡ 极速缓存**：利用 Cloudflare CDN 全球网络加速
- **🎯 智能策略**：根据数据特性自动选择最优缓存策略
- **📦 模块化 Actions**：支持 tree-shaking，按需导入
- **🛡️ 自动回退**：代理失败时自动回退到原始 RPC
- **📊 性能监控**：客户端性能指标（P50/P95/P99、缓存命中率）+ 服务端统计端点
- **🔁 重试与链路追踪**：瞬时失败指数退避重试，`X-Trace-Id` 全链路关联
- **📦 批量请求与并发控制**：单次往返批量执行，服务端按链限流
- **🌍 多链支持**：支持所有 EVM 兼容链

## 📦 安装

```bash
# 使用 pnpm（推荐）
pnpm add viem-proxy

# 使用 npm
npm install viem-proxy

# 使用 yarn
yarn add viem-proxy
```

## 🎯 快速开始

### 方式 1：使用 createPublicClient（简单）

只需要将 `viem` 的导入替换为 `viem-proxy`：

```typescript
// 之前
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

// 现在
import { createPublicClient, http } from 'viem-proxy'
import { mainnet } from 'viem-proxy/chains'

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
  proxy: {
    enabled: true,
    endpoint: 'https://your-workers-domain.workers.dev'
  }
})

// API 使用完全相同
const balance = await client.getBalance({
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
})
```

### 方式 2：使用 extend 模式（推荐）

使用 viem 的 `extend` 模式，更灵活且支持 tree-shaking：

```typescript
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { proxyActions } from 'viem-proxy/actions'

const client = createPublicClient({
  chain: mainnet,
  transport: http()
}).extend(proxyActions({
  endpoint: 'https://your-workers-domain.workers.dev',
  fallback: true
}))

const balance = await client.getBalance({
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
})
```

> **严格 TypeScript / batch 注意**：viem 的客户端类型与运行时都保留 `batch`
> （multicall 配置）属性——`.extend(proxyActions(...))` 在严格类型检查下会因
> `batch()` 方法与其同名而报错，且 viem 的 extend 在运行时会剥离同名扩展属性，
> 因此 extend 模式下 `client.batch` 不可用（其余代理 action 正常）。
> 需要完整能力时，可改用方式 1，或用
> `const actions = proxyActions(withProxy(client, config))` 直接获取 actions 对象
> （`actions.batch(...)` 可用），或单独调用 `batchActions(requests, config)`。

### 方式 3：单独导入 Actions（最佳 tree-shaking）

按需导入单个 action，获得最佳的 tree-shaking 效果。用 `withProxy` 把代理配置挂到客户端上：

```typescript
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { withProxy } from 'viem-proxy'
import { getBalance, getBlockNumber, batchActions } from 'viem-proxy/actions'

const client = withProxy(
  createPublicClient({ chain: mainnet, transport: http() }),
  {
    endpoint: 'https://your-workers-domain.workers.dev',
    fallback: true
  }
)

// 代理配置已挂在 client 上，直接调用即可
const balance = await getBalance(client, {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
})

const blockNumber = await getBlockNumber(client)

// batchActions / preheatCache 也可不依赖 client，直接传配置调用
const results = await batchActions(
  [
    { id: 1, action: 'getBalance', args: { address: '0xd8dA...' } },
    { id: 2, action: 'getBlockNumber' }
  ],
  { endpoint: 'https://your-workers-domain.workers.dev' }
)
```

### 高级配置

```typescript
const client = createPublicClient({
  chain: mainnet,
  transport: http(),
  proxy: {
    enabled: true,
    endpoint: 'https://your-workers-domain.workers.dev',
    debug: true, // 开启调试模式
    fallback: true, // 启用自动回退
    timeout: 30000, // 请求超时时间
  }
})
```

## 📚 可用 Actions

以下 actions 支持代理：

| Action | 描述 | 优先级 |
|--------|------|--------|
| `getBalance` | 获取账户余额 | P0 |
| `getBlock` | 获取区块信息 | P0 |
| `getBlockNumber` | 获取最新区块号 | P0 |
| `getTransaction` | 获取交易信息 | P0 |
| `getTransactionReceipt` | 获取交易回执 | P0 |
| `readContract` | 读取合约 | P0 |
| `call` | 执行调用 | P1 |
| `estimateGas` | 估算 Gas | P1 |
| `getGasPrice` | 获取 Gas 价格 | P1 |
| `getLogs` | 获取日志 | P1 |
| `getCode` | 获取合约代码 | P1 |
| `getChainId` | 获取链 ID | P2 |
| `getTransactionCount` | 获取交易数（nonce） | P2 |
| `getStorageAt` | 获取存储槽值 | P2 |
| `getFeeHistory` | 获取历史费用信息 | P2 |
| `getBlobBaseFee` | 获取 blob 基础费用 | P2 |

## 🏗️ 部署 Workers

### 1. 克隆项目

```bash
git clone https://github.com/wmzy/viem-proxy.git
cd viem-proxy/workers
```

### 2. 安装依赖

```bash
pnpm install --prefer-offline --registry=https://registry.npmmirror.com
```

### 3. 配置环境

编辑 `wrangler.toml`：

```toml
name = "your-viem-proxy-workers"

[[durable_objects.bindings]]
name = "PROXY_STATE"
class_name = "ProxyState"

# 服务端统计（GET /api/v1/stats 需要）
[[durable_objects.bindings]]
name = "STATISTICS"
class_name = "Statistics"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ProxyState"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["Statistics"]

[vars]
ENVIRONMENT = "production"
MAX_RPC_CONCURRENCY = "10"  # 每条链允许的并发上游 RPC 调用数
```

### 4. 部署

```bash
# 开发环境
pnpm run dev

# 生产部署
pnpm run deploy
```

## 📚 API 文档

### 客户端配置

#### ProxyConfig

```typescript
type ProxyConfig = {
  enabled: boolean              // 是否启用代理
  endpoint: string             // Workers 端点
  timeout?: number             // 请求超时时间(ms)，默认 30000
  fallback?: boolean           // 是否启用回退，默认 true
  debug?: boolean              // 调试模式
  apiKey?: string              // API 认证密钥（对应 Workers 的 API_KEY）
  retryOptions?: {             // 瞬时失败重试策略
    attempts: number           // 总尝试次数（含首次请求），默认 3
    delay: number              // 重试基础延迟(ms)，指数退避，默认 500
  }
  compressionThreshold?: number // 参数压缩阈值
}
```

#### ProxyActionConfig（用于单独 actions）

```typescript
type ProxyActionConfig = {
  endpoint: string             // Workers 端点
  timeout?: number             // 请求超时时间(ms)
  fallback?: boolean           // 是否启用回退
  debug?: boolean              // 调试模式
  apiKey?: string              // API 认证密钥
  retryOptions?: {             // 瞬时失败重试策略
    attempts: number           // 总尝试次数（含首次请求）
    delay: number              // 重试基础延迟(ms)，指数退避
  }
}
```

### 扩展方法

通过 `viem-proxy` 的 `createPublicClient` 创建的客户端额外提供以下方法（`.extend(proxyActions(...))` 模式下 `batch` 不可用，见方式 2 的说明）：

```typescript
import type { PerformanceMetrics } from 'viem-proxy'

// 获取本地性能指标快照（同步方法，非 Promise）
// 返回 PerformanceMetrics：totalRequests、errorRate、cacheHits/cacheMisses、
// cacheHitRate、averageResponseTime、responseTimeP50/P95/P99、
// chainIds、strategyCounts、methodStats（分方法统计）
const stats: PerformanceMetrics = client.getCacheStats()
console.log(`命中率: ${(stats.cacheHitRate * 100).toFixed(1)}%`)

// 重置本地指标统计（同步方法）。仅清空客户端统计，
// 清除 CDN 缓存本身需要服务端支持，将在后续版本提供
client.clearCache()

// 批量执行多个 action：单次 POST /api/v1/batch 往返
// 单项隔离：某一项失败只会在该项结果中返回 error，其余照常
// 批量端点不可用时自动降级为串行单请求
const results = await client.batch([
  { id: 1, action: 'getBalance', args: { address: '0x...' } },
  { id: 2, action: 'getBlockNumber' },                        // 可省略 args
  { id: 3, action: 'getGasPrice', chainId: 137 }              // 可按项覆盖目标链
])
// results: Array<{ id: string | number, result?: unknown, blockNumber?: string,
//                  error?: { code: number, message: string } }>

// 预热缓存（逐项走压缩 GET 路径填充 CDN 缓存，并发度 5，永不抛错）
const { submitted, failed } = await client.preheatCache([
  { action: 'getBalance', args: { address: '0x...' } },
  { action: 'getBlockNumber' }
])

// 注册中间件（洋葱模型：先注册者在外层；中间件抛错则请求走回退/错误路径）
client.use(async (request, next) => {
  // 请求前处理（request: { functionName, chainId, args }）
  const response = await next(request)
  // 响应后处理
  return response
})
```

> `createPublicClient` 创建的客户端还提供 `getMetrics()` / `clearMetrics()`（async 别名，效果同 `getCacheStats()` / `clearCache()`）。

> 注意：单独 actions 导入（`viem-proxy/actions`）时不经过客户端，上述扩展方法不可用；但可单独导入等价函数：
> `batchActions(requests, config, chainId?)`、`preheatCache(requests, config?, chainId?)`、
> `addMiddleware(middleware)`（另有 `clearMiddlewares()` / `getMiddlewares()`）。

### 重试配置

针对瞬时失败（网络错误、超时、5xx、429）自动重试，指数退避（`delay * 2^n`）：

```typescript
const client = createPublicClient({
  chain: mainnet,
  transport: http(),
  proxy: {
    enabled: true,
    endpoint: 'https://your-workers-domain.workers.dev',
    retryOptions: {
      attempts: 3,  // 总尝试次数（含首次请求），默认 3
      delay: 500    // 基础延迟(ms)，实际等待 500ms → 1000ms，默认 500
    }
  }
})
```

- 重试只针对可重试错误；RPC 业务错误（如 `execution reverted`）不重试
- 所有重试复用同一个 `X-Trace-Id`，便于关联一次逻辑请求
- 重试耗尽后，若 `fallback: true` 则回退到原始 RPC
- `debug: true` 时每次重试会输出告警日志（含 trace id、退避时长）

### 链路追踪

每个代理请求自动携带 `X-Trace-Id`（12 位十六进制随机数）请求头；服务端原样回显该头，没有时生成新的。响应头 `X-Cache` 标明缓存状态（`HIT` / `MISS`）：

```typescript
// 也可用原生 fetch 观察这两个响应头（POST /api/v1/{chainId}/{action}，body 为参数 JSON）
const response = await fetch(
  'https://your-workers-domain.workers.dev/api/v1/1/getBalance',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 'abc123def456' },
    body: JSON.stringify({ address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' })
  }
)
console.log(response.headers.get('X-Trace-Id')) // 'abc123def456'（回显）
console.log(response.headers.get('X-Cache'))    // 'HIT' | 'MISS'
```

客户端指标（`getCacheStats()`）即从 `X-Cache` 响应头统计命中率。

### 服务端监控端点

Workers 提供 `GET /api/v1/stats`，返回服务端聚合统计（来自 Statistics Durable Object）：

```
GET /api/v1/stats?chainId=1&method=getBalance&hours=24
```

| 参数 | 说明 |
|------|------|
| `chainId` | 可选，按链过滤（非负整数） |
| `method` | 可选，按方法过滤（如 `getBalance`） |
| `hours` | 可选，聚合窗口小时数，默认 24，最大 720 |

```jsonc
{
  "totalRequests": 12345,
  "cacheHits": 9876,
  "cacheHitRate": 0.8,
  "averageResponseTime": 52.3,
  "errorCount": 12,
  "errorRate": 0.00097,
  "periods": [
    { "bucket": "2026-08-20T10:00:00.000Z", "count": 420, "errorCount": 0,
      "p50": 48.2, "p95": 120.5, "p99": 210.0 }
  ]
}
```

> `periods` 为按小时分桶（UTC）的明细，`bucket` 为桶起始时间，`p50/p95/p99` 为最近邻排名百分位，无样本时为 `null`。

### 批量与并发控制

- 客户端 `client.batch(items)`：一次 HTTP 往返执行多项，单项隔离
- 服务端单批上限 `MAX_BATCH_SIZE = 50`（超出返回 400）
- 服务端按链限制上游 RPC 并发，超出的请求进入 FIFO 队列排队（等待超过 10 秒失败）

Workers 环境变量（`workers/wrangler.toml` 的 `[vars]`）：

```toml
MAX_RPC_CONCURRENCY = "10"  # 每条链允许的并发上游 RPC 调用数
```

> `MAX_BATCH_SIZE`（50）为编译期常量，当前不支持环境变量调整。

## 🎯 缓存策略

### 自动缓存策略（与 `workers/src/utils/cache.ts` 实现一致）

| 数据类型 | 方法 | TTL |
|---------|------|-----|
| 历史交易数据 | `eth_getBlockByHash`、`eth_getTransactionByHash`、`eth_getTransactionReceipt` | 1 年 |
| Finalized 区块 | `eth_getBlockByNumber`、`eth_getStorageAt`（按块参数判定） | 30 天 |
| ≥ 2 epoch 历史块 | 同上 | 1 天 |
| ≥ 1 epoch 区块 | 同上 | 1 小时 |
| 较新区块 | 同上 | 5 分钟 |
| 最新数据 | `eth_blockNumber`、`eth_gasPrice`、`eth_estimateGas`、`eth_feeHistory`、`eth_blobBaseFee`、`latest`/`pending` 块参数 | 12 秒 |
| 账户状态 | `eth_getBalance`、`eth_call`、`eth_getTransactionCount` | 30 秒 |
| 合约代码 | `eth_getCode` | 5 分钟 |
| 网络信息 | `eth_chainId`、`net_version`、`web3_clientVersion` | 1 小时 |
| 日志查询 | `eth_getLogs` | 1 分钟 |
| 其他方法 | 默认 | 5 分钟 |

> epoch（区块确认档位）按链配置：Ethereum 32 块、BSC 200 块、Polygon 64 块、Arbitrum 32 块、Optimism 16 块、Avalanche 32 块。

### 请求去重

使用 Cloudflare Durable Objects 实现请求去重：
- 并发相同请求只执行一次 RPC 调用
- 等待中的请求共享结果
- 超时处理机制

## 🔧 开发

### 本地开发

```bash
# 安装依赖
pnpm install --prefer-offline --registry=https://registry.npmmirror.com

# 开发模式
pnpm run dev

# 构建
pnpm run build

# 测试
pnpm run test

# 类型检查
pnpm run typecheck
```

### 测试

```bash
# 运行所有测试
pnpm run test

# 测试覆盖率
pnpm run test:coverage

# 监听模式
pnpm run test --watch
```

## 📊 性能对比

| 场景 | 原始 RPC | viem-proxy (首次) | viem-proxy (缓存) | 提升 |
|------|----------|-------------------|-------------------|------|
| 获取余额 | 200ms | 180ms | 50ms | 75% ↑ |
| 读取合约 | 300ms | 250ms | 60ms | 80% ↑ |
| 获取区块 | 150ms | 130ms | 40ms | 73% ↑ |

## 🛠️ 故障排除

### 常见问题

1. **代理请求失败**
   ```typescript
   // 确保启用回退机制
   proxy: {
     enabled: true,
     endpoint: 'https://your-workers-domain.workers.dev',
     fallback: true // 重要！
   }
   ```

2. **缓存未命中**
   ```typescript
   // 检查参数是否一致
   proxy: {
     debug: true // 开启调试查看详细日志
   }
   ```

### 调试模式

```typescript
const client = createPublicClient({
  // ...
  proxy: {
    debug: true // 开启后会输出详细日志
  }
})
```

## 🤝 贡献

欢迎贡献代码！请查看 [贡献指南](CONTRIBUTING.md)。

## 📄 许可证

[MIT License](LICENSE)

## 🔗 相关链接

- [viem 官方文档](https://viem.sh)
- [Cloudflare Workers 文档](https://workers.cloudflare.com)
- [问题反馈](https://github.com/wmzy/viem-proxy/issues)
- [讨论区](https://github.com/wmzy/viem-proxy/discussions)

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**
