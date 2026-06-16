import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

function runPython(code, options = {}) {
  const result = spawnSync(pythonBin, ["-c", code, ...(options.args || [])], {
    cwd: options.cwd || repoRoot,
    env: options.env || basePythonEnv(),
    encoding: "utf8"
  });

  assert.equal(
    result.status,
    0,
    [
      "Python FastAPI sidecar assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("FastAPI sidecar GET /health reports unavailable MySQL without leaking sensitive strings", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

client = TestClient(create_app())
response = client.get("/health")
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is False, payload
assert payload["mysql"] == {"connected": False, "configured": False}, payload
assert payload["service"] == "fastapi-sidecar", payload
assert payload["error_type"] == "mysql_unavailable", payload

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in [".env", "Cookie", "token", "config/cookies/weibo.json", "stderr"]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI sidecar GET /health includes sanitized configured legacy adapter readiness", () => {
  runPython(`
import json
import os
import sys
import types
from app.main import create_app
from fastapi.testclient import TestClient

os.environ["MYSQL_URL"] = "mysql://sidecar-ready"
fake_workers = types.ModuleType("workers")
fake_db = types.SimpleNamespace(health=lambda: {"connected": True})
fake_workers.db = fake_db
sys.modules["workers"] = fake_workers
sys.modules["workers.db"] = fake_db

class ReadyAdapter:
    def readiness(self):
        return {
            "configured": True,
            "python_bin": {"configured": True},
            "worker_script": {"configured": True},
            "diagnostic": "Bearer fake-secret-value",
            "configLine": "DEEPSEEK_API_KEY=redacted-value"
        }

client = TestClient(create_app(legacy_adapter=ReadyAdapter()))
response = client.get("/health")
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is True, payload
assert payload["service"] == "fastapi-sidecar", payload
assert payload["mysql"] == {"connected": True, "configured": True}, payload
assert payload["legacy_worker"]["configured"] is True, payload

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in ["Bearer fake-secret-value", "DEEPSEEK_API_KEY=redacted-value"]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI sidecar GET /health refuses ok when legacy adapter is misconfigured", () => {
  runPython(`
import json
import os
import sys
import types
from app.main import create_app
from fastapi.testclient import TestClient

os.environ["MYSQL_URL"] = "mysql://sidecar-ready"
fake_workers = types.ModuleType("workers")
fake_db = types.SimpleNamespace(health=lambda: {"connected": True})
fake_workers.db = fake_db
sys.modules["workers"] = fake_workers
sys.modules["workers.db"] = fake_db

class MisconfiguredAdapter:
    def readiness(self):
        return {
            "configured": False,
            "error_type": "legacy_adapter_unavailable",
            "message": "Legacy worker adapter is not configured.",
            "cause": "worker script is missing.",
            "fix": "Restore the configured worker script.",
            "diagnostic": "Bearer fake-secret-value"
        }

client = TestClient(create_app(legacy_adapter=MisconfiguredAdapter()))
response = client.get("/health")
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is False, payload
assert payload["error_type"] == "legacy_adapter_unavailable", payload
assert payload["legacy_worker"]["configured"] is False, payload

serialized = json.dumps(payload, ensure_ascii=False)
assert "Bearer fake-secret-value" not in serialized, serialized
`);
});

test("FastAPI sidecar import sets YUQING_SKIP_ENV_FILE and ignores local .env sentinel", () => {
  const dir = mkdtempSync(join(tmpdir(), "fastapi-sidecar-env-"));
  try {
    writeFileSync(join(dir, ".env"), [
      "SIDECAR_DOTENV_SENTINEL=loaded",
      "MYSQL_URL=mysql://sentinel:sentinel@127.0.0.1/sentinel"
    ].join("\n"));
    mkdirSync(join(dir, "config", "cookies"), { recursive: true });
    writeFileSync(join(dir, "config", "cookies", "weibo.json"), "{\"Cookie\":\"SUB=secret\"}");

    const env = basePythonEnv();
    delete env.YUQING_SKIP_ENV_FILE;
    runPython(`
import json
import os
import sys
from pathlib import Path

repo_root = Path(sys.argv[1])
tmp_root = Path(sys.argv[2])
os.chdir(tmp_root)
sys.path.insert(0, str(repo_root))
os.environ.pop("YUQING_SKIP_ENV_FILE", None)
os.environ.pop("SIDECAR_DOTENV_SENTINEL", None)
os.environ.pop("MYSQL_URL", None)

from app.main import create_app
from fastapi.testclient import TestClient

assert os.environ.get("YUQING_SKIP_ENV_FILE") == "1"
assert "SIDECAR_DOTENV_SENTINEL" not in os.environ
assert "MYSQL_URL" not in os.environ

payload = TestClient(create_app()).get("/health").json()
serialized = json.dumps(payload, ensure_ascii=False)
assert payload["error_type"] == "mysql_unavailable", payload
for forbidden in ["SIDECAR_DOTENV_SENTINEL", "SUB=secret", "config/cookies/weibo.json", ".env", "Cookie", "token", "stderr"]:
    assert forbidden not in serialized, serialized
`, { cwd: dir, env, args: [repoRoot, dir] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FastAPI sidecar validates Agent Loop run payloads and delegates valid runs to an injected adapter", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

class FakeAdapter:
    def __init__(self):
        self.calls = []

    def run_agent_loop(self, payload):
        self.calls.append(("run", payload))
        return {"ok": True, "agentLoopRunId": 42, "status": "running"}

    def get_agent_run(self, run_id, payload=None):
        self.calls.append(("status", run_id, payload or {}))
        return {
            "ok": True,
            "agentLoopRunId": run_id,
            "status": "needs_human",
            "run": {"id": run_id, "status": "needs_human"},
            "steps": [],
            "judgeReviews": [],
            "manualHandoffs": []
        }

adapter = FakeAdapter()
client = TestClient(create_app(legacy_adapter=adapter))

response = client.post("/api/weibo/agent-loop/run", json={
    "projectId": 1,
    "targetId": 12,
    "mode": "after_collection",
    "input": {"source": "fixture"}
})
payload = response.json()
assert response.status_code == 200, payload
assert payload == {"ok": True, "agentLoopRunId": 42, "status": "running"}, payload
assert adapter.calls == [("run", {
    "projectId": 1,
    "targetId": 12,
    "triggerMode": "after_collection",
    "input": {"source": "fixture"}
})], adapter.calls

invalid_cases = [
    (["not-object"], "invalid_agent_loop_payload"),
    ({"projectId": 0, "mode": "manual"}, "invalid_project_id"),
    ({"targetId": "abc", "mode": "manual"}, "invalid_agent_loop_payload"),
    ({"mode": "fixture"}, "invalid_agent_loop_mode"),
    ({"mode": "manual", "input": []}, "invalid_agent_loop_payload"),
]

for body, error_type in invalid_cases:
    invalid = client.post("/api/weibo/agent-loop/run", json=body)
    invalid_payload = invalid.json()
    assert invalid.status_code == 400, invalid_payload
    assert invalid_payload["ok"] is False, invalid_payload
    assert invalid_payload["error_type"] == error_type, invalid_payload
    assert isinstance(invalid_payload["fix"], str) and invalid_payload["fix"], invalid_payload

status = client.get("/api/weibo/agent-runs/42?projectId=1")
status_payload = status.json()
assert status.status_code == 200, status_payload
assert status_payload["ok"] is True, status_payload
assert status_payload["agentLoopRunId"] == 42, status_payload
assert status_payload["manualHandoffs"] == [], status_payload
assert adapter.calls[-1] == ("status", 42, {"projectId": 1}), adapter.calls

bad_status = client.get("/api/weibo/agent-runs/not-a-number")
bad_status_payload = bad_status.json()
assert bad_status.status_code == 400, bad_status_payload
assert bad_status_payload["error_type"] == "invalid_agent_run_id", bad_status_payload
`);
});

test("FastAPI sidecar maps worker execution errors to HTTP status codes", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

class FailingAdapter:
    def __init__(self):
        self.run_error_type = "legacy_worker_failed"

    def run_agent_loop(self, payload):
        return {
            "ok": False,
            "error_type": self.run_error_type,
            "message": "Worker execution failed.",
            "cause": "fixture",
            "fix": "Inspect worker logs."
        }

    def get_agent_run(self, run_id, payload=None):
        return {
            "ok": False,
            "error_type": "agent_loop_not_found",
            "message": "Agent Loop run was not found.",
            "cause": f"{run_id} does not exist.",
            "fix": "Retry with an existing agentLoopRunId."
        }

adapter = FailingAdapter()
client = TestClient(create_app(legacy_adapter=adapter))

missing = client.get("/api/weibo/agent-runs/999")
missing_payload = missing.json()
assert missing.status_code == 404, missing_payload
assert missing_payload["error_type"] == "agent_loop_not_found", missing_payload

failed = client.post("/api/weibo/agent-loop/run", json={"mode": "manual"})
failed_payload = failed.json()
assert 500 <= failed.status_code < 600, failed_payload
assert failed_payload["error_type"] == "legacy_worker_failed", failed_payload

adapter.run_error_type = "worker_exploded"
unknown = client.post("/api/weibo/agent-loop/run", json={"mode": "manual"})
unknown_payload = unknown.json()
assert 500 <= unknown.status_code < 600, unknown_payload
assert unknown_payload["error_type"] == "worker_exploded", unknown_payload
`);
});

test("FastAPI sidecar default Agent Loop status reports stable MySQL unavailable errors", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

client = TestClient(create_app())
response = client.get("/api/weibo/agent-runs/1")
payload = response.json()

assert response.status_code == 503, payload
assert payload["ok"] is False, payload
assert payload["mysql"] == {"connected": False, "configured": False}, payload
assert payload["error_type"] == "mysql_unavailable", payload
assert isinstance(payload["fix"], str) and payload["fix"], payload
`);
});

test("FastAPI sidecar LegacyWorkerAdapter passes only minimal allowlisted environment to subprocess", () => {
  runPython(`
import json
import os
import sys
import tempfile
from pathlib import Path
from app.legacy_worker import LegacyWorkerAdapter

with tempfile.TemporaryDirectory() as tmp:
    script = Path(tmp) / "worker.py"
    script.write_text("""import json
import os
print(json.dumps({
    "ok": True,
    "db_env_seen": "MYSQL_URL" in os.environ,
    "mysql_url": os.environ.get("MYSQL_URL"),
    "database_url": os.environ.get("MYSQL_URL"),
    "db_url": os.environ.get("MYSQL_URL"),
    "dsn": os.environ.get("MYSQL_URL"),
    "neutral": "mysql://sidecar-env",
    "skip_env_file": os.environ.get("YUQING_SKIP_ENV_FILE"),
    "custom_seen": "SHOULD_NOT_PASS" in os.environ,
    "openai_seen": "OPENAI_API_KEY" in os.environ,
    "path_seen": "PATH" in os.environ
}))
""")

    os.environ["MYSQL_URL"] = "mysql://sidecar-env"
    os.environ["YUQING_SKIP_ENV_FILE"] = "0"
    os.environ["SHOULD_NOT_PASS"] = "parent-secret"
    os.environ["OPENAI_API_KEY"] = "redacted-parent"

    adapter = LegacyWorkerAdapter(
        python_bin=sys.executable,
        worker_script=str(script),
        cwd=tmp,
        timeout_seconds=5
    )
    result = adapter.call("weibo-agent-loop-status", {"probe": True})

assert result["ok"] is True, result
assert result["db_env_seen"] is True, result
assert result["skip_env_file"] == "1", result
assert result["custom_seen"] is False, result
assert result["openai_seen"] is False, result
assert result["path_seen"] is True, result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["mysql_url", "database_url", "db_url", "dsn", "mysql://sidecar-env"]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI sidecar sanitizer drops case-insensitive secret patterns from neutral string values", () => {
  runPython(`
import json
from app.legacy_worker import sanitize_for_public

payload = {
    "safe": "visible",
    "comment": "Bearer fake-secret-value",
    "diagnostic": "DEEPSEEK_API_KEY=redacted-value",
    "database_url": "mysql://user:password@127.0.0.1/db",
    "db_url": "mysql+pymysql://user:password@127.0.0.1/db",
    "dsn": "mariadb://user:password@127.0.0.1/db",
    "mixedCase": "deepseek_api_key=SK-FAKE-VALUE",
    "nested": {
        "keep": "visible",
        "line": "bearer fake-secret-value"
    },
    "items": [
        "visible",
        "Bearer fake-secret-value",
        {"line": "DEEPSEEK_API_KEY=redacted-value"}
    ]
}

sanitized = sanitize_for_public(payload)
serialized = json.dumps(sanitized, ensure_ascii=False)

assert sanitized["safe"] == "visible", sanitized
assert sanitized["nested"]["keep"] == "visible", sanitized
assert sanitized["items"][0] == "visible", sanitized
for forbidden in [
    "Bearer fake-secret-value",
    "bearer fake-secret-value",
    "DEEPSEEK_API_KEY=redacted-value",
    "deepseek_api_key=SK-FAKE-VALUE",
    "mysql://user:password@127.0.0.1/db",
    "mysql+pymysql://user:password@127.0.0.1/db",
    "mariadb://user:password@127.0.0.1/db",
    "database_url",
    "db_url"
]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI sidecar legacy worker adapter rejects non-whitelisted commands and sanitizes allowed output", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class FakeAdapter:
    def __init__(self):
        self.calls = []

    def call(self, command, payload):
        self.calls.append((command, payload))
        return {
            "ok": True,
            "result": {"safe": True},
            "stderr": "secret worker stderr",
            "token": "secret-token",
            "nested": {
                "Cookie": "SUB=secret",
                "path": "config/cookies/weibo.json",
                "keep": "visible"
            }
        }

adapter = FakeAdapter()
client = TestClient(create_app(legacy_adapter=adapter))

rejected = client.post("/api/tools/legacy-worker/rm-rf", json={})
rejected_payload = rejected.json()
assert rejected.status_code == 400, rejected_payload
assert rejected_payload["ok"] is False, rejected_payload
assert rejected_payload["error_type"] == "legacy_worker_command_not_allowed", rejected_payload
assert adapter.calls == [], adapter.calls

allowed = client.post("/api/tools/legacy-worker/weibo-agent-loop-status", json={"agentLoopRunId": 42})
payload = allowed.json()
serialized = json.dumps(payload, ensure_ascii=False)
assert allowed.status_code == 200, payload
assert payload["ok"] is True, payload
assert payload["result"] == {"safe": True}, payload
assert payload["nested"]["keep"] == "visible", payload
for forbidden in ["stderr", "secret worker stderr", "token", "secret-token", "Cookie", "SUB=secret", "config/cookies/weibo.json"]:
    assert forbidden not in serialized, serialized
assert adapter.calls == [("weibo-agent-loop-status", {"agentLoopRunId": 42})], adapter.calls
`);
});
