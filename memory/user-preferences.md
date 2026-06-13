# 用户偏好

记录会影响未来 agent loop 的稳定产品偏好和工作流偏好。

- loop 通过验证后，优先让 Codex 在 feature branch 上自主继续开发。
- 普通 commit、feature branch push、PR 创建/更新不需要每轮人工确认。
- `main`/`master` push、PR merge、生产发布、真实凭据、生产数据库破坏性操作、大规模付费 API、合规风险必须人工确认。
- 相比只跑 checklist，更重视 outcome、rubric、evidence。
- 大型串行多 Agent 工作必须使用真实子 Agent 或 `$serial-agent-handoff`，不要只在一个回复里角色扮演多个子 Agent。
- harness 和项目说明尽量用中文书写，便于人工定位问题；命令、字段名、官方事件名可以保留英文。
