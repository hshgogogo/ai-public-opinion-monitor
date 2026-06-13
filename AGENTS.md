# 项目智能体说明

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

## Outcome-Driven Agent Loop

- 使用 `docs/agent-loop.md` 作为本仓库的智能体开发循环。
- 当用户说“use agent loop”“使用 agent loop”“按 agent loop 开发”，或要求根据 PRD/OpenSpec 自动开发时，必须使用 `$agent-loop-orchestrator`。
- 每个 OpenSpec/PRD 功能一次只推进一个小的、可本地验证、低风险的切片。
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
- 当需要把重复流程、review 标准或用户偏好沉淀成可复用 skill 时，使用 `$harness-skill-engineering`。
