#!/usr/bin/env node
/**
 * Reproducible latency benchmark for a viem-proxy Workers endpoint.
 *
 * Zero-dependency Node >= 18 script (native fetch). For each scenario it
 * times the same logical read through two HTTP paths:
 *
 *   direct — a JSON-RPC POST straight to the upstream RPC (--rpc)
 *   proxy  — the proxy's action endpoint POST /api/v1/{chain}/{action}
 *
 * Per path it reports P50/P95/P99/mean/min/max, and for the proxy path the
 * X-Cache hit rate, the cold first response vs subsequent (cached) latency,
 * and an estimated upstream-RPC-call saving. One untimed warmup request per
 * path per scenario removes connection setup from the numbers and fills the
 * proxy cache.
 *
 * Usage:
 *   node scripts/benchmark.mjs --proxy https://your-proxy.workers.dev \
 *       --rpc https://eth.llamarpc.com [--chain 1] [--key KEY]
 *       [--iterations 20] [--address 0x...] [--scenario getBalance,...]
 *       [--json]
 *
 * Exit codes: 0 benchmark completed (per-request failures are reported in
 * the output), 1 at least one scenario had zero successful samples on one
 * of the two paths (comparison impossible), 2 usage error.
 *
 * Pure helpers (parseArgs, parseScenarios, buildUrl, percentile, summarize,
 * buildScenarioRequests, aggregateScenario, formatReport) and the full flow
 * (runBenchmark with injectable fetch/now/log) are exported so
 * scripts/benchmark.test.ts can exercise them without real network calls.
 */

import { pathToFileURL } from "node:url";

/** Fallback account for the getBalance scenario: vitalik.eth's main account. */
export const DEFAULT_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/** Fallback chain: Ethereum mainnet. */
export const DEFAULT_CHAIN = 1;

/**
 * Fallback contract for the readContract scenario: USDC on Ethereum
 * mainnet. Correct only for chain 1 — pass --address on other chains.
 */
export const DEFAULT_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

/** Timed requests per path per scenario. */
export const DEFAULT_ITERATIONS = 20;

/** Calldata for `name()` (ERC-20 metadata); works on any ERC-20 contract. */
export const NAME_CALLDATA = "0x06fdde03";

/** Supported benchmark scenarios. */
export const SCENARIOS = ["getBalance", "getBlockNumber", "readContract"];

/** Per-request timeout; a hung endpoint should not stall the script. */
const REQUEST_TIMEOUT_MS = 15000;

const USAGE = `用法: node scripts/benchmark.mjs --proxy <url> --rpc <url> [选项]

对比「直连上游 RPC」与「经 viem-proxy 代理」的同一读请求延迟，把 README
性能表变成你自己环境下可复现的数字（每路径先做 1 次不计入统计的预热）。

必选:
  --proxy <url>       viem-proxy Workers 端点，如 https://your-proxy.workers.dev
  --rpc <url>         直连对照用的上游 RPC URL（JSON-RPC POST）

可选:
  --chain <id>        链 ID（默认 ${DEFAULT_CHAIN}，Ethereum 主网）
  --key <API_KEY>     API 密钥（部署配置了 API_KEY 则必填，经 X-API-Key 头发送）
  --iterations <n>    每场景每路径的计时请求次数（默认 ${DEFAULT_ITERATIONS}，1~1000）
  --address <0x..>    getBalance 账户地址，默认 vitalik.eth 常用地址；readContract
                      场景同时将其作为合约地址（调用 name()）
  --scenario <list>   逗号分隔场景（默认 ${SCENARIOS.join(",")}）
  --json              输出机器可读 JSON（不含 API key）
  -h, --help          显示本帮助

场景与对照:
  getBalance      代理 POST /api/v1/{chain}/getBalance      vs  eth_getBalance
  getBlockNumber  代理 POST /api/v1/{chain}/getBlockNumber  vs  eth_blockNumber
  readContract    代理 POST /api/v1/{chain}/readContract    vs  eth_call（name()）
                  （readContract 默认使用主网 USDC 合约，仅链 ${DEFAULT_CHAIN} 有效；
                  其他链请用 --address 指定该链上的 ERC-20 合约）

报告: 每场景 P50/P95/P99/均值、X-Cache 命中率、首次（冷）vs 后续延迟、
      上游 RPC 调用节省估算。

退出码: 0 = 完成（个别请求失败会计入报告）；1 = 任一场景某条路径全部失败；
        2 = 参数错误`;

/**
 * Parse and validate a comma-separated scenario list.
 *
 * @returns {string[]} unique scenario names in the given order
 * @throws {Error} Chinese, user-facing message on empty input or unknown names
 */
export function parseScenarios(raw) {
  const names = String(raw)
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new Error(`--scenario 不能为空，可选值: ${SCENARIOS.join(", ")}`);
  }
  const unknown = names.filter((name) => !SCENARIOS.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `未知场景: ${unknown.join(", ")}（可选值: ${SCENARIOS.join(", ")}）`
    );
  }
  return [...new Set(names)];
}

/**
 * Parse CLI arguments. All options are flags (`--flag value` and
 * `--flag=value` both work); there is no positional argument.
 *
 * `--address` overrides both the getBalance account and the readContract
 * contract (with `name()` calldata). Throws an Error with a Chinese,
 * user-facing message on invalid input; validation is skipped when
 * `--help` is present so help never requires --proxy/--rpc.
 *
 * @returns {{ proxy?: string, rpc?: string, chain: number, key?: string,
 *             iterations: number, address: string, contract: string,
 *             scenarios: string[], json: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const options = {
    proxy: undefined,
    rpc: undefined,
    chain: DEFAULT_CHAIN,
    key: undefined,
    iterations: DEFAULT_ITERATIONS,
    address: DEFAULT_ADDRESS,
    // readContract target: the well-known USDC contract on mainnet, or the
    // --address value when one is given (see setValue below).
    contract: DEFAULT_CONTRACT,
    scenarios: [...SCENARIOS],
    json: false,
    help: false,
  };

  const setValue = (name, rawValue) => {
    if (name === "proxy" || name === "rpc") {
      options[name] = rawValue;
    } else if (name === "chain") {
      const chain = Number(rawValue);
      if (!Number.isInteger(chain) || chain <= 0) {
        throw new Error(`--chain 需要正整数链 ID，收到: ${rawValue}`);
      }
      options.chain = chain;
    } else if (name === "key") {
      options.key = rawValue;
    } else if (name === "iterations") {
      const iterations = Number(rawValue);
      if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) {
        throw new Error(`--iterations 需要 1~1000 的整数，收到: ${rawValue}`);
      }
      options.iterations = iterations;
    } else if (name === "address") {
      options.address = rawValue;
      // --address also retargets the readContract scenario (its calldata is
      // `name()`, so pass an ERC-20-like contract on the benchmarked chain).
      options.contract = rawValue;
    } else if (name === "scenario") {
      options.scenarios = parseScenarios(rawValue);
    } else if (name === "json") {
      options.json = rawValue === "" ? true : parseBool(name, rawValue);
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const inline = /^--(proxy|rpc|chain|key|iterations|address|scenario|json)=([\s\S]*)$/.exec(arg);
    if (inline) {
      setValue(inline[1], inline[2]);
      continue;
    }

    if (arg === "--proxy" || arg === "--rpc" || arg === "--chain" ||
        arg === "--key" || arg === "--iterations" || arg === "--address" ||
        arg === "--scenario") {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`${arg} 需要一个值，如 ${arg} 1`);
      }
      setValue(arg.slice(2), value);
      continue;
    }

    throw new Error(`未知参数: ${arg}（无位置参数，请用 --proxy/--rpc 指定端点）`);
  }

  if (!options.help) {
    options.proxy = requireHttpUrl(options.proxy, "--proxy");
    options.rpc = requireHttpUrl(options.rpc, "--rpc");
  }

  return options;
}

const parseBool = (name, rawValue) => {
  if (rawValue === "true" || rawValue === "") return true;
  if (rawValue === "false") return false;
  throw new Error(`${name} 是开关参数，不需要值（收到: ${rawValue}）`);
};

const requireHttpUrl = (value, name) => {
  if (value === undefined || value === "") {
    throw new Error(`缺少必选参数 ${name} <url>`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} 不是合法 URL: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} 必须以 http:// 或 https:// 开头: ${value}`);
  }
  return value;
};

/**
 * Join a base URL with path segments, tolerating trailing slashes (mirrors
 * the client's `${endpoint}/api/v1/...` shape).
 *
 * @returns {string} normalized URL string
 */
export function buildUrl(endpoint, ...segments) {
  const base = endpoint.replace(/\/+$/, "");
  return segments.length > 0 ? `${base}/${segments.join("/")}` : base;
}

/**
 * Nearest-rank percentile of a list of numbers. Input order does not
 * matter (a sorted copy is used); returns null for an empty list.
 *
 * @param {number[]} values
 * @param {number} p percentile in [0, 100]
 * @returns {number|null}
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil((p / 100) * sorted.length))
  );
  return sorted[rank - 1];
}

/**
 * Latency summary (milliseconds, rounded to 0.1) of successful samples.
 * Returns null when there are no samples so callers can distinguish
 * "path totally failed" from "0ms".
 *
 * @param {number[]} values
 * @returns {{count: number, min: number, max: number, mean: number,
 *            p50: number, p95: number, p99: number}|null}
 */
export function summarize(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  const round = (value) => Math.round(value * 10) / 10;
  return {
    count: values.length,
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    mean: round(total / values.length),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
  };
}

/**
 * Build the two request descriptors (proxy action POST + direct JSON-RPC
 * POST) for one scenario. Pure: no network, no I/O.
 *
 * `readContract` targets `options.contract` (USDC on mainnet by default,
 * the --address value when one was given); its calldata is `name()`.
 *
 * @param {{ proxy: string, rpc: string, chain: number, address: string,
 *           contract?: string }} options
 * @param {string} name scenario name
 * @returns {{ name: string, proxy: { url: string, body: string },
 *             direct: { url: string, body: string }, note: string }}
 */
export function buildScenarioRequests(options, name) {
  const { proxy, rpc, chain, address } = options;
  const contract = options.contract ?? DEFAULT_CONTRACT;
  const proxyUrl = buildUrl(proxy, "api/v1", String(chain), name);
  const jsonRpc = (method, params) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  if (name === "getBalance") {
    return {
      name,
      proxy: { url: proxyUrl, body: JSON.stringify({ address }) },
      direct: { url: rpc, body: jsonRpc("eth_getBalance", [address, "latest"]) },
      note: `地址 ${address}`,
    };
  }
  if (name === "getBlockNumber") {
    return {
      name,
      proxy: { url: proxyUrl, body: JSON.stringify({}) },
      direct: { url: rpc, body: jsonRpc("eth_blockNumber", []) },
      note: "",
    };
  }
  if (name === "readContract") {
    return {
      name,
      proxy: { url: proxyUrl, body: JSON.stringify({ address: contract, data: NAME_CALLDATA }) },
      direct: {
        url: rpc,
        body: jsonRpc("eth_call", [{ to: contract, data: NAME_CALLDATA }, "latest"]),
      },
      note: `合约 ${contract} · name()`,
    };
  }
  throw new Error(`未知场景: ${name}`);
}

/**
 * Derive the comparison numbers for one scenario run. Pure.
 *
 * hitRate is over successful proxy samples whose X-Cache status is known;
 * the upstream-RPC saving is an estimate: each proxy MISS is assumed to
 * cost exactly one upstream call, every direct call always does.
 *
 * @param {{ name: string, iterations: number,
 *           direct: { latencies: number[], errors: string[] },
 *           proxy: { latencies: number[], cacheStatuses: string[],
 *                    errors: string[] },
 *           firstProxyLatencyMs: number|null }} run
 */
export function aggregateScenario(run) {
  const directSummary = summarize(run.direct.latencies);
  const proxySummary = summarize(run.proxy.latencies);
  const statuses = run.proxy.cacheStatuses.filter((status) => status !== "-");
  const cacheHits = statuses.filter((status) => status.toUpperCase() === "HIT").length;
  const cacheMisses = statuses.length - cacheHits;
  const hitRate =
    statuses.length > 0 ? Math.round((cacheHits / statuses.length) * 1000) / 10 : null;

  const directCalls = run.iterations;
  // Without any X-Cache status (very old deployment / header stripped) the
  // upstream-call count is unknowable — report null instead of inventing
  // "100% saved" from an empty status list.
  const proxyUpstreamCalls = statuses.length > 0 ? cacheMisses : null;
  const savedPercent =
    statuses.length > 0 && directCalls > 0
      ? Math.round(((directCalls - cacheMisses) / directCalls) * 1000) / 10
      : null;

  const p50Improvement =
    directSummary && proxySummary && directSummary.p50 > 0
      ? Math.round(
          ((directSummary.p50 - proxySummary.p50) / directSummary.p50) * 1000
        ) / 10
      : null;

  return {
    name: run.name,
    iterations: run.iterations,
    direct: { summary: directSummary, errorCount: run.direct.errors.length },
    proxy: {
      summary: proxySummary,
      errorCount: run.proxy.errors.length,
      cacheHits,
      cacheMisses,
      hitRate,
    },
    firstProxyLatencyMs: run.firstProxyLatencyMs,
    subsequentMeanMs: proxySummary ? proxySummary.mean : null,
    savings: { directCalls, proxyUpstreamCalls, savedPercent },
    p50Improvement,
  };
}

const fmtMs = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}ms` : "-";
const fmtPct = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";

const renderTable = (headers, rows) => {
  const lines = [headers, rows.map((row) => row.map(() => "-"))];
  const width = headers.map((_, i) =>
    Math.max(...lines.map((line) => String(line[i]).length))
  );
  const render = (line) =>
    `| ${line.map((cell, i) => String(cell).padEnd(width[i])).join(" | ")} |`;
  return [
    render(headers),
    `|${width.map((w) => "-".repeat(w + 2)).join("|")}|`,
    ...rows.map(render),
  ];
};

/**
 * Render the Chinese human-readable report. Pure string building — never
 * touches the network. Scenarios with zero successful samples on a path
 * render that path's row as "全部失败" instead of numbers.
 *
 * @param {{ options: { proxy: string, rpc: string, chain: number,
 *             iterations: number, scenarios: string[], hasKey: boolean },
 *            scenarios: ReturnType<aggregateScenario>[] }} report
 * @returns {string} full report (no trailing newline)
 */
export function formatReport(report) {
  const { options, scenarios } = report;
  const out = [];
  out.push("🏁 viem-proxy 性能基准");
  out.push(`   代理端点: ${options.proxy}`);
  out.push(`   直连 RPC: ${options.rpc}`);
  out.push(
    `   链 ID: ${options.chain}    迭代: ${options.iterations}/场景    ` +
      `API key: ${options.hasKey ? "已配置" : "未配置"}`
  );
  out.push("");

  scenarios.forEach((scenario, index) => {
    const label = `${scenario.name}${scenario.direct.summary && scenario.proxy.summary ? "" : " ⚠️ 存在全部失败的路径"}`;
    out.push(`▶ 场景 ${index + 1}/${scenarios.length}: ${label}`);
    out.push(
      `   代理 POST /api/v1/${options.chain}/${scenario.name}` +
        `  vs  直连 JSON-RPC`
    );
    const row = (path, summary, errorCount) => [
      path,
      fmtMs(summary?.p50),
      fmtMs(summary?.p95),
      fmtMs(summary?.p99),
      fmtMs(summary?.mean),
      fmtMs(summary?.min),
      fmtMs(summary?.max),
      summary ? `${errorCount}/${scenario.iterations}` : `全部失败`,
    ];
    out.push(
      ...renderTable(
        ["路径", "P50", "P95", "P99", "均值", "最小", "最大", "失败"],
        [
          row("直连", scenario.direct.summary, scenario.direct.errorCount),
          row("代理", scenario.proxy.summary, scenario.proxy.errorCount),
        ]
      ).map((line) => `   ${line}`)
    );
    out.push(
      `   缓存命中: ${scenario.proxy.cacheHits}/${scenario.proxy.cacheHits + scenario.proxy.cacheMisses}` +
        `（${fmtPct(scenario.proxy.hitRate)}，HIT ${scenario.proxy.cacheHits} · MISS ${scenario.proxy.cacheMisses}）`
    );
    out.push(
      `   首次响应（冷）: ${fmtMs(scenario.firstProxyLatencyMs)}  →  后续均值: ${fmtMs(scenario.subsequentMeanMs)}`
    );
    out.push(
      `   上游 RPC 调用估算: 直连 ${scenario.savings.directCalls} 次 vs 代理 ` +
        `${scenario.savings.proxyUpstreamCalls === null ? "-" : `${scenario.savings.proxyUpstreamCalls} 次`}` +
        `（节省 ${fmtPct(scenario.savings.savedPercent)}）`
    );
    out.push("");
  });

  out.push("─".repeat(48));
  out.push("📊 汇总（P50 对比）");
  out.push(
    ...renderTable(
      ["场景", "直连 P50", "代理 P50", "提升"],
      scenarios.map((scenario) => [
        scenario.name,
        fmtMs(scenario.direct.summary?.p50),
        fmtMs(scenario.proxy.summary?.p50),
        scenario.p50Improvement === null
          ? "-"
          : `${scenario.p50Improvement.toFixed(1)}%`,
      ])
    ).map((line) => `   ${line}`)
  );
  out.push("   （提升 = (直连 P50 − 代理 P50) / 直连 P50；命中率高时提升主要来自 CDN 边缘缓存）");

  return out.join("\n");
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

/**
 * Run the benchmark against a deployed proxy and its upstream RPC.
 *
 * Per scenario: one untimed warmup request per path (the proxy warmup also
 * fills the cache and is recorded as the cold first response), then
 * `iterations` timed direct→proxy pairs. Only successful requests enter
 * the latency statistics; failures are counted and reported.
 *
 * @param {{ proxy: string, rpc: string, chain: number, key?: string,
 *           iterations: number, address: string, contract?: string,
 *           scenarios: string[] }}
 *   options (from parseArgs)
 * @param {{ fetch?: Function, now?: () => number,
 *           log?: (line: string) => void }} deps injectable fetch, clock
 *   and progress sink for tests
 * @returns {{ ok: boolean, scenarios: ReturnType<aggregateScenario>[] }}
 *   ok === false maps to exit code 1
 */
export async function runBenchmark(options, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => performance.now());
  const log = deps.log ?? ((line) => console.error(line));

  const baseHeaders = { "Content-Type": "application/json" };
  if (options.key) baseHeaders["X-API-Key"] = options.key;

  /** One timed request; network errors collapse into { error }. */
  const send = async (url, body) => {
    const startedAt = now();
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: baseHeaders,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return { error: describeFetchError(error) };
    }
    const latencyMs = now() - startedAt;
    const parsed = await safeJson(res);
    if (!res.ok || !parsed || parsed.error !== undefined || parsed.result === undefined) {
      const detail =
        parsed && parsed.error && typeof parsed.error.message === "string"
          ? `: ${parsed.error.message}`
          : parsed ? "（响应缺少 result）" : "";
      return { error: `HTTP ${res.status}${detail}`, latencyMs };
    }
    return {
      latencyMs,
      cache: res.headers?.get?.("x-cache") ?? "-",
    };
  };

  const scenarioRuns = [];

  for (let index = 0; index < options.scenarios.length; index++) {
    const name = options.scenarios[index];
    const requests = buildScenarioRequests(options, name);
    log(`▶ 场景 ${index + 1}/${options.scenarios.length}: ${name}（${options.iterations} 次迭代 × 2 路径）`);

    const run = {
      name,
      iterations: options.iterations,
      direct: { latencies: [], errors: [] },
      proxy: { latencies: [], cacheStatuses: [], errors: [] },
      firstProxyLatencyMs: null,
    };

    // Warmup (untimed): proxy first so the cache is warm for the timed run
    // and its latency becomes the "cold first response"; direct second to
    // absorb connection/TLS setup on the upstream path.
    const proxyWarmup = await send(requests.proxy.url, requests.proxy.body);
    if (proxyWarmup.error === undefined) {
      run.firstProxyLatencyMs = Math.round(proxyWarmup.latencyMs * 10) / 10;
    }
    await send(requests.direct.url, requests.direct.body);

    for (let i = 0; i < options.iterations; i++) {
      const direct = await send(requests.direct.url, requests.direct.body);
      if (direct.error === undefined) {
        run.direct.latencies.push(direct.latencyMs);
      } else {
        run.direct.errors.push(direct.error);
      }

      const proxy = await send(requests.proxy.url, requests.proxy.body);
      if (proxy.error === undefined) {
        run.proxy.latencies.push(proxy.latencyMs);
        run.proxy.cacheStatuses.push(proxy.cache);
        if (run.firstProxyLatencyMs === null) {
          // Warmup failed but timed requests succeed: fall back to the
          // first timed sample as the cold reference.
          run.firstProxyLatencyMs = Math.round(proxy.latencyMs * 10) / 10;
        }
      } else {
        run.proxy.errors.push(proxy.error);
      }
    }

    scenarioRuns.push(run);
  }

  const scenarios = scenarioRuns.map(aggregateScenario);
  const ok = scenarios.every(
    (scenario) => scenario.direct.summary !== null && scenario.proxy.summary !== null
  );
  return { ok, scenarios };
}

/**
 * Machine-readable view of a finished run. The API key never appears —
 * only whether one was configured.
 */
export const toJsonReport = (options, result) => ({
  tool: "viem-proxy benchmark",
  options: {
    proxy: options.proxy,
    rpc: options.rpc,
    chain: options.chain,
    iterations: options.iterations,
    address: options.address,
    contract: options.contract ?? null,
    scenarios: options.scenarios,
    hasKey: Boolean(options.key),
  },
  ok: result.ok,
  scenarios: result.scenarios,
});

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

  if (!options.json) {
    console.log("🏁 viem-proxy 性能基准（运行中，进度见 stderr）");
  }
  const result = await runBenchmark(options);

  if (options.json) {
    console.log(JSON.stringify(toJsonReport(options, result), null, 2));
  } else {
    console.log(
      formatReport({
        options: { ...options, hasKey: Boolean(options.key) },
        scenarios: result.scenarios,
      })
    );
  }

  if (!result.ok) {
    const broken = result.scenarios
      .filter(
        (scenario) => scenario.direct.summary === null || scenario.proxy.summary === null
      )
      .map(
        (scenario) =>
          `${scenario.name}（${scenario.direct.summary === null ? "直连" : "代理"}路径全部失败）`
      );
    console.error(`❌ 以下场景无法对比：${broken.join("、")}；详见上方报告中的失败计数`);
    return 1;
  }
  return 0;
}

// Run only when executed directly (node benchmark.mjs ...), not when
// imported by tests. exitCode (not process.exit) so stdout can flush.
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
