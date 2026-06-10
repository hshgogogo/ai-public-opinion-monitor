import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("computes Weibo backtest fixture signal levels and unknown missing-data result", () => {
  const result = spawnSync(
    python,
    ["workers/enterprise_worker.py", "weibo-backtest-fixture", "--fixture", "test/fixtures/weibo-backtest-scenarios.json"],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.deepEqual(payload.results.map((item) => item.result), ["strong", "medium", "weak", "no_signal", "negative", "unknown"]);

  const strong = payload.results[0];
  assert.equal(strong.eligible, true);
  assert.equal(strong.signal_level, "strong");
  assert.equal(strong.attribution_confidence > 0, true);
  assert.equal(Object.hasOwn(strong.metric_changes, "negative_rate_delta"), true);
  assert.equal(Array.isArray(strong.confounders), true);
  assert.match(strong.next_recommendation, /continue|monitor/i);

  const unknown = payload.results.at(-1);
  assert.equal(unknown.eligible, false);
  assert.equal(unknown.result, "unknown");
  assert.match(unknown.missing_data_reason, /confirmed|effective_at|baseline|post/i);
});
