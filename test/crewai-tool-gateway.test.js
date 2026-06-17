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

test("Harness tool gateway projects cross-platform evidence summaries to public fields only", () => {
  runPython(`
import json
from app.crewai_tools import HarnessToolGateway

class FakeRepository:
    def __init__(self):
        self.calls = []

    def get_loop_context(self, *, project_id, run_id):
        self.calls.append(("get_loop_context", project_id, run_id))
        return {"project_id": project_id, "run_id": run_id}

    def get_evidence_summary(self, *, project_id, evidence_ids):
        self.calls.append(("get_evidence_summary", project_id, tuple(evidence_ids)))
        return {
            "project_id": project_id,
            "evidence": [
                {
                    "id": "bilibili:project:2:item:BV1",
                    "platform": "bilibili",
                    "label": "B站视频",
                    "source_type": "video",
                    "summary": "B站视频摘要",
                    "citation": "B站 BV1",
                    "metrics": {
                        "view_count": 1200,
                        "like_count": 88,
                        "comment_count": 12,
                        "share_count": [5],
                        "favorite_count": {"value": 7},
                        "agentReachCollect": "local probe name only",
                        "agent-reach-collect": "local probe hyphen only",
                        "runner": "local runner name only",
                        "logging": "local logging name only",
                        "url": "local url key only",
                        "raw_url": "local raw url key only",
                        "rawArtifactRef": "local raw artifact ref key only",
                        "browserState": "local browser state key only",
                        "storageState": "local storage state key only",
                        "loginState": "local login state key only",
                        "command": "local command key only",
                        "stdout": "metric raw stdout",
                        "private": {"token": "metric-token"},
                        "nested": ["agent_reach.collect", {"cookie": "metric-cookie"}],
                    },
                    "raw_artifact_ref": "storage/artifacts/agent-reach/bilibili/detail.json",
                    "artifact_ref": "storage/artifacts/agent-reach/bilibili/raw.json",
                    "raw_json": {"cookie": "SUB=secret", "token": "nested-token"},
                    "stdout": "raw stdout from agent_reach.collect",
                    "stderr": "raw stderr with token",
                    "raw_runner_output": {"lines": ["agent_reach.collect", "browser_state"]},
                    "cookie": "SUB=secret",
                    "token": "bearer hidden-token",
                    "browser_state": {"storage_state": "browser-session"},
                    "storage_state": "browser-session",
                    "login_state": {"qr_token": "hidden-qr"},
                    "private": {"login_state": "secret"},
                    "command": "agent_reach.collect",
                    "nested": {"raw_artifact_ref": "raw nested artifact", "token": "nested-token"},
                    "list": [{"stdout": "nested stdout"}, "agent_reach.collect"],
                },
                {
                    "id": "xiaohongshu:project:2:comment:xhs-1",
                    "platform": "xiaohongshu",
                    "label": "小红书评论",
                    "source_type": "comment",
                    "summary": "小红书评论摘要",
                    "citation": "小红书 xhs-1",
                    "metrics": {
                        "like_count": 9,
                        "reply_count": 1,
                        "collect_count": 4,
                        "runner": {"stdout": "nested runner should not project"},
                        "logging": ["debug", "trace"],
                        "url": "xhs url key only",
                        "raw_url": "xhs raw url key only",
                        "agentReachCollect": True,
                        "agent-reach-collect": 1,
                        "raw_runner_output": "metric runner output",
                        "browser_state": "metric browser state",
                    },
                    "raw_artifact_ref": "storage/artifacts/agent-reach/xiaohongshu/detail.json",
                    "artifact_ref": "storage/artifacts/agent-reach/xiaohongshu/raw.json",
                    "raw_json": [{"browser_state": "hidden"}, {"token": "nested-token"}],
                    "stdout": "raw stdout",
                    "stderr": "raw stderr",
                    "raw_runner_output": "runner output",
                    "cookie": "xsec_token=secret",
                    "token": "xhs-token",
                    "browser_state": "browser-session",
                    "storage_state": "storage-session",
                    "login_state": "login-session",
                    "private": True,
                    "command": "platform_collection",
                    "nested": [{"command": "xiaohongshu_collect"}, {"cookie": "hidden-cookie"}],
                },
                {
                    "id": "comment:123",
                    "label": "微博评论",
                    "summary": "旧微博评论摘要",
                    "metrics": {"like_count": 3},
                    "raw_json": {"safe": "not public"},
                    "stdout": "old raw stdout",
                },
            ],
        }

repository = FakeRepository()
gateway = HarnessToolGateway(repository=repository)
result = gateway.call_tool(
    "get_evidence_summary",
    {
        "project_id": 2,
        "evidence_ids": [
            "bilibili:project:2:item:BV1",
            "xiaohongshu:project:2:comment:xhs-1",
            "comment:123",
        ],
    },
)

assert result["ok"] is True, result
assert repository.calls == [
    (
        "get_evidence_summary",
        2,
        (
            "bilibili:project:2:item:BV1",
            "xiaohongshu:project:2:comment:xhs-1",
            "comment:123",
        ),
    )
], repository.calls

public_item_keys = {"id", "platform", "label", "source_type", "summary", "citation", "metrics"}
evidence = result["result"]["evidence"]
assert len(evidence) == 3, evidence
for item in evidence:
    assert set(item).issubset(public_item_keys), item

bilibili = evidence[0]
assert bilibili == {
    "id": "bilibili:project:2:item:BV1",
    "platform": "bilibili",
    "label": "B站视频",
    "source_type": "video",
    "summary": "B站视频摘要",
    "citation": "B站 BV1",
    "metrics": {"view_count": 1200, "like_count": 88, "comment_count": 12},
}, bilibili

xiaohongshu = evidence[1]
assert xiaohongshu == {
    "id": "xiaohongshu:project:2:comment:xhs-1",
    "platform": "xiaohongshu",
    "label": "小红书评论",
    "source_type": "comment",
    "summary": "小红书评论摘要",
    "citation": "小红书 xhs-1",
    "metrics": {"like_count": 9, "reply_count": 1, "collect_count": 4},
}, xiaohongshu

old_comment = evidence[2]
assert old_comment["id"] == "comment:123", old_comment
assert old_comment["label"] == "微博评论", old_comment
assert old_comment["summary"] == "旧微博评论摘要", old_comment
assert old_comment["metrics"] == {"like_count": 3}, old_comment

serialized = json.dumps(result, ensure_ascii=False)
for forbidden in [
    "raw_artifact_ref",
    "artifact_ref",
    "raw_json",
    "stdout",
    "stderr",
    "raw_runner_output",
    "cookie",
    "token",
    "browser_state",
    "storage_state",
    "login_state",
    "private",
    "command",
    "agentReachCollect",
    "agent-reach-collect",
    "runner",
    "logging",
    "url",
    "raw_url",
    "rawArtifactRef",
    "browserState",
    "storageState",
    "loginState",
    "local probe name only",
    "local probe hyphen only",
    "local runner name only",
    "local logging name only",
    "local url key only",
    "local raw url key only",
    "xhs url key only",
    "xhs raw url key only",
    "local raw artifact ref key only",
    "local browser state key only",
    "local storage state key only",
    "local login state key only",
    "local command key only",
    "nested runner should not project",
    "debug",
    "trace",
    "agent_reach.collect",
    "platform_collection",
    "xiaohongshu_collect",
    "storage/artifacts",
    "SUB=secret",
    "nested-token",
    "metric-token",
    "metric-cookie",
    "hidden-token",
    "browser-session",
    "storage-session",
    "login-session",
    "hidden-qr",
    "runner output",
    "raw stdout",
    "raw stderr",
    "[REDACTED]",
]:
    assert forbidden not in serialized, serialized
`);
});

test("Runtime tool facade snapshots only gateway-projected evidence summaries", () => {
  runPython(`
import json
from app.crewai_runtime import _RuntimeToolFacade
from app.crewai_tools import HarnessToolGateway

class FakeRepository:
    def get_loop_context(self, *, project_id, run_id):
        return {"project_id": project_id, "run_id": run_id, "stage": "strategy"}

    def get_evidence_summary(self, *, project_id, evidence_ids):
        return {
            "project_id": project_id,
            "evidence": [
                {
                    "id": evidence_ids[0],
                    "platform": "bilibili",
                    "source_type": "video",
                    "summary": "B站 summary",
                    "raw_artifact_ref": "storage/artifacts/agent-reach/bilibili/raw.json",
                    "raw_json": {"token": "secret"},
                    "command": "agent_reach.collect",
                    "stdout": "runner stdout",
                    "private": {"gateway": "internal"},
                }
            ],
        }

gateway = HarnessToolGateway(repository=FakeRepository())
facade = _RuntimeToolFacade.from_gateway(
    gateway,
    {
        "project_id": 2,
        "agent_loop_run_id": 10,
        "evidence_ids": ["bilibili:project:2:item:BV1"],
    },
)
snapshots = facade.snapshots_for_child_process()
serialized = json.dumps(snapshots, ensure_ascii=False)

assert "B站 summary" in serialized, snapshots
for forbidden in [
    "raw_artifact_ref",
    "raw_json",
    "token",
    "command",
    "agent_reach.collect",
    "stdout",
    "private",
    "storage/artifacts",
    "repository",
    "gateway",
    "internal",
    "[REDACTED]",
]:
    assert forbidden not in serialized, serialized
`);
});

test("Harness tool gateway rejects non-allowlisted submit, recorder, and Agent-Reach tools", () => {
  runPython(`
import json
from app.crewai_tools import HarnessToolGateway

class FakeRepository:
    def __init__(self):
        self.calls = []

    def get_loop_context(self, *, project_id, run_id):
        self.calls.append(("get_loop_context", project_id, run_id))
        return {"project_id": project_id, "run_id": run_id}

repository = FakeRepository()
gateway = HarnessToolGateway(repository=repository)

for tool_name in [
    "unknown_tool",
    "submit_proposal",
    "record_proposal",
    "proposal_recorder",
    "proposal_recorder.create",
    "agent_reach.collect",
    "platform_collection",
    "bilibili_collect",
    "xiaohongshu_collect",
    "douyin_collect",
    "agent_reach.doctor",
    "agent_reach.health",
    "open",
    "read_file",
]:
    result = gateway.call_tool(tool_name, {"project_id": 2, "run_id": 10})
    assert result["ok"] is False, (tool_name, result)
    assert result["error_type"] == "crewai_tool_not_allowed", (tool_name, result)
    serialized = json.dumps(result, ensure_ascii=False)
    assert tool_name not in serialized, serialized
    assert "proposal" not in serialized.lower(), serialized

assert repository.calls == [], repository.calls
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
