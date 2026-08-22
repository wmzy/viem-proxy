## 1. Implementation

- [x] 1.1 Create `workers/src/handlers/dashboard.ts`: `DASHBOARD_HTML` (single inline-HTML document, inline CSS/JS, no external assets) + `handleDashboardRequest`; page fetches `/api/v1/stats?hours=…` and renders summary cards, switchable count/errorCount/p50/p95/p99 bar chart (error share marked red in count mode), bucket table
- [x] 1.2 Page controls: 24h/7d window toggle, `chainId`/`method` filter inputs, optional API-key field (sent only as `X-API-Key`), manual refresh button, 30 s auto-refresh switch; 401 from stats shows a guidance banner
- [x] 1.3 Register `GET /dashboard` in `workers/src/index.ts` (route after `/api/v1/stats`); add `/dashboard` to `PUBLIC_API_PATHS` (`workers/src/utils/auth.ts`) and `RATE_LIMIT_EXEMPT_PATHS` (`workers/src/utils/rate-limit.ts`) with defense-in-depth comments
- [x] 1.4 Tests in `workers/test/handlers.test.ts` (`Stats dashboard (app-level)` describe): 200 text/html with DOM hooks, no external script/style/URL references, credential-free with `API_KEY` set, registry membership, shell contacts no DO/upstream
- [x] 1.5 Docs: README「服务端监控端点 → 统计仪表盘」; GETTING_STARTED「验证部署」 browser mention

## 2. Verification

- [x] 2.1 `cd workers && pnpm typecheck` clean
- [x] 2.2 `cd workers && pnpm vitest run test/handlers.test.ts` green (108 tests, incl. 5 new dashboard tests)
- [x] 2.3 openspec change dir `openspec/changes/add-stats-dashboard/` complete (proposal + tasks + spec delta; CLI unavailable locally, format follows existing changes)
