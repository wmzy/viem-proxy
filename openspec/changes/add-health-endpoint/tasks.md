## 1. Implementation

- [x] 1.1 Add `getSupportedChainIds()` to `workers/src/actions/utils.ts` (defaults ∪ custom, narrowed by allowlist, sorted)
- [x] 1.2 Create `workers/src/handlers/health.ts`: `SERVICE_VERSION`, `parseRateLimit`, shallow snapshot, bounded `?deep=1` probing (≤ 5 chains, 2.5 s `AbortController` timeout per probe)
- [x] 1.3 Exempt the endpoint from API-key auth via `PUBLIC_API_PATHS` (`workers/src/utils/auth.ts`) checked in the `/api/*` middleware; register `GET /api/v1/health` in `workers/src/index.ts`
- [x] 1.4 Add `RATE_LIMIT_PER_MINUTE?: string` to `Env` (`workers/src/types.ts`); health reports `{ enabled, limitPerMinute }` defensively (env optional)
- [x] 1.5 Tests in `workers/test/handlers.test.ts` (`Health endpoint (app-level)` describe): default shape, no-credential access with `API_KEY` set, no upstream URL leakage (counts only, rejects any `http(s)://` in the payload), degraded-on-empty, rate-limit variants, deep success/failure/timeout-settles, probe-count cap constant
- [x] 1.6 Docs: README「健康检查端点」(API docs, with response examples); GETTING_STARTED「验证部署」deploy-verification step

## 2. Verification

- [x] 2.1 `cd workers && pnpm typecheck` clean
- [x] 2.2 `cd workers && pnpm test` green (150 tests, incl. 84 in `handlers.test.ts`)
- [x] 2.3 openspec change dir `openspec/changes/add-health-endpoint/` complete (proposal + tasks + spec delta; CLI unavailable locally, format follows existing changes)
