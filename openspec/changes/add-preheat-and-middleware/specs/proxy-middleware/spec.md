# Delta: Proxy Middleware

## ADDED Requirements

### Requirement: Middleware Registration
The library SHALL provide a module-level middleware registry: `addMiddleware(middleware)` registers in order, `clearMiddlewares()` removes all, and `use(middleware)` on both the `proxyActions` extension object and `createPublicClient` clients SHALL register through the same registry. Middleware applies globally to every request sent through `makeProxyRequest`; batch POST requests do not pass through the chain (their serial fallback does).

#### Scenario: Register via the use extension method
```typescript
const seen: string[] = []
const ext = proxyActions(withProxy(client, { endpoint: "https://proxy.example.com" }))
ext.use(async (request, next) => {
  seen.push(request.functionName)
  return next(request)
})
await ext.getBalance({ address: "0x…" })
// seen === ["getBalance"]
```

#### Scenario: clearMiddlewares stops all interception
```typescript
const mw = vi.fn(async (request, next) => next(request))
addMiddleware(mw)
clearMiddlewares()
await ext.getBalance({ address: "0x…" })
// mw never called
```

### Requirement: Middleware Execution Semantics
`makeProxyRequest` SHALL wrap its actual send in the registered middlewares onion style: the first registered middleware forms the outermost layer, its `next` invokes the next registered middleware, and the innermost `next` performs the HTTP request. The request SHALL carry the proxy semantics `{ functionName, chainId, args }`; a middleware may replace any field, and the modified values SHALL drive URL construction, param compression and the GET/POST decision (and the strategy recorded in metrics). A middleware MAY short-circuit by returning its own `{ result }` or `{ error }` response without calling `next`. A middleware that throws SHALL abort the request: the error propagates out of `makeProxyRequest`, a failed metrics entry is recorded, and the caller follows the existing fallback/error path — blocking semantics, chosen over warn-and-skip for predictability. A middleware response carrying neither `result` nor `error` SHALL likewise be treated as a failure.

#### Scenario: Onion order with the first registered outermost
```typescript
const order: string[] = []
addMiddleware(async (req, next) => { order.push("outer:before"); const r = await next(req); order.push("outer:after"); return r })
addMiddleware(async (req, next) => { order.push("inner:before"); const r = await next(req); order.push("inner:after"); return r })
await ext.getBalance({ address: "0x…" })
// order === ["outer:before", "inner:before", "inner:after", "outer:after"]
```

#### Scenario: Modified request drives what is sent
```typescript
addMiddleware(async (request, next) => next({ ...request, chainId: 137 }))
await ext.getBalance({ address: "0x…" })
// fetch URL contains /api/v1/137/getBalance?p=…
```

#### Scenario: Short-circuit with an authored response
```typescript
addMiddleware(async () => ({ result: "0xdeadbeef" }))
const balance = await ext.getBalance({ address: "0x…" })
// balance === 0xdeadbeefn; fetch never called
```

#### Scenario: A throwing middleware aborts and falls back
```typescript
addMiddleware(async () => { throw new Error("blocked") })
const balance = await getBalance(fallbackClient, { address: "0x…" })
// the proxy request never went out; the direct RPC fallback answered
// exactly like a proxy failure would (failed metrics entry recorded)
```
