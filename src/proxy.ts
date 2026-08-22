import type { Client } from "viem";
import type { ProxyActionConfig } from "./actions/types";
import { resolveProxyConfig } from "./actions/config";

const proxySymbol: unique symbol = Symbol("proxy");

type ClientWithProxy = Client & {
  [proxySymbol]?: ProxyActionConfig;
};

export const withProxy = <T extends Client>(
  client: T,
  config?: Partial<ProxyActionConfig>
): T =>
  Object.assign(client, {
    [proxySymbol]: resolveProxyConfig(config),
  });

/**
 * The proxy config mounted on a client, resolved with the module
 * defaults (`configureProxy`) layered under the mounted values:
 * client-mounted config wins over module defaults per key.
 */
export const getProxyConfig = (client: Client): ProxyActionConfig =>
  (client as ClientWithProxy)[proxySymbol] ?? resolveProxyConfig(undefined);
