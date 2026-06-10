import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("runs full Weibo fixture E2E loop without real auth or MediaCrawler", () => {
  const result = spawnSync(
    python,
    ["workers/enterprise_worker.py", "weibo-fixture-e2e", "--now", "2026-06-10T12:00:00Z"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MYSQL_URL: "",
        DEEPSEEK_API_KEY: "",
        WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json",
        MEDIACRAWLER_HOME: "/tmp/mediacrawler-does-not-exist"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.noExternalDependencies, true);
  assert.deepEqual(payload.steps, [
    "migration_checked",
    "search_targets",
    "target_selected",
    "detail_comments",
    "analysis",
    "event_lead",
    "action_logged",
    "backtest",
    "qa_answer",
    "workbench"
  ]);
  assert.equal(payload.selectedTarget.recommendation_metadata.state, "recommended");
  assert.equal(payload.detail.comments.length > 0, true);
  assert.equal(payload.analysis.analyses.length > 0, true);
  assert.equal(payload.events.events.length > 0, true);
  assert.equal(payload.actions.actions.some((action) => action.source === "agent_recommended"), true);
  assert.equal(payload.backtest.results.some((item) => item.result === "unknown"), true);
  assert.equal(payload.qa.answer.citations.length > 0, true);
  assert.deepEqual(Object.keys(payload.workbench), [
    "mode",
    "setup",
    "judgments",
    "recommendedTargets",
    "events",
    "pendingActions",
    "dataGaps",
    "citations"
  ]);
  assert.equal(payload.workbench.mode, "weibo-agent-mvp");
  assert.equal(payload.workbench.setup.partialState, "fixture-e2e");
  assert.equal(payload.workbench.recommendedTargets.length > 0, true);
});
