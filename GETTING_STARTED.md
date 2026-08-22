# viem-proxy 快速开始指南

## 🚀 项目概述

viem-proxy 是一个高性能的 Web3 RPC 缓存代理库，通过 Cloudflare CDN 优化区块链数据读取性能。

## 📁 项目结构

```
viem-proxy/
├── src/                    # 客户端代理库源码
│   ├── index.ts           # 主入口（重导出 viem + 代理 API）
│   ├── client.ts          # createPublicClient 封装
│   ├── proxy.ts           # withProxy / getProxyConfig
│   ├── types.ts           # TypeScript 类型定义
│   ├── chains.ts          # 链配置重导出
│   ├── actions/           # 模块化 actions（client 端）
│   │   ├── index.ts       # actions 导出入口
│   │   ├── proxyActions.ts # client.extend(proxyActions(...)) 扩展
│   │   ├── *.client.ts    # 各 action 客户端实现
│   │   ├── batch.client.ts # 批量请求
│   │   ├── preheat.client.ts # 缓存预热
│   │   ├── middleware.ts  # 请求中间件
│   │   ├── types.ts       # ProxyActionConfig 等类型
│   │   └── utils.ts       # makeProxyRequest（重试/trace/指标）
│   ├── utils/
│   │   ├── compression.ts # 参数压缩算法
│   │   └── metrics.ts     # 客户端指标采集
│   └── test/              # 测试文件
│       ├── actions.test.ts
│       ├── client.test.ts
│       ├── index.test.ts
│       ├── utils.test.ts
│       ├── chains.test.ts
│       └── compression.test.ts
├── workers/               # Cloudflare Workers 后端
│   ├── src/
│   │   ├── index.ts       # Workers 主入口（Hono 路由）
│   │   ├── types.ts       # Workers 类型定义
│   │   ├── handlers/      # 请求处理器
│   │   │   ├── proxy.ts   # 压缩/哈希引用/直连请求
│   │   │   ├── actions.ts # 单 action 请求（含去重）
│   │   │   └── batch.ts   # 批量请求（上限 50）
│   │   ├── actions/       # 服务端 action 执行器（*.server.ts）
│   │   ├── durable-objects/
│   │   │   ├── proxy-state.ts # 参数存储 + 请求去重
│   │   │   └── statistics.ts  # 服务端统计（/api/v1/stats）
│   │   └── utils/
│   │       ├── cache.ts       # 缓存策略/TTL/trace 头
│   │       ├── statistics.ts  # 统计聚合
│   │       └── compression.ts
│   ├── test/              # Workers 测试
│   ├── package.json
│   ├── wrangler.toml      # Cloudflare 配置
│   └── tsconfig.json
├── examples/              # 使用示例
│   ├── basic-usage.ts
│   └── migration-guide.ts
├── dist/                  # 构建输出目录
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
├── vite.config.ts         # 构建配置
├── vitest.config.ts       # 测试配置
├── setup.sh               # 安装脚本
├── PRD.md                 # 产品需求文档
├── README.md              # 项目说明
└── GETTING_STARTED.md     # 快速开始指南
```

## 🛠️ 安装和设置

### 1. 运行安装脚本

```bash
./setup.sh
```

或者手动安装：

```bash
# 安装根目录依赖
pnpm install --prefer-offline --registry=https://registry.npmmirror.com

# 安装 workers 依赖
cd workers
pnpm install --prefer-offline --registry=https://registry.npmmirror.com
cd ..
```

### 2. 构建项目

```bash
npm run build
```

### 3. 运行测试

```bash
npm test
```

## 📦 使用方法

### 基础使用

```typescript
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

// API 使用与 viem 完全相同
const balance = await client.getBalance({
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
})
```

### 高级配置

```typescript
const client = createPublicClient({
  chain: mainnet,
  transport: http(),
  proxy: {
    enabled: true,
    endpoint: 'https://your-workers-domain.workers.dev',
    debug: true,
    fallback: true,
    timeout: 30000,
    retryOptions: {
      attempts: 3,  // 总尝试次数（含首次请求）
      delay: 500    // 重试基础延迟(ms)，指数退避
    },
    cacheControl: {
      eth_getBalance: 30,    // 30秒缓存
      eth_call: 60,          // 1分钟缓存
      eth_getBlockByNumber: 300  // 5分钟缓存
    }
  }
})
```

#### 全局默认（configureProxy）

endpoint 等配置需要在多处使用时，用 `configureProxy` 设置**模块级默认**，一次设置、全入口继承（`createPublicClient`、`withProxy`、`proxyActions`、`batchActions`、`preheatCache`、`purgeCache`）：

```typescript
import { configureProxy } from 'viem-proxy'

configureProxy({
  endpoint: 'https://your-workers-domain.workers.dev',
  timeout: 10000,
  fallback: true
})

// 之后无需再重复传 endpoint / timeout
const client = createPublicClient({ chain: mainnet, transport: http() })
const results = await batchActions([{ id: 1, action: 'getBlockNumber' }])  // config 可省略
```

优先级：显式传入的配置 > 客户端挂载的配置 > 模块默认 > 内置默认（逐键比较）。
模块默认是**进程级**状态，SSR / 多实例共享；需要隔离时用显式传参（永远优先）。
详见 README「客户端配置 → 全局默认配置」。

### 进阶能力

#### 1. 指标采集

```typescript
import { createPublicClient } from 'viem-proxy'
import { mainnet } from 'viem-proxy/chains'

const client = createPublicClient({
  chain: mainnet,
  proxy: { enabled: true, endpoint: 'https://your-workers-domain.workers.dev' }
})

await client.getBlockNumber()
await client.getBalance({ address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' })

// 同步快照：请求数、缓存命中率、错误率、P50/P95/P99 响应时间（含分方法统计）
const stats = client.getCacheStats()
console.log(`命中率: ${(stats.cacheHitRate * 100).toFixed(1)}%, P95: ${stats.responseTimeP95}ms`)

// 回退观测：回退意味着该次请求绕过了代理（代理未产生价值）
// fallbackCount：回退次数；fallbackRate：fallbackCount / totalRequests
// fallbackReasons：按原因分类（network / timeout / 5xx / 429 / abort / other）
if (stats.fallbackRate > 0.05) {
  console.warn('回退率超过 5%，检查代理可达性或限流配置:', stats.fallbackReasons)
}

// 重置本地统计（仅清空客户端指标，与 CDN 缓存无关）
client.resetStats()
```

#### 2. 批量请求

```typescript
// 单次 POST /api/v1/batch 往返；单项隔离，失败项返回 error，其余照常
// （方法名 batchProxy：避开 viem 客户端自身的 batch 配置属性，
//   createPublicClient 与 extend 模式下均可用）
const results = await client.batchProxy([
  { id: 1, action: 'getBalance', args: { address: '0xd8dA...' } },
  { id: 2, action: 'getBlockNumber' },
  { id: 3, action: 'getChainId', chainId: 137 }  // 可按项覆盖目标链
])

// 每项 result 类型按该项 action 自动推断（与对应单项 action 的
// 返回类型一致，无需 `as unknown` / 手动断言）：
//   results[0].result: bigint | undefined  ← getBalance
//   results[1].result: bigint | undefined  ← getBlockNumber
//   results[2].result: number | undefined  ← getChainId
const balance: bigint | undefined = results[0].result

for (const item of results) {
  if (item.error) console.error(`#${item.id} 失败:`, item.error.message)
  else console.log(`#${item.id}:`, item.result)  // 联合类型，按索引访问可得精确类型
}
```

#### 3. 缓存预热

```typescript
// 逐项走压缩 GET 路径填充 CDN 缓存（并发度 5），永不抛错
const { submitted, failed } = await client.preheatCache([
  { action: 'getBalance', args: { address: '0xd8dA...' } },
  { action: 'getBlockNumber' },
  { action: 'getGasPrice' }
])
console.log(`已提交 ${submitted} 项预热，失败 ${failed} 项`)
```

#### 4. 中间件

```typescript
// 洋葱模型：先注册者在外层；中间件抛错则请求走回退/错误路径
client.use(async (request, next) => {
  const start = Date.now()
  const response = await next(request)
  console.log(`${request.functionName}(${request.chainId}) 耗时 ${Date.now() - start}ms`)
  return response
})
```

> 以上扩展方法依赖客户端实例；单独 actions 导入时可改用顶层函数
> `batchActions(requests, config?, chainId?)`、`preheatCache(requests, config?, chainId?)`、
> `addMiddleware(fn)`（均从 `viem-proxy/actions` 导入；config 省略时继承 `configureProxy` 模块默认）。
>
> 预热集合怎么自动收集？Next.js 路由预取场景的落地示例见 [`examples/nextjs-preheat/`](examples/nextjs-preheat/)。

#### 5. 服务端统计

部署 Workers 后（需配置 `STATISTICS` Durable Object），访问监控端点：

```bash
# 聚合统计：chainId/method 可选过滤，hours 默认 24、最大 720
curl 'https://your-workers-domain.workers.dev/api/v1/stats?chainId=1&hours=24'
# → { totalRequests, cacheHits, cacheHitRate, averageResponseTime,
#     errorCount, errorRate, periods: [{ bucket, count, errorCount, p50, p95, p99 }] }
```

#### 6. 缓存清除

服务端管理端点 `POST /api/v1/purge` 主动失效缓存（需要 `API_KEY` 鉴权、不豁免限流；未配置密钥时返回 501）。支持整链（`{ "chainId": 1 }`）与单请求（`{ "requests": [...] }`）两种粒度。如实说明的限制：只影响处理该请求的 **colo**（`scope: "colo"`），不是全局 CDN 失效；链级清除无法枚举 CDN 条目，只清 Durable Object 去重存储。详见 README「缓存清除」。

```typescript
import { purgeCache } from 'viem-proxy/actions'

const report = await purgeCache(
  [{ chainId: 1, action: 'getBalance', args: { address: '0xd8dA...' } }],
  { endpoint: 'https://your-workers-domain.workers.dev', apiKey: '你的API_KEY' }
)
// report: { purged: { dedup, cache }, scope: 'colo', limitations: [...] }
```

## 🌐 部署 Cloudflare Workers

### 1. 配置 wrangler.toml

编辑 `workers/wrangler.toml`：

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
```

> 默认开启按 IP 限流（固定 60 秒窗口，Durable Object 全局计数）：超限返回 `429` + `Retry-After`，不计入成功统计。`"0"` 可整体禁用。详见 README「限流（滥用防护）」。

### 2. 部署

```bash
cd workers
npm run deploy
```

### 3. 验证部署

部署完成后访问健康检查端点确认服务状态（无需 `X-API-Key`）：

```bash
curl 'https://your-workers-domain.workers.dev/api/v1/health'
# → { "status": "ok", "version": "0.2.0", "environment": "production",
#     "chains": [{ "chainId": 1, "upstreams": 3 }, ...],
#     "durableObjects": { "proxyState": true, "statistics": true },
#     "rateLimit": { "enabled": true, "limitPerMinute": 60 } }
```

`status` 为 `"ok"` 即部署成功；`"degraded"` 表示无可服务的链（检查 `RPC_URLS`/`ALLOWED_CHAIN_IDS` 配置）。需要进一步验证上游连通性时加 `?deep=1`（最多探测 5 条链，各 2.5 秒超时；会消耗上游配额，仅排障时用）。详见 README「健康检查端点」。

curl 之外，也可以直接在浏览器打开 `https://your-workers-domain.workers.dev/dashboard`——内嵌统计仪表盘（汇总卡片 + 分桶时序图，支持 24h/7d 切换与 chainId/method 过滤）图形化展示 `/api/v1/stats` 的数据，便于部署后快速目检流量是否正常（页面本身无需鉴权；数据仍走 `/api/v1/stats` 的鉴权规则，配置了 `API_KEY` 时在页面内填入即可）。

### 4. 部署后验证（冒烟脚本）

用仓库自带的冒烟脚本在 1 分钟内确认代理工作正常（Node ≥ 18，零依赖）：

```bash
# 仓库根目录执行；也可 cd workers && pnpm smoke <endpoint> ...
node workers/scripts/smoke.mjs https://your-proxy.workers.dev --chain 1 --key 你的API_KEY
```

脚本依次检查：① 健康检查 `GET /api/v1/health`（旧版本无此端点时自动跳过）；② 连续 3 次 `getBlockNumber`（每次延迟 + `X-Cache` 命中 + trace id，重复请求应命中去重缓存）；③ `getBalance`；④ 可选的 `GET /api/v1/stats` 服务端统计。末尾输出 ✅/❌ 总结，任一关键请求失败时退出码非零，适合接入部署钩子。完整示例输出与选项说明见 README「部署后验证」小节和 `node workers/scripts/smoke.mjs --help`。

### 5. 性能基准（可选）

验证代理工作正常后，用仓库根目录的基准脚本量化「直连上游 RPC」与「走代理」的延迟差距（Node ≥ 18，零依赖）：

```bash
# 仓库根目录执行；--proxy 是你的 Workers 端点，--rpc 是直连对照的上游 RPC
node scripts/benchmark.mjs \
  --proxy https://your-proxy.workers.dev \
  --rpc https://eth.llamarpc.com \
  --key 你的API_KEY

# 等价别名
pnpm benchmark --proxy https://your-proxy.workers.dev --rpc https://eth.llamarpc.com --key 你的API_KEY
```

三个场景（`getBalance` / `getBlockNumber` / `readContract`）逐次计时，输出中文报告：每路径 P50/P95/P99/均值、`X-Cache` 命中率、首次（冷）vs 后续延迟、上游 RPC 调用节省估算；`--json` 输出机器可读结果。加 `--help` 查看全部选项。用法解读与示例输出见 README「📊 性能对比」章节。

## 🧪 开发和测试

### 开发模式

```bash
# 客户端库开发
npm run dev

# Workers 开发
cd workers
npm run dev
```

### 运行测试

```bash
npm test
npm run test:coverage
```

### 类型检查

```bash
npm run typecheck
```

## 📊 核心特性

### 1. 智能压缩算法
- 函数选择器字典压缩
- 零填充压缩
- 地址格式优化
- Base64/URL 编码选择

### 2. 分层缓存策略（与 `workers/src/utils/cache.ts` 实现一致）
- **历史交易数据**（按哈希查块/交易/回执）：缓存 1 年
- **Finalized 区块**：缓存 30 天
- **≥ 2 epoch 历史块**：缓存 1 天；**≥ 1 epoch 区块**：缓存 1 小时；**较新区块**：缓存 5 分钟
- **最新数据**（blockNumber、gasPrice、estimateGas、feeHistory、blobBaseFee）：缓存 12 秒
- **账户状态**（balance、call、transactionCount）：缓存 30 秒
- **合约代码**：缓存 5 分钟；**链 ID 等网络信息**：缓存 1 小时；**日志**：缓存 1 分钟

### 3. 请求处理策略
- **小参数**（<1500字符）：压缩后 GET 请求
- **大参数**：哈希引用 GET 请求
- **首次大参数**：异步存储 + 直接调用

### 4. 自动回退机制
- 代理失败时自动回退到原始 RPC
- 保证服务可靠性

## 🔧 故障排除

### 常见问题

1. **代理请求失败**
   - 确保 `fallback: true`
   - 检查 Workers 端点是否正确

2. **缓存未命中**
   - 开启 `debug: true` 查看日志
   - 检查参数是否一致

3. **构建失败**
   - 确保所有依赖已安装
   - 运行 `npm run typecheck` 检查类型错误

### 调试模式

```typescript
const client = createPublicClient({
  // ...
  proxy: {
    debug: true  // 开启详细日志
  }
})
```

## 📈 性能优化建议

1. **合理设置缓存时间**
   - 根据数据更新频率调整缓存策略
   - 历史数据可以设置更长缓存时间

2. **使用批量请求**
   - 尽量合并多个相关请求
   - 减少网络往返次数

3. **监控缓存命中率**
   - 使用 `getCacheStats()` 监控性能
   - 根据统计数据优化缓存策略

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

MIT License

## 🔗 相关链接

- [viem 官方文档](https://viem.sh)
- [Cloudflare Workers 文档](https://workers.cloudflare.com)
- [项目 GitHub](https://github.com/your-username/viem-proxy)
