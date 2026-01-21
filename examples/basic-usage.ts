import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { proxyActions } from "../src/actions";

// Basic usage example - using createPublicClient with proxy config
async function basicExample() {
  console.log("=== Basic Usage Example ===");

  // Method 1: Using viem-proxy's createPublicClient with proxy config
  const { createPublicClient: createProxyClient } = await import("../src");

  const client = createProxyClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
      debug: true,
      fallback: true,
    },
  });

  try {
    // Get latest block number
    console.log("Fetching latest block number...");
    const blockNumber = await client.getBlockNumber();
    console.log("Latest block:", blockNumber);

    // Get account balance
    console.log("\nFetching account balance...");
    const balance = await client.getBalance({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik's address
    });
    console.log("Balance:", balance, "wei");

    // Read contract (USDC)
    console.log("\nReading contract...");
    const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const symbol = await client.readContract({
      address: usdcAddress,
      abi: [
        {
          name: "symbol",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "string" }],
        },
      ],
      functionName: "symbol",
    });
    console.log("Token symbol:", symbol);

    // Get block info
    console.log("\nFetching block info...");
    const block = await client.getBlock({
      blockNumber: blockNumber - 1n,
    });
    console.log("Block hash:", block?.hash);
    console.log(
      "Block timestamp:",
      block?.timestamp ? new Date(Number(block.timestamp) * 1000) : "N/A"
    );
  } catch (error) {
    console.error("Error:", error);
  }
}

// Extend pattern example (recommended for tree-shaking)
async function extendPatternExample() {
  console.log("\n=== Extend Pattern Example ===");

  // Method 2: Using viem's createPublicClient with extend pattern
  const client = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  }).extend(
    proxyActions({
      endpoint: "https://your-workers-domain.workers.dev",
      fallback: true,
      debug: true,
    })
  );

  try {
    // Get latest block number
    console.log("Fetching latest block number...");
    const blockNumber = await client.getBlockNumber();
    console.log("Latest block:", blockNumber);

    // Get account balance
    console.log("\nFetching account balance...");
    const balance = await client.getBalance({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    console.log("Balance:", balance, "wei");
  } catch (error) {
    console.error("Error:", error);
  }
}

// Standalone action example (best for tree-shaking)
async function standaloneActionExample() {
  console.log("\n=== Standalone Action Example ===");

  // Method 3: Import individual actions for best tree-shaking
  const { getBalance, getBlockNumber } = await import("../src/actions");

  const client = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  });

  const proxyConfig = {
    endpoint: "https://your-workers-domain.workers.dev",
    fallback: true,
    debug: true,
  };

  try {
    // Get latest block number
    console.log("Fetching latest block number...");
    const blockNumber = await getBlockNumber(client, { proxy: proxyConfig });
    console.log("Latest block:", blockNumber);

    // Get account balance
    console.log("\nFetching account balance...");
    const balance = await getBalance(client, {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      proxy: proxyConfig,
    });
    console.log("Balance:", balance, "wei");
  } catch (error) {
    console.error("Error:", error);
  }
}

// Cache strategy example
async function cacheExample() {
  console.log("\n=== Cache Strategy Example ===");

  const { createPublicClient: createProxyClient } = await import("../src");

  const client = createProxyClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
      debug: true,
    },
  });

  const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  console.log("First request (cache miss):");
  const start1 = Date.now();
  const balance1 = await client.getBalance({ address });
  const time1 = Date.now() - start1;
  console.log(`Balance: ${balance1}, Time: ${time1}ms`);

  console.log("\nSecond request (cache hit):");
  const start2 = Date.now();
  const balance2 = await client.getBalance({ address });
  const time2 = Date.now() - start2;
  console.log(`Balance: ${balance2}, Time: ${time2}ms`);

  console.log(
    `\nSpeed improvement: ${(((time1 - time2) / time1) * 100).toFixed(1)}%`
  );
}

// Proxy methods example
async function proxyMethodsExample() {
  console.log("\n=== Proxy Methods Example ===");

  const { createPublicClient: createProxyClient } = await import("../src");

  const client = createProxyClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
    },
  });

  // Get cache stats
  const stats = await client.getCacheStats?.();
  console.log("Cache stats:", stats);

  // Get metrics
  const metrics = await client.getMetrics?.();
  console.log("Metrics:", metrics);

  // Clear cache
  await client.clearCache?.();
  console.log("Cache cleared");

  // Clear metrics
  await client.clearMetrics?.();
  console.log("Metrics cleared");
}

// Run examples
async function runExamples() {
  await basicExample();
  await extendPatternExample();
  await standaloneActionExample();
  await cacheExample();
  await proxyMethodsExample();
}

runExamples().catch(console.error);

export {
  basicExample,
  extendPatternExample,
  standaloneActionExample,
  cacheExample,
  proxyMethodsExample,
};
