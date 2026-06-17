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

### 2026-06-17 Agent 3

日期：2026-06-17

Agent：Lorentz（worker，019ed64b-b733-7ac0-8dba-a2e2ed3c62a9）

任务：小红书 auth-required/login-state boundary 4.3/4.4

状态：worker 已完成最小切片；未更新 OpenSpec tasks，未 commit/push。

改动文件：

- `app/xiaohongshu_collection_service.py`
- `test/xiaohongshu-collection-service.test.js`
- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`

新增接口：

- `XiaohongshuCollectionService(runner=None, login_state_provider=None)`
- `collect(public_request)` 返回小红书专属 public result；缺 private login provider 或 provider 空值时 fail-closed 为 `platform_auth_required`，runner 不执行。

安全边界：

- public request 只白名单透传 `project_id`、`query`、`keywords`、`limit`、`cursor`、`raw_artifact_ref`，不接受 caller `command`，也不接受 public `cookie` / `token` / `storageState` / `browserState` 作为登录态。
- service-owned runner command 固定为 `xiaohongshu_collect`。
- injected private login state 只放入 runner request 的 `private.login_state`，不进入 public result。
- public result 对 summary、content_items、evidence_summaries 分别使用字段白名单；`stdout`、`stderr`、`step_output`、`log_output` 无 public 输出路径。

TDD 证据：

- RED：`PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-collection-service.test.js` 初次运行 5/5 fail，失败原因为 `ModuleNotFoundError: No module named 'app.xiaohongshu_collection_service'`。
- GREEN：同命令复跑 5/5 pass。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-collection-service.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-collection-service.test.js test/xiaohongshu-normalizer.test.js test/agent-reach-adapter.test.js test/bilibili-collection-step.test.js`

验证结果：

- 小红书 collection service 5/5 pass。
- 小红书 collection + normalizer + Agent-Reach adapter + B站 collection step 21/21 pass。

遗留问题：

- 本切片不做真实登录、真实小红书/Agent-Reach/Spider_XHS 调用、persistence/MySQL、FastAPI endpoint、CrewAI/Judge/Report、抖音。
- 仍需主控/后续 reviewer 做反驳式 review 后再决定 tasks 勾选、commit/push。

### 2026-06-18 Agent 4

日期：2026-06-18

Agent：Noether（worker，019ed666-xhs-persistence-worker）

任务：小红书 evidence persistence/idempotent writes 4.5

状态：worker 已完成最小切片；未更新 OpenSpec tasks，未 commit/push。

改动文件：

- `app/xiaohongshu_persistence.py`
- `test/xiaohongshu-persistence.test.js`
- `test/weibo-db-persistence.test.js`
- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`

新增接口：

- `XiaohongshuEvidenceWriter(repository)`
- `InMemoryXiaohongshuRepository`
- `MySQLXiaohongshuRepository`

持久化语义：

- normalized 小红书 note/search/detail/comment payload 写入现有 `source_accounts`、`social_posts`、`social_comments` 语义。
- `evidence_summaries` 的 evidence id、source type、content item external id、metrics、raw artifact ref 放入 `raw_json`；未新增 generic evidence 表。
- 同项目按 `(project_id, platform, external_id)` 幂等，重复 search/detail 只更新 metrics/raw refs，不增加 source/post/comment count。
- 跨项目相同 external id 隔离，source/post/comment raw refs 和 comment like_count 不串项目。

安全边界：

- writer 拒绝非 `xiaohongshu` payload、缺/非法 `project_id`、unsafe `raw_artifact_ref`、敏感 key/value、非小红书 evidence ID、evidence ID project mismatch。
- `raw_artifact_ref` 复用 `safe_xiaohongshu_artifact_ref`，不只依赖通用 sanitizer。
- MySQL 三个 upsert 均使用 `ON DUPLICATE KEY UPDATE` + `LAST_INSERT_ID(id)`。

TDD 证据：

- RED：`PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-persistence.test.js` 初次运行 0/3 pass、3/3 fail，失败原因为 `ENOENT app/xiaohongshu_persistence.py` / `ModuleNotFoundError: No module named 'app.xiaohongshu_persistence'`。
- GREEN：同命令复跑 3/3 pass。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-persistence.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/weibo-db-persistence.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/xiaohongshu-persistence.test.js test/xiaohongshu-normalizer.test.js test/xiaohongshu-collection-service.test.js test/bilibili-persistence.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-agent-reach-multichannel-ingestion --strict`
- `git diff --check`

验证结果：

- 小红书 persistence 3/3 pass。
- weibo-db persistence 无 `WEIBO_DB_PERSISTENCE_TEST_URL` 时 1 pass / 52 skipped / 0 fail；新增小红书 MySQL 用例按 env gate skip。
- 小红书 persistence + normalizer + collection service + B站 persistence 19/19 pass。
- 全量 `npm test` 224 tests：172 pass / 52 skipped / 0 fail。
- OpenSpec strict valid。
- `git diff --check` pass。

遗留问题：

- 本切片不做真实小红书采集、登录态 provider、Agent Loop step status、FastAPI endpoint、CrewAI/Judge/Report、抖音、PRD 修改、migration、tasks 勾选、commit 或 push。
- 真实 MySQL 回归仅在 `WEIBO_DB_PERSISTENCE_TEST_URL` 设置时运行；本 worker 环境未设置该 env，因此只验证了 skip path。
- 工作区存在非本 worker 范围的 `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 脏改，需后续选择性 staging 排除。

### 2026-06-18 Agent 5

日期：2026-06-18

Agents：

- Averroes（explorer，019ed684-bf46-7522-bc13-52f82b19dff6）
- Gauss（worker，019ed68b-71ea-7da0-ba23-329454b25831）
- Galileo（reviewer，019ed694-2333-77c3-b486-223d435f9064）
- Meitner（worker，019ed699-45ed-74e3-a176-2d7cb2b2275b）
- Einstein（reviewer，019ed6a1-f927-7890-bba0-f57f5e5225a0）

任务：抖音 doctor/capability fixture contract 5.1，以及 5.2 search/detail gate。

状态：5.1 已完成并通过复审；5.2/5.3/5.4 保持未完成。

改动文件：

- `app/agent_reach_adapter.py`
- `test/agent-reach-adapter.test.js`
- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`
- `openspec/changes/haidao-agent-reach-multichannel-ingestion/tasks.md`

实现语义：

- `AgentReachAdapter` 现在允许 `douyin` 的 `doctor` 和 `capability` 两个 fake-runner contract 命令。
- `douyin` 的 `search`、`detail`、`collect` 仍返回 `agent_reach_command_not_allowed`，并说明 runner contract 尚不清楚；runner 不会执行。
- 抖音 top-level artifact ref 使用 `artifacts/agent-reach/douyin/` 平台 allowlist，只保留 ASCII 安全路径。
- 抖音 runner summary 内的 `artifact_ref`、`raw_artifact_ref`、`artifactRef`、`rawArtifactRef` 通过 normalized key 进入同一 allowlist。
- 抖音 doctor/capability runner payload 使用 `sanitize_douyin_runner_payload`，只允许 `projectId`、`project_id`、`safeQuery` 的安全 scalar 值；caller-controlled `command`、artifact refs、Cookie/token/storage/stdout/transcript 字段不会进入 runner。

安全边界：

- 不读取 `.env`、真实 Cookie/token、`config/cookies/*` 或 browser state。
- 不调用真实抖音、真实 Agent-Reach 或外部平台。
- 不做抖音 search/detail fixture、normalizer、persistence、migration、FastAPI endpoint、CrewAI/Judge/Report。
- 真实抖音采集仍为 blocked/unverified，后续需要明确安全 runner schema 或人工确认登录态边界。

TDD / review 证据：

- RED 1：新增抖音 tests 时，旧实现因 `douyin` platform not allowlisted，3 个抖音测试失败。
- GREEN 1：`douyin doctor/capability` fake runner、`search/detail/collect` fail-closed、artifact allowlist 测试通过。
- Galileo 初审 P1/P2：runner payload 原样透传 caller-controlled command/artifact/cookie/storage/token；summary camelCase artifact refs 和 ordinary stdout/transcript value 可绕过。
- RED 2：Meitner 补测试复现 fake runner 收到 unsafe caller payload，public summary 泄漏 `artifactRef` / `rawArtifactRef` 和 `raw_stdout_collector_transcript` value。
- GREEN 2：runner payload 白名单化，summary normalized-key artifact allowlist，compact value marker 拒绝 stdout/raw_stdout/raw_transcript/collector_transcript。
- Einstein 复审 APPROVED：无 P0/P1/P2；P3 建议未来可把 hyphenated `artifact-ref` / `raw-artifact-ref` 加进持久回归测试，代码探针已通过。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/agent-reach-adapter.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/agent-reach-adapter.test.js test/bilibili-normalizer.test.js test/xiaohongshu-normalizer.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-agent-reach-multichannel-ingestion --strict`
- `git diff --check`
- `npm run agent:guard`

验证结果：

- Agent-Reach adapter 9/9 pass。
- Agent-Reach adapter + B站/小红书 normalizer 17/17 pass。
- worker 全量 `npm test`：177 pass / 52 skipped / 0 fail。
- OpenSpec strict valid。
- `git diff --check` pass。
- `npm run agent:guard` pass。

遗留问题：

- 5.2 search/detail fixture tests 未做，因为上游 runner schema 尚不清楚。
- 5.3 normalizer/persistence 未做，避免固化不稳定抖音 schema。
- 5.4 真实抖音 validation blocked/unverified 还需要独立 evidence report 后再决定勾选。
- 工作区存在非本切片范围的 `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 脏改，提交时必须选择性 staging 排除。

### 2026-06-18 Agent 6

日期：2026-06-18

Agent：Heisenberg（explorer，019ed6ab-2ad7-70a3-82bf-0302f190a711）

任务：抖音 5.2/5.3/5.4 路线判断与真实验证 blocked evidence。

状态：5.4 blocked/unverified evidence 已记录；5.2/5.3 保持未完成。

结论：

- 5.2 前置未满足。`workers/collectors/douyin.py` 里的 `normalize_video()` 是旧 collector helper，只返回 `external_id`、`url`、`author_name`、`title`、`content`、`keyword`、`engagement`、`comments`、`raw_json`。它不是稳定的 Agent-Reach `search/detail` runner contract。
- 当前没有安全、脱敏、已提交的抖音 `search/detail` runner schema，也没有 `test/fixtures/douyin-*.json`、`test/douyin-normalizer.test.js`、`app/douyin_normalizer.py`。
- 当前 `AgentReachAdapter` 仅允许 `douyin doctor/capability` fake-runner contract；`douyin search/detail/collect` 明确 fail-closed，返回 `agent_reach_command_not_allowed` 且不执行 runner。
- 因为真实抖音访问可能需要登录态、Cookie、浏览器 state 或不稳定上游 runner，自动 agent loop 不读取真实凭据、不触发真实平台，也不把真实验证伪装为完成。

Blocked / unverified evidence：

```json
{
  "platform": "douyin",
  "real_douyin_collection": "blocked",
  "real_douyin_validation": "unverified",
  "blocked_reason": "high_risk_login_state_or_unstable_runner_contract",
  "safe_contract_available": ["doctor", "capability"],
  "blocked_commands": ["search", "detail", "collect"],
  "no_real_platform_call": true,
  "no_env_or_cookie_read": true,
  "no_browser_state_read": true,
  "no_douyin_fixture_schema_committed": true,
  "no_douyin_normalizer_or_persistence": true
}
```

为什么不做 5.2：

- OpenSpec 5.2 明确要求“only after the upstream runner contract is clear”。
- 现有旧 collector helper 不是上游 Agent-Reach runner schema，不包含 Harness evidence 所需字段，也不经过平台 artifact allowlist。
- 若在此时自造 `douyin_normalizer` 和 fixtures，会把不稳定 schema 固化为事实合同。

为什么不做 5.3：

- 5.3 前置为 local/fake runner contract stable。
- 5.2 尚未完成，没有抖音 normalized evidence payload。
- 直接做 persistence 会把未确认字段写入现有事实表语义，增加回滚和数据污染风险。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/agent-reach-adapter.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-agent-reach-multichannel-ingestion --strict`
- `git diff --check`
- `npm run agent:guard`

遗留问题：

- 5.2 search/detail fixture tests 需要等待安全、脱敏、已提交的上游 runner schema。
- 5.3 normalizer/persistence 需要等待 5.2 完成。
- 后续如果用户明确提供安全 runner schema 或人工确认真实登录态边界，必须重新开启一个小切片，不得复用 blocked evidence 直接放开真实采集。
- P3：`workers/enterprise_worker.py` 仍注册 dormant `douyin.collect`，而 `workers/collectors/douyin.py` 会在失败前读取 `cookie_file`；当前 public legacy collect path 已禁用，不阻塞 5.4，但后续 6.x 或安全清理切片应移除或 hard-block 这条 dormant 路径。

### 2026-06-18 Agent 7

日期：2026-06-18

Agents：

- Boole（explorer，019ed6b9-22c1-72c2-a425-7f38ac9f2bbd）
- Singer（worker，019ed6c0-b1e0-7891-96a5-1b95ffcbcf61）
- Mill（reviewer，019ed6cb-0565-79b1-90d9-ee2de423bb5b）
- Maxwell（worker follow-up，019ed6d0-c77c-7b10-bf63-20dd5f54ac37）

任务：FastAPI internal platform collection trigger 6.1

状态：6.1 已完成并通过复审；6.2/6.3/6.4 保持未完成。

改动文件：

- `app/main.py`
- `test/fastapi-sidecar.test.js`
- `openspec/changes/haidao-agent-reach-multichannel-ingestion/tasks.md`
- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`

新增接口：

- `create_app(..., platform_collection_services=None)`
- `POST /api/internal/agent-runs/{run_id}/platform-collections`

实现语义：

- 内部 endpoint 只允许 `bilibili` 与 `xiaohongshu` 平台。
- `douyin`、未知平台、未注入 service 均 fail-closed，且不执行 service。
- 默认 `platform_collection_services` 为空，不实例化真实 runner，不读取真实平台、`.env`、Cookie、browser state。
- 请求体只接受 `projectId`、`platform`、`query`、`keywords`、`limit`、`cursor`。
- caller 不能通过 body 传 `agentLoopRunId`、`command`、credential/storage/browser/artifact/path 字段；run id 只来自 path。
- service response 先走现有 public sanitizer，再递归移除 stdout/stderr/raw/private/login/browser/storage 等 key 和 safe-looking string value 中的 raw runner output marker。

TDD / review 证据：

- RED 1：新增 3 个 FastAPI internal collection tests 时，旧实现因 `create_app()` 不支持 `platform_collection_services` 参数失败。
- GREEN 1：新增 endpoint 后 fastapi-sidecar 32/32 pass，相关定向 60/60 pass。
- Mill 初审 P1：response sanitizer 会漏 safe-looking key 下的 `raw runner output` / `raw_stdout transcript` string value。
- RED 2：Maxwell 补测试复现 message、summary、list/object value 泄漏 raw runner output marker，以及 allowed `query` 中 `raw_stdout transcript` 未被拒。
- GREEN 2：新增 `contains_platform_collection_private_string()`，request validator 与 response sanitizer 复用，fastapi-sidecar 34/34 pass，相关定向 62/62 pass。
- Mill 复审 APPROVED：无 P0/P1/P2；确认 douyin 即使注入 service 仍 fail-closed，CrewAI/Judge/legacy grammar 未放宽。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/fastapi-sidecar.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/fastapi-sidecar.test.js test/bilibili-collection-step.test.js test/xiaohongshu-collection-service.test.js test/crewai-tool-gateway.test.js test/agent-reach-adapter.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-agent-reach-multichannel-ingestion --strict`
- `git diff --check`
- `npm run agent:guard`
- `node -e` JSONL parse check for `docs/agent-loop/subagent-events.jsonl`

验证结果：

- FastAPI sidecar 34/34 pass。
- 相关 FastAPI/B站/小红书/CrewAI gateway/Agent-Reach 定向 62/62 pass。
- 全量 `npm test`：234 tests，182 pass / 52 skipped / 0 fail。
- OpenSpec strict valid。
- `git diff --check` pass。
- `npm run agent:guard` pass。
- JSONL parse pass。

遗留问题：

- `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 仍有本切片前存在的无关格式化脏改，提交必须选择性 staging 排除，不要回滚用户/既有改动。
- 本切片不做 6.2 CrewAI evidence-only grammar、6.3 Judge/Report platform citations、6.4 旧微博整体回归确认。
- 真实 MySQL 测试按 `WEIBO_DB_PERSISTENCE_TEST_URL` env gate 跳过；本切片未改 schema 或 persistence。
