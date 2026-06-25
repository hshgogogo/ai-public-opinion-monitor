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

### 2026-06-18 Agent 8

日期：2026-06-18

Agents：

- Franklin（explorer，019ed6dc-d4e8-7f82-b0c0-5927b3126d23）
- Cicero（worker，019ed6e2-f78d-7320-aaed-128733f1d9c6）
- Poincare（reviewer，019ed6eb-a13e-7460-9350-263c6a7d31e2）
- Fermat（worker follow-up，019ed6f0-e272-7c90-a200-4b28f3178ff6）

任务：CrewAI evidence-only boundary 6.2

状态：6.2 已完成并通过复审；6.3/6.4 保持未完成。

改动文件：

- `app/crewai_tools.py`
- `test/crewai-tool-gateway.test.js`
- `openspec/changes/haidao-agent-reach-multichannel-ingestion/tasks.md`
- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`

实现语义：

- `HarnessToolGateway.get_evidence_summary` 现在对 repository 返回值做 CrewAI public-only projection。
- summary 顶层只保留 `project_id` 与 `evidence`。
- 每条 evidence 只保留 `id`、`platform`、`label`、`source_type`、`summary`、`citation`、`metrics`。
- `metrics` 走严格白名单，只保留有限数值公共指标，例如 `view_count`、`like_count`、`comment_count`、`reply_count`、`collect_count` 等。
- raw artifacts、raw JSON、stdout/stderr、runner output、cookie/token、browser/storage/login/private、command/tool-call 等字段和值不会进入 CrewAI 可读 summary。
- `ALLOWED_TOOLS` 未新增 Agent-Reach/platform collection 工具；`agent_reach.collect`、`platform_collection`、`bilibili_collect`、`xiaohongshu_collect`、`douyin_collect` 等继续返回 `crewai_tool_not_allowed`。
- `app/main.py` public `evidenceIds` grammar 与 `crewai_proposal_service.py` proposal scope validation 未放宽；本切片不接 Judge/Report citation。

TDD / review 证据：

- RED 1：旧 `get_evidence_summary` 会把 `raw_artifact_ref`、`raw_json`、`stdout`、`command=agent_reach.collect`、`private` 等字段暴露给 CrewAI。
- GREEN 1：新增 public projection 后 crewai-tool-gateway 6/6 pass，gateway+runtime+fastapi 52/52 pass。
- Poincare 初审 P1：`metrics` 作为 allowlisted object，仍可泄漏 `runner`、`logging`、`agentReachCollect`、`agent-reach-collect`、`url`、`raw_url` 等非公共字段。
- RED 2：Fermat 补 metrics variants 测试，旧实现泄漏 list/object/non-public metrics。
- GREEN 2：新增 `CREWAI_PUBLIC_METRIC_KEYS` 和 strict numeric metrics projection，crewai-tool-gateway 6/6 pass，gateway+runtime+fastapi 52/52 pass。
- Poincare 复审 APPROVED：无 P0/P1/P2；确认 P2 production summary repository wiring 不阻塞本切片，真实平台 summary lookup 留给后续 citation/summary integration。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/crewai-tool-gateway.test.js`
- `PYTHON_BIN=.venv/bin/python node --test test/crewai-tool-gateway.test.js test/crewai-runtime-adapter.test.js test/fastapi-sidecar.test.js`
- `git diff --check`
- 后续 commit gate 继续运行全量 `npm test`、OpenSpec strict、agent guard。

验证结果：

- CrewAI tool gateway 6/6 pass。
- CrewAI gateway + runtime + FastAPI sidecar 52/52 pass。
- `git diff --check` pass。
- JSONL parse pass。

遗留问题：

- 真实平台 evidence summary repository 尚未端到端接入 CrewAI runtime；当前完成的是 CrewAI 只能读取 normalized/public summary 的安全边界。后续 6.3 platform citation/summary integration 可继续接真实 lookup。
- `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 仍有本切片前存在的无关格式化脏改，提交必须选择性 staging 排除。
- 本切片不做 Judge/Report citation 展示、不放开 FastAPI public platform evidence grammar、不做抖音 search/detail/normalizer。

### 2026-06-18 Agent 9

日期：2026-06-18

Agents：

- Sartre（explorer，019ed6ff-4569-7680-9bc2-41d96087646b）
- Schrodinger（worker，019ed707-151b-7e53-aa55-8efbbaffa722）
- Anscombe（reviewer，019ed712-3161-7231-89c6-dc97d88584df）
- Hume（worker follow-up，019ed718-94ed-7e91-af37-df5382a3d709）
- Dewey（worker follow-up，019ed723-19a7-7443-befe-033fb349d3b6）

任务：Judge/Report platform evidence citations 6.3

状态：6.3 已完成并通过最终复审；6.4/7.x 保持未完成。

改动文件：

- `workers/agents/judge_agent.py`
- `app/judge_review_service.py`
- `workers/enterprise_worker.py`
- `app/bilibili_persistence.py`
- `test/fastapi-sidecar.test.js`
- `test/weibo-memory-report.test.js`
- `test/bilibili-persistence.test.js`
- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`
- `openspec/changes/haidao-agent-reach-multichannel-ingestion/tasks.md`

实现语义：

- Judge 支持同项目平台证据 ID：`bilibili:project:<id>:item:<bvid>`、`bilibili:project:<id>:comment:<rpid>`、`bilibili:project:<id>:text:<bvid>:transcript:<lang>`、`bilibili:project:<id>:text:<bvid>:body`、`xiaohongshu:project:<id>:item:<note>`、`xiaohongshu:project:<id>:comment:<comment>`。
- Judge `feedback_json.citation_details` 输出平台标签：B站视频、B站评论、B站字幕、B站正文、小红书笔记、小红书评论。
- MySQL Judge evidence repository 通过 `social_posts` / `social_comments` 的 project/platform/external_id 校验 item/comment 归属；B站 text 还要求同项目 B站 `social_posts.raw_json.evidence_ids` 包含完整 text evidence ID。
- Report/Q&A 新增 `citationDetails`，旧 `citations` 字符串数组保持兼容；日报 Markdown 显示平台标签。
- B站 persistence 的内存和 MySQL duplicate upsert 路径合并 existing/incoming `raw_json.evidence_ids`，避免 detail->search 或 search->detail 顺序丢失 text citation membership。

安全边界：

- 不放宽 FastAPI public proposal `evidenceIds` grammar。
- 不新增 CrewAI Agent-Reach 或 platform collection tool allowlist。
- 不支持 Douyin citation，不支持小红书 text citation。
- 不读取真实凭据、`.env`、Cookie/token、`config/cookies/*`、browser state，不调用真实平台或真实 Agent-Reach。
- 不新增 migration 或事实表 schema。

TDD / review 证据：

- RED 1：旧 Judge 把平台 evidence IDs 判为 `invalid_evidence_id_format`，Report 缺 `citationDetails`。
- GREEN 1：Judge 支持 B站/小红书 item/comment citation，Report/Q&A 输出平台标签并保留旧 citations。
- Anscombe 初审 P2：B站 normalizer 已产生字幕/body text evidence IDs，但 Judge/MySQL lookup 只支持 item/comment。
- RED 2：B站 text IDs、MySQL text lookup、Report B站字幕/正文标签缺失。
- GREEN 2：支持 B站 text transcript/body citation，MySQL lookup 要求同项目 B站 post raw_json evidence_ids membership；Douyin text 和小红书 text 仍拒绝。
- Anscombe 复审 P2：B站 duplicate upsert 覆盖 `raw_json.evidence_ids`，detail->search 顺序会丢失 text citation。
- RED 3：B站 persistence detail->search 丢 evidence IDs，MySQL probe 命中旧 `raw_json=VALUES(raw_json)`。
- GREEN 3：内存 repository 合并 evidence IDs；MySQL duplicate update 使用 `JSON_SET` + `JSON_MERGE_PRESERVE` 合并 evidence IDs。
- Anscombe 最终复审 APPROVED：无 P0/P1/P2；P3 为 `JSON_MERGE_PRESERVE` 可能保留重复数组项，但 membership lookup 不受影响。

验证命令：

- `PYTHON_BIN=.venv/bin/python node --test test/bilibili-persistence.test.js test/fastapi-sidecar.test.js test/weibo-memory-report.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-agent-reach-multichannel-ingestion --strict`
- `git diff --check`
- `npm run agent:guard`
- `node -e` JSONL parse check for `docs/agent-loop/subagent-events.jsonl`

验证结果：

- 定向 platform citation / persistence / report：44/44 pass。
- 全量 `npm test`：241 tests，189 pass / 52 skipped / 0 fail。
- OpenSpec strict valid。
- `git diff --check` pass。
- `npm run agent:guard` pass。
- JSONL parse pass。

遗留问题：

- 6.4 旧微博路径回归仍需独立切片确认。
- 7.x 最终验证与 review 仍未完成。
- 真实 MySQL 只有在 `WEIBO_DB_PERSISTENCE_TEST_URL` 设置时运行；当前 fake MySQL probe 不执行真实 SQL。
- `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 仍有无关脏改，提交必须选择性 staging 排除。

### 2026-06-18 Agent 10

日期：2026-06-18

Agents：

- Gibbs（explorer，019ed737-96a5-7471-bc83-fb401ba0e77c）
- Parfit（reviewer，019ed73d-54f3-77c1-a0d7-58872c57c40b）

任务：旧微博路径回归 6.4 与验证任务 7.1/7.2/7.4/7.5/7.6

状态：6.4 已完成并通过独立复核；7.1/7.2/7.4/7.5/7.6 已完成；7.3 真实 MySQL 因 `WEIBO_DB_PERSISTENCE_TEST_URL` 未设置仍未验证；7.7 需在 evidence report、commit、push、PR update 后完成。

改动文件：

- `docs/agent-loop/subagent-events.jsonl`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`
- `openspec/changes/haidao-agent-reach-multichannel-ingestion/tasks.md`

实现语义：

- 本切片不改业务代码，目标是证明 6.3 的平台 `citationDetails` 为 additive，未破坏旧微博 trigger/status/feedback/workbench/fixture E2E、旧 `citations` 字符串数组、legacy evidence parser、public CrewAI proposal grammar 或旧微博 API payload。
- Gibbs 只读探索建议复用现有定向测试，不新增重复测试。
- Parfit 独立复核确认 6.4 相对 6.3 无新增代码 diff，旧微博路径与兼容边界未被放宽。

Done rubric 证据：

1. 旧微博 trigger/status/feedback/workbench/fixture E2E 回归通过：旧微博定向 67/67 pass。
2. 旧微博 Q&A/report `citations` 字符串兼容不被 6.3 破坏：`test/weibo-memory-report.test.js` 在旧微博和平台 citation cases 均通过。
3. 不放宽 public CrewAI proposal grammar 或旧微博 API payload：FastAPI/CrewAI/Judge 定向 46/46 pass；Parfit 检查 `app/crewai_proposal.py` 与 `src/server.js` 后无 P0/P1/P2。
4. 不触碰真实凭据、真实平台、真实 DB：测试通过 `scripts/run-tests.mjs` 剥离真实 MySQL、DeepSeek、微博 Cookie、MediaCrawler env；`WEIBO_DB_PERSISTENCE_TEST_URL` 未设置，真实 DB 未运行。
5. 定向/全量/OpenSpec/diff/guard 通过：见验证结果。
6. 独立子 agent 复核无 P0/P1/P2：Parfit APPROVED。

验证命令：

- `PYTHON_BIN=.venv/bin/python npm test -- test/agent-loop-trigger-api.test.js test/weibo-api-contract.test.js test/weibo-workbench.test.js test/weibo-frontend.test.js test/weibo-fixture-e2e.test.js test/weibo-memory-report.test.js test/enterprise-worker.test.js`
- `PYTHON_BIN=.venv/bin/python npm test -- test/fastapi-sidecar.test.js test/crewai-proposal-validator.test.js test/crewai-tool-gateway.test.js`
- `PYTHON_BIN=.venv/bin/python npm test -- test/agent-reach-adapter.test.js test/bilibili-normalizer.test.js test/xiaohongshu-normalizer.test.js test/bilibili-persistence.test.js test/xiaohongshu-persistence.test.js test/bilibili-collection-step.test.js test/xiaohongshu-collection-service.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-agent-reach-multichannel-ingestion --strict`
- `git diff --check`
- `npm run agent:guard`
- `node -e` JSONL parse check for `docs/agent-loop/subagent-events.jsonl`

验证结果：

- 旧微博定向：67/67 pass。
- FastAPI/CrewAI/Judge 定向：46/46 pass。
- Adapter/normalizer/persistence/collection 定向：40/40 pass。
- 全量 `npm test`：241 tests，189 pass / 52 skipped / 0 fail。
- OpenSpec strict valid。
- `git diff --check` pass。
- `npm run agent:guard` pass。
- JSONL parse pass。

仍未触碰范围：

- 真实 MySQL：已使用临时本地 MySQL 8.4 Docker 容器设置 `WEIBO_DB_PERSISTENCE_TEST_URL` 运行 `test/weibo-db-persistence.test.js`，53/53 pass；容器运行结束后自动删除。
- 真实微博/B站/小红书/抖音/Agent-Reach 平台调用：按安全边界未执行。

遗留问题：

- 5.2/5.3 抖音 search/detail fixture 与 normalizer/persistence 仍受上游 runner contract 不清晰阻塞。
- 7.7 需要最终 evidence report、commit、push 和 PR update。
- `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 仍有无关脏改，提交必须选择性 staging 排除。

### 2026-06-18 Agent 11

日期：2026-06-18

任务：7.3 真实 MySQL 验证与真实 DB 回归修复

状态：7.3 已完成并通过 Volta 独立复核；可进入 5.2/5.3 blocked/N/A 收口与 7.7。

改动文件：

- `app/judge_review_service.py`
- `workers/enterprise_worker.py`
- `test/weibo-db-persistence.test.js`
- `openspec/changes/haidao-agent-reach-multichannel-ingestion/tasks.md`
- `docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`

Root cause：

- 真实 MySQL 测试第一次运行 50/53 pass，暴露 3 个问题。
- CrewAI runtime failure 用例使用不存在的 `comment:123`，在真实 MySQL 下会被 Harness 证据归属校验提前拒绝，无法测到 runtime failure。修复为创建同项目真实 comment evidence 后再触发 runtime adapter error。
- step-based Judge review 在 `feedback_json.proposal_audit_id` 写入 JSON null；MySQL 8.4 下 `JSON_UNQUOTE(JSON_EXTRACT(...))` 会返回字符串 `null`。修复为 step-based review 省略该 key，proposal review 仍写真实 audit id。
- action recommendation step ledger 同时写 `event-<id>` 和裸数字 comment id；当 event id 与 comment id 同为 `1` 时，归一化会把裸 `1` 当作 event 去重，导致 comment evidence 丢失。修复为 agent step evidence 对 action comment evidence 使用 `comment-<id>` 前缀。

验证命令：

- `PYTHON_BIN=.venv/bin/python npm test -- test/fastapi-sidecar.test.js test/weibo-memory-report.test.js test/enterprise-worker.test.js`
- 临时本地 MySQL 8.4 Docker 容器 + `WEIBO_DB_PERSISTENCE_TEST_URL=mysql://root:<local-test-password>@127.0.0.1:<random-port>/yuqing_monitor_test_agent_loop PYTHON_BIN=.venv/bin/python npm test -- test/weibo-db-persistence.test.js`

验证结果：

- FastAPI/Judge/Report/enterprise 无 DB 定向：76/76 pass。
- 真实 MySQL persistence：53/53 pass，0 skipped，0 fail。

复核：

- Volta（reviewer，019ed74f-41f0-79a1-a32d-f7b5b2b0ea7b）反驳式 review APPROVED，无 P0/P1/P2。
- Volta 确认 runtime_failed 用例先通过真实 evidence scope validation 再触发 injected runtime，不是放宽测试。
- Volta 确认 step-based `proposal_audit_id` 省略避免 MySQL JSON null 字符串歧义，proposal-based Judge review 仍有窄断言证明真实 audit id 会持久化。
- Volta 确认 action step ledger 改为 `comment-*` evidence，避免 event/comment 裸数字碰撞，并匹配 Judge grammar。

未验证：

- 没有使用真实 `.env`、真实 Cookie/token、真实浏览器状态、真实微博/B站/小红书/抖音/Agent-Reach 平台。

### 2026-06-18 Agent 12

日期：2026-06-18

Agent：Dalton（reviewer，019ed756-c13e-7a43-8b1c-10850f4439fa）

任务：抖音条件任务 5.2/5.3 blocked/N/A 收口。

状态：5.2/5.3 可在改写任务文字后勾选为 blocked/N/A done；不得声称已实现抖音 search/detail、normalizer、persistence、migration 或真实 collection path。

结论：

- Dalton 结论为 `APPROVED_TO_MARK_BLOCKED_DONE`。
- 无 P0；如果保留原始 “Write/Implement” wording 后直接勾选，会产生 P1 误导风险。
- OpenSpec design/spec 允许抖音在上游 runner contract 不稳定、高风险登录态或真实访问不可安全验证时保持 blocked，不阻塞 B站/小红书交付。
- 当前安全 contract 只有 `douyin doctor/capability` fake runner；`douyin search/detail/collect` fail-closed。
- 当前没有已提交、安全、脱敏、稳定的 Agent-Reach 抖音 search/detail runner schema；没有 `app/douyin_normalizer.py`、没有抖音 persistence、没有 migration、没有真实采集路径。

已采用的 tasks wording：

- 5.2：Record 抖音 search/detail fixture tests as blocked/N/A because no safe, redacted upstream Agent-Reach runner contract is available; do not create synthetic fixtures or claim search/detail support.
- 5.3：Record 抖音 normalizer and persistence as blocked/N/A because the local/fake runner contract is not stable; no 抖音 normalizer, persistence, migration, or real collection path is implemented.

验证：

- 该收口只改 tasks wording 和 evidence；不改业务代码。
- 最近一次 `PYTHON_BIN=.venv/bin/python npm test -- test/agent-reach-adapter.test.js` 为 9/9 pass，证明 douyin doctor/capability 受控、search/detail/collect fail-closed。
- 后续 7.7 gate 仍需重跑全量 `npm test`、OpenSpec strict、`git diff --check`、`npm run agent:guard`、JSONL parse。

未验证：

- 没有真实抖音平台调用。
- 没有读取真实 `.env`、Cookie/token、浏览器状态或 `config/cookies/*`。

### 2026-06-18 Agent 13 Candidate Evidence

日期：2026-06-18

任务：7.7 final evidence report、subagent review、commit、push、PR update gate。

状态：candidate evidence 已生成并通过 Hubble 独立 final review；允许勾选 7.7、选择性 commit/push、更新 PR。

完成内容：

- 6.4 旧微博路径回归已确认，旧微博 trigger/status/feedback/workbench/fixture E2E、Q&A/report `citations` 字符串兼容、legacy evidence parser、public CrewAI proposal grammar 和旧微博 API payload 均未被平台 citation 扩展破坏。
- 7.3 真实 MySQL 暴露的三个回归已修复：runtime_failed 测试使用同项目真实 comment evidence，step-based Judge review 省略 JSON null `proposal_audit_id`，action step ledger 对 comment evidence 使用 `comment-*` 前缀避免 event/comment 裸数字碰撞。
- 5.2/5.3 按 Dalton reviewer 要求改写为 blocked/N/A done，不实现也不声称实现抖音 search/detail、normalizer、persistence、migration 或真实 collection path。
- 继续排除无关 `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 脏改，不读取真实 `.env`、Cookie/token、浏览器状态或 `config/cookies/*`。

Done rubric 证据：

1. OpenSpec 任务只剩 7.7：`openspec instructions apply --change haidao-agent-reach-multichannel-ingestion --json` 显示 34 total / 33 complete / 1 remaining，剩余 7.7。
2. 抖音条件任务没有虚假实现：tasks 5.2/5.3 明确写为 blocked/N/A；handoff Agent 12 记录没有抖音 search/detail fixture、normalizer、persistence、migration 或真实 collection path。
3. 真实 MySQL 修复已验证：临时本地 MySQL 8.4 Docker + `WEIBO_DB_PERSISTENCE_TEST_URL=mysql://root:<local-test-password>@127.0.0.1:<random-port>/yuqing_monitor_test_agent_loop PYTHON_BIN=.venv/bin/python npm test -- test/weibo-db-persistence.test.js` 为 53/53 pass，0 skipped，0 fail；容器已删除。
4. 本轮最新定向验证通过：`PYTHON_BIN=.venv/bin/python npm test -- test/agent-reach-adapter.test.js` 为 9/9 pass。
5. 本轮最新全量验证通过：`PYTHON_BIN=.venv/bin/python npm test` 为 241 tests，189 pass / 52 skipped / 0 fail。
6. 收口 gate 通过：`openspec validate haidao-agent-reach-multichannel-ingestion --strict` valid；`git diff --check` pass；`npm run agent:guard` branch and secret checks passed；JSONL parse 为 235 lines ok。
7. 子 agent 证据齐全：Gibbs/Parfit 覆盖 6.4，Volta 覆盖 7.3，Dalton 覆盖 5.2/5.3 blocked/N/A；所有已完成或关闭。

验证命令：

- `PYTHON_BIN=.venv/bin/python npm test -- test/agent-reach-adapter.test.js`
- `PYTHON_BIN=.venv/bin/python npm test`
- `openspec validate haidao-agent-reach-multichannel-ingestion --strict`
- `git diff --check`
- `npm run agent:guard`
- `node -e "const fs=require('fs'); const lines=fs.readFileSync('docs/agent-loop/subagent-events.jsonl','utf8').trim().split(/\n/); for (const line of lines) JSON.parse(line); console.log(lines.length+' jsonl lines ok')"`

验证结果：

- Agent-Reach adapter：9/9 pass。
- 全量 no-DB：241 tests，189 pass / 52 skipped / 0 fail。
- OpenSpec strict：valid。
- `git diff --check`：pass。
- `npm run agent:guard`：branch and secret checks passed；working tree has expected changes。
- JSONL parse：235 lines ok。
- 真实 MySQL：已在 Agent 11 使用临时本地 MySQL 8.4 Docker 跑过 53/53 pass。

子 Agent 证据：

- Gibbs（explorer，019ed737-96a5-7471-bc83-fb401ba0e77c）：6.4 旧微博路径回归范围与验证建议，completed_adopted_closed。
- Parfit（reviewer，019ed73d-54f3-77c1-a0d7-58872c57c40b）：6.4 反驳式 review APPROVED，无 P0/P1/P2。
- Volta（reviewer，019ed74f-41f0-79a1-a32d-f7b5b2b0ea7b）：7.3 真实 MySQL 回归修复 review APPROVED，无 P0/P1/P2。
- Dalton（reviewer，019ed756-c13e-7a43-8b1c-10850f4439fa）：5.2/5.3 blocked/N/A 收口 APPROVED_TO_MARK_BLOCKED_DONE，无 P0；原始 wording 直接勾选有 P1 误导风险，已按建议改写。
- Hubble（reviewer，019ed761-cbbc-7ab0-af24-7d8f0a301adf）：7.7 final evidence review APPROVED，无 P0/P1/P2，`safe_to_mark_7_7_commit_push_pr_update=yes`。

Hubble final review 结论：

- OpenSpec 进度：34 total / 33 complete / only 7.7 remaining。
- 验证复核：OpenSpec strict pass、`git diff --check` pass、`npm run agent:guard` pass、JSONL 235 lines ok、Agent-Reach adapter 9/9 pass、FastAPI/Judge/Report/enterprise 76/76 pass。
- Hubble 未重跑真实 MySQL 或外部平台，符合安全边界。
- P3：Agent 10 的历史记录说 7.3 当时未验证，Agent 11/13 已记录最终真实 MySQL 53/53 pass；final evidence 已正确解释，不阻塞。
- P3：`prefixed_comment_evidence_ids()` 依赖 action evidence 输入是 numeric comment IDs；当前 `action_from_event()` 支持该窄契约，未来平台 evidence 进入 action recommendation 前需重新审查。
- 必须选择性 stage：`app/judge_review_service.py`、`workers/enterprise_worker.py`、`test/weibo-db-persistence.test.js`、`openspec/changes/haidao-agent-reach-multichannel-ingestion/tasks.md`、`docs/agent-loop/haidao-agent-reach-multichannel-ingestion-handoff.md`、`docs/agent-loop/subagent-events.jsonl`。
- 必须排除：`docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md`。

未验证：

- 未做真实微博/B站/小红书/抖音/Agent-Reach 平台调用。
- 未读真实 `.env`、Cookie/token、浏览器状态或 `config/cookies/*`。
- 真实平台登录态、高风险账号动作和生产发布均未执行。

剩余风险：

- 抖音 search/detail、normalizer、persistence 和真实 collection 仍是 blocked/N/A，后续必须等安全、脱敏、稳定的上游 runner contract 或人工确认边界后另开 change。
- `docs/PRD-Agent-Harness-CrewAI-Knowledge-Base.md` 仍有无关脏改，提交必须选择性 staging 排除。
- 最终项目验收尚未执行；7.7 和 PR 更新后仍需按 `docs/final-acceptance.md` 启动网站、真实浏览器操作并监控日志。

## Final Acceptance 2026-06-18

最终验收状态：通过。

验收环境：

- 分支：`agent/agent-harness/loop-slice`
- 启动命令：`YUQING_SKIP_ENV_FILE=1 PYTHON_BIN=.venv/bin/python PORT=8787 HOST=127.0.0.1 npm start`
- URL：[http://127.0.0.1:8787](http://127.0.0.1:8787)
- 日志观察：主控保持 `npm start` session 运行并轮询 stdout/stderr；验收期间没有额外服务端异常输出。

真实使用路径：

1. 打开 `/`：微博 Agent 工作台加载成功，显示“依赖未就绪”；推荐目标、事件、行动、评论、分析、数据缺口、证据引用、证据问答均有清晰空状态或 no-DB 失败状态。
2. 点击证据问答“提问”：顶部显示“证据问答未完成：mysql unavailable”，问答区域显示 `POST /api/weibo/bot/messages requires MySQL-backed real Weibo records.`，不是静默失败。
3. 打开 `/settings`：后台设置页加载成功，依赖状态显示 MySQL 未连接、MediaCrawler 未配置、Chrome CDP 不可用。
4. 点击“发现目标”：页面显示“发现任务未完成：mysql unavailable”，没有假成功、没有新增假数据。
5. 切到 390x844 窄屏：设置页布局仍可读，未观察到明显文本重叠。

浏览器证据：

- 主控 Playwright snapshot 覆盖 `/`、点击“提问”、`/settings`、点击“发现目标”、390x844 viewport。
- 截图 artifact：`.playwright-cli/page-2026-06-17T21-11-42-662Z.png`。
- Kierkegaard（QA/browser agent，019ed76d-43bd-7e13-9914-b867c1cf154b）独立复核 PASSED，无 P0/P1/P2。

Console / network：

- JS exception：0。
- Unhandled promise / 页面崩溃：未观察到。
- 预期 network 503：`/api/weibo/workbench`、`/api/weibo/comments`、`/api/weibo/analyses`、`/api/weibo/bot/messages`、`/api/weibo/discovery`；UI 均转成可见 no-DB 状态。
- 允许项：`/favicon.ico` 404。
- 未观察到浏览器访问微博/B站/小红书/抖音/Agent-Reach 外部域名。
- 未发现 Cookie/token/真实密钥值泄漏；页面/API 只显示 `MYSQL_URL` 变量名和未配置原因。

数据或持久化检查：

- 无本地 `MYSQL_URL`，最终验收只验证 no-DB 可用状态和失败路径，不进行写库。
- 真实 MySQL 7.3 已在前置验证中使用临时本地 MySQL 8.4 Docker 跑过 `test/weibo-db-persistence.test.js`，53/53 pass，0 skipped，0 fail。

发现的问题：

- P0：无。
- P1：无。
- P2：无。
- P3：设置页“依赖状态”标题旁显示 `unknown`，但同屏已有“依赖未就绪 / MySQL 未连接 / 补齐依赖 / mysql_unavailable”语义，未影响核心验收。

回流修复：

- 无 P0/P1/P2，因此未创建修复切片。

未验证范围：

- 没有读取真实 `.env`、Cookie/token、`config/cookies/*` 或浏览器真实账号状态。
- 没有调用真实微博/B站/小红书/抖音/Agent-Reach 平台。
- 没有进行生产发布、merge PR 或生产数据库操作。

剩余风险：

- 抖音 search/detail、normalizer、persistence 和真实 collection 仍保持 blocked/N/A。
- 若用户要体验真实数据流，需要提供安全的本地 MySQL 测试配置并明确真实账号/平台调用边界；默认 agent loop 不读取真实凭据。
