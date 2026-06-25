# Agent Loop Harness 项目说明

这是 `yuqingjiance` workspace 里的应用代码仓库和 Git 仓库。OpenSpec 文件跟随本仓库管理，gstack 已经全局安装给 Codex 使用。

## gstack

- gstack 源码位置：`/Users/mini-002/.gstack/repos/gstack`
- Codex runtime 位置：`/Users/mini-002/.codex/skills/gstack`
- 当任务匹配时，使用 gstack skills 做结构化规划、review、QA、安全检查、ship 和浏览器测试。
- 常用 gstack skills 包括：`office-hours`、`plan-ceo-review`、`plan-eng-review`、`review`、`qa`、`qa-only`、`investigate`、`cso`、`ship`、`land-and-deploy`、`browse`、`gstack-upgrade`。
- 做 Web QA 或浏览器验证时，如果明确使用 gstack，则优先用 gstack 的 browser runtime；否则使用当前 Codex 会话可用的浏览器工具。

## OpenSpec

- OpenSpec 文件在本仓库的 `openspec/`。
- OpenSpec Codex skills 在父 workspace 的 `../.codex/skills/`。
- 从本仓库根目录运行 OpenSpec 命令。
- 使用 OpenSpec 承载 spec-driven change proposal、设计、规格和验证。

## Superpowers

- Superpowers 只通过 `.claude/settings.json` 在当前项目启用。
- 不要把 Superpowers 安装或启用到用户全局范围。
- 使用 Superpowers 做 TDD、系统化调试、完成前验证和 code review 流程约束。
- OpenSpec 是需求事实源，Superpowers 是质量 gate，gstack 是规划、QA、ship 工作流层。

## 外部服务授权

- 用户已授权本项目使用 `.env` 中的 DeepSeek API 做分析，不必因 DeepSeek 费用单独暂停；但不得打印、提交或泄露 API key。
- 其他付费 API、大规模外部调用、生产数据库破坏性操作、真实 Cookie/token 提交或合规风险仍必须人工确认。

## Outcome-Driven Agent Loop

- 当用户说“use agent loop”“使用 agent loop”“按 agent loop 开发”，或要求根据 PRD/OpenSpec 自动开发时，必须使用 `$agent-loop-orchestrator`。
- PRD、OpenSpec、设计文档、任务清单是需求事实源；不要凭空补需求。
- 当输入是大型 PRD、PRD 还没有对应 OpenSpec change，或用户说“根据 PRD 自动开发”但没有指定 `<CHANGE_ID>` 时，必须先执行 `docs/prd-to-openspec.md`：把 PRD 拆成 OpenSpec changes 队列。拆解完成前禁止直接写业务代码。
- 每轮只推进一个小的、可本地验证、低风险切片。
- 实现前必须写 3-7 条 done rubric。
- 完成前必须走 TDD、定向验证、全量测试、必要时 OpenSpec validate、`git diff --check`、反驳式 review 和 evidence report。
- 所有开发任务完成后，必须执行 `docs/final-acceptance.md` 的最终验收：用 Computer Use 或浏览器工具真实使用程序/网站，同时监控日志；发现 P0/P1/P2 问题必须回到 agent loop 修复并重新验收。
- 如果本轮发现了可复用失败模式、用户偏好、风险边界或项目特定解决办法，写入 `memory/`。

## 自动化授权

- 用户已一次性预授权：当一个 loop 切片满足 done rubric，并通过验证、反驳式 review 和 evidence report 后，Codex 可以自动 commit、push 当前 feature branch，并创建或更新 PR。
- 正常自动开发必须在非 `main`、非 `master` 分支上进行，例如 `agent/<change-id>/<slice-name>`。
- 不允许在 `main` 或 `master` 上自动 commit 或 push；如果当前在主分支，必须先创建或切换到 agent feature branch。
- 以下动作必须暂停并请求人工确认：push `main`/`master`、merge PR、发布生产、生产数据库破坏性迁移、使用真实账号凭据、提交 Cookie/token/`.env` 材料、大规模付费 API 调用、法律或合规判断。
- 使用 `.codex/hooks/pre_tool_use_guard.mjs` 和 `npm run agent:guard` 作为机械 guardrail。

## 子 Agent 与交接

- 小的单切片任务可以由主 Orchestrator 直接执行。
- 大型、跨模块、多 worker 的实现任务必须显式使用 `$serial-agent-handoff`；不要在一个回复里假装多个子 Agent。
- 一旦任务来自大型 PRD、`docs/agent-loop-change-queue.md`、多个 OpenSpec changes，或用户明确要求“子 agent / subagent / 多智能体”，实现 loop 必须进入 Subagent-Driven 模式：主 Orchestrator 不再独自完成实现、review 和验收。
- Subagent-Driven 模式下，每个代码切片自动 commit 前必须有真实子 agent 证据：`SubagentStart/SubagentStop` hook 日志，或交接文件中的 worker 执行记录。不允许用“我扮演 reviewer/worker”替代真实子 agent。
- 当需要把重复流程、review 标准或用户偏好沉淀成可复用 skill 时，使用 `$harness-skill-engineering`。

## 新项目适配

- 如果项目有 PRD 但没有 OpenSpec，先按 `docs/prd-to-openspec.md` 创建 OpenSpec changes 队列；只有极小任务才允许把 PRD 直接作为单轮需求事实源。
- 如果项目没有 `npm test`，Codex 必须先识别项目实际测试命令，并更新 `docs/agent-loop.md` 或 `package.json`。
- 如果项目不是 GitHub PR 工作流，Codex 必须把“创建/更新 PR”替换成项目实际的 review 入口。
- 所有 harness 文档尽量使用中文，便于用户定位问题；命令、字段名、官方事件名可以保留英文。
