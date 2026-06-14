import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("enterprise worker reports allowed real platforms only", () => {
  const result = spawnSync(python, ["workers/enterprise_worker.py", "health"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.platforms, ["weibo"]);
  assert.equal(payload.platforms.includes("xiaohongshu"), false);
  assert.equal(payload.platforms.includes("douyin"), false);
});

test("enterprise worker health reports Weibo MVP dependencies with actionable errors", () => {
  const result = spawnSync(python, ["workers/enterprise_worker.py", "health"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_URL: "",
      MEDIACRAWLER_HOME: "/tmp/mediacrawler-does-not-exist",
      MEDIACRAWLER_PYTHON: "/tmp/python-does-not-exist",
      MEDIACRAWLER_OUTPUT_DIR: "/tmp/weibo-mvp-test-output",
      MEDIACRAWLER_CDP_PORT: "65534",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
    }
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.platforms.length, 1);
  assert.equal(payload.weiboMvp.mediacrawler.home.ok, false);
  assert.equal(payload.weiboMvp.mediacrawler.home.error.error_type, "mediacrawler_missing");
  assert.equal(payload.weiboMvp.mediacrawler.python.error.error_type, "mediacrawler_python_missing");
  assert.equal(payload.weiboMvp.cdp.error.error_type, "chrome_cdp_unavailable");
  assert.equal(payload.weiboMvp.auth.status, "missing");
  assert.equal(payload.weiboMvp.auth.error.error_type, "auth_required");

  for (const error of [
    payload.weiboMvp.mediacrawler.home.error,
    payload.weiboMvp.mediacrawler.python.error,
    payload.weiboMvp.cdp.error,
    payload.weiboMvp.auth.error
  ]) {
    assert.equal(typeof error.message, "string");
    assert.equal(typeof error.cause, "string");
    assert.equal(typeof error.fix, "string");
  }
});

test("Weibo MVP migration chunk declares ingestion tables and columns", () => {
  const sql = readText("migrations/002_weibo_mvp_ingestion.sql");

  assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  assert.match(sql, /INFORMATION_SCHEMA\.COLUMNS/i);
  assert.doesNotMatch(sql, /\n\s+rank\s+INT/i);
  assert.match(sql, /`rank`\s+INT/i);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS discovered_targets/i);
  assert.match(sql, /uniq_discovered_project_platform_external/i);
  assert.match(sql, /project_id,\s*platform,\s*external_id/i);
  for (const column of [
    "target_locator",
    "target_type",
    "external_id",
    "weibo_mid",
    "author_external_id",
    "author_url",
    "content_fingerprint",
    "hot_score",
    "recommendation_metadata",
    "selected_status",
    "source_type",
    "source_match_method",
    "source_match_confidence"
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  }

  assert.match(sql, /CREATE TABLE IF NOT EXISTS target_collection_links/i);
  for (const column of ["crawler_engine", "crawler_type", "error_type", "output_path", "raw_files", "parsed_records", "failed_records", "target_id"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  }
  for (const status of ["partial", "analyzing", "analyzed"]) {
    assert.match(sql, new RegExp(status, "i"));
  }
  for (const status of ["expired", "verification_required", "rate_limited", "unknown", "configured"]) {
    assert.match(sql, new RegExp(status, "i"));
  }
  assert.match(sql, /DROP INDEX uniq_platform_external/i);
  assert.match(sql, /uniq_project_platform_external/i);
  assert.match(sql, /DROP INDEX uniq_comment_platform_external/i);
  assert.match(sql, /uniq_comment_project_platform_external/i);
});

test("Weibo MVP event action backtest migration declares ledger tables", () => {
  const sql = readText("migrations/003_weibo_mvp_event_action.sql");

  for (const table of [
    "source_accounts",
    "artist_public_opinion_events",
    "event_evidence_links",
    "event_status_history",
    "publicity_actions",
    "action_backtests"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"));
  }

  for (const token of [
    "agent_recommended",
    "user_confirmed",
    "official_observed",
    "matrix_inferred",
    "manual_log",
    "pending",
    "confirmed",
    "rejected",
    "partial",
    "uncertain",
    "unknown",
    "signal_level",
    "attribution_confidence",
    "confounders"
  ]) {
    assert.match(sql, new RegExp(token, "i"));
  }
  assert.match(sql, /DROP INDEX uniq_source_account_external/i);
  assert.match(sql, /uniq_project_source_account_external/i);
  assert.match(sql, /uniq_project_source_account_display/i);
  assert.match(sql, /event_identity/i);
  assert.match(sql, /uniq_event_project_platform_identity/i);
});

test("Weibo MVP memory report migration declares bot memory tables", () => {
  const sql = readText("migrations/004_weibo_mvp_memory_report.sql");

  for (const table of [
    "bot_memory_items",
    "bot_conversations",
    "bot_messages",
    "daily_reports"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"));
  }

  for (const token of ["source_kind", "source_id", "memory_identity", "evidence_ids", "project_id", "report_date", "markdown_body", "uniq_memory_project_kind_identity"]) {
    assert.match(sql, new RegExp(token, "i"));
  }
});

test("Weibo MVP sentiment migration extends analysis fields and migration order", () => {
  const sql = readText("migrations/005_weibo_mvp_sentiment.sql");
  const dbPy = readText("workers/db.py");

  assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  assert.match(sql, /INFORMATION_SCHEMA\.COLUMNS/i);

  for (const column of [
    "stance",
    "issue_summary",
    "intensity",
    "weight_snapshot",
    "analysis_json",
    "fallback_type",
    "analyzed_at"
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  }

  for (const migration of [
    "002_weibo_mvp_ingestion.sql",
    "003_weibo_mvp_event_action.sql",
    "004_weibo_mvp_memory_report.sql",
    "005_weibo_mvp_sentiment.sql"
  ]) {
    assert.match(dbPy, new RegExp(migration.replace(/[.]/g, "\\.")));
  }
});

test("Agent Harness loop migration declares ledger tables and migration order", () => {
  const sql = readText("migrations/006_agent_harness_loop.sql");
  const dbPy = readText("workers/db.py");

  assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);

  for (const table of [
    "agent_loop_runs",
    "agent_step_runs",
    "judge_reviews",
    "feedback_items"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"));
  }

  for (const token of [
    "trigger_mode",
    "current_step",
    "summary_json",
    "evidence_ids",
    "judge_agent_name",
    "required_changes",
    "evidence_errors",
    "feedback_type",
    "handled_at",
    "needs_human"
  ]) {
    assert.match(sql, new RegExp(token, "i"));
  }

  const sentimentMigrationIndex = dbPy.indexOf("005_weibo_mvp_sentiment.sql");
  const harnessMigrationIndex = dbPy.indexOf("006_agent_harness_loop.sql");
  assert.equal(sentimentMigrationIndex >= 0, true);
  assert.equal(harnessMigrationIndex > sentimentMigrationIndex, true);
});

test("Feedback memory loop migration declares OpenSpec-compatible enums", () => {
  const harnessSql = readText("migrations/006_agent_harness_loop.sql");
  const eventActionSql = readText("migrations/003_weibo_mvp_event_action.sql");
  const memorySql = readText("migrations/004_weibo_mvp_memory_report.sql");

  assert.deepEqual(enumValuesFromModify(harnessSql, "source_type"), [
    "loop",
    "step",
    "judge_review",
    "event",
    "action",
    "account",
    "preference",
    "knowledge",
    "rule",
    "other",
    "source_account"
  ]);
  assert.deepEqual(enumValuesFromModify(harnessSql, "feedback_type"), [
    "manual_handoff",
    "needs_human",
    "confirmed",
    "rejected",
    "modified",
    "comment",
    "preference",
    "other",
    "event_confirmed",
    "event_rejected",
    "event_observation_only",
    "event_note",
    "action_confirmed",
    "action_rejected",
    "action_partially_executed",
    "action_not_executed",
    "action_note",
    "source_type_corrected",
    "preference_added",
    "preference_updated",
    "manual_handoff_resolved",
    "manual_handoff_note"
  ]);
  assert.deepEqual(enumValuesFromModify(eventActionSql, "status"), [
    "observing",
    "escalating",
    "stable",
    "resolved",
    "archived",
    "confirmed",
    "rejected"
  ]);
  assert.deepEqual(enumValuesFromModify(eventActionSql, "source_type"), [
    "official",
    "artist",
    "producer",
    "marketing",
    "suspected_matrix",
    "media",
    "fan",
    "organic",
    "unknown"
  ]);
  assert.deepEqual(enumValuesFromModify(memorySql, "source_kind"), [
    "target",
    "comment",
    "analysis",
    "event",
    "action",
    "backtest",
    "report",
    "preference",
    "conversation",
    "source_account"
  ]);
});

test("Agent Harness worker ledger commands expose only run/status public HTTP in trigger API slice", () => {
  const worker = readText("workers/enterprise_worker.py");
  const server = readText("src/server.js");

  for (const helper of [
    "create_agent_loop_run",
    "record_agent_step_run",
    "start_agent_step_run",
    "succeed_agent_step_run",
    "partially_complete_agent_step_run",
    "fail_agent_step_run",
    "mark_agent_step_needs_human",
    "record_judge_review",
    "record_manual_handoff"
  ]) {
    assert.match(worker, new RegExp(`def ${helper}\\(`));
  }

  for (const command of [
    "weibo-agent-loop-run",
    "weibo-agent-loop-status",
    "weibo-agent-loop-step",
    "weibo-agent-loop-judge-review",
    "weibo-agent-loop-handoff"
  ]) {
    assert.match(worker, new RegExp(command));
  }

  assert.match(server, /agent-loop\/run/i);
  assert.match(server, /agent-runs/i);
  assert.doesNotMatch(server, /agent-loop\/step|agent-loop\/judge|agent-loop\/handoff/i);
});

test("Agent Harness worker ledger commands return mysql_unavailable without MySQL", () => {
  const commands = [
    "weibo-agent-loop-run",
    "weibo-agent-loop-status",
    "weibo-agent-loop-step",
    "weibo-agent-loop-judge-review",
    "weibo-agent-loop-handoff"
  ];

  for (const command of commands) {
    const payloadJson = command === "weibo-agent-loop-handoff"
      ? JSON.stringify({ sourceType: "loop", sourceId: 1 })
      : "{}";
    const result = spawnSync(python, ["workers/enterprise_worker.py", command, "--payload-json", payloadJson], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MYSQL_URL: "",
        WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
      }
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error_type, "mysql_unavailable");
    assert.match(payload.endpoint, new RegExp(command));
  }
});

test("Agent Harness worker ledger commands return standard errors for malformed JSON", () => {
  const commands = [
    "weibo-agent-loop-run",
    "weibo-agent-loop-status",
    "weibo-agent-loop-step",
    "weibo-agent-loop-judge-review",
    "weibo-agent-loop-handoff"
  ];

  for (const command of commands) {
    const result = spawnSync(python, ["workers/enterprise_worker.py", command, "--payload-json", "{"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MYSQL_URL: "",
        WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
      }
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error_type, "invalid_agent_loop_payload");
    assert.match(payload.endpoint, new RegExp(command));
    assert.equal(typeof payload.cause, "string");
    assert.equal(typeof payload.fix, "string");
  }
});

test("Feedback memory loop exposes worker/API command and no-DB safety contract", () => {
  const worker = readText("workers/enterprise_worker.py");
  const server = readText("src/server.js");
  const dbPy = readText("workers/db.py");

  assert.match(worker, /weibo-feedback/);
  assert.match(worker, /def weibo_feedback_payload\(/);
  assert.match(worker, /event_confirmed/);
  assert.match(worker, /action_rejected/);
  assert.match(worker, /source_type_corrected/);
  assert.match(worker, /preference_added/);
  assert.match(server, /\/api\/weibo\/feedback/);
  assert.match(server, /YUQING_SKIP_ENV_FILE/);
  assert.match(dbPy, /YUQING_SKIP_ENV_FILE/);
  assert.doesNotMatch(server, /agent-loop\/step|agent-loop\/judge|agent-loop\/handoff/i);

  const result = spawnSync(python, [
    "workers/enterprise_worker.py",
    "weibo-feedback",
    "--payload-json",
    JSON.stringify({
      projectId: 1,
      sourceType: "event",
      sourceId: 42,
      feedbackType: "event_confirmed"
    })
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      YUQING_SKIP_ENV_FILE: "1",
      MYSQL_URL: "",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
    }
  });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error_type, "mysql_unavailable");
  assert.match(payload.endpoint, /weibo-feedback/);
  assert.equal(typeof payload.cause, "string");
  assert.equal(typeof payload.fix, "string");
});

test("Feedback memory loop rejects source and feedback type mismatch before persistence", () => {
  const result = spawnSync(python, [
    "workers/enterprise_worker.py",
    "weibo-feedback",
    "--payload-json",
    JSON.stringify({
      projectId: 1,
      sourceType: "action",
      sourceId: 7,
      feedbackType: "event_confirmed"
    })
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      YUQING_SKIP_ENV_FILE: "1",
      MYSQL_URL: "",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
    }
  });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error_type, "invalid_feedback_type");
  assert.match(payload.message, /feedback/i);
  assert.equal(typeof payload.cause, "string");
  assert.equal(typeof payload.fix, "string");
});

test("Feedback memory loop validates positive project and source ids before persistence", () => {
  for (const body of [
    { projectId: 0, sourceType: "event", sourceId: 42, feedbackType: "event_confirmed" },
    { projectId: 1, sourceType: "event", sourceId: 0, feedbackType: "event_confirmed" },
    { projectId: 1, sourceType: "event", sourceId: "-7", feedbackType: "event_confirmed" }
  ]) {
    const result = spawnSync(python, [
      "workers/enterprise_worker.py",
      "weibo-feedback",
      "--payload-json",
      JSON.stringify(body)
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        YUQING_SKIP_ENV_FILE: "1",
        MYSQL_URL: "",
        WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
      }
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error_type, /^invalid_feedback_/);
    assert.equal(typeof payload.cause, "string");
    assert.equal(typeof payload.fix, "string");
  }
});

test("Feedback memory loop rejects unsupported feedback ledger status before persistence", () => {
  for (const status of ["done", "", [], {}]) {
    const result = spawnSync(python, [
      "workers/enterprise_worker.py",
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId: 1,
        sourceType: "event",
        sourceId: 42,
        feedbackType: "event_confirmed",
        status
      })
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        YUQING_SKIP_ENV_FILE: "1",
        MYSQL_URL: "mysql://root:bad@127.0.0.1:1/missing",
        WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
      }
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error_type, "invalid_feedback_status");
    assert.match(payload.fix, /open/);
  }
});

test("Agent Harness foundation docs preserve compatibility boundaries", () => {
  const readme = readText("README.md");
  const server = readText("src/server.js");
  const frontend = readText("public/app.js");
  const worker = readText("workers/enterprise_worker.py");

  assert.match(readme, /Agent Harness 基础层/);
  assert.match(readme, /worker-only 契约/);
  assert.match(readme, /不新增公开 HTTP endpoint/);
  assert.match(readme, /不修改前端 workbench/);
  assert.match(readme, /weibo-comments-analyze/);
  assert.match(readme, /weibo-events-build/);
  assert.match(readme, /weibo-actions-build/);
  assert.match(readme, /weibo-bot-message/);
  assert.match(readme, /haidao-agent-loop-step-attachment/);
  assert.match(readme, /haidao-feedback-memory-loop/);

  assert.match(server, /agent-loop\/run/i);
  assert.match(server, /agent-runs/i);
  assert.doesNotMatch(server, /agent-loop\/step|agent-loop\/judge|agent-loop\/handoff/i);
  assert.doesNotMatch(frontend, /agent-loop\/run|agent-runs|weibo-agent-loop/i);
  for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
    assert.doesNotMatch(worker, new RegExp(`${command}[\\s\\S]{0,200}agentLoopRunId`));
  }
});

test("Agent Harness handoff command requires a status-visible source association", () => {
  const result = spawnSync(python, [
    "workers/enterprise_worker.py",
    "weibo-agent-loop-handoff",
    "--payload-json",
    JSON.stringify({ sourceType: "other", feedbackType: "manual_handoff" })
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_URL: "",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
    }
  });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error_type, "invalid_agent_loop_payload");
  assert.match(payload.fix, /sourceType/);
});

test("OpenSpec tasks include real environment and design pass evidence", () => {
  const tasks = readText("openspec/changes/haidao-weibo-agent-mvp/tasks.md")
    || readText("openspec/changes/archive/2026-06-11-haidao-weibo-agent-mvp/tasks.md");

  for (const taskId of ["3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2", "4.3", "4.4", "4.7", "4.8", "4.9", "5.5", "6.4", "6.5", "7.1", "7.2", "7.5", "7.6", "7.7", "7.8"]) {
    assert.match(tasks, new RegExp(`- \\[x\\] ${taskId.replace(".", "\\.")}\\b`));
  }

  assert.match(tasks, /- \[x\] 9\.12\b/);
  assert.match(tasks, /Local Claude Code design pass succeeded/);
  assert.match(tasks, /- \[x\] 10\.1\b/);
  assert.match(tasks, /- \[x\] 11\.5\b/);
});

test("Weibo discovery target persistence uses atomic MySQL upsert", () => {
  const worker = readText("workers/enterprise_worker.py");
  const section = worker.match(/def persist_discovered_targets[\s\S]*?\ndef find_discovered_target/)?.[0] || "";

  assert.match(section, /ON DUPLICATE KEY UPDATE/i);
  assert.match(section, /LAST_INSERT_ID\(id\)/i);
  assert.match(section, /selected_status=IF\(selected_status IN \('selected','ignored'\)/i);
  assert.doesNotMatch(section, /discovered_target_id/);
  assert.doesNotMatch(worker, /def discovered_target_id/);
});

test("Weibo event and source account persistence use atomic MySQL upsert", () => {
  const worker = readText("workers/enterprise_worker.py");
  const eventsSection = worker.match(/def persist_events[\s\S]*?\ndef persist_source_accounts/)?.[0] || "";
  const sourceAccountsSection = worker.match(/def persist_source_accounts[\s\S]*?\ndef persist_publicity_actions/)?.[0] || "";

  assert.match(eventsSection, /ON DUPLICATE KEY UPDATE/i);
  assert.match(eventsSection, /LAST_INSERT_ID\(id\)/i);
  assert.doesNotMatch(eventsSection, /SELECT\s+id\s+FROM\s+artist_public_opinion_events/i);

  assert.match(sourceAccountsSection, /ON DUPLICATE KEY UPDATE/i);
  assert.match(sourceAccountsSection, /LAST_INSERT_ID\(id\)/i);
  assert.doesNotMatch(sourceAccountsSection, /SELECT\s+id\s+FROM\s+source_accounts/i);
});

test("Weibo publicity action persistence uses atomic MySQL upsert", () => {
  const sql = readText("migrations/003_weibo_mvp_event_action.sql");
  const worker = readText("workers/enterprise_worker.py");
  const actionsSection = worker.match(/def persist_publicity_actions[\s\S]*?\ndef persist_memory_report/)?.[0] || "";

  assert.match(sql, /action_identity/);
  assert.match(sql, /uniq_action_project_platform_identity/);
  assert.match(actionsSection, /ON DUPLICATE KEY UPDATE/i);
  assert.match(actionsSection, /LAST_INSERT_ID\(id\)/i);
});

test("default project and env example are Weibo MVP scoped", () => {
  const dbPy = readText("workers/db.py");
  const env = readText(".env.example");

  assert.match(dbPy, /"active_platforms": \["weibo"\]/);
  assert.match(dbPy, /"keywords": \["海岛舒服日志", "刘昊然", "李兰迪"\]/);
  assert.match(dbPy, /"actors": \["刘昊然", "李兰迪"\]/);
  assert.match(env, /^MEDIACRAWLER_HOME=/m);
  assert.match(env, /^MEDIACRAWLER_COMMIT=/m);
  assert.match(env, /^MEDIACRAWLER_PYTHON=/m);
  assert.match(env, /^MEDIACRAWLER_OUTPUT_DIR=/m);
  assert.match(env, /^MEDIACRAWLER_CDP_PORT=/m);
});

test("Weibo MVP worker text does not present Xiaohongshu or Douyin as active strategy surfaces", () => {
  const worker = readText("workers/enterprise_worker.py");

  assert.equal(worker.includes('"抖音"'), false);
  assert.equal(worker.includes('"小红书"'), false);
  assert.equal(worker.includes("三平台"), false);
});

test("fixture hello-world path returns a Weibo workbench shell without real dependencies", () => {
  const result = spawnSync(python, ["workers/enterprise_worker.py", "weibo-fixture-hello"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_URL: "",
      MEDIACRAWLER_HOME: "/tmp/mediacrawler-does-not-exist",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json"
    }
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.fixture, true);
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
  assert.equal(payload.workbench.events.length, 0);
  assert.equal(payload.workbench.pendingActions.length, 0);
});

function readText(path) {
  return spawnSync("node", ["-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(path)}, "utf8"))`], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).stdout;
}

function enumValuesFromModify(sql, columnName) {
  const pattern = new RegExp(`MODIFY\\s+COLUMN\\s+\`?${columnName}\`?\\s+ENUM\\(([^)]*)\\)`, "i");
  const match = sql.match(pattern);
  assert.ok(match, `expected MODIFY COLUMN enum for ${columnName}`);
  return mysqlEnumValues(match[1]);
}

function mysqlEnumValues(enumBody) {
  const values = [];
  const regex = /'((?:''|[^'])*)'/g;
  let match;
  while ((match = regex.exec(enumBody)) !== null) {
    values.push(match[1].replaceAll("''", "'"));
  }
  return values;
}
