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
      "Python BilibiliNormalizer assertion failed.",
      `status=${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n")
  );
}

test("BilibiliNormalizer normalizes search fixture content items with scoped evidence IDs", () => {
  runPython(`
import json
from app.bilibili_normalizer import BilibiliNormalizer

normalizer = BilibiliNormalizer(project_id=2)
payload = normalizer.normalize_search_fixture(
    "test/fixtures/bilibili-search.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/search-fixture.json"
)

assert payload["ok"] is True, payload
assert payload["platform"] == "bilibili", payload
assert payload["project_id"] == 2, payload
assert payload["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/search-fixture.json", payload
assert len(payload["content_items"]) == 2, payload

first = payload["content_items"][0]
assert first["platform"] == "bilibili", first
assert first["project_id"] == 2, first
assert first["external_id"] == "BV1HDLOG0001", first
assert first["title"] == "海岛舒服日志官宣反应混剪", first
assert "刘昊然和李兰迪" in first["text"], first
assert first["author_external_id"] == "up1001", first
assert first["author_display_name"] == "海风剪辑室", first
assert first["url"] == "https://www.bilibili.com/video/BV1HDLOG0001", first
assert first["published_at"] == "2026-05-20T10:20:00+08:00", first
assert first["metrics"] == {
    "view_count": 128000,
    "like_count": 6200,
    "comment_count": 860,
    "share_count": 470,
}, first
assert first["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/search-fixture.json", first
assert first["evidence_ids"] == ["bilibili:project:2:item:BV1HDLOG0001"], first

evidence = payload["evidence_summaries"]
assert len(evidence) == 2, evidence
assert [item["id"] for item in evidence] == [
    "bilibili:project:2:item:BV1HDLOG0001",
    "bilibili:project:2:item:BV1HDLOG0002",
], evidence

for content_item, evidence_item in zip(payload["content_items"], evidence):
    assert evidence_item["id"] == content_item["evidence_ids"][0], evidence_item
    assert evidence_item["platform"] == "bilibili", evidence_item
    assert evidence_item["project_id"] == 2, evidence_item
    assert evidence_item["source_type"] == "video", evidence_item
    assert evidence_item["external_id"] == content_item["external_id"], evidence_item
    assert evidence_item["content_item_external_id"] == content_item["external_id"], evidence_item
    assert content_item["title"] in evidence_item["summary"], evidence_item
    assert evidence_item["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/search-fixture.json", evidence_item

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in ["raw_json", "private_runner_note", "internal collector note"]:
    assert forbidden not in serialized, serialized
`);
});

test("BilibiliNormalizer splits detail fixture into safe Harness evidence summaries", () => {
  runPython(`
import json
from app.bilibili_normalizer import BilibiliNormalizer

normalizer = BilibiliNormalizer(project_id=2)
payload = normalizer.normalize_detail_fixture(
    "test/fixtures/bilibili-detail.json",
    raw_artifact_ref="artifacts/agent-reach/bilibili/detail-fixture.json"
)

assert payload["ok"] is True, payload
assert payload["platform"] == "bilibili", payload
assert payload["project_id"] == 2, payload
assert payload["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/detail-fixture.json", payload
assert len(payload["content_items"]) == 1, payload

video = payload["content_items"][0]
assert video["external_id"] == "BV1HDLOG0001", video
assert video["metrics"] == {
    "view_count": 139500,
    "like_count": 7100,
    "comment_count": 3,
    "share_count": 520,
}, video
assert video["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/detail-fixture.json", video

evidence = payload["evidence_summaries"]
ids = [item["id"] for item in evidence]
assert len(ids) == len(set(ids)), ids
assert all(item.startswith("bilibili:") for item in ids), ids
assert video["evidence_ids"] == ids, video

video_evidence = next(item for item in evidence if item["source_type"] == "video")
assert video_evidence["id"] == "bilibili:project:2:item:BV1HDLOG0001", video_evidence
assert video_evidence["platform"] == "bilibili", video_evidence
assert video_evidence["project_id"] == 2, video_evidence
assert video_evidence["external_id"] == "BV1HDLOG0001", video_evidence
assert "官宣反应混剪" in video_evidence["summary"], video_evidence
assert video_evidence["raw_artifact_ref"] == "artifacts/agent-reach/bilibili/detail-fixture.json", video_evidence

comment = next(item for item in evidence if item["id"] == "bilibili:project:2:comment:r9001")
assert comment["source_type"] == "comment", comment
assert comment["content_item_external_id"] == "BV1HDLOG0001", comment
assert comment["author_display_name"] == "岛民A", comment
assert "官宣节奏" in comment["summary"], comment
assert comment["metrics"] == {"like_count": 96, "reply_count": 4}, comment

transcript = next(item for item in evidence if item["source_type"] == "transcript")
assert transcript["id"] == "bilibili:project:2:text:BV1HDLOG0001:transcript:zh-cn", transcript
assert "演员阵容讨论" in transcript["summary"], transcript

body_text = next(item for item in evidence if item["source_type"] == "body_text")
assert body_text["id"] == "bilibili:project:2:text:BV1HDLOG0001:body", body_text
assert "UP主补充" in body_text["summary"], body_text

serialized = json.dumps(payload, ensure_ascii=False)
for forbidden in ["raw_json", "debug_payload", "private_runner_note", "collector-only diagnostics"]:
    assert forbidden not in serialized, serialized
`);
});

test("BilibiliNormalizer redacts dangerous values from actual public fields", () => {
  runPython(`
import json
import tempfile
from pathlib import Path
from app.bilibili_normalizer import BilibiliNormalizer

fixture = {
    "video": {
        "bvid": "BVSECRETS0001",
        "title": "安全回归样本",
        "description": "description leaked Cookie=SUB=secret",
        "url": "https://www.bilibili.com/video/BVSECRETS0001",
        "published_at": "2026-05-20T10:20:00+08:00",
        "author": {"mid": "up-secret", "name": "安全测试"},
        "stat": {
            "view": "mysql://root:secret@localhost/db",
            "like": "token=secret",
            "reply": ".env",
            "share": "bearer secret"
        },
        "body_text": "body_text leaked mysql://root:secret@localhost/db"
    },
    "comments": [
        {
            "rpid": "r-secret",
            "member": {"mid": "fan-secret", "uname": "测试用户"},
            "content": {"message": "comment message leaked bearer secret-token"},
            "like_count": "mysql://root:secret@localhost/db",
            "reply_count": "token=secret"
        }
    ],
    "subtitles": [
        {
            "language": "zh-CN",
            "body": [
                {"from": 0, "to": 1, "content": "subtitle leaked .env"},
                {"from": 1, "to": 2, "content": "subtitle leaked browser/storage_state.json"}
            ]
        }
    ]
}

with tempfile.TemporaryDirectory() as tmpdir:
    fixture_path = Path(tmpdir) / "bilibili-dangerous.json"
    fixture_path.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")
    payload = BilibiliNormalizer(project_id=2).normalize_detail_fixture(
        fixture_path,
        raw_artifact_ref="config/cookies/bilibili.json raw stderr token=secret"
    )

assert payload["raw_artifact_ref"] is None, payload
video = payload["content_items"][0]
assert video["text"] is None, video
assert video["raw_artifact_ref"] is None, video
assert video["metrics"] == {"view_count": 0, "like_count": 0, "comment_count": 0, "share_count": 0}, video

for evidence in payload["evidence_summaries"]:
    assert evidence["raw_artifact_ref"] is None, evidence
    if evidence["source_type"] in {"video", "comment", "transcript", "body_text"}:
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
    "bearer"
]:
    assert forbidden not in serialized, serialized
`);
});
