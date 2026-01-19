# viem-proxy 快速开始指南

## 🚀 项目概述

viem-proxy 是一个高性能的 Web3 RPC 缓存代理库，通过 Cloudflare CDN 优化区块链数据读取性能。

## 📁 项目结构

```
viem-proxy/
├── src/                    # 客户端代理库源码
│   ├── types.ts           # TypeScript 类型定义
│   ├── transport.ts       # 传输层实现
│   ├── client.ts          # 客户端封装
│   ├── index.ts           # 主入口文件
│   ├── chains.ts          # 链配置重导出
│   ├── utils/             # 工具函数
│   │   └── compression.ts # 参数压缩算法
│   └── test/              # 测试文件
│       └── compression.test.ts
├── workers/               # Cloudflare Workers 后端
│   ├── src/
│   │   ├── index.ts       # Workers 主入口
│   │   ├── types.ts       # Workers 类型定义
│   │   ├── handlers/      # 请求处理器
│   │   │   └── proxy.ts
│   │   └── utils/         # Workers 工具函数
│   │       ├── cache.ts
│   │       └── compression.ts
│   ├── package.json
│   ├── wrangler.toml      # Cloudflare 配置
│   └── tsconfig.json
├── examples/              # 使用示例
│   ├── basic-usage.ts
│   └── migration-guide.ts
├── dist/                  # 构建输出目录
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
├── tsup.config.ts         # 构建配置
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
    cacheControl: {
      eth_getBalance: 30,    // 30秒缓存
      eth_call: 60,          // 1分钟缓存
      eth_getBlockByNumber: 300  // 5分钟缓存
    }
  }
})
```

## 🌐 部署 Cloudflare Workers

### 1. 配置 wrangler.toml

编辑 `workers/wrangler.toml`：

```toml
name = "your-viem-proxy-workers"

[[kv_namespaces]]
binding = "PARAM_STORE"
id = "your-kv-namespace-id"

[vars]
ENVIRONMENT = "production"
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

### 2. 分层缓存策略
- **历史数据**：缓存 1 年
- **近期数据**：缓存 10 分钟
- **最新数据**：缓存 12 秒
- **账户状态**：缓存 30 秒

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
