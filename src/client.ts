import {
  type Chain,
  type PublicClientConfig,
  type Transport,
  type PublicClient,
  createPublicClient as createViemPublicClient,
  http as viemHttp,
} from "viem";
import type { ProxyPublicClient, ProxyConfig } from "./types";
import {
  createProxyGetBalance,
  createProxyGetBlock,
  createProxyGetBlockNumber,
  createProxyGetTransaction,
  createProxyGetTransactionReceipt,
  createProxyCall,
  createProxyReadContract,
  createProxyEstimateGas,
  createProxyGetGasPrice,
  createProxyGetLogs,
  createProxyGetCode,
} from "./proxy-actions";

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: true,
  endpoint: "",
  timeout: 30000,
  fallback: true,
  debug: false,
};

type CreatePublicClientConfig<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = undefined
> = Omit<PublicClientConfig<TTransport, TChain>, "transport"> & {
  transport?: TTransport;
  proxy?: Partial<ProxyConfig>;
};

/**
 * Create a proxy-enabled public client
 */
export const createPublicClient = <
  TChain extends Chain | undefined = undefined,
  TTransport extends Transport = Transport
>(
  config: CreatePublicClientConfig<TTransport, TChain>
): ProxyPublicClient<TTransport, TChain> => {
  const { proxy: proxyConfig, ...clientConfig } = config;

  // Merge proxy config with defaults
  const finalProxyConfig: ProxyConfig = {
    ...DEFAULT_PROXY_CONFIG,
    ...proxyConfig,
  };

  // Create base viem client
  // If no transport provided, use default http transport
  const transport = clientConfig.transport ?? viemHttp();
  const baseClient = createViemPublicClient({
    ...clientConfig,
    transport,
  }) as PublicClient;

  // Create proxy client by extending base client
  const proxyClient = baseClient as ProxyPublicClient<TTransport, TChain>;

  // Store proxy config
  proxyClient.proxy = finalProxyConfig;

  // Add helper methods regardless of proxy state
  proxyClient.getCacheStats = async () => {
    return {
      hitRate: 0,
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  };

  proxyClient.clearCache = async () => {
    if (proxyClient.proxy?.debug) {
      console.log("[viem-proxy] Cache cleared");
    }
  };

  proxyClient.preheatCache = async (requests) => {
    if (proxyClient.proxy?.debug) {
      console.log(
        "[viem-proxy] Preheating cache for",
        requests.length,
        "requests"
      );
    }
    return requests.map((req) => ({
      jsonrpc: "2.0" as const,
      id: req.id,
      result: null,
      error: null,
    }));
  };

  proxyClient.getMetrics = async () => {
    return {
      totalRequests: 0,
      cacheHitRate: 0,
      averageResponseTime: 0,
      errorRate: 0,
      strategyCounts: {
        compressed: 0,
        "hash-reference": 0,
        direct: 0,
      },
      methodStats: {},
    };
  };

  proxyClient.clearMetrics = async () => {
    if (proxyClient.proxy?.debug) {
      console.log("[viem-proxy] Metrics cleared");
    }
    return true;
  };

  // If proxy is disabled or no endpoint, return client without proxied actions
  if (!finalProxyConfig.enabled || !finalProxyConfig.endpoint) {
    return proxyClient;
  }

  // Override P0 actions (high priority) - use type assertions to avoid complex type issues
  (proxyClient as any).getBalance = createProxyGetBalance(baseClient, finalProxyConfig);
  (proxyClient as any).getBlock = createProxyGetBlock(baseClient, finalProxyConfig);
  (proxyClient as any).getBlockNumber = createProxyGetBlockNumber(baseClient, finalProxyConfig);
  (proxyClient as any).getTransaction = createProxyGetTransaction(baseClient, finalProxyConfig);
  (proxyClient as any).getTransactionReceipt = createProxyGetTransactionReceipt(baseClient, finalProxyConfig);
  (proxyClient as any).readContract = createProxyReadContract(baseClient, finalProxyConfig);

  // Override P1 actions (medium priority)
  (proxyClient as any).call = createProxyCall(baseClient, finalProxyConfig);
  (proxyClient as any).estimateGas = createProxyEstimateGas(baseClient, finalProxyConfig);
  (proxyClient as any).getGasPrice = createProxyGetGasPrice(baseClient, finalProxyConfig);
  (proxyClient as any).getLogs = createProxyGetLogs(baseClient, finalProxyConfig);
  (proxyClient as any).getCode = createProxyGetCode(baseClient, finalProxyConfig);

  return proxyClient;
};
