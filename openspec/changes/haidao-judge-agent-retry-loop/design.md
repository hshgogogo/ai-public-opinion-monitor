## Context

`haidao-agent-harness-loop-foundation` 已经提供 `agent_loop_runs`、`agent_step_runs`、`judge_reviews` 和 `feedback_items`。`haidao-agent-loop-step-attachment` 已允许现有微博 worker 命令在显式 `agentLoopRunId` 下写入 step evidence。`haidao-knowledge-card-rag-mvp` 已让行动建议和 Q&A 能引用知识卡，并明确知识卡不能替代真实微博证据。

本 change 在这些基础上补齐 Judge retry 编排。它仍在现有 Node + Python worker + MySQL 架构内实现，不引入 FastAPI/CrewAI/React，不新增公开 HTTP endpoint。

## Goals / Non-Goals

**Goals:**

- 为微博分析、事件生成和行动建议 step 提供统一 Judge review。
- 对缺失证据、不存在 evidence ID、空泛建议、数值指标越权、知识卡误用、因果过度表述等问题返回 failed review。
- 失败时把 required changes、evidence errors、失败输出摘要和 retry count 写入 `judge_reviews`。
- 最多执行 3 次总尝试；第 3 次仍失败时将 step/loop 标为 `needs_human` 并创建人工处理记录。
- 通过 review 时记录 passed review，但 Judge 不覆盖事实表、事件表或行动表。
- 提供 fixture/fake 路径，使本地和真实 MySQL 测试可验证完整 retry 语义。

**Non-Goals:**

- 不实现真实 CrewAI runtime。
- 不调用真实 MediaCrawler 或真实微博登录。
- 不强制 DeepSeek live call；可用 fixture/fake output 测试。
- 不新增前端控件或 public HTTP API。
- 不把 Q&A、Report 或 Backtest 接入 Judge retry；这些属于后续 change。
- 不让 Judge 决定情感分数、事件分数、趋势窗口或 backtest signal 等确定性数值。
- 不让 Judge 自动确认现实宣发动作。

## Decisions

### 1. 先做规则化 Judge，再接 LLM Judge

首版 Judge 是 Harness 里的确定性检查器，命名为 `Rule Judge Agent` 或等价 worker helper。它检查可验证结构与边界：

- 输出是否有 evidence IDs。
- evidence IDs 是否存在于当前 project 的目标、评论、分析、事件、行动或 memory。
- `knowledge_references` 中的知识卡引用是否存在且有效。
- 分析/事件/行动的必填字段是否存在。
- 行动建议是否空泛，是否没有 owner/priority/check-after/evidence。
- 知识卡引用是否 active、未命中禁用条件、C 级来源是否只作为 weak inspiration。
- 行动建议是否至少包含一个真实项目 evidence ID；`knowledge-card-*` 只能作为 `knowledge_references`，不能单独证明当前微博观察事实。
- 文案是否把知识卡、推断、建议写成当前微博事实。
- 文案是否把 backtest/动作效果说成单因果结论。

LLM Judge 或 CrewAI Judge 后续可以作为另一个 reviewer 接入，但首版必须本地可测、可复现。

### 2. Judge retry 是 worker-only orchestration

新增 worker-only 命令建议：

```text
weibo-agent-loop-judge-run
```

payload 示例：

```json
{
  "projectId": 1,
  "agentLoopRunId": 12,
  "stepRunId": 34,
  "maxAttempts": 3,
  "fixtureOutputs": [
    {"output": {"evidence_ids": []}},
    {"output": {"evidence_ids": ["comment-1"], "summary": "仍然空泛"}},
    {"output": {"evidence_ids": ["comment-1"], "summary": "有证据、有边界"}}
  ]
}
```

实现可以先支持 fixture/fake output retry，用于验证状态机；下一步再把它包到真实 `weibo-comments-analyze` / `weibo-events-build` / `weibo-actions-build` 调用链中。`weibo-bot-message` 不在本 change 接入。

术语固定为：

- `maxAttempts=3` 表示最多 3 次总尝试，不是初始尝试后再额外重试 3 次。
- `retry_count` 表示写入当前 review 前已经失败的尝试次数。
- 第 1 次 review 写 `retry_count=0`；第 2 次写 `retry_count=1`；第 3 次写 `retry_count=2`。
- 调用方传入 `maxRetries` 时只能作为兼容别名解释为 `maxAttempts`，并 clamp 到 3。

### 3. 重试记录不覆盖事实表

每轮失败 MUST 追加一条 `judge_reviews`，包含：

- `loop_run_id`
- `step_run_id`
- `status = failed` 或 `needs_human`
- `passed = false`
- `retry_count`
- `feedback_json`
- `required_changes`
- `evidence_errors`

如果最后通过，追加 `status = passed`、`passed = true` 的 review。Judge 不直接更新 `sentiment_results`、`artist_public_opinion_events` 或 `publicity_actions` 的事实内容；它只更新 step/loop 状态和 review/handoff 账本。

本 change 的质量门是 post-write review：前序 worker 可能已经把候选分析、事件或行动建议写入业务表。Judge 失败时不得删除、覆盖或改写这些事实字段，但 MUST 把对应 step 标为未接受/failed 或 `needs_human`，让 Agent Loop、状态查询和后续工作台不能把该 step 当作 accepted output。

### 4. 第 3 次总尝试失败进入人工处理

`maxAttempts` 默认 3，允许测试传入更小值但不得超过 3。达到上限后：

- 对应 step status 更新为 `needs_human`。
- loop status 更新为 `needs_human`，current step 指向 `judge_review` 或原 step。
- 写入 `feedback_items`，`source_type='judge_review'` 或 `source_type='step'`，`feedback_type='manual_handoff'`，note 包含失败摘要和下一步建议。
- 人工处理记录必须校验 `agent_loop_runs`、`agent_step_runs`、`judge_reviews` 和 handoff source 均属于当前 project；不得复用会绕过 source/project ownership 的弱校验路径。
- 查询 run 状态时能看到 failed reviews、retry_count 和 handoff。

### 5. Evidence ID 格式

首版支持已有系统使用的 citation 形状：

- `target-<id>`
- `post-<id>`
- `comment-<id>`
- `analysis-<id>`
- `event-<id>`
- `action-<id>`
- `memory-<id>`

Judge helper 只校验当前 project 下可查到的 ID。对无法识别的前缀或不存在的 ID，记录 `evidence_errors`。`analysis-<id>` 指向 `sentiment_results.id`；本 change 不引入 `sentiment-<id>` 别名，避免 citation 契约分裂。

知识卡引用使用独立字段，例如 `knowledge_references: ["knowledge-card-<id>"]`。Judge 会校验知识卡是否 active、可信度和禁用条件，但 `knowledge-card-*` 不属于真实微博 evidence，不能单独满足分析、事件或行动建议的 evidence 要求。

### 6. 安全输出

Judge review、handoff、status payload 不得暴露：

- `.env`
- Cookie/token/API key
- `config/cookies/weibo.json`
- worker stderr
- 内部 raw JSON 长正文
- 未脱敏外部账号凭据

失败输出可保存结构化摘要和字段名，但不保存 secret 或真实 cookie 值。

## Risks / Trade-offs

- [Risk] 规则化 Judge 可能误判语义质量。
  Mitigation: 首版只检查可确定的证据、结构和边界，语义质量问题记录为 required changes；后续再接 LLM Judge。

- [Risk] retry 编排可能重复写业务表。
  Mitigation: 首版 fixture/fake retry 只更新 step output 和 review 账本；对真实业务命令的 retry 必须复用已有 upsert/idempotency。

- [Risk] 失败输出保存过多 raw payload。
  Mitigation: 保存摘要和白名单字段；测试扫描 public/status payload 不含禁用词。

- [Risk] 第 3 次总尝试失败后任务卡住。
  Mitigation: 明确写入 `feedback_items`，让前端/后续工作台能展示需人工处理。

## Migration Plan

默认复用现有 `judge_reviews.retry_count`、`feedback_items` 和 `agent_step_runs.output_json/error_*`。实现前先写测试判断是否需要新增字段。

如果需要保留失败输出摘要，优先写入 `judge_reviews.feedback_json.failed_output_summary`，避免新增 migration。只有当真实 MySQL 无法表达必须字段时，才新增 MySQL-safe migration，且必须可连续运行两遍。

## Verification Strategy

- 静态测试：OpenSpec 任务和 worker 文本不得引入 public Judge endpoint、CrewAI runtime、真实微博/Cookie 调用。
- 规则测试：无 evidence、错误 evidence ID、空泛建议、禁用知识卡、C 级硬规则、数值越权分别被 Judge 拒绝。
- Retry 测试：失败两轮后第三轮通过，写入 2 条 failed review + 1 条 passed review，loop 最终不进入人工处理。
- Exhaustion 测试：连续 3 次总尝试失败后 step/loop `needs_human`，创建 handoff。
- 真实 MySQL 测试：migration 后运行 worker-only retry 命令，查询 `judge_reviews`、`agent_step_runs`、`agent_loop_runs`、`feedback_items`。
- 常规验证：`npm test`、真实 MySQL `npm test`、`openspec validate haidao-judge-agent-retry-loop --strict`、`git diff --check`、`npm run agent:guard`。
