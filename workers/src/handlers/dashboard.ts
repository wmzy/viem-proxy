import type { Context } from "hono";
import type { Env } from "../types";

/**
 * GET /dashboard — self-contained statistics dashboard page.
 *
 * A single inline HTML document (style + script embedded, zero external
 * assets) that renders GET /api/v1/stats in a browser: summary cards
 * (requests, cache hit rate, error rate, average upstream latency), a
 * per-hour bar chart switchable across count/errorCount/p50/p95/p99, the
 * bucket table, chainId/method filters, a 24h/7d window toggle and an
 * optional 30s auto-refresh. All requests are issued by the visitor's own
 * browser against the same origin, so the stats endpoint keeps its
 * existing auth rules — when an API key is configured the page surfaces a
 * hint (and an optional key field sent as X-API-Key) instead of weakening
 * the endpoint.
 *
 * The page itself carries no data and is registered in PUBLIC_API_PATHS
 * and RATE_LIMIT_EXEMPT_PATHS like the other read-only monitoring
 * surfaces (utils/auth.ts, utils/rate-limit.ts).
 *
 * Inline-script note: the embedded JS deliberately avoids template
 * literals so the whole document can live in one TypeScript template
 * literal without escaping backticks or "${".
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>viem-proxy 统计仪表盘</title>
<style>
  :root {
    --bg: #f4f6f9; --card: #ffffff; --ink: #1f2937; --muted: #6b7280;
    --line: #e5e7eb; --accent: #2563eb; --accent-soft: #dbeafe;
    --bad: #dc2626; --ok: #059669;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  #stats-container { max-width: 1080px; margin: 0 auto; padding: 20px 16px 40px; }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 15px; margin: 0; }
  .muted { color: var(--muted); font-size: 12px; }
  .controls {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    padding: 10px; margin-bottom: 12px;
  }
  .controls input[type="text"], .controls input[type="password"] {
    border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font: inherit; width: 190px;
  }
  #chain-filter { width: 130px; }
  .controls button { font: inherit; cursor: pointer; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; background: var(--card); padding: 6px 12px; color: var(--muted); }
  .seg button.active { background: var(--accent); color: #fff; }
  #refresh-btn {
    border: 1px solid var(--accent); background: var(--accent); color: #fff;
    border-radius: 6px; padding: 6px 14px;
  }
  .switch { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
  .banner { border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; border: 1px solid; }
  .banner.hint { background: #fffbeb; border-color: #f59e0b; color: #92400e; }
  .banner.error { background: #fef2f2; border-color: var(--bad); color: #7f1d1d; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 12px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .card .k { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .card .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-bottom: 12px; }
  .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 8px; }
  #metric-select { border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; font: inherit; }
  .chart { height: 220px; display: flex; align-items: stretch; gap: 2px; }
  .chart .empty { align-self: center; margin: 0 auto; color: var(--muted); }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; height: 100%; }
  .bar-area { flex: 1; display: flex; align-items: flex-end; }
  .bar { width: 100%; min-height: 2px; background: var(--accent); border-radius: 2px 2px 0 0; position: relative; }
  .bar .err { position: absolute; top: 0; left: 0; right: 0; background: var(--bad); border-radius: 2px 2px 0 0; }
  .xlab { font-size: 10px; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; margin-top: 3px; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--muted); font-weight: 500; font-size: 12px; }
  td.bad { color: var(--bad); font-weight: 600; }
  .empty-cell { text-align: center; color: var(--muted); }
  footer { margin-top: 6px; }
  code { background: var(--accent-soft); border-radius: 4px; padding: 1px 4px; font-size: 12px; }
</style>
</head>
<body>
<div id="stats-container">
  <header>
    <h1>viem-proxy 统计仪表盘</h1>
    <span id="updated-at" class="muted"></span>
  </header>

  <section class="controls">
    <div class="seg" id="hours-toggle" role="group" aria-label="时间窗口">
      <button type="button" data-hours="24" class="active">近 24 小时</button>
      <button type="button" data-hours="168">近 7 天</button>
    </div>
    <input type="text" id="chain-filter" placeholder="chainId 过滤，如 1" inputmode="numeric" aria-label="按 chainId 过滤">
    <input type="text" id="method-filter" placeholder="method 过滤，如 getBalance" aria-label="按 method 过滤">
    <input type="password" id="key-input" placeholder="API Key（可选）" aria-label="API Key">
    <button type="button" id="refresh-btn">刷新</button>
    <label class="switch"><input type="checkbox" id="auto-refresh">每 30 秒自动刷新</label>
  </section>

  <div id="auth-hint" class="banner hint" hidden>
    <code>/api/v1/stats</code> 已启用 API_KEY 鉴权（当前返回 401）。在上方「API Key」输入框填入密钥后点击刷新即可：
    密钥只保存在本页面内存中，仅作为 <code>X-API-Key</code> 请求头发送，不会写入 URL 或任何存储。
  </div>
  <div id="error-banner" class="banner error" hidden></div>

  <section id="summary-cards" class="cards" aria-label="汇总指标">
    <div class="card"><div class="k">总请求数</div><div class="v" id="total-requests">—</div></div>
    <div class="card"><div class="k">缓存命中率</div><div class="v" id="cache-hit-rate">—</div></div>
    <div class="card"><div class="k">错误率</div><div class="v" id="error-rate">—</div></div>
    <div class="card"><div class="k">平均上游延迟</div><div class="v" id="avg-latency">—</div></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>时序分布（按 UTC 小时分桶）</h2>
      <select id="metric-select" aria-label="图表指标">
        <option value="count" selected>请求数</option>
        <option value="errorCount">错误数</option>
        <option value="p50">p50 延迟 (ms)</option>
        <option value="p95">p95 延迟 (ms)</option>
        <option value="p99">p99 延迟 (ms)</option>
      </select>
    </div>
    <div id="stats-chart" class="chart"><div class="empty">暂无数据</div></div>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>分桶明细</h2></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间桶 (UTC)</th><th>请求数</th><th>错误数</th>
            <th>p50 (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th>
          </tr>
        </thead>
        <tbody id="stats-table-body"></tbody>
      </table>
    </div>
  </section>

  <footer class="muted">
    数据来自 <code>/api/v1/stats</code>（按其现有规则鉴权与限流）；本页面全部脚本与样式内联，无任何外部网络依赖。
  </footer>
</div>

<script>
(function () {
  "use strict";
  var REFRESH_MS = 30000;
  var state = { hours: 24, data: null, timer: null };

  function el(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function fmtInt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function fmtMs(v) { return v == null ? "—" : Number(v).toFixed(1); }
  function fmtBucket(bucket) { return String(bucket).replace("T", " ").slice(0, 16); }

  var METRICS = {
    count: { label: "请求数", pick: function (p) { return p.count; } },
    errorCount: { label: "错误数", pick: function (p) { return p.errorCount; } },
    p50: { label: "p50 (ms)", pick: function (p) { return p.p50; } },
    p95: { label: "p95 (ms)", pick: function (p) { return p.p95; } },
    p99: { label: "p99 (ms)", pick: function (p) { return p.p99; } }
  };

  function showAuthHint() {
    el("auth-hint").hidden = false;
    el("error-banner").hidden = true;
  }
  function showError(message) {
    el("error-banner").textContent = "加载统计失败：" + message;
    el("error-banner").hidden = false;
    el("auth-hint").hidden = true;
  }
  function clearNotices() {
    el("auth-hint").hidden = true;
    el("error-banner").hidden = true;
  }

  function renderSummary(data) {
    el("total-requests").textContent = fmtInt(data.totalRequests);
    el("cache-hit-rate").textContent = (Number(data.cacheHitRate || 0) * 100).toFixed(2) + "%";
    el("error-rate").textContent = (Number(data.errorRate || 0) * 100).toFixed(4) + "%";
    el("avg-latency").textContent = Number(data.averageResponseTime || 0).toFixed(1) + " ms";
  }

  function renderChart(periods) {
    var chart = el("stats-chart");
    if (!periods.length) {
      chart.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    var metric = METRICS[el("metric-select").value] || METRICS.count;
    var max = 0;
    periods.forEach(function (p) {
      var v = Number(metric.pick(p) || 0);
      if (v > max) max = v;
    });
    // Thin out x labels when there are many buckets, else they collide.
    var labelEvery = periods.length <= 24 ? 1 : Math.ceil(periods.length / 12);
    var html = "";
    periods.forEach(function (p, i) {
      var v = Number(metric.pick(p) || 0);
      var height = max > 0 ? Math.max(2, (v / max) * 100) : 0;
      // For the count metric, mark the error share as a red cap on the bar.
      var errSeg = "";
      if (metric === METRICS.count && p.count > 0 && p.errorCount > 0) {
        errSeg = '<div class="err" style="height:' +
          Math.min(100, (p.errorCount / p.count) * 100).toFixed(1) + '%"></div>';
      }
      var lab = i % labelEvery === 0 ? esc(fmtBucket(p.bucket).slice(6)) : "";
      html += '<div class="col" title="' + esc(fmtBucket(p.bucket)) + " · " + esc(metric.label) + ": " + esc(v) + '">' +
        '<div class="bar-area"><div class="bar" style="height:' + height.toFixed(1) + '%">' + errSeg + "</div></div>" +
        '<div class="xlab">' + lab + "</div></div>";
    });
    chart.innerHTML = html;
  }

  function renderTable(periods) {
    var rows = "";
    periods.forEach(function (p) {
      rows += "<tr><td>" + esc(fmtBucket(p.bucket)) + "</td>" +
        "<td>" + fmtInt(p.count) + "</td>" +
        '<td class="' + (p.errorCount > 0 ? "bad" : "") + '">' + fmtInt(p.errorCount) + "</td>" +
        "<td>" + fmtMs(p.p50) + "</td><td>" + fmtMs(p.p95) + "</td><td>" + fmtMs(p.p99) + "</td></tr>";
    });
    el("stats-table-body").innerHTML =
      rows || '<tr><td colspan="6" class="empty-cell">暂无数据</td></tr>';
  }

  function render(data) {
    state.data = data;
    clearNotices();
    renderSummary(data);
    renderChart(data.periods || []);
    renderTable(data.periods || []);
    el("updated-at").textContent = "更新于 " + new Date().toISOString().slice(11, 19) + " UTC";
  }

  function load() {
    var params = new URLSearchParams();
    params.set("hours", String(state.hours));
    var chain = el("chain-filter").value.trim();
    var method = el("method-filter").value.trim();
    if (chain) params.set("chainId", chain);
    if (method) params.set("method", method);
    var headers = {};
    var key = el("key-input").value.trim();
    if (key) headers["X-API-Key"] = key;

    fetch("/api/v1/stats?" + params.toString(), { headers: headers })
      .then(function (res) {
        if (res.status === 401) throw { auth: true };
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        if (err && err.auth) showAuthHint();
        else showError(err && err.message ? err.message : "网络错误");
      });
  }

  function setAutoRefresh(on) {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (on) state.timer = setInterval(load, REFRESH_MS);
  }

  var seg = el("hours-toggle");
  seg.querySelectorAll("button").forEach(function (button) {
    button.addEventListener("click", function () {
      seg.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
      button.classList.add("active");
      state.hours = parseInt(button.getAttribute("data-hours"), 10);
      load();
    });
  });
  ["chain-filter", "method-filter", "key-input"].forEach(function (id) {
    el(id).addEventListener("keydown", function (e) {
      if (e.key === "Enter") load();
    });
  });
  el("refresh-btn").addEventListener("click", load);
  el("metric-select").addEventListener("change", function () {
    if (state.data) renderChart(state.data.periods || []);
  });
  el("auto-refresh").addEventListener("change", function (e) {
    setAutoRefresh(e.target.checked);
  });

  load();
})();
</script>
</body>
</html>
`;

/**
 * Serve the dashboard shell. Static and credential-free by design: the
 * page renders whatever /api/v1/stats allows the visitor to read.
 */
export const handleDashboardRequest = async (
  c: Context<{ Bindings: Env }>
): Promise<Response> => c.html(DASHBOARD_HTML);
