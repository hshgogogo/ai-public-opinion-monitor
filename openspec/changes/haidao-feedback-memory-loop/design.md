## 背景

反馈闭环需要同时满足两个约束：一方面用户必须能纠正系统判断；另一方面 Agent 不能借反馈接口绕过事实边界，直接改写高风险事实或发布外部动作。

## 设计

### 输入契约

`POST /api/weibo/feedback` 和 worker command `weibo-feedback` 接收同一业务 payload：

```json
{
  "projectId": 1,
  "sourceType": "event",
  "sourceId": 42,
  "feedbackType": "event_confirmed",
  "note": "判断方向正确，但暂时不要升级高风险。",
  "status": "resolved",
  "preference": {
    "preferenceType": "conservative_response",
    "summary": "团队倾向低调观察，不优先公开澄清。"
  }
}
```

### 允许的 sourceType

- `event`
- `action`
- `source_account`
- `preference`
- `loop`
- `step`
- `judge_review`

`loop`、`step`、`judge_review` 首版只写 `feedback_items` 和可选 memory，不改 ledger 状态。

### 允许的 feedbackType

事件：

- `event_confirmed`
- `event_rejected`
- `event_observation_only`
- `event_note`

行动：

- `action_confirmed`
- `action_rejected`
- `action_partially_executed`
- `action_not_executed`
- `action_note`

账号：

- `source_type_corrected`

偏好：

- `preference_added`
- `preference_updated`

人工处理：

- `manual_handoff_resolved`
- `manual_handoff_note`

### 状态更新

反馈写入顺序：

1. 校验 project 和 source ownership。
2. 写入 `feedback_items`。
3. 根据 sourceType/feedbackType 做受控业务状态更新。
4. 写入 `bot_memory_items`。
5. 返回 feedback、memory、updatedSource 摘要。

事件状态映射：

- `event_confirmed`：事件状态变成 `confirmed` 或保持已有更终态；写 `event_status_history`。
- `event_rejected`：事件状态变成 `rejected`；不删除 evidence。
- `event_observation_only`：事件状态变成 `observing`，风险不得被提升。
- `event_note`：只写 feedback/memory，不改事件状态。

行动状态映射：

- `action_confirmed`：等价于用户确认现实动作，更新 `confirmation_status='confirmed'`、`confirmed_at`，可写 `effective_at`。
- `action_rejected` / `action_not_executed`：更新 `confirmation_status='rejected'`，不得再被 agent build 覆盖为 pending。
- `action_partially_executed`：更新 `confirmation_status='partial'`。
- `action_note`：只写 feedback/memory。

账号修正：

- `source_type_corrected` 必须带合法 `sourceTypeValue`。
- 更新 `source_accounts.source_type`、`confirmed_by_user=1`。
- 不批量重写历史 posts/targets；是否回填属于后续迁移。

偏好写回：

- `preference_added` / `preference_updated` 写入 `bot_memory_items`，`source_kind='preference'`。
- `memory_identity` 使用 project scoped deterministic identity，例如 `preference:<preferenceType>:<hash(summary)>`。
- 后续 Strategy/Q&A 读取 preference memory 时必须把它作为约束或上下文，不得把偏好当成外部事实。

### 后续建议如何读取偏好

`weibo-actions-build` 在生成 `agent_recommended` 时读取最近的高重要度 preference memory：

- 如果偏好明确拒绝公开澄清，降低或替换 `clarify_official_announcement` 的优先级与理由。
- 返回的 action `reason` 或 `raw_json` 应包含 preference memory ID。
- 没有 preference 时保持现有 deterministic strategy 行为。

`weibo-bot-message` 在回答中可引用 preference memory，但必须与事实、推断、建议分开。

### 错误处理

- MySQL 不可用返回 `mysql_unavailable`。
- project 不存在返回 `project_not_found`。
- source 不存在或不属于 project 返回 `<source>_not_found`。
- feedbackType/sourceType 不匹配返回 `invalid_feedback_type`。
- 无法更新业务对象时保留已写 feedback 的语义必须明确：首版采用单事务，任一步失败整体回滚。

### 安全边界

- 不读取真实 Cookie、`.env` 或浏览器状态。
- 不把反馈接口用于发布外部内容。
- 不允许通过 feedback 更新非本 project 数据。
- 不把用户偏好覆盖成 Agent 自动推断，所有偏好 memory 必须来自用户 payload。

## 验证策略

- API tests：Node endpoint 参数校验、MySQL unavailable、worker 错误映射。
- Worker static tests：命令存在、source/feedback enum 明确、无 public step/judge/handoff endpoint 扩张。
- Real MySQL tests：
  - event feedback 写 `feedback_items`、`bot_memory_items`、`event_status_history` 并更新 event status。
  - action feedback 更新 confirmation status，并保护用户确认/驳回不被后续 action build 覆盖。
  - source account feedback 更新 `source_type` 和 `confirmed_by_user`。
  - preference feedback 影响后续 `weibo-actions-build` 的建议优先级或 reason。
  - cross-project source 被拒绝。
- 常规验证：`npm test`、真实 MySQL persistence test、`openspec validate haidao-feedback-memory-loop --strict`、`git diff --check`、`npm run agent:guard`。
