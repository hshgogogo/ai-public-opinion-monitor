## 1. Schema

- [x] 1.1 为 `agent_loop_runs` 增加幂等 migration。
- [x] 1.2 为 `agent_step_runs` 增加幂等 migration。
- [x] 1.3 为 `judge_reviews` 增加幂等 migration。
- [x] 1.4 为 `feedback_items` 增加幂等 migration。
- [x] 1.5 增加测试，证明 migration 对 MySQL 8.0/8.4 安全且可重复执行。

## 2. Worker 账本契约

- [x] 2.1 增加 worker helper，用 project、platform、trigger mode、target、status 和 input JSON 创建 Agent Loop run。
- [x] 2.2 增加 worker helper，用于启动、成功、部分完成、失败或标记 step 需要人工处理。
- [x] 2.3 增加 worker helper，用于记录带 pass/fail/needs-human 状态和 evidence errors 的 Judge review 骨架。
- [x] 2.4 增加 worker helper，用于记录 feedback/manual-handoff item。
- [x] 2.5 增加 loop run、step run、Judge review 和 feedback persistence 测试。

## 3. Worker 命令

- [x] 3.1 增加 `weibo-agent-loop-run` worker 命令，用于创建 loop run。
- [x] 3.2 增加 `weibo-agent-loop-status` worker 命令，用于读取 run、step、Judge 和 feedback 状态。
- [x] 3.3 增加 worker-only 命令或 payload 路径，用于记录 step、Judge review 和人工交接骨架。
- [x] 3.4 增加测试，覆盖 MySQL 不可用、非法 project ID 和稳定 worker payload 形状。

## 4. 兼容边界

- [x] 4.1 保持 `weibo-comments-analyze`、`weibo-events-build`、`weibo-actions-build` 和 `weibo-bot-message` 的独立行为。
- [x] 4.2 记录可选 step attachment 属于后续 `haidao-agent-loop-step-attachment`。
- [x] 4.3 确保本 change 不新增公开 HTTP endpoint。
- [x] 4.4 确保本 change 不新增前端 workbench 行为。

## 5. 人工交接骨架

- [x] 5.1 将人工交接骨架存入 `feedback_items`，但不实现完整用户反馈语义。
- [x] 5.2 增加测试，证明人工交接记录保留 source type、source ID、status、note 和 creator。
- [x] 5.3 记录完整用户确认、驳回、偏好写回属于后续 `haidao-feedback-memory-loop`。

## 6. 验证和文档

- [x] 6.1 在 README 或实现说明中更新 Agent Harness worker 命令和限制。
- [x] 6.2 运行 `npm test`。
- [x] 6.3 当 `WEIBO_DB_PERSISTENCE_TEST_URL` 可用时，运行真实 MySQL persistence 测试。
- [x] 6.4 运行 `openspec validate haidao-agent-harness-loop-foundation --strict`。
- [x] 6.5 运行 `git diff --check`。
- [x] 6.6 运行 `npm run agent:guard`。
