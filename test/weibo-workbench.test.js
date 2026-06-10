import test from "node:test";
import assert from "node:assert/strict";
import { server } from "../src/server.js";

test("returns mysql_unavailable for Weibo workbench when MySQL is unavailable", async (t) => {
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

  const response = await fetch(`${base}/api/weibo/workbench`);
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.mode, "weibo-agent-mvp");
  assert.equal(payload.error_type, "mysql_unavailable");
  assert.match(payload.fix, /MYSQL_URL|MySQL/);
});
