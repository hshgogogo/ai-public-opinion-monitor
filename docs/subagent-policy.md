# Subagent-Driven Development 策略

本文档定义何时必须使用真实子 agent，以及如何防止主 Orchestrator 自己扮演多个角色。

## 核心判断

子 agent 不是为了形式感，而是为了隔离上下文、制造独立反驳、并行或串行推进大型任务。主 Orchestrator 可以写代码，但不能在需要独立判断时同时当实现者、reviewer、QA 和验收者。

## 必须使用子 Agent 的情况

满足任一条件时，必须 spawn 真实子 agent：

- 用户明确说“子 agent”“subagent”“subagent-driven development”“多智能体”“worker agent”“reviewer agent”“QA agent”。
- 输入来自大型 PRD、`docs/agent-loop-change-queue.md` 或多个 OpenSpec changes。
- 同一 PRD 已连续推进到第二个及后续切片。
- 当前切片跨两个以上边界：前端、后端、数据库、worker、异步队列、部署、权限、LLM/RAG、外部集成、日志监控。
- 实现前需要范围审查、方案反驳或依赖梳理。
- 实现后需要反驳式 review。
- 最终项目验收、浏览器/Computer Use 真实使用测试、日志监控、性能或安全审查。
- 上一轮出现 P1/P2、反复测试失败、需求理解偏差，或用户指出流程没按子 agent 执行。

## 可由主 Orchestrator 独自执行的情况

必须同时满足：

- 单文件或单接口。
- 不来自大型 PRD/change queue。
- 不跨模块。
- 不涉及真实凭据、生产数据、数据库破坏性迁移、付费 API 或合规判断。
- 用户没有要求子 agent。
- 不属于最终验收或反驳式 review。

## 最小子 Agent 编队

普通实现切片：

- `explorer`：实现前审查范围和风险。
- `worker`：负责明确写入范围内的实现。
- `reviewer`：实现后做反驳式 review。

小但必须 subagent 的切片：

- 至少 `reviewer` 一个真实子 agent。

跨前后端/DB/worker 切片：

- 按写入范围拆 worker，避免多个 worker 改同一文件。
- 如果写入范围重叠，使用 `$serial-agent-handoff` 串行执行。

最终验收：

- QA/browser/log 角色必须独立于实现者。
- 主 Orchestrator 负责启动环境、整合证据和回流缺陷。

## 生命周期管理

子 agent 不是一次性装饰品。每个子 agent 必须有明确生命周期：

```text
spawn
-> assigned
-> running
-> completed / blocked / failed
-> integrated
-> closed
```

主 Orchestrator 必须遵守：

- 启动子 agent 后记录 `agent_id`、角色、职责、允许写入范围。
- 子 agent 完成后，主 Orchestrator 先 review 输出、集成结果、运行验证。
- 集成完成后，必须关闭不再需要的 completed/failed/blocked 子 agent。
- 不要把已完成的子 agent 留在侧边栏长期占位。
- 同一任务如果需要连续追问，可以复用同一个子 agent；如果不再需要上下文，关闭它。
- 每轮开始前检查是否有上一轮遗留子 agent。若有，先判断复用或关闭，再创建新子 agent。
- 如果创建子 agent 失败、变慢或没有触发，优先怀疑并清理遗留子 agent，再继续 loop。

经验规则：

- 同时打开的子 agent 控制在 1-3 个。
- 串行 handoff 默认一次只开 1 个 worker。
- 并行 worker 只有在写入范围互不重叠时才允许。
- reviewer/QA 类只读 agent 完成报告后应立即关闭。

## 子 Agent Prompt 必填项

每个子 agent prompt 必须包含：

```text
你不是独自在这个代码库里工作。不要回滚别人做过的改动。与现有变更协作。补丁只限于你被分配的文件和职责范围。
```

同时必须写清：

- 角色。
- 本轮 outcome。
- done rubric。
- 必读文件。
- 允许写入范围。
- 禁止范围。
- 验证命令。
- 输出格式。

## 禁止行为

- 主 Orchestrator 写“我作为 reviewer 检查了一遍”来替代真实子 agent。
- 没有 `agent_id` 或交接日志，却声称已完成 subagent-driven review。
- 多个 worker 并行修改同一文件或同一迁移。
- 子 agent 未完成，主 Orchestrator 直接 commit。
- 子 agent 发现 P0/P1/P2 后只记录不修复。

## Evidence 要求

Subagent-Driven 模式下，evidence report 必须包含：

```text
子 Agent 证据：
- 模式：subagent-driven
- agent_id / agent_type：
- 子 agent 职责：
- 子 agent 输出摘要：
- hook 日志或交接文件：
- 主 Orchestrator 复核结果：
- 生命周期：已集成 / 已关闭 / 仍需保留及原因
```

如果没有真实子 agent 证据，本轮不得自动 commit/push/PR。

## Hook 证据

本 harness 会通过 `SubagentStart` 和 `SubagentStop` hook 尝试写入：

```text
.codex/agent-loop/subagent-events.jsonl
```

这份日志用于给 guard 提供机械证据。它不是安全审计系统，但能减少“忘记创建子 agent 还继续 commit”的情况。
