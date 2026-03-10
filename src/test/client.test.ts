import { describe, it, expect, beforeEach } from "vitest";
import type { Chain } from "viem";
import { createPublicClient } from "../client";

describe("Client", () => {
  describe("createPublicClient", () => {
    it("should create proxy client with default config", () => {
      const client = createPublicClient({
        chain: {
          id: 1,
          name: "Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        },
      });

      expect(client).toBeDefined();
      expect(client.proxy).toBeDefined();
      expect(client.proxy.enabled).toBe(true);
      expect(client.proxy.fallback).toBe(true);
      expect(client.proxy.timeout).toBe(30000);
    });

    it("should create client with custom proxy config", () => {
      const client = createPublicClient({
        chain: {
          id: 1,
          name: "Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        },
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
      const client = createPublicClient({
        chain: {
          id: 1,
          name: "Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        },
      });

      expect(client.getCacheStats).toBeDefined();
      expect(client.clearCache).toBeDefined();
      expect(client.preheatCache).toBeDefined();
      expect(client.getMetrics).toBeDefined();
      expect(client.clearMetrics).toBeDefined();
    });

    it("should have proxied read methods when endpoint is set", () => {
      const client = createPublicClient({
        chain: {
          id: 1,
          name: "Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        },
        proxy: {
          endpoint: "https://proxy.example.com",
        },
      });

      // These methods should be overridden with proxy versions
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
  });

  describe("proxy client methods", () => {
    let client: ReturnType<typeof createPublicClient>;

    beforeEach(() => {
      client = createPublicClient({
        chain: {
          id: 1,
          name: "Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        },
      });
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

    it("should implement preheatCache", async () => {
      const requests = [
        {
          jsonrpc: "2.0" as const,
          id: 1,
          method: "eth_getBalance",
          params: ["0x123", "latest"],
        },
      ];

      const result = await client.preheatCache(requests);

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1);
    });
  });

  describe("proxy configuration edge cases", () => {
    it("should handle undefined proxy config", () => {
      const client = createPublicClient({
        chain: {
          id: 1,
          name: "Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        },
      });

      expect(client.proxy).toBeDefined();
      expect(client.proxy.enabled).toBe(true);
    });

    it("should merge partial proxy config with defaults", () => {
      const client = createPublicClient({
        chain: {
          id: 1,
          name: "Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
        },
        proxy: {
          endpoint: "https://custom.proxy.com",
        },
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
