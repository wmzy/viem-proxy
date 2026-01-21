# viem-proxy

[![npm version](https://badge.fury.io/js/viem-proxy.svg)](https://badge.fury.io/js/viem-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

高性能的 Web3 RPC 缓存代理库，通过 Cloudflare CDN 优化区块链数据读取性能。

## 🚀 特性

- **🔄 完全兼容 viem**：零学习成本，直接替换即可使用
- **⚡ 极速缓存**：利用 Cloudflare CDN 全球网络加速
- **🎯 智能策略**：根据数据特性自动选择最优缓存策略
- **📦 模块化 Actions**：支持 tree-shaking，按需导入
- **🛡️ 自动回退**：代理失败时自动回退到原始 RPC
- **📊 性能监控**：内置监控和调试功能
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

### 方式 3：单独导入 Actions（最佳 tree-shaking）

按需导入单个 action，获得最佳的 tree-shaking 效果：

```typescript
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { getBalance, getBlockNumber } from 'viem-proxy/actions'

const client = createPublicClient({
  chain: mainnet,
  transport: http()
})

const proxyConfig = {
  endpoint: 'https://your-workers-domain.workers.dev',
  fallback: true
}

// 使用 proxy 参数调用
const balance = await getBalance(client, {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  proxy: proxyConfig
})

const blockNumber = await getBlockNumber(client, {
  proxy: proxyConfig
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

## 🏗️ 部署 Workers

### 1. 克隆项目

```bash
git clone https://github.com/your-username/viem-proxy.git
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

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ProxyState"]

[vars]
ENVIRONMENT = "production"
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
  timeout?: number             // 请求超时时间(ms)
  fallback?: boolean           // 是否启用回退
  debug?: boolean              // 调试模式
}
```

#### ProxyActionConfig（用于单独 actions）

```typescript
type ProxyActionConfig = {
  endpoint: string             // Workers 端点
  timeout?: number             // 请求超时时间(ms)
  fallback?: boolean           // 是否启用回退
  debug?: boolean              // 调试模式
}
```

### 扩展方法

```typescript
// 获取缓存统计
const stats = await client.getCacheStats()

// 清除缓存
await client.clearCache()

// 预热缓存
await client.preheatCache([
  { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [...] }
])
```

## 🎯 缓存策略

### 自动缓存策略

- **历史数据**（finalized 区块）：缓存 30 天
- **近期数据**（epoch 内）：缓存 5 分钟  
- **最新数据**（latest、pending）：缓存 12 秒
- **账户状态**：缓存 30 秒
- **交易数据**：缓存 1 年

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
- [问题反馈](https://github.com/your-username/viem-proxy/issues)
- [讨论区](https://github.com/your-username/viem-proxy/discussions)

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**
