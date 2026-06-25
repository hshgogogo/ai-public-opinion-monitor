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
      "Python CrewAI proposal validator assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("CrewAI proposal validator accepts a minimal proposal_only payload", () => {
  runPython(`
import json
from app.crewai_proposal import validate_crewai_proposal

payload = {
    "proposal_type": "strategy_action",
    "project_id": 2,
    "agent_loop_run_id": 10,
    "agent_name": "Strategy Agent",
    "stage": "strategy",
    "facts": [{"text": "Comment volume increased.", "evidence_ids": ["comment:123"]}],
    "inferences": [{"text": "The discussion is heating up.", "confidence": "medium", "evidence_ids": ["comment:123"]}],
    "recommendations": [{"text": "Prepare a measured reply.", "risk_notes": ["Avoid overclaiming."], "evidence_ids": ["event:7"]}],
    "write_intent": "proposal_only",
    "knowledge_card_ids": [5],
    "raw_model_output_ref": None
}

result = validate_crewai_proposal(json.dumps(payload))

assert result["ok"] is True, result
assert result["proposal"]["write_intent"] == "proposal_only", result
assert result["proposal"]["proposal_type"] == "strategy_action", result
assert result["proposal"]["facts"][0]["evidence_ids"] == ["comment:123"], result
`);
});

test("CrewAI proposal validator rejects direct write intent with a dedicated error", () => {
  runPython(`
import json
from app.crewai_proposal import validate_crewai_proposal

payload = {
    "proposal_type": "strategy_action",
    "project_id": 2,
    "agent_loop_run_id": 10,
    "agent_name": "Strategy Agent",
    "stage": "strategy",
    "facts": [{"text": "Comment volume increased.", "evidence_ids": ["comment:123"]}],
    "inferences": [],
    "recommendations": [],
    "write_intent": "write_memory",
    "knowledge_card_ids": [],
    "raw_model_output_ref": None
}

result = validate_crewai_proposal(payload)

assert result["ok"] is False, result
assert result["error_type"] == "crewai_write_intent_not_allowed", result
assert "proposal_only" in result["fix"], result
serialized = json.dumps(result, ensure_ascii=False)
assert "write_memory" not in serialized, serialized

payload["write_intent"] = "write_mysql://root:secret@localhost/db"
result = validate_crewai_proposal(payload)

assert result["ok"] is False, result
assert result["error_type"] == "crewai_write_intent_not_allowed", result
serialized = json.dumps(result, ensure_ascii=False)
for forbidden in ["write_mysql", "mysql://", "root:secret"]:
    assert forbidden not in serialized, serialized
`);
});

test("CrewAI proposal validator requires evidence IDs for factual proposal sections", () => {
  runPython(`
from app.crewai_proposal import validate_crewai_proposal

base = {
    "proposal_type": "strategy_action",
    "project_id": 2,
    "agent_loop_run_id": 10,
    "agent_name": "Strategy Agent",
    "stage": "strategy",
    "facts": [{"text": "Comment volume increased.", "evidence_ids": ["comment:123"]}],
    "inferences": [{"text": "The discussion is heating up.", "confidence": "high", "evidence_ids": ["comment:123"]}],
    "recommendations": [{"text": "Prepare a measured reply.", "risk_notes": [], "evidence_ids": ["event:7"]}],
    "write_intent": "proposal_only",
    "knowledge_card_ids": [5],
    "raw_model_output_ref": None
}

cases = [
    ("facts", [{"text": "Comment volume increased.", "evidence_ids": []}]),
    ("facts", [{"text": "Comment volume increased."}]),
    ("inferences", [{"text": "The discussion is heating up.", "confidence": "high", "evidence_ids": []}]),
    ("recommendations", [{"text": "Prepare a measured reply.", "risk_notes": [], "evidence_ids": []}]),
]

for section, value in cases:
    payload = dict(base)
    payload[section] = value
    result = validate_crewai_proposal(payload)
    assert result["ok"] is False, (section, result)
    assert result["error_type"] == "crewai_evidence_required", (section, result)
    serialized = str(result)
    assert "Comment volume increased" not in serialized, serialized
`);
});

test("CrewAI proposal validator returns stable schema errors for malformed public payloads", () => {
  runPython(`
import json
from app.crewai_proposal import validate_crewai_proposal

valid = {
    "proposal_type": "strategy_action",
    "project_id": 2,
    "agent_loop_run_id": 10,
    "agent_name": "Strategy Agent",
    "stage": "strategy",
    "facts": [{"text": "Comment volume increased.", "evidence_ids": ["comment:123"]}],
    "inferences": [{"text": "The discussion is heating up.", "confidence": "medium", "evidence_ids": ["comment:123"]}],
    "recommendations": [{"text": "Prepare a measured reply.", "risk_notes": ["Avoid overclaiming."], "evidence_ids": ["event:7"]}],
    "write_intent": "proposal_only",
    "knowledge_card_ids": [5],
    "raw_model_output_ref": None
}

cases = [
    "{not-json",
    {key: value for key, value in valid.items() if key != "proposal_type"},
    {**valid, "proposal_type": "database_write"},
    {**valid, "inferences": [{"text": "The discussion is heating up.", "confidence": "certain", "evidence_ids": ["comment:123"]}]},
    {**valid, "raw_model_output": "RAW MODEL OUTPUT: mysql://user:pass@localhost/db DEEPSEEK_API_KEY=secret"},
    {**valid, "raw_model_output_ref": "RAW MODEL OUTPUT: prompt text with Cookie SUB=secret"},
    {**valid, "submit_proposal": True},
    {**valid, "facts": [{"text": "Comment volume increased.", "evidence_ids": ["comment:123"], "api_key": "sk-secret", "prompt": "hidden prompt", "traceback": "stack", "worker_stderr": "stderr"}]},
]

for payload in cases:
    result = validate_crewai_proposal(payload)
    assert result["ok"] is False, result
    assert result["error_type"] == "crewai_invalid_proposal", result
    assert isinstance(result["fix"], str) and result["fix"], result
    serialized = json.dumps(result, ensure_ascii=False)
    for forbidden in [
        "RAW MODEL OUTPUT",
        "prompt text",
        "DEEPSEEK_API_KEY",
        "mysql://",
        "Cookie",
        "SUB=secret",
        "database_write",
        "certain",
        "submit_proposal",
        "api_key",
        "sk-secret",
        "hidden prompt",
        "traceback",
        "worker_stderr"
    ]:
        assert forbidden not in serialized, serialized
`);
});
