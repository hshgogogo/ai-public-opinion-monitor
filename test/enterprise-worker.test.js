import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

test("enterprise worker reports allowed real platforms only", () => {
  const result = spawnSync(python, ["workers/enterprise_worker.py", "health"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.platforms, ["xiaohongshu", "douyin", "weibo"]);
  assert.equal(payload.platforms.includes("Reddit"), false);
  assert.equal(payload.platforms.includes("Bilibili"), false);
  assert.equal(payload.platforms.includes("News"), false);
});
