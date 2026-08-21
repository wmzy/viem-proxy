import type { CompressionResult } from "../types";

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

const ENCODING_PREFIX_B64 = "b:";
const ENCODING_PREFIX_URL = "u:";

export const compressParams = (params: string): CompressionResult => {
  const originalSize = params.length;
  let compressed = params;

  try {
    JSON.parse(params);

    compressed = compressFunctionSelectors(compressed);
    compressed = compressZeroPadding(compressed);

    const base64Compressed = ENCODING_PREFIX_B64 +
      btoa(compressed)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

    const urlEncoded = ENCODING_PREFIX_URL + encodeURIComponent(compressed);

    compressed = base64Compressed.length <= urlEncoded.length
      ? base64Compressed
      : urlEncoded;
  } catch {
    compressed = ENCODING_PREFIX_URL + encodeURIComponent(params);
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

const compressFunctionSelectors = (data: string): string => {
  let result = data;
  for (const [selector, name] of Object.entries(FUNCTION_SELECTORS)) {
    const regex = new RegExp(`"${selector}"`, "g");
    result = result.replace(regex, `"${name}"`);
  }
  return result;
};

const compressZeroPadding = (data: string): string => {
  return data.replace(/0{8,}/g, (match) => `{${match.length}z}`);
};
