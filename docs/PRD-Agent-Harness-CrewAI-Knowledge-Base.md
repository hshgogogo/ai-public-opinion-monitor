# PRD：《海岛舒服日志》Agent Harness、CrewAI 多智能体与营销知识库重构

副标题：用 React + FastAPI + CrewAI，把当前舆情监测系统升级为可监督、可写回、可自进化的宣发舆情 Agent Harness。

## 1. 文档目的

这份 PRD 用来整合两个已确认的重构计划：

1. **Agent Harness 重构计划**：把后端从脚本式接口升级为服务 Agent Loop 的运行底座。
2. **Agent Harness 与营销知识库计划**：确定前后端框架、CrewAI 多 Agent 编排、skill 写法、结构化营销知识库和 RAG 检索方案。

本文件要求初级开发工程师也能看懂并开始执行。因此每个核心概念都会先解释，再给实现要求。

## 2. 背景与当前问题

当前系统已经能做微博真实搜索、推荐目标、选择目标、采集评论并写入 MySQL。但它还不是一个真正的宣发舆情 Agent。

当前真实链路大致是：

```text
微博搜索 -> 推荐博文 -> 选择目标 -> 采评论入库
```

缺失的真实闭环是：

```text
评论议题分析 -> Judge 复核 -> 事件生成 -> Judge 复核 -> 营销建议 -> 用户反馈 -> 长期记忆 -> 问答/日报
```

已经确认的问题：

- 后端情感分析部分偏写死，很多判断来自固定规则或 fixture 测试，没有充分让 Agent 基于证据和业务知识发挥能力。
- 当前 `enterprise_worker.py` 像一个大型脚本，既做采集、解析、分析、事件、接口，又做错误处理，缺少清晰的 Agent Harness。
- 当前没有形成真正的 Agent Loop。采评论成功后，没有自动进入分析、事件、策略、记忆和问答。
- 一些真实 API 仍是占位，例如 `/api/weibo/bot/messages` 曾返回 `reserved for the real Weibo MVP workflow`，说明真实智能体问答未接入。
- 前端没有完整展示采集到的评论、评论分析、Judge 反馈、事件建议和 Agent 写回结果。
- 业务模型还不够像“宣发作战系统”，更像数据采集和看板。
- 多 Agent 分工不清，一个 Agent 容易既当运动员又当裁判。
- Agent 需要写回能力支撑 feedback，但必须有权限边界、审计和人工确认机制。

## 3. 产品目标

本次重构目标不是简单换框架，而是把系统升级成：

```text
一个围绕《海岛舒服日志》的宣发舆情 Agent Harness。
```

它要持续完成：

- 发现最值得关注的微博博文。
- 采集真实评论。
- 分析评论中的议题、立场、风险、证据句和营销含义。
- 归并观察线索和正式舆情事件。
- 给出有证据、有业务依据的宣发建议。
- 让 Judge Agent 按标准复核所有关键输出。
- 将失败反馈回传给对应 Agent，让它重做直到达标或进入人工处理。
- 记录用户确认、拒绝、修改和现实动作。
- 把事实、事件、动作、回测、经验和偏好写入长期记忆。
- 通过问答入口回答“为什么”“现在该做什么”“过去什么动作有效”等问题。

一句话目标：

```text
后端不再只是 API 和采集脚本，而是 Agent 的 Harness；前端不再只是看板，而是宣发舆情 Agent 工作台。
```

## 4. 非目标

本次首版不做以下事情：

- 不直接做三平台完整重构。首版只跑通微博闭环，小红书和抖音后续接入。
- 不允许生产 Agent 自动修改生产代码。
- 不允许 Agent 自动发布外部平台内容。
- 不允许 Agent 自动把高风险事件升级为正式结论，必须经过 Judge 和必要的人工确认。
- 不把营销书籍或网页全文塞进 prompt，也不复制受版权保护的长篇内容。
- 不把 DeepSeek、CrewAI 或任何模型输出当成最终事实来源。事实必须回到真实数据和证据 ID。

## 5. 已锁定的核心决策

### 5.1 技术栈

| 层级 | 选择 | 原因 |
| --- | --- | --- |
| 前端 | React + Vite | 适合复杂 Agent 工作台、评论表、事件时间线、Judge 反馈、行动账本和知识引用。 |
| 后端 | FastAPI | Python 统一承载 MediaCrawler、CrewAI、Agent Harness、MySQL 写回，减少 Node/Python 跨进程复杂度。 |
| 多 Agent 编排 | CrewAI | 用 Flow 管状态和执行顺序，用 Crew/Agent 做具体任务，适合多 Agent 协作。 |
| 知识库 | 结构化卡片 + RAG | 让营销理论和案例可检索、可引用、可审计，不把知识写死在代码里。 |
| 数据库 | MySQL 继续使用 | 保留现有真实采集、评论、事件、行动和记忆表，新增 harness 相关表。 |

参考：

- CrewAI 文档：https://docs.crewai.com/
- CrewAI Quickstart：https://docs.crewai.com/en/quickstart
- CrewAI Knowledge：https://docs.crewai.com/en/concepts/knowledge
- FastAPI：https://fastapi.tiangolo.com/
- React：https://react.dev/
- Vite：https://vite.dev/

### 5.2 自主等级

采用 **L1.5 半自动 Agent**。

Agent 可以自动做：

- 分析评论。
- 生成观察线索。
- 生成事件草案。
- 生成宣发建议。
- 生成日报。
- 写入业务记忆。
- 提出补采建议。
- 提出待审核规则或知识卡片草案。

Agent 必须人工确认：

- 高风险评论补采。
- 采集二级评论。
- 将观察线索升级成正式高风险事件。
- 将 Agent 建议标记为现实中已执行。
- 认定疑似矩阵投放为已知合作动作。
- 关闭、解决或归档某个重大事件。
- 任何外部平台发布或现实宣发动作。

### 5.3 Judge Agent 权力

采用 **复核 + 否决建议**。

Judge Agent 有评判标准，可以：

- 检查其他 Agent 输出是否符合验收标准。
- 检查是否有真实证据 ID。
- 检查是否套错营销案例。
- 检查是否给了空泛建议。
- 检查是否把推断说成事实。
- 检查是否让模型决定了不该由模型决定的数值。
- 不通过时给出反馈，并要求对应 Agent 重做。
- 阻止不合格结果写库。

Judge Agent 不可以：

- 绕过 Harness 的证据规则。
- 自己直接改数据库事实。
- 自动决定现实宣发动作已经执行。
- 自动覆盖用户反馈。

### 5.4 Judge 重试策略

每个关键阶段最多允许：

```text
Agent 输出 -> Judge 复核 -> 失败反馈 -> Agent 重做
```

循环 3 轮。

如果 3 轮仍不通过：

- Harness 停止该阶段。
- 写入人工处理队列。
- 保留失败输出、Judge 反馈、证据 ID、重试次数。
- 前端显示“需人工处理”。

### 5.5 Agent 自进化边界

首版允许写回：

- 业务记忆。
- 用户偏好。
- 策略经验。
- 案例适用经验。
- 待审规则草案。
- 待审 skill 草案。
- 待审知识卡片。

首版不允许自动写回：

- 生产代码。
- 数据库 migration。
- `.env`。
- Cookie 或登录态。
- 已生效的规则。
- 已生效的 skill。
- 外部平台内容。

如果未来允许 Agent 自动改代码，也必须以 PR 形式提交，并经过测试、review 和人工合并。

## 6. 面向初级工程师的核心概念解释

### 6.1 什么是 Agent Harness

Harness 是“安全运行智能体的后端底座”。

它不是 Agent 本身，而是负责：

- 给 Agent 准备输入。
- 限制 Agent 权限。
- 校验 Agent 输出。
- 控制流程顺序。
- 决定是否写数据库。
- 记录日志。
- 处理失败和重试。

可以理解为：

```text
Agent 负责思考和提案。
Harness 负责证据、权限、状态机、审计和写回。
```

### 6.2 什么是 CrewAI Flow

Flow 用来管理一个完整任务的状态和顺序。

例如一次微博 Agent Loop：

```text
采集完成 -> 分析评论 -> Judge 复核 -> 生成事件 -> Judge 复核 -> 生成建议 -> 写记忆
```

Flow 决定下一步该运行哪个 Agent。

### 6.3 什么是 Crew/Agent

Crew 是一组 Agent。

Agent 是一个有角色、有任务、有工具、有输出格式要求的智能体。

例如：

- Issue Analysis Agent 只负责分析评论。
- Event Agent 只负责归并事件。
- Judge Agent 只负责复核。

### 6.4 什么是 RAG

RAG 是“先检索知识，再让模型回答”。

本项目中，Agent 不能只靠模型记忆回答营销问题。它必须先检索：

- 真实评论。
- 事件。
- 行动账本。
- 用户反馈。
- 营销知识卡片。
- 经典案例。

然后再生成建议。

### 6.5 什么是 skill

skill 是给开发 Agent 或运行时业务 Agent 使用的工作规约。

本项目使用“双层 skill”：

1. **开发层 skill**：告诉 Codex/Claude 如何开发这个项目。
2. **运行层知识/规则**：告诉 CrewAI 业务 Agent 如何做宣发舆情判断。

两者使用同一套业务语言，但不要混放。

## 7. 目标业务流程

### 7.1 完整 Agent Loop

首版微博闭环必须跑通：

```text
1. 真实感知
   通过 MediaCrawler 搜索微博候选内容，采集评论。

2. Adapter 标准化
   解析 JSONL，标准化帖子、评论、账号、热度、链接和原始 JSON。

3. 议题分析
   Issue Analysis Agent 分析评论议题、立场、风险、证据句和营销含义。

4. Judge 复核
   Judge Agent 检查分析结果是否有证据、是否字段完整、是否过度推断。

5. 事件理解
   Event Agent 把评论和候选归并为观察线索或正式事件。

6. Judge 复核
   Judge Agent 检查事件是否满足证据门槛。

7. 行动建议
   Strategy Agent 基于事件、评论、营销知识库给出宣发建议。

8. Judge 复核
   Judge Agent 检查建议是否可执行、是否证据充分、是否套错案例。

9. 人类确认
   用户确认、拒绝、修改或补充现实动作。

10. 记忆写回
    Memory Agent 写入事实、事件、动作、经验、偏好。

11. 问答与日报
    QA Agent 和 Report Agent 基于证据和记忆回答问题或生成报告。
```

### 7.2 数据流

```text
MediaCrawler
  -> raw JSONL
  -> Adapter Agent
  -> MySQL 原始证据表
  -> Issue Analysis Agent
  -> Judge Agent
  -> sentiment_results
  -> Event Agent
  -> Judge Agent
  -> artist_public_opinion_events
  -> Strategy Agent
  -> Judge Agent
  -> publicity_actions
  -> 用户反馈
  -> bot_memory_items / feedback_items
  -> QA / 日报 / 前端工作台
```

### 7.3 当前微博首版优先级

必须先修复真实链路：

```text
已有 social_comments 后
  -> 自动生成 sentiment_results
  -> 生成 observation lead / formal event
  -> 生成 agent_recommended 行动建议
  -> 写入 bot_memory_items
  -> /api/weibo/bot/messages 能真实回答
  -> 前端展示评论、分析、事件、建议和 Judge 结果
```

## 8. 多 Agent 职责

前端只展示一个统一的“宣发舆情 Agent”，但内部由多个 Agent 协作。

| Agent | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| Collector Agent | 提出采集任务和补采建议 | 关键词、目标、数据缺口 | 采集计划、补采建议 |
| Adapter Agent | 检查原始 JSONL 并标准化数据 | JSONL、任务信息 | 候选、帖子、评论、坏行报告 |
| Issue Analysis Agent | 分析评论含义 | 评论、项目词包、知识卡 | sentiment、topics、risks、stance、evidence |
| Event Agent | 归并观察线索和事件 | 评论分析、候选、历史事件 | observation lead、formal event |
| Strategy Agent | 生成宣发建议 | 事件、评论、知识卡、行动账本 | agent_recommended action |
| Action Agent | 维护行动账本 | 用户确认、官方动作、矩阵线索 | publicity_actions |
| Backtest Agent | 回测行动效果 | 行动时间、前后窗口数据 | backtest result |
| Memory Agent | 写业务记忆 | 事件、动作、反馈、报告 | bot_memory_items |
| Report Agent | 生成日报/周报 | 事件、行动、数据覆盖 | Markdown report |
| QA Agent | 回答追问 | 用户问题、证据、记忆、知识卡 | 带引用答案 |
| Judge Agent | 监督结果 | Agent 输出、评分标准、证据 | pass/fail、反馈、重做要求 |

## 9. Judge Agent 验收标准

### 9.1 通用验收标准

任何 Agent 输出都必须满足：

- 必须包含真实证据 ID，或明确说明证据不足。
- 事实、推断、建议必须分开。
- 不能把模型推断写成事实。
- 不能引用不存在的 target/comment/event/action/report/memory ID。
- 不能使用 mock 数据冒充真实数据。
- 不能泄露 `.env`、Cookie、token、登录态。
- 不能输出没有可执行性的空泛建议。
- 不能让 LLM 决定评论权重、事件分数、趋势窗口和回测信号。

### 9.2 评论分析验收标准

Issue Analysis Agent 输出必须包含：

- `comment_id`
- `sentiment`
- `score`
- `confidence`
- `topics`
- `risks`
- `stance`
- `issue_summary`
- `intensity`
- `evidence`
- `model`
- `fallback_type`
- `analyzed_at`

Judge 必须检查：

- 每条分析都对应真实评论。
- 证据句来自评论内容。
- 风险标签和议题标签能从评论推导。
- 如果模型失败，本地规则兜底必须标记为 fallback。

### 9.3 事件验收标准

Event Agent 输出必须包含：

- 事件标题。
- 事件类型。
- 触发原因。
- 相关艺人。
- 状态。
- 风险等级。
- 证据 ID。
- 时间线。
- 影响评估。
- 推荐动作草案。

Judge 必须检查：

- 观察线索和正式事件没有混淆。
- 正式事件满足证据门槛。
- 升温/降温必须有至少两个采集周期。
- 事件不能只凭模型感觉创建。

### 9.4 策略建议验收标准

Strategy Agent 输出必须包含：

- `action_type`
- `platform`
- `content_summary`
- `reason`
- `evidence_ids`
- `priority`
- `owner_suggestion`
- `confidence`
- `recommended_check_after_at`
- 关联知识卡或案例引用。

Judge 必须检查：

- 建议是否和证据相关。
- 建议是否适合微博场景。
- 是否误用了营销案例。
- 是否能执行。
- 是否说明风险。
- 是否把建议误当成现实动作。

### 9.5 QA 验收标准

QA Agent 回答必须使用固定结构：

```text
事实：
- 基于真实 ID 的可追溯信息。

推断：
- Agent 对事实的解释，必须标明置信度。

建议：
- 可执行动作、适用平台、负责人建议、复查时间。

引用：
- target_id / comment_id / event_id / action_id / report_id / memory_id / knowledge_card_id。
```

无数据时回答：

```text
当前没有真实数据支撑，不能判断。
```

证据不足时回答：

```text
当前只能作为观察线索，证据不足以定性为正式事件。
```

归因不足时回答：

```text
动作后相关指标出现变化，但存在其他干扰因素，不能确认该动作单独导致改善。
```

## 10. 前端框架与页面设计

### 10.1 框架

使用：

```text
React + Vite
```

当前原生 HTML/JS 只适合简单工作台。Agent 工作台需要：

- 多面板状态。
- 评论表。
- 时间线。
- Judge 反馈。
- 用户确认队列。
- 知识引用。
- 问答上下文。

React 更适合维护这些状态。

### 10.2 页面结构

首版页面：

1. **Agent 总览**
   - 当前 loop 状态。
   - 今日最重要判断。
   - 当前卡在哪个阶段。
   - Judge 是否通过。

2. **推荐采集目标**
   - 微博候选。
   - Agent 推荐理由。
   - 预计能回答的问题。
   - 采集成本和风险。
   - 用户选择、忽略、补采。

3. **评论与议题分析**
   - 真实评论列表。
   - 评论来源。
   - 点赞/回复。
   - 议题。
   - 立场。
   - 情绪。
   - 风险。
   - 证据句。
   - Judge 结果。

4. **舆情事件**
   - 观察线索。
   - 正式事件。
   - 时间线。
   - 风险等级。
   - 影响评估。
   - 证据 ID。

5. **行动账本**
   - Agent 建议。
   - 官方观察动作。
   - 疑似矩阵动作。
   - 用户确认状态。
   - 回测状态。

6. **Judge 反馈队列**
   - 哪个 Agent 输出没通过。
   - 为什么没通过。
   - 已重试几次。
   - 是否需要人工处理。

7. **知识库引用**
   - 本次建议引用了哪些营销知识卡。
   - 来源可信度。
   - 适用条件。
   - 禁用条件。

8. **证据问答**
   - 用户提问。
   - Agent 检索证据。
   - 回答带引用。
   - 证据不足时明确说明。

### 10.3 前端不展示的内容

主工作台不应展示：

- Chrome CDP 运行过程。
- MediaCrawler 内部日志。
- Cookie。
- `.env` 配置。
- token。

这些只放在后台设置或诊断页。

## 11. 后端框架与服务设计

### 11.1 框架

使用：

```text
FastAPI + CrewAI + MySQL
```

FastAPI 负责：

- HTTP API。
- 请求校验。
- 用户反馈接口。
- Agent Loop 触发。
- 工作台数据聚合。
- 诊断接口。

CrewAI 负责：

- Flow 编排。
- Agent 执行。
- 多 Agent 协作。
- Knowledge 检索。

Harness 负责：

- 权限。
- 状态机。
- 数据库写入。
- Judge 重试。
- 错误处理。
- 审计日志。

### 11.2 Node 迁移策略

当前 `src/server.js` 是 Node HTTP wrapper。迁移时不要一次性推翻全部功能。

建议步骤：

1. 新增 FastAPI 服务，与旧 Node 服务并行。
2. 先把微博 Agent Loop 新接口放在 FastAPI。
3. React 前端改为调用 FastAPI。
4. 保留 Node 旧接口一段时间用于回归对比。
5. 微博闭环稳定后，再下线 Node wrapper。

### 11.3 CrewAI 使用方式

推荐结构：

```text
Flow：控制一次 Agent Loop 的状态和顺序。
Crew：执行某个阶段的一组 Agent。
Agent：完成具体任务，例如议题分析、事件归并、策略建议。
Tool：访问数据库、读取知识库、调用 MediaCrawler、写日志。
Knowledge：营销知识卡、案例、项目记忆。
```

重要规则：

```text
CrewAI Agent 不能直接写库。
Agent 只能返回结构化 proposal。
Harness 校验 proposal 后才决定是否写库。
```

## 12. API 设计

### 12.1 Agent Loop

```http
POST /api/weibo/agent-loop/run
```

用途：触发一次微博 Agent Loop。

请求示例：

```json
{
  "projectId": 1,
  "targetId": 123,
  "mode": "after_collection"
}
```

`mode` 可选：

- `after_collection`：评论采集后自动触发。
- `scheduled`：定时监控触发。
- `manual`：用户手动触发。

返回示例：

```json
{
  "ok": true,
  "agentLoopRunId": 88,
  "status": "running"
}
```

### 12.2 Agent Run 查询

```http
GET /api/weibo/agent-runs/{id}
```

返回：

- 每个 Agent 阶段。
- Judge 结果。
- 重试次数。
- 当前状态。
- 写库结果。
- 失败原因。

### 12.3 评论列表

```http
GET /api/weibo/comments
```

用于前端展示真实采集评论。

### 12.4 分析列表

```http
GET /api/weibo/analyses
```

用于前端展示评论议题分析结果。

### 12.5 用户反馈

```http
POST /api/weibo/feedback
```

用户可以反馈：

- 确认事件。
- 驳回事件。
- 修改事件。
- 确认建议。
- 驳回建议。
- 记录现实动作。
- 修正账号类型。
- 补充偏好。

请求示例：

```json
{
  "projectId": 1,
  "sourceType": "event",
  "sourceId": 42,
  "feedbackType": "confirmed",
  "note": "这确实是官宣可信度相关风险，但暂时不要升级为高风险。"
}
```

### 12.6 真实问答

```http
POST /api/weibo/bot/messages
```

要求：

- 不再返回 reserved。
- 必须先检索真实证据和知识卡。
- 回答必须带引用。
- 证据不足时明确说明不足。

### 12.7 知识卡查看

```http
GET /api/knowledge/cards
```

### 12.8 知识卡草案

```http
POST /api/knowledge/cards/propose
```

用途：Agent 可以提出待审核知识卡，但不能直接生效。

## 13. 数据模型

保留现有核心表：

- `monitor_projects`
- `platform_auth_states`
- `collection_tasks`
- `discovered_targets`
- `target_collection_links`
- `social_posts`
- `social_comments`
- `sentiment_results`
- `agent_runs`
- `source_accounts`
- `artist_public_opinion_events`
- `event_evidence_links`
- `event_status_history`
- `publicity_actions`
- `action_backtests`
- `bot_memory_items`
- `bot_conversations`
- `bot_messages`
- `daily_reports`

新增或扩展以下表。

### 13.1 `agent_loop_runs`

记录一次完整 Agent Loop。

字段建议：

- `id`
- `project_id`
- `platform`
- `trigger_mode`
- `target_id`
- `status`
- `started_at`
- `finished_at`
- `current_step`
- `error_type`
- `error_message`

### 13.2 `agent_step_runs`

记录每个 Agent 阶段。

字段建议：

- `id`
- `loop_run_id`
- `project_id`
- `agent_name`
- `step_name`
- `status`
- `input_json`
- `output_json`
- `started_at`
- `finished_at`
- `error_message`

### 13.3 `judge_reviews`

记录 Judge 复核。

字段建议：

- `id`
- `loop_run_id`
- `step_run_id`
- `judge_agent_name`
- `status`
- `score`
- `pass`
- `feedback_json`
- `required_changes`
- `evidence_errors`
- `retry_count`
- `created_at`

### 13.4 `feedback_items`

记录用户反馈和人工处理队列。

字段建议：

- `id`
- `project_id`
- `source_type`
- `source_id`
- `feedback_type`
- `note`
- `status`
- `created_by`
- `created_at`

### 13.5 `knowledge_sources`

记录知识来源。

字段建议：

- `id`
- `title`
- `source_type`
- `reliability_level`
- `url`
- `publisher`
- `published_at`
- `notes`

### 13.6 `knowledge_cards`

记录结构化营销知识卡。

字段建议：

- `id`
- `source_id`
- `framework_or_case`
- `applicable_scenario`
- `do_not_apply_when`
- `recommended_actions`
- `risk_warnings`
- `evidence_required`
- `judge_questions`
- `tags`
- `status`
- `created_at`
- `updated_at`

### 13.7 `rule_proposals`

记录 Agent 自进化产生的待审规则或 skill 草案。

字段建议：

- `id`
- `project_id`
- `proposal_type`
- `title`
- `content`
- `source_evidence_ids`
- `judge_review_id`
- `status`
- `created_at`

## 14. Skill 设计

### 14.1 开发层 skill

新增项目级：

```text
CLAUDE.md
.claude/skills/haidao-public-opinion-agent/SKILL.md
```

注意：这是项目级配置，不是全局配置。

`CLAUDE.md` 应包含：

- 本项目是单剧宣发舆情 Agent，不是通用看板。
- OpenSpec 是需求源。
- Harness 是运行裁决层。
- CrewAI Agent 只能提案，不能直接写库。
- Judge Agent 必须按验收标准复核。
- 不得提交 `.env`、Cookie、token、登录态。
- Agent 自进化只能生成待审草案，不得直接改生产代码。
- 真实数据优先，不允许 mock 冒充真实数据。

`SKILL.md` 应包含：

- 舆情 Agent Loop 工作流。
- 证据门槛。
- Judge 评分表。
- 允许写回和禁止写回边界。
- “事实 / 推断 / 建议 / 引用”的回答格式。
- TDD 和验证要求。

### 14.2 运行层知识规则

运行层知识不放进开发 skill 里，而是放进知识库。

原因：

- 知识量会持续增长。
- Agent 需要检索，而不是一次性加载全部。
- 每条知识都要有来源、适用条件和禁用条件。
- Judge 要能引用知识卡来判断建议是否合理。

## 15. 营销知识库

### 15.1 知识库原则

首版采用：

```text
结构化卡片 + RAG
```

不做：

- 只写在 prompt 里。
- 只写在代码里。
- 直接复制整本书。
- 没有来源的营销经验。

### 15.2 来源分级

| 级别 | 来源类型 | 用途 |
| --- | --- | --- |
| A | 官方资料、学术论文、权威机构、经典工具书 | 可作为主要判断依据。 |
| B | 奖项案例、行业报告、公开访谈、平台案例 | 可作为案例参考。 |
| C | 营销文章、自媒体分析、二手总结 | 只能作为启发，不参与硬规则。 |

### 15.3 首批知识范围

优先顺序：

1. 影视宣发案例。
2. 微博社媒传播案例。
3. 危机公关案例。
4. 通用营销理论。
5. 品牌增长和长期/短期效果。
6. 平台经验。

### 15.4 首批知识主题

#### 经典营销基础

- Kotler/Keller 营销管理体系。
- STP。
- 定位。
- 4P / 4C。
- 品牌资产。

参考：

- Pearson Marketing Management：https://www.pearson.com/se/Nordics-Higher-Education/subject-catalogue/marketing/Kotler-Keller-Marketing-Management-Global-Edition-16e.html

#### 品牌增长与长期/短期平衡

- Ehrenberg-Bass 的 How Brands Grow。
- Binet & Field 的 IPA 营销效果研究。
- 长期品牌建设和短期转化的平衡。

参考：

- Ehrenberg-Bass books：https://marketingscience.info/learn-with-us/books
- IPA Long and Short：https://ipa.co.uk/knowledge/publications-reports/the-long-and-the-short-of-it-balancing-short-and-long-term-marketing-strategies

#### 公关与危机应对

- SCCT 情境危机沟通理论。
- PESO 模型。
- SOSTAC 规划模型。
- AISAS 消费者行为模型。

参考：

- SCCT：https://en.wikipedia.org/wiki/Situational_crisis_communication_theory
- SOSTAC：https://prsmith.org/
- AISAS：https://dentsu-ho.com/en/articles/3100
- PESO：https://spinsucks.com/communication/peso-model-comprehensive-guide/

#### 影视宣发案例

- Barbie：跨品牌合作、社媒扩散、earned media。
- The Blair Witch Project：沉浸式病毒营销。
- Deadpool：角色人格化内容和社媒传播。
- 中国影视剧微博/平台传播案例。

参考：

- Barbie case：https://shortyawards.com/16th/barbie-the-movie-marketing-campaign
- Blair Witch Stanford case：https://www.gsb.stanford.edu/faculty-research/case-studies/blair-witch-project
- Chinese TV drama social media marketing：https://drpress.org/ojs/index.php/HBEM/article/download/14852/14398

### 15.5 知识卡格式

每张知识卡必须包含：

```json
{
  "source_title": "Barbie The Movie Marketing Campaign",
  "source_type": "award_case",
  "reliability_level": "B",
  "framework_or_case": "跨品牌合作和 earned media 扩散",
  "applicable_scenario": "当剧集具备明确视觉符号、生活方式标签或可合作品牌资产时",
  "do_not_apply_when": "当当前舆情核心是艺人危机或事实争议时，不应直接套用放大传播策略",
  "recommended_actions": ["寻找低风险生活方式话题", "联动视觉物料", "观察自然用户二创"],
  "risk_warnings": ["过度商业联动可能被认为营销感过强"],
  "evidence_required": ["相关正向评论", "视觉/生活方式话题讨论", "非高风险事件状态"],
  "citation_url": "https://shortyawards.com/16th/barbie-the-movie-marketing-campaign",
  "judge_questions": ["当前证据是否支持放大传播，而不是先澄清风险？"]
}
```

## 16. 写回能力与 Feedback

### 16.1 用户反馈类型

用户可以反馈：

- 这个事件判断正确。
- 这个事件判断错误。
- 这个事件只是观察线索，不要升级。
- 这个建议我们执行了。
- 这个建议我们没执行。
- 这个建议部分执行。
- 这个账号是官方号。
- 这个账号是营销号。
- 这个账号不是矩阵号。
- 我们更偏好保守处理。
- 我们更偏好放大正向讨论。

### 16.2 Feedback 如何影响系统

Feedback 必须写入：

- `feedback_items`
- `bot_memory_items`
- 相关 event/action 的状态或备注。

后续 Agent 必须检索这些反馈。

例如：

```text
用户多次拒绝“公开澄清”建议。
Memory Agent 应写入偏好：当前团队倾向低调观察，不优先公开澄清。
Strategy Agent 后续给建议时，应降低公开澄清优先级。
Judge Agent 也应检查建议是否违背已知用户偏好。
```

### 16.3 自进化流程

```text
用户反馈 / 事件结果 / Judge 失败原因
  -> Memory Agent 总结经验
  -> 生成 knowledge_card 或 rule_proposal 草案
  -> Judge Agent 复核
  -> 人工确认
  -> 生效
```

## 17. 验收标准

### 17.1 微博真实闭环验收

给定 MySQL 中已经有微博真实评论：

- 系统能触发 Agent Loop。
- 系统能分析评论。
- 系统能写入 `sentiment_results`。
- 系统能创建观察线索或正式事件。
- 系统能生成至少一条 evidence-bound 策略建议，或明确说明证据不足。
- 系统能写入 `agent_loop_runs`、`agent_step_runs`、`judge_reviews`。
- 系统能写入 `bot_memory_items`。
- `/api/weibo/bot/messages` 能真实回答，不再返回 reserved。
- 前端能看到评论、分析、事件、建议、Judge 状态。

### 17.2 Judge 验收

必须证明：

- 无证据输出会被 Judge 拒绝。
- 引用不存在 ID 会被 Judge 拒绝。
- 空泛建议会被 Judge 拒绝。
- 模型输出权重、事件分数、趋势结论时，Harness 会忽略或拒绝。
- 3 轮不过会进入人工处理队列。

### 17.3 知识库验收

必须证明：

- 策略建议能引用知识卡。
- 知识卡有来源 URL。
- 来源有可信度等级。
- Judge 会检查知识卡适用条件。
- Agent 不会把 C 级来源当成硬规则。

### 17.4 前端验收

必须看到：

- 采到多少条评论。
- 评论内容。
- 每条评论的议题分析。
- 事件列表。
- 行动建议。
- Judge 是否通过。
- 不通过原因。
- 用户反馈入口。
- QA 回答引用的证据 ID。

## 18. 测试计划

### 18.1 单元测试

- Agent 输出 schema 校验。
- Judge 评分表校验。
- 知识卡格式校验。
- Evidence ID 存在性校验。
- 评论权重确定性计算。
- 事件分数确定性计算。

### 18.2 集成测试

- 微博评论入库后跑完整 Agent Loop。
- DeepSeek/CrewAI 失败时写入 agent failure。
- Judge 失败后自动重试。
- 3 轮失败后进入人工队列。
- QA 从真实证据回答。

### 18.3 前端测试

- React 工作台渲染 Agent Loop 状态。
- 评论和分析表正确展示。
- Judge 反馈正确展示。
- 用户反馈能提交。
- QA 能显示引用。

### 18.4 安全测试

- `.env` 不进入 diff。
- Cookie 不进入 diff。
- token 不进入 diff。
- 登录态不进入 diff。
- 原始账号密码不保存。

## 19. 分阶段实施计划

### Phase 0：保护当前状态

- 先提交或暂存当前未提交的前端小改动。
- 新建 OpenSpec change，例如 `haidao-agent-harness-crewai-loop`。
- 不直接修改 archived MVP change。

### Phase 1：技术底座

- 初始化 FastAPI 服务。
- 初始化 React + Vite 前端。
- 初始化项目级 Python 环境。
- 安装 CrewAI 到项目环境，不装全局。
- 保留旧 Node 服务用于对照。

### Phase 2：Agent Harness

- 新增 `agent_loop_runs`。
- 新增 `agent_step_runs`。
- 新增 `judge_reviews`。
- 实现 Agent proposal schema。
- 实现 Harness 校验和写回。

### Phase 3：微博真实闭环

- 评论入库后触发 Agent Loop。
- 实现真实评论分析。
- 实现真实事件生成。
- 实现真实策略建议。
- 实现真实 QA。
- 前端展示评论、分析、事件、建议。

### Phase 4：Judge 反馈循环

- 实现 Judge Agent。
- 实现评分表。
- 实现失败反馈。
- 实现最多 3 轮重试。
- 实现人工处理队列。

### Phase 5：营销知识库

- 建立 `knowledge_sources`。
- 建立 `knowledge_cards`。
- 导入首批影视宣发和营销知识卡。
- 接入 RAG。
- 让 Strategy Agent 和 Judge Agent 使用知识卡。

### Phase 6：自进化与反馈

- 实现 `feedback_items`。
- 实现用户反馈写回。
- 实现 rule proposal。
- 实现待审知识卡。
- 实现用户偏好影响后续建议。

### Phase 7：三平台扩展准备

- 抽象平台接口。
- 保留微博实现。
- 为小红书和抖音预留 Collector/Adapter。
- 不在首版强行接三平台闭环。

## 20. 风险与控制

| 风险 | 控制方式 |
| --- | --- |
| Agent 幻觉 | Harness 证据校验 + Judge 复核 + 引用 ID 必填 |
| Judge 自己误判 | Judge 不能绕过 Harness；关键动作仍需人工确认 |
| 无限重试 | 每阶段最多 3 轮 |
| 营销案例套错 | 知识卡必须有适用条件和禁用条件 |
| 成本过高 | 先微博闭环，按阶段执行 |
| 技术迁移过大 | FastAPI 与旧 Node 并行，逐步迁移 |
| 规则写死 | 规则只约束证据、权限、状态机，不写死业务结论 |
| Agent 自改系统 | 首版只允许待审草案，不自动改生产代码 |

## 21. 初级开发工程师执行提示

如果你是初级开发工程师，优先记住：

1. 不要让 CrewAI Agent 直接写数据库。
2. Agent 输出必须先变成 proposal。
3. proposal 必须经过 Harness 校验。
4. 关键 proposal 必须经过 Judge。
5. Judge 不通过就重做，最多 3 次。
6. 所有事实都要有真实 ID。
7. 没证据就说证据不足。
8. 不要把营销知识写死在代码里。
9. 不要提交 `.env`、Cookie、token。
10. 首版只把微博闭环跑通。

## 22. 最终定义

本项目最终要形成的是：

```text
React 工作台
  + FastAPI Agent Harness
  + CrewAI 多 Agent
  + Judge 反馈循环
  + MySQL 证据和记忆
  + 结构化营销知识库
  + 用户反馈写回
```

它不是一个简单的舆情 dashboard，而是一个能持续感知、判断、建议、接受反馈、沉淀经验的《海岛舒服日志》宣发舆情 Agent。
