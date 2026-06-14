## 1. OpenSpec 与契约

- [ ] 1.1 创建 `haidao-agent-loop-trigger-api` proposal、design、tasks 和 spec。
- [ ] 1.2 明确本 change 只暴露 HTTP wrapper，不串完整 Agent Loop。
- [ ] 1.3 运行 `openspec validate haidao-agent-loop-trigger-api --strict`。

## 2. HTTP API

- [ ] 2.1 新增 `POST /api/weibo/agent-loop/run`。
- [ ] 2.2 新增 `GET /api/weibo/agent-runs/:id`。
- [ ] 2.3 将 run endpoint 映射到 worker `weibo-agent-loop-run`。
- [ ] 2.4 将 status endpoint 映射到 worker `weibo-agent-loop-status`。
- [ ] 2.5 public HTTP payload 使用 PRD-compatible 的 `mode` 和 `agentLoopRunId`。
- [ ] 2.6 public HTTP `mode` 只允许 `manual`、`scheduled`、`after_collection`，不暴露 worker-only/test-only `fixture`。
- [ ] 2.7 status payload 包含 run、steps、judgeReviews、manualHandoffs、currentStep 和 retryCount。

## 3. 错误与安全

- [ ] 3.1 POST/GET 在 MySQL 不可用时返回 HTTP `503` 和带 `error_type/cause/fix` 的 `mysql_unavailable` payload。
- [ ] 3.2 非法 project ID 返回 HTTP `400` 和可操作错误。
- [ ] 3.3 非法 run ID 或 payload 返回 HTTP `400` 和可操作错误。
- [ ] 3.4 worker `ok:false` 时 HTTP response 不丢失 `error_type/cause/fix`。
- [ ] 3.5 endpoint 不读取、打印或提交 `.env`、Cookie、token、`config/cookies/weibo.json`。
- [ ] 3.6 endpoint 不调用真实 MediaCrawler、DeepSeek、CrewAI 或真实微博登录。

## 4. 兼容性与验证

- [ ] 4.1 保持现有 Weibo MVP endpoint 和 worker-only ledger 命令行为不变。
- [ ] 4.2 增加 API contract 测试覆盖 run/status endpoint。
- [ ] 4.3 增加 stub/fake worker 行为测试，证明 POST 只调用 `weibo-agent-loop-run`，GET 只调用 `weibo-agent-loop-status`。
- [ ] 4.4 增加行为测试证明不会调用分析、事件、行动、问答、MediaCrawler、DeepSeek、CrewAI 相关命令。
- [ ] 4.5 增加测试证明本 change 不新增前端 Agent Loop 行为。
- [ ] 4.6 运行定向测试。
- [ ] 4.7 运行 `npm test`。
- [ ] 4.8 运行 `git diff --check`。
- [ ] 4.9 运行 `npm run agent:guard`。
