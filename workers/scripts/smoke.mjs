#!/usr/bin/env node
/**
 * Post-deploy smoke test for a viem-proxy Workers endpoint.
 *
 * Zero-dependency Node >= 18 script (native fetch). Four checks:
 *
 *   1. GET  /api/v1/health               skipped — not failed — on 404/405:
 *                                        older deployments ship no health
 *                                        endpoint (added in a later wave)
 *   2. POST /api/v1/{chain}/getBlockNumber  x3 sequential calls; reports
 *      latency, X-Cache (dedup HIT/MISS) and X-Trace-Id per call
 *   3. POST /api/v1/{chain}/getBalance   on --address (defaults to a
 *      well-known public address)
 *   4. GET  /api/v1/stats                optional; failures are reported
 *                                        but never fail the run
 *
 * Exit codes: 0 all critical requests passed, 1 at least one critical
 * request failed, 2 usage error.
 *
 * Usage:
 *   node workers/scripts/smoke.mjs <endpoint> [--chain 1] [--key API_KEY]
 *       [--address 0x...]
 *
 * Pure helpers (parseArgs, buildUrl, formatEther) are exported so tests in
 * workers/test/smoke.test.ts can exercise them without spawning Node.
 */

import { pathToFileURL } from "node:url";

/** Fallback address for the getBalance check: vitalik.eth's main account. */
export const DEFAULT_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/** Fallback chain: Ethereum mainnet. */
export const DEFAULT_CHAIN = 1;

/** Sequential getBlockNumber calls used to demonstrate dedup cache hits. */
const BLOCK_NUMBER_ROUNDS = 3;

/** Per-request timeout; a hung endpoint should not stall the script. */
const REQUEST_TIMEOUT_MS = 15000;

const USAGE = `用法: node workers/scripts/smoke.mjs <endpoint> [选项]

部署完 Workers 后 1 分钟内验证代理是否正常工作：
  ① GET  /api/v1/health                 健康检查（旧版本无此端点时自动跳过）
  ② POST /api/v1/{chain}/getBlockNumber  连续 3 次，报告延迟与 X-Cache 命中
  ③ POST /api/v1/{chain}/getBalance      查询指定地址余额
  ④ GET  /api/v1/stats                   服务端统计（可选，不影响结论）

选项:
  <endpoint>         Workers 端点，如 https://your-proxy.workers.dev
  --chain <id>       链 ID（默认 ${DEFAULT_CHAIN}，Ethereum 主网）
  --key <API_KEY>    API 密钥，部署时配置了 API_KEY 则必填（经 X-API-Key 头发送）
  --address <0x..>   getBalance 查询地址（默认 vitalik.eth 常用地址）
  -h, --help         显示本帮助

退出码: 0 = 全部关键检查通过；1 = 存在失败；2 = 参数错误`;

/**
 * Parse CLI arguments.
 *
 * Accepted forms: `<endpoint>` positional plus `--chain`, `--key`,
 * `--address` (both `--flag value` and `--flag=value`). Throws an Error
 * with a Chinese, user-facing message on invalid input. Validation of the
 * endpoint is skipped when `--help` is present so help never requires one.
 *
 * @returns {{ endpoint?: string, chain: number, key?: string,
 *             address: string, help: boolean }}
 */
export function parseArgs(argv) {
  const options = {
    endpoint: undefined,
    chain: DEFAULT_CHAIN,
    key: undefined,
    address: DEFAULT_ADDRESS,
    help: false,
  };

  const setValue = (name, rawValue) => {
    if (name === "chain") {
      const chain = Number(rawValue);
      if (!Number.isInteger(chain) || chain <= 0) {
        throw new Error(`--chain 需要正整数链 ID，收到: ${rawValue}`);
      }
      options.chain = chain;
    } else if (name === "key") {
      options.key = rawValue;
    } else {
      options.address = rawValue;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    const inline = /^--(chain|key|address)=([\s\S]*)$/.exec(arg);
    if (inline) {
      setValue(inline[1], inline[2]);
      continue;
    }

    if (arg === "--chain" || arg === "--key" || arg === "--address") {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`${arg} 需要一个值，如 ${arg} 1`);
      }
      setValue(arg.slice(2), value);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`未知参数: ${arg}`);
    }

    if (options.endpoint !== undefined) {
      throw new Error(`多余的参数: ${arg}（endpoint 只能提供一个）`);
    }
    options.endpoint = arg;
  }

  if (!options.help) {
    if (options.endpoint === undefined) {
      throw new Error("缺少 <endpoint> 参数");
    }
    let parsed;
    try {
      parsed = new URL(options.endpoint);
    } catch {
      throw new Error(`endpoint 不是合法 URL: ${options.endpoint}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `endpoint 必须以 http:// 或 https:// 开头: ${options.endpoint}`
      );
    }
  }

  return options;
}

/**
 * Join an endpoint base URL with path segments, tolerating trailing slashes
 * on the endpoint (mirrors the client's `${endpoint}/api/v1/...` shape).
 *
 * @returns {string} normalized URL string
 */
export function buildUrl(endpoint, ...segments) {
  const base = endpoint.replace(/\/+$/, "");
  return segments.length > 0 ? `${base}/${segments.join("/")}` : base;
}

/**
 * Format a hex wei string as a decimal ETH amount with 6 fraction digits.
 * Returns null for anything that is not a parseable wei quantity.
 */
export function formatEther(weiHex) {
  try {
    const wei = BigInt(weiHex);
    const whole = wei / 10n ** 18n;
    const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
    return `${whole.toString()}.${fraction}`;
  } catch {
    return null;
  }
}

const describeFetchError = (error) => {
  if (error && error.name === "TimeoutError") {
    return `请求超时（>${REQUEST_TIMEOUT_MS / 1000}s）`;
  }
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `（${error.cause.message}）` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
};

const safeJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const pct = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "?";

/**
 * Run the smoke checks against a deployed endpoint and print a Chinese,
 * human-readable report line by line.
 *
 * @param {{ endpoint: string, chain: number, key?: string, address: string }}
 *   options
 * @param {{ fetch?: Function, log?: (line: string) => void }} deps
 *   injectable fetch and log sink for tests
 * @returns {{ ok: boolean, failures: string[], cacheHits: number,
 *             cacheTotal: number }} ok === false maps to exit code 1
 */
export async function runSmoke(options, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? ((line) => console.log(line));
  const { endpoint, chain, key, address } = options;

  const failures = [];
  const cacheTotal = BLOCK_NUMBER_ROUNDS;
  let cacheHits = 0;

  const baseHeaders = {};
  if (key) baseHeaders["X-API-Key"] = key;

  /** One timed request; network errors collapse into { networkError }. */
  const send = async (url, init = {}) => {
    const startedAt = performance.now();
    let res;
    try {
      res = await fetchImpl(url, {
        ...init,
        headers: { ...baseHeaders, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, networkError: describeFetchError(error) };
    }
    return { ok: true, res, latencyMs: Math.round(performance.now() - startedAt) };
  };

  const bodyError = (body) =>
    body && body.error && typeof body.error.message === "string"
      ? `: ${body.error.message}`
      : "";

  // --- ① Health check (optional endpoint: 404/405 means older deployment) ---
  log("");
  log("① 健康检查  GET /api/v1/health");
  const health = await send(buildUrl(endpoint, "api/v1/health"));
  if (!health.ok) {
    log(`   ❌ ${health.networkError}`);
    failures.push("健康检查请求失败（端点不可达）");
  } else if (health.res.status === 404 || health.res.status === 405) {
    log(`   ⏭ HTTP ${health.res.status}：该部署未提供 /api/v1/health（版本较旧），跳过`);
  } else if (!health.res.ok) {
    const body = await safeJson(health.res);
    log(`   ❌ HTTP ${health.res.status}${bodyError(body)}`);
    failures.push(`健康检查返回 HTTP ${health.res.status}`);
  } else {
    const body = await safeJson(health.res);
    const chains = Array.isArray(body?.chains) ? `${body.chains.length} 条` : "?";
    const mark = body?.status === "ok" ? "✅" : "⚠️ ";
    log(
      `   ${mark} ${health.latencyMs}ms  status=${body?.status ?? "?"}  version=${body?.version ?? "?"}  可服务链 ${chains}`
    );
    if (body?.status === "degraded") {
      log("   ❌ status=degraded：没有任何可服务链（检查 RPC_URLS / ALLOWED_CHAIN_IDS 配置）");
      failures.push("健康检查 status=degraded");
    }
  }

  // --- ② getBlockNumber ×3: latency + dedup cache (X-Cache) per call ------
  log("");
  log(
    `② 区块高度  POST /api/v1/${chain}/getBlockNumber ×${BLOCK_NUMBER_ROUNDS}（顺序请求，观察去重缓存命中）`
  );
  for (let round = 1; round <= BLOCK_NUMBER_ROUNDS; round++) {
    const call = await send(
      buildUrl(endpoint, "api/v1", String(chain), "getBlockNumber"),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    );
    if (!call.ok) {
      log(`   第 ${round} 次  ❌ ${call.networkError}`);
      failures.push(`getBlockNumber 第 ${round} 次请求失败（端点不可达）`);
      continue;
    }
    const body = await safeJson(call.res);
    if (!call.res.ok || !body || body.error || body.result === undefined) {
      log(`   第 ${round} 次  ❌ HTTP ${call.res.status}${bodyError(body) || "（响应缺少 result）"}`);
      failures.push(`getBlockNumber 第 ${round} 次失败（HTTP ${call.res.status}）`);
      continue;
    }
    const cache = call.res.headers.get("x-cache") ?? "-";
    const trace = call.res.headers.get("x-trace-id") ?? "-";
    if (cache.toUpperCase() === "HIT") cacheHits++;
    const block = Number.parseInt(body.result, 16);
    const blockText = Number.isNaN(block) ? String(body.result) : `#${block}`;
    log(`   第 ${round} 次  ✅ ${call.latencyMs}ms  cache=${cache}  block=${blockText}  trace=${trace}`);
  }

  // --- ③ getBalance on the configured address -----------------------------
  log("");
  log(`③ 余额查询  POST /api/v1/${chain}/getBalance`);
  log(`   地址: ${address}`);
  const balance = await send(
    buildUrl(endpoint, "api/v1", String(chain), "getBalance"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }
  );
  if (!balance.ok) {
    log(`   ❌ ${balance.networkError}`);
    failures.push("getBalance 请求失败（端点不可达）");
  } else {
    const body = await safeJson(balance.res);
    if (!balance.res.ok || !body || body.error || body.result === undefined) {
      log(`   ❌ HTTP ${balance.res.status}${bodyError(body) || "（响应缺少 result）"}`);
      failures.push(`getBalance 失败（HTTP ${balance.res.status}）`);
    } else {
      const cache = balance.res.headers.get("x-cache") ?? "-";
      const trace = balance.res.headers.get("x-trace-id") ?? "-";
      const eth = formatEther(body.result);
      log(`   ✅ ${balance.latencyMs}ms  cache=${cache}  balance=${eth ?? body.result} ETH  trace=${trace}`);
    }
  }

  // --- ④ Stats (optional: old deployments / missing STATISTICS binding) ---
  log("");
  log("④ 服务端统计  GET /api/v1/stats（可选）");
  const stats = await send(buildUrl(endpoint, "api/v1/stats"));
  if (!stats.ok) {
    log(`   ⏭ ${stats.networkError}，跳过`);
  } else if (!stats.res.ok) {
    const hint =
      stats.res.status === 401
        ? `401：需要认证${key ? "（提供的 --key 被拒绝）" : "（未提供 --key）"}`
        : `HTTP ${stats.res.status}（可能未绑定 STATISTICS Durable Object 或版本较旧）`;
    log(`   ⏭ ${hint}，跳过`);
  } else {
    const body = await safeJson(stats.res);
    log(
      `   ✅ 总请求 ${body?.totalRequests ?? "?"} · 缓存命中 ${body?.cacheHits ?? "?"}（${pct(body?.cacheHitRate)}）· ` +
        `平均上游延迟 ${body?.averageResponseTime ?? "?"}ms · 错误率 ${pct(body?.errorRate)}`
    );
  }

  log("");
  log("─".repeat(48));
  if (failures.length === 0) {
    log(
      `✅ 验证通过：代理工作正常（区块请求缓存命中 ${cacheHits}/${cacheTotal}，重复请求应命中去重缓存）`
    );
  } else {
    log(`❌ 验证失败：${failures.length} 项关键检查未通过：`);
    for (const failure of failures) log(`   - ${failure}`);
  }

  return { ok: failures.length === 0, failures, cacheHits, cacheTotal };
}

const printUsage = (write) => write(USAGE);

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`参数错误：${error instanceof Error ? error.message : String(error)}\n`);
    printUsage(console.error);
    return 2;
  }

  if (options.help) {
    printUsage(console.log);
    return 0;
  }

  console.log("🚀 viem-proxy 部署验证");
  console.log(`   端点: ${options.endpoint}`);
  console.log(`   链 ID: ${options.chain}    API key: ${options.key ? "已配置" : "未配置"}`);

  const result = await runSmoke(options);
  return result.ok ? 0 : 1;
}

// Run only when executed directly (node smoke.mjs ...), not when imported
// by tests. exitCode (not process.exit) so stdout can flush.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`执行出错：${error instanceof Error ? error.stack : String(error)}`);
      process.exitCode = 1;
    }
  );
}
