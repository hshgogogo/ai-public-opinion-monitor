## Why

当前策略建议和问答主要依赖已采集证据、行动账本和偏好记忆，营销知识还容易散落在代码、prompt 或人工经验里。为了让 Strategy Agent 的建议可解释、可复核，并让 Judge 能判断“是否套错案例”，需要建立首版结构化营销知识卡与检索引用能力。

## What Changes

- 新增结构化知识来源与知识卡能力，覆盖来源可信度、适用条件、禁用条件、建议动作、风险提醒、证据要求和 Judge 检查问题。
- 新增首批脱敏/摘要式影视宣发、微博传播、危机公关和通用营销知识卡 seed；不得复制受版权保护的长篇内容。
- 新增 MySQL text retrieval MVP，让 Strategy/Q&A 可以按项目场景、事件、议题和动作类型检索知识卡。
- 让 `weibo-actions-build` 在生成 `agent_recommended` 建议时引用适用知识卡 ID，并将引用写入 `publicity_actions.raw_json` 或等价结构字段。
- 让 `weibo-bot-message` 可以引用知识卡，但必须把知识卡与真实舆情事实、用户偏好和推断分开。
- 为 C 级来源设置边界：可作为启发，不得作为硬规则或唯一依据。

## Capabilities

### New Capabilities

- `knowledge-card-rag`: 结构化营销知识来源、知识卡、检索、引用和 Judge 适用性边界。

### Modified Capabilities

- `weibo-public-opinion-agent`: Weibo 证据问答和 Agent 建议可以检索知识卡，但不得把知识卡当成真实舆情事实。
- `weibo-publicity-action-ledger`: Agent 建议需要保存知识卡引用、适用性说明和禁用条件检查摘要。

## Impact

- 数据库：新增 MySQL-safe migration，创建 `knowledge_sources`、`knowledge_cards`，必要时为行动/记忆引用补充 JSON 结构约定。
- Worker：扩展 Python worker 的知识卡 seed、检索、校验，以及 `weibo-actions-build` / `weibo-bot-message` 的知识引用。
- API：本 change 首版保持 worker-only；只读 `GET /api/knowledge/cards` 另开 follow-up，避免在知识 schema、检索和引用尚未稳定时扩大 public API surface。
- 测试：migration/schema 测试、知识卡格式测试、检索排序测试、行动建议引用测试、Q&A 引用测试、C 级来源不作硬规则测试。
- 安全：不读取或提交 `.env`、Cookie、token、浏览器登录态；不调用真实 MediaCrawler、微博登录、CrewAI 或新的付费 API。
