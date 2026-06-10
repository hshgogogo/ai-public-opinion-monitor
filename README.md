# AI舆情监测系统

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
