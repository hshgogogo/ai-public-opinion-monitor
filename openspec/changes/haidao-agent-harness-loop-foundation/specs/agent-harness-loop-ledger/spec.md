## ADDED Requirements

### Requirement: Agent Loop run 账本
系统 SHALL 在引入更大的 CrewAI 或 FastAPI 编排之前，把每一次微博 Agent Loop run 记录到可审计账本中。

#### Scenario: 创建人工触发的 loop run
- **WHEN** 用户或 worker 为某个项目请求一次微博 Agent Loop run
- **THEN** 系统 MUST 创建一条 `agent_loop_runs` 记录，包含 project ID、platform `weibo`、trigger mode、status、current step、input JSON 和 timestamps

#### Scenario: Loop run 失败
- **WHEN** 某个必要 step 失败导致 loop run 无法继续
- **THEN** 系统 MUST 将 run 标记为 `failed` 或 `needs_human`，并带上 `error_type`、`error_message` 和 current step，而不是报告成功

### Requirement: Agent step 账本
系统 SHALL 在 loop run 下记录每个独立 Agent step。

#### Scenario: 带证据的账本 step 成功
- **WHEN** 某个账本 step 被记录到 loop run 下
- **THEN** 系统 MUST 创建或更新一条 `agent_step_runs` 记录，包含 agent name、step name、status、output JSON 和 cited evidence IDs

#### Scenario: 现有命令保持兼容
- **WHEN** 本基础 change 实现后
- **THEN** 现有微博分析、事件、行动和 Q&A 命令 MUST 保持当前独立行为，并且 MUST NOT 要求存在 Agent Loop run

### Requirement: Judge review 骨架
系统 SHALL 将 Judge review 记录与 Agent 输出分开持久化。

#### Scenario: 记录 Judge review
- **WHEN** 某个 step 输出被确定性检查或未来 Judge Agent 评审
- **THEN** 系统 MUST 记录 `judge_reviews`，包含 status、pass/fail result、可用时的 score、retry count、required changes、feedback JSON 和 evidence errors

#### Scenario: 检测到证据错误
- **WHEN** review 检测到缺失证据、不存在的 ID、过度推断或不支持的 source type
- **THEN** review MUST 被记录为 `failed` 或 `needs_human`，并且 MUST NOT 静默把 step 标记为成功

### Requirement: 人工反馈队列
系统 SHALL 为 Agent Loop 失败或用户纠正记录人工反馈与交接 item。

#### Scenario: 需要人工处理
- **WHEN** 某个 loop step 无法通过验证或需要用户确认
- **THEN** 系统 MUST 创建一条 `feedback_items` 记录，包含 source type、可用时的 source ID、feedback type、note、status、creator 和 creation time

#### Scenario: 完整反馈语义后置
- **WHEN** 需要用户确认、驳回、修改或偏好写回
- **THEN** 本基础层 MUST 保留人工交接记录形状，但把完整反馈语义留给 feedback-memory change
