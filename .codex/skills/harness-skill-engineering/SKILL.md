---
name: harness-skill-engineering
description: >
  当用户要创建、改造、安装前检查、评审或治理 Codex/Claude Agent Skill 时使用，尤其是把反复解释的 SOP、领域知识、业务流程、判断标准、模板、脚本、权限边界或触发条件沉淀成可复用 Skill。适用于“写一个 skill / 优化 skill 触发条件 / 把工作流 skill 化 / 评审 allowed-tools / 给 skill 加模板或脚本 / 验证 skill 是否可靠”等请求。不适用于普通问答、一次性提示词润色、单次代码开发、无需长期复用的临时任务。
argument-hint: "[目标行业或任务] [目标安装范围]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - Bash(python3 .claude/skills/harness-skill-engineering/scripts/validate_skill.py:*)
---

# Harness Skill 工程

## 定位

把临时口头交代变成可复用、可版本化、可测试、可按需加载的专业工作流。目标不是让 Agent 记住更多，而是让它在正确时刻读取正确知识，并且只做被允许做的事。

这个 Skill 面向所有行业：先抽象“任务触发、知识分层、行动边界、验证闭环”，再落到具体行业材料。

## 触发条件

必须使用本 Skill：

- 用户明确说“创建 skill”“写 skill”“改造 skill”“安装前检查 skill”“优化 skill 触发条件”“把 SOP 变成 skill”“把工作流沉淀成 skill”。
- 用户提供一段反复使用的流程、岗位 SOP、业务规则、偏好、判断标准、模板、脚本或权限边界，并希望以后不用重复解释。
- 用户要求评审某个 skill 的 `description`、frontmatter、触发边界、资源分层、`allowed-tools`、模板、脚本或测试方式。
- 用户要求把一份长文档、工作流或团队规范拆成可按需加载的 `SKILL.md`、`reference/`、`templates/`、`scripts/`。

可以使用本 Skill：

- 用户对 Codex/Claude 经常误触发、漏触发、不读正确文件、越权执行、输出格式不稳等问题做系统性治理。
- 用户希望为多个项目、多个角色或多个行业沉淀一套可复用 agent 能力。

不要使用本 Skill：

- 用户只是要一次性解释概念、润色 prompt、修改普通代码、修复 bug 或写单次文档。
- 用户要执行某个已经存在的产品开发流程，此时应优先使用对应业务 skill，例如 TDD、review、frontend QA 或 handoff。
- 任务有真实提交、发布、删除数据、发送通知等外部副作用，但用户没有明确授权。

## 核心流程

1. 明确要沉淀的重复能力：识别用户反复解释的领域知识、业务规则、判断标准、输出格式、工具步骤或协作流程。信息不足时最多问 3 个关键问题。
2. 判定承载位置：所有任务都必须遵守的规则放 `CLAUDE.md`；特定领域或工作流放 Skill；确定性计算、扫描、转换、校验放 `scripts/`；稳定格式放 `templates/`。
3. 选择 Skill 类型：无副作用的知识、分析、审查类默认自动触发；提交、发布、发送通知、删除数据、修改外部系统等有副作用任务必须设计为手动触发，并设置 `disable-model-invocation: true`。
4. 设计目录骨架：目录名使用 kebab-case；唯一必需文件是全大写 `SKILL.md`；长知识放 `reference/`，模板放 `templates/`，示例放 `examples/`，确定性逻辑放 `scripts/`。
5. 写 `description`：把它当作语义指纹，而不是人类说明书。包含“做什么、何时用、能做什么、不适用什么”，优先覆盖用户真实说法和同义表达。
6. 写 `SKILL.md` 主文件：只保留身份、触发边界、核心流程、Quick Reference、资源加载契约和输出要求。不要把它写成百科全书。
7. 配置行动边界：依据最坏情况测试和最小权限原则设置 `allowed-tools`。严禁在高风险 Skill 中使用 `Bash(*)`。
8. 验证并迭代：做触发测试、功能测试、性能对比和安全检查。用户每次反复纠正的点，都应回写到 Skill。

## 快速路由

| 需要处理的问题 | 加载资源 | 取得什么 |
|---|---|---|
| 不确定某类知识应放 `CLAUDE.md` 还是 Skill | `reference/architecture.md` | 知识分层、目录职责、Harness 思想 |
| 要写 frontmatter、`description` 或触发边界 | `reference/frontmatter-and-triggering.md` | 元数据字段、预算、自动/手动触发、作用域 |
| 要设计权限、脚本或副作用任务 | `reference/security-and-permissions.md` | `allowed-tools`、最小权限、命令白名单、安全反模式 |
| 要测试、评审或治理一组 Skills | `reference/testing-and-iteration.md` | 测试集、指标、迭代闭环、预算治理 |
| 要直接创建新 Skill | `templates/skill-skeleton.md` | 可复制的中文 Skill 骨架 |
| 要打磨 `description` | `templates/description-lab.md` | 触发词收集和压缩模板 |
| 要设计主文件路由表 | `templates/quick-reference-table.md` | Quick Reference 表格模板 |
| 要做最终审查 | `templates/review-checklist.md` | 上线前检查清单 |

## 资源引用契约

引用辅助文件时必须说明三件事：何时加载、去哪加载、加载后获得什么。不要只写“详见某文件”。

推荐写法：

```md
当用户需求涉及风险权限、外部副作用、命令执行或数据写入时，读取
`reference/security-and-permissions.md`，据此决定 Skill 类型、allowed-tools
白名单和必须禁止的动作。
```

## 输出要求

创建或改造 Skill 时，默认输出实际文件，而不是只给建议。产物应包含：

- 合规目录名和 `SKILL.md`
- 凝练但可触发的 `description`
- 渐进式加载结构和 Quick Reference
- 必要的 `reference/`、`templates/`、`scripts/` 拆分
- 与任务风险匹配的 `allowed-tools`
- 触发测试、功能测试和安全检查说明

如目标路径可执行验证脚本，最后运行：

```bash
python3 .claude/skills/harness-skill-engineering/scripts/validate_skill.py <skill-dir>
```
