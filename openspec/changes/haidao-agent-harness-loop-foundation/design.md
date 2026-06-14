## 背景

已归档的 `haidao-weibo-agent-mvp` change 证明了微博垂直链路：发现、目标选择、详情评论、分析、事件、行动建议、记忆、报告和问答。新的 PRD 要求增加 Agent Harness，用 run state、Judge review、重试、反馈，以及后续 CrewAI/FastAPI/React 迁移来监督这条链路。

本 change 刻意只从账本和契约基础开始。目标是在不替换现有 Node/Python 架构的前提下，让当前系统更可审计。

## 设计

### 数据模型

增加一个幂等 migration，创建四张表。

`agent_loop_runs` 记录一次顶层微博 loop：

- `id`
- `project_id`
- `platform`，初始只支持 `weibo`
- `trigger_mode`：`after_collection`、`scheduled`、`manual`、`fixture`
- `target_id`
- `status`: `pending`, `running`, `succeeded`, `partial`, `failed`, `needs_human`
- `current_step`
- `started_at`, `finished_at`
- `error_type`, `error_message`
- `input_json`, `summary_json`

`agent_step_runs` 记录每个阶段：

- `id`
- `loop_run_id`
- `project_id`
- `agent_name`
- `step_name`
- `status`
- `input_json`
- `output_json`
- `evidence_ids`
- `started_at`, `finished_at`
- `error_type`, `error_message`

`judge_reviews` 记录评审结果：

- `id`
- `loop_run_id`
- `step_run_id`
- `judge_agent_name`
- `status`：`pending`、`passed`、`failed`、`needs_human`
- `score`
- `passed`
- `feedback_json`
- `required_changes`
- `evidence_errors`
- `retry_count`
- `created_at`

`feedback_items` 在本 change 中记录人工交接骨架。完整用户反馈语义保留给 `haidao-feedback-memory-loop`：

- `id`
- `project_id`
- `source_type`
- `source_id`
- `feedback_type`
- `note`
- `status`
- `created_by`
- `created_at`
- `handled_at`

所有表都是增量新增，不替换现有微博证据表。

### Worker 契约

在编排层扩大之前，先增加一组小的 worker 命令：

- `weibo-agent-loop-run`：创建 run，但不执行下游业务 loop。
- `weibo-agent-loop-status`：读取一个 run 及其 steps、Judge reviews。
- `weibo-agent-loop-step`：为测试和后续集成创建或更新 step 记录。
- `weibo-agent-loop-judge-review`：为测试和后续集成创建 Judge review 骨架。
- `weibo-agent-loop-handoff`：为测试和后续集成创建人工交接骨架。
- 内部 helper：
  - 创建 loop run
  - 启动、完成、失败或标记 step
  - 创建 Judge review 骨架
  - 创建人工 feedback item

`weibo-comments-analyze`、`weibo-events-build`、`weibo-actions-build` 和 `weibo-bot-message` 等现有命令在本基础 change 中保持不变。可选的 `agentLoopRunId` 绑定属于后续 `haidao-agent-loop-step-attachment` change。

### API 契约

本基础 change 不暴露新的 HTTP endpoint。以下 endpoint 属于后续 `haidao-agent-loop-trigger-api` change：

- `POST /api/weibo/agent-loop/run`
- `GET /api/weibo/agent-runs/:id`

本基础层只确保 worker/status payload 形状已经为这些 endpoint 做好准备。

### Judge 基础

本 change 不实现完整 LLM Judge，只创建持久化与确定性 guard 的形状：

- Judge review 可以记录为 `passed`、`failed` 或 `needs_human`。
- 证据错误包括缺失 citation ID、source type 错误或证据不足。
- retry 字段先预留；完整重试编排保留给 `haidao-judge-agent-retry-loop`。

### 失败处理

- 如果 MySQL 不可用，worker 命令返回现有 `mysql_unavailable` payload 风格。
- 如果某个 step 失败，loop 必须带上 `error_type`、`error_message` 和 current step，进入 `failed` 或 `needs_human`。
- 下游只完成一部分时必须显示为 `partial`，不能转换成成功。

### 安全

- 本 change 的测试不读取也不打印 `.env`、Cookie、token 或浏览器状态。
- 真实微博登录和 MediaCrawler 不属于这个基础层。
- 用户已授权后续使用 DeepSeek，但本账本 change 不要求 live call。

## 验证策略

- Migration 测试断言表和列声明存在，并且没有不安全 MySQL 语法。
- 真实 MySQL 测试连续跑两遍 migrations，并验证 loop/step/Judge/feedback 记录可持久化。
- Worker 测试证明账本命令能写入 run、step、Judge review 和人工交接记录，同时现有微博命令保持兼容。
- 对本 change 运行 OpenSpec validation。
- commit 前运行 `npm test`、真实 MySQL `npm test`、`git diff --check` 和 `npm run agent:guard`。
