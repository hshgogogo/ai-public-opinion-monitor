# 已知失败模式

记录未来 agent loop 选择切片前必须检查的重复失败。

## 模板

```markdown
## <失败名称>

When:
- <什么时候出现>

Symptom:
- <表面现象>

Root cause:
- <根因>

Apply:
- <以后如何避免>

Verification:
- <如何验证修复>
```

## 临时 worktree 红测误用默认 Python runtime

When:
- 在临时 git worktree 中只应用测试补丁，运行 `test/fastapi-sidecar.test.js` 或 worker 相关 Node 测试做 TDD 红测。

Symptom:
- 大量测试同时失败，`spawnSync` status 为 `null`，或 Python stderr 显示缺少 `requests` / 找不到 `.venv/bin/python`。

Root cause:
- 临时 worktree 没有项目 `.venv`，测试默认 `PYTHON_BIN` 会解析到临时目录下不存在的 `.venv/bin/python` 或缺依赖 runtime，失败原因不是业务行为。

Apply:
- 临时 worktree 红测必须显式传入主仓库的绝对 `PYTHON_BIN=/Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor/.venv/bin/python`。
- 正常主仓库验证 worker 测试时也优先使用 `PYTHON_BIN=.venv/bin/python`。

Verification:
- 只有当旧实现下失败集中在新增断言或缺失接口上，才把它计为有效 RED；环境/依赖失败只能作为无效红测重跑。
