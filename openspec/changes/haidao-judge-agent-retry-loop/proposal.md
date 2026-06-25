## Why

当前微博 Agent Loop 已经能记录 run、step、Judge review 骨架，也能把分析、事件、行动和问答 step 挂到 loop 上。`haidao-fastapi-sidecar-harness` 与 `haidao-crewai-runtime-adapter` 已经把后续 Agent 主线切到 FastAPI + CrewAI proposal contract：Agent 只产出结构化 proposal，Harness 负责证据、权限、状态机、审计和写回。

因此本 change 需要从原来的旧 worker-only 编排重新定向为 FastAPI/CrewAI Harness 上的 Judge quality gate。分析、事件和行动 proposal 仍缺少统一的 Judge 复核与失败重试编排：无证据输出、不存在的 evidence ID、空泛建议、套错知识卡或把推断写成事实时，系统还不能把该 proposal/step 标为未接受、要求重做，并在 3 次总尝试后进入人工处理。

本 change 让 Judge Agent 成为 Harness 的质量门，而不是另一个会覆盖事实表的生成器。

## What Changes

- 在 FastAPI Harness 内新增 Judge retry 编排能力：对 CrewAI proposal audit、legacy tool step output、以及后续分析/事件/行动 proposal 做规则化 Judge review。
- Judge review MUST 检查 evidence IDs、输出结构、事实/推断边界、知识卡引用边界、空泛建议和数值指标边界。
- 失败 review MUST 记录 required changes、evidence errors、retry count、失败输出摘要，并最多执行 3 次总尝试。
- 第 3 次尝试仍失败时，loop 和 step MUST 进入 `needs_human`，并创建 `feedback_items` 人工处理记录。
- 对通过 review 的 proposal/step，系统 MUST 记录 passed Judge review，并保持原业务写库结果不被 Judge 覆盖。
- 本 change 是 proposal/post-write quality gate：Judge 失败不会删除或覆盖业务表，但该 proposal/step 不得被 Agent Loop 当作 accepted output。
- 新增可本地验证的 FastAPI service/fixture/fake runtime 路径，证明 retry、manual handoff 和状态查询，不调用真实 MediaCrawler、真实微博登录、真实 CrewAI 或新的 public frontend。
- Q&A、Report、Backtest 的 Judge 接入后置到后续 change，避免首轮扩大范围。

## Capabilities

### New Capabilities

- `agent-judge-retry-loop`: Judge review、最多 3 次总尝试、失败输出保存和人工处理队列。

### Modified Capabilities

- `weibo-public-opinion-agent`: 分析和事件输出必须接受 Judge 证据与边界检查；失败时不得作为最终可信输出。Q&A 接入后置。
- `weibo-publicity-action-ledger`: 行动建议必须接受 Judge 检查；空泛建议、无证据建议、禁用知识卡引用和过度因果表述必须被拒绝。

## Impact

- FastAPI：新增 Harness-owned Judge service/API boundary，复用 CrewAI proposal audit contract、Agent Loop run/step ledger、`judge_reviews` 和 `feedback_items`。
- Legacy worker：只作为 tool adapter/ledger compatibility；不继续把新的 Judge 主业务编排写进 `workers/enterprise_worker.py`。如需调用旧 worker，只能通过已 allowlist 的 FastAPI adapter。
- 数据库：优先复用 `agent_loop_runs`、`agent_step_runs`、`judge_reviews`、`feedback_items`；如实现发现需要保存失败输出快照，可在 MySQL-safe migration 中增量补充字段，但不得破坏现有表。
- API：首轮可以新增 FastAPI 内部/service-level endpoint 或 worker-facing endpoint；不新增前端控件，不修改旧 Node public workbench 入口。
- 测试：新增 FastAPI/service contract tests、fixture/fake runtime tests、真实 MySQL persistence tests，覆盖 passed、failed retry、3 次后 needs_human、manual handoff 和不泄露内部 payload。
- 安全：不读取或打印 `.env`、Cookie、token、浏览器登录态或 `config/cookies/weibo.json`；不调用真实 MediaCrawler、真实微博登录、真实 CrewAI 外部模型或新的付费 API。
