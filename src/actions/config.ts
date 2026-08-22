import type { ProxyActionConfig } from "./types";
import { DEFAULT_PROXY_CONFIG } from "./utils";

/**
 * Module-level proxy defaults set via `configureProxy`. This is
 * process-wide state: every entry point (`createPublicClient`,
 * `withProxy`, `proxyActions`, `batchActions`, `preheatCache`,
 * `purgeCache`) inherits these values unless the call site passes an
 * explicit value, which always wins per key.
 *
 * Precedence per key: explicit call-site config > client-mounted config
 * (`withProxy`) > module defaults > built-in defaults
 * (`DEFAULT_PROXY_CONFIG`). Until `configureProxy` is called the map is
 * empty and resolution is exactly the previous behavior.
 */
let moduleDefaults: Partial<ProxyActionConfig> = {};

/**
 * Set module-level default proxy configuration, inherited by every
 * entry point. Repeated calls merge per key; `resetProxyDefaults()`
 * clears everything.
 *
 * @example
 * import { configureProxy } from 'viem-proxy'
 * configureProxy({
 *   endpoint: 'https://proxy.example.com',
 *   timeout: 10000,
 * })
 * // every client / action call now inherits this endpoint and timeout
 */
export const configureProxy = (defaults: Partial<ProxyActionConfig>): void => {
  moduleDefaults = { ...moduleDefaults, ...defaults };
};

/**
 * A copy of the current module-level defaults (empty object until
 * `configureProxy` is called). Mutating the copy does not affect the
 * module state. Intended for introspection and tests.
 */
export const getProxyDefaults = (): Partial<ProxyActionConfig> => ({
  ...moduleDefaults,
});

/** Clear all module-level defaults (test / isolation helper). */
export const resetProxyDefaults = (): void => {
  moduleDefaults = {};
};

/** Whether any module-level default is currently set. */
export const hasProxyDefaults = (): boolean =>
  Object.keys(moduleDefaults).length > 0;

/**
 * Built-in defaults layered under the module defaults. `retryOptions` is
 * copied so callers can never mutate the shared default objects.
 */
export const resolveProxyDefaults = (): Required<ProxyActionConfig> => {
  const merged = { ...DEFAULT_PROXY_CONFIG, ...moduleDefaults };
  return { ...merged, retryOptions: { ...merged.retryOptions } };
};

/**
 * The full inheritance chain in one object:
 * built-in defaults < module defaults < explicit call-site config.
 */
export const resolveProxyConfig = (
  explicit?: Partial<ProxyActionConfig>
): Required<ProxyActionConfig> => ({
  ...resolveProxyDefaults(),
  ...explicit,
});
