import type { Client } from "viem";
import type { ProxyActionConfig } from "./actions/types";

const proxySymbol: unique symbol = Symbol("proxy");

type ClientWithProxy = Client & {
  [proxySymbol]?: ProxyActionConfig;
};

export const withProxy = <T extends Client>(
  client: T,
  config: ProxyActionConfig
): T => Object.assign(client, { [proxySymbol]: config });

export const getProxyConfig = (
  client: Client
): ProxyActionConfig | undefined => (client as ClientWithProxy)[proxySymbol];
