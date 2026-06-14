## 1. OpenSpec 与契约

- [ ] 1.1 创建 `haidao-feedback-memory-loop` proposal、design、tasks 和 spec。
- [ ] 1.2 明确反馈接口只做人工反馈写回，不自动发布或自动确认现实动作。
- [ ] 1.3 明确支持的 sourceType、feedbackType、状态映射和错误契约。
- [ ] 1.4 明确偏好 memory 来自用户反馈，不是 Agent 自行推断。
- [ ] 1.5 运行 `openspec validate haidao-feedback-memory-loop --strict`。

## 2. Worker Feedback Command

- [ ] 2.1 新增 `weibo-feedback` worker command。
- [ ] 2.2 校验 project、sourceType、sourceId、feedbackType 和 source ownership。
- [ ] 2.3 使用单事务写 `feedback_items`、业务状态更新和 `bot_memory_items`。
- [ ] 2.4 支持 event feedback 更新事件状态和 `event_status_history`。
- [ ] 2.5 支持 action feedback 更新 `publicity_actions.confirmation_status`、`confirmed_at`、`effective_at`。
- [ ] 2.6 支持 source account feedback 修正 `source_type` 并设置 `confirmed_by_user`。
- [ ] 2.7 支持 preference feedback 写入 deterministic preference memory。

## 3. API Wrapper

- [ ] 3.1 新增 `POST /api/weibo/feedback`。
- [ ] 3.2 API 保留 worker 的标准错误字段 `error_type/message/cause/fix`。
- [ ] 3.3 MySQL unavailable 返回 HTTP 503。
- [ ] 3.4 project/source/feedback payload 错误返回 HTTP 400 或 404。
- [ ] 3.5 不新增 step/judge/handoff public endpoint。

## 4. 偏好影响后续建议与问答

- [ ] 4.1 `weibo-actions-build` 读取 preference memory。
- [ ] 4.2 用户拒绝公开澄清偏好会降低或替换公开澄清建议。
- [ ] 4.3 action reason/raw_json 引用 preference memory ID。
- [ ] 4.4 `weibo-bot-message` 可引用 preference memory，且不把偏好写成外部事实。

## 5. 验证

- [ ] 5.1 增加 API contract tests。
- [ ] 5.2 增加 worker command static/no-DB tests。
- [ ] 5.3 增加真实 MySQL feedback persistence tests。
- [ ] 5.4 增加 cross-project source 拒绝测试。
- [ ] 5.5 增加 preference 影响 action build 测试。
- [ ] 5.6 运行定向测试。
- [ ] 5.7 运行真实 MySQL persistence 测试。
- [ ] 5.8 运行 `npm test`。
- [ ] 5.9 运行 `openspec validate haidao-feedback-memory-loop --strict`。
- [ ] 5.10 运行 `git diff --check`。
- [ ] 5.11 运行 `npm run agent:guard`。
