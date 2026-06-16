## ADDED Requirements

### Requirement: Judge review quality gate
系统 SHALL 在微博 Agent Loop 的关键 proposal/step 输出后，通过 FastAPI Harness-owned Judge quality gate 执行 Judge review，并把 review 结果保存到 `judge_reviews`。

#### Scenario: 有证据输出通过 Judge
- **WHEN** 一个 proposal/step 输出包含当前 project 下存在的 evidence IDs、必填结构和清晰边界
- **THEN** 系统 MUST 记录一条 `passed` Judge review
- **AND** review MUST 包含 `passed=true`、retry count、feedback JSON 和空 evidence errors

#### Scenario: 无证据输出被拒绝
- **WHEN** 一个 proposal/step 输出没有 evidence IDs，或 evidence IDs 为空
- **THEN** 系统 MUST 记录 `failed` Judge review
- **AND** review MUST 包含 required changes 和 evidence errors
- **AND** 系统 MUST NOT 把该 proposal/step 标记为完整成功

#### Scenario: 不存在 evidence ID 被拒绝
- **WHEN** 一个 proposal/step 输出引用了不存在、跨 project 或格式无法识别的 evidence ID
- **THEN** 系统 MUST 记录 `failed` Judge review
- **AND** evidence errors MUST 指出无法验证的 evidence ID

### Requirement: Judge retry loop
系统 SHALL 对 Judge 未通过的 proposal/step 最多执行 3 次总尝试，并保留每轮失败输出和 Judge 反馈。

#### Scenario: 重试后通过
- **WHEN** 前两轮 Judge review 失败，第三轮输出通过
- **THEN** 系统 MUST 保存两条 failed review 和一条 passed review
- **AND** 第一次 review 的 `retry_count` MUST 为 `0`，第二次为 `1`，第三次为 `2`
- **AND** loop MUST NOT 被标记为 `needs_human`

#### Scenario: 三次总尝试后仍失败
- **WHEN** 同一 proposal/step 连续 3 次总尝试的 Judge review 均失败
- **THEN** 系统 MUST 将 step 和 loop 标记为 `needs_human`
- **AND** 系统 MUST 创建人工处理 `feedback_items` 记录
- **AND** 最新 Judge review MUST 保存最后失败原因、required changes、evidence errors 和 `retry_count=2`

#### Scenario: Retry 上限
- **WHEN** 调用方请求超过 3 次总尝试
- **THEN** 系统 MUST 将最大自动尝试次数限制为 3
- **AND** 系统 MUST NOT 无限循环或长时间占用 worker

#### Scenario: retry count 语义
- **WHEN** Judge retry loop 写入任意一条 review
- **THEN** `retry_count` MUST 表示当前 review 前已经失败的尝试次数
- **AND** 系统 MUST NOT 将 `maxAttempts=3` 解释为初始尝试外再额外重试 3 次

### Requirement: Judge 人工处理可见
系统 SHALL 让 FastAPI Harness run 状态查询看到 Judge 失败、retry 次数和人工处理记录。

#### Scenario: 查询需人工处理的 run
- **WHEN** 一个 run 因 Judge retry exhausted 进入 `needs_human`
- **THEN** FastAPI Harness status MUST 返回 loop status、proposal/step status、judge reviews 和 manual handoff
- **AND** payload MUST 包含可操作错误类型或 note

#### Scenario: 跨项目 handoff 被拒绝
- **WHEN** Judge retry exhausted 准备创建人工处理记录，但 `agent_loop_runs`、`agent_step_runs`、`judge_reviews` 或 handoff source 不属于当前 project
- **THEN** 系统 MUST 拒绝创建 `feedback_items` handoff
- **AND** 系统 MUST 记录可诊断的 ownership 错误，不得把跨项目 source 暴露为可处理事项

#### Scenario: 失败输出安全保存
- **WHEN** Judge 保存失败输出摘要
- **THEN** 系统 MUST 保存结构化摘要或白名单字段
- **AND** 系统 MUST NOT 保存或返回 `.env`、Cookie、token、浏览器登录态、`config/cookies/weibo.json` 或 worker stderr

### Requirement: Judge 权限边界
系统 SHALL 让 Judge 只复核和阻断输出，不直接覆盖事实表或现实行动状态。

#### Scenario: Judge 不覆盖事实表
- **WHEN** Judge review 失败或通过
- **THEN** Judge MUST NOT 直接修改 `sentiment_results`、`artist_public_opinion_events`、`publicity_actions` 的事实字段
- **AND** Judge MUST 通过 step status、review 和 handoff 表达结果

#### Scenario: 失败的 post-write review 不被接受
- **WHEN** 一个已经写过候选业务记录的 proposal/step 在 Judge post-write review 中失败
- **THEN** 系统 MUST NOT 删除或覆盖业务表事实字段
- **AND** 系统 MUST NOT 将该 proposal/step 作为 Agent Loop accepted output，直到出现 passed review 或进入人工处理

#### Scenario: Judge 不决定确定性数值
- **WHEN** proposal/step 输出包含情感分数、事件分数、评论权重、趋势窗口或 backtest signal
- **THEN** Judge MUST NOT 将模型或自身输出的数字写成权威指标
- **AND** required changes MUST 指向确定性计算或已有业务记录
