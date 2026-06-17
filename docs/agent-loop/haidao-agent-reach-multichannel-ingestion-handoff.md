# haidao-agent-reach-multichannel-ingestion 开发任务交接记录

本文用于 Codex 主控与真实子 agent 串行交接。需求事实源仍以 OpenSpec change 为准。

## 1. 总体工作方式

- 主控 Codex 负责选择小切片、定义 done rubric、启动子 agent、审核改动、验证、提交和继续下一切片。
- 子 agent 默认串行执行；每个 worker 只负责 1-2 个清晰功能块。
- 每个切片自动 commit 前必须有真实子 agent 证据，并同步记录到 `docs/agent-loop/subagent-events.jsonl`。
- 子 agent 不得回滚他人改动，不得触碰真实凭据、Cookie、`.env`、浏览器状态或生产数据。

## 2. 需求源与技术源

- PRD：`docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md`
- OpenSpec：`openspec/changes/haidao-agent-reach-multichannel-ingestion/`
- Agent Loop：`docs/agent-loop.md`
- 验证：`docs/verification-rubric.md`
- 最终验收：`docs/final-acceptance.md`

## 3. 不可突破约束

- 不读取或提交 `.env`、真实 Cookie/token、`config/cookies/*`、浏览器状态。
- 不调用真实 B站、小红书、抖音、Agent-Reach 外部平台服务。
- 真实 MySQL 只在 `WEIBO_DB_PERSISTENCE_TEST_URL` 设置时运行 env-gated 测试。
- 不 stage 或回滚无关 `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 脏改。
- 不在 `main` 或 `master` 自动 commit/push。

## 4. 当前基线

- 已完成 2.x Agent-Reach Adapter Foundation。
- 已完成 3.1/3.2 B站 fixture normalizer。
- 已完成 3.3/3.4 B站 idempotent persistence。
- 已完成 3.5 B站 collection step status。
- 当前提交候选切片：4.1/4.2 小红书 fixture normalization。
- 下一切片：4.3/4.4 小红书 auth-required/login-state boundary。

## 5. 推荐串行任务顺序

### Agent 1：B站 collection step status

目标：

- 用 fixture/fake runner 串起 B站 normalizer、persistence writer 和 Agent Loop step status。
- 覆盖 `succeeded`、`partial`、`failed` 三种状态。
- 不接触真实平台、真实登录态或真实 DB。

主要触碰范围：

- `app/bilibili_collection_service.py`
- `test/bilibili-collection-step.test.js`
- 必要时极小复用 `app/bilibili_persistence.py`

禁止触碰：

- `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md`
- `.env`、Cookie/token、`config/cookies/*`、浏览器状态
- 小红书/抖音实现
- migrations

验收：

- 定向 B站 collection step 测试通过。
- B站 normalizer/persistence 既有测试通过。
- 输出和 step payload 均脱敏。

状态：进行中，worker James（019ed5f9-6503-77b2-8a72-e231b2f99919）

## 6. 每个子 agent 必须回填的交接信息

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
```

## 7. 阶段执行记录

### 2026-06-17 Agent 1

日期：2026-06-17

Agent：James（worker，019ed5f9-6503-77b2-8a72-e231b2f99919）

任务：B站 collection step status 3.5

改动文件：

- `app/bilibili_collection_service.py`
- `test/bilibili-collection-step.test.js`
- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`

新增接口：

- `BilibiliCollectionService(adapter, normalizer=None, writer=None, step_recorder=None, loop_run_resolver=None)`
- `collect(payload)` 返回 `succeeded` / `partial` / `failed`，并在精确 `agentLoopRunId` 且 resolver 验证 project ownership 后记录 step。

复用接口：

- `BilibiliNormalizer`
- `BilibiliEvidenceWriter`
- `sanitize_agent_reach_public`

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/bilibili-collection-step.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/bilibili-collection-step.test.js test/bilibili-normalizer.test.js test/bilibili-persistence.test.js`

验证结果：

- collection step 7/7 pass
- B站 collection + normalizer + persistence 13/13 pass

遗留问题：

- 真实 MySQL 与真实平台采集仍未运行，按本切片要求保持 fake/fixture 与 env-gated。
- 需要主控复审 Linnaeus P1/P2 修复后再决定 tasks 勾选、commit/push。

下一位 agent 注意事项：

- step recorder 必须 fail-closed：无 resolver、missing run、cross-project run 均不写 step，只在业务结果附 `agentStepError`。
- Adapter `.run()` fallback 固定 service-owned `collect` command，public `payload.command` 不进入 runner request。
- `adapter_summary` 只保留白名单安全字段；不要恢复 passthrough。
- success 只接受 posts/comments durable content，source-account-only 必须保持 partial。

### 2026-06-17 Agent 2

日期：2026-06-17

Agent：Jason（worker，019ed620-6089-7302-8aee-4af7b35b53b5）

任务：小红书 fixture normalization 4.1/4.2

状态：worker 已返回；Newton P2 follow-up 已修复 `raw_artifact_ref` path-safe 敏感 marker 残留，保留安全 `artifacts/agent-reach/xiaohongshu/search-safe.json`，并保持无 ID comment fallback 按父 note 去重隔离。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-normalizer.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-normalizer.test.js test/bilibili-normalizer.test.js test/agent-reach-adapter.test.js`
- `git diff --check`

复审结果：

- Laplace 初审 P2：`raw_artifact_ref` 不能只走通用 sanitizer；ID-less comment fallback 必须包含父 note。
- Newton 复审 P2：path-safe `raw_stdout` / `collector_transcript` 变体仍需归一化 marker 拒绝。
- Mencius 最终复审 APPROVED：无 P0/P1/P2；确认 `rawstdout`、`collectortranscript`、`stderr`、`cookie`、`token`、DB/browser marker 被拒，安全 `search-safe.json` 保留；跨 note ID-less comment 不碰撞，同 note 重复去重。

遗留问题：

- 真实小红书登录态、Spider_XHS 真实采集、persistence、FastAPI endpoint、抖音均不在 4.1/4.2 范围内。
- 提交必须选择性 stage，排除无关 `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 脏改。
