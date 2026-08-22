# Change: Add Per-IP Rate Limiting

## Why
A self-deployed instance fronts the deployer's own upstream RPC quota and Workers request budget. Without a rate limit, any third party that discovers the `*.workers.dev` endpoint (or any leaked API key) can drain that quota. Authentication (`API_KEY`) gates *who* may call, but says nothing about *how fast* — and unauthenticated floods still burn Workers invocations.

## What Changes
- New `RateLimiter` Durable Object (`workers/src/durable-objects/rate-limiter.ts`): fixed 60-second-window counter persisted in SQLite (`rate_limit_counters(minute INTEGER PRIMARY KEY, count INTEGER)`), stale buckets (> 2 minutes old) purged on write. One DO instance per client id (`RATE_LIMITER.idFromName(clientId)`), so each client's budget lives in a single single-threaded object — globally accurate across isolates and PoPs (an isolate-local counter would undercount), and one flooding client cannot hot-spot the object tracking another. Fixed window (vs. sliding) deliberately trades up-to-2x burst at a minute boundary for O(1) storage and a single read-modify-write
- Client identity: the `CF-Connecting-IP` header (set by Cloudflare on every proxied request); when absent (local dev, direct Node tests) all callers share the `"unknown"` bucket, so the endpoint stays bounded in total
- New middleware in `workers/src/index.ts` on `/api/v1/*`, registered **before** the auth middleware: it is the outermost abuse guard, so floods of unauthenticated/invalid-key requests are rejected without config/auth work, and 401 responses still consume the attacker's own per-IP budget (decision documented in code comments). Sits after the trace middleware so 429s still carry `X-Trace-Id`/`X-Cache`
- Configuration via `RATE_LIMIT_PER_MINUTE` (string env var): unset/empty/invalid/negative → default `60`; `"0"` → disabled (no DO call at all); positive values floored to integers. Invalid values fail toward protection (default), never silently off
- Scope: all `/api/v1/*` proxy endpoints. Exempt (`RATE_LIMIT_EXEMPT_PATHS` in `workers/src/utils/rate-limit.ts`): the read-only monitoring endpoints `/api/v1/stats` and `/api/v1/health`, so an operator can observe and probe the instance while a flood fills every other bucket. Rate-limit exemption is a different concern from auth exemption (`PUBLIC_API_PATHS`): exempt paths remain authenticated when `API_KEY` is set
- Over-limit response: HTTP `429`, `Retry-After: <seconds-to-window-rollover>` (1–60), JSON-RPC error `{ code: -32005, message: "Rate limit exceeded", data: { retryAfterSeconds } }`. 429s never count as successes: they are recorded to the Statistics DO as errors under `method = "rate_limit"`, `chainId = 0` (filterable via `GET /api/v1/stats?method=rate_limit`), keeping `/api/v1/stats` semantics (`errorCount`/`errorRate`) intact
- Fail-open semantics: a missing `RATE_LIMITER` binding or an unreachable/erroring DO lets the request through — rate limiting is a protection add-on, never a hard dependency of the proxy path
- Env binding `RATE_LIMITER` (`workers/src/types.ts`) + wrangler migration `v3` (`new_sqlite_classes = ["RateLimiter"]`); `RateLimiter` exported from the worker entrypoint
- Docs: README deploy variable table + manual `wrangler.toml` sample + new「限流（滥用防护）」section; GETTING_STARTED sample + note; `workers/package.json` `cloudflare.bindings` description for `RATE_LIMIT_PER_MINUTE`

## Impact
- Affected specs: `workers-backend` (new requirements)
- Affected code:
  - `workers/src/utils/rate-limit.ts` — new: `DEFAULT_RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_EXEMPT_PATHS`, `RateLimitVerdict`, `parseRateLimitPerMinute`, `resolveClientId`
  - `workers/src/durable-objects/rate-limiter.ts` — new DO (`GET /consume?limit=N` protocol)
  - `workers/src/index.ts` — rate-limit middleware (before auth), `RateLimiter` export
  - `workers/src/handlers/health.ts` — `parseRateLimit` now delegates to the shared `parseRateLimitPerMinute` (single source of truth; duplicate local parser and constant removed, semantics unchanged)
  - `workers/src/types.ts`, `workers/wrangler.toml`, `workers/package.json`
  - `workers/test/handlers.test.ts` — helper parsing, DO fixed-window behavior (fake SQL shim), middleware behavior (429 + Retry-After, per-IP isolation, unknown-IP fallback, 401s consume budget, exemptions, disable, fail-open, 429 error stats)
- No breaking API changes: default behavior adds 429 beyond 60 req/min/IP on `/api/v1/*`; monitoring endpoints and non-`/api/v1` paths unaffected; clients that honor `Retry-After` (the client's retry logic already treats 429 as retryable with backoff)
