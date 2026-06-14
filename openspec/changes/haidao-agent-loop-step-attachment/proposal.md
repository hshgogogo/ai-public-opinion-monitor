## 背景

当前系统已经有 Agent Loop run 账本和 HTTP 创建/查询入口，但微博分析、事件、行动和问答命令仍然以独立 worker 命令运行。PRD 要求 Agent Harness 能看到每个关键阶段的状态、证据和失败原因。

本 change 只做可选 step attachment：当调用方显式传入 `agentLoopRunId` 时，现有 worker 命令把自己的执行结果记录到 `agent_step_runs`。未传入时，现有命令必须保持独立行为不变。

## 变更内容

- 为以下 worker 命令增加可选 `agentLoopRunId` 支持：
  - `weibo-comments-analyze`
  - `weibo-events-build`
  - `weibo-actions-build`
  - `weibo-bot-message`
- 每个命令在成功、部分成功、失败或需要人工处理时记录对应 Agent step。
- step output 必须引用已有 evidence IDs 或业务结果 ID，不得编造证据。
- 本 change 不新增或修改 HTTP endpoint；HTTP 层保持当前透传机制，实际 attachment 契约只定义 worker payload 中的精确 `agentLoopRunId` 字段。

## 非目标

- 不调用真实 MediaCrawler。
- 不读取或打印真实微博 Cookie、Chrome 登录态或 `config/cookies/weibo.json`。
- 不新增 DeepSeek live call 要求；现有 DeepSeek/fallback 行为保持不变。
- 不实现 Judge retry loop；Judge 复核属于 `haidao-judge-agent-retry-loop`。
- 不新增前端 Agent Loop 控件。
- 不改变未传 `agentLoopRunId` 时的独立命令行为。

## 能力

### 新增能力

- `agent-loop-step-attachment`：现有微博分析、事件、行动和问答 worker 可选挂载到 Agent Loop run，并写入 step evidence。

## 影响范围

- Worker：`workers/enterprise_worker.py` 中四个现有命令的可选账本写入。
- 数据库：复用 `agent_step_runs`，不新增 migration。
- API：不新增 public endpoint，不改变现有 Node endpoint 契约。
- 测试：standalone compatibility、with-loop step persistence、error/partial 状态测试。
