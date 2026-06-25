## Context

`haidao-fastapi-sidecar-harness` 已完成 FastAPI sidecar、health、Agent Loop run/status 和 legacy worker adapter。它把后续 Agent 主线从旧 Node/Python worker 切到了 FastAPI，但还没有真正运行 CrewAI。

PRD 要求的边界是：

```text
Agent 负责思考和提案。
Harness 负责证据、权限、状态机、审计和写回。
```

因此 CrewAI 接入不能成为第二个“能随意写库/读凭据/跑 worker”的后门。这个 change 只建立 proposal runtime：CrewAI 可以生成结构化建议，但所有写入、状态推进、证据校验、项目归属校验都由 FastAPI Harness 执行。

## Goals / Non-Goals

**Goals:**

- 在项目 Python 环境中接入 CrewAI adapter，但测试必须可用 fake runtime，无需真实 LLM。
- 定义稳定 proposal schema，区分 fact、inference、recommendation 和 write intent。
- CrewAI Agent 只能通过 allowlisted Harness tools 获取 scoped context、evidence summary 和 knowledge summary；proposal 只能作为 runtime adapter 的结构化返回值交给 Harness。
- Harness 拒绝无 evidence IDs、不存在 evidence IDs、跨 project evidence、schema invalid 和 tool not allowed 的 proposal。
- CrewAI runtime 失败时写入可审计 error/fallback record，不能静默成功。
- 保持旧 Node 服务、旧 worker 和现有 FastAPI sidecar endpoint 兼容。

**Non-Goals:**

- 不实现完整 Judge retry；Judge retry 在后续 `haidao-judge-agent-retry-loop` 上基于本 proposal contract 实现。
- 不接 React/Vite 工作台。
- 不调用真实微博 Cookie、真实 MediaCrawler 或真实 Chrome CDP。
- 不要求真实 DeepSeek 调用；DeepSeek 可在后续 agent task 中作为模型配置，但本 change 的自动测试使用 fake runtime。
- 不让 CrewAI 直接写 MySQL、读 `.env`、读 Cookie 或调用任意旧 worker 命令。
- 不自动执行外部发布或现实宣发动作。

## Architecture

```text
FastAPI endpoint/service
  -> CrewAIRuntimeAdapter
      -> CrewAI Flow/Agent 或 FakeCrewRuntime
      -> HarnessToolGateway (allowlisted tools only)
          -> read evidence summaries / knowledge summaries / loop context
      <- structured proposal
  -> ProposalValidator
      -> schema validation
      -> evidence existence and project ownership checks
      -> permission boundary checks
  -> Harness write decision
      -> mandatory accepted proposal record / rejected proposal record / error record
```

首版可以先实现 service 层和测试注入，不必马上暴露公开前端入口。若新增 HTTP endpoint，应放在 FastAPI sidecar 下，例如：

```text
POST /api/weibo/agent-runs/{id}/crewai/proposals
GET  /api/weibo/agent-runs/{id}/crewai/proposals/{proposal_id}
```

endpoint 的输入只能包含 project/run/task/stage 和可选 evidence scope，不包含 prompt 原文、cookie、模型密钥或任意文件路径。

## Proposal Contract

最小 proposal 对象：

```json
{
  "proposal_type": "comment_analysis | event_draft | strategy_action | report_note | memory_note",
  "project_id": 2,
  "agent_loop_run_id": 10,
  "agent_name": "Strategy Agent",
  "stage": "strategy",
  "facts": [{"text": "...", "evidence_ids": ["comment:123"]}],
  "inferences": [{"text": "...", "confidence": "low|medium|high", "evidence_ids": ["comment:123"]}],
  "recommendations": [{"text": "...", "risk_notes": ["..."], "evidence_ids": ["event:7"]}],
  "write_intent": "proposal_only",
  "knowledge_card_ids": [5],
  "raw_model_output_ref": null
}
```

要求：

- `write_intent` 首版只能是 `proposal_only`。
- 所有 facts/inferences/recommendations 如果声称基于事实，必须有 evidence IDs。
- `knowledge_card_ids` 可以支持建议，但不能替代真实 evidence。
- 模型数值、权重、趋势窗口、回测结论不能直接作为事实写入。
- raw model output 不进入 public response；如需保存，只保存引用或脱敏摘要。

## Tool Boundary

CrewAI tools 必须由 Harness 包装，例如：

- `get_loop_context(run_id, project_id)`
- `get_evidence_summary(evidence_ids, project_id)`
- `search_knowledge_cards(query, project_id)`

CrewAI 不获得 `submit_proposal` 工具。CrewAI runtime 的返回值由 `CrewAIRuntimeAdapter` 接收，再交给 Harness-owned `ProposalValidator` 和 `ProposalRecorder`。也就是说，提交、校验和审计写入是 Harness adapter 边界的一部分，不是 CrewAI 可调用工具。

禁止：

- `open(path)` 或任意文件读写。
- 读取 `.env`、`config/cookies/weibo.json`、浏览器 state、真实 Cookie/token。
- 直接导入 `workers.db` 并写库。
- 直接调用旧 worker 任意命令。
- 直接调用 proposal recorder 或绕过 Harness validation 提交 proposal。
- 直接使用真实外部 API 作为测试必要条件。

## Audit Persistence Boundary

首版允许 proposal 只写入审计/提案记录，不写事实表。无论 proposal 被接受、拒绝或 runtime 失败，Harness 都必须留下可追踪记录：

- accepted proposal record：schema、evidence ownership 和权限校验通过，但仍只是待后续 Judge/Harness 使用的提案。
- rejected proposal record：记录 `error_type`、拒绝原因、输入摘要和 evidence 校验结果。
- error record：记录 runtime/tool/schema 失败类型和脱敏错误摘要。

禁止只把 accepted proposal 返回给调用方而不落审计记录。若未来需要 dry-run 模式，必须另开显式 `dry_run=true` contract，并在响应中标记不持久化；本 change 默认不实现 dry-run。

## Failure Handling

CrewAI runtime 或 tool 调用失败时：

- FastAPI 返回稳定 `error_type`，例如 `crewai_runtime_failed`、`crewai_tool_not_allowed`、`crewai_invalid_proposal`、`crewai_evidence_rejected`。
- 失败进入 Agent Loop step/error record 或 proposal rejection record。
- 不把 traceback、stderr、prompt、API key、DB URL、Cookie 路径暴露到 public payload。
- 如果 fake runtime 不可用，测试应失败；如果真实 CrewAI 包未安装，运行时应返回 dependency error，而不是 import-time 崩溃。

## Verification Strategy

- 单元测试：proposal schema validation、无 evidence 拒绝、跨 project evidence 拒绝、write_intent 非 proposal_only 拒绝。
- adapter 测试：fake CrewAI runtime 返回 proposal，Harness validator 接受或拒绝。
- audit 测试：accepted、rejected 和 runtime error 都产生 proposal audit record；invalid submit attempt 不产生 accepted record。
- 安全测试：工具白名单；禁止 `.env`、Cookie、DB URL、worker stderr 出现在响应。
- FastAPI contract 测试：MySQL unavailable、invalid payload、runtime failed、accepted proposal response。
- 回归测试：`npm test`、真实 MySQL test、OpenSpec strict、`git diff --check`、`npm run agent:guard`。
