/**
 * Tests for the benchmark tool (scripts/benchmark.mjs).
 *
 * New file: the script's pure helpers (argument / scenario parsing, URL
 * building, percentile math, latency summaries, request construction,
 * report aggregation) and its end-to-end runBenchmark flow fit none of the
 * existing src/test suites (client library units). Merge suggestion: none —
 * keep this file next to the script it covers; it is picked up by the root
 * vitest default include pattern for .test.ts files.
 *
 * Network logic is exercised through an injectable fetch mock that mirrors
 * the real response shapes: proxy actions answer
 * `{ result, blockNumber?, timestamp }` with X-Cache / X-Trace-Id headers,
 * the direct path answers `{ jsonrpc, id, result }`.
 */
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_ADDRESS,
  DEFAULT_CHAIN,
  DEFAULT_CONTRACT,
  DEFAULT_ITERATIONS,
  NAME_CALLDATA,
  SCENARIOS,
  parseScenarios,
  parseArgs,
  buildUrl,
  percentile,
  summarize,
  buildScenarioRequests,
  aggregateScenario,
  formatReport,
  runBenchmark,
  toJsonReport,
} from "./benchmark.mjs";

describe("Benchmark Tool", () => {
  describe("parseScenarios", () => {
    it("should parse and trim a comma-separated list", () => {
      expect(parseScenarios("getBalance, getBlockNumber")).toEqual([
        "getBalance",
        "getBlockNumber",
      ]);
    });

    it("should deduplicate while preserving order", () => {
      expect(parseScenarios("getBlockNumber,getBalance,getBlockNumber")).toEqual([
        "getBlockNumber",
        "getBalance",
      ]);
    });

    it("should reject empty lists", () => {
      expect(() => parseScenarios("  ,  ")).toThrow(/不能为空/);
    });

    it("should reject unknown scenario names with the valid list", () => {
      expect(() => parseScenarios("getBalance,nope")).toThrow(/未知场景: nope/);
      expect(() => parseScenarios("getBalance,nope")).toThrow(/readContract/);
    });
  });

  describe("parseArgs", () => {
    const base = ["--proxy", "https://proxy.dev", "--rpc", "https://rpc.dev"];

    it("should fill defaults for every option", () => {
      const options = parseArgs(base);
      expect(options).toMatchObject({
        proxy: "https://proxy.dev",
        rpc: "https://rpc.dev",
        chain: DEFAULT_CHAIN,
        iterations: DEFAULT_ITERATIONS,
        address: DEFAULT_ADDRESS,
        json: false,
        help: false,
      });
      expect(options.scenarios).toEqual(SCENARIOS);
      expect(options.key).toBeUndefined();
    });

    it("should accept --flag value and --flag=value forms", () => {
      expect(parseArgs([...base, "--chain", "137", "--iterations=5"]).chain).toBe(137);
      expect(parseArgs([...base, "--chain=137"]).chain).toBe(137);
    });

    it("should accept --scenario overriding the default list", () => {
      expect(parseArgs([...base, "--scenario", "readContract"]).scenarios).toEqual([
        "readContract",
      ]);
    });

    it("should accept --json and --json=false", () => {
      expect(parseArgs([...base, "--json"]).json).toBe(true);
      expect(parseArgs([...base, "--json=true"]).json).toBe(true);
      expect(parseArgs([...base, "--json=false"]).json).toBe(false);
    });

    it("should skip endpoint validation when --help is present", () => {
      const options = parseArgs(["--help"]);
      expect(options.help).toBe(true);
    });

    it("should reject missing required flags with Chinese messages", () => {
      expect(() => parseArgs(["--rpc", "https://rpc.dev"])).toThrow(/缺少必选参数 --proxy/);
      expect(() => parseArgs(["--proxy", "https://proxy.dev"])).toThrow(/缺少必选参数 --rpc/);
    });

    it("should reject non-http(s) and malformed URLs", () => {
      expect(() => parseArgs(["--proxy", "ftp://x.dev", "--rpc", "https://rpc.dev"])).toThrow(
        /http:\/\/ 或 https:\/\//
      );
      expect(() => parseArgs(["--proxy", "not-a-url", "--rpc", "https://rpc.dev"])).toThrow(
        /不是合法 URL/
      );
    });

    it("should reject invalid chain, iterations and scenario values", () => {
      expect(() => parseArgs([...base, "--chain", "abc"])).toThrow(/--chain 需要正整数/);
      expect(() => parseArgs([...base, "--chain", "0"])).toThrow(/--chain 需要正整数/);
      expect(() => parseArgs([...base, "--iterations", "0"])).toThrow(/--iterations/);
      expect(() => parseArgs([...base, "--iterations", "1001"])).toThrow(/--iterations/);
      expect(() => parseArgs([...base, "--scenario", "bogus"])).toThrow(/未知场景/);
    });

    it("should reject unknown flags and stray positionals", () => {
      expect(() => parseArgs([...base, "--wat"])).toThrow(/未知参数/);
      expect(() => parseArgs([...base, "https://stray.dev"])).toThrow(/未知参数/);
    });

    it("should reject flags without a value", () => {
      expect(() => parseArgs([...base, "--key"])).toThrow(/--key 需要一个值/);
    });
  });

  describe("buildUrl", () => {
    it("should tolerate trailing slashes and join segments", () => {
      expect(buildUrl("https://proxy.dev/", "api", "v1")).toBe("https://proxy.dev/api/v1");
      expect(buildUrl("https://proxy.dev///", "api")).toBe("https://proxy.dev/api");
      expect(buildUrl("https://proxy.dev")).toBe("https://proxy.dev");
    });
  });

  describe("percentile", () => {
    it("should use nearest-rank percentiles on an unsorted copy", () => {
      const values = [10, 1, 5, 3, 7, 9, 2, 8, 6, 4]; // 1..10 shuffled
      expect(percentile(values, 50)).toBe(5);
      expect(percentile(values, 95)).toBe(10);
      expect(percentile(values, 100)).toBe(10);
      expect(percentile(values, 0)).toBe(1);
      expect(values).toEqual([10, 1, 5, 3, 7, 9, 2, 8, 6, 4]); // unmutated
    });

    it("should handle single-element lists and return null when empty", () => {
      expect(percentile([42], 50)).toBe(42);
      expect(percentile([], 50)).toBeNull();
    });
  });

  describe("summarize", () => {
    it("should compute count/min/max/mean and nearest-rank percentiles", () => {
      const summary = summarize([100, 200, 300, 400]);
      expect(summary).toEqual({
        count: 4,
        min: 100,
        max: 400,
        mean: 250,
        p50: 200,
        p95: 400,
        p99: 400,
      });
    });

    it("should round to one decimal", () => {
      expect(summarize([1, 2]).mean).toBe(1.5);
      expect(summarize([1.234, 2.345]).p99).toBe(2.3);
    });

    it("should return null when there are no samples", () => {
      expect(summarize([])).toBeNull();
    });
  });

  describe("buildScenarioRequests", () => {
    const options = {
      proxy: "https://proxy.dev/",
      rpc: "https://rpc.dev",
      chain: 137,
      address: DEFAULT_ADDRESS,
    };

    it("should build the proxy action POST for each scenario", () => {
      for (const name of SCENARIOS) {
        const requests = buildScenarioRequests(options, name);
        expect(requests.proxy.url).toBe(`https://proxy.dev/api/v1/137/${name}`);
        expect(() => JSON.parse(requests.proxy.body)).not.toThrow();
      }
    });

    it("should pair each scenario with its direct JSON-RPC equivalent", () => {
      expect(JSON.parse(buildScenarioRequests(options, "getBalance").direct.body)).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [DEFAULT_ADDRESS, "latest"],
      });
      expect(JSON.parse(buildScenarioRequests(options, "getBlockNumber").direct.body)).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      });
      expect(JSON.parse(buildScenarioRequests(options, "readContract").direct.body)).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: DEFAULT_CONTRACT, data: NAME_CALLDATA }, "latest"],
      });
    });

    it("should send {address} / {} / {address,data} proxy bodies per scenario", () => {
      expect(JSON.parse(buildScenarioRequests(options, "getBalance").proxy.body)).toEqual({
        address: DEFAULT_ADDRESS,
      });
      expect(JSON.parse(buildScenarioRequests(options, "getBlockNumber").proxy.body)).toEqual({});
      expect(JSON.parse(buildScenarioRequests(options, "readContract").proxy.body)).toEqual({
        address: DEFAULT_CONTRACT,
        data: NAME_CALLDATA,
      });
    });

    it("should default readContract to the USDC mainnet contract", () => {
      const requests = buildScenarioRequests(options, "readContract");
      expect(JSON.parse(requests.proxy.body).address).toBe(DEFAULT_CONTRACT);
      expect(requests.note).toContain(DEFAULT_CONTRACT);
      expect(requests.note).toContain("name()");
    });

    it("should retarget readContract to --address when one is given", () => {
      const custom = { ...options, address: "0xabc", contract: "0xabc" };
      expect(JSON.parse(buildScenarioRequests(custom, "readContract").proxy.body)).toEqual({
        address: "0xabc",
        data: NAME_CALLDATA,
      });
      expect(JSON.parse(buildScenarioRequests(custom, "getBalance").proxy.body)).toEqual({
        address: "0xabc",
      });
    });

    it("should throw on unknown scenario names", () => {
      expect(() => buildScenarioRequests(options, "bogus")).toThrow(/未知场景/);
    });
  });

  describe("aggregateScenario", () => {
    /** 10 direct samples at 100ms, 10 proxy samples at 20ms, 9 HIT + 1 MISS. */
    const run = {
      name: "getBalance",
      iterations: 10,
      direct: { latencies: Array(10).fill(100), errors: [] },
      proxy: {
        latencies: Array(10).fill(20),
        cacheStatuses: ["MISS", ...Array(9).fill("HIT")],
        errors: [],
      },
      firstProxyLatencyMs: 210.4,
    };

    it("should compute hit rate and upstream-call savings", () => {
      const aggregated = aggregateScenario(run);
      expect(aggregated.proxy.cacheHits).toBe(9);
      expect(aggregated.proxy.cacheMisses).toBe(1);
      expect(aggregated.proxy.hitRate).toBe(90);
      expect(aggregated.savings).toEqual({
        directCalls: 10,
        proxyUpstreamCalls: 1,
        savedPercent: 90,
      });
    });

    it("should compute the P50 improvement from both summaries", () => {
      const aggregated = aggregateScenario(run);
      expect(aggregated.p50Improvement).toBe(80);
      expect(aggregated.subsequentMeanMs).toBe(20);
      expect(aggregated.firstProxyLatencyMs).toBe(210.4);
    });

    it("should ignore unknown cache statuses in the hit rate", () => {
      const aggregated = aggregateScenario({
        ...run,
        proxy: { ...run.proxy, cacheStatuses: ["HIT", "-", "MISS"] },
      });
      expect(aggregated.proxy.hitRate).toBe(50);
      expect(aggregated.proxy.cacheMisses).toBe(1);
    });

    it("should tolerate a fully failed path", () => {
      const aggregated = aggregateScenario({
        ...run,
        direct: { latencies: [], errors: ["HTTP 429"] },
      });
      expect(aggregated.direct.summary).toBeNull();
      expect(aggregated.direct.errorCount).toBe(1);
      expect(aggregated.p50Improvement).toBeNull();
    });

    it("should report zero savings when every proxy request misses", () => {
      const aggregated = aggregateScenario({
        ...run,
        proxy: { ...run.proxy, cacheStatuses: Array(10).fill("MISS") },
      });
      expect(aggregated.savings.savedPercent).toBe(0);
    });

    it("should report unknown savings when no X-Cache status is available", () => {
      const aggregated = aggregateScenario({
        ...run,
        proxy: { ...run.proxy, cacheStatuses: Array(10).fill("-") },
      });
      expect(aggregated.proxy.hitRate).toBeNull();
      expect(aggregated.savings).toEqual({
        directCalls: 10,
        proxyUpstreamCalls: null,
        savedPercent: null,
      });
    });
  });

  describe("formatReport", () => {
    const report = {
      options: {
        proxy: "https://proxy.dev",
        rpc: "https://rpc.dev",
        chain: 1,
        iterations: 10,
        scenarios: ["getBalance"],
        hasKey: true,
      },
      scenarios: [
        aggregateScenario({
          name: "getBalance",
          iterations: 10,
          direct: { latencies: Array(10).fill(100), errors: [] },
          proxy: {
            latencies: Array(10).fill(20),
            cacheStatuses: ["MISS", ...Array(9).fill("HIT")],
            errors: [],
          },
          firstProxyLatencyMs: 210.4,
        }),
      ],
    };

    it("should render a Chinese table with percentile rows and cache metrics", () => {
      const text = formatReport(report);
      expect(text).toContain("🏁 viem-proxy 性能基准");
      expect(text).toContain("代理 POST /api/v1/1/getBalance");
      expect(text).toContain("直连");
      expect(text).toContain("代理");
      expect(text).toContain("P50");
      expect(text).toContain("100.0ms");
      expect(text).toContain("20.0ms");
      expect(text).toContain("缓存命中: 9/10（90.0%");
      expect(text).toContain("首次响应（冷）: 210.4ms");
      expect(text).toContain("后续均值: 20.0ms");
      expect(text).toContain("直连 10 次 vs 代理 1 次");
      expect(text).toContain("80.0%");
    });

    it("should mark scenarios with a fully failed path", () => {
      const text = formatReport({
        ...report,
        scenarios: [
          aggregateScenario({
            name: "readContract",
            iterations: 3,
            direct: { latencies: [1, 2, 3], errors: [] },
            proxy: { latencies: [], cacheStatuses: [], errors: ["HTTP 401"] },
            firstProxyLatencyMs: null,
          }),
        ],
      });
      expect(text).toContain("⚠️ 存在全部失败的路径");
      expect(text).toContain("全部失败");
    });
  });

  describe("runBenchmark (injectable fetch)", () => {
    /**
     * Mock proxy + upstream pair. Proxy responses carry X-Cache (every
     * timed proxy call after the warmup hits), direct RPC responses are
     * plain JSON-RPC results. `now` advances deterministically so direct
     * calls take 100ms and proxy calls 20ms.
     */
    function createMockDeps(overrides = {}) {
      const calls = [];
      let clock = 0;
      const now = () => {
        clock += 1;
        return clock;
      };
      const fetchMock = vi.fn(async (url, init = {}) => {
        const { pathname } = new URL(String(url));
        const body = JSON.parse(init.body ?? "{}");
        calls.push({ url: String(url), body, headers: init.headers ?? {} });
        const headers = new Headers({
          "X-Trace-Id": "trace0001",
          "X-Cache": pathname.includes("/api/v1/") ? "HIT" : "",
        });
        // Each mock fetch consumes 5 ticks of `now` (≈ 5ms × scale below).
        for (let i = 0; i < 5; i++) now();
        const latencyScale = pathname.includes("/api/v1/") ? 4 : 20; // 20ms vs 100ms
        for (let i = 0; i < latencyScale; i++) now();
        const ok = overrides.fail?.(pathname) ?? true;
        return new Response(
          JSON.stringify(
            ok ? { result: "0x1", timestamp: 1 } : { error: { code: -32603, message: "boom" } }
          ),
          { status: ok ? 200 : 500, headers }
        );
      });
      return { fetch: fetchMock, now, calls };
    }

    const options = {
      proxy: "https://proxy.dev",
      rpc: "https://rpc.dev",
      chain: 1,
      key: "secret-key",
      iterations: 3,
      address: DEFAULT_ADDRESS,
      scenarios: ["getBlockNumber"],
    };

    it("should warm up both paths, then run iterations of direct→proxy pairs", async () => {
      const deps = createMockDeps();
      const result = await runBenchmark(options, { ...deps, log: () => {} });
      const requestOrder = deps.calls.map((call) =>
        call.url.includes("/api/v1/") ? "proxy" : "direct"
      );
      // Warmup pair, then 3 × (direct, proxy).
      expect(requestOrder).toEqual(["proxy", "direct", "direct", "proxy", "direct", "proxy", "direct", "proxy"]);
      expect(result.ok).toBe(true);
    });

    it("should send the API key on every request", async () => {
      const deps = createMockDeps();
      await runBenchmark(options, { ...deps, log: () => {} });
      expect(deps.calls.length).toBeGreaterThan(0);
      for (const call of deps.calls) {
        expect(call.headers["X-API-Key"]).toBe("secret-key");
      }
    });

    it("should count X-Cache hits, estimate savings and report improvement", async () => {
      const deps = createMockDeps();
      const result = await runBenchmark(options, { ...deps, log: () => {} });
      const scenario = result.scenarios[0];
      // Proxy warmup fires before any timed call, so every timed proxy
      // response is a HIT in the mock.
      expect(scenario.proxy.cacheHits).toBe(3);
      expect(scenario.proxy.cacheMisses).toBe(0);
      expect(scenario.proxy.hitRate).toBe(100);
      expect(scenario.savings).toEqual({
        directCalls: 3,
        proxyUpstreamCalls: 0,
        savedPercent: 100,
      });
      expect(scenario.direct.summary.count).toBe(3);
      expect(scenario.proxy.summary.count).toBe(3);
      expect(scenario.p50Improvement).toBeGreaterThan(0);
      // Latencies follow the mock's tick accounting (direct 25 ticks vs
      // proxy 9 ticks per call).
      expect(scenario.direct.summary.p50).toBeGreaterThan(scenario.proxy.summary.p50);
    });

    it("should record the warmup latency as the cold first response", async () => {
      const deps = createMockDeps();
      const result = await runBenchmark(options, { ...deps, log: () => {} });
      expect(result.scenarios[0].firstProxyLatencyMs).not.toBeNull();
      expect(result.scenarios[0].subsequentMeanMs).not.toBeNull();
    });

    it("should count failed timed requests without breaking the run", async () => {
      const deps = createMockDeps({ fail: () => false });
      const result = await runBenchmark(options, { ...deps, log: () => {} });
      const scenario = result.scenarios[0];
      expect(result.ok).toBe(false);
      // Warmup failures are untimed and not counted; only the 3 timed
      // requests per path appear in the failure statistics.
      expect(scenario.direct.errorCount).toBe(3);
      expect(scenario.proxy.errorCount).toBe(3);
      expect(scenario.direct.summary).toBeNull();
      expect(scenario.proxy.summary).toBeNull();
    });

    it("should fall back to the first successful timed proxy sample when warmup fails", async () => {
      const deps = createMockDeps();
      let firstProxy = true;
      const originalFetch = deps.fetch;
      deps.fetch = async (url, init) => {
        if (String(url).includes("/api/v1/") && firstProxy) {
          firstProxy = false;
          return new Response(JSON.stringify({ error: { code: -32603, message: "cold" } }), {
            status: 500,
          });
        }
        return originalFetch(url, init);
      };
      const result = await runBenchmark(options, { ...deps, log: () => {} });
      const scenario = result.scenarios[0];
      expect(result.ok).toBe(true);
      expect(scenario.firstProxyLatencyMs).not.toBeNull();
      expect(scenario.proxy.errorCount).toBe(0); // warmup is untimed: no timed failure
    });

    it("should produce a JSON-safe report without the API key", async () => {
      const deps = createMockDeps();
      const result = await runBenchmark(options, { ...deps, log: () => {} });
      const json = toJsonReport(options, result);
      const text = JSON.stringify(json);
      expect(text).not.toContain("secret-key");
      expect(json.options.hasKey).toBe(true);
      expect(json.ok).toBe(true);
      expect(json.scenarios[0].name).toBe("getBlockNumber");
    });
  });
});
