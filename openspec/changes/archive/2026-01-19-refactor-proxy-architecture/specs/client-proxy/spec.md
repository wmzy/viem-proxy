## ADDED Requirements

### Requirement: 顶层函数代理
客户端库 SHALL 代理 viem 的顶层函数（如 `getBalance`, `readContract`, `getBlock`），将函数参数发送到 Server 端执行。

#### Scenario: 代理 getBalance 调用
- **WHEN** 客户端调用 `getBalance({ address: '0x...' })`
- **THEN** 客户端 SHALL 序列化参数并发送到 Server 端点
- **AND** Server SHALL 执行 RPC 调用并返回结果
- **AND** 客户端 SHALL 反序列化并返回类型化的结果

#### Scenario: 代理 readContract 调用
- **WHEN** 客户端调用 `readContract({ address, abi, functionName, args })`
- **THEN** 客户端 SHALL 将合约调用参数发送到 Server
- **AND** Server SHALL 执行 `eth_call` 并返回结果
- **AND** 客户端 SHALL 使用提供的 ABI 解码结果

#### Scenario: 代理失败时回退
- **WHEN** 代理请求失败且 fallback 已启用
- **THEN** 客户端 SHALL 回退到通过 viem 直接调用 RPC

### Requirement: 代理客户端工厂
库 SHALL 提供 `createPublicClient` 函数，创建启用代理的 PublicClient。

#### Scenario: 使用 endpoint 创建代理客户端
- **WHEN** 用户调用 `createPublicClient({ chain, proxy: { endpoint: 'https://...' } })`
- **THEN** SHALL 返回带有代理 actions 的 PublicClient
- **AND** 所有读操作 SHALL 通过代理端点路由

#### Scenario: 禁用代理
- **WHEN** 用户设置 `proxy: { enabled: false }`
- **THEN** 客户端 SHALL 表现为标准的 viem PublicClient

### Requirement: 类型安全
代理客户端 SHALL 保持与 viem PublicClient 兼容的完整 TypeScript 类型安全。

#### Scenario: readContract 的类型推断
- **WHEN** 用户使用类型化 ABI 调用 `readContract`
- **THEN** 返回类型 SHALL 从 ABI 正确推断

### Requirement: 支持的方法优先级
客户端 SHALL 按优先级支持以下方法：

#### Scenario: P0 高优先级方法
- **WHEN** 客户端调用 `getBalance`, `readContract`, `getBlock`, `getBlockNumber`, `getTransaction`, `getTransactionReceipt`
- **THEN** 这些方法 SHALL 通过代理执行

#### Scenario: P1 中优先级方法
- **WHEN** 客户端调用 `call`, `estimateGas`, `getGasPrice`, `getLogs`, `getCode`
- **THEN** 这些方法 SHALL 通过代理执行

## REMOVED Requirements

### Requirement: Transport 层代理
**Reason**: 被顶层函数代理替代，以获得更好的控制和更简单的实现。
**Migration**: 使用新的带有 proxy 配置的 `createPublicClient` 替代自定义 `http()` transport。
