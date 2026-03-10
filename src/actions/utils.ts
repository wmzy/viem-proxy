import type {
  ProxyActionConfig,
  ProxyResponse,
  ProxyErrorResponse,
} from "./types";
import { compressParams } from "../utils/compression";

export const DEFAULT_PROXY_CONFIG: Required<ProxyActionConfig> = {
  endpoint: "",
  timeout: 30000,
  fallback: true,
  debug: false,
  apiKey: "",
};

export const makeProxyRequest = async <T>(
  functionName: string,
  chainId: number,
  args: Record<string, unknown>,
  config: ProxyActionConfig
): Promise<T> => {
  const { endpoint, timeout = 30000, debug = false, apiKey } = config;

  if (debug) {
    console.log(`[viem-proxy] ${functionName}:`, args);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const argsJson = JSON.stringify(args);
  const compressed = compressParams(argsJson);
  const getUrl = `${endpoint}/api/v1/${chainId}/${functionName}?p=${compressed.compressed}`;

  const useGet = getUrl.length <= 2048;

  const response = useGet
    ? await fetch(getUrl, {
        method: "GET",
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
        signal: AbortSignal.timeout(timeout),
      })
    : await fetch(`${endpoint}/api/v1/${chainId}/${functionName}`, {
        method: "POST",
        headers,
        body: argsJson,
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

export const mergeProxyConfig = (
  config?: Partial<ProxyActionConfig>
): ProxyActionConfig => ({
  ...DEFAULT_PROXY_CONFIG,
  ...config,
});

export const isProxyEnabled = (config?: ProxyActionConfig): boolean => {
  return !!config?.endpoint;
};
