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

  for (const token of ["source_kind", "source_id", "evidence_ids", "project_id", "report_date", "markdown_body"]) {
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

test("OpenSpec tasks keep external dependency and partial memory work unchecked", () => {
  const tasks = readText("openspec/changes/haidao-weibo-agent-mvp/tasks.md");

  for (const taskId of ["3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2", "4.3", "4.4", "4.8", "4.9", "5.5", "6.5", "7.1", "7.2", "7.5", "7.6", "7.7", "7.8"]) {
    assert.match(tasks, new RegExp(`- \\[x\\] ${taskId.replace(".", "\\.")}\\b`));
  }

  for (const taskId of ["4.7", "6.4", "9.12", "10.1", "11.5"]) {
    assert.match(tasks, new RegExp(`- \\[ \\] ${taskId.replace(".", "\\.")}\\b`));
  }
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
