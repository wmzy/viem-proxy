import { createPublicClient } from "../src";
import { mainnet } from "../src/chains";

// Basic usage example
async function basicExample() {
  console.log("=== Basic Usage Example ===");

  // Create proxy client
  const client = createPublicClient({
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
    console.log("Block timestamp:", block?.timestamp ? new Date(Number(block.timestamp) * 1000) : "N/A");
  } catch (error) {
    console.error("Error:", error);
  }
}

// Cache strategy example
async function cacheExample() {
  console.log("\n=== Cache Strategy Example ===");

  const client = createPublicClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
      debug: true,
      cacheControl: {
        // Custom cache strategy
        eth_getBalance: 60, // 1 minute
        eth_call: 120, // 2 minutes
        eth_getBlockByNumber: 3600, // 1 hour
      },
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

// Large parameters example
async function largeParamsExample() {
  console.log("\n=== Large Parameters Example ===");

  const client = createPublicClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
      debug: true,
      compressionThreshold: 500, // Lower threshold for demo
    },
  });

  // Simulate contract call with large parameters
  const largeCalldata = "0x" + "0".repeat(1000); // Large data

  try {
    console.log("Making call with large parameters...");
    const result = await client.call({
      to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      data: largeCalldata as `0x${string}`,
    });
    console.log("Call result:", result);
  } catch (error) {
    console.log("Expected error for demo calldata:", (error as Error).message);
  }
}

// Proxy methods example
async function proxyMethodsExample() {
  console.log("\n=== Proxy Methods Example ===");

  const client = createPublicClient({
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
  await cacheExample();
  await largeParamsExample();
  await proxyMethodsExample();
}

runExamples().catch(console.error);

export { basicExample, cacheExample, largeParamsExample, proxyMethodsExample };
