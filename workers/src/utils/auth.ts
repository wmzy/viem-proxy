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
