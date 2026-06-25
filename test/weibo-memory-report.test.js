import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("labels platform evidence citations in Q&A and daily report while preserving citation strings", () => {
  const dir = mkdtempSync(join(tmpdir(), "platform-citation-fixture-"));
  try {
    const fixture = join(dir, "records.json");
    const platformIds = [
      "bilibili:project:2:item:BV1HDLOG0001",
      "xiaohongshu:project:2:item:xhs-note-1001",
      "bilibili:project:2:text:BV1HDLOG0001:transcript:zh-cn",
      "bilibili:project:2:text:BV1HDLOG0001:body",
      "bilibili:project:2:comment:r9001",
      "xiaohongshu:project:2:comment:xhs-comment-7001"
    ];
    writeFileSync(fixture, JSON.stringify({
      events: [
        {
          id: platformIds[0],
          title: "B站视频二创讨论",
          status: "observed",
          risk_level: "medium",
          raw_artifact_ref: "artifacts/agent-reach/bilibili/raw_stdout.json"
        },
        {
          id: platformIds[1],
          title: "小红书笔记种草反馈",
          status: "observed",
          risk_level: "low",
          stdout: "raw runner output token=secret"
        },
        {
          id: platformIds[2],
          title: "B站字幕提到演员阵容讨论",
          status: "observed",
          risk_level: "medium"
        },
        {
          id: platformIds[3],
          title: "B站正文补充暑期档信息",
          status: "observed",
          risk_level: "low"
        }
      ],
      comments: [
        {
          id: platformIds[4],
          content: "B站评论提到演员合作很有新鲜感。",
          sentiment: "positive",
          privateLoginState: "storage state should not leak"
        },
        {
          id: platformIds[5],
          content: "小红书评论说海岛质感适合暑期档。",
          sentiment: "positive",
          stderr: "Cookie=secret"
        }
      ],
      actions: [],
      backtests: [],
      memory: []
    }), "utf8");

    const result = runMemory("多平台反馈怎么样", fixture);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.answer.citations, platformIds);
    assert.equal(payload.answer.citations.every((item) => typeof item === "string"), true);
    assert.deepEqual(
      payload.answer.citationDetails.map((item) => ({ id: item.id, label: item.label })),
      [
        { id: platformIds[0], label: "B站视频" },
        { id: platformIds[1], label: "小红书笔记" },
        { id: platformIds[2], label: "B站字幕" },
        { id: platformIds[3], label: "B站正文" },
        { id: platformIds[4], label: "B站评论" },
        { id: platformIds[5], label: "小红书评论" }
      ]
    );
    assert.match(payload.dailyReport.markdown, /B站视频 bilibili:project:2:item:BV1HDLOG0001/);
    assert.match(payload.dailyReport.markdown, /B站字幕 bilibili:project:2:text:BV1HDLOG0001:transcript:zh-cn/);
    assert.match(payload.dailyReport.markdown, /B站正文 bilibili:project:2:text:BV1HDLOG0001:body/);
    assert.match(payload.dailyReport.markdown, /小红书评论 xiaohongshu:project:2:comment:xhs-comment-7001/);
    assert.deepEqual(
      payload.dailyReport.citationDetails.map((item) => ({ id: item.id, label: item.label })),
      [
        { id: platformIds[0], label: "B站视频" },
        { id: platformIds[1], label: "小红书笔记" },
        { id: platformIds[2], label: "B站字幕" },
        { id: platformIds[3], label: "B站正文" },
        { id: platformIds[4], label: "B站评论" },
        { id: platformIds[5], label: "小红书评论" }
      ]
    );
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["raw_artifact_ref", "raw_stdout", "raw runner output", "token=secret", "privateLoginState", "storage state", "Cookie=secret", "stderr"]) {
      assert.equal(serialized.includes(forbidden), false, serialized);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
