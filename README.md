# viem-proxy

[![npm version](https://badge.fury.io/js/viem-proxy.svg)](https://badge.fury.io/js/viem-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

高性能的 Web3 RPC 缓存代理库，通过 Cloudflare CDN 优化区块链数据读取性能。

## 🚀 特性

- **🔄 完全兼容 viem**：零学习成本，直接替换即可使用
- **⚡ 极速缓存**：利用 Cloudflare CDN 全球网络加速
- **🎯 智能策略**：根据数据特性自动选择最优缓存策略
- **📦 参数压缩**：智能压缩大参数，最大化缓存命中率
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

### 基础使用

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
    compressionThreshold: 1500, // 参数压缩阈值
    cacheControl: {
      // 自定义缓存策略
      eth_getBalance: 30, // 30秒
      eth_call: 60, // 1分钟
      eth_getBlockByNumber: 300 // 5分钟
    },
    retryOptions: {
      attempts: 3,
      delay: 1000
    }
  }
})
```

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

[[kv_namespaces]]
binding = "PARAM_STORE"
id = "your-kv-namespace-id"

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
  compressionThreshold?: number // 参数压缩阈值
  cacheControl?: {             // 自定义缓存策略
    [method: string]: number   // 方法对应的缓存时间(秒)
  }
  retryOptions?: {             // 重试配置
    attempts: number
    delay: number
  }
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

- **历史数据**（区块号 < latest - 100）：缓存 1 年
- **近期数据**（区块号 >= latest - 100）：缓存 10 分钟  
- **最新数据**（latest、pending）：缓存 12 秒
- **账户状态**：缓存 30 秒
- **合约常量**：缓存 1 小时

### 参数处理策略

```typescript
// 小参数（<1500字符）：压缩后 GET 请求
GET /api/v1/1/eth_call?p=eyJ0byI6IjB4NDU2...

// 大参数：哈希引用 GET 请求
GET /api/v1/cached/1:eth_call:a1b2c3d4e5f6...

// 首次大参数：异步存储 + 直接调用
POST /api/v1/store
POST /api/v1/direct/1/eth_call
```

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

3. **大参数处理**
   ```typescript
   // 调整压缩阈值
   proxy: {
     compressionThreshold: 1000 // 降低阈值
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

## 📚 文档更新

- 更新了类型定义和API文档
- 修复了测试用例中的缓存策略配置
- 完善了错误处理和调试信息

## 🔗 相关链接

- [viem 官方文档](https://viem.sh)
- [Cloudflare Workers 文档](https://workers.cloudflare.com)
- [问题反馈](https://github.com/your-username/viem-proxy/issues)
- [讨论区](https://github.com/your-username/viem-proxy/discussions)

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**
