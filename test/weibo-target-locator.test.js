import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("validates a MediaCrawler-detail-compatible Weibo target locator", () => {
  const result = runLocator({
    platform: "weibo",
    target_type: "weibo_post",
    external_id: "1001",
    url: "https://weibo.com/artist/status/1001",
    weibo_mid: "m1001",
    author_external_id: "u100"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.detail_locator.platform, "weibo");
  assert.equal(payload.detail_locator.crawler_type, "detail");
  assert.equal(payload.detail_locator.weibo_mid, "m1001");
  assert.equal(payload.detail_locator.external_id, "1001");
});

test("rejects unsupported Weibo target locator with actionable error", () => {
  const result = runLocator({
    platform: "weibo",
    target_type: "weibo_topic",
    external_id: "topic-no-detail",
    url: "https://s.weibo.com/weibo?q=%E6%B5%B7%E5%B2%9B",
    raw_json: { title: "search-only target" }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.error_type, "target_detail_unsupported");
  assert.match(payload.message, /detail/i);
  assert.match(payload.fix, /weibo_mid|external_id|URL/i);
  assert.equal(payload.target_selected_state, "selected");
  assert.deepEqual(payload.preserved_locator.external_id, "topic-no-detail");
});

test("uses Weibo post external_id as detail fallback when mid and status URL are absent", () => {
  const result = runLocator({
    platform: "weibo",
    target_type: "weibo_post",
    external_id: "1001",
    url: "https://weibo.com/artist/not-status/1001"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.detail_locator.weibo_mid, "1001");
  assert.equal(payload.detail_locator.external_id, "1001");
});

function runLocator(locator) {
  return spawnSync(
    python,
    ["workers/enterprise_worker.py", "weibo-validate-target-locator", "--locator-json", JSON.stringify(locator)],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}
