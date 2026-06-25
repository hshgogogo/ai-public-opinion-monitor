## 背景

Agent Harness 基础层已经把 loop run、step、Judge review 和人工交接写入 MySQL，并提供 worker-only 命令。下一步需要一个稳定 HTTP 契约，让前端或调度器能创建 run、查询 run 状态，但仍不执行完整业务 loop。

## 设计

### API 契约

新增两个 Node endpoint。

`POST /api/weibo/agent-loop/run`

- 请求体：
  - `projectId`：可选，默认使用当前项目。
  - `mode`：可选，允许 `manual`、`scheduled`、`after_collection`。
  - `targetId`：可选。
  - `input`：可选 JSON object。
- 行为：
  - 调用 worker `weibo-agent-loop-run`。
  - HTTP 层将 `mode` 映射为 worker payload 的 `triggerMode`。
  - `fixture` 只允许 worker-only/test-only 使用，不通过 public HTTP API 暴露。
  - 不执行评论分析、事件生成、行动建议、问答、MediaCrawler、DeepSeek 或 CrewAI。
  - 成功时返回 `ok: true`、`agentLoopRunId`、`status` 和 run 数据。

`GET /api/weibo/agent-runs/:id`

- 路径参数：
  - `id`：必须是正整数。
- 行为：
  - 调用 worker `weibo-agent-loop-status`。
  - 返回 run、steps、judgeReviews、manualHandoffs、currentStep、retryCount。
  - 如果 worker 内部仍以 `feedbackItems` 命名，HTTP 层必须过滤/映射出 manual handoff 语义，不能让调用方猜测。
  - 不创建或修改业务数据。

### Worker 映射

Node 服务继续使用现有 worker bridge：

```text
HTTP request
  -> src/server.js
  -> workers/enterprise_worker.py <command> --payload-json
  -> MySQL ledger tables
```

HTTP payload 使用 PRD 对外字段 `mode` 和 `agentLoopRunId`。worker payload 可以继续使用内部字段 `triggerMode` 和 `loopRunId`，但映射必须集中在 HTTP wrapper 内。

### 错误处理

- MySQL 不可用：POST/GET 都返回 HTTP `503`，payload 保留 worker 的 `mysql_unavailable`，并包含 `cause` 和 `fix`。
- 非法 project ID：返回 HTTP `400`，payload 包含稳定 `error_type`、`cause` 和 `fix`。
- 非法 run ID：返回 HTTP `400`，`error_type` 为 `invalid_agent_run_id`，并包含 `cause` 和 `fix`。
- worker 返回 `ok: false`：HTTP status 由 `error_type` 映射，payload 不丢失 `error_type`、`cause` 和 `fix`。
- endpoint 不得把 worker stderr、环境变量、`.env`、Cookie 或 token 打印到响应中。

### 兼容边界

- 现有微博 MVP endpoint 行为保持不变。
- worker-only 命令仍可直接使用。
- 本 change 不把现有业务命令挂载到 run；后续 `haidao-agent-loop-step-attachment` 再处理。

## 验证策略

- API contract 测试证明 endpoint 存在、请求结构稳定、无 MySQL 时返回标准错误。
- 行为测试使用 stub/fake worker bridge 证明 POST 只调用 `weibo-agent-loop-run`，GET 只调用 `weibo-agent-loop-status`。
- 行为测试证明不会调用分析、事件、行动、问答、MediaCrawler、DeepSeek、CrewAI 或真实微博登录相关命令。
- 前端文件不出现新 Agent Loop 调用；本 change 不新增前端入口。
- 运行 `npm test`、`openspec validate haidao-agent-loop-trigger-api --strict`、`git diff --check` 和 `npm run agent:guard`。
