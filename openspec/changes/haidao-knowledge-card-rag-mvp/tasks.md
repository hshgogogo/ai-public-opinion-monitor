## 1. OpenSpec 与范围锁定

- [x] 1.1 创建 `haidao-knowledge-card-rag-mvp` proposal、design、tasks 和 specs。
- [x] 1.2 明确首版只做 MySQL text retrieval MVP，不引入向量库、CrewAI runtime、FastAPI 或新的付费 API。
- [x] 1.3 明确知识卡只能作为知识参考，不能替代真实微博证据、用户反馈或行动账本事实。
- [x] 1.4 明确 C 级来源只能作为弱启发，不能作为硬规则或唯一依据。
- [x] 1.5 运行 `openspec validate haidao-knowledge-card-rag-mvp --strict`。

## 2. Schema 与 Migration

- [x] 2.1 先写 migration/schema static tests，断言 `knowledge_sources`、`knowledge_cards`、identity 唯一键、citation URL 和核心字段存在。
- [x] 2.2 新增 MySQL-safe migration 创建 `knowledge_sources`。
- [x] 2.3 新增 MySQL-safe migration 创建 `knowledge_cards`。
- [x] 2.4 为 knowledge source/card 添加 project-independent 稳定 identity 与唯一键。
- [x] 2.5 知识卡字段覆盖 source、framework_or_case、applicable_scenario、do_not_apply_when、recommended_actions、risk_warnings、evidence_required、judge_questions、tags、status、raw_json。
- [x] 2.6 先写真实 MySQL migration 幂等测试，再确认 migration 连续运行两遍不报重复表、重复列或重复索引。

## 3. 知识卡 Seed 与校验

- [x] 3.1 先写 seed 内容测试，断言首批卡片为短摘要、结构化字段和 citation URL，不含长篇版权正文。
- [x] 3.2 新增首批 3 到 5 张脱敏/摘要式知识卡 seed，覆盖影视宣发、微博传播、危机应对或通用营销理论。
- [x] 3.3 先写知识卡校验测试，覆盖缺少来源 URL、适用条件、禁用条件、证据要求或 Judge questions 的无效卡片。
- [x] 3.4 实现知识卡校验，缺少必填字段时拒绝或标记 inactive。
- [x] 3.5 先写重复 seed 测试，断言重复 seed 不创建重复 source/card。
- [x] 3.6 新增 worker seed 命令，使用 `INSERT ... ON DUPLICATE KEY UPDATE` 幂等写入 knowledge sources/cards。

## 4. Knowledge Retrieval 与 Validator

- [x] 4.1 先写检索排序测试，覆盖 project/platform/topics/risks/action_type/query 命中 active 知识卡。
- [x] 4.2 新增 worker 检索命令或 helper，按 project/platform/topics/risks/action_type/query 检索 active 知识卡。
- [x] 4.3 检索结果包含 card id、source id、reliability level、匹配原因、适用条件、禁用条件和 tags。
- [x] 4.4 先写禁用条件测试，覆盖命中 `do_not_apply_when` 时排除或标记 `blocked_by_do_not_apply`。
- [x] 4.5 实现禁用条件过滤或 blocked 标记。
- [x] 4.6 先写 C 级来源测试，断言 C 级来源排序低于 A/B，且不能作为硬规则结果。
- [x] 4.7 实现 C 级来源弱启发标记。
- [x] 4.8 先写 Judge/validator 测试，覆盖 applicable_scenario、do_not_apply_when、judge_questions 和 C 级边界。
- [x] 4.9 实现 worker 级知识卡适用性 validator，供 Strategy/Q&A/Judge 复用。

## 5. Strategy Agent 行动建议引用

- [x] 5.1 先写 action build citation 测试，断言建议引用 knowledge_card_id 且保留真实 Weibo evidence IDs。
- [x] 5.2 `weibo-actions-build` 读取知识卡检索和 validator 结果。
- [x] 5.3 生成 `agent_recommended` action 时在 `raw_json.knowledge_card_ids` 保存知识卡 ID。
- [x] 5.4 action reason 或 `raw_json.knowledge_fit` 保存适用性摘要。
- [x] 5.5 先写 blocked card 测试，断言禁用条件命中的知识卡不能成为支持引用。
- [x] 5.6 实现 blocked card 不写入 action supporting citations。
- [x] 5.7 先写 C 级来源 action 测试，断言只有 C 级来源命中时不得把它写成硬规则或主要依据。
- [x] 5.8 实现 C 级来源 action 弱启发文案和真实 evidence IDs 保护。

## 6. Q&A 知识引用

- [x] 6.1 先写 Q&A citation 测试，断言回答引用 knowledge_card_id 且将其标记为知识参考。
- [x] 6.2 `weibo-bot-message` 可检索并引用知识卡。
- [x] 6.3 Q&A 回答区分事实、团队偏好、知识参考、推断和建议。
- [x] 6.4 先写证据不足测试，断言知识卡不能伪造当前微博事实。
- [x] 6.5 实现证据不足时仍回答真实微博证据不足。
- [x] 6.6 先写 C 级来源 Q&A 测试，断言 C 级来源只能标记为弱启发。
- [x] 6.7 实现 C 级来源 Q&A 弱启发表达。

## 7. Worker-only 范围与工作台准备

- [x] 7.1 保持本 change worker-only，不新增 public `GET /api/knowledge/cards`。
- [x] 7.2 如工作台 payload 后续包含知识引用，只显示 card id、标题、可信度、适用/禁用摘要和 citation URL。
- [x] 7.3 确认所有 worker/API 输出不暴露 `.env`、Cookie、token、浏览器登录态或内部采集日志。

## 8. 验证

- [x] 8.1 运行定向测试。
- [x] 8.2 运行 `npm test`。
- [x] 8.3 运行真实 MySQL persistence tests。
- [x] 8.4 运行 `openspec validate haidao-knowledge-card-rag-mvp --strict`。
- [x] 8.5 运行 `git diff --check`。
- [x] 8.6 运行 `npm run agent:guard`。
