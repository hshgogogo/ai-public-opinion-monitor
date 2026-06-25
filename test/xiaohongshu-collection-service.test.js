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
      "Python XiaohongshuCollectionService assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("XiaohongshuCollectionService fails closed without a safe local login provider and does not execute runner", () => {
  runPython(`
import json
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

calls = []

def fake_runner(request):
    calls.append(request)
    raise AssertionError("runner must not execute without private login state")

service = XiaohongshuCollectionService(runner=fake_runner)
payload = service.collect({"project_id": 2, "query": "海岛舒服"})

assert calls == [], calls
assert payload["ok"] is False, payload
assert payload["platform"] == "xiaohongshu", payload
assert payload["status"] == "failed", payload
assert payload["error_type"] == "platform_auth_required", payload
assert "content_items" not in payload, payload
assert "evidence_summaries" not in payload, payload

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in ["cookie", "token", "storagestate", "browserstate", "content_items", "evidence_summaries"]:
    assert forbidden not in serialized, serialized
`);
});

test("XiaohongshuCollectionService treats public credential-looking fields as untrusted and keeps them out of runner and result", () => {
  runPython(`
import json
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

calls = []

def fake_runner(request):
    calls.append(request)
    raise AssertionError("runner must not execute from public fake credentials")

service = XiaohongshuCollectionService(runner=fake_runner)
payload = service.collect({
    "project_id": 2,
    "query": "海岛舒服",
    "command": "use-my-public-command",
    "cookie": "a1=public-cookie-secret",
    "token": "public-token-secret",
    "storageState": {"cookies": ["secret"]},
    "browserState": "logged-in-browser-state"
})

assert calls == [], calls
assert payload["ok"] is False, payload
assert payload["status"] == "failed", payload
assert payload["error_type"] == "platform_auth_required", payload

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    "public-cookie-secret",
    "public-token-secret",
    "logged-in-browser-state",
    "storagestate",
    "browserstate",
    "use-my-public-command",
    "cookie",
    "token"
]:
    assert forbidden not in serialized, serialized
`);
});

test("XiaohongshuCollectionService passes injected private login state only to the controlled runner", () => {
  runPython(`
import json
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

calls = []
private_login_state = {
    "storage_state_ref": "private/local/xhs-storage-state.json",
    "session_token": "private-session-token"
}

def login_provider():
    return private_login_state

def fake_runner(request):
    calls.append(request)
    assert request["platform"] == "xiaohongshu", request
    assert request["command"] == "xiaohongshu_collect", request
    assert request["private"]["login_state"] is private_login_state, request
    assert "login_state" not in request["payload"], request
    return {
        "status": "ok",
        "artifact_ref": "artifacts/agent-reach/xiaohongshu/collection-1.json",
        "content_items": [
            {
                "platform": "xiaohongshu",
                "project_id": 2,
                "external_id": "xhs-note-1",
                "title": "海岛舒服口碑",
                "text": "安全公开正文",
                "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/collection-1.json",
                "evidence_ids": ["xiaohongshu:project:2:item:xhs-note-1"],
                "cookie": "runner-cookie-leak"
            }
        ],
        "evidence_summaries": [
            {
                "id": "xiaohongshu:project:2:item:xhs-note-1",
                "platform": "xiaohongshu",
                "project_id": 2,
                "source_type": "note",
                "external_id": "xhs-note-1",
                "summary": "安全公开摘要",
                "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/collection-1.json",
                "token": "runner-token-leak"
            }
        ],
        "summary": {
            "content_count": 1,
            "evidence_count": 1,
            "cookie": "summary-cookie-leak",
            "token": "summary-token-leak",
            "raw_stderr": "summary raw stderr leak"
        },
        "stdout": "Cookie=stdout-cookie token=stdout-token",
        "stderr": "storageState stderr leak"
    }

service = XiaohongshuCollectionService(
    runner=fake_runner,
    login_state_provider=login_provider
)
payload = service.collect({"project_id": 2, "query": "海岛舒服", "limit": 10})

assert len(calls) == 1, calls
assert payload["ok"] is True, payload
assert payload["platform"] == "xiaohongshu", payload
assert payload["status"] == "ok", payload
assert payload["command"] == "xiaohongshu_collect", payload
assert payload["artifact_ref"] == "artifacts/agent-reach/xiaohongshu/collection-1.json", payload
assert payload["summary"] == {"content_count": 1, "evidence_count": 1}, payload
assert payload["content_items"] == [
    {
        "platform": "xiaohongshu",
        "project_id": 2,
        "external_id": "xhs-note-1",
        "title": "海岛舒服口碑",
        "text": "安全公开正文",
        "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/collection-1.json",
        "evidence_ids": ["xiaohongshu:project:2:item:xhs-note-1"],
    }
], payload
assert payload["evidence_summaries"] == [
    {
        "id": "xiaohongshu:project:2:item:xhs-note-1",
        "platform": "xiaohongshu",
        "project_id": 2,
        "source_type": "note",
        "external_id": "xhs-note-1",
        "summary": "安全公开摘要",
        "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/collection-1.json",
    }
], payload

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    "private-session-token",
    "private/local/xhs-storage-state.json",
    "runner-cookie-leak",
    "runner-token-leak",
    "summary-cookie-leak",
    "summary-token-leak",
    "stdout-cookie",
    "stdout-token",
    "stderr leak",
    "storagestate",
    "cookie",
    "token",
    "raw_stderr",
    "stdout",
    "stderr"
]:
    assert forbidden not in serialized, serialized
`);
});

test("XiaohongshuCollectionService ignores caller command and sends a service-owned request", () => {
  runPython(`
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

calls = []

def fake_runner(request):
    calls.append(request)
    return {
        "status": "ok",
        "artifact_ref": "artifacts/agent-reach/xiaohongshu/collection-2.json",
        "summary": {"content_count": 0, "evidence_count": 0},
        "content_items": [],
        "evidence_summaries": []
    }

service = XiaohongshuCollectionService(
    runner=fake_runner,
    login_state_provider=lambda: {"storage_state_ref": "private/xhs.json"}
)
payload = service.collect({
    "project_id": 2,
    "query": "海岛舒服",
    "command": "rm -rf /tmp/should-not-pass-through"
})

assert calls[0]["command"] == "xiaohongshu_collect", calls
assert "command" not in calls[0]["payload"], calls
assert payload["command"] == "xiaohongshu_collect", payload
assert payload["ok"] is True, payload
assert payload["summary"] == {"content_count": 0, "evidence_count": 0}, payload
`);
});

test("XiaohongshuCollectionService failure output is built from whitelisted fields only", () => {
  runPython(`
import json
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

def fake_runner(request):
    return {
        "status": "failed",
        "artifact_ref": "artifacts/agent-reach/xiaohongshu/failure-1.json",
        "error_type": "upstream_auth_expired",
        "message": "runner message with token=secret",
        "summary": {
            "content_count": 99,
            "evidence_count": 88,
            "warnings": ["safe warning", "Cookie=summary-cookie"],
            "unexpected": "must not be copied"
        },
        "step_output": {"cookie": "step-cookie"},
        "log_output": "token=log-token",
        "stdout": "Cookie=stdout-cookie",
        "stderr": "token=stderr-token"
    }

service = XiaohongshuCollectionService(
    runner=fake_runner,
    login_state_provider=lambda: {"storage_state_ref": "private/xhs.json"}
)
payload = service.collect({"project_id": 2, "query": "海岛舒服"})

assert payload["ok"] is False, payload
assert payload["platform"] == "xiaohongshu", payload
assert payload["status"] == "failed", payload
assert payload["error_type"] == "upstream_auth_expired", payload
assert payload["artifact_ref"] == "artifacts/agent-reach/xiaohongshu/failure-1.json", payload
assert payload["summary"] == {"content_count": 99, "evidence_count": 88, "warnings": ["safe warning"]}, payload
assert set(payload.keys()) == {
    "ok",
    "platform",
    "command",
    "status",
    "error_type",
    "message",
    "artifact_ref",
    "summary"
}, payload

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    "token=secret",
    "summary-cookie",
    "unexpected",
    "step-cookie",
    "log-token",
    "stdout-cookie",
    "stderr-token",
    "step_output",
    "log_output",
    "stdout",
    "stderr",
    "cookie",
    "token"
]:
    assert forbidden not in serialized, serialized
`);
});

test("XiaohongshuCollectionService rejects unsafe Xiaohongshu artifact refs from runner output", () => {
  runPython(`
import json
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

def fake_runner(request):
    return {
        "status": "ok",
        "artifact_ref": "artifacts/agent-reach/xiaohongshu/raw_stdout_collector_transcript.json",
        "summary": {"content_count": 1, "evidence_count": 1},
        "content_items": [
            {
                "platform": "xiaohongshu",
                "project_id": 2,
                "external_id": "xhs-note-unsafe-artifact",
                "title": "安全 artifact 回归",
                "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/raw-stdout-collector-transcript.json",
                "evidence_ids": ["xiaohongshu:project:2:item:xhs-note-unsafe-artifact"]
            }
        ],
        "evidence_summaries": [
            {
                "id": "xiaohongshu:project:2:item:xhs-note-unsafe-artifact",
                "platform": "xiaohongshu",
                "project_id": 2,
                "source_type": "note",
                "external_id": "xhs-note-unsafe-artifact",
                "summary": "安全 artifact 回归",
                "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/raw-stdout-collector-transcript.json"
            }
        ]
    }

payload = XiaohongshuCollectionService(
    runner=fake_runner,
    login_state_provider=lambda: {"storage_state_ref": "private/xhs.json"}
).collect({"project_id": 2, "query": "海岛舒服"})

assert payload["ok"] is True, payload
assert "artifact_ref" not in payload, payload
assert "raw_artifact_ref" not in payload["content_items"][0], payload
assert "raw_artifact_ref" not in payload["evidence_summaries"][0], payload

serialized = json.dumps(payload, ensure_ascii=False).lower()
compact = "".join(ch for ch in serialized if ch.isalnum())
for forbidden in [
    "rawstdout",
    "collectortranscript",
    "raw_stdout_collector_transcript",
    "raw-stdout-collector-transcript"
]:
    assert forbidden not in compact
    assert forbidden not in serialized
`);
});

test("XiaohongshuCollectionService does not pass caller-controlled unsafe artifact refs to runner", () => {
  runPython(`
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

calls = []

def fake_runner(request):
    calls.append(request)
    return {
        "status": "ok",
        "artifact_ref": "artifacts/agent-reach/xiaohongshu/search-safe.json",
        "summary": {"content_count": 0, "evidence_count": 0},
        "content_items": [],
        "evidence_summaries": []
    }

service = XiaohongshuCollectionService(
    runner=fake_runner,
    login_state_provider=lambda: {"storage_state_ref": "private/xhs.json"}
)

unsafe_refs = [
    "artifacts/agent-reach/xiaohongshu/raw_stdout_collector_transcript.json",
    "artifacts/agent-reach/xiaohongshu/raw-stdout-collector-transcript.json",
    "/tmp/artifacts/agent-reach/xiaohongshu/search-safe.json",
    "artifacts/agent-reach/xiaohongshu/../search-safe.json",
    r"artifacts\\agent-reach\\xiaohongshu\\search-safe.json",
    "artifacts/agent-reach/xiaohongshu/search-safe.json:ads",
    "artifacts/agent-reach/bilibili/search-safe.json"
]

for unsafe_ref in unsafe_refs:
    payload = service.collect({
        "project_id": 2,
        "query": "海岛舒服",
        "raw_artifact_ref": unsafe_ref
    })
    assert payload["ok"] is True, payload

assert len(calls) == len(unsafe_refs), calls
for call in calls:
    assert "raw_artifact_ref" not in call["payload"], call
`);
});

test("XiaohongshuCollectionService keeps safe Xiaohongshu artifact refs", () => {
  runPython(`
from app.xiaohongshu_collection_service import XiaohongshuCollectionService

calls = []

def fake_runner(request):
    calls.append(request)
    return {
        "status": "ok",
        "artifact_ref": "artifacts/agent-reach/xiaohongshu/search-safe.json",
        "summary": {"content_count": 1, "evidence_count": 1},
        "content_items": [
            {
                "platform": "xiaohongshu",
                "project_id": 2,
                "external_id": "xhs-note-safe-artifact",
                "title": "安全 artifact 保留",
                "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/search-safe.json",
                "evidence_ids": ["xiaohongshu:project:2:item:xhs-note-safe-artifact"]
            }
        ],
        "evidence_summaries": [
            {
                "id": "xiaohongshu:project:2:item:xhs-note-safe-artifact",
                "platform": "xiaohongshu",
                "project_id": 2,
                "source_type": "note",
                "external_id": "xhs-note-safe-artifact",
                "summary": "安全 artifact 保留",
                "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/search-safe.json"
            }
        ]
    }

payload = XiaohongshuCollectionService(
    runner=fake_runner,
    login_state_provider=lambda: {"storage_state_ref": "private/xhs.json"}
).collect({
    "project_id": 2,
    "query": "海岛舒服",
    "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/search-safe.json"
})

safe_ref = "artifacts/agent-reach/xiaohongshu/search-safe.json"
assert calls[0]["payload"]["raw_artifact_ref"] == safe_ref, calls
assert payload["artifact_ref"] == safe_ref, payload
assert payload["content_items"][0]["raw_artifact_ref"] == safe_ref, payload
assert payload["evidence_summaries"][0]["raw_artifact_ref"] == safe_ref, payload
`);
});
