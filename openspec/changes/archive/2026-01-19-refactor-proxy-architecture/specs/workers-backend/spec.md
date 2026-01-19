## ADDED Requirements

### Requirement: 基于函数的请求处理
Workers 后端 SHALL 接受带有序列化参数的基于函数的请求。

#### Scenario: 处理 getBalance 请求
- **WHEN** Server 收到 POST `/api/v1/{chainId}/getBalance` 带有 `{ address: '0x...' }`
- **THEN** Server SHALL 执行 `eth_getBalance` RPC 调用
- **AND** 返回带有适当缓存头的结果

#### Scenario: 处理 readContract 请求
- **WHEN** Server 收到 POST `/api/v1/{chainId}/readContract` 带有合约调用参数
- **THEN** Server SHALL 编码调用数据并执行 `eth_call`
- **AND** 返回原始结果供客户端解码

### Requirement: 请求去重
Workers 后端 SHALL 使用 Durable Objects 对并发的相同请求进行去重。

#### Scenario: 并发相同请求
- **WHEN** 多个相同请求同时到达
- **THEN** 只 SHALL 向上游提供者发起一次 RPC 调用
- **AND** 所有等待的请求 SHALL 收到相同的结果

#### Scenario: 请求去重超时
- **WHEN** 待处理请求超过超时阈值
- **THEN** 请求 SHALL 被标记为失败
- **AND** 后续相同请求 SHALL 触发新的 RPC 调用

### Requirement: 响应格式
Server SHALL 返回统一的响应格式。

#### Scenario: 成功响应
- **WHEN** RPC 调用成功
- **THEN** Server SHALL 返回 `{ result: any, blockNumber?: string, timestamp: number }`
- **AND** HTTP 状态码 SHALL 为 200

#### Scenario: 错误响应
- **WHEN** RPC 调用失败
- **THEN** Server SHALL 返回 `{ error: { code: number, message: string } }`
- **AND** HTTP 状态码 SHALL 为 4xx 或 5xx

## MODIFIED Requirements

### Requirement: 缓存策略
Workers 后端 SHALL 基于数据类型和区块确认状态实现智能缓存。

#### Scenario: 缓存已确认区块数据
- **WHEN** 请求针对已确认区块（通过 epoch 确认）
- **THEN** 响应 SHALL 使用长 TTL 缓存（默认 30 天）

#### Scenario: 缓存近期数据
- **WHEN** 请求针对近期/pending 数据
- **THEN** 响应 SHALL 使用短 TTL 缓存（12-30 秒）

#### Scenario: 缓存历史交易
- **WHEN** 请求通过 hash 查询交易
- **THEN** 响应 SHALL 使用 1 年 TTL 缓存

## REMOVED Requirements

### Requirement: 基于 KV 的参数存储
**Reason**: 被 Durable Objects 替代，以获得更好的一致性和请求去重支持。
**Migration**: 参数存储现在由 DO 的 SQLite 存储处理。
