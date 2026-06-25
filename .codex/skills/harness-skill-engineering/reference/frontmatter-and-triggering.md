# Frontmatter 与触发机制

## 目录和文件硬约束

- 目录名使用 kebab-case：小写字母、数字、短横线。
- 目录名不使用空格、下划线、大写字母、首尾短横线、连续短横线。
- 目录名建议不超过 64 个字符。
- 主文件必须叫 `SKILL.md`，全大写；`skill.md`、`Skill.md`、`SKILL.MD` 都不合格。

## 常用 YAML 字段

```yaml
---
name: example-skill
description: >
  一句话说明能力。使用场景：用户提出哪些真实需求、关键词或同义表达时使用。不适用：哪些相邻场景不应触发。
argument-hint: "[输入对象] [输出形式]"
disable-model-invocation: true
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Glob
---
```

字段说明：

| 字段 | 作用 | 设计要点 |
|---|---|---|
| `name` | Skill 唯一标识 | 最好与目录名一致，短而清楚 |
| `description` | 自动触发的语义信号 | 写给 Agent 判断，不是写给人类浏览 |
| `argument-hint` | `/` 调用时的参数提示 | 只放输入格式，不放长说明 |
| `disable-model-invocation` | 禁止模型自动触发 | 有副作用或高风险任务设为 `true` |
| `user-invocable` | 是否出现在 `/` 菜单 | 纯内部辅助 Skill 可设为 `false` |
| `allowed-tools` | 行动权限边界 | 按最小权限授予 |

若宿主支持，也可使用 `model`、`context`、`agent`、`hooks` 等运行时字段，但不要为炫技而配置。

## `description` 写法

公式：

```text
功能定义 + 使用场景 + 核心能力 + 不适用范围
```

写作步骤：

1. 定义做什么：用一句话说清能力边界。
2. 收集用户真实表达：记录用户可能说的短语、口语、行业术语、同义词。
3. 说明核心能力：能生成什么、分析什么、检查什么、调用什么资源。
4. 加排除范围：用“不适用”排除相邻但不该触发的任务。
5. 压缩预算：优先保留触发词和边界词，删掉空泛介绍。
6. 测试触发：准备应触发和不应触发用例。

好例子：

```yaml
description: >
  生成结构化 API 文档和 OpenAPI/Swagger 规范。使用场景：用户要求生成接口文档、编写 API 文档、输出 OpenAPI 3.0 规范、整理 Swagger、从源码生成端点说明。不适用：只询问某个接口如何调用、普通调试、代码审查或一次性示例解释。
```

坏例子：

```yaml
description: Helps with docs.
```

## 预算机制

- `description` 是第一层常驻入口，会与其他 Skills 共同消耗预算。
- 单个 `description` 必须控制在宿主限制内；实践中超过 800 字符要警惕，超过 1024 字符通常不可接受。
- 预算紧张时，优先保留高频、低风险、自然语言会触发的参考型 Skill。
- 手动触发型 Skill 可设置 `disable-model-invocation: true`，释放自动触发预算。

## 过触发与漏触发

过触发：不该用时被调用。

修复：

- 删除“help、project、coding、docs”等过泛词。
- 增加“不适用”边界。
- 拆分过宽 Skill。
- 将高风险或低频任务改为手动触发。

漏触发：该用时没有调用。

修复：

- 补充用户真实表达和同义词。
- 用行业术语和口语同时覆盖。
- 检查 `description` 是否过长或预算超限。
- 检查目录名和 `SKILL.md` 文件名是否合规。

## 参考型与任务型

| 类型 | 自动触发 | 适用 | 典型配置 |
|---|---|---|---|
| 参考型 Skill | 是 | 知识、规范、分析、审查、报告建议 | 默认配置 |
| 任务型 Skill | 否 | 提交、发布、通知、删除、写入外部系统 | `disable-model-invocation: true` |

最坏情况测试：

```text
如果 Agent 自动执行这个任务，最坏情况是否让人紧张？
```

紧张就做成任务型；不紧张且只是多加载知识，可做参考型。

## 作用域

| 位置 | 生效范围 | 适用 |
|---|---|---|
| 企业配置中心 | 全员 | 企业安全、合规、统一流程 |
| `~/.claude/skills/<name>/` | 个人所有项目 | 个人偏好和跨项目工具 |
| `<project>/.claude/skills/<name>/` | 当前项目 | 项目业务规则和团队协作 |
| Plugin 内置 | 插件启用时 | 社区共享或框架能力包 |

团队协作优先使用项目级 Skill，并纳入版本控制。
