# Change: Add Global Proxy Config

## Why
Proxy settings (`endpoint`, `timeout`, `apiKey`, …) had to be repeated at every entry point — `createPublicClient({ proxy })`, `withProxy(client, config)`, `proxyActions(config)`, `batchActions(requests, config)`, `preheatCache(requests, config)`, `purgeCache(requests, config)`. In apps with one deployment the endpoint is a constant: passing it N times is noise and a drift risk (one call site forgets `retryOptions` and silently behaves differently). A module-level default, set once and inherited everywhere, removes the duplication without weakening per-call overrides.

## What Changes
- New module `src/actions/config.ts` exporting `configureProxy(defaults: Partial<ProxyActionConfig>)` (merge-per-key into module-level defaults), `getProxyDefaults()` (copy of the current defaults, for introspection/tests), `resetProxyDefaults()` (clear, restores built-in-only resolution) and the internal resolvers `resolveProxyDefaults()` / `resolveProxyConfig(explicit?)`.
- Precedence per key, most specific wins: **explicit call-site config > client-mounted config (`withProxy` / `createPublicClient({ proxy })`) > module defaults (`configureProxy`) > built-in defaults (`DEFAULT_PROXY_CONFIG`)**.
- Every entry point inherits module defaults:
  - `withProxy(client, config?)` — config now optional and `Partial`; a bare `withProxy(client)` mounts the resolved defaults.
  - `getProxyConfig(client)` — an unmounted client now resolves through module defaults instead of returning `undefined` (actions' endpoint-presence check is unchanged, so no endpoint anywhere still means the native path).
  - `proxyActions(config?)` — config form accepts a partial (even `{}`), merged over module defaults; discrimination between the client and config forms switches from `"endpoint" in arg` to `"transport" in arg` (every viem client carries `transport`, config objects never do), which also makes `{ timeout: … }`-style configs unambiguous.
  - `batchActions(requests, config?)`, `preheatCache(requests, config?)`, `purgeCache(requests, config?)` — config parameters become optional `Partial<ProxyActionConfig>`, resolved via `resolveProxyConfig`.
  - `createPublicClient` — its local `DEFAULT_PROXY_CONFIG` duplicate is deleted; resolution goes through `resolveProxyConfig(proxyConfig)` with `enabled` still defaulting to `true`, so `createPublicClient({ chain, transport })` with a module-default endpoint produces a proxied client, and `proxy: { enabled: false }` still opts out.
- Preserved semantics (regression-tested):
  - `preheatCache` stays **single-attempt** (`PREHEAT_RETRY_OPTIONS`) unless `retryOptions` come from the explicit config or the module defaults — the built-in 3-attempt default never silently applies to preheat.
  - `resetStats`, metrics and middleware behavior are untouched.
  - **Zero behavior change when `configureProxy` is never called**: empty module defaults mean resolution collapses to the previous built-in-defaults-or-explicit behavior (full root suite green is the proof).
- Exports: `configureProxy` / `getProxyDefaults` / `resetProxyDefaults` re-exported from both `viem-proxy` (`src/index.ts`) and `viem-proxy/actions` (`src/actions/index.ts`). No package.json exports change needed (no new subpath).
- Tests: new top-level describe「global proxy defaults (configureProxy)」in `src/test/actions.test.ts` (22 cases: merge/copy semantics, reset, inheritance per entry point, per-key precedence, native-path preservation, preheat retry semantics, purge/batch module-default usage) with `resetProxyDefaults()` in `afterEach` so the process-level state never leaks into other suites.
- Docs: README「客户端配置」gains「全局默认配置（configureProxy）」(usage, precedence chain, SSR/multi-instance process-level warning) and the standalone-actions note now marks the config params optional; GETTING_STARTED「高级配置」gains a `configureProxy` example with the precedence summary.

## Impact
- Affected specs: `global-proxy-config` (new capability, client-side only)
- Affected code:
  - `src/actions/config.ts` — new
  - `src/proxy.ts` — optional partial config, defaults-aware `getProxyConfig`
  - `src/actions/proxyActions.ts` — optional partial config form, transport-based discrimination
  - `src/actions/batch.client.ts`, `src/actions/preheat.client.ts`, `src/actions/purge.client.ts` — optional config param + resolution
  - `src/client.ts` — drop duplicated defaults, resolve via config module
  - `src/actions/index.ts`, `src/index.ts` — exports
  - `src/test/actions.test.ts` — new describe + import of the config API
- No breaking change for existing valid call signatures (previously required params become optional/partials). Not yet published to npm; clean cutover.
