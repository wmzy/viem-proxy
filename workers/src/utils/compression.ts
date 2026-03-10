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

const ENCODING_PREFIX_B64 = "b:";
const ENCODING_PREFIX_URL = "u:";

export const decompressParams = (compressed: string): string => {
  let decompressed: string;

  if (compressed.startsWith(ENCODING_PREFIX_B64)) {
    const raw = compressed.slice(ENCODING_PREFIX_B64.length);
    let padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) {
      padded += "=";
    }
    decompressed = atob(padded);
  } else if (compressed.startsWith(ENCODING_PREFIX_URL)) {
    decompressed = decodeURIComponent(compressed.slice(ENCODING_PREFIX_URL.length));
  } else {
    decompressed = tryLegacyDecode(compressed);
  }

  decompressed = decompressFunctionSelectors(decompressed);
  decompressed = decompressZeroPadding(decompressed);

  return decompressed;
};

const tryLegacyDecode = (str: string): string => {
  try {
    let padded = str.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) {
      padded += "=";
    }
    return atob(padded);
  } catch {
    try {
      return decodeURIComponent(str);
    } catch {
      return str;
    }
  }
};

const decompressFunctionSelectors = (data: string): string => {
  let result = data;
  for (const [name, selector] of Object.entries(FUNCTION_SELECTORS)) {
    const regex = new RegExp(`"${name}"`, "g");
    result = result.replace(regex, `"${selector}"`);
  }
  return result;
};

const decompressZeroPadding = (data: string): string => {
  return data.replace(/\{(\d+)z\}/g, (_match, length) => {
    return "0".repeat(parseInt(length, 10));
  });
};

export const generateParamHash = async (params: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(params);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};
