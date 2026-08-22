# Change: Add Health Endpoint

## Why
Deployers currently have no cheap way to confirm a deployment is live and correctly configured. `GET /` returns a static stub, `/api/v1/stats` requires the `STATISTICS` binding and reports traffic rather than configuration, and both demand reading deploy logs to answer "did my env vars land?". A dedicated health endpoint removes this operational blind spot: one unauthenticated request shows the service version, servable chains, upstream counts, Durable Object binding health, and the effective rate-limit configuration.

## What Changes
- New `GET /api/v1/health` (handler `workers/src/handlers/health.ts`, registered in the route region of `workers/src/index.ts`) returning:
  - `status`: `"ok"` normally; `"degraded"` when no chain is servable (empty `RPC_URLS` ∩ `ALLOWED_CHAIN_IDS`) or — in deep mode only — when every probed upstream failed
  - `version` (`SERVICE_VERSION` constant, synced with workers/package.json), `environment` (`ENVIRONMENT`)
  - `chains`: `{ chainId, upstreams }` for every currently servable chain (defaults ∪ `RPC_URLS`, narrowed by `ALLOWED_CHAIN_IDS`) — **URL counts only, never the URLs themselves**, which may embed provider API keys
  - `durableObjects`: `{ proxyState, statistics }` binding availability (Boolean presence, no probes)
  - `rateLimit`: `{ enabled, limitPerMinute }` parsed from the optional `RATE_LIMIT_PER_MINUTE` env var via the same `parseRateLimitPerMinute` the rate-limit middleware enforces (`workers/src/utils/rate-limit.ts`), so the reported value can never contradict enforcement (unset/invalid → enabled with default 60, `"0"` → disabled)
- Shallow mode (default) performs **zero upstream RPC calls** — safe for high-frequency uptime polling. `?deep=1` optionally probes the first `HEALTH_DEEP_MAX_CHAINS = 5` chains with one `eth_chainId` call each (`HEALTH_DEEP_TIMEOUT_MS = 2500` via `AbortController`), reporting `{ checked, chains: [{ chainId, ok, latencyMs }] }`; probe failures degrade to `ok: false` and never throw
- **Authentication exemption**: the endpoint stays credential-free even when `API_KEY` is configured, via `PUBLIC_API_PATHS` (`workers/src/utils/auth.ts`) checked in the existing `/api/*` auth middleware — uptime monitors must not carry the API key. The set is exported so other middlewares (e.g. rate limiting) can reuse the same exemption list; the rate-limit middleware keeps its own separate `RATE_LIMIT_EXEMPT_PATHS` (health + stats) as the two concerns differ
- **Not recorded in statistics**: the endpoint proxies nothing, so no `StatsRecord` is emitted
- Uptime is deliberately not reported: Cloudflare isolates are ephemeral and may be recycled between requests, so a Worker-computed uptime is unreliable
- `getSupportedChainIds()` added to `workers/src/actions/utils.ts` (sorted ascending enumeration of servable chains), reusing the existing `isSupportedChainId` logic
- `Env` gains optional `RATE_LIMIT_PER_MINUTE?: string`

## Impact
- Affected specs: `workers-backend` (new requirement)
- Affected code:
  - `workers/src/handlers/health.ts` — new: `SERVICE_VERSION`, deep-probe constants, `parseRateLimit`, `handleHealthRequest`
  - `workers/src/index.ts` — route registration + `PUBLIC_API_PATHS` check in the auth middleware
  - `workers/src/utils/auth.ts` — exported `PUBLIC_API_PATHS`
  - `workers/src/actions/utils.ts` — exported `getSupportedChainIds`
  - `workers/src/types.ts` — `RATE_LIMIT_PER_MINUTE` env type
  - `workers/test/handlers.test.ts` — new `Health endpoint (app-level)` describe
  - `README.md` (API docs「健康检查端点」), `GETTING_STARTED.md` (deploy「验证部署」)
- No breaking changes: new endpoint only; the auth middleware change is additive (one more path exempted from the key check, by design)
