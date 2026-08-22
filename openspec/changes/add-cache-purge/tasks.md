# Tasks

## 1. Implementation

- [x] 1.1 `ProxyState` DO: `deleteRequest(hash)` (existence check + delete) and `purgeAllRequests()` (count + delete-all), exposed as `DELETE /requests/:hash` → `{ deleted: boolean }` and `POST /purge` → `{ deleted: number }`
- [x] 1.2 Workers-side `compressParams` in `workers/src/utils/compression.ts` mirroring the client algorithm byte-for-byte (inverse selector map, zero-padding, b64url-vs-urlencoded shortest-wins)
- [x] 1.3 `workers/src/handlers/purge.ts`: 501 without `API_KEY`, 400 validation (method-level unsupported, nothing to purge, invalid chainId, unknown action, > 50 items, bad JSON), per-request purge (DO hash + reconstructed URL + `caches.default.delete`), chain-level purge, 502 on DO failure, `{ purged, scope: "colo", limitations }` response
- [x] 1.4 Route `app.post("/api/v1/purge", handlePurgeRequest)` in `workers/src/index.ts` with the auth/rate-limit (non-)exemption contract documented
- [x] 1.5 Client `src/actions/purge.client.ts`: `purgeCache(requests, config)` with retry policy, API-key/trace headers, typed `PurgeResult`, zero-deletion early return; exported from `viem-proxy/actions` (no client method)
- [x] 1.6 Workers tests (`workers/test/handlers.test.ts`): compression mock preserves real `compressParams`; endpoint describe (501 / 401 / per-request incl. exact hash + URL / per-item chainId / chain-level / 400 matrix / 502 / rate-limit not exempt); URL compression contract (cross-package equality + round-trip); ProxyState DO purge paths via fake SQL shim
- [x] 1.7 Client tests (`src/test/actions.test.ts`「cache purge」describe): request shape + headers, transient retry, non-retryable throw, zero-deletion early return
- [x] 1.8 Docs: README「缓存清除」section + `resetStats` note pointing at purge + standalone-actions note; GETTING_STARTED「6. 缓存清除」

## 2. Verification

- [x] 2.1 `cd workers && pnpm typecheck` clean
- [x] 2.2 `cd workers && pnpm vitest run test/handlers.test.ts` green (131 tests, incl. peers' suites)
- [x] 2.3 Root `pnpm typecheck` clean; `pnpm vitest run src/test/actions.test.ts` green (140 tests)
