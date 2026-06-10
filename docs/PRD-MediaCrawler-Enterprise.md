# PRD：单剧宣发 AI 舆情监测系统与 MediaCrawler 真实采集接入

## 1. 背景与目标

当前 AI 舆情监测系统已经固定运行在 `0.0.0.0:8787`，采用 `real-data-only` 模式，前端只允许展示小红书、抖音、微博三个平台，企业数据表使用项目自有 MySQL schema。现阶段缺口是：真实采集器尚未接入，采集任务只能显示阻塞状态，无法把三平台真实帖子与评论稳定导入业务表并进入 DeepSeek 议题分析链路。

当前版本的产品范围收窄为“单部即将上线影视剧的宣发舆情监控系统”。系统重点监控该剧本身的市场反应，以及剧中主角和核心演员的舆情风向。后续可以扩展为通用舆情监测平台，但不属于当前版本目标。

本 PRD 的目标是将 `NanmiCoder/MediaCrawler` 作为独立真实采集引擎接入现有系统。MediaCrawler 只负责平台采集；主系统继续负责项目管理、MySQL 企业表、标准化 adapter、Agent 分析、看板与报告。

完成后，制片人和宣发团队可以围绕当前剧集创建关键词监控任务。系统先调用 MediaCrawler 检索小红书、抖音、微博中热度最高的候选内容，例如小红书笔记、抖音视频标题、微博词条/博文；用户从候选列表中选择真正需要关注的目标后，系统再精确采集评论，经 adapter 标准化入库，再由 DeepSeek Agent 分析评论里的具体议题、艺人舆情事件、市场反应、潜在影响和后续应对方案。最终分析结果会沉淀到一个带长期记忆的问答机器人中，供用户持续追问项目舆情、历史变化和营销策略。

## 1A. MVP 固定监控对象

当前 MVP 不做任意剧集、任意艺人、任意行业的自由监控，只服务一个真实宣发项目：

| 类型 | 固定对象 |
| --- | --- |
| 剧名 | 《海岛舒服日志》 |
| 监控艺人 | 刘昊然、李兰迪 |
| 监控平台 | 小红书、抖音、微博 |
| 业务阶段 | 上线前后宣发监控、风险识别、市场反馈判断、营销动作建议 |

系统默认词包分三类：

| 词包 | 首版关键词 |
| --- | --- |
| 剧集词包 | 海岛舒服日志、海岛舒服日志 官宣、海岛舒服日志 定档、海岛舒服日志 预告、海岛舒服日志 路透、海岛舒服日志 粤语、海岛舒服日志 妆造、海岛舒服日志 剧情 |
| 刘昊然词包 | 刘昊然、刘昊然 海岛舒服日志、刘昊然 新剧、刘昊然 演技、刘昊然 粤语、刘昊然 路透 |
| 李兰迪词包 | 李兰迪、李兰迪 海岛舒服日志、李兰迪 新剧、李兰迪 演技、李兰迪 粤语、李兰迪 路透 |

词包可以由运营人员增删，但首版词包必须围绕《海岛舒服日志》、刘昊然、李兰迪展开。若用户输入与本项目无关的关键词，系统应提示“不属于当前 MVP 监控对象”，不得把产品退回通用舆情平台。

## 2. 核心原则

- 主服务端口固定为 `0.0.0.0:8787`，不得变更。
- 当前版本只服务单部即将上线影视剧，不做通用舆情平台。
- MVP 固定监控《海岛舒服日志》、刘昊然、李兰迪；其他对象只作为后续版本扩展。
- 前端只展示小红书、抖音、微博，禁止出现 News、Bilibili、Reddit、YouTube、Douban 等非目标平台。
- 已有企业级功能必须保留：真实数据看板、趋势预测、多 Agent 状态、三平台可视化、评论议题分析、营销策略、Markdown 简报、任务日志、MySQL 企业表、无数据不造假。
- MySQL schema 使用本项目企业舆情表，不直接把 MediaCrawler 表结构作为业务主表。
- MediaCrawler 作为独立 CLI worker 使用，不作为主系统二开底座。
- MediaCrawler 原始输出先落 JSONL，adapter 再标准化写入 `social_posts`、`social_comments`、候选内容表和机器人记忆表。
- 系统默认先做“热度发现”，只展示每平台/关键词热度前十候选；用户选择后才做精确评论采集。
- 无 MySQL、无登录态、无真实评论时，系统显示阻塞或空状态，不使用 mock 数据补位。
- 三个平台均按“企业级真实采集必须有有效登录态”处理；匿名公开页能力只能用于人工排障，不能作为生产采集方案。
- 所有采集行为以已获授权、低频率、可审计为前提，不绕过验证码、不破解风控、不伪造评论。

## 3. 已确认产品决策

1. MediaCrawler 接入形态：CLI Worker。
2. 数据中转方式：JSONL 中转。
3. 登录态方式：CDP Chrome，连接本机真实浏览器登录态。
4. 采集任务粒度：项目 × 平台 × 关键词。
5. 采集流程：先检索热度前十候选内容，用户选择目标后再采集评论。
6. 调度模式：人工触发 + 定时任务双模式。
7. 第一版发现规模：每平台每关键词最多展示热度前 10 候选。
8. 第一版评论规模：每个被选中目标最多采集 100 条一级评论；不足 100 条时全量采集；二级评论默认关闭，风险话题触发补采。
9. 议题分析时机：评论入库后异步 DeepSeek 分析。
10. MediaCrawler 部署位置：同机独立目录，例如 `/Users/mini-002/Desktop/yuqingjiance/MediaCrawler`。
11. MediaCrawler 版本管理：锁定 commit hash，配置 `MEDIACRAWLER_HOME` 和 `MEDIACRAWLER_COMMIT`。
12. 原始 JSONL 保留周期：30 天。
13. 告警方式：看板内告警 + 每日 Markdown 简报。
14. 用户权限：内网 MVP 无登录。
15. 策略报告输出：看板 + Markdown 报告。
16. 问答机器人：接入长期记忆，记住项目、关键词、用户选择过的候选、历史情绪、风险、策略和用户追问。
17. 三平台登录态：小红书、抖音、微博都必须配置企业采集账号登录态；登录态失效时任务进入阻塞，不降级为 mock 或匿名采集。
18. 艺人舆情事件：系统必须把刘昊然、李兰迪相关舆情从零散评论归并为可复盘事件，并评估对《海岛舒服日志》宣发的影响。

## 4. 用户故事

1. 作为制片人，我想看到《海岛舒服日志》在小红书、抖音、微博的真实评论声量，这样我能判断项目热度是否来自真实用户讨论。
2. 作为制片人，我想看到三平台情绪占比，这样我能快速判断舆情是正向扩散还是负向发酵。
3. 作为宣发负责人，我想在《海岛舒服日志》固定项目下配置关键词和演员词包，这样我能随宣发阶段调整监控重点。
4. 作为宣发负责人，我想先看到每个平台每个关键词热度前十的候选内容，这样我能决定哪些内容值得精确采评论。
5. 作为宣发负责人，我想在候选列表里勾选微博词条、微博博文、小红书笔记、抖音视频，这样系统只分析我真正关心的对象。
6. 作为宣发负责人，我想手动触发候选发现和精确评论采集，这样我能在官宣、定档、物料发布后立即查看反馈。
7. 作为宣发负责人，我想系统按固定频率自动刷新候选热度，这样我能发现新的高热帖子、词条和视频。
8. 作为数据分析师，我想查看每个平台每个关键词的发现任务和评论采集任务状态，这样我能知道失败是来自发现阶段还是精采阶段。
9. 作为数据分析师，我想保留 MediaCrawler 原始 JSONL，这样我能回放、排错和审计采集结果。
10. 作为数据分析师，我想 adapter 把不同平台字段统一到企业表，这样后续分析不用关心平台差异。
11. 作为数据分析师，我想评论先入库再异步做议题分析，这样 LLM 失败不会导致原始数据丢失。
12. 作为宣发策略人员，我想看到 DeepSeek 给出的情绪、风险标签和证据句，这样我能判断策略建议是否有真实评论支撑。
13. 作为宣发策略人员，我想看到微博、抖音、小红书分平台建议，这样不同平台可以采用不同内容打法。
14. 作为运营人员，我想看到登录态是否有效，这样采集失败时能快速知道是否需要重新登录。
15. 作为运营人员，我想看到 MySQL 是否连接，这样系统部署问题可以第一时间暴露。
16. 作为运营人员，我想看到高风险评论触发二级评论补采，这样争议链路不会被一级评论截断。
17. 作为管理者，我想每天获得 Markdown 简报，这样我可以不打开系统也能了解昨日舆情。
18. 作为制片人，我想向机器人追问“为什么今天负向升高”“哪些演员风险最大”“昨天建议有没有改善”，这样我能基于长期记忆持续决策。
19. 作为宣发负责人，我想机器人记住我选择过的候选和采集过的评论，这样下一次分析可以承接历史上下文。
20. 作为工程师，我想有清晰的命令、配置、表结构和验收标准，这样我能按文档完成实现而不需要重新设计。
21. 作为制片人，我想让系统把刘昊然或李兰迪相关事件讲清楚，包括起因、传播路径、主要立场、代表评论和当前状态，这样我不用在评论海里自己拼事实。
22. 作为宣发负责人，我想看到每个艺人事件对《海岛舒服日志》的上线、路人盘、粉丝盘和物料节奏有什么影响，这样我能决定澄清、转移议题、加物料还是观察。
23. 作为策略人员，我想看到每个事件的可执行动作、负责人建议和下一次观察时间，这样事件处理不是停留在“有风险”三个字。

## 5. 系统边界

### 5.1 主系统

主系统继续负责：

- Web 服务与 API，固定端口 `8787`。
- MySQL 企业业务表。
- 项目、关键词、演员、平台白名单配置。
- 候选发现、人工选择、精确评论采集任务创建、状态管理、错误展示。
- JSONL adapter 标准化入库。
- DeepSeek 议题分析 Agent。
- 艺人舆情事件归并、事件时间线、影响评估和应对方案。
- 趋势预测、风险判断、营销建议。
- 长期记忆问答机器人。
- 前端看板和 Markdown 简报。

### 5.2 MediaCrawler

MediaCrawler 只负责：

- 根据平台、关键词、采集类型执行真实采集。
- 复用 CDP Chrome 登录态。
- 输出帖子、视频、笔记、微博词条、评论 JSONL。
- 不直接承担业务分析、看板展示、策略生成。

### 5.3 不在范围内

- 不做 MediaCrawler 主项目二开。
- 不展示除小红书、抖音、微博之外的平台。
- 不做公网 SaaS 多租户。
- 不做任意行业、任意关键词的通用舆情监测。
- 不做短信、企业微信、邮件告警。
- 不做自动 PPT 生成。
- 不做账号密码托管登录。
- 不做绕验证码、绕风控、破解签名。
- 不取消已规划的看板、趋势预测、多 Agent、营销策略、Markdown 简报等前置功能。

## 6. MediaCrawler 接入方案

### 6.1 部署目录

约定目录：

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

### 6.2 MediaCrawler 命令

MediaCrawler README 中示例命令为：

```bash
uv run main.py --platform xhs --lt qrcode --type search
python main.py --platform xhs --lt qrcode --type search
python main.py --platform xhs --lt qrcode --type detail
```

本系统只允许以下 platform：

```text
xhs -> xiaohongshu
dy  -> douyin
wb  -> weibo
```

本系统首版只使用：

```text
--type search
```

后续需要补采指定内容评论时，使用：

```text
--type detail
```

登录方式首版使用：

```text
--lt qrcode
```

但实际登录态依赖 CDP Chrome 复用，不能每次都要求用户扫码。

### 6.3 MediaCrawler 配置约束

根据 MediaCrawler `config/base_config.py`，PRD 固定以下配置含义：

- `PLATFORM`：平台，支持 `xhs | dy | wb`。
- `KEYWORDS`：英文逗号分隔关键词。
- `LOGIN_TYPE`：登录方式，首版使用 `qrcode`。
- `ENABLE_CDP_MODE=True`。
- `CDP_DEBUG_PORT=9222` 或读取 `MEDIACRAWLER_CDP_PORT`。
- `CDP_CONNECT_EXISTING=True`。
- `SAVE_DATA_OPTION=jsonl`。
- `CRAWLER_MAX_NOTES_COUNT=50`。
- `ENABLE_GET_COMMENTS=True`。
- `CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES=100`。
- `ENABLE_GET_SUB_COMMENTS=False`，风险补采任务才改为 True。
- `MAX_CONCURRENCY_NUM=1`，首版保守限速。
- `CRAWLER_MAX_SLEEP_SEC>=2`。
- `HEADLESS=False`，首版保持可见浏览器，方便处理平台验证。

实现时不得手工修改 MediaCrawler 源码里的固定配置作为运行方式；应由 adapter 在运行前生成临时配置或通过环境/配置补丁注入，避免污染上游项目。

### 6.4 三平台登录态要求

企业级真实采集按以下规则处理登录态：

| 平台 | 登录态要求 | 首版处理 |
| --- | --- | --- |
| 小红书 | 必须有登录态 | 使用企业采集账号在 CDP Chrome 中登录；登录失效时 `auth_required` |
| 抖音 | 必须有登录态 | 使用企业采集账号在 CDP Chrome 中登录；登录失效时 `auth_required` |
| 微博 | 生产采集必须有登录态 | 公开页匿名访问只能人工排障；搜索翻页、评论采集、稳定增量必须使用登录态 |

登录态实现原则：

- 首版使用 `ENABLE_CDP_MODE=True`、`CDP_CONNECT_EXISTING=True` 连接本机真实 Chrome 登录态。
- `LOGIN_TYPE` 可使用 `qrcode` 完成首次登录，也可以在必要时使用 `cookie` 导入已授权 cookie。
- `SAVE_LOGIN_STATE=True`，允许 MediaCrawler 保存登录状态，但主系统仍必须维护平台登录态状态。
- 主系统不保存账号密码，不提供自动账号密码登录。
- 每个平台至少维护一个企业采集账号；账号归属、用途和授权说明写入部署文档。
- 登录态状态分为 `missing`、`valid`、`expired`、`verification_required`、`rate_limited`、`unknown`。
- 每次采集前必须检查登录态，失败时不得启动采集。
- 采集中出现二维码、手机号验证、滑块验证、风控提示时，任务失败为 `platform_verification_required`，由运营人工处理。
- 登录态失效时，看板顶部状态必须显示具体平台，不允许只显示“采集失败”。
- 任一平台登录态不可用时，只阻塞该平台任务，不影响其他平台和 Web 服务。

合规与稳定性要求：

- 不绕过验证码、不破解签名、不使用未授权账号、不进行高频大规模采集。
- 默认并发为 1，平台间串行或低并发执行。
- 每次任务记录平台、关键词、账号标识、开始时间、结束时间、采集数量、失败原因。
- 若连续出现 `rate_limited` 或 `platform_verification_required`，系统自动暂停该平台定时任务，等待人工恢复。

## 7. 任务状态机

## 7A. 热度发现与人工选择工作流

系统采集分为两个阶段：先发现候选，再精确采评论。

### 7A.1 阶段一：热度发现

用户在《海岛舒服日志》固定项目词包内选择或增补关键词后，系统为每个平台和关键词创建发现任务：

```text
项目：《海岛舒服日志》
关键词：海岛舒服日志、刘昊然、李兰迪、官宣、粤语
平台：小红书、抖音、微博
任务：每个平台每个关键词检索热度前 10 候选
```

候选类型：

- 小红书：笔记标题、笔记正文摘要、作者、点赞/收藏/评论数、链接。
- 抖音：视频标题/描述、作者、点赞/评论/分享数、链接。
- 微博：微博词条、热门博文、作者、转评赞、链接。

热度前十以平台原生搜索或榜单返回顺序为准，即 `candidate_rank`。系统同时计算解释性 `hot_score`，用于看板展示和二次排序，但不取代平台原生排名。

热度分首版使用平台互动字段加权：

```text
hot_score = like_count + comment_count * 3 + share_count * 4 + collect_count * 2
```

如果平台缺少某个互动字段，缺失字段按 0 处理。每个平台每个关键词默认保留平台原生前 10 条；用户可以在前端按 `hot_score` 进行二次排序。

### 7A.2 阶段二：用户选择

前端展示候选列表，用户可以：

- 勾选一个或多个候选内容。
- 查看候选标题、正文摘要、平台、作者、互动量、链接。
- 按平台、关键词、热度、是否已采评论筛选。
- 点击“精采评论”创建 detail 采集任务。
- 对不相关候选标记为“忽略”。

候选选择是业务决策，系统不得自动对所有候选采评论。例外：如果用户开启“风险自动补采”，系统可对命中风险规则的候选自动创建补采任务，但必须在任务日志里标明触发原因。

### 7A.3 阶段三：精确评论采集

用户选择候选后，系统创建 detail 评论采集任务：

- 每个候选最多采集 100 条一级评论；不足 100 条时全量采集。
- 默认不采二级评论。
- 风险触发后可补采 50 条二级评论。
- 采集结果与候选内容关联。
- 同一候选重复采集时做 upsert，不重复插入。

### 7A.4 阶段四：分析与沉淀

评论入库后：

- DeepSeek Agent 异步分析评论议题、立场、情绪、风险和证据。
- 结果进入看板 KPI、图表和证据面板。
- 高热候选、用户选择、评论分析、策略建议写入长期记忆。
- 问答机器人可基于长期记忆回答项目舆情问题。

### 7.1 采集任务状态

`collection_tasks.status` 使用以下状态：

- `queued`：任务已创建，等待执行。
- `running`：MediaCrawler 正在运行。
- `succeeded`：JSONL 生成、adapter 入库完成。
- `failed`：任务失败，必须有 `error_message`。

建议扩展状态：

- `partial`：MediaCrawler 有输出，但部分记录标准化失败。
- `analyzing`：评论入库完成，DeepSeek 分析进行中。
- `analyzed`：评论议题分析完成。

如果暂不改表，可先将扩展状态写入 `agent_runs.output_json`。

### 7.2 任务唯一性

同一项目、平台、关键词、采集窗口内只允许一个 running 任务。若用户重复点击采集：

- 如果已有 running 任务，API 返回已有任务 ID。
- 如果上次任务 failed，允许重新创建。
- 如果上次任务 succeeded，允许用户手动选择是否重跑。

### 7.3 错误分类

错误必须归入以下类型之一：

- `mysql_unavailable`
- `mediacrawler_missing`
- `mediacrawler_version_mismatch`
- `chrome_cdp_unavailable`
- `auth_required`
- `platform_verification_required`
- `crawler_timeout`
- `jsonl_missing`
- `adapter_parse_failed`
- `deepseek_failed`
- `rate_limited`
- `unknown`

前端显示中文错误说明，数据库保存机器可读错误类型和原始错误。

## 8. JSONL Adapter 规范

### 8.1 输入

adapter 从 `MEDIACRAWLER_OUTPUT_DIR` 读取本次任务生成的 JSONL 文件。文件路径必须记录到 `collection_tasks.output_path` 或 `agent_runs.output_json`。

如果 MediaCrawler 输出多文件，adapter 必须按平台和任务 ID 归档到：

```text
storage/mediacrawler/<project_id>/<task_id>/<platform>/<keyword_slug>/
```

### 8.2 输出到企业表

帖子/视频/笔记写入 `social_posts`。

评论写入 `social_comments`。

议题分析结果写入 `sentiment_results`。

原始 JSON 保存到 `raw_json` 字段。

### 8.3 平台字段映射

标准化字段：

| 标准字段 | 含义 |
| --- | --- |
| `project_id` | 监控项目 ID |
| `platform` | `xiaohongshu` / `douyin` / `weibo` |
| `external_id` | 平台内容 ID |
| `url` | 原始链接 |
| `author_name` | 作者昵称 |
| `title` | 标题，可空 |
| `content` | 正文/描述 |
| `keyword` | 触发采集的关键词 |
| `engagement` | 点赞/互动汇总 |
| `published_at` | 发布时间，可空 |
| `collected_at` | 采集时间 |
| `raw_json` | 原始记录 |

评论字段：

| 标准字段 | 含义 |
| --- | --- |
| `post_id` | 关联内容 ID |
| `external_id` | 平台评论 ID |
| `author_name` | 评论作者 |
| `content` | 评论文本 |
| `like_count` | 评论点赞数 |
| `published_at` | 评论时间，可空 |
| `raw_json` | 原始评论 |

### 8.4 去重规则

- 帖子唯一键：`platform + external_id`。
- 评论唯一键：`platform + external_id`。
- 如果平台缺少 ID，用 `platform + url + content_hash` 生成稳定 ID。
- 同一评论重复入库时更新互动量和 raw_json，不重复创建。

### 8.5 部分失败处理

adapter 遇到单条坏数据时不得中断整个任务：

- 将坏数据写入 `adapter_errors` 日志或 `agent_runs.output_json`。
- 统计 `parsed_count`、`inserted_posts`、`inserted_comments`、`failed_records`。
- 失败比例超过 30% 时任务标记为 `partial` 或 `failed`。

## 9. DeepSeek 议题分析 Agent

现有代码里已有 `workers/agents/sentiment_agent.py` 和 `src/deepseek-agent.js`。本 PRD 不要求保留“只做情感分析”的旧语义，后续实现应将其演进为“议题分析 Agent”：

- Python 逐评论分析优先升级 `workers/agents/sentiment_agent.py`。
- Node 聚合策略分析优先升级 `src/deepseek-agent.js`。
- 文件名可以后续重命名，但第一阶段可以保留旧文件名，避免一次性大规模迁移。
- API 输出必须按本节字段扩展，不得只返回 `sentiment/score/topics/risks/evidence`。

### 9.0 算法与 Agent 分工

首版采用“确定性算法 + Agent 理解”的混合方案：

- 确定性算法负责评论权重、热度分、聚合占比、趋势计算。
- DeepSeek Agent 负责理解评论表达的具体议题、立场、风险、证据和营销含义。
- Agent 不直接决定评论权重，避免模型输出不稳定导致同一批数据多次分析结果不一致。
- 聚合结论必须同时展示加权结果和原始评论数，避免高赞少数意见被误读为全体意见。

### 9.0A 多 Agent 协作模型

系统采用多 Agent/worker 协作，但不是让每个 Agent 都自由读写结论。每个 Agent 有明确输入、输出和边界：

| Agent/worker | 职责 | 可并行性 | 输出 |
| --- | --- | --- | --- |
| 采集 Agent | 调用 MediaCrawler 做 search/detail 真实采集 | 可按平台排队并行，首版同平台串行 | JSONL、采集任务状态 |
| Adapter Agent | 解析 JSONL、标准化、去重入库 | 可在不同任务之间并行 | `discovered_targets`、`social_posts`、`social_comments` |
| 议题分析 Agent | 调用 DeepSeek 分析评论议题、立场、风险和证据 | 可批量并行，受 API 限流控制 | `sentiment_results` |
| 事件归并 Agent | 把评论和候选归并为艺人舆情事件 | 与新采集并行，但同一项目串行更新事件 | `artist_public_opinion_events`、事件证据 |
| 策略 Agent | 基于事件、趋势和证据生成宣发建议 | 事件分析完成后触发 | `strategy_reports`、事件应对动作 |
| 记忆 Agent | 把关键事实、事件、策略和用户偏好写入长期记忆 | 可异步执行 | `bot_memory_items` |
| 简报 Agent | 生成每日 Markdown 简报 | 定时或人工触发 | `daily_reports`、Markdown 文件 |
| 机器人 Agent | 检索长期记忆并回答用户问题 | 用户提问时触发 | `bot_messages` |

并行约束：

- 采集新数据时，可以同时分析上一批已入库评论。
- DeepSeek 分析失败不能阻塞后续采集。
- 同一事件的状态更新必须串行，避免两个 Agent 同时把事件改成不同状态。
- Agent 输出必须写入数据库或报告文件，不允许只存在内存里。
- 每次 Agent 执行必须写 `agent_runs`，包括输入摘要、输出摘要、状态、错误信息和耗时。
- 前端多 Agent 状态面板必须显示每类 Agent 最近一次运行状态。

### 9.1 触发时机

评论入库后异步执行。每次采集任务结束后，系统创建议题分析批次：

```text
待分析评论 = social_comments 中没有 deepseek-chat sentiment_results 的评论
```

### 9.2 输出字段

每条评论输出的不应只有正向/负向，而应包含具体议题、立场、情绪强度、风险和证据。正向/负向/中性只是其中一个字段。

每条评论输出：

- `sentiment`：`positive` / `neutral` / `negative`
- `score`：-1 到 1
- `confidence`：0 到 1
- `topics`：话题标签数组
- `risks`：风险标签数组
- `stance`：评论对议题的具体立场，例如期待、质疑、担忧、反感、建议、求证、玩梗。
- `issue_summary`：一句话概括评论在讨论什么具体问题。
- `intensity`：1 到 5，表示表达强度。
- `weight`：系统根据获赞数等指标计算出的评论权重，Agent 不直接决定权重。
- `evidence`：证据短句
- `model`：`deepseek-chat`

### 9.3 评论权重算法

评论权重由确定性算法计算，不交给 Agent 自由判断。首版算法：

```text
base_weight = log10(like_count + 1) + 1
reply_bonus = min(reply_count, 20) * 0.03
author_bonus = 0.2 if author_is_verified else 0
recency_decay = max(0.6, 1 - hours_since_collected / 168 * 0.4)
comment_weight = round((base_weight + reply_bonus + author_bonus) * recency_decay, 4)
```

解释：

- `like_count` 是主因，高赞评论权重大。
- 使用 `log10` 防止单条超高赞评论完全支配结论。
- 有回复的评论代表讨论链路更强，给轻微加成。
- 认证作者可轻微加成，但不得压过普通用户高赞评论。
- 时间衰减只轻微影响，避免一周前的高热争议永久支配结论。

聚合分析时，议题占比、风险占比和情绪占比都应使用 `comment_weight` 加权，同时保留未加权评论数。

失败时：

- 不删除评论。
- 记录 `deepseek_failed`。
- 可使用本地规则生成兜底结果，但前端必须标明 `本地规则兜底`。

### 9.4 影视舆情标签

首版内置标签：

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

## 9A. 艺人舆情事件模型

艺人舆情事件是当前 MVP 的核心分析对象。系统不能只展示“刘昊然负向 32%”“李兰迪正向 41%”这类抽象数字，而要把舆论里正在发生的事情讲清楚：

- 事件是什么。
- 为什么发生。
- 从哪个平台开始扩散。
- 哪些候选内容和评论能证明它存在。
- 主要人群立场是什么。
- 当前是升温、观察、降温还是已解决。
- 对《海岛舒服日志》的上线、路人盘、粉丝盘、口碑和宣发节奏有什么影响。
- 明天应该做什么动作。

### 9A.1 事件识别来源

事件识别来自以下数据：

- 被用户选择并采集评论的候选内容。
- 高热候选但尚未采评论的标题、摘要和互动数据。
- DeepSeek 议题分析结果中的 `topics`、`risks`、`stance`、`issue_summary`。
- 加权后的评论聚合结果。
- 连续采集批次中的趋势变化。
- 用户在机器人对话中明确指出的事件或偏好。

系统不得凭空生成事件。每个事件至少要有：

- 1 个候选内容证据，或
- 3 条真实评论证据，或
- 1 条高热负向评论证据。

证据不足时，系统只能标记为“观察线索”，不能升级为正式事件。

### 9A.2 事件类型

首版事件类型固定为：

| 事件类型 | 含义 | 示例 |
| --- | --- | --- |
| `actor_reputation` | 艺人口碑事件 | 演技争议、过往事件再传播、路人好感变化 |
| `casting_match` | 选角和搭配事件 | 刘昊然/李兰迪 CP 感、年龄感、角色适配度争议 |
| `official_announcement` | 官宣可信度事件 | 非官宣不信、溜粉、物料真实性质疑 |
| `language_region` | 语言地域事件 | 粤语、海岛地域表达、方言真实性讨论 |
| `visual_material` | 物料视觉事件 | 妆造、海报、预告、路透视觉反馈 |
| `fan_conflict` | 粉丝争议事件 | 控评、互撕、粉圈对立、拉踩 |
| `market_interest` | 市场兴趣事件 | 想看、无感、题材疲劳、播出意愿 |
| `release_rhythm` | 宣发节奏事件 | 定档节奏、预告释放、平台预约、热度承接 |

### 9A.3 事件字段

每个事件必须结构化保存以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event_id` | string | 系统事件 ID |
| `project_id` | string | 固定关联《海岛舒服日志》项目 |
| `event_title` | string | 一句话事件标题，例如“刘昊然粤语表现被集中讨论” |
| `event_type` | enum | 使用第 9A.2 节事件类型 |
| `related_artists` | array | `刘昊然`、`李兰迪`、`both`、`none` |
| `related_drama` | string | 固定为《海岛舒服日志》 |
| `trigger_summary` | text | 事件触发原因 |
| `current_status` | enum | `new` / `observing` / `escalating` / `cooling` / `resolved` |
| `risk_level` | enum | `low` / `medium` / `high` / `critical` |
| `first_seen_at` | datetime | 首次发现时间 |
| `last_seen_at` | datetime | 最近一次有证据更新时间 |
| `timeline_json` | JSON | 时间线节点 |
| `platform_distribution_json` | JSON | 小红书/抖音/微博分布 |
| `stance_distribution_json` | JSON | 加权立场分布和原始评论数 |
| `key_evidence_json` | JSON | 候选 ID、评论 ID、证据句 |
| `impact_assessment` | text | 对剧集宣发影响评估 |
| `recommended_actions` | JSON | 应对或营销动作 |
| `next_check_at` | datetime | 下次观察时间 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

### 9A.4 事件状态流转

事件状态规则：

| 状态 | 进入条件 | 退出条件 |
| --- | --- | --- |
| `new` | 第一次达到正式事件证据门槛 | 完成首次影响评估后转入 `observing` 或 `escalating` |
| `observing` | 有讨论但未持续升温 | 风险上升转 `escalating`；连续低热转 `cooling` |
| `escalating` | 加权负向、风险标签或高热评论连续上升 | 应对后下降转 `cooling`；风险继续扩大保持 |
| `cooling` | 声量和风险下降，但仍有残余讨论 | 连续两个采集周期低风险转 `resolved`；反弹转 `escalating` |
| `resolved` | 事件对宣发动作不再有明显影响 | 新证据重新升温时重开为 `observing` 或 `escalating` |

事件状态由确定性规则初判，DeepSeek Agent 负责解释原因和给出建议。Agent 不能绕过证据门槛直接创建高风险事件。

### 9A.5 事件聚合算法

事件聚合采用“规则召回 + Agent 归并”的混合方式：

1. 规则召回候选评论：按演员名、剧名、风险标签、议题标签、关键词命中召回评论。
2. 计算评论权重：使用第 9.3 节 `comment_weight`。
3. 生成议题簇：按 `topics + risks + stance + related_artist` 分组，得到候选事件簇。
4. 计算事件分数：

```text
event_heat = sum(comment_weight) + log10(sum(post_hot_score) + 1)
negative_pressure = weighted_negative_ratio * log10(weighted_comment_count + 1)
risk_pressure = weighted_risk_ratio * log10(weighted_comment_count + 1)
event_score = round(event_heat * 0.5 + negative_pressure * 0.3 + risk_pressure * 0.2, 4)
```

5. DeepSeek Agent 对候选事件簇进行归并：判断是否为同一事件、生成事件标题、复盘起因、提炼主要立场。
6. 系统写入或更新事件表：相同艺人、相同事件类型、相近议题且 72 小时内持续出现，优先更新同一事件；否则新建事件。

聚合结果必须同时展示：

- 加权评论数。
- 原始评论数。
- 正向/中性/负向加权占比。
- 主要立场加权占比。
- 平台分布。
- 代表性证据。

### 9A.6 影响评估维度

每个事件必须输出对《海岛舒服日志》的影响评估，至少覆盖：

| 维度 | 问题 |
| --- | --- |
| 上线风险 | 是否影响观众对剧集上线的期待或抵触 |
| 路人转化 | 是否帮助或阻碍非粉丝用户产生观看兴趣 |
| 粉丝盘稳定 | 是否引发粉丝争议、控评、互撕或脱粉情绪 |
| 物料节奏 | 是否需要提前、延后或调整预告/海报/花絮释放 |
| 平台策略 | 小红书、抖音、微博分别应该如何处理 |
| 公关动作 | 是否需要澄清、降温、转移议题或保持观察 |

影响评估必须分为三层：

- `事实`：真实数据和证据，例如候选、评论、时间、互动量。
- `判断`：基于事实的分析，例如“争议集中在微博粉丝圈，路人盘尚未明显扩散”。
- `建议`：可执行动作，例如“微博暂不扩大话题，小红书补充轻生活向物料，抖音投放角色氛围短视频”。

### 9A.7 应对方案输出格式

每个事件的应对方案必须可执行，格式如下：

| 字段 | 说明 |
| --- | --- |
| `action_type` | `observe` / `clarify` / `shift_topic` / `amplify_positive` / `release_material` / `pause_campaign` |
| `platform` | `xiaohongshu` / `douyin` / `weibo` / `all` |
| `action` | 具体动作 |
| `reason` | 为什么这样做 |
| `evidence_ids` | 支撑该动作的候选或评论 ID |
| `priority` | `low` / `medium` / `high` |
| `owner_suggestion` | 建议负责角色，例如宣发、艺人经纪、公关、内容运营 |
| `check_after_hours` | 几小时后复查 |

示例：

```json
{
  "action_type": "release_material",
  "platform": "xiaohongshu",
  "action": "发布一组海岛生活感双人剧照，文案避开争议词，强调角色关系和治愈氛围",
  "reason": "负向主要来自官宣不确定和角色适配疑虑，小红书用户对视觉氛围和生活方式反馈更敏感",
  "evidence_ids": ["target_1024", "comment_8831", "comment_8842"],
  "priority": "medium",
  "owner_suggestion": "内容运营",
  "check_after_hours": 24
}
```

### 9A.8 机器人事件问答要求

长期记忆机器人必须支持事件追问：

- “把刘昊然最近这个事件讲清楚。”
- “李兰迪这两天的主要争议是什么？”
- “这个粤语讨论会不会影响《海岛舒服日志》上线？”
- “昨天建议发小红书物料，今天数据有没有改善？”
- “微博这个事件现在是升温还是降温？”

回答必须引用 `event_id`、候选 ID、评论 ID 或日报 ID。若没有足够证据，必须回答“当前只能作为观察线索，证据不足以定性为事件”。

## 10. 风险触发与二级评论补采

### 10.1 风险触发条件

满足任一条件触发风险：

- 负向率 ≥ 25%。
- 单一风险标签评论数 ≥ 10。
- 同一关键词连续两次采集负向率上升。
- 高热负向评论点赞数进入 Top 10。
- 出现关键词：`非官宣不信`、`溜粉`、`辟谣`、`粤语`、`演技`、`扑`、`诈骗宣发`、`控评`。
- 艺人舆情事件状态从 `observing` 升级为 `escalating`。

### 10.2 二级评论补采

风险触发后创建 detail 补采任务：

- 目标为高热负向内容。
- `ENABLE_GET_SUB_COMMENTS=True`。
- 每条内容最多补采 50 条二级评论。
- 补采任务必须独立记录，不能覆盖原始 search 任务。

## 11. 看板需求

### 11.1 顶部状态

显示：

- 当前项目名。
- 数据模式：`real-data-only`。
- MySQL 状态。
- Chrome CDP 状态。
- MediaCrawler 版本状态。
- 小红书/抖音/微博登录态状态。

### 11.2 KPI

显示：

- 总评论数。
- 总内容数。
- 热度指数。
- 正向率。
- 负向率。
- 风险分。
- 待分析评论数。
- 今日新增评论数。

### 11.3 图表

必须包含：

- 三平台声量柱状图。
- 情绪结构图。
- 按小时趋势图。
- 风险标签排行。
- 演员提及排行。
- 关键词表现排行。
- 艺人舆情事件状态分布图。
- 事件热度与风险趋势图。

图表无数据时显示“等待真实采集”，不得显示 mock 图形。

图表和文字必须同步：

- 同一张看板中的 KPI、图表、事件摘要、策略建议必须来自同一时间窗口和同一批 MySQL 聚合结果。
- 文字结论引用的数字必须能在图表或证据面板中找到。
- 图表筛选条件变化时，文字摘要和策略建议必须同步刷新或标明“尚未重新生成”。
- 加权占比和原始评论数必须同时展示，避免只看比例误判规模。

### 11.4 任务面板

显示最近 20 个采集任务：

- 平台。
- 关键词。
- 状态。
- 创建时间。
- 开始/结束时间。
- 采集内容数。
- 采集评论数。
- 错误类型。
- 错误详情。
- 原始 JSONL 路径。

### 11.5 评论证据面板

显示可筛选评论：

- 平台。
- 关键词。
- 情绪。
- 风险标签。
- 作者。
- 评论内容。
- 点赞数。
- 原始链接。
- DeepSeek 证据句。

默认按热度和风险排序。

### 11.6 热度候选面板

显示每个平台每个关键词的热度前十候选：

- 平台。
- 关键词。
- 候选类型。
- 标题。
- 摘要。
- 作者。
- 热度分。
- 点赞/评论/分享/收藏。
- 排名。
- 是否已选择。
- 是否已采评论。
- 原始链接。

用户操作：

- 勾选候选。
- 批量选择。
- 忽略候选。
- 对已选择候选发起精确评论采集。
- 查看候选对应的已采评论和分析结果。

### 11.6A 艺人舆情事件面板

显示刘昊然、李兰迪和剧集市场反应的事件卡片：

- 事件标题。
- 相关艺人。
- 事件类型。
- 当前状态。
- 风险等级。
- 事件分数。
- 原始评论数。
- 加权评论数。
- 三平台分布。
- 主要立场。
- 影响短评。
- 下一次观察时间。

用户操作：

- 打开事件详情。
- 查看事件时间线。
- 查看证据候选和证据评论。
- 查看应对方案。
- 标记事件状态。
- 记录应对动作反馈。

事件详情必须把图表和文字结合展示：

- 左侧为时间线和平台分布。
- 中部为代表评论和候选证据。
- 右侧为影响评估和应对方案。
- 不允许只给大段模型文字而没有证据。

### 11.7 长期记忆问答机器人

看板新增问答机器人入口。机器人必须能回答：

- 当前项目整体舆情如何？
- 今天与昨天相比，负向是否升高？
- 哪个平台风险最大？
- 哪些候选内容值得继续追踪？
- 用户上次选择了哪些候选？
- 上次策略建议是什么，当前数据是否验证了它？
- 关于刘昊然/李兰迪/官宣/粤语争议，历史变化是什么？

回答必须引用数据来源：

- 引用候选 ID。
- 引用评论 ID。
- 引用日报。
- 引用策略报告。

如果没有数据，机器人必须明确说“当前没有真实数据支撑”，不能编造结论。

## 12. Markdown 简报

系统每天生成 Markdown 简报，保存到：

```text
reports/<project_slug>/<YYYY-MM-DD>.md
```

简报包括：

- 数据时间范围。
- 三平台总览。
- 情绪结构。
- 风险变化。
- 高热正向评论。
- 高热负向评论。
- 演员/关键词表现。
- 分平台营销建议。
- 明日监控动作。
- 数据覆盖与采集失败说明。

无真实数据时也生成简报，但内容必须说明“今日无真实评论入库”。

## 12A. 长期记忆问答机器人

问答机器人是系统的最终入口之一，不替代看板，而是让用户用自然语言追问看板背后的证据和历史。

### 12A.1 记忆来源

机器人长期记忆来自：

- 项目基础信息：项目名、类型、监控平台、关键词、演员词包。
- 用户选择记录：选择过的候选内容、忽略过的候选内容、选择原因。
- 采集事实：采集时间、平台、关键词、评论数量、失败原因。
- 情感摘要：每次分析后的正/中/负比例、风险标签、代表性评论。
- 风险事件：负向升高、官宣可信度风险、粉丝争议、语言争议等。
- 策略建议：DeepSeek Agent 和系统生成的宣发动作。
- 每日简报：Markdown 日报摘要。
- 用户问答：用户追问和系统回答中的偏好、判断和决策。

### 12A.2 记忆写入规则

以下事件必须写入 `bot_memory_items`：

- 新项目创建或项目配置变化。
- 用户选择候选。
- 用户忽略候选。
- 评论采集完成。
- DeepSeek 分析完成。
- 风险告警生成。
- 策略报告生成。
- Markdown 日报生成。
- 用户明确表达偏好，例如“以后重点看微博词条”“不要分析粉丝控评帖”。

### 12A.3 记忆检索规则

机器人回答前必须检索：

- 当前项目记忆。
- 最近 7 天相关记忆。
- 与问题关键词匹配的候选、评论、风险和策略。
- 用户历史偏好。

首版检索方式：

- MySQL 条件查询：项目、时间、平台、关键词、演员、风险标签。
- MySQL 文本匹配：`content/title/summary`。
- importance 高的记忆优先。

后续增强：

- 为 `bot_memory_items` 增加 embedding。
- 接入向量检索。
- 支持跨项目对比。

### 12A.4 回答规则

机器人必须：

- 使用真实数据回答。
- 引用候选 ID、评论 ID、报告 ID 或策略报告 ID。
- 区分“事实”“推断”“建议”。
- 数据不足时明确说数据不足。
- 不得编造平台评论、热度数字、演员争议。
- 不得把 mock 或历史 PPT 参考样本说成实时真实评论。

### 12A.5 示例问题

- “今天《海岛舒服日志》的主要风险是什么？”
- “微博上为什么负向变多了？”
- “刘昊然相关评论和李兰迪相关评论有什么差异？”
- “哪些高热候选值得继续采评论？”
- “昨天我们选择过哪些候选？今天这些候选的情绪有没有变化？”
- “给我一份明天小红书、抖音、微博分别怎么投内容的建议。”

## 13. API 需求

保留现有：

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/stream`
- `POST /api/migrate`
- `POST /api/collect`

新增建议：

- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/retry`
- `POST /api/tasks/:id/analyze`
- `GET /api/comments`
- `GET /api/reports/latest`
- `POST /api/reports/generate`
- `POST /api/discovery`：按项目、平台、关键词创建热度发现任务。
- `GET /api/discovery/targets`：查看热度前十候选。
- `POST /api/discovery/targets/select`：选择候选进入精确评论采集。
- `POST /api/discovery/targets/ignore`：忽略不相关候选。
- `POST /api/discovery/targets/:id/collect-comments`：对单个候选采集评论。
- `POST /api/bot/conversations`：创建机器人对话。
- `GET /api/bot/conversations`：查看历史对话。
- `POST /api/bot/conversations/:id/messages`：向长期记忆机器人提问。
- `GET /api/bot/memory`：查看项目记忆条目。
- `GET /api/events`：查看艺人舆情事件列表。
- `GET /api/events/:id`：查看事件详情、时间线、证据和应对方案。
- `POST /api/events/:id/reanalyze`：基于最新评论重新分析事件。
- `PATCH /api/events/:id/status`：人工确认事件状态，例如标记为已处理或继续观察。
- `POST /api/events/:id/actions/:action_id/feedback`：记录宣发动作执行反馈，供机器人长期记忆使用。

首版如果不做完整 REST，可以先用 worker 子命令实现，但 API 名称和返回结构按此设计。

### 13.1 固定项目配置 API

MVP 启动时必须存在一个默认项目：

```json
{
  "project_name": "海岛舒服日志",
  "project_type": "drama",
  "monitored_artists": ["刘昊然", "李兰迪"],
  "platforms": ["xiaohongshu", "douyin", "weibo"],
  "mode": "single_drama_mvp"
}
```

如果 `POST /api/projects` 暂不开放给用户，系统也必须通过 migration 或启动初始化创建该项目。前端不得要求用户先创建通用项目才能进入看板。

### 13.2 事件列表返回结构

`GET /api/events` 返回：

```json
{
  "events": [
    {
      "event_id": "evt_20260608_001",
      "event_title": "刘昊然粤语表现被集中讨论",
      "event_type": "language_region",
      "related_artists": ["刘昊然"],
      "current_status": "observing",
      "risk_level": "medium",
      "event_score": 8.42,
      "raw_comment_count": 73,
      "weighted_comment_count": 126.8,
      "platform_distribution": {
        "xiaohongshu": 0.31,
        "douyin": 0.22,
        "weibo": 0.47
      },
      "dominant_stances": ["担忧", "求证", "玩梗"],
      "impact_short": "讨论集中在表达真实性，对剧集整体期待尚未转负，但需要用物料降低不确定感。",
      "next_check_at": "2026-06-09T10:00:00+08:00",
      "updated_at": "2026-06-08T18:30:00+08:00"
    }
  ]
}
```

事件详情必须包含：

- 时间线。
- 代表候选。
- 代表评论。
- 加权和未加权分布。
- DeepSeek 事件复盘。
- 影响评估。
- 应对方案。
- 历史状态变化。

## 14. MySQL 变更建议

当前项目已经有 `migrations/001_enterprise_mysql.sql`，其中包含 `monitor_projects`、`platform_auth_states`、`collection_tasks`、`social_posts`、`social_comments`、`sentiment_results`、`agent_runs`、`strategy_reports`。本 PRD 不要求推翻现有 schema，而是在现有表上做企业级扩展，并新增候选、事件、机器人和日报表。

新 migration 必须满足：

- 可重复执行，不破坏已有真实数据。
- 不删除现有字段。
- 新字段有安全默认值或允许为空。
- 枚举值扩展时要兼容旧数据，例如 `platform_auth_states.status='configured'` 可映射为 `valid` 或保留兼容。
- 所有新增表使用 `utf8mb4_unicode_ci`。
- 所有真实采集、分析、事件和机器人结果都必须能追溯到 `project_id`。

### `monitor_projects`

现有表继续使用，但 MVP 必须初始化一条默认项目：

```json
{
  "project_name": "海岛舒服日志",
  "category": "drama",
  "audience": "影视剧上线前后宣发监控",
  "keywords": {
    "drama": ["海岛舒服日志", "海岛舒服日志 官宣", "海岛舒服日志 定档", "海岛舒服日志 预告", "海岛舒服日志 粤语"],
    "liu_haoran": ["刘昊然", "刘昊然 海岛舒服日志", "刘昊然 新剧", "刘昊然 演技", "刘昊然 粤语"],
    "li_landi": ["李兰迪", "李兰迪 海岛舒服日志", "李兰迪 新剧", "李兰迪 演技", "李兰迪 粤语"]
  },
  "actors": ["刘昊然", "李兰迪"],
  "active_platforms": ["xiaohongshu", "douyin", "weibo"]
}
```

### `platform_auth_states`

现有表继续使用，但建议扩展：

- `account_label`，采集账号标识，例如 `xhs_ops_01`。
- `login_method`：`cdp` / `cookie` / `qrcode` / `phone`。
- `status` 扩展为：`missing` / `configured` / `valid` / `expired` / `verification_required` / `rate_limited` / `invalid` / `unknown`。
- `last_success_at`，最近一次采集成功时间。
- `last_error_type`。
- `last_error_message`。

兼容规则：

- 旧值 `configured` 在 health 展示时可以视为“已配置但未验证”。
- 新采集任务启动前必须把平台状态验证为 `valid` 或兼容的 `configured`。
- 若出现验证码、二维码、手机号验证、滑块验证，更新为 `verification_required`。

### `collection_tasks`

新增：

- `crawler_engine`：固定 `mediacrawler`。
- `crawler_type`：`search` / `detail`。
- `error_type`。
- `output_path`。
- `raw_files` JSON。
- `parsed_records`。
- `failed_records`。
- `enable_sub_comments`。
- `target_id` 可空，detail 任务关联 `discovered_targets.id`。
- `requested_limit` 默认从现有 50 改为 100。
- `schedule_id` 可空。

建议扩展状态为：

```text
queued / running / succeeded / failed / partial / analyzing / analyzed
```

### `social_posts`

新增：

- `comment_count`。
- `share_count`。
- `collect_count`。
- `source_keyword`。

### `social_comments`

新增：

- `parent_comment_id` 可空，用于二级评论。
- `reply_count`，一级评论回复数；平台无该字段时为 0。
- `sub_comment_count`。
- `author_is_verified`，评论作者是否认证；平台无该字段时为 false。
- `ip_location` 可空。
- `comment_weight`，确定性算法计算出的评论权重。
- `weight_version`，评论权重算法版本，例如 `v1_log_like_reply_recency`。

### `sentiment_results`

现有表继续使用，但要从简单情感结果扩展为议题分析结果。

新增：

- `stance`，评论立场，例如期待、质疑、担忧、反感、建议、求证、玩梗。
- `issue_summary`，一句话概括评论讨论的具体问题。
- `intensity`，1 到 5。
- `weight`，分析时读取的评论权重快照。
- `analysis_json`，保存 DeepSeek 原始结构化输出。
- `fallback_type`：`none` / `local_rule` / `manual`。
- `analyzed_at`。

兼容规则：

- 现有 `sentiment`、`score`、`confidence`、`topics`、`risks`、`evidence` 保留。
- 前端图表可以继续使用 `sentiment`，但事件归并和策略建议必须使用 `topics`、`risks`、`stance`、`issue_summary` 和 `weight`。

### 新表：`daily_reports`

字段：

- `id`
- `project_id`
- `report_date`
- `markdown_path`
- `summary`
- `generated_by`
- `created_at`

### 新表：`alert_events`

字段：

- `id`
- `project_id`
- `alert_type`
- `severity`
- `platform`
- `keyword`
- `message`
- `evidence_json`
- `resolved_at`
- `created_at`

### 新表：`artist_public_opinion_events`

用于保存刘昊然、李兰迪相关舆情事件，以及剧集市场反应事件。

字段：

- `id`
- `project_id`
- `event_title`
- `event_type`：`actor_reputation` / `casting_match` / `official_announcement` / `language_region` / `visual_material` / `fan_conflict` / `market_interest` / `release_rhythm`
- `related_artists` JSON
- `related_drama`
- `trigger_summary`
- `current_status`：`new` / `observing` / `escalating` / `cooling` / `resolved`
- `risk_level`：`low` / `medium` / `high` / `critical`
- `event_score`
- `raw_comment_count`
- `weighted_comment_count`
- `weighted_negative_ratio`
- `weighted_positive_ratio`
- `first_seen_at`
- `last_seen_at`
- `next_check_at`
- `timeline_json`
- `platform_distribution_json`
- `stance_distribution_json`
- `key_evidence_json`
- `impact_assessment`
- `recommended_actions_json`
- `agent_model`
- `agent_confidence`
- `created_at`
- `updated_at`

索引：

- `project_id + current_status`
- `project_id + risk_level`
- `project_id + event_type`
- `project_id + last_seen_at`

### 新表：`event_evidence_links`

用于把事件和证据关联起来。

字段：

- `id`
- `event_id`
- `source_type`：`target` / `post` / `comment` / `report` / `memory`
- `source_id`
- `platform`
- `evidence_text`
- `evidence_weight`
- `stance`
- `sentiment`
- `risk_tags` JSON
- `created_at`

唯一键：

```text
event_id + source_type + source_id
```

### 新表：`event_status_history`

用于记录事件状态变化，方便机器人回答“这个事件有没有降温”。

字段：

- `id`
- `event_id`
- `from_status`
- `to_status`
- `reason`
- `changed_by`：`system` / `deepseek` / `user`
- `evidence_json`
- `created_at`

### 新表：`event_action_feedback`

用于记录宣发动作执行和效果反馈。

字段：

- `id`
- `event_id`
- `action_id`
- `action_type`
- `platform`
- `action`
- `owner`
- `executed_status`：`planned` / `executed` / `skipped`
- `executed_at`
- `feedback`
- `effect_observation`
- `created_at`
- `updated_at`

### 新表：`discovered_targets`

用于保存热度发现阶段的候选内容。

字段：

- `id`
- `project_id`
- `task_id`
- `platform`
- `keyword`
- `target_type`：`note` / `video` / `weibo_topic` / `weibo_post`
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
- `rank_no`
- `selected_status`：`pending` / `selected` / `ignored`
- `selected_by`
- `selected_at`
- `raw_json`
- `created_at`

唯一键：

```text
platform + external_id
```

如果无 external_id，则使用：

```text
platform + url + title_hash
```

### 新表：`target_collection_links`

用于记录用户选择的候选和后续评论采集任务的关系。

字段：

- `id`
- `target_id`
- `collection_task_id`
- `trigger_type`：`manual_selection` / `risk_auto_recollect`
- `trigger_reason`
- `created_at`

### 新表：`bot_memory_items`

用于保存问答机器人的长期记忆。

字段：

- `id`
- `project_id`
- `memory_type`：`project_fact` / `selected_target` / `sentiment_summary` / `artist_event` / `risk_event` / `strategy` / `action_feedback` / `user_preference` / `qa_turn`
- `title`
- `content`
- `source_type`：`system` / `user` / `deepseek` / `report`
- `source_id`
- `importance`：1 到 5
- `embedding_status`：`pending` / `embedded` / `failed`
- `created_at`
- `updated_at`

### 新表：`bot_conversations`

字段：

- `id`
- `project_id`
- `title`
- `created_at`
- `updated_at`

### 新表：`bot_messages`

字段：

- `id`
- `conversation_id`
- `role`：`user` / `assistant` / `system`
- `content`
- `referenced_memory_ids` JSON
- `referenced_comment_ids` JSON
- `created_at`

首版可以不做向量数据库，先用 MySQL 全文检索和结构化筛选实现长期记忆检索；后续再加 embedding。

## 15. 工程实现分期

### Phase 1：MediaCrawler 运行环境检查

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
- 平台验证出现时显示 `platform_verification_required`。
- 页面显示错误，不影响 Web 服务运行。

### Phase 2：热度发现任务调用 MediaCrawler

目标：能对单个平台单个关键词运行 search 采集，并生成热度前十候选。

任务：

- 创建 `mediacrawler_adapter` worker。
- 为 `xhs/dy/wb` 生成运行配置。
- 调用 MediaCrawler CLI。
- 保存 JSONL 到任务目录。
- 解析候选内容。
- 计算 `hot_score`。
- 每个平台每个关键词写入前 10 条到 `discovered_targets`。
- 写入发现任务状态。

验收：

- 用户触发小红书关键词发现后生成任务。
- 页面出现热度前十候选。
- 任务成功或失败都有可读日志。
- 不产生非目标平台数据。

### Phase 3：候选选择与精确评论采集

目标：用户选择候选后，系统只对被选中的内容采集评论。

任务：

- 实现候选勾选、忽略、批量选择。
- 创建 `target_collection_links`。
- 对被选候选运行 MediaCrawler detail 采集。
- 默认采 100 条一级评论；不足 100 条时全量采集。
- 风险触发时创建二级评论补采任务。
- 保存 detail JSONL 到任务目录。

验收：

- 未选择候选时不采评论。
- 选择候选后能创建评论采集任务。
- 评论采集任务和候选内容能关联。

### Phase 4：JSONL 标准化入库

目标：MediaCrawler 输出进入企业表。

任务：

- 解析三平台 JSONL。
- 统一帖子字段。
- 统一评论字段。
- 关联 `discovered_targets`。
- 去重 upsert。
- 原始 JSON 写入 `raw_json`。
- 统计成功/失败记录。

验收：

- `social_posts` 有真实内容。
- `social_comments` 有真实评论。
- 重复运行不会重复插入。

### Phase 5：DeepSeek 异步分析

目标：评论入库后自动分析议题、立场、情绪、风险和证据。

任务：

- 查询待分析评论。
- 批量调用 DeepSeek。
- 写入 `sentiment_results`。
- 失败记录 agent 日志。
- 本地规则兜底必须标记。

验收：

- 评论有议题、立场、情绪、分数、风险标签和证据句。
- DeepSeek 失败时原始评论不丢失。

### Phase 6：艺人舆情事件归并

目标：把零散评论和议题分析归并成《海岛舒服日志》、刘昊然、李兰迪相关事件。

任务：

- 从 `sentiment_results` 读取评论议题、立场、风险和证据。
- 按演员、剧名、事件类型、风险标签召回候选评论。
- 使用评论权重和事件分数算法生成事件簇。
- 调用 DeepSeek 归并同类事件并生成标题、起因、影响评估和应对方案。
- 写入 `artist_public_opinion_events`。
- 写入 `event_evidence_links`。
- 写入 `event_status_history`。
- 需要人工动作时写入 `event_action_feedback` 初始计划。

验收：

- 刘昊然、李兰迪相关评论能归并为事件或观察线索。
- 每个正式事件至少有候选或评论证据。
- 事件包含状态、风险等级、影响评估和应对方案。
- 事件状态变化有历史记录。

### Phase 7：长期记忆问答机器人

目标：把候选选择、评论分析、艺人舆情事件、风险事件和策略沉淀为可追问的长期记忆。

任务：

- 写入 `bot_memory_items`。
- 创建 `bot_conversations` 和 `bot_messages`。
- 实现基于项目、关键词、演员、风险标签、事件 ID 的记忆检索。
- 机器人回答时引用事件 ID、候选 ID、评论 ID、日报或策略报告。
- 无真实数据时拒绝编造。

验收：

- 用户能问“今天负向为什么升高”并得到带引用的回答。
- 用户能问“把刘昊然最近这个事件讲清楚”并得到事件时间线、证据和建议。
- 用户能问“上次选择过哪些候选”并得到历史记录。
- 机器人回答能区分事实、推断、建议和无数据状态。

### Phase 8：看板升级

目标：前端展示真实采集闭环。

任务：

- 增加热度候选面板。
- 增加候选选择和精确采评按钮。
- 增加任务面板。
- 增加评论证据筛选。
- 增加风险标签排行。
- 增加艺人舆情事件面板。
- 增加事件详情、时间线、证据和应对动作。
- 增加 MediaCrawler 状态。
- 增加待分析评论数。
- 增加机器人入口。

验收：

- 无数据时显示等待真实采集。
- 有数据时图表、评论、策略同步。
- 事件面板能解释刘昊然、李兰迪相关事件对剧集宣发的影响。
- 候选发现、人工选择、评论采集状态清楚。
- 页面不显示非目标平台。

### Phase 9：每日 Markdown 简报

目标：形成可交付报告。

任务：

- 生成日报 worker。
- 汇总艺人舆情事件和事件状态变化。
- 保存 Markdown。
- API 返回最新报告。
- 前端展示报告入口。

验收：

- 每日能生成一份报告。
- 报告引用真实评论证据。
- 报告说明刘昊然、李兰迪相关事件是否升温或降温。
- 无数据日报说明数据缺口。

## 16. 测试计划

### 单元测试

- 平台白名单只允许 `xiaohongshu/douyin/weibo`。
- MediaCrawler 平台映射 `xhs/dy/wb` 正确。
- JSONL adapter 能处理缺字段、重复数据、坏行。
- 候选热度计算排序正确。
- 只保留每个平台每个关键词前 10 候选。
- 候选选择状态 `pending/selected/ignored` 流转正确。
- 议题分析结果解析能处理 DeepSeek JSON、Markdown 包裹 JSON、失败响应。
- 评论权重算法可复现，点赞数越高权重越高但不线性支配。
- 事件分数算法可复现。
- 事件证据门槛正确：证据不足只能成为观察线索。
- 事件状态 `new/observing/escalating/cooling/resolved` 流转正确。
- 风险触发规则正确。
- 机器人记忆检索不会返回其他项目的数据。

### 集成测试

- MySQL migration 成功。
- 默认《海岛舒服日志》项目初始化后能创建候选发现任务。
- 模拟 search JSONL 能入库到 `discovered_targets`。
- 选择候选后能创建评论采集任务。
- 模拟 detail JSONL 能入库到 `social_posts/social_comments`。
- 待分析评论能写入 `sentiment_results`。
- 议题分析结果能归并为 `artist_public_opinion_events`。
- 事件证据能写入 `event_evidence_links`。
- 分析摘要、用户选择、艺人事件、策略建议能写入 `bot_memory_items`。
- `/api/snapshot` 只聚合企业表数据。

### 端到端测试

- 在 CDP Chrome 已登录状态下，运行一个小红书关键词发现任务。
- search JSONL 文件生成。
- 页面展示热度前十候选。
- 用户选择一个候选。
- detail JSONL 文件生成。
- adapter 将评论入库。
- DeepSeek 分析完成。
- 艺人舆情事件生成或观察线索生成。
- 机器人能基于刚刚分析的评论回答问题并引用来源。
- 机器人能回答“把刘昊然最近这个事件讲清楚”并引用事件、候选和评论。
- 看板出现真实评论和策略建议。
- 页面没有 News/Bilibili/Reddit 等非目标平台。

### 回归测试

- `POST /api/items` 继续拒绝 mock 注入。
- MySQL 断开时系统显示阻塞，不回退 mock。
- MediaCrawler 缺失时任务失败，Web 服务仍可用。

## 17. 验收标准

项目完成必须同时满足：

1. 服务仍固定运行在 `0.0.0.0:8787`。
2. 前端只显示小红书、抖音、微博。
3. 能在《海岛舒服日志》固定项目下创建关键词热度发现任务。
4. 至少一个平台能通过 MediaCrawler 发现热度前十候选。
5. 用户能选择候选内容。
6. 系统只对被选候选采集评论。
7. 原始 search/detail JSONL 保存在任务目录。
8. adapter 将候选、真实帖子、真实评论写入企业 MySQL 表。
9. DeepSeek Agent 写入议题分析结果。
10. 系统能生成或更新刘昊然、李兰迪相关艺人舆情事件。
11. 每个事件都有证据、状态、风险等级、影响评估和应对方案。
12. 看板 KPI、图表、候选、评论证据、事件和策略建议来自 MySQL。
13. 问答机器人能使用长期记忆回答项目舆情问题，并引用事件/候选/评论/报告。
14. 前面已规划的看板、趋势预测、多 Agent、营销策略、Markdown 简报都保留。
15. 无数据、无登录态、无 MySQL 时不展示 mock 数据。
16. 全套测试通过。
17. 生成至少一份 Markdown 简报。
18. README 写明部署、配置、采集、排错步骤。

## 18. 初级工程师实施说明

实现时按以下顺序，不要跳步：

1. 先让 MySQL 跑起来，并执行 migration。
2. 再把 MediaCrawler clone 到独立目录，锁 commit。
3. 按 MediaCrawler 文档启动 Chrome CDP，确认端口 `9222` 可用。
4. 手工在 MediaCrawler 目录跑一次 `xhs` 搜索命令，确认能生成 search JSONL。
5. 回到主系统，实现 adapter 读取 search JSONL，并写入 `discovered_targets`。
6. 用模拟 search JSONL 写候选 adapter 单元测试。
7. 候选 adapter 测试通过后，再做前端候选选择。
8. 用户选择候选后，再实现 detail 评论采集。
9. 用模拟 detail JSONL 写评论 adapter 单元测试。
10. 评论入库后，再接 DeepSeek 分析。
11. DeepSeek 议题分析稳定后，再做艺人舆情事件归并。
12. 事件能生成和更新后，再写入长期记忆并接机器人。
13. 最后改完整前端看板，不要先做 UI。

每一步都必须有可见证据：命令输出、数据库记录、API 返回或测试结果。

## 19. 参考资料

- MediaCrawler README：支持 CDP Chrome、`--platform`、`--type search/detail`、WebUI、JSONL/DB 等数据保存方式。
- MediaCrawler `config/base_config.py`：包含 `ENABLE_CDP_MODE`、`CDP_DEBUG_PORT`、`SAVE_DATA_OPTION`、`CRAWLER_MAX_NOTES_COUNT`、`ENABLE_GET_COMMENTS`、`CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES`、`ENABLE_GET_SUB_COMMENTS` 等配置。
- 本项目现有文档：`README.md`、`docs/DESIGN.md`。

## 20. 初级工程师任务卡

这一节用于把 PRD 直接拆成可领取任务。每张任务卡都必须独立提交、独立测试、独立验收。

### Task 1：补全 MySQL migration

目标：让数据库支持候选发现、候选选择、艺人舆情事件、机器人记忆和日报。

输入：

- 现有 `migrations/001_enterprise_mysql.sql`。
- 本 PRD 第 14 节表结构。

输出：

- 新 migration 文件。
- 数据库能创建新增表和新增字段。

完成定义：

- migration 可重复执行，不破坏已有表。
- `discovered_targets`、`target_collection_links`、`artist_public_opinion_events`、`event_evidence_links`、`event_status_history`、`event_action_feedback`、`bot_memory_items`、`bot_conversations`、`bot_messages`、`daily_reports`、`alert_events` 可正常创建。
- 有测试或 SQL 检查证明表存在。

### Task 2：实现 MediaCrawler 环境检查

目标：系统能判断 MediaCrawler、Chrome CDP、版本锁和三平台登录态是否可用。

输入：

- `.env` 中的 `MEDIACRAWLER_HOME`、`MEDIACRAWLER_COMMIT`、`MEDIACRAWLER_PYTHON`、`MEDIACRAWLER_CDP_PORT`。
- `platform_auth_states` 或等价状态表中的小红书、抖音、微博登录态记录。

输出：

- `/api/health` 返回 MediaCrawler 状态。
- 前端企业数据状态面板显示 MediaCrawler 状态。

完成定义：

- MediaCrawler 缺失时显示 `mediacrawler_missing`。
- commit 不一致时显示 `mediacrawler_version_mismatch`。
- CDP 不可连接时显示 `chrome_cdp_unavailable`。
- 小红书、抖音、微博任一登录态缺失时显示平台级 `auth_required`。
- 平台验证出现时显示 `platform_verification_required`。
- Web 服务仍能正常打开。

### Task 3：实现热度发现 worker

目标：按项目、平台、关键词调用 MediaCrawler search，产出热度前十候选。

输入：

- 项目 ID。
- 平台：`xiaohongshu` / `douyin` / `weibo`。
- 关键词。

输出：

- search JSONL 原始文件。
- `discovered_targets` 记录。
- `collection_tasks` 任务状态。

完成定义：

- 每个平台每个关键词最多保留 10 条候选。
- 候选默认按平台原生 `candidate_rank` 展示；`hot_score` 仅用于解释热度和前端二次排序。
- 失败时有 `error_type` 和 `error_message`。
- 不写入非目标平台。

### Task 4：实现候选选择 API

目标：用户可以选择或忽略候选。

输入：

- 候选 ID 列表。
- 操作：`select` / `ignore`。

输出：

- `discovered_targets.selected_status` 更新。
- 被选择候选可进入评论采集。

完成定义：

- pending -> selected 成功。
- pending -> ignored 成功。
- ignored 候选默认不进入评论采集。
- 重复选择不会重复创建采集链路。

### Task 5：实现精确评论采集 worker

目标：只对用户选择的候选运行 MediaCrawler detail 评论采集。

输入：

- `target_id`。
- 评论上限，默认 100。
- 是否采二级评论，默认 false。

输出：

- detail JSONL 原始文件。
- `target_collection_links` 记录。
- `social_posts` 和 `social_comments` 记录。

完成定义：

- 未选择候选不能采评论。
- 已选择候选能创建 detail 任务。
- 同一评论重复采集不会重复插入。
- detail 任务和候选 ID 可追踪。

### Task 6：实现 JSONL adapter 测试夹具

目标：不用真实平台也能测试 adapter。

输入：

- 三平台模拟 search JSONL。
- 三平台模拟 detail JSONL。

输出：

- adapter 单元测试。

完成定义：

- xhs search JSONL 能生成笔记候选。
- dy search JSONL 能生成视频候选。
- wb search JSONL 能生成词条/博文候选。
- detail JSONL 能生成评论。
- 缺字段、坏行、重复行都有测试。

### Task 7：实现 DeepSeek 异步分析批次

目标：评论入库后批量分析议题、立场、情绪、风险和证据。

输入：

- 尚未有 `deepseek-chat` 结果的评论。

输出：

- `sentiment_results`。
- `agent_runs`。
- 必要时 `alert_events`。

完成定义：

- 成功评论有 sentiment、score、confidence、topics、risks、evidence。
- DeepSeek 失败不删除评论。
- 本地规则兜底时前端可识别。

### Task 8：实现艺人舆情事件归并 worker

目标：把 DeepSeek 议题分析结果归并为可复盘的艺人舆情事件。

输入：

- `sentiment_results`。
- `social_comments`。
- `discovered_targets`。
- 评论权重。
- 固定监控对象：刘昊然、李兰迪、《海岛舒服日志》。

输出：

- `artist_public_opinion_events`。
- `event_evidence_links`。
- `event_status_history`。
- 必要时 `event_action_feedback`。

完成定义：

- 证据不足时只生成观察线索，不生成正式高风险事件。
- 正式事件至少有候选或评论证据。
- 事件有标题、类型、相关艺人、状态、风险等级、影响评估、应对方案。
- 同一事件在 72 小时内再次出现时更新旧事件，不重复创建。

### Task 9：实现长期记忆写入

目标：关键业务事件进入机器人记忆。

输入：

- 用户选择候选。
- 评论采集完成。
- DeepSeek 分析完成。
- 艺人舆情事件创建或状态变化。
- 风险告警。
- 策略报告。
- 每日简报。
- 用户问答。

输出：

- `bot_memory_items`。

完成定义：

- 每类事件至少写入一条 memory。
- memory 有 project_id、memory_type、title、content、importance。
- 事件 memory 必须引用 `event_id`。
- 不跨项目污染。

### Task 10：实现问答机器人

目标：用户能基于长期记忆追问项目舆情。

输入：

- conversation_id。
- 用户问题。

输出：

- 机器人回答。
- 引用 event/memory/comment/report ID。
- `bot_messages` 记录。

完成定义：

- 无真实数据时明确拒绝编造。
- 有数据时回答引用来源。
- 能回答“上次选择了哪些候选”和“今天负向为什么升高”。
- 能回答“把刘昊然最近这个事件讲清楚”和“李兰迪这个争议对剧有什么影响”。

### Task 11：升级前端看板

目标：保留原看板功能，并新增候选、艺人事件和机器人入口。

输入：

- `/api/snapshot`。
- discovery API。
- events API。
- bot API。

输出：

- 企业状态面板。
- 热度候选面板。
- 任务面板。
- 评论证据面板。
- 风险图表。
- 艺人舆情事件面板。
- 事件详情页或详情抽屉。
- 机器人对话入口。

完成定义：

- 无数据时显示等待真实采集。
- 有候选时可选择和忽略。
- 有评论时图表和策略同步。
- 有事件时能查看时间线、证据、影响评估和应对动作。
- 页面不出现非目标平台。

### Task 12：实现 Markdown 日报

目标：每天产出可交付简报。

输入：

- 项目数据。
- 候选数据。
- 评论议题分析。
- 艺人舆情事件。
- 风险事件。
- 策略建议。

输出：

- `reports/<project_slug>/<YYYY-MM-DD>.md`。
- `daily_reports` 记录。

完成定义：

- 有数据日报引用真实评论证据。
- 日报说明刘昊然、李兰迪相关事件是否升温或降温。
- 无数据日报说明数据缺口。
- 日报摘要写入机器人记忆。

### Task 13：端到端验收

目标：验证完整闭环。

步骤：

1. 启动 MySQL。
2. 运行 migration。
3. 启动 Chrome CDP。
4. 确认 MediaCrawler 版本。
5. 创建关键词发现任务。
6. 选择一个候选。
7. 采集评论。
8. 分析议题、立场、情绪和风险。
9. 生成或更新艺人舆情事件。
10. 生成策略。
11. 向机器人提问。
12. 生成日报。

完成定义：

- 全链路至少跑通一个平台。
- 至少生成一个事件或一个观察线索。
- API、前端、MySQL、报告均有证据。
- 全套自动化测试通过。
