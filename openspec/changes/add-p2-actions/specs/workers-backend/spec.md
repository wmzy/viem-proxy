# Delta: P2 Server Handlers and Cache Policy

## ADDED Requirements

### Requirement: P2 Server Action Handlers
Workers SHALL 注册 5 个新 action handler（`getChainId`、`getTransactionCount`、`getStorageAt`、`getFeeHistory`、`getBlobBaseFee`）并在 `ACTION_TO_RPC_METHOD` 中映射到对应 RPC 方法：`eth_chainId`、`eth_getTransactionCount`、`eth_getStorageAt`、`eth_feeHistory`、`eth_blobBaseFee`。块参数 SHALL 按 `blockNumber`（十进制字符串）→ hex、否则 `blockTag`（默认 `latest`）编码。

#### Scenario: RPC method and params mapping
```typescript
await getStorageAtHandler({ chainId: 1, args: { address: '0x..', slot: '0x0' }, env })
// upstream JSON-RPC body: method "eth_getStorageAt", params ["0x..", "0x0", "latest"]

await getFeeHistoryHandler({ chainId: 1, args: { blockCount: 4, rewardPercentiles: [25, 75] }, env })
// upstream body: method "eth_feeHistory", params ["0x4", "latest", [25, 75]]
```

#### Scenario: blockNumber hex encoding
```typescript
await getTransactionCountHandler({ chainId: 1, args: { address: '0x..', blockNumber: '100' }, env })
// params ["0x..", "0x64"]
```

#### Scenario: getFeeHistory passes through the raw payload
```typescript
// upstream result { oldestBlock: "0x5", baseFeePerGas: [...], gasUsedRatio: [...] }
// handler returns { result: <raw payload>, blockNumber: "0x5" } — bigint conversion stays client-side
```

### Requirement: P2 Cache TTL Policy
新 RPC 方法的缓存 TTL SHALL 按数据特性配置：`eth_chainId` 3600 秒（网络信息，长期不变）；`eth_getTransactionCount` 30 秒（状态数据）；`eth_getStorageAt` 按块参数复用与 `eth_getBlockByNumber` 相同的区块感知分档（finalized → 30 天长期缓存，确认数分档，`latest`/`pending` → 12 秒，兜底 300 秒）；`eth_feeHistory`、`eth_blobBaseFee` 12 秒（最新数据）。

#### Scenario: Chain id caches for one hour
```typescript
getCacheStrategy(1, 'eth_chainId', []) // ttl === 3600
```

#### Scenario: Fee data caches for one block time
```typescript
getCacheStrategy(1, 'eth_feeHistory', ['0x4', 'latest', []]) // ttl === 12
getCacheStrategy(1, 'eth_blobBaseFee', []) // ttl === 12
getCacheStrategy(1, 'eth_getTransactionCount', ['0x..', 'latest']) // ttl === 30
```

#### Scenario: Storage queries follow block-aware tiers
```typescript
getCacheStrategy(1, 'eth_getStorageAt', ['0x..', '0x0', 'latest']) // ttl === 12
getCacheStrategy(1, 'eth_getStorageAt', ['0x..', '0x0', '0x3f0'], 300, 0x400) // recent, ttl === 300
getCacheStrategy(1, 'eth_getStorageAt', ['0x..', '0x0', '0x100'], 300, 0x400) // finalized, ttl === 2592000
```
