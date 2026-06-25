## ADDED Requirements

### Requirement: 可选 Agent step attachment
系统 SHALL 允许现有微博 worker 命令在显式传入 Agent Loop run ID 时记录 step run。

#### Scenario: 未传 run ID 时保持独立行为
- **WHEN** 调用 `weibo-comments-analyze`、`weibo-events-build`、`weibo-actions-build` 或 `weibo-bot-message` 且未传 `agentLoopRunId`
- **THEN** 系统 MUST 保持当前独立命令行为
- **AND** 系统 MUST NOT 要求存在 Agent Loop run

#### Scenario: 别名字段不触发 attachment
- **WHEN** 调用支持 attachment 的 worker 命令但只传入 `loopRunId`、`agent_loop_run_id` 或其他类似别名字段
- **THEN** 系统 MUST 保持当前 standalone 行为
- **AND** 系统 MUST NOT 写入 `agent_step_runs`

#### Scenario: 传入 run ID 时记录 step
- **WHEN** 调用支持 attachment 的 worker 命令并传入合法 `agentLoopRunId`
- **THEN** 系统 MUST 在 `agent_step_runs` 中记录对应 agent name、step name、status、output JSON 和 evidence IDs
- **AND** 查询该 run 状态时 MUST 能看到该 step

#### Scenario: 非法 run ID
- **WHEN** 调用支持 attachment 的 worker 命令并传入不存在或不属于当前 project 的 `agentLoopRunId`
- **THEN** 系统 MUST 返回标准 `agent_loop_not_found`
- **AND** 系统 MUST NOT 执行业务写回

### Requirement: Step 状态与证据
系统 SHALL 根据业务结果和证据完整性记录 step 状态。

#### Scenario: 有证据的成功输出
- **WHEN** worker 命令成功产生带 evidence IDs 的结果
- **THEN** step status MUST 记录为 `succeeded`
- **AND** `evidence_ids` MUST 引用已有业务证据或结果 ID

#### Scenario: 无证据或数据不足
- **WHEN** worker 命令返回 no-data、insufficient-data、unknown 或没有 evidence IDs
- **THEN** step status MUST 记录为 `partial` 或 `needs_human`
- **AND** 系统 MUST NOT 把该 step 记录为完整成功

#### Scenario: Worker 失败
- **WHEN** worker 命令返回 `ok: false` 或执行失败
- **THEN** step status MUST 记录为 `failed` 或 `needs_human`
- **AND** 原始错误 payload MUST 保持可见
- **AND** 如果原始错误 payload 已含 `error_type`、`cause` 或 `fix`，系统 MUST NOT 丢失这些字段

#### Scenario: 使用既有 step 状态
- **WHEN** 系统记录 `partial` 或 `needs_human` step
- **THEN** 系统 MUST 使用 `agent_step_runs` 既有状态契约
- **AND** 本 change MUST NOT 新增 migration

### Requirement: 兼容与安全边界
系统 SHALL 保持现有 API/worker 兼容，并保护真实凭据。

#### Scenario: 不新增前端入口
- **WHEN** 本 change 实现后
- **THEN** 前端 MUST NOT 新增 Agent Loop step attachment 控件或自动触发行为

#### Scenario: 不新增真实外部调用
- **WHEN** 本 change 实现后
- **THEN** 系统 MUST NOT 因 step attachment 额外调用真实 MediaCrawler、DeepSeek、CrewAI、真实微博登录或 Cookie 读取

#### Scenario: 凭据不泄露
- **WHEN** 测试、错误响应或日志输出
- **THEN** 系统 MUST NOT 包含 `.env`、Cookie、token、`config/cookies/weibo.json` 内容
