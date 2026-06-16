# Agent Loop Change Queue

来源 PRD：
- `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md`

全局 MVP outcome：
- 在已跑通微博采集、分析、事件、行动和证据问答的基础上，把系统升级为可审计、可复核、可写回的《海岛舒服日志》宣发舆情 Agent Harness。

全局不做：
- 不在一个 change 中同时迁移 FastAPI、React、CrewAI、知识库和所有前端页面。
- 不自动发布外部平台内容。
- 不把 CrewAI/DeepSeek 输出当成最终事实来源。
- 不提交 `.env`、Cookie、token、浏览器登录态或真实账号材料。
- 不把小红书、抖音纳入首版闭环。

全局风险边界：
- DeepSeek 已被用户授权可在本项目中使用，但不得打印或提交 API key。
- 真实微博 Cookie、Chrome 登录态和 `config/cookies/weibo.json` 只能在用户已确认的真实采集切片中使用，且不得打印或提交。
- 其他付费 API、大规模外部调用、生产数据库破坏性迁移、PR merge 和生产发布必须人工确认。
- Agent 自进化首版只能生成待审草案，不能直接改生产代码、migration、规则、skill 或外部平台内容。

## 执行顺序

| 顺序 | Change ID | Outcome | 本地验证方式 | 依赖 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| 1 | haidao-agent-harness-loop-foundation | 建立最小 Agent Loop 账本：run、step、Judge review skeleton、manual handoff skeleton | migration tests, worker command tests, real MySQL persistence tests, OpenSpec strict validate | 已归档 Weibo MVP | 低 | done |
| 2 | haidao-agent-loop-trigger-api | 暴露 `/api/weibo/agent-loop/run` 和 `GET /api/weibo/agent-runs/:id`，只负责创建/查询 loop，不串完整业务 | API contract tests, MySQL unavailable tests | 1 | 低 | done |
| 3 | haidao-agent-loop-step-attachment | 让已存在的分析、事件、行动、问答 worker 可选挂载 `agentLoopRunId` 并写 step evidence | worker tests, real MySQL persistence tests | 1 | 中 | done |
| 4 | haidao-feedback-memory-loop | 用户反馈、人工确认/驳回、偏好写回影响后续建议 | feedback API tests, memory persistence tests, action/event state tests | 1, 3 | 中 | done |
| 5 | haidao-knowledge-card-rag-mvp | 建立结构化营销知识卡、检索和建议引用，不把知识写死在代码里 | migration/tests, card validation tests, suggestion citation tests | 1 | 中 | done |
| 6 | haidao-judge-agent-retry-loop | Judge Agent 对分析、事件、建议做 pass/fail 复核，最多 3 轮后进入人工处理 | judge schema tests, retry tests, failed-output persistence tests | 1, 3, 5 | 中 | active |
| 7 | haidao-report-backtest-agent-loop | Report Agent 和 Backtest Agent 进入 loop，日报/回测结果带证据、归因限制和 Judge 状态 | report tests, backtest tests, no-causal-overclaim tests | 1, 3, 6 | 中 | planned |
| 8 | haidao-agent-workbench-react-shell | 在不推翻旧前端的前提下，引入 React/Vite 工作台 shell 展示 loop 状态、评论、分析、事件、建议、日报和问答 | frontend tests, browser QA, no console errors | 2, 3, 6, 7 | 中 | planned |
| 9 | haidao-fastapi-sidecar-harness | 新增 FastAPI sidecar 承载新 Agent Harness API，与旧 Node 服务并行 | FastAPI tests, Node proxy/compat tests, health checks | 2, 3 | 中 | planned |
| 10 | haidao-crewai-runtime-adapter | 引入 CrewAI Flow/Agent adapter，但 Agent 只产出 proposal，由 Harness 校验后写库 | unit tests with fake CrewAI tools, failure/fallback tests | 1, 6, 9 | 高 | planned |
| 11 | haidao-rule-proposal-self-evolution | 用户反馈/Judge 失败生成待审 rule proposal 或知识卡草案 | rule proposal tests, approval-state tests | 4, 5, 6 | 中 | planned |
| 12 | haidao-final-acceptance-weibo-agent | 按 `docs/final-acceptance.md` 真实使用工作台并监控日志，发现 P0/P1/P2 回流修复 | browser QA, logs, DB checks, PR acceptance report | 1-11 | 中 | planned |

## Change: haidao-agent-harness-loop-foundation

Outcome:
- 每次微博 Agent Loop 可以被记录为 `agent_loop_runs`，每个阶段可以记录为 `agent_step_runs`，关键输出可以有 `judge_reviews` 骨架，失败或需人工处理可以进入 manual handoff skeleton。

范围:
- 新增最小 Harness ledger schema。
- 新增 worker 层可调用的 loop run 创建、step 记录、Judge review skeleton 和 manual handoff skeleton。
- 提供 worker-only 创建/查询命令，供下一轮 API change 包装。
- 保留 Node 服务、现有 Python worker、现有微博分析/事件/行动/问答命令行为。

不做:
- 不新增 HTTP endpoint。
- 不把现有分析、事件、行动、问答 worker 挂载到 loop。
- 不调用真实 MediaCrawler。
- 不强制真实 DeepSeek 调用。
- 不实现完整 Judge LLM 或重试循环。
- 不做 React/Vite 迁移。
- 不做知识库/RAG。
- 不实现用户确认/驳回/偏好写回语义，只保留 manual handoff skeleton。

Done rubric 摘要:
1. 迁移安全创建 `agent_loop_runs`、`agent_step_runs`、`judge_reviews`、`feedback_items`。
2. worker 能创建 loop run、记录 step start/success/failure、记录 Judge review skeleton。
3. worker 能记录 manual handoff skeleton，但不处理完整用户反馈语义。
4. 查询命令能返回 run、steps、judge reviews 和 handoff items。
5. 所有新增记录都引用真实 project/source IDs，不写入 mock 结论。

建议测试:
- migration 声明和真实 MySQL 幂等测试。
- worker command fixture tests。
- real MySQL persistence tests for run/step/review/handoff records。
- no-secret guard tests。

验收方式:
- `npm test`
- `WEIBO_DB_PERSISTENCE_TEST_URL=... npm test`
- `openspec validate haidao-agent-harness-loop-foundation --strict`
- `git diff --check`
- `npm run agent:guard`

依赖:
- 已归档 `haidao-weibo-agent-mvp` 的 MySQL tables 和 worker commands。

风险与人工 gate:
- 只用本地 MySQL/fixture 验证；真实微博 Cookie 和生产数据不在本 change 使用。

## Change: haidao-agent-loop-trigger-api

Outcome:
- 用户或后端可以通过 HTTP 创建一次微博 Agent Loop run，并查询 run/step/Judge/manual handoff 状态。

范围:
- `POST /api/weibo/agent-loop/run`。
- `GET /api/weibo/agent-runs/:id`。
- manual/scheduled/after_collection trigger mode 参数校验。
- MySQL unavailable 和项目范围错误处理。

不做:
- 不串完整业务 loop。
- 不引入 FastAPI。
- 不引入 CrewAI。

Done rubric 摘要:
1. run endpoint 返回 run ID 和 pending/running/failed 状态。
2. status endpoint 显示 step、Judge 和 manual handoff 状态。
3. 失败状态有 `error_type` 和可操作建议。

## Change: haidao-agent-loop-step-attachment

Outcome:
- 现有微博分析、事件、行动和问答 worker 可以可选接收 `agentLoopRunId`，在保持原行为的同时写入 step evidence。

范围:
- `weibo-comments-analyze` step attachment。
- `weibo-events-build` step attachment。
- `weibo-actions-build` step attachment。
- `weibo-bot-message` step attachment。
- standalone backward compatibility。

不做:
- 不新增 UI。
- 不实现 Judge retry。

Done rubric 摘要:
1. 未传 `agentLoopRunId` 时现有命令行为不变。
2. 传入有效 run ID 时写入 step status 和 evidence IDs。
3. step 失败时 loop 状态可追踪。

## Change: haidao-feedback-memory-loop

Outcome:
- 用户可以确认、驳回、修改事件/建议/账号类型/偏好，反馈写入 `feedback_items` 和 `bot_memory_items`，后续建议会读取这些反馈。

范围:
- 用户反馈 API。
- action/event/source account 状态更新。
- preference memory 写回。
- 后续建议读取偏好约束。

不做:
- 不自动认定现实动作已执行。
- 不自动发布内容。

Done rubric 摘要:
1. 反馈记录有来源、状态、note、created_by。
2. action/event 状态变更可审计。
3. 用户偏好影响后续建议排序或文案。

## Change: haidao-knowledge-card-rag-mvp

Outcome:
- Strategy Agent 能引用结构化营销知识卡，Judge 能检查适用条件和禁用条件。

范围:
- `knowledge_sources`、`knowledge_cards`。
- 首批脱敏/摘要式知识卡 seed。
- MySQL text retrieval MVP。
- 建议输出包含 knowledge card IDs。

不做:
- 不复制受版权保护的长篇内容。
- 不引入向量数据库作为首版硬依赖。

Done rubric 摘要:
1. 知识卡有来源、可信度、适用条件、禁用条件和 judge questions。
2. 建议能引用知识卡。
3. C 级来源不能作为硬规则。

## Change: haidao-judge-agent-retry-loop

Outcome:
- 分析、事件、策略建议在写库前或写库后可被 Judge 复核，失败反馈最多重试 3 轮，仍失败进入人工处理。

范围:
- Judge rubric schema。
- pass/fail review persistence。
- retry counter。
- 人工处理队列。

不做:
- 不让 Judge 覆盖事实表。
- 不让模型决定数值指标。

Done rubric 摘要:
1. 无证据输出被拒绝。
2. 不存在 ID 被拒绝。
3. 空泛建议被拒绝。
4. 3 轮失败进入人工处理。

## Change: haidao-report-backtest-agent-loop

Outcome:
- Report Agent 和 Backtest Agent 进入 Agent Loop，日报和回测输出带证据、覆盖范围、归因限制和 Judge 状态。

范围:
- 日报生成 step 挂载。
- action backtest step 挂载。
- backtest confounder/no-causal-overclaim checks。
- report/backtest evidence IDs。

不做:
- 不声称营销动作单独导致结果变化。
- 不自动执行现实动作。

Done rubric 摘要:
1. 日报包含数据覆盖、事件、行动、引用和下一步。
2. backtest unknown 是有效输出并说明缺失窗口。
3. 重叠动作/外部事件不会被写成单因果结论。

## Change: haidao-agent-workbench-react-shell

Outcome:
- 用户能在 React 工作台看到 Agent Loop 状态、评论/分析/事件/建议/Judge/日报/问答，而不是只看静态看板。

范围:
- Vite + React shell。
- 当前 Node API 适配。
- 评论、分析、事件、行动、Judge、日报、问答只读/基础交互。

不做:
- 不一次性替换所有旧页面。

Done rubric 摘要:
1. 前端显示 loop 当前阶段和卡点。
2. 评论/分析/Judge/建议/日报有空/加载/成功/失败状态。
3. 浏览器 QA 无明显 console error。

## Change: haidao-fastapi-sidecar-harness

Outcome:
- FastAPI sidecar 可以承载新 Agent Harness API，与旧 Node 服务并行验证。

范围:
- FastAPI app skeleton。
- health/migrate/status 基础接口。
- Node proxy 或并行启动说明。

不做:
- 不下线 Node。
- 不把所有 API 一次迁移。

Done rubric 摘要:
1. FastAPI 可本地启动。
2. 不破坏旧 Node 工作台。
3. health/status 有测试。

## Change: haidao-crewai-runtime-adapter

Outcome:
- CrewAI Flow/Agent 可以生成结构化 proposal，但不能直接写库；Harness 校验后决定写回。

范围:
- CrewAI dependency in project env。
- fake tool tests。
- proposal schema and validation.

不做:
- 不让 CrewAI 直接访问 `.env`、Cookie 或 DB 写权限。

Done rubric 摘要:
1. Agent 只返回 proposal。
2. Harness 拒绝无证据 proposal。
3. CrewAI 失败有 fallback/error record。

## Change: haidao-rule-proposal-self-evolution

Outcome:
- 用户反馈、Judge 失败和回测结果能生成待审规则/知识卡草案，等待人工确认后才生效。

范围:
- `rule_proposals`。
- 草案状态机。
- 人工确认入口。

不做:
- 不自动改代码、skill、migration 或生产规则。

Done rubric 摘要:
1. 草案有来源 evidence IDs。
2. 未确认草案不影响线上判断。
3. 确认后才进入可检索知识/规则。

## Change: haidao-final-acceptance-weibo-agent

Outcome:
- 完成所有开发 change 后，真实使用网站/程序，监控日志和数据库，形成最终验收报告。

范围:
- 启动本地环境。
- 浏览器真实操作核心路径。
- 日志、网络、DB 检查。
- P0/P1/P2 回流修复。

不做:
- 不 merge PR。
- 不生产发布。

Done rubric 摘要:
1. 核心路径可真实走通。
2. 日志无未解决 P0/P1/P2。
3. 验收报告写入 PR 或文档。
