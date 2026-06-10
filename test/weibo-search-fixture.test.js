import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("parses Weibo search fixture into top 10 recommended targets with locators", () => {
  const result = spawnSync(
    python,
    ["workers/enterprise_worker.py", "weibo-parse-search-fixture", "--fixture", "test/fixtures/weibo-search.jsonl", "--limit", "10"],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.targets.length, 10);

  const [top] = payload.targets;
  assert.equal(top.platform, "weibo");
  assert.equal(top.rank, 1);
  assert.equal(top.external_id, "1004");
  assert.equal(top.recommendation_metadata.state, "not_recommended");
  assert.equal(typeof top.content_fingerprint, "string");
  assert.equal(top.content_fingerprint.length > 10, true);
  assert.equal(top.hot_score > payload.targets.at(-1).hot_score, true);

  assert.equal(payload.targets.some((target) => target.external_id === "1011"), false);
  const recommended = payload.targets.find((target) => target.external_id === "1001");
  assert.equal(recommended.weibo_mid, "m1001");
  assert.equal(recommended.author_external_id, "u100");
  assert.equal(recommended.target_locator.platform, "weibo");
  assert.equal(recommended.target_locator.weibo_mid, "m1001");
  assert.equal(recommended.target_locator.author_external_id, "u100");
  assert.equal(recommended.recommendation_metadata.state, "recommended");
  assert.equal(recommended.recommendation_metadata.target_id, "1001");
  assert.match(recommended.recommendation_metadata.reason, /海岛舒服日志|刘昊然|李兰迪/);
  assert.equal(typeof recommended.recommendation_metadata.expected_question_answered, "string");
  assert.equal(recommended.recommendation_metadata.confidence > top.recommendation_metadata.confidence, true);
});
