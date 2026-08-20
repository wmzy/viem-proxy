import type { ProxyMiddleware, RpcRequest, RpcResponse } from "../types";

/**
 * Module-level middleware registry. Order matters: the first registered
 * middleware forms the outermost layer of the request onion.
 */
const middlewares: ProxyMiddleware[] = [];

/**
 * Register a proxy middleware. Middlewares wrap every request sent through
 * `makeProxyRequest` onion style — the first registered middleware runs
 * outermost: its `next` invokes the next registered middleware, and the
 * innermost `next` performs the actual request. A middleware may inspect,
 * modify or replace the request, short-circuit with its own response, or
 * throw — a throw aborts the request and propagates to the caller's
 * fallback/error path like any other proxy failure.
 */
export const addMiddleware = (middleware: ProxyMiddleware): void => {
  middlewares.push(middleware);
};

/** Remove every registered middleware. */
export const clearMiddlewares = (): void => {
  middlewares.length = 0;
};

/** Snapshot of the registered middlewares in registration order. */
export const getMiddlewares = (): readonly ProxyMiddleware[] =>
  middlewares.slice();

/**
 * Wrap `core` (the actual request sender) with the registered middlewares,
 * onion style: the first registered middleware becomes the outermost layer.
 * With no registered middlewares the core is returned as-is.
 */
export const applyMiddlewareChain = <T = unknown>(
  core: (request: RpcRequest) => Promise<RpcResponse<T>>
): ((request: RpcRequest) => Promise<RpcResponse<T>>) =>
  getMiddlewares().reduceRight<(request: RpcRequest) => Promise<RpcResponse<T>>>(
    (next, middleware) => (request: RpcRequest) =>
      // A middleware-authored response is trusted to carry the caller's
      // expected result type, exactly like the raw proxy response is.
      middleware(request, next) as Promise<RpcResponse<T>>,
    core
  );
