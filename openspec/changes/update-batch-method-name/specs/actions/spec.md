# Delta: Rename Client Batch Method to batchProxy

## REMOVED Requirements

### Requirement: Batch Action Requests

Removed because it specifies the extension-object method as `batch(requests)`. That name collides with viem's core `batch` multicall config property: viem's `client.extend()` deletes extension keys that collide with core client properties at runtime, and its strict `Extended` type guard pins `batch?: undefined`, so the method was both stripped and type-rejected in extend mode. The requirement is superseded by "Batch Proxy Method Naming", which specifies the same capability under a collision-free name.

## ADDED Requirements

### Requirement: Batch Proxy Method Naming

The client-facing batch method SHALL be named `batchProxy` on the `ProxyActions` extension object and on the `ProxyPublicClient` type. The library SHALL NOT expose the batch capability under the name `batch` on a client, because viem clients carry `batch` as a core multicall config property. `batchProxy` SHALL remain available and typed in every usage pattern, including `client.extend(proxyActions(...))`. The top-level function `batchActions(requests, config, defaultChainId?)` SHALL keep its name and signature.

#### Scenario: batchProxy survives viem extend

```typescript
import { createPublicClient, http } from 'viem'
import { proxyActions } from 'viem-proxy/actions'

const client = createPublicClient({ chain: mainnet, transport: http() }).extend(
  proxyActions({ endpoint: 'https://proxy.example.com' })
)

// viem's extend strips extension keys colliding with core client properties
// (`batch` would be stripped); `batchProxy` survives and is callable + typed
const results = await client.batchProxy([{ id: 1, action: 'getBlockNumber' }])
```

#### Scenario: createPublicClient wrapper exposes batchProxy

```typescript
import { createPublicClient } from 'viem-proxy'

const client = createPublicClient({
  chain: mainnet,
  proxy: { enabled: true, endpoint: 'https://proxy.example.com' },
})

const results = await client.batchProxy([{ id: 1, action: 'getGasPrice' }])
```

#### Scenario: top-level batchActions keeps its name

```typescript
import { batchActions } from 'viem-proxy/actions'

const results = await batchActions(
  [{ id: 1, action: 'getBalance', args: { address: '0x...' } }],
  { endpoint: 'https://proxy.example.com' }
)
```
