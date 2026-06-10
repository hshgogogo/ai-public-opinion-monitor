# PRD：《海岛舒服日志》宣发舆情 Agent

副标题：基于真实采集、事件记忆、宣发行动账本和回测闭环的单剧舆情作战系统

## 1. 产品定位

本产品不是通用舆情监测看板，也不是简单的“MediaCrawler 接入工程”。本产品是服务《海岛舒服日志》上线前后宣发期的舆情作战 Agent。

Agent 的目标不是帮用户看更多数据，而是帮制片人、宣发团队和策略人员持续判断：

- 哪件舆情正在变重要。
- 为什么重要。
- 这件事对剧集、演员、粉丝盘、路人盘和物料节奏有什么影响。
- 现在应该观察、澄清、转移议题、释放物料，还是放大正向讨论。
- 现实中采取了什么宣发动作。
- 动作之后，相关舆情有没有改善。

一句话产品锚点：

```text
这个 Agent 不是展示舆情数据，而是维护一份《海岛舒服日志》宣发期的连续舆情事实、行动和效果档案。
```

## 2. 当前 MVP 范围

当前 MVP 只服务一个真实宣发项目，不做任意剧集、任意艺人、任意行业的通用监控。

| 类型 | 固定对象 |
| --- | --- |
| 剧名 | 《海岛舒服日志》 |
| 监控艺人 | 刘昊然、李兰迪 |
| 监控平台 | 小红书、抖音、微博 |
| 业务阶段 | 上线前后宣发监控、风险识别、市场反馈判断、营销动作建议、效果复盘 |
| 数据模式 | `real-data-only` |
| 主服务端口 | `0.0.0.0:8787` |

系统默认词包：

| 词包 | 首版关键词 |
| --- | --- |
| 剧集词包 | 海岛舒服日志、海岛舒服日志 官宣、海岛舒服日志 定档、海岛舒服日志 预告、海岛舒服日志 路透、海岛舒服日志 粤语、海岛舒服日志 妆造、海岛舒服日志 剧情 |
| 刘昊然词包 | 刘昊然、刘昊然 海岛舒服日志、刘昊然 新剧、刘昊然 演技、刘昊然 粤语、刘昊然 路透 |
| 李兰迪词包 | 李兰迪、李兰迪 海岛舒服日志、李兰迪 新剧、李兰迪 演技、李兰迪 粤语、李兰迪 路透 |

词包可以由运营人员增删，但首版词包必须围绕《海岛舒服日志》、刘昊然、李兰迪展开。若用户输入与当前 MVP 无关的关键词，系统应提示“不属于当前 MVP 监控对象”，不得退回通用舆情平台形态。

## 3. Agent 与传统舆情系统的区别

传统舆情系统回答：

```text
现在有多少声量？
正负面比例是多少？
哪个平台数据最多？
```

本系统的 Agent 回答：

```text
发生了什么？
为什么这件事影响宣发？
这个变化是自然讨论、官方动作、矩阵投放，还是粉丝争议造成的？
现在应该做什么？
做完以后是否真的变好？
哪些经验应该记住，下次遇到类似事件时复用？
```

核心差异：

| 维度 | 传统舆情监测 | 宣发舆情 Agent |
| --- | --- | --- |
| 产品中心 | 看板和指标 | 事件、判断、行动和复盘 |
| 用户操作 | 搜索、筛选、查看 | 确认、追问、决策、反馈 |
| 数据价值 | 展示当前状态 | 支撑长期判断 |
| AI 角色 | 分析模块 | 具有证据约束的作战助理 |
| 长期能力 | 历史报表 | 记住事件、动作、结果和偏好 |
| 风险控制 | 展示告警 | 主动说明证据不足和归因限制 |

## 4. Agent 工作循环

Agent 的基本工作循环为：

```text
┌──────────┐
│ 真实感知 │  采集帖子、评论、热度、账号动作、平台变化
└────┬─────┘
     ▼
┌──────────┐
│ 事件理解 │  归并议题、识别事件、判断升温/降温
└────┬─────┘
     ▼
┌──────────┐
│ 行动建议 │  给出平台化宣发、公关、物料、观察建议
└────┬─────┘
     ▼
┌──────────┐
│ 人类确认 │  用户采纳、拒绝、修改或记录现实动作
└────┬─────┘
     ▼
┌──────────┐
│ 回测复盘 │  比较动作前后指标，评估可能效果和干扰因素
└────┬─────┘
     ▼
┌──────────┐
│ 长期记忆 │  写入事实、事件、动作、结果和经验
└──────────┘
```

Agent 必须区分：

| 类型 | 含义 | 例子 | 复盘置信度 |
| --- | --- | --- | --- |
| `agent_recommended` | Agent 建议过的动作 | 建议小红书发布海岛生活感剧照 | 中 |
| `user_confirmed` | 用户明确告知的现实动作 | 用户说“我们实际发了双人剧照” | 高 |
| `official_observed` | Agent 观察到官方账号动作 | 官方微博 20:03 发了海报 | 中高 |
| `matrix_inferred` | Agent 推断的矩阵扩散 | 12 个营销号 30 分钟内发相似文案 | 中低 |
| `unknown_world_action` | 观察到变化但无法确认动作来源 | 负向下降但未发现明确宣发动作 | 低 |

Agent 不能假设“建议等于执行”。现实中用户可能采用完全不同的解决方式，因此所有回测都必须基于实际动作，而不是基于 Agent 建议本身。

## 5. Agent 权限分级

MVP 定义为 `L1.5` 建议型半自动 Agent。

| 等级 | 能力 | 当前范围 |
| --- | --- | --- |
| L0 只读观察 | 只汇总数据，不主动建议 | 不采用 |
| L1 建议型 Agent | 主动提出采集、事件和策略建议，但需要用户确认 | 必须支持 |
| L1.5 半自动 Agent | 低风险发现、日报、观察线索自动执行；高风险动作要求确认 | MVP 目标 |
| L2 运营 Agent | 可自动触发更多补采和部分工作流 | 后续版本 |
| L3 自动宣发 Agent | 自动发布或调度外部宣发动作 | 不在范围内 |

MVP 中 Agent 可以自动执行：

- 定时发现候选内容。
- 识别观察线索。
- 生成事件草案。
- 生成日报和周报。
- 对低风险数据缺口提出补采建议。
- 记录用户明确反馈。

MVP 中 Agent 必须请求确认：

- 精确采集某个高热候选的评论。
- 采集二级评论。
- 将观察线索升级为正式高风险事件。
- 将 Agent 建议标记为已执行。
- 认定疑似矩阵投放为已知合作动作。
- 关闭或解决某个事件。

## 6. 证据规则与反幻觉约束

Agent 可以不知道，但不能假装知道。

硬性规则：

- 没有候选、评论、事件、报告、账号动作或用户反馈 ID，不得输出事实判断。
- 没有真实评论，不得说“用户认为”。
- 没有连续时间窗口数据，不得说“升温”或“降温”。
- 没有已确认或已观察到的实际动作，不得说“某建议有效”。
- 没有动作前后对照，不得做效果复盘。
- 没有足够证据时，只能输出“观察线索”，不能升级为正式事件。
- Agent 回答必须区分“事实”“推断”“建议”“置信度”“引用来源”。
- 日报、周报、月报可以作为索引，但不能替代原始证据。

回答格式要求：

```text
事实：
- 基于 target/comment/event/action/report ID 的可追溯信息。

推断：
- Agent 对事实的解释，必须标明置信度。

建议：
- 可执行动作、适用平台、负责人建议、复查时间。

引用：
- event_id / target_id / comment_id / action_id / report_id。
```

证据门槛：

| 对象 | 最低证据要求 |
| --- | --- |
| 观察线索 | 1 条候选内容、1 条高热评论或 1 次账号动作 |
| 正式事件 | 1 个候选内容证据，或 3 条真实评论证据，或 1 条高热负向评论证据 |
| 升温判断 | 至少 2 个采集周期，且相关声量、负向压力或风险标签上升 |
| 降温判断 | 至少 2 个采集周期，且相关风险指标下降 |
| 动作回测 | 明确动作时间点，且有动作前后观察窗口 |
| 强效果信号 | 指标改善明显，且无明显竞争干扰 |

## 7. 数据来源与感知系统

数据爬取和情感分析不是 Agent 的替代品，而是 Agent 的感官系统。没有真实采集，Agent 不能做舆情判断；没有议题分析，Agent 不能解释评论含义；没有行动账本，Agent 不能做效果回测。

感知层包括：

| 数据类型 | 来源 | 用途 |
| --- | --- | --- |
| 候选内容 | MediaCrawler search | 发现高热帖子、视频、微博词条、博文 |
| 评论 | MediaCrawler detail | 识别真实讨论、立场、风险和证据句 |
| 账号动作 | 官方号、演员号、营销号、矩阵号监控 | 判断现实宣发动作 |
| 用户反馈 | 系统内确认、拒绝、修改、备注 | 记录真实决策 |
| 日报/周报 | 系统生成 | 历史索引和复盘入口 |
| 事件状态 | 事件 Agent 更新 | 跟踪舆情生命周期 |
| 策略动作 | Agent 建议和用户执行反馈 | 回测效果 |

Agent 依据分层：

```text
第一层：原始事实
帖子、评论、账号动作、时间、互动量、链接、原始 JSON。

第二层：机器标注
情绪、议题、立场、风险标签、证据句、置信度。

第三层：事件归并
同类评论和候选归并为事件，形成时间线和状态。

第四层：业务判断
对剧集上线、路人转化、粉丝盘、物料节奏、公关动作的影响。

第五层：行动结果
用户或现实世界采取了什么动作，后续指标是否变化。
```

## 8. 账号与传播源监控

真实宣发场景中，声量不只来自自然用户。官方号、演员号、出品方、营销号、媒体号、粉丝账号和矩阵号都可能参与传播。Agent 必须识别传播源类型，避免把矩阵制造的声量误判为路人真实转化。

传播源类型：

| 类型 | 说明 |
| --- | --- |
| `official_account` | 剧集官号、出品方账号、平台方账号 |
| `creator_account` | 导演、编剧、主创账号 |
| `artist_account` | 刘昊然、李兰迪及其工作室账号 |
| `partner_matrix` | 已知合作营销号或矩阵号 |
| `suspected_matrix` | 疑似协同发布账号 |
| `media_account` | 媒体、娱乐资讯账号 |
| `fan_account` | 粉丝站、超话账号、粉丝 KOL |
| `organic_user` | 普通自然用户 |
| `unknown` | 暂无法判断 |

首版账号池：

- 用户可录入官方号、演员号、出品方号、已知营销号。
- Agent 通过关键词发现新账号。
- Agent 对新账号进行传播源初判。
- 用户可确认或修正账号类型。

矩阵识别规则：

```text
疑似协同发布 = 相近发布时间 + 相似文案 + 相同物料/话题 + 多账号集中出现
```

首版可使用文本指纹，不做复杂图片和视频识别：

```text
content_fingerprint =
剧名 + 演员名 + 核心物料词 + 话题标签 + 文案关键词 + 发布时间窗口
```

后续增强：

- 图片 hash。
- 视频封面 hash。
- OCR 物料文字。
- 账号关系图。
- 发布节奏聚类。

Agent 每日应生成“疑似宣发动作确认列表”：

```text
我观察到以下疑似宣发动作：

1. 官方微博发布《海岛舒服日志》双人剧照
   可能关联事件：官宣可信度 / CP 搭配讨论
   请确认：这是本轮宣发动作吗？

2. 12 个营销号在 1 小时内发布相似“海岛治愈感”文案
   可能关联事件：路人兴趣转化
   请确认：是否为合作矩阵投放？

3. 小红书出现 8 篇取景地/穿搭方向笔记
   可能关联事件：小红书生活方式种草
   请确认：是否为官方或合作内容？
```

用户操作：

- 是。
- 不是。
- 不确定。
- 部分相关。
- 标记账号类型。
- 关联到已有事件。
- 新建宣发动作。

## 9. 宣发行动账本

宣发行动账本是 Agent 做长期回测的核心。它记录 Agent 建议、人类决策、现实动作和后续效果，防止 Agent 把自己的建议误认为现实发生的动作。

行动生命周期：

```text
planned -> observed -> confirmed -> executed -> backtested -> learned
          rejected   -> archived
          unknown    -> needs_confirmation
```

行动字段：

| 字段 | 说明 |
| --- | --- |
| `action_id` | 行动 ID |
| `project_id` | 固定关联《海岛舒服日志》 |
| `related_event_id` | 关联事件，可空 |
| `action_source` | `agent_recommended` / `user_confirmed` / `official_observed` / `matrix_inferred` / `manual_log` |
| `action_type` | `observe` / `clarify` / `shift_topic` / `amplify_positive` / `release_material` / `pause_campaign` / `matrix_distribution` / `official_post` |
| `platform` | `xiaohongshu` / `douyin` / `weibo` / `all` |
| `account_id` | 账号 ID，可空 |
| `account_name` | 账号名称，可空 |
| `source_type` | 传播源类型 |
| `content_url` | 现实发布内容链接 |
| `content_summary` | 文案或物料摘要 |
| `recommended_by_agent` | 是否为 Agent 建议 |
| `user_confirmation_status` | `pending` / `confirmed` / `rejected` / `uncertain` / `partial` |
| `confidence` | 0 到 1 |
| `expected_metric_change` | 预期改善指标 |
| `check_after_hours` | 复查时间 |
| `backtest_result` | 回测结果 |
| `created_at` | 创建时间 |
| `observed_at` | 观察到的发布时间 |
| `confirmed_at` | 用户确认时间 |

Agent 建议动作格式：

```json
{
  "action_type": "release_material",
  "platform": "xiaohongshu",
  "action": "发布一组海岛生活感双人剧照，文案避开争议词，强调角色关系和治愈氛围",
  "reason": "负向主要来自官宣不确定和角色适配疑虑，小红书用户对视觉氛围和生活方式反馈更敏感",
  "expected_metric_change": ["官宣可信度风险下降", "期待/想看立场上升"],
  "evidence_ids": ["event_1024", "target_8831", "comment_8842"],
  "priority": "medium",
  "owner_suggestion": "内容运营",
  "check_after_hours": 24
}
```

## 10. 回测与归因

Agent 不能轻易说“某动作导致了某结果”。回测应表述为：

```text
动作发生后，相关指标是否出现改善？
这种改善与该动作有关的置信度是多少？
是否存在其他干扰因素？
```

回测窗口：

| 窗口 | 用途 |
| --- | --- |
| 动作前 24 小时 | 建立基线 |
| 动作后 6 小时 | 快速扩散观察 |
| 动作后 24 小时 | 短期效果 |
| 动作后 48 小时 | 稳定变化 |
| 动作后 72 小时 | 是否持续 |

回测指标：

- 相关事件声量变化。
- 加权负向率变化。
- 相关风险标签变化。
- 主要立场变化，例如期待、质疑、担忧、求证、玩梗。
- 高热评论方向变化。
- 平台分布变化。
- 传播源变化：官方/矩阵/自然用户分开统计。
- 数据覆盖变化。

回测结果分级：

| 级别 | 含义 |
| --- | --- |
| `strong_signal` | 动作后目标指标明显改善，且无明显竞争干扰 |
| `medium_signal` | 指标改善，但同时存在其他宣发动作或平台事件 |
| `weak_signal` | 指标有变化，但样本少、数据缺口大或干扰明显 |
| `no_signal` | 无明显变化 |
| `negative_signal` | 动作后风险反而升高 |
| `unknown` | 数据不足，无法判断 |

回测输出必须包含：

- 动作事实。
- 对比窗口。
- 指标变化。
- 干扰因素。
- 归因置信度。
- 下一步建议。
- 引用 action/event/target/comment/report ID。

## 11. 多 Agent 内部分工

前端只展示一个统一的“宣发舆情 Agent”，内部可以由多个 worker/Agent 协作。

| Agent/worker | 职责 | 输出 |
| --- | --- | --- |
| 采集 Agent | 调用 MediaCrawler 做 search/detail 真实采集 | JSONL、采集任务状态 |
| Adapter Agent | 解析 JSONL、标准化、去重入库 | 候选、帖子、评论 |
| 观察 Agent | 发现新候选、异常变化、数据缺口、疑似宣发动作 | 观察线索、确认请求 |
| 议题分析 Agent | 分析评论议题、立场、情绪、风险和证据 | `sentiment_results` |
| 事件 Agent | 将零散评论和候选归并为事件 | 事件、时间线、状态 |
| 策略 Agent | 基于事件和证据生成建议 | 宣发动作建议 |
| 行动 Agent | 维护行动账本，跟踪官方号和矩阵号动作 | `publicity_actions` |
| 回测 Agent | 比较动作前后指标，评估效果信号 | 回测报告 |
| 记忆 Agent | 写入事实、事件、决策、动作、效果和用户偏好 | 长期记忆 |
| 简报 Agent | 生成每日/每周 Markdown 简报 | 报告文件 |
| 问答 Agent | 检索长期记忆和证据回答追问 | 对话消息 |

并行约束：

- 采集新数据时，可以同时分析上一批已入库评论。
- DeepSeek 分析失败不能阻塞后续采集。
- 同一事件状态更新必须串行。
- 同一行动回测必须以确认后的动作时间为准。
- Agent 输出必须写入数据库或报告文件，不允许只存在内存。
- 每次 Agent 执行必须写 `agent_runs`。

## 12. 热度发现与精确评论采集

系统采集分为四个阶段：

```text
热度发现 -> Agent 推荐候选 -> 人工确认/自动低风险补采 -> 精确评论采集
```

### 12.1 热度发现

系统为固定项目、平台和关键词创建发现任务。

```text
项目：《海岛舒服日志》
关键词：海岛舒服日志、刘昊然、李兰迪、官宣、粤语
平台：小红书、抖音、微博
任务：每个平台每个关键词检索热度前 10 候选
```

候选类型：

- 小红书：笔记标题、正文摘要、作者、点赞/收藏/评论数、链接。
- 抖音：视频标题/描述、作者、点赞/评论/分享数、链接。
- 微博：微博词条、热门博文、作者、转评赞、链接。

热度分首版使用平台互动字段加权：

```text
hot_score = like_count + comment_count * 3 + share_count * 4 + collect_count * 2
```

平台缺少某个互动字段时，缺失字段按 0 处理。每个平台每个关键词默认保留平台原生前 10 条；用户可以在前端按 `hot_score` 二次排序。

### 12.2 Agent 推荐候选

传统流程是“用户自己从候选里选”。Agent 流程应改为“Agent 提出采集建议，用户确认”。

Agent 对每个候选输出：

- 是否建议采评论。
- 推荐原因。
- 可能关联事件。
- 预计能回答的问题。
- 采集成本和风险。
- 是否需要二级评论。
- 建议观察窗口。

候选推荐状态：

| 状态 | 含义 |
| --- | --- |
| `pending` | 待判断 |
| `agent_recommended` | Agent 建议采集 |
| `selected` | 用户确认采集 |
| `ignored` | 用户忽略 |
| `auto_recollect` | 风险规则自动补采 |
| `needs_review` | Agent 无法判断，需要用户确认 |

### 12.3 精确评论采集

用户选择候选后，系统创建 detail 评论采集任务：

- 每个候选最多采集 100 条一级评论。
- 不足 100 条时全量采集。
- 默认不采二级评论。
- 风险触发后可补采 50 条二级评论。
- 同一候选重复采集时做 upsert，不重复插入。

### 12.4 风险自动补采

满足任一条件可触发风险补采建议：

- 负向率大于等于 25%。
- 单一风险标签评论数大于等于 10。
- 同一关键词连续两次采集负向率上升。
- 高热负向评论点赞数进入 Top 10。
- 出现关键词：非官宣不信、溜粉、辟谣、粤语、演技、扑、诈骗宣发、控评。
- 艺人事件状态从 `observing` 升级为 `escalating`。

自动补采必须写入任务日志和行动账本，标明触发原因。

## 13. 议题分析

首版采用“确定性算法 + Agent 理解”的混合方案。

- 确定性算法负责评论权重、热度分、聚合占比、趋势计算。
- DeepSeek Agent 负责理解评论表达的具体议题、立场、风险、证据和营销含义。
- Agent 不直接决定评论权重，避免模型输出不稳定导致同一批数据多次分析结果不一致。
- 聚合结论必须同时展示加权结果和原始评论数。

每条评论输出：

- `sentiment`：`positive` / `neutral` / `negative`
- `score`：-1 到 1
- `confidence`：0 到 1
- `topics`：话题标签数组
- `risks`：风险标签数组
- `stance`：期待、质疑、担忧、反感、建议、求证、玩梗等
- `issue_summary`：一句话概括评论在讨论什么
- `intensity`：1 到 5
- `weight`：确定性算法计算出的评论权重
- `evidence`：证据短句
- `model`：`deepseek-chat`

评论权重算法：

```text
base_weight = log10(like_count + 1) + 1
reply_bonus = min(reply_count, 20) * 0.03
author_bonus = 0.2 if author_is_verified else 0
recency_decay = max(0.6, 1 - hours_since_collected / 168 * 0.4)
comment_weight = round((base_weight + reply_bonus + author_bonus) * recency_decay, 4)
```

首版影视舆情标签：

- 官宣可信度
- 演员讨论
- CP/搭配
- 导演与主创
- 妆造与视觉
- 地域与语言
- 粉丝争议
- 路人转化
- 档期竞争
- 口碑风险
- 二创潜力
- 平台观看路径
- 官方物料反馈
- 矩阵扩散
- 自然讨论

## 14. 艺人舆情事件模型

事件是本产品最重要的分析对象。系统不能只展示“刘昊然负向 32%”“李兰迪正向 41%”，而要讲清楚：

- 事件是什么。
- 为什么发生。
- 从哪个平台开始扩散。
- 是否与官方、矩阵、粉丝或自然讨论有关。
- 哪些候选内容、评论和账号动作能证明它存在。
- 主要人群立场是什么。
- 当前是升温、观察、降温还是已解决。
- 对《海岛舒服日志》的上线、路人盘、粉丝盘、口碑和物料节奏有什么影响。
- 明天应该做什么动作。
- 过去采取过什么动作，是否有效。

事件类型：

| 事件类型 | 含义 |
| --- | --- |
| `actor_reputation` | 艺人口碑事件 |
| `casting_match` | 选角和搭配事件 |
| `official_announcement` | 官宣可信度事件 |
| `language_region` | 语言地域事件 |
| `visual_material` | 物料视觉事件 |
| `fan_conflict` | 粉丝争议事件 |
| `market_interest` | 市场兴趣事件 |
| `release_rhythm` | 宣发节奏事件 |
| `official_action_response` | 官方动作反馈事件 |
| `matrix_distribution` | 矩阵传播事件 |

事件字段：

| 字段 | 说明 |
| --- | --- |
| `event_id` | 系统事件 ID |
| `project_id` | 固定关联《海岛舒服日志》项目 |
| `event_title` | 一句话事件标题 |
| `event_type` | 事件类型 |
| `related_artists` | 刘昊然、李兰迪、both、none |
| `related_drama` | 固定为《海岛舒服日志》 |
| `trigger_summary` | 事件触发原因 |
| `current_status` | `new` / `observing` / `escalating` / `cooling` / `resolved` |
| `risk_level` | `low` / `medium` / `high` / `critical` |
| `first_seen_at` | 首次发现时间 |
| `last_seen_at` | 最近一次证据更新时间 |
| `timeline_json` | 时间线 |
| `platform_distribution_json` | 三平台分布 |
| `source_distribution_json` | 官方、矩阵、媒体、粉丝、自然用户分布 |
| `stance_distribution_json` | 加权立场分布和原始评论数 |
| `key_evidence_json` | 候选 ID、评论 ID、账号动作 ID、证据句 |
| `impact_assessment` | 对剧集宣发影响评估 |
| `recommended_actions_json` | 应对或营销动作 |
| `linked_action_ids` | 关联宣发行动 |
| `backtest_summary` | 相关动作回测摘要 |
| `next_check_at` | 下次观察时间 |

状态流转：

| 状态 | 进入条件 | 退出条件 |
| --- | --- | --- |
| `new` | 第一次达到正式事件证据门槛 | 完成首次影响评估后转入 `observing` 或 `escalating` |
| `observing` | 有讨论但未持续升温 | 风险上升转 `escalating`；连续低热转 `cooling` |
| `escalating` | 加权负向、风险标签或高热评论连续上升 | 应对后下降转 `cooling`；风险继续扩大保持 |
| `cooling` | 声量和风险下降，但仍有残余讨论 | 连续两个采集周期低风险转 `resolved`；反弹转 `escalating` |
| `resolved` | 事件对宣发动作不再有明显影响 | 新证据重新升温时重开 |

事件聚合采用“规则召回 + Agent 归并”：

```text
1. 规则召回候选评论：按演员名、剧名、风险标签、议题标签、关键词命中。
2. 计算评论权重。
3. 生成议题簇：topics + risks + stance + related_artist。
4. 计算事件分数。
5. DeepSeek Agent 判断是否同一事件，生成标题、起因、传播路径和立场。
6. 系统写入或更新事件。
```

事件分数：

```text
event_heat = sum(comment_weight) + log10(sum(post_hot_score) + 1)
negative_pressure = weighted_negative_ratio * log10(weighted_comment_count + 1)
risk_pressure = weighted_risk_ratio * log10(weighted_comment_count + 1)
source_pressure = suspected_matrix_ratio * 0.2 + official_action_ratio * 0.1
event_score = round(event_heat * 0.45 + negative_pressure * 0.3 + risk_pressure * 0.2 + source_pressure * 0.05, 4)
```

影响评估必须分为：

- 事实：真实数据和证据。
- 判断：基于事实的分析。
- 建议：可执行动作。
- 置信度：高、中、低。
- 归因限制：是否存在其他干扰因素。

## 15. 长期记忆设计

半年周期内，Agent 不能靠长上下文“记住所有事”。它必须维护结构化长期记忆，并且总结不能替代证据。

记忆分层：

```text
┌──────────────┐
│ 原始证据库    │  评论、帖子、候选、账号动作、链接、JSON
└──────┬───────┘
       ▼
┌──────────────┐
│ 事件档案库    │  事件生命周期、状态变化、证据、影响
└──────┬───────┘
       ▼
┌──────────────┐
│ 行动账本      │  Agent 建议、人类决策、现实动作
└──────┬───────┘
       ▼
┌──────────────┐
│ 回测档案      │  动作前后指标变化、效果信号、干扰因素
└──────┬───────┘
       ▼
┌──────────────┐
│ 经验记忆      │  下次遇到类似情况时可复用的经验
└──────────────┘
```

记忆类型：

| 类型 | 内容 |
| --- | --- |
| `project_fact` | 项目基础信息、平台、词包、账号池 |
| `selected_target` | 用户选择或忽略的候选 |
| `sentiment_summary` | 每批评论分析摘要 |
| `artist_event` | 艺人相关事件 |
| `risk_event` | 风险事件 |
| `publicity_action` | 宣发行动 |
| `backtest_result` | 回测结果 |
| `strategy` | Agent 策略建议 |
| `action_feedback` | 用户反馈和实际执行情况 |
| `user_preference` | 用户偏好 |
| `qa_turn` | 用户问答 |
| `daily_report` | 日报摘要 |
| `weekly_report` | 周报摘要 |

记忆写入规则：

- 新项目创建或配置变化。
- 用户选择或忽略候选。
- 评论采集完成。
- DeepSeek 分析完成。
- 观察线索生成。
- 正式事件创建或状态变化。
- Agent 生成策略建议。
- 用户确认、拒绝或修改建议。
- Agent 观察到官方号或疑似矩阵动作。
- 用户确认现实动作。
- 动作回测完成。
- Markdown 日报/周报生成。
- 用户明确表达偏好。

记忆检索规则：

- 当前项目记忆。
- 最近 7 天相关记忆。
- 当前事件完整时间线。
- 当前动作账本和回测结果。
- 与问题关键词匹配的候选、评论、风险、策略和账号动作。
- importance 高的记忆优先。
- 对半年长期问题，先检索事件档案和月度索引，再回到原始证据。

回答长期问题时，Agent 必须引用：

- `event_id`
- `target_id`
- `comment_id`
- `action_id`
- `backtest_id`
- `report_id`
- `memory_id`

## 16. Agent 工作台体验

首屏不应是传统数据大盘，而应是 Agent 工作台。图表和表格作为证据层，不作为唯一入口。

首屏模块：

1. 今日最重要的 3 个判断。
2. 正在升温/降温的事件。
3. Agent 建议马上处理的动作。
4. 待用户确认的采集、事件、宣发动作和矩阵识别。
5. 官方号和疑似矩阵动作摘要。
6. 数据覆盖缺口。
7. 今日与昨日对比。
8. 快速追问入口。

示例：

```text
今日 Agent 判断

1. “官宣可信度”仍是微博主要风险，但负向压力较昨日下降。
   证据：event_001、comment_112、target_203
   判断：可能与昨晚官方海报发布有关，但同时存在矩阵扩散，归因置信度中。
   建议：继续观察 24 小时，不建议扩大澄清。

2. 小红书“海岛生活感”讨论上升，主要来自生活方式笔记。
   证据：target_311、target_318
   判断：具备路人转化潜力。
   建议：优先补采 Top 3 笔记评论。

3. 李兰迪妆造讨论进入观察线索。
   证据：comment_441、comment_452
   判断：样本不足，暂不升级为事件。
   建议：等待下一轮物料后再判断。
```

## 17. 问答机器人要求

机器人是 Agent 的自然语言入口，不替代工作台。

必须支持：

- “今天最重要的舆情风险是什么？”
- “微博上为什么负向变多了？”
- “刘昊然最近这个事件讲清楚。”
- “李兰迪这两天的主要争议是什么？”
- “昨天建议发小红书物料，今天有没有改善？”
- “这波热度是路人讨论还是矩阵铺量？”
- “官方号昨晚发的物料对官宣可信度有没有帮助？”
- “过去一个月哪些动作最有效？”
- “哪些建议我们没有执行？”
- “哪些疑似矩阵号需要确认？”

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
动作后相关指标出现改善，但同时存在其他宣发动作，不能确认该动作单独导致改善。
```

## 18. MediaCrawler 接入方案

MediaCrawler 是 Agent 的真实采集工具，不是主系统二开底座。

部署目录：

```text
/Users/mini-002/Desktop/yuqingjiance/MediaCrawler
```

主系统 `.env` 增加：

```bash
MEDIACRAWLER_HOME=/Users/mini-002/Desktop/yuqingjiance/MediaCrawler
MEDIACRAWLER_COMMIT=<锁定的commit hash>
MEDIACRAWLER_PYTHON=/Users/mini-002/Desktop/yuqingjiance/MediaCrawler/.venv/bin/python
MEDIACRAWLER_OUTPUT_DIR=/Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor/storage/mediacrawler
MEDIACRAWLER_CDP_PORT=9222
```

DeepSeek API Key 只允许通过 `.env` 或进程环境变量 `DEEPSEEK_API_KEY` 注入，禁止写死在代码、测试夹具、PRD、README 或前端资源中。

验收要求：

- `MEDIACRAWLER_HOME` 存在。
- 当前 git commit 等于 `MEDIACRAWLER_COMMIT`。
- `MEDIACRAWLER_PYTHON` 可执行。
- Chrome CDP 端口可连接。
- 不满足任一条件时，采集任务失败并写入明确错误。

平台映射：

```text
xhs -> xiaohongshu
dy  -> douyin
wb  -> weibo
```

首版使用：

```text
--type search
--type detail
```

配置约束：

- `ENABLE_CDP_MODE=True`
- `CDP_DEBUG_PORT=9222`
- `CDP_CONNECT_EXISTING=True`
- `SAVE_DATA_OPTION=jsonl`
- `CRAWLER_MAX_NOTES_COUNT=50`
- `ENABLE_GET_COMMENTS=True`
- `CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES=100`
- `ENABLE_GET_SUB_COMMENTS=False`
- `MAX_CONCURRENCY_NUM=1`
- `CRAWLER_MAX_SLEEP_SEC>=2`
- `HEADLESS=False`

实现时不得手工修改 MediaCrawler 源码里的固定配置作为运行方式；应由 adapter 在运行前生成临时配置或通过环境/配置补丁注入，避免污染上游项目。

## 19. 登录态、合规与稳定性

三平台均按“企业级真实采集必须有有效登录态”处理。

| 平台 | 登录态要求 | 首版处理 |
| --- | --- | --- |
| 小红书 | 必须有登录态 | 使用企业采集账号在 CDP Chrome 中登录 |
| 抖音 | 必须有登录态 | 使用企业采集账号在 CDP Chrome 中登录 |
| 微博 | 生产采集必须有登录态 | 匿名公开页只能人工排障 |

登录态状态：

```text
missing / valid / expired / verification_required / rate_limited / unknown
```

要求：

- 主系统不保存账号密码。
- 不提供自动账号密码登录。
- 每个平台至少维护一个企业采集账号。
- 每次采集前必须检查登录态。
- 登录态失效时，只阻塞该平台任务，不影响其他平台和 Web 服务。
- 出现二维码、手机号验证、滑块验证、风控提示时，任务失败为 `platform_verification_required`。
- 连续出现 `rate_limited` 或 `platform_verification_required` 时，系统自动暂停该平台定时任务。

合规约束：

- 不绕过验证码。
- 不破解签名。
- 不使用未授权账号。
- 不进行高频大规模采集。
- 不伪造评论。
- 不使用 mock 数据冒充真实数据。

## 20. 数据模型建议

现有表继续使用，并新增 Agent 所需表。所有真实采集、分析、事件、动作、回测和机器人结果都必须追溯到 `project_id`。

### 20.1 现有表扩展

`monitor_projects`：

- 初始化《海岛舒服日志》默认项目。
- 增加 `actors`、`active_platforms`、`source_account_config`。

`platform_auth_states`：

- `account_label`
- `login_method`
- `status`
- `last_success_at`
- `last_error_type`
- `last_error_message`

`collection_tasks`：

- `crawler_engine`
- `crawler_type`
- `error_type`
- `output_path`
- `raw_files`
- `parsed_records`
- `failed_records`
- `enable_sub_comments`
- `target_id`
- `schedule_id`

`social_posts`：

- `comment_count`
- `share_count`
- `collect_count`
- `source_keyword`
- `source_account_id`
- `source_type`
- `content_fingerprint`

`social_comments`：

- `parent_comment_id`
- `reply_count`
- `sub_comment_count`
- `author_is_verified`
- `ip_location`
- `comment_weight`
- `weight_version`

`sentiment_results`：

- `stance`
- `issue_summary`
- `intensity`
- `weight`
- `analysis_json`
- `fallback_type`
- `analyzed_at`

### 20.2 新表

`discovered_targets`：保存热度发现阶段候选内容。

关键字段：

- `project_id`
- `task_id`
- `platform`
- `keyword`
- `target_type`
- `external_id`
- `title`
- `summary`
- `author_name`
- `url`
- `like_count`
- `comment_count`
- `share_count`
- `collect_count`
- `hot_score`
- `candidate_rank`
- `selected_status`
- `agent_recommendation_json`
- `source_type`
- `content_fingerprint`
- `raw_json`

`source_accounts`：保存官方号、主创号、演员号、营销号、粉丝号等账号。

关键字段：

- `project_id`
- `platform`
- `account_name`
- `account_url`
- `source_type`
- `is_seed_account`
- `confirmed_by_user`
- `confidence`
- `notes`

`publicity_actions`：宣发行动账本。

关键字段：

- `project_id`
- `related_event_id`
- `action_source`
- `action_type`
- `platform`
- `account_id`
- `source_type`
- `content_url`
- `content_summary`
- `user_confirmation_status`
- `confidence`
- `expected_metric_change_json`
- `check_after_hours`
- `observed_at`
- `confirmed_at`

`action_backtests`：行动回测。

关键字段：

- `action_id`
- `event_id`
- `baseline_window_json`
- `after_window_json`
- `metric_changes_json`
- `confounders_json`
- `signal_level`
- `attribution_confidence`
- `summary`
- `next_recommendation`

`artist_public_opinion_events`：保存艺人和剧集相关舆情事件。

新增字段：

- `source_distribution_json`
- `linked_action_ids_json`
- `backtest_summary`

`event_evidence_links`：事件证据关联。

新增 `source_type`：

```text
target / post / comment / report / memory / action / account
```

`event_status_history`：事件状态变化。

`event_action_feedback`：用户对动作执行和效果的反馈。

`bot_memory_items`：长期记忆。

新增 `memory_type`：

```text
project_fact / selected_target / sentiment_summary / artist_event / risk_event /
publicity_action / backtest_result / strategy / action_feedback /
user_preference / qa_turn / daily_report / weekly_report
```

`bot_conversations`、`bot_messages`：机器人对话。

`daily_reports`、`weekly_reports`：报告。

`alert_events`：风险告警。

## 21. API 需求

保留现有：

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/stream`
- `POST /api/migrate`
- `POST /api/collect`

新增建议：

- `GET /api/projects`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/retry`
- `POST /api/discovery`
- `GET /api/discovery/targets`
- `POST /api/discovery/targets/select`
- `POST /api/discovery/targets/ignore`
- `POST /api/discovery/targets/:id/collect-comments`
- `GET /api/events`
- `GET /api/events/:id`
- `POST /api/events/:id/reanalyze`
- `PATCH /api/events/:id/status`
- `GET /api/source-accounts`
- `POST /api/source-accounts`
- `PATCH /api/source-accounts/:id`
- `GET /api/actions`
- `POST /api/actions`
- `PATCH /api/actions/:id/confirm`
- `POST /api/actions/:id/backtest`
- `GET /api/backtests`
- `POST /api/bot/conversations`
- `GET /api/bot/conversations`
- `POST /api/bot/conversations/:id/messages`
- `GET /api/bot/memory`
- `GET /api/reports/latest`
- `POST /api/reports/generate`

`GET /api/actions/pending-confirmation` 返回 Agent 观察到但需要用户确认的现实动作。

示例返回：

```json
{
  "actions": [
    {
      "action_id": "act_20260609_001",
      "action_source": "official_observed",
      "platform": "weibo",
      "source_type": "official_account",
      "account_name": "海岛舒服日志官微",
      "content_summary": "发布双人海报，强调海岛治愈感",
      "content_url": "https://example.com/post/1",
      "observed_at": "2026-06-09T20:03:00+08:00",
      "related_event_candidates": ["event_001", "event_003"],
      "confidence": 0.82,
      "confirmation_status": "pending"
    }
  ]
}
```

## 22. 报告需求

### 22.1 日报

每天生成 Markdown 日报，保存到：

```text
reports/<project_slug>/<YYYY-MM-DD>.md
```

日报包括：

- 数据时间范围。
- 数据覆盖和采集失败说明。
- 今日最重要的 3 个 Agent 判断。
- 三平台总览。
- 官方号和疑似矩阵动作摘要。
- 新增事件、升温事件、降温事件。
- 高热正向评论。
- 高热负向评论。
- 演员/关键词表现。
- 今日 Agent 建议。
- 待确认动作。
- 明日监控动作。

无真实数据时也生成日报，但必须说明“今日无真实评论入库”。

### 22.2 周报

每周生成周报，用于半年度长期记忆索引。

周报包括：

- 本周核心事件。
- 事件状态变化。
- 重要宣发动作。
- 动作回测信号。
- 平台策略变化。
- 下周重点观察。
- 本周学习到的经验。

周报摘要写入长期记忆，但回答具体事实时必须回溯事件、动作和评论证据。

## 23. 工程实现分期

### Phase 1：基础环境与真实采集可用

目标：系统能判断 MediaCrawler、Chrome CDP、三平台登录态是否可用。

任务：

- 增加 `.env` 配置项。
- 检查 `MEDIACRAWLER_HOME`。
- 检查 commit hash。
- 检查 Python/uv 可执行。
- 检查 Chrome CDP 端口。
- 检查小红书、抖音、微博登录态状态。
- 前端展示 MediaCrawler、Chrome CDP 和三平台登录态状态。

验收：

- 缺少任一项时，`/api/health` 返回明确错误。
- 任一平台登录态缺失时显示平台级 `auth_required`。
- Web 服务仍能正常打开。

### Phase 2：热度发现与候选推荐

目标：能对单个平台单个关键词运行 search 采集，生成热度前十候选，并由 Agent 给出采集建议。

任务：

- 创建 `mediacrawler_adapter` worker。
- 调用 MediaCrawler CLI。
- 保存 JSONL 到任务目录。
- 解析候选内容。
- 计算 `hot_score`。
- 写入 `discovered_targets`。
- Agent 生成 `agent_recommendation_json`。

验收：

- 页面出现热度前十候选。
- Agent 能说明哪些候选建议采评论及原因。
- 任务成功或失败都有可读日志。

### Phase 3：账号池与传播源识别

目标：系统能区分官方、演员、营销号、疑似矩阵、粉丝和自然用户。

任务：

- 新增 `source_accounts`。
- 支持录入官方号和已知营销号。
- 在候选和帖子中记录 `source_type`。
- 实现文本指纹。
- 识别疑似协同发布。
- 生成待确认账号和动作列表。

验收：

- 官方号内容可被识别。
- 疑似矩阵内容进入确认列表。
- 用户可以修正账号类型。

### Phase 4：候选确认与精确评论采集

目标：用户确认候选后，系统只对被选择候选采集评论。

任务：

- 实现候选选择、忽略、批量选择。
- 创建 `target_collection_links`。
- 对被选候选运行 MediaCrawler detail。
- 默认采 100 条一级评论。
- 风险触发时创建二级评论补采任务。

验收：

- 未选择候选时不采评论。
- 选择候选后能创建评论采集任务。
- 评论采集任务和候选内容能关联。

### Phase 5：JSONL 标准化入库

目标：MediaCrawler 输出进入企业表。

任务：

- 解析三平台 JSONL。
- 统一帖子和评论字段。
- 关联候选和账号来源。
- 去重 upsert。
- 原始 JSON 写入 `raw_json`。

验收：

- `social_posts` 有真实内容。
- `social_comments` 有真实评论。
- 重复运行不会重复插入。

### Phase 6：议题分析

目标：评论入库后自动分析议题、立场、情绪、风险和证据。

任务：

- 查询待分析评论。
- 批量调用 DeepSeek。
- 写入 `sentiment_results`。
- 失败记录 agent 日志。
- 本地规则兜底必须标记。

验收：

- 评论有议题、立场、情绪、风险标签和证据句。
- DeepSeek 失败时原始评论不丢失。

### Phase 7：事件归并

目标：把零散评论、候选和账号动作归并为《海岛舒服日志》相关事件。

任务：

- 按演员、剧名、事件类型、风险标签召回。
- 使用评论权重和事件分数算法生成事件簇。
- 调用 DeepSeek 归并同类事件。
- 写入事件表、证据表和状态历史。
- 关联已知宣发动作。

验收：

- 刘昊然、李兰迪相关评论能归并为事件或观察线索。
- 每个正式事件至少有证据。
- 事件包含状态、风险等级、影响评估和应对方案。

### Phase 8：宣发行动账本

目标：记录 Agent 建议、人类决策、现实动作和疑似矩阵动作。

任务：

- 新增 `publicity_actions`。
- Agent 建议写入行动账本。
- 用户确认/拒绝/修改建议。
- 官方号和疑似矩阵动作写入待确认列表。
- 用户可确认现实动作。

验收：

- Agent 建议不自动等于已执行。
- 用户确认后动作状态更新。
- 官方号发布内容可成为 `official_observed`。
- 疑似矩阵动作可成为 `matrix_inferred`。

### Phase 9：行动回测

目标：比较动作前后数据，评估效果信号。

任务：

- 新增 `action_backtests`。
- 为确认动作建立前后观察窗口。
- 聚合事件指标、情绪、风险、传播源变化。
- 识别干扰因素。
- 输出 signal level。

验收：

- 能回答“昨晚官方物料有没有帮助”。
- 回测输出包含置信度和归因限制。
- 无数据时返回 `unknown`。

### Phase 10：长期记忆与问答

目标：把候选、评论、事件、行动、回测、报告和用户反馈沉淀为可追问的长期记忆。

任务：

- 写入 `bot_memory_items`。
- 实现记忆检索。
- 机器人回答时引用来源。
- 无真实数据时拒绝编造。

验收：

- 用户能问“刘昊然最近这个事件讲清楚”并得到证据。
- 用户能问“过去一个月哪些动作有效”并得到回测结果。
- 用户能问“哪些建议没有执行”并得到行动账本记录。

### Phase 11：Agent 工作台

目标：前端展示真实采集、事件、行动、回测和问答闭环。

任务：

- 增加 Agent 今日判断。
- 增加待确认动作。
- 增加事件面板。
- 增加行动账本面板。
- 增加回测结果面板。
- 增加账号池和疑似矩阵确认入口。
- 增加机器人入口。

验收：

- 首屏能看到 Agent 判断和待处理事项。
- 有事件时能查看时间线、证据、影响评估和应对动作。
- 有动作时能查看执行状态和回测结果。

### Phase 12：日报、周报与端到端验收

目标：形成可交付报告和半年度记忆索引。

任务：

- 生成日报 worker。
- 生成周报 worker。
- 报告摘要写入长期记忆。
- 跑通一个平台端到端链路。

验收：

- 每日能生成一份日报。
- 每周能生成一份周报。
- 报告引用真实证据。
- 机器人能引用报告作为索引，并回溯到事件和评论。

## 24. 测试计划

### 单元测试

- 平台白名单只允许小红书、抖音、微博。
- MediaCrawler 平台映射正确。
- JSONL adapter 能处理缺字段、重复数据、坏行。
- 候选热度计算正确。
- 候选推荐状态流转正确。
- 评论权重算法可复现。
- 议题分析结果解析能处理 DeepSeek JSON、Markdown 包裹 JSON、失败响应。
- 事件证据门槛正确。
- 事件状态流转正确。
- 传播源类型识别规则正确。
- 文本指纹生成稳定。
- 疑似矩阵识别规则可复现。
- 行动状态流转正确。
- 回测 signal level 规则正确。
- 机器人记忆检索不跨项目污染。

### 集成测试

- MySQL migration 成功。
- 默认项目初始化。
- 模拟 search JSONL 能入库到 `discovered_targets`。
- 候选能生成 Agent 推荐。
- 官方号内容能识别 source type。
- 选择候选后能创建评论采集任务。
- 模拟 detail JSONL 能入库评论。
- 待分析评论能写入 `sentiment_results`。
- 议题分析结果能归并为事件。
- Agent 建议能写入行动账本。
- 用户确认动作后能触发回测。
- 回测结果能写入长期记忆。

### 端到端测试

- 在 CDP Chrome 已登录状态下运行一个小红书关键词发现任务。
- search JSONL 文件生成。
- 页面展示热度前十候选。
- Agent 推荐至少一个候选。
- 用户选择一个候选。
- detail JSONL 文件生成。
- adapter 将评论入库。
- DeepSeek 分析完成。
- 事件或观察线索生成。
- Agent 生成建议。
- 用户记录一个现实动作。
- 系统生成回测结果。
- 机器人能回答事件、动作和效果相关问题。
- 看板不显示非目标平台。

### 回归测试

- `POST /api/items` 继续拒绝 mock 注入。
- MySQL 断开时系统显示阻塞，不回退 mock。
- MediaCrawler 缺失时任务失败，Web 服务仍可用。
- 登录态失效时只阻塞对应平台。
- DeepSeek 失败时原始数据不丢失。
- 无证据时 Agent 不编造判断。

## 25. 验收标准

项目完成必须同时满足：

1. 服务仍固定运行在 `0.0.0.0:8787`。
2. 前端只显示小红书、抖音、微博。
3. 系统固定服务《海岛舒服日志》、刘昊然、李兰迪。
4. 能创建关键词热度发现任务。
5. 至少一个平台能通过 MediaCrawler 发现热度前十候选。
6. Agent 能推荐值得采评论的候选并说明原因。
7. 用户能确认、忽略或修改候选选择。
8. 系统只对被选候选采集评论。
9. 原始 search/detail JSONL 保存在任务目录。
10. adapter 将候选、帖子、评论写入企业 MySQL 表。
11. DeepSeek Agent 写入议题分析结果。
12. 系统能生成或更新艺人舆情事件。
13. 每个正式事件都有证据、状态、风险等级、影响评估和应对方案。
14. 系统能记录官方号、营销号、疑似矩阵和自然用户来源。
15. Agent 能生成待确认的疑似宣发动作。
16. 用户能确认现实中采取的宣发动作。
17. Agent 建议不被自动视为已执行。
18. 系统能对确认动作进行前后窗口回测。
19. 回测结果包含指标变化、置信度和归因限制。
20. 问答机器人能使用长期记忆回答项目舆情问题，并引用事件、候选、评论、动作、回测和报告。
21. 无数据、无登录态、无 MySQL 时不展示 mock 数据。
22. 无证据时 Agent 明确说数据不足。
23. 生成至少一份 Markdown 日报。
24. 生成至少一份 Markdown 周报。
25. 全套测试通过。
26. README 写明部署、配置、采集、排错、账号池、行动账本和回测步骤。

## 26. 不在当前范围内

- 不做公网 SaaS 多租户。
- 不做任意行业、任意关键词的通用舆情平台。
- 不展示除小红书、抖音、微博之外的平台。
- 不做自动发布微博、小红书或抖音内容。
- 不自动控制官方号或营销号。
- 不托管账号密码。
- 不绕过验证码、风控或平台限制。
- 不自动生成 PPT。
- 不把矩阵声量当作自然路人转化。
- 不把 Agent 建议自动视为现实已执行。
- 不在缺少证据时编造评论、事件、动作或效果。

## 27. 初级工程师任务卡

每张任务卡必须独立提交、独立测试、独立验收。

### Task 1：补全数据库 migration

目标：支持候选、账号池、事件、行动账本、回测、机器人记忆和报告。

完成定义：

- 新增表可创建。
- 新字段兼容旧数据。
- migration 可重复执行。

### Task 2：实现 MediaCrawler 环境检查

目标：系统能判断 MediaCrawler、Chrome CDP、版本锁和三平台登录态是否可用。

完成定义：

- `/api/health` 返回明确状态。
- 缺失时显示具体错误。
- Web 服务不受影响。

### Task 3：实现热度发现 worker

目标：按项目、平台、关键词调用 MediaCrawler search，产出热度前十候选。

完成定义：

- 每个平台每个关键词最多保留 10 条候选。
- 失败有 `error_type` 和 `error_message`。
- 不写入非目标平台。

### Task 4：实现 Agent 候选推荐

目标：Agent 对候选给出采集建议和原因。

完成定义：

- 每个候选有推荐状态。
- 推荐必须引用候选数据。
- 不能无证据推荐。

### Task 5：实现账号池和传播源识别

目标：记录官方号、演员号、营销号、疑似矩阵、粉丝号和自然用户。

完成定义：

- 用户可录入账号。
- 候选和帖子可关联账号。
- source type 可人工修正。

### Task 6：实现疑似矩阵识别

目标：基于时间窗口、文案相似度、话题和物料关键词识别协同行为。

完成定义：

- 识别结果进入待确认列表。
- 结果带置信度。
- 用户可确认或否认。

### Task 7：实现候选选择和评论采集

目标：只对用户确认候选运行 MediaCrawler detail。

完成定义：

- 未选择候选不能采评论。
- 已选择候选能创建 detail 任务。
- 评论 upsert 不重复。

### Task 8：实现 JSONL adapter 测试夹具

目标：不用真实平台也能测试 adapter。

完成定义：

- 三平台 search/detail fixture 可解析。
- 缺字段、坏行、重复行都有测试。

### Task 9：实现 DeepSeek 议题分析

目标：评论入库后批量分析议题、立场、情绪、风险和证据。

完成定义：

- 成功评论有完整分析字段。
- 失败不删除评论。
- 本地规则兜底可识别。

### Task 10：实现事件归并 worker

目标：将评论、候选和账号动作归并为事件。

完成定义：

- 证据不足只能生成观察线索。
- 正式事件至少有证据。
- 同一事件 72 小时内优先更新旧事件。

### Task 11：实现宣发行动账本

目标：记录 Agent 建议、人类决策和现实动作。

完成定义：

- Agent 建议写入但不标记执行。
- 用户可确认、拒绝或修改。
- 官方观察和矩阵推断可进入待确认。

### Task 12：实现行动回测

目标：比较动作前后指标，输出效果信号。

完成定义：

- 回测必须有动作时间点。
- 输出 signal level、置信度、干扰因素。
- 数据不足返回 `unknown`。

### Task 13：实现长期记忆写入

目标：关键事实、事件、行动、回测和用户偏好进入机器人记忆。

完成定义：

- 每类事件至少写入一条 memory。
- 不跨项目污染。
- 事件、动作、回测 memory 必须引用源 ID。

### Task 14：实现问答机器人

目标：用户能基于长期记忆追问项目舆情、动作和效果。

完成定义：

- 回答引用来源。
- 区分事实、推断、建议。
- 无真实数据时拒绝编造。

### Task 15：实现 Agent 工作台

目标：前端展示 Agent 判断、事件、行动、回测和待确认事项。

完成定义：

- 首屏出现今日 Agent 判断。
- 用户能处理待确认动作。
- 事件详情能看到证据、建议和回测。

### Task 16：实现日报和周报

目标：形成长期可追溯报告。

完成定义：

- 日报、周报引用真实证据。
- 报告摘要写入记忆。
- 无数据报告说明数据缺口。

### Task 17：端到端验收

目标：跑通完整 Agent 闭环。

步骤：

1. 启动 MySQL。
2. 运行 migration。
3. 启动 Chrome CDP。
4. 确认 MediaCrawler 版本。
5. 创建关键词发现任务。
6. Agent 推荐候选。
7. 用户选择候选。
8. 采集评论。
9. 分析议题、立场、情绪和风险。
10. 生成事件。
11. Agent 生成建议。
12. 用户记录现实动作。
13. 系统回测动作效果。
14. 向机器人提问。
15. 生成日报和周报。

完成定义：

- 全链路至少跑通一个平台。
- 至少生成一个事件或观察线索。
- 至少记录一个现实动作。
- 至少生成一个回测结果。
- API、前端、MySQL、报告均有证据。
- 全套自动化测试通过。

