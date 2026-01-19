## ADDED Requirements

### Requirement: Durable Objects 存储
系统 SHALL 使用 Cloudflare Durable Objects 进行持久化存储和状态管理。

#### Scenario: 存储参数哈希映射
- **WHEN** 收到大参数集
- **THEN** 参数哈希和原始参数 SHALL 存储在 DO SQLite 中
- **AND** 映射 SHALL 可通过哈希检索

#### Scenario: DO 数据过期
- **WHEN** 存储数据超过 TTL（默认 7 天）
- **THEN** 数据 SHALL 符合清理条件

### Requirement: 请求状态管理
Durable Object SHALL 跟踪进行中的请求状态以实现去重。

#### Scenario: 跟踪待处理请求
- **WHEN** 新的唯一请求到达
- **THEN** DO SHALL 创建状态为 'pending' 的待处理请求记录
- **AND** 记录 SHALL 包含请求哈希、时间戳和链 ID

#### Scenario: 完成请求
- **WHEN** RPC 调用成功完成
- **THEN** DO SHALL 将请求状态更新为 'completed'
- **AND** 存储结果供等待的请求使用

#### Scenario: 请求失败
- **WHEN** RPC 调用失败
- **THEN** DO SHALL 将请求状态更新为 'failed'
- **AND** 存储错误信息供等待的请求使用

### Requirement: SQL Schema
Durable Object SHALL 使用 SQLite 并定义参数和请求的 schema。

#### Scenario: 初始化 schema
- **WHEN** DO 首次被访问
- **THEN** 必需的表 SHALL 被创建：
  - `params` (hash TEXT PRIMARY KEY, data TEXT, created_at INTEGER, expires_at INTEGER)
  - `pending_requests` (request_hash TEXT PRIMARY KEY, status TEXT, result TEXT, error TEXT, created_at INTEGER, completed_at INTEGER)

#### Scenario: 查询待处理请求
- **WHEN** 检查重复请求
- **THEN** DO SHALL 通过 request_hash 查询 `pending_requests`
- **AND** 如果找到则返回现有的 pending/completed 结果

### Requirement: 数据清理
DO SHALL 定期清理过期数据。

#### Scenario: 定时清理
- **WHEN** DO alarm 触发（每小时一次）
- **THEN** DO SHALL 删除 `expires_at < 当前时间` 的 params 记录
- **AND** 删除 `completed_at < 当前时间 - 30秒` 的已完成请求记录
- **AND** 删除 `created_at < 当前时间 - 5分钟` 的待处理请求记录
