# Outcome-Driven Agent Loop

本文档是 Codex 和子 Agent 在项目中的开发循环规范。它把 PRD/OpenSpec/任务清单拆成小的、可验证的、证据充分的实现切片。

## 核心原则

不要机械勾选任务。每一轮 loop 都必须证明一个用户可见或系统可见的 outcome，并给出 done rubric、验证证据、反驳式 review，以及必要时写入长期 memory。

## 状态机

```text
LOAD_CONTEXT
  -> SELECT_SLICE
  -> DEFINE_RUBRIC
  -> WRITE_FAILING_TEST
  -> IMPLEMENT_MINIMAL_CHANGE
  -> RUN_TARGETED_TESTS
  -> LOCAL_FIX_LOOP
  -> RUN_FULL_VALIDATION
  -> ADVERSARIAL_REVIEW
  -> FIX_REVIEW_FINDINGS
  -> EVIDENCE_REPORT
  -> UPDATE_TASKS_AND_DOCS
  -> WRITE_MEMORY
  -> COMMIT_PUSH_PR
  -> NEXT_SLICE
  -> FINAL_ACCEPTANCE
  -> ACCEPTANCE_FIX_LOOP or STOP
```

## 每轮必须读取的上下文

每轮开始前，优先读取：

- PRD、需求文档或任务说明
- 如果存在 OpenSpec：`openspec/changes/<CHANGE_ID>/proposal.md`
- 如果存在 OpenSpec：`openspec/changes/<CHANGE_ID>/design.md`
- 如果存在 OpenSpec：`openspec/changes/<CHANGE_ID>/tasks.md`
- `AGENTS.md`
- `docs/agent-loop.md`
- `docs/verification-rubric.md`
- `docs/final-acceptance.md`
- `memory/` 下相关文件
- `git status --short`

如果 OpenSpec change 已经 archive，只把它当历史上下文；除非用户明确要求，不要重新打开已归档 change。

## 选择切片

每轮只选一个切片。它必须满足：

- 对当前产品 outcome 有价值
- 能本地验证
- 外部风险低
- 可回滚
- 范围足够窄，适合一轮完成

如果任务太大，先拆分再写代码。如果需要真实账号、Cookie、token、生产数据、破坏性迁移、大规模付费 API 或合规判断，必须暂停并请求人工确认。

## Done Rubric

写代码前必须写 3-7 条可验证标准。好的 rubric 应覆盖行为、失败处理、数据/日志结构、测试和明确不做什么。

示例：

```text
Done rubric:
1. 用户触发动作后能看到 started/running/succeeded/failed 状态。
2. 失败时显示 error_type 和可操作建议。
3. API 返回结构保持稳定。
4. 日志包含 trace_id、run_id、task_id、error_type。
5. 测试覆盖成功、失败、空状态。
6. 本切片不使用真实账号、真实 Cookie 或生产数据。
```

## TDD Loop

使用红绿重构：

1. 先写失败测试。
2. 再写让测试通过的最小实现。
3. 定向测试通过后才重构。

最多 3 轮本地修复。同类失败连续出现 2 次时，停止并报告阻塞，不要继续猜。

## 验证顺序

先跑最窄的相关测试，再扩大范围。默认命令如下，项目不适用时必须替换成真实命令：

```bash
npm test -- <targeted-test-if-supported>
npm test
openspec validate <CHANGE_ID> --strict
git diff --check
git status --short
```

如果项目没有 OpenSpec，跳过 `openspec validate`，但要在 evidence report 里说明“本项目无 OpenSpec 或本轮无活跃 change”。

如果 Node test runner 不支持当前定向参数，可用：

```bash
node --test <test-file>
```

自动化测试绝不能指向生产数据库。

## 反驳式 Review

实现后，像“证明这个切片其实没完成”一样检查 diff。

必须检查：

- done rubric 是否逐条满足
- 测试是否测行为，而不是假测试或只测实现细节
- 是否扩大了不必要范围
- 是否过早勾选任务
- 是否有账号、Cookie、token、`.env`、真实凭据风险
- SQL、并发、重试、幂等、错误处理是否可靠
- 前端空状态、加载状态、错误状态是否清晰
- 用户使用方式改变时，文档是否同步

问题分级：

- P0：立即停止；安全、数据、账号、合规或严重正确性问题
- P1：必须修；功能不成立
- P2：本轮必须修；质量、可维护性或可验证性问题
- P3：记录即可；不阻塞本轮

P0 必须请求人工确认。P1/P2 必须修复并重新验证。

## Evidence Report

每个完成的 loop 都必须包含：

```text
完成内容：
- <改了什么>

Done rubric 证据：
1. <标准>：通过/失败/未验证。证据：<测试/日志/文件/浏览器检查>

验证：
- 定向测试：
- 全量测试：
- OpenSpec validate：
- diff check：
- 浏览器/手动检查：

未验证：
- <真实账号、生产 DB、外部 API、长时间运行等>

剩余风险：
- <仍存在的产品或运行风险>
```

没有 evidence report，不要说“完成”，也不要勾任务。

## 最终项目验收

当 PRD/OpenSpec/任务清单里的所有开发任务都完成，意味着前端、后端、数据链路、文档和自动化都已经进入候选交付状态。此时不能直接宣布项目完成，必须进入最终验收。

最终验收使用 `docs/final-acceptance.md`。核心流程：

```text
确认所有任务完成
-> 启动本地/测试环境
-> 使用 Computer Use 或浏览器工具模拟真实用户完成全流程
-> 同时监控后端、前端、worker、数据库、队列、外部集成日志
-> 记录验收证据、截图/日志/命令输出
-> 如果发现问题，写入缺陷切片
-> 回到 SELECT_SLICE 修复
-> 重新验证和重新验收
-> 直到真实使用验收通过
```

真实使用验收要覆盖：

- 用户从进入系统到完成核心任务的完整路径。
- 表单输入、按钮点击、状态变化、成功/失败反馈。
- 前端控制台错误、网络请求错误、后端日志错误。
- 空状态、加载状态、失败状态、重试或恢复路径。
- 权限、鉴权、数据保存、刷新后状态保持。
- 移动端或窄屏视图，如果项目面向移动端用户。

后台日志监控应按项目实际技术栈选择方式，例如：

```bash
npm run dev
tail -f logs/*.log
docker compose logs -f
journalctl -f -u <service>
```

如果项目没有统一日志入口，最终验收前应先建立最小可用日志观察方式。

最终验收发现的问题，不允许只写在总结里。必须回流成新的 loop 切片：

```text
验收问题
-> 缺陷描述
-> done rubric
-> 失败测试或复现脚本
-> 修复
-> 验证
-> evidence report
-> 重新最终验收
```

## 自动化授权

用户已预授权普通 feature branch 自动化。通过 loop 后可以执行：

```text
evidence report
-> 自动 commit
-> 自动 push 当前 feature branch
-> 自动创建/更新 PR
-> 进入下一轮
```

允许自动执行：

- 在非 `main`、非 `master` 的 agent feature branch 上 commit
- push 当前 feature branch
- 创建或更新该分支的 PR

仍需人工确认：

- 在 `main`/`master` 上 commit 或 push
- merge PR
- 发布生产
- 生产数据库破坏性迁移
- 真实账号登录或真实 Cookie/token/`.env` 使用
- 大规模付费 API 调用
- 法律或合规判断

## Memory

当 loop 发现以下内容时，写入 `memory/`：

- 重复失败模式
- 用户偏好
- 项目特定风险边界
- 测试、fixture 或验证技巧
- 外部依赖、数据库、前端或 LLM JSON 相关坑

Lesson 保持短而可执行：

```markdown
# Lesson: <名称>

When:
- <出现条件>

Why:
- <原因>

Apply:
- <以后要遵守的规则>
```

## 子 Agent

小切片由主 Orchestrator 执行。大型、跨模块、多 worker 或需要长期交接记录的任务，使用 `$serial-agent-handoff`。

如果任务明确要求真实串行子 Agent 或交接文件，不要只在一个回复里角色扮演多个子 Agent。
