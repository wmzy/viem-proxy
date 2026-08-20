## 1. Cache Preheat
- [x] 1.1 Create `src/actions/preheat.client.ts`: `PreheatRequest = { action: BatchActionName, args? }`, `PreheatResult = { submitted, failed }`, `PREHEAT_CONCURRENCY = 5`
- [x] 1.2 `preheatCache(requests, config?, defaultChainId = 1)`: each item through the `makeProxyRequest` compressed GET path in a bounded 5-worker pool; never throws; default `retryOptions: { attempts: 1, delay: 0 }` unless explicitly provided; debug warning per failed item
- [x] 1.3 `preheatClientCache(client, requests)`: resolves config + chain from the client; no proxy config → `{ submitted: 0, failed: 0 }`
- [x] 1.4 Expose `preheatCache` on the `proxyActions` extension object; `createPublicClient` delegates to the shared implementation (legacy `/api/v1/direct` helper removed)

## 2. Proxy Middleware
- [x] 2.1 Create `src/actions/middleware.ts`: module-level registry with `addMiddleware` / `clearMiddlewares` / `getMiddlewares`, `applyMiddlewareChain` wraps a core sender onion style (first registered outermost)
- [x] 2.2 `makeProxyRequest` wraps the actual send in the chain; request shape `{ functionName, chainId, args }`; modified values drive URL/compression/GET-POST decision and strategy metrics
- [x] 2.3 Blocking error semantics: a middleware throw aborts the request and follows the existing fallback/error path (failed metrics entry recorded); a response with neither `result` nor `error` is a failure; short-circuit responses are returned as-is
- [x] 2.4 `use(mw)` exposed on the `proxyActions` extension object and on `createPublicClient` clients
- [x] 2.5 `RpcRequest`/`RpcResponse` realigned to proxy semantics; `ProxyPublicClient` updated (`preheatCache` signature, `use`)

## 3. Exports & Docs
- [x] 3.1 `src/actions/index.ts`: `preheatCache`, `preheatClientCache`, `PREHEAT_CONCURRENCY`, `PreheatRequest`, `PreheatResult`, `addMiddleware`, `clearMiddlewares`, `getMiddlewares`
- [x] 3.2 `src/index.ts`: same public surface
- [x] 3.3 README 扩展方法 section updated to the real `preheatCache`/`use` API

## 4. Tests (appended to existing suites)
- [x] 4.1 Preheat: compressed GET path + per-call chain id; concurrency capped at 5; failures counted, never thrown; explicit retry override; empty list / missing endpoint / proxyless client → zero counters; extension-object exposure
- [x] 4.2 Middleware: request shape exposure; onion order (first registered outermost); `next` request modification drives the sent URL; short-circuit response; throw aborts and falls back; result-less response treated as failure; `clearMiddlewares`; `use` registration
- [x] 4.3 `client.test.ts`: preheat tests migrated to `{ submitted, failed }` contract (GET path, API key header, fetch failure, sync throw, partial failure)

## 5. Verification
- [x] 5.1 Root `npm run test` all green (328 tests, incl. workers suite); root `npm run typecheck` clean
- [x] 5.2 Workers `npx vitest run` all green (89 tests, server untouched); `npx tsc --noEmit` clean
- [x] 5.3 `openspec validate add-preheat-and-middleware --strict --no-interactive` passes
