## Context

微博 MVP 已经具备真实评论、分析、事件、行动、记忆和反馈闭环的基础能力。下一步需要让 Strategy Agent 和 Q&A 不只依赖固定规则或 prompt 经验，而是能检索结构化营销知识卡，并把“为什么采用这个建议、什么时候不能套用这个案例”保存为可审计引用。

本 change 仍运行在现有 Node HTTP wrapper + Python worker + MySQL 架构中，不引入 FastAPI、CrewAI runtime 或向量数据库作为首版硬依赖。知识库首版只服务微博闭环，不扩展小红书、抖音。

## Goals / Non-Goals

**Goals:**

- 建立 MySQL 中的 `knowledge_sources` 和 `knowledge_cards`，支持幂等 migration 与 seed。
- 知识卡必须结构化保存来源、可信度、适用条件、禁用条件、建议动作、风险提醒、证据要求、Judge questions 和 tags。
- 提供 worker 级知识卡校验、seed、检索和只读列表能力。
- `weibo-actions-build` 生成建议时可引用知识卡，并把引用和适用性摘要写入行动记录。
- `weibo-bot-message` 可在回答中引用知识卡，同时区分真实舆情事实、团队偏好、知识卡和推断。
- C 级来源只能作为启发，不能作为唯一依据或硬规则。

**Non-Goals:**

- 不复制书籍、文章、案例的长篇受版权保护内容，只保存脱敏摘要、结构化原则、短标题和 URL。
- 不引入向量数据库、embedding 服务或新的付费 API。
- 不调用真实 MediaCrawler、微博登录、CrewAI 或 DeepSeek。
- 不实现待审知识卡草案；这属于后续 `haidao-rule-proposal-self-evolution`。
- 不新增 public HTTP API 或前端完整知识库页面；只读 API/UI 另开 follow-up。

## Decisions

### 1. MySQL 结构化卡片优先

首版新增 `knowledge_sources` 与 `knowledge_cards`。`knowledge_sources` 记录来源标题、类型、可信度、URL、publisher、发布时间和 notes；`knowledge_cards` 记录结构化营销原则或案例摘要，包含：

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
- `raw_json`

替代方案是把知识写入静态 JSON 或 prompt。拒绝原因：无法审计、无法按来源可信度治理，也难以让 Judge 检查适用条件。

### 2. 幂等 seed 使用稳定 identity

知识来源和知识卡都使用 project-independent 稳定 identity，例如：

- `source_identity = shortyawards:barbie-2024`
- `card_identity = case:barbie:earned-media-lifestyle-symbol`

Seed 通过 `INSERT ... ON DUPLICATE KEY UPDATE` 幂等写入，避免重复运行 migration 或 worker seed 产生重复卡片。

### 3. Text retrieval MVP，不做向量检索

检索首版使用 MySQL 文本字段和 JSON tags 做轻量打分：

- 场景关键词命中：`framework_or_case`、`applicable_scenario`、`tags`
- 事件/行动上下文命中：risk、topics、action_type、platform
- 可信度排序：A > B > C
- 状态过滤：只检索 `active` 卡片

替代方案是 embedding + vector DB。拒绝原因：首版验证目标是“结构化、可引用、可审计”，向量能力可以后续叠加，不应成为本地验收硬依赖。

### 4. 行动建议引用知识卡，但不让知识卡替代证据

`weibo-actions-build` 读取真实事件、评论、行动账本和偏好 memory 后，按上下文检索知识卡。生成 action 时：

- `evidence_ids` 仍必须来自真实评论、事件、行动或 memory。
- 知识卡 ID 写入 `raw_json.knowledge_card_ids`。
- 适用性摘要写入 `raw_json.knowledge_fit`。
- 禁用条件命中时，不应采用该卡片驱动的建议。
- C 级来源不得成为唯一引用；若只命中 C 级来源，应只作为启发或不引用。

### 5. Q&A 引用知识卡时必须分层表达

`weibo-bot-message` 可把知识卡作为“知识参考”引用，但回答中必须区分：

- 事实：真实微博证据与 DB 记录。
- 团队偏好：用户反馈 memory。
- 知识参考：knowledge card。
- 推断/建议：Agent 根据以上材料给出的解释。

知识卡不得被写成“当前微博真实发生的事实”。

### 6. Judge 首版通过规则化适用性 validator 落地

本 change 不实现完整 LLM Judge retry，但必须提供 worker 级规则化适用性 validator，作为后续 Judge Agent 的可执行前置检查。凡是 action 或 Q&A 要引用知识卡，validator 必须检查：

- 推荐引用的卡片必须存在且 active。
- 当前上下文必须能匹配该卡片 `applicable_scenario` 或 tags。
- 建议上下文不能命中该卡片 `do_not_apply_when`。
- 引用结果必须带 `judge_questions`，供后续 Judge review 展示或复核。
- C 级来源不能作为硬规则。
- action `evidence_ids` 不能为空或必须说明证据不足。

## Risks / Trade-offs

- [Risk] MySQL LIKE 检索召回粗糙，可能漏掉相关知识卡。
  Mitigation: 首版 seed 数量小，使用 tags/action_type/risk/topics 提高可控性，后续再加 embedding。

- [Risk] 营销案例被套错场景。
  Mitigation: 知识卡必须包含 `applicable_scenario`、`do_not_apply_when` 和 `judge_questions`，行动生成必须记录适用性摘要。

- [Risk] C 级来源误导决策。
  Mitigation: C 级来源只能作为启发，测试必须覆盖 C 级来源不作为唯一硬规则。

- [Risk] 知识卡内容带来版权风险。
  Mitigation: 只存短摘要、结构化原则和 URL，不复制长篇正文，不抓取付费内容。

- [Risk] 与后续 CrewAI Knowledge 设计重复。
  Mitigation: 当前 MySQL schema 作为权威知识账本，后续 CrewAI adapter 只能读取或提出 proposal，不能绕过 Harness 写库。

## Migration Plan

1. 新增 MySQL-safe migration `007_knowledge_card_rag.sql`。
2. 添加 worker seed 命令，将首批脱敏知识来源和卡片幂等写入。
3. 添加 worker 检索命令和内部 helper。
4. 扩展 `weibo-actions-build` 写入知识卡引用。
5. 扩展 `weibo-bot-message` 引用知识卡并保持事实/偏好/知识/建议分层。
6. 通过真实 MySQL persistence tests 验证 migration、seed、检索和引用。

Rollback 策略：删除或忽略新 migration 生成的知识表不会影响既有微博采集、分析、事件、行动和反馈表；行动中的 `raw_json.knowledge_card_ids` 是附加字段，旧逻辑可忽略。

## Open Questions

- 首批 seed 数量控制在 5 到 10 张，还是先以 3 张最小卡片跑通链路？
- 只读 `GET /api/knowledge/cards` 是否需要作为后续 follow-up change 排队？
