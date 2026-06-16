## Why

当前系统已经有微博采集、MySQL 入库、Agent Loop 账本、反馈和知识库基础，但新增 Agent 能力仍容易落回旧 Node + `enterprise_worker.py` 脚本集合。这个 change 把后续 Agent Harness 主线切到 FastAPI sidecar，同时复用已经完成的账本、知识库和 legacy worker 能力，避免推倒重来。

## What Changes

- 新增 FastAPI sidecar 作为后续 Agent Harness 新后端入口，与旧 Node 服务并行运行。
- 新增最小 Harness API：`GET /health`、`POST /api/weibo/agent-loop/run`、`GET /api/weibo/agent-runs/{id}`。
- 新增内部 legacy worker tool adapter：白名单调用既有 worker 命令，不把新的 Agent 编排继续写入旧 worker。
- FastAPI MUST 复用现有 MySQL Harness ledger，不新增破坏性 migration。
- FastAPI MUST NOT 读取、打印或提交 `.env`、Cookie、token、浏览器登录态或 `config/cookies/weibo.json`。
- 本 change 不引入 CrewAI runtime、不做 React/Vite 前端迁移、不下线旧 Node 服务。
- `haidao-judge-agent-retry-loop` 的业务目标保留，但后续应迁移到 FastAPI/CrewAI Harness 上实现；不继续在旧 worker 中推进高级 Judge 主线。

## Capabilities

### New Capabilities
- `fastapi-sidecar-harness`: FastAPI sidecar health、Agent Loop run/status 和 legacy worker tool adapter 的最小 Harness 能力。

### Modified Capabilities
- None.

## Impact

- Python 依赖：新增 FastAPI/ASGI 测试所需依赖，限定在项目环境。
- 后端：新增 FastAPI sidecar 模块，复用现有 `workers.db` 和 worker subprocess。
- API：新增与旧 Node 并行的 FastAPI endpoint；旧 Node endpoint 保持兼容。
- 测试：新增 FastAPI unit/integration tests，覆盖 health、payload validation、MySQL unavailable、legacy command whitelist 和安全边界。
- 文档：README 和 change queue 明确旧 worker 是 legacy tool adapter，不是新增 Agent 主业务承载层。
