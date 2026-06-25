## 背景

Agent Loop run 已经可被创建和查询。为了让 Harness 看到真实业务阶段，现有 worker 命令需要在可选 run 上记录 step，但不能把独立命令强制变成 loop-only。

## 设计

### 触发条件

只有 payload 中显式传入精确字段 `agentLoopRunId` 时才启用 attachment。

未传入 `agentLoopRunId` 时，即使 payload 中出现其他类似字段，命令行为和返回 payload 也必须保持当前 standalone 兼容。别名兼容不属于本 change。

### Step 映射

| worker command | agent_name | step_name |
|---|---|---|
| `weibo-comments-analyze` | `Issue Analysis Agent` | `comment_analysis` |
| `weibo-events-build` | `Event Agent` | `event_building` |
| `weibo-actions-build` | `Strategy Agent` | `action_recommendation` |
| `weibo-bot-message` | `QA Agent` | `evidence_qa` |

### 状态映射

- `ok: true` 且有完整结果：step `succeeded`。
- `ok: true` 但结果明确为 unknown/insufficient-data/no-data：step `partial`。
- `ok: false` 且错误可恢复或需要人工处理：step `needs_human` 或 `failed`，由 payload/error_type 决定。
- worker 抛出异常时，原错误 payload 保持可见，并尝试记录 `failed` step。

### Evidence IDs

每个 step 的 `evidence_ids` 来自已有结果字段：

- 评论分析：评论 IDs、analysis IDs 或 citation IDs。
- 事件生成：event IDs、comment evidence IDs。
- 行动建议：action IDs、event evidence IDs。
- 问答：answer citations、memory/evidence IDs。

如果没有 evidence IDs，仍可记录 step，但 status 应为 `partial` 或 `needs_human`，不能把无证据输出记为完整成功。

### 幂等与错误处理

- 如果传入的 `agentLoopRunId` 不存在或不属于项目，worker 返回标准 `agent_loop_not_found`，不执行业务写回。
- 每次命令执行可以创建一条新的 step run；后续 retry loop 的去重和 retry counter 属于 Judge retry change。
- 记录 step 失败不能隐藏业务命令原始错误；如果原始错误 payload 已含 `error_type`、`cause` 或 `fix`，这些字段不得丢失。
- `partial` 和 `needs_human` 是 `agent_step_runs` 既有允许状态，本 change 不新增 migration；真实 MySQL 测试必须证明这些状态可写入。

### 安全边界

- 不读取 `.env`、Cookie、token 或浏览器状态。
- 不新增真实外部调用。
- 不允许 step attachment 把模型推断写成事实。

## 验证策略

- Worker fixture 测试证明未传 `agentLoopRunId` 时返回与当前独立命令兼容。
- 真实 MySQL persistence 测试证明传入 `agentLoopRunId` 时写入 `agent_step_runs`；fake DB 只可作为额外单元测试，不能替代真实 MySQL 验证。
- 错误测试证明不存在的 run ID 返回标准错误。
- 行为测试证明不调用 MediaCrawler、DeepSeek 之外的新 live dependency，也不新增前端入口。
- 运行真实 MySQL persistence 定向测试、`npm test`、`openspec validate haidao-agent-loop-step-attachment --strict`、`git diff --check` 和 `npm run agent:guard`。
