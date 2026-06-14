#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const [, , command, ...args] = process.argv;
const logPath = process.env.FAKE_WORKER_LOG;

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function payload() {
  const raw = argValue("--payload-json") || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function record(payloadJson) {
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify({ command, payload: payloadJson })}\n`);
}

function emit(body) {
  process.stdout.write(JSON.stringify(body));
}

const request = payload();
record(request);

if (process.env.FAKE_WORKER_MODE === "mysql_unavailable") {
  emit({
    ok: false,
    mode: "weibo-agent-mvp",
    command,
    error_type: "mysql_unavailable",
    cause: "Fake worker has no MySQL.",
    fix: "Set MYSQL_URL for a test database."
  });
  process.exit(0);
}

if (process.env.FAKE_WORKER_MODE === "worker_error") {
  emit({
    ok: false,
    mode: "weibo-agent-mvp",
    command,
    error_type: "project_not_found",
    cause: "Fake project is missing.",
    fix: "Use a valid projectId."
  });
  process.exit(0);
}

if (command === "weibo-agent-loop-run") {
  emit({
    ok: true,
    mode: "weibo-agent-mvp",
    command,
    run: {
      id: 42,
      project_id: Number(request.projectId || 1),
      platform: "weibo",
      trigger_mode: request.triggerMode,
      target_id: request.targetId || null,
      status: "running",
      current_step: "queued"
    }
  });
  process.exit(0);
}

if (command === "weibo-agent-loop-status") {
  emit({
    ok: true,
    mode: "weibo-agent-mvp",
    command,
    run: {
      id: Number(request.loopRunId),
      project_id: Number(request.projectId || 1),
      platform: "weibo",
      status: "needs_human",
      current_step: "judge_review"
    },
    steps: [
      { id: 7, status: "failed", step_name: "comment_analysis" }
    ],
    judgeReviews: [
      { id: 8, status: "needs_human", retry_count: 2 }
    ],
    feedbackItems: [
      { id: 9, source_type: "loop", source_id: Number(request.loopRunId), feedback_type: "manual_handoff", status: "open" }
    ]
  });
  process.exit(0);
}

emit({
  ok: false,
  mode: "weibo-agent-mvp",
  command,
  error_type: "unexpected_command",
  cause: `Unexpected command ${command}.`,
  fix: "Use an Agent Loop ledger command."
});
