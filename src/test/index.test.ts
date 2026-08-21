import { describe, it, expect } from "vitest";

describe("Index exports", () => {
  it("should export compressParams function", async () => {
    const exports = await import("../index");
    expect(exports.compressParams).toBeDefined();
    expect(typeof exports.compressParams).toBe("function");
  });

  it("should export http transport function from viem", async () => {
    const exports = await import("../index");
    expect(exports.http).toBeDefined();
    expect(typeof exports.http).toBe("function");
  });

  it("should export createPublicClient function", async () => {
    const exports = await import("../index");
    expect(exports.createPublicClient).toBeDefined();
    expect(typeof exports.createPublicClient).toBe("function");
  });

  it("should export withProxy function", async () => {
    const exports = await import("../index");
    expect(exports.withProxy).toBeDefined();
    expect(typeof exports.withProxy).toBe("function");
  });

  it("should export getProxyConfig function", async () => {
    const exports = await import("../index");
    expect(exports.getProxyConfig).toBeDefined();
    expect(typeof exports.getProxyConfig).toBe("function");
  });

  it("should re-export viem exports", async () => {
    const exports = await import("../index");

    // Check some key viem exports are available
    expect(exports.createWalletClient).toBeDefined();
    expect(typeof exports.createWalletClient).toBe("function");

    expect(exports.formatUnits).toBeDefined();
    expect(typeof exports.formatUnits).toBe("function");
  });

  it("should allow creating public client with proxy", async () => {
    const exports = await import("../index");

    const client = exports.createPublicClient({
      chain: {
        id: 1,
        name: "Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
      },
      proxy: {
        enabled: true,
        endpoint: "https://proxy.example.com",
      },
    });

    expect(client).toBeDefined();
    expect(client.proxy.endpoint).toBe("https://proxy.example.com");
  });

  it("should export compression utils", async () => {
    const exports = await import("../index");

    const testParams = '["0x123", "latest"]';
    const compressed = exports.compressParams(testParams);
    expect(compressed.compressed).toBeDefined();
    expect(compressed.originalSize).toBe(testParams.length);
  });

  it("should import chains correctly", async () => {
    const viemChains = await import("viem/chains");

    expect(viemChains.mainnet).toBeDefined();
    expect(viemChains.sepolia).toBeDefined();
  });

  it("should export all actions from actions/index", async () => {
    const actions = await import("../actions/index");

    expect(actions.getBalance).toBeDefined();
    expect(actions.getBlock).toBeDefined();
    expect(actions.getBlockNumber).toBeDefined();
    expect(actions.getTransaction).toBeDefined();
    expect(actions.getTransactionReceipt).toBeDefined();
    expect(actions.readContract).toBeDefined();
    expect(actions.call).toBeDefined();
    expect(actions.estimateGas).toBeDefined();
    expect(actions.getGasPrice).toBeDefined();
    expect(actions.getLogs).toBeDefined();
    expect(actions.getCode).toBeDefined();
    expect(actions.proxyActions).toBeDefined();
  });
});
