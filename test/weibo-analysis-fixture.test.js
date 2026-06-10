import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("analyzes Weibo comment fixture with structured fields and deterministic weights", () => {
  const result = spawnSync(
    python,
    [
      "workers/enterprise_worker.py",
      "weibo-analyze-comments-fixture",
      "--fixture",
      "test/fixtures/weibo-comments-analysis.jsonl",
      "--now",
      "2026-06-10T12:00:00Z"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DEEPSEEK_API_KEY: "" }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.analyses.length, 3);

  for (const analysis of payload.analyses) {
    for (const field of [
      "comment_id",
      "sentiment",
      "score",
      "confidence",
      "topics",
      "risks",
      "stance",
      "issue_summary",
      "intensity",
      "weight",
      "evidence",
      "model",
      "fallback_type",
      "analyzed_at"
    ]) {
      assert.equal(Object.hasOwn(analysis, field), true, field);
    }
    assert.equal(analysis.model, "local-rules");
    assert.equal(analysis.fallback_type, "local_rules");
    assert.equal(typeof analysis.analysis_json, "object");
  }

  const hot = payload.analyses.find((item) => item.comment_id === "c-hot");
  const old = payload.analyses.find((item) => item.comment_id === "c-old");
  const risk = payload.analyses.find((item) => item.comment_id === "c-risk");
  assert.equal(hot.weight > old.weight, true);
  assert.equal(risk.weight < 999, true);
  assert.equal(risk.sentiment, "negative");
  assert.equal(risk.stance, "questioning");
  assert.equal(risk.risks.includes("官宣可信度"), true);
  assert.match(risk.issue_summary, /官宣可信度|粉丝/);
});
