/**
 * Tests for the post-deploy smoke script (workers/scripts/smoke.mjs).
 *
 * New file: the script's pure helpers (argument parsing / URL building /
 * wei formatting) and its end-to-end runSmoke flow fit neither
 * handlers.test.ts (server-side Hono handlers) nor statistics.test.ts
 * (statistics helpers + Durable Objects). Merge suggestion: none — keep
 * this file next to the script it covers; if a scripts/ test suite ever
 * appears, move it there unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_ADDRESS,
  DEFAULT_CHAIN,
  buildUrl,
  formatEther,
  parseArgs,
  runSmoke,
} from "../scripts/smoke.mjs";

/**
 * In-memory mock of a deployed proxy covering exactly the routes the smoke
 * script exercises (health / {chain}/{action} POST / stats), mirroring the
 * real response shapes: { result, blockNumber?, timestamp } plus the
 * X-Cache / X-Trace-Id observability headers.
 */
function createMockProxy(overrides = {}) {
  const state = {
    healthStatus: 200,
    healthBody: {
      status: "ok",
      version: "0.2.0",
      environment: "production",
      chains: [{ chainId: 1, upstreams: 1 }],
    },
    blockNumberStatus: 200,
    balanceStatus: 200,
    statsStatus: 200,
    statsBody: {
      totalRequests: 4,
      cacheHits: 2,
      cacheHitRate: 0.5,
      averageResponseTime: 210,
      errorCount: 0,
      errorRate: 0,
      periods: [],
    },
    ...overrides,
  };

  const fetchMock = vi.fn(async (url, init = {}) => {
    const { pathname } = new URL(String(url));
    const json = (body, { status = 200, headers = {} } = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "X-Trace-Id": "trace0001", ...headers },
      });

    if (pathname === "/api/v1/health") {
      return json(state.healthBody, { status: state.healthStatus });
    }
    const action = /^\/api\/v1\/(\d+)\/(\w+)$/.exec(pathname);
    if (action) {
      if (action[2] === "getBlockNumber") {
        return json(
          { result: "0x1234f0", blockNumber: "0x1234f0", timestamp: 1 },
          { status: state.blockNumberStatus, headers: { "X-Cache": "HIT" } }
        );
      }
      if (action[2] === "getBalance") {
        return json(
          { result: "0xde0b6b3a7640000", timestamp: 1 },
          { status: state.balanceStatus, headers: { "X-Cache": "MISS" } }
        );
      }
    }
    if (pathname === "/api/v1/stats") {
      return json(state.statsBody, { status: state.statsStatus });
    }
    return json({ error: { code: -32601, message: "not found" } }, { status: 404 });
  });

  return { fetchMock, state };
}

const runWithMock = async (overrides = {}, options = {}) => {
  const { fetchMock } = createMockProxy(overrides);
  const lines = [];
  const result = await runSmoke(
    {
      endpoint: "https://proxy.example.com",
      chain: 1,
      address: DEFAULT_ADDRESS,
      ...options,
    },
    { fetch: fetchMock, log: (line) => lines.push(line) }
  );
  return { result, lines, fetchMock };
};

describe("Smoke script pure helpers", () => {
  describe("parseArgs", () => {
    it("should take the endpoint positionally and apply defaults", () => {
      const options = parseArgs(["https://proxy.example.com"]);
      expect(options).toEqual({
        endpoint: "https://proxy.example.com",
        chain: DEFAULT_CHAIN,
        key: undefined,
        address: DEFAULT_ADDRESS,
        help: false,
      });
    });

    it("should accept space-separated flags", () => {
      const options = parseArgs([
        "https://proxy.example.com/",
        "--chain",
        "137",
        "--key",
        "secret",
        "--address",
        "0xabc",
      ]);
      expect(options.chain).toBe(137);
      expect(options.key).toBe("secret");
      expect(options.address).toBe("0xabc");
      expect(options.endpoint).toBe("https://proxy.example.com/");
    });

    it("should accept --flag=value form", () => {
      const options = parseArgs(["https://x.dev", "--chain=137", "--key=k1"]);
      expect(options.chain).toBe(137);
      expect(options.key).toBe("k1");
    });

    it("should set help without requiring an endpoint", () => {
      expect(parseArgs(["--help"]).help).toBe(true);
      expect(parseArgs(["https://x.dev"]).help).toBe(false);
    });

    it("should reject unknown flags", () => {
      expect(() => parseArgs(["https://x.dev", "--wat"])).toThrow(/未知参数/);
    });

    it("should reject flags without a value", () => {
      expect(() => parseArgs(["https://x.dev", "--key"])).toThrow(/--key 需要一个值/);
    });

    it("should reject invalid chain ids", () => {
      expect(() => parseArgs(["https://x.dev", "--chain", "abc"])).toThrow(/正整数/);
      expect(() => parseArgs(["https://x.dev", "--chain", "0"])).toThrow(/正整数/);
      expect(() => parseArgs(["https://x.dev", "--chain", "-1"])).toThrow(/正整数/);
    });

    it("should reject malformed and non-http endpoints", () => {
      expect(() => parseArgs(["not-a-url"])).toThrow(/合法 URL/);
      expect(() => parseArgs(["ftp://x.dev"])).toThrow(/http/);
    });

    it("should reject a second positional argument", () => {
      expect(() => parseArgs(["https://x.dev", "https://y.dev"])).toThrow(/多余的参数/);
    });

    it("should require an endpoint when not asking for help", () => {
      expect(() => parseArgs([])).toThrow(/缺少 <endpoint>/);
    });
  });

  describe("buildUrl", () => {
    it("should join segments and tolerate trailing slashes", () => {
      expect(buildUrl("https://x.dev/", "api/v1", "1/getBlockNumber")).toBe(
        "https://x.dev/api/v1/1/getBlockNumber"
      );
      expect(buildUrl("https://x.dev///", "api/v1/health")).toBe(
        "https://x.dev/api/v1/health"
      );
    });

    it("should return the trimmed base when no segments are given", () => {
      expect(buildUrl("https://x.dev/")).toBe("https://x.dev");
    });
  });

  describe("formatEther", () => {
    it("should format whole and fractional wei amounts", () => {
      expect(formatEther("0xde0b6b3a7640000")).toBe("1.000000"); // 1 ETH
      expect(formatEther("0x14d1120d7b160000")).toBe("1.500000"); // 1.5 ETH
      expect(formatEther("0x00")).toBe("0.000000");
    });

    it("should return null for non-wei input", () => {
      expect(formatEther("nope")).toBeNull();
      expect(formatEther(undefined)).toBeNull();
    });
  });
});

describe("Smoke script runSmoke", () => {
  it("should pass on a healthy deployment and report cache/trace/balance", async () => {
    const { result, lines } = await runWithMock();
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.cacheHits).toBe(3); // mock always answers X-Cache: HIT
    expect(result.cacheTotal).toBe(3);
    expect(lines.some((l) => l.includes("status=ok"))).toBe(true);
    expect(lines.some((l) => l.includes("cache=HIT") && l.includes("block=#1193200"))).toBe(true);
    expect(lines.some((l) => l.includes("cache=HIT") && l.includes("trace=trace0001"))).toBe(true);
    expect(lines.some((l) => l.includes("balance=1.000000 ETH"))).toBe(true);
    expect(lines.some((l) => l.includes("总请求 4") && l.includes("50.0%"))).toBe(true);
    expect(lines.some((l) => l.includes("✅ 验证通过"))).toBe(true);
  });

  it("should exercise exactly the documented request sequence", async () => {
    const { fetchMock } = await runWithMock({}, { key: "secret" });
    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(urls).toEqual([
      "/api/v1/health",
      "/api/v1/1/getBlockNumber",
      "/api/v1/1/getBlockNumber",
      "/api/v1/1/getBlockNumber",
      "/api/v1/1/getBalance",
      "/api/v1/stats",
    ]);
    // API key travels on every request, including health and stats
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers["X-API-Key"]).toBe("secret");
    }
    // getBlockNumber posts an empty args object; getBalance posts the address
    const blockInit = fetchMock.mock.calls[1][1];
    const balanceInit = fetchMock.mock.calls[4][1];
    expect(blockInit.method).toBe("POST");
    expect(JSON.parse(blockInit.body)).toEqual({});
    expect(balanceInit.method).toBe("POST");
    expect(JSON.parse(balanceInit.body)).toEqual({ address: DEFAULT_ADDRESS });
  });

  it("should skip (not fail) when the health endpoint is missing", async () => {
    const { result, lines } = await runWithMock({ healthStatus: 404 });
    expect(result.ok).toBe(true);
    expect(lines.some((l) => l.includes("版本较旧") && l.includes("跳过"))).toBe(true);
  });

  it("should fail when health reports degraded", async () => {
    const { result, lines } = await runWithMock({
      healthBody: { status: "degraded", version: "0.2.0", chains: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("健康检查 status=degraded");
    expect(lines.some((l) => l.includes("❌ 验证失败"))).toBe(true);
  });

  it("should fail when a critical action request errors", async () => {
    const { result } = await runWithMock({
      blockNumberStatus: 500,
      balanceStatus: 502,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(4); // 3× getBlockNumber + 1× getBalance
    expect(result.failures.some((f) => f.includes("getBlockNumber"))).toBe(true);
    expect(result.failures.some((f) => f.includes("getBalance"))).toBe(true);
  });

  it("should fail on network errors without throwing", async () => {
    const lines = [];
    const result = await runSmoke(
      { endpoint: "https://proxy.example.com", chain: 1, address: DEFAULT_ADDRESS },
      {
        fetch: vi.fn(async () => {
          throw new Error("fetch failed");
        }),
        log: (line) => lines.push(line),
      }
    );
    expect(result.ok).toBe(false);
    expect(result.failures.every((f) => f.includes("不可达"))).toBe(true);
    expect(lines.some((l) => l.includes("❌"))).toBe(true);
  });

  it("should treat stats failures as optional", async () => {
    const { result, lines } = await runWithMock({ statsStatus: 401 });
    expect(result.ok).toBe(true);
    expect(lines.some((l) => l.includes("401") && l.includes("跳过"))).toBe(true);
  });
});
