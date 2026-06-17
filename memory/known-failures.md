# 已知失败模式

记录未来 agent loop 选择切片前必须检查的重复失败。

## 模板

```markdown
## <失败名称>

When:
- <什么时候出现>

Symptom:
- <表面现象>

Root cause:
- <根因>

Apply:
- <以后如何避免>

Verification:
- <如何验证修复>
```

## 临时 worktree 红测误用默认 Python runtime

When:
- 在临时 git worktree 中只应用测试补丁，运行 `test/fastapi-sidecar.test.js` 或 worker 相关 Node 测试做 TDD 红测。

Symptom:
- 大量测试同时失败，`spawnSync` status 为 `null`，或 Python stderr 显示缺少 `requests` / 找不到 `.venv/bin/python`。

Root cause:
- 临时 worktree 没有项目 `.venv`，测试默认 `PYTHON_BIN` 会解析到临时目录下不存在的 `.venv/bin/python` 或缺依赖 runtime，失败原因不是业务行为。

Apply:
- 临时 worktree 红测必须显式传入主仓库的绝对 `PYTHON_BIN=/Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor/.venv/bin/python`。
- 正常主仓库验证 worker 测试时也优先使用 `PYTHON_BIN=.venv/bin/python`。

Verification:
- 只有当旧实现下失败集中在新增断言或缺失接口上，才把它计为有效 RED；环境/依赖失败只能作为无效红测重跑。

## Adapter step output 只做递归脱敏但不白名单

When:
- 外部 runner、adapter 或 collection service 要把 `summary`、`output_json`、step audit payload 暴露给 public response 或 `agent_step_runs`。

Symptom:
- 顶层 stdout/stderr 被移除了，但 `summary.stdout`、`summary.raw_stdout`、未知诊断字段或 caller-controlled command 仍可能进入 step output。

Root cause:
- 递归 sanitizer 只能识别已知 key/value marker；外部 runner summary 是开放形状，不能只靠 sanitizer 当安全边界。

Apply:
- Step/public output 必须用字段白名单；runner command 必须 service-owned allowlist，不能从 public payload 透传；写 `agent_step_runs` 前必须校验 run/project ownership。

Verification:
- 测试同时覆盖 `summary.stdout`、caller `payload.command`、missing/cross-project `agentLoopRunId`、source-account-only/zero durable content partial。
