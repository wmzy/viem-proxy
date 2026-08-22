## 1. Implementation

- [x] 1.1 Add `RateLimiter` Durable Object: per-minute SQLite counter (`rate_limit_counters`), `GET /consume?limit=N` protocol, lazy purge of stale buckets
- [x] 1.2 Add `RATE_LIMITER` Env binding, wrangler `[[durable_objects.bindings]]` + migration `v3` (`new_sqlite_classes = ["RateLimiter"]`), export `RateLimiter` from the worker entrypoint
- [x] 1.3 Add `workers/src/utils/rate-limit.ts`: `parseRateLimitPerMinute` (unset/invalid → 60, `"0"` → disabled, floors integers), `resolveClientId` (CF-Connecting-IP → `"unknown"`), `RATE_LIMIT_EXEMPT_PATHS` (`/api/v1/stats`, `/api/v1/health`), `RateLimitVerdict`
- [x] 1.4 Register the rate-limit middleware on `/api/v1/*` in `workers/src/index.ts`, before the auth middleware, with the ordering rationale documented; 429 = `Retry-After` + JSON-RPC `-32005`, recorded as `method = "rate_limit"` error stats
- [x] 1.5 Health endpoint (`handlers/health.ts`) derives `rateLimit.enabled/limitPerMinute` from the shared parser (no duplicated semantics)
- [x] 1.6 Tests in `workers/test/handlers.test.ts`: helper parsing, DO window counting/purge/protocol errors, middleware 429 + `Retry-After`, per-IP isolation, unknown-IP fallback, 401s consume budget, exempt endpoints, `RATE_LIMIT_PER_MINUTE=0` disables, DO failure fails open, 429s recorded as error stats
- [x] 1.7 Docs: README variable table + `wrangler.toml` sample +「限流（滥用防护）」section; GETTING_STARTED sample + note; `workers/package.json` `cloudflare.bindings`

## 2. Verification

- [x] 2.1 `cd workers && pnpm typecheck` clean
- [x] 2.2 `cd workers && pnpm vitest run` green (169 tests)
- [x] 2.3 `cd workers && npx wrangler deploy --dry-run --outdir /tmp/rl-dry` succeeds (RATE_LIMITER binding present, migration v3 accepted)
