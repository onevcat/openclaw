# PATCH_REWRITE_NOTES

目标：把 `v2026.4.26..origin/onevcat/patches` 的补丁意图，按 upstream `v2026.4.29` 的结构/风格重写落地，并确保补丁自带测试所验证的行为仍然成立。

- Source patch range: `v2026.4.26..origin/onevcat/patches` (20 commits)
- Target base: `v2026.4.29`
- Working branch (local): `onevcat/rewrite-patches-v2026.4.29`
- Worktree: `/tmp/openclaw-rewrite-v2026.4.29`

## Outcome

- ✅ 已在 `v2026.4.29` 上落地（当前分支共有 19 个 patch commits；其中 1 个旧 commit 以“无需再存在/已被等价重写”方式 drop）。
- ✅ `pnpm install && pnpm build && pnpm ui:build` 通过。
- ✅ 最小回归测试集通过（覆盖 ACP client、exec PATH/PTy、TUI local shell、acpx runtime env、hooks callback、server hooks）。

## Per-commit mapping (original -> rewritten)

> 说明：大部分补丁在 `v2026.4.29` 上可以直接应用；冲突热点主要在 `docs/tools/exec.md`、`extensions/acpx/src/runtime.ts`、以及 Discord monitor/provider 的结构变化。

### 3fce5d71b7 feat(runtime): expose agent and session env markers via centralized helper

- 保留意图：提供统一 helper 来注入 `OPENCLAW_*` runtime markers，避免 spawn 点各自拼 env。
- 重写/调整点：
  - 解决与 upstream `docs/tools/exec.md` 新增说明的冲突：合并为“同时保留 channels login 限制 + 新增 env markers 的文档说明”。

### 0122d750a4 feat(hooks): add platform callback delivery

- 保留：新增 hook callback POST 回传能力（`hook-callback.ts` + hooks pipeline thread-through）。

### ec34b808d5 sec(hooks): harden callback URL validation and logging

- 保留：callback URL 安全校验（https-only，loopback 允许 http，禁止 credentials），并对 log URL 做 sanitize。

### 3e8e2e7c7a feat(agents): allow profile bootstrap symlinks to shared workspace

- 保留：profile workspace (`workspace-<name>`) 允许 bootstrap 文件 symlink 回 sibling `workspace/`，但仍保持 boundary 防护。

### a67b19784f Fix duplicate ACP Discord replies

- 保留：Discord/Telegram 的 ACP delivery 可见性判断调整，避免重复 final reply。

### e529cc4714 feat(hooks): support sticky session mode for hook agent runs

- 保留：hooks agent 支持 `sessionMode: sticky` 并映射到 `session:hook`。

### de9b214dfd fix: require terminal hook results for callbacks

- 保留：当 callback body 里声明 `requireTerminalHookResult` 时，必须从终端 block 解析 schema；缺失则 fail-closed。

### b990e56118 fix(acpx): define backend id locally for runtime compatibility

- 保留：acpx runtime backend id 兼容性修复。

### 9d060c00a1 feat(hooks): include outputText in callback payload

- 保留：callback payload 包含 `outputText` 支撑 terminal block parse。

### 35651dfed1 feat(runtime): inject OPENCLAW_SESSION_ID into child runtimes

- 保留：在 exec/acp-client/tui-local 等 child runtime 注入 `OPENCLAW_SESSION_ID`（与 sessionKey/agentId 并存）。

### 837a468f1d fix(patches): resolve v2026.4.8 type regressions

- 保留：对类型回归的兼容调整（在 `v2026.4.29` 上仍适用，且不会引入额外分歧）。

### 37c6f511cd fix(hooks): keep mapping dispatch session mode isolated

- 保留：mapping dispatch session mode 保持 isolated。

### 2e1475c49e Add oc-git-id checks to local git-hooks chain

- 保留：本地 git-hooks 串联 oc-git-id 检查。

### c23a15143b fix(acpx): restore OPENCLAW\_\* env injection for embedded runtime

- 保留：acpx runtime 在 ensureSession / runTurn 周期内 patch env 并在结束后 restore；并覆盖 async iteration 的稳定性。

### 0b79148b85 feat(acpx): prepend OpenClaw workspace bin to PATH for git identity

- 保留：acpx runtime 确保 `~/.openclaw/workspace/bin` 在 PATH 前置，以便 git identity wrapper/gh-guard 对子进程可见。
- 重写/调整点：
  - 与 upstream 同文件的 session mode assert 逻辑并存：`assertSupportedRuntimeSessionMode` 与 `ensureOpenClawBinInPath` 均执行，且顺序明确。

### 82058dfcc7 fix(discord): scope native skill commands by account

- 保留：
  - default Discord account -> 只扫描 default agent 的 skills
  - named accountId 匹配 agentId -> 只扫描该 agent 的 skills
  - 否则 fallback 全量扫描
- 重写/调整点（关键）：
  - upstream `v2026.4.29` 已经把 command spec 解析抽到 `extensions/discord/src/monitor/provider.commands.ts`。
  - 因此将“按 accountId 计算 agentIds 并传给 listSkillCommandsForAgents”的逻辑**移动到 provider.commands.ts**，并在 provider.ts 调用时传入 `accountId: account.accountId`。
  - 这样能最大化贴合 upstream 结构，减少未来冲突面。

### e4ba3573f8 fix(discord): reclaim command slot and log deploy diagnostics

- 保留：
  - 禁用 voice command 推送（释放 Discord command slots）
  - 增加 verbose 下的诊断日志（skill 数量/命令总数/最终部署数）
- 重写/调整点：
  - 由于本地已将“scoped agent ids”逻辑移动到 provider.commands.ts，诊断日志也一并放在 provider.commands.ts 里输出（更贴近 command resolution 的位置）。

### 4f787788bc chore(commands): disable unused base native commands

- 保留：注释掉部分 base native commands，释放 slots 给 per-skill commands。

### 7773e888ff test(exec): fix env marker mock outputs in path suite

- 保留：测试修复，确保 env marker mock 行为与实现一致。

### 659b6fa900 fix(discord): import default agent resolver from agent runtime

- 处理方式：**dropped**（不再作为独立 commit 保留）。
- 原因：
  - 在 `v2026.4.29` 的 upstream 结构下，provider.ts 不再直接需要 `resolveDefaultAgentId`。
  - 我们的重写实现改为在 `provider.commands.ts` 中使用 `plugin-sdk/config-runtime` 导出的 `resolveDefaultAgentId`，从而达到同样目标且更稳定。

## Validation

Executed in the worktree:

```bash
pnpm install
pnpm build
pnpm ui:build
pnpm vitest run \
  src/acp/client.test.ts \
  src/agents/bash-tools.exec.path.test.ts \
  src/agents/bash-tools.exec.pty.test.ts \
  src/agents/bash-tools.exec-runtime.test.ts \
  src/tui/tui-local-shell.test.ts \
  extensions/acpx/src/runtime.test.ts \
  src/gateway/hooks.test.ts \
  src/gateway/server.hooks.test.ts \
  src/gateway/hook-callback.test.ts
```
