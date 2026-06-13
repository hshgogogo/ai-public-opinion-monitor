# Codex Agent Loop Hooks

本目录保存项目 agent loop 的机械 guardrail。它们不是替代文档，而是用脚本拦住高风险动作。

## 当前 Guard

`pre_tool_use_guard.mjs` 设计用于 Codex `PreToolUse` hook。它会阻止：

- 在 `main` 或 `master` 上 `git commit`
- push 到 `main` 或 `master`
- 未经人工确认的 PR merge / git merge
- 生产 deploy / release 命令
- 过宽或疑似包含密钥的 `git add`
- 通过 git 或 shell 查看明显的 `.env`、Cookie、token、secret 材料

它会有意放行：loop 验证通过后的普通 feature branch commit、feature branch push、PR 创建或更新。

## 手动 Guard

运行：

```bash
npm run agent:guard
```

它会检查当前分支、疑似密钥变更文件、以及必要的 agent-loop 指导文件。

## Hook Trust

Codex 可能会在新项目首次运行时要求 review/trust hooks。只有确认脚本仍符合本项目策略后，才信任这些 hooks。
