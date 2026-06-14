## 背景

`haidao-agent-harness-loop-foundation` 已经提供 worker-only 的 Agent Loop 账本命令，但用户和后端仍没有稳定 HTTP 入口来创建或查询一次微博 Agent Loop。

本 change 只做最小 HTTP wrapper：把现有 worker 命令包装成明确的 Node API endpoint，让后续前端、调度器和真实业务 loop 可以引用同一个 run ID。它不串起分析、事件、行动、问答，也不引入 FastAPI 或 CrewAI。

这是 change queue 拆分出的 Node wrapper 过渡切片。PRD 中的 FastAPI 迁移留给后续 `haidao-fastapi-sidecar-harness`，本 change 只在当前 Node 服务里暴露最小入口。

## 变更内容

- 新增 `POST /api/weibo/agent-loop/run`。
- 新增 `GET /api/weibo/agent-runs/:id`。
- 将 HTTP payload 映射到现有 worker 命令：
  - `weibo-agent-loop-run`
  - `weibo-agent-loop-status`
- public HTTP contract 使用 PRD 的 `mode` 字段，只允许 `manual`、`scheduled`、`after_collection`；worker-only/test-only 的 `fixture` 不通过 HTTP 暴露。
- 成功响应统一返回 `ok`、`agentLoopRunId`、`status` 和 run/status 数据。
- status 响应必须包含 run、steps、judgeReviews、manualHandoffs，以及 currentStep/retryCount 等状态信息。
- 保持统一错误格式：MySQL 不可用、非法 project ID、非法 run ID、worker payload 错误都必须返回稳定 `error_type`、`cause` 和 `fix`。
- 明确 HTTP endpoint 只是触发/查询账本，不执行真实采集、DeepSeek、MediaCrawler、CrewAI 或完整业务 loop。

## 非目标

- 不调用真实 MediaCrawler。
- 不读取真实微博 Cookie、Chrome 登录态或 `config/cookies/weibo.json`。
- 不调用 DeepSeek live call。
- 不实现 `agentLoopRunId` step attachment；该能力属于 `haidao-agent-loop-step-attachment`。
- 不新增前端 Agent Loop 行为；React/Vite 工作台属于后续 change。
- 不引入 FastAPI 或 CrewAI runtime。
- 不改变现有 `weibo-comments-analyze`、`weibo-events-build`、`weibo-actions-build`、`weibo-bot-message` 的独立行为。

## 能力

### 新增能力

- `agent-loop-trigger-api`：微博 Agent Loop run 创建与状态查询 HTTP API。

## 影响范围

- API：`src/server.js` 增加两个微博 Agent Loop endpoint。
- Worker：复用现有 `workers/enterprise_worker.py` 命令，不新增真实业务执行。
- 测试：API contract 测试、MySQL unavailable 测试、非法输入测试、兼容边界测试。
- 外部依赖：本 change 可以在无真实微博登录、无 MediaCrawler、无 DeepSeek 的本地环境验证。
