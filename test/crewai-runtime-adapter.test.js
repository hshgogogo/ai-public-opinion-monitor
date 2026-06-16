import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(".");
const pythonBin = resolve(repoRoot, process.env.PYTHON_BIN || ".venv/bin/python");
const fakeRuntimeModule = "test.fixtures.crewai_fake_runtime";

function basePythonEnv() {
  const env = { ...process.env };
  delete env.MYSQL_URL;
  delete env.DEEPSEEK_API_KEY;
  delete env.DEEPSEEK_API_URL;
  delete env.DEEPSEEK_MODEL;
  delete env.WEIBO_COOKIE_FILE;
  delete env.MEDIACRAWLER_HOME;
  delete env.MEDIACRAWLER_PYTHON;
  delete env.MEDIACRAWLER_OUTPUT_DIR;
  delete env.MEDIACRAWLER_CDP_PORT;
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
      "Python CrewAI runtime adapter assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("CrewAI runtime adapter accepts valid fake runtime output through the proposal validator", () => {
  runPython(`
import json
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec

runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="run")
adapter = CrewAIRuntimeAdapter(runtime=runtime)
request = {"project_id": 2, "agent_loop_run_id": 10, "stage": "strategy"}

result = adapter.run_proposal(request)

assert result["ok"] is True, result
assert result["proposal"]["write_intent"] == "proposal_only", result
assert result["proposal"]["project_id"] == 2, result
assert result["proposal"]["agent_loop_run_id"] == 10, result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["raw model output", "mysql://", ".env", "config/cookies/weibo.json"]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI runtime adapter supports callable fake runtimes through process-isolated specs", () => {
  runPython(`
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec

runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="callable_run")
result = CrewAIRuntimeAdapter(runtime=runtime).run_proposal({"project_id": 2, "agent_loop_run_id": 10})

assert result["ok"] is True, result
assert result["proposal"]["proposal_type"] == "report_note", result
`);
});

test("CrewAI runtime adapter rejects in-process object and callable runtimes", () => {
  runPython(`
import json
from app.crewai_runtime import CrewAIRuntimeAdapter

class InProcessRuntime:
    def run(self, request, tools):
        return {}

def callable_runtime(request, tools):
    return {}

for runtime in [InProcessRuntime(), callable_runtime]:
    result = CrewAIRuntimeAdapter(runtime=runtime).run_proposal({"project_id": 2, "agent_loop_run_id": 10})
    assert result["ok"] is False, result
    assert result["error_type"] == "crewai_runtime_failed", result
    serialized = json.dumps(result, ensure_ascii=False)
    for forbidden in ["traceback", ".env", "mysql://", "DEEPSEEK_API_KEY", "config/cookies/weibo.json"]:
        assert forbidden not in serialized, serialized
`);
});

test("CrewAI runtime adapter returns dependency unavailable on the default missing-runtime path", () => {
  runPython(`
import json
import app.crewai_runtime as runtime_module

runtime_module.load_crewai_runtime = lambda module_name="crewai": runtime_module.dependency_unavailable_error()

result = runtime_module.CrewAIRuntimeAdapter().run_proposal(
    {"project_id": 2, "agent_loop_run_id": 10}
)

assert result["ok"] is False, result
assert result["error_type"] == "crewai_dependency_unavailable", result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["traceback", ".env", "mysql://", "DEEPSEEK_API_KEY", "config/cookies/weibo.json"]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI runtime receives only a narrow tool facade without gateway internals", () => {
  runPython(`
import json
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec
from app.crewai_tools import HarnessToolGateway

class LeakyRepository:
    private_cookie_path = "config/cookies/weibo.json"
    database_url = "mysql://root:secret@localhost/weibo"

    def get_loop_context(self, *, project_id, run_id):
        return {
            "project_id": project_id,
            "run_id": run_id,
            "private_cookie_path": self.private_cookie_path,
            "database_url": self.database_url,
            "safe": "context",
        }

    def get_evidence_summary(self, *, project_id, evidence_ids):
        return {"project_id": project_id, "evidence": []}

    def search_knowledge_cards(self, *, project_id, query):
        return {"project_id": project_id, "cards": []}

gateway = HarnessToolGateway(repository=LeakyRepository())
runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="run")
result = CrewAIRuntimeAdapter(runtime=runtime, tool_gateway=gateway).run_proposal(
    {"project_id": 2, "agent_loop_run_id": 10, "stage": "strategy", "fixture_mode": "adversarial"}
)

assert result["ok"] is True, result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["config/cookies/weibo.json", "mysql://", "root:secret"]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI child runtime receives a scrubbed environment", () => {
  runPython(`
import json
import os
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec

os.environ["MYSQL_URL"] = "mysql://root:secret@localhost/weibo"
os.environ["DEEPSEEK_API_KEY"] = "sk-secret"
os.environ["WEIBO_COOKIE_FILE"] = "config/cookies/weibo.json"
os.environ["MEDIACRAWLER_HOME"] = "/tmp/mediacrawler"
os.environ["MEDIACRAWLER_CDP_PORT"] = "9222"

runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="run")
result = CrewAIRuntimeAdapter(runtime=runtime).run_proposal(
    {"project_id": 2, "agent_loop_run_id": 10, "stage": "strategy", "fixture_mode": "env_probe"}
)

assert result["ok"] is True, result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["mysql://", "sk-secret", "config/cookies/weibo.json", "MEDIACRAWLER_CDP_PORT"]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI runtime adapter converts runtime exceptions into sanitized stable errors", () => {
  runPython(`
import json
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec

runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="run")
result = CrewAIRuntimeAdapter(runtime=runtime).run_proposal(
    {"project_id": 2, "agent_loop_run_id": 10, "prompt": "hidden prompt", "fixture_mode": "exception"}
)

assert result["ok"] is False, result
assert result["error_type"] == "crewai_runtime_failed", result
assert isinstance(result["fix"], str) and result["fix"], result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in [
    "traceback",
    "prompt text",
    "hidden prompt",
    "DEEPSEEK_API_KEY",
    "sk-secret",
    "mysql://",
    "root:secret",
    "config/cookies/weibo.json",
    "worker stderr",
]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI runtime adapter converts timeout-like errors into the same stable runtime error", () => {
  runPython(`
import json
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec

runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="run")
result = CrewAIRuntimeAdapter(runtime=runtime).run_proposal(
    {"project_id": 2, "agent_loop_run_id": 10, "fixture_mode": "timeout"}
)

assert result["ok"] is False, result
assert result["error_type"] == "crewai_runtime_failed", result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["timeout while", "prompt text", "mysql://", "root:secret"]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI runtime adapter kills hung child runtimes with a stable runtime error", () => {
  runPython(`
import json
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec

runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="run", timeout_seconds=0.2)
result = CrewAIRuntimeAdapter(runtime=runtime).run_proposal(
    {"project_id": 2, "agent_loop_run_id": 10, "fixture_mode": "sleep"}
)

assert result["ok"] is False, result
assert result["error_type"] == "crewai_runtime_failed", result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["timeout while", "prompt text", "mysql://", "root:secret", "traceback"]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI runtime adapter returns proposal validator errors for malformed runtime output", () => {
  runPython(`
import json
from app.crewai_runtime import CrewAIRuntimeAdapter, PythonModuleRuntimeSpec

runtime = PythonModuleRuntimeSpec(module="${fakeRuntimeModule}", callable_name="run")
result = CrewAIRuntimeAdapter(runtime=runtime).run_proposal(
    {"project_id": 2, "agent_loop_run_id": 10, "fixture_mode": "malformed"}
)

assert result["ok"] is False, result
assert result["error_type"] == "crewai_invalid_proposal", result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in [
    "database_write",
    "RAW MODEL OUTPUT",
    "mysql://",
    "root:secret",
    "prompt text",
    "Cookie",
    "SUB=secret",
]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI optional dependency wrapper reports unavailable package without import-time crash", () => {
  runPython(`
import json
from app.crewai_runtime import crewai_dependency_status, load_crewai_runtime

missing_module = "__definitely_missing_crewai_runtime_package__"
status = crewai_dependency_status(module_name=missing_module)

assert status["ok"] is False, status
assert status["error_type"] == "crewai_dependency_unavailable", status
assert "install" in status["fix"].lower(), status

loaded = load_crewai_runtime(module_name=missing_module)
assert loaded["ok"] is False, loaded
assert loaded["error_type"] == "crewai_dependency_unavailable", loaded

serialized = json.dumps([status, loaded], ensure_ascii=False)
for forbidden in ["traceback", ".env", "mysql://", "DEEPSEEK_API_KEY", "config/cookies/weibo.json"]:
    assert forbidden not in serialized, serialized
`);
});
