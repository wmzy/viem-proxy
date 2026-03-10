import {
  type Chain,
  type PublicClientConfig,
  type Transport,
  type PublicClient,
  createPublicClient as createViemPublicClient,
  http as viemHttp,
} from "viem";
import type { ProxyPublicClient, ProxyConfig, RpcRequest, RpcResponse, PerformanceMetrics } from "./types";
import { proxyActions } from "./actions/proxyActions";
import { withProxy } from "./proxy";

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
 *
 * @example
 * const client = createPublicClient({
 *   chain: mainnet,
 *   proxy: {
 *     endpoint: 'https://proxy.example.com',
 *     fallback: true,
 *   }
 * })
 *
 * @example
 * // Using extend pattern (recommended for tree-shaking)
 * import { createPublicClient, http } from 'viem'
 * import { withProxy } from 'viem-proxy'
 * import { proxyActions } from 'viem-proxy/actions'
 *
 * const client = withProxy(
 *   createPublicClient({ chain: mainnet, transport: http() }),
 *   { endpoint: 'https://proxy.example.com' }
 * ).extend(proxyActions)
 */
export const createPublicClient = <
  TChain extends Chain | undefined = undefined,
  TTransport extends Transport = Transport
>(
  config: CreatePublicClientConfig<TTransport, TChain>
): ProxyPublicClient<TTransport, TChain> => {
  const { proxy: proxyConfig, ...clientConfig } = config;

  const finalProxyConfig: ProxyConfig = {
    ...DEFAULT_PROXY_CONFIG,
    ...proxyConfig,
  };

  const transport = clientConfig.transport ?? viemHttp();
  const baseClient = createViemPublicClient({
    ...clientConfig,
    transport,
  } as PublicClientConfig) as PublicClient;

  const helperMethods = {
    proxy: finalProxyConfig,

    getCacheStats: async () => ({
      hitRate: 0,
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
    }),

    clearCache: async () => {
      if (finalProxyConfig.debug) {
        console.log("[viem-proxy] Cache cleared");
      }
    },

    preheatCache: async (requests: RpcRequest[]): Promise<RpcResponse[]> => {
      if (!finalProxyConfig.endpoint) {
        return requests.map((req) => ({
          jsonrpc: "2.0" as const,
          id: req.id,
          result: null,
          error: null,
        }));
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (finalProxyConfig.apiKey) {
        headers["X-API-Key"] = finalProxyConfig.apiKey;
      }

      try {
        const results = await Promise.allSettled(
          requests.map((req) =>
            fetch(`${finalProxyConfig.endpoint}/api/v1/direct/${baseClient.chain?.id ?? 1}/${req.method}`, {
              method: "POST",
              headers,
              body: JSON.stringify(req),
            }).then((r) => r.json() as Promise<RpcResponse>)
          )
        );

        return results.map((r, i) =>
          r.status === "fulfilled"
            ? r.value
            : { jsonrpc: "2.0" as const, id: requests[i].id, result: null, error: null }
        );
      } catch {
        return requests.map((req) => ({
          jsonrpc: "2.0" as const,
          id: req.id,
          result: null,
          error: null,
        }));
      }
    },

    getMetrics: async (): Promise<PerformanceMetrics> => ({
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
    }),

    clearMetrics: async () => {
      if (finalProxyConfig.debug) {
        console.log("[viem-proxy] Metrics cleared");
      }
      return true;
    },
  };

  if (!finalProxyConfig.enabled || !finalProxyConfig.endpoint) {
    return Object.assign(baseClient, helperMethods) as ProxyPublicClient<TTransport, TChain>;
  }

  const proxiedClient = withProxy(baseClient, {
    endpoint: finalProxyConfig.endpoint,
    timeout: finalProxyConfig.timeout,
    fallback: finalProxyConfig.fallback,
    debug: finalProxyConfig.debug,
    apiKey: finalProxyConfig.apiKey,
  });

  const extendedClient = (proxiedClient as any).extend(proxyActions);

  return Object.assign(extendedClient, helperMethods) as ProxyPublicClient<TTransport, TChain>;
};
