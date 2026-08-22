# Delta: Client-Side Performance Metrics

## REMOVED Requirements

### Requirement: clearCache Extension Method
**Reason**: The name `clearCache` claimed to clear a cache while the implementation only resets the locally collected client-side statistics — misleading. `resetStats(): void` (ADDED below) replaces it with an honest name and identical synchronous behavior.
**Migration**: Replace every `client.clearCache()` call with `client.resetStats()`. The package is unpublished, so no alias is kept (clean cutover).

#### Scenario: clearCache no longer exists
```typescript
client.clearCache()
// TypeScript error: Property 'clearCache' does not exist on type 'ProxyPublicClient'
```

### Requirement: Async Metric Aliases
**Reason**: `getMetrics(): Promise<PerformanceMetrics>` and `clearMetrics(): Promise<boolean>` were redundant async duplicates of the synchronous `getCacheStats()` and the reset operation, under inconsistent names. The synchronous `getCacheStats()` is the single canonical metrics reader.
**Migration**: Replace `await client.getMetrics()` with `client.getCacheStats()` (already synchronous) and `await client.clearMetrics()` with `client.resetStats()`.

#### Scenario: getMetrics and clearMetrics no longer exist
```typescript
await client.getMetrics()
await client.clearMetrics()
// TypeScript errors: Property 'getMetrics'/'clearMetrics' does not exist on type 'ProxyPublicClient'
```

## ADDED Requirements

### Requirement: resetStats Extension Method
The `proxyActions(client)` extension object and `ProxyPublicClient` (from `createPublicClient`) SHALL expose `resetStats(): void`. `resetStats` SHALL reset the locally collected metric statistics; it SHALL NOT purge the CDN cache — purging requires server-side support provided in a later version, and this constraint SHALL be documented in code and docs. The synchronous `getCacheStats(): PerformanceMetrics` SHALL remain the single canonical metrics reader.

#### Scenario: resetStats resets local metrics
```typescript
const ext = proxyActions(withProxy(client, { endpoint: "https://proxy.example.com" }))
await ext.getBalance({ address: "0x..." })
// ext.getCacheStats().totalRequests === 1

ext.resetStats()

const stats = ext.getCacheStats()
// stats.totalRequests === 0 && stats.methodStats deep-equals {}
```

#### Scenario: Exposed on createPublicClient clients
```typescript
const client = createPublicClient({ chain: mainnet, proxy: { endpoint: "https://proxy.example.com" } })
// typeof client.getCacheStats === "function" && typeof client.resetStats === "function"
```

#### Scenario: No cache is purged
```typescript
// resetStats drops only local counters/samples; it issues no request
// to the proxy or CDN (a fetch mock records zero calls)
client.resetStats()
```
