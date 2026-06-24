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

## 平台 artifact ref 只做通用脱敏但不做 allowlist

When:
- 平台 normalizer、collection service 或 persistence writer 要把 `artifact_ref` / `raw_artifact_ref` 暴露给 public payload、runner payload、step output 或 evidence summary。

Symptom:
- 普通 secret sanitizer 能删掉明显 Cookie/token 字段，但 path-safe 名称如 `raw_stdout_collector_transcript.json`、`raw-stdout-collector-transcript.json`、`collector_transcript` 或 `storage-state` 仍可能作为 artifact path 进入 public output 或被传给 runner。

Root cause:
- Artifact reference 是路径语义，不是普通字符串；只做递归 sanitizer 无法表达“只允许当前平台受控 artifacts 目录下的安全文件名”。

Apply:
- 每个平台必须有专用 artifact allowlist helper，并在所有入口复用：public request、runner output、content item、evidence summary、step output 和 persistence payload。
- Caller-controlled artifact ref 不能直接透传；只有通过平台 allowlist 后才允许进入 runner payload。

Verification:
- 测试同时覆盖 top-level artifact、content/evidence raw artifact、caller raw artifact，包含 `raw_stdout`、`raw-stdout`、`collector_transcript`、Cookie/token/storage marker、绝对路径、`..`、反斜杠、冒号、wrong prefix 和 safe path 保留。

## Public response 顶层 ID 净化但 nested object 仍泄露

When:
- FastAPI/Node adapter 把 worker/service 的 `run`、`step`、`report`、`backtest` 等子对象展开到 public response，同时又在顶层补 `agentLoopRunId`、`status` 或 summary 字段。

Symptom:
- 顶层 `agentLoopRunId` 已被强制为正整数，但 nested `run.id`、summary、nextRecommendation 或其他 allowlisted 子字段仍保留非正整数 ID、raw artifact path、stdout/stderr 文件名或 secret-like 字符串。

Root cause:
- 只净化派生出来的顶层字段，未重写原始子对象；递归 sanitizer 也不能替代字段白名单和类型约束。

Apply:
- Public response helper 必须先复制并白名单化 nested object，再重写 ID/status/summary 等 public 字段；ID 字段只允许 positive integer，必要时使用 path/request 中已验证过的 ID 作为 fallback。
- 对允许自由文本的字段，必须把通用 POSIX/Windows 路径、raw/stdout/stderr/trace/transcript/artifact 文件名视为 raw artifact/internal trace 风险。

Verification:
- Contract tests 同时断言 top-level `agentLoopRunId`、nested `run.id`、report/backtest summary、nextRecommendation；serialized public payload 不含非正整数 ID、secret markers、raw artifact paths、stdout/stderr 或 internal trace markers。
