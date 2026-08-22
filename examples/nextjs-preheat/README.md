# Next.js 路由预热示例

`preheatCache` 的前置条件是「预知查询集」——静态列表人人会写，但真实项目里查询集随页面、
随用户地址变化，靠手工维护很快就会失真，结果就是这个 API 的真实使用率并不高。
本示例演示如何借框架的路由结构**自动收集预热集合**：路由定义本身就编码了
「这个页面需要哪些链上数据」，把两者对齐，预热就从一次性脚本变成可维护的模式。

典型场景：DApp **首屏**（服务端渲染前预热余额、合约元数据）与**路由切换前**
（用户悬停 / 预取链接时预热目标页的常用 `readContract`、余额查询），
让用户进入页面时命中的是 CDN 边缘缓存而不是冷回源。

> 本目录是**文档 + 可复制片段**，不是可运行的完整 Next 项目（避免脚手架膨胀）。
> 两个片段都可直接粘进你的项目，或用 `tsx` 单独运行 `build-time-preheat.ts`。

## 文件

| 文件 | 内容 |
|------|------|
| [`preheat-on-navigate.ts`](./preheat-on-navigate.ts) | 模式②：路由预取触发预热的钩子与辅助函数（App Router 为主，附 Pages Router 接法） |
| [`build-time-preheat.ts`](./build-time-preheat.ts) | 模式③：静态查询集的构建时/部署后预热脚本（独立 Node 脚本，`npx tsx` 直接跑） |
| `README.md` | 本文档：场景说明与三种集成模式 |

## 三种集成模式

### 模式①：页面级预热（getServerSideProps / 服务端组件）

在服务端渲染入口里调用 `preheatCache`（或片段中的 `preheatForRoute`），
SSR 在 Node 里执行，渲染前预热意味着 HTML 尚未下发、边缘缓存已经填好，
随后水合的客户端组件读到的全是缓存命中：

```typescript
// pages/portfolio.tsx (Pages Router)
export async function getServerSideProps() {
  await preheatCache([
    { action: 'getBalance', args: { address: '0xd8dA...' } },
    { action: 'getCode', args: { address: USDC } },
  ])
  return { props: {} }
}
```

适合「本页数据本页预热」的确定性场景；缺点是预热发生在请求时而非请求前，
收益上限是省掉组件级的重复回源，而非整段冷启动延迟。

### 模式②：路由预取钩子（推荐）

见 [`preheat-on-navigate.ts`](./preheat-on-navigate.ts)。核心结构：

1. `configureProxy({ endpoint, timeout, fallback: false })` 设置**模块级默认配置**，
   之后本模块所有 `preheatCache(requests)` 调用自动继承，无需逐处传 endpoint；
2. `ROUTE_PREHEAT: Record<string, PreheatRequest[]>` 把路由映射到查询集，
   与路由定义放在一起维护；
3. `preheatForRoute(pathname)` 在**用户表达导航意图的那一刻**（`<Link>` 悬停、
   `next/link` 预取窗口、`routeChangeStart` 事件）触发预热，带 25 秒去重窗口
   （恰好低于账户状态 30 秒 TTL：短时间重复悬停只预热一次，之后再悬停会刷新缓存）。

与 `next/link` 自身的预取是互补关系：`next/link` 预取的是**页面 JS 数据**，
这里预取的是**链上数据**——两者都命中时，路由切换完全无冷路径。

### 模式③：构建时 / 部署后预热静态查询集

见 [`build-time-preheat.ts`](./build-time-preheat.ts)。适用于冷启动流量高峰：
新版本发布、铸造/空投开启前，用 CI 部署后置步骤或 cron 把静态查询集灌进边缘缓存。

```bash
PROXY_ENDPOINT=https://proxy.example.com npx tsx examples/nextjs-preheat/build-time-preheat.ts
```

失败项以退出码 `1` 上报（预热永不抛错，脚本负责把 `failed` 计数转成 CI 信号）。

**TTL 诚实提示**：构建时预热只对 TTL 足以覆盖「预热到真实流量到达」间隔的查询有意义——
合约元数据（5 分钟 ~ 1 小时）、finalized 历史（30 天+）、`getChainId`（1 小时）是主力；
最新区块号（12 秒）与余额（30 秒）几乎立刻过期，只应在「预热紧贴流量高峰前」的
post-deploy 钩子里包含。完整 TTL 分档见根 README「🎯 缓存策略」表。

## 与 `configureProxy` 的配合

两个片段都只在模块加载时调用一次 `configureProxy(...)`（Partial 配置，可只传 endpoint），
之后：

- `preheatCache(requests)` 不传第二个参数 → 继承模块默认配置；
- `preheatCache(requests, { timeout: 1000 }, chainId)` → 调用点显式配置覆盖默认。

预热场景的两个推荐默认：`fallback: false`（回退直连 RPC 会烧上游配额却不预热任何缓存）、
`retryOptions` 保持轻量（预热幂等且不在请求路径上，构建时脚本给一次廉价重试即可）。

## 类型检查说明

`examples/` 不在根 `tsconfig.json` 的 `include`（仅 `src/**/*`）内，根包 `pnpm typecheck`
不会覆盖这两个片段。本目录交付时用独立 tsconfig + 最小桩模块（`react`、`next/navigation`
仅在仓库中不存在类型时声明）单独校验过：

```bash
npx tsc --noEmit -p /tmp/preheat-typecheck/tsconfig.json
# paths: viem-proxy → <repo>/src/index.ts, viem-proxy/actions → <repo>/src/actions/index.ts
```

片段本身按发布后的包名导入（`viem-proxy/actions`），粘入任意项目即可通过其自身类型检查。
