# Change: Add Cache Preheat and Proxy Middleware

## Why
The README's 扩展方法 section and PRD 2.1/4.2 promise two client capabilities that do not exist yet: `preheatCache()` (warm the CDN cache for known hot requests before real traffic arrives) and `client.use()` middleware (custom request/response interception). The `ProxyMiddleware` type skeleton already sits in `src/types.ts` unused. Today the only "preheat" implementation is a legacy `createPublicClient` helper posting raw JSON-RPC bodies to the uncacheable `/api/v1/direct` endpoint — it warms nothing and returns a misleading per-request array.

## What Changes
- **Cache preheat** (`src/actions/preheat.client.ts`, new): `preheatCache(requests: PreheatRequest[], config?, defaultChainId = 1)` where `PreheatRequest = { action: BatchActionName, args? }` (reuses the batch action names). Each item is fired through the existing `makeProxyRequest` compressed GET path so the Workers/CDN edge cache fills exactly the way real traffic would — zero server-side changes (the GET path is already cacheable). Items run in a bounded pool of 5 concurrent requests; the function never throws and resolves `{ submitted, failed }` counters. Transient retries are disabled by default (`attempts: 1`): preheat is best-effort cache warming, so re-issuing a failed item adds upstream load without benefit; an explicit `config.retryOptions` is honored (client-bound preheat therefore inherits the client's retry policy).
- **Proxy middleware** (`src/actions/middleware.ts`, new): module-level registry with `addMiddleware(mw)` / `clearMiddlewares()` / `getMiddlewares()`, plus `use(mw)` on both the `proxyActions` extension object and `createPublicClient` clients. Middlewares wrap every `makeProxyRequest` onion style — the first registered middleware runs outermost. The request shape is `{ functionName, chainId, args }`, aligned with `makeProxyRequest`; a middleware may inspect or replace it, and the modified values drive URL construction, compression and the GET/POST decision. A middleware may also short-circuit with its own `{ result }` / `{ error }` response.
- **Blocking error semantics (design decision)**: a middleware that throws aborts the request — the error propagates out of `makeProxyRequest`, records a failed metrics entry, and follows the existing per-action fallback/error path exactly like a proxy failure. Chosen over "warn and skip the layer" for predictability: a middleware observes and vetoes traffic, it is not an optional observer. A middleware response carrying neither `result` nor `error` is likewise treated as a failure.
- **Type realignment (BREAKING, placeholder-only)**: `RpcRequest` is redefined from the unused JSON-RPC wire shape (`{ jsonrpc, id, method, params }`) to the proxy shape (`{ functionName, chainId, args }`), and `RpcResponse` drops the `jsonrpc`/`id` ceremony to `{ result?, error? }`. `ProxyPublicClient.preheatCache` changes from `(requests: RpcRequest[]) => Promise<RpcResponse[]>` to `(requests: PreheatRequest[]) => Promise<PreheatResult>` and gains `use: (middleware: ProxyMiddleware) => void`. `createPublicClient`'s legacy `/api/v1/direct` preheat helper is replaced by delegation to the shared implementation.
- **`makeProxyRequest` restructure** (`src/actions/utils.ts`): the actual send (URL building, compression, retry, cache-status capture) moves into a function of the request so the middleware chain can wrap it; strategy/cache-status metrics now reflect the possibly-modified request that was actually sent.
- Scope: client library only. The Workers backend needs no new endpoint — preheat deliberately rides the already-cacheable compressed GET path.

## Impact
- Affected specs: new `cache-preheat` and `proxy-middleware` capabilities
- Affected code:
  - `src/actions/preheat.client.ts` — new: `preheatCache`, `preheatClientCache`, `PreheatRequest`, `PreheatResult`, `PREHEAT_CONCURRENCY` (5)
  - `src/actions/middleware.ts` — new: `addMiddleware`, `clearMiddlewares`, `getMiddlewares`, `applyMiddlewareChain`
  - `src/actions/utils.ts` — `makeProxyRequest` send extracted and wrapped by the middleware chain
  - `src/actions/proxyActions.ts` — `preheatCache` and `use` extension methods
  - `src/types.ts` — `RpcRequest`/`RpcResponse` realigned, `ProxyPublicClient` updated
  - `src/client.ts` — preheat delegates to the shared implementation; `use` added
  - `src/actions/index.ts`, `src/index.ts` — exports
  - `src/test/actions.test.ts`, `src/test/client.test.ts` — preheat/middleware cases, migrated preheat tests
  - `README.md` — preheat/use snippets updated to the real API
- No server-side changes; no new env vars
