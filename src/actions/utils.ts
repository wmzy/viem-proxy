import type {
  ProxyActionConfig,
  ProxyResponse,
  ProxyErrorResponse,
} from "./types";

/**
 * Default proxy configuration
 */
export const DEFAULT_PROXY_CONFIG: Required<ProxyActionConfig> = {
  endpoint: "",
  timeout: 30000,
  fallback: true,
  debug: false,
};

/**
 * Make a proxy request to the server
 */
export const makeProxyRequest = async <T>(
  functionName: string,
  chainId: number,
  args: Record<string, unknown>,
  config: ProxyActionConfig
): Promise<T> => {
  const { endpoint, timeout = 30000, debug = false } = config;
  const url = `${endpoint}/api/v1/${chainId}/${functionName}`;

  if (debug) {
    console.log(`[viem-proxy] ${functionName}:`, args);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeout),
  });

  const data = (await response.json()) as
    | ProxyResponse<T>
    | ProxyErrorResponse;

  if ("error" in data) {
    throw new Error(`Proxy error: ${data.error.message}`);
  }

  if (debug) {
    console.log(`[viem-proxy] ${functionName} result:`, data.result);
  }

  return data.result;
};

/**
 * Merge proxy config with defaults
 */
export const mergeProxyConfig = (
  config?: Partial<ProxyActionConfig>
): ProxyActionConfig => ({
  ...DEFAULT_PROXY_CONFIG,
  ...config,
});

/**
 * Check if proxy is enabled
 */
export const isProxyEnabled = (config?: ProxyActionConfig): boolean => {
  return !!config?.endpoint;
};
