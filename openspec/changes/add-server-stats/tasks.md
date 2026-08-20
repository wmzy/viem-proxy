## 1. Implementation

- [x] 1.1 Add `Statistics` Durable Object with hourly SQLite buckets (`method, chain_id, cache_status, period_bucket, count, error_count, total_ms, samples`) and a 30-day retention alarm
- [x] 1.2 Add `STATISTICS` Env binding and wrangler migration `v2` (`new_sqlite_classes`)
- [x] 1.3 Add pure aggregation helpers (`percentile`, `appendSample`, `mergeRecord`, `aggregatePeriods`) and the fire-and-forget `recordRequestStats`
- [x] 1.4 Extend `setCacheHeaders` with `X-Cache`/`X-Trace-Id` options; add the `/api/v1/*` middleware fallback
- [x] 1.5 Instrument `handlers/proxy.ts` (compressed, hash-reference ×2, direct, function) and `handlers/actions.ts` with stats recording on all terminal paths
- [x] 1.6 Implement `GET /api/v1/stats` with `chainId`/`method`/`hours` filters, keeping the previous response shape
- [x] 1.7 Tests: DO read/write (bucket merge, HIT/MISS split, filters, sample cap, alarm purge), endpoint filters + compat shape + error cases, `X-Cache`/`X-Trace-Id` headers, statistics-write failure isolation
- [x] 1.8 Validate with `openspec validate add-server-stats --strict --no-interactive`

## 2. Verification

- [x] 2.1 `cd workers && npm run test` green (64 tests)
- [x] 2.2 `cd workers && npm run typecheck` (tsc --noEmit) clean
- [x] 2.3 Root package `npm run test` still green (client untouched)
