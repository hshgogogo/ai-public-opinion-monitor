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

test("AgentReachAdapter executes allowlisted douyin doctor and capability with a fake runner", () => {
  runPython(`
import json
from app.agent_reach_adapter import AgentReachAdapter

calls = []

def fake_runner(request):
    calls.append(request)
    command = request["command"]
    return {
        "status": "ok",
        "artifact_ref": f"artifacts/agent-reach/douyin/{command}-safe.json",
        "stdout": "douyin fake runner stdout must stay private",
        "stderr": "douyin fake runner stderr must stay private",
        "summary": {
            "platform": "douyin",
            "capability": command,
            "diagnostic": "fake-runner-contract-ok"
        }
    }

adapter = AgentReachAdapter(runner=fake_runner)

doctor = adapter.run("douyin", "doctor", {"projectId": 2})
capability = adapter.run("douyin", "capability", {"projectId": 2})

assert doctor == {
    "ok": True,
    "platform": "douyin",
    "command": "doctor",
    "status": "ok",
    "artifact_ref": "artifacts/agent-reach/douyin/doctor-safe.json",
    "summary": {
        "platform": "douyin",
        "capability": "doctor",
        "diagnostic": "fake-runner-contract-ok"
    }
}, doctor
assert capability == {
    "ok": True,
    "platform": "douyin",
    "command": "capability",
    "status": "ok",
    "artifact_ref": "artifacts/agent-reach/douyin/capability-safe.json",
    "summary": {
        "platform": "douyin",
        "capability": "capability",
        "diagnostic": "fake-runner-contract-ok"
    }
}, capability
assert calls == [
    {"platform": "douyin", "command": "doctor", "payload": {"projectId": 2}},
    {"platform": "douyin", "command": "capability", "payload": {"projectId": 2}},
], calls

serialized = json.dumps([doctor, capability], ensure_ascii=False).lower()
for forbidden in ["stdout", "stderr", "fake runner stdout", "fake runner stderr"]:
    assert forbidden not in serialized, serialized
`);
});

test("AgentReachAdapter sends only service-owned safe douyin payload fields to runner", () => {
  runPython(`
import json
from app.agent_reach_adapter import AgentReachAdapter

calls = []

def fake_runner(request):
    calls.append(request)
    return {
        "status": "ok",
        "artifact_ref": "artifacts/agent-reach/douyin/doctor-safe.json",
        "summary": {"diagnostic": "visible"}
    }

adapter = AgentReachAdapter(runner=fake_runner)
payload = adapter.run("douyin", "doctor", {
    "projectId": 2,
    "safeQuery": "haidao safe",
    "command": "cat config/cookies/douyin.json",
    "artifact_ref": "artifacts/agent-reach/douyin/raw_stdout_collector_transcript.json",
    "raw_artifact_ref": "artifacts/agent-reach/douyin/raw-stdout-collector-transcript.json",
    "rawArtifactRef": "artifacts/agent-reach/douyin/rawstdout.json",
    "cookie": "session=secret",
    "storageState": "browser/storage_state.json",
    "token": "secret-token",
    "stdout": "raw stdout collector transcript",
    "nested": {
        "safeQuery": "nested safe",
        "cookie": "nested-cookie-secret",
        "command": "nested command"
    }
})

assert payload["ok"] is True, payload
assert calls == [{
    "platform": "douyin",
    "command": "doctor",
    "payload": {"projectId": 2, "safeQuery": "haidao safe"}
}], calls

serialized_request = json.dumps(calls, ensure_ascii=False).lower()
for forbidden in [
    "cat config/cookies",
    "artifact_ref",
    "raw_artifact_ref",
    "rawartifactref",
    "raw_stdout_collector_transcript",
    "raw-stdout-collector-transcript",
    "cookie",
    "storagestate",
    "browser/storage_state",
    "secret-token",
    "raw stdout collector transcript",
    "nested safe",
    "nested-cookie-secret",
    "nested command"
]:
    assert forbidden not in serialized_request, serialized_request
`);
});

test("AgentReachAdapter sanitizes douyin summary artifact keys and stdout transcript values", () => {
  runPython(`
import json
from app.agent_reach_adapter import AgentReachAdapter

safe_ref = "artifacts/agent-reach/douyin/doctor-safe_02.json"
unsafe_ref = "artifacts/agent-reach/douyin/raw_stdout_collector_transcript.json"

def fake_runner(request):
    return {
        "status": "ok",
        "artifact_ref": safe_ref,
        "summary": {
            "diagnostic": "visible",
            "artifact_ref": safe_ref,
            "raw_artifact_ref": safe_ref,
            "artifactRef": unsafe_ref,
            "rawArtifactRef": "artifacts/agent-reach/douyin/raw-stdout-collector-transcript.json",
            "reportName": "raw_stdout_collector_transcript.json",
            "hyphenReportName": "raw-stdout-collector-transcript.json",
            "compactReportName": "rawstdout_collectortranscript.json",
            "plainStdout": "stdout",
            "rawTranscriptName": "raw_transcript",
            "collectorTranscriptName": "collector_transcript",
            "spacedRawTranscript": "raw transcript",
            "stdoutTranscript": "stdout transcript",
            "nested": {
                "keep": "visible",
                "artifactRef": unsafe_ref,
                "items": [
                    "ok",
                    "raw_stdout_collector_transcript.json",
                    "raw transcript",
                    {"note": "stdout transcript"}
                ]
            }
        }
    }

adapter = AgentReachAdapter(runner=fake_runner)
payload = adapter.run("douyin", "doctor", {"projectId": 2})

assert payload["ok"] is True, payload
assert payload["artifact_ref"] == safe_ref, payload
assert payload["summary"] == {
    "diagnostic": "visible",
    "artifact_ref": safe_ref,
    "raw_artifact_ref": safe_ref,
    "nested": {"keep": "visible", "items": ["ok", {}]}
}, payload

serialized = json.dumps(payload, ensure_ascii=False)
serialized_lower = serialized.lower()
compact = "".join(ch for ch in serialized_lower if ch.isalnum())
assert '"artifactRef"' not in serialized, serialized
assert '"rawArtifactRef"' not in serialized, serialized
for forbidden in [
    unsafe_ref,
    "raw_stdout_collector_transcript",
    "raw-stdout-collector-transcript",
    "rawstdout",
    "collectortranscript",
    "rawtranscript",
    "raw transcript",
    "stdout transcript",
    "stdout"
]:
    assert forbidden not in serialized_lower, serialized
for forbidden in ["rawstdout", "collectortranscript", "rawtranscript", "stdouttranscript"]:
    assert forbidden not in compact, serialized
`);
});

test("AgentReachAdapter keeps douyin collection commands blocked before runner contract is clear", () => {
  runPython(`
from app.agent_reach_adapter import AgentReachAdapter

calls = []

def fake_runner(request):
    calls.append(request)
    raise AssertionError("runner must not execute while douyin collection contract is unclear")

adapter = AgentReachAdapter(runner=fake_runner)

for command in ["search", "detail", "collect"]:
    result = adapter.run("douyin", command, {"projectId": 2, "query": "海岛舒服"})
    assert result["ok"] is False, result
    assert result["platform"] == "douyin", result
    assert result["command"] == command, result
    assert result["status"] == "rejected", result
    assert result["error_type"] == "agent_reach_command_not_allowed", result
    guidance = f"{result.get('message', '')} {result.get('cause', '')} {result.get('fix', '')}".lower()
    assert "runner contract" in guidance, result
    assert "not clear" in guidance or "unclear" in guidance, result

assert calls == [], calls
`);
});

test("AgentReachAdapter omits unsafe douyin artifact refs and preserves safe refs", () => {
  runPython(`
import json
from app.agent_reach_adapter import AgentReachAdapter

unsafe_refs = [
    "artifacts/agent-reach/douyin/raw_stdout_collector_transcript.json",
    "artifacts/agent-reach/douyin/raw-stdout-collector-transcript.json",
    "artifacts/agent-reach/douyin/collector_transcript.json",
    "artifacts/agent-reach/douyin/stderr.json",
    "artifacts/agent-reach/douyin/rawStderr.json",
    "artifacts/agent-reach/douyin/cookie.json",
    "artifacts/agent-reach/douyin/token.json",
    "artifacts/agent-reach/douyin/secret.json",
    "artifacts/agent-reach/douyin/storage_state.json",
    "artifacts/agent-reach/douyin/browser_state.json",
    "artifacts/agent-reach/douyin/database.json",
    "artifacts/agent-reach/douyin/db.json",
    "artifacts/agent-reach/douyin/mysql.json",
    "artifacts/agent-reach/douyin/dsn.json",
    "/tmp/artifacts/agent-reach/douyin/doctor-safe.json",
    "artifacts/agent-reach/douyin/../doctor-safe.json",
    r"artifacts\\agent-reach\\douyin\\doctor-safe.json",
    "artifacts/agent-reach/douyin/doctor-safe.json:ads",
    "artifacts/agent-reach/bilibili/doctor-safe.json",
]

def adapter_for(ref):
    def fake_runner(request):
        return {
            "status": "ok",
            "artifact_ref": ref,
            "summary": {
                "diagnostic": "visible",
                "artifact_ref": ref,
                "nested": {"raw_artifact_ref": ref}
            }
        }
    return AgentReachAdapter(runner=fake_runner)

for unsafe_ref in unsafe_refs:
    payload = adapter_for(unsafe_ref).run("douyin", "doctor", {"projectId": 2})
    assert payload["ok"] is True, payload
    assert "artifact_ref" not in payload, payload
    assert payload["summary"] == {"diagnostic": "visible", "nested": {}}, payload
    serialized = json.dumps(payload, ensure_ascii=False).lower()
    compact = "".join(ch for ch in serialized if ch.isalnum())
    for forbidden in [
        "rawstdout",
        "collectortranscript",
        "rawstderr",
        "stderr",
        "cookie",
        "token",
        "secret",
        "storagestate",
        "browserstate",
        "database",
        "mysql",
        "dsn",
        "artifactsagentreachbilibili"
    ]:
        assert forbidden not in compact, (unsafe_ref, serialized)

safe_ref = "artifacts/agent-reach/douyin/doctor-safe_01.json"
safe_payload = adapter_for(safe_ref).run("douyin", "doctor", {"projectId": 2})
assert safe_payload["ok"] is True, safe_payload
assert safe_payload["artifact_ref"] == safe_ref, safe_payload
assert safe_payload["summary"] == {
    "diagnostic": "visible",
    "artifact_ref": safe_ref,
    "nested": {"raw_artifact_ref": safe_ref}
}, safe_payload
`);
});
