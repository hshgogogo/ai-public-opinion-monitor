import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("README documents Weibo MVP setup, fixture E2E, auth troubleshooting, and limitations in Chinese", () => {
  const readme = readFileSync("README.md", "utf8");

  for (const text of [
    "微博 MVP",
    "weibo-fixture-e2e",
    "MEDIACRAWLER_HOME",
    "MEDIACRAWLER_CDP_PORT",
    "WEIBO_COOKIE_FILE",
    "target_detail_unsupported",
    "real_weibo_auth_missing",
    "不启用小红书或抖音采集",
    "fixture 驱动的 MySQL 持久化",
    "MediaCrawler 微博 search/detail adapters",
    "tasks.md"
  ]) {
    assert.equal(readme.includes(text), true, text);
  }

  assert.equal(readme.includes("MySQL task 入库、DeepSeek 线上调用"), false);
});

test("README documents FastAPI Judge retry scope, handoff, and schema decision", () => {
  const readme = readFileSync("README.md", "utf8");
  const section = readme.slice(
    readme.indexOf("### FastAPI Judge retry quality gate"),
    readme.indexOf("面向影视制作公司的企业级 AI 舆情监测 Web 服务")
  );

  assert.match(section, /^### FastAPI Judge retry quality gate/m);
  assert.match(section, /POST \/api\/weibo\/agent-runs\/\{id\}\/judge\/reviews/);
  assert.match(section, /支持 `weibo-comments-analyze`、`weibo-events-build`、`weibo-actions-build`/);
  assert.match(section, /`weibo-bot-message`、Q&A、Report、Backtest 不在本 change 接入 Judge retry/);
  assert.match(section, /不接受 prompt、runtime module、Cookie 路径、DB URL、任意文件路径或旧 worker 任意命令/);
  assert.match(section, /`maxAttempts` 默认 3，且最多 3 次总尝试/);
  assert.match(section, /第 1 次 review 的 `retry_count=0`，第 2 次为 `1`，第 3 次为 `2`/);
  assert.match(section, /Judge 失败时追加 `judge_reviews`，记录 required changes、evidence errors、retry count 和白名单失败摘要/);
  assert.match(section, /第 3 次仍失败时，对应 step\/run 进入 `needs_human`，并通过 `feedback_items` 写入 `manual_handoff`/);
  assert.match(section, /不覆盖事实表，不决定情感分数、事件分数或 backtest signal，不自动确认现实宣发动作/);
  assert.match(section, /`judge_reviews\.retry_count`、`feedback_items`、`agent_step_runs\.output_json\/error_\*`/);
  assert.match(section, /失败输出摘要写入 `judge_reviews\.feedback_json\.failed_output_summary`，不新增 migration/);
  assert.match(section, /真实 MySQL persistence tests 仍需设置 `WEIBO_DB_PERSISTENCE_TEST_URL` 后运行/);
});
