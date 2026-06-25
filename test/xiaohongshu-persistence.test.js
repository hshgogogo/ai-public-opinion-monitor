import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
      "Python Xiaohongshu persistence assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("Xiaohongshu persistence migration already allows 小红书 evidence platform values", () => {
  const dbPy = readFileSync("workers/db.py", "utf8");
  const migration = readFileSync("migrations/008_agent_reach_bilibili_ingestion.sql", "utf8");
  const writer = readFileSync("app/xiaohongshu_persistence.py", "utf8");

  assert.match(dbPy, /008_agent_reach_bilibili_ingestion\.sql/);
  for (const table of ["social_posts", "social_comments", "source_accounts"]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*MODIFY COLUMN platform ENUM\\('xiaohongshu','douyin','weibo','bilibili'\\)`, "i"));
  }
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE/i);

  const mysqlWriter = writer.slice(writer.indexOf("class MySQLXiaohongshuRepository"));
  for (const method of ["upsert_source_account", "upsert_post", "upsert_comment"]) {
    const section = mysqlWriter.match(new RegExp(`def ${method}[\\s\\S]*?(?=\\n    def |\\n\\ndef |\\nclass |\\Z)`))?.[0] || "";
    assert.match(section, /ON DUPLICATE KEY UPDATE/i, method);
    assert.match(section, /LAST_INSERT_ID\(id\)/i, method);
  }
});

test("XiaohongshuEvidenceWriter persists normalized notes and comments idempotently with project-scoped keys", () => {
  runPython(`
from app.xiaohongshu_normalizer import XiaohongshuNormalizer
from app.xiaohongshu_persistence import XiaohongshuEvidenceWriter, InMemoryXiaohongshuRepository

normalizer = XiaohongshuNormalizer(project_id=2)
search = normalizer.normalize_search_fixture(
    "test/fixtures/xiaohongshu-search.json",
    raw_artifact_ref="artifacts/agent-reach/xiaohongshu/search-fixture.json",
)
detail = normalizer.normalize_detail_fixture(
    "test/fixtures/xiaohongshu-detail.json",
    raw_artifact_ref="artifacts/agent-reach/xiaohongshu/detail-fixture.json",
)

repo = InMemoryXiaohongshuRepository()
writer = XiaohongshuEvidenceWriter(repo)
search_result = writer.persist(search)
detail_result = writer.persist(detail)
for evidence in detail["evidence_summaries"]:
    if evidence.get("external_id") == "xhs-comment-7001":
        evidence["metrics"]["like_count"] = 141
repeat_result = writer.persist(detail)

assert search_result["ok"] is True, search_result
assert search_result["platform"] == "xiaohongshu", search_result
assert search_result["persisted_source_accounts"] == 2, search_result
assert search_result["persisted_posts"] == 2, search_result
assert search_result["persisted_comments"] == 0, search_result
assert search_result["evidence_ids"] == [
    "xiaohongshu:project:2:item:xhs-note-1001",
    "xiaohongshu:project:2:item:xhs-note-1002",
], search_result

assert detail_result["persisted_source_accounts"] == 3, detail_result
assert detail_result["persisted_posts"] == 1, detail_result
assert detail_result["persisted_comments"] == 2, detail_result
assert detail_result["updated_posts"] == 1, detail_result
assert detail_result["evidence_ids"] == detail["content_items"][0]["evidence_ids"], detail_result
assert repeat_result["persisted_source_accounts"] == 3, repeat_result
assert repeat_result["persisted_posts"] == 1, repeat_result
assert repeat_result["persisted_comments"] == 2, repeat_result

assert repo.count("source_accounts", project_id=2) == 4, repo.snapshot()
assert repo.count("posts", project_id=2) == 2, repo.snapshot()
assert repo.count("comments", project_id=2) == 2, repo.snapshot()
post = repo.post(2, "xhs-note-1001")
comment = repo.comment(2, "xhs-comment-7001")
assert post["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/detail-fixture.json", repo.snapshot()
assert post["like_count"] == 9100, repo.snapshot()
assert post["raw_json"]["evidence_ids"] == detail["content_items"][0]["evidence_ids"], post
assert post["raw_json"]["metrics"]["collect_count"] == 1500, post
assert comment["like_count"] == 141, repo.snapshot()
assert comment["raw_json"]["evidence_id"] == "xiaohongshu:project:2:comment:xhs-comment-7001", comment
assert comment["raw_json"]["metrics"]["reply_count"] == 6, comment

other_search = XiaohongshuNormalizer(project_id=3).normalize_search_fixture(
    "test/fixtures/xiaohongshu-search.json",
    raw_artifact_ref="artifacts/agent-reach/xiaohongshu/search-project-3.json",
)
other_result = writer.persist(other_search)
other_detail = XiaohongshuNormalizer(project_id=3).normalize_detail_fixture(
    "test/fixtures/xiaohongshu-detail.json",
    raw_artifact_ref="artifacts/agent-reach/xiaohongshu/detail-project-3.json",
)
for evidence in other_detail["evidence_summaries"]:
    if evidence.get("external_id") == "xhs-comment-7001":
        evidence["metrics"]["like_count"] = 7
other_detail_result = writer.persist(other_detail)

assert other_result["persisted_posts"] == 2, other_result
assert other_detail_result["persisted_source_accounts"] == 3, other_detail_result
assert other_detail_result["persisted_posts"] == 1, other_detail_result
assert other_detail_result["persisted_comments"] == 2, other_detail_result
assert repo.count("posts", project_id=2) == 2, repo.snapshot()
assert repo.count("posts", project_id=3) == 2, repo.snapshot()
assert repo.count("source_accounts", project_id=3) == 4, repo.snapshot()
assert repo.count("comments", project_id=3) == 2, repo.snapshot()
assert repo.post(2, "xhs-note-1001")["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/detail-fixture.json"
assert repo.post(3, "xhs-note-1001")["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/detail-project-3.json"
assert repo.comment(2, "xhs-comment-7001")["like_count"] == 141, repo.snapshot()
assert repo.comment(3, "xhs-comment-7001")["like_count"] == 7, repo.snapshot()
`);
});

test("XiaohongshuEvidenceWriter rejects unsafe or mismatched persistence payloads before writes", () => {
  runPython(`
from app.xiaohongshu_persistence import XiaohongshuEvidenceWriter, InMemoryXiaohongshuRepository

writer = XiaohongshuEvidenceWriter(InMemoryXiaohongshuRepository())
payloads = [
    {"ok": True, "platform": "bilibili", "project_id": 2},
    {"ok": True, "platform": "xiaohongshu", "project_id": 0},
    {
        "ok": True,
        "platform": "xiaohongshu",
        "project_id": 2,
        "raw_artifact_ref": "config/cookies/xhs.json token=secret",
        "content_items": [],
        "evidence_summaries": [],
    },
    {
        "ok": True,
        "platform": "xiaohongshu",
        "project_id": 2,
        "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/safe.json",
        "content_items": [{"external_id": "xhs-safe-note", "databaseUrl": "redacted"}],
        "evidence_summaries": [{"id": "xiaohongshu:project:2:comment:xhs-safe-comment", "rawStderr": "redacted"}],
    },
    {
        "ok": True,
        "platform": "xiaohongshu",
        "project_id": 2,
        "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/safe.json",
        "content_items": [{"external_id": "xhs-safe-note", "evidence_ids": ["bilibili:project:2:item:BV1"]}],
        "evidence_summaries": [],
    },
    {
        "ok": True,
        "platform": "xiaohongshu",
        "project_id": 2,
        "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/safe.json",
        "content_items": [{"external_id": "xhs-safe-note", "evidence_ids": ["xiaohongshu:project:3:item:xhs-safe-note"]}],
        "evidence_summaries": [{"id": "xiaohongshu:project:3:item:xhs-safe-note"}],
    },
    {
        "ok": True,
        "platform": "xiaohongshu",
        "project_id": 2,
        "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/safe.json",
        "content_items": [{"project_id": 3, "external_id": "xhs-cross-project-note"}],
        "evidence_summaries": [],
    },
    {
        "ok": True,
        "platform": "xiaohongshu",
        "project_id": 2,
        "raw_artifact_ref": "artifacts/agent-reach/xiaohongshu/safe.json",
        "content_items": [{"platform": "bilibili", "external_id": "xhs-cross-platform-note"}],
        "evidence_summaries": [],
    },
]

for payload in payloads:
    result = writer.persist(payload)
    assert result["ok"] is False, result
    assert result["error_type"] in {
        "xiaohongshu_platform_not_allowed",
        "invalid_project_id",
        "unsafe_xiaohongshu_payload",
    }, result

assert writer.repository.snapshot() == {"source_accounts": [], "posts": [], "comments": []}
`);
});
