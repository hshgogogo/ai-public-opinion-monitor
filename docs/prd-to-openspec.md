# PRD 到 OpenSpec Changes 拆解规范

本文档定义 agent loop 在面对大型 PRD 时的前置拆解流程。目标是先把模糊、庞大、跨模块的 PRD 变成可排队、可验证、可回滚的 OpenSpec changes，再进入实现 loop。

## 何时必须执行

满足任一条件时，必须先执行本流程，禁止直接写业务代码：

- 用户说“根据 PRD 自动开发”“执行这个 PRD”“按 PRD 跑 agent loop”，但没有指定活跃 OpenSpec `<CHANGE_ID>`。
- PRD 覆盖多个模块、前后端、数据库、异步任务、权限、部署、可观测性或外部集成。
- PRD 中有多个用户流程、多个里程碑，或任务数量超过 7 个。
- 预计完整实现需要超过 1-2 个 agent loop 切片。
- 项目使用 OpenSpec，但 PRD 还没有对应 `openspec/changes/<change-id>/`。
- 上一轮开发暴露出“任务太大、验收不清、依赖太多、无法本地验证”。

只有非常小的需求才可以跳过：单模块、单行为、可在一轮内完成、无外部风险，并且用户明确允许不创建 OpenSpec。

## 输入

优先读取：

- PRD 或需求文档
- `AGENTS.md`
- `docs/agent-loop.md`
- `docs/verification-rubric.md`
- `docs/final-acceptance.md`
- 已存在的 `openspec/changes/`
- 相关 `memory/`
- `git status --short`

如果 PRD 缺少关键业务目标、用户流程、验收标准或风险边界，先基于现有内容做保守拆解；只有在无法判断安全边界或核心目标时才询问用户。

## 输出

必须产出或更新：

```text
docs/agent-loop-change-queue.md
```

如果项目使用 OpenSpec，还必须为排在第一位的低风险 change 创建：

```text
openspec/changes/<change-id>/proposal.md
openspec/changes/<change-id>/design.md
openspec/changes/<change-id>/tasks.md
```

大型 PRD 可以只先创建前 1-3 个 OpenSpec change 的完整文件，但 `change-queue.md` 必须列出全量候选队列。这样可以避免一次性生成大量低质量 spec。

如果项目没有 OpenSpec 目录或 CLI：

- 仍然创建 `docs/agent-loop-change-queue.md`。
- 在 evidence report 中说明“OpenSpec 未就绪，已生成待迁移 change 队列”。
- 后续如果用户或项目启用 OpenSpec，再把队列迁移成 `openspec/changes/<change-id>/`。

## 拆解原则

每个 change 应该是一个垂直切片，而不是按技术层水平拆分。

好的 change：

- 有明确用户或系统 outcome。
- 可以在本地或测试环境验证。
- 可以独立 review、commit、push、PR。
- 依赖少，回滚成本低。
- 能用 3-7 条 done rubric 判断完成。
- 不把真实凭据、生产数据、合规判断混入普通开发。

坏的 change：

- “完成整个前端”“实现全部后端”“接入所有功能”。
- 只按文件夹或技术层拆：例如“先建所有数据库表，再写全部 API，再写全部 UI”。
- 需要真实账号、生产数据库或大规模付费 API 才能知道是否完成。
- 没有用户路径、失败路径或验收证据。

推荐队列规模：

- 小 PRD：1-3 个 changes。
- 中型 PRD：4-8 个 changes。
- 大型 PRD：8-15 个 changes，超出时先拆里程碑。

## Change Queue 模板

`docs/agent-loop-change-queue.md` 使用以下结构：

```markdown
# Agent Loop Change Queue

来源 PRD：
- <文件路径或说明>

全局 MVP outcome：
- <最终用户或系统要达成的结果>

全局不做：
- <本阶段明确不做的范围>

全局风险边界：
- <真实凭据、生产数据、付费 API、合规、破坏性迁移等>

## 执行顺序

| 顺序 | Change ID | Outcome | 本地验证方式 | 依赖 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| 1 | add-example-foundation | <结果> | <测试/浏览器/日志> | 无 | 低 | planned |

## Change: <change-id>

Outcome:
-

范围:
-

不做:
-

Done rubric 摘要:
1.

建议测试:
-

验收方式:
-

依赖:
-

风险与人工 gate:
-
```

状态值：

- `planned`：已排队，未开始。
- `active`：当前正在实现。
- `blocked`：等待人工确认或外部条件。
- `done`：已实现并有 evidence。
- `accepted`：最终验收覆盖通过。

## OpenSpec 文件要求

`proposal.md` 至少包含：

- 背景和用户/系统 outcome。
- 本 change 的范围。
- 明确不做什么。
- 风险和人工 gate。

`design.md` 至少包含：

- 关键技术方案。
- 数据流、状态流或交互流。
- 失败处理、日志、幂等、权限或兼容性考虑。
- 本地验证策略。

`tasks.md` 至少包含：

- 可勾选任务。
- 每个任务可验证。
- 不把“最终验收通过”提前写成普通开发任务完成。

## 拆解阶段 Done Rubric

拆解阶段完成必须满足：

1. `change-queue.md` 覆盖 PRD 的主要 outcome，没有遗漏明显用户流程。
2. 每个 change 都有 outcome、范围、不做、验证方式、风险和依赖。
3. 第一个 change 足够小、低风险、可本地验证。
4. 如果使用 OpenSpec，第一个 change 已创建 `proposal.md`、`design.md`、`tasks.md`。
5. 高风险事项已经标为人工 gate，没有混入自动执行队列。
6. 没有开始写业务代码。

## Evidence Report 要求

拆解完成后必须输出：

```text
PRD 拆解完成：
- 来源 PRD：
- 生成/更新的 change queue：
- 创建的 OpenSpec change：
- 第一个推荐执行 change：

覆盖说明：
- 已覆盖的 PRD outcome：
- 暂未覆盖或后置的范围：

风险 gate：
-

下一步：
- 进入 SELECT_CHANGE / SELECT_SLICE，开始第一个低风险 change。
```

## 后续 Loop 衔接

拆解完成后：

1. 把队列中第一个低风险 change 标为 `active`。
2. 读取该 change 的 `proposal.md`、`design.md`、`tasks.md`。
3. 从该 change 中选择一个最小可验证切片。
4. 按 `docs/agent-loop.md` 继续 DEFINE_RUBRIC、TDD、验证、review、evidence。
5. 一个 change 完成后，更新 `change-queue.md` 状态，再进入下一个 change。
