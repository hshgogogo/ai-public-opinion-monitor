import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("README documents Weibo MVP setup, fixture E2E, auth troubleshooting, and limitations", () => {
  const readme = readFileSync("README.md", "utf8");

  for (const text of [
    "Weibo MVP",
    "weibo-fixture-e2e",
    "MEDIACRAWLER_HOME",
    "MEDIACRAWLER_CDP_PORT",
    "WEIBO_COOKIE_FILE",
    "target_detail_unsupported",
    "real_weibo_auth_missing",
    "No Xiaohongshu or Douyin collection",
    "fixture-driven MySQL persistence",
    "MediaCrawler Weibo search/detail adapters",
    "tasks.md"
  ]) {
    assert.equal(readme.includes(text), true, text);
  }

  assert.equal(readme.includes("MySQL task 入库、DeepSeek 线上调用"), false);
});
