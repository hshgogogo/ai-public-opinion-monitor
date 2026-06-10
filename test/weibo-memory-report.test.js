import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("answers Weibo Q&A from retrieved evidence and generates cited daily report", () => {
  const risk = runMemory("为什么微博负面升高");
  assert.equal(risk.status, 0, risk.stderr || risk.stdout);
  const riskPayload = JSON.parse(risk.stdout);
  assert.equal(riskPayload.ok, true);
  assert.match(riskPayload.answer.text, /官宣可信度|非官宣|溜粉/);
  assert.equal(riskPayload.answer.citations.includes("event-1"), true);
  assert.equal(riskPayload.answer.citations.includes("comment-e1"), true);
  assert.match(riskPayload.dailyReport.markdown, /# Weibo MVP Daily Report/);
  assert.match(riskPayload.dailyReport.markdown, /event-1/);
  assert.equal(riskPayload.dailyReport.dataCoverage.events, 1);

  const action = runMemory("这个行动有效吗");
  const actionPayload = JSON.parse(action.stdout);
  assert.equal(actionPayload.answer.error.error_type, "insufficient_backtest_data");
  assert.match(actionPayload.answer.text, /no confirmed action\/backtest|insufficient/i);
  assert.equal(actionPayload.answer.citations.includes("action-1"), true);
});

test("returns no-data answer with standardized error when memory fixture is empty", () => {
  const result = runMemory("为什么负面升高", "test/fixtures/weibo-event-empty.jsonl");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.answer.error.error_type, "insufficient_evidence");
  assert.deepEqual(payload.answer.citations, []);
});

function runMemory(question, fixture = "test/fixtures/weibo-memory-records.json") {
  return spawnSync(
    python,
    [
      "workers/enterprise_worker.py",
      "weibo-memory-report-fixture",
      "--fixture",
      fixture,
      "--question",
      question,
      "--now",
      "2026-06-10T12:00:00Z"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}
