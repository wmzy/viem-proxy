# Change: Add Retry Mechanism and Request Tracing

## Why
Proxy requests currently fail on the first transient error (network glitch, timeout, 5xx from the edge, 429 rate limit) and immediately hit the fallback path, even though a single retry usually succeeds. There is also no way to correlate a client request with server-side logs, making debugging production issues guesswork. This implements PRD 4.1 (`retryOptions`) and part of PRD 3.2 (debug tracing).

## What Changes
- Add `ProxyRetryOptions` (`{ attempts, delay }`) to `ProxyActionConfig`; default `attempts: 3, delay: 500ms`
- Implement `withRetry` with exponential backoff (`delay * 2^attempt`) inside `makeProxyRequest`, so all 11 actions benefit without per-action changes
- Retry only transient failures: network errors, timeouts, 5xx responses and 429; 4xx (except 429) and business errors (response body `error` field) fail fast
- Fallback still wins over the final failure: direct-RPC fallback is only invoked after retries are exhausted (retry happens inside `makeProxyRequest`, fallback in the action's catch)
- Generate a short random trace id (12 hex chars) per request, reused across retries of the same request
- Send `X-Trace-Id` header on every proxy request (GET and POST) for server-side correlation
- Debug logs now include the trace id and elapsed time: `[viem-proxy][trace:xxxx] <method> request:/result:/error:/retry N in Mms:`
- Pass `retryOptions` through `createPublicClient`'s proxy config into the action config

## Impact
- Affected specs: `actions`
- Affected code:
  - `src/actions/types.ts` — add `ProxyRetryOptions`, `retryOptions` field
  - `src/actions/utils.ts` — `withRetry`, trace id generation, `X-Trace-Id` header, trace-aware debug logs, `DEFAULT_RETRY_OPTIONS`
  - `src/client.ts` — pass `retryOptions` through `withProxy`
  - `src/test/utils.test.ts`, `src/test/actions.test.ts` — retry/trace coverage; existing fallback tests pinned to `attempts: 1` to keep testing pure fallback
- No breaking API changes: `retryOptions` is optional and defaults preserve prior single-attempt semantics only when explicitly disabled
