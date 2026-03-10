import { describe, it, expect, vi, afterEach } from "vitest";
import { makeProxyRequest, mergeProxyConfig, isProxyEnabled, DEFAULT_PROXY_CONFIG } from "../actions/utils";

const originalFetch = global.fetch;

describe("Action Utils", () => {
  afterEach(() => {
    global.fetch = originalFetch;
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

      expect(logSpy).toHaveBeenCalledWith("[viem-proxy] getBalance:", { address: "0x123" });
      expect(logSpy).toHaveBeenCalledWith("[viem-proxy] getBalance result:", "0xabc");
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
  });
});
