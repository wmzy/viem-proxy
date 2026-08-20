import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Chain } from "viem";
import { createPublicClient } from "../client";
import { resetMetrics } from "../utils/metrics";

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
        proxy: { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } },
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
      resetMetrics();
      client = createPublicClient({ chain: CHAIN });
    });

    it("should implement getCacheStats", () => {
      const stats = client.getCacheStats();

      expect(stats).toEqual({
        totalRequests: 0,
        errorCount: 0,
        errorRate: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitRate: 0,
        averageResponseTime: 0,
        responseTimeP50: 0,
        responseTimeP95: 0,
        responseTimeP99: 0,
        chainIds: [],
        strategyCounts: { compressed: 0, "hash-reference": 0, direct: 0 },
        methodStats: {},
      });
    });

    it("should implement clearCache", () => {
      expect(() => client.clearCache()).not.toThrow();
    });

    it("should reflect proxy request metrics in getCacheStats", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        headers: new Headers({ "X-Cache": "HIT" }),
        json: () => Promise.resolve({ result: "0x1" }),
      });
      const proxied = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } },
      });

      await proxied.getBalance({ address: "0x1234567890123456789012345678901234567890" });

      const stats = proxied.getCacheStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheHitRate).toBe(1);
      expect(stats.methodStats.getBalance.count).toBe(1);
      expect(stats.chainIds).toEqual([1]);
    });

    it("should reset local metrics via clearCache", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        headers: new Headers({ "X-Cache": "MISS" }),
        json: () => Promise.resolve({ result: "0x1" }),
      });
      const proxied = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } },
      });

      await proxied.getBalance({ address: "0x1234567890123456789012345678901234567890" });
      expect(proxied.getCacheStats().totalRequests).toBe(1);

      proxied.clearCache();

      const stats = proxied.getCacheStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.methodStats).toEqual({});
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

    it("should implement preheatCache returning zero counters when no endpoint", async () => {
      const requests = [{ action: "getBalance" as const, args: { address: "0x123" } }];

      const result = await client.preheatCache(requests);

      expect(result).toEqual({ submitted: 0, failed: 0 });
    });
  });

  describe("debug mode logging", () => {
    it("should log on clearCache when debug is enabled", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { debug: true },
      });

      client.clearCache();
      expect(spy).toHaveBeenCalledWith("[viem-proxy] Cache cleared");
      spy.mockRestore();
    });

    it("should not log on clearCache when debug is disabled", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = createPublicClient({
        chain: CHAIN,
        proxy: { debug: false },
      });

      client.clearCache();
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
    it("should send each item through the cacheable compressed GET path", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } },
      });

      const requests = [
        { action: "getBalance" as const, args: { address: "0x123" } },
        { action: "getBlockNumber" as const },
      ];

      const result = await client.preheatCache(requests);

      expect(result).toEqual({ submitted: 2, failed: 0 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [firstUrl, firstInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(firstUrl).toContain("https://proxy.example.com/api/v1/1/getBalance?p=");
      expect(firstInit.method).toBe("GET");
      expect(String(mockFetch.mock.calls[1][0])).toContain("/api/v1/1/getBlockNumber?p=");
    });

    it("should include API key in preheatCache requests", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", apiKey: "my-key" },
      });

      await client.preheatCache([{ action: "getBalance" as const, args: { address: "0x123" } }]);

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("my-key");
    });

    it("should handle preheatCache fetch failures gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } },
      });

      const requests = [{ action: "getBalance" as const, args: { address: "0x123" } }];

      const result = await client.preheatCache(requests);
      expect(result).toEqual({ submitted: 1, failed: 1 });
    });

    it("should handle preheatCache when fetch throws synchronously", async () => {
      global.fetch = (() => { throw new Error("sync error"); }) as unknown as typeof fetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } },
      });

      const requests = [{ action: "getBalance" as const, args: { address: "0x123" } }];

      const result = await client.preheatCache(requests);
      expect(result).toEqual({ submitted: 1, failed: 1 });
    });

    it("should handle individual preheatCache request rejection", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) })
        .mockRejectedValueOnce(new Error("fail"));
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: CHAIN,
        proxy: { endpoint: "https://proxy.example.com", retryOptions: { attempts: 1, delay: 0 } },
      });

      const requests = [
        { action: "getBalance" as const, args: { address: "0x123" } },
        { action: "getBlockNumber" as const },
      ];

      const result = await client.preheatCache(requests);
      expect(result).toEqual({ submitted: 2, failed: 1 });
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
