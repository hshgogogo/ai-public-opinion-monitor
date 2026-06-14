# Outcome-Driven Agent Loop

本文档是 Codex 和子 Agent 在项目中的开发循环规范。它把 PRD/OpenSpec/任务清单拆成小的、可验证的、证据充分的实现切片。

## 核心原则

不要机械勾选任务。每一轮 loop 都必须证明一个用户可见或系统可见的 outcome，并给出 done rubric、验证证据、反驳式 review，以及必要时写入长期 memory。

## 状态机

```text
LOAD_CONTEXT
  -> PRD_DECOMPOSITION_GATE
  -> CREATE_OR_UPDATE_OPENSPEC_CHANGE_QUEUE
  -> SELECT_CHANGE
  -> SUBAGENT_ROUTING_GATE
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

## PRD 拆解硬门

当用户输入的是 PRD、路线图、长需求文档，或用户说“根据 PRD 自动开发”但没有指定活跃 `<CHANGE_ID>` 时，先执行 `docs/prd-to-openspec.md`。

以下情况禁止直接进入写代码：

- PRD 跨多个模块、前后端、数据链路、异步任务、权限或部署。
- PRD 内包含多个用户流程或多个里程碑。
- PRD 中任务超过 7 个，或预计需要超过 1-2 个 loop 切片。
- 当前项目使用 OpenSpec，但 PRD 还没有对应 `openspec/changes/<change-id>/`。
- Codex 无法清楚说明“本轮只做哪个 OpenSpec change”。

拆解阶段必须产出：

- `docs/agent-loop-change-queue.md`：change 队列、依赖、风险、推荐执行顺序。
- 每个 change 的 outcome、范围、不做什么、验收摘要。
- 第一个低风险 change 的 `proposal.md`、`design.md`、`tasks.md`，如果项目使用 OpenSpec。
- 如果项目暂未安装 OpenSpec，则先产出等价的 change queue 文档，并在 evidence 里说明“OpenSpec CLI/目录未就绪，已生成待迁移队列”。

拆解完成前不要编辑业务代码、测试代码或数据库迁移。允许编辑的范围仅限需求拆解文档、OpenSpec change 文件、agent loop 文档和必要的项目计划文件。

PRD 拆解不是项目完成证据。它只是把“要做什么”变成可执行队列；每个 change 仍然必须按后续 loop 独立 TDD、验证、review、evidence 和最终验收。

## 选择切片

每轮先选一个 OpenSpec change，再从该 change 中选一个切片。切片必须满足：

- 对当前产品 outcome 有价值
- 能本地验证
- 外部风险低
- 可回滚
- 范围足够窄，适合一轮完成

如果 change 或任务太大，先回到 `docs/prd-to-openspec.md` 继续拆分再写代码。如果需要真实账号、Cookie、token、生产数据、破坏性迁移、大规模付费 API 或合规判断，必须暂停并请求人工确认。

## Subagent Routing Gate

在选择切片后、写代码前，必须判断本轮是否进入 Subagent-Driven 模式。

以下任一条件成立时，必须使用真实子 agent，不允许主 Orchestrator 独自实现：

- 用户明确说“使用子 agent”“subagent-driven development”“多智能体”“让 worker/reviewer/QA agent 做”。
- 本轮来自大型 PRD 拆解出的 `docs/agent-loop-change-queue.md`。
- 当前 change 跨越前端、后端、数据库、worker、异步队列、部署、权限、LLM/RAG 或外部集成中的两个及以上边界。
- 连续推进同一 PRD 的第二个及后续切片。
- 需要反驳式 review、真实使用验收、浏览器/Computer Use QA、日志监控或安全/数据风险审查。
- 上一轮出现 P1/P2、测试反复失败、需求理解偏差，或者用户指出“没有按流程使用子 agent”。

允许主 Orchestrator 独自完成的情况仅限：

- 单文件或单接口的小修复。
- 不来自大型 PRD/change queue。
- 不涉及跨模块协调。
- 用户没有要求子 agent。
- 仍然必须做 TDD、验证和 evidence report。

Subagent-Driven 模式至少包含：

1. `explorer` 或 reviewer 子 agent：实现前做范围/方案反驳，检查切片是否过大、是否偏离 PRD/OpenSpec、是否可本地验证。
2. `worker` 子 agent：在明确写入范围内实现或修复。写入范围必须尽量与其他 worker 不重叠。
3. reviewer/QA 子 agent：实现后做反驳式 review。前端、浏览器、日志或最终验收相关任务必须包含 QA/browser/log 验证角色。

如果切片太小，不值得 worker 子 agent 改代码，仍然必须至少创建独立 reviewer 子 agent 做反驳式 review。也就是说，在 Subagent-Driven 模式下，不能完全没有子 agent。

每个子 agent prompt 必须包含：

```text
你不是独自在这个代码库里工作。不要回滚别人做过的改动。与现有变更协作。补丁只限于你被分配的文件和职责范围。
```

并明确角色、目标 outcome、必读文件、允许写入范围、禁止范围、验证命令和输出格式。

子 agent 完成后，主 Orchestrator 必须审查其输出，不要盲目接受。P0/P1/P2 问题回到修复 loop。

子 agent 生命周期必须闭合：完成并集成后，关闭不再需要的子 agent。每轮开始前如果发现上一轮遗留子 agent，先复用或关闭，再创建新的 worker/reviewer/QA。

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

子 Agent 证据：
- 模式：single-agent / subagent-driven
- agent_id / agent_type：
- 子 agent 职责：
- 子 agent 输出摘要：
- 交接/日志文件：
- 生命周期：已集成 / 已关闭 / 仍需保留及原因

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

小切片可以由主 Orchestrator 执行，但只限于 `Subagent Routing Gate` 明确允许的情况。大型 PRD、change queue、跨模块、多 worker、review/QA/最终验收、用户明确要求 subagent 的任务，必须使用真实子 agent 或 `$serial-agent-handoff`。

如果任务明确要求真实串行子 Agent 或交接文件，不要只在一个回复里角色扮演多个子 Agent。
