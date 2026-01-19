import type { CompressionResult } from "../types";

// 常见函数选择器字典
const FUNCTION_SELECTORS: Record<string, string> = {
  "0x70a08231": "balanceOf",
  "0xa9059cbb": "transfer",
  "0x23b872dd": "transferFrom",
  "0x095ea7b3": "approve",
  "0xdd62ed3e": "allowance",
  "0x18160ddd": "totalSupply",
  "0x06fdde03": "name",
  "0x95d89b41": "symbol",
  "0x313ce567": "decimals",
  "0xa0712d68": "mint",
  "0x42966c68": "burn",
  "0x8da5cb5b": "owner",
  "0xf2fde38b": "transferOwnership",
};

// 反向映射
const SELECTOR_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(FUNCTION_SELECTORS).map(([k, v]) => [v, k])
);

/**
 * 压缩 JSON-RPC 参数为 URL 友好格式
 */
export const compressParams = (params: string): CompressionResult => {
  const originalSize = params.length;
  let compressed = params;

  try {
    const parsed = JSON.parse(params);

    // 1. 压缩函数选择器
    compressed = compressFunctionSelectors(compressed);

    // 2. 压缩地址（移除前导零，但保持校验和）
    compressed = compressAddresses(compressed);

    // 3. 压缩重复的零填充
    compressed = compressZeroPadding(compressed);

    // 4. 只有在压缩后确实更小时才进行 Base64 编码
    const preBase64Size = compressed.length;
    const base64Compressed = btoa(compressed)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    // 如果 Base64 编码后反而更大，就使用 URL 编码
    if (base64Compressed.length < preBase64Size) {
      compressed = base64Compressed;
    } else {
      // 使用 URL 编码作为备选方案
      compressed = encodeURIComponent(compressed);
    }
  } catch (error) {
    // 如果解析失败，使用 URL 编码
    compressed = encodeURIComponent(params);
  }

  const compressedSize = compressed.length;
  const ratio = originalSize > 0 ? compressedSize / originalSize : 1;

  return {
    compressed,
    originalSize,
    compressedSize,
    ratio,
  };
};

/**
 * 解压缩参数
 */
export const decompressParams = (compressed: string): string => {
  try {
    let decompressed: string;

    // 尝试 Base64 解码
    if (isBase64Encoded(compressed)) {
      // 1. 恢复 Base64 填充
      let padded = compressed.replace(/-/g, "+").replace(/_/g, "/");

      while (padded.length % 4) {
        padded += "=";
      }

      // 2. Base64 解码
      decompressed = atob(padded);
    } else {
      // 使用 URL 解码
      decompressed = decodeURIComponent(compressed);
    }

    // 3. 恢复函数选择器
    decompressed = decompressFunctionSelectors(decompressed);

    // 4. 恢复地址格式
    decompressed = decompressAddresses(decompressed);

    // 5. 恢复零填充
    decompressed = decompressZeroPadding(decompressed);

    return decompressed;
  } catch (error) {
    // 如果 Base64 解码失败，尝试 URL 解码
    try {
      let decompressed = decodeURIComponent(compressed);
      decompressed = decompressFunctionSelectors(decompressed);
      decompressed = decompressAddresses(decompressed);
      decompressed = decompressZeroPadding(decompressed);
      return decompressed;
    } catch (urlError) {
      throw new Error(`Failed to decompress params: ${error}`);
    }
  }
};

/**
 * 压缩函数选择器
 */
const compressFunctionSelectors = (data: string): string => {
  let result = data;

  for (const [selector, name] of Object.entries(FUNCTION_SELECTORS)) {
    const regex = new RegExp(`"${selector}"`, "g");
    result = result.replace(regex, `"${name}"`);
  }

  return result;
};

/**
 * 恢复函数选择器
 */
const decompressFunctionSelectors = (data: string): string => {
  let result = data;

  for (const [name, selector] of Object.entries(SELECTOR_REVERSE)) {
    const regex = new RegExp(`"${name}"`, "g");
    result = result.replace(regex, `"${selector}"`);
  }

  return result;
};

/**
 * 压缩以太坊地址（移除不必要的前导零，但保持有效性）
 */
const compressAddresses = (data: string): string => {
  // 匹配以太坊地址模式 0x + 40个十六进制字符
  const addressRegex = /"0x[0-9a-fA-F]{40}"/g;

  return data.replace(addressRegex, (match) => {
    const address = match.slice(1, -1); // 移除引号
    // 保持地址完整性，只是标记为地址类型
    return `"${address}"`;
  });
};

/**
 * 恢复地址格式
 */
const decompressAddresses = (data: string): string => {
  // 这里主要是确保地址格式正确
  return data;
};

/**
 * 压缩重复的零填充
 */
const compressZeroPadding = (data: string): string => {
  // 压缩连续的零（但要小心不要破坏有效数据）
  return data.replace(/0{8,}/g, (match) => {
    return `{${match.length}z}`; // 用 {长度z} 表示连续的零
  });
};

/**
 * 恢复零填充
 */
const decompressZeroPadding = (data: string): string => {
  return data.replace(/\{(\d+)z\}/g, (match, length) => {
    return "0".repeat(parseInt(length, 10));
  });
};

/**
 * 生成参数哈希
 */
export const generateParamHash = async (params: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(params);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * 检查是否应该使用压缩
 */
export const shouldCompress = (params: string, threshold = 1500): boolean => {
  return params.length >= threshold;
};

/**
 * 检查是否应该使用哈希引用
 */
export const shouldUseHashReference = (
  params: string,
  threshold = 1500
): boolean => {
  const compressed = compressParams(params);
  return compressed.compressedSize >= threshold;
};

/**
 * 检查字符串是否为 Base64 编码
 */
const isBase64Encoded = (str: string): boolean => {
  // Base64 字符集：A-Z, a-z, 0-9, -, _（URL 安全版本）
  const base64Regex = /^[A-Za-z0-9_-]*$/;
  return base64Regex.test(str) && str.length % 4 === 0;
};
