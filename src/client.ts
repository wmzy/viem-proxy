import {
  type Chain,
  type PublicClientConfig,
  type Transport,
  type PublicClient,
  createPublicClient as createViemPublicClient,
  http as viemHttp,
} from "viem";
import type { ProxyPublicClient, ProxyConfig, PerformanceMetrics, ProxyMiddleware } from "./types";
import { proxyActions } from "./actions/proxyActions";
import { batchClientActions } from "./actions/batch.client";
import { addMiddleware } from "./actions/middleware";
import { preheatCache as runPreheat } from "./actions/preheat.client";
import type { PreheatRequest, PreheatResult } from "./actions/preheat.client";
import { withProxy } from "./proxy";
import { getMetricsCollector, resetMetrics } from "./utils/metrics";

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: true,
  endpoint: "",
  timeout: 30000,
  fallback: true,
  debug: false,
  retryOptions: { attempts: 3, delay: 500 },
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

  const proxyEnabled =
    finalProxyConfig.enabled && !!finalProxyConfig.endpoint;

  // The client the proxy actions resolve their config from: carries the
  // proxy config when enabled, plain (native actions) otherwise.
  const actionClient = proxyEnabled
    ? withProxy(baseClient, {
        endpoint: finalProxyConfig.endpoint,
        timeout: finalProxyConfig.timeout,
        fallback: finalProxyConfig.fallback,
        debug: finalProxyConfig.debug,
        apiKey: finalProxyConfig.apiKey,
        retryOptions: finalProxyConfig.retryOptions,
      })
    : baseClient;

  const helperMethods = {
    proxy: finalProxyConfig,

    // viem's `extend` strips any extension key that exists on the core
    // client (`batch` is a core config key), so `batch` is wired here
    // explicitly to survive on the returned client.
    batch: batchClientActions(actionClient),

    getCacheStats: (): PerformanceMetrics =>
      getMetricsCollector().getSnapshot(),

    // Resets local metric statistics only; purging the CDN cache itself
    // requires server-side support and will be provided in a later version.
    clearCache: (): void => {
      resetMetrics();
      if (finalProxyConfig.debug) {
        console.log("[viem-proxy] Cache cleared");
      }
    },

    preheatCache: async (
      requests: PreheatRequest[]
    ): Promise<PreheatResult> =>
      runPreheat(requests, finalProxyConfig, baseClient.chain?.id ?? 1),

    use: (middleware: ProxyMiddleware): void => {
      addMiddleware(middleware);
    },

    getMetrics: async (): Promise<PerformanceMetrics> =>
      getMetricsCollector().getSnapshot(),

    clearMetrics: async () => {
      resetMetrics();
      if (finalProxyConfig.debug) {
        console.log("[viem-proxy] Metrics cleared");
      }
      return true;
    },
  };

  if (!proxyEnabled) {
    return Object.assign(
      baseClient,
      helperMethods
    ) as ProxyPublicClient<TTransport, TChain>;
  }

  const extendedClient = (actionClient as any).extend(proxyActions);

  return Object.assign(extendedClient, helperMethods) as ProxyPublicClient<TTransport, TChain>;
};
