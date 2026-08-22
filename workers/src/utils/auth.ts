/**
 * API paths served without the X-API-Key check. These carry no secrets and
 * exist so deployers and uptime monitors can probe the service (e.g. the
 * health endpoint). Auth-free by design, but rate-limit middlewares should
 * consult the same set so the exemption lists cannot drift apart.
 *
 * `/dashboard` is the monitoring UI shell: the document itself carries no
 * data (all numbers are fetched browser-side through /api/v1/stats, which
 * keeps its own auth rules). It is also outside the /api/* scope this
 * middleware guards, so the entry is defensive registration — a registry
 * of read-only monitoring surfaces, not the operative exemption.
 */
export const PUBLIC_API_PATHS = new Set<string>([
  "/api/v1/health",
  "/dashboard",
]);

/**
 * Constant-time string equality for secret comparison (API keys).
 *
 * A naive `provided === expected` short-circuits on the first mismatching
 * character, so response latency leaks how much of the expected secret's
 * prefix matched — enough to reconstruct it one character at a time. This
 * variant always iterates over the longer of the two inputs and folds every
 * character difference into a single accumulator, so both the loop count
 * and the per-iteration work are independent of where (or whether) the
 * strings differ. Strings of different lengths never compare equal; the
 * length delta is folded into the same accumulator rather than returned
 * early, so timing does not leak the expected length either.
 *
 * (Out-of-range `charCodeAt` returns NaN, which XOR coerces to 0 — the
 * longer side's characters still land in `diff` as intended.)
 */
export const timingSafeEqualString = (a: string, b: string): boolean => {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};
