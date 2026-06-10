import test from "node:test";
import assert from "node:assert/strict";
import { server } from "../src/server.js";

test("serves enterprise health and real-data-only snapshot", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(Array.isArray(health.platforms), true);
  assert.deepEqual(health.platforms, ["weibo"]);

  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json());
  assert.equal(snapshot.enterprise.mode, "real-data-only");
  assert.deepEqual(snapshot.enterprise.allowedPlatforms, ["weibo"]);
  assert.equal(Object.keys(snapshot.sourceCounts).some((source) => ["News", "Bilibili", "Reddit"].includes(source)), false);
  assert.equal(JSON.stringify(snapshot.strategy).includes("小红书"), false);
  assert.equal(JSON.stringify(snapshot.strategy).includes("抖音"), false);
});

test("rejects mock item injection in enterprise mode", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${base}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ source: "News", content: "fake" }] })
  });
  const payload = await response.json();
  assert.equal(response.status, 410);
  assert.equal(payload.mode, "real-data-only");
}
);

test("legacy collect is safely rejected in Weibo MVP mode", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${base}/api/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1 })
  });
  const payload = await response.json();

  assert.equal(response.status, 410);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.error_type, "legacy_collect_disabled");
  assert.match(payload.fix, /\/api\/weibo\/discovery/);
});
