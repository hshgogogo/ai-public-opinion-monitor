const state = { workbench: null };

const els = {
  connectionDot: document.querySelector("#connectionDot"),
  connectionText: document.querySelector("#connectionText"),
  generatedAt: document.querySelector("#generatedAt"),
  partialState: document.querySelector("#partialState"),
  setupStatus: document.querySelector("#setupStatus"),
  judgments: document.querySelector("#judgments"),
  recommendedTargets: document.querySelector("#recommendedTargets"),
  events: document.querySelector("#events"),
  pendingActions: document.querySelector("#pendingActions"),
  dataGaps: document.querySelector("#dataGaps"),
  citations: document.querySelector("#citations"),
  lastAction: document.querySelector("#lastAction"),
  discoveryKeyword: document.querySelector("#discoveryKeyword"),
  botQuestion: document.querySelector("#botQuestion"),
  botAnswer: document.querySelector("#botAnswer")
};

document.querySelector("#runDiscovery").addEventListener("click", runDiscovery);
document.querySelector("#runMigrate").addEventListener("click", runMigrate);
document.querySelector("#sendBotMessage").addEventListener("click", askBot);
document.querySelector("#weiboWorkbench").addEventListener("click", handleWorkbenchAction);

refreshWorkbench();
window.setInterval(refreshWorkbench, 30000);

async function refreshWorkbench() {
  try {
    state.workbench = await fetchJson("/api/weibo/workbench");
    setConnection(true, "微博 Agent 就绪");
    renderWorkbench();
  } catch (error) {
    setConnection(false, "读取失败");
    els.lastAction.textContent = error.message;
  }
}

async function runDiscovery() {
  const keyword = els.discoveryKeyword.value.trim();
  if (!keyword) return;
  const result = await postJson("/api/weibo/discovery", { keyword });
  showActionResult(result);
  await refreshWorkbench();
}

async function runMigrate() {
  const result = await fetchJson("/api/migrate", { method: "POST" });
  showActionResult(result);
  await refreshWorkbench();
}

async function askBot() {
  const question = els.botQuestion.value.trim();
  if (!question) return;
  const result = await postJson("/api/weibo/bot/messages", { question });
  els.botAnswer.textContent = result.answer?.text || result.message || result.fix || "当前没有足够微博证据回答。";
  showActionResult(result);
}

async function handleWorkbenchAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, targetId, actionId } = button.dataset;
  if (action === "select-target") {
    showActionResult(await postJson("/api/weibo/targets/select", { targetId }));
  }
  if (action === "ignore-target") {
    showActionResult(await postJson("/api/weibo/targets/ignore", { targetId }));
  }
  if (action === "collect-comments") {
    showActionResult(await postJson(`/api/weibo/targets/${encodeURIComponent(targetId)}/collect-comments`, {}));
  }
  if (action === "confirm-action") {
    showActionResult(await patchJson(`/api/weibo/actions/${encodeURIComponent(actionId)}/confirmation`, { confirmationStatus: "confirmed" }));
  }
  if (action === "reject-action") {
    showActionResult(await patchJson(`/api/weibo/actions/${encodeURIComponent(actionId)}/confirmation`, { confirmationStatus: "rejected" }));
  }
  if (action === "uncertain-action") {
    showActionResult(await patchJson(`/api/weibo/actions/${encodeURIComponent(actionId)}/confirmation`, { confirmationStatus: "uncertain" }));
  }
  if (action === "partial-action") {
    showActionResult(await patchJson(`/api/weibo/actions/${encodeURIComponent(actionId)}/confirmation`, { confirmationStatus: "partial" }));
  }
  await refreshWorkbench();
}

function renderWorkbench() {
  const workbench = state.workbench;
  if (!workbench) return;
  els.generatedAt.textContent = new Date().toLocaleString();
  els.partialState.textContent = workbench.setup?.partialState || "unknown";
  renderSetup(workbench.setup || {});
  renderJudgments(workbench.judgments || []);
  renderTargets(workbench.recommendedTargets || []);
  renderEvents(workbench.events || []);
  renderActions(workbench.pendingActions || []);
  renderDataGaps(workbench.dataGaps || []);
  renderCitations(workbench.citations || []);
}

function renderSetup(setup) {
  const health = setup.health?.weiboMvp || {};
  const rows = [
    ["平台", setup.activePlatform || "weibo", "ok"],
    ["MySQL", health.database?.connected ? "已连接" : "未连接", health.database?.connected ? "ok" : "warn"],
    ["MediaCrawler", health.mediacrawler?.home?.ok ? "已配置" : "未配置", health.mediacrawler?.home?.ok ? "ok" : "warn"],
    ["Chrome CDP", health.cdp?.ok ? "可用" : "不可用", health.cdp?.ok ? "ok" : "warn"],
    ["微博登录", health.auth?.status || "unknown", health.auth?.error ? "warn" : "ok"]
  ];
  els.setupStatus.innerHTML = rows
    .map(([label, value, tone]) => `<div><strong>${escapeHtml(label)}</strong><span class="${tone}">${escapeHtml(value)}</span></div>`)
    .join("");
}

function renderJudgments(judgments) {
  els.judgments.innerHTML = judgments.length
    ? judgments.map((item) => `<section class="list-item"><strong>${escapeHtml(item.type || "判断")}</strong><p>${escapeHtml(item.summary || item.message || "")}</p></section>`).join("")
    : empty("暂无 Agent 判断。先完成微博发现、详情采集和分析。");
}

function renderTargets(targets) {
  els.recommendedTargets.innerHTML = targets.length
    ? targets.map(targetCard).join("")
    : empty("暂无推荐采集目标。配置真实环境后创建微博发现任务。");
}

function targetCard(target) {
  const meta = target.recommendation_metadata || target.recommendation || {};
  const targetId = target.targetId || target.target_id || target.external_id || "";
  const expectedQuestion = meta.expected_question_answered || meta.expectedQuestionAnswered || target.expected_question_answered || target.expectedQuestionAnswered || "采集后确认评论关注点。";
  const rank = target.rank ?? target.platform_rank ?? target.platformRank ?? "-";
  const hotScore = target.hot_score ?? target.hotScore ?? "-";
  const reason = meta.reason || target.recommendationReason || target.recommendation_reason || "等待更多微博证据。";
  return `
    <section class="list-item target-card">
      <div>
        <strong>${escapeHtml(target.title || target.summary || targetId || "微博目标")}</strong>
        <p>${escapeHtml(target.summary || reason)}</p>
        <p class="meta">ID ${escapeHtml(targetId || "-")} · ${escapeHtml(target.author_name || target.author || "未知账号")} · 排名 ${escapeHtml(String(rank))} · 热度 ${escapeHtml(String(hotScore))} · 置信度 ${escapeHtml(String(meta.confidence ?? target.confidence ?? "-"))}</p>
        <p class="meta">推荐理由：${escapeHtml(reason)}</p>
        <p class="meta">预期回答：${escapeHtml(expectedQuestion)}</p>
        ${target.url ? `<a href="${escapeAttr(target.url)}" target="_blank" rel="noreferrer">打开微博证据</a>` : ""}
      </div>
      <div class="button-row">
        <button data-action="select-target" data-target-id="${escapeAttr(targetId)}">选择</button>
        <button class="secondary" data-action="ignore-target" data-target-id="${escapeAttr(targetId)}">忽略</button>
        <button class="secondary" data-action="collect-comments" data-target-id="${escapeAttr(targetId)}">采评论</button>
      </div>
    </section>
  `;
}

function renderEvents(events) {
  els.events.innerHTML = events.length
    ? events.map(eventCard).join("")
    : empty("暂无微博事件或观察线索。");
}

function eventCard(event) {
  const timeline = event.timeline || [];
  const evidenceIds = event.evidence_ids || event.evidenceIds || [];
  const recommendedActions = event.recommended_actions || event.recommendedActions || [];
  const impactAssessment = event.impact_assessment || event.impactAssessment || event.summary || "";
  return `
    <section class="list-item">
      <strong>${escapeHtml(event.title || event.issue_key || event.id || "微博事件")}</strong>
      <p>${escapeHtml(event.trigger_summary || event.summary || event.status || "")}</p>
      <p class="meta">状态 ${escapeHtml(event.status || "observation")} · 风险 ${escapeHtml(event.risk_level || "unknown")}</p>
      <p class="meta">时间线：${escapeHtml(formatList(timeline))}</p>
      <p class="meta">影响判断：${escapeHtml(impactAssessment || "暂无影响判断")}</p>
      <p class="meta">建议行动：${escapeHtml(formatList(recommendedActions))}</p>
      <p class="meta">证据：${escapeHtml(formatList(evidenceIds))}</p>
    </section>
  `;
}

function renderActions(actions) {
  els.pendingActions.innerHTML = actions.length
    ? actions.map((action) => {
        const actionId = action.action_id || action.id || "";
        return `<section class="list-item"><strong>${escapeHtml(action.action_type || action.source || "待确认行动")}</strong><p>${escapeHtml(action.reason || action.content_summary || "")}</p><p class="meta">状态 ${escapeHtml(action.confirmation_status || action.confirmationStatus || "pending")} · 平台 ${escapeHtml(action.platform || "weibo")}</p><div class="button-row"><button data-action="confirm-action" data-action-id="${escapeAttr(actionId)}">确认</button><button class="secondary" data-action="reject-action" data-action-id="${escapeAttr(actionId)}">驳回</button><button class="secondary" data-action="uncertain-action" data-action-id="${escapeAttr(actionId)}">不确定</button><button class="secondary" data-action="partial-action" data-action-id="${escapeAttr(actionId)}">部分执行</button></div></section>`;
      }).join("")
    : empty("暂无待确认微博行动。");
}

function renderDataGaps(gaps) {
  els.dataGaps.innerHTML = gaps.length
    ? gaps.map((gap) => `<section class="list-item data-gap"><strong>${escapeHtml(gap.code || "data_gap")}</strong><p>${escapeHtml(gap.message || "")}</p><p class="meta">${escapeHtml(gap.nextAction || "")}</p></section>`).join("")
    : empty("当前没有已知数据缺口。");
}

function renderCitations(citations) {
  els.citations.innerHTML = citations.length
    ? citations.map((citation) => `<section class="list-item"><strong>${escapeHtml(citation.id || citation.source_id || "source")}</strong><p>${escapeHtml(citation.type || citation.label || "")}</p></section>`).join("")
    : empty("暂无可引用证据。");
}

function showActionResult(result) {
  els.lastAction.textContent = result.ok === false
    ? `${result.error_type || "blocked"}：${result.fix || result.message || "操作未完成"}`
    : "操作已提交，等待真实数据链路处理。";
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function patchJson(url, body) {
  return fetchJson(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok && !payload.error_type) throw new Error(payload.error || response.statusText);
  return payload;
}

function empty(message) {
  return `<section class="list-item empty"><p>${escapeHtml(message)}</p></section>`;
}

function formatList(value) {
  if (!value) return "暂无";
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : item.id || item.title || item.action_type || JSON.stringify(item)).join(" / ") || "暂无";
  return String(value);
}

function setConnection(online, text) {
  els.connectionDot.classList.toggle("online", online);
  els.connectionText.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
