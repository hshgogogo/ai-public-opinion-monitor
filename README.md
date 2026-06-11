# AI舆情监测系统

## Weibo MVP

当前 OpenSpec change `haidao-weibo-agent-mvp` 将第一阶段收窄为 Weibo MVP：只验证《海岛舒服日志》在微博上的 Agent 工作流。No Xiaohongshu or Douyin collection is active in this MVP.

### Weibo MVP 环境变量

```bash
export MYSQL_URL='mysql://user:password@127.0.0.1:3306/yuqing_monitor'
export WEIBO_COOKIE_FILE='config/cookies/weibo.json'
export MEDIACRAWLER_HOME='../MediaCrawler'
export MEDIACRAWLER_COMMIT='<verified-commit>'
export MEDIACRAWLER_PYTHON='../MediaCrawler/.venv/bin/python'
export MEDIACRAWLER_OUTPUT_DIR='storage/mediacrawler'
export MEDIACRAWLER_CDP_PORT='9222'
```

不要提交 `.env`、`config/cookies/`、`storage/`、浏览器登录态或真实 API key。

### Fixture E2E

无需真实微博登录、Chrome CDP、MediaCrawler 或 MySQL，可先跑 fixture 闭环：

```bash
npm test
python workers/enterprise_worker.py weibo-fixture-e2e --now 2026-06-10T12:00:00Z
```

该命令会验证 migration 文件存在，解析微博搜索 fixture，推荐目标，选择目标，解析 detail 评论，做本地/fixture 分析，生成事件线索、行动记录、backtest unknown/信号结果、带引用的 Q&A，并渲染 workbench payload。

### Weibo Auth Troubleshooting

- `auth_required`: 检查 `WEIBO_COOKIE_FILE` 是否存在并指向本地 cookie 文件。
- `chrome_cdp_unavailable`: 检查 Chrome 是否开启 remote debugging，并确认 `MEDIACRAWLER_CDP_PORT`。
- `mediacrawler_missing`: 检查 `MEDIACRAWLER_HOME` 是否指向 MediaCrawler checkout。
- `target_detail_unsupported`: 目标缺少可用于 detail 采集的 `weibo_mid`、`external_id` 或详情 URL。
- `real_weibo_auth_missing`: fixture 模式未使用真实登录态；这是预期限制，不代表真实采集已完成。

### MVP Limitations

- 已完成 fixture-driven MySQL persistence，可在本地测试 Weibo task、target、detail posts/comments、event、action、memory/report 的部分入库链路。
- 已完成 MediaCrawler Weibo search adapter、task-specific output path、raw JSONL 归档和 search JSONL 入库链路；真实环境验收仍以 11.5 为准。
- 真实 MediaCrawler detail 仍未完成；当前不会对选中目标启动真实 detail 采集任务。
- 真实微博登录态、Chrome CDP、MediaCrawler 环境验收仍未完成。
- 真实 DeepSeek 事件解释仍未完成；当前事件标题、解释和行动建议以确定性/fixture 路径为主。
- 剩余未完成或部分保留的工作以 `openspec/changes/haidao-weibo-agent-mvp/tasks.md` 为准。
- Agent 不自动发帖，不保管账号密码，不绕过验证码或反爬机制。
- 没有足够 evidence 时，Q&A、report、backtest 必须返回 insufficient-data 或 unknown，不能编造事件、评论或行动效果。

面向影视制作公司的企业级 AI 舆情监测 Web 服务。系统限定监控小红书、抖音、微博，使用授权 Cookie 采集真实内容，写入本机 MySQL，并由 DeepSeek Agent 做逐评论情感分析和营销策略生成。

## 已实现

- 可运行 Web 服务，监听 `0.0.0.0` 后可供当前网段用户访问。
- 真实数据模式：无 MySQL、无 Cookie、无真实评论时不展示 mock 数据。
- 平台白名单：只允许小红书、抖音、微博。
- MySQL schema：项目、账号态、采集任务、帖子、评论、情感结果、Agent 日志、策略报告。
- 多 Agent：真实采集、清洗入库、DeepSeek 情感分析、策略输出。
- 数据可视化：热度趋势、6 小时预测、情绪结构、平台声量、议题分布。
- 测试覆盖：分析引擎、HTTP API、真实数据模式防 mock 注入。

## 运行

```bash
cd /Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor
HOST=0.0.0.0 PORT=8787 node src/server.js
```

本机访问：

```text
http://127.0.0.1:8787
```

## 企业配置

安装 Python worker 依赖：

```bash
/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pip install -r requirements.txt
```

Scrapling 与 crawl4ai 依赖的 `lxml` 主版本冲突，生产部署应放入两个隔离 worker 环境：

```bash
python -m venv .venv-scrapling && .venv-scrapling/bin/pip install -r requirements-scrapling.txt
python -m venv .venv-crawl4ai && .venv-crawl4ai/bin/pip install -r requirements-crawl4ai.txt
```

配置环境变量：

```bash
export MYSQL_URL='mysql://user:password@127.0.0.1:3306/yuqing_monitor'
export DEEPSEEK_API_KEY='sk-...'
export XHS_COOKIE_FILE='config/cookies/xhs.json'
export DOUYIN_COOKIE_FILE='config/cookies/douyin.json'
export WEIBO_COOKIE_FILE='config/cookies/weibo.json'
```

初始化 MySQL 表：

```bash
curl -X POST http://127.0.0.1:8787/api/migrate
```

启动真实采集：

```bash
curl -X POST http://127.0.0.1:8787/api/collect -H 'Content-Type: application/json' -d '{"limit":20}'
```

## API

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/stream`
- `POST /api/migrate`
- `POST /api/collect`

`POST /api/items` 和 `POST /api/config` 已在真实数据模式禁用，避免手工注入或内存配置造成假数据。

## 真实采集器

- 小红书：`workers/collectors/xiaohongshu.py`，预留 Spider_XHS 授权 Cookie 接入点。
- 抖音：`workers/collectors/douyin.py`，预留 crawl4ai 授权浏览器采集点。
- 微博：`workers/collectors/weibo.py`，预留 scrapling 授权采集点。

当前采集器不会伪造评论：Cookie 缺失、依赖缺失或适配器未完成时，任务会失败并写明原因。

更完整架构说明见 [docs/DESIGN.md](/Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor/docs/DESIGN.md)。
