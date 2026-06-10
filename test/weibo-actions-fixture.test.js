import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("builds Weibo source matches and action ledger fixture without conflating suggestions and execution", () => {
  const result = spawnSync(
    python,
    [
      "workers/enterprise_worker.py",
      "weibo-actions-fixture",
      "--accounts",
      "test/fixtures/weibo-source-accounts.json",
      "--posts",
      "test/fixtures/weibo-action-posts.jsonl",
      "--event-id",
      "event-1",
      "--now",
      "2026-06-10T12:00:00Z"
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

  const officialPost = payload.posts.find((post) => post.external_id === "p-official");
  assert.equal(officialPost.source_type, "official");
  assert.equal(officialPost.source_match_method, "stable_id");
  assert.equal(officialPost.source_match_confidence, 1);
  assert.equal(typeof officialPost.content_fingerprint, "string");

  const displayFallbackPost = payload.posts.find((post) => post.external_id === "p-display");
  assert.equal(displayFallbackPost.source_type, "media");
  assert.equal(displayFallbackPost.source_match_method, "display_name");
  assert.equal(displayFallbackPost.source_match_confidence < officialPost.source_match_confidence, true);

  const officialAction = payload.actions.find((action) => action.source === "official_observed");
  assert.equal(officialAction.confirmation_status, "pending");
  assert.equal(officialAction.observed_at, "2026-06-10T08:00:00Z");
  assert.equal(officialAction.effective_at, "2026-06-10T08:00:00Z");
  assert.equal(officialAction.source_account_external_id, "u-official");

  const matrixAction = payload.actions.find((action) => action.source === "matrix_inferred");
  assert.equal(matrixAction.confirmation_status, "pending");
  assert.equal(matrixAction.related_post_ids.length, 3);
  assert.equal(matrixAction.confidence > 0, true);

  const suggested = payload.actions.find((action) => action.source === "agent_recommended");
  assert.equal(suggested.confirmation_status, "pending");
  assert.equal(suggested.related_event_id, "event-1");
  assert.equal(suggested.confirmed_at, null);

  const confirmed = payload.actions.find((action) => action.source === "user_confirmed");
  assert.notEqual(confirmed.id, suggested.id);
  assert.equal(confirmed.confirmation_status, "confirmed");
  assert.equal(confirmed.confirmed_at, "2026-06-10T12:00:00Z");
  assert.equal(confirmed.effective_at, "2026-06-10T08:00:00Z");
});
