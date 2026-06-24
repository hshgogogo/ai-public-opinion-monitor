## Context

当前项目已经具备 Agent Loop ledger、FastAPI sidecar、CrewAI proposal-only adapter 和 Judge retry loop。旧 `workers/enterprise_worker.py` 中已有 deterministic backtest fixture、memory report fixture、`action_backtests`/`daily_reports`/`bot_memory_items` 持久化 helper，但它们还没有作为 Report Agent / Backtest Agent 的 Harness step 被统一审计。

本 change 要把 report/backtest 纳入新主线：FastAPI Harness 是入口和状态机，legacy worker 只是 allowlisted tool adapter；Agent 或 fixture 输出必须先被 Harness 校验证据、归属、归因边界和 Judge 状态，再写入 step audit 或业务表。

## Goals / Non-Goals

**Goals:**
- Report Agent 生成日报时记录 `agent_step_runs`，输出包含 data coverage、citations、events/actions/backtests summary、insufficient evidence notes 和 Judge 状态。
- Backtest Agent 生成 action 回测时记录 `agent_step_runs`，输出包含 action ID、pre/post windows、deterministic metric changes、confounders、attribution confidence、result/unknown 和 Judge 状态。
- `unknown` 回测结果作为成功的可审计 partial outcome 保存，并明确缺失窗口或缺失行动信息。
- Judge 检查 report/backtest 的 evidence IDs、项目归属、空泛输出、deterministic metric 边界和 no-causal-overclaim。
- 真实 MySQL 测试证明 report/backtest step、Judge review、业务持久化和 cross-project evidence rejection。

**Non-Goals:**
- 不实现 React/Vite 工作台，日报展示和可视化留给后续 workbench shell change。
- 不调用真实微博 Cookie、真实 MediaCrawler、真实 CrewAI 外部模型或新的付费 API。
- 不自动确认、发布或执行现实宣发动作。
- 不让 LLM/Judge 覆盖事实表、决定 trend window、event score、sentiment weight 或 backtest signal。

## Decisions

### Decision 1: FastAPI Harness service owns report/backtest orchestration

新增或扩展 FastAPI service boundary，例如 `ReportBacktestAgentService`，由它验证 `project_id`、`agent_loop_run_id`、`action_id`/`report_date` 和 evidence scope。service 负责调用 allowlisted legacy worker helper 或 fake runtime，记录 step status，并把输出交给 Judge service。

Alternative considered: 继续暴露旧 Node `/api/weibo/actions/:id/backtest` 作为主实现。拒绝原因是旧 Node 只能代理 worker，不能表达 CrewAI proposal audit、Judge retry 和 Harness-owned 状态机。

### Decision 2: Reuse deterministic worker helpers behind a narrow adapter

Backtest 指标沿用 `backtest_scenario`、`classify_backtest_signal`、`backtest_confounders` 等 deterministic helper；Report 沿用 `daily_report`/`persist_memory_report` 生成结构。FastAPI adapter 只传 service-owned allowlisted inputs，不接受 caller-controlled command、fixture path、raw artifact path 或外部 runner output。

Alternative considered: 为 report/backtest 新建 CrewAI 生成逻辑。拒绝原因是本 change 的风险集中在审计和归因边界，直接引入生成式逻辑会扩大外部模型和幻觉风险。

### Decision 3: Judge reviews the step output, not the business tables

Report/backtest 完成后创建 Judge review。通过时 step 可标记 accepted/succeeded；失败时记录 required changes、evidence errors 和 failed output summary，必要时进入 retry/needs_human。Judge 不删除或覆盖 `daily_reports`、`action_backtests` 或 `bot_memory_items`，但失败输出不得被 Agent Loop 当成可信 accepted outcome。

Alternative considered: 让 Judge 直接修改 report/backtest 结果。拒绝原因是这会让质量门变成另一个事实写入者，破坏 Harness 审计边界。

### Decision 4: Unknown and confounded backtests are first-class outputs

当行动缺少 `effective_at`、相关事件/目标、baseline 或 post window 时，Backtest Agent 返回 `result: "unknown"`、`eligible: false`、`missing_data_reason` 和下一步采集建议。存在多个重叠动作、外部事件或 volume spike 时，输出必须包含 `confounders`，文案必须使用“相关信号/不能确认单独导致”。

Alternative considered: 把 unknown 当失败。拒绝原因是 PRD 明确要求证据不足时可复核地说明缺口，unknown 是产品可用的下一步指引。

### Decision 5: Evidence IDs remain scoped and typed

Report/backtest step 的 `evidence_ids` 只能来自同项目已存在 records，例如 `comment:<id>`、`sentiment:<id>`、`event:<id>`、`action:<id>`、`backtest:<id>`、`report:<id>`、`memory:<id>` 或已允许的跨平台 evidence string。跨项目、不存在或危险 payload 必须在进入 runtime/worker 前拒绝。

Alternative considered: 只依赖 recursive sanitizer。拒绝原因是 memory 中已有失败模式证明 sanitizer 不能替代 allowlist 和 ownership validation。

## Risks / Trade-offs

- Report/backtest 首轮仍复用 legacy worker helper → 用 narrow FastAPI adapter 和 service-owned allowlist 限制命令范围，后续可再把 deterministic core 拆到独立模块。
- 真实 MySQL 测试较重 → 只把归属校验、step/Judge/业务持久化放进 env-gated MySQL test；普通 fixture/FastAPI tests 覆盖大部分 contract。
- Judge 失败后业务表可能已有草稿记录 → step/Judge status 必须明确 accepted/rejected/needs_human，前端和 Q&A 只能引用 accepted 或明确标注未通过的结果。
- 回测指标容易被误读为因果结论 → spec、tests 和 Judge rule 同时检查 no-causal-overclaim wording 与 confounder presence。
- 外部真实数据验收需要 Cookie/账号 → 本 change 不做真实外部采集；最终验收只使用已有本地/fixture/测试 MySQL 数据，真实账号路径必须人工确认。
