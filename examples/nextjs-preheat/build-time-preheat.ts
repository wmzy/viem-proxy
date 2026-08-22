/**
 * Build-time / post-deploy cache preheat — integration pattern ③.
 * Standalone Node script: no Next.js runtime needed, so it also works for
 * plain deployments behind a traffic spike (mint drops, airdrop claims,
 * product launches) where you want the edge warm before users arrive.
 *
 * Run directly:
 *   PROXY_ENDPOINT=https://proxy.example.com npx tsx build-time-preheat.ts
 * or wire it as a post-deploy CI step / cron job (see README.md).
 *
 * Type-checked against viem-proxy's public API with `tsc --noEmit`
 * (examples/ is outside the root tsconfig include; see README.md).
 */
import { configureProxy, preheatCache } from "viem-proxy/actions";
import type { PreheatRequest } from "viem-proxy/actions";

// Module-level defaults: every preheatCache call below inherits them.
const endpoint = process.env.PROXY_ENDPOINT;
if (!endpoint) {
  console.error("Missing PROXY_ENDPOINT — set it to your viem-proxy Workers URL");
  process.exit(1);
}
configureProxy({
  endpoint,
  timeout: 8000,
  // A preheat run must not silently fall back to direct RPC on failure:
  // failures should surface here (exit code 1) instead of burning upstream
  // quota while warming nothing.
  fallback: false,
  // Warm-up is idempotent and off the request path; one cheap retry covers
  // edge cold starts right after a deploy. (preheatCache defaults to a
  // single attempt; module defaults raise it for this script only.)
  retryOptions: { attempts: 2, delay: 500 },
});

// ---------------------------------------------------------------------------
// Static query set, split per chain (PreheatRequest has no per-item chainId
// override — group requests by chain and call preheatCache once per chain).
//
// What is worth warming here? Only queries whose TTL survives the gap
// between this run and real traffic:
//   - Contract metadata (getCode, symbol/decimals readContract): 5 min ~ 1 h
//   - Finalized history (old blocks, receipts): 30 d ~ 1 y
//   - chainId: 1 h
// Latest-block (12 s) and balance (30 s) entries expire almost immediately —
// include them only when this run fires shortly before a traffic spike
// (e.g. a post-deploy hook feeding a launch), otherwise they are dead weight.
// ---------------------------------------------------------------------------
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const TREASURY = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

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

type PreheatPlan = {
  chainId: number;
  label: string;
  requests: PreheatRequest[];
};

const PLANS: PreheatPlan[] = [
  {
    chainId: 1,
    label: "Ethereum",
    requests: [
      // Long-TTL: safe to warm at build time
      { action: "getChainId" },
      { action: "getCode", args: { address: USDC } },
      { action: "readContract", args: { address: USDC, abi: erc20MetaAbi, functionName: "symbol" } },
      { action: "readContract", args: { address: USDC, abi: erc20MetaAbi, functionName: "decimals" } },
      // Short-TTL: only useful because this run precedes a launch window
      { action: "getBalance", args: { address: TREASURY } },
      { action: "getGasPrice" },
    ],
  },
  {
    chainId: 137,
    label: "Polygon",
    requests: [
      { action: "getChainId" },
      { action: "getBlockNumber" },
    ],
  },
];

async function main(): Promise<void> {
  let failedTotal = 0;
  for (const plan of PLANS) {
    // Config argument omitted: endpoint/timeout/fallback/retryOptions all
    // come from configureProxy above. The third argument selects the chain.
    const { submitted, failed } = await preheatCache(plan.requests, undefined, plan.chainId);
    failedTotal += failed;
    console.log(
      `[preheat] ${plan.label} (chain ${plan.chainId}): ${submitted - failed}/${submitted} warmed`
    );
  }
  if (failedTotal > 0) {
    console.error(`[preheat] ${failedTotal} request(s) failed`);
    process.exitCode = 1;
  }
}

void main();
