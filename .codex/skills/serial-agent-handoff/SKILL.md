---
name: serial-agent-handoff
description: >
  当已经评审过的 PRD、技术合同、实施设计、OpenSpec change 或大型功能，需要通过“主控 Codex + 串行子 Agent + 共享交接文件”的方式执行时使用。触发说法包括：“使用子 agent 串行工作”“按交接文件执行”“生成/更新开发任务交接记录”“多 Agent 接力实现”“把这个大任务拆给多个 worker 串行做”“不要并行，主控审核后再让下一个 agent 继续”。本 skill 会创建或更新任务交接记录，把每个 worker 限定在 1-2 个清晰功能块内，并在每个 worker 后由主控 review、验证、更新交接状态。不适用于小型单切片 TDD、早期产品探索、普通 code review，或写入范围明确互不重叠的并行任务。
---

# 串行 Agent 交接

当用户希望用“文件式交接 + 串行子 Agent”控制开发时，使用本 skill。它替代的是一次性把大任务丢给某个执行器的做法。

通常在以下阶段之后使用：

1. 需求澄清或场景对齐已经完成。
2. PRD 已经存在。
3. 技术合同或实施设计已经评审过。
4. 当前任务已经进入实现编排阶段。

本 skill 只负责实现编排。除非源文档互相矛盾，否则不要重新做产品探索。

## 触发条件

必须使用本 skill：

- 用户明确要求串行子 Agent、sequential workers、交接文件、开发任务交接记录、多 Agent 接力执行。
- 用户说“使用子 agent 串行工作”“开始串行 agent”“按交接文件执行”“生成开发任务交接记录”“多 Agent 接力实现”“让多个 worker 一个个做”等。
- 已评审 PRD、技术合同、实施设计、OpenSpec change 或等价计划已经准备好，并且用户要求通过多个受控实现阶段执行。
- 任务对单轮安全切片来说太大，但写入范围又不够独立，不适合并行 Agent。
- 上下文可能压缩，或任务会跨会话继续，需要持久文件作为 memory。

可以使用本 skill：

- 工作跨 front/back/Android/deploy/docs 等多个边界，每个阶段都需要交接记录。
- 用户希望主控 Codex 在每个 worker 后 review、验证、批准，再启动下一位 worker。
- 长任务需要清晰记录每个 worker 的目标、写入范围、禁止范围、验证命令、遗留风险和下一位注意事项。

不要使用本 skill：

- 任务是小的、可本地验证的单切片，主 Orchestrator 可以直接用 TDD 完成。
- 用户还在产品探索、场景对齐、PRD 起草或技术设计阶段。
- 请求只是普通 code review、bug 修复、文档编辑或解释。
- 用户明确要求并行 Agent，且写入范围确实互不重叠。
- 源文档存在会影响产品行为的矛盾。此时先停下来询问用户。

## 核心模型

- 主 Codex 是 controller：负责拆分工作、一次启动一个子 Agent、review 改动、运行验证、更新交接文件、决定是否继续。
- worker 子 Agent 默认串行执行。除非用户明确要求且写入范围互不重叠，不要并行启动 coding workers。
- 每个 worker 只负责 1-2 个清晰功能块。
- 每个 worker 编辑前必须读取当前交接文件，并且不得回滚其他人的改动。
- 交接文件是跨上下文压缩、worker 回合、未来会话的 durable memory。
- 不要在每个 worker 后自动 commit。只有当前任务明确包含 commit 行为，或用户授权时，才 commit。

## 模式

支持两种模式：

- `plan-only`：创建或刷新交接文件，然后停止。
- `run`：创建或刷新交接文件，然后开始串行 worker 执行。

如果用户说“使用子 agent 串行工作”“开始串行 agent”“按交接文件执行”等，默认 `run`。

如果用户只说“制定计划”“生成交接文件”“先整理任务”，默认 `plan-only`。

## 必要输入

生成或执行计划前，从用户请求和仓库中识别：

- 需求源文档：PRD、场景对齐文档、用户提供的需求文本。
- 技术源文档：技术合同、实施设计，如果存在。
- 目标工作区域：front、back、android、deploy、docs 或 mixed。
- 用户和根级 `AGENTS.md` 中的不可突破约束。

如果用户没有指定要使用哪些 harness，启动 worker 前要简短确认。推荐最小有用集合：

- 始终读取：根级 `AGENTS.md`
- 前端工作：涉及 API/auth/data 时，读取 `front/.planning/codebase/ARCHITECTURE.md`、`STRUCTURE.md`、`INTEGRATIONS.md`
- 后端工作：涉及数据库时，读取 `back/.planning/codebase/ARCHITECTURE.md`、`STRUCTURE.md`、`DB_MIGRATIONS.md`
- Android 工作：读取 `android/README.md` 和 Android 本地指导文件
- 部署工作：读取 `deploy_something/README.md`

如果用户已经说“按你的推荐”，就按推荐 harness 继续。

## Android 工作

Android 任务必须把 `android/` 当作与 `front/`、`back/` 并列的独立子系统。

必读 Android harness：

- `android/AGENTS.md`
- `android/README.md`
- `android/settings.gradle.kts`
- `android/app/build.gradle.kts`

默认 Android 约束：

- 使用原生 Kotlin + Jetpack Compose + Material 3。
- 除非用户明确改变技术决策，不要改成 Flutter、React Native、Ionic、Capacitor 或 WebView shell。
- 使用 VS Code、Gradle、Android SDK command line tools、ADB、真机或 AVD。
- dev/prod product flavors 保持分离。
- prod API base URL 必须用 HTTPS 域名，不要用裸生产 IP。
- 优先复用现有 Web/front API。无法复用时，新增 mobile-generic endpoint；不要创建 Android-only 后端 API。
- 不要在未获授权时修改 Web 已使用的后端 API contract。
- 支持中英双语的功能，所有可见 Android 文案进入 i18n 结构。
- 遵守 Android git 规则：Gradle wrapper 和 build scripts 进入版本管理；`.gradle/`、build 输出、`local.properties`、IDE 文件、APK/AAB、签名临时文件不提交。

Android 交接记录还应包含：

- 本地 JDK 和 Android SDK 假设。
- ADB 路径、目标设备或 AVD 名称。
- dev/prod application ID 和 API base URL。
- dev 测试需要的后端服务状态。
- build/install 命令和截图/logcat 证据。

默认 Android 验证命令按实际项目调整：

```bash
cd android
./gradlew assembleDevDebug
./gradlew assembleProdDebug
adb devices -l
```

用户要求安装时，只安装任务范围内需要的 flavor。不要擅自安装 dev/prod 两套，除非这是既定任务范围。

## 交接文件

交接文件通常放在需求文档附近：

```text
docs/需求文档/<topic>/<feature-name>开发任务交接记录.md
```

创建新记录时，使用 `references/handoff-template.md` 作为模板，并针对当前功能具体化。

交接文件必须包含：

- 工作模式和 controller/worker 职责
- 源文档
- 需要读取的 harness
- 不可突破约束
- 当前基线和目标路径
- 推荐串行 worker 顺序
- 每个 worker 的目标、写入范围、禁止范围、验收检查
- 必填完成报告格式
- 执行日志：日期、worker 名称、改动文件、复用/新增 API、验证、遗留风险、下一位注意事项
- 真正可复用的代码库模式

## Worker Prompt 规则

启动 worker 时，必须提供：

- 它负责的精确功能阶段
- 交接文件路径
- 必须读取的源文档
- 必须读取的 harness
- 允许写入范围和禁止路径
- 期望验证命令
- 要求它更新或提供交接执行日志内容

每个 worker prompt 必须包含：

```text
你不是独自在这个代码库里工作。不要回滚别人做过的改动。与现有变更协作。补丁只限于你被分配的文件和职责范围。
```

一次只启动一个 worker。等待当前 worker 完成后，主控本地 review 改动、运行验证、更新交接文件，再启动下一位 worker。

## 验证

主控必须先验证每个 worker 的结果，再继续。

默认验证：

- 检查 changed files。
- 运行项目相关 typecheck/build/test 命令。
- UI 改动在可行且有意义时，用 browser/device/screenshot 验证。
- 后端改动检查 route、schema、幂等、鉴权，以及风险匹配的测试。
- 部署改动使用仓库部署脚本，并按项目策略保留备份。

可选 validator agent：

- 高风险流程使用 validator agent：auth、payment、data migration、deployment、跨项目集成、文件上传/下载，或用户指定关键路径。
- validator agent 只验证，不修代码。

## 进度与模式

可复用经验写入交接文件的 `Codebase Patterns`。如果经验稳定且广泛有用，在用户同意后或作为文档任务，更新合适的 `.planning/codebase/` 文档。

不要把新工作写入 `scripts/ralph/progress.txt`。

## 停止条件

遇到以下情况，停止并询问用户：

- 源文档互相矛盾，并影响产品行为。
- worker 需要修改禁止路径或现有 API contract。
- 必需外部服务、设备、凭据或素材不可用，且没有安全 fallback。
- 验证因同一原因反复失败，下一步只能靠猜。

否则，按串行计划继续，直到请求阶段完成。
