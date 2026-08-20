import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { getCacheStrategy, setCacheHeaders, createCacheKey, shouldCacheResponse } from "../src/utils/cache";
import type { Env } from "../src/types";
import {
  executeRpcCall,
  getMaxRpcConcurrency,
  resetRpcConcurrency,
  setMaxRpcConcurrency,
} from "../src/actions/utils";
import { handleBatchRequest, MAX_BATCH_SIZE } from "../src/handlers/batch";

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

    it("should return long TTL for chain id queries", () => {
      const strategy = getCacheStrategy(1, "eth_chainId", []);
      expect(strategy.ttl).toBe(3600); // 1 hour
      expect(strategy.shouldCache).toBe(true);
    });

    it("should return medium TTL for transaction count queries", () => {
      const strategy = getCacheStrategy(1, "eth_getTransactionCount", ["0x123", "latest"]);
      expect(strategy.ttl).toBe(30); // 30 seconds
      expect(strategy.shouldCache).toBe(true);
    });

    it("should return short TTL for fee history queries", () => {
      const strategy = getCacheStrategy(1, "eth_feeHistory", ["0x4", "latest", []]);
      expect(strategy.ttl).toBe(12); // 12 seconds
      expect(strategy.shouldCache).toBe(true);
    });

    it("should return short TTL for blob base fee queries", () => {
      const strategy = getCacheStrategy(1, "eth_blobBaseFee", []);
      expect(strategy.ttl).toBe(12); // 12 seconds
      expect(strategy.shouldCache).toBe(true);
    });

    it("should apply block-aware TTL for storage queries", () => {
      // Latest storage slot follows block time
      const latestStrategy = getCacheStrategy(1, "eth_getStorageAt", ["0x123", "0x0", "latest"]);
      expect(latestStrategy.ttl).toBe(12);

      // Recent storage slot (16 confirmations, under one epoch) gets 5 minutes
      const recentStrategy = getCacheStrategy(1, "eth_getStorageAt", ["0x123", "0x0", "0x3f0"], 300, 0x400);
      expect(recentStrategy.ttl).toBe(300);

      // Finalized storage slot (>= epoch size) gets the long-term cache
      const finalizedStrategy = getCacheStrategy(1, "eth_getStorageAt", ["0x123", "0x0", "0x100"], 300, 0x400);
      expect(finalizedStrategy.ttl).toBe(2592000); // 30 days
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

    it("should default X-Cache to MISS", () => {
      const response = new Response("test");
      const cachedResponse = setCacheHeaders(response, 300);

      expect(cachedResponse.headers.get("X-Cache")).toBe("MISS");
      expect(cachedResponse.headers.get("X-Trace-Id")).toBeNull();
    });

    it("should set X-Cache HIT when a cache status is provided", () => {
      const response = new Response("test");
      const cachedResponse = setCacheHeaders(response, 300, { cacheStatus: "HIT" });

      expect(cachedResponse.headers.get("X-Cache")).toBe("HIT");
    });

    it("should echo the provided trace id", () => {
      const response = new Response("test");
      const cachedResponse = setCacheHeaders(response, 300, {
        cacheStatus: "HIT",
        traceId: "abc123def456",
      });

      expect(cachedResponse.headers.get("X-Trace-Id")).toBe("abc123def456");
      expect(cachedResponse.headers.get("X-Cache")).toBe("HIT");
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

  it("should execute getChainId handler and map to eth_chainId", async () => {
    const { getChainIdHandler } = await import("../src/actions/getChainId.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    });

    const result = await getChainIdHandler({ chainId: 1, args: {}, env: mockEnv as any });

    expect(result.result).toBe("0x1");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe("eth_chainId");
    expect(body.params).toEqual([]);
  });

  it("should execute getTransactionCount handler and map to eth_getTransactionCount", async () => {
    const { getTransactionCountHandler } = await import("../src/actions/getTransactionCount.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x9" }),
    });

    const result = await getTransactionCountHandler({
      chainId: 1,
      args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" },
      env: mockEnv as any,
    });

    expect(result.result).toBe("0x9");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe("eth_getTransactionCount");
    expect(body.params).toEqual(["0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18", "latest"]);
  });

  it("should encode blockNumber for getTransactionCount", async () => {
    const { getTransactionCountHandler } = await import("../src/actions/getTransactionCount.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x9" }),
    });

    await getTransactionCountHandler({
      chainId: 1,
      args: {
        address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        blockNumber: "100",
      },
      env: mockEnv as any,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params).toEqual(["0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18", "0x64"]);
  });

  it("should execute getStorageAt handler and map to eth_getStorageAt", async () => {
    const { getStorageAtHandler } = await import("../src/actions/getStorageAt.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000004" }),
    });

    const result = await getStorageAtHandler({
      chainId: 1,
      args: {
        address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        slot: "0x0",
      },
      env: mockEnv as any,
    });

    expect(result.result).toBe("0x0000000000000000000000000000000000000000000000000000000000000004");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe("eth_getStorageAt");
    expect(body.params).toEqual(["0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18", "0x0", "latest"]);
  });

  it("should execute getFeeHistory handler and map to eth_feeHistory", async () => {
    const { getFeeHistoryHandler } = await import("../src/actions/getFeeHistory.server");
    const feeHistory = {
      oldestBlock: "0x5",
      baseFeePerGas: ["0x1", "0x2"],
      gasUsedRatio: [0.5, 0.6],
      reward: [["0x3", "0x4"], ["0x5", "0x6"]],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: feeHistory }),
    });

    const result = await getFeeHistoryHandler({
      chainId: 1,
      args: { blockCount: 4, rewardPercentiles: [25, 75] },
      env: mockEnv as any,
    });

    expect(result.result).toEqual(feeHistory);
    expect(result.blockNumber).toBe("0x5");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe("eth_feeHistory");
    expect(body.params).toEqual(["0x4", "latest", [25, 75]]);
  });

  it("should execute getBlobBaseFee handler and map to eth_blobBaseFee", async () => {
    const { getBlobBaseFeeHandler } = await import("../src/actions/getBlobBaseFee.server");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    });

    const result = await getBlobBaseFeeHandler({ chainId: 1, args: {}, env: mockEnv as any });

    expect(result.result).toBe("0x1");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe("eth_blobBaseFee");
    expect(body.params).toEqual([]);
  });
});

describe("Batch Endpoint", () => {
  const batchApp = new Hono<{ Bindings: Env }>();
  batchApp.post("/api/v1/batch", handleBatchRequest);

  const postBatch = (env: unknown, body: string) =>
    batchApp.request(
      "/api/v1/batch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      env as any
    );

  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });

  it("executes a batch and returns per-item results in request order", async () => {
    mockFetch.mockResolvedValue(rpcOk("0xde0b6b3a7640000"));

    const response = await postBatch(
      mockEnv,
      JSON.stringify({
        requests: [
          { id: "a", chainId: 1, action: "getBalance", args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" } },
          { id: "b", chainId: 1, action: "getBlockNumber" },
        ],
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.results).toHaveLength(2);
    expect(data.results.map((r: any) => r.id)).toEqual(["a", "b"]);
    expect(data.results[0].result).toBe("0xde0b6b3a7640000");
    expect(data.results[1].result).toBe("0xde0b6b3a7640000");
    expect(data.results[0].error).toBeUndefined();
    // POST is never CDN-cached by design
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 400 when the batch exceeds the size limit", async () => {
    const requests = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      id: i,
      chainId: 1,
      action: "getBlockNumber",
    }));

    const response = await postBatch(mockEnv, JSON.stringify({ requests }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe(-32602);
    expect(data.error.message).toContain("exceeds limit");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or non-array requests field", async () => {
    const missing = await postBatch(mockEnv, JSON.stringify({}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe(-32602);

    const empty = await postBatch(mockEnv, JSON.stringify({ requests: [] }));
    expect(empty.status).toBe(400);
  });

  it("returns 400 for an invalid JSON body", async () => {
    const response = await postBatch(mockEnv, "{not json");

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe(-32600);
    expect(data.error.message).toContain("Invalid JSON");
  });

  it("returns 400 for structurally invalid items", async () => {
    const response = await postBatch(
      mockEnv,
      JSON.stringify({ requests: [{ chainId: 1, action: "getBalance" }] }) // no id
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.message).toContain("index 0");
  });

  it("isolates item failures: one failing item does not affect the others", async () => {
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    const response = await postBatch(
      mockEnv,
      JSON.stringify({
        requests: [
          { id: "ok", chainId: 1, action: "getBalance", args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" } },
          { id: "unsupported-chain", chainId: 99999, action: "getBalance", args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" } },
          { id: "unknown-action", chainId: 1, action: "doesNotExist" },
        ],
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    const byId = Object.fromEntries(
      data.results.map((r: any) => [r.id, r])
    ) as Record<string, any>;

    expect(byId.ok.result).toBe("0x1");
    expect(byId.ok.error).toBeUndefined();

    expect(byId["unsupported-chain"].result).toBeUndefined();
    expect(byId["unsupported-chain"].error.message).toContain("Unsupported chain ID");

    expect(byId["unknown-action"].error.code).toBe(-32601);
    expect(byId["unknown-action"].error.message).toContain("Unknown action");
  });

  it("records statistics for every item through the shared execution path", async () => {
    const statsFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        })
      );
    const statsEnv = {
      ...mockEnv,
      STATISTICS: {
        idFromName: () => ({ toString: () => "stats-id" }),
        get: () => ({ fetch: statsFetch }),
      },
    };
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    const response = await postBatch(
      statsEnv,
      JSON.stringify({
        requests: [
          { id: 1, chainId: 1, action: "getBalance", args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" } },
          { id: 2, chainId: 1, action: "getBlockNumber" },
        ],
      })
    );

    expect(response.status).toBe(200);
    // One stats write per batch item (dedup MISS path records each item)
    expect(statsFetch).toHaveBeenCalledTimes(2);
    const records = await Promise.all(
      statsFetch.mock.calls.map(async ([request]: [Request]) =>
        JSON.parse(await request.text())
      )
    );
    expect(records.filter((r) => r.method === "eth_getBalance")).toHaveLength(1);
    expect(records.filter((r) => r.method === "eth_blockNumber")).toHaveLength(1);
  });
});

describe("RPC Concurrency Limit", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });

  beforeEach(() => {
    resetRpcConcurrency();
  });

  afterEach(() => {
    resetRpcConcurrency();
    vi.useRealTimers();
  });

  it("validates the configured limit", () => {
    expect(() => setMaxRpcConcurrency(0)).toThrow();
    expect(() => setMaxRpcConcurrency(-1)).toThrow();
    expect(() => setMaxRpcConcurrency(1.5)).toThrow();
    setMaxRpcConcurrency(25);
    expect(getMaxRpcConcurrency()).toBe(25);
  });

  it("queues excess calls per chain FIFO and hands slots over in order", async () => {
    setMaxRpcConcurrency(1);
    let releaseFirst!: (value: unknown) => void;
    mockFetch
      .mockImplementationOnce(
        () => new Promise((resolve) => { releaseFirst = resolve; })
      )
      .mockResolvedValueOnce(rpcOk("0xa"))
      .mockResolvedValueOnce(rpcOk("0xb"));

    const first = executeRpcCall(1, "eth_gasPrice", []);
    const second = executeRpcCall(1, "eth_gasPrice", []);
    const third = executeRpcCall(1, "eth_gasPrice", []);
    await flush();

    // Only the first call holds the single slot; the others are queued
    expect(mockFetch).toHaveBeenCalledTimes(1);

    releaseFirst(rpcOk("0x1"));
    const [r1, r2, r3] = await Promise.all([first, second, third]);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(r1.result).toBe("0x1");
    expect(r2.result).toBe("0xa");
    expect(r3.result).toBe("0xb");
  });

  it("does not block other chains", async () => {
    setMaxRpcConcurrency(1);
    let releaseFirst!: (value: unknown) => void;
    mockFetch
      .mockImplementationOnce(
        () => new Promise((resolve) => { releaseFirst = resolve; })
      )
      .mockResolvedValue(rpcOk("0x7"));

    const held = executeRpcCall(1, "eth_gasPrice", []);
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Chain 137 has its own limiter and is not queued behind chain 1
    const other = await executeRpcCall(137, "eth_gasPrice", []);
    expect(other.result).toBe("0x7");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    releaseFirst(rpcOk("0x1"));
    await held;
  });

  it("rejects queued calls after the queue timeout without leaking the slot", async () => {
    vi.useFakeTimers();
    setMaxRpcConcurrency(1);
    let releaseFirst!: (value: unknown) => void;
    mockFetch
      .mockImplementationOnce(
        () => new Promise((resolve) => { releaseFirst = resolve; })
      )
      .mockResolvedValue(rpcOk("0xc"));

    const first = executeRpcCall(1, "eth_gasPrice", []);
    const queued = executeRpcCall(1, "eth_gasPrice", []);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const timeout = expect(queued).rejects.toThrow(/queue timeout/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await timeout;

    releaseFirst(rpcOk("0x1"));
    await first;

    // The rejected call never held a slot: the next call starts immediately
    const next = await executeRpcCall(1, "eth_gasPrice", []);
    expect(next.result).toBe("0xc");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
