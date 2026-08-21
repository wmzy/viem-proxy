import { describe, it, expect, vi } from "vitest";
import { compressParams } from "../utils/compression";

describe("Compression Utils", () => {
  describe("compressParams", () => {
    it("should compress simple parameters", () => {
      const params = '["0x742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8", "latest"]';
      const result = compressParams(params);

      expect(result.compressed).toBeDefined();
      expect(result.originalSize).toBe(params.length);
      // Small parameters may grow after compression, which is expected
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThan(0);
    });

    it("should handle function selectors", () => {
      const params =
        '["0x70a08231000000000000000000000000742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8"]';
      const result = compressParams(params);

      expect(result.compressed).toBeDefined();
      // Selector compression replaces the raw selector with its name,
      // shrinking the encoded output below the original size
      expect(result.compressedSize).toBeLessThan(params.length);
    });

    it("should compress zero padding", () => {
      const params =
        '["0x00000000000000000000000000000000000000000000000000000000000000001"]';
      const result = compressParams(params);

      expect(result.compressed).toBeDefined();
      // Zero-run compression collapses long zero runs into a {Nz} marker
      // (base64-encoded in the final output), shrinking the result
      expect(result.compressedSize).toBeLessThan(params.length);
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle invalid JSON in compressParams gracefully", () => {
      const invalidJson = "invalid json";
      const result = compressParams(invalidJson);

      expect(result.compressed).toBeDefined();
      expect(result.originalSize).toBe(invalidJson.length);
      expect(result.compressedSize).toBeGreaterThan(0);
    });

    it("should handle Base64 encoding when it increases size", () => {
      // Create a string that won't benefit from Base64
      const simpleParams = 'simple-123-abc_params';
      const result = compressParams(simpleParams);

      expect(result.compressed).toBeDefined();
      expect(result.compressedSize).toBeGreaterThan(0);
    });

    it("should handle empty parameters", () => {
      const emptyParams = "";
      const result = compressParams(emptyParams);

      expect(result.compressed).toBeDefined();
      expect(result.originalSize).toBe(0);
      expect(result.compressedSize).toBeGreaterThanOrEqual(0);
    });

    it("should handle Base64 encode errors gracefully", () => {
      // Mock btoa to throw error
      const originalBtoa = global.btoa;
      const mockBtoa = vi.fn().mockImplementation(() => {
        throw new Error("Base64 encoding error");
      });
      Object.defineProperty(global, 'btoa', { value: mockBtoa, writable: true });

      const params = 'test params';

      // Should use URL encoding as fallback
      const result = compressParams(params);
      expect(result.compressed).toBeDefined();
      expect(result.ratio).toBeGreaterThan(0);

      Object.defineProperty(global, 'btoa', { value: originalBtoa, writable: true });
    });
  });
});
