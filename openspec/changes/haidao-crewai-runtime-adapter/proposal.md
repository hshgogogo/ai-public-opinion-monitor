## Why

FastAPI sidecar 已经成为后续 Agent Harness 的新后端入口，但当前还没有 CrewAI runtime。若下一步直接让 CrewAI Agent 调用数据库、Cookie、`.env` 或旧 worker，系统会重新变成不可审计的脚本集合，并破坏“Agent 负责提案，Harness 负责证据、权限、状态机和写回”的边界。

这个 change 的目标是把 CrewAI 接入为受控 runtime adapter：CrewAI Flow/Agent 只能读取 Harness 提供的安全上下文，并产出结构化 proposal；FastAPI Harness 校验证据 ID、项目归属、权限边界和输出 schema 后，才决定是否写入现有 Agent Loop ledger 或进入人工处理。

## What Changes

- 新增 CrewAI runtime adapter 的最小项目依赖和 adapter 模块。
- 新增 proposal schema：Agent 输出必须是结构化 JSON/Pydantic 风格对象，包含 proposal type、evidence IDs、confidence、risk notes 和 write intent。
- 新增 FastAPI Harness 内部接口或 service function，用于创建 CrewAI proposal run，但不允许 CrewAI 直接写 MySQL。
- 新增安全工具边界：CrewAI 只能调用 FastAPI/Harness 暴露的 allowlisted tools，不能直接读取 `.env`、Cookie、浏览器登录态、`config/cookies/weibo.json` 或任意文件系统路径。
- 新增 mandatory proposal audit boundary：accepted、rejected 和 runtime error 都必须写入脱敏审计/提案记录；CrewAI 不拥有 `submit_proposal` 工具。
- 新增 fake CrewAI runtime tests，覆盖 proposal-only、无证据拒绝、工具白名单、失败 fallback/error record。
- 本 change 不实现完整 Judge retry、不做 React/Vite、不调用真实微博/MediaCrawler、不要求真实 DeepSeek 调用、不自动发布或执行外部动作。

## Capabilities

### New Capabilities
- `crewai-runtime-adapter`: FastAPI Harness 内受控运行 CrewAI proposal adapter 的能力。

### Modified Capabilities
- `fastapi-sidecar-harness`: 新增 CrewAI adapter 的内部调用边界，但不改变已存在 sidecar endpoint 的兼容行为。

## Impact

- Python 依赖：新增 CrewAI 运行依赖时必须固定版本，并确保测试可用 fake runtime，不依赖真实外部模型。
- FastAPI：新增内部 service/API，用于触发 proposal-only CrewAI run。
- 安全：禁止 CrewAI 直接访问 DB、Cookie、`.env`、浏览器状态或旧 worker 任意命令。
- 审计：Harness 必须记录 accepted/rejected/error proposal，不允许只把模型输出返回给调用方。
- 测试：新增 adapter 单元测试、FastAPI contract tests、no-secret/no-direct-db tests。
- OpenSpec：后续 `haidao-judge-agent-retry-loop` 必须基于本 adapter 的 proposal contract 继续，不再回到旧 worker 新业务主线。
