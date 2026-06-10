import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("parses Markdown-wrapped DeepSeek JSON and ignores model numeric metrics", () => {
  const result = runDeepSeekFixture(["--response", "test/fixtures/deepseek-response.md"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.defaults, { batch_size: 20, timeout_seconds: 60, retries: 1 });
  assert.equal(payload.agent_runs.some((run) => run.status === "succeeded"), true);
  assert.equal(payload.analyses.length, 2);

  const first = payload.analyses.find((item) => item.comment_id === "d1");
  assert.equal(first.model, "deepseek-chat");
  assert.equal(first.fallback_type, "none");
  assert.equal(first.weight < 999, true);
  assert.equal(first.analysis_json.ignored_model_numbers.weight, 999);
  assert.equal(first.analysis_json.ignored_model_numbers.event_score, 999);
  assert.equal(first.analysis_json.ignored_model_numbers.backtest_signal, "strong");
});

test("marks local fallback and preserves raw comments when DeepSeek fails", () => {
  const result = runDeepSeekFixture(["--simulate-failure", "timeout"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.deepseek.status, "failed");
  assert.equal(payload.deepseek.error_type, "deepseek_failed");
  assert.equal(payload.agent_runs.some((run) => run.status === "failed"), true);
  assert.equal(payload.raw_comments.length, 2);
  assert.equal(payload.analyses.length, 2);
  assert.equal(payload.analyses.every((item) => item.model === "local-rules"), true);
  assert.equal(payload.analyses.every((item) => item.fallback_type === "local_rules"), true);
});

function runDeepSeekFixture(extraArgs) {
  return spawnSync(
    python,
    [
      "workers/enterprise_worker.py",
      "weibo-deepseek-fixture",
      "--comments",
      "test/fixtures/deepseek-comments.jsonl",
      "--now",
      "2026-06-10T12:00:00Z",
      ...extraArgs
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}
