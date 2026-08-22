/**
 * Route-prefetch cache preheat for Next.js — integration pattern ②.
 * (Pattern ① server-side and ③ build-time notes live in README.md;
 * ③ has its own snippet: build-time-preheat.ts)
 *
 * The problem this solves: `preheatCache` requires the query set up front,
 * which few apps know statically. Route definitions already encode "which
 * on-chain queries does this page need" — map routes to query sets here and
 * warm them the moment the user shows navigation intent (link hover,
 * next/link prefetch window, or a route-change event), so the CDN edge is
 * warm before the page's own requests arrive.
 *
 * Copy this file into your project (e.g. `lib/preheat.ts`) and import the
 * helpers from client components. Type-checked against viem-proxy's public
 * API with `tsc --noEmit`; `react` / `next/navigation` are stubbed during
 * that check (see examples/nextjs-preheat/README.md for the command).
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { configureProxy, preheatCache } from "viem-proxy/actions";
import type { PreheatRequest } from "viem-proxy/actions";

// ---------------------------------------------------------------------------
// 1. Module-level proxy defaults: set once, inherited by every action call
//    in this module. NEXT_PUBLIC_* so Next.js inlines the value into the
//    browser bundle (and it is also available server-side).
// ---------------------------------------------------------------------------
configureProxy({
  endpoint: process.env.NEXT_PUBLIC_PROXY_ENDPOINT ?? "https://proxy.example.com",
  timeout: 5000,
  // Preheat only warms the CDN. On proxy failure, falling back to direct RPC
  // would spend upstream quota without warming anything — keep it off.
  fallback: false,
});

// ---------------------------------------------------------------------------
// 2. Route → query set. Keep this next to your route definitions so it
//    evolves with the page. Favor queries whose TTL outlives the trigger
//    lag (contract metadata: 5 min ~ 1 h; finalized history: 30 d+;
//    balance-ish data: 30 s — warmed seconds before use, which is exactly
//    what a hover/prefetch trigger gives you).
// ---------------------------------------------------------------------------
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const erc20MetaAbi = [
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

const ROUTE_PREHEAT: Record<string, PreheatRequest[]> = {
  // Landing page hero widgets: balance + latest block
  "/": [
    { action: "getBalance", args: { address: VITALIK } },
    { action: "getBlockNumber" },
  ],
  // Swap page: token metadata for both pools + current gas
  "/swap": [
    { action: "readContract", args: { address: WETH, abi: erc20MetaAbi, functionName: "symbol" } },
    { action: "readContract", args: { address: USDC, abi: erc20MetaAbi, functionName: "decimals" } },
    { action: "getGasPrice" },
  ],
  // Portfolio page: balances, nonce, and whether the address is a contract
  "/portfolio": [
    { action: "getBalance", args: { address: VITALIK } },
    { action: "getTransactionCount", args: { address: VITALIK } },
    { action: "getCode", args: { address: USDC } },
  ],
};

// ---------------------------------------------------------------------------
// 3. Trigger helpers
// ---------------------------------------------------------------------------

/**
 * Skip re-preheating a route whose queries were warmed within this window.
 * 25s sits just under the 30s account-state TTL (see the cache-strategy
 * table in the root README): two hovers within 25s cost one warm-up, a later
 * hover usefully refreshes the cache instead of being deduplicated away.
 */
const PREHEAT_WINDOW_MS = 25_000;
const lastPreheat = new Map<string, number>();

/**
 * Warm the edge cache for one route. Never throws: `preheatCache` swallows
 * failures into its `failed` counter, and unknown routes are a no-op.
 * Endpoint/timeout/fallback are inherited from `configureProxy` above.
 */
export async function preheatForRoute(pathname: string): Promise<void> {
  const requests = ROUTE_PREHEAT[pathname];
  if (!requests || requests.length === 0) return;

  const now = Date.now();
  if (now - (lastPreheat.get(pathname) ?? 0) < PREHEAT_WINDOW_MS) return;
  lastPreheat.set(pathname, now);

  // Bounded pool of 5 concurrent compressed-GET requests, the same path
  // real traffic takes — so the CDN fills exactly the way production will read.
  const { submitted, failed } = await preheatCache(requests);
  if (failed > 0) {
    console.warn(`[preheat] ${pathname}: ${failed}/${submitted} requests failed`);
  }
}

/**
 * App Router hook: warm the current route's queries right after navigation.
 * Useful when a page renders several widgets that each fetch on mount —
 * the preheat pool usually lands most queries before the widgets ask.
 */
export function usePreheatOnNavigate(): void {
  const pathname = usePathname();
  useEffect(() => {
    void preheatForRoute(pathname);
  }, [pathname]);
}

/*
 * Wiring it up:
 *
 * App Router — hover intent on <Link>, pairing with next/link's own prefetch:
 *   <Link
 *     href="/swap"
 *     onMouseEnter={() => void preheatForRoute("/swap")}
 *   >
 *     Swap
 *   </Link>
 *
 * Pages Router — any route change, warmed while the navigation is in flight:
 *   useEffect(() => {
 *     router.events.on("routeChangeStart", preheatForRoute)
 *     return () => router.events.off("routeChangeStart", preheatForRoute)
 *   }, [router.events])
 *
 * Pattern ① (getServerSideProps / server components): call `preheatForRoute`
 * or `preheatCache` directly on the server before rendering — SSR runs in
 * Node, so the edge warms before the HTML even ships, and the hydrated
 * client reads cache hits.
 */
