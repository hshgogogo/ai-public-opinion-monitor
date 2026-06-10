import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(join(rootDir, ".env"));
const publicDir = join(rootDir, "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const pythonBin = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/health") return sendJson(response, await worker("health"));
    if (url.pathname === "/api/snapshot") return sendJson(response, await worker("snapshot"));
    if (url.pathname === "/api/weibo/workbench" && request.method === "GET") return weiboWorker(request, response, "weibo-workbench");
    if (url.pathname === "/api/weibo/discovery" && request.method === "POST") return weiboWorker(request, response, "weibo-discovery");
    if (url.pathname === "/api/weibo/targets" && request.method === "GET") return weiboWorker(request, response, "weibo-targets");
    if (url.pathname === "/api/weibo/targets/select" && request.method === "POST") return weiboWorker(request, response, "weibo-target-select");
    if (url.pathname === "/api/weibo/targets/ignore" && request.method === "POST") return weiboWorker(request, response, "weibo-target-ignore");
    const targetCollectMatch = url.pathname.match(/^\/api\/weibo\/targets\/([^/]+)\/collect-comments$/);
    if (targetCollectMatch && request.method === "POST") return weiboWorker(request, response, "weibo-collect-target", "--target-id", targetCollectMatch[1]);
    if (url.pathname === "/api/weibo/events" && request.method === "GET") return weiboWorker(request, response, "weibo-events");
    const eventMatch = url.pathname.match(/^\/api\/weibo\/events\/([^/]+)$/);
    if (eventMatch && request.method === "GET") return weiboWorker(request, response, "weibo-events", "--event-id", eventMatch[1]);
    if (url.pathname === "/api/weibo/actions/pending" && request.method === "GET") return weiboWorker(request, response, "weibo-actions-pending");
    const actionConfirmationMatch = url.pathname.match(/^\/api\/weibo\/actions\/([^/]+)\/confirmation$/);
    if (actionConfirmationMatch && request.method === "PATCH") return weiboWorker(request, response, "weibo-action-confirm", "--action-id", actionConfirmationMatch[1]);
    const actionBacktestMatch = url.pathname.match(/^\/api\/weibo\/actions\/([^/]+)\/backtest$/);
    if (actionBacktestMatch && request.method === "POST") return weiboWorker(request, response, "weibo-action-backtest", "--action-id", actionBacktestMatch[1]);
    if (url.pathname === "/api/weibo/bot/messages" && request.method === "POST") return weiboWorker(request, response, "weibo-bot-message");
    if (url.pathname === "/api/stream") return stream(response);
    if (url.pathname === "/api/migrate" && request.method === "POST") return sendJson(response, await worker("migrate"));
    if (url.pathname === "/api/collect" && request.method === "POST") return collect(request, response);
    if (url.pathname === "/api/config" && request.method === "POST") return unsupported(response, "项目配置必须写入 MySQL，当前接口不再修改内存 mock 配置。");
    if (url.pathname === "/api/items" && request.method === "POST") return unsupported(response, "真实数据模式禁止手工注入测试舆情。请通过 /api/collect 采集或写入 MySQL。");
    return serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, enterpriseError(error), 500);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => {
    console.log(`企业级AI舆情监测系统已启动: http://${host}:${port}`);
  });
}

async function collect(request, response) {
  const payload = await readJson(request);
  const args = ["collect"];
  if (payload.projectId) args.push("--project-id", String(payload.projectId));
  if (payload.limit) args.push("--limit", String(payload.limit));
  const result = await worker(...args);
  sendJson(response, result, result.error_type === "legacy_collect_disabled" ? 410 : 200);
}

async function weiboWorker(request, response, command, ...args) {
  const payload = ["GET", "HEAD"].includes(request.method || "") ? {} : await readJson(request);
  const result = await worker(command, ...args, "--payload-json", JSON.stringify(payload));
  sendJson(response, result, statusFor(result));
}

function statusFor(payload) {
  if (payload?.error_type === "mysql_unavailable") return 503;
  if (payload?.error_type === "weibo_endpoint_pending_real_data_implementation") return 501;
  return 200;
}

function stream(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  let closed = false;
  const push = async () => {
    if (closed) return;
    const snapshot = await worker("snapshot");
    response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  };
  push();
  const timer = setInterval(push, 30000);
  response.on("close", () => {
    closed = true;
    clearInterval(timer);
  });
}

async function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) return sendJson(response, { error: "Forbidden" }, 403);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    sendJson(response, { error: "Not found" }, 404);
  }
}

async function worker(...args) {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, ["workers/enterprise_worker.py", ...args], {
      cwd: rootDir,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", () => {
      try {
        const payload = JSON.parse(stdout || "{}");
        if (stderr && !payload.stderr) payload.stderr = stderr;
        resolve(payload);
      } catch {
        resolve(enterpriseError(new Error(stderr || stdout || "Worker returned no JSON")));
      }
    });
  });
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function unsupported(response, message) {
  sendJson(response, { ok: false, error: message, mode: "real-data-only" }, 410);
}

function enterpriseError(error) {
  const now = new Date().toISOString();
  return {
    ok: false,
    error: error.message,
    generatedAt: now,
    enterprise: {
      mode: "real-data-only",
      database: { connected: false, error: error.message },
      allowedPlatforms: ["weibo"]
    },
    kpis: { totalMentions: 0, heat: 0, avgSentiment: 0, positiveRate: 0, negativeRate: 0, riskScore: 0 },
    sentimentCounts: {},
    sourceCounts: {},
    topicCounts: {},
    trend: [],
    forecast: [],
    topItems: [],
    strategy: { headline: "系统错误", summary: error.message, plays: [], evidence: [] },
    agents: [],
    events: [],
    rawItems: []
  };
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
}

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed
        .slice(index + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional; health endpoints will report missing configuration.
  }
}
