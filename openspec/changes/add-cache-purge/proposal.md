# Change: Add Cache Purge

## Why
`resetStats()` only clears client-local metrics; operators had no way to actively invalidate stale or wrong entries in the server-side caches (Durable Object dedup store + Cache API / CDN colo entries). Active invalidation is table stakes for a caching product: when an upstream reorg or a bad cached value is discovered, waiting out the TTL is not an operational answer.

## What Changes
- New endpoint `POST /api/v1/purge` (`workers/src/handlers/purge.ts`, routed in `workers/src/index.ts`), an **administrative** operation:
  - **Auth**: requires `API_KEY` like every other proxied endpoint (the existing auth middleware enforces it — 401 without a valid `X-API-Key`). When `API_KEY` is **not configured**, the handler refuses with **501** and an explicit message telling the operator to configure a key first — an unauthenticated cache-wipe button must not exist.
  - **Not rate-limit exempt**: purge consumes the caller's per-IP budget like any other `/api/v1/*` request (it is an admin op, not a read-only monitor; `/api/v1/purge` is deliberately absent from both `PUBLIC_API_PATHS` and `RATE_LIMIT_EXEMPT_PATHS`).
  - Body granularities (`{ chainId?, method?, requests?: [{ chainId?, action, args? }] }`):
    - `requests` (per-entry): each item resolves to the **exact** dedup hash (same `generateParamHash(`${chainId}:${action}:${JSON.stringify(args)}`)` as `handlers/actions.ts`) and the **exact** compressed GET URL the client used, then deletes both the DO record and the colo cache entry (`caches.default.delete(new Request(url))`). Per-item `chainId` falls back to the top-level one; cap `MAX_PURGE_REQUESTS = 50` (mirrors the batch endpoint).
    - `chainId` only (chain-level): clears the whole `chain-${chainId}` ProxyState DO store. CDN entries cannot be enumerated, so nothing is deleted from the colo cache at this granularity — disclosed in the response limitations.
    - `method`: **rejected with 400** explaining why (dedup hashes are opaque SHA-256 digests; Cache API has no listing) rather than pretending to purge.
- `ProxyState` Durable Object (`workers/src/durable-objects/proxy-state.ts`) gains `deleteRequest(hash)` (single-row delete, reports existence) and `purgeAllRequests()` (count + delete-all), exposed over the DO fetch protocol as `DELETE /requests/:hash` → `{ deleted: boolean }` and `POST /purge` → `{ deleted: number }`.
- **Honest scope reporting**: the response is `{ purged: { dedup, cache }, scope: "colo", limitations: [...] }`. `caches.default.delete` only affects the Cloudflare colo serving the purge request; other PoPs' entries expire by TTL. Global invalidation requires Cloudflare's zone-level purge API (out of scope) — the response and README both state this instead of implying global effect.
- Workers-side `compressParams` (`workers/src/utils/compression.ts`): byte-for-byte mirror of the client's `src/utils/compression.ts` so the purge endpoint can rebuild CDN cache URLs; guarded by a cross-package equality test (workers output === client output) plus a decompress round-trip test.
- Client: `purgeCache(requests: PurgeRequest[], config: ProxyActionConfig)` exported from `viem-proxy/actions` (`src/actions/purge.client.ts`). Standalone top-level function by contract — **no client-instance method** is added. `PurgeRequest = { chainId: number; action: string; args?: Record<string, unknown> }` (args must match the original request exactly, including JSON key order, because the server hashes them); returns the server report typed as `PurgeResult`. Retries transient failures (network/timeout/5xx/429) via `config.retryOptions`; non-retryable errors throw with the server message. Empty list or missing endpoint resolves zero deletions without a round trip (mirrors `preheatCache`).
- Docs: README「缓存清除」section (API shape, granularity, honest limitations, client usage) + the `resetStats` note now points at the purge endpoint (responsibilities differ, note kept); GETTING_STARTED「进阶能力 → 6. 缓存清除」; the standalone-actions equivalence note lists `purgeCache`.

## Impact
- Affected specs: `cache-purge` (new capability; server endpoint + client action)
- Affected code:
  - `workers/src/handlers/purge.ts` — new handler (`MAX_PURGE_REQUESTS`, granularity validation, 501/400/401/502 paths)
  - `workers/src/durable-objects/proxy-state.ts` — `deleteRequest` / `purgeAllRequests` + `DELETE /requests/:hash`, `POST /purge` routes
  - `workers/src/utils/compression.ts` — `compressParams` (client-mirroring, tested contract)
  - `workers/src/index.ts` — route registration with the auth/rate-limit contract documented in a comment
  - `src/actions/purge.client.ts` — new; `src/actions/index.ts` — exports
  - `workers/test/handlers.test.ts` — compression module mock now spreads `importOriginal` (real `compressParams` preserved); new describes: endpoint (501/401/200 per-request/chain-level/per-item chainId/400 matrix/502/rate-limit not exempt), URL compression contract, ProxyState DO purge paths (fake SQL shim)
  - `src/test/actions.test.ts` — new「cache purge」describe (request shape + headers, retry, non-retryable throw, zero-deletion early return)
- No breaking API changes: new endpoint + new export only. No new bindings or migrations (ProxyState already exists).
