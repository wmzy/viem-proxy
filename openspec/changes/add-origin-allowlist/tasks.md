## 1. Implementation

- [x] 1.1 Add `workers/src/utils/origin.ts`: `parseOriginAllowlist` (unset/empty → null; comma-separated; `scheme://` stripped, ports honored; `*.example.com` wildcard matches apex + subdomains; zero-rule parse fails closed), `matchOrigin` (host-based, port-sensitive, unparseable/`null` origins never match), `ORIGIN_CHECK_EXEMPT_PATHS` (`/dashboard` only, decision documented)
- [x] 1.2 Register the origin-check middleware on `*` in `workers/src/index.ts` after the trace middleware and before rate limiting/auth, with the ordering + exemption rationale in comments; 403 = JSON-RPC `-32000` "Origin not allowed", no CORS echo, no upstream/DO work
- [x] 1.3 Tighten CORS: build hono `cors()` per env value (cached per isolate by raw var); unset → identical `origin: "*"` config; set → echo matched origin + `Vary: Origin`, no ACAO for non-matching/absent origins (preflights from outside the allowlist fail in the browser)
- [x] 1.4 `ALLOWED_ORIGINS` in `Env` (`workers/src/types.ts`); commented sample in `workers/wrangler.toml`; `cloudflare.bindings` description in `workers/package.json`
- [x] 1.5 Tests in `workers/test/handlers.test.ts` ("Origin allowlist (app-level)"): unset = zero drift (foreign origin passes, ACAO `*`, preflight unchanged), 403 before auth without upstream calls, exact/wildcard/port matching, apex + subdomains vs. lookalikes, no-Origin pass-through, preflight echo vs. silent 204, stats/health guarded + `/dashboard` exempt, zero-rule fail-closed, `Origin: null` non-matching
- [x] 1.6 Docs: README「Origin 白名单（浏览器场景防护）」section + deploy sample line; README「🔒 隐私与数据披露」section (GET-URL logging, cross-user cache sharing, no key custody / read-only proxying, API_KEY server-side-only)

## 2. Verification

- [x] 2.1 `cd workers && pnpm typecheck` clean
- [x] 2.2 `cd workers && pnpm vitest run` green (183 tests: 174 pre-existing unchanged + 9 new)
