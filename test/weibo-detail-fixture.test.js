import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("parses Weibo detail fixture with dedupe, bad rows, and target-task link", () => {
  const result = spawnSync(
    python,
    [
      "workers/enterprise_worker.py",
      "weibo-parse-detail-fixture",
      "--fixture",
      "test/fixtures/weibo-detail.jsonl",
      "--target-id",
      "1001",
      "--task-id",
      "fixture-task-1"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.status, "partial");
  assert.equal(payload.parsed_records, 3);
  assert.equal(payload.failed_records, 2);
  assert.equal(payload.posts.length, 2);
  assert.equal(payload.comments.length, 4);
  assert.deepEqual(payload.target_collection_link, {
    target_id: "1001",
    collection_task_id: "fixture-task-1",
    link_type: "detail"
  });

  const post = payload.posts.find((item) => item.external_id === "1001");
  assert.equal(post.platform, "weibo");
  assert.equal(post.weibo_mid, "m1001");
  assert.equal(post.engagement, 121);
  assert.equal(post.source_account_external_id, "u100");
  assert.equal(typeof post.content_fingerprint, "string");
  assert.equal(post.raw_json.post.id, "1001");

  const duplicateComment = payload.comments.find((item) => item.external_id === "c1002");
  assert.equal(duplicateComment.like_count, 21);
  assert.equal(duplicateComment.reply_count, 5);
  assert.equal(duplicateComment.post_external_id, "1001");
  assert.equal(duplicateComment.comment_weight > 1, true);
  assert.equal(typeof duplicateComment.content_fingerprint, "string");
  assert.equal(payload.errors.some((error) => error.error_type === "adapter_parse_failed"), true);
});
