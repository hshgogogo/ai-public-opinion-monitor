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
      "Python CrewAI tool gateway assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("Harness tool gateway allows only scoped read tools from the explicit registry", () => {
  runPython(`
import json
from app.crewai_tools import HarnessToolGateway

class FakeRepository:
    def __init__(self):
        self.calls = []

    def get_loop_context(self, *, project_id, run_id):
        self.calls.append(("get_loop_context", project_id, run_id))
        return {"project_id": project_id, "run_id": run_id, "stage": "strategy"}

    def get_evidence_summary(self, *, project_id, evidence_ids):
        self.calls.append(("get_evidence_summary", project_id, tuple(evidence_ids)))
        return {"evidence": [{"id": evidence_ids[0], "project_id": project_id, "summary": "safe"}]}

    def search_knowledge_cards(self, *, project_id, query):
        self.calls.append(("search_knowledge_cards", project_id, query))
        return {"cards": [{"id": 5, "title": "Tone guidance", "project_id": project_id}]}

repository = FakeRepository()
gateway = HarnessToolGateway(repository=repository)

loop_context = gateway.call_tool("get_loop_context", {"project_id": 2, "run_id": 10})
evidence = gateway.call_tool("get_evidence_summary", {"project_id": 2, "evidence_ids": ["comment:123"]})
cards = gateway.call_tool("search_knowledge_cards", {"project_id": 2, "query": "reply tone"})

for result, tool in [
    (loop_context, "get_loop_context"),
    (evidence, "get_evidence_summary"),
    (cards, "search_knowledge_cards"),
]:
    assert result["ok"] is True, result
    assert result["tool"] == tool, result
    assert "result" in result, result

assert repository.calls == [
    ("get_loop_context", 2, 10),
    ("get_evidence_summary", 2, ("comment:123",)),
    ("search_knowledge_cards", 2, "reply tone"),
], repository.calls

serialized = json.dumps([loop_context, evidence, cards], ensure_ascii=False)
assert "MYSQL_URL" not in serialized, serialized
assert ".env" not in serialized, serialized
assert "config/cookies/weibo.json" not in serialized, serialized
`);
});

test("Harness tool gateway rejects non-allowlisted submit and recorder tools", () => {
  runPython(`
import json
from app.crewai_tools import HarnessToolGateway

class FakeRepository:
    def get_loop_context(self, *, project_id, run_id):
        return {"project_id": project_id, "run_id": run_id}

gateway = HarnessToolGateway(repository=FakeRepository())

for tool_name in [
    "unknown_tool",
    "submit_proposal",
    "record_proposal",
    "proposal_recorder",
    "proposal_recorder.create",
    "open",
    "read_file",
]:
    result = gateway.call_tool(tool_name, {"project_id": 2, "run_id": 10})
    assert result["ok"] is False, (tool_name, result)
    assert result["error_type"] == "crewai_tool_not_allowed", (tool_name, result)
    serialized = json.dumps(result, ensure_ascii=False)
    assert tool_name not in serialized, serialized
    assert "proposal" not in serialized.lower(), serialized
`);
});

test("Harness tool gateway rejects dangerous tool payloads without echoing them", () => {
  runPython(`
import json
from app.crewai_tools import HarnessToolGateway

class FakeRepository:
    def get_loop_context(self, *, project_id, run_id):
        return {"project_id": project_id, "run_id": run_id}

gateway = HarnessToolGateway(repository=FakeRepository())

dangerous_payloads = [
    {"project_id": 2, "run_id": 10, "env_file": ".env"},
    {"project_id": 2, "run_id": 10, "cookie_path": "config/cookies/weibo.json"},
    {"project_id": 2, "run_id": 10, "db": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "browser_state": {"storage_state": "session"}},
    {"project_id": 2, "run_id": 10, "browserState": {"storageState": "session"}},
    {"project_id": 2, "run_id": 10, "apiKey": "sk-secret"},
    {"project_id": 2, "run_id": 10, "APIKEY": "sk-secret"},
    {"project_id": 2, "run_id": 10, "rawModelOutput": "hidden prompt"},
    {"project_id": 2, "run_id": 10, "DATABASE_URL": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "databaseUrl": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "mysqlUrl": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "MYSQLURL": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "MySQLUrl": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "dbUrl": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "DBUrl": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "DBURL": "mysql://root:secret@127.0.0.1/weibo"},
    {"project_id": 2, "run_id": 10, "path": "/Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor/.env"},
    {"project_id": 2, "run_id": 10, "path": "file:///Users/mini-002/Desktop/yuqingjiance/.env"},
    {"project_id": 2, "run_id": 10, "path": "C:\\\\Users\\\\mini-002\\\\Desktop\\\\secret.env"},
    {"project_id": 2, "run_id": 10, "path": "~/.env"},
    {"project_id": 2, "run_id": 10, "notes": ["read /tmp/secrets.txt"]},
]

for payload in dangerous_payloads:
    result = gateway.call_tool("get_loop_context", payload)
    assert result["ok"] is False, result
    assert result["error_type"] == "crewai_tool_payload_rejected", result
    serialized = json.dumps(result, ensure_ascii=False)
    for forbidden in [
        ".env",
        "config/cookies/weibo.json",
        "mysql://",
        "root:secret",
        "browser_state",
        "storage_state",
        "browserState",
        "storageState",
        "apiKey",
        "APIKEY",
        "rawModelOutput",
        "DATABASE_URL",
        "databaseUrl",
        "mysqlUrl",
        "MYSQLURL",
        "MySQLUrl",
        "dbUrl",
        "DBUrl",
        "DBURL",
        "/Users/mini-002",
        "file://",
        "C:\\\\Users",
        "~/.env",
        "/tmp/secrets.txt",
    ]:
        assert forbidden not in serialized, serialized
`);
});

test("Harness tool gateway sanitizes secret-like repository output before public return", () => {
  runPython(`
import json
from app.crewai_tools import HarnessToolGateway

class FakeRepository:
    def get_loop_context(self, *, project_id, run_id):
        return {
            "project_id": project_id,
            "run_id": run_id,
            "api_key": "sk-secret",
            "nested": {
                "token": "bearer hidden-token",
                "safe": "keep me",
                "db_url": "mysql://root:secret@localhost/weibo",
                "databaseUrl": "mysql://root:secret@localhost/weibo",
                "MYSQLURL": "mysql://root:secret@localhost/weibo",
                "storageState": "browser-session",
            },
            "items": [
                {"cookie": "SUB=secret", "title": "safe title"},
                {"apiKey": "sk-secret", "APIKEY": "sk-secret", "title": "safe second title"},
                "traceback: /Users/mini-002/Desktop/yuqingjiance/ai-public-opinion-monitor/.env",
            ],
            "rawModelOutput": "hidden prompt",
            "DBURL": "mysql://root:secret@localhost/weibo",
        }

gateway = HarnessToolGateway(repository=FakeRepository())
result = gateway.call_tool("get_loop_context", {"project_id": 2, "run_id": 10})

assert result["ok"] is True, result
assert result["result"]["nested"]["safe"] == "keep me", result
assert result["result"]["items"][0]["title"] == "safe title", result
assert result["result"]["items"][1]["title"] == "safe second title", result
assert result["result"]["items"][2] == "[REDACTED]", result

serialized = json.dumps(result, ensure_ascii=False)
for forbidden in [
    "api_key",
    "apiKey",
    "APIKEY",
    "token",
    "db_url",
    "databaseUrl",
    "MYSQLURL",
    "DBURL",
    "storageState",
    "cookie",
    "rawModelOutput",
    "sk-secret",
    "hidden-token",
    "mysql://",
    "root:secret",
    "SUB=secret",
    "traceback",
    "/Users/mini-002",
    ".env",
]:
    assert forbidden not in serialized, serialized
`);
});
