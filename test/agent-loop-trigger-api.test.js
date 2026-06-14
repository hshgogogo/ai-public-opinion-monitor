import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { server } from "../src/server.js";

const fakeWorker = "scripts/fake_agent_loop_worker.mjs";

async function withFakeWorker(t, mode = "ok") {
  const originalPython = process.env.PYTHON_BIN;
  const originalWorkerScript = process.env.ENTERPRISE_WORKER_SCRIPT;
  const originalLog = process.env.FAKE_WORKER_LOG;
  const originalMode = process.env.FAKE_WORKER_MODE;
  const dir = await mkdtemp(join(tmpdir(), "agent-loop-api-"));
  const logPath = join(dir, "worker.jsonl");
  process.env.PYTHON_BIN = process.execPath;
  process.env.ENTERPRISE_WORKER_SCRIPT = fakeWorker;
  process.env.FAKE_WORKER_LOG = logPath;
  process.env.FAKE_WORKER_MODE = mode;
  t.after(async () => {
    if (originalPython === undefined) delete process.env.PYTHON_BIN;
    else process.env.PYTHON_BIN = originalPython;
    if (originalWorkerScript === undefined) delete process.env.ENTERPRISE_WORKER_SCRIPT;
    else process.env.ENTERPRISE_WORKER_SCRIPT = originalWorkerScript;
    if (originalLog === undefined) delete process.env.FAKE_WORKER_LOG;
    else process.env.FAKE_WORKER_LOG = originalLog;
    if (originalMode === undefined) delete process.env.FAKE_WORKER_MODE;
    else process.env.FAKE_WORKER_MODE = originalMode;
    await rm(dir, { recursive: true, force: true });
  });
  return logPath;
}

async function listen(t) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function calls(logPath) {
  try {
    const text = await readFile(logPath, "utf8");
    return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test("POST /api/weibo/agent-loop/run maps public mode to the ledger worker only", async (t) => {
  const logPath = await withFakeWorker(t);
  const base = await listen(t);

  for (const mode of ["manual", "scheduled", "after_collection"]) {
    const response = await fetch(`${base}/api/weibo/agent-loop/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: 1, mode, targetId: 12, input: { source: "test" } })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.agentLoopRunId, 42);
    assert.equal(payload.status, "running");
  }

  const recorded = await calls(logPath);
  assert.deepEqual(recorded.map((item) => item.command), [
    "weibo-agent-loop-run",
    "weibo-agent-loop-run",
    "weibo-agent-loop-run"
  ]);
  assert.deepEqual(recorded.map((item) => item.payload.triggerMode), ["manual", "scheduled", "after_collection"]);
  assert.equal(recorded.every((item) => !("mode" in item.payload)), true);
});

test("GET /api/weibo/agent-runs/:id returns run status with manual handoff fields", async (t) => {
  const logPath = await withFakeWorker(t);
  const base = await listen(t);

  const response = await fetch(`${base}/api/weibo/agent-runs/42?projectId=1`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.agentLoopRunId, 42);
  assert.equal(payload.status, "needs_human");
  assert.equal(payload.currentStep, "judge_review");
  assert.equal(payload.retryCount, 2);
  assert.equal(payload.run.id, 42);
  assert.equal(payload.steps.length, 1);
  assert.equal(payload.manualHandoffs.length, 1);
  assert.equal(payload.manualHandoffs[0].feedback_type, "manual_handoff");
  assert.equal("feedbackItems" in payload, false);
  assert.equal(payload.judgeReviews[0].retry_count, 2);

  const recorded = await calls(logPath);
  assert.deepEqual(recorded.map((item) => item.command), ["weibo-agent-loop-status"]);
  assert.equal(recorded[0].payload.loopRunId, 42);
});

test("Agent Loop trigger API rejects invalid public payloads before worker calls", async (t) => {
  const logPath = await withFakeWorker(t);
  const base = await listen(t);

  for (const body of [
    { mode: "fixture" },
    { mode: "invalid" },
    { projectId: "not-a-number", mode: "manual" }
  ]) {
    const response = await fetch(`${base}/api/weibo/agent-loop/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(typeof payload.error_type, "string");
    assert.equal(typeof payload.cause, "string");
    assert.equal(typeof payload.fix, "string");
  }

  const invalidRun = await fetch(`${base}/api/weibo/agent-runs/not-a-number`);
  const invalidRunPayload = await invalidRun.json();
  assert.equal(invalidRun.status, 400);
  assert.equal(invalidRunPayload.error_type, "invalid_agent_run_id");

  assert.deepEqual(await calls(logPath), []);
});

test("Agent Loop trigger API maps MySQL unavailable errors without losing cause and fix", async (t) => {
  const logPath = await withFakeWorker(t, "mysql_unavailable");
  const base = await listen(t);

  const postResponse = await fetch(`${base}/api/weibo/agent-loop/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "manual" })
  });
  const postPayload = await postResponse.json();

  assert.equal(postResponse.status, 503);
  assert.equal(postPayload.error_type, "mysql_unavailable");
  assert.equal(typeof postPayload.cause, "string");
  assert.equal(typeof postPayload.fix, "string");

  const getResponse = await fetch(`${base}/api/weibo/agent-runs/42`);
  const getPayload = await getResponse.json();

  assert.equal(getResponse.status, 503);
  assert.equal(getPayload.error_type, "mysql_unavailable");
  assert.equal(typeof getPayload.cause, "string");
  assert.equal(typeof getPayload.fix, "string");

  const recorded = await calls(logPath);
  assert.deepEqual(recorded.map((item) => item.command), ["weibo-agent-loop-run", "weibo-agent-loop-status"]);
});

test("Agent Loop trigger API maps worker project errors to public validation errors", async (t) => {
  const logPath = await withFakeWorker(t, "worker_error");
  const base = await listen(t);

  const postResponse = await fetch(`${base}/api/weibo/agent-loop/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: 999, mode: "manual" })
  });
  const postPayload = await postResponse.json();

  assert.equal(postResponse.status, 400);
  assert.equal(postPayload.error_type, "project_not_found");
  assert.equal(typeof postPayload.cause, "string");
  assert.equal(typeof postPayload.fix, "string");

  const getResponse = await fetch(`${base}/api/weibo/agent-runs/42?projectId=999`);
  const getPayload = await getResponse.json();

  assert.equal(getResponse.status, 400);
  assert.equal(getPayload.error_type, "project_not_found");
  assert.equal(typeof getPayload.cause, "string");
  assert.equal(typeof getPayload.fix, "string");

  const recorded = await calls(logPath);
  assert.deepEqual(recorded.map((item) => item.command), ["weibo-agent-loop-run", "weibo-agent-loop-status"]);
});

test("front-end does not expose Agent Loop trigger controls in this slice", async () => {
  const [html, settingsHtml, js] = await Promise.all([
    readFile("public/index.html", "utf8"),
    readFile("public/settings.html", "utf8"),
    readFile("public/app.js", "utf8")
  ]);

  for (const text of [html, settingsHtml, js]) {
    assert.doesNotMatch(text, /\/api\/weibo\/agent-loop\/run/);
    assert.doesNotMatch(text, /\/api\/weibo\/agent-runs/);
  }
});
