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

  // Method 2: attach the proxy config with withProxy, then get the actions
  // object directly. (`client.extend(proxyActions({...}))` proxies the
  // regular actions, but viem's extend strips the `batch` extension key at
  // runtime and conflicts with it under strict TypeScript — so prefer this
  // form when you need `actions.batch(...)`.)
  const { withProxy } = await import("../src");

  const client = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  });

  const actions = proxyActions(
    withProxy(client, {
      endpoint: "https://your-workers-domain.workers.dev",
      fallback: true,
      debug: true,
    })
  );

  try {
    // Get latest block number
    console.log("Fetching latest block number...");
    const blockNumber = await actions.getBlockNumber();
    console.log("Latest block:", blockNumber);

    // Get account balance
    console.log("\nFetching account balance...");
    const balance = await actions.getBalance({
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

  // Method 3: Import individual actions for best tree-shaking.
  // The proxy config is attached to the client via withProxy; standalone
  // actions read it from there.
  const { getBalance, getBlockNumber } = await import("../src/actions");
  const { withProxy } = await import("../src");

  const client = withProxy(
    createPublicClient({
      chain: mainnet,
      transport: http("https://eth.llamarpc.com"),
    }),
    {
      endpoint: "https://your-workers-domain.workers.dev",
      fallback: true,
      debug: true,
    }
  );

  try {
    // Get latest block number
    console.log("Fetching latest block number...");
    const blockNumber = await getBlockNumber(client);
    console.log("Latest block:", blockNumber);

    // Get account balance
    console.log("\nFetching account balance...");
    const balance = await getBalance(client, {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
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

// Metrics example - client-side performance metrics
async function metricsExample() {
  console.log("\n=== Metrics Example ===");

  const { createPublicClient: createProxyClient } = await import("../src");

  const client = createProxyClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
    },
  });

  // Generate some traffic so the snapshot has samples
  await client.getBlockNumber();
  await client.getBalance({
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  });

  // Synchronous snapshot: request counts, cache hit rate, error rate,
  // P50/P95/P99 response times, with a per-method breakdown
  const stats = client.getCacheStats();
  console.log(`Total requests: ${stats.totalRequests}`);
  console.log(`Cache hit rate: ${(stats.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`P95 response time: ${stats.responseTimeP95}ms`);
  console.log("Per-method stats:", stats.methodStats);

  // Reset the locally collected metrics (client-side statistics only)
  client.clearCache();
  console.log("Metrics reset");
}

// Batch example - multiple actions in one round trip (POST /api/v1/batch)
async function batchExample() {
  console.log("\n=== Batch Example ===");

  const { createPublicClient: createProxyClient } = await import("../src");

  const client = createProxyClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
    },
  });

  // Per-item isolation: a failing item yields an `error` entry,
  // the rest still resolve; `chainId` overrides the target chain per item
  const results = await client.batch([
    { id: 1, action: "getBalance", args: { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" } },
    { id: 2, action: "getBlockNumber" },
    { id: 3, action: "getGasPrice", chainId: 137 },
  ]);

  for (const item of results) {
    if (item.error) {
      console.error(`#${item.id} failed:`, item.error.message);
    } else {
      console.log(`#${item.id}:`, item.result);
    }
  }
}

// Preheat example - fill the CDN cache ahead of real traffic
async function preheatExample() {
  console.log("\n=== Preheat Example ===");

  const { createPublicClient: createProxyClient } = await import("../src");

  const client = createProxyClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
    },
  });

  // Each item goes through the regular compressed GET path in a bounded
  // pool (5 concurrent). Never throws: failures are counted instead.
  const { submitted, failed } = await client.preheatCache([
    { action: "getBalance", args: { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" } },
    { action: "getBlockNumber" },
    { action: "getGasPrice" },
  ]);
  console.log(`Preheated ${submitted} requests, ${failed} failed`);
}

// Middleware example - onion-style request instrumentation
async function middlewareExample() {
  console.log("\n=== Middleware Example ===");

  const { createPublicClient: createProxyClient } = await import("../src");

  const client = createProxyClient({
    chain: mainnet,
    proxy: {
      enabled: true,
      endpoint: "https://your-workers-domain.workers.dev",
    },
  });

  // The first registered middleware runs outermost; a middleware that
  // throws aborts the request (which then follows the fallback/error path)
  client.use(async (request, next) => {
    const start = Date.now();
    const response = await next(request);
    console.log(
      `${request.functionName}(chain ${request.chainId}) took ${Date.now() - start}ms`
    );
    return response;
  });

  await client.getBlockNumber();
}

// Run examples
async function runExamples() {
  await basicExample();
  await extendPatternExample();
  await standaloneActionExample();
  await cacheExample();
  await metricsExample();
  await batchExample();
  await preheatExample();
  await middlewareExample();
}

runExamples().catch(console.error);

export {
  basicExample,
  extendPatternExample,
  standaloneActionExample,
  cacheExample,
  metricsExample,
  batchExample,
  preheatExample,
  middlewareExample,
};
