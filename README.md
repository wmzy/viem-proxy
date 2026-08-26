# viem-proxy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wmzy/viem-proxy/tree/main/workers)

高性能的 Web3 RPC 缓存代理库，通过 Cloudflare CDN 优化区块链数据读取性能。

> 点击上方的 **Deploy to Cloudflare** 按钮即可一键部署 Workers 后端（Durable Objects 会自动创建和绑定），无需克隆仓库和手动配置。部署完成后回到这里的「快速开始」连接你的端点即可。

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

## 🔍 为什么不用 Alchemy/Infura/dRPC 官方端点

托管 RPC 端点开箱即用，但 viem-proxy 解决的是它们不覆盖的问题：

- **自部署、无供应商锁定**：端点是你自己部署的 Cloudflare Workers，上游 `RPC_URLS` 随时可换（Alchemy → 公共节点 → 自建节点），客户端代码一行不用改。数据路径完全在你手里，不受任何一家供应商的配额策略、定价调整或服务下线影响。
- **缓存策略完全可自定义**：TTL 按「数据特性 × 区块确认度」分档，全部集中在 `workers/src/utils/cache.ts` 一个文件里。fork 之后改几行就能适配你的业务对新鲜度的容忍度（例如把余额缓存从 30 秒调到 5 秒）——托管端点不提供这种控制权。
- **按请求计费的 RPC 成本节省**：CDN 缓存命中直接在 Cloudflare 边缘返回，**不消耗上游 RPC 配额**。读多写少的 DApp（余额查询、历史区块、合约常量）命中率越高省得越多，对按请求计费的供应商账单是直接折扣——同一份合约常量读一万次，只回源一次。
- **与 viem 官方 `batch` / `fallback` transport 的区别**：viem 的 batch 是把多个调用**合并**成一次 JSON-RPC 请求（省往返，但不缓存），fallback 是上游**故障转移**（提高可用性，也不缓存）。viem-proxy 做的是另一件事：把 JSON-RPC POST 转换为可缓存的 HTTP GET，让相同的读请求在 CDN 边缘直接命中、根本不打到上游 RPC。三者解决不同问题，可以叠加使用。

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

// 批量执行同样可用（方法名为 batchProxy，避开 viem 客户端的 batch 配置属性）
// 每项 result 按该项 action 推断类型（balance 项为 bigint，无需 as unknown）
const results = await client.batchProxy([
  { id: 1, action: 'getBalance', args: { address: '0xd8dA...' } },
  { id: 2, action: 'getBlockNumber' }
])
const balance: bigint | undefined = results[0].result
```

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
// （batchActions 的每项 result 同样按 action 推断类型）
const results = await batchActions(
  [
    { id: 1, action: 'getBalance', args: { address: '0xd8dA...' } },
    { id: 2, action: 'getBlockNumber' }
  ],
  { endpoint: 'https://your-workers-domain.workers.dev' }
)
const balance: bigint | undefined = results[0].result
const blockNumber: bigint | undefined = results[1].result
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

### 方式 A：一键部署（推荐）

点击下方按钮，Cloudflare 会把 `workers/` 子目录克隆到你的 GitHub 账户、自动创建并绑定三个 Durable Objects（参数存储 ProxyState、统计 Statistics、限流 RateLimiter），然后构建部署。全程无需本地环境：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wmzy/viem-proxy/tree/main/workers)

部署页面会提示你配置关键变量（各变量的作用见页面上的说明）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `RPC_URLS` | 推荐 | JSON 映射 `chainId -> URL[]`，如 `{"1":["https://eth-mainnet.g.alchemy.com/v2/你的Key"]}`。不配置时使用内置公共 RPC（限流严格，仅供试用） |
| `API_KEY` | 推荐 | 认证密钥。**不设置则任何人都能使用你部署的服务、消耗你的 RPC 配额**，请务必设置 |
| `ALLOWED_CHAIN_IDS` | 可选 | 可服务的链 ID 白名单，如 `"1,137"`；不设置则服务所有已配置上游的链 |
| `RATE_LIMIT_PER_MINUTE` | 可选 | 每 IP 每分钟请求预算，默认 `"60"`，设 `"0"` 禁用。只读监控端点（`/api/v1/stats`、`/api/v1/health`）不受限流影响 |

> **关于部署表单里的 Build / Deploy command**
>
> 表单读取的是 **`workers/` 子目录的 package.json**（部署后该目录就是你账户中新仓库的根），而不是仓库根目录那个客户端库的 package.json——所以在仓库根目录找不到 `deploy` script 是正常的。
>
> - **Build command 留空是预期行为**：workers 后端没有独立构建步骤，`wrangler deploy` 会直接用 esbuild 打包 TypeScript 源码。
> - **Deploy command**（`pnpm run deploy`）对应 `workers/package.json` 中的 `"deploy": "wrangler deploy"` script，保持默认即可。

部署完成后，用部署页给出的 `*.workers.dev` 域名作为客户端的 `endpoint` 即可。回到「快速开始」连接它。

#### 部署后验证

拿到域名后，先用仓库自带的冒烟脚本花 1 分钟确认代理真的在工作（Node ≥ 18，零依赖，无需克隆后端代码也能 `curl` 单测）：

```bash
# 仓库根目录执行
node workers/scripts/smoke.mjs https://your-proxy.workers.dev --key 你的API_KEY

# 或在 workers/ 目录下
pnpm smoke https://your-proxy.workers.dev --key 你的API_KEY
```

脚本依次执行四步检查：① 健康检查 `GET /api/v1/health`（旧版本部署无此端点时自动跳过，不算失败）；② 连续 3 次 `getBlockNumber`（报告每次延迟、`X-Cache` 命中与 trace id——重复请求应命中去重缓存）；③ `getBalance` 查询默认地址；④ 可选的服务端统计 `GET /api/v1/stats`。示例输出：

```
🚀 viem-proxy 部署验证
   端点: https://your-proxy.workers.dev
   链 ID: 1    API key: 已配置

① 健康检查  GET /api/v1/health
   ✅ 45ms  status=ok  version=0.2.0  可服务链 1 条

② 区块高度  POST /api/v1/1/getBlockNumber ×3（顺序请求，观察去重缓存命中）
   第 1 次  ✅ 312ms  cache=MISS  block=#12345678  trace=a1b2c3d4e5f6
   第 2 次  ✅ 38ms   cache=HIT   block=#12345678  trace=b2c3d4e5f6a7
   第 3 次  ✅ 36ms   cache=HIT   block=#12345678  trace=c3d4e5f6a7b8

③ 余额查询  POST /api/v1/1/getBalance
   地址: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
   ✅ 190ms  cache=MISS  balance=2411.641970 ETH  trace=d4e5f6a7b8c9

④ 服务端统计  GET /api/v1/stats（可选）
   ✅ 总请求 4 · 缓存命中 2（50.0%）· 平均上游延迟 210ms · 错误率 0.0%

────────────────────────────────────────
✅ 验证通过：代理工作正常（区块请求缓存命中 2/3，重复请求应命中去重缓存）
```

任一关键请求失败时脚本以非零退出码结束并列出失败项，可直接接入 CI 或部署钩子。更多选项（`--chain`、`--address`）见 `node workers/scripts/smoke.mjs --help`。

### 方式 B：手动部署

#### 1. 克隆项目

```bash
git clone https://github.com/wmzy/viem-proxy.git
cd viem-proxy/workers
```

#### 2. 安装依赖

```bash
pnpm install --prefer-offline --registry=https://registry.npmmirror.com
```

#### 3. 配置环境

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

# 每 IP 限流（保护你的 RPC 配额不被滥用）
[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ProxyState"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["Statistics"]

[[migrations]]
tag = "v3"
new_sqlite_classes = ["RateLimiter"]

[vars]
ENVIRONMENT = "production"
MAX_RPC_CONCURRENCY = "10"  # 每条链允许的并发上游 RPC 调用数
RATE_LIMIT_PER_MINUTE = "60"  # 每 IP 每分钟请求预算（"0" 禁用；/api/v1/stats 与 /api/v1/health 豁免）
# ALLOWED_ORIGINS = "app.example.com,*.dapp.example.com"  # 可选，浏览器 Origin 白名单（见下文「Origin 白名单」）
```

#### 4. 部署

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
  compressionThreshold?: number // 大参数哈希引用阈值(字符数)，默认 1500，需与服务端 COMPRESSION_THRESHOLD 一致
}
```

##### 大参数哈希引用流程

序列化后长度 ≥ `compressionThreshold` 的参数不再压缩进查询串，而是走固定长度的可缓存 GET 路径：

```
GET /api/v1/cached/{chainId}:{actionName}:{sha256(params)}
  → 404 -32004 (服务端未见此哈希)
POST /api/v1/store {"hash": "<sha256-hex>", "params": "<原始JSON字符串>"}
  → 服务端重算摘要校验绑定，幂等写入（30 天 TTL）
GET /api/v1/cached/... → 执行并缓存，后续相同哈希直接命中
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

#### 全局默认配置（configureProxy）

`endpoint` 等配置原本可能要在 `createPublicClient`、`withProxy`、`proxyActions(...)`、`batchActions` 等多处重复传。`configureProxy` 提供**模块级默认配置**：设置一次，之后所有入口自动继承。

```typescript
import { configureProxy } from 'viem-proxy'

// 应用启动时设置一次（服务入口、next.config 初始化等）
configureProxy({
  endpoint: 'https://your-proxy.workers.dev',
  timeout: 10000,
  retryOptions: { attempts: 3, delay: 500 },
})

// 之后所有入口自动继承，无需重复传 endpoint
const client = createPublicClient({ chain: mainnet, transport: http() })
// withProxy 不传 config 同样继承模块默认
const actions = proxyActions(withProxy(anotherClient))
// 顶层函数的 config 参数变为可选
const results = await batchActions([{ id: 1, action: 'getBlockNumber' }])
await preheatCache([{ action: 'getBalance', args: { address: '0x...' } }])
await purgeCache([{ chainId: 1, action: 'getBalance' }])
```

**优先级**（逐键比较，更具体的赢）：

> 显式传入的配置 > 客户端挂载的配置（`createPublicClient` 的 `proxy` / `withProxy`）> 模块默认（`configureProxy`）> 内置默认（`timeout: 30000`、`fallback: true`、`attempts: 3 / delay: 500`）

```typescript
configureProxy({ endpoint: 'https://proxy.example.com', timeout: 10000 })

// 显式配置只覆盖传入的键，其余键继承模块默认
createPublicClient({
  chain: mainnet,
  transport: http(),
  proxy: {
    endpoint: 'https://another.example.com',  // 覆盖 endpoint
    // timeout 未传 → 仍是模块默认的 10000
  },
})
```

相关函数（`viem-proxy` 与 `viem-proxy/actions` 均有导出）：

- `configureProxy(defaults: Partial<ProxyActionConfig>)`：合并式设置模块默认，重复调用按键合并
- `getProxyDefaults()`：读取当前模块默认的副本（排查 / 测试用）
- `resetProxyDefaults()`：清空模块默认，恢复内置默认（测试隔离用）

> ⚠️ **SSR / 多实例注意**：模块默认是**进程级**状态——同一进程内的所有客户端实例、所有请求共享同一份默认值（Next.js 服务端、测试进程皆如此）。需要按请求 / 按租户隔离配置时，请显式传参（`withProxy(client, config)` 或 `createPublicClient({ proxy })`），显式配置永远优先。未调用 `configureProxy` 时一切行为与之前完全一致（零行为变化）。

### 扩展方法

`viem-proxy` 的 `createPublicClient` 创建的客户端，以及 `.extend(proxyActions(...))` 扩展后的客户端，均提供以下方法：

```typescript
import type { PerformanceMetrics } from 'viem-proxy'

// 获取本地性能指标快照（同步方法，非 Promise）
// 返回 PerformanceMetrics：totalRequests、errorRate、cacheHits/cacheMisses、
// cacheHitRate、averageResponseTime、responseTimeP50/P95/P99、
// fallbackCount/fallbackRate/fallbackReasons（回退观测，见「重试配置」）、
// chainIds、strategyCounts、methodStats（分方法统计）
const stats: PerformanceMetrics = client.getCacheStats()
console.log(`命中率: ${(stats.cacheHitRate * 100).toFixed(1)}%`)
console.log(`回退率: ${(stats.fallbackRate * 100).toFixed(1)}%`) // 越低越好

// 重置本地指标统计（同步方法）。注意：仅清空客户端本地统计，
// 不会清除 CDN 缓存本身——主动清缓存是服务端 POST /api/v1/purge 的
// 职责（见下方「缓存清除」小节），两者职责不同
client.resetStats()

// 批量执行多个 action：单次 POST /api/v1/batch 往返
// 单项隔离：某一项失败只会在该项结果中返回 error，其余照常
// 批量端点不可用时自动降级为串行单请求
// （方法名 batchProxy：避开 viem 客户端自身的 batch 配置属性，
//   保证 extend 模式下同样可用）
const results = await client.batchProxy([
  { id: 1, action: 'getBalance', args: { address: '0x...' } },
  { id: 2, action: 'getBlockNumber' },                        // 可省略 args
  { id: 3, action: 'getChainId', chainId: 137 }               // 可按项覆盖目标链
])
// 每项 result 类型按该项 action 自动推断（与对应单项 action 的返回类型一致，
// 无需再 `as unknown` / 手动断言）：
//   results[0].result: bigint | undefined   ← getBalance
//   results[1].result: bigint | undefined   ← getBlockNumber
//   results[2].result: number | undefined   ← getChainId
//   失败项：results[i].error: { code: number, message: string }

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

> 注意：单独 actions 导入（`viem-proxy/actions`）时不经过客户端，上述扩展方法不可用；但可单独导入等价函数：
> `batchActions(requests, config?, chainId?)`、`preheatCache(requests, config?, chainId?)`、
> `purgeCache(requests, config?)`（config 省略时继承 `configureProxy` 模块默认，见「全局默认配置」；
> 「缓存清除」见下文）、
> `addMiddleware(middleware)`（另有 `clearMiddlewares()` / `getMiddlewares()`）。
>
> 预热集合从哪来？Next.js 路由预取场景的自动收集模式见 [`examples/nextjs-preheat/`](examples/nextjs-preheat/)。

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

### 回退观测（fallback 指标）

`fallback: true` 时代理失败会静默回退到原始 RPC——结果仍然正确，但该次请求**代理没有产生任何价值**。客户端指标为此提供三个字段（`getCacheStats()` 返回）：

| 字段 | 含义 |
| --- | --- |
| `fallbackCount` | 回退到原始 RPC 的请求次数（重试耗尽后回退和直接回退都计一次，且每次逻辑请求只计一次） |
| `fallbackRate` | `fallbackCount / totalRequests`，无请求时为 0 |
| `fallbackReasons` | 按原因分类计数：`network`（代理不可达）、`timeout`、`5xx`、`429`（被限流）、`abort`、`other`（代理业务错误、中间件抛错等） |

持续偏高的 `fallbackCount` 意味着流量正在绕过代理，这是监控代理有效性的关键指标；`fallbackReasons` 直接指出该修什么（`429` 多为触发了服务端限流，`network`/`timeout` 多为 Workers 不可达或超时配置过短）：

```typescript
const stats = client.getCacheStats()
// 示例输出：58 个请求中 2 个回退，1 个 5xx、1 个超时
// stats.fallbackCount  // 2
// stats.fallbackRate   // 0.034482758620689655
// stats.fallbackReasons // { "5xx": 1, "timeout": 1 }

if (stats.fallbackRate > 0.05) {
  console.warn('回退率超过 5%', stats.fallbackReasons)
}
```

`resetStats()` 会将回退指标连同其他指标一并清零。

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

#### 统计仪表盘

不想逐字段读 JSON？部署后直接打开 **`GET /dashboard`**，浏览器里即可看到 `/api/v1/stats` 的图形化视图：

```
https://your-workers-domain.workers.dev/dashboard
```

- **汇总卡片**：总请求数、缓存命中率、错误率、平均上游延迟
- **时序条形图**：按 UTC 小时分桶，可在 请求数 / 错误数 / p50 / p95 / p99 之间切换；请求数模式下错误占比以红色标注
- **分桶明细表**：每个桶的 count / errorCount / p50 / p95 / p99
- **过滤与窗口**：`chainId` / `method` 过滤输入框，近 24 小时 / 近 7 天一键切换，可选每 30 秒自动刷新
- **鉴权说明**：页面本身无需鉴权（纯外壳、不含任何数据），所有数字由浏览器实时请求 `/api/v1/stats` 获得——若该端点配置了 `API_KEY`，页面会显示 401 引导文案，在页面内填入 Key（仅作为 `X-API-Key` 请求头发送，不写入 URL）即可
- **零依赖**：HTML/CSS/JS 全部内联，无任何外部 CDN 脚本或样式请求

### 健康检查端点

Workers 提供 `GET /api/v1/health`（**无需鉴权**，可在配置 `API_KEY` 后仍直接访问），返回服务状态与配置快照，用于部署验证与存活监控：

```
GET /api/v1/health
```

```jsonc
{
  "status": "ok",            // "ok" | "degraded"（无可服务链，或 deep 模式下全部探测失败）
  "version": "0.2.0",
  "environment": "production",
  "chains": [                // 当前可服务的链（默认链 ∪ RPC_URLS，经 ALLOWED_CHAIN_IDS 过滤）
    { "chainId": 1, "upstreams": 3 }   // 只报每链上游数量，绝不泄露完整 URL
  ],
  "durableObjects": { "proxyState": true, "statistics": true },
  "rateLimit": { "enabled": true, "limitPerMinute": 60 }  // 来自 RATE_LIMIT_PER_MINUTE
}
```

浅探测零上游调用、不产生额外流量，可放心高频轮询。需要验证上游连通性时用 `?deep=1`：对前 5 条链各发起一次 `eth_chainId` 探测（单次超时 2.5 秒，失败不抛错），额外返回：

```jsonc
{
  "deep": {
    "checked": 2,
    "chains": [
      { "chainId": 1, "ok": true, "latencyMs": 120 },   // 探测失败为 { ok: false, latencyMs: null }
      { "chainId": 137, "ok": false, "latencyMs": null }
    ]
  }
}
```

> `deep` 会消耗上游 RPC 配额，建议只在排障时使用，不要用于常规监控轮询。

### 缓存清除

Workers 提供 `POST /api/v1/purge`，主动失效服务端缓存。**管理操作**：需要 `API_KEY` 鉴权（与其他代理端点一致），且**不豁免限流**；未配置 `API_KEY` 时返回 `501` 并明确提示先配置密钥（拒绝无鉴权暴露管理端点）。

支持两种粒度：

```bash
# 整链清除：清空该链的 Durable Object 去重存储（每链一个 DO 实例）
curl -X POST 'https://your-workers-domain.workers.dev/api/v1/purge' \
  -H 'Content-Type: application/json' -H 'X-API-Key: 你的API_KEY' \
  -d '{ "chainId": 1 }'

# 单请求级：重建缓存键，精确删除 DO 去重记录 + CDN colo 缓存条目
curl -X POST 'https://your-workers-domain.workers.dev/api/v1/purge' \
  -H 'Content-Type: application/json' -H 'X-API-Key: 你的API_KEY' \
  -d '{ "requests": [ { "chainId": 1, "action": "getBalance", "args": { "address": "0x..." } } ] }'
```

响应如实报告清除数量与已知限制：

```jsonc
{
  "purged": {
    "dedup": 2,  // Durable Object 去重记录删除数
    "cache": 1   // Cache API（CDN colo）条目删除数
  },
  "scope": "colo",  // 明示作用域：只影响当前 colo，不是全局失效
  "limitations": [
    "caches.default.delete only affects the Cloudflare colo serving this request; ..."
  ]
}
```

**已知限制（如实说明，请勿期待全局失效）**：

- **只影响当前 colo**：Workers 的 `caches.default.delete` 只清除处理该 purge 请求的 Cloudflare PoP 上的缓存条目；其他节点上的条目按各自 TTL 自然过期。全局 CDN 失效需要 Cloudflare zone 级 Purge API（超出本项目范围），响应中的 `scope: "colo"` 与 `limitations` 字段即为明示。
- **链级清除无法枚举 CDN 条目**：`{ "chainId": N }` 只清空该链的 DO 去重存储；CDN 缓存条目无法按链枚举（Cache API 没有列出接口），要删 CDN 条目必须逐请求 purge（服务端按参数精确重建 URL）。
- **方法级（`method` 字段）不支持**：去重哈希是不透明的 SHA-256，无法按方法过滤——返回 `400` 并说明原因，而不是假装清除。
- **`args` 必须与原请求完全一致**（包括 JSON 键顺序）：服务端按 `chainId:action:args` 哈希定位条目，键顺序不同会得到不同哈希。
- 单次 `requests` 上限 50（与批量端点一致），超出返回 `400`。

客户端用法（单独 actions 导入的顶层函数，不挂在 client 实例上）：

```typescript
import { purgeCache } from 'viem-proxy/actions'

const report = await purgeCache(
  [
    { chainId: 1, action: 'getBalance', args: { address: '0x...' } },
    { chainId: 1, action: 'getBlockNumber' }
  ],
  {
    endpoint: 'https://your-workers-domain.workers.dev',
    apiKey: '你的API_KEY'   // purge 需要鉴权
  }
)
// report: { purged: { dedup, cache }, scope: 'colo', limitations: [...] }
```

> `purgeCache` 对瞬时失败（网络错误、超时、5xx、429）按 `retryOptions` 重试；`400`/`401`/`501` 等业务错误直接抛出服务端错误信息。

### 限流（滥用防护）

自部署实例默认开启**按 IP 限流**，防止他人滥用你部署的服务、消耗你的 RPC 配额与 Workers 请求额度：

- **计数方式**：固定 60 秒窗口，按 `CF-Connecting-IP` 计数，由 `RateLimiter` Durable Object 全局计数（跨 isolate/PoP 准确，非实例内存计数）；每个 IP 独立预算
- **限流范围**：`/api/v1/*` 代理端点；限流在鉴权**之前**执行——未认证/错误密钥的请求同样消耗该 IP 的预算
- **豁免端点**：只读监控端点 `/api/v1/stats`、`/api/v1/health` 不受限流，保证洪泛期间仍可观测
- **超限响应**：HTTP 429 + `Retry-After`（距下一分钟窗口的秒数）+ JSON-RPC 错误 `{ code: -32005, message: "Rate limit exceeded" }`；429 会计入 `/api/v1/stats` 的 `errorCount`（`method = "rate_limit"`，可用 `?method=rate_limit` 过滤），绝不计入成功
- **容错**：限流依赖故障（DO 不可用、绑定缺失）时放行请求——限流是保护插件，不是硬依赖

```toml
RATE_LIMIT_PER_MINUTE = "60"  # 每 IP 每分钟请求预算；"0" 禁用限流；非法值回退默认 60
```

### Origin 白名单（浏览器场景防护）

浏览器前端无法保密 `API_KEY`（任何访问者都能从构建产物里读走它），因此 API_KEY 只适用于服务端调用方。浏览器请求有天然的身份标识：跨域调用与同源 POST 会携带 `Origin` 头，而服务端/移动端调用从不携带。`ALLOWED_ORIGINS` 正是利用这一点提供 Origin 级防护：

- **语义**：逗号分隔的域名列表，支持 `*.example.com` 通配（匹配主域及所有子域名）；条目中的 `scheme://` 前缀会被忽略、端口参与匹配。示例：`ALLOWED_ORIGINS = "app.example.com,*.dapp.example.com"`
- **不设置（默认）**：不做 Origin 检查，行为与之前完全一致（宽松模式，文档强调配合 `API_KEY` + 限流使用）
- **设置后**：
  - 带 `Origin` 头的请求（浏览器）必须命中白名单，否则返回 `403`（`{ code: -32000, message: "Origin not allowed" }`）；检查在限流与鉴权**之前**执行，不消耗上游 RPC 与 Durable Object 资源
  - 不带 `Origin` 的请求（服务端/移动端调用）一律放行，继续由 `API_KEY` + 限流防护
  - CORS 同步收紧：`Access-Control-Allow-Origin` 只回显白名单命中的 Origin（不再返回 `*`，并带 `Vary: Origin`）；白名单外的预检 OPTIONS 虽返回 204 但不带 ACAO 头，浏览器会直接拒绝
- **豁免**：`/dashboard` 运维页豁免 Origin 检查（它本身免鉴权、只读、不代理任何 RPC，洪泛期间恰恰需要能打开观测）；`/api/v1/stats`、`/api/v1/health` **不**豁免——浏览器只能从白名单域名访问它们。若需在其他域名下查看统计/嵌入面板，把该域名加进白名单即可
- **容错**：白名单解析结果为空（如配置全是逗号/空格）时**闭环**（所有带 Origin 的请求 403）——配置错误宁可大声失败，也不静默放开访问

```toml
ALLOWED_ORIGINS = "app.example.com,*.dapp.example.com"  # 不设置则不做 Origin 检查
```

### 批量与并发控制

- 客户端 `client.batchProxy(items)`：一次 HTTP 往返执行多项，单项隔离
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
| Finalized 区块 | `eth_getBlockByNumber`、`eth_getStorageAt`（`finalized` 标签或确认数 ≥ epoch） | 30 天 |
| 较新区块 | 同上（确认数 < epoch） | 5 分钟 |
| 最新数据 | `eth_blockNumber`、`eth_gasPrice`、`eth_estimateGas`、`eth_feeHistory`、`eth_blobBaseFee`、`latest`/`pending` 块参数 | 12 秒 |
| 账户状态 | `eth_getBalance`、`eth_call`、`eth_getTransactionCount` | 30 秒 |
| 合约代码 | `eth_getCode` | 5 分钟 |
| 网络信息 | `eth_chainId`、`net_version`、`web3_clientVersion` | 1 小时 |
| 日志查询 | `eth_getLogs` | 1 分钟 |
| 其他方法 | 默认 | 5 分钟 |

> epoch（区块确认档位）按链配置：Ethereum 32 块、BSC 200 块、Polygon 64 块、Arbitrum 32 块、Optimism 16 块、Avalanche 32 块。带块参数的方法按「确认数 ≥ epoch 视为 finalized（30 天）、< epoch 视为较新（5 分钟）」二档判定。
>
> 本表由 `workers/test/handlers.test.ts` 中的防漂移测试守护：修改 `workers/src/utils/cache.ts` 的 TTL 或本表内容而不同步另一方，测试会失败。

### 请求去重

使用 Cloudflare Durable Objects 实现请求去重：
- 并发相同请求只执行一次 RPC 调用
- 等待中的请求共享结果
- 超时处理机制

## 🔒 隐私与数据披露

使用本服务（自部署或他人的部署）前，请了解以下数据行为：

1. **GET URL 含查询内容，会进入中间层日志**。压缩参数请求以 `GET /api/v1/:chainId/:method?params=...` 形式发出，URL 中包含被查询的地址与 calldata（压缩后仍可还原）。这类 URL 会经过并留存于 CDN、企业代理、访问日志等中间层——**不要用它查询不愿留痕的地址或合约调用**。
2. **缓存跨用户共享**。Worker 层缓存按「方法 + 参数」为键，不区分调用者：不同用户用相同参数查询会命中同一份缓存结果（也因此更快、更省配额）。这不泄露额外信息——响应内容本就由参数唯一决定——但意味着查询模式可能通过缓存命中率间接可观测（`X-Cache: HIT`）。
3. **服务端不存储私钥、不做签名**。本服务只代理**只读** RPC 方法（读余额、区块、日志、`eth_call` 等），不提供任何发送交易或签名的通道；私钥永远只在你自己的客户端（如钱包）本地使用，不会经过本服务。服务端也不持久化存储任何请求内容——统计（`/api/v1/stats`）只保留聚合计数，不含地址或参数。
4. **`API_KEY` 仅适用于服务端调用方**。浏览器场景下 API_KEY 无法保密（会随构建产物分发），请勿在浏览器端配置；浏览器场景请改用 `ALLOWED_ORIGINS` Origin 白名单（见上文「Origin 白名单」），服务端则始终用 `API_KEY` + 限流防护。

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

> 下表为**示意值**，用于直观展示缓存命中带来的量级差异，并非严格基准测试结果（实际数值取决于上游 RPC、地理位置与缓存命中率）。**想要你自己环境下的真实数字？** 用下面的基准脚本 1 分钟即可复现。

| 场景 | 原始 RPC | viem-proxy (首次) | viem-proxy (缓存) | 提升 |
|------|----------|-------------------|-------------------|------|
| 获取余额 | 200ms | 180ms | 50ms | 75% ↑ |
| 读取合约 | 300ms | 250ms | 60ms | 80% ↑ |
| 获取区块 | 150ms | 130ms | 40ms | 73% ↑ |

### 用基准脚本复现

仓库自带零依赖基准工具（Node ≥ 18，原生 `fetch`，不依赖构建产物），对同一读请求逐次计时，对比「直连上游 RPC」与「走代理」两条路径：

```bash
# 仓库根目录执行（--proxy 你的 Workers 端点，--rpc 直连对照的上游 RPC）
node scripts/benchmark.mjs \
  --proxy https://your-proxy.workers.dev \
  --rpc https://eth.llamarpc.com \
  --key 你的API_KEY

# 等价别名
pnpm benchmark --proxy https://your-proxy.workers.dev --rpc https://eth.llamarpc.com --key 你的API_KEY
```

常用选项：`--chain 1`（链 ID）、`--iterations 20`（每场景每路径计时次数）、`--address 0x...`（getBalance 账户；readContract 场景同时将其作为合约地址）、`--scenario getBalance,getBlockNumber,readContract`（场景子集）、`--json`（机器可读输出，CI 友善）。三个场景分别对照 `eth_getBalance` / `eth_blockNumber` / `eth_call`（默认调用主网 USDC 的 `name()`，其他链请配 `--address`）。完整说明见 `node scripts/benchmark.mjs --help`。

示例输出（每路径先做 1 次不计入统计的预热，再逐次交替请求两条路径）：

```
▶ 场景 1/3: getBalance
   代理 POST /api/v1/1/getBalance  vs  直连 JSON-RPC
   | 路径 | P50    | P95    | P99    | 均值   | 最小   | 最大   | 失败 |
   |------|--------|--------|--------|--------|--------|--------|------|
   | 直连 | 208.3ms | 351.2ms | 390.5ms | 226.4ms | 190.1ms | 390.5ms | 0/20 |
   | 代理 | 42.0ms  | 61.3ms  | 70.2ms  | 45.1ms  | 36.4ms  | 70.2ms  | 0/20 |
   缓存命中: 19/20（95.0%，HIT 19 · MISS 1）
   首次响应（冷）: 215.3ms  →  后续均值: 45.1ms
   上游 RPC 调用估算: 直连 20 次 vs 代理 1 次（节省 95.0%）

────────────────────────────────────────
📊 汇总（P50 对比）
   | 场景       | 直连 P50 | 代理 P50 | 提升  |
   |------------|----------|----------|-------|
   | getBalance | 208.3ms  | 42.0ms   | 79.8% |
```

### 怎么解读

- **P50/P95/P99**：第 50/95/99 百分位的单次请求延迟（nearest-rank）。缓存命中的收益主要看 P50 与均值；P95/P99 反映尾延迟（回源 MISS、网络抖动）。
- **缓存命中**：`X-Cache: HIT` 占代理计时请求的比例。命中率越高，说明该场景的 TTL 策略（见前文「🎯 缓存策略」章节）越适配你的访问模式；命中率低不代表代理无效，只是该数据的缓存窗口较短（如最新区块号）。
- **首次响应（冷）vs 后续均值**：首次是预热请求（缓存 MISS，完整回源），后续均值近似缓存命中延迟。两者差距就是缓存带来的单次延迟收益。
- **上游 RPC 调用估算**：`直连 N 次 vs 代理 M 次`，M 为代理路径的 MISS 次数（每次 MISS 回源一次）。这是对按请求计费 RPC 配额的**直接节省比例**——读多写少、重复读多的业务节省最多。
- 结果受上游 RPC 速度、你到 Cloudflare 边缘的往返、以及运行时段的区块产出影响；不同环境跑出不同绝对值是正常的，重点看**同一环境内两条路径的相对差距**。

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
