## Context

已完成的 `haidao-agent-harness-loop-foundation`、`haidao-agent-loop-trigger-api`、`haidao-agent-loop-step-attachment`、`haidao-feedback-memory-loop` 和 `haidao-knowledge-card-rag-mvp` 把系统从采集链路推进到可审计 Agent Harness 地基。它们的业务目标仍然有效：MySQL 里已有 run、step、Judge skeleton、feedback、memory 和 knowledge card 账本。

问题在于后续实现主线。如果继续把 Judge retry、CrewAI、策略编排和问答增强写进 `enterprise_worker.py`，系统会继续膨胀为传统脚本后端，而不是 PRD 要求的 Agent Harness。这个 change 只切换主线入口：新增 FastAPI sidecar，旧 Node/Python worker 保留为 legacy tool adapter。

## Goals / Non-Goals

**Goals:**

- FastAPI sidecar 可以本地启动并返回 health。
- FastAPI 可以创建 Agent Loop run，并查询现有 run/step/Judge/handoff 状态。
- FastAPI 提供内部 legacy worker adapter，只允许白名单命令。
- FastAPI 不直接读取真实 Cookie、浏览器登录态或打印 secret。
- 旧 Node 服务和当前工作台保持可用。

**Non-Goals:**

- 不引入 CrewAI runtime；下一 change 才接 CrewAI proposal adapter。
- 不迁移 React/Vite 前端；React shell 后置。
- 不实现 Judge retry、Report、Backtest 或完整微博闭环。
- 不删除旧 Node 服务或旧 worker 命令。
- 不新增破坏性 MySQL migration。

## Decisions

### 1. FastAPI sidecar 先并行，不替换 Node

FastAPI 新增独立入口，例如 `uvicorn app.main:app`。旧 `src/server.js` 保持现状，避免前端和真实微博采集路径中断。下一阶段再让 React 工作台逐步调用 FastAPI。

### 2. 复用现有 MySQL ledger

FastAPI 通过项目内 Python 数据访问层复用现有 `agent_loop_runs`、`agent_step_runs`、`judge_reviews` 和 `feedback_items`。本 change 不新增 schema；如果本地没有 MySQL 或 `MYSQL_URL`，API 返回标准 `mysql_unavailable`。

### 3. legacy worker 是 tool adapter

FastAPI adapter 只能调用明确白名单命令，例如 `weibo-agent-loop-run`、`weibo-agent-loop-status` 和只读/安全诊断命令。adapter 不暴露 arbitrary command execution，不透传 worker stderr，不返回 secret-bearing env。

### 4. CrewAI 权限边界提前固化

本 change 不安装或运行 CrewAI，但接口边界为下一 change 留出位置：CrewAI 后续只能通过 FastAPI 暴露的安全 tool adapter 产生 proposal，不能直接读 `.env`、Cookie、浏览器登录态或写 MySQL。

## Risks / Trade-offs

- [Risk] 双后端短期增加运行复杂度。
  Mitigation: README 明确启动命令和职责边界；旧 Node 不下线。

- [Risk] legacy adapter 变成任意命令后门。
  Mitigation: 命令白名单、payload 校验、禁用 stderr/raw env 返回，并用测试覆盖。

- [Risk] FastAPI 直接 import 现有 DB 模块时加载 `.env`。
  Mitigation: sidecar 启动默认设置 `YUQING_SKIP_ENV_FILE=1`，测试用 sentinel 证明不加载 `.env`；部署时通过环境变量注入配置。

- [Risk] 旧 Judge retry change 仍显示 in-progress。
  Mitigation: change queue 标为 `paused-rescope`；后续将其迁移到 FastAPI/CrewAI Harness 上继续，不否定已完成基础 specs。

## Migration Plan

1. 建立 FastAPI sidecar OpenSpec 和最小代码结构。
2. 用 fixture/fake subprocess 测试 legacy adapter，不调用真实微博或 Cookie。
3. 用真实 MySQL 测试验证 run/status 能访问现有 ledger。
4. README 增加并行运行说明。
5. 下一 change 接入 CrewAI runtime proposal adapter。
