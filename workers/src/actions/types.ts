import type { Env } from "../types";

/**
 * Action handler context
 */
export type ActionContext = {
  chainId: number;
  args: Record<string, unknown>;
  env: Env;
};

/**
 * Action handler result
 */
export type ActionResult<T = unknown> = {
  result: T;
  blockNumber?: string;
};

/**
 * Server action handler type
 */
export type ServerActionHandler<TArgs = unknown, TResult = unknown> = (
  ctx: ActionContext & { args: TArgs }
) => Promise<ActionResult<TResult>>;

/**
 * RPC request type
 */
export type RpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};

/**
 * RPC response type
 */
export type RpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};
