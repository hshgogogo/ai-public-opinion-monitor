## 背景

当前系统已经能记录 Agent Loop run/step，也能把分析、事件、行动和问答挂载到 step。但用户对事件、建议、账号类型和团队偏好的反馈还没有一个统一入口。PRD 要求 Agent Harness 能把人工确认、驳回、修改和偏好写回 `feedback_items`、`bot_memory_items` 以及相关业务表，并让后续建议读取这些反馈。

本 change 只做反馈与记忆闭环的 MVP：用户通过一个明确的 Weibo feedback API 或 worker command 写入反馈，系统审计该反馈、更新允许更新的业务状态，并生成可被后续 Strategy/Q&A 使用的偏好记忆。

## 变更内容

- 新增 `POST /api/weibo/feedback` 的 Node wrapper 和对应 worker command。
- 支持事件反馈、行动反馈、账号类型修正和偏好补充。
- 将每条反馈写入 `feedback_items`。
- 将可复用偏好或确认结果写入 `bot_memory_items`。
- 对允许的业务对象做受控状态更新：
  - event：只允许确认、驳回、降级为观察线索或备注。
  - action：只允许确认、驳回、部分执行、未执行或补充现实动作时间。
  - source account：只允许修正 `source_type` 并记录人工确认。
- 后续 `weibo-actions-build` 和 `weibo-bot-message` 可读取用户偏好记忆，避免重复推荐用户已明确拒绝的方向。

## 非目标

- 不自动发布微博或外部平台内容。
- 不把 Agent 建议自动标记为现实已执行；必须来自用户反馈。
- 不实现 Judge retry loop。
- 不生成知识卡或 rule proposal 草案；自进化草案属于后续 `haidao-rule-proposal-self-evolution`。
- 不新增 React/Vite 工作台页面。
- 不读取或提交 `.env`、Cookie、token、`config/cookies/weibo.json`。
- 不调用真实 MediaCrawler、DeepSeek 或 CrewAI。

## 能力

### 新增能力

- `feedback-memory-loop`：用户反馈可审计写入、受控更新业务状态，并形成后续 Agent 可检索的偏好/确认记忆。

## 影响范围

- API：新增 `POST /api/weibo/feedback`。
- Worker：新增 `weibo-feedback` command，并让后续建议/问答读取偏好记忆。
- 数据库：优先复用 `feedback_items`、`bot_memory_items`、`artist_public_opinion_events`、`publicity_actions`、`source_accounts`；如字段不足，只允许 MySQL-safe 幂等迁移。
- 测试：API contract、worker no-DB error、真实 MySQL feedback persistence、状态更新、偏好影响建议。
