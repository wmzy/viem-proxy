# 贡献指南

感谢你为 viem-proxy 做贡献！本文帮助你快速搭建开发环境并了解项目约定。

## 开发环境

- **Node.js >= 18**（根目录 `package.json` 的 `engines` 约束）
- **pnpm**（仓库通过根目录 `package.json` 的 `packageManager: pnpm@10.9.0` 锁定版本，Corepack 会自动使用）
- Git

```bash
git clone https://github.com/wmzy/viem-proxy.git
cd viem-proxy
pnpm install
```

## 仓库结构（两个包）

| 包 | 路径 | 说明 |
|----|------|------|
| `viem-proxy` | 仓库根目录 | 客户端库（npm 包）：viem 兼容的代理 actions、`withProxy`、压缩传输层 |
| `viem-proxy-workers` | `workers/` | Cloudflare Workers 后端（**private，不发布到 npm**），有自己的 `pnpm-lock.yaml` |

两个包独立安装依赖、独立跑测试，修改哪个包就进入哪个目录操作。

## 常用命令

### 根目录（客户端库）

```bash
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint src
pnpm lint:fix      # eslint --fix
pnpm dev           # vite build --watch
pnpm build         # vite build（产出 dist/，请勿提交构建产物）
```

### workers/（后端子包）

```bash
cd workers
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm dev           # wrangler dev（本地 Workers 运行时）
pnpm deploy        # wrangler deploy（部署到 Cloudflare）
```

## 测试放置规范

- 新测试用例**优先追加到现有测试文件的现有 `describe` block**中，与相邻用例保持风格一致。
- 仅当新用例与所有现有文件的主题都完全不适配时才新建测试文件，并在文件头注释注明来源（对应的 change / 需求）与后续归并建议。
- CI（`.github/workflows/ci.yml`）会在两个包上分别跑 lint / typecheck / test / build，提交前请至少运行所修改包的 `pnpm typecheck` 与直接相关的 vitest 文件。

## 文档同步

- `README.md` 的「缓存策略」表格由 `workers/test/handlers.test.ts` 中的防漂移测试守护：修改 `workers/src/utils/cache.ts` 的 TTL 或该表格而不同步另一方，workers 测试会失败。
- 产品行为变更时同步更新 `README.md` 与 `PRD.md`，避免文档漂移。

## openspec 流程

功能性变更请通过 [openspec](https://github.com/Fission-AI/OpenSpec) 记录：

1. 在 `openspec/changes/` 下创建变更目录（kebab-case、动词开头，如 `add-batch-and-concurrency`），包含：
   - `proposal.md`：为什么改、改什么、影响面
   - `tasks.md`：实施清单，完成后逐项勾选
   - `specs/<capability>/spec.md`：spec delta，使用 `## ADDED/MODIFIED/REMOVED Requirements`，每个 Requirement 至少一个 `#### Scenario:`
2. 实现完成、`tasks.md` 全部勾选后，用 `npx openspec validate <change-id> --strict --no-interactive` 校验。

## 提交信息（Conventional Commits）

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
<type>(<scope>): <subject>

type: feat | fix | docs | style | refactor | perf | test | build | ci | chore
scope（可选）: client | workers | docs | ci ...
```

示例：`feat(client): add preheatCache action`、`fix(workers): cap per-chain RPC concurrency`、`docs: sync cache strategy table with cache.ts`。

## 提交 PR

1. 从 `main` 切出特性分支
2. 确保所修改包的 typecheck / 相关测试通过
3. PR 描述关联对应的 openspec change（如有）
4. CI 全绿后即可请求 review
