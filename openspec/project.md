# Project Context

## Purpose
viem-proxy 是一个高性能的 Web3 RPC 缓存代理库，利用 Cloudflare Workers 和 CDN 来优化区块链数据读取性能。它提供与 viem 库的零配置兼容性，同时添加智能缓存和请求优化功能。

核心目标：
- 通过 CDN 缓存减少 RPC 请求延迟和成本
- 提供与 viem 2.x API 完全兼容的透明代理
- 智能压缩请求参数以最大化 CDN 缓存命中率
- 支持多端点负载均衡和自动故障转移

## Tech Stack

### Client Library (`src/`)
- **TypeScript** (strict mode, ES2022 target)
- **viem** ^2.x - Web3 客户端库 (peer dependency)
- **Vite** - 构建工具 (CJS/ESM dual output)
- **Vitest** - 测试框架
- **ESLint** - 代码检查

### Workers Backend (`workers/`)
- **Cloudflare Workers** - 边缘计算平台
- **Hono** ^3.x - 轻量级 Web 框架
- **Cloudflare Durable Objects** - 持久化存储 (用于参数哈希缓存)
- **Wrangler** - Cloudflare CLI 工具

## Project Conventions

### Code Style
- TypeScript strict mode 启用
- 优先使用 `type` 而非 `interface` 和 `enum`
- 优先使用 `const` 声明变量，避免使用 `let`
- 优先使用函数式编程，避免使用 `class` 和 OOP
- 减少条件分支，尤其是嵌套的条件分支
- 遵循 viem 库的模式和约定
- 代码和注释使用英文

### Architecture Patterns
- **函数式设计**: 使用纯函数和组合，避免类和继承
- **顶层函数代理**: 代理 viem 的顶层函数 (如 `getBalance`, `readContract` 等) 而非 Transport 层
- **策略模式**: 根据参数大小选择不同的请求策略 (compressed/hash-reference/direct)
- **Fallback 机制**: 代理失败时自动回退到原始 RPC
- **四阶段压缩管道**:
  1. 函数选择器字典压缩 (e.g., `0x70a08231` → `balanceOf`)
  2. 地址优化 (保留校验和)
  3. 零填充压缩 (`{length}z` 表示法)
  4. URL-safe Base64 编码

### Testing Strategy
- 使用 Vitest 进行单元测试
- 测试文件与源文件放在同一目录 (`*.test.ts`)
- 覆盖率配置在 `vitest.config.ts`
- 运行测试: `npm run test`
- 覆盖率报告: `npm run test:coverage`

### Git Workflow
- 使用英文编写 commit message
- 遵循 Conventional Commits 规范
- 主分支: `main`

## Domain Context

### Ethereum RPC 方法分类
- **只读方法** (通过代理): `eth_call`, `eth_getBalance`, `eth_getBlockByNumber`, `eth_getTransactionReceipt` 等
- **写入方法** (直接透传): `eth_sendTransaction`, `eth_sendRawTransaction` 等

### 缓存策略
| 数据类型 | TTL |
|---------|-----|
| 历史区块数据 (< latest - 100) | 1 年 |
| 近期区块数据 (≥ latest - 100) | 10 分钟 |
| 最新数据 (latest/pending) | 12 秒 |
| 账户状态 | 30 秒 |
| 合约常量 | 1 小时 |
| 已确认区块 (finalized) | 30 天 |

### 请求策略选择
| 参数大小 | 策略 |
|---------|------|
| < 200 chars | compressed (GET with compressed query params) |
| 200 - 1500 chars | compressed |
| > 1500 chars | hash-reference (GET with SHA-256 hash lookup) |
| fallback | direct (POST) |

## Important Constraints

### 技术约束
- 必须保持与 viem 2.x API 的完全兼容
- Workers 请求 URL 长度限制 (影响压缩策略选择)
- Cloudflare Durable Objects 的单点写入特性
- Node.js >= 18 (使用原生 fetch 和 AbortSignal.timeout)

### 安全约束
- 只代理只读方法，写入操作直接透传
- 不存储敏感数据 (私钥、签名等)

### 性能约束
- 默认请求超时: 30 秒
- 压缩阈值: 1500 字符
- 负载均衡排名间隔: 4000ms

## External Dependencies

### 必需服务
- **Cloudflare Workers**: 边缘计算和 CDN 缓存
- **Cloudflare Durable Objects**: 存储大参数的哈希引用
- **Ethereum RPC Provider**: 上游 RPC 服务 (如 Infura, Alchemy, 自建节点)

### 配置要求
用户需要:
1. 部署自己的 Cloudflare Workers 实例
2. 配置 Durable Objects
3. 在客户端配置中设置 Workers 端点
