# Tasks

## 1. Implementation

- [x] 1.1 `src/actions/config.ts`: `configureProxy` (merge-per-key module defaults), `getProxyDefaults` (copy), `resetProxyDefaults`, internal `resolveProxyDefaults` / `resolveProxyConfig(explicit?)` with fresh-object semantics
- [x] 1.2 `src/proxy.ts`: `withProxy(client, config?)` optional partial config; `getProxyConfig` resolves module defaults for unmounted clients (endpoint-presence check unchanged)
- [x] 1.3 `src/actions/proxyActions.ts`: config form accepts `Partial` / `{}` merged over module defaults; client-vs-config discrimination via `transport` key
- [x] 1.4 `src/actions/batch.client.ts` / `preheat.client.ts` / `purge.client.ts`: config param optional, resolved via `resolveProxyConfig`; preheat keeps single-attempt default unless retryOptions configured explicitly or via module defaults
- [x] 1.5 `src/client.ts`: delete duplicated local `DEFAULT_PROXY_CONFIG`; resolve through `resolveProxyConfig` with `enabled` defaulting to `true`; explicit `enabled: false` still opts out
- [x] 1.6 Exports from `src/actions/index.ts` (`viem-proxy/actions`) and `src/index.ts` (`viem-proxy`): `configureProxy`, `getProxyDefaults`, `resetProxyDefaults`

## 2. Tests

- [x] 2.1 New「global proxy defaults (configureProxy)」describe in `src/test/actions.test.ts`: merge across calls, snapshot-copy semantics, built-in fill for unconfigured keys, fresh resolution copies, reset behavior
- [x] 2.2 Inheritance per entry point: `withProxy` bare / explicit, `proxyActions` client + config forms, `createPublicClient` with and without `proxy` key, `batchActions`, `preheatCache`, `purgeCache`
- [x] 2.3 Precedence cases: explicit > client-mounted > module > built-in (per key); native path preserved when no endpoint is configured anywhere; `enabled: false` opt-out stays native
- [x] 2.4 Preheat retry semantics preserved: single-attempt by default, module `retryOptions` honored
- [x] 2.5 `afterEach` reset of module defaults so process-level state never leaks into other suites; full root suite green proves zero behavior change when `configureProxy` is never called

## 3. Docs

- [x] 3.1 README「客户端配置 → 全局默认配置（configureProxy）」: usage example, precedence chain, `getProxyDefaults` / `resetProxyDefaults`, SSR / multi-instance process-level warning
- [x] 3.2 README standalone-actions note + GETTING_STARTED「高级配置」example and standalone note: config params optional, module defaults inheritance
- [x] 3.3 openspec change `add-global-proxy-config` (proposal, tasks, spec delta)

## 4. Verification

- [x] 4.1 Root `pnpm typecheck` clean
- [x] 4.2 Root `pnpm vitest run` green (full suite)
