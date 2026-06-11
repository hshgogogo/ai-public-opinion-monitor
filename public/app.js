const state = {
  workbench: null,
  pendingActionConfirmation: null,
  submittingActionIds: new Set()
};

const els = {
  connectionDot: document.querySelector("#connectionDot"),
  connectionText: document.querySelector("#connectionText"),
  generatedAt: document.querySelector("#generatedAt"),
  partialState: document.querySelector("#partialState"),
  setupStatus: document.querySelector("#setupStatus"),
  nextStep: document.querySelector("#nextStep"),
  targetCount: document.querySelector("#targetCount"),
  eventCount: document.querySelector("#eventCount"),
  actionCount: document.querySelector("#actionCount"),
  gapCount: document.querySelector("#gapCount"),
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

document.querySelector("#runDiscovery")?.addEventListener("click", runDiscovery);
document.querySelector("#runMigrate")?.addEventListener("click", runMigrate);
document.querySelector("#sendBotMessage")?.addEventListener("click", askBot);
document.querySelector("#weiboWorkbench")?.addEventListener("click", handleWorkbenchAction);
document.querySelector("body")?.addEventListener("click", handlePageAction);

refreshWorkbench();
window.setInterval(refreshWorkbench, 30000);

async function refreshWorkbench() {
  try {
    state.workbench = await fetchJson("/api/weibo/workbench");
    const blocked = state.workbench?.ok === false || Boolean(state.workbench?.error_type);
    setConnection(!blocked, blocked ? "依赖未就绪" : "微博 Agent 就绪");
    renderWorkbench();
  } catch (error) {
    setConnection(false, "读取失败");
    setText(els.lastAction, error.message);
  }
}

async function runDiscovery() {
  const keyword = els.discoveryKeyword?.value.trim();
  if (!keyword) return;
  await withBusy(document.querySelector("#runDiscovery"), "创建发现任务", async () => {
    const result = await postJson("/api/weibo/discovery", { keyword });
    showActionResult(result, "发现任务");
    await refreshWorkbench();
  });
}

async function runMigrate() {
  await withBusy(document.querySelector("#runMigrate"), "初始化数据库结构", async () => {
    const result = await fetchJson("/api/migrate", { method: "POST" });
    showActionResult(result, "初始化数据库结构");
    await refreshWorkbench();
  });
}

async function askBot() {
  const question = els.botQuestion?.value.trim();
  if (!question) return;
  await withBusy(document.querySelector("#sendBotMessage"), "证据问答", async () => {
    const result = await postJson("/api/weibo/bot/messages", { question });
    setText(els.botAnswer, result.answer?.text || result.message || result.fix || "当前没有足够微博证据回答。");
    showActionResult(result, "证据问答");
  });
}

async function handleWorkbenchAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, targetId, actionId } = button.dataset;
  if (action === "select-target") {
    await withBusy(button, "选择目标", async () => {
      showActionResult(await postJson("/api/weibo/targets/select", { targetId }), "选择目标");
      await refreshWorkbench();
    });
    return;
  }
  if (action === "ignore-target") {
    await withBusy(button, "忽略目标", async () => {
      showActionResult(await postJson("/api/weibo/targets/ignore", { targetId }), "忽略目标");
      await refreshWorkbench();
    });
    return;
  }
  if (action === "collect-comments") {
    await withBusy(button, "采集评论", async () => {
      await postJson("/api/weibo/targets/select", { targetId });
      showActionResult(await postJson(`/api/weibo/targets/${encodeURIComponent(targetId)}/collect-comments`, {}), `采集评论 ${targetId || ""}`);
      await refreshWorkbench();
    });
    return;
  }
  if (["confirm-action", "reject-action", "uncertain-action", "partial-action"].includes(action)) {
    if (state.submittingActionIds.has(String(actionId))) return;
    const statusByAction = {
      "confirm-action": "confirmed",
      "reject-action": "rejected",
      "uncertain-action": "uncertain",
      "partial-action": "partial"
    };
    const status = statusByAction[action];
    state.pendingActionConfirmation = { actionId, status };
    renderActions(state.workbench?.pendingActions || []);
    return;
  }
  if (action === "cancel-confirmation") {
    state.pendingActionConfirmation = null;
    renderActions(state.workbench?.pendingActions || []);
    return;
  }
  if (action === "apply-confirmation") {
    if (state.submittingActionIds.has(String(actionId))) return;
    const status = button.dataset.status;
    const note = document.querySelector(`[data-confirm-note="${CSS.escape(actionId)}"]`)?.value.trim();
    state.submittingActionIds.add(String(actionId));
    renderActions(state.workbench?.pendingActions || []);
    await withBusy(button, confirmationLabel(status), async () => {
      try {
        showActionResult(await patchJson(`/api/weibo/actions/${encodeURIComponent(actionId)}/confirmation`, {
          confirmationStatus: status,
          note
        }), confirmationLabel(status));
        state.pendingActionConfirmation = null;
        await refreshWorkbench();
      } finally {
        state.submittingActionIds.delete(String(actionId));
        renderActions(state.workbench?.pendingActions || []);
      }
    });
    return;
  }
}

function handlePageAction(event) {
  const button = event.target.closest("button[data-scroll-target], button[data-run-discovery]");
  if (!button) return;
  if (button.dataset.runDiscovery) {
    runDiscovery();
    return;
  }
  document.querySelector(button.dataset.scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderWorkbench() {
  const workbench = state.workbench;
  if (!workbench) return;
  const dataGaps = dataGapsFor(workbench);
  setText(els.generatedAt, new Date().toLocaleString());
  setText(els.partialState, workbench.setup?.partialState || "unknown");
  renderOverview(workbench, dataGaps);
  renderSetup(workbench.setup || {});
  renderJudgments(workbench.judgments || []);
  renderTargets(workbench.recommendedTargets || []);
  renderEvents(workbench.events || []);
  renderActions(workbench.pendingActions || []);
  renderDataGaps(dataGaps);
  renderCitations(workbench.citations || []);
}

function dataGapsFor(workbench) {
  const gaps = workbench.dataGaps || [];
  if (!workbench.error_type) return gaps;
  return [
    {
      code: workbench.error_type,
      message: workbench.message || "微博工作台暂时不可用。",
      nextAction: workbench.fix || workbench.cause || "先补齐依赖，再继续微博工作流。"
    },
    ...gaps
  ];
}

function renderOverview(workbench, dataGaps) {
  const targets = workbench.recommendedTargets || [];
  const events = workbench.events || [];
  const actions = workbench.pendingActions || [];
  const gaps = dataGaps || [];
  const highRiskEvents = events.filter((event) => ["critical", "high"].includes(event.risk_level)).length;
  const blockingGaps = gaps.filter(isBlockingGap).length;
  setText(els.targetCount, targets.length);
  setText(els.eventCount, highRiskEvents ? `${events.length}/${highRiskEvents}高` : events.length);
  setText(els.actionCount, actions.length);
  setText(els.gapCount, blockingGaps ? `${gaps.length}/${blockingGaps}阻断` : gaps.length);
  setHtml(els.nextStep, nextStepCard(workbench, targets, events, actions, gaps));
}

function nextStepCard(workbench, targets, events, actions, gaps) {
  const blockingGap = gaps.find(isBlockingGap);
  if (blockingGap) {
    return stepMarkup({
      title: "补齐依赖",
      summary: blockingGap.message || blockingGap.code,
      action: blockingGap.nextAction || "先修复依赖状态，再创建微博发现任务。",
      tone: "warn",
      ctaLabel: "查看缺口",
      scrollTarget: "#dataGaps"
    });
  }
  if (!targets.length) {
    return stepMarkup({
      title: "发现目标",
      summary: "当前没有推荐采集目标。",
      action: "用左侧关键词创建微博发现任务。",
      tone: "neutral",
      ctaLabel: "创建发现任务",
      runDiscovery: true
    });
  }
  if (!events.length) {
    return stepMarkup({
      title: "采集评论",
      summary: "已有目标，但还没有形成事件或线索。",
      action: "先处理推荐目标，再进入分析和事件判断。",
      tone: "neutral",
      ctaLabel: "查看推荐目标",
      scrollTarget: "#recommendedTargets"
    });
  }
  if (actions.length) {
    return stepMarkup({
      title: "确认行动",
      summary: `${actions.length} 条行动等待人工确认。`,
      action: "确认真实动作后再做回测，不把建议当执行。",
      tone: "ok",
      ctaLabel: "处理待确认行动",
      scrollTarget: "#pendingActions"
    });
  }
  if (gaps.length) {
    return stepMarkup({
      title: "处理缺口",
      summary: `${gaps.length} 个数据缺口影响判断。`,
      action: "先补齐缺口，再生成更可靠的问答和报告。",
      tone: "warn",
      ctaLabel: "查看缺口",
      scrollTarget: "#dataGaps"
    });
  }
  return stepMarkup({
    title: "查看证据",
    summary: stateLabel(workbench.setup?.partialState || "微博链路已更新。"),
    action: "检查事件、引用和问答结果。",
    tone: "ok",
    ctaLabel: "查看证据引用",
    scrollTarget: "#citations"
  });
}

function stepMarkup({ title, summary, action, tone, ctaLabel, scrollTarget, runDiscovery }) {
  return `
    <section class="step-card ${escapeAttr(tone)}">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(summary || "")}</p>
      <span>${escapeHtml(action || "")}</span>
      ${ctaLabel ? `<button class="step-cta" ${runDiscovery ? "data-run-discovery=\"1\"" : `data-scroll-target="${escapeAttr(scrollTarget)}"`}>${escapeHtml(ctaLabel)}</button>` : ""}
    </section>
  `;
}

function renderSetup(setup) {
  if (!els.setupStatus) return;
  const health = setup.health?.weiboMvp || {};
  const rows = [
    ["平台", platformLabel(setup.activePlatform || "weibo"), "ok"],
    ["MySQL", health.database?.connected ? "已连接" : "未连接", health.database?.connected ? "ok" : "warn"],
    ["MediaCrawler", health.mediacrawler?.home?.ok ? "已配置" : "未配置", health.mediacrawler?.home?.ok ? "ok" : "warn"],
    ["Chrome CDP", health.cdp?.ok ? "可用" : "不可用", health.cdp?.ok ? "ok" : "warn"],
    ["微博登录", stateLabel(health.auth?.status || "unknown"), health.auth?.error ? "warn" : "ok"]
  ];
  setHtml(els.setupStatus, rows
    .map(([label, value, tone]) => `<div><strong>${escapeHtml(label)}</strong><span class="${tone}">${escapeHtml(value)}</span></div>`)
    .join(""));
}

function renderJudgments(judgments) {
  setHtml(els.judgments, judgments.length
    ? judgments.map((item) => `<section class="list-item"><strong>${escapeHtml(item.type || "判断")}</strong><p>${escapeHtml(item.summary || item.message || "")}</p></section>`).join("")
    : empty({ title: "暂无 Agent 判断", message: "先完成微博发现、详情采集和分析。", actionLabel: "查看推荐目标", scrollTarget: "#recommendedTargets" }));
}

function renderTargets(targets) {
  setHtml(els.recommendedTargets, targets.length
    ? targets.map(targetCard).join("")
    : empty({ title: "还没有推荐目标", message: "到后台设置里用关键词创建微博发现任务。", actionLabel: "去后台设置", href: "/settings" }));
}

function targetCard(target) {
  const meta = target.recommendation_metadata || target.recommendation || {};
  const targetId = target.external_id || target.targetId || target.target_id || "";
  const internalId = target.targetId || target.target_id || target.id || "";
  const expectedQuestion = meta.expected_question_answered || meta.expectedQuestionAnswered || target.expected_question_answered || target.expectedQuestionAnswered || "采集后确认评论关注点。";
  const rank = target.rank ?? target.platform_rank ?? target.platformRank ?? "-";
  const hotScore = target.hot_score ?? target.hotScore ?? "-";
  const reason = meta.reason || target.recommendationReason || target.recommendation_reason || "等待更多微博证据。";
  const confidence = meta.confidence ?? target.confidence ?? "-";
  return `
    <section class="list-item target-card">
      <div>
        <strong>${escapeHtml(target.title || target.summary || targetId || "微博目标")}</strong>
        <p>${escapeHtml(target.summary || reason)}</p>
        <div class="chip-row">
          ${chip(`排名 ${rank}`, "neutral")}
          ${chip(`热度 ${hotScore}`, "hot")}
          ${chip(`置信 ${confidence}`, "trust")}
          ${chip(stateLabel(target.selected_status || "pending"), "neutral")}
        </div>
        <p class="meta strong-meta">推荐理由：${escapeHtml(reason)}</p>
        <p class="meta">预期回答：${escapeHtml(expectedQuestion)}</p>
        <p class="meta">微博 ID ${escapeHtml(target.external_id || "-")} · 记录 ${escapeHtml(String(internalId || "-"))} · ${escapeHtml(target.author_name || target.author || "未知账号")}</p>
        ${target.url ? `<a href="${escapeAttr(target.url)}" target="_blank" rel="noreferrer">打开微博证据</a>` : ""}
      </div>
      <div class="button-row">
        <button data-action="collect-comments" data-target-id="${escapeAttr(targetId)}">采评论</button>
        <button class="secondary" data-action="select-target" data-target-id="${escapeAttr(targetId)}">选择</button>
        <button class="secondary" data-action="ignore-target" data-target-id="${escapeAttr(targetId)}">忽略</button>
      </div>
    </section>
  `;
}

function renderEvents(events) {
  setHtml(els.events, events.length
    ? events.map(eventCard).join("")
    : empty({ title: "还没有形成事件", message: "先选择目标并采集评论；分析后达到证据阈值才会生成事件。", actionLabel: "查看推荐目标", scrollTarget: "#recommendedTargets" }));
}

function eventCard(event) {
  const timeline = event.timeline || [];
  const evidenceIds = event.evidence_ids || event.evidenceIds || [];
  const recommendedActions = event.recommended_actions || event.recommendedActions || [];
  const impactAssessment = event.impact_assessment || event.impactAssessment || event.summary || "";
  const risk = event.risk_level || "unknown";
  return `
    <section class="list-item">
      <div class="card-head">
        <strong>${escapeHtml(event.title || event.issue_key || event.id || "微博事件")}</strong>
        ${riskChip(risk)}
      </div>
      <p>${escapeHtml(event.trigger_summary || event.summary || event.status || "")}</p>
      <p class="meta">状态 ${escapeHtml(stateLabel(event.status || "observation"))}</p>
      <p class="meta">时间线：${escapeHtml(formatList(timeline))}</p>
      <p class="meta">影响判断：${escapeHtml(impactAssessment || "暂无影响判断")}</p>
      <p class="meta">建议行动：${escapeHtml(formatList(recommendedActions))}</p>
      <p class="meta">证据：${escapeHtml(formatList(evidenceIds))}</p>
    </section>
  `;
}

function renderActions(actions) {
  setHtml(els.pendingActions, actions.length
    ? actions.map(actionCard).join("")
    : empty({ title: "暂无待确认行动", message: "Agent 建议会先进入人工队列；这里为空时，不代表已经执行任何外部动作。" }));
}

function actionCard(action) {
  const actionId = action.action_id || action.id || "";
  const evidenceIds = action.evidence_ids || action.evidenceIds || [];
  const status = action.confirmation_status || action.confirmationStatus || "pending";
  const pending = state.pendingActionConfirmation?.actionId === String(actionId);
  const pendingStatus = state.pendingActionConfirmation?.status || "confirmed";
  const submitting = state.submittingActionIds.has(String(actionId));
  return `
    <section class="list-item action-card ${submitting ? "submitting" : ""}">
      <div class="card-head">
        <strong>${escapeHtml(action.action_type || action.source || "待确认行动")}</strong>
        ${chip(stateLabel(status), statusTone(status))}
      </div>
      <p>${escapeHtml(action.reason || action.content_summary || "等待人工根据证据确认。")}</p>
      <p class="meta">平台 ${escapeHtml(platformLabel(action.platform || "weibo"))} · 来源 ${escapeHtml(stateLabel(action.source || "agent_recommended"))} · 置信度 ${escapeHtml(String(action.confidence ?? "-"))}</p>
      <p class="meta">关联事件 ${escapeHtml(String(action.related_event_id || "-"))} · 证据 ${escapeHtml(formatList(evidenceIds))}</p>
      <div class="button-row action-buttons">
        <button data-action="confirm-action" data-action-id="${escapeAttr(actionId)}" ${submitting ? "disabled" : ""}>确认</button>
        <button class="secondary" data-action="reject-action" data-action-id="${escapeAttr(actionId)}" ${submitting ? "disabled" : ""}>驳回</button>
        <button class="secondary" data-action="uncertain-action" data-action-id="${escapeAttr(actionId)}" ${submitting ? "disabled" : ""}>不确定</button>
        <button class="secondary" data-action="partial-action" data-action-id="${escapeAttr(actionId)}" ${submitting ? "disabled" : ""}>部分执行</button>
      </div>
      ${submitting ? `<p class="meta submit-lock">正在写入行动台账，请勿重复提交。</p>` : ""}
      ${pending && !submitting ? confirmationPanel(actionId, pendingStatus) : ""}
    </section>
  `;
}

function confirmationPanel(actionId, status) {
  return `
    <div class="confirmation-panel">
      <strong>${escapeHtml(confirmationLabel(status))}</strong>
      <p>此操作会写入行动台账和记忆项，用于后续报告与回测。请确认它对应真实人工判断。</p>
      <textarea data-confirm-note="${escapeAttr(actionId)}" placeholder="${status === "partial" ? "记录已执行部分" : "可选：记录确认依据或原因"}"></textarea>
      <div class="button-row">
        <button data-action="apply-confirmation" data-action-id="${escapeAttr(actionId)}" data-status="${escapeAttr(status)}">${escapeHtml(confirmationLabel(status))}</button>
        <button class="secondary" data-action="cancel-confirmation" data-action-id="${escapeAttr(actionId)}">取消</button>
      </div>
    </div>
  `;
}

function renderDataGaps(gaps) {
  setHtml(els.dataGaps, gaps.length
    ? gaps.map(gapCard).join("")
    : empty({ title: "后端未报告数据缺口", message: "这不代表已经覆盖全量微博数据；仍以目标、评论、事件和引用里的证据范围为准。", actionLabel: "查看证据引用", scrollTarget: "#citations" }));
}

function gapCard(gap) {
  const blocking = isBlockingGap(gap);
  return `
    <section class="list-item data-gap ${blocking ? "blocking" : ""}">
      <div class="card-head">
        <strong>${escapeHtml(stateLabel(gap.code || "data_gap"))}</strong>
        ${chip(blocking ? "阻断" : "待补齐", blocking ? "danger" : "warning")}
      </div>
      <p>${escapeHtml(gap.message || "")}</p>
      <p class="meta">${escapeHtml(gap.nextAction || "")}</p>
    </section>
  `;
}

function renderCitations(citations) {
  setHtml(els.citations, citations.length
    ? citations.map((citation) => `<section class="list-item"><strong>${escapeHtml(citation.id || citation.source_id || "source")}</strong><p>${escapeHtml(citation.type || citation.label || "")}</p></section>`).join("")
    : empty({ title: "暂无可引用证据", message: "完成搜索、详情或评论采集后，问答和报告会引用这里的来源 ID。" }));
}

function showActionResult(result, actionName = "操作") {
  setText(els.lastAction, result.ok === false
    ? `${actionName}未完成：${stateLabel(result.error_type || "blocked")}，${result.fix || result.message || "请查看数据缺口。"}`
    : `${actionName}已提交，等待真实数据链路处理。`);
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

async function withBusy(button, label, task) {
  if (!button || button.disabled) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "处理中";
  setText(els.lastAction, `${label}处理中。`);
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function empty(options) {
  const state = typeof options === "string" ? { message: options } : options;
  const action = state.href
    ? `<a class="empty-cta button-link secondary" href="${escapeAttr(state.href)}">${escapeHtml(state.actionLabel)}</a>`
    : state.actionLabel ? `<button class="empty-cta secondary" ${state.runDiscovery ? "data-run-discovery=\"1\"" : `data-scroll-target="${escapeAttr(state.scrollTarget)}"`}>${escapeHtml(state.actionLabel)}</button>` : "";
  return `
    <section class="list-item empty">
      ${state.title ? `<strong>${escapeHtml(state.title)}</strong>` : ""}
      <p>${escapeHtml(state.message || "")}</p>
      ${action}
    </section>
  `;
}

function formatList(value) {
  if (!value) return "暂无";
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : item.id || item.title || item.action_type || JSON.stringify(item)).join(" / ") || "暂无";
  return String(value);
}

function isBlockingGap(gap) {
  return Boolean(gap.blocking || /mysql|mediacrawler|cdp|auth|login|unavailable/i.test(`${gap.code || ""} ${gap.message || ""}`));
}

function chip(label, tone = "neutral") {
  return `<span class="chip ${escapeAttr(tone)}">${escapeHtml(label)}</span>`;
}

function riskChip(risk) {
  return `<span class="risk-chip risk-${escapeAttr(risk || "unknown")}">${escapeHtml(riskLabel(risk))}</span>`;
}

function riskLabel(risk) {
  const labels = {
    critical: "严重风险",
    high: "高风险",
    medium: "中风险",
    low: "低风险",
    unknown: "证据不足"
  };
  return labels[risk] || stateLabel(risk || "unknown");
}

function platformLabel(value) {
  return { weibo: "微博" }[value] || value;
}

function statusTone(status) {
  if (status === "confirmed") return "success";
  if (status === "rejected") return "danger";
  if (["partial", "uncertain"].includes(status)) return "warning";
  return "neutral";
}

function confirmationLabel(status) {
  return {
    confirmed: "确认执行",
    rejected: "确认驳回",
    uncertain: "标记不确定",
    partial: "标记部分执行"
  }[status] || "确认状态";
}

function stateLabel(value) {
  const labels = {
    agent_recommended: "Agent 建议",
    "analysis-without-event": "已分析未成事件",
    auth_required: "需要微博登录",
    backtested: "已回测",
    configured: "已配置",
    data_gap: "数据缺口",
    "detail-without-analysis": "详情待分析",
    "event-without-action": "事件待行动",
    failed: "失败",
    ignored: "已忽略",
    "no-data": "无数据",
    observation: "观察线索",
    observing: "观察中",
    official_observed: "官号观察",
    partial: "部分执行",
    pending: "待处理",
    rejected: "已驳回",
    resolved: "已解决",
    "search-only": "仅搜索",
    selected: "已选择",
    stable: "稳定",
    succeeded: "成功",
    uncertain: "不确定",
    unknown: "未知",
    weibo_analysis_needed: "需要分析",
    weibo_backtest_needed: "需要回测",
    weibo_detail_or_analysis_needed: "需要详情或分析",
    weibo_event_needed: "需要事件证据",
    weibo_latest_task_failed: "最近任务失败",
    weibo_real_data_missing: "缺少微博真实数据"
  };
  return labels[value] || String(value || "未知").replaceAll("_", " ");
}

function setConnection(online, text) {
  els.connectionDot.classList.toggle("online", online);
  els.connectionText.textContent = text;
}

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function setHtml(element, value) {
  if (element) element.innerHTML = value;
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
