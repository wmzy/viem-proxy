import { describe, it, expect, vi } from "vitest";
import {
  compressParams,
  decompressParams,
  generateParamHash,
  shouldCompress,
  shouldUseHashReference,
} from "../utils/compression";

describe("Compression Utils", () => {
  describe("compressParams", () => {
    it("should compress simple parameters", () => {
      const params = '["0x742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8", "latest"]';
      const result = compressParams(params);

      expect(result.compressed).toBeDefined();
      expect(result.originalSize).toBe(params.length);
      // 对于小参数，压缩后可能会更大，这是正常的
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThan(0);
    });

    it("should handle function selectors", () => {
      const params =
        '["0x70a08231000000000000000000000000742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8"]';
      const result = compressParams(params);

      expect(result.compressed).toBeDefined();
      // 验证可以正确解压缩
      const decompressed = decompressParams(result.compressed);
      expect(decompressed).toBe(params);
    });

    it("should compress zero padding", () => {
      const params =
        '["0x00000000000000000000000000000000000000000000000000000000000000001"]';
      const result = compressParams(params);

      expect(result.compressed).toBeDefined();
      // 验证可以正确解压缩
      const decompressed = decompressParams(result.compressed);
      expect(decompressed).toBe(params);
    });
  });

  describe("decompressParams", () => {
    it("should decompress parameters correctly", () => {
      const original =
        '["0x742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8", "latest"]';
      const compressed = compressParams(original);
      const decompressed = decompressParams(compressed.compressed);

      expect(decompressed).toBe(original);
    });

    it("should handle function selectors in decompression", () => {
      const original =
        '["0x70a08231000000000000000000000000742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8"]';
      const compressed = compressParams(original);
      const decompressed = decompressParams(compressed.compressed);

      expect(decompressed).toBe(original);
    });

    it("should handle zero padding in decompression", () => {
      const original =
        '["0x00000000000000000000000000000000000000000000000000000000000000001"]';
      const compressed = compressParams(original);
      const decompressed = decompressParams(compressed.compressed);

      expect(decompressed).toBe(original);
    });
  });

  describe("generateParamHash", () => {
    it("should generate consistent hashes", async () => {
      const params = '["0x742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8", "latest"]';
      const hash1 = await generateParamHash(params);
      const hash2 = await generateParamHash(params);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string
    });

    it("should generate different hashes for different params", async () => {
      const params1 =
        '["0x742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8", "latest"]';
      const params2 =
        '["0x742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8", "pending"]';

      const hash1 = await generateParamHash(params1);
      const hash2 = await generateParamHash(params2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("shouldCompress", () => {
    it("should return false for small parameters", () => {
      const smallParams = '["0x123", "latest"]';
      expect(shouldCompress(smallParams)).toBe(false);
    });

    it("should return true for large parameters", () => {
      const largeParams = "x".repeat(2000);
      expect(shouldCompress(largeParams)).toBe(true);
    });

    it("should respect custom threshold", () => {
      const params = "x".repeat(100);
      expect(shouldCompress(params, 50)).toBe(true);
      expect(shouldCompress(params, 200)).toBe(false);
    });
  });

  describe("shouldUseHashReference", () => {
    it("should return false for small parameters", () => {
      const smallParams = '["0x123", "latest"]';
      expect(shouldUseHashReference(smallParams)).toBe(false);
    });

    it("should return true for very large parameters", () => {
      const largeParams = "x".repeat(3000);
      expect(shouldUseHashReference(largeParams)).toBe(true);
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
      
      // Decompression should work
      const decompressed = decompressParams(result.compressed);
      expect(decompressed).toBe(simpleParams);
    });

    it("should handle empty parameters", () => {
      const emptyParams = "";
      const result = compressParams(emptyParams);
      
      expect(result.compressed).toBeDefined();
      expect(result.originalSize).toBe(0);
      expect(result.compressedSize).toBeGreaterThanOrEqual(0);
    });

    it("should handle decompression Base64 decode failure gracefully", () => {
      const compressed = "SGVsbG8+V29ybGQ_YWJj"; // Invalid Base64
      
      // Should try URL decode as fallback
      const decoded = decompressParams(compressed);
      expect(decoded).toBeDefined();
    });

    it("should handle Base64 without proper padding", () => {
      const original = '["0x123", "latest"]';
      const compressed = compressParams(original);
      
      // Manually remove padding to test padding restoration
      let compressedStr = compressed.compressed;
      if (compressedStr.endsWith('=') || compressedStr.endsWith('-') || compressedStr.endsWith('_')) {
        compressedStr = compressedStr.replace(/-=|=|-$|_$/g, '');
      }
      
      const decompressed = decompressParams(compressedStr);
      expect(decompressed).toBe(original);
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

    it("should handle legacy strings without prefix via fallback", () => {
      const legacyStr = "some-legacy-string";
      const decoded = decompressParams(legacyStr);
      expect(decoded).toBeDefined();
    });
  });

  describe("round-trip compression", () => {
    const testCases = [
      '["0x742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8", "latest"]',
      '["0x70a08231000000000000000000000000742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8"]',
      '["0x00000000000000000000000000000000000000000000000000000000000000001"]',
      "[]",
      '["0x123"]',
      JSON.stringify([
        "0xa9059cbb",
        "000000000000000000000000742d35cc6634c0532925a3b8d8b4c8b8b8b8b8b8",
        "0000000000000000000000000000000000000000000000000de0b6b3a7640000",
      ]),
    ];

    testCases.forEach((testCase, index) => {
      it(`should handle round-trip compression for case ${index + 1}`, () => {
        const compressed = compressParams(testCase);
        const decompressed = decompressParams(compressed.compressed);
        expect(decompressed).toBe(testCase);
      });
    });
  });
});
