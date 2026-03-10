import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCacheStrategy, setCacheHeaders, createCacheKey, shouldCacheResponse } from "../src/utils/cache";

// Mock compression utils
vi.mock("../src/utils/compression", () => ({
  decompressParams: vi.fn((params) => params),
  generateParamHash: vi.fn(async (params) => `hash-${JSON.stringify(params).length}`)
}));

// Create fetch mock for all tests
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

afterEach(() => {
  mockFetch.mockRestore();
});

// Mock Durable Object stub
class MockDurableObjectStub {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Mock params storage
    if (request.method === "GET" && path.startsWith("/params/")) {
      const hash = path.slice("/params/".length);
      if (hash === "existing-hash") {
        return new Response(JSON.stringify({ data: '["0x123", "latest"]' }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && path === "/params") {
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Mock request deduplication
    if (request.method === "POST" && path === "/requests") {
      return new Response(JSON.stringify({ exists: false, created: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "PUT" && path.includes("/complete")) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "PUT" && path.includes("/fail")) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Mock Durable Object namespace
class MockDurableObjectNamespace {
  idFromName(_name: string) {
    return { toString: () => "mock-id" };
  }
  get(_id: any) {
    return new MockDurableObjectStub();
  }
}

const mockEnv = {
  PROXY_STATE: new MockDurableObjectNamespace(),
  ENVIRONMENT: "test",
  MAX_CACHE_TTL: "3600",
  DEFAULT_CACHE_TTL: "300",
  COMPRESSION_THRESHOLD: "1500"
};

describe("Cache Utilities", () => {
  describe("getCacheStrategy", () => {
    it("should return long TTL for historical block data", () => {
      const strategy = getCacheStrategy(1, "eth_getBlockByHash", ["0x123", true]);
      expect(strategy.ttl).toBe(31536000); // 1 year
      expect(strategy.shouldCache).toBe(true);
    });

    it("should return short TTL for latest block data", () => {
      const strategy = getCacheStrategy(1, "eth_blockNumber", []);
      expect(strategy.ttl).toBe(12); // 12 seconds
      expect(strategy.shouldCache).toBe(true);
    });

    it("should return medium TTL for balance queries", () => {
      const strategy = getCacheStrategy(1, "eth_getBalance", ["0x123", "latest"]);
      expect(strategy.ttl).toBe(30); // 30 seconds
      expect(strategy.shouldCache).toBe(true);
    });

    it("should return long TTL for transaction data", () => {
      const strategy = getCacheStrategy(1, "eth_getTransactionByHash", ["0x123"]);
      expect(strategy.ttl).toBe(31536000); // 1 year
      expect(strategy.shouldCache).toBe(true);
    });

    it("should return medium TTL for code queries", () => {
      const strategy = getCacheStrategy(1, "eth_getCode", ["0x123", "latest"]);
      expect(strategy.ttl).toBe(300); // 5 minutes
      expect(strategy.shouldCache).toBe(true);
    });

    it("should handle eth_getBlockByNumber with different block types", () => {
      // Latest block
      const latestStrategy = getCacheStrategy(1, "eth_getBlockByNumber", ["latest", true]);
      expect(latestStrategy.ttl).toBe(12);

      // Pending block
      const pendingStrategy = getCacheStrategy(1, "eth_getBlockByNumber", ["pending", true]);
      expect(pendingStrategy.ttl).toBe(12);

      // Specific block number (recent) - within 1 epoch (32 blocks for Ethereum)
      const recentStrategy = getCacheStrategy(1, "eth_getBlockByNumber", ["0x1F0", true], 300, 0x200);
      expect(recentStrategy.ttl).toBe(300); // 5 minutes for recent blocks

      // Finalized block - more than 2 epochs old
      const finalizedStrategy = getCacheStrategy(1, "eth_getBlockByNumber", ["0x1", true], 300, 0x100);
      expect(finalizedStrategy.ttl).toBe(2592000); // 30 days for finalized
    });
  });

  describe("setCacheHeaders", () => {
    it("should set cache headers for positive TTL", () => {
      const response = new Response("test");
      const cachedResponse = setCacheHeaders(response, 3600);
      
      expect(cachedResponse.headers.get("Cache-Control")).toBe("public, max-age=3600, s-maxage=3600");
      expect(cachedResponse.headers.get("CDN-Cache-Control")).toBe("max-age=3600");
    });

    it("should set no-cache headers for zero TTL", () => {
      const response = new Response("test");
      const cachedResponse = setCacheHeaders(response, 0);
      
      expect(cachedResponse.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
    });
  });

  describe("createCacheKey", () => {
    it("should create consistent cache keys", () => {
      const requestInfo = {
        chainId: 1,
        method: "eth_getBalance",
        params: ["0x123", "latest"],
        strategy: "compressed" as const
      };
      
      const key = createCacheKey(requestInfo);
      expect(key).toBe('1:eth_getBalance:["0x123","latest"]');
    });
  });

  describe("shouldCacheResponse", () => {
    it("should return true for valid results", () => {
      expect(shouldCacheResponse("eth_getBalance", "0x123")).toBe(true);
    });

    it("should return false for error results", () => {
      expect(shouldCacheResponse("eth_getBalance", { error: "something" })).toBe(false);
    });

    it("should return false for null results", () => {
      expect(shouldCacheResponse("eth_getBalance", null)).toBe(false);
    });

    it("should return false for pending status", () => {
      expect(shouldCacheResponse("eth_getTransactionReceipt", { status: "pending" })).toBe(false);
    });
  });
});

describe("Compression Utilities", () => {
  it("should mock decompressParams correctly", async () => {
    const { decompressParams } = await import("../src/utils/compression");
    const result = decompressParams("test");
    expect(result).toBe("test");
  });

  it("should mock generateParamHash correctly", async () => {
    const { generateParamHash } = await import("../src/utils/compression");
    const result = await generateParamHash("test");
    expect(result).toContain("hash-");
  });
});

describe("Mock Environment", () => {
  it("should have PROXY_STATE configured", () => {
    expect(mockEnv.PROXY_STATE).toBeDefined();
    expect(mockEnv.PROXY_STATE.idFromName).toBeDefined();
    expect(mockEnv.PROXY_STATE.get).toBeDefined();
  });

  it("should create DO stub correctly", () => {
    const id = mockEnv.PROXY_STATE.idFromName("test");
    const stub = mockEnv.PROXY_STATE.get(id);
    expect(stub).toBeDefined();
    expect(stub.fetch).toBeDefined();
  });

  it("should handle DO fetch for params", async () => {
    const stub = mockEnv.PROXY_STATE.get(mockEnv.PROXY_STATE.idFromName("test"));
    
    // Test existing params
    const existingResponse = await stub.fetch(new Request("http://do/params/existing-hash"));
    expect(existingResponse.ok).toBe(true);
    const existingData = await existingResponse.json();
    expect(existingData.data).toBeDefined();

    // Test non-existing params
    const missingResponse = await stub.fetch(new Request("http://do/params/missing-hash"));
    expect(missingResponse.ok).toBe(false);
  });

  it("should handle DO fetch for request deduplication", async () => {
    const stub = mockEnv.PROXY_STATE.get(mockEnv.PROXY_STATE.idFromName("test"));
    
    const response = await stub.fetch(new Request("http://do/requests", {
      method: "POST",
      body: JSON.stringify({ requestHash: "test-hash" }),
    }));
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.created).toBe(true);
  });
});

describe("Action Handlers", () => {
  it("should execute getBalance handler", async () => {
    const { getBalanceHandler } = await import("../src/actions/getBalance.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        result: "0xde0b6b3a7640000",
      }),
    });

    const result = await getBalanceHandler({
      chainId: 1,
      args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" },
      env: mockEnv as any,
    });

    expect(result.result).toBe("0xde0b6b3a7640000");
  });

  it("should execute getBlockNumber handler", async () => {
    const { getBlockNumberHandler } = await import("../src/actions/getBlockNumber.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        result: "0x10d4f1",
      }),
    });

    const result = await getBlockNumberHandler({
      chainId: 1,
      args: {},
      env: mockEnv as any,
    });

    expect(result.result).toBe("0x10d4f1");
    expect(result.blockNumber).toBe("0x10d4f1");
  });

  it("should execute getGasPrice handler", async () => {
    const { getGasPriceHandler } = await import("../src/actions/getGasPrice.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        result: "0x3b9aca00",
      }),
    });

    const result = await getGasPriceHandler({
      chainId: 1,
      args: {},
      env: mockEnv as any,
    });

    expect(result.result).toBe("0x3b9aca00");
  });

  it("should execute readContract handler", async () => {
    const { readContractHandler } = await import("../src/actions/readContract.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        result: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
      }),
    });

    const result = await readContractHandler({
      chainId: 1,
      args: {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        data: "0x70a08231000000000000000000000000742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
      },
      env: mockEnv as any,
    });

    expect(result.result).toBe("0x0000000000000000000000000000000000000000000000000de0b6b3a7640000");
  });

  it("should execute getCode handler and return undefined for empty code", async () => {
    const { getCodeHandler } = await import("../src/actions/getCode.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        result: "0x",
      }),
    });

    const result = await getCodeHandler({
      chainId: 1,
      args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" },
      env: mockEnv as any,
    });

    expect(result.result).toBeUndefined();
  });

  it("should throw when all RPC endpoints fail", async () => {
    const { getBalanceHandler } = await import("../src/actions/getBalance.server");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch
      .mockRejectedValueOnce(new Error("RPC 1 failed"))
      .mockRejectedValueOnce(new Error("RPC 2 failed"))
      .mockRejectedValueOnce(new Error("RPC 3 failed"));

    await expect(
      getBalanceHandler({
        chainId: 1,
        args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" },
        env: mockEnv as any,
      })
    ).rejects.toThrow("All RPC endpoints failed");

    spy.mockRestore();
  });

  it("should throw for unsupported chain ID", async () => {
    const { getBalanceHandler } = await import("../src/actions/getBalance.server");

    await expect(
      getBalanceHandler({
        chainId: 99999,
        args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" },
        env: mockEnv as any,
      })
    ).rejects.toThrow("Unsupported chain ID");
  });

  it("should use incrementing IDs instead of Date.now()", async () => {
    const { getGasPriceHandler } = await import("../src/actions/getGasPrice.server");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", id: 2, result: "0x2" }),
      });

    await getGasPriceHandler({ chainId: 1, args: {}, env: mockEnv as any });
    await getGasPriceHandler({ chainId: 1, args: {}, env: mockEnv as any });

    const call1Body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const call2Body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(call2Body.id).toBeGreaterThan(call1Body.id);
    expect(call2Body.id - call1Body.id).toBe(1);
  });
});
