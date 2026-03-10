import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { proxyActions } from "../actions/proxyActions";
import { getBalance } from "../actions/getBalance.client";
import { getBlockNumber } from "../actions/getBlockNumber.client";

// Store original fetch
const originalFetch = global.fetch;

describe("Modular Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  describe("proxyActions extend pattern", () => {
    it("should extend client with proxy actions", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      }).extend(
        proxyActions({
          endpoint: "https://proxy.example.com",
        })
      );

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

  describe("standalone action usage", () => {
    it("should call getBalance with proxy config", async () => {
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
      expect(mockFetch).toHaveBeenCalledWith(
        "https://proxy.example.com/api/v1/1/getBalance",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("should call getBlockNumber with proxy config", async () => {
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
      expect(mockFetch).toHaveBeenCalledWith(
        "https://proxy.example.com/api/v1/1/getBlockNumber",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("should fallback to direct RPC on proxy error", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (callCount === 1) {
          // First call to proxy fails
          return Promise.reject(new Error("Proxy error"));
        }
        // Subsequent calls to direct RPC succeed
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

      // Should have called proxy first, then fallback
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
      // Should call direct RPC, not proxy
      expect(mockFetch).toHaveBeenCalledWith(
        "https://eth.llamarpc.com",
        expect.anything()
      );
    });
  });
});
