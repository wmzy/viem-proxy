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

// 重置本地统计
client.clearCache()
```

#### 2. 批量请求

```typescript
// 单次 POST /api/v1/batch 往返；单项隔离，失败项返回 error，其余照常
const results = await client.batch([
  { id: 1, action: 'getBalance', args: { address: '0xd8dA...' } },
  { id: 2, action: 'getBlockNumber' },
  { id: 3, action: 'getGasPrice', chainId: 137 }  // 可按项覆盖目标链
])

for (const item of results) {
  if (item.error) console.error(`#${item.id} 失败:`, item.error.message)
  else console.log(`#${item.id}:`, item.result)
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
> `batchActions(requests, config, chainId?)`、`preheatCache(requests, config?, chainId?)`、
> `addMiddleware(fn)`（均从 `viem-proxy/actions` 导入）。

#### 5. 服务端统计

部署 Workers 后（需配置 `STATISTICS` Durable Object），访问监控端点：

```bash
# 聚合统计：chainId/method 可选过滤，hours 默认 24、最大 720
curl 'https://your-workers-domain.workers.dev/api/v1/stats?chainId=1&hours=24'
# → { totalRequests, cacheHits, cacheHitRate, averageResponseTime,
#     errorCount, errorRate, periods: [{ bucket, count, errorCount, p50, p95, p99 }] }
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

### 2. 部署

```bash
cd workers
npm run deploy
```

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
