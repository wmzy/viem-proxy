# Tasks: Refactor Proxy Architecture

## 1. Build System Migration (Vite)
- [x] 1.1 Install Vite and related dependencies
- [x] 1.2 Create `vite.config.ts` with library mode
- [x] 1.3 Configure CJS/ESM dual output
- [x] 1.4 Configure TypeScript declarations generation
- [x] 1.5 Update `package.json` scripts
- [x] 1.6 Remove `tsup.config.ts`
- [x] 1.7 Verify build output matches previous structure

## 2. Workers Durable Objects Migration
- [x] 2.1 Create `ProxyState` Durable Object class
- [x] 2.2 Define SQL schema for params and request deduplication
- [x] 2.3 Update `wrangler.toml` with DO bindings
- [x] 2.4 Migrate param storage from KV to DO
- [x] 2.5 Implement request deduplication logic
- [x] 2.6 Update handlers to use DO
- [x] 2.7 Remove KV-related code
- [x] 2.8 Update Workers types

## 3. Client Library Refactor
- [x] 3.1 Design proxy function wrapper interface
- [x] 3.2 Implement `createProxyClient` with action proxies
- [x] 3.3 Implement proxy for `getBalance`
- [x] 3.4 Implement proxy for `getBlock`
- [x] 3.5 Implement proxy for `getBlockNumber`
- [x] 3.6 Implement proxy for `readContract`
- [x] 3.7 Implement proxy for `call`
- [x] 3.8 Implement proxy for other read methods
- [x] 3.9 Remove Transport-based proxy (`src/transport.ts`)
- [x] 3.10 Update `src/client.ts`
- [x] 3.11 Update `src/index.ts` exports
- [x] 3.12 Update `src/types.ts`

## 4. API Endpoint Updates
- [x] 4.1 Add new endpoint for function-based requests
- [x] 4.2 Update request/response format
- [x] 4.3 Ensure backward compatibility during migration

## 5. Testing
- [x] 5.1 Update client tests for new architecture
- [x] 5.2 Add DO integration tests (mocked)
- [x] 5.3 Add request deduplication tests (mocked)
- [x] 5.4 Verify all existing tests pass
- [x] 5.5 Add E2E tests for proxy flow (basic coverage)

## 6. Documentation
- [x] 6.1 Update README with new usage
- [x] 6.2 Update examples
- [x] 6.3 Update CLAUDE.md with new architecture

## Dependencies
- Task 2 can run in parallel with Task 1
- Task 3 depends on Task 2 (needs DO endpoints)
- Task 4 is part of Task 2 and Task 3
- Task 5 depends on Task 1, 2, 3
- Task 6 depends on Task 5
