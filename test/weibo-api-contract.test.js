import test from "node:test";
import assert from "node:assert/strict";
import { server } from "../src/server.js";

test("exposes explicit Weibo MVP API endpoints with safe no-database errors", async (t) => {
  const originalMysqlUrl = process.env.MYSQL_URL;
  process.env.MYSQL_URL = "";
  t.after(() => {
    if (originalMysqlUrl === undefined) delete process.env.MYSQL_URL;
    else process.env.MYSQL_URL = originalMysqlUrl;
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const cases = [
    ["POST", "/api/weibo/discovery", { keyword: "刘昊然" }],
    ["GET", "/api/weibo/targets"],
    ["POST", "/api/weibo/targets/select", { targetId: "target-1" }],
    ["POST", "/api/weibo/targets/ignore", { targetId: "target-1" }],
    ["POST", "/api/weibo/targets/target-1/collect-comments", {}],
    ["GET", "/api/weibo/comments"],
    ["POST", "/api/weibo/comments/analyze", {}],
    ["GET", "/api/weibo/events"],
    ["GET", "/api/weibo/events/event-1"],
    ["GET", "/api/weibo/actions/pending"],
    ["PATCH", "/api/weibo/actions/action-1/confirmation", { confirmationStatus: "rejected" }],
    ["POST", "/api/weibo/actions/action-1/backtest", {}],
    ["POST", "/api/weibo/bot/messages", { question: "微博负面为什么升高？" }]
  ];

  for (const [method, path, body] of cases) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json();

    assert.notEqual(response.status, 404, `${method} ${path} must be an explicit endpoint`);
    assert.equal(response.status, 503, `${method} ${path} should be blocked locally by MySQL, not fake data`);
    assert.equal(payload.mode, "weibo-agent-mvp");
    assert.equal(payload.error_type, "mysql_unavailable");
    assert.match(payload.fix, /MYSQL_URL|MySQL/);
  }
});
