## Context

项目主线已经确定为：

```text
FastAPI Harness
  -> controlled tool adapters
  -> MySQL evidence / ledger / memory
  -> CrewAI proposal-only runtime
  -> Judge / Report / Workbench
```

Agent-Reach 应被放在 `controlled tool adapters` 层。它可以帮助 Harness 发现和执行平台采集能力，但不应该被 CrewAI 直接调用，也不应该拥有写库、读取 `.env`、读取 Cookie 或决定事实结论的权限。

## Goals / Non-Goals

**Goals:**

- 设计并实现受控 Agent-Reach adapter contract。
- 首先跑通 B站 fixture/本地健康检查和归一化。
- 其次跑通小红书 fixture/本地健康检查和登录态安全边界。
- 最后再处理抖音采集能力，避免在首轮引入最高不确定性平台。
- 所有平台产物都归档原始结果引用，并归一化为 Harness evidence。
- 采集失败、无工具、无登录态、平台限流、解析失败都返回稳定 `error_type` 和可操作建议。

**Non-Goals:**

- 不在当前 active CrewAI runtime change 中实现本 change。
- 不让 CrewAI/Agent 直接调用 Agent-Reach。
- 不自动发布、评论、点赞、私信或执行现实宣发动作。
- 不绕过平台服务条款或验证码/风控。
- 不把真实 Cookie、二维码、浏览器登录态、`.env`、API key 写入日志、fixture、PR 或 public payload。
- 不把抖音放在第一阶段；抖音必须等 B站和小红书 adapter contract 稳定后再做。

## Architecture

```text
FastAPI internal service
  -> AgentReachAdapter
      -> doctor / capability discovery
      -> allowlisted platform command runner
      -> raw artifact archive
      -> platform normalizer
  -> EvidenceWriter
      -> source account upsert
      -> content item/post/comment/evidence link persistence
  -> Agent Loop step record
      -> success / partial / failed
      -> sanitized logs and error_type
  -> CrewAI / Judge / Report
      -> read evidence summary only
      -> proposal-only output
```

## Platform Order

1. **B站**
   - 优先实现 `doctor`、搜索 fixture、视频详情 fixture、评论/字幕字段归一化。
   - 首轮不要求登录态。
   - 适合作为多平台采集 adapter 的第一条真实路径。

2. **小红书**
   - 实现 fixture 和 adapter contract。
   - 真实采集需要明确登录态隔离，登录态只进入采集 runner 环境，不进入 CrewAI 或 public API。
   - 若本地没有可用登录态，返回 `platform_auth_required`，任务保持未完成或标记 blocked。

3. **抖音**
   - 放在本 change 内最后阶段。
   - 先做 doctor/capability/fixture contract，再决定真实采集路径。
   - 若上游工具不稳定或需要高风险登录态，保留为 blocked，不影响 B站/小红书能力交付。

## Data Contract

归一化输出至少包含：

```json
{
  "platform": "bilibili | xiaohongshu | douyin",
  "project_id": 2,
  "external_id": "stable-platform-id",
  "url": "https://...",
  "title": "...",
  "text": "...",
  "author_external_id": "...",
  "author_display_name": "...",
  "published_at": "ISO-8601-or-null",
  "metrics": {
    "like_count": 0,
    "comment_count": 0,
    "share_count": 0,
    "view_count": 0
  },
  "raw_artifact_ref": "storage/artifacts/...",
  "evidence_ids": ["platform:item:..."]
}
```

要求：

- `platform + project_id + external_id` 必须具备幂等保护。
- 原始 stdout/stderr 不能直接进 public response。
- 原始采集产物必须可追踪，但敏感字段要脱敏。
- 对评论、弹幕、字幕、笔记正文、视频标题等不同结构，先归一化为 evidence summary，再交给 Agent。

## Security Boundary

- Adapter runner 可以在明确采集切片中读取必要登录态，但不得打印或提交。
- CrewAI runtime、Judge、Report、Workbench 只能访问 Harness evidence summary。
- Agent-Reach 命令必须白名单化，不允许任意 shell command。
- 任何包含 `.env`、Cookie、token、浏览器 state、DB URL、二维码 token、真实 API key 的输出必须脱敏或拒绝。
- 自动测试不得依赖真实平台账号；真实平台验收作为单独 evidence，无法完成时明确 blocked。

## Verification Strategy

- OpenSpec strict validate。
- Agent-Reach doctor fake runner tests。
- B站 fixture parsing and persistence tests。
- 小红书 fixture parsing and auth-required tests。
- 抖音 fixture/doctor contract tests，最后实现。
- Command allowlist and secret redaction tests。
- MySQL idempotent persistence tests when schema changes。
- Full `npm test`、`git diff --check`、`npm run agent:guard`。
