# Change: Modular Actions

## Why
当前实现将所有 proxy actions 硬编码在 `createPublicClient` 中，这导致：
1. 无法单独导入 action 进行 tree-shaking
2. 无法像 viem 那样通过 `client.extend()` 动态添加 actions
3. 不符合 viem 的模块化设计模式

viem 的设计允许：
- 从 `viem/actions` 单独导入 action 函数
- 使用 `client.extend(publicActions)` 扩展 client
- 支持 tree-shaking，只打包使用的 actions

## What Changes

### Client Library (`src/`)
- **BREAKING**: 重构 actions 为独立可导入的函数
- 创建 `src/actions/` 目录
- 使用 `.client.ts` / `.server.ts` 后缀区分客户端和服务端实现
- 创建 `src/actions/index.ts` 导出所有 client actions
- 添加 `proxyActions` 函数用于 `client.extend()`
- 更新 `createPublicClient` 使用新的模块化架构
- 添加 `viem-proxy/actions` 子模块导出

### Workers Backend (`workers/`)
- 更新 handlers 导入 server actions
- 统一 action 注册机制

### Package Configuration
- 更新 `package.json` exports 添加 `/actions` 子路径
- 更新 Vite 配置支持多入口点

## Impact
- Affected specs: `actions` (新建)
- Affected code:
  - `src/proxy-actions.ts` → `src/actions/*.client.ts`
  - `workers/src/handlers/proxy.ts` → 使用 `*.server.ts`
  - `src/client.ts` - 使用 extend 模式
  - `src/index.ts` - 更新导出
  - `package.json` - 添加 exports
  - `vite.config.ts` - 添加入口点
