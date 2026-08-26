import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { getCacheStrategy, setCacheHeaders, createCacheKey, shouldCacheResponse } from "../src/utils/cache";
import type { Env } from "../src/types";
import {
  executeRpcCall,
  getMaxRpcConcurrency,
  getSupportedChainIds,
  isSupportedChainId,
  parseChainIdParam,
  resetRpcConcurrency,
  setAllowedChainIds,
  setCustomRpcUrls,
  setMaxRpcConcurrency,
} from "../src/actions/utils";
import { handleBatchRequest, MAX_BATCH_SIZE } from "../src/handlers/batch";
import { handleActionRequest } from "../src/handlers/actions";
import {
  HEALTH_DEEP_TIMEOUT_MS,
  type DeepChainCheck,
} from "../src/handlers/health";
import {
  handleCompressedRequest,
  handleDirectRequest,
} from "../src/handlers/proxy";
import { timingSafeEqualString } from "../src/utils/auth";
import {
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  parseRateLimitPerMinute,
  resolveClientId,
} from "../src/utils/rate-limit";
import { RateLimiter } from "../src/durable-objects/rate-limiter";
import { ProxyState } from "../src/durable-objects/proxy-state";
import { MAX_PURGE_REQUESTS } from "../src/handlers/purge";
import { aggregatePeriods } from "../src/utils/statistics";
import { compressParams } from "../../src/utils/compression";
// The workers-side compression module is vi.mock'ed below, but the factory
// spreads importOriginal, so compressParams is the real implementation;
// generateParamHash comes back mocked by the factory — which is what the
// handler sees too, so test and handler compute identical hashes.
import {
  compressParams as workersCompressParams,
  generateParamHash,
} from "../src/utils/compression";

// The DurableObject base class only exists in the Workers runtime; index.ts
// re-exports the DO classes, so substitute a plain class for Node tests.
vi.mock("cloudflare:workers", () => {
  class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(state: unknown, env: unknown) {
      this.ctx = state;
      this.env = env;
    }
  }
  return { DurableObject };
});

import app from "../src/index";

// Mock compression utils. generateParamHash/decompressParams stay mocked;
// the module's other exports (compressParams, used by the purge endpoint to
// rebuild CDN cache URLs) must stay real, so spread importOriginal first.
vi.mock("../src/utils/compression", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/utils/compression")>();
  return {
    ...actual,
    decompressParams: vi.fn((params) => params),
    generateParamHash: vi.fn(
      // 64-char lowercase hex (matches the real digest shape, which the
      // store/cached endpoints validate), deterministic per input. The
      // numeric tail is taken mod 2^32 so the digest stays exactly 64
      // chars for inputs of any size.
      async (params) =>
        `${"0".repeat(56)}${(JSON.stringify(params).length % 0x100000000).toString(16).padStart(8, "0")}`
    ),
  };
});

// Create fetch mock for all tests
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch;
  MockDurableObjectStub.storedParams.clear();
});

afterEach(() => {
  mockFetch.mockRestore();
});

// Mock Durable Object stub
class MockDurableObjectStub {
  // In-memory hash->params mapping backing the PARAM_STORE binding.
  static storedParams = new Map<string, string>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Mock ParamStore hash->params mappings.
    if (request.method === "PUT" && path === "/params") {
      const { hash, params } = await request.json<{
        hash: string;
        params: string;
      }>();
      MockDurableObjectStub.storedParams.set(hash, params);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && path.startsWith("/params/")) {
      const hash = path.slice("/params/".length);
      const params = MockDurableObjectStub.storedParams.get(hash) ?? null;
      return new Response(
        JSON.stringify({ found: params !== null, params }),
        { headers: { "Content-Type": "application/json" } }
      );
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
  PARAM_STORE: new MockDurableObjectNamespace(),
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

  // Docs drift guard: the README「自动缓存策略」table must stay in sync with
  // src/utils/cache.ts. Each probe re-derives a documented tier's TTL from
  // getCacheStrategy, so changing cache.ts (or editing the table) without
  // updating the other side fails here.
  describe("README cache strategy drift guard", () => {
    const formatTtl = (ttl: number): string => {
      if (ttl % 31536000 === 0) return `${ttl / 31536000} 年`;
      if (ttl % 86400 === 0) return `${ttl / 86400} 天`;
      if (ttl % 3600 === 0) return `${ttl / 3600} 小时`;
      if (ttl % 60 === 0) return `${ttl / 60} 分钟`;
      return `${ttl} 秒`;
    };

    interface TtlProbe {
      label: string;
      method: string;
      params: unknown[];
      latestBlockNumber?: number;
    }

    // One probe per documented row of the README cache strategy table.
    // Block-scoped probes use Ethereum (epoch = 32 blocks):
    // - finalized: 0x100 - 0x1 = 255 confirmations >= epoch -> 30 days
    // - recent: 0x200 - 0x1f0 = 16 confirmations < epoch -> 5 minutes
    const probes: TtlProbe[] = [
      { label: "历史交易数据", method: "eth_getTransactionReceipt", params: ["0xabc"] },
      { label: "Finalized 区块", method: "eth_getBlockByNumber", params: ["0x1", true], latestBlockNumber: 0x100 },
      { label: "较新区块", method: "eth_getBlockByNumber", params: ["0x1f0", true], latestBlockNumber: 0x200 },
      { label: "最新数据", method: "eth_blockNumber", params: [] },
      { label: "账户状态", method: "eth_getBalance", params: ["0x123", "latest"] },
      { label: "合约代码", method: "eth_getCode", params: ["0x123", "latest"] },
      { label: "网络信息", method: "eth_chainId", params: [] },
      { label: "日志查询", method: "eth_getLogs", params: [{}] },
      { label: "其他方法", method: "eth_someUndocumentedMethod", params: [] },
    ];

    // Parse the root README.md「缓存策略」table into label -> TTL text.
    const readReadmeTtlTable = (): Map<string, string> => {
      const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf-8");
      const lines = readme.split("\n");
      const headerIndex = lines.findIndex((line) => line.trim() === "| 数据类型 | 方法 | TTL |");
      expect(headerIndex, "README cache strategy table header not found").toBeGreaterThan(-1);

      const rows = new Map<string, string>();
      for (const line of lines.slice(headerIndex + 1)) {
        if (!line.trim().startsWith("|")) break;
        const cells = line.split("|").map((cell) => cell.trim());
        // ["", 数据类型, 方法, TTL, ""] — skip the separator row
        if (cells[1].startsWith("---")) continue;
        rows.set(cells[1], cells[3]);
      }
      expect(rows.size, "README cache strategy table has no data rows").toBeGreaterThan(0);
      return rows;
    };

    it("documents every tier with the TTL value cache.ts produces", () => {
      const rows = readReadmeTtlTable();
      for (const probe of probes) {
        const actualTtl = getCacheStrategy(
          1,
          probe.method,
          probe.params as any[],
          300,
          probe.latestBlockNumber
        ).ttl;
        expect(
          rows.has(probe.label),
          `README cache table row "${probe.label}" is missing`
        ).toBe(true);
        expect(
          rows.get(probe.label),
          `README row "${probe.label}" drifted from cache.ts (${probe.method} -> ${actualTtl}s)`
        ).toBe(formatTtl(actualTtl));
      }
    });

    it("has no documented row left unverified by a probe", () => {
      const rows = readReadmeTtlTable();
      const probedLabels = new Set(probes.map((probe) => probe.label));
      const unverified = [...rows.keys()].filter((label) => !probedLabels.has(label));
      expect(
        unverified,
        "README cache table rows without a matching drift probe (add a probe or fix the table)"
      ).toEqual([]);
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
    expect(result).toMatch(/^[0-9a-f]{64}$/);
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

describe("Compressed GET requests", () => {
  const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
  const VITALIK = "0xd8dA6BFEB93458525dE2fBD952BA38Ec8b18C1F1";

  const compressedApp = new Hono<{ Bindings: Env }>();
  compressedApp.get("/api/v1/:chainId/:method", handleCompressedRequest);

  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });

  const upstreamBody = (call = 0) => JSON.parse(mockFetch.mock.calls[call][1].body);

  // The suite-wide vi.mock replaces server decompression with an identity
  // function; borrow the real implementation for a single request so the
  // client-side compressor is verified against the real server decoder.
  const useRealDecompression = async () => {
    const { decompressParams } = await import("../src/utils/compression");
    const actual = await vi.importActual<typeof import("../src/utils/compression")>(
      "../src/utils/compression"
    );
    vi.mocked(decompressParams).mockImplementationOnce(actual.decompressParams);
  };

  it("routes action-name GET requests through the action pipeline as eth_getBalance", async () => {
    mockFetch.mockResolvedValueOnce(rpcOk("0xde0b6b3a7640000"));

    const response = await compressedApp.request(
      `/api/v1/1/getBalance?p=${encodeURIComponent(
        JSON.stringify({ address: ADDRESS, blockTag: "latest" })
      )}`,
      undefined,
      mockEnv as any
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toBe("0xde0b6b3a7640000");
    expect(data.timestamp).toBeTypeOf("number");
    expect(response.headers.get("X-Cache")).toBe("MISS");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(upstreamBody().method).toBe("eth_getBalance");
    expect(upstreamBody().params).toEqual([ADDRESS, "latest"]);
  });

  it("accepts the real client compressParams output end-to-end (client ↔ server contract)", async () => {
    await useRealDecompression();

    // Exactly what src/actions/utils.ts send() puts on the wire for a GET:
    // `${endpoint}/api/v1/1/getBalance?p=${compressed.compressed}`
    const compressed = compressParams(JSON.stringify({ address: VITALIK, blockTag: "latest" }));
    mockFetch.mockResolvedValueOnce(rpcOk("0x1"));

    const response = await compressedApp.request(
      `/api/v1/1/getBalance?p=${compressed.compressed}`,
      undefined,
      mockEnv as any
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("0x1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(upstreamBody().method).toBe("eth_getBalance");
    expect(upstreamBody().params).toEqual([VITALIK, "latest"]);
  });

  it("still passes raw RPC methods with array params straight to upstream", async () => {
    await useRealDecompression();

    const compressed = compressParams(JSON.stringify([ADDRESS, "latest"]));
    mockFetch.mockResolvedValueOnce(rpcOk("0x2"));

    const response = await compressedApp.request(
      `/api/v1/1/eth_getBalance?p=${compressed.compressed}`,
      undefined,
      mockEnv as any
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("0x2");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(upstreamBody().method).toBe("eth_getBalance");
    expect(upstreamBody().params).toEqual([ADDRESS, "latest"]);
  });

  it("keeps the pre-action passthrough when an action name carries array params", async () => {
    mockFetch.mockResolvedValueOnce(rpcOk("0x3"));

    const response = await compressedApp.request(
      `/api/v1/1/getBalance?p=${encodeURIComponent(JSON.stringify([ADDRESS, "latest"]))}`,
      undefined,
      mockEnv as any
    );

    expect(response.status).toBe(200);
    expect(upstreamBody().method).toBe("getBalance");
    expect(upstreamBody().params).toEqual([ADDRESS, "latest"]);
  });
});

// ---------------------------------------------------------------------------
// Chain ID validation: pure helpers
// ---------------------------------------------------------------------------

describe("Chain ID validation helpers", () => {
  afterEach(() => {
    setAllowedChainIds(null);
  });

  describe("parseChainIdParam", () => {
    it("accepts supported default chains", () => {
      expect(parseChainIdParam("1")).toBe(1);
      expect(parseChainIdParam("10")).toBe(10);
      expect(parseChainIdParam("56")).toBe(56);
      expect(parseChainIdParam("137")).toBe(137);
      expect(parseChainIdParam("42161")).toBe(42161);
    });

    it("rejects non-numeric, non-positive and malformed segments", () => {
      for (const raw of ["abc", "", "0", "-1", "1.5", "1e9", " 1", "1 ", "0x1"]) {
        expect(parseChainIdParam(raw)).toBeNull();
      }
    });

    it("rejects well-formed but unknown chain IDs", () => {
      expect(parseChainIdParam("999999999")).toBeNull();
      expect(parseChainIdParam("31337")).toBeNull();
    });
  });

  describe("isSupportedChainId", () => {
    it("rejects non-integers and non-positive values", () => {
      expect(isSupportedChainId(1.5)).toBe(false);
      expect(isSupportedChainId(0)).toBe(false);
      expect(isSupportedChainId(-1)).toBe(false);
      expect(isSupportedChainId(NaN)).toBe(false);
    });

    it("honors an explicit allowlist when one is set", () => {
      setAllowedChainIds(new Set([137]));
      expect(isSupportedChainId(137)).toBe(true);
      // Chain 1 has RPC URLs configured but is not allowlisted
      expect(isSupportedChainId(1)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Unsupported chain IDs must never create Durable Object instances
// ---------------------------------------------------------------------------

describe("Unsupported chain IDs never create Durable Objects", () => {
  const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });

  // PROXY_STATE namespace whose stub fetch is a spy: zero calls proves no
  // Durable Object instance was ever provisioned or contacted.
  const createSpyProxyState = () => {
    const doFetch = vi.fn(async () =>
      Response.json({ exists: false, created: true })
    );
    const env = {
      ...mockEnv,
      PROXY_STATE: {
        idFromName: (name: string) => ({ name }),
        get: () => ({ fetch: doFetch }),
      },
    };
    return { env, doFetch };
  };

  it("POST /api/v1/:chainId/:action returns 400 without touching the DO", async () => {
    const guardApp = new Hono<{ Bindings: Env }>();
    guardApp.post("/api/v1/:chainId/:actionName", handleActionRequest);
    const { env, doFetch } = createSpyProxyState();

    for (const chainId of ["999999999", "abc"]) {
      const response = await guardApp.request(
        `/api/v1/${chainId}/getBalance`,
        { method: "POST", body: JSON.stringify({ address: ADDRESS }) },
        env as any
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe(-32602);
      expect(data.error.message).toContain("Unsupported chain ID");
    }

    expect(doFetch).not.toHaveBeenCalled(); // no DO instance contacted
    expect(mockFetch).not.toHaveBeenCalled(); // no upstream RPC either
  });

  it("GET /api/v1/:chainId/:method (compressed) returns 400 without touching the DO", async () => {
    const guardApp = new Hono<{ Bindings: Env }>();
    guardApp.get("/api/v1/:chainId/:method", handleCompressedRequest);
    const { env, doFetch } = createSpyProxyState();

    const response = await guardApp.request(
      `/api/v1/999999999/getBalance?p=${encodeURIComponent(
        JSON.stringify({ address: ADDRESS, blockTag: "latest" })
      )}`,
      undefined,
      env as any
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32602);
    expect(doFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("POST /api/v1/direct/:chainId/:method returns 400 without touching the DO", async () => {
    const guardApp = new Hono<{ Bindings: Env }>();
    guardApp.post("/api/v1/direct/:chainId/:method", handleDirectRequest);
    const { env, doFetch } = createSpyProxyState();

    const response = await guardApp.request(
      "/api/v1/direct/abc/eth_getBalance",
      { method: "POST", body: JSON.stringify({ params: [ADDRESS, "latest"] }) },
      env as any
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32602);
    expect(doFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("batch items with unsupported chain IDs get per-item errors and no DO access", async () => {
    const batchApp = new Hono<{ Bindings: Env }>();
    batchApp.post("/api/v1/batch", handleBatchRequest);
    const { env, doFetch } = createSpyProxyState();

    const response = await batchApp.request(
      "/api/v1/batch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            { id: "a", chainId: 999999999, action: "getBalance", args: { address: ADDRESS } },
            { id: "b", chainId: 12345, action: "getBlockNumber" },
          ],
        }),
      },
      env as any
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    for (const result of data.results) {
      expect(result.error.code).toBe(-32602);
      expect(result.error.message).toContain("Unsupported chain ID");
    }
    expect(doFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still routes supported chain IDs through to the DO (control)", async () => {
    const guardApp = new Hono<{ Bindings: Env }>();
    guardApp.post("/api/v1/:chainId/:actionName", handleActionRequest);
    const { env, doFetch } = createSpyProxyState();
    mockFetch.mockResolvedValueOnce(rpcOk("0x1"));

    const response = await guardApp.request(
      `/api/v1/1/getBalance`,
      { method: "POST", body: JSON.stringify({ address: ADDRESS }) },
      env as any
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("0x1");
    expect(doFetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Constant-time API key comparison
// ---------------------------------------------------------------------------

describe("timingSafeEqualString", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqualString("secret", "secret")).toBe(true);
    expect(timingSafeEqualString("", "")).toBe(true);
    expect(timingSafeEqualString("a b c", "a b c")).toBe(true);
  });

  it("returns false for different content of the same length", () => {
    expect(timingSafeEqualString("secret", "secrft")).toBe(false);
    expect(timingSafeEqualString("a", "b")).toBe(false);
  });

  it("returns false for different lengths, including prefix matches", () => {
    expect(timingSafeEqualString("secret", "secret-extra")).toBe(false);
    expect(timingSafeEqualString("secret-extra", "secret")).toBe(false);
    expect(timingSafeEqualString("", "s")).toBe(false);
    expect(timingSafeEqualString("s", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API key authentication middleware (app-level)
// ---------------------------------------------------------------------------

describe("API key authentication (app-level)", () => {
  const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
  const authEnv = { ...mockEnv, API_KEY: "test-secret-key" };
  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });

  it("rejects requests without credentials with 401", async () => {
    const response = await app.request(
      "/api/v1/1/getBalance",
      { method: "POST", body: JSON.stringify({ address: ADDRESS }) },
      authEnv as any
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(-32600);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("no longer accepts the key as a ?key= query parameter", async () => {
    const response = await app.request(
      "/api/v1/1/getBalance?key=test-secret-key",
      { method: "POST", body: JSON.stringify({ address: ADDRESS }) },
      authEnv as any
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(-32600);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a wrong or prefix-matching X-API-Key with 401", async () => {
    for (const key of ["wrong-key", "test-secret-ke", ""]) {
      const response = await app.request(
        "/api/v1/1/getBalance",
        { method: "POST", headers: { "X-API-Key": key }, body: "{}" },
        authEnv as any
      );
      expect(response.status).toBe(401);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts the correct X-API-Key header and forwards to the handler", async () => {
    mockFetch.mockResolvedValueOnce(rpcOk("0x1"));

    const response = await app.request(
      "/api/v1/1/getBalance",
      {
        method: "POST",
        headers: { "X-API-Key": "test-secret-key" },
        body: JSON.stringify({ address: ADDRESS }),
      },
      authEnv as any
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("0x1");
  });
});

// ---------------------------------------------------------------------------
// ALLOWED_CHAIN_IDS allowlist (app-level)
// ---------------------------------------------------------------------------

describe("ALLOWED_CHAIN_IDS allowlist (app-level)", () => {
  const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });

  afterEach(() => {
    setAllowedChainIds(null);
  });

  it("denies configured-but-not-allowlisted chains and serves allowlisted ones", async () => {
    const allowEnv = { ...mockEnv, ALLOWED_CHAIN_IDS: "137" };

    const denied = await app.request(
      "/api/v1/1/getBalance",
      { method: "POST", body: JSON.stringify({ address: ADDRESS }) },
      allowEnv as any
    );
    expect(denied.status).toBe(400);
    const data = await denied.json();
    expect(data.error.code).toBe(-32602);
    expect(data.error.message).toContain("Unsupported chain ID");
    expect(mockFetch).not.toHaveBeenCalled();

    // Chain 137 is both configured and allowlisted
    mockFetch.mockResolvedValueOnce(rpcOk("0x9"));
    const allowed = await app.request(
      "/api/v1/137/getBalance",
      { method: "POST", body: JSON.stringify({ address: ADDRESS }) },
      allowEnv as any
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).result).toBe("0x9");
  });

  it("restores the default (all configured chains) when the var is unset", async () => {
    const allowEnv = { ...mockEnv, ALLOWED_CHAIN_IDS: "137" };
    await app.request(
      "/api/v1/1/getBalance",
      { method: "POST", body: "{}" },
      allowEnv as any
    ); // sets the allowlist for this request

    mockFetch.mockResolvedValueOnce(rpcOk("0x1"));
    const response = await app.request(
      "/api/v1/1/getBalance",
      { method: "POST", body: JSON.stringify({ address: ADDRESS }) },
      mockEnv as any // no ALLOWED_CHAIN_IDS -> allowlist cleared again
    );
    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("0x1");
  });
});

// ---------------------------------------------------------------------------
// Health endpoint (app-level): GET /api/v1/health
// ---------------------------------------------------------------------------

describe("Health endpoint (app-level)", () => {
  afterEach(() => {
    // The /api/* middleware reconfigures both knobs from env vars on every
    // request; reset them so later describes start from defaults.
    setAllowedChainIds(null);
    setCustomRpcUrls({});
  });

  it("returns the default lightweight shape without touching upstreams", async () => {
    const response = await app.request("/api/v1/health", {}, mockEnv as any);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.status).toBe("ok");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.version).toBe("0.2.0");
    expect(body.environment).toBe("test");
    expect(body.durableObjects).toEqual({
      proxyState: true,
      statistics: false, // mockEnv has no STATISTICS binding
      paramStore: true, // mockEnv binds PARAM_STORE
    });
    expect(body.rateLimit).toEqual({ enabled: true, limitPerMinute: 60 });
    expect(body.chains).toEqual([
      { chainId: 1, upstreams: 3 },
      { chainId: 10, upstreams: 3 },
      { chainId: 56, upstreams: 3 },
      { chainId: 137, upstreams: 3 },
      { chainId: 42161, upstreams: 3 },
    ]);
    expect(body.deep).toBeUndefined();
    // Shallow mode must be free: no upstream RPC call of any kind.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is served without credentials even when API_KEY is configured", async () => {
    const authEnv = { ...mockEnv, API_KEY: "test-secret-key" };
    const response = await app.request("/api/v1/health", {}, authEnv as any);

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never leaks upstream URLs (counts only)", async () => {
    const env = {
      ...mockEnv,
      RPC_URLS:
        '{"1":["https://secret-upstream.example.com/v2/apikey-do-not-leak"],"137":["https://a.example","https://b.example"]}',
      ALLOWED_CHAIN_IDS: "1,137",
    };
    const response = await app.request("/api/v1/health", {}, env as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.chains).toEqual([
      { chainId: 1, upstreams: 1 },
      { chainId: 137, upstreams: 2 },
    ]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("secret-upstream");
    expect(serialized).not.toContain("apikey-do-not-leak");
    expect(serialized).not.toContain("llamarpc"); // built-in default hosts too
    expect(serialized).not.toContain("ankr");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("http://");
  });

  it("reports degraded when no chain is servable", async () => {
    const env = { ...mockEnv, ALLOWED_CHAIN_IDS: "999" };
    const response = await app.request("/api/v1/health", {}, env as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.chains).toEqual([]);
  });

  it("reports the effective rate-limit configuration", async () => {
    for (const [raw, expected] of [
      ["0", { enabled: false, limitPerMinute: 0 }],
      ["120", { enabled: true, limitPerMinute: 120 }],
      ["abc", { enabled: true, limitPerMinute: 60 }], // invalid -> default
    ] as const) {
      const env = { ...mockEnv, RATE_LIMIT_PER_MINUTE: raw };
      const response = await app.request("/api/v1/health", {}, env as any);
      expect(await response.json()).toMatchObject({ rateLimit: expected });
    }
  });

  it("deep=1 probes each configured upstream and reports latency", async () => {
    const env = {
      ...mockEnv,
      RPC_URLS:
        '{"1":["https://up-one.example"],"10":["https://up-two.example"]}',
      ALLOWED_CHAIN_IDS: "1,10",
    };
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    const response = await app.request("/api/v1/health?deep=1", {}, env as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://up-one.example",
      expect.objectContaining({ method: "POST" })
    );
    expect(body.deep).toEqual({
      checked: 2,
      chains: [
        { chainId: 1, ok: true, latencyMs: expect.any(Number) },
        { chainId: 10, ok: true, latencyMs: expect.any(Number) },
      ],
    });
    expect(body.status).toBe("ok");
    expect(body.deep.chains[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("deep=1 caps probing at 5 chains regardless of chain count", async () => {
    const rpcUrls = JSON.stringify(
      Object.fromEntries(
        [1, 10, 56, 137, 42161, 8453, 43114].map((id) => [id, ["https://up.example"]])
      )
    );
    const env = { ...mockEnv, RPC_URLS: rpcUrls };
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    const response = await app.request("/api/v1/health?deep=1", {}, env as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    // 7 chains servable, but only the first 5 are probed.
    expect(body.chains).toHaveLength(7);
    expect(body.deep.checked).toBe(5);
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(body.deep.chains.map((c: DeepChainCheck) => c.chainId)).toEqual([
      1, 10, 56, 137, 8453,
    ]);
  });

  it("deep=1 degrades (without throwing) when every probe fails", async () => {
    const env = {
      ...mockEnv,
      RPC_URLS: '{"1":["https://up-broken.example"]}',
      ALLOWED_CHAIN_IDS: "1",
    };
    mockFetch.mockRejectedValue(new Error("upstream down"));

    const response = await app.request("/api/v1/health?deep=1", {}, env as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deep.chains).toEqual([
      { chainId: 1, ok: false, latencyMs: null },
    ]);
    expect(body.status).toBe("degraded");
  });

  it("deep=1 bounds each probe with a timeout instead of hanging the response", async () => {
    vi.useFakeTimers();
    try {
      const env = {
        ...mockEnv,
        RPC_URLS: '{"1":["https://up-hanging.example"]}',
        ALLOWED_CHAIN_IDS: "1",
      };
      // A fetch that only settles when its request is aborted.
      mockFetch.mockImplementation(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      );

      const pending = app.request("/api/v1/health?deep=1", {}, env as any);
      // Run the probe timeout to expiry; the response must still settle.
      await vi.advanceTimersByTimeAsync(HEALTH_DEEP_TIMEOUT_MS + 100);
      const response = await pending;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.deep.chains).toEqual([
        { chainId: 1, ok: false, latencyMs: null },
      ]);
      expect(body.status).toBe("degraded");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limiting helpers (utils/rate-limit.ts)
// ---------------------------------------------------------------------------

describe("Rate limiting helpers", () => {
  describe("parseRateLimitPerMinute", () => {
    it("falls back to the default when unset or empty", () => {
      expect(parseRateLimitPerMinute(undefined)).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
      expect(parseRateLimitPerMinute("")).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
    });

    it('treats "0" as the explicit off switch', () => {
      expect(parseRateLimitPerMinute("0")).toBe(0);
    });

    it("accepts positive integers", () => {
      expect(parseRateLimitPerMinute("120")).toBe(120);
      expect(parseRateLimitPerMinute("1")).toBe(1);
    });

    it("floors non-integers and rejects garbage/negatives toward the default", () => {
      expect(parseRateLimitPerMinute("12.9")).toBe(12);
      expect(parseRateLimitPerMinute("abc")).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
      expect(parseRateLimitPerMinute("-5")).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
    });
  });

  describe("resolveClientId", () => {
    it("uses CF-Connecting-IP when present", () => {
      expect(resolveClientId("203.0.113.7")).toBe("203.0.113.7");
    });

    it("falls back to a shared 'unknown' bucket when absent or empty", () => {
      expect(resolveClientId(undefined)).toBe("unknown");
      expect(resolveClientId("")).toBe("unknown");
    });
  });
});

// ---------------------------------------------------------------------------
// RateLimiter Durable Object (fake in-memory SQL storage)
// ---------------------------------------------------------------------------

const createRateLimiterDo = (): {
  instance: RateLimiter;
  rows: Map<number, number>;
} => {
  const rows = new Map<number, number>();

  // Minimal SQL shim implementing exactly the statements the DO issues.
  const exec = (sql: string, ...params: unknown[]): Record<string, unknown>[] => {
    if (/^\s*CREATE/i.test(sql)) return [];

    if (sql.startsWith("INSERT INTO rate_limit_counters")) {
      const minute = params[0] as number;
      rows.set(minute, (rows.get(minute) ?? 0) + 1);
      return [];
    }

    if (sql.startsWith("DELETE FROM rate_limit_counters")) {
      const cutoff = params[0] as number;
      for (const minute of rows.keys()) {
        if (minute < cutoff) rows.delete(minute);
      }
      return [];
    }

    if (sql.startsWith("SELECT count FROM rate_limit_counters")) {
      const minute = params[0] as number;
      const count = rows.get(minute);
      return count === undefined ? [] : [{ count }];
    }

    throw new Error(`FakeSql: unsupported statement: ${sql}`);
  };

  const storage = { sql: { exec } };
  const instance = new RateLimiter({ storage } as never, {} as never);
  return { instance, rows };
};

const doConsume = (instance: RateLimiter, limit: number): Promise<Response> =>
  instance.fetch(new Request(`http://do/consume?limit=${limit}`));

describe("RateLimiter Durable Object", () => {
  it("counts requests within the limit as allowed", async () => {
    const { instance } = createRateLimiterDo();

    for (let i = 1; i <= 3; i++) {
      const response = await doConsume(instance, 3);
      expect(response.status).toBe(200);
      const verdict = await response.json();
      expect(verdict).toMatchObject({ allowed: true, count: i, limit: 3 });
    }
  });

  it("rejects once the minute budget is exhausted with a bounded retry hint", async () => {
    const { instance } = createRateLimiterDo();

    await doConsume(instance, 2);
    await doConsume(instance, 2);
    const response = await doConsume(instance, 2);

    const verdict = await response.json();
    expect(verdict.allowed).toBe(false);
    expect(verdict.count).toBe(3);
    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("purges minute buckets older than the retention window on write", async () => {
    const { instance, rows } = createRateLimiterDo();
    const currentMinute = Math.floor(Date.now() / 60_000);
    rows.set(currentMinute - 10, 99); // long-expired bucket

    await doConsume(instance, 10);

    expect(rows.has(currentMinute - 10)).toBe(false);
    expect(rows.size).toBe(1);
  });

  it("rejects a missing or invalid limit with 400 and unknown paths with 404", async () => {
    const { instance } = createRateLimiterDo();

    const badLimit = await instance.fetch(
      new Request("http://do/consume?limit=abc")
    );
    expect(badLimit.status).toBe(400);

    const negative = await instance.fetch(
      new Request("http://do/consume?limit=-1")
    );
    expect(negative.status).toBe(400);

    const notFound = await instance.fetch(new Request("http://do/nope"));
    expect(notFound.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting middleware (app-level)
// ---------------------------------------------------------------------------

describe("Rate limiting middleware (app-level)", () => {
  const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () =>
      Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });
  const post = (env: unknown, headers: Record<string, string> = {}) =>
    app.request(
      "/api/v1/1/getBalance",
      { method: "POST", headers, body: JSON.stringify({ address: ADDRESS }) },
      env as any
    );

  // A mock RATE_LIMITER namespace speaking the real DO protocol over an
  // in-memory fixed-window counter, plus the client ids it was asked for.
  const createRateLimitEnv = (
    extra: Record<string, unknown> = {}
  ): { env: Record<string, unknown>; seenClients: string[] } => {
    const buckets = new Map<string, Map<number, number>>();
    const seenClients: string[] = [];

    class Stub {
      constructor(private clientId: string) {}
      async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname !== "/consume") {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
          });
        }
        const limit = Number(url.searchParams.get("limit"));
        const minute = Math.floor(Date.now() / 60_000);
        const perClient = buckets.get(this.clientId) ?? new Map();
        buckets.set(this.clientId, perClient);
        const count = (perClient.get(minute) ?? 0) + 1;
        perClient.set(minute, count);
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((60_000 - (Date.now() % 60_000)) / 1000)
        );
        return new Response(
          JSON.stringify({ allowed: count <= limit, count, limit, retryAfterSeconds }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
    }

    class Namespace {
      idFromName(name: string) {
        return { name };
      }
      get(id: { name: string }) {
        seenClients.push(id.name);
        return new Stub(id.name);
      }
    }

    return {
      env: { ...mockEnv, RATE_LIMITER: new Namespace(), ...extra },
      seenClients,
    };
  };

  afterEach(() => {
    // The /api/* middleware reconfigures the allowlist from env on every
    // request; reset so later describes start from defaults.
    setAllowedChainIds(null);
    setCustomRpcUrls({});
  });

  it("rejects with 429, a JSON-RPC error body and Retry-After once the budget is exhausted", async () => {
    const { env } = createRateLimitEnv({ RATE_LIMIT_PER_MINUTE: "2" });
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    expect((await post(env)).status).toBe(200);
    expect((await post(env)).status).toBe(200);

    const blocked = await post(env);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    const body = await blocked.json();
    expect(body.error.code).toBe(-32005);
    expect(body.error.data.retryAfterSeconds).toBe(retryAfter);
    expect(mockFetch).toHaveBeenCalledTimes(2); // the rejected one never reached upstream
  });

  it("charges requests to CF-Connecting-IP and falls back to a shared 'unknown' bucket", async () => {
    const { env, seenClients } = createRateLimitEnv({
      RATE_LIMIT_PER_MINUTE: "1",
    });
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    await post(env, { "CF-Connecting-IP": "203.0.113.7" });
    await post(env, { "CF-Connecting-IP": "203.0.113.7" });
    expect(seenClients).toEqual(["203.0.113.7", "203.0.113.7"]);

    // No IP header (e.g. direct access): still limited, under "unknown".
    const noIp = await post(env);
    expect(noIp.status).toBe(200); // different bucket
    expect(seenClients[seenClients.length - 1]).toBe("unknown");
    const blockedUnknown = await post(env);
    expect(blockedUnknown.status).toBe(429);
    expect(seenClients[seenClients.length - 1]).toBe("unknown");
  });

  it("keeps per-IP budgets independent", async () => {
    const { env } = createRateLimitEnv({ RATE_LIMIT_PER_MINUTE: "1" });
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    expect((await post(env, { "CF-Connecting-IP": "198.51.100.1" })).status).toBe(200);
    expect((await post(env, { "CF-Connecting-IP": "198.51.100.2" })).status).toBe(200);
    expect((await post(env, { "CF-Connecting-IP": "198.51.100.1" })).status).toBe(429);
    expect((await post(env, { "CF-Connecting-IP": "198.51.100.2" })).status).toBe(429);
  });

  it("still charges 401 responses to the caller's budget (limit runs before auth)", async () => {
    const { env } = createRateLimitEnv({
      RATE_LIMIT_PER_MINUTE: "1",
      API_KEY: "test-secret-key",
    });

    const first = await post(env, { "X-API-Key": "wrong" });
    expect(first.status).toBe(401);

    const second = await post(env, { "X-API-Key": "wrong" });
    expect(second.status).toBe(429);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("leaves the read-only monitoring endpoints exempt", async () => {
    const { env } = createRateLimitEnv({ RATE_LIMIT_PER_MINUTE: "1" });
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    expect((await post(env)).status).toBe(200);
    expect((await post(env)).status).toBe(429); // proxied surface exhausted

    const stats = await app.request("/api/v1/stats", {}, env as any);
    expect(stats.status).toBe(200); // no STATISTICS binding -> empty summary

    const health = await app.request("/api/v1/health", {}, env as any);
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe("ok");
  });

  it("is fully disabled by RATE_LIMIT_PER_MINUTE=0 (no DO call at all)", async () => {
    const { env, seenClients } = createRateLimitEnv({
      RATE_LIMIT_PER_MINUTE: "0",
    });
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    for (let i = 0; i < 5; i++) {
      expect((await post(env)).status).toBe(200);
    }
    expect(seenClients).toEqual([]);
  });

  it("fails open when the limiter DO errors or is unreachable", async () => {
    class BrokenStub {
      async fetch(): Promise<Response> {
        throw new Error("DO unavailable");
      }
    }
    class ErrorStub {
      async fetch(): Promise<Response> {
        return new Response("boom", { status: 500 });
      }
    }
    class Namespace {
      constructor(private stub: unknown) {}
      idFromName() {
        return {};
      }
      get() {
        return this.stub;
      }
    }

    mockFetch.mockResolvedValue(rpcOk("0x1"));
    const throwingEnv = {
      ...mockEnv,
      RATE_LIMIT_PER_MINUTE: "1",
      RATE_LIMITER: new Namespace(new BrokenStub()),
    };
    expect((await post(throwingEnv)).status).toBe(200);
    expect((await post(throwingEnv)).status).toBe(200);

    const erroringEnv = {
      ...mockEnv,
      RATE_LIMIT_PER_MINUTE: "1",
      RATE_LIMITER: new Namespace(new ErrorStub()),
    };
    expect((await post(erroringEnv)).status).toBe(200);
  });

  it("records 429s as error statistics under the 'rate_limit' method", async () => {
    const records: Array<Record<string, unknown>> = [];
    class RecordingStub {
      async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === "/record") {
          records.push(await request.json());
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    class StatsNamespace {
      idFromName() {
        return {};
      }
      get() {
        return new RecordingStub();
      }
    }

    const { env } = createRateLimitEnv({
      RATE_LIMIT_PER_MINUTE: "1",
      STATISTICS: new StatsNamespace(),
    });
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    expect((await post(env)).status).toBe(200);
    expect((await post(env)).status).toBe(429);

    const rejected = records.filter((r) => r.method === "rate_limit");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      chainId: 0,
      cacheStatus: "MISS",
      error: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Stats dashboard (app-level): GET /dashboard
// ---------------------------------------------------------------------------

describe("Stats dashboard (app-level)", () => {
  it("serves an HTML document with the rendering hooks", async () => {
    const response = await app.request("/dashboard", {}, mockEnv as any);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();

    // DOM hooks the inline script renders into.
    for (const id of [
      "stats-container",
      "stats-chart",
      "stats-table-body",
      "summary-cards",
      "auth-hint",
      "error-banner",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("/api/v1/stats"); // fetches the stats endpoint
  });

  it("is self-contained: no external scripts or stylesheets", async () => {
    const response = await app.request("/dashboard", {}, mockEnv as any);
    const html = await response.text();

    // No <script src>, <link rel=stylesheet>, or any external URL reference
    // that a browser would fetch: style and script must be fully inline.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/[^"'\\\s)]+/);
  });

  it("stays accessible without credentials when API_KEY is set", async () => {
    const authEnv = { ...mockEnv, API_KEY: "test-secret-key" };
    const response = await app.request("/dashboard", {}, authEnv as any);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("is registered in the monitoring exemption registries", async () => {
    // /dashboard is a read-only monitoring surface: listed in both registries
    // (defensive — the path also sits outside the /api/* middleware scopes).
    const { PUBLIC_API_PATHS } = await import("../src/utils/auth");
    const { RATE_LIMIT_EXEMPT_PATHS } = await import("../src/utils/rate-limit");
    expect(PUBLIC_API_PATHS.has("/dashboard")).toBe(true);
    expect(RATE_LIMIT_EXEMPT_PATHS.has("/dashboard")).toBe(true);
  });

  it("does not touch the Statistics DO or upstreams (shell only)", async () => {
    const seen: string[] = [];
    class RecordingStub {
      async fetch(request: Request): Promise<Response> {
        seen.push(new URL(request.url).pathname);
        return new Response(JSON.stringify(aggregatePeriods([])), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    class StatsNamespace {
      idFromName() {
        return {};
      }
      get() {
        return new RecordingStub();
      }
    }

    const response = await app.request("/dashboard", {}, {
      ...mockEnv,
      STATISTICS: new StatsNamespace(),
    } as any);

    expect(response.status).toBe(200);
    expect(seen).toEqual([]); // the page shell proxies nothing
    expect(mockFetch).not.toHaveBeenCalled(); // and calls no upstream
  });
});

// ---------------------------------------------------------------------------
// Origin allowlist (app-level): ALLOWED_ORIGINS
// ---------------------------------------------------------------------------

describe("Origin allowlist (app-level)", () => {
  const ADDRESS = "0x742d35Cc6634C0532925a3f2bD18";
  const rpcOk = (result: unknown) => ({
    ok: true,
    json: () =>
      Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result }),
  });
  const allowEnv = (origins: string, extra: Record<string, unknown> = {}) => ({
    ...mockEnv,
    ALLOWED_ORIGINS: origins,
    ...extra,
  });
  const post = (env: unknown, headers: Record<string, string> = {}) =>
    app.request(
      "/api/v1/1/getBalance",
      { method: "POST", headers, body: JSON.stringify({ address: ADDRESS }) },
      env as any
    );

  afterEach(() => {
    // The /api/* middleware reconfigures the allowlist from env on every
    // request; reset so later describes start from defaults.
    setAllowedChainIds(null);
    setCustomRpcUrls({});
  });

  it("is fully permissive when ALLOWED_ORIGINS is unset (zero drift)", async () => {
    mockFetch.mockResolvedValue(rpcOk("0x1"));

    // A foreign Origin passes and CORS stays wide open, exactly as before.
    const response = await post(mockEnv, { Origin: "https://evil.example.net" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Vary")).not.toContain("Origin");

    // Preflights keep the previous shape too.
    const preflight = await app.request(
      "/api/v1/1/getBalance",
      { method: "OPTIONS", headers: { Origin: "https://evil.example.net" } },
      mockEnv as any
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("403s non-matching origins before auth, without upstream calls or CORS echo", async () => {
    const env = allowEnv("app.example.com", { API_KEY: "test-secret-key" });

    const response = await post(env, { Origin: "https://evil.example.net" });

    // 403, not 401: the origin check runs before the auth middleware.
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error.code).toBe(-32000);
    expect(data.error.message).toContain("Origin not allowed");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(null);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("matches exact hosts (scheme/case-insensitive, port-sensitive) and echoes the origin", async () => {
    mockFetch.mockResolvedValue(rpcOk("0x2"));
    const env = allowEnv("https://App.Example.com:8443,other.test");

    const response = await post(env, { Origin: "https://app.example.com:8443" });
    expect(response.status).toBe(200);
    // The allowlist echo replaces the permissive `*`, with Vary: Origin.
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com:8443"
    );
    expect(response.headers.get("Vary")).toContain("Origin");

    // Same host, different port: a different origin.
    expect(
      (await post(env, { Origin: "https://app.example.com:3000" })).status
    ).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("matches wildcards against the apex and subdomains, but not lookalikes", async () => {
    mockFetch.mockResolvedValue(rpcOk("0x3"));
    const env = allowEnv("*.example.com");

    for (const origin of [
      "https://example.com",
      "https://app.example.com",
      "https://deep.sub.example.com",
    ]) {
      expect((await post(env, { Origin: origin })).status).toBe(200);
    }
    for (const origin of [
      "https://notexample.com",
      "https://example.com.evil.net",
      "https://evil.net",
    ]) {
      expect((await post(env, { Origin: origin })).status).toBe(403);
    }
    expect(mockFetch).toHaveBeenCalledTimes(3); // only the matches went upstream
  });

  it("passes requests without an Origin header (server-side/mobile callers)", async () => {
    mockFetch.mockResolvedValue(rpcOk("0x4"));
    const env = allowEnv("app.example.com");

    const response = await post(env);

    expect(response.status).toBe(200);
    // No Origin in play -> no ACAO header to echo.
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  it("answers preflights per the allowlist: echo when matching, silent otherwise", async () => {
    const env = allowEnv("app.example.com");

    const allowed = await app.request(
      "/api/v1/1/getBalance",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type, x-api-key",
        },
      },
      env as any
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com"
    );
    expect(allowed.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST"
    );
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-API-Key"
    );

    const denied = await app.request(
      "/api/v1/1/getBalance",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example.net",
          "Access-Control-Request-Method": "POST",
        },
      },
      env as any
    );
    // Preflights still answer 204, but without ACAO the browser rejects it.
    expect(denied.status).toBe(204);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  it("guards monitoring endpoints too; only /dashboard is exempt", async () => {
    const env = allowEnv("app.example.com");

    const stats = await app.request(
      "/api/v1/stats",
      { headers: { Origin: "https://evil.example.net" } },
      env as any
    );
    expect(stats.status).toBe(403);

    const health = await app.request(
      "/api/v1/health",
      { headers: { Origin: "https://evil.example.net" } },
      env as any
    );
    expect(health.status).toBe(403);

    // The operator page stays reachable: read-only, unauthenticated by
    // design, and needed most while a flood is being observed.
    const dashboard = await app.request(
      "/dashboard",
      { headers: { Origin: "https://evil.example.net" } },
      env as any
    );
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get("content-type")).toContain("text/html");
  });

  it("fails closed when the allowlist parses to zero rules", async () => {
    mockFetch.mockResolvedValue(rpcOk("0x5"));
    const env = allowEnv(", ,");

    expect(
      (await post(env, { Origin: "https://app.example.com" })).status
    ).toBe(403);
    expect((await post(env)).status).toBe(200); // non-browser callers unaffected
  });

  it("treats unmatchable origins (e.g. sandboxed iframes' null) as non-matching", async () => {
    const env = allowEnv("app.example.com");
    expect((await post(env, { Origin: "null" })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Cache purge (app-level): POST /api/v1/purge
// ---------------------------------------------------------------------------

describe("Cache purge endpoint (app-level)", () => {
  const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
  const KEY = "test-secret-key";

  // In-memory per-chain dedup store speaking the purge additions of the
  // ProxyState DO protocol, plus a record of every stub call.
  const createPurgeEnv = (extra: Record<string, unknown> = {}) => {
    const stores = new Map<string, Set<string>>();
    const calls: Array<{ chain: string; method: string; path: string }> = [];

    class Stub {
      constructor(private chain: string) {}
      async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        calls.push({
          chain: this.chain,
          method: request.method,
          path: url.pathname,
        });
        if (request.method === "POST" && url.pathname === "/purge") {
          const store = stores.get(this.chain) ?? new Set<string>();
          const deleted = store.size;
          store.clear();
          stores.set(this.chain, store);
          return new Response(JSON.stringify({ deleted }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (
          request.method === "DELETE" &&
          url.pathname.startsWith("/requests/")
        ) {
          const store = stores.get(this.chain) ?? new Set<string>();
          const deleted = store.delete(url.pathname.split("/")[2]);
          stores.set(this.chain, store);
          return new Response(JSON.stringify({ deleted }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    class Namespace {
      idFromName(name: string) {
        return { name };
      }
      get(id: { name: string }) {
        return new Stub(id.name);
      }
    }

    return {
      env: { ...mockEnv, API_KEY: KEY, PROXY_STATE: new Namespace(), ...extra },
      stores,
      calls,
    };
  };

  // caches.default does not exist under Node; substitute one so the handler
  // exercises the real cache.delete() code path.
  const mockCacheDelete = vi.fn(async () => false as boolean);
  const originalCaches = (globalThis as { caches?: unknown }).caches;

  beforeEach(() => {
    (globalThis as { caches?: unknown }).caches = {
      default: { delete: mockCacheDelete },
    };
  });

  afterEach(() => {
    if (originalCaches === undefined) {
      delete (globalThis as { caches?: unknown }).caches;
    } else {
      (globalThis as { caches?: unknown }).caches = originalCaches;
    }
    // The /api/* middleware reconfigures the allowlist from env on every
    // request; reset so later describes start from defaults.
    setAllowedChainIds(null);
    setCustomRpcUrls({});
  });

  const purge = (
    env: unknown,
    body: unknown,
    headers: Record<string, string> = {}
  ) =>
    app.request(
      "/api/v1/purge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": KEY, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      env as any
    );

  it("returns 501 with guidance when no API_KEY is configured", async () => {
    const { env, calls } = createPurgeEnv();
    delete (env as Record<string, unknown>).API_KEY;

    const response = await purge(env, {
      requests: [{ chainId: 1, action: "getBalance", args: { address: ADDRESS } }],
    });

    expect(response.status).toBe(501);
    const data = await response.json();
    expect(data.error.code).toBe(-32601);
    expect(data.error.message).toContain("API_KEY");
    // Disabled means disabled: nothing was touched.
    expect(calls).toEqual([]);
    expect(mockCacheDelete).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing key with 401 before the handler runs", async () => {
    const { env, calls } = createPurgeEnv();

    for (const key of [undefined, "wrong-key"]) {
      const response = await purge(
        env,
        { requests: [{ chainId: 1, action: "getBalance" }] },
        key === undefined ? { "X-API-Key": "" } : { "X-API-Key": key }
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe(-32600);
    }
    expect(calls).toEqual([]);
    expect(mockCacheDelete).not.toHaveBeenCalled();
  });

  it("purges per-request entries: the DO record and the colo cache entry", async () => {
    const { env, stores, calls } = createPurgeEnv();
    const argsJson = JSON.stringify({ address: ADDRESS });
    const hash = await generateParamHash(`1:getBalance:${argsJson}`);
    stores.set("chain-1", new Set([hash, "some-other-hash"]));
    // First URL lookup finds the entry; later ones miss.
    mockCacheDelete.mockResolvedValueOnce(true);

    const response = await purge(env, {
      requests: [{ chainId: 1, action: "getBalance", args: { address: ADDRESS } }],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.purged).toEqual({ dedup: 1, cache: 1 });
    expect(body.scope).toBe("colo");
    expect(body.limitations).toHaveLength(1);
    expect(body.limitations[0]).toContain("colo");

    // The DO delete targeted the exact hash the dedup path stores under.
    expect(calls).toEqual([
      { chain: "chain-1", method: "DELETE", path: `/requests/${hash}` },
    ]);
    // And the cache delete targeted the exact compressed GET URL.
    expect(mockCacheDelete).toHaveBeenCalledTimes(1);
    const [request] = mockCacheDelete.mock.calls[0] as [Request];
    expect(request.method).toBe("GET");
    expect(request.url).toBe(
      `http://localhost/api/v1/1/getBalance?p=${workersCompressParams(argsJson)}`
    );
  });

  it("resolves each item against its own chain (per-item chainId)", async () => {
    const { env, stores, calls } = createPurgeEnv();
    const hash1 = await generateParamHash(`1:getBlockNumber:{}`);
    const hash137 = await generateParamHash(`137:getBlockNumber:{}`);
    stores.set("chain-1", new Set([hash1]));
    stores.set("chain-137", new Set([hash137]));

    const response = await purge(env, {
      requests: [
        { chainId: 1, action: "getBlockNumber" },
        { chainId: 137, action: "getBlockNumber" },
      ],
    });

    expect(response.status).toBe(200);
    expect((await response.json()).purged).toEqual({ dedup: 2, cache: 0 });
    expect(calls.map((call) => call.chain)).toEqual(["chain-1", "chain-137"]);
    expect(calls.every((call) => call.method === "DELETE")).toBe(true);
  });

  it("falls back to the top-level chainId for items without one", async () => {
    const { env, calls } = createPurgeEnv();

    const response = await purge(env, {
      chainId: 10,
      requests: [{ action: "getBlockNumber" }],
    });

    expect(response.status).toBe(200);
    expect(calls[0].chain).toBe("chain-10");
  });

  it("purges a whole chain via the DO and discloses the enumeration limit", async () => {
    const { env, stores, calls } = createPurgeEnv();
    stores.set("chain-1", new Set(["h1", "h2", "h3"]));

    const response = await purge(env, { chainId: 1 });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.purged).toEqual({ dedup: 3, cache: 0 });
    expect(body.scope).toBe("colo");
    expect(body.limitations).toHaveLength(2);
    expect(body.limitations[1]).toContain("cannot be enumerated");
    // Chain level never guesses at CDN URLs.
    expect(calls).toEqual([{ chain: "chain-1", method: "POST", path: "/purge" }]);
    expect(mockCacheDelete).not.toHaveBeenCalled();
  });

  it("rejects unsupported granularity, invalid input and over-cap lists with 400", async () => {
    const { env } = createPurgeEnv();

    const cases: Array<[unknown, RegExp]> = [
      [{}, /Nothing to purge/],
      [{ method: "eth_getBalance" }, /Method-level purge is not supported/],
      [{ chainId: 0 }, /Invalid chainId/],
      [{ chainId: "abc" }, /Invalid chainId/],
      [
        { requests: [{ chainId: 1, action: "definitelyNotAnAction" }] },
        /Unknown action: definitelyNotAnAction/,
      ],
      [
        { requests: [{ action: "getBalance" }] },
        /positive integer chainId/,
      ],
      [
        {
          requests: Array.from({ length: MAX_PURGE_REQUESTS + 1 }, () => ({
            chainId: 1,
            action: "getBlockNumber",
          })),
        },
        new RegExp(`Too many purge requests \\(${MAX_PURGE_REQUESTS + 1}\\)`),
      ],
      ["{not json", /Invalid JSON body/],
    ];

    for (const [body, message] of cases) {
      const response = await purge(env, body);
      expect(response.status, `body ${JSON.stringify(body)}`).toBe(400);
      const data = await response.json();
      expect(data.error.code, `body ${JSON.stringify(body)}`).toBe(-32602);
      expect(data.error.message).toMatch(message);
    }
  });

  it("fails with 502 when the ProxyState DO is unreachable", async () => {
    class ThrowingNamespace {
      idFromName() {
        return {};
      }
      get() {
        return {
          async fetch() {
            throw new Error("DO unavailable");
          },
        };
      }
    }
    const env = {
      ...mockEnv,
      API_KEY: KEY,
      PROXY_STATE: new ThrowingNamespace(),
    };

    const response = await purge(env, {
      requests: [{ chainId: 1, action: "getBlockNumber" }],
    });

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe(-32603);
  });

  it("is not exempt from rate limiting (admin op, charged like any other)", async () => {
    let count = 0;
    class LimiterStub {
      async fetch(request: Request): Promise<Response> {
        const limit = Number(new URL(request.url).searchParams.get("limit"));
        count += 1;
        return new Response(
          JSON.stringify({
            allowed: count <= limit,
            count,
            limit,
            retryAfterSeconds: 30,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
    }
    class LimiterNamespace {
      idFromName() {
        return {};
      }
      get() {
        return new LimiterStub();
      }
    }

    const { env } = createPurgeEnv({
      RATE_LIMITER: new LimiterNamespace(),
      RATE_LIMIT_PER_MINUTE: "1",
    });

    const first = await purge(env, {
      requests: [{ chainId: 1, action: "getBlockNumber" }],
    });
    expect(first.status).toBe(200);

    const second = await purge(env, {
      requests: [{ chainId: 1, action: "getBlockNumber" }],
    });
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe(-32005);
  });
});

// ---------------------------------------------------------------------------
// Purge compression contract: workers compressParams === client compressParams
// ---------------------------------------------------------------------------

describe("Purge URL compression contract", () => {
  const samples = [
    '{"address":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"}',
    '{"blockTag":"latest"}',
    // Function selector + zero padding exercise the dictionary and {N}z paths
    '{"data":"0x70a0823100000000000000000000000000000000000000000000000000000000000000dead","to":"0x0000000000000000000000000000000000000001"}',
  ];

  it("produces byte-identical p= values to the client library", () => {
    for (const sample of samples) {
      expect(workersCompressParams(sample)).toBe(compressParams(sample).compressed);
    }
  });

  it("round-trips through the workers-side decompressParams", async () => {
    const actual =
      await vi.importActual<typeof import("../src/utils/compression")>(
        "../src/utils/compression"
      );
    for (const sample of samples) {
      expect(actual.decompressParams(workersCompressParams(sample))).toBe(sample);
    }
  });
});

// ---------------------------------------------------------------------------
// ProxyState Durable Object purge paths (fake in-memory SQL storage)
// ---------------------------------------------------------------------------

const createProxyStateDo = (): {
  instance: ProxyState;
  rows: Map<string, Record<string, unknown>>;
} => {
  const rows = new Map<string, Record<string, unknown>>();

  // Minimal SQL shim implementing exactly the statements the DO issues.
  const exec = (
    sql: string,
    ...params: unknown[]
  ): Record<string, unknown>[] => {
    if (/^\s*CREATE/i.test(sql)) return [];

    if (sql.startsWith("SELECT * FROM pending_requests")) {
      const row = rows.get(params[0] as string);
      return row ? [row] : [];
    }

    if (sql.startsWith("SELECT 1 FROM pending_requests")) {
      return rows.has(params[0] as string) ? [{ "1": 1 }] : [];
    }

    if (sql.startsWith("SELECT COUNT(*)")) {
      return [{ count: rows.size }];
    }

    // Specific DELETEs before the bare table-wide one (cleanup paths).
    if (sql.startsWith("DELETE FROM pending_requests WHERE request_hash")) {
      rows.delete(params[0] as string);
      return [];
    }

    if (sql.startsWith("DELETE FROM pending_requests")) {
      rows.clear();
      return [];
    }

    if (sql.startsWith("INSERT INTO pending_requests")) {
      rows.set(params[0] as string, {
        request_hash: params[0],
        status: "pending",
        result: null,
        error: null,
        created_at: params[1],
        completed_at: null,
      });
      return [];
    }

    if (sql.startsWith("UPDATE pending_requests")) {
      const row = rows.get(params[2] as string);
      if (row) {
        row.status = sql.includes("'completed'") ? "completed" : "failed";
        row.completed_at = params[1];
      }
      return [];
    }

    throw new Error(`FakeSql: unsupported statement: ${sql}`);
  };

  const storage = {
    sql: { exec },
    getAlarm: () => null,
    setAlarm: () => {},
  };
  const instance = new ProxyState({ storage } as never, {} as never);
  return { instance, rows };
};

describe("ProxyState Durable Object purge paths", () => {
  it("DELETE /requests/:hash removes an existing record and reports true", async () => {
    const { instance, rows } = createProxyStateDo();
    rows.set("hash-a", {
      request_hash: "hash-a",
      status: "completed",
      result: "ok",
      created_at: Date.now(),
      completed_at: Date.now(),
    });

    const response = await instance.fetch(
      new Request("http://do/requests/hash-a", { method: "DELETE" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(rows.has("hash-a")).toBe(false);

    // The record is truly gone from the read path too.
    const status = await instance.fetch(
      new Request("http://do/requests/hash-a/status")
    );
    expect(status.status).toBe(404);
  });

  it("DELETE /requests/:hash reports false for an unknown hash", async () => {
    const { instance } = createProxyStateDo();

    const response = await instance.fetch(
      new Request("http://do/requests/never-seen", { method: "DELETE" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: false });
  });

  it("POST /purge clears every record and reports the deleted count", async () => {
    const { instance, rows } = createProxyStateDo();
    for (const hash of ["h1", "h2", "h3"]) {
      rows.set(hash, { request_hash: hash, status: "pending" });
    }

    const response = await instance.fetch(
      new Request("http://do/purge", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 3 });
    expect(rows.size).toBe(0);

    // Idempotent: purging an empty store reports zero.
    const again = await instance.fetch(
      new Request("http://do/purge", { method: "POST" })
    );
    expect(await again.json()).toEqual({ deleted: 0 });
  });
});

describe("Hash-reference flow (POST /api/v1/store + GET /api/v1/cached)", () => {
  const paramsJson = JSON.stringify([
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "latest",
  ]);
  // Same mock the handlers see, so store's server-side recomputation and
  // the cached lookup agree on the digest.
  const storedHash = () => generateParamHash(paramsJson);

  const rpcOk = (result: unknown) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      headers: { "Content-Type": "application/json" },
    });

  it("stores a valid hash/params pair", async () => {
    const response = await app.request(
      "/api/v1/store",
      {
        method: "POST",
        body: JSON.stringify({ hash: await storedHash(), params: paramsJson }),
      },
      mockEnv as any
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stored: true });
    expect(MockDurableObjectStub.storedParams.get(await storedHash())).toBe(
      paramsJson
    );
  });

  it("rejects a hash that does not match params with -32602/400", async () => {
    const wrongHash = "b".repeat(64);
    const response = await app.request(
      "/api/v1/store",
      {
        method: "POST",
        body: JSON.stringify({ hash: wrongHash, params: paramsJson }),
      },
      mockEnv as any
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32602);
    expect(MockDurableObjectStub.storedParams.has(wrongHash)).toBe(false);
  });

  it("rejects non-hex hashes with -32602/400", async () => {
    const response = await app.request(
      "/api/v1/store",
      {
        method: "POST",
        body: JSON.stringify({ hash: "not-a-digest", params: paramsJson }),
      },
      mockEnv as any
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32602);
  });

  it("rejects oversized payloads with 413", async () => {
    const oversized = JSON.stringify({ blob: "x".repeat(32 * 1024) });
    const response = await app.request(
      "/api/v1/store",
      {
        method: "POST",
        body: JSON.stringify({
          hash: await generateParamHash(oversized),
          params: oversized,
        }),
      },
      mockEnv as any
    );

    expect(response.status).toBe(413);
  });

  it("returns 404 -32004 for a hash that was never stored", async () => {
    const unknownHash = "c".repeat(64);
    const response = await app.request(
      `/api/v1/cached/1:eth_getBalance:${unknownHash}`,
      {},
      mockEnv as any
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe(-32004);
  });

  it("executes stored raw-RPC params through the shared pipeline", async () => {
    await app.request(
      "/api/v1/store",
      {
        method: "POST",
        body: JSON.stringify({ hash: await storedHash(), params: paramsJson }),
      },
      mockEnv as any
    );
    mockFetch.mockResolvedValueOnce(rpcOk("0x1234"));

    const response = await app.request(
      `/api/v1/cached/1:eth_getBalance:${await storedHash()}`,
      {},
      mockEnv as any
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe("0x1234");
    // eth_getBalance tier: account-state TTL, first execution is a MISS.
    expect(response.headers.get("cache-control")).toContain("max-age=30");
    expect(response.headers.get("x-cache")).toBe("MISS");

    // The upstream received the stored params verbatim.
    const rpcBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(rpcBody.method).toBe("eth_getBalance");
    expect(rpcBody.params).toEqual(JSON.parse(paramsJson));
  });

  it("routes known action names through the action pipeline", async () => {
    const argsJson = JSON.stringify({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" });
    const argsHash = await generateParamHash(argsJson);
    await app.request(
      "/api/v1/store",
      {
        method: "POST",
        body: JSON.stringify({ hash: argsHash, params: argsJson }),
      },
      mockEnv as any
    );
    mockFetch.mockResolvedValueOnce(rpcOk("0x9"));

    const response = await app.request(
      `/api/v1/cached/1:getBalance:${argsHash}`,
      {},
      mockEnv as any
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("0x9");
    const rpcBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(rpcBody.method).toBe("eth_getBalance");
  });

  it("rejects malformed cache keys with -32602/400", async () => {
    const response = await app.request(
      "/api/v1/cached/not-a-key",
      {},
      mockEnv as any
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32602);
  });

  it("rejects unsupported chains before touching ParamStore", async () => {
    const response = await app.request(
      `/api/v1/cached/8453:eth_getBalance:${await storedHash()}`,
      {},
      mockEnv as any
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("8453");
    expect(MockDurableObjectStub.storedParams.has(await storedHash())).toBe(
      false
    );
  });
});

describe("Malformed percent-encoding guard", () => {
  it("answers 400 -32602 instead of a framework-level 500 for bad escapes", async () => {
    // Hono's query decoding throws URIError on "%%%"; the entry middleware
    // must convert that into a caller error before any handler runs.
    const response = await app.request(
      "/api/v1/1/eth_getBalance?p=%%%",
      {},
      mockEnv as any
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("percent-encoding");
  });

  it("leaves well-formed query strings untouched", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await app.request(
      `/api/v1/1/eth_blockNumber?p=${encodeURIComponent(JSON.stringify([]))}`,
      {},
      mockEnv as any
    );

    expect(response.status).toBe(200);
  });
});
