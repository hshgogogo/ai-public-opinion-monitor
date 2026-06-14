---
name: agent-loop-orchestrator
description: >
  当用户说 "use agent loop"、"使用 agent loop"、"按 agent loop 开发"、"根据 PRD 自动开发"、"把 PRD 拆成 OpenSpec changes"、"无人值守开发"、"持续推进 OpenSpec/PRD"，或要求 Codex 根据 PRD/OpenSpec 自主开发，并且需要 PRD 拆解、rubric、TDD、验证、review、evidence、memory、commit、push、PR 更新闭环时使用。该 skill 负责按 docs/agent-loop.md 和 docs/prd-to-openspec.md 编排项目工作流。不适用于一次性解释、用户明确不要 loop 的小改动，或需要人工审批的高风险动作。
---

# Agent Loop Orchestrator

这是无人值守项目开发的入口 skill。

## 触发条件

必须使用本 skill：

- 用户明确说 "use agent loop"、"使用 agent loop"、"按 agent loop"、"启动 agent loop"、"用智能体循环"。
- 用户要求 Codex 根据 PRD、OpenSpec change、任务清单或实施方案进行低人工干预开发。
- 用户要求把大型 PRD 拆成 OpenSpec changes、change queue、任务队列、里程碑队列或可执行切片。
- 用户希望进行迭代式自动开发，并包含 TDD、验证、反驳式 review、evidence report、memory、commit、feature branch push 和 PR 更新。
- 用户要求“最终验收”“真实使用测试”“全流程测试”“用 Computer Use 测试网站/程序”“边看日志边验收”等项目收尾流程。

不要使用本 skill：

- 用户只是要普通解释、直接回答、小改动或 code review。
- 任务需要真实凭据、Cookie、token、`.env`、生产数据库破坏性变更、生产发布、merge、push `main`/`master`、大规模付费 API 或法律/合规判断。遇到这些情况要停下来请求人工确认。

## 必须读取

选择切片前必须读取：

- `AGENTS.md`
- `docs/agent-loop.md`
- `docs/prd-to-openspec.md`
- `docs/verification-rubric.md`
- `docs/final-acceptance.md`
- `docs/` 下相关 PRD
- 如果存在活跃 OpenSpec change，读取 `openspec/changes/<CHANGE_ID>/` 下相关文件
- `memory/` 下相关记忆
- `git status --short`

如果项目缺少 `docs/agent-loop.md`，先使用 `AGENTS.md` 中的 loop 规则，并在实现前创建缺失文档。

## 执行循环

PRD 拆解硬门：

- 如果用户给的是 PRD、长需求、路线图，或只说“根据 PRD 自动开发”但没有指定 `<CHANGE_ID>`，先执行 `docs/prd-to-openspec.md`。
- 拆解阶段只允许创建/更新 change queue、OpenSpec change 和计划文档；禁止直接写业务代码。
- 拆解完成后，从 `docs/agent-loop-change-queue.md` 选择第一个低风险 change，再进入实现 loop。

每一轮实现 loop：

1. 从 PRD/OpenSpec、change queue、项目文档、memory 和 git status 读取上下文。
2. 选择一个 OpenSpec change，再选择一个小的、可本地验证、低风险切片。
3. 执行 Subagent Routing Gate：大型 PRD/change queue/跨模块/用户要求 subagent/连续切片/review/QA/最终验收，必须使用真实子 agent，不允许主 Orchestrator 自己扮演多个角色。
4. 写 3-7 条 done rubric 后再编辑代码。
5. 使用 TDD：失败测试、最小实现、重构。
6. 运行定向测试、全量测试、必要时 OpenSpec validate、`git diff --check`、`git status --short`。
7. 做反驳式 review：尝试证明该切片没有完成。Subagent-Driven 模式下 review 必须由独立子 agent 或串行 handoff worker 完成。
8. 修复 P1/P2 并重新验证；P0 必须停止。
9. 生成 evidence report，把每条 rubric 映射到证据，并列出真实子 agent 证据和生命周期状态。
10. 只有证据充分时才更新 tasks/docs/memory。
11. 如果当前在安全 feature branch 且 gate 通过，自动 commit、push，并创建或更新 PR。
12. 继续下一切片，直到全部开发任务完成或触发人工 gate。
13. 所有任务完成后，进入 `docs/final-acceptance.md` 定义的最终验收。
14. 使用 Computer Use 或浏览器工具真实操作程序/网站，同时监控后台日志。
15. 最终验收发现问题时，把问题转成新的修复切片，回到 loop；修复后重新验收。

## 分支与自动化规则

验证通过后允许自动执行：

- 在非 `main`、非 `master` 的 feature branch 上 commit
- push 当前 feature branch
- 创建或更新 PR

必须请求人工确认：

- 在 `main` 或 `master` 上 commit/push
- merge PR
- 发布生产
- 生产数据库破坏性迁移
- 真实账号登录、Cookie、token 或 `.env` 使用
- 大规模付费 API 调用
- 合规或法律风险

如果当前在 `main` 或 `master`，先创建或切换到：

```text
agent/<change-id-or-prd>/<slice-name>
```

## 子 Agent 路由

小的单切片任务可以由主 Orchestrator 执行，但必须满足：不来自大型 PRD/change queue、不跨模块、用户没有要求 subagent、不涉及最终验收或高风险 review。

以下情况必须 spawn 真实子 agent：

- 用户明确要求 subagent-driven development、子 agent、多智能体、worker/reviewer/QA agent。
- 当前任务来自 `docs/agent-loop-change-queue.md`。
- 同一 PRD 已连续推进到第二个及后续切片。
- 切片跨两个以上系统边界。
- 需要反驳式 review、Computer Use/browser QA、日志监控、最终验收或安全/数据风险审查。

在必须使用子 agent 的任务里，主 Orchestrator 只负责选切片、写 rubric、分配范围、审查结果、验证和集成；不得自己扮演 worker/reviewer/QA 后声称完成。

子 agent 完成且结果已集成后，必须关闭不再需要的 agent。每轮开始前先处理遗留子 agent：能复用就复用，不能复用就关闭，避免 completed agents 长期占用并发槽。

以下情况使用 `$serial-agent-handoff`：

- 工作跨多个模块或阶段
- 需要多个 worker agent
- 上下文可能压缩
- 需要持久交接记录

以下情况使用 `$harness-skill-engineering`：

- 需要把本工作流创建或更新为可复用 skill
- 需要把反复出现的项目偏好、review 标准或流程约束治理到 skill 层

## 必须输出的 Evidence 形状

每个完成切片必须报告：

```text
完成内容：
-

Done rubric 证据：
1.

验证：
- 定向测试：
- 全量测试：
- OpenSpec：
- diff check：
- guard：

反驳式 review：
-

子 Agent 证据：
- 模式：
- agent_id / agent_type：
- 子 agent 职责：
- 子 agent 输出摘要：
- 生命周期：

未验证：
-

风险：
-

下一切片：
-
```

## 最终验收输出

当所有任务完成后，必须额外输出：

```text
最终验收：
- 启动方式：
- 真实使用路径：
- Computer Use/浏览器操作证据：
- 前端控制台/网络观察：
- 后台日志观察：
- 数据或持久化检查：
- 发现的问题：
- 回流修复切片：
- 重新验收结果：
- 未验证范围：
- 剩余风险：
```

最终验收未通过时，不要宣布项目完成。必须继续修复 loop。
