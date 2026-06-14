## 1. OpenSpec 与契约

- [ ] 1.1 创建 `haidao-agent-loop-step-attachment` proposal、design、tasks 和 spec。
- [ ] 1.2 明确未传 `agentLoopRunId` 时现有 worker 命令必须保持独立行为。
- [ ] 1.3 明确本 change 不实现 Judge retry、不新增前端入口、不调用真实采集。
- [ ] 1.4 明确本 change 只接受精确 `agentLoopRunId`，不把 `loopRunId` 等别名作为 attachment 触发条件。
- [ ] 1.5 运行 `openspec validate haidao-agent-loop-step-attachment --strict`。

## 2. Worker Step Attachment

- [ ] 2.1 为 `weibo-comments-analyze` 增加可选 `agentLoopRunId` step 写入。
- [ ] 2.2 为 `weibo-events-build` 增加可选 `agentLoopRunId` step 写入。
- [ ] 2.3 为 `weibo-actions-build` 增加可选 `agentLoopRunId` step 写入。
- [ ] 2.4 为 `weibo-bot-message` 增加可选 `agentLoopRunId` step 写入。
- [ ] 2.5 step payload 包含 agent name、step name、status、output JSON 和 evidence IDs。

## 3. 兼容与错误

- [ ] 3.1 未传 `agentLoopRunId` 时现有命令返回结构不变。
- [ ] 3.2 只传 `loopRunId`、`agent_loop_run_id` 等别名时仍保持 standalone 行为，不触发 attachment。
- [ ] 3.3 传入不存在或跨项目的 run ID 时返回标准 `agent_loop_not_found`。
- [ ] 3.4 无证据或 insufficient-data 输出不得记录为完整成功，且只使用现有 `partial`/`needs_human` 状态。
- [ ] 3.5 step 记录失败时不吞掉原始 worker 错误，且不丢失已有 `error_type/cause/fix`。
- [ ] 3.6 不读取、打印或提交 `.env`、Cookie、token、`config/cookies/weibo.json`。

## 4. 验证

- [ ] 4.1 增加 standalone compatibility 测试。
- [ ] 4.2 增加 attachment 写入 `agent_step_runs` 测试。
- [ ] 4.3 增加 invalid run ID 错误测试。
- [ ] 4.4 增加 no-evidence partial/needs-human 状态测试。
- [ ] 4.5 增加真实 MySQL persistence 测试，覆盖合法 run、跨项目/不存在 run、no-evidence 状态。
- [ ] 4.6 运行定向测试。
- [ ] 4.7 运行真实 MySQL persistence 测试。
- [ ] 4.8 运行 `npm test`。
- [ ] 4.9 运行 `git diff --check`。
- [ ] 4.10 运行 `npm run agent:guard`。
