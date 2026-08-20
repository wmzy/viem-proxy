# Delta: P2 Client Read Actions

## ADDED Requirements

### Requirement: P2 Read Actions
`getChainId`、`getTransactionCount`、`getStorageAt`、`getFeeHistory`、`getBlobBaseFee` SHALL 可以从 `viem-proxy/actions` 单独导入，并 SHALL 暴露在 `proxyActions` 扩展对象上，参数与返回语义对齐 viem 同名 action。

#### Scenario: getChainId through proxy
```typescript
import { getChainId } from 'viem-proxy/actions'
const chainId = await getChainId(client)
// GET {endpoint}/api/v1/{chainId}/getChainId → hex "0x1" converted to number 1
```

#### Scenario: getTransactionCount with block parameters
```typescript
const count = await getTransactionCount(client, { address: '0x...', blockTag: 'latest' })
// number 42 (hex nonce converted)
const pending = await getTransactionCount(client, { address: '0x...', blockNumber: 100n })
// blockNumber serialized as string and hex-encoded server-side
```

#### Scenario: getStorageAt serializes the slot
```typescript
const value = await getStorageAt(client, { address: '0x...', slot: 69n })
// slot 69n → "0x45"; result passthrough hex string
const hexSlot = await getStorageAt(client, { address: '0x...', slot: '0xdeadbeef' })
// hex slots pass through unchanged
```

#### Scenario: getFeeHistory formats bigints
```typescript
const history = await getFeeHistory(client, { blockCount: 2, rewardPercentiles: [25, 75] })
// { baseFeePerGas: [1n, 2n], gasUsedRatio: [0.5, 0.6], oldestBlock: 5n, reward: [[3n, 4n], [5n, 6n]] }
// `reward` is omitted when the RPC response carries none
```

#### Scenario: getBlobBaseFee through proxy
```typescript
const fee = await getBlobBaseFee(client)
// hex "0x3e8" converted to bigint 1000n
```

### Requirement: P2 Action Fallback Behavior
P2 actions SHALL 遵循与既有 action 相同的 fallback 语义：代理请求失败且未显式 `fallback: false` 时回退到 viem 原生 action；`fallback: false` 时向上抛出代理错误。

#### Scenario: Fallback on proxy failure
```typescript
const client = withProxy(viemClient, { endpoint: 'https://failing-proxy.com', fallback: true })
const chainId = await getChainId(client) // resolved by the direct eth_chainId call
```

#### Scenario: Fallback disabled throws
```typescript
const client = withProxy(viemClient, { endpoint: 'https://failing-proxy.com', fallback: false })
await expect(getChainId(client)).rejects.toThrow('fail')
```

### Requirement: P2 Actions in Batch Requests
P2 actions SHALL 属于 `BatchActionName` 联合类型：可作为 `batchActions`/`batch()` 的 batch item，且在客户端无 proxy 配置时通过对应原生 action 执行。

#### Scenario: P2 action as a batch item
```typescript
const results = await batchActions(
  [
    { id: 1, action: 'getChainId' },
    { id: 2, action: 'getTransactionCount', args: { address: '0x...' } },
  ],
  { endpoint: 'https://proxy.example.com' }
)
// both items execute through the batch/single proxy path
```

#### Scenario: Native execution without proxy config
```typescript
const plainClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
const results = await proxyActions(plainClient).batch([{ id: 1, action: 'getBlobBaseFee' }])
// executed via the native getBlobBaseFee client function; results[0].result is a bigint
```
