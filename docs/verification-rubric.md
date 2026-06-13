# 验证 Rubric

本文档定义通用软件开发项目中，agent loop 切片“完成”的标准。

## 必要完成信号

只有满足所有适用信号时，切片才算完成：

- 本切片有清晰 outcome 描述。
- 实现前写过 3-7 条 done rubric。
- 为本次行为变化新增或更新了测试。
- 定向验证通过。
- `npm test` 通过。
- 如果存在活跃 OpenSpec change，`openspec validate <CHANGE_ID> --strict` 通过。
- `git diff --check` 通过。
- 反驳式 review 没有未解决的 P0/P1/P2。
- evidence report 把每条 rubric 映射到证据，或明确标记未验证。
- 只在真正完成时更新 `tasks.md`。
- 用户使用方式、风险边界或可复用经验变化时，同步更新 docs 或 memory。

## 项目级最终完成信号

所有任务完成后，项目仍不算最终完成。必须通过 `docs/final-acceptance.md` 定义的真实使用验收。

项目级完成必须额外证明：

- 前端、后端、数据链路、异步任务、文档和运行方式都处于候选交付状态。
- Codex 使用 Computer Use 或浏览器工具完成了至少一条核心用户全流程。
- 验收期间同步监控了前端控制台、网络请求、后端日志、worker/队列日志、数据库或持久化结果。
- 真实使用中发现的问题已经回流到 agent loop，并通过修复切片重新验证。
- 最终验收报告包含操作路径、观察到的日志、发现的问题、修复记录、未验证范围和剩余风险。

## 产品质量线

面向用户的功能必须证明：

- 有清晰空状态
- 有可见加载/进度状态
- 有带有效摘要的成功状态
- 有带 `error_type` 和可操作建议的失败状态
- API 返回结构稳定
- 没有静默 spinner 或无法解释的失败
- 不把假数据包装成真实数据

## 数据、后端与 Worker 质量线

涉及数据处理、后端 API、异步任务、队列、worker 或外部集成的切片必须证明：

- 适用位置包含 `trace_id`、`run_id`、`task_id`、`stage`、`event`、`status`、`duration_ms`、`error_type`、`git_sha`、`redacted`
- 重试有上限
- 重复请求具备幂等性，或有明确保护
- 部分失败对用户和日志可见
- 原始外部数据、请求或任务产物路径有记录
- 解析、转换或持久化失败不会污染已有状态
- 自动化测试不触碰生产数据库

## 安全与风险线

切片涉及以下内容时，loop 必须暂停并请求人工确认：

- 真实账号登录
- 超出本地安全配置检查范围的 Cookie/token/`.env` 访问
- 提交或推送密钥
- 生产数据库破坏性迁移
- push `main`/`master`
- merge PR
- 发布生产
- 大规模付费 API 调用
- 法律或合规判断

## Evidence Report 检查清单

自动 commit/push/PR 前使用这份清单：

```text
Outcome:
-

Done rubric 证据:
1.
2.
3.

验证命令:
- targeted:
- npm test:
- openspec validate:
- git diff --check:
- git status --short:
- final acceptance:

反驳式 review:
- reviewer:
- P0/P1/P2:
- 修复:

未验证:
-

剩余风险:
-

下一切片:
-
```

## Commit 与 PR Gate

只有检查清单通过后，才允许自动 commit、push feature branch、创建或更新 PR。

绝不在 `main` 或 `master` 上自动 commit。必须先创建或切换到 `agent/<change-id>/<slice-name>` 分支。

最终项目验收通过前，不允许把项目描述为“完全完成”。
