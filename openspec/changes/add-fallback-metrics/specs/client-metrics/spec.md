# Delta: Client-Side Performance Metrics

## ADDED Requirements

### Requirement: Fallback Observability
Every proxy request that falls back to the original RPC SHALL be recorded as a fallback event in the same metrics collector as the request metrics, exactly once per logical request (retry exhaustion collapses into one event; both the retry-exhausted path and the direct-failure path are covered). Each event SHALL carry the action method and a failure reason classified as `"network"` (proxy unreachable / fetch rejected), `"timeout"`, `"5xx"`, `"429"` (rate limited), `"abort"`, or `"other"` (proxy business errors, middleware throws, decode failures). Classification SHALL prefer the reason attached where the failure is known precisely (`RetryableError.reason` from the send path) and SHALL fall back to message-based heuristics for errors raised elsewhere. Fallback events SHALL NOT be recorded when `fallback` is disabled (the error propagates) or when the request succeeds.

`PerformanceMetrics` (returned by `getCacheStats()`) SHALL expose `fallbackCount: number`, `fallbackRate: number` (`fallbackCount / totalRequests`, 0 when no requests were recorded) and `fallbackReasons: Record<string, number>` (per-reason counts, only reasons that occurred). `MethodMetrics` SHALL expose per-method `fallbackCount`. `resetStats()` SHALL clear all fallback counters along with the other metrics. Documentation SHALL state that a fallback means the proxy delivered no value for that request, making this the key metric for proxy effectiveness.

#### Scenario: Retry exhaustion records exactly one fallback event
```typescript
resetMetrics()
// retryOptions: { attempts: 3, delay: 0 }; fetch rejects 3x (proxy attempts) then serves the direct RPC
const balance = await getBalance(client, { address: "0x…" })

const stats = getSharedCollector().getSnapshot()
// stats.fallbackCount === 1, stats.totalRequests === 1, stats.fallbackRate === 1,
// stats.methodStats.getBalance.fallbackCount === 1
```

#### Scenario: Reasons are classified per failure category
```typescript
// fetch rejects (TypeError) → fallbackReasons === { network: 1 }
// proxy responds HTTP 500   → fallbackReasons === { "5xx": 1 }
// proxy responds HTTP 429   → fallbackReasons === { "429": 1 }
// middleware throws / proxy JSON error → fallbackReasons === { other: 1 }
// mixed traffic accumulates: { "429": 1, "5xx": 1 }
```

#### Scenario: No fallback stays zero
```typescript
resetMetrics()
// successful proxied request:
const stats = getSharedCollector().getSnapshot()
// stats.fallbackCount === 0 && stats.fallbackRate === 0 && stats.fallbackReasons deep-equals {}
```

#### Scenario: Disabled fallback records nothing
```typescript
resetMetrics()
// fallback: false, fetch rejects → the action rejects (no direct-RPC call)
const stats = getSharedCollector().getSnapshot()
// stats.fallbackCount === 0 && stats.fallbackReasons deep-equals {}
```

#### Scenario: getCacheStats exposes fallback fields and resetStats clears them
```typescript
const ext = proxyActions(withProxy(client, { endpoint: "https://proxy.example.com", fallback: true }))
// proxy fetch fails once, direct RPC answers:
const stats = ext.getCacheStats()
// stats.fallbackCount === 1, stats.fallbackRate === 1, stats.fallbackReasons === { network: 1 }

ext.resetStats()
const after = ext.getCacheStats()
// after.fallbackCount === 0 && after.fallbackRate === 0 && after.fallbackReasons deep-equals {}
```

#### Scenario: classifyFallbackReason prefers the attached reason tag
```typescript
classifyFallbackReason(new RetryableError("timeout-ish wording", { reason: "abort" })) // "abort"
classifyFallbackReason(new Error("HTTP 503"))  // "5xx" (message heuristic)
classifyFallbackReason(new Error("Proxy error: execution reverted")) // "other"
```
