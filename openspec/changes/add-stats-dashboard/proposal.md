# Change: Add Stats Dashboard

## Why
`GET /api/v1/stats` answers every operational question (volume, hit rate, errors, latency percentiles) but only as raw JSON — reading it means squinting at `periods` arrays by hand. Deployers verifying a fresh instance or watching traffic during an incident want an at-a-glance view. A built-in dashboard page turns the same endpoint into a ops view with zero tooling: no build step, no external assets, deploy-and-open.

## What Changes
- New `GET /dashboard` serving a **single self-contained HTML document** (handler module `workers/src/handlers/dashboard.ts` exporting the `DASHBOARD_HTML` constant + `handleDashboardRequest`; registered in `workers/src/index.ts` after the stats route):
  - All CSS and JS **inline** — no `<script src>`, no external stylesheet, no CDN or any external network dependency (privacy + availability)
  - Browser-side `fetch("/api/v1/stats?hours=24")` renders: summary cards (总请求数 / 缓存命中率 / 错误率 / 平均上游延迟), an hourly bucket **bar chart** switchable across `count` / `errorCount` / `p50` / `p95` / `p99` (count mode marks the per-bucket error share in red), and the bucket **detail table**
  - **Filters**: `chainId` / `method` text inputs forwarded as query params; **window toggle** 近 24 小时 (24h) / 近 7 天 (168h); optional **auto-refresh** every 30 s
  - **Auth-aware**: when the stats endpoint returns 401 (an `API_KEY` is configured), the page shows a guidance banner instead of a blank error, with an optional in-page key field sent strictly as the `X-API-Key` header (never in the URL)
  - All text interpolation is HTML-escaped server-side-independent (the page builds DOM only from JSON numbers/strings via an escape helper)
- **Exemption registration**: `/dashboard` added to `PUBLIC_API_PATHS` (`workers/src/utils/auth.ts`) and `RATE_LIMIT_EXEMPT_PATHS` (`workers/src/utils/rate-limit.ts`) as a read-only monitoring surface. Defense-in-depth by design: the path sits outside both middlewares' mount scopes (`/api/*`, `/api/v1/*`), so the entries document intent and guard against future scope changes; the operative exemption is the mount scope. The page shell carries **no data** — every number is fetched through `/api/v1/stats`, which keeps its existing auth and rate-limit rules untouched
- The dashboard shell emits no `StatsRecord` and contacts no DO/upstream (verified by test)
- Docs: README「服务端监控端点 → 统计仪表盘」 subsection; GETTING_STARTED「验证部署」 mentions opening `/dashboard` in a browser

## Impact
- Affected specs: `workers-backend` (new requirement)
- Affected code:
  - `workers/src/handlers/dashboard.ts` — new: `DASHBOARD_HTML`, `handleDashboardRequest`
  - `workers/src/index.ts` — import + one route (`app.get("/dashboard", handleDashboardRequest)`)
  - `workers/src/utils/auth.ts` — `PUBLIC_API_PATHS` gains `"/dashboard"`
  - `workers/src/utils/rate-limit.ts` — `RATE_LIMIT_EXEMPT_PATHS` gains `"/dashboard"`
  - `workers/test/handlers.test.ts` — new `Stats dashboard (app-level)` describe (5 tests)
  - `README.md`, `GETTING_STARTED.md` — monitoring/deploy-verification docs
- No breaking changes: new page route only; stats endpoint behavior untouched
