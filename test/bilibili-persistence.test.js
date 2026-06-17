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
      "Python Bilibili persistence assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("Bilibili persistence migration expands evidence platform enums for B站", () => {
  const dbPy = readFileSync("workers/db.py", "utf8");
  const migration = readFileSync("migrations/008_agent_reach_bilibili_ingestion.sql", "utf8");
  const writer = readFileSync("app/bilibili_persistence.py", "utf8");

  assert.match(dbPy, /008_agent_reach_bilibili_ingestion\.sql/);
  for (const table of ["social_posts", "social_comments", "source_accounts"]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*MODIFY COLUMN platform ENUM\\('xiaohongshu','douyin','weibo','bilibili'\\)`, "i"));
  }
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE/i);

  const mysqlWriter = writer.slice(writer.indexOf("class MySQLBilibiliRepository"));
  for (const method of ["upsert_source_account", "upsert_post", "upsert_comment"]) {
    const section = mysqlWriter.match(new RegExp(`def ${method}[\\s\\S]*?(?=\\n    def |\\n\\ndef |\\nclass |\\Z)`))?.[0] || "";
    assert.match(section, /ON DUPLICATE KEY UPDATE/i, method);
    assert.match(section, /LAST_INSERT_ID\(id\)/i, method);
  }
});

test("BilibiliEvidenceWriter persists fixture payloads idempotently with project-scoped keys", () => {
  runPython(`
from app.bilibili_normalizer import BilibiliNormalizer
from app.bilibili_persistence import BilibiliEvidenceWriter, InMemoryBilibiliRepository

normalizer = BilibiliNormalizer(project_id=2)
search = normalizer.normalize_search_fixture(
    "test/fixtures/bilibili-search.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/search-fixture.json",
)
detail = normalizer.normalize_detail_fixture(
    "test/fixtures/bilibili-detail.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/detail-fixture.json",
)

repo = InMemoryBilibiliRepository()
writer = BilibiliEvidenceWriter(repo)
search_result = writer.persist(search)
detail_result = writer.persist(detail)
for evidence in detail["evidence_summaries"]:
    if evidence.get("external_id") == "r9002":
        evidence["metrics"]["like_count"] = 141
repeat_result = writer.persist(detail)

assert search_result["ok"] is True, search_result
assert search_result["platform"] == "bilibili", search_result
assert search_result["persisted_source_accounts"] == 2, search_result
assert search_result["persisted_posts"] == 2, search_result
assert search_result["persisted_comments"] == 0, search_result
assert search_result["evidence_ids"] == [
    "bilibili:project:2:item:BV1HDLOG0001",
    "bilibili:project:2:item:BV1HDLOG0002",
], search_result

assert detail_result["persisted_source_accounts"] == 4, detail_result
assert detail_result["persisted_posts"] == 1, detail_result
assert detail_result["persisted_comments"] == 3, detail_result
assert detail_result["updated_posts"] == 1, detail_result
assert detail_result["evidence_ids"] == detail["content_items"][0]["evidence_ids"], detail_result
assert repeat_result["persisted_source_accounts"] == 4, repeat_result
assert repeat_result["persisted_posts"] == 1, repeat_result
assert repeat_result["persisted_comments"] == 3, repeat_result

assert repo.count("source_accounts", project_id=2) == 5, repo.snapshot()
assert repo.count("posts", project_id=2) == 2, repo.snapshot()
assert repo.count("comments", project_id=2) == 3, repo.snapshot()
assert repo.post(2, "BV1HDLOG0001")["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/detail-fixture.json", repo.snapshot()
assert repo.comment(2, "r9002")["like_count"] == 141, repo.snapshot()

other_search = BilibiliNormalizer(project_id=3).normalize_search_fixture(
    "test/fixtures/bilibili-search.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/search-project-3.json",
)
other_result = writer.persist(other_search)
other_detail = BilibiliNormalizer(project_id=3).normalize_detail_fixture(
    "test/fixtures/bilibili-detail.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/detail-project-3.json",
)
for evidence in other_detail["evidence_summaries"]:
    if evidence.get("external_id") == "r9002":
        evidence["metrics"]["like_count"] = 7
other_detail_result = writer.persist(other_detail)
assert other_result["persisted_posts"] == 2, other_result
assert other_detail_result["persisted_source_accounts"] == 4, other_detail_result
assert other_detail_result["persisted_posts"] == 1, other_detail_result
assert other_detail_result["persisted_comments"] == 3, other_detail_result
assert repo.count("posts", project_id=2) == 2, repo.snapshot()
assert repo.count("posts", project_id=3) == 2, repo.snapshot()
assert repo.count("source_accounts", project_id=3) == 5, repo.snapshot()
assert repo.count("comments", project_id=3) == 3, repo.snapshot()
assert repo.post(2, "BV1HDLOG0001")["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/detail-fixture.json"
assert repo.post(3, "BV1HDLOG0001")["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/detail-project-3.json"
assert repo.comment(2, "r9002")["like_count"] == 141, repo.snapshot()
assert repo.comment(3, "r9002")["like_count"] == 7, repo.snapshot()
`);
});

test("Bilibili post upsert preserves raw_json evidence IDs across search/detail duplicates", () => {
  runPython(`
from app.bilibili_normalizer import BilibiliNormalizer
from app.bilibili_persistence import BilibiliEvidenceWriter, InMemoryBilibiliRepository

normalizer = BilibiliNormalizer(project_id=2)
search = normalizer.normalize_search_fixture(
    "test/fixtures/bilibili-search.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/search-fixture.json",
)
detail = normalizer.normalize_detail_fixture(
    "test/fixtures/bilibili-detail.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/detail-fixture.json",
)
expected = detail["content_items"][0]["evidence_ids"]

def persisted_post_evidence_ids(first_payload, second_payload):
    repo = InMemoryBilibiliRepository()
    writer = BilibiliEvidenceWriter(repo)
    writer.persist(first_payload)
    writer.persist(second_payload)
    return repo.post(2, "BV1HDLOG0001")["raw_json"]["evidence_ids"]

assert persisted_post_evidence_ids(detail, search) == expected
assert persisted_post_evidence_ids(search, detail) == expected
`);
});

test("MySQLBilibiliRepository duplicate post upsert merges raw_json evidence IDs", () => {
  runPython(`
import json
from app.bilibili_normalizer import BilibiliNormalizer
from app.bilibili_persistence import MySQLBilibiliRepository

normalizer = BilibiliNormalizer(project_id=2)
search = normalizer.normalize_search_fixture(
    "test/fixtures/bilibili-search.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/search-fixture.json",
)
detail = normalizer.normalize_detail_fixture(
    "test/fixtures/bilibili-detail.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/detail-fixture.json",
)
search_item = next(item for item in search["content_items"] if item["external_id"] == "BV1HDLOG0001")
detail_item = detail["content_items"][0]
expected = set(detail_item["evidence_ids"])

class Cursor:
    def __init__(self, db):
        self.db = db
        self.lastrowid = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params):
        self.db.queries.append((sql, params))
        assert "INSERT INTO social_posts" in sql, sql
        incoming = json.loads(params[10])
        key = (params[0], "bilibili", params[1])
        existing = self.db.posts.get(key)
        if existing:
            assert "JSON_MERGE_PRESERVE" in sql, sql
            assert "JSON_EXTRACT(raw_json, '$.evidence_ids')" in sql, sql
            assert "JSON_EXTRACT(VALUES(raw_json), '$.evidence_ids')" in sql, sql
            merged_ids = list(dict.fromkeys(
                (existing["raw_json"].get("evidence_ids") or []) + (incoming.get("evidence_ids") or [])
            ))
            self.db.posts[key]["raw_json"] = {**incoming, "evidence_ids": merged_ids}
            self.lastrowid = existing["id"]
        else:
            self.db.posts[key] = {"id": self.db.next_id, "raw_json": incoming}
            self.lastrowid = self.db.next_id
            self.db.next_id += 1

class Connection:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return Cursor(self.db)

class FakeDb:
    def __init__(self):
        self.posts = {}
        self.queries = []
        self.next_id = 100

    def connect(self):
        return Connection(self)

def persisted_mysql_post_evidence_ids(first_item, second_item):
    fake_db = FakeDb()
    repo = MySQLBilibiliRepository(fake_db)
    repo.upsert_post(2, first_item)
    repo.upsert_post(2, second_item)
    return set(fake_db.posts[(2, "bilibili", "BV1HDLOG0001")]["raw_json"]["evidence_ids"])

assert persisted_mysql_post_evidence_ids(detail_item, search_item) == expected
assert persisted_mysql_post_evidence_ids(search_item, detail_item) == expected
`);
});

test("BilibiliEvidenceWriter rejects unsafe or cross-platform persistence payloads", () => {
  runPython(`
from app.bilibili_persistence import BilibiliEvidenceWriter, InMemoryBilibiliRepository

writer = BilibiliEvidenceWriter(InMemoryBilibiliRepository())
for payload in [
    {"ok": True, "platform": "weibo", "project_id": 2},
    {"ok": True, "platform": "bilibili", "project_id": 0},
    {
        "ok": True,
        "platform": "bilibili",
        "project_id": 2,
        "raw_artifact_ref": "config/cookies/bilibili.json token=secret",
        "content_items": [],
        "evidence_summaries": [],
    },
    {
        "ok": True,
        "platform": "bilibili",
        "project_id": 2,
        "raw_artifact_ref": "artifacts/agent-reach/bilibili/safe.json",
        "content_items": [{"external_id": "BVSAFE", "databaseUrl": "redacted"}],
        "evidence_summaries": [{"id": "bilibili:project:2:comment:r-safe", "rawStderr": "redacted"}],
    },
]:
    result = writer.persist(payload)
    assert result["ok"] is False, result
    assert result["error_type"] in {
        "bilibili_platform_not_allowed",
        "invalid_project_id",
        "unsafe_bilibili_payload",
    }, result

assert writer.repository.snapshot() == {"source_accounts": [], "posts": [], "comments": []}
`);
});
