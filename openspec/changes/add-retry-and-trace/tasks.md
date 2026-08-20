## 1. Types and Configuration
- [x] 1.1 Add `ProxyRetryOptions` type and `retryOptions?: ProxyRetryOptions` to `ProxyActionConfig` (`src/actions/types.ts`)
- [x] 1.2 Add `DEFAULT_RETRY_OPTIONS` (`attempts: 3, delay: 500`) and sync `DEFAULT_PROXY_CONFIG` (`src/actions/utils.ts`)
- [x] 1.3 Pass `retryOptions` from `createPublicClient` proxy config into `withProxy` (`src/client.ts`)

## 2. Retry with Exponential Backoff
- [x] 2.1 Implement `withRetry` (exponential backoff `delay * 2^attempt`, non-retryable errors abort immediately)
- [x] 2.2 Classify retryable failures in `makeProxyRequest`: fetch rejections (network/timeout), 5xx, 429
- [x] 2.3 Do not retry 4xx (except 429) or business errors (response body `error` field)
- [x] 2.4 Ensure direct-RPC fallback in actions only triggers after retries are exhausted

## 3. Request Tracing
- [x] 3.1 Generate short random trace id (12 hex chars) per request, reused across retries
- [x] 3.2 Send `X-Trace-Id` header on GET and POST proxy requests
- [x] 3.3 Debug logs: `[viem-proxy][trace:xxxx] <method> request:/result:/error:` with elapsed time, plus retry warnings

## 4. Tests
- [x] 4.1 Retry on network error then succeed; exhaustion throws after exactly `attempts` calls
- [x] 4.2 Exponential backoff timing verified with fake timers
- [x] 4.3 5xx retried, 429 retried, 4xx not retried, business error not retried
- [x] 4.4 `X-Trace-Id` present (GET/POST) and identical across retries
- [x] 4.5 Debug logs include trace id and duration; `DEFAULT_PROXY_CONFIG`/`mergeProxyConfig` defaults
- [x] 4.6 Existing fallback tests pinned to `attempts: 1`; new ordering test (retries exhaust before fallback)

## 5. Verification
- [x] 5.1 `npm run test` all green (198 tests)
- [x] 5.2 `npm run typecheck` clean
- [x] 5.3 `openspec validate add-retry-and-trace --strict --no-interactive` passes
