import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { proxyActions } from "../actions/proxyActions";
import { getBalance } from "../actions/getBalance.client";
import { getBlockNumber } from "../actions/getBlockNumber.client";

const originalFetch = global.fetch;

describe("Modular Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("proxyActions extend pattern", () => {
    it("should extend client with proxy actions", () => {
      const base = createPublicClient({
        chain: mainnet,
        transport: http(),
      });
      const actions = proxyActions({
        endpoint: "https://proxy.example.com",
      });
      const extended = actions(base);

      expect(extended.getBalance).toBeDefined();
      expect(extended.getBlock).toBeDefined();
      expect(extended.getBlockNumber).toBeDefined();
      expect(extended.getTransaction).toBeDefined();
      expect(extended.getTransactionReceipt).toBeDefined();
      expect(extended.readContract).toBeDefined();
      expect(extended.call).toBeDefined();
      expect(extended.estimateGas).toBeDefined();
      expect(extended.getGasPrice).toBeDefined();
      expect(extended.getLogs).toBeDefined();
      expect(extended.getCode).toBeDefined();
    });
  });

  describe("standalone action usage", () => {
    it("should call getBalance with proxy config via GET", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: "0x1234",
            timestamp: Date.now(),
          }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const balance = await getBalance(client, {
        address: "0x1234567890123456789012345678901234567890",
        proxy: {
          endpoint: "https://proxy.example.com",
        },
      });

      expect(balance).toBe(BigInt("0x1234"));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("https://proxy.example.com/api/v1/1/getBalance");
      expect(url).toContain("?p=");
      expect(opts.method).toBe("GET");
    });

    it("should call getBlockNumber with proxy config via GET", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: "0xabcdef",
            timestamp: Date.now(),
          }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const blockNumber = await getBlockNumber(client, {
        proxy: {
          endpoint: "https://proxy.example.com",
        },
      });

      expect(blockNumber).toBe(BigInt("0xabcdef"));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("https://proxy.example.com/api/v1/1/getBlockNumber");
      expect(url).toContain("?p=");
      expect(opts.method).toBe("GET");
    });

    it("should include API key header when configured", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: "0x1234",
            timestamp: Date.now(),
          }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      await getBalance(client, {
        address: "0x1234567890123456789012345678901234567890",
        proxy: {
          endpoint: "https://proxy.example.com",
          apiKey: "test-key-123",
        },
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers?.["X-API-Key"]).toBe("test-key-123");
    });

    it("should fallback to direct RPC on proxy error", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((_url: string) => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("Proxy error"));
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () =>
            Promise.resolve({
              jsonrpc: "2.0",
              id: 1,
              result: "0x5678",
            }),
        });
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: mainnet,
        transport: http("https://eth.llamarpc.com"),
      });

      const balance = await getBalance(client, {
        address: "0x1234567890123456789012345678901234567890",
        proxy: {
          endpoint: "https://proxy.example.com",
          fallback: true,
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(balance).toBe(BigInt("0x5678"));
    });

    it("should throw error when fallback is disabled", async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error("Proxy error"));
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      await expect(
        getBalance(client, {
          address: "0x1234567890123456789012345678901234567890",
          proxy: {
            endpoint: "https://proxy.example.com",
            fallback: false,
          },
        })
      ).rejects.toThrow("Proxy error");
    });
  });

  describe("without proxy config", () => {
    it("should use direct viem call when no proxy endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: "0x9999",
          }),
      });
      global.fetch = mockFetch;

      const client = createPublicClient({
        chain: mainnet,
        transport: http("https://eth.llamarpc.com"),
      });

      const balance = await getBalance(client, {
        address: "0x1234567890123456789012345678901234567890",
      });

      expect(balance).toBe(BigInt("0x9999"));
      expect(mockFetch).toHaveBeenCalledWith(
        "https://eth.llamarpc.com",
        expect.anything()
      );
    });
  });
});
