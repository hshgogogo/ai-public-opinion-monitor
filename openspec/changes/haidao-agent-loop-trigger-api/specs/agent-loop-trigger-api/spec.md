## ADDED Requirements

### Requirement: Agent Loop 创建 API
系统 SHALL 提供一个微博 Agent Loop run 创建 HTTP endpoint，并且该 endpoint 只创建账本 run，不执行完整业务 loop。

#### Scenario: 创建 manual loop run
- **WHEN** 用户或后端调用 `POST /api/weibo/agent-loop/run` 并传入合法 payload，其中 public `mode` 为 `manual`
- **THEN** 系统 MUST 调用 worker `weibo-agent-loop-run` 创建一条 `agent_loop_runs` 记录
- **AND** 响应 MUST 包含稳定的 `agentLoopRunId`、status 和 `ok: true`

#### Scenario: 创建 scheduled 或 after_collection loop run
- **WHEN** 用户或后端调用 `POST /api/weibo/agent-loop/run` 并传入合法 payload，其中 public `mode` 为 `scheduled` 或 `after_collection`
- **THEN** 系统 MUST 调用 worker `weibo-agent-loop-run` 创建一条 `agent_loop_runs` 记录
- **AND** 响应 MUST 包含稳定的 `agentLoopRunId`、status 和 `ok: true`

#### Scenario: 拒绝非 public mode
- **WHEN** 用户或后端调用 `POST /api/weibo/agent-loop/run` 并传入非 `manual`、`scheduled`、`after_collection` 的 mode
- **THEN** 系统 MUST 返回 HTTP `400`
- **AND** payload MUST 包含稳定 `error_type`、`cause` 和 `fix`

#### Scenario: 拒绝 fixture mode
- **WHEN** 用户或后端调用 `POST /api/weibo/agent-loop/run` 并传入 `fixture` mode
- **THEN** 系统 MUST 返回 HTTP `400`
- **AND** 系统 MUST NOT 将 `fixture` 转发给 worker
- **AND** payload MUST 包含稳定 `error_type`、`cause` 和 `fix`

#### Scenario: 非法 project ID
- **WHEN** 用户或后端调用 `POST /api/weibo/agent-loop/run` 并传入非法 project ID
- **THEN** 系统 MUST 返回 HTTP `400`
- **AND** payload MUST 包含稳定 `error_type`、`cause` 和 `fix`

#### Scenario: MySQL 不可用
- **WHEN** 调用 `POST /api/weibo/agent-loop/run` 时 MySQL 不可用
- **THEN** 系统 MUST 返回 HTTP `503`
- **AND** payload MUST 包含 `error_type` 为 `mysql_unavailable` 的标准错误
- **AND** payload MUST 包含 `cause` 和 `fix`

#### Scenario: 不执行完整业务 loop
- **WHEN** 创建 Agent Loop run
- **THEN** 系统 MUST NOT 调用真实 MediaCrawler、DeepSeek、CrewAI、评论分析、事件生成、行动建议或问答命令

### Requirement: Agent Loop 状态查询 API
系统 SHALL 提供一个微博 Agent Loop run 状态查询 HTTP endpoint。

#### Scenario: 查询 loop run 状态
- **WHEN** 用户或后端调用 `GET /api/weibo/agent-runs/:id`
- **THEN** 系统 MUST 调用 worker `weibo-agent-loop-status`
- **AND** 响应 MUST 返回 run、steps、judgeReviews、manualHandoffs、currentStep 和 retryCount

#### Scenario: 非法 run ID
- **WHEN** `GET /api/weibo/agent-runs/:id` 收到非正整数 ID
- **THEN** 系统 MUST 返回 HTTP `400`
- **AND** payload MUST 包含稳定 `error_type`、`cause` 和 `fix`

#### Scenario: 状态查询 MySQL 不可用
- **WHEN** 调用 `GET /api/weibo/agent-runs/:id` 时 MySQL 不可用
- **THEN** 系统 MUST 返回 HTTP `503`
- **AND** payload MUST 包含 `error_type` 为 `mysql_unavailable` 的标准错误、`cause` 和 `fix`

#### Scenario: Worker 返回错误
- **WHEN** worker 返回 `ok: false`
- **THEN** HTTP response MUST 保留 worker payload 中的 `error_type`、`cause` 和 `fix`

### Requirement: 兼容与安全边界
系统 SHALL 保持现有微博 MVP endpoint 和 worker-only ledger 命令兼容，并保护真实凭据。

#### Scenario: 现有 endpoint 保持兼容
- **WHEN** 本 change 实现后
- **THEN** 现有 Weibo MVP API 和 worker-only ledger 命令 MUST 保持当前行为

#### Scenario: 凭据不泄露
- **WHEN** API 返回错误或测试执行
- **THEN** 系统 MUST NOT 在响应、日志或测试 fixture 中包含 `.env`、Cookie、token、`config/cookies/weibo.json` 内容
