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

if (process.env.FAKE_WORKER_MODE === "invalid_feedback_type") {
  process.stderr.write("fake worker diagnostic that must stay private\n");
  emit({
    ok: false,
    mode: "weibo-agent-mvp",
    command,
    error_type: "invalid_feedback_type",
    message: "Feedback type does not match sourceType.",
    cause: "event_confirmed is not allowed for sourceType action.",
    fix: "Use a feedbackType supported by the selected sourceType."
  });
  process.exit(0);
}

if (process.env.FAKE_WORKER_MODE === "invalid_feedback_status") {
  emit({
    ok: false,
    mode: "weibo-agent-mvp",
    command,
    error_type: "invalid_feedback_status",
    message: "Feedback status is invalid.",
    cause: "done is not a feedback ledger status.",
    fix: "Use status open, in_review, resolved, rejected, or archived."
  });
  process.exit(0);
}

if (process.env.FAKE_WORKER_MODE === "invalid_feedback_effective_at") {
  emit({
    ok: false,
    mode: "weibo-agent-mvp",
    command,
    error_type: "invalid_feedback_effective_at",
    message: "Feedback effectiveAt is invalid.",
    cause: "effectiveAt must be an ISO-8601 or MySQL timestamp.",
    fix: "Use an ISO-8601 timestamp."
  });
  process.exit(0);
}

if (process.env.FAKE_WORKER_MODE === "source_not_found") {
  emit({
    ok: false,
    mode: "weibo-agent-mvp",
    command,
    error_type: "event_not_found",
    message: "Feedback source event was not found.",
    cause: "The event id does not match this project.",
    fix: "Refresh events and retry with a valid event id."
  });
  process.exit(0);
}

if (process.env.FAKE_WORKER_MODE === "invalid_json_with_secret_stderr") {
  process.stderr.write("FAKE_SECRET_TOKEN_SHOULD_NOT_LEAK\n");
  process.stdout.write("{not-json");
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
