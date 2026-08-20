# Delta: Actions Retry and Tracing

## ADDED Requirements

### Requirement: Retry with Exponential Backoff
`makeProxyRequest` SHALL retry transient failures with exponential backoff (`delay * 2^attempt`) before surfacing the error. Transient failures are: network errors (fetch rejection), timeouts, HTTP 5xx responses, and HTTP 429 responses. All 11 proxy actions SHALL inherit retry behavior without per-action changes. Direct-RPC fallback SHALL only be attempted after retries are exhausted.

#### Scenario: Network error retried then succeeds
```typescript
// First attempt rejects, second succeeds
global.fetch = vi.fn()
  .mockRejectedValueOnce(new Error("network down"))
  .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) })

const result = await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
  endpoint: "https://proxy.example.com",
  retryOptions: { attempts: 3, delay: 1 },
})
// result === "0x1", fetch called exactly 2 times
```

#### Scenario: Retries exhausted before fallback
```typescript
// Proxy rejects 3 times (default attempts), then direct RPC answers
// fetch called 4 times total: 3 proxy attempts + 1 direct fallback call
const balance = await getBalance(client, { address: "0x..." })
```

#### Scenario: Non-retryable failures fail fast
```typescript
// 4xx response or business error body { error: { message } }:
// fetch called exactly once, error thrown immediately
```

### Requirement: Retry Policy Configuration
`ProxyActionConfig` SHALL accept optional `retryOptions: { attempts: number; delay: number }` with defaults `attempts: 3, delay: 500` (milliseconds). `attempts` is the total number of attempts including the initial request. `createPublicClient` proxy config SHALL pass `retryOptions` through to actions.

#### Scenario: Custom retry options
```typescript
const client = withProxy(viemClient, {
  endpoint: "https://proxy.example.com",
  retryOptions: { attempts: 5, delay: 100 },
})
// Up to 5 total attempts, backoffs of 100ms, 200ms, 400ms, ...
```

### Requirement: Request Trace ID
Each proxy request SHALL carry a short random trace id (12 hex characters) sent as the `X-Trace-Id` header on both GET and POST requests. All retries of the same request SHALL reuse the same trace id. When `debug` is enabled, logs SHALL include the trace id, the action method, and elapsed time in the form `[viem-proxy][trace:xxxx] <method> request:/result:/error:` plus retry warnings `[viem-proxy][trace:xxxx] <method> retry N in Mms:`.

#### Scenario: Trace header present and stable across retries
```typescript
// After one failed and one successful attempt, both fetch calls carry
// the same X-Trace-Id header matching /^[0-9a-f]{12}$/
const ids = fetchMock.mock.calls.map(([, opts]) => opts.headers["X-Trace-Id"])
expect(ids[0]).toBe(ids[1])
```

#### Scenario: Debug logging with trace id and duration
```typescript
// With debug: true, console output includes:
// [viem-proxy][trace:a1b2c3d4e5f6] getBalance request: { address: "0x123" }
// [viem-proxy][trace:a1b2c3d4e5f6] getBalance result: "0x1" (12ms)
```
