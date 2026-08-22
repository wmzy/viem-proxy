/**
 * Per-IP rate limiting (protects a self-deployed instance's RPC quota and
 * Workers request budget from abuse).
 */

/** Default per-IP request budget per minute when RATE_LIMIT_PER_MINUTE is unset. */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

/**
 * Read-only monitoring endpoints exempt from rate limiting: an operator
 * must be able to observe (stats) and probe (health) the instance even
 * while a flood is filling every other bucket. This is a different concern
 * from auth exemption (PUBLIC_API_PATHS in utils/auth.ts, which keeps
 * /api/v1/health credential-free): /api/v1/stats still requires the API
 * key when one is configured; only the rate-limit budget does not apply.
 *
 * `/dashboard` serves the monitoring UI shell (no data of its own) and
 * lives outside the /api/v1/* scope this middleware guards, so its entry
 * is defensive registration — the registry of read-only monitoring
 * surfaces — not the operative exemption.
 */
export const RATE_LIMIT_EXEMPT_PATHS = new Set<string>([
  "/api/v1/health",
  "/api/v1/stats",
  "/dashboard",
]);

/** Verdict returned by the RateLimiter Durable Object for one consume attempt. */
export type RateLimitVerdict = {
  allowed: boolean;
  /** Requests charged to the current minute bucket after this one. */
  count: number;
  /** Effective limit the check was made against. */
  limit: number;
  /** Whole seconds until the current minute bucket rolls over (always >= 1). */
  retryAfterSeconds: number;
};

/**
 * Parse RATE_LIMIT_PER_MINUTE:
 * - unset/empty -> the default (limiting on)
 * - "0" -> 0, the explicit off switch
 * - negative or non-numeric -> the default (fail toward protection; an
 *   invalid value must not silently disable the guard)
 * - other numbers -> floored to an integer >= 1
 */
export const parseRateLimitPerMinute = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return DEFAULT_RATE_LIMIT_PER_MINUTE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_RATE_LIMIT_PER_MINUTE;
  const floored = Math.floor(parsed);
  if (floored === 0) return 0;
  if (floored < 0) return DEFAULT_RATE_LIMIT_PER_MINUTE;
  return floored;
};

/**
 * Identify the client a request is charged to. CF-Connecting-IP is set by
 * Cloudflare on every request it proxies; when absent (e.g. direct Node
 * tests) all callers share the "unknown" budget so the endpoint is still
 * bounded in total.
 */
export const resolveClientId = (header: string | undefined): string =>
  header !== undefined && header.length > 0 ? header : "unknown";
