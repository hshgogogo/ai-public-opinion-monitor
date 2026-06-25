## Why

Report Agent 和 Backtest Agent 目前还停留在旧 worker/fixture 能力上，尚未进入 FastAPI + CrewAI Harness 的 Agent Loop 账本与 Judge 质量门。没有这个 change，日报、回测和后续问答会缺少统一的 evidence、coverage、attribution limit 和 audit 状态，容易把生成文本或单次窗口变化误当成可复核结论。

## What Changes

- 将日报生成接入 Agent Loop step：输出必须包含数据覆盖范围、引用 ID、事件/行动摘要、证据不足说明和 Judge 状态。
- 将 action backtest 接入 Agent Loop step：输出必须包含行动、前后窗口、metric changes、confounders、attribution confidence、next recommendation 和 Judge 状态。
- 明确 `unknown` 是 backtest 的有效结果：缺少行动时间、缺少 pre/post 窗口或证据不足时必须说明缺口，不得伪造效果。
- 强化 no-causal-overclaim：重叠动作、外部事件或证据不足时，系统只能描述相关信号，不能声称单个动作导致结果变化。
- 复用 CrewAI proposal-only 边界、Judge retry 账本和 existing worker/FastAPI adapter；Harness 负责校验证据 ID、项目归属、状态机和写回。
- 新增 fixture/service/FastAPI/real MySQL 测试，证明 report/backtest step、Judge review、evidence IDs 和 unknown/no-causal-overclaim 行为。
- 本 change 不实现 React/Vite 工作台，不自动执行现实宣发动作，不调用真实微博 Cookie、真实 MediaCrawler、真实 CrewAI 外部模型或新的付费 API。

## Capabilities

### New Capabilities
- `report-backtest-agent-loop`: Report Agent 与 Backtest Agent 在 Agent Loop 中生成可审计日报和回测结果的能力。

### Modified Capabilities
- `weibo-public-opinion-agent`: Q&A/日报必须基于真实证据和记忆生成，并在证据不足、趋势不足或归因不足时使用明确失败/不足表达。
- `weibo-publicity-action-ledger`: backtest 结果必须进入 Harness step/Judge audit，且必须保持 deterministic metric 与 no-causal-overclaim 边界。

## Impact

- FastAPI：新增或扩展 Harness-owned report/backtest service/API boundary，用于触发日报和回测 step、返回稳定错误结构和状态。
- Legacy worker：复用既有 `weibo-action-backtest`、`weibo-memory-report-fixture` 和持久化 helper 作为受控 tool adapter；不继续把新 Agent 主业务写进旧 worker。
- 数据库：优先复用 `agent_loop_runs`、`agent_step_runs`、`judge_reviews`、`action_backtests`、`daily_reports`、`bot_memory_items`；如确需新增字段，必须保持 MySQL-safe migration 和向后兼容。
- 测试：新增/更新 fixture tests、FastAPI contract tests、Judge/service tests 和真实 MySQL persistence tests，覆盖成功、unknown、confounder/no-causal-overclaim、cross-project evidence rejection 和 audit persistence。
- 安全：不读取或打印 `.env`、Cookie、token、浏览器登录态或 `config/cookies/weibo.json`；自动测试只使用 fixture、本地 FastAPI fake services 和明确的本地测试 MySQL。
