## 背景

微博 MVP 已经能完成采集、分析、事件生成、行动建议和基于证据的问答，但这些能力目前主要以彼此独立的 worker/API 命令暴露。PRD 要求增加 Agent Harness：一个安全的运行时层，用来记录 loop 过程、区分事实与建议、保存 Judge 反馈，并让失败状态可见。

本 change 先补齐最小账本和评审基础，再进入更大的 FastAPI、React、CrewAI 和知识库迁移。它保留当前 Node 服务和 Python worker，不做高风险重写，让下一步产品演进先变成可审计的编排层。

## 变更内容

- 新增增量式 MySQL 表：
  - `agent_loop_runs`
  - `agent_step_runs`
  - `judge_reviews`
  - `feedback_items`
- 增加 worker-only 契约，用于创建微博 Agent Loop run、记录 step 状态、记录 Judge review 骨架、记录人工交接骨架，以及读取 run 状态。
- 标准化 loop step 与 Judge review 的失败状态和人工交接状态。
- 继续约束 Agent 输出必须绑定证据：事实、推断、建议和引用保持分离。

## 非目标

- 本 change 不引入 FastAPI。
- 本 change 不引入 CrewAI runtime。
- 本 change 不把前端迁移到 React/Vite。
- 本 change 不新增公开 HTTP endpoint。
- 本 change 不把现有分析、事件、行动或 bot 命令强制挂到 loop run 上。
- 自动化测试不调用真实 MediaCrawler，也不要求真实微博登录。
- 不要求 DeepSeek live call；后续授权的分析切片可以使用 DeepSeek，但这个基础层必须能用 fixture/local DB 测试。
- 不实现完整的用户确认、驳回、偏好写回语义；这里只预留人工交接骨架。
- 未经用户确认，任何 Agent 或 Judge 都不得对外发布，也不得把现实世界行动标记为已执行。

## 能力

### 新增能力

- `agent-harness-loop-ledger`：Agent Loop run 账本、step run 账本、Judge review 记录，以及反馈/人工交接队列。

## 影响范围

- 持久化：在当前微博 MVP migrations 之后追加新的增量 migration。
- Worker：`workers/enterprise_worker.py` 增加 loop 账本命令和内部账本 helper。
- API：本 change 不改 HTTP API；HTTP endpoint 暴露留给后续 `haidao-agent-loop-trigger-api`。
- 测试：migration 测试、真实 MySQL persistence 测试、worker 契约测试、guard 测试。
- 外部依赖：真实持久化路径只需要 MySQL。本 change 不需要真实微博登录、Cookie、MediaCrawler 或 DeepSeek live call。
