import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("README documents Weibo MVP setup, fixture E2E, auth troubleshooting, and limitations in Chinese", () => {
  const readme = readFileSync("README.md", "utf8");

  for (const text of [
    "微博 MVP",
    "weibo-fixture-e2e",
    "MEDIACRAWLER_HOME",
    "MEDIACRAWLER_CDP_PORT",
    "WEIBO_COOKIE_FILE",
    "target_detail_unsupported",
    "real_weibo_auth_missing",
    "不启用小红书或抖音采集",
    "fixture 驱动的 MySQL 持久化",
    "MediaCrawler 微博 search/detail adapters",
    "tasks.md"
  ]) {
    assert.equal(readme.includes(text), true, text);
  }

  assert.equal(readme.includes("MySQL task 入库、DeepSeek 线上调用"), false);
});
