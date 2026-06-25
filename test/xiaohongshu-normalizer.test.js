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
      "Python XiaohongshuNormalizer assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("XiaohongshuNormalizer normalizes search fixture notes with scoped evidence IDs", () => {
  runPython(`
import json
from app.xiaohongshu_normalizer import XiaohongshuNormalizer

normalizer = XiaohongshuNormalizer(project_id=2)
payload = normalizer.normalize_search_fixture(
    "test/fixtures/xiaohongshu-search.json",
    raw_artifact_ref="artifacts/agent-reach/xiaohongshu/search-fixture.json"
)

assert payload["ok"] is True, payload
assert payload["platform"] == "xiaohongshu", payload
assert payload["project_id"] == 2, payload
assert payload["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/search-fixture.json", payload
assert len(payload["content_items"]) == 2, payload

first = payload["content_items"][0]
assert first["platform"] == "xiaohongshu", first
assert first["project_id"] == 2, first
assert first["external_id"] == "xhs-note-1001", first
assert first["title"] == "海岛舒服日志官宣后的小红书观感", first
assert "刘昊然、李兰迪组合" in first["text"], first
assert first["author_external_id"] == "xhs-user-501", first
assert first["author_display_name"] == "海岛追剧手账", first
assert first["author_url"] == "https://www.xiaohongshu.com/user/profile/xhs-user-501", first
assert first["url"] == "https://www.xiaohongshu.com/explore/xhs-note-1001", first
assert first["published_at"] == "2026-05-22T09:30:00+08:00", first
assert first["metrics"] == {
    "like_count": 8300,
    "collect_count": 1200,
    "comment_count": 460,
    "share_count": 98,
}, first
assert first["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/search-fixture.json", first
assert first["evidence_ids"] == ["xiaohongshu:project:2:item:xhs-note-1001"], first

second = payload["content_items"][1]
assert second["external_id"] == "xhs-note-1002", second
assert second["text"] == "笔记记录站内对角色关系、服化风格和宣发节奏的反馈。", second
assert second["published_at"] == "2026-05-22T15:45:00+08:00", second
assert second["author_external_id"] == "xhs-user-502", second
assert second["metrics"] == {
    "like_count": 5100,
    "collect_count": 760,
    "comment_count": 210,
    "share_count": 45,
}, second

evidence = payload["evidence_summaries"]
assert [item["id"] for item in evidence] == [
    "xiaohongshu:project:2:item:xhs-note-1001",
    "xiaohongshu:project:2:item:xhs-note-1002",
], evidence

for content_item, evidence_item in zip(payload["content_items"], evidence):
    assert evidence_item["id"] == content_item["evidence_ids"][0], evidence_item
    assert evidence_item["platform"] == "xiaohongshu", evidence_item
    assert evidence_item["project_id"] == 2, evidence_item
    assert evidence_item["source_type"] == "note", evidence_item
    assert evidence_item["external_id"] == content_item["external_id"], evidence_item
    assert evidence_item["content_item_external_id"] == content_item["external_id"], evidence_item
    assert content_item["title"] in evidence_item["summary"], evidence_item
    assert evidence_item["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/search-fixture.json", evidence_item

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in ["raw_json", "debug_payload", "private_runner_note", "internal collector note"]:
    assert forbidden not in serialized, serialized
`);
});

test("XiaohongshuNormalizer splits detail fixture into note and comment evidence summaries", () => {
  runPython(`
import json
from app.xiaohongshu_normalizer import XiaohongshuNormalizer

normalizer = XiaohongshuNormalizer(project_id=2)
payload = normalizer.normalize_detail_fixture(
    "test/fixtures/xiaohongshu-detail.json",
    raw_artifact_ref="artifacts/agent-reach/xiaohongshu/detail-fixture.json"
)

assert payload["ok"] is True, payload
assert payload["platform"] == "xiaohongshu", payload
assert payload["project_id"] == 2, payload
assert payload["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/detail-fixture.json", payload
assert len(payload["content_items"]) == 1, payload

note = payload["content_items"][0]
assert note["external_id"] == "xhs-note-1001", note
assert note["metrics"] == {
    "like_count": 9100,
    "collect_count": 1500,
    "comment_count": 3,
    "share_count": 120,
}, note
assert note["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/detail-fixture.json", note

evidence = payload["evidence_summaries"]
ids = [item["id"] for item in evidence]
assert ids == [
    "xiaohongshu:project:2:item:xhs-note-1001",
    "xiaohongshu:project:2:comment:xhs-comment-7001",
    "xiaohongshu:project:2:comment:xhs-comment-7002",
], ids
assert len(ids) == len(set(ids)), ids
assert note["evidence_ids"] == ids, note

note_evidence = next(item for item in evidence if item["source_type"] == "note")
assert note_evidence["id"] == "xiaohongshu:project:2:item:xhs-note-1001", note_evidence
assert note_evidence["platform"] == "xiaohongshu", note_evidence
assert note_evidence["project_id"] == 2, note_evidence
assert note_evidence["external_id"] == "xhs-note-1001", note_evidence
assert "海岛取景质感" in note_evidence["summary"], note_evidence

comment = next(item for item in evidence if item["id"] == "xiaohongshu:project:2:comment:xhs-comment-7001")
assert comment["source_type"] == "comment", comment
assert comment["content_item_external_id"] == "xhs-note-1001", comment
assert comment["author_external_id"] == "xhs-fan-7001", comment
assert comment["author_display_name"] == "海风观剧", comment
assert comment["author_url"] == "https://www.xiaohongshu.com/user/profile/xhs-fan-7001", comment
assert "组合感比路透阶段更清楚" in comment["summary"], comment
assert comment["metrics"] == {"like_count": 126, "reply_count": 6}, comment
assert comment["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/detail-fixture.json", comment

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in ["raw_json", "debug_payload", "private_runner_note", "collector-only diagnostics"]:
    assert forbidden not in serialized, serialized
`);
});

test("XiaohongshuNormalizer redacts dangerous values from actual public fields", () => {
  runPython(`
import json
import tempfile
from pathlib import Path
from app.xiaohongshu_normalizer import XiaohongshuNormalizer

fixture = {
    "note": {
        "note_id": "xhs-secret-note",
        "title": "安全回归样本",
        "desc": "description leaked Cookie=SUB=secret",
        "url": "https://www.xiaohongshu.com/explore/xhs-secret-note",
        "published_at": "2026-05-22T09:30:00+08:00",
        "author": {
            "user_id": "xhs-safe-author",
            "nickname": "安全测试",
            "profile_url": "browser/storage_state.json"
        },
        "stats": {
            "liked_count": "mysql://root:secret@localhost/db",
            "collected_count": "token=secret",
            "comment_count": ".env",
            "share_count": "bearer secret"
        },
        "raw_json": {"cookie": "SUB=secret"},
        "body_text": "body_text leaked mysql://root:secret@localhost/db"
    },
    "comments": [
        {
            "comment_id": "xhs-secret-comment",
            "content": "comment message leaked bearer secret-token",
            "author": {"user_id": "fan-secret", "nickname": "测试用户"},
            "like_count": "mysql://root:secret@localhost/db",
            "reply_count": "token=secret"
        }
    ],
    "debug_payload": "collector-only diagnostics"
}

with tempfile.TemporaryDirectory() as tmpdir:
    fixture_path = Path(tmpdir) / "xiaohongshu-dangerous.json"
    fixture_path.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")
    payload = XiaohongshuNormalizer(project_id=2).normalize_detail_fixture(
        fixture_path,
        raw_artifact_ref="config/cookies/xhs.json raw stderr token=secret"
    )

assert payload["raw_artifact_ref"] is None, payload
note = payload["content_items"][0]
assert note["text"] is None, note
assert note["author_url"] is None, note
assert note["raw_artifact_ref"] is None, note
assert note["metrics"] == {"like_count": 0, "collect_count": 0, "comment_count": 0, "share_count": 0}, note

for evidence in payload["evidence_summaries"]:
    assert evidence["raw_artifact_ref"] is None, evidence
    assert evidence["summary"] is None, evidence
    if evidence["source_type"] == "comment":
        assert evidence["metrics"] == {"like_count": 0, "reply_count": 0}, evidence

serialized = json.dumps(payload, ensure_ascii=False).lower()
for forbidden in [
    "cookie",
    "sub=secret",
    "token",
    "secret-token",
    ".env",
    "mysql://",
    "browser/storage",
    "storage_state",
    "config/cookies",
    "raw stderr",
    "bearer",
    "raw_json",
    "debug_payload",
    "collector-only diagnostics"
]:
    assert forbidden not in serialized, serialized
`);
});

test("XiaohongshuNormalizer allowlists raw artifact refs before public output", () => {
  runPython(`
import json
from app.xiaohongshu_normalizer import XiaohongshuNormalizer

normalizer = XiaohongshuNormalizer(project_id=2)
for unsafe_ref in [
    "raw stdout collector transcript",
    "artifacts/agent-reach/xiaohongshu/raw stdout collector transcript",
    "artifacts/agent-reach/xiaohongshu/raw_stdout_collector_transcript.json",
    "artifacts/agent-reach/xiaohongshu/raw-stdout-collector-transcript.json"
]:
    unsafe_payload = normalizer.normalize_search_fixture(
        "test/fixtures/xiaohongshu-search.json",
        raw_artifact_ref=unsafe_ref
    )

    assert unsafe_payload["raw_artifact_ref"] is None, unsafe_payload
    for content_item in unsafe_payload["content_items"]:
        assert content_item["raw_artifact_ref"] is None, content_item
    for evidence in unsafe_payload["evidence_summaries"]:
        assert evidence["raw_artifact_ref"] is None, evidence

    serialized = json.dumps(unsafe_payload, ensure_ascii=False).lower()
    assert "raw stdout collector transcript" not in serialized, serialized
    compact = "".join(ch for ch in serialized if ch.isalnum())
    assert "rawstdout" not in compact, serialized
    assert "collectortranscript" not in compact, serialized

safe_payload = normalizer.normalize_search_fixture(
    "test/fixtures/xiaohongshu-search.json",
    raw_artifact_ref="artifacts/agent-reach/xiaohongshu/search-safe.json"
)
assert safe_payload["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/search-safe.json", safe_payload
assert safe_payload["content_items"][0]["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/search-safe.json", safe_payload
assert safe_payload["evidence_summaries"][0]["raw_artifact_ref"] == "artifacts/agent-reach/xiaohongshu/search-safe.json", safe_payload
`);
});

test("XiaohongshuNormalizer scopes ID-less comment fallback IDs to the parent note", () => {
  runPython(`
import json
import tempfile
from pathlib import Path
from app.xiaohongshu_normalizer import XiaohongshuNormalizer

comment = {
    "content": "同一位用户在不同笔记下留下相同评论。",
    "author": {"user_id": "xhs-same-author", "nickname": "同名评论者"},
    "like_count": 9,
    "reply_count": 1
}

fixture_a = {
    "note": {
        "note_id": "xhs-note-fallback-a",
        "title": "海岛舒服日志 A",
        "content": "第一条笔记。",
        "url": "https://www.xiaohongshu.com/explore/xhs-note-fallback-a"
    },
    "comments": [comment, dict(comment)]
}
fixture_b = {
    "note": {
        "note_id": "xhs-note-fallback-b",
        "title": "海岛舒服日志 B",
        "content": "第二条笔记。",
        "url": "https://www.xiaohongshu.com/explore/xhs-note-fallback-b"
    },
    "comments": [comment]
}

with tempfile.TemporaryDirectory() as tmpdir:
    path_a = Path(tmpdir) / "note-a.json"
    path_b = Path(tmpdir) / "note-b.json"
    path_a.write_text(json.dumps(fixture_a, ensure_ascii=False), encoding="utf-8")
    path_b.write_text(json.dumps(fixture_b, ensure_ascii=False), encoding="utf-8")

    normalizer = XiaohongshuNormalizer(project_id=2)
    payload_a = normalizer.normalize_detail_fixture(
        path_a,
        raw_artifact_ref="artifacts/agent-reach/xiaohongshu/detail-a.json"
    )
    payload_b = normalizer.normalize_detail_fixture(
        path_b,
        raw_artifact_ref="artifacts/agent-reach/xiaohongshu/detail-b.json"
    )

comment_ids_a = [
    item["id"]
    for item in payload_a["evidence_summaries"]
    if item["source_type"] == "comment"
]
comment_ids_b = [
    item["id"]
    for item in payload_b["evidence_summaries"]
    if item["source_type"] == "comment"
]

assert len(comment_ids_a) == 1, payload_a
assert len(comment_ids_b) == 1, payload_b
assert comment_ids_a[0].startswith("xiaohongshu:project:2:comment:"), comment_ids_a
assert comment_ids_b[0].startswith("xiaohongshu:project:2:comment:"), comment_ids_b
assert comment_ids_a[0] != comment_ids_b[0], (comment_ids_a, comment_ids_b)
assert payload_a["content_items"][0]["evidence_ids"].count(comment_ids_a[0]) == 1, payload_a
`);
});
