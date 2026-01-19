/**
 * Migration Guide: From viem to viem-proxy
 *
 * This file demonstrates how to migrate existing viem code to viem-proxy
 */

// ===== Before Migration (using viem) =====
/*
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com')
})
*/

// ===== After Migration (using viem-proxy) =====
import { createPublicClient, http } from "../src"; // Replace import
import { mainnet } from "../src/chains"; // Replace import

// 1. Basic Migration - Just add proxy config
const client = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"), // Keep original RPC as fallback
  proxy: {
    enabled: true,
    endpoint: "https://your-workers-domain.workers.dev",
  },
});

// 2. Advanced Configuration Migration
const advancedClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"),
  proxy: {
    enabled: true,
    endpoint: "https://your-workers-domain.workers.dev",
    debug: process.env.NODE_ENV === "development",
    fallback: true, // Enable fallback to original RPC
    timeout: 30000,
    cacheControl: {
      // Custom cache strategy
      eth_getBalance: 30,
      eth_call: 60,
      eth_getBlockByNumber: 300,
    },
    retryOptions: {
      attempts: 3,
      delay: 1000,
    },
  },
});

// ===== API Usage is Completely the Same =====
async function demonstrateCompatibility() {
  // All viem APIs can be used directly without modification

  // Read operations - will be proxied and cached
  const blockNumber = await client.getBlockNumber();
  const balance = await client.getBalance({
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  });

  const contractResult = await client.readContract({
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"],
  });

  // Write operations - pass through directly, not proxied
  // const hash = await walletClient.sendTransaction({
  //   to: '0x...',
  //   value: parseEther('0.01')
  // })

  console.log({
    blockNumber,
    balance,
    contractResult,
  });
}

// ===== Gradual Migration Strategies =====

// Strategy 1: Conditional Proxy Enable
const conditionalClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"), // Keep original RPC as fallback
  proxy: {
    enabled: process.env.ENABLE_PROXY === "true", // Control via environment variable
    endpoint: process.env.PROXY_ENDPOINT || "",
    fallback: true, // Ensure fallback is available
  },
});

// Strategy 2: A/B Testing
const abTestClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"),
  proxy: {
    enabled: Math.random() < 0.5, // 50% traffic uses proxy
    endpoint: "https://your-workers-domain.workers.dev",
    fallback: true,
    debug: true, // Log performance data
  },
});

// Strategy 3: Selective Method Proxy
const selectiveClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"),
  proxy: {
    enabled: true,
    endpoint: "https://your-workers-domain.workers.dev",
    fallback: true,
    cacheControl: {
      // Only enable caching for specific methods
      eth_getBalance: 30,
      eth_call: 60,
      // Other methods use 0 to disable caching (pass through)
      eth_sendTransaction: 0,
    },
  },
});

// ===== Performance Monitoring =====
async function performanceComparison() {
  console.log("=== Performance Comparison ===");

  // Original viem client (no proxy)
  const originalClient = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
    proxy: {
      enabled: false, // Disable proxy
    },
  });

  // Proxy client
  const proxyClient = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
      debug: true,
    },
  });

  const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  // Test original client
  console.log("Testing original client...");
  const start1 = Date.now();
  await originalClient.getBalance({ address });
  const time1 = Date.now() - start1;
  console.log(`Original client: ${time1}ms`);

  // Test proxy client (first time - cache miss)
  console.log("Testing proxy client (cache miss)...");
  const start2 = Date.now();
  await proxyClient.getBalance({ address });
  const time2 = Date.now() - start2;
  console.log(`Proxy client (miss): ${time2}ms`);

  // Test proxy client (second time - cache hit)
  console.log("Testing proxy client (cache hit)...");
  const start3 = Date.now();
  await proxyClient.getBalance({ address });
  const time3 = Date.now() - start3;
  console.log(`Proxy client (hit): ${time3}ms`);

  console.log(
    `Cache hit improvement: ${(((time1 - time3) / time1) * 100).toFixed(1)}%`
  );
}

// ===== Using Proxy Helper Methods =====
async function useProxyMethods() {
  console.log("=== Proxy Helper Methods ===");

  const proxyClient = createPublicClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
    },
  });

  // Get cache statistics
  const stats = await proxyClient.getCacheStats?.();
  console.log("Cache stats:", stats);

  // Get performance metrics
  const metrics = await proxyClient.getMetrics?.();
  console.log("Metrics:", metrics);

  // Clear cache if needed
  await proxyClient.clearCache?.();
  console.log("Cache cleared");

  // Preheat cache with common requests
  const requests = [
    { jsonrpc: "2.0" as const, id: 1, method: "eth_blockNumber", params: [] },
    { jsonrpc: "2.0" as const, id: 2, method: "eth_gasPrice", params: [] },
  ];
  await proxyClient.preheatCache?.(requests);
  console.log("Cache preheated");
}

export {
  client,
  advancedClient,
  conditionalClient,
  abTestClient,
  selectiveClient,
  demonstrateCompatibility,
  performanceComparison,
  useProxyMethods,
};
