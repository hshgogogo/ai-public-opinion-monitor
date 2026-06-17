import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(".");
const pythonBin = resolve(repoRoot, process.env.PYTHON_BIN || ".venv/bin/python");

function basePythonEnv() {
  const env = { ...process.env };
  delete env.MYSQL_URL;
  delete env.DEEPSEEK_API_KEY;
  delete env.DEEPSEEK_API_URL;
  delete env.DEEPSEEK_MODEL;
  delete env.WEIBO_COOKIE_FILE;
  delete env.SIDECAR_DOTENV_SENTINEL;
  env.YUQING_SKIP_ENV_FILE = "1";
  return env;
}

function runPython(code) {
  const result = spawnSync(pythonBin, ["-c", code], {
    cwd: repoRoot,
    env: basePythonEnv(),
    encoding: "utf8"
  });

  assert.equal(
    result.status,
    0,
    [
      "Python AgentReachAdapter assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("AgentReachAdapter executes allowlisted bilibili doctor and health with a fake runner", () => {
  runPython(`
import json
from app.agent_reach_adapter import AgentReachAdapter

calls = []

def fake_runner(request):
    calls.append(request)
    return {
        "status": "ok",
        "artifact_ref": "artifacts/agent-reach/bilibili/doctor-1.json",
        "stdout": "doctor ok from local fake runner",
        "stderr": "raw stderr must stay private",
        "summary": {
            "capability": "bilibili doctor",
            "diagnostic": "healthy"
        }
    }

adapter = AgentReachAdapter(runner=fake_runner)

doctor = adapter.run("bilibili", "doctor", {"projectId": 2})
health = adapter.run("bilibili", "health", {"projectId": 2})

assert doctor["platform"] == "bilibili", doctor
assert doctor["command"] == "doctor", doctor
assert doctor["status"] == "ok", doctor
assert doctor["artifact_ref"] == "artifacts/agent-reach/bilibili/doctor-1.json", doctor
assert doctor["summary"] == {"capability": "bilibili doctor", "diagnostic": "healthy"}, doctor
assert health["command"] == "health", health
assert calls == [
    {"platform": "bilibili", "command": "doctor", "payload": {"projectId": 2}},
    {"platform": "bilibili", "command": "health", "payload": {"projectId": 2}},
], calls

serialized = json.dumps([doctor, health], ensure_ascii=False)
for forbidden in ["raw stderr must stay private", "stderr"]:
    assert forbidden not in serialized, serialized
`);
});

test("AgentReachAdapter rejects non-allowlisted platforms and commands before runner execution", () => {
  runPython(`
from app.agent_reach_adapter import AgentReachAdapter

calls = []

def fake_runner(request):
    calls.append(request)
    raise AssertionError("runner must not execute for rejected requests")

adapter = AgentReachAdapter(runner=fake_runner)

bad_platform = adapter.run("xiaohongshu", "doctor", {"projectId": 2})
bad_command = adapter.run("bilibili", "search", {"projectId": 2})

assert calls == [], calls
assert bad_platform["ok"] is False, bad_platform
assert bad_platform["platform"] == "xiaohongshu", bad_platform
assert bad_platform["error_type"] == "agent_reach_platform_not_allowed", bad_platform
assert bad_command["ok"] is False, bad_command
assert bad_command["platform"] == "bilibili", bad_command
assert bad_command["command"] == "search", bad_command
assert bad_command["error_type"] == "agent_reach_command_not_allowed", bad_command
`);
});

test("AgentReachAdapter never exposes credentials, storage state, DB URLs, QR tokens, or raw worker stderr", () => {
  runPython(`
import json
from app.agent_reach_adapter import AgentReachAdapter

calls = []

def fake_runner(request):
    calls.append(request)
    return {
        "status": "failed",
        "artifact_ref": "artifacts/agent-reach/bilibili/health-1.json",
        "stdout": "read .env and config/cookies/bilibili.json",
        "stderr": "Traceback raw worker stderr Cookie=SUB=secret token=secret QR token mysql://root:secret@localhost/db",
        "error": "browser/storage_state.json includes authorization bearer secret",
        "summary": {
            "safe": "visible",
            "cookie": "SUB=secret",
            "db_url": "mysql://root:secret@localhost/db",
            "browser_state": "browser/storage_state.json",
            "nested": {
                "keep": "visible",
                "token": "secret-token",
                "line": "config/cookies/private.json"
            }
        }
    }

adapter = AgentReachAdapter(runner=fake_runner)
payload = adapter.run("bilibili", "health", {"projectId": 2})

assert calls == [{"platform": "bilibili", "command": "health", "payload": {"projectId": 2}}], calls
assert payload["platform"] == "bilibili", payload
assert payload["command"] == "health", payload
assert payload["status"] == "failed", payload
assert payload["error_type"] == "agent_reach_runner_failed", payload
assert payload["artifact_ref"] == "artifacts/agent-reach/bilibili/health-1.json", payload
assert payload["summary"] == {"safe": "visible", "nested": {"keep": "visible"}}, payload

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    ".env",
    "cookie",
    "config/cookies",
    "token",
    "mysql://",
    "db_url",
    "database_url",
    "browser/storage_state",
    "browser_state",
    "qr token",
    "raw worker stderr",
    "stderr",
    "traceback",
    "authorization",
    "bearer"
]:
    assert forbidden not in serialized, serialized
`);
});

test("AgentReachAdapter redacts camelCase sensitive runner summary keys", () => {
  runPython(`
import json
from app.agent_reach_adapter import AgentReachAdapter

def fake_runner(request):
    return {
        "status": "failed",
        "artifact_ref": "artifacts/agent-reach/bilibili/camel-case.json",
        "summary": {
            "safe": "visible",
            "browserState": "logged-in browser state",
            "databaseUrl": "mysql://root:secret@localhost/db",
            "dbUrl": "mysql+pymysql://root:secret@localhost/db",
            "mysqlUrl": "mariadb://root:secret@localhost/db",
            "dsn": "mysql://root:secret@localhost/db",
            "storageState": "browser/storage_state.json",
            "qrToken": "qr-login-token",
            "rawStderr": "raw worker stderr line",
            "workerStderr": "worker stderr line",
            "nested": {
                "keep": "visible",
                "databaseUrl": "mysql://nested:secret@localhost/db",
                "storageState": "nested-storage-state"
            }
        }
    }

adapter = AgentReachAdapter(runner=fake_runner)
payload = adapter.run("bilibili", "health", {"projectId": 2})

assert payload["summary"] == {"safe": "visible", "nested": {"keep": "visible"}}, payload

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    "browserstate",
    "databaseurl",
    "dburl",
    "mysqlurl",
    "storagestate",
    "qrtoken",
    "rawstderr",
    "workerstderr",
    "logged-in browser state",
    "mysql://",
    "mysql+pymysql://",
    "mariadb://",
    "qr-login-token",
    "raw worker stderr",
    "worker stderr",
    "nested-storage-state"
]:
    assert forbidden not in serialized, serialized
`);
});
