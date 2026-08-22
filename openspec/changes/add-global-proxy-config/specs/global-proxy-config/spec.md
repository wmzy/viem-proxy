# Delta: Global Proxy Config

## ADDED Requirements

### Requirement: Module-Level Default Configuration
The library SHALL provide `configureProxy(defaults: Partial<ProxyActionConfig>)`, exported from both `viem-proxy` and `viem-proxy/actions`, that stores module-level default proxy configuration. Repeated calls SHALL merge per key (later calls override earlier values per key, unmentioned keys persist). The module state SHALL be process-wide. `getProxyDefaults()` SHALL return a copy of the current defaults whose mutation does not affect the module state, and `resetProxyDefaults()` SHALL clear all module defaults, restoring built-in-only resolution. Until `configureProxy` is called, `getProxyDefaults()` SHALL return an empty object and all behavior SHALL be identical to the previous release.

#### Scenario: partial defaults merge across calls and snapshots are copies
```typescript
configureProxy({ endpoint: "https://default-proxy.example.com" })
configureProxy({ timeout: 10000 })
getProxyDefaults() // { endpoint: "https://default-proxy.example.com", timeout: 10000 }
const snapshot = getProxyDefaults()
snapshot.endpoint = "https://mutated.example.com"
getProxyDefaults().endpoint // still "https://default-proxy.example.com"
```

#### Scenario: unconfigured state is the previous behavior
```typescript
getProxyDefaults() // {}
// every entry point behaves exactly as before configureProxy existed:
// withProxy(client) leaves the client on the native path, an explicit
// config is the only source of proxy settings
```

### Requirement: Precedence Chain
Every entry point SHALL resolve its effective configuration per key with the following precedence, most specific first: explicit call-site config, client-mounted config (`createPublicClient({ proxy })` / `withProxy(client, config)`), module defaults (`configureProxy`), built-in defaults (`timeout: 30000`, `fallback: true`, `retryOptions: { attempts: 3, delay: 500 }`, `debug: false`, `apiKey: ""`). Keys never configured at any level SHALL fall back to built-in defaults. Resolution results SHALL be fresh objects: mutating a resolved config SHALL NOT corrupt the module defaults or built-in defaults.

#### Scenario: explicit call-site config wins per key, other keys inherit
```typescript
configureProxy({ endpoint: "https://default-proxy.example.com", timeout: 10000 })
const client = withProxy(baseClient, { endpoint: "https://explicit.example.com" })
getProxyConfig(client) // endpoint: explicit, timeout: 10000 (module default)
```

#### Scenario: client-mounted config beats module defaults
```typescript
configureProxy({ endpoint: "https://default-proxy.example.com", timeout: 10000 })
const client = createPublicClient({ chain, transport, proxy: { endpoint: "https://client.example.com" } })
client.proxy.endpoint   // "https://client.example.com"
client.proxy.timeout    // 10000 (inherited from module defaults)
```

#### Scenario: built-in defaults fill keys configured nowhere
```typescript
configureProxy({ endpoint: "https://default-proxy.example.com" })
resolveProxyConfig(undefined).timeout       // 30000
resolveProxyConfig(undefined).fallback      // true
resolveProxyConfig(undefined).retryOptions  // { attempts: 3, delay: 500 }
```

### Requirement: Inheritance Across All Entry Points
All entry points SHALL inherit the module defaults when their explicit config omits keys: `withProxy(client, config?)` (config optional and partial), `getProxyConfig(client)` (an unmounted client resolves through module defaults), `proxyActions(config?)` (config form accepts a partial, including `{}`), `batchActions(requests, config?)`, `preheatCache(requests, config?, chainId?)`, `purgeCache(requests, config?)` (previously required config parameters SHALL become optional), and `createPublicClient` (a client created without a `proxy` key SHALL be proxied when a module-default endpoint exists; `proxy: { enabled: false }` SHALL still opt out and keep the client's own methods on the native path). When no endpoint is configured at any level, actions SHALL stay on the native viem path exactly as before.

#### Scenario: createPublicClient without a proxy key routes through the module endpoint
```typescript
configureProxy({ endpoint: "https://default-proxy.example.com", retryOptions: { attempts: 1, delay: 0 } })
const client = createPublicClient({ chain: mainnet, transport: http() })
await client.getBalance({ address })
// single fetch to https://default-proxy.example.com/api/v1/1/getBalance?p=…
```

#### Scenario: standalone functions inherit module defaults without a config
```typescript
configureProxy({ endpoint: "https://default-proxy.example.com" })
await batchActions([{ id: 1, action: "getBlockNumber" }])
// POST https://default-proxy.example.com/api/v1/batch
await purgeCache([{ chainId: 1, action: "getBalance" }])
// POST https://default-proxy.example.com/api/v1/purge with module-default apiKey header
```

#### Scenario: preheat keeps its single-attempt default
```typescript
configureProxy({ endpoint: "https://default-proxy.example.com" }) // no retryOptions
await preheatCache([{ action: "getBalance", args }]) // failing fetch called exactly once:
// the built-in 3-attempt policy never silently applies to preheat; module
// retryOptions (when configured) and explicit retryOptions are honored
```

#### Scenario: no endpoint anywhere keeps the native path
```typescript
const client = withProxy(createPublicClient({ chain: mainnet, transport: http(rpc) })) // bare
await getBalance(client, { address }) // direct RPC call, no /api/v1/ request
```
