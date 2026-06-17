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

test("FastAPI internal platform collection trigger delegates to injected bilibili service and rejects caller run id override", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class FakeBilibiliCollectionService:
    def __init__(self):
        self.calls = []

    def collect(self, payload):
        self.calls.append(payload)
        return {
            "ok": True,
            "platform": "bilibili",
            "status": "succeeded",
            "project_id": payload["project_id"],
            "agentLoopRunId": payload["agentLoopRunId"],
            "evidence_ids": ["bilibili:project:2:item:BVSAFE"],
            "stdout": "raw stdout must stay private",
            "stderr": "Cookie=SUB=secret token=secret",
        }

service = FakeBilibiliCollectionService()
client = TestClient(create_app(platform_collection_services={"bilibili": service}))

forged = client.post("/api/internal/agent-runs/77/platform-collections", json={
    "projectId": 2,
    "platform": "bilibili",
    "query": "海岛舒服日志",
    "agentLoopRunId": 999,
})
forged_payload = forged.json()
assert forged.status_code == 400, forged_payload
assert forged_payload["error_type"] == "platform_collection_payload_rejected", forged_payload
assert service.calls == [], service.calls

response = client.post("/api/internal/agent-runs/77/platform-collections", json={
    "projectId": "2",
    "platform": "bilibili",
    "query": "海岛舒服日志",
    "keywords": ["海岛舒服", "路演"],
    "limit": "5",
    "cursor": "page-2",
})
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is True, payload
assert payload["platform"] == "bilibili", payload
assert payload["agentLoopRunId"] == 77, payload
assert service.calls == [{
    "projectId": 2,
    "project_id": 2,
    "platform": "bilibili",
    "agentLoopRunId": 77,
    "query": "海岛舒服日志",
    "keywords": ["海岛舒服", "路演"],
    "limit": 5,
    "cursor": "page-2",
}], service.calls

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in ["stdout", "stderr", "cookie", "sub=secret", "token"]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI internal platform collection trigger rejects unsupported platforms and unsafe fields before service execution", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class CountingCollectionService:
    def __init__(self):
        self.calls = []

    def collect(self, payload):
        self.calls.append(payload)
        return {"ok": True, "status": "unexpected"}

service = CountingCollectionService()
client = TestClient(create_app(platform_collection_services={
    "bilibili": service,
    "xiaohongshu": service,
}))

cases = [
    ({"projectId": 2, "platform": "douyin", "query": "海岛舒服"}, 400, "platform_collection_not_allowed"),
    ({"projectId": 2, "platform": "youtube", "query": "海岛舒服"}, 400, "platform_collection_not_allowed"),
    ({"projectId": 2, "platform": "bilibili", "query": "海岛舒服", "command": "collect"}, 400, "platform_collection_payload_rejected"),
    ({
        "projectId": 2,
        "platform": "xiaohongshu",
        "query": "海岛舒服",
        "cookie": "Cookie=SUB=secret",
        "token": "Bearer fake-secret-value",
        "storageState": {"cookies": ["secret"]},
        "browserState": "logged-in-browser-state",
        "raw_artifact_ref": "/tmp/raw.json",
        "rawArtifactRef": "artifacts/agent-reach/xiaohongshu/raw_stdout.json",
        "artifact_ref": "../config/cookies/weibo.json",
        "path": "/Users/local/secret-browser-state",
    }, 400, "platform_collection_payload_rejected"),
]

for body, status, error_type in cases:
    response = client.post("/api/internal/agent-runs/88/platform-collections", json=body)
    payload = response.json()
    serialized = json.dumps(payload, ensure_ascii=False)
    assert response.status_code == status, payload
    assert payload["ok"] is False, payload
    assert payload["error_type"] == error_type, payload
    for forbidden in [
        "Cookie=SUB=secret",
        "Bearer fake-secret-value",
        "storageState",
        "browserState",
        "raw_artifact_ref",
        "rawArtifactRef",
        "artifact_ref",
        "/tmp/raw.json",
        "../config/cookies/weibo.json",
        "/Users/local/secret-browser-state",
    ]:
        assert forbidden not in serialized, serialized

unconfigured = TestClient(create_app(platform_collection_services={}))
missing = unconfigured.post("/api/internal/agent-runs/88/platform-collections", json={
    "projectId": 2,
    "platform": "bilibili",
    "query": "海岛舒服",
})
missing_payload = missing.json()
assert missing.status_code == 503, missing_payload
assert missing_payload["error_type"] == "platform_collection_service_unavailable", missing_payload
assert service.calls == [], service.calls
`);
});

test("FastAPI internal platform collection trigger maps xiaohongshu auth-required responses through sanitizer", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class CallableXiaohongshuService:
    def __init__(self):
        self.calls = []

    def __call__(self, payload):
        self.calls.append(payload)
        return {
            "ok": False,
            "platform": "xiaohongshu",
            "status": "failed",
            "error_type": "platform_auth_required",
            "message": "Xiaohongshu collection requires local auth.",
            "cause": "No injected private login state was available.",
            "fix": "Configure a private login provider.",
            "stdout": "runner stdout Cookie=SUB=secret",
            "stderr": "runner stderr token=secret",
            "raw_runner_output": "raw runner output with Bearer fake-secret-value",
            "privateLoginState": "private/local/xhs-storage-state.json",
            "summary": {
                "safe": "auth blocked",
                "stderr": "nested stderr token=secret",
                "raw_runner_output": "nested raw output",
            },
        }

service = CallableXiaohongshuService()
client = TestClient(create_app(platform_collection_services={"xiaohongshu": service}))

response = client.post("/api/internal/agent-runs/91/platform-collections", json={
    "projectId": 2,
    "platform": "xiaohongshu",
    "query": "海岛舒服",
})
payload = response.json()

assert response.status_code == 503, payload
assert payload["ok"] is False, payload
assert payload["platform"] == "xiaohongshu", payload
assert payload["error_type"] == "platform_auth_required", payload
assert payload["summary"] == {"safe": "auth blocked"}, payload
assert service.calls == [{
    "projectId": 2,
    "project_id": 2,
    "platform": "xiaohongshu",
    "agentLoopRunId": 91,
    "query": "海岛舒服",
}], service.calls

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    "stdout",
    "stderr",
    "raw_runner_output",
    "raw runner output",
    "cookie",
    "sub=secret",
    "token",
    "bearer fake-secret-value",
    "privateloginstate",
    "private/local/xhs-storage-state.json",
    "storagestate",
]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI internal platform collection trigger strips sensitive string values from safe-looking response fields", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class LeakyCollectionService:
    def __init__(self):
        self.calls = []

    def collect(self, payload):
        self.calls.append(payload)
        return {
            "ok": True,
            "platform": "bilibili",
            "status": "succeeded",
            "message": "raw runner output should not be public",
            "summary": {
                "safe": "public rollup",
                "note": "raw_stdout transcript should not be public",
                "items": [
                    "ordinary public item",
                    "raw-stdout compact leak",
                    {
                        "label": "public label survives",
                        "value": "collector transcript: browser state dump",
                    },
                    {
                        "label": "safe object",
                        "value": "public engagement summary",
                    },
                ],
            },
            "details": [
                {"text": "rawstderr dump should not be public"},
                {"text": "storage state contains private login state"},
                {"text": "safe detail"},
            ],
        }

service = LeakyCollectionService()
client = TestClient(create_app(platform_collection_services={"bilibili": service}))

response = client.post("/api/internal/agent-runs/92/platform-collections", json={
    "projectId": 2,
    "platform": "bilibili",
    "query": "海岛舒服",
})
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is True, payload
assert payload["summary"]["safe"] == "public rollup", payload
assert "ordinary public item" in payload["summary"]["items"], payload
assert {"label": "safe object", "value": "public engagement summary"} in payload["summary"]["items"], payload
assert service.calls == [{
    "projectId": 2,
    "project_id": 2,
    "platform": "bilibili",
    "agentLoopRunId": 92,
    "query": "海岛舒服",
}], service.calls

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    "raw runner output",
    "raw_stdout",
    "raw-stdout",
    "rawstderr",
    "collector transcript",
    "browser state",
    "storage state",
    "login state",
    "private login state",
]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI internal platform collection trigger rejects dangerous values inside allowed public fields before service execution", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class CountingCollectionService:
    def __init__(self):
        self.calls = []

    def collect(self, payload):
        self.calls.append(payload)
        return {"ok": True, "status": "unexpected"}

service = CountingCollectionService()
client = TestClient(create_app(platform_collection_services={
    "bilibili": service,
    "xiaohongshu": service,
}))

cases = [
    {"query": "read .env before collecting"},
    {"query": "Bearer fake-secret-value"},
    {"query": "../config/cookies/weibo.json"},
    {"query": "raw_stdout transcript"},
    {"query": "raw-stdout transcript"},
    {"query": "rawstderr transcript"},
    {"query": "collector transcript dump"},
    {"query": "browser state dump"},
    {"query": "storage state dump"},
    {"query": "login state dump"},
    {"query": "private login state dump"},
    {"keywords": ["海岛舒服", "raw_stdout transcript"]},
    {"keywords": ["海岛舒服", "Bearer fake-secret-value"]},
    {"keywords": ["海岛舒服", "../config/cookies/weibo.json"]},
    {"keywords": ["海岛舒服", "browser storage login marker"]},
    {"cursor": "page-2 raw_stdout"},
    {"cursor": "Bearer fake-secret-value"},
    {"cursor": "../config/cookies/weibo.json"},
    {"cursor": "browser storage login marker"},
]

for case in cases:
    body = {
        "projectId": 2,
        "platform": "bilibili",
        "query": "海岛舒服",
        **case,
    }
    response = client.post("/api/internal/agent-runs/93/platform-collections", json=body)
    payload = response.json()
    serialized = json.dumps(payload, ensure_ascii=False).lower()
    assert response.status_code == 400, (case, payload)
    assert payload["ok"] is False, (case, payload)
    assert payload["error_type"] == "platform_collection_payload_rejected", (case, payload)
    for forbidden in [
        ".env",
        "bearer fake-secret-value",
        "config/cookies",
        "raw_stdout",
        "raw-stdout",
        "rawstderr",
        "collector transcript",
        "browser state",
        "storage state",
        "login state",
        "private login state",
        "browser storage login",
    ]:
        assert forbidden not in serialized, (case, serialized)

assert service.calls == [], service.calls
`);
});

test("FastAPI sidecar creates CrewAI proposals through an injected proposal service and returns proposalAuditId without fact writes", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class FakeProposalService:
    def __init__(self):
        self.calls = []
        self.runtime_call_count = 0
        self.fact_write_count = 0
        self.audit_records = []

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return run_id == 10 and project_id == 2

    def create_proposal(self, run_id, payload):
        self.calls.append((run_id, payload))
        self.runtime_call_count += 1
        self.audit_records.append({"id": "audit-accepted-1", "status": "accepted"})
        return {
            "ok": True,
            "proposalAuditId": "audit-accepted-1",
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": 2,
                "agent_loop_run_id": run_id,
                "agent_name": "Strategy Agent",
                "stage": "strategy",
                "facts": [{"text": "Scoped context was inspected.", "evidence_ids": ["comment:123"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None,
            },
        }

service = FakeProposalService()
client = TestClient(create_app(crewai_proposal_service=service))

response = client.post("/api/weibo/agent-runs/10/crewai/proposals", json={
    "projectId": "2",
    "stage": "strategy",
    "evidenceIds": ["comment:123"],
    "knowledgeQuery": "heated discussion",
})
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is True, payload
assert payload["proposalAuditId"] == "audit-accepted-1", payload
assert payload["proposal"]["agent_loop_run_id"] == 10, payload
assert "raw_model_output_ref" in payload["proposal"], payload
assert service.runtime_call_count == 1, service.runtime_call_count
assert service.fact_write_count == 0, service.fact_write_count
assert service.audit_records == [{"id": "audit-accepted-1", "status": "accepted"}], service.audit_records
assert service.calls == [(10, {
    "projectId": 2,
    "stage": "strategy",
    "evidenceIds": ["comment:123"],
    "knowledgeQuery": "heated discussion",
})], service.calls

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in [
    "forbidden",
    "hidden prompt text",
    "\\"raw_model_output\\":",
    "traceback",
    "stderr",
    "mysql://",
    ".env",
    "config/cookies/weibo.json",
]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI sidecar rejects unknown CrewAI proposal public fields before service/runtime execution", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

class CountingProposalService:
    def __init__(self):
        self.calls = 0
        self.runtime_call_count = 0

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return True

    def create_proposal(self, run_id, payload):
        self.calls += 1
        self.runtime_call_count += 1
        return {"ok": True, "proposalAuditId": "unexpected"}

service = CountingProposalService()
client = TestClient(create_app(crewai_proposal_service=service))

response = client.post("/api/weibo/agent-runs/10/crewai/proposals", json={
    "projectId": 2,
    "stage": "strategy",
    "runtime": {"module": "forbidden"},
})
payload = response.json()
assert response.status_code == 400, payload
assert payload["error_type"] == "invalid_crewai_proposal_payload", payload
assert service.calls == 0, service.calls
assert service.runtime_call_count == 0, service.runtime_call_count

response = client.post("/api/weibo/agent-runs/10/crewai/proposals", json={
    "projectId": 2,
    "stage": "strategy",
    "prompt": "hidden prompt text",
})
payload = response.json()
assert response.status_code == 400, payload
assert payload["error_type"] == "invalid_crewai_proposal_payload", payload
assert service.calls == 0, service.calls
assert service.runtime_call_count == 0, service.runtime_call_count
serialized = __import__("json").dumps(payload, ensure_ascii=False)
for forbidden in ["prompt", "hidden prompt text", "runtime", "callable", "traceback", "stderr"]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI sidecar rejects dangerous values inside allowed CrewAI proposal fields before service/runtime execution", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

class CountingProposalService:
    def __init__(self):
        self.calls = 0

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return True

    def create_proposal(self, run_id, payload):
        self.calls += 1
        return {"ok": True, "proposalAuditId": "unexpected"}

service = CountingProposalService()
client = TestClient(create_app(crewai_proposal_service=service))

cases = [
    {"projectId": 2, "stage": "read .env", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "mysql://root:secret", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "mariadb://root:secret@localhost/db", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "mysql+pymysql://root:secret@localhost/db", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "Bearer fake-secret-value", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "api_key=hidden", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "/etc/passwd", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "../config/cookies/weibo.json", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "database_url=hidden", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "db_url=hidden", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "dsn=hidden", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "raw_model_output: hidden", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "secret diagnostic", "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "evidenceIds": ["config/cookies/weibo.json"], "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "evidenceIds": ["comment:1", "post:../../etc/passwd"], "error_type": "invalid_crewai_proposal_payload"},
    {"projectId": 2, "stage": "strategy", "knowledgeQuery": "traceback token prompt", "error_type": "invalid_crewai_proposal_payload"},
]

for case in cases:
    body = {key: value for key, value in case.items() if key != "error_type"}
    response = client.post("/api/weibo/agent-runs/10/crewai/proposals", json=body)
    payload = response.json()
    assert response.status_code == 400, payload
    assert payload["error_type"] == case["error_type"], payload

assert service.calls == 0, service.calls
`);
});

test("FastAPI sidecar rejects CrewAI proposal requests before runtime on mysql_unavailable and run-not-found", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

class MysqlUnavailableService:
    def __init__(self):
        self.runtime_call_count = 0

    def is_mysql_available(self):
        return False

    def has_agent_run(self, run_id, project_id):
        return True

    def create_proposal(self, run_id, payload):
        self.runtime_call_count += 1
        raise AssertionError("runtime should not be called when mysql is unavailable")

class MissingRunService:
    def __init__(self):
        self.runtime_call_count = 0

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return False

    def create_proposal(self, run_id, payload):
        self.runtime_call_count += 1
        raise AssertionError("runtime should not be called when run is missing")

mysql_service = MysqlUnavailableService()
mysql_client = TestClient(create_app(crewai_proposal_service=mysql_service))
mysql_unavailable = mysql_client.post("/api/weibo/agent-runs/10/crewai/proposals", json={"projectId": 2, "stage": "strategy"})
mysql_unavailable_payload = mysql_unavailable.json()
assert mysql_unavailable.status_code == 503, mysql_unavailable_payload
assert mysql_unavailable_payload["error_type"] == "mysql_unavailable", mysql_unavailable_payload
assert mysql_service.runtime_call_count == 0, mysql_service.runtime_call_count

missing_service = MissingRunService()
missing_client = TestClient(create_app(crewai_proposal_service=missing_service))
run_not_found = missing_client.post("/api/weibo/agent-runs/999/crewai/proposals", json={"projectId": 2, "stage": "strategy"})
run_not_found_payload = run_not_found.json()
assert run_not_found.status_code == 404, run_not_found_payload
assert run_not_found_payload["error_type"] == "agent_loop_not_found", run_not_found_payload
assert missing_service.runtime_call_count == 0, missing_service.runtime_call_count
`);
});

test("FastAPI sidecar creates Judge reviews through an injected Harness service", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class FakeJudgeReviewService:
    def __init__(self):
        self.calls = []
        self.review_call_count = 0
        self.fact_write_count = 0

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return run_id == 10 and project_id == 2

    def create_review(self, run_id, payload):
        self.calls.append((run_id, payload))
        self.review_call_count += 1
        return {
            "ok": True,
            "review": {
                "id": "judge-review-1",
                "status": "passed",
                "passed": True,
                "retry_count": 2,
                "required_changes": [],
                "evidence_errors": [],
                "feedback_json": {"judge": "rule_judge"},
            },
            "retryCount": 2,
            "proposalAuditId": 56,
            "stepRunId": 34,
        }

service = FakeJudgeReviewService()
client = TestClient(create_app(judge_review_service=service))

response = client.post("/api/weibo/agent-runs/10/judge/reviews", json={
    "projectId": "2",
    "proposalAuditId": "56",
    "stepRunId": "34",
    "maxAttempts": 5,
    "fixtureOutputs": [
        {"output": {"evidence_ids": []}},
        {"output": {"evidence_ids": ["comment-123"]}},
        {"output": {"evidence_ids": ["comment-123"], "summary": "bounded"}}
    ],
})
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is True, payload
assert payload["review"]["status"] == "passed", payload
assert payload["retryCount"] == 2, payload
assert service.review_call_count == 1, service.review_call_count
assert service.fact_write_count == 0, service.fact_write_count
assert service.calls == [(10, {
    "projectId": 2,
    "proposalAuditId": 56,
    "stepRunId": 34,
    "maxAttempts": 3,
    "fixtureOutputs": [
        {"output": {"evidence_ids": []}},
        {"output": {"evidence_ids": ["comment-123"]}},
        {"output": {"evidence_ids": ["comment-123"], "summary": "bounded"}}
    ],
})], service.calls

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in ["raw_model_output", "prompt", "traceback", "stderr", "mysql://", ".env", "config/cookies/weibo.json"]:
    assert forbidden not in serialized, serialized
`);
});

test("FastAPI sidecar passes Judge review stepRunId without fake fixture outputs", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

class FakeJudgeReviewService:
    def __init__(self):
        self.calls = []
        self.review_call_count = 0

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return run_id == 10 and project_id == 2

    def create_review(self, run_id, payload):
        self.calls.append((run_id, payload))
        self.review_call_count += 1
        return {
            "ok": True,
            "review": {
                "id": "judge-review-step-1",
                "status": "passed",
                "passed": True,
                "retry_count": 0,
                "required_changes": [],
                "evidence_errors": [],
                "feedback_json": {"judge": "rule_judge"},
            },
            "retryCount": 0,
            "proposalAuditId": None,
            "stepRunId": 34,
        }

service = FakeJudgeReviewService()
client = TestClient(create_app(judge_review_service=service))

response = client.post("/api/weibo/agent-runs/10/judge/reviews", json={
    "projectId": "2",
    "stepRunId": "34",
    "maxAttempts": 5,
})
payload = response.json()

assert response.status_code == 200, payload
assert payload["ok"] is True, payload
assert payload["review"]["status"] == "passed", payload
assert service.review_call_count == 1, service.review_call_count
assert service.calls == [(10, {
    "projectId": 2,
    "stepRunId": 34,
    "maxAttempts": 3,
})], service.calls

missing_source = client.post("/api/weibo/agent-runs/10/judge/reviews", json={
    "projectId": "2",
    "proposalAuditId": "56",
})
missing_payload = missing_source.json()
assert missing_source.status_code == 400, missing_payload
assert missing_payload["error_type"] == "invalid_judge_review_payload", missing_payload

unscoped_fixture = client.post("/api/weibo/agent-runs/10/judge/reviews", json={
    "projectId": "2",
    "stepRunId": "34",
    "fixtureOutputs": [{"output": {"evidence_ids": ["comment-123"]}}],
})
unscoped_payload = unscoped_fixture.json()
assert unscoped_fixture.status_code == 400, unscoped_payload
assert unscoped_payload["error_type"] == "invalid_judge_review_payload", unscoped_payload
assert service.review_call_count == 1, service.review_call_count
`);
});

test("FastAPI sidecar rejects unsafe Judge review payloads before service execution", () => {
  runPython(`
import json
from app.main import create_app
from fastapi.testclient import TestClient

class CountingJudgeReviewService:
    def __init__(self):
        self.calls = 0

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return True

    def create_review(self, run_id, payload):
        self.calls += 1
        return {"ok": True, "review": {"status": "passed"}}

service = CountingJudgeReviewService()
client = TestClient(create_app(judge_review_service=service))

cases = [
    {"projectId": 2, "proposalAuditId": 56, "prompt": "hidden prompt"},
    {"projectId": 2, "proposalAuditId": 56, "runtime": {"module": "forbidden"}},
    {"projectId": 2, "proposalAuditId": 56},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"runtime": {"module": "forbidden"}}}]},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"module": "forbidden"}}]},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"dbUrl": "hidden"}}]},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"rawModelOutput": "hidden"}}]},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"evidence_ids": ["comment-123"], "summary": "Bearer fake-secret-value"}}]},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"evidence_ids": ["comment-123"], "summary": "mysql://root:secret"}}]},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"evidence_ids": ["../config/cookies/weibo.json"]}}]},
    {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"raw_model_output": "hidden"}]},
]

for body in cases:
    response = client.post("/api/weibo/agent-runs/10/judge/reviews", json=body)
    payload = response.json()
    assert response.status_code == 400, payload
    assert payload["error_type"] == "invalid_judge_review_payload", payload
    serialized = json.dumps(payload, ensure_ascii=False)
    for forbidden in ["hidden prompt", "runtime", "Bearer fake-secret-value", "mysql://root:secret", "config/cookies/weibo.json", "raw_model_output", "traceback", "stderr"]:
        assert forbidden not in serialized, serialized

assert service.calls == 0, service.calls
`);
});

test("FastAPI sidecar rejects Judge review requests before review logic on mysql_unavailable and run-not-found", () => {
  runPython(`
from app.main import create_app
from fastapi.testclient import TestClient

class MysqlUnavailableJudgeService:
    def __init__(self):
        self.review_call_count = 0

    def is_mysql_available(self):
        return False

    def has_agent_run(self, run_id, project_id):
        return True

    def create_review(self, run_id, payload):
        self.review_call_count += 1
        raise AssertionError("Judge review should not run when MySQL is unavailable")

class MissingRunJudgeService:
    def __init__(self):
        self.review_call_count = 0

    def is_mysql_available(self):
        return True

    def has_agent_run(self, run_id, project_id):
        return False

    def create_review(self, run_id, payload):
        self.review_call_count += 1
        raise AssertionError("Judge review should not run when run ownership fails")

body = {"projectId": 2, "proposalAuditId": 56, "fixtureOutputs": [{"output": {"evidence_ids": ["comment-123"]}}]}

mysql_service = MysqlUnavailableJudgeService()
mysql_client = TestClient(create_app(judge_review_service=mysql_service))
mysql_unavailable = mysql_client.post("/api/weibo/agent-runs/10/judge/reviews", json=body)
mysql_payload = mysql_unavailable.json()
assert mysql_unavailable.status_code == 503, mysql_payload
assert mysql_payload["error_type"] == "mysql_unavailable", mysql_payload
assert mysql_service.review_call_count == 0, mysql_service.review_call_count

missing_service = MissingRunJudgeService()
missing_client = TestClient(create_app(judge_review_service=missing_service))
run_not_found = missing_client.post("/api/weibo/agent-runs/999/judge/reviews", json=body)
missing_payload = run_not_found.json()
assert run_not_found.status_code == 404, missing_payload
assert missing_payload["error_type"] == "agent_loop_not_found", missing_payload
assert missing_service.review_call_count == 0, missing_service.review_call_count
`);
});

test("JudgeReviewService maps weibo-comments-analyze step output into Rule Judge input", () => {
  runPython(`
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return run_id == 10 and project_id == 2

class SourceRepository:
    def __init__(self, evidence_ids=None, command="weibo-comments-analyze"):
        self.calls = []
        self.output_calls = []
        self.evidence_ids = evidence_ids if evidence_ids is not None else ["comment-123"]
        self.command = command

    def has_sources(self, run_id, project_id, proposal_audit_id=None, step_run_id=None):
        self.calls.append((run_id, project_id, proposal_audit_id, step_run_id))
        return run_id == 10 and project_id == 2 and proposal_audit_id is None and step_run_id == 34

    def step_output_for_review(self, run_id, project_id, step_run_id):
        self.output_calls.append((run_id, project_id, step_run_id))
        return {
            "ok": True,
            "step": {
                "id": step_run_id,
                "step_name": "comment_analysis",
                "status": "succeeded",
                "output_json": {
                    "command": self.command,
                    "analyzed_comments": 2,
                    "persisted_sentiments": 2,
                    "deepseek": {"status": "disabled"},
                },
                "evidence_ids": self.evidence_ids,
            },
        }

class EvidenceRepository:
    def __init__(self):
        self.calls = []

    def existing_evidence_ids(self, project_id, evidence_ids):
        self.calls.append((project_id, list(evidence_ids)))
        return {"comment-123", "event-7", "action-8"}.intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        return set()

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append({
            "proposal_audit_id": proposal_audit_id,
            "step_run_id": step_run_id,
            "review": persisted,
            "output": output,
        })
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        raise AssertionError("single step-output review should not create handoff")

source_repository = SourceRepository()
review_repository = ReviewRepository()
evidence_repository = EvidenceRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=source_repository,
    review_repository=review_repository,
    evidence_repository=evidence_repository,
)

accepted = service.create_review(10, {
    "projectId": 2,
    "stepRunId": 34,
    "maxAttempts": 3,
})
assert accepted["ok"] is True, accepted
assert accepted["proposalAuditId"] is None, accepted
assert accepted["stepRunId"] == 34, accepted
assert accepted["review"]["status"] == "passed", accepted
assert accepted["review"]["retry_count"] == 0, accepted
assert source_repository.calls == [(10, 2, None, 34)], source_repository.calls
assert source_repository.output_calls == [(10, 2, 34)], source_repository.output_calls
assert evidence_repository.calls == [(2, ["comment-123"])], evidence_repository.calls
assert len(review_repository.records) == 1, review_repository.records
recorded = review_repository.records[0]
assert recorded["proposal_audit_id"] is None, recorded
assert recorded["step_run_id"] == 34, recorded
assert recorded["output"]["command"] == "weibo-comments-analyze", recorded
assert recorded["output"]["evidence_ids"] == ["comment-123"], recorded
assert recorded["output"]["summary"] == "weibo-comments-analyze persisted 2 sentiment result(s) from 2 analyzed comment(s).", recorded
assert "deepseek" not in recorded["output"], recorded

missing_evidence_source = SourceRepository(evidence_ids=[])
missing_evidence_reviews = ReviewRepository()
missing_evidence = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=missing_evidence_source,
    review_repository=missing_evidence_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 34,
    "maxAttempts": 3,
})
assert missing_evidence["review"]["status"] == "failed", missing_evidence
assert missing_evidence["review"]["passed"] is False, missing_evidence
assert any(item["error_type"] == "missing_evidence_ids" for item in missing_evidence["review"]["evidence_errors"]), missing_evidence
assert len(missing_evidence_reviews.records) == 1, missing_evidence_reviews.records

unsupported_evidence_reviews = ReviewRepository()
unsupported_evidence = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=["event-7", "action-8"]),
    review_repository=unsupported_evidence_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 34,
    "maxAttempts": 3,
})
assert unsupported_evidence["review"]["status"] == "failed", unsupported_evidence
assert unsupported_evidence["review"]["passed"] is False, unsupported_evidence
unsupported_errors = unsupported_evidence["review"]["evidence_errors"]
assert {item["evidence_id"] for item in unsupported_errors} == {"event-7", "action-8"}, unsupported_evidence
assert all(item["error_type"] == "unsupported_comment_analysis_evidence_prefix" for item in unsupported_errors), unsupported_evidence
assert len(unsupported_evidence_reviews.records) == 1, unsupported_evidence_reviews.records

wrong_command = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(command="weibo-events-build"),
    review_repository=ReviewRepository(),
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 34,
    "maxAttempts": 3,
})
assert wrong_command["ok"] is False, wrong_command
assert wrong_command["error_type"] == "judge_review_source_not_found", wrong_command
`);
});

test("JudgeReviewService maps weibo-events-build step output into Rule Judge input", () => {
  runPython(`
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return run_id == 10 and project_id == 2

class SourceRepository:
    def __init__(self, evidence_ids=None, command="weibo-events-build"):
        self.calls = []
        self.output_calls = []
        self.evidence_ids = evidence_ids if evidence_ids is not None else ["123", "analysis-4", "event-7"]
        self.command = command

    def has_sources(self, run_id, project_id, proposal_audit_id=None, step_run_id=None):
        self.calls.append((run_id, project_id, proposal_audit_id, step_run_id))
        return run_id == 10 and project_id == 2 and proposal_audit_id is None and step_run_id == 44

    def step_output_for_review(self, run_id, project_id, step_run_id):
        self.output_calls.append((run_id, project_id, step_run_id))
        return {
            "ok": True,
            "step": {
                "id": step_run_id,
                "step_name": "event_building",
                "status": "succeeded",
                "output_json": {
                    "command": self.command,
                    "evidence_count": 3,
                    "persisted_events": 1,
                    "deepseek": {"status": "disabled"},
                },
                "evidence_ids": self.evidence_ids,
            },
        }

class EvidenceRepository:
    def __init__(self):
        self.calls = []

    def existing_evidence_ids(self, project_id, evidence_ids):
        self.calls.append((project_id, list(evidence_ids)))
        return {"comment-123", "analysis-4", "event-7", "action-8"}.intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        return set()

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append({
            "proposal_audit_id": proposal_audit_id,
            "step_run_id": step_run_id,
            "review": persisted,
            "output": output,
        })
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        raise AssertionError("single event step-output review should not create handoff")

source_repository = SourceRepository()
review_repository = ReviewRepository()
evidence_repository = EvidenceRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=source_repository,
    review_repository=review_repository,
    evidence_repository=evidence_repository,
)

accepted = service.create_review(10, {
    "projectId": 2,
    "stepRunId": 44,
    "maxAttempts": 3,
})
assert accepted["ok"] is True, accepted
assert accepted["proposalAuditId"] is None, accepted
assert accepted["stepRunId"] == 44, accepted
assert accepted["review"]["status"] == "passed", accepted
assert accepted["review"]["retry_count"] == 0, accepted
assert source_repository.calls == [(10, 2, None, 44)], source_repository.calls
assert source_repository.output_calls == [(10, 2, 44)], source_repository.output_calls
assert evidence_repository.calls == [(2, ["comment-123", "analysis-4", "event-7"])], evidence_repository.calls
assert len(review_repository.records) == 1, review_repository.records
recorded = review_repository.records[0]
assert recorded["proposal_audit_id"] is None, recorded
assert recorded["step_run_id"] == 44, recorded
assert recorded["output"]["command"] == "weibo-events-build", recorded
assert recorded["output"]["evidence_ids"] == ["comment-123", "analysis-4", "event-7"], recorded
assert recorded["output"]["summary"] == "weibo-events-build persisted 1 event(s) with 3 evidence reference(s).", recorded
assert "deepseek" not in recorded["output"], recorded

missing_evidence_reviews = ReviewRepository()
missing_evidence = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=[]),
    review_repository=missing_evidence_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 44,
    "maxAttempts": 3,
})
assert missing_evidence["review"]["status"] == "failed", missing_evidence
assert missing_evidence["review"]["passed"] is False, missing_evidence
assert any(item["error_type"] == "missing_evidence_ids" for item in missing_evidence["review"]["evidence_errors"]), missing_evidence
assert len(missing_evidence_reviews.records) == 1, missing_evidence_reviews.records

unsupported_evidence_reviews = ReviewRepository()
unsupported_evidence = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=["action-8", "foo-5"]),
    review_repository=unsupported_evidence_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 44,
    "maxAttempts": 3,
})
assert unsupported_evidence["review"]["status"] == "failed", unsupported_evidence
assert unsupported_evidence["review"]["passed"] is False, unsupported_evidence
unsupported_errors = unsupported_evidence["review"]["evidence_errors"]
assert {item["evidence_id"] for item in unsupported_errors} == {"action-8", "foo-5"}, unsupported_evidence
assert [item["error_type"] for item in unsupported_errors] == [
    "unsupported_event_building_evidence_prefix",
    "unsupported_event_building_evidence_prefix",
], unsupported_evidence
assert len(unsupported_evidence_reviews.records) == 1, unsupported_evidence_reviews.records

event_only_reviews = ReviewRepository()
event_only = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=["event-7"]),
    review_repository=event_only_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 44,
    "maxAttempts": 3,
})
assert event_only["review"]["status"] == "failed", event_only
assert event_only["review"]["passed"] is False, event_only
event_only_errors = event_only["review"]["evidence_errors"]
assert any(item["error_type"] == "event_building_source_evidence_required" for item in event_only_errors), event_only
assert len(event_only_reviews.records) == 1, event_only_reviews.records

wrong_command = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(command="weibo-actions-build"),
    review_repository=ReviewRepository(),
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 44,
    "maxAttempts": 3,
})
assert wrong_command["ok"] is False, wrong_command
assert wrong_command["error_type"] == "judge_review_source_not_found", wrong_command
`);
});

test("JudgeReviewService maps weibo-actions-build step output into Rule Judge input", () => {
  runPython(`
import json
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return run_id == 10 and project_id == 2

class SourceRepository:
    def __init__(
        self,
        evidence_ids=None,
        command="weibo-actions-build",
        output_json=None,
    ):
        self.calls = []
        self.output_calls = []
        self.evidence_ids = evidence_ids if evidence_ids is not None else ["event-7", "123", "memory-9"]
        self.command = command
        self.output_json = output_json

    def has_sources(self, run_id, project_id, proposal_audit_id=None, step_run_id=None):
        self.calls.append((run_id, project_id, proposal_audit_id, step_run_id))
        return run_id == 10 and project_id == 2 and proposal_audit_id is None and step_run_id == 54

    def step_output_for_review(self, run_id, project_id, step_run_id):
        self.output_calls.append((run_id, project_id, step_run_id))
        output_json = self.output_json or {
            "command": self.command,
            "events_considered": 2,
            "persisted_actions": 1,
            "candidate_events": 2,
            "deepseek": {"status": "not_run", "secret": "must-not-leak"},
            "actions": [{"raw_json": {"internal": "must-not-leak"}}],
            "recommendations": [{
                "text": "Use comment-123 as the monitoring signal.",
                "owner": "PR",
                "priority": "medium",
                "check_after": "24h",
                "evidence_ids": ["comment-123"],
                "raw_json": {"token": "secret-token"},
                "token": "secret-token",
                "cookie": "SUB=secret",
                "stderr": "secret stderr",
                "source_id": 999,
                "source_identity": "internal-source",
                "knowledge_fit": [{"source_id": 1, "match_reasons": ["internal"]}],
            }],
            "knowledge_reference_details": [{
                "id": "knowledge-card-8",
                "reliability_level": "A",
                "usage": "supporting_reference",
                "source_id": 999,
                "source_identity": "internal-source",
                "match_reasons": ["internal"],
                "judge_questions": ["internal"],
                "raw_json": {"token": "secret-token"},
            }],
            "knowledgeReferences": [{
                "id": "knowledge-card-8",
                "reliability_level": "A",
                "usage": "supporting_reference",
                "raw_json": {"token": "secret-token"},
            }],
        }
        output_json["command"] = self.command
        return {
            "ok": True,
            "step": {
                "id": step_run_id,
                "step_name": "action_recommendation",
                "status": "succeeded",
                "output_json": output_json,
                "evidence_ids": self.evidence_ids,
            },
        }

class EvidenceRepository:
    def __init__(self):
        self.calls = []
        self.knowledge_calls = []

    def existing_evidence_ids(self, project_id, evidence_ids):
        self.calls.append((project_id, list(evidence_ids)))
        return {"event-7", "comment-123", "memory-9"}.intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        self.knowledge_calls.append((project_id, list(knowledge_ids)))
        return {"knowledge-card-8"}.intersection(knowledge_ids)

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append({
            "proposal_audit_id": proposal_audit_id,
            "step_run_id": step_run_id,
            "review": persisted,
            "output": output,
        })
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        raise AssertionError("single action step-output review should not create handoff")

source_repository = SourceRepository()
review_repository = ReviewRepository()
evidence_repository = EvidenceRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=source_repository,
    review_repository=review_repository,
    evidence_repository=evidence_repository,
)

accepted = service.create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert accepted["ok"] is True, accepted
assert accepted["proposalAuditId"] is None, accepted
assert accepted["stepRunId"] == 54, accepted
assert accepted["review"]["status"] == "passed", accepted
assert accepted["review"]["retry_count"] == 0, accepted
assert source_repository.calls == [(10, 2, None, 54)], source_repository.calls
assert source_repository.output_calls == [(10, 2, 54)], source_repository.output_calls
assert evidence_repository.calls == [(2, ["event-7", "comment-123", "memory-9"])], evidence_repository.calls
assert len(review_repository.records) == 1, review_repository.records
recorded = review_repository.records[0]
assert recorded["proposal_audit_id"] is None, recorded
assert recorded["step_run_id"] == 54, recorded
assert recorded["output"]["command"] == "weibo-actions-build", recorded
assert recorded["output"]["evidence_ids"] == ["event-7", "comment-123", "memory-9"], recorded
assert recorded["output"]["summary"] == "weibo-actions-build persisted 1 action(s) from 2 candidate event(s).", recorded
assert recorded["output"]["persisted_actions"] == 1, recorded
assert recorded["output"]["candidate_events"] == 2, recorded
assert "deepseek" not in recorded["output"], recorded
assert "actions" not in recorded["output"], recorded
assert recorded["output"]["recommendations"] == [{
    "text": "Use comment-123 as the monitoring signal.",
    "owner": "PR",
    "priority": "medium",
    "check_after": "24h",
    "evidence_ids": ["comment-123"],
}], recorded
assert recorded["output"]["knowledge_references"] == ["knowledge-card-8"], recorded
assert recorded["output"]["knowledge_reference_details"] == [{
    "id": "knowledge-card-8",
    "reliability_level": "A",
    "usage": "supporting_reference",
}], recorded
serialized_output = json.dumps(recorded["output"], ensure_ascii=False)
serialized_review = json.dumps(recorded["review"]["feedback_json"], ensure_ascii=False)
for forbidden in [
    "secret-token",
    "SUB=secret",
    "secret stderr",
    "raw_json",
    "source_id",
    "source_identity",
    "knowledge_fit",
    "match_reasons",
    "judge_questions",
]:
    assert forbidden not in serialized_output, serialized_output
    assert forbidden not in serialized_review, serialized_review

missing_evidence_reviews = ReviewRepository()
missing_evidence = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=[]),
    review_repository=missing_evidence_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert missing_evidence["review"]["status"] == "failed", missing_evidence
assert missing_evidence["review"]["passed"] is False, missing_evidence
assert any(item["error_type"] == "missing_evidence_ids" for item in missing_evidence["review"]["evidence_errors"]), missing_evidence
assert len(missing_evidence_reviews.records) == 1, missing_evidence_reviews.records

knowledge_as_evidence_reviews = ReviewRepository()
knowledge_as_evidence = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=["knowledge-card-8"]),
    review_repository=knowledge_as_evidence_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert knowledge_as_evidence["review"]["status"] == "failed", knowledge_as_evidence
knowledge_as_evidence_errors = knowledge_as_evidence["review"]["evidence_errors"]
assert any(item["error_type"] == "knowledge_card_in_evidence_ids" for item in knowledge_as_evidence_errors), knowledge_as_evidence
assert len(knowledge_as_evidence_reviews.records) == 1, knowledge_as_evidence_reviews.records

missing_knowledge_reviews = ReviewRepository()
missing_knowledge = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(
        evidence_ids=["event-7", "comment-123"],
        output_json={
            "command": "weibo-actions-build",
            "persisted_actions": 1,
            "events_considered": 2,
            "knowledge_references": ["knowledge-card-999"],
        },
    ),
    review_repository=missing_knowledge_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert missing_knowledge["review"]["status"] == "failed", missing_knowledge
assert any(item["error_type"] == "knowledge_reference_not_found" for item in missing_knowledge["review"]["evidence_errors"]), missing_knowledge

inactive_knowledge_reviews = ReviewRepository()
inactive_knowledge_repo = EvidenceRepository()
inactive_knowledge_repo.existing_knowledge_card_ids = lambda project_id, knowledge_ids: set()
inactive_knowledge = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(
        evidence_ids=["event-7", "comment-123"],
        output_json={
            "command": "weibo-actions-build",
            "persisted_actions": 1,
            "events_considered": 2,
            "knowledge_references": ["knowledge-card-8"],
        },
    ),
    review_repository=inactive_knowledge_reviews,
    evidence_repository=inactive_knowledge_repo,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert inactive_knowledge["review"]["status"] == "failed", inactive_knowledge
assert any(item["error_type"] == "knowledge_reference_not_found" for item in inactive_knowledge["review"]["evidence_errors"]), inactive_knowledge

action_only_reviews = ReviewRepository()
action_only = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=["action-6"]),
    review_repository=action_only_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert action_only["review"]["status"] == "failed", action_only
assert any(item["error_type"] == "action_recommendation_source_evidence_required" for item in action_only["review"]["evidence_errors"]), action_only

event_with_numeric_fallback_reviews = ReviewRepository()
event_with_numeric_fallback_evidence = EvidenceRepository()
event_with_numeric_fallback = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(evidence_ids=["event-7", "7"]),
    review_repository=event_with_numeric_fallback_reviews,
    evidence_repository=event_with_numeric_fallback_evidence,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert event_with_numeric_fallback["review"]["status"] == "passed", event_with_numeric_fallback
assert event_with_numeric_fallback_evidence.calls == [(2, ["event-7"])], event_with_numeric_fallback_evidence.calls
assert event_with_numeric_fallback_reviews.records[0]["output"]["evidence_ids"] == ["event-7"], event_with_numeric_fallback_reviews.records

vague_action_reviews = ReviewRepository()
vague_action = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(
        evidence_ids=["event-7", "comment-123"],
        output_json={
            "command": "weibo-actions-build",
            "persisted_actions": 1,
            "events_considered": 2,
            "summary": "建议继续关注，加强沟通。",
            "recommendations": [{"text": "继续关注，加强沟通。"}],
        },
    ),
    review_repository=vague_action_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert vague_action["review"]["status"] == "failed", vague_action
assert any(item["error_type"] == "vague_action_without_operational_fields" for item in vague_action["review"]["evidence_errors"]), vague_action

causal_overclaim_reviews = ReviewRepository()
causal_overclaim = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(
        evidence_ids=["event-7", "comment-123"],
        output_json={
            "command": "weibo-actions-build",
            "persisted_actions": 1,
            "events_considered": 2,
            "summary": "这次宣发行动单独导致负面评论下降，行动效果已经确定。",
            "recommendations": [{
                "owner": "PR",
                "priority": "high",
                "check_after": "24h",
                "text": "Use comment-123 as the monitoring signal."
            }],
        },
    ),
    review_repository=causal_overclaim_reviews,
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert causal_overclaim["review"]["status"] == "failed", causal_overclaim
assert any(item["error_type"] == "single_cause_overclaim" for item in causal_overclaim["review"]["evidence_errors"]), causal_overclaim

wrong_command = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(command="weibo-bot-message"),
    review_repository=ReviewRepository(),
    evidence_repository=evidence_repository,
).create_review(10, {
    "projectId": 2,
    "stepRunId": 54,
    "maxAttempts": 3,
})
assert wrong_command["ok"] is False, wrong_command
assert wrong_command["error_type"] == "judge_review_source_not_found", wrong_command
`);
});

test("JudgeReviewService runs fixture outputs as a clamped three-attempt rule Judge retry", () => {
  runPython(`
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return run_id == 10 and project_id == 2

class SourceRepository:
    def __init__(self, valid=True):
        self.valid = valid
        self.calls = []

    def has_sources(self, run_id, project_id, proposal_audit_id, step_run_id=None):
        self.calls.append((run_id, project_id, proposal_audit_id, step_run_id))
        return self.valid

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append(persisted)
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        return {"feedback": {"id": 1, "source_type": "judge_review", "source_id": review["id"]}}

class EvidenceRepository:
    def existing_evidence_ids(self, project_id, evidence_ids):
        return {"comment-123"}.intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        return set()

source_repository = SourceRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=source_repository,
    review_repository=ReviewRepository(),
    evidence_repository=EvidenceRepository(),
)
assert service.has_agent_run(10, 2) is True
assert service.has_agent_run(10, 3) is False

result = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 56,
    "stepRunId": 34,
    "maxAttempts": 5,
    "fixtureOutputs": [
        {"output": {"summary": "missing evidence"}},
        {"output": {"evidence_ids": []}},
        {"output": {"summary": "bounded", "evidence_ids": ["comment-123"]}},
        {"output": {"summary": "must not run", "evidence_ids": []}},
    ],
})
assert result["ok"] is True, result
assert result["review"]["status"] == "passed", result
assert result["review"]["passed"] is True, result
assert result["review"]["retry_count"] == 2, result
assert result["retryCount"] == 2, result
assert result["proposalAuditId"] == 56, result
assert result["stepRunId"] == 34, result
assert service.fact_write_count == 0, service.fact_write_count
assert source_repository.calls == [(10, 2, 56, 34)], source_repository.calls

exhausted = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 57,
    "maxAttempts": 3,
    "fixtureOutputs": [
        {"output": {"summary": "missing evidence"}},
        {"output": {"summary": "still missing"}},
        {"output": {"summary": "still missing again"}},
        {"output": {"summary": "fourth output must not run", "evidence_ids": ["comment-999"]}},
    ],
})
assert exhausted["review"]["status"] == "needs_human", exhausted
assert exhausted["review"]["passed"] is False, exhausted
assert exhausted["retryCount"] == 2, exhausted

missing_source_service = JudgeReviewService(run_repository=RunRepository(), source_repository=SourceRepository(valid=False), review_repository=ReviewRepository())
missing_source = missing_source_service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 999,
    "stepRunId": 34,
    "fixtureOutputs": [{"output": {"evidence_ids": ["comment-123"]}}],
})
assert missing_source["ok"] is False, missing_source
assert missing_source["error_type"] == "judge_review_source_not_found", missing_source
`);
});

test("JudgeReviewService persists each fake retry attempt and handoff on exhaustion", () => {
  runPython(`
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return True

class SourceRepository:
    def has_sources(self, run_id, project_id, proposal_audit_id, step_run_id=None):
        return True

class ReviewRepository:
    def __init__(self):
        self.records = []
        self.needs_human_calls = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append({
            "run_id": run_id,
            "project_id": project_id,
            "proposal_audit_id": proposal_audit_id,
            "step_run_id": step_run_id,
            "review": persisted,
            "output": output,
        })
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        self.needs_human_calls.append((run_id, project_id, step_run_id, review["id"]))
        return {"feedback": {"id": len(self.needs_human_calls), "source_type": "judge_review", "source_id": review["id"]}}

class EvidenceRepository:
    def existing_evidence_ids(self, project_id, evidence_ids):
        return {"comment-123"}.intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        return set()

passing_repo = ReviewRepository()
passing_service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(),
    review_repository=passing_repo,
    evidence_repository=EvidenceRepository(),
)
passing = passing_service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 56,
    "stepRunId": 34,
    "maxAttempts": 3,
    "fixtureOutputs": [
        {"output": {"summary": "missing evidence"}},
        {"output": {"summary": "still missing"}},
        {"output": {"summary": "bounded", "evidence_ids": ["comment-123"]}},
    ],
})
assert passing["ok"] is True, passing
assert passing["review"]["id"] == 3, passing
assert passing["review"]["status"] == "passed", passing
assert [item["review"]["status"] for item in passing_repo.records] == ["failed", "failed", "passed"], passing_repo.records
assert [item["review"]["retry_count"] for item in passing_repo.records] == [0, 1, 2], passing_repo.records
assert passing_repo.records[0]["review"]["feedback_json"]["failed_output_summary"]["summary"] == "missing evidence", passing_repo.records
assert passing_repo.needs_human_calls == [], passing_repo.needs_human_calls

exhausted_repo = ReviewRepository()
exhausted_service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(),
    review_repository=exhausted_repo,
    evidence_repository=EvidenceRepository(),
)
exhausted = exhausted_service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 57,
    "stepRunId": 35,
    "maxAttempts": 5,
    "fixtureOutputs": [
        {"output": {"summary": "missing evidence"}},
        {"output": {"summary": "still missing"}},
        {"output": {"summary": "still missing again"}},
        {"output": {"summary": "must not run", "evidence_ids": ["comment-999"]}},
    ],
})
assert exhausted["review"]["status"] == "needs_human", exhausted
assert [item["review"]["status"] for item in exhausted_repo.records] == ["failed", "failed", "needs_human"], exhausted_repo.records
assert exhausted_repo.needs_human_calls == [(10, 2, 35, 3)], exhausted_repo.needs_human_calls
assert exhausted["manualHandoff"]["source_id"] == 3, exhausted

default_source_repo = ReviewRepository()
default_source_service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(),
    review_repository=default_source_repo,
    evidence_repository=EvidenceRepository(),
)
default_source = default_source_service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 58,
    "maxAttempts": 3,
    "fixtureOutputs": [
        {"output": {"summary": "missing evidence"}},
        {"output": {"summary": "still missing"}},
        {"output": {"summary": "still missing again"}},
    ],
})
assert default_source["review"]["status"] == "needs_human", default_source
assert default_source["stepRunId"] == 58, default_source
assert default_source_repo.needs_human_calls == [(10, 2, 58, 3)], default_source_repo.needs_human_calls
`);
});

test("JudgeReviewService rejects malformed and unowned Judge evidence IDs before passed review persistence", () => {
  runPython(`
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return True

class SourceRepository:
    def has_sources(self, run_id, project_id, proposal_audit_id, step_run_id=None):
        return True

class EvidenceRepository:
    def __init__(self):
        self.existing_calls = []
        self.knowledge_calls = []

    def existing_evidence_ids(self, project_id, evidence_ids):
        self.existing_calls.append((project_id, list(evidence_ids)))
        existing = {
            2: {
                "target-1",
                "post-2",
                "comment-3",
                "analysis-4",
                "event-5",
                "action-6",
                "memory-7",
            }
        }
        return set(existing.get(project_id, set())).intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        self.knowledge_calls.append((project_id, list(knowledge_ids)))
        return set()

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append(persisted)
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        return {"feedback": {"id": 1, "source_type": "judge_review", "source_id": review["id"]}}

evidence_repository = EvidenceRepository()
review_repository = ReviewRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(),
    review_repository=review_repository,
    evidence_repository=evidence_repository,
)

result = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 56,
    "stepRunId": 34,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "bad evidence should fail",
            "evidence_ids": [
                "target-",
                "comment:3",
                "sentiment-4",
                "analysis-abc",
                "knowledge-card-8",
                "comment-999",
            ],
        }
    }],
})

assert result["ok"] is True, result
assert result["review"]["status"] == "failed", result
assert result["review"]["passed"] is False, result
assert review_repository.records[0]["status"] == "failed", review_repository.records
assert review_repository.records[0]["passed"] is False, review_repository.records
errors = result["review"]["evidence_errors"]
bad_ids = {item["evidence_id"] for item in errors}
assert bad_ids == {
    "target-",
    "comment:3",
    "sentiment-4",
    "analysis-abc",
    "knowledge-card-8",
    "comment-999",
}, errors
assert all(item["error_type"] in {
    "invalid_evidence_id_format",
    "unsupported_evidence_prefix",
    "knowledge_card_in_evidence_ids",
    "evidence_not_found",
} for item in errors), errors
assert evidence_repository.existing_calls == [(2, ["comment-999"])], evidence_repository.existing_calls
assert evidence_repository.knowledge_calls == [], evidence_repository.knowledge_calls
`);
});

test("JudgeReviewService accepts same-project Judge evidence IDs and validates knowledge references separately", () => {
  runPython(`
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return True

class SourceRepository:
    def has_sources(self, run_id, project_id, proposal_audit_id, step_run_id=None):
        return True

class EvidenceRepository:
    def __init__(self):
        self.existing_calls = []
        self.knowledge_calls = []

    def existing_evidence_ids(self, project_id, evidence_ids):
        self.existing_calls.append((project_id, list(evidence_ids)))
        existing = {
            2: {
                "target-1",
                "post-2",
                "comment-3",
                "analysis-4",
                "event-5",
                "action-6",
                "memory-7",
            },
            3: {"comment-3"},
        }
        return set(existing.get(project_id, set())).intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        self.knowledge_calls.append((project_id, list(knowledge_ids)))
        existing = {2: {"knowledge-card-8"}}
        return set(existing.get(project_id, set())).intersection(knowledge_ids)

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append(persisted)
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        raise AssertionError("valid evidence should not need human handoff")

evidence_repository = EvidenceRepository()
review_repository = ReviewRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(),
    review_repository=review_repository,
    evidence_repository=evidence_repository,
)

accepted = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 56,
    "stepRunId": 34,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "all evidence belongs to project 2",
            "evidence_ids": [
                "target-1",
                "post-2",
                "comment-3",
                "analysis-4",
                "event-5",
                "action-6",
                "memory-7",
            ],
            "knowledge_references": ["knowledge-card-8"],
        }
    }],
})
assert accepted["review"]["status"] == "passed", accepted
assert accepted["review"]["passed"] is True, accepted
assert accepted["review"]["evidence_errors"] == [], accepted
assert accepted["review"]["feedback_json"]["evidence_ids"] == [
    "target-1",
    "post-2",
    "comment-3",
    "analysis-4",
    "event-5",
    "action-6",
    "memory-7",
], accepted
assert accepted["review"]["feedback_json"]["knowledge_references"] == ["knowledge-card-8"], accepted
assert evidence_repository.existing_calls == [(2, [
    "target-1",
    "post-2",
    "comment-3",
    "analysis-4",
    "event-5",
    "action-6",
    "memory-7",
])], evidence_repository.existing_calls
assert evidence_repository.knowledge_calls == [(2, ["knowledge-card-8"])], evidence_repository.knowledge_calls

knowledge_only = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 57,
    "stepRunId": 35,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "knowledge cards cannot replace real evidence",
            "evidence_ids": [],
            "knowledge_references": ["knowledge-card-8"],
        }
    }],
})
assert knowledge_only["review"]["status"] == "failed", knowledge_only
assert knowledge_only["review"]["passed"] is False, knowledge_only
assert any(item["error_type"] == "missing_evidence_ids" for item in knowledge_only["review"]["evidence_errors"]), knowledge_only

missing_knowledge = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 58,
    "stepRunId": 36,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "knowledge references are validated independently",
            "evidence_ids": ["comment-3"],
            "knowledge_references": ["knowledge-card-999", "comment-3"],
        }
    }],
})
assert missing_knowledge["review"]["status"] == "failed", missing_knowledge
bad_refs = {item["evidence_id"] for item in missing_knowledge["review"]["evidence_errors"]}
assert bad_refs == {"knowledge-card-999", "comment-3"}, missing_knowledge
`);
});

test("JudgeReviewService accepts platform evidence IDs with labels and rejects cross-project or unsupported platform IDs", () => {
  runPython(`
import json
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return True

class SourceRepository:
    def has_sources(self, run_id, project_id, proposal_audit_id, step_run_id=None):
        return True

platform_ids = [
    "bilibili:project:2:item:BV1HDLOG0001",
    "bilibili:project:2:text:BV1HDLOG0001:transcript:zh-cn",
    "bilibili:project:2:text:BV1HDLOG0001:body",
    "bilibili:project:2:comment:r9001",
    "xiaohongshu:project:2:item:xhs-note-1001",
    "xiaohongshu:project:2:comment:xhs-comment-7001",
]

class EvidenceRepository:
    def __init__(self):
        self.existing_calls = []

    def existing_evidence_ids(self, project_id, evidence_ids):
        self.existing_calls.append((project_id, list(evidence_ids)))
        existing = {2: set(platform_ids)}
        return set(existing.get(project_id, set())).intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        return set()

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append(persisted)
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        raise AssertionError("platform fixture evidence should not need human handoff")

evidence_repository = EvidenceRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(),
    review_repository=ReviewRepository(),
    evidence_repository=evidence_repository,
)

accepted = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 61,
    "stepRunId": 41,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "platform evidence has normalized citations",
            "evidence_ids": platform_ids,
        }
    }],
})
assert accepted["review"]["status"] == "passed", accepted
assert accepted["review"]["passed"] is True, accepted
assert accepted["review"]["evidence_errors"] == [], accepted
assert accepted["review"]["feedback_json"]["evidence_ids"] == platform_ids, accepted
assert accepted["review"]["feedback_json"]["citation_details"] == [
    {"id": "bilibili:project:2:item:BV1HDLOG0001", "platform": "bilibili", "platform_label": "B站", "source_type": "item", "label": "B站视频"},
    {"id": "bilibili:project:2:text:BV1HDLOG0001:transcript:zh-cn", "platform": "bilibili", "platform_label": "B站", "source_type": "text", "label": "B站字幕"},
    {"id": "bilibili:project:2:text:BV1HDLOG0001:body", "platform": "bilibili", "platform_label": "B站", "source_type": "text", "label": "B站正文"},
    {"id": "bilibili:project:2:comment:r9001", "platform": "bilibili", "platform_label": "B站", "source_type": "comment", "label": "B站评论"},
    {"id": "xiaohongshu:project:2:item:xhs-note-1001", "platform": "xiaohongshu", "platform_label": "小红书", "source_type": "item", "label": "小红书笔记"},
    {"id": "xiaohongshu:project:2:comment:xhs-comment-7001", "platform": "xiaohongshu", "platform_label": "小红书", "source_type": "comment", "label": "小红书评论"},
], accepted
assert evidence_repository.existing_calls == [(2, platform_ids)], evidence_repository.existing_calls
serialized = json.dumps(accepted, ensure_ascii=False)
for forbidden in ["raw_artifact", "stdout", "stderr", "Cookie", "token", "browser", "storage", "login", "private"]:
    assert forbidden not in serialized, serialized

cross_project = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 62,
    "stepRunId": 42,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "cross-project platform evidence must fail",
            "evidence_ids": ["bilibili:project:3:item:BV1HDLOG0001"],
        }
    }],
})
assert cross_project["review"]["status"] == "failed", cross_project
assert any(item["error_type"] == "evidence_project_mismatch" for item in cross_project["review"]["evidence_errors"]), cross_project

cross_project_text = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 65,
    "stepRunId": 45,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "cross-project B站 text evidence must fail",
            "evidence_ids": ["bilibili:project:3:text:BV1HDLOG0001:body"],
        }
    }],
})
assert cross_project_text["review"]["status"] == "failed", cross_project_text
assert any(item["error_type"] == "evidence_project_mismatch" for item in cross_project_text["review"]["evidence_errors"]), cross_project_text

missing_text = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 66,
    "stepRunId": 46,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "missing B站 text evidence must fail",
            "evidence_ids": ["bilibili:project:2:text:BV1HDLOG4040:transcript:zh-cn"],
        }
    }],
})
assert missing_text["review"]["status"] == "failed", missing_text
assert any(item["error_type"] == "evidence_not_found" for item in missing_text["review"]["evidence_errors"]), missing_text

unsupported = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 63,
    "stepRunId": 43,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "douyin platform evidence is not implemented",
            "evidence_ids": ["douyin:project:2:item:douyin-video-1"],
        }
    }],
})
assert unsupported["review"]["status"] == "failed", unsupported
assert any(item["error_type"] == "unsupported_platform_evidence_id" for item in unsupported["review"]["evidence_errors"]), unsupported

malformed = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 64,
    "stepRunId": 44,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "malformed platform evidence must fail",
            "evidence_ids": ["bilibili:project:2:item:../raw_stdout"],
        }
    }],
})
assert malformed["review"]["status"] == "failed", malformed
assert any(item["error_type"] == "invalid_evidence_id_format" for item in malformed["review"]["evidence_errors"]), malformed
`);
});

test("MySQLJudgeEvidenceRepository verifies Bilibili text evidence through same-project post raw_json evidence_ids", () => {
  runPython(`
import sys
import types
import workers
from app.judge_review_service import MySQLJudgeEvidenceRepository

transcript_id = "bilibili:project:2:text:BV1HDLOG0001:transcript:zh-cn"
body_id = "bilibili:project:2:text:BV1HDLOG0001:body"
missing_id = "bilibili:project:2:text:BV1HDLOG4040:transcript:zh-cn"
cross_project_id = "bilibili:project:3:text:BV1HDLOG0001:body"
persisted = {
    (2, "bilibili", "BV1HDLOG0001", transcript_id),
    (2, "bilibili", "BV1HDLOG0001", body_id),
}
queries = []

class Cursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params):
        self.sql = sql
        self.params = params
        queries.append((sql, params))
        self.row = None
        if "FROM social_posts" in sql and "JSON_CONTAINS" in sql and "raw_json" in sql:
            project_id, platform, external_id, evidence_id = params
            if (project_id, platform, external_id, evidence_id) in persisted:
                self.row = {"id": 1001}

    def fetchone(self):
        return self.row

class Connection:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return Cursor()

fake_db = types.SimpleNamespace(connect=lambda: Connection())
workers.db = fake_db
sys.modules["workers.db"] = fake_db

repository = MySQLJudgeEvidenceRepository()
existing = repository.existing_evidence_ids(2, [
    transcript_id,
    body_id,
    missing_id,
    cross_project_id,
])

assert existing == {transcript_id, body_id}, existing
assert len(queries) == 3, queries
for sql, params in queries:
    assert "FROM social_posts" in sql, sql
    assert "JSON_CONTAINS" in sql, sql
    assert "raw_json" in sql, sql
    assert params[0] == 2, params
    assert params[1] == "bilibili", params
    assert params[3].startswith("bilibili:project:2:text:"), params
`);
});

test("JudgeReviewService rejects deterministic Rule Judge boundary violations", () => {
  runPython(`
from app.judge_review_service import JudgeReviewService

class RunRepository:
    def has_run(self, run_id, project_id):
        return True

class SourceRepository:
    def has_sources(self, run_id, project_id, proposal_audit_id, step_run_id=None):
        return True

class EvidenceRepository:
    def existing_evidence_ids(self, project_id, evidence_ids):
        return {"comment-3", "event-5", "action-6"}.intersection(evidence_ids)

    def existing_knowledge_card_ids(self, project_id, knowledge_ids):
        return {"knowledge-card-8"}.intersection(knowledge_ids)

class ReviewRepository:
    def __init__(self):
        self.records = []

    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        persisted = {**review, "id": len(self.records) + 1}
        self.records.append(persisted)
        return persisted

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        return {"feedback": {"id": 1, "source_type": "judge_review", "source_id": review["id"]}}

review_repository = ReviewRepository()
service = JudgeReviewService(
    run_repository=RunRepository(),
    source_repository=SourceRepository(),
    review_repository=review_repository,
    evidence_repository=EvidenceRepository(),
)

cases = [
    (
        "vague action without operational fields",
        {
            "summary": "建议继续关注，加强沟通。",
            "evidence_ids": ["comment-3"],
            "recommendations": [{"text": "继续关注，加强沟通。"}],
        },
        "vague_action_without_operational_fields",
    ),
    (
        "action item missing operational fields without fixed vague phrase",
        {
            "summary": "建议发布澄清帖回应争议。",
            "evidence_ids": ["comment-3"],
            "recommendations": [{"text": "发布澄清帖回应争议。"}],
        },
        "vague_action_without_operational_fields",
    ),
    (
        "knowledge card written as current fact",
        {
            "summary": "current Weibo facts copied from a card",
            "evidence_ids": ["comment-3"],
            "knowledge_references": ["knowledge-card-8"],
            "facts": [{"text": "knowledge-card-8 证明当前微博用户已经接受联名转发策略。"}],
        },
        "knowledge_card_as_current_fact",
    ),
    (
        "knowledge card summary written as current Weibo fact",
        {
            "summary": "根据知识卡经验，当前微博用户已经接受联名转发策略。",
            "evidence_ids": ["comment-3"],
            "knowledge_references": ["knowledge-card-8"],
        },
        "knowledge_card_as_current_fact",
    ),
    (
        "C-level card used as hard rule",
        {
            "summary": "C-level card is being used as a hard rule",
            "evidence_ids": ["comment-3"],
            "knowledge_references": ["knowledge-card-8"],
            "knowledge_reference_details": [
                {"id": "knowledge-card-8", "reliability_level": "C", "usage": "hard_rule"}
            ],
            "recommendations": [{"text": "必须按知识卡经验执行抽奖转发。"}],
        },
        "c_level_knowledge_card_hard_rule",
    ),
    (
        "C-level card dict reference used as hard rule",
        {
            "summary": "C-level card reference dict is being used as a hard rule",
            "evidence_ids": ["comment-3"],
            "knowledge_references": [
                {"id": "knowledge-card-8", "reliability_level": "C", "usage": "hard_rule"}
            ],
            "recommendations": [{"text": "必须按知识卡经验执行抽奖转发。"}],
        },
        "c_level_knowledge_card_hard_rule",
    ),
    (
        "C-level weak label still cannot use hard-rule action text",
        {
            "summary": "C-level card is labelled weak, but the action text is mandatory",
            "evidence_ids": ["comment-3"],
            "knowledge_references": [
                {"id": "knowledge-card-8", "reliability_level": "C", "usage": "weak_inspiration"}
            ],
            "recommendations": [
                {
                    "owner": "PR",
                    "priority": "high",
                    "check_after": "24h",
                    "text": "必须按知识卡经验执行抽奖转发，并以 comment-3 作为跟踪信号。"
                }
            ],
        },
        "c_level_knowledge_card_hard_rule",
    ),
    (
        "deterministic metric overclaim",
        {
            "summary": "Judge output sets authoritative deterministic metrics",
            "evidence_ids": ["comment-3"],
            "sentiment_score": 0.92,
            "event_score": 88,
            "trend_window": "7d",
            "backtest_signal": "strong_positive",
        },
        "deterministic_metric_overclaim",
    ),
    (
        "single-cause effect overclaim",
        {
            "summary": "这次宣发行动单独导致负面评论下降，行动效果已经确定。",
            "evidence_ids": ["comment-3", "action-6"],
            "recommendations": [
                {
                    "owner": "PR",
                    "priority": "high",
                    "check_after": "24h",
                    "text": "继续监控 action-6 后续评论。"
                }
            ],
        },
        "single_cause_overclaim",
    ),
    (
        "single-cause effect overclaim cannot be bypassed by uncertainty word",
        {
            "summary": "这次宣发行动直接导致负面评论下降；虽然存在不确定性，但行动效果已经确定。",
            "evidence_ids": ["comment-3", "action-6"],
            "recommendations": [
                {
                    "owner": "PR",
                    "priority": "high",
                    "check_after": "24h",
                    "text": "Use comment-3 as the monitoring signal after action-6."
                }
            ],
        },
        "single_cause_overclaim",
    ),
    (
        "single-cause effect overclaim cannot be bypassed by all boundary words",
        {
            "summary": "这次宣发行动直接导致负面评论下降，行动效果已经确定；comment-3 is a signal with uncertainty and confounders.",
            "evidence_ids": ["comment-3", "action-6"],
            "recommendations": [
                {
                    "owner": "PR",
                    "priority": "high",
                    "check_after": "24h",
                    "text": "Use comment-3 as the monitoring signal after action-6."
                }
            ],
        },
        "single_cause_overclaim",
    ),
]

for index, (name, output, error_type) in enumerate(cases, start=1):
    result = service.create_review(10, {
        "projectId": 2,
        "proposalAuditId": 100 + index,
        "stepRunId": 200 + index,
        "maxAttempts": 1,
        "fixtureOutputs": [{"output": output}],
    })
    assert result["review"]["status"] == "failed", (name, result)
    assert result["review"]["passed"] is False, (name, result)
    assert any(item["error_type"] == error_type for item in result["review"]["evidence_errors"]), (name, result)
    assert any(error_type in change for change in result["review"]["required_changes"]), (name, result)

weak_inspiration = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 200,
    "stepRunId": 300,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "C-level knowledge is kept only as weak inspiration; real evidence is comment-3.",
            "evidence_ids": ["comment-3"],
            "knowledge_references": [
                {"id": "knowledge-card-8", "reliability_level": "C", "usage": "weak_inspiration"}
            ],
            "recommendations": [
                {
                    "owner": "PR",
                    "priority": "medium",
                    "check_after": "24h",
                    "text": "Use comment-3 as the signal and treat the C-level card as weak inspiration only."
                }
            ],
        }
    }],
})
assert weak_inspiration["review"]["status"] == "passed", weak_inspiration
assert weak_inspiration["review"]["passed"] is True, weak_inspiration
assert weak_inspiration["review"]["evidence_errors"] == [], weak_inspiration

weak_inspiration_with_operational_must = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 202,
    "stepRunId": 302,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "C-level knowledge is weak inspiration only; real evidence is comment-3.",
            "evidence_ids": ["comment-3"],
            "knowledge_references": [
                {"id": "knowledge-card-8", "reliability_level": "C", "usage": "weak_inspiration"}
            ],
            "recommendations": [
                {
                    "owner": "PR",
                    "priority": "high",
                    "check_after": "24h",
                    "text": "PR must reply to comment-3 today; the team must not treat the C-level card as evidence."
                }
            ],
        }
    }],
})
assert weak_inspiration_with_operational_must["review"]["status"] == "passed", weak_inspiration_with_operational_must
assert weak_inspiration_with_operational_must["review"]["passed"] is True, weak_inspiration_with_operational_must
assert weak_inspiration_with_operational_must["review"]["evidence_errors"] == [], weak_inspiration_with_operational_must

non_causal_confirmed_plan = service.create_review(10, {
    "projectId": 2,
    "proposalAuditId": 201,
    "stepRunId": 301,
    "maxAttempts": 1,
    "fixtureOutputs": [{
        "output": {
            "summary": "执行计划已经确定，但当前舆情仍只作为观察信号处理。",
            "evidence_ids": ["comment-3"],
            "recommendations": [
                {
                    "owner": "PR",
                    "priority": "medium",
                    "check_after": "24h",
                    "text": "Use comment-3 as the signal and keep monitoring uncertainty."
                }
            ],
        }
    }],
})
assert non_causal_confirmed_plan["review"]["status"] == "passed", non_causal_confirmed_plan
assert non_causal_confirmed_plan["review"]["passed"] is True, non_causal_confirmed_plan
assert not any(
    item["error_type"] == "single_cause_overclaim"
    for item in non_causal_confirmed_plan["review"]["evidence_errors"]
), non_causal_confirmed_plan
`);
});

test("JudgeReviewService MySQL handoff path uses an explicit transaction", () => {
  runPython(`
from pathlib import Path

source = Path("app/judge_review_service.py").read_text(encoding="utf-8")
method = source[source.index("    def mark_needs_human("):source.index("\\n\\nclass JudgeReviewService")]
for required in ["conn.begin()", "conn.commit()", "conn.rollback()"]:
    assert required in method, method
`);
});

test("CrewAIProposalService records accepted rejected and runtime_failed proposal audits without fact writes and keeps raw_model_output_ref", () => {
  runPython(`
import json
from app.crewai_proposal_service import CrewAIProposalService, InMemoryAgentRunRepository, InMemoryProposalAuditRepository
from app.crewai_proposal import proposal_error

class FakeAuditRepository(InMemoryProposalAuditRepository):
    pass

class EvidenceRepository:
    def __init__(self):
        self.project_evidence = {
            (2, "comment"): {123},
            (2, "event"): {7},
        }

    def find_existing(self, project_id, kind, ids):
        return self.project_evidence.get((project_id, kind), set()).intersection(ids)

class AcceptedRuntime:
    def __init__(self):
        self.calls = []

    def run_proposal(self, request):
        self.calls.append(request)
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "Scoped context was inspected.", "evidence_ids": ["comment:123"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": "audit://raw-output/1",
            },
        }

class RejectedRuntime:
    def run_proposal(self, request):
        return proposal_error(
            "crewai_evidence_rejected",
            "Evidence was rejected.",
            "Cross-project evidence is not allowed.",
            "Retry with evidence IDs from the same project.",
        )

class RuntimeFailedRuntime:
    def run_proposal(self, request):
        return {
            **proposal_error(
                "crewai_runtime_failed",
                "CrewAI runtime failed.",
                "private runtime details",
                "Retry with a healthy runtime.",
            ),
            "traceback": "hidden traceback",
            "stderr": "hidden stderr",
            "prompt": "hidden prompt",
        }

run_repository = InMemoryAgentRunRepository(runs={(2, 10)})

accepted_audit = FakeAuditRepository()
accepted_runtime = AcceptedRuntime()
accepted_service = CrewAIProposalService(
    runtime_adapter=accepted_runtime,
    audit_repository=accepted_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
accepted = accepted_service.create_proposal(10, {
    "projectId": 2,
    "stage": "strategy",
    "evidenceIds": ["comment:123"],
    "knowledgeQuery": "heated discussion",
})
assert accepted["ok"] is True, accepted
assert accepted["proposalAuditId"] == "audit-1", accepted
assert accepted["proposal"]["raw_model_output_ref"] == "audit://raw-output/1", accepted
assert accepted_runtime.calls == [{
    "project_id": 2,
    "agent_loop_run_id": 10,
    "stage": "strategy",
    "evidence_ids": ["comment:123"],
    "knowledge_query": "heated discussion",
}], accepted_runtime.calls
assert accepted_audit.fact_write_count == 0, accepted_audit.fact_write_count
assert accepted_audit.records[0]["status"] == "accepted", accepted_audit.records

rejected_audit = FakeAuditRepository()
rejected_service = CrewAIProposalService(
    runtime_adapter=RejectedRuntime(),
    audit_repository=rejected_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
rejected = rejected_service.create_proposal(10, {"projectId": 2, "stage": "strategy"})
assert rejected["ok"] is False, rejected
assert rejected["error_type"] == "crewai_evidence_rejected", rejected
assert rejected["proposalAuditId"] == "audit-1", rejected
assert rejected_audit.records[0]["status"] == "rejected", rejected_audit.records

runtime_failed_audit = FakeAuditRepository()
runtime_failed_service = CrewAIProposalService(
    runtime_adapter=RuntimeFailedRuntime(),
    audit_repository=runtime_failed_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
runtime_failed = runtime_failed_service.create_proposal(10, {"projectId": 2, "stage": "strategy"})
assert runtime_failed["ok"] is False, runtime_failed
assert runtime_failed["error_type"] == "crewai_runtime_failed", runtime_failed
assert runtime_failed["proposalAuditId"] == "audit-1", runtime_failed
assert runtime_failed_audit.records[0]["status"] == "runtime_error", runtime_failed_audit.records

serialized = json.dumps([accepted, rejected, runtime_failed], ensure_ascii=False)
for forbidden in [
    "hidden traceback",
    "hidden stderr",
    "hidden prompt",
    "traceback",
    "stderr",
    "prompt",
    "mysql://",
    ".env",
    "config/cookies/weibo.json",
]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAIProposalService rejects scope mismatch and missing or cross-project evidence before accepted audit", () => {
  runPython(`
from app.crewai_proposal_service import CrewAIProposalService, InMemoryAgentRunRepository, InMemoryProposalAuditRepository

class RecordingAuditRepository(InMemoryProposalAuditRepository):
    pass

class EvidenceRepository:
    def __init__(self):
        self.project_evidence = {
            (2, "comment"): {123},
            (2, "event"): {7},
            (3, "comment"): {999},
        }

    def find_existing(self, project_id, kind, ids):
        return self.project_evidence.get((project_id, kind), set()).intersection(ids)

class WrongScopeRuntime:
    def run_proposal(self, request):
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": 999,
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "wrong project", "evidence_ids": ["comment:123"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None,
            },
        }

class MissingEvidenceRuntime:
    def run_proposal(self, request):
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "missing evidence", "evidence_ids": ["comment:999"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None,
            },
        }

class CrossProjectEvidenceRuntime:
    def run_proposal(self, request):
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "cross project evidence", "evidence_ids": ["comment:999"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None,
            },
        }

class InvalidAcceptedShapeRuntime:
    def run_proposal(self, request):
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "tries direct write", "evidence_ids": ["comment:123"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "database_write",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None,
            },
        }

class RuntimeShouldNotBeCalled:
    def __init__(self):
        self.calls = 0

    def run_proposal(self, request):
        self.calls += 1
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "would have accepted valid output", "evidence_ids": ["comment:123"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None,
            },
        }

run_repository = InMemoryAgentRunRepository(runs={(2, 10)})

request_scope_audit = RecordingAuditRepository()
request_scope_runtime = RuntimeShouldNotBeCalled()
request_scope_service = CrewAIProposalService(
    runtime_adapter=request_scope_runtime,
    audit_repository=request_scope_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
request_scope_result = request_scope_service.create_proposal(10, {
    "projectId": 2,
    "stage": "strategy",
    "evidenceIds": ["comment:999"],
})
assert request_scope_result["ok"] is False, request_scope_result
assert request_scope_result["error_type"] == "crewai_evidence_rejected", request_scope_result
assert request_scope_result["proposalAuditId"] == "audit-1", request_scope_result
assert request_scope_runtime.calls == 0, request_scope_runtime.calls
assert request_scope_audit.records[0]["status"] == "rejected", request_scope_audit.records

wrong_scope_audit = RecordingAuditRepository()
wrong_scope = CrewAIProposalService(
    runtime_adapter=WrongScopeRuntime(),
    audit_repository=wrong_scope_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
wrong_scope_result = wrong_scope.create_proposal(10, {"projectId": 2, "stage": "strategy"})
assert wrong_scope_result["ok"] is False, wrong_scope_result
assert wrong_scope_result["error_type"] == "crewai_evidence_rejected", wrong_scope_result
assert wrong_scope_result["proposalAuditId"] == "audit-1", wrong_scope_result
assert wrong_scope_audit.records[0]["status"] == "rejected", wrong_scope_audit.records

missing_audit = RecordingAuditRepository()
missing_service = CrewAIProposalService(
    runtime_adapter=MissingEvidenceRuntime(),
    audit_repository=missing_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
missing_result = missing_service.create_proposal(10, {"projectId": 2, "stage": "strategy"})
assert missing_result["ok"] is False, missing_result
assert missing_result["error_type"] == "crewai_evidence_rejected", missing_result
assert missing_result["proposalAuditId"] == "audit-1", missing_result
assert missing_audit.records[0]["status"] == "rejected", missing_audit.records

cross_audit = RecordingAuditRepository()
cross_service = CrewAIProposalService(
    runtime_adapter=CrossProjectEvidenceRuntime(),
    audit_repository=cross_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
cross_result = cross_service.create_proposal(10, {"projectId": 2, "stage": "strategy"})
assert cross_result["ok"] is False, cross_result
assert cross_result["error_type"] == "crewai_evidence_rejected", cross_result
assert cross_result["proposalAuditId"] == "audit-1", cross_result
assert cross_audit.records[0]["status"] == "rejected", cross_audit.records

invalid_audit = RecordingAuditRepository()
invalid_service = CrewAIProposalService(
    runtime_adapter=InvalidAcceptedShapeRuntime(),
    audit_repository=invalid_audit,
    run_repository=run_repository,
    evidence_repository=EvidenceRepository(),
)
invalid_result = invalid_service.create_proposal(10, {"projectId": 2, "stage": "strategy"})
assert invalid_result["ok"] is False, invalid_result
assert invalid_result["error_type"] == "crewai_write_intent_not_allowed", invalid_result
assert invalid_result["proposalAuditId"] == "audit-1", invalid_result
assert invalid_audit.records[0]["status"] == "rejected", invalid_audit.records
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
