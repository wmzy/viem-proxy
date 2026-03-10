import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Chain } from "viem";
import { createPublicClient } from "../client";

const CHAIN = {
  id: 1,
  name: "Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
};

const originalFetch = global.fetch;

describe("Client", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("createPublicClient", () => {
    it("should create proxy client with default config", () => {
      const client = createPublicClient({ chain: CHAIN });

      expect(client).toBeDefined();
      expect(client.proxy).toBeDefined();
      expect(client.proxy.enabled).toBe(true);
      expect(client.proxy.fallback).toBe(true);
      expect(client.proxy.timeout).toBe(30000);
    });

    it("should create client with custom proxy config", () => {
      const client = createPublicClient({
        chain: CHAIN,
        proxy: {
          enabled: true,
          endpoint: "https://proxy.example.com",
          debug: true,
          fallback: false,
          timeout: 60000,
        },
      });

      expect(client.proxy.enabled).toBe(true);
      expect(client.proxy.endpoint).toBe("https://proxy.example.com");
      expect(client.proxy.debug).toBe(true);
      expect(client.proxy.fallback).toBe(false);
      expect(client.proxy.timeout).toBe(60000);
    });

    it("should preserve chain configuration", () => {
      const chain = {
        id: 56,
        name: "Binance Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: { default: { http: ["https://bsc-dataseed.binance.org"] } },
      } as Chain;

      const client = createPublicClient({ chain });
      expect(client.chain).toEqual(chain);
    });

    it("should extend client with proxy methods", () => {
      const client = createPublicClient({ chain: CHAIN });

      expect(client.getCacheStats).toBeDefined();
      expect(client.clearCache).toBeDefined();
      expect(client.preheatCache).toBeDefined();
      expect(client.getMetrics).toBeDefined();
      expect(client.clearMetrics).toBeDefined();
    });

    it("should have proxied read methods when endpoint is set", () => {
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com" },
      });

      expect(client.getBalance).toBeDefined();
      expect(client.getBlock).toBeDefined();
      expect(client.getBlockNumber).toBeDefined();
      expect(client.getTransaction).toBeDefined();
      expect(client.getTransactionReceipt).toBeDefined();
      expect(client.readContract).toBeDefined();
      expect(client.call).toBeDefined();
      expect(client.estimateGas).toBeDefined();
      expect(client.getGasPrice).toBeDefined();
      expect(client.getLogs).toBeDefined();
      expect(client.getCode).toBeDefined();
    });

    it("should not extend with proxyActions when proxy is disabled", () => {
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { enabled: false, endpoint: "https://proxy.example.com" },
      });

      expect(client.proxy.enabled).toBe(false);
      expect(client.getCacheStats).toBeDefined();
    });

    it("should not extend with proxyActions when endpoint is empty", () => {
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { enabled: true, endpoint: "" },
      });

      expect(client.proxy.endpoint).toBe("");
      expect(client.getCacheStats).toBeDefined();
    });
  });

  describe("proxy client methods", () => {
    let client: ReturnType<typeof createPublicClient>;

    beforeEach(() => {
      client = createPublicClient({ chain: CHAIN });
    });

    it("should implement getCacheStats", async () => {
      const stats = await client.getCacheStats();

      expect(stats).toEqual({
        hitRate: 0,
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
      });
    });

    it("should implement clearCache", async () => {
      await expect(client.clearCache()).resolves.toBeUndefined();
    });

    it("should implement getMetrics", async () => {
      const metrics = await client.getMetrics();

      expect(metrics.totalRequests).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
    });

    it("should implement clearMetrics", async () => {
      const result = await client.clearMetrics();
      expect(result).toBe(true);
    });

    it("should implement preheatCache returning empty results when no endpoint", async () => {
      const requests = [
        { jsonrpc: "2.0" as const, id: 1, method: "eth_getBalance", params: ["0x123", "latest"] },
      ];

      const result = await client.preheatCache(requests);

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1);
      expect(result[0].result).toBeNull();
    });
  });

  describe("debug mode logging", () => {
    it("should log on clearCache when debug is enabled", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { debug: true },
      });

      await client.clearCache();
      expect(spy).toHaveBeenCalledWith("[viem-proxy] Cache cleared");
      spy.mockRestore();
    });

    it("should not log on clearCache when debug is disabled", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { debug: false },
      });

      await client.clearCache();
      expect(spy).not.toHaveBeenCalledWith("[viem-proxy] Cache cleared");
      spy.mockRestore();
    });

    it("should log on clearMetrics when debug is enabled", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { debug: true },
      });

      await client.clearMetrics();
      expect(spy).toHaveBeenCalledWith("[viem-proxy] Metrics cleared");
      spy.mockRestore();
    });
  });

  describe("preheatCache with endpoint", () => {
    it("should send POST requests to proxy endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com" },
      });

      const requests = [
        { jsonrpc: "2.0" as const, id: 1, method: "eth_getBalance", params: ["0x123", "latest"] },
        { jsonrpc: "2.0" as const, id: 2, method: "eth_blockNumber", params: [] },
      ];

      const results = await client.preheatCache(requests);

      expect(results).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain("https://proxy.example.com/api/v1/direct/1/eth_getBalance");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });

    it("should include API key in preheatCache requests", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", apiKey: "my-key" },
      });

      await client.preheatCache([
        { jsonrpc: "2.0" as const, id: 1, method: "eth_getBalance", params: [] },
      ]);

      expect(mockFetch.mock.calls[0][1].headers["X-API-Key"]).toBe("my-key");
    });

    it("should handle preheatCache fetch failures gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com" },
      });

      const requests = [
        { jsonrpc: "2.0" as const, id: 1, method: "eth_getBalance", params: [] },
      ];

      const results = await client.preheatCache(requests);
      expect(results).toHaveLength(1);
      expect(results[0].result).toBeNull();
    });

    it("should handle preheatCache when fetch throws synchronously", async () => {
      global.fetch = (() => { throw new Error("sync error"); }) as unknown as typeof fetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com" },
      });

      const requests = [
        { jsonrpc: "2.0" as const, id: 1, method: "eth_getBalance", params: [] },
      ];

      const results = await client.preheatCache(requests);
      expect(results).toHaveLength(1);
      expect(results[0].result).toBeNull();
    });

    it("should handle individual preheatCache request rejection", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }) })
        .mockRejectedValueOnce(new Error("fail"));
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com" },
      });

      const requests = [
        { jsonrpc: "2.0" as const, id: 1, method: "eth_getBalance", params: [] },
        { jsonrpc: "2.0" as const, id: 2, method: "eth_blockNumber", params: [] },
      ];

      const results = await client.preheatCache(requests);
      expect(results).toHaveLength(2);
      expect(results[0].result).toBe("0x1");
      expect(results[1].result).toBeNull();
    });
  });

  describe("proxy configuration edge cases", () => {
    it("should handle undefined proxy config", () => {
      const client = createPublicClient({ chain: CHAIN });

      expect(client.proxy).toBeDefined();
      expect(client.proxy.enabled).toBe(true);
    });

    it("should merge partial proxy config with defaults", () => {
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://custom.proxy.com" },
      });

      expect(client.proxy.endpoint).toBe("https://custom.proxy.com");
      expect(client.proxy.timeout).toBe(30000);
      expect(client.proxy.fallback).toBe(true);
    });

    it("should handle different chain types", () => {
      const testChains = [
        { id: 1, name: "Ethereum" },
        { id: 56, name: "BSC" },
        { id: 137, name: "Polygon" },
        { id: 42161, name: "Arbitrum" },
      ];

      testChains.forEach((chain) => {
        const fullChain = {
          ...chain,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        };
        const client = createPublicClient({ chain: fullChain });

        expect(client).toBeDefined();
        expect(client.chain).toEqual(fullChain);
      });
    });
  });
});
