## Why

当前系统已经把微博作为首个平台跑通，并正在把后续 Agent 主线迁移到 FastAPI + CrewAI Harness。真实宣发舆情不会只发生在微博，小红书、B站和抖音上的内容扩散、二创、评论情绪、账号矩阵和站内话题都可能影响《海岛舒服日志》的舆论判断。

`Panniantong/Agent-Reach` 可以作为多平台采集能力入口，用于诊断和调用上游工具（例如 B站、小红书、抖音相关能力）。但它不能成为 CrewAI 的自由上网工具，也不能绕过 Harness 直接读 Cookie、浏览器登录态、`.env` 或写事实表。本 change 的目标是把 Agent-Reach 接入为 FastAPI Harness 下的受控采集 adapter：采集、归档、归一化和证据入库由 Harness 执行，CrewAI/Judge/Report 只读取 evidence summary 并输出 proposal。

## What Changes

- 新增 Agent-Reach 多平台采集 adapter 的 OpenSpec 设计，覆盖 B站、小红书和抖音。
- 首轮实现顺序约束为：先 B站，再小红书，最后抖音。
- 新增 FastAPI Harness tool/worker adapter contract：只允许白名单命令和白名单平台，不允许 Agent 直接执行 Agent-Reach。
- 新增跨平台原始结果归档和 normalize contract，把 B站/小红书/抖音内容映射到现有证据/帖子/评论/来源账号语义。
- 新增安全边界：真实登录态、Cookie、二维码登录、浏览器状态只允许在明确采集切片中使用，不能进入 CrewAI、public payload、日志、测试 fixture 或 Git。
- 新增测试计划：doctor/health、fixture parsing、stdout/stderr 脱敏、命令白名单、平台顺序、证据归属、失败状态和无凭据 fallback。

## Capabilities

### New Capabilities

- `multichannel-agent-reach-ingestion`: 通过 Agent-Reach adapter 获取 B站、小红书和抖音候选内容，并转成 Harness 可审计证据。

### Modified Capabilities

- `fastapi-sidecar-harness`: 后续可新增内部采集 adapter endpoint/service，但不改变当前微博和 CrewAI proposal-only contract。
- `weibo-public-opinion-agent`: 后续分析阶段可读取跨平台 evidence summary，但不能把平台外采集直接交给 CrewAI 执行。

## Impact

- Python 依赖：可能新增 Agent-Reach 或其 CLI 运行前置检查；自动测试必须使用 fixture/fake runner，不依赖真实登录态。
- 数据：需要复用或扩展 posts/comments/source_accounts/evidence 表；若需要新表或新字段，必须单独做 MySQL-safe migration。
- 安全：严禁提交小红书/抖音/B站登录态、Cookie、二维码 token、`.env`、浏览器 state、原始含敏感字段输出。
- 执行顺序：本 change 排在当前 CrewAI runtime、proposal audit、Judge/report/workbench 主线之后；抖音在本 change 内最后实现。
- 测试：先 fixture 驱动，真实平台验证必须作为独立验收步骤，并保留未验证范围。
