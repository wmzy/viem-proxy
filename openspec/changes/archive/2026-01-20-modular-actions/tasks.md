# Tasks: Modular Actions

## 1. Create Actions Module Structure
- [x] 1.1 Create `src/actions/` directory
- [x] 1.2 Create shared utilities (`src/actions/utils.ts`)
- [x] 1.3 Create action types (`src/actions/types.ts`)

## 2. Implement Client Actions (*.client.ts)
- [x] 2.1 Implement `getBalance.client.ts`
- [x] 2.2 Implement `getBlock.client.ts`
- [x] 2.3 Implement `getBlockNumber.client.ts`
- [x] 2.4 Implement `getTransaction.client.ts`
- [x] 2.5 Implement `getTransactionReceipt.client.ts`
- [x] 2.6 Implement `readContract.client.ts`
- [x] 2.7 Implement `call.client.ts`
- [x] 2.8 Implement `estimateGas.client.ts`
- [x] 2.9 Implement `getGasPrice.client.ts`
- [x] 2.10 Implement `getLogs.client.ts`
- [x] 2.11 Implement `getCode.client.ts`

## 3. Implement Server Actions (*.server.ts)
- [x] 3.1 Implement `getBalance.server.ts`
- [x] 3.2 Implement `getBlock.server.ts`
- [x] 3.3 Implement `getBlockNumber.server.ts`
- [x] 3.4 Implement `getTransaction.server.ts`
- [x] 3.5 Implement `getTransactionReceipt.server.ts`
- [x] 3.6 Implement `readContract.server.ts`
- [x] 3.7 Implement `call.server.ts`
- [x] 3.8 Implement `estimateGas.server.ts`
- [x] 3.9 Implement `getGasPrice.server.ts`
- [x] 3.10 Implement `getLogs.server.ts`
- [x] 3.11 Implement `getCode.server.ts`

## 4. Create Extend Helper
- [x] 4.1 Implement `proxyActions.ts` extend function
- [x] 4.2 Create `src/actions/index.ts` exports (client only)

## 5. Update Workers
- [x] 5.1 Create `workers/src/actions/` directory with server actions
- [x] 5.2 Create `workers/src/handlers/actions.ts` to handle action requests
- [x] 5.3 Update `workers/src/index.ts` to use new action handlers

## 6. Update Build Configuration
- [x] 6.1 Update `vite.config.ts` with actions entry point
- [x] 6.2 Update `package.json` exports for `/actions` subpath
- [x] 6.3 Verify build output structure

## 7. Update Client
- [x] 7.1 Update `createPublicClient` to use extend internally
- [x] 7.2 Maintain backward compatibility with `proxy` config
- [x] 7.3 Remove old `proxy-actions.ts`

## 8. Testing
- [x] 8.1 Add tests for client actions
- [x] 8.2 Add tests for proxyActions extend
- [x] 8.3 Add tests for backward compatibility
- [x] 8.4 Verify all existing tests pass

## 9. Documentation
- [x] 9.1 Update examples with new usage patterns
- [x] 9.2 Update README with actions import guide
- [x] 9.3 Update CLAUDE.md

## Dependencies
- Task 2, 3 depend on Task 1
- Task 4 depends on Task 2
- Task 5 depends on Task 3
- Task 6 can run in parallel with Task 2-5
- Task 7 depends on Task 4
- Task 8 depends on Task 5, 6, 7
- Task 9 depends on Task 8
