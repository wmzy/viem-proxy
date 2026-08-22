import { describe, it, expect, vi, afterEach } from "vitest";
import {
  makeProxyRequest,
  mergeProxyConfig,
  isProxyEnabled,
  DEFAULT_PROXY_CONFIG,
  classifyFallbackReason,
  RetryableError,
} from "../actions/utils";
import { createMetricsCollector, getSharedCollector, resetMetrics } from "../utils/metrics";

const originalFetch = global.fetch;

describe("Action Utils", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe("makeProxyRequest", () => {
    it("should use GET for short params", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1", timestamp: Date.now() }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, { endpoint: "https://proxy.example.com" });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe("GET");
      expect(url).toContain("?p=");
    });

    it("should use POST for very long params", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1", timestamp: Date.now() }),
      });
      global.fetch = mockFetch;

      const largeArgs: Record<string, unknown> = { data: "x".repeat(3000) };
      await makeProxyRequest("readContract", 1, largeArgs, { endpoint: "https://proxy.example.com" });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe("POST");
      expect(url).not.toContain("?p=");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(opts.body).toBeDefined();
    });

    it("should include X-API-Key header in GET when apiKey is set", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        apiKey: "secret",
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["X-API-Key"]).toBe("secret");
    });

    it("should include X-API-Key header in POST when apiKey is set", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      const largeArgs: Record<string, unknown> = { data: "x".repeat(3000) };
      await makeProxyRequest("readContract", 1, largeArgs, {
        endpoint: "https://proxy.example.com",
        apiKey: "secret",
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["X-API-Key"]).toBe("secret");
    });

    it("should not include X-API-Key header when apiKey is empty", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        apiKey: "",
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers?.["X-API-Key"]).toBeUndefined();
    });

    it("should throw on proxy error response", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ error: { message: "Not found", code: 404 } }),
      });
      global.fetch = mockFetch;

      await expect(
        makeProxyRequest("getBalance", 1, { address: "0x123" }, { endpoint: "https://proxy.example.com" })
      ).rejects.toThrow("Proxy error: Not found");
    });

    it("should log debug info when debug is enabled", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0xabc" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        debug: true,
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[viem-proxy\]\[trace:[0-9a-f]{12}\] getBalance request:$/),
        { address: "0x123" }
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[viem-proxy\]\[trace:[0-9a-f]{12}\] getBalance result:$/),
        "0xabc",
        expect.stringMatching(/^\(\d+ms\)$/)
      );
      logSpy.mockRestore();
    });

    it("should not log when debug is disabled", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0xabc" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        debug: false,
      });

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it("should use default timeout of 30000", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.signal).toBeDefined();
    });

    it("should retry on network error and succeed", async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) });
      global.fetch = mockFetch;

      const result = await makeProxyRequest<string>("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        retryOptions: { attempts: 3, delay: 1 },
      });

      expect(result).toBe("0x1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should apply exponential backoff between retries", async () => {
      vi.useFakeTimers();
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) });
      global.fetch = mockFetch;

      const promise = makeProxyRequest<string>("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        retryOptions: { attempts: 3, delay: 100 },
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(99);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // First backoff (100ms) elapsed -> second attempt, then second backoff (200ms) starts
      await vi.advanceTimersByTimeAsync(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(199);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second backoff (200ms = delay * 2^1) elapsed -> third attempt succeeds
      await vi.advanceTimersByTimeAsync(1);
      const result = await promise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toBe("0x1");
      vi.useRealTimers();
    });

    it("should throw after exhausting all retry attempts", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
      global.fetch = mockFetch;

      await expect(
        makeProxyRequest("getBalance", 1, { address: "0x123" }, {
          endpoint: "https://proxy.example.com",
          retryOptions: { attempts: 3, delay: 1 },
        })
      ).rejects.toThrow("network down");

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should retry on 5xx responses", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ status: 502, ok: false, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) });
      global.fetch = mockFetch;

      const result = await makeProxyRequest<string>("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        retryOptions: { attempts: 3, delay: 1 },
      });

      expect(result).toBe("0x1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should retry on 429 responses", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ status: 429, ok: false, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x2" }) });
      global.fetch = mockFetch;

      const result = await makeProxyRequest<string>("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        retryOptions: { attempts: 3, delay: 1 },
      });

      expect(result).toBe("0x2");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry on 4xx responses", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 400,
        ok: false,
        json: () => Promise.resolve({ error: { code: 400, message: "Bad request" } }),
      });
      global.fetch = mockFetch;

      await expect(
        makeProxyRequest("getBalance", 1, { address: "0x123" }, {
          endpoint: "https://proxy.example.com",
          retryOptions: { attempts: 3, delay: 1 },
        })
      ).rejects.toThrow("Proxy error: Bad request");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry on business error responses", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: { code: -32000, message: "execution reverted" } }),
      });
      global.fetch = mockFetch;

      await expect(
        makeProxyRequest("getBalance", 1, { address: "0x123" }, {
          endpoint: "https://proxy.example.com",
          retryOptions: { attempts: 3, delay: 1 },
        })
      ).rejects.toThrow("Proxy error: execution reverted");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should attach a short hex X-Trace-Id header on GET", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["X-Trace-Id"]).toMatch(/^[0-9a-f]{12}$/);
    });

    it("should attach a short hex X-Trace-Id header on POST", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("readContract", 1, { data: "x".repeat(3000) }, {
        endpoint: "https://proxy.example.com",
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["X-Trace-Id"]).toMatch(/^[0-9a-f]{12}$/);
    });

    it("should reuse the same trace id across retries", async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        retryOptions: { attempts: 3, delay: 1 },
      });

      const traceIds = mockFetch.mock.calls.map(([, opts]) => opts.headers["X-Trace-Id"]);
      expect(traceIds).toHaveLength(2);
      expect(traceIds[0]).toBe(traceIds[1]);
    });

    it("should log retry attempts with trace id when debug is enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce({ json: () => Promise.resolve({ result: "0x1" }) });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        debug: true,
        retryOptions: { attempts: 3, delay: 1 },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[viem-proxy\]\[trace:[0-9a-f]{12}\] getBalance retry 1 in 1ms:$/),
        "network down"
      );
      warnSpy.mockRestore();
    });

    it("should log error with trace id and duration when debug is enabled", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const mockFetch = vi.fn().mockRejectedValue(new Error("boom"));
      global.fetch = mockFetch;

      await expect(
        makeProxyRequest("getBalance", 1, { address: "0x123" }, {
          endpoint: "https://proxy.example.com",
          debug: true,
          retryOptions: { attempts: 2, delay: 1 },
        })
      ).rejects.toThrow("boom");

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[viem-proxy\]\[trace:[0-9a-f]{12}\] getBalance error:$/),
        expect.any(Error),
        expect.stringMatching(/^\(\d+ms\)$/)
      );
      logSpy.mockRestore();
    });

    it("should record cache hit metrics from X-Cache header", async () => {
      resetMetrics();
      const mockFetch = vi.fn().mockResolvedValueOnce({
        headers: new Headers({ "X-Cache": "HIT" }),
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
      });

      const snapshot = getSharedCollector().getSnapshot();
      expect(snapshot.totalRequests).toBe(1);
      expect(snapshot.errorCount).toBe(0);
      expect(snapshot.cacheHits).toBe(1);
      expect(snapshot.cacheMisses).toBe(0);
      expect(snapshot.cacheHitRate).toBe(1);
      expect(snapshot.methodStats.getBalance.count).toBe(1);
      expect(snapshot.strategyCounts.compressed).toBe(1);
      expect(snapshot.chainIds).toEqual([1]);
    });

    it("should record cache miss and unknown statuses separately", async () => {
      resetMetrics();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          headers: new Headers({ "X-Cache": "MISS" }),
          json: () => Promise.resolve({ result: "0x1" }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ result: "0x2" }),
        });
      global.fetch = mockFetch;
      const config = { endpoint: "https://proxy.example.com" };

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, config);
      // Second response has no X-Cache header -> recorded as unknown,
      // excluded from both hit and miss counters
      await makeProxyRequest("getBalance", 1, { address: "0x456" }, config);

      const snapshot = getSharedCollector().getSnapshot();
      expect(snapshot.totalRequests).toBe(2);
      expect(snapshot.cacheMisses).toBe(1);
      expect(snapshot.cacheHits).toBe(0);
      expect(snapshot.cacheHitRate).toBe(0);
      expect(snapshot.methodStats.getBalance.count).toBe(2);
    });

    it("should record failed requests with error metrics and POST strategy", async () => {
      resetMetrics();
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: { code: -32000, message: "execution reverted" } }),
      });
      global.fetch = mockFetch;

      await expect(
        makeProxyRequest("readContract", 137, { data: "x".repeat(3000) }, {
          endpoint: "https://proxy.example.com",
        })
      ).rejects.toThrow("Proxy error: execution reverted");

      const snapshot = getSharedCollector().getSnapshot();
      expect(snapshot.totalRequests).toBe(1);
      expect(snapshot.errorCount).toBe(1);
      expect(snapshot.errorRate).toBe(1);
      expect(snapshot.methodStats.readContract.errorCount).toBe(1);
      expect(snapshot.strategyCounts.direct).toBe(1);
      expect(snapshot.chainIds).toEqual([137]);
    });

    it("should warn about slow requests with trace id when debug is enabled", async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let resolveFetch!: (value: {
        headers: Headers;
        json: () => Promise<unknown>;
      }) => void;
      global.fetch = vi.fn(
        () =>
          new Promise<{ headers: Headers; json: () => Promise<unknown> }>(
            (resolve) => {
              resolveFetch = resolve;
            }
          )
      ) as unknown as typeof fetch;

      const request = makeProxyRequest<string>("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        debug: true,
      });

      await vi.advanceTimersByTimeAsync(1500);
      resolveFetch({
        headers: new Headers({ "X-Cache": "HIT" }),
        json: () => Promise.resolve({ result: "0x1" }),
      });
      await request;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[viem-proxy\]\[trace:[0-9a-f]{12}\] getBalance slow request: \d{4}ms$/
        )
      );
      warnSpy.mockRestore();
      vi.useRealTimers();
    });

    it("should not warn about fast requests when debug is enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValueOnce({
        headers: new Headers({ "X-Cache": "MISS" }),
        json: () => Promise.resolve({ result: "0x1" }),
      });
      global.fetch = mockFetch;

      await makeProxyRequest("getBalance", 1, { address: "0x123" }, {
        endpoint: "https://proxy.example.com",
        debug: true,
      });

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/slow request/)
      );
      warnSpy.mockRestore();
    });
  });

  describe("mergeProxyConfig", () => {
    it("should return defaults when no config provided", () => {
      const result = mergeProxyConfig();
      expect(result).toEqual(DEFAULT_PROXY_CONFIG);
    });

    it("should merge partial config with defaults", () => {
      const result = mergeProxyConfig({ endpoint: "https://custom.com", debug: true });
      expect(result.endpoint).toBe("https://custom.com");
      expect(result.debug).toBe(true);
      expect(result.timeout).toBe(30000);
      expect(result.fallback).toBe(true);
    });

    it("should override all defaults", () => {
      const result = mergeProxyConfig({
        endpoint: "https://custom.com",
        timeout: 5000,
        fallback: false,
        debug: true,
        apiKey: "key",
      });
      expect(result.endpoint).toBe("https://custom.com");
      expect(result.timeout).toBe(5000);
      expect(result.fallback).toBe(false);
      expect(result.debug).toBe(true);
      expect(result.apiKey).toBe("key");
    });

    it("should merge custom retryOptions with defaults", () => {
      const result = mergeProxyConfig({
        endpoint: "https://custom.com",
        retryOptions: { attempts: 5, delay: 100 },
      });
      expect(result.retryOptions).toEqual({ attempts: 5, delay: 100 });
    });
  });

  describe("isProxyEnabled", () => {
    it("should return false when config is undefined", () => {
      expect(isProxyEnabled()).toBe(false);
    });

    it("should return false when endpoint is empty", () => {
      expect(isProxyEnabled({ endpoint: "" })).toBe(false);
    });

    it("should return true when endpoint is set", () => {
      expect(isProxyEnabled({ endpoint: "https://proxy.example.com" })).toBe(true);
    });
  });

  describe("DEFAULT_PROXY_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_PROXY_CONFIG.endpoint).toBe("");
      expect(DEFAULT_PROXY_CONFIG.timeout).toBe(30000);
      expect(DEFAULT_PROXY_CONFIG.fallback).toBe(true);
      expect(DEFAULT_PROXY_CONFIG.debug).toBe(false);
      expect(DEFAULT_PROXY_CONFIG.apiKey).toBe("");
    });

    it("should have default retryOptions of 3 attempts and 500ms delay", () => {
      expect(DEFAULT_PROXY_CONFIG.retryOptions).toEqual({ attempts: 3, delay: 500 });
    });
  });

  describe("classifyFallbackReason", () => {
    it("should prefer the reason tag attached to RetryableError", () => {
      expect(classifyFallbackReason(new RetryableError("HTTP 502", { reason: "5xx" }))).toBe("5xx");
      expect(classifyFallbackReason(new RetryableError("HTTP 429", { reason: "429" }))).toBe("429");
      expect(classifyFallbackReason(new RetryableError("fetch failed", { reason: "network" }))).toBe("network");
      expect(classifyFallbackReason(new RetryableError("Signal timed out", { reason: "timeout" }))).toBe("timeout");
      // Tag wins over message heuristics
      const misleading = new RetryableError("timeout-ish wording", { reason: "abort" });
      expect(classifyFallbackReason(misleading)).toBe("abort");
    });

    it("should fall back to message heuristics for untagged errors", () => {
      expect(classifyFallbackReason(new Error("HTTP 503"))).toBe("5xx");
      expect(classifyFallbackReason(new Error("HTTP 429"))).toBe("429");
      expect(classifyFallbackReason(new Error("The operation was aborted"))).toBe("abort");
      expect(classifyFallbackReason(new Error("Signal timed out"))).toBe("timeout");
      expect(classifyFallbackReason(new Error("fetch failed"))).toBe("network");
      expect(classifyFallbackReason(new Error("getaddrinfo ENOTFOUND proxy.example.com"))).toBe("network");
    });

    it("should classify proxy business and middleware errors as other", () => {
      expect(classifyFallbackReason(new Error("Proxy error: execution reverted"))).toBe("other");
      expect(classifyFallbackReason(new Error("middleware rejected the request"))).toBe("other");
      expect(classifyFallbackReason("not even an error")).toBe("other");
    });
  });

  describe("MetricsCollector", () => {
    it("should return an all-zero snapshot when empty", () => {
      const snapshot = createMetricsCollector().getSnapshot();

      expect(snapshot).toEqual({
        totalRequests: 0,
        errorCount: 0,
        errorRate: 0,
        fallbackCount: 0,
        fallbackRate: 0,
        fallbackReasons: {},
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitRate: 0,
        averageResponseTime: 0,
        responseTimeP50: 0,
        responseTimeP95: 0,
        responseTimeP99: 0,
        chainIds: [],
        strategyCounts: { compressed: 0, direct: 0 },
        methodStats: {},
      });
    });

    it("should aggregate counts per method and globally", () => {
      const collector = createMetricsCollector();
      collector.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: true, responseTime: 10, cacheStatus: "hit" });
      collector.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: false, responseTime: 20, cacheStatus: "miss", error: "boom" });
      collector.record({ method: "getBlock", chainId: 137, strategy: "direct", success: true, responseTime: 30, cacheStatus: "unknown" });

      const snapshot = collector.getSnapshot();
      expect(snapshot.totalRequests).toBe(3);
      expect(snapshot.errorCount).toBe(1);
      expect(snapshot.errorRate).toBeCloseTo(1 / 3);
      expect(snapshot.cacheHits).toBe(1);
      expect(snapshot.cacheMisses).toBe(1);
      expect(snapshot.cacheHitRate).toBe(0.5);
      expect(snapshot.averageResponseTime).toBe(20);
      expect(snapshot.responseTimeP50).toBe(20);
      expect(snapshot.chainIds).toEqual([1, 137]);
      expect(snapshot.strategyCounts).toEqual({ compressed: 2, direct: 1 });

      expect(snapshot.methodStats.getBalance).toEqual({
        count: 2,
        errorCount: 1,
        errorRate: 0.5,
        fallbackCount: 0,
        cacheHits: 1,
        cacheMisses: 1,
        cacheHitRate: 0.5,
        averageResponseTime: 15,
        responseTimeP50: 10,
        responseTimeP95: 20,
        responseTimeP99: 20,
      });
      // Unknown cache status counts toward neither hits nor misses
      expect(snapshot.methodStats.getBlock.count).toBe(1);
      expect(snapshot.methodStats.getBlock.cacheHits).toBe(0);
      expect(snapshot.methodStats.getBlock.cacheMisses).toBe(0);
      expect(snapshot.methodStats.getBlock.cacheHitRate).toBe(0);
    });

    it("should record fallback events with per-reason and per-method counts", () => {
      const collector = createMetricsCollector();
      collector.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: false, responseTime: 10, cacheStatus: "unknown", error: "HTTP 502" });
      collector.recordFallback({ method: "getBalance", reason: "5xx" });
      collector.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: false, responseTime: 20, cacheStatus: "unknown", error: "fetch failed" });
      collector.recordFallback({ method: "getBalance", reason: "network" });
      collector.recordFallback({ method: "getBalance", reason: "network" });
      collector.record({ method: "getBlock", chainId: 1, strategy: "direct", success: true, responseTime: 30, cacheStatus: "hit" });

      const snapshot = collector.getSnapshot();
      expect(snapshot.totalRequests).toBe(3);
      expect(snapshot.fallbackCount).toBe(3);
      expect(snapshot.fallbackRate).toBe(1);
      expect(snapshot.fallbackReasons).toEqual({ "5xx": 1, network: 2 });
      expect(snapshot.methodStats.getBalance.fallbackCount).toBe(3);
      expect(snapshot.methodStats.getBlock.fallbackCount).toBe(0);
    });

    it("should compute fallbackRate as fallbackCount over totalRequests", () => {
      const collector = createMetricsCollector();
      for (let i = 0; i < 4; i++) {
        collector.record({ method: "getBlock", chainId: 1, strategy: "direct", success: true, responseTime: 5, cacheStatus: "miss" });
      }
      collector.recordFallback({ method: "getBlock", reason: "timeout" });

      const snapshot = collector.getSnapshot();
      expect(snapshot.fallbackRate).toBeCloseTo(1 / 4);
      expect(snapshot.fallbackReasons).toEqual({ timeout: 1 });
    });

    it("should report zero fallback metrics when no fallback occurred", () => {
      const collector = createMetricsCollector();
      collector.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: true, responseTime: 5, cacheStatus: "hit" });
      collector.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: false, responseTime: 8, cacheStatus: "unknown", error: "boom" });

      const snapshot = collector.getSnapshot();
      expect(snapshot.totalRequests).toBe(2);
      expect(snapshot.fallbackCount).toBe(0);
      expect(snapshot.fallbackRate).toBe(0);
      expect(snapshot.fallbackReasons).toEqual({});
    });

    it("should compute nearest-rank percentiles from fixed samples", () => {
      const collector = createMetricsCollector();
      // Response times 1..100
      for (let i = 1; i <= 100; i++) {
        collector.record({ method: "getBlock", chainId: 1, strategy: "direct", success: true, responseTime: i, cacheStatus: "miss" });
      }

      const snapshot = collector.getSnapshot();
      expect(snapshot.averageResponseTime).toBe(50.5);
      expect(snapshot.responseTimeP50).toBe(50);
      expect(snapshot.responseTimeP95).toBe(95);
      expect(snapshot.responseTimeP99).toBe(99);
      expect(snapshot.methodStats.getBlock.responseTimeP50).toBe(50);
      expect(snapshot.methodStats.getBlock.responseTimeP99).toBe(99);
    });

    it("should cap response-time samples at maxSamples (ring buffer)", () => {
      const collector = createMetricsCollector(3);
      for (let i = 1; i <= 5; i++) {
        collector.record({ method: "getBlock", chainId: 1, strategy: "direct", success: true, responseTime: i, cacheStatus: "miss" });
      }

      const snapshot = collector.getSnapshot();
      // Count keeps the full history; statistics use only the last 3 samples (3, 4, 5)
      expect(snapshot.totalRequests).toBe(5);
      expect(snapshot.averageResponseTime).toBe(4);
      expect(snapshot.responseTimeP50).toBe(4);
      expect(snapshot.responseTimeP95).toBe(5);
      expect(snapshot.responseTimeP99).toBe(5);
    });

    it("should keep only the most recent 200 samples by default", () => {
      const collector = createMetricsCollector();
      for (let i = 1; i <= 250; i++) {
        collector.record({ method: "getBlock", chainId: 1, strategy: "direct", success: true, responseTime: i, cacheStatus: "miss" });
      }

      const snapshot = collector.getSnapshot();
      // Ring keeps durations 51..250
      expect(snapshot.totalRequests).toBe(250);
      expect(snapshot.averageResponseTime).toBe(150.5);
      expect(snapshot.responseTimeP50).toBe(150);
      expect(snapshot.responseTimeP95).toBe(240);
      expect(snapshot.responseTimeP99).toBe(248);
    });

    it("should drop all recorded metrics on reset", () => {
      const collector = createMetricsCollector();
      collector.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: true, responseTime: 5, cacheStatus: "hit" });
      expect(collector.getSnapshot().totalRequests).toBe(1);

      collector.reset();

      const snapshot = collector.getSnapshot();
      expect(snapshot.totalRequests).toBe(0);
      expect(snapshot.methodStats).toEqual({});
      expect(snapshot.strategyCounts).toEqual({ compressed: 0, direct: 0 });
    });

    it("should drop fallback counters on reset", () => {
      const collector = createMetricsCollector();
      collector.recordFallback({ method: "getBalance", reason: "network" });
      collector.recordFallback({ method: "getBalance", reason: "429" });
      expect(collector.getSnapshot().fallbackCount).toBe(2);

      collector.reset();

      const snapshot = collector.getSnapshot();
      expect(snapshot.fallbackCount).toBe(0);
      expect(snapshot.fallbackRate).toBe(0);
      expect(snapshot.fallbackReasons).toEqual({});
      expect(snapshot.methodStats.getBalance).toBeUndefined();
    });

    it("should share one module-level collector and reset it via resetMetrics", () => {
      resetMetrics();
      const first = getSharedCollector();
      expect(getSharedCollector()).toBe(first);

      first.record({ method: "getBalance", chainId: 1, strategy: "compressed", success: true, responseTime: 5, cacheStatus: "hit" });
      expect(getSharedCollector().getSnapshot().totalRequests).toBe(1);

      resetMetrics();
      expect(getSharedCollector()).toBe(first);
      expect(getSharedCollector().getSnapshot().totalRequests).toBe(0);
    });
  });
});
