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
      "Python Bilibili collection step assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("BilibiliCollectionService records a sanitized succeeded Agent Loop step", () => {
  runPython(`
import json
from app.bilibili_collection_service import BilibiliCollectionService
from app.bilibili_persistence import BilibiliEvidenceWriter, InMemoryBilibiliRepository

class FakeAdapter:
    def collect(self, request):
        return {
            "ok": True,
            "platform": "bilibili",
            "status": "ok",
            "fixture_kind": "detail",
            "fixture_path": "test/fixtures/bilibili-detail.json",
            "artifact_ref": "artifacts/agent-reach/bilibili/detail-fixture.json",
            "stdout": "raw stdout must stay private",
            "stderr": "Traceback Cookie=SUB=secret token=secret mysql://root:secret@localhost/db",
            "summary": {
                "query": "海岛舒服日志",
                "stdout": "summary stdout must stay private",
                "raw_stdout": "summary raw stdout must stay private",
                "rawStderr": "raw worker stderr line",
                "cookie": "SUB=secret",
                "databaseUrl": "mysql://root:secret@localhost/db",
                "safeCount": 1
            }
        }

class FakeRecorder:
    def __init__(self):
        self.calls = []

    def record_step_run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "id": 101,
            "loop_run_id": kwargs["loop_run_id"],
            "project_id": kwargs["project_id"],
            "agent_name": kwargs["agent_name"],
            "step_name": kwargs["step_name"],
            "status": kwargs["status"],
            "output_json": kwargs["output_json"],
            "evidence_ids": kwargs["evidence_ids"],
            "error_type": kwargs["error_type"],
            "error_message": kwargs["error_message"],
        }

class FakeResolver:
    def __init__(self):
        self.calls = []

    def resolve_loop_run(self, project_id, loop_run_id):
        self.calls.append({"project_id": project_id, "loop_run_id": loop_run_id})
        return {"id": loop_run_id, "project_id": project_id}

recorder = FakeRecorder()
resolver = FakeResolver()
service = BilibiliCollectionService(
    adapter=FakeAdapter(),
    writer=BilibiliEvidenceWriter(InMemoryBilibiliRepository()),
    step_recorder=recorder,
    loop_run_resolver=resolver,
)

result = service.collect({"projectId": 2, "agentLoopRunId": 42, "query": "海岛舒服日志"})

assert result["ok"] is True, result
assert result["status"] == "succeeded", result
assert result["platform"] == "bilibili", result
assert result["project_id"] == 2, result
assert result["persist_counts"] == {
    "source_accounts": 4,
    "posts": 1,
    "comments": 3,
    "updated_posts": 1,
}, result
assert result["evidence_ids"] == [
    "bilibili:project:2:item:BV1HDLOG0001",
    "bilibili:project:2:comment:r9001",
    "bilibili:project:2:comment:r9002",
    "bilibili:project:2:comment:r9003",
    "bilibili:project:2:text:BV1HDLOG0001:transcript:zh-cn",
    "bilibili:project:2:text:BV1HDLOG0001:body",
], result
assert result["artifact_refs"] == ["artifacts/agent-reach/bilibili/detail-fixture.json"], result
assert resolver.calls == [{"project_id": 2, "loop_run_id": 42}], resolver.calls
assert len(recorder.calls) == 1, recorder.calls

call = recorder.calls[0]
assert call["loop_run_id"] == 42, call
assert call["project_id"] == 2, call
assert call["agent_name"] == "Bilibili Collection Agent", call
assert call["step_name"] == "bilibili_collection", call
assert call["status"] == "succeeded", call
assert call["error_type"] is None, call
assert call["error_message"] is None, call
assert call["evidence_ids"] == result["evidence_ids"], call
output = call["output_json"]
assert output["command"] == "bilibili_collection", output
assert output["status"] == "succeeded", output
assert output["platform"] == "bilibili", output
assert output["project_id"] == 2, output
assert output["normalized_counts"] == {"content_items": 1, "evidence_summaries": 6}, output
assert output["persist_counts"] == result["persist_counts"], output
assert output["evidence_ids"] == result["evidence_ids"], output
assert output["artifact_refs"] == result["artifact_refs"], output
assert output["adapter_summary"] == {"query": "海岛舒服日志", "safeCount": 1}, output
assert result["agentStepRun"]["status"] == "succeeded", result

serialized = json.dumps({"result": result, "call": call}, ensure_ascii=False).lower()
for forbidden in [
    "raw stdout",
    "summary stdout",
    "summary raw stdout",
    "stderr",
    "traceback",
    "cookie",
    "sub=secret",
    "token",
    "mysql://",
    "databaseurl",
    ".env",
    "config/cookies",
    "raw worker stderr"
]:
    assert forbidden not in serialized, serialized
`);
});

test("BilibiliCollectionService returns standalone results unless exact agentLoopRunId is present", () => {
  runPython(`
from app.bilibili_collection_service import BilibiliCollectionService

class FakeAdapter:
    def collect(self, request):
        return {"ok": True, "platform": "bilibili", "status": "ok", "artifact_ref": "artifacts/agent-reach/bilibili/empty.json"}

class FakeNormalizer:
    def normalize_adapter_result(self, adapter_result, request):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": request["project_id"],
            "raw_artifact_ref": adapter_result["artifact_ref"],
            "content_items": [{"external_id": "BVSTANDALONE", "evidence_ids": ["bilibili:project:7:item:BVSTANDALONE"]}],
            "evidence_summaries": [{"id": "bilibili:project:7:item:BVSTANDALONE"}],
        }

class FakeWriter:
    def persist(self, payload):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": payload["project_id"],
            "persisted_source_accounts": 0,
            "persisted_posts": 1,
            "persisted_comments": 0,
            "updated_posts": 1,
            "evidence_ids": ["bilibili:project:7:item:BVSTANDALONE"],
        }

class FakeRecorder:
    def __init__(self):
        self.calls = []
    def record_step_run(self, **kwargs):
        self.calls.append(kwargs)
        return kwargs

class FakeResolver:
    def __init__(self):
        self.calls = []
    def resolve_loop_run(self, project_id, loop_run_id):
        self.calls.append({"project_id": project_id, "loop_run_id": loop_run_id})
        return {"id": loop_run_id, "project_id": project_id}

recorder = FakeRecorder()
resolver = FakeResolver()
service = BilibiliCollectionService(FakeAdapter(), FakeNormalizer(), FakeWriter(), recorder, loop_run_resolver=resolver)

for payload in [
    {"projectId": 7},
    {"projectId": 7, "loopRunId": 42},
    {"projectId": 7, "agent_loop_run_id": 42},
]:
    result = service.collect(payload)
    assert result["ok"] is True, result
    assert result["status"] == "succeeded", result
    assert "agentStepRun" not in result, result

assert recorder.calls == [], recorder.calls
assert resolver.calls == [], resolver.calls

recorded = service.collect({"projectId": 7, "agentLoopRunId": 42})
assert recorded["agentStepRun"]["loop_run_id"] == 42, recorded
assert len(recorder.calls) == 1, recorder.calls
assert resolver.calls == [{"project_id": 7, "loop_run_id": 42}], resolver.calls
`);
});

test("BilibiliCollectionService does not pass caller command to run-only adapters", () => {
  runPython(`
from app.bilibili_collection_service import BilibiliCollectionService

class RunOnlyAdapter:
    def __init__(self):
        self.calls = []
    def run(self, platform, command, request):
        self.calls.append({"platform": platform, "command": command, "payload_command": request["payload"].get("command")})
        return {"ok": True, "platform": "bilibili", "status": "ok", "artifact_ref": "artifacts/agent-reach/bilibili/run-only.json"}

class FakeNormalizer:
    def normalize_adapter_result(self, adapter_result, request):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": request["project_id"],
            "raw_artifact_ref": adapter_result["artifact_ref"],
            "content_items": [{"external_id": "BVRUNONLY", "evidence_ids": ["bilibili:project:2:item:BVRUNONLY"]}],
            "evidence_summaries": [{"id": "bilibili:project:2:item:BVRUNONLY"}],
        }

class FakeWriter:
    def persist(self, payload):
        return {
            "ok": True,
            "persisted_source_accounts": 0,
            "persisted_posts": 1,
            "persisted_comments": 0,
            "updated_posts": 1,
            "evidence_ids": ["bilibili:project:2:item:BVRUNONLY"],
        }

adapter = RunOnlyAdapter()
service = BilibiliCollectionService(adapter, FakeNormalizer(), FakeWriter())
result = service.collect({"projectId": 2, "command": "delete-all-runner-state"})

assert result["ok"] is True, result
assert result["status"] == "succeeded", result
assert adapter.calls == [{"platform": "bilibili", "command": "collect", "payload_command": None}], adapter.calls
`);
});

test("BilibiliCollectionService requires verified Agent Loop ownership before recording", () => {
  runPython(`
from app.bilibili_collection_service import BilibiliCollectionService

class FakeAdapter:
    def collect(self, request):
        return {"ok": True, "platform": "bilibili", "status": "ok", "artifact_ref": "artifacts/agent-reach/bilibili/ownership.json"}

class FakeNormalizer:
    def normalize_adapter_result(self, adapter_result, request):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": request["project_id"],
            "raw_artifact_ref": adapter_result["artifact_ref"],
            "content_items": [{"external_id": "BVOWNER", "evidence_ids": ["bilibili:project:2:item:BVOWNER"]}],
            "evidence_summaries": [{"id": "bilibili:project:2:item:BVOWNER"}],
        }

class FakeWriter:
    def persist(self, payload):
        return {
            "ok": True,
            "persisted_source_accounts": 0,
            "persisted_posts": 1,
            "persisted_comments": 0,
            "updated_posts": 1,
            "evidence_ids": ["bilibili:project:2:item:BVOWNER"],
        }

class FakeRecorder:
    def __init__(self):
        self.calls = []
    def record_step_run(self, **kwargs):
        self.calls.append(kwargs)
        return kwargs

class Resolver:
    def __init__(self, row):
        self.row = row
        self.calls = []
    def resolve_loop_run(self, project_id, loop_run_id):
        self.calls.append({"project_id": project_id, "loop_run_id": loop_run_id})
        return self.row

def make_service(recorder, resolver=None):
    return BilibiliCollectionService(FakeAdapter(), FakeNormalizer(), FakeWriter(), recorder, loop_run_resolver=resolver)

recorder = FakeRecorder()
no_resolver = make_service(recorder).collect({"projectId": 2, "agentLoopRunId": 42})
assert no_resolver["ok"] is True, no_resolver
assert no_resolver["status"] == "succeeded", no_resolver
assert "agentStepRun" not in no_resolver, no_resolver
assert no_resolver["agentStepError"]["error_type"] == "bilibili_agent_loop_run_unverified", no_resolver
assert recorder.calls == [], recorder.calls

missing_resolver = Resolver(None)
missing = make_service(recorder, missing_resolver).collect({"projectId": 2, "agentLoopRunId": 42})
assert missing["ok"] is True, missing
assert "agentStepRun" not in missing, missing
assert missing["agentStepError"]["error_type"] == "bilibili_agent_loop_run_not_found", missing
assert missing_resolver.calls == [{"project_id": 2, "loop_run_id": 42}], missing_resolver.calls
assert recorder.calls == [], recorder.calls

cross_project_resolver = Resolver({"id": 42, "project_id": 99})
cross_project = make_service(recorder, cross_project_resolver).collect({"projectId": 2, "agentLoopRunId": 42})
assert cross_project["ok"] is True, cross_project
assert "agentStepRun" not in cross_project, cross_project
assert cross_project["agentStepError"]["error_type"] == "bilibili_agent_loop_project_mismatch", cross_project
assert cross_project_resolver.calls == [{"project_id": 2, "loop_run_id": 42}], cross_project_resolver.calls
assert recorder.calls == [], recorder.calls
`);
});

test("BilibiliCollectionService does not attach Agent Loop steps when projectId is invalid", () => {
  runPython(`
from app.bilibili_collection_service import BilibiliCollectionService

class FakeAdapter:
    def __init__(self):
        self.calls = []
    def collect(self, request):
        self.calls.append(request)
        raise AssertionError("adapter must not execute without a valid project")

class FakeRecorder:
    def __init__(self):
        self.calls = []
    def record_step_run(self, **kwargs):
        self.calls.append(kwargs)
        raise AssertionError("recorder must not execute without a valid project")

adapter = FakeAdapter()
recorder = FakeRecorder()
service = BilibiliCollectionService(adapter=adapter, step_recorder=recorder)

for payload in [
    {"projectId": 0, "agentLoopRunId": 42},
    {"agentLoopRunId": 42},
]:
    result = service.collect(payload)
    assert result["ok"] is False, result
    assert result["status"] == "failed", result
    assert result["error_type"] == "invalid_project_id", result
    assert "agentStepRun" not in result, result
    assert "agentStepError" not in result, result

assert adapter.calls == [], adapter.calls
assert recorder.calls == [], recorder.calls
`);
});

test("BilibiliCollectionService maps no data and nonfatal writer failures to partial", () => {
  runPython(`
from app.bilibili_collection_service import BilibiliCollectionService

class FakeAdapter:
    def collect(self, request):
        return {"ok": True, "platform": "bilibili", "status": "ok", "artifact_ref": "artifacts/agent-reach/bilibili/partial.json"}

class EmptyNormalizer:
    def normalize_adapter_result(self, adapter_result, request):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": request["project_id"],
            "raw_artifact_ref": adapter_result["artifact_ref"],
            "content_items": [],
            "evidence_summaries": [],
        }

class EmptyWriter:
    def persist(self, payload):
        raise AssertionError("writer must not persist empty normalized payloads")

no_data = BilibiliCollectionService(FakeAdapter(), EmptyNormalizer(), EmptyWriter()).collect({"projectId": 2})
assert no_data["ok"] is True, no_data
assert no_data["status"] == "partial", no_data
assert no_data["error_type"] == "bilibili_no_persistable_evidence", no_data
assert no_data["evidence_ids"] == [], no_data

class OneEvidenceNormalizer:
    def normalize_adapter_result(self, adapter_result, request):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": request["project_id"],
            "raw_artifact_ref": adapter_result["artifact_ref"],
            "content_items": [{"external_id": "BVPARTIAL", "evidence_ids": ["bilibili:project:2:item:BVPARTIAL"]}],
            "evidence_summaries": [{"id": "bilibili:project:2:item:BVPARTIAL"}],
        }

class NonFatalWriter:
    def persist(self, payload):
        return {
            "ok": False,
            "fatal": False,
            "error_type": "bilibili_writer_retryable",
            "message": "The fixture writer skipped one duplicate row.",
            "fix": "Retry persistence after checking duplicate evidence.",
            "evidence_ids": ["bilibili:project:2:item:BVPARTIAL"],
            "persisted_posts": 0,
            "persisted_comments": 0,
            "persisted_source_accounts": 0,
        }

writer_partial = BilibiliCollectionService(FakeAdapter(), OneEvidenceNormalizer(), NonFatalWriter()).collect({"projectId": 2})
assert writer_partial["ok"] is True, writer_partial
assert writer_partial["status"] == "partial", writer_partial
assert writer_partial["error_type"] == "bilibili_persistence_partial", writer_partial
assert "The fixture writer skipped one duplicate row." in writer_partial["message"], writer_partial
assert writer_partial["evidence_ids"] == ["bilibili:project:2:item:BVPARTIAL"], writer_partial

class SourceAccountOnlyWriter:
    def persist(self, payload):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": payload["project_id"],
            "persisted_source_accounts": 1,
            "persisted_posts": 0,
            "persisted_comments": 0,
            "updated_posts": 0,
            "evidence_ids": ["bilibili:project:2:item:BVPARTIAL"],
        }

source_only = BilibiliCollectionService(FakeAdapter(), OneEvidenceNormalizer(), SourceAccountOnlyWriter()).collect({"projectId": 2})
assert source_only["ok"] is True, source_only
assert source_only["status"] == "partial", source_only
assert source_only["error_type"] == "bilibili_persistence_partial", source_only
assert source_only["persist_counts"] == {
    "source_accounts": 1,
    "posts": 0,
    "comments": 0,
    "updated_posts": 0,
}, source_only
`);
});

test("BilibiliCollectionService maps adapter, normalizer, and writer hard failures to failed", () => {
  runPython(`
from app.bilibili_collection_service import BilibiliCollectionService

class GoodAdapter:
    def collect(self, request):
        return {"ok": True, "platform": "bilibili", "status": "ok", "artifact_ref": "artifacts/agent-reach/bilibili/hard-failure.json"}

class GoodNormalizer:
    def normalize_adapter_result(self, adapter_result, request):
        return {
            "ok": True,
            "platform": "bilibili",
            "project_id": request["project_id"],
            "raw_artifact_ref": adapter_result["artifact_ref"],
            "content_items": [{"external_id": "BVFAIL", "evidence_ids": ["bilibili:project:2:item:BVFAIL"]}],
            "evidence_summaries": [{"id": "bilibili:project:2:item:BVFAIL"}],
        }

class GoodWriter:
    def persist(self, payload):
        return {"ok": True, "persisted_posts": 1, "persisted_comments": 0, "persisted_source_accounts": 0, "updated_posts": 1, "evidence_ids": ["bilibili:project:2:item:BVFAIL"]}

class AdapterReturnsFailure:
    def collect(self, request):
        return {"ok": False, "error_type": "agent_reach_runner_failed", "message": "runner failed", "fix": "Inspect private runner logs."}

class NormalizerRaises:
    def normalize_adapter_result(self, adapter_result, request):
        raise ValueError("bad fixture shape")

class WriterRaises:
    def persist(self, payload):
        raise RuntimeError("db unavailable")

class WriterFatalResult:
    def persist(self, payload):
        return {"ok": False, "fatal": True, "error_type": "unsafe_bilibili_payload", "message": "unsafe payload", "fix": "Remove sensitive fields."}

cases = [
    (BilibiliCollectionService(AdapterReturnsFailure(), GoodNormalizer(), GoodWriter()), "bilibili_adapter_failed"),
    (BilibiliCollectionService(GoodAdapter(), NormalizerRaises(), GoodWriter()), "bilibili_normalization_failed"),
    (BilibiliCollectionService(GoodAdapter(), GoodNormalizer(), WriterRaises()), "bilibili_persistence_failed"),
    (BilibiliCollectionService(GoodAdapter(), GoodNormalizer(), WriterFatalResult()), "bilibili_persistence_failed"),
]

for service, expected_error in cases:
    result = service.collect({"projectId": 2})
    assert result["ok"] is False, result
    assert result["status"] == "failed", result
    assert result["error_type"] == expected_error, result
    assert result["message"], result
    assert result["fix"], result
`);
});
