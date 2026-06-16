## 1. OpenSpec 与范围锁定

- [x] 1.1 创建 `haidao-judge-agent-retry-loop` proposal、design、tasks 和 specs。
- [x] 1.2 明确本 change 只做 worker-only Judge retry，不新增 public HTTP endpoint 或前端控件。
- [x] 1.3 明确本 change 不引入 CrewAI runtime、FastAPI、React，也不调用真实 MediaCrawler/微博登录。
- [x] 1.4 明确 Judge 不覆盖事实表、不决定确定性数值、不自动确认现实行动。
- [x] 1.5 明确 Q&A、Report、Backtest 的 Judge 接入后置。
- [x] 1.6 运行 `openspec validate haidao-judge-agent-retry-loop --strict`。

## 2. Judge 规则与证据校验

- [x] 2.1 先写 Judge 规则测试，覆盖无 evidence IDs 被拒绝。
- [x] 2.2 实现 Judge helper，输出 `passed/failed/needs_human`、required changes 和 evidence errors。
- [ ] 2.3 先写 evidence ID 校验测试，覆盖不存在、跨 project 和无法识别前缀的 evidence ID。
- [ ] 2.4 实现 evidence ID resolver，支持 target/post/comment/analysis/event/action/memory；另行校验 `knowledge_references` 中的 knowledge-card。
- [ ] 2.5 先写边界测试，覆盖空泛建议、知识卡当事实、C 级知识卡当硬规则、确定性数值越权和因果过度表述。
- [ ] 2.6 实现规则化边界检查；首版只做可确定检查，不调用 LLM Judge。

## 3. Retry 编排

- [ ] 3.1 先写 worker-only retry command 测试，覆盖失败两轮后第三轮通过。
- [ ] 3.2 新增 `weibo-agent-loop-judge-run` worker 命令或等价 worker-only payload 路径。
- [ ] 3.3 retry 每轮 MUST 写入一条 `judge_reviews`，包含 retry count、required changes、evidence errors 和失败输出摘要。
- [ ] 3.4 通过时 MUST 写入 passed review，且 loop 不进入 `needs_human`。
- [ ] 3.5 先写 retry exhausted 测试，覆盖连续 3 次总尝试失败。
- [ ] 3.6 第 3 次总尝试失败后 MUST 将 step/loop 标记为 `needs_human` 并写入 `feedback_items` manual handoff。
- [ ] 3.7 manual handoff 写入 MUST 校验 source 属于当前 project，不得使用弱校验路径。
- [ ] 3.8 请求超过 3 次总尝试时 MUST clamp 到 3，且不得无限循环。

## 4. Step 集成边界

- [ ] 4.1 先写 step output review 测试，覆盖 `weibo-comments-analyze` attachment 输出被 Judge 检查。
- [ ] 4.2 为 comment analysis step 提供 Judge review 输入映射。
- [ ] 4.3 先写事件 step review 测试，覆盖无事件证据或 formal event 证据不足被拒绝。
- [ ] 4.4 为 event-building step 提供 Judge review 输入映射。
- [ ] 4.5 先写 action step review 测试，覆盖无 evidence、禁用知识卡、空泛建议或因果过度表述被拒绝。
- [ ] 4.6 为 action recommendation step 提供 Judge review 输入映射。
- [ ] 4.7 明确 `weibo-bot-message` 不在本 change 接入 Judge retry，保持 step attachment 既有行为。

## 5. 持久化与状态查询

- [ ] 5.1 先写真实 MySQL persistence 测试，验证 passed/failed/needs_human reviews 入库。
- [ ] 5.2 验证 `weibo-agent-loop-status` 返回 Judge reviews、retry count 和 manual handoff。
- [ ] 5.3 验证失败输出摘要只保存白名单字段，不返回 raw secret/internal fields。
- [ ] 5.4 如果现有 schema 不足，先写 migration 测试，再新增 MySQL-safe migration；若现有 `feedback_json` 足够，则不新增 migration。

## 6. 安全与兼容

- [ ] 6.1 增加静态测试，确认本 change 不新增 public Judge HTTP endpoint。
- [ ] 6.2 增加测试，确认不读取或输出 `.env`、Cookie、token、浏览器登录态、`config/cookies/weibo.json` 或 worker stderr。
- [ ] 6.3 未传 `agentLoopRunId` 时现有 worker 命令 standalone 行为保持不变。
- [ ] 6.4 本 change 不调用真实 MediaCrawler、真实微博登录、CrewAI runtime 或新的付费 API。

## 7. 文档、验证与交付

- [ ] 7.1 更新 README 或相关 docs，说明 Judge retry worker-only 能力、限制和人工处理状态。
- [ ] 7.2 运行定向测试。
- [ ] 7.3 运行 `npm test`。
- [ ] 7.4 运行真实 MySQL persistence tests。
- [ ] 7.5 运行 `openspec validate haidao-judge-agent-retry-loop --strict`。
- [ ] 7.6 运行 `git diff --check`。
- [ ] 7.7 运行 `npm run agent:guard`。
- [ ] 7.8 通过 subagent reviewer 反驳式 review 后，更新 evidence report、commit、push 并更新 PR。
