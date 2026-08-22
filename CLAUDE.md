<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

viem-proxy is a high-performance Web3 RPC caching proxy library that uses Cloudflare Workers and CDN to optimize blockchain data reading performance. It provides zero-config compatibility with the viem library while adding intelligent caching and request optimization.

## Key Commands

### Development
```bash
# Install dependencies
pnpm install --prefer-offline --registry=https://registry.npmmirror.com

# Development mode with watch
npm run dev

# Build the library
npm run build

# Run tests
npm run test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run typecheck

# Lint code
npm run lint

# Fix linting issues  
npm run lint:fix
```

### Workers Development
```bash
cd workers
pnpm install --prefer-offline --registry=https://registry.npmmirror.com
npm run dev     # Development mode
npm run deploy  # Deploy to production
```

## Architecture Overview

### Core Design Pattern
The library implements a **Cloudflare Workers-based RPC caching proxy** with top-level function proxy:
- **Client Library** (`src/`): Proxies viem's top-level functions (getBalance, readContract, etc.) to send requests to Server
- **Workers Backend** (`workers/`): Cloudflare Workers with Durable Objects for caching and request deduplication

### Key Components

1. **ProxyPublicClient** (`src/client.ts`): Extended viem PublicClient with proxied read methods
2. **Modular Actions** (`src/actions/`): Individual proxy implementations for each viem action
   - Client actions (`*.client.ts`): Client-side proxy logic
   - Server actions (`*.server.ts`): Server-side RPC execution (for reference)
   - `proxyActions.ts`: Extend helper for `client.extend()` pattern
3. **Compression Engine** (`src/utils/compression.ts`): Multi-layer compression (function selectors → addresses → zero padding → Base64)
4. **Workers API** (`workers/src/index.ts`): Hono-based REST API with action-based endpoints
5. **Workers Actions** (`workers/src/actions/`): Server-side action handlers
6. **Durable Objects** (`workers/src/durable-objects/proxy-state.ts`): SQLite-based storage for params and request deduplication
7. **Cache Strategy** (`workers/src/utils/cache.ts`): Method-specific TTL optimization and block-aware caching

### Request Flow
```
Client → Proxy Action (*.client.ts) → Workers API → Action Handler (*.server.ts) → Durable Objects → CDN Cache → RPC Provider
```

### Usage Patterns
1. **createPublicClient with proxy config**: Simple drop-in replacement; helper methods (`batchProxy`, `getCacheStats`, `clearCache`, `preheatCache`, `use`) wired directly
2. **client.extend(proxyActions())**: Recommended for tree-shaking. All proxy actions are available; the batch method is named `batchProxy` because viem's `extend` strips extension keys colliding with core client properties (`batch` is viem's multicall config key)
3. **Standalone action import**: Best tree-shaking, import only what you need; attach the config with `withProxy(client, config)`

### Supported Methods (by Priority)

**P0 (High Priority)**:
- `getBalance` - Account balance queries
- `readContract` - Contract read operations
- `getBlock` / `getBlockNumber` - Block queries
- `getTransaction` / `getTransactionReceipt` - Transaction queries

**P1 (Medium Priority)**:
- `call` - Low-level calls
- `estimateGas` - Gas estimation
- `getGasPrice` - Gas price queries
- `getLogs` - Log queries
- `getCode` - Contract code queries

**P2 (Additional Actions)**:
- `getChainId` - Chain ID queries
- `getTransactionCount` - Transaction count (nonce) queries
- `getStorageAt` - Storage slot queries
- `getFeeHistory` - Historical gas fee queries
- `getBlobBaseFee` - Blob base fee queries

### Smart Caching
TTLs are defined in `workers/src/utils/cache.ts` (`getCacheTtlByMethod`):
- **Historical tx data** (`eth_getBlockByHash`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`): 1 year
- **Block-scoped queries** (`eth_getBlockByNumber`, `eth_getStorageAt`), by block param: finalized → 30 days; ≥ 2 epochs → 1 day; ≥ 1 epoch → 1 hour; newer → 5 minutes; `latest`/`pending` → 12s
- **Latest data** (`eth_blockNumber`, `eth_gasPrice`, `eth_estimateGas`, `eth_feeHistory`, `eth_blobBaseFee`): 12 seconds
- **Account state** (`eth_getBalance`, `eth_call`, `eth_getTransactionCount`): 30 seconds
- **Contract code** (`eth_getCode`): 5 minutes; **network info** (`eth_chainId`, `net_version`, `web3_clientVersion`): 1 hour; **logs** (`eth_getLogs`): 1 minute; default: 5 minutes

### Request Deduplication
Durable Objects provide single-threaded execution to deduplicate concurrent identical requests:
- Only one RPC call is made for concurrent identical requests
- Waiting requests receive the same result
- Timeout handling for stuck requests

## Important Implementation Notes

### Top-Level Function Proxy
Client proxies viem's top-level functions instead of Transport layer:
- Client encodes calldata and sends to Server
- Server executes RPC call and returns result
- Client decodes result with type safety
- Fallback to direct RPC on proxy failure

### Compression Algorithm
Four-stage pipeline:
1. Function selector dictionary compression (e.g., `0x70a08231` → `balanceOf`)
2. Address optimization with checksum preservation
3. Zero-padding compression (`{length}z` notation)
4. Base64 encoding with URL-safe characters (`-` `_`)

### Fallback Mechanism
Always enabled in production. Proxy failures automatically route to original RPC provider to ensure service continuity.

### Type Safety
Full TypeScript support with viem compatibility. Client types are extended from viem's base types to maintain type safety while adding proxy-specific configurations.

## Development Guidelines

### Code Style
- TypeScript strict mode enabled
- ESLint with TypeScript plugin
- Follow existing viem patterns and conventions
- Maintain compatibility with viem 2.x API
- Prefer `type` over `interface` and `enum`
- Prefer `const` over `let`
- Functional programming style, avoid classes

### Testing
- Vitest for unit tests
- Coverage requirements defined in `vitest.config.ts`
- Test files in `src/test/` and `workers/test/`

### Build Configuration
- Vite for bundling with CJS/ESM dual output
- vite-plugin-dts for TypeScript declarations
- Source maps generated
- External viem dependency (peer dependency)

## Common Issues and Solutions

1. **Build failures**: Check TypeScript types with `npm run typecheck`
2. **Proxy timeouts**: Adjust timeout in proxy config, ensure fallback enabled
3. **Cache misses**: Use debug mode to inspect parameter handling
4. **Large parameter errors**: Check compression threshold settings

## Deployment Notes

The library requires a Cloudflare Workers deployment for the proxy backend. Users must:
1. Deploy Workers with Durable Objects enabled
2. Configure the `PROXY_STATE` Durable Object binding
3. Update the endpoint in their client configuration

### Wrangler Configuration
```toml
[[durable_objects.bindings]]
name = "PROXY_STATE"
class_name = "ProxyState"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ProxyState"]
```
