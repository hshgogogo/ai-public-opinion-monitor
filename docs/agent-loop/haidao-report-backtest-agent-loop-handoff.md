# haidao-report-backtest-agent-loop 开发任务交接记录

本文用于 Codex 主控与串行子 agent 交接。本文只记录执行顺序、边界、验收和交接状态，不替代 PRD / OpenSpec proposal / design / tasks。

## 1. 总体工作方式

- 主控 Codex 负责拆分任务、启动子 agent、审核改动、集成、测试、提交和 PR 更新。
- 子 agent 默认串行执行，不并行修改同一阶段。
- 每个子 agent 一次只负责 1-2 个清晰功能块。
- 一个子 agent 完成并通过主控审核以后，下一位子 agent 才继续。
- 每阶段结束后，主控更新本文的状态、变更文件、验证结果和遗留问题。
- 如需突破本文约束，必须先回到主控确认。

## 2. 需求源与技术源

- PRD：`docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md`
- Change queue：`docs/agent-loop-change-queue.md`
- OpenSpec proposal：`openspec/changes/haidao-report-backtest-agent-loop/proposal.md`
- OpenSpec design：`openspec/changes/haidao-report-backtest-agent-loop/design.md`
- OpenSpec specs：`openspec/changes/haidao-report-backtest-agent-loop/specs/`
- OpenSpec tasks：`openspec/changes/haidao-report-backtest-agent-loop/tasks.md`
- 相关既有 change：`haidao-crewai-runtime-adapter`、`haidao-judge-agent-retry-loop`、`haidao-agent-loop-step-attachment`

## 3. 本轮 Harness

- 根级：`AGENTS.md`
- Agent loop：`docs/agent-loop.md`
- PRD 拆解：`docs/prd-to-openspec.md`
- 验证：`docs/verification-rubric.md`
- 最终验收：`docs/final-acceptance.md`
- 子 agent 策略：`docs/subagent-policy.md`
- 记忆：`memory/external-integration-safety.md`、`memory/product-quality-bar.md`、`memory/known-failures.md`

## 4. 不可突破约束

- 不读取、打印、提交 `.env`、Cookie、token、浏览器登录态或 `config/cookies/weibo.json`。
- 不调用真实微博、MediaCrawler、真实 CrewAI 外部模型或新的付费 API。
- 不自动执行、确认或发布现实宣发动作。
- 不让 LLM/Judge 覆盖事实表、决定情感权重、事件分数、趋势窗口或 backtest signal。
- 不把 `unknown` backtest 当失败；必须记录缺失窗口和下一步。
- 不把重叠动作、外部事件或低置信窗口写成单因果结论。
- 不 stage unrelated `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 或 `.playwright-cli/`。

## 5. 当前已知基线

- 目标目录：`/Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor`
- 当前分支：`agent/agent-harness/loop-slice`
- 关键入口：
  - `app/main.py`
  - `app/judge_review_service.py`
  - `workers/enterprise_worker.py`
  - `src/server.js`
  - `test/fastapi-sidecar.test.js`
  - `test/weibo-backtest-fixture.test.js`
  - `test/weibo-memory-report.test.js`
  - `test/weibo-db-persistence.test.js`
- 已知可复用接口：
  - `weibo-backtest-fixture`
  - `weibo-memory-report-fixture`
  - `build_weibo_backtest_fixture`
  - `persist_backtest_memory`
  - `persist_memory_report`
  - `JudgeReviewService`
  - `agent_step_runs` / `judge_reviews`
- 当前不应误处理的变更：
  - `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 既有脏 diff。
  - `.playwright-cli/` 本地 QA 产物。

## 6. 推荐串行任务顺序

### Agent 1：Report/Backtest Contract Worker

目标：

- 负责 OpenSpec tasks 1.x、2.1-2.2、3.1-3.2 的最小红绿闭环。
- 先写 FastAPI contract/service red tests，再实现 report/backtest Harness service skeleton 和 endpoints。

主要触碰范围：

- `app/main.py`
- 可新增 `app/report_backtest_agent_service.py`
- `test/fastapi-sidecar.test.js`
- 必要的小型 fixture 文件

禁止触碰：

- PRD 文档
- `.env`、Cookie、token、浏览器状态
- 真实外部平台调用
- React/Vite 工作台

验收：

- `PYTHON_BIN=.venv/bin/python npm test -- test/fastapi-sidecar.test.js`
- `openspec validate haidao-report-backtest-agent-loop --strict`

状态：已完成

### Agent 2：Persistence/Judge Worker

目标：

- 负责 OpenSpec tasks 2.3-2.4、4.x、5.x。
- 把 report/backtest step 写入 `agent_step_runs`，接入 Judge review，补真实 MySQL persistence 和 no-causal-overclaim 测试。

主要触碰范围：

- `app/report_backtest_agent_service.py`
- `app/judge_review_service.py` 如需新增可复用 helper
- `workers/enterprise_worker.py` 仅限 deterministic backtest/report helper 小改
- `test/weibo-db-persistence.test.js`
- `test/weibo-backtest-fixture.test.js`
- `test/weibo-memory-report.test.js`

禁止触碰：

- PRD 文档
- 无关 migrations，除非实现证明必须且保持 MySQL-safe
- 真实外部平台调用

验收：

- `PYTHON_BIN=.venv/bin/python npm test -- test/weibo-backtest-fixture.test.js test/weibo-memory-report.test.js`
- env-gated local MySQL：`PYTHON_BIN=.venv/bin/python npm test -- test/weibo-db-persistence.test.js`

状态：待开始

### Agent 3：Docs/QA/Review Worker

目标：

- 负责 OpenSpec tasks 6.x、7.x 和反驳式 review。
- 更新 README/运行说明、change queue、交接记录，执行 browser/log spot check。

主要触碰范围：

- `README.md`
- `docs/agent-loop-change-queue.md`
- `docs/agent-loop/haidao-report-backtest-agent-loop-handoff.md`
- PR comment/evidence 文本

禁止触碰：

- PRD 文档，除非用户明确要求。
- `.playwright-cli/` staging。

验收：

- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-report-backtest-agent-loop --strict`
- `git diff --check`
- `npm run agent:guard`
- Browser/API/log QA spot check

状态：待开始

## 7. 每个子 agent 必须回填的交接信息

每个子 agent 完成后，主控在这里追加记录：

```text
日期：
Agent：
任务：
改动文件：
新增接口：
复用接口：
验证命令：
验证结果：
遗留问题：
下一位 agent 注意事项：
生命周期：
```

## 8. Codebase Patterns

- FastAPI Harness owns state and public/service API; legacy worker remains an allowlisted tool adapter.
- Judge reviews step output and acceptance state; Judge does not overwrite business fact tables.
- Backtest `unknown` is a valid partial result with missing-window guidance.
- Public payloads need field allowlists, not only recursive sanitizers.

## 9. 阶段执行记录

### 2026-06-18 Planning

日期：2026-06-18

Agent：主控 Codex + explorer subagent `019ed781-f684-7503-a80d-255e06053fac`

任务：创建 `haidao-report-backtest-agent-loop` OpenSpec proposal/design/specs/tasks，并建立串行 handoff。

改动文件：

- `openspec/changes/haidao-report-backtest-agent-loop/proposal.md`
- `openspec/changes/haidao-report-backtest-agent-loop/design.md`
- `openspec/changes/haidao-report-backtest-agent-loop/specs/report-backtest-agent-loop/spec.md`
- `openspec/changes/haidao-report-backtest-agent-loop/specs/weibo-public-opinion-agent/spec.md`
- `openspec/changes/haidao-report-backtest-agent-loop/specs/weibo-publicity-action-ledger/spec.md`
- `openspec/changes/haidao-report-backtest-agent-loop/tasks.md`
- `docs/agent-loop/haidao-report-backtest-agent-loop-handoff.md`

新增接口：

- 规划中：`POST /api/weibo/agent-runs/{run_id}/reports/daily`
- 规划中：`POST /api/weibo/agent-runs/{run_id}/actions/{action_id}/backtests`

复用接口：

- `weibo-backtest-fixture`
- `weibo-memory-report-fixture`
- `JudgeReviewService`

验证命令：

- `openspec validate haidao-report-backtest-agent-loop --strict`

验证结果：

- specs 阶段已通过；tasks/handoff 后需重新运行。

遗留问题：

- 尚未开始业务代码实现。

下一位 agent 注意事项：

- 先做 contract red tests，不要直接改 worker 主逻辑。
- 不要读取 `.env` 或真实 Cookie。

生命周期：

- explorer 子 agent `019ed781-f684-7503-a80d-255e06053fac` spawn 后返回 403 subscription quota error，未产出有效规划复核，不可计入完成证据。

### 2026-06-25 Agent 1 Started

日期：2026-06-25

Agent：Contract Worker `019efa91-fe22-77e2-92ee-3ae0c44efb68`

任务：OpenSpec tasks 1.1、1.2、2.1、2.2、3.1、3.2 的 FastAPI contract/API skeleton 红绿闭环。

改动文件：

- 待 worker 回填

新增接口：

- `POST /api/weibo/agent-runs/{run_id}/reports/daily`
- `POST /api/weibo/agent-runs/{run_id}/actions/{action_id}/backtests`

复用接口：

- `JudgeReviewService` 只读参考
- legacy deterministic report/backtest helper 仅允许通过窄 adapter 或 fake service 复用

验证命令：

- `PYTHON_BIN=.venv/bin/python npm test -- test/fastapi-sidecar.test.js`
- `openspec validate haidao-report-backtest-agent-loop --strict`

验证结果：

- 运行中

遗留问题：

- 运行中

下一位 agent 注意事项：

- 运行中

生命周期：

- completed, integrated, closed

### 2026-06-25 Agent 1 Completion

日期：2026-06-25

Agent：Contract Worker `019efa91-fe22-77e2-92ee-3ae0c44efb68`

任务：OpenSpec tasks 1.1、1.2、2.1、2.2、3.1、3.2 的 FastAPI contract/API skeleton 红绿闭环。

改动文件：

- `app/main.py`
- `app/report_backtest_agent_service.py`
- `test/fastapi-sidecar.test.js`
- `openspec/changes/haidao-report-backtest-agent-loop/tasks.md`

新增接口：

- `POST /api/weibo/agent-runs/{run_id}/reports/daily`
- `POST /api/weibo/agent-runs/{run_id}/actions/{action_id}/backtests`

复用接口：

- `workers.enterprise_worker.daily_report`
- `workers.enterprise_worker.backtest_scenario`

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test --test-name-pattern 'daily report|action backtest|ReportBacktestAgentService|DeterministicReportBacktestAdapter' test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python npm test -- test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`（脱沙箱，因沙箱内监听 127.0.0.1 会 EPERM）
- `openspec validate haidao-report-backtest-agent-loop --strict`
- `git diff --check`
- `npm run agent:guard`

验证结果：

- 定向 pattern：6/6 pass
- FastAPI sidecar：42/42 pass
- 全量 no-DB：246 tests, 194 pass / 52 skipped / 0 fail
- OpenSpec strict validate：pass
- diff check：pass
- guard：pass

遗留问题：

- 尚未实现 Judge deep integration、`agent_step_runs`/`judge_reviews` persistence、真实 MySQL report/backtest persistence、no-causal-overclaim 深测；这些留给 Agent 2。

下一位 agent 注意事项：

- 不要把当前 API skeleton 当成完整 report/backtest loop 完成；下一步必须写持久化和 Judge gate 的 red tests。
- 继续避开 `.env`、Cookie、token、真实平台调用和 PRD 既有脏 diff。

生命周期：

- Contract Worker completed with concerns; P2 已由主控修复；spec re-review `019efb37-7c96-7170-a900-d7cad6d08a76` 通过；worker 和 spec reviewers 均已关闭。

### 2026-06-25 Agent 1 Security Re-review Closure

日期：2026-06-25

Agent：主控 Codex + reviewer `019efb55-b9c5-7343-981c-02b5a206bf77`

任务：收口 Report/Backtest API skeleton 的 public response 安全边界，补 reviewer 发现的 P1/P2/P3。

改动文件：

- `app/main.py`
- `app/report_backtest_agent_service.py`
- `test/fastapi-sidecar.test.js`
- `docs/agent-loop-change-queue.md`
- `openspec/changes/haidao-report-backtest-agent-loop/tasks.md`
- `docs/agent-loop/haidao-report-backtest-agent-loop-handoff.md`
- `memory/known-failures.md`

新增接口：

- 无新增 endpoint；强化既有 Agent Loop run/status、daily report、action backtest public response contract。

复用接口：

- `positive_integer`
- `safe_text`
- `daily_report_public_response`
- `action_backtest_public_response`
- `sanitize_for_public`

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test --test-name-pattern 'FastAPI sidecar validates Agent Loop run payloads and delegates valid runs to an injected adapter' test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python node --test --test-name-pattern 'Report/backtest service import|daily report|action backtest|ReportBacktestAgentService|DeterministicReportBacktestAdapter|Agent Loop run payloads' test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python npm test -- test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`（脱沙箱，因沙箱内监听 127.0.0.1 会 EPERM）
- `python3 -m compileall app/report_backtest_agent_service.py app/main.py`
- `openspec validate haidao-report-backtest-agent-loop --strict`
- `git diff --check`
- `npm run agent:guard`

验证结果：

- Agent Loop run/status 红测：pass
- report/backtest 定向 pattern：8/8 pass
- FastAPI sidecar：43/43 pass
- 全量 no-DB：248 tests, 196 pass / 52 skipped / 0 fail
- compileall：pass
- OpenSpec strict validate：pass
- diff check：pass
- guard：pass

Review 结果：

- reviewer `019efb55-b9c5-7343-981c-02b5a206bf77` 初审发现 P1/P2：unknown+succeeded/running 状态穿透、allowlisted text 中 raw artifact path 泄露、change queue row 12 依赖 planned workbench、import-env 测试未真实覆盖父进程 `YUQING_SKIP_ENV_FILE=0`。
- 二审发现剩余 P2：top-level `agentLoopRunId` 已净化，但 nested `run.id` 仍可能保留非正整数 public ID。
- 三审 APPROVED：无 P0/P1/P2；确认 `run.id`、env override、unknown status、path/raw artifact sanitization 均关闭。

遗留问题：

- 尚未实现 Judge deep integration、`agent_step_runs`/`judge_reviews` persistence、真实 MySQL report/backtest persistence、no-causal-overclaim 深测；这些留给 Agent 2。
- OpenSpec tasks 7.x 最终验证任务后续仍需在 Agent 2/3 后重新运行并勾选。

下一位 agent 注意事项：

- Agent 2 先写 Judge/service red tests：缺失 evidence、model-owned metrics、causal overclaim 必须被拒并写 redacted failed-output summary。
- 所有 public response 不只检查 top-level 字段，也要检查 nested allowlisted objects，例如 `run.id`、report/backtest summary、nextRecommendation。
- 继续避开 `.env`、Cookie、token、真实平台调用和 PRD 既有脏 diff。

生命周期：

- reviewer `019efb55-b9c5-7343-981c-02b5a206bf77` completed, integrated, closed.

### 2026-06-25 Agent 2 Persistence/Judge First Slice

日期：2026-06-25

Agent：Persistence-Judge Worker `019efb68-465c-7e21-bd12-5ede980d9c86` + reviewer `019efb74-fdc6-7231-8978-0b1e97f6d95e`

任务：推进 OpenSpec tasks 1.3、2.3、2.4 的 fake/local 第一阶段：Report/Backtest service 记录 step audit，并把 step output 交给 Judge review；Judge 拒绝 missing evidence、model-owned metrics、causal overclaim，并返回 required changes / evidence errors / redacted failed-output summary。

改动文件：

- `app/report_backtest_agent_service.py`
- `app/judge_review_service.py`
- `test/fastapi-sidecar.test.js`
- `openspec/changes/haidao-report-backtest-agent-loop/tasks.md`
- `docs/agent-loop/haidao-report-backtest-agent-loop-handoff.md`

新增接口：

- 无新增 HTTP endpoint；扩展 `ReportBacktestAgentService` 构造器，支持注入 `step_repository` 与 `judge_review_service`。

复用接口：

- `JudgeReviewService.create_review`
- Rule Judge evidence / boundary checks
- 既有 report/backtest public response sanitizer

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test --test-name-pattern 'ReportBacktestAgentService records|ReportBacktestAgentService rejects unsafe' test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python node --test --test-name-pattern 'JudgeReviewService maps report/backtest persisted step evidence into Rule Judge input' test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python node --test --test-name-pattern 'ReportBacktestAgentService|daily report|action backtest|Judge' test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python npm test -- test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`（脱沙箱，因沙箱内监听 127.0.0.1 会 EPERM）
- `openspec validate haidao-report-backtest-agent-loop --strict`
- `git diff --check`
- `python3 -m compileall app/report_backtest_agent_service.py app/judge_review_service.py`
- `npm run agent:guard`

验证结果：

- 新增红测初次失败于 `ReportBacktestAgentService.__init__()` 不支持 `step_repository`，随后实现后通过。
- 主控补充 persisted-step 红测初次失败于 `sentiment:4` 被映射为 Judge 不支持的 `sentiment-4`，随后修为 `analysis-4` 后通过。
- 新增定向 tests：2/2 pass。
- persisted-step evidence mapper：1/1 pass。
- report/backtest/Judge pattern：23/23 pass。
- FastAPI sidecar 文件：46/46 pass。
- 全量 no-DB：251 tests, 199 pass / 52 skipped / 0 fail。
- OpenSpec strict validate：pass。
- diff check：pass。
- compileall：pass。
- guard：pass。

Review 结果：

- reviewer `019efb74-fdc6-7231-8978-0b1e97f6d95e` 初审发现 P2：persisted step 的 Judge mapper 把 `sentiment:4` 转成 unsupported `sentiment-4`，而直接 service path 已正确转 `analysis-4`。
- 主控补测试并修复 `normalize_report_backtest_evidence_ids()`。
- reviewer re-review APPROVED：无 P0/P1/P2；确认 fake/local service-Judge-step audit 可通过，真实 MySQL persistence、真实 Judge persistence、全链路 no-causal-overclaim 仍留后续。

遗留问题：

- 2.3/2.4 仍未勾：本轮只证明 fake/local repository 与 service/Judge contract，未执行真实 MySQL `agent_step_runs` / `judge_reviews` 持久化验证。
- 4.x 真实 MySQL persistence、5.x no-causal-overclaim 全链路 Q&A/report 行为仍留给后续 worker。
- 默认 `MYSQL_URL` 未配置时 service 不自动写 MySQL step repository；测试通过注入 fake repository 证明本轮 contract。

下一位 agent 注意事项：

- 真实 MySQL worker 需要验证 `MySQLAgentStepRepository` 写入/更新与 loop 状态联动，尤其是 Judge failed / needs_human / retry-exhausted 时的 step status。
- 如果继续扩展 Judge stepRunId 直读路径，可为 `daily_report` / `action_backtest` mapper 增加独立 red tests。
- 继续不要读取 `.env`、Cookie、token、真实平台登录态，不要碰 PRD 既有脏 diff 或 `.playwright-cli/`。

生命周期：

- worker `019efb68-465c-7e21-bd12-5ede980d9c86` completed with concerns; 主控已集成并补 P2 修复。
- reviewer `019efb74-fdc6-7231-8978-0b1e97f6d95e` completed, approved, closed.
