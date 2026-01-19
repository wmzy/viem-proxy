# Design: Refactor Proxy Architecture

## Context
viem-proxy 需要重构为顶层函数代理模式，使用 Durable Objects 作为存储层，并迁移到 Vite 构建系统。

### 当前架构
```
Client → ProxyTransport (拦截所有RPC) → Workers → KV → RPC Provider
```

### 目标架构
```
Client → 顶层函数代理 → Workers → Durable Objects → RPC Provider
```

## Goals / Non-Goals

### Goals
- 实现顶层函数代理，客户端调用 `getBalance` 等函数时将参数传给 Server
- 使用 Durable Objects 存储参数哈希和请求状态
- 利用 DO 的 SQL 功能实现请求去重
- 迁移到 Vite 构建系统
- 保持与 viem API 的兼容性

### Non-Goals
- 不改变缓存策略逻辑
- 不改变压缩算法
- 不改变 API 路由设计

## Decisions

### Decision 1: 顶层函数代理实现方式
**选择**: 包装 viem 的 PublicClient actions

**原因**:
- viem 的 PublicClient 通过 actions 扩展功能
- 我们可以创建代理版本的 actions，在调用前将请求发送到 Server
- 保持类型安全和 API 兼容性

**实现**:
```typescript
// 代理 getBalance
const proxyGetBalance = async (client, args) => {
  const response = await fetch(`${endpoint}/api/v1/${chainId}/getBalance`, {
    method: 'POST',
    body: JSON.stringify(args)
  })
  return response.json()
}
```

**Alternatives considered**:
- Proxy 对象拦截: 过于复杂，难以维护类型
- 修改 Transport: 当前方案，不符合设计目标

### Decision 2: Durable Objects 架构
**选择**: 单个 DO 类处理所有链的请求

**原因**:
- 简化部署和管理
- 使用 DO 的 SQLite 存储参数映射和请求状态
- 利用 DO 的单线程特性实现请求去重

**实现**:
```typescript
export class ProxyState extends DurableObject {
  sql: SqlStorage

  async fetch(request: Request) {
    // 处理请求，使用 SQL 去重
  }
}
```

**Alternatives considered**:
- 每个链一个 DO: 增加复杂性，收益不明显
- 继续使用 KV: 无法实现请求去重

### Decision 3: 请求去重机制
**选择**: 使用 DO SQL 存储进行中的请求

**原因**:
- DO 是单线程的，天然支持并发控制
- SQL 提供灵活的查询能力
- 可以存储请求状态和结果

**实现**:
```sql
CREATE TABLE pending_requests (
  request_hash TEXT PRIMARY KEY,
  status TEXT,
  result TEXT,
  created_at INTEGER,
  completed_at INTEGER
)
```

### Decision 4: Vite 构建配置
**选择**: 使用 vite-plugin-dts 生成类型声明

**原因**:
- Vite 原生支持 TypeScript
- 支持 CJS/ESM 双输出
- 更快的构建速度

## Risks / Trade-offs

### Risk 1: API 兼容性
- **风险**: 顶层函数代理可能无法完全兼容 viem API
- **缓解**: 仔细测试所有支持的方法，提供完整的类型定义

### Risk 2: DO 成本
- **风险**: Durable Objects 比 KV 更贵
- **缓解**: 合理设置 TTL，清理过期数据

### Risk 3: 迁移复杂性
- **风险**: 同时重构多个组件可能引入 bug
- **缓解**: 分步实现，每步都有测试覆盖

## Migration Plan

### Phase 1: 构建系统迁移
1. 创建 `vite.config.ts`
2. 更新 `package.json` 依赖
3. 移除 `tsup.config.ts`
4. 验证构建输出

### Phase 2: Workers DO 迁移
1. 创建 DO 类 `ProxyState`
2. 更新 `wrangler.toml` 配置
3. 迁移参数存储逻辑
4. 实现请求去重

### Phase 3: 客户端重构
1. 创建顶层函数代理
2. 移除 Transport 层代理
3. 更新导出
4. 更新测试

### Rollback
- 保留旧代码分支
- 如果出现问题，可以快速回滚

## Resolved Questions

### Q1: 支持哪些 viem PublicClient actions？
**决定**: 优先支持常用且缓存收益高的方法

**优先级 P0 (高频 + 高缓存收益)**:
- `getBalance` - 账户余额查询，30秒缓存
- `readContract` - 合约读取，最常用，30秒-1年缓存
- `getBlock` / `getBlockNumber` - 区块查询，12秒-1年缓存
- `getTransaction` / `getTransactionReceipt` - 交易查询，1年缓存

**优先级 P1 (中频)**:
- `call` - 底层调用
- `estimateGas` - Gas 估算，12秒缓存
- `getGasPrice` - Gas 价格，12秒缓存
- `getLogs` - 日志查询，1分钟缓存
- `getCode` - 合约代码，5分钟缓存

**优先级 P2 (低频，后续支持)**:
- `getStorageAt` - 存储槽查询
- `getTransactionCount` - Nonce 查询
- 其他只读方法

### Q2: DO 数据保留策略
**决定**: 分层保留策略

| 数据类型 | 保留时间 | 清理策略 |
|---------|---------|---------|
| 参数哈希映射 | 7 天 | 定时清理过期数据 |
| 待处理请求 | 5 分钟 | 完成后立即清理 |
| 已完成请求 | 30 秒 | 用于短期去重后清理 |

**实现**:
- 使用 `expires_at` 字段标记过期时间
- DO alarm 定时触发清理任务
- 清理频率: 每小时一次
