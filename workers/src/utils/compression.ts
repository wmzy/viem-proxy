// 与客户端相同的压缩工具，但适配 Workers 环境

// 常见函数选择器字典
const FUNCTION_SELECTORS: Record<string, string> = {
  balanceOf: "0x70a08231",
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
  approve: "0x095ea7b3",
  allowance: "0xdd62ed3e",
  totalSupply: "0x18160ddd",
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  mint: "0xa0712d68",
  burn: "0x42966c68",
  owner: "0x8da5cb5b",
  transferOwnership: "0xf2fde38b",
};

/**
 * 解压缩参数（Workers 端）
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

    // 4. 恢复零填充
    decompressed = decompressZeroPadding(decompressed);

    return decompressed;
  } catch (error) {
    // 如果 Base64 解码失败，尝试 URL 解码
    try {
      let decompressed = decodeURIComponent(compressed);
      decompressed = decompressFunctionSelectors(decompressed);
      decompressed = decompressZeroPadding(decompressed);
      return decompressed;
    } catch (urlError) {
      throw new Error(`Failed to decompress params: ${error}`);
    }
  }
};

/**
 * 恢复函数选择器
 */
const decompressFunctionSelectors = (data: string): string => {
  let result = data;

  for (const [name, selector] of Object.entries(FUNCTION_SELECTORS)) {
    const regex = new RegExp(`"${name}"`, "g");
    result = result.replace(regex, `"${selector}"`);
  }

  return result;
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
 * 检查字符串是否为 Base64 编码
 */
const isBase64Encoded = (str: string): boolean => {
  // Base64 字符集：A-Z, a-z, 0-9, -, _（URL 安全版本）
  const base64Regex = /^[A-Za-z0-9_-]*$/;
  return base64Regex.test(str) && str.length % 4 === 0;
};
