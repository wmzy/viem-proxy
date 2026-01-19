# Change: Refactor Proxy Architecture

## Why
当前实现使用 Transport 层拦截 RPC 请求，这种方式虽然能工作，但与设计目标不符。设计要求：
1. 客户端代理顶层函数（如 `getBalance`, `readContract`），将参数传给 Server 端执行
2. 使用 Cloudflare Durable Objects 替代 KV，支持请求去重和状态管理
3. 使用 Vite 替代 tsup 作为构建工具

## What Changes

### Client Library (`src/`)
- **BREAKING**: 移除 Transport 层代理实现
- **BREAKING**: 重新设计为顶层函数代理模式
- 客户端调用 `getBalance` 等函数时，将参数序列化后发送到 Server 端
- Server 端执行 RPC 调用并返回结果，同时设置缓存
- 保持与 viem API 的兼容性

### Workers Backend (`workers/`)
- **BREAKING**: 从 KV 迁移到 Durable Objects
- 使用 DO 的 KV 存储参数哈希映射
- 使用 DO 的 SQL 支持请求去重（防止并发重复请求）
- 优化缓存策略

### Build System
- 从 tsup 迁移到 Vite
- 更新构建配置

## Impact
- Affected specs: `client-proxy`, `workers-backend`, `storage` (新建)
- Affected code:
  - `src/transport.ts` - 移除或重构
  - `src/client.ts` - 重新实现顶层函数代理
  - `src/index.ts` - 更新导出
  - `workers/src/handlers/proxy.ts` - 适配新的请求格式
  - `workers/src/types.ts` - 添加 DO 类型
  - `workers/wrangler.toml` - 配置 DO
  - `tsup.config.ts` → `vite.config.ts`
  - `package.json` - 更新依赖
