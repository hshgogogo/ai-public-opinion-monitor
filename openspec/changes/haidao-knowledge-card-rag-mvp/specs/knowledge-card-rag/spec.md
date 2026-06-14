## ADDED Requirements

### Requirement: 结构化知识来源
系统 SHALL 将营销知识来源保存为可审计记录，并标明来源类型、可信度和引用 URL。

#### Scenario: 创建知识来源
- **WHEN** 系统导入或 seed 一个营销知识来源
- **THEN** 系统 MUST 写入 `knowledge_sources`
- **AND** active 来源记录 MUST 包含稳定 identity、标题、source type、reliability level 和 citation URL

#### Scenario: 来源可信度分级
- **WHEN** 知识来源被保存
- **THEN** 系统 MUST 将可信度标记为 A、B 或 C
- **AND** C 级来源 MUST NOT 被后续 Agent 当成硬规则或唯一依据

### Requirement: 结构化知识卡
系统 SHALL 将营销理论、案例和宣发经验保存为结构化知识卡，而不是写死在代码或 prompt 中。

#### Scenario: 保存有效知识卡
- **WHEN** 系统导入或 seed 一个知识卡
- **THEN** 系统 MUST 写入 `knowledge_cards`
- **AND** 知识卡 MUST 包含 source、framework_or_case、applicable_scenario、do_not_apply_when、recommended_actions、risk_warnings、evidence_required、judge_questions、tags 和 status

#### Scenario: 拒绝不完整知识卡
- **WHEN** 知识卡缺少来源、适用条件、禁用条件、证据要求或 Judge questions
- **THEN** 系统 MUST 拒绝该知识卡或将其标记为 inactive
- **AND** 系统 MUST NOT 让它参与 Strategy Agent 建议

#### Scenario: 幂等导入
- **WHEN** 同一知识来源或知识卡被重复 seed
- **THEN** 系统 MUST 使用稳定 identity 更新已有记录
- **AND** 系统 MUST NOT 创建重复知识来源或重复知识卡

### Requirement: 知识卡检索
系统 SHALL 支持基于微博事件、议题、风险、行动类型和项目上下文检索 active 知识卡。

#### Scenario: 检索适用知识卡
- **WHEN** Strategy Agent 或 Q&A 提供项目、平台、议题、风险或行动上下文
- **THEN** 系统 MUST 返回匹配的 active 知识卡
- **AND** 返回结果 MUST 包含 knowledge card id、source id、reliability level、匹配原因、适用条件和禁用条件

#### Scenario: 禁用条件命中
- **WHEN** 当前上下文命中某知识卡的 `do_not_apply_when`
- **THEN** 系统 MUST 将该知识卡排除或标记为 `blocked_by_do_not_apply`
- **AND** Strategy Agent MUST NOT 使用该知识卡作为建议依据

#### Scenario: 无适用知识卡
- **WHEN** 没有 active 知识卡适合当前上下文
- **THEN** 系统 MUST 返回空列表或 no-match 结果
- **AND** 系统 MUST NOT 编造知识卡引用

### Requirement: 知识卡适用性复核
系统 SHALL 提供规则化知识卡适用性 validator，让 Judge 或 Harness 能检查引用是否满足适用条件、禁用条件和可信度边界。

#### Scenario: Validator 通过适用知识卡
- **WHEN** action 或 Q&A 准备引用 active 知识卡
- **THEN** validator MUST 检查该卡片存在、active、当前上下文匹配 `applicable_scenario` 或 tags
- **AND** validator MUST 返回该卡片的 `judge_questions` 供 Judge review 或 Harness 记录

#### Scenario: Validator 拒绝禁用知识卡
- **WHEN** 当前上下文命中知识卡的 `do_not_apply_when`
- **THEN** validator MUST 返回拒绝结果
- **AND** action 或 Q&A MUST NOT 将该知识卡作为支持引用

#### Scenario: Validator 限制 C 级来源
- **WHEN** 引用集合只包含 C 级来源
- **THEN** validator MUST 标记该引用为 weak_inspiration
- **AND** 系统 MUST NOT 将它作为硬规则或唯一行动依据

### Requirement: 知识卡安全边界
系统 SHALL 只保存摘要式、结构化、可引用的营销知识，不保存敏感凭据或受版权保护的长篇正文。

#### Scenario: 不保存长篇版权内容
- **WHEN** seed 或导入知识卡
- **THEN** 系统 MUST 保存短摘要、结构化字段和 citation URL
- **AND** 系统 MUST NOT 保存书籍、文章、报告或案例的长篇原文

#### Scenario: 不读取真实凭据
- **WHEN** 知识卡 seed、检索或引用执行
- **THEN** 系统 MUST NOT 读取、打印或提交 `.env`、Cookie、token、浏览器登录态或 `config/cookies/weibo.json`
