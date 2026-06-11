import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("builds Weibo events from evidence thresholds and 72-hour merge windows", () => {
  const result = runEvents("test/fixtures/weibo-event-evidence.jsonl");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "weibo-agent-mvp");

  const formal = payload.events.find((event) => event.issue_key === "官宣可信度" && event.evidence_ids.includes("e1"));
  assert.equal(formal.event_type, "formal_event");
  assert.equal(formal.status, "escalating");
  assert.equal(formal.risk_level, "high");
  assert.equal(formal.evidence_ids.length, 3);
  assert.equal(formal.evidence_ids.includes("e3"), true);
  assert.equal(formal.evidence_ids.includes("e5"), false);
  assert.equal(formal.event_score > 8, true);
  assert.deepEqual(formal.related_artists.sort(), ["刘昊然", "李兰迪"]);
  assert.equal(formal.status_history.at(-1).to_status, "escalating");

  const lead = payload.events.find((event) => event.issue_key === "演员讨论");
  assert.equal(lead.event_type, "observation_lead");
  assert.equal(lead.status, "observing");
  assert.equal(lead.risk_level, "low");
  assert.equal(lead.evidence_ids.includes("e4"), true);
});

test("uses DeepSeek event explanation only after evidence exists and ignores model numeric risk", () => {
  const result = runEvents("test/fixtures/weibo-event-evidence.jsonl", [
    "--deepseek-response",
    "test/fixtures/deepseek-event-response.md"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.deepseek_event_explanation.status, "succeeded");

  const formal = payload.events.find((event) => event.issue_key === "官宣可信度" && event.evidence_ids.includes("e1"));
  assert.match(formal.event_identity, /^官宣可信度::2026-06-10T08:00:00Z::/);
  assert.equal(formal.title, "DeepSeek 官宣可信度风险升温");
  assert.match(formal.trigger_summary, /非官宣/);
  assert.deepEqual(formal.main_stances, ["质疑非官宣节奏", "要求官方确认", "担心粉圈对立"]);
  assert.match(formal.impact_assessment, /官方澄清/);
  assert.equal(formal.recommended_actions[0].action_type, "official_clarification");
  assert.equal(formal.event_score > 8, true);
  assert.notEqual(formal.event_score, 999);
  assert.equal(formal.risk_level, "high");
  assert.equal(formal.event_explanation.model, "deepseek-chat");
  assert.equal(formal.event_explanation.ignored_model_numbers.event_score, 999);
  assert.equal(formal.event_explanation.ignored_model_numbers.risk_level, "critical");
});

test("does not treat numeric-only DeepSeek event output as an applied explanation", () => {
  const result = runEvents("test/fixtures/weibo-event-evidence.jsonl", [
    "--deepseek-response",
    "test/fixtures/deepseek-event-numeric-only.md"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.deepseek_event_explanation.status, "not_run");
  assert.equal(payload.deepseek_event_explanation.reason, "no_allowed_event_explanation_fields");
  const formal = payload.events.find((event) => event.issue_key === "官宣可信度" && event.evidence_ids.includes("e1"));
  assert.equal(formal.title, "微博官宣可信度观察");
  assert.equal(formal.event_score > 8, true);
  assert.notEqual(formal.event_score, 999);
});

test("does not create Weibo events when there is no evidence", () => {
  const result = runEvents("test/fixtures/weibo-event-empty.jsonl", [
    "--deepseek-response",
    "test/fixtures/deepseek-event-response.md"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.data_gap, "no_evidence");
  assert.equal(payload.deepseek_event_explanation.status, "not_run");
  assert.equal(payload.deepseek_event_explanation.reason, "no_evidence");
});

function runEvents(fixture, extraArgs = []) {
  return spawnSync(
    python,
    ["workers/enterprise_worker.py", "weibo-build-events-fixture", "--fixture", fixture, ...extraArgs],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}
