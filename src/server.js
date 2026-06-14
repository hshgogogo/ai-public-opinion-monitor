import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
if (process.env.YUQING_SKIP_ENV_FILE !== "1") {
  loadEnvFile(join(rootDir, ".env"));
}
const publicDir = join(rootDir, "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const defaultPythonBin = "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const defaultWorkerScript = "workers/enterprise_worker.py";
const publicAgentLoopModes = new Set(["manual", "scheduled", "after_collection"]);

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
    if (url.pathname === "/api/weibo/comments" && request.method === "GET") return weiboWorker(request, response, "weibo-comments");
    if (url.pathname === "/api/weibo/comments/analyze" && request.method === "POST") return weiboWorker(request, response, "weibo-comments-analyze");
    if (url.pathname === "/api/weibo/analyses" && request.method === "GET") return weiboWorker(request, response, "weibo-analyses");
    if (url.pathname === "/api/weibo/events" && request.method === "GET") return weiboWorker(request, response, "weibo-events");
    const eventMatch = url.pathname.match(/^\/api\/weibo\/events\/([^/]+)$/);
    if (eventMatch && request.method === "GET") return weiboWorker(request, response, "weibo-events", "--event-id", eventMatch[1]);
    if (url.pathname === "/api/weibo/actions/pending" && request.method === "GET") return weiboWorker(request, response, "weibo-actions-pending");
    const actionConfirmationMatch = url.pathname.match(/^\/api\/weibo\/actions\/([^/]+)\/confirmation$/);
    if (actionConfirmationMatch && request.method === "PATCH") return weiboWorker(request, response, "weibo-action-confirm", "--action-id", actionConfirmationMatch[1]);
    const actionBacktestMatch = url.pathname.match(/^\/api\/weibo\/actions\/([^/]+)\/backtest$/);
    if (actionBacktestMatch && request.method === "POST") return weiboWorker(request, response, "weibo-action-backtest", "--action-id", actionBacktestMatch[1]);
    if (url.pathname === "/api/weibo/feedback" && request.method === "POST") return feedbackWorker(request, response);
    if (url.pathname === "/api/weibo/bot/messages" && request.method === "POST") return weiboWorker(request, response, "weibo-bot-message");
    if (url.pathname === "/api/weibo/agent-loop/run" && request.method === "POST") return runAgentLoop(request, response);
    const agentRunMatch = url.pathname.match(/^\/api\/weibo\/agent-runs\/([^/]+)$/);
    if (agentRunMatch && request.method === "GET") return agentLoopStatus(request, response, agentRunMatch[1]);
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
  const payload = ["GET", "HEAD"].includes(request.method || "") ? queryPayload(request) : await readJson(request);
  const result = await worker(command, ...args, "--payload-json", JSON.stringify(payload));
  sendJson(response, withoutWorkerStderr(result), statusFor(result));
}

async function feedbackWorker(request, response) {
  const { payload, error } = await readFeedbackPayload(request);
  if (error) return sendJson(response, error, 400);
  const result = withoutWorkerStderr(await worker("weibo-feedback", "--payload-json", JSON.stringify(payload)));
  sendJson(response, result, feedbackStatusFor(result));
}

async function runAgentLoop(request, response) {
  const { payload, error } = await readAgentLoopPayload(request);
  if (error) return sendJson(response, error, 400);

  const projectId = optionalPositiveInteger(payload.projectId);
  if (payload.projectId !== undefined && projectId === null) {
    return sendJson(response, agentLoopError(
      "invalid_project_id",
      "Agent Loop run requires a valid projectId.",
      "The public payload projectId must be a positive integer when provided.",
      "Pass a positive integer projectId or omit it to use the default project."
    ), 400);
  }

  const targetId = optionalPositiveInteger(payload.targetId);
  if (payload.targetId !== undefined && targetId === null) {
    return sendJson(response, agentLoopError(
      "invalid_agent_loop_payload",
      "Agent Loop run targetId is invalid.",
      "The public payload targetId must be a positive integer when provided.",
      "Pass a positive integer targetId or omit it."
    ), 400);
  }

  const mode = payload.mode ?? "manual";
  if (!publicAgentLoopModes.has(mode)) {
    return sendJson(response, agentLoopError(
      "invalid_agent_loop_mode",
      "Agent Loop mode is not public.",
      "The public API only accepts manual, scheduled, or after_collection.",
      "Use one of manual, scheduled, or after_collection."
    ), 400);
  }

  if (payload.input !== undefined && !isPlainObject(payload.input)) {
    return sendJson(response, agentLoopError(
      "invalid_agent_loop_payload",
      "Agent Loop input must be a JSON object.",
      `Received ${Array.isArray(payload.input) ? "array" : typeof payload.input}.`,
      "Pass input as a JSON object or omit it."
    ), 400);
  }

  const workerPayload = { triggerMode: mode };
  if (projectId !== undefined && projectId !== null) workerPayload.projectId = projectId;
  if (targetId !== undefined && targetId !== null) workerPayload.targetId = targetId;
  if (payload.input !== undefined) workerPayload.input = payload.input;

  const result = await worker("weibo-agent-loop-run", "--payload-json", JSON.stringify(workerPayload));
  sendJson(response, agentLoopRunResponse(result), agentLoopStatusFor(result));
}

async function agentLoopStatus(request, response, id) {
  const loopRunId = positiveInteger(id);
  if (loopRunId === null) {
    return sendJson(response, agentLoopError(
      "invalid_agent_run_id",
      "Agent Loop run id is invalid.",
      "The path id must be a positive integer.",
      "Retry with an agentLoopRunId returned by POST /api/weibo/agent-loop/run."
    ), 400);
  }

  const payload = queryPayload(request);
  const projectId = optionalPositiveInteger(payload.projectId);
  if (payload.projectId !== undefined && projectId === null) {
    return sendJson(response, agentLoopError(
      "invalid_project_id",
      "Agent Loop status requires a valid projectId.",
      "The query projectId must be a positive integer when provided.",
      "Pass a positive integer projectId or omit it to use the default project."
    ), 400);
  }

  const workerPayload = { loopRunId };
  if (projectId !== undefined && projectId !== null) workerPayload.projectId = projectId;

  const result = await worker("weibo-agent-loop-status", "--payload-json", JSON.stringify(workerPayload));
  sendJson(response, agentLoopStatusResponse(result), agentLoopStatusFor(result));
}

function queryPayload(request) {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  return Object.fromEntries(url.searchParams.entries());
}

function statusFor(payload) {
  if (payload?.error_type === "mysql_unavailable") return 503;
  if ([
    "invalid_feedback_source_type",
    "invalid_feedback_type",
    "invalid_feedback_source_id"
  ].includes(payload?.error_type)) return 400;
  if (payload?.error_type === "weibo_endpoint_pending_real_data_implementation") return 501;
  return 200;
}

function feedbackStatusFor(payload) {
  if (payload?.ok !== false) return 200;
  if (payload.error_type === "mysql_unavailable") return 503;
  if (payload.error_type === "weibo_endpoint_pending_real_data_implementation") return 501;
  if (payload.error_type === "project_not_found") return 400;
  if (String(payload.error_type || "").endsWith("_not_found")) return 404;
  if ([
    "invalid_feedback_payload",
    "invalid_feedback_project_id",
    "invalid_feedback_source_type",
    "invalid_feedback_type",
    "invalid_feedback_source_id"
  ].includes(payload.error_type)) return 400;
  return 500;
}

function agentLoopStatusFor(payload) {
  if (payload?.ok !== false) return 200;
  if (payload.error_type === "mysql_unavailable") return 503;
  if (["invalid_agent_loop_payload", "invalid_agent_run_id", "invalid_agent_loop_mode", "invalid_project_id", "project_not_found"].includes(payload.error_type)) return 400;
  if (payload.error_type === "agent_loop_not_found") return 404;
  return 500;
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
  const routePath = pathname === "/settings" ? "/settings.html" : pathname;
  const safePath = routePath === "/" ? "/index.html" : routePath;
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
    const workerBin = process.env.PYTHON_BIN || defaultPythonBin;
    const workerScript = process.env.ENTERPRISE_WORKER_SCRIPT || defaultWorkerScript;
    const child = spawn(workerBin, [workerScript, ...args], {
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
        resolve(workerInvalidJsonError());
      }
    });
  });
}

function workerInvalidJsonError() {
  return {
    ok: false,
    mode: "weibo-agent-mvp",
    error_type: "worker_invalid_json",
    message: "Worker returned invalid JSON.",
    cause: "The worker process did not return a parseable JSON payload.",
    fix: "Inspect local worker logs and retry after fixing the worker command."
  };
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function readFeedbackPayload(request) {
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload)) {
      return {
        error: agentLoopError(
          "invalid_feedback_payload",
          "Feedback payload must be a JSON object.",
          `Received ${Array.isArray(payload) ? "array" : typeof payload}.`,
          "Pass a JSON object request body."
        )
      };
    }
    return { payload };
  } catch (error) {
    return {
      error: agentLoopError(
        "invalid_feedback_payload",
        "Feedback payload must be valid JSON.",
        error.message,
        "Send a valid JSON object request body."
      )
    };
  }
}

async function readAgentLoopPayload(request) {
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload)) {
      return {
        error: agentLoopError(
          "invalid_agent_loop_payload",
          "Agent Loop payload must be a JSON object.",
          `Received ${Array.isArray(payload) ? "array" : typeof payload}.`,
          "Pass a JSON object request body."
        )
      };
    }
    return { payload };
  } catch (error) {
    return {
      error: agentLoopError(
        "invalid_agent_loop_payload",
        "Agent Loop payload must be valid JSON.",
        error.message,
        "Send a valid JSON object request body."
      )
    };
  }
}

function agentLoopRunResponse(payload) {
  const result = withoutWorkerStderr(payload);
  if (result?.ok === false) return result;
  const run = result?.run || {};
  return {
    ...result,
    agentLoopRunId: result.agentLoopRunId ?? run.id,
    status: result.status ?? run.status
  };
}

function agentLoopStatusResponse(payload) {
  const result = withoutWorkerStderr(payload);
  if (result?.ok === false) return result;
  const run = result?.run || {};
  const judgeReviews = result?.judgeReviews || [];
  const manualHandoffs = result?.manualHandoffs
    || (result?.feedbackItems || []).filter((item) => item.feedback_type === "manual_handoff" || item.feedbackType === "manual_handoff");
  const { feedbackItems, ...publicResult } = result;
  return {
    ...publicResult,
    agentLoopRunId: result.agentLoopRunId ?? run.id,
    status: result.status ?? run.status,
    currentStep: result.currentStep ?? run.current_step ?? run.currentStep ?? null,
    retryCount: result.retryCount ?? retryCountFrom(judgeReviews),
    manualHandoffs
  };
}

function retryCountFrom(judgeReviews) {
  return judgeReviews.reduce((max, item) => {
    const count = Number(item.retry_count ?? item.retryCount ?? 0);
    return Number.isFinite(count) && count > max ? count : max;
  }, 0);
}

function withoutWorkerStderr(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const { stderr, ...rest } = payload;
  return rest;
}

function agentLoopError(error_type, message, cause, fix) {
  return {
    ok: false,
    mode: "weibo-agent-mvp",
    error_type,
    message,
    cause,
    fix
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalPositiveInteger(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return positiveInteger(value);
}

function positiveInteger(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  return Number(value);
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
