/**
 * Shared error-presentation helpers for API handlers.
 */

/**
 * Message prefix used by executeWithFailover once every configured upstream
 * endpoint for a chain has been tried. The aggregated message is safe to
 * surface to callers: it names the chain and the last endpoint-level reason
 * but never contains upstream URLs or credentials.
 */
export const UPSTREAM_EXHAUSTED_PREFIX = "All RPC endpoints failed";

/**
 * Whether an error is the aggregate "every upstream failed" failure whose
 * message may be shown to API callers instead of a generic Internal error.
 */
export const isUpstreamExhaustedError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.startsWith(UPSTREAM_EXHAUSTED_PREFIX);

/**
 * Error message for handler responses: pass through the actionable upstream
 * exhaustion summary, collapse everything else to a generic message
 * (arbitrary internal errors may contain URLs or stack details).
 */
export const responseErrorMessage = (
  error: unknown
): { code: number; message: string } => ({
  code: -32603,
  message: isUpstreamExhaustedError(error)
    ? (error as Error).message
    : "Internal error",
});
