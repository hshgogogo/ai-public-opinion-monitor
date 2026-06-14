## ADDED Requirements

### Requirement: 用户反馈写回
系统 SHALL 提供 Weibo feedback 入口，将人工反馈写入可审计账本并受控更新业务对象。

#### Scenario: 反馈写入审计账本
- **WHEN** 用户提交合法 `POST /api/weibo/feedback`
- **THEN** 系统 MUST 写入 `feedback_items`
- **AND** 反馈记录 MUST 包含 project、source type、source id、feedback type、note、status 和 created_by

#### Scenario: 非法 source 被拒绝
- **WHEN** 用户对不存在或不属于当前 project 的 event、action 或 source account 提交反馈
- **THEN** 系统 MUST 返回标准 not-found 错误
- **AND** 系统 MUST NOT 更新其他 project 的数据

#### Scenario: feedbackType 与 sourceType 不匹配
- **WHEN** 用户对 action 提交 event-only feedbackType
- **THEN** 系统 MUST 返回 `invalid_feedback_type`
- **AND** 系统 MUST NOT 写入业务状态更新

### Requirement: 事件与行动状态写回
系统 SHALL 根据用户反馈受控更新事件和行动状态。

#### Scenario: 用户确认事件
- **WHEN** 用户提交 `sourceType=event` 且 `feedbackType=event_confirmed`
- **THEN** 系统 MUST 更新该 event 状态为 confirmed
- **AND** 系统 MUST 写入 `event_status_history`
- **AND** 系统 MUST 写入对应 memory

#### Scenario: 用户驳回行动建议
- **WHEN** 用户提交 `sourceType=action` 且 `feedbackType=action_rejected`
- **THEN** 系统 MUST 更新该 action `confirmation_status` 为 rejected
- **AND** 后续 action build MUST NOT 覆盖该用户决策为 pending

#### Scenario: 用户确认现实动作已执行
- **WHEN** 用户提交 `sourceType=action` 且 `feedbackType=action_confirmed`
- **THEN** 系统 MUST 更新 `confirmation_status` 为 confirmed
- **AND** 系统 MUST 记录 `confirmed_at`
- **AND** 如果用户提供 effectiveAt，系统 MUST 记录 `effective_at`

### Requirement: 账号类型修正
系统 SHALL 允许用户修正 source account 类型，并保留人工确认标记。

#### Scenario: 修正账号类型
- **WHEN** 用户提交 `sourceType=source_account`、`feedbackType=source_type_corrected` 和合法 `sourceTypeValue`
- **THEN** 系统 MUST 更新 `source_accounts.source_type`
- **AND** 系统 MUST 设置 `confirmed_by_user=1`
- **AND** 系统 MUST 写入 feedback 和 memory

### Requirement: 偏好记忆影响后续建议
系统 SHALL 将用户偏好写入 memory，并让后续建议读取该偏好。

#### Scenario: 新增用户偏好
- **WHEN** 用户提交 `sourceType=preference` 且 `feedbackType=preference_added`
- **THEN** 系统 MUST 写入 `bot_memory_items`，且 `source_kind` MUST 为 preference
- **AND** memory identity MUST 在同一 project 内可重复写入而不产生重复偏好

#### Scenario: 偏好约束行动建议
- **WHEN** 用户偏好明确拒绝公开澄清
- **AND** 后续 Strategy Agent 构建行动建议
- **THEN** 系统 MUST 降低或替换公开澄清类建议
- **AND** 建议 MUST 引用相关 preference memory ID

#### Scenario: 偏好不是外部事实
- **WHEN** Q&A 引用用户偏好
- **THEN** 系统 MUST 将其表述为团队偏好或人工反馈
- **AND** 系统 MUST NOT 将其表述为外部事实

### Requirement: 安全和范围边界
系统 SHALL 保持反馈闭环的安全边界。

#### Scenario: 不新增外部调用
- **WHEN** feedback memory loop 执行
- **THEN** 系统 MUST NOT 因反馈写回调用真实 MediaCrawler、DeepSeek、CrewAI 或微博登录

#### Scenario: 不泄露凭据
- **WHEN** 反馈写入、错误响应或测试输出
- **THEN** 系统 MUST NOT 包含 `.env`、Cookie、token 或 `config/cookies/weibo.json` 内容

#### Scenario: 不自动发布
- **WHEN** 用户确认或驳回建议
- **THEN** 系统 MUST NOT 自动发布微博或外部平台内容
