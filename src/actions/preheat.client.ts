import type { Chain, Client, Transport } from "viem";
import { getProxyConfig } from "../proxy";
import type { ProxyActionConfig } from "./types";
import type { BatchActionName } from "./batch.client";
import { makeProxyRequest } from "./utils";

/** One cache-preheat item: an action plus its arguments */
export type PreheatRequest = {
  action: BatchActionName;
  args?: Record<string, unknown>;
};

/** Outcome counters of a preheat run */
export type PreheatResult = {
  /** Number of requests submitted to the preheat pool */
  submitted: number;
  /** Number of submitted requests that failed (preheat never throws) */
  failed: number;
};

/** Maximum number of concurrent preheat requests */
export const PREHEAT_CONCURRENCY = 5;

/** Preheat is best-effort: transient failures are not retried by default */
const PREHEAT_RETRY_OPTIONS = { attempts: 1, delay: 0 };

/**
 * Preheat the CDN cache for the given requests.
 *
 * Each item is fired through the regular `makeProxyRequest` compressed GET
 * path, so the Workers/CDN edge caches fill exactly the way real traffic
 * would. Items run in a bounded pool of `PREHEAT_CONCURRENCY` (5)
 * concurrent requests; failures are swallowed and counted — this function
 * never throws. Transient retries are disabled by default (`attempts: 1`):
 * preheat only warms caches, so re-issuing a failed request adds upstream
 * load without benefit. Callers can override via `config.retryOptions`.
 *
 * @example
 * import { preheatCache } from 'viem-proxy/actions'
 * const { submitted, failed } = await preheatCache(
 *   [
 *     { action: 'getBalance', args: { address: '0x...' } },
 *     { action: 'getBlockNumber' },
 *   ],
 *   { endpoint: 'https://proxy.example.com' }
 * )
 */
export const preheatCache = async (
  requests: PreheatRequest[],
  config?: ProxyActionConfig,
  defaultChainId = 1
): Promise<PreheatResult> => {
  if (requests.length === 0 || !config?.endpoint) {
    return { submitted: 0, failed: 0 };
  }

  const preheatConfig: ProxyActionConfig = {
    ...config,
    retryOptions: config.retryOptions ?? PREHEAT_RETRY_OPTIONS,
  };

  let failed = 0;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < requests.length) {
      const request = requests[cursor++];
      try {
        await makeProxyRequest(
          request.action,
          defaultChainId,
          request.args ?? {},
          preheatConfig
        );
      } catch (error) {
        failed += 1;
        if (preheatConfig.debug) {
          console.warn(
            `[viem-proxy] Preheat failed for ${request.action}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(PREHEAT_CONCURRENCY, requests.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { submitted: requests.length, failed };
};

/**
 * Preheat entry point bound to a proxied client: resolves the proxy config
 * and chain from the client itself. Without a proxy config there is nothing
 * to preheat and zero counters are returned.
 */
export const preheatClientCache = <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  requests: PreheatRequest[]
): Promise<PreheatResult> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;
  if (!proxy?.endpoint) {
    return Promise.resolve({ submitted: 0, failed: 0 });
  }
  return preheatCache(requests, proxy, chainId);
};
