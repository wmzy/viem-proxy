/**
 * Origin allowlist: browser-scoped access control for self-deployed
 * instances.
 *
 * Threat model: the API key is a server-side secret. A browser frontend
 * embedding this proxy cannot keep one (any visitor can read it from the
 * bundle), so API_KEY is useless against browser-originated abuse. Browser
 * requests are, however, self-identifying: browsers attach an `Origin`
 * header to cross-origin calls and same-origin POSTs, while server-side
 * and mobile callers never send one. When ALLOWED_ORIGINS is configured,
 * the origin middleware rejects Origin-carrying requests that do not match
 * the allowlist; requests without Origin pass through and stay protected
 * by API_KEY + rate limiting.
 *
 * Unset ALLOWED_ORIGINS = permissive (previous behavior): rely on API_KEY
 * and rate limiting, as documented in the README.
 */

/** One parsed ALLOWED_ORIGINS entry. */
export type OriginRule =
  | { type: "exact"; host: string }
  | { type: "wildcard"; domain: string };

/**
 * Operator paths exempt from the origin check. `/dashboard` is an
 * unauthenticated, read-only operator page by design (it serves no RPC and
 * leaks no secrets): blocking it would take the ops surface away exactly
 * when an operator wants to look at an ongoing flood. API endpoints such
 * as `/api/v1/stats` and `/api/v1/health` are deliberately NOT exempt —
 * browsers reach them from allowlisted domains or not at all.
 */
export const ORIGIN_CHECK_EXEMPT_PATHS = new Set<string>(["/dashboard"]);

/**
 * Normalize one allowlist entry to a bare lowercase host: an optional
 * `scheme://` prefix and any `/path` suffix are stripped. Ports are kept
 * (they are part of the origin), e.g. `https://App.Example.com:3000/dapp`
 * -> `app.example.com:3000`.
 */
const normalizeOriginEntry = (entry: string): string => {
  let value = entry.trim().toLowerCase();
  const schemeIndex = value.indexOf("://");
  if (schemeIndex !== -1) value = value.slice(schemeIndex + 3);
  const slashIndex = value.indexOf("/");
  if (slashIndex !== -1) value = value.slice(0, slashIndex);
  return value;
};

// Parsed-rules cache: ALLOWED_ORIGINS is constant per isolate, and the
// middleware re-derives rules per request — cache the parse keyed by the
// raw string so alternating envs (tests) and steady-state traffic both
// cost at most one parse per raw value.
let parsedRulesCache: { raw: string; rules: OriginRule[] } | undefined;

/**
 * Parse ALLOWED_ORIGINS into match rules.
 * - unset/empty -> null (feature off, permissive behavior)
 * - comma-separated hosts; `scheme://` prefixes and `/paths` are stripped,
 *   ports are honored; `*.example.com` matches `example.com` AND any
 *   subdomain (the operator's intent when writing a wildcard is "this
 *   site and everything under it"; excluding the apex would silently
 *   break the main site while still allowing subdomains — no security
 *   gain, since anyone controlling a subdomain controls that origin)
 * - blank entries are dropped; a value that parses to zero rules yields
 *   an empty list, which `matchOrigin` fails CLOSED on (all browser
 *   requests rejected) — same philosophy as ALLOWED_CHAIN_IDS: a broken
 *   allowlist must never silently widen access.
 */
export const parseOriginAllowlist = (
  raw: string | undefined
): readonly OriginRule[] | null => {
  if (raw === undefined || raw === "") return null;
  if (parsedRulesCache?.raw === raw) return parsedRulesCache.rules;

  const rules: OriginRule[] = [];
  for (const part of raw.split(",")) {
    const value = normalizeOriginEntry(part);
    if (value === "") continue;
    if (value.startsWith("*.")) {
      const domain = value.slice(2);
      if (domain !== "") rules.push({ type: "wildcard", domain });
    } else {
      rules.push({ type: "exact", host: value });
    }
  }
  parsedRulesCache = { raw, rules };
  return rules;
};

/**
 * Does a request `Origin` header value match the allowlist? Matching is by
 * host (scheme-insensitive, port-sensitive): `https://app.example.com`
 * matches the entry `app.example.com` or the wildcard `*.example.com`.
 * Unparseable or absent-like origins (including the literal `null` sent by
 * sandboxed iframes) match nothing — fail closed. A null/empty rule set
 * also matches nothing (misconfiguration fails closed, see above).
 */
export const matchOrigin = (
  rules: readonly OriginRule[] | null,
  origin: string
): boolean => {
  if (rules === null || rules.length === 0) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return rules.some((rule) =>
    rule.type === "wildcard"
      ? host === rule.domain || host.endsWith("." + rule.domain)
      : host === rule.host
  );
};
