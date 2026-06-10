const state = { snapshot: null };
const palette = ["#2868d8", "#188763", "#d94841", "#b98213", "#087b83", "#7c4d9e", "#455a64", "#c05746"];

const els = {
  connectionDot: document.querySelector("#connectionDot"),
  connectionText: document.querySelector("#connectionText"),
  generatedAt: document.querySelector("#generatedAt"),
  kpiGrid: document.querySelector("#kpiGrid"),
  strategyHeadline: document.querySelector("#strategyHeadline"),
  strategySummary: document.querySelector("#strategySummary"),
  strategyPlays: document.querySelector("#strategyPlays"),
  agents: document.querySelector("#agents"),
  topItems: document.querySelector("#topItems"),
  events: document.querySelector("#events")
};

document.querySelector("#runCollect").addEventListener("click", runCollect);
document.querySelector("#runMigrate").addEventListener("click", runMigrate);

connectStream();

async function connectStream() {
  const stream = new EventSource("/api/stream");
  stream.addEventListener("open", () => setConnection(true));
  stream.addEventListener("error", () => setConnection(false));
  stream.addEventListener("snapshot", (event) => {
    state.snapshot = JSON.parse(event.data);
    render();
  });
}

async function runCollect() {
  els.connectionText.textContent = "采集中";
  const response = await fetch("/api/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 20 })
  });
  const result = await response.json();
  console.log("collect", result);
  state.snapshot = await fetch("/api/snapshot").then((res) => res.json());
  render();
}

async function runMigrate() {
  els.connectionText.textContent = "初始化中";
  const result = await fetch("/api/migrate", { method: "POST" }).then((res) => res.json());
  console.log("migrate", result);
  state.snapshot = await fetch("/api/snapshot").then((res) => res.json());
  render();
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  syncConfigForm(snapshot.config);
  renderEnterprise(snapshot.enterprise);
  els.generatedAt.textContent = new Date(snapshot.generatedAt).toLocaleString();
  renderKpis(snapshot.kpis);
  renderStrategy(snapshot.strategy);
  renderAgents(snapshot.agents);
  renderTopItems(snapshot.topItems);
  renderEvents(snapshot.events);
  drawTrend(document.querySelector("#trendChart"), snapshot.trend, snapshot.forecast);
  drawDonut(document.querySelector("#sentimentChart"), snapshot.sentimentCounts, {
    positive: "#188763",
    neutral: "#2868d8",
    negative: "#d94841"
  });
  drawBars(document.querySelector("#sourceChart"), snapshot.sourceCounts);
  drawBars(document.querySelector("#topicChart"), snapshot.topicCounts);
}

function syncConfigForm(config) {
  if (!config || document.activeElement?.matches?.("input, textarea")) return;
  document.querySelector("#projectName").value = config.projectName || "";
  document.querySelector("#category").value = config.category || "";
  document.querySelector("#audience").value = config.audience || "";
  document.querySelector("#keywords").value = Array.isArray(config.keywords) ? config.keywords.join(", ") : "";
}

function renderEnterprise(enterprise = {}) {
  const database = enterprise.database || {};
  const auth = enterprise.auth || [];
  const authRows = auth.length
    ? auth.map((row) => `<div><strong>${platformName(row.platform)}</strong><span class="${row.status === "configured" ? "ok" : "warn"}">${row.status}</span></div>`).join("")
    : `<div><strong>账号态</strong><span class="warn">未读取</span></div>`;
  document.querySelector("#enterpriseStatus").innerHTML = `
    <div><strong>数据模式</strong><span class="ok">${enterprise.mode || "real-data-only"}</span></div>
    <div><strong>MySQL</strong><span class="${database.connected ? "ok" : "warn"}">${database.connected ? "已连接" : "未连接"}</span></div>
    <div><strong>平台白名单</strong><span>小红书 / 抖音 / 微博</span></div>
    ${authRows}
    <p>${enterprise.message || database.error || "等待真实采集"}</p>
  `;
}

function renderKpis(kpis) {
  const rows = [
    ["总声量", kpis.totalMentions],
    ["热度指数", kpis.heat],
    ["平均情绪", kpis.avgSentiment],
    ["正向率", percent(kpis.positiveRate)],
    ["风险分", kpis.riskScore]
  ];
  els.kpiGrid.innerHTML = rows.map(([label, value]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderStrategy(strategy) {
  els.strategyHeadline.textContent = strategy.headline;
  els.strategySummary.textContent = strategy.summary;
  els.strategyPlays.innerHTML = strategy.plays
    .map(
      (play) => `<section class="play"><h3>${play.name}</h3><ol>${play.steps
        .map((step) => `<li>${step}</li>`)
        .join("")}</ol><div class="metric">${play.metric}</div></section>`
    )
    .join("");
}

function renderAgents(agents) {
  els.agents.innerHTML = agents
    .map((agent) => `<section class="agent"><strong>${agent.name}</strong><span class="tag">${agent.status}</span><p>${agent.work}</p><p class="meta">${agent.output}</p></section>`)
    .join("");
}

function renderTopItems(items) {
  if (!items.length) {
    els.topItems.innerHTML = `<section class="feed-item"><span class="tag">无真实评论</span><p>当前没有从 MySQL 读取到真实评论样本。请先初始化数据库、配置 Cookie，并启动真实采集。</p></section>`;
    return;
  }
  els.topItems.innerHTML = items
    .slice(0, 6)
    .map(
      (item) => `<section class="feed-item"><span class="tag">${item.source}</span><p>${item.content}</p><p class="meta">热度 ${item.heat} · ${item.sentimentLabel} · ${item.topics.join(" / ")}</p></section>`
    )
    .join("");
}

function renderEvents(events) {
  if (!events.length) {
    els.events.innerHTML = `<section class="event"><span class="tag">真实数据模式</span><p>没有采集任务日志。系统不会展示 mock 事件。</p></section>`;
    return;
  }
  els.events.innerHTML = events
    .slice(-8)
    .reverse()
    .map((event) => `<section class="event"><span class="tag">${event.type}</span><p>${event.message}</p><p class="meta">${new Date(event.at).toLocaleTimeString()}</p></section>`)
    .join("");
}

function drawTrend(canvas, trend, forecast) {
  const ctx = setupCanvas(canvas);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  clear(ctx, width, height);
  const all = [...trend, ...forecast];
  if (!all.length) return emptyCanvas(ctx, width, height, "等待真实采集数据");
  const max = Math.max(...all.map((point) => point.heat), 1);
  const points = all.map((point, index) => ({
    x: 42 + (index * (width - 74)) / Math.max(1, all.length - 1),
    y: height - 34 - (point.heat / max) * (height - 70),
    point
  }));
  grid(ctx, width, height);
  line(ctx, points.slice(0, trend.length), "#2868d8", false);
  line(ctx, points.slice(Math.max(0, trend.length - 1)), "#b98213", true);
  points.forEach((point, index) => {
    ctx.fillStyle = index < trend.length ? "#2868d8" : "#b98213";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#637083";
    ctx.font = "12px sans-serif";
    ctx.fillText(point.point.label, point.x - 14, height - 12);
  });
}

function drawDonut(canvas, counts, colors) {
  const ctx = setupCanvas(canvas);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  clear(ctx, width, height);
  const entries = Object.entries(counts);
  if (!entries.length) return emptyCanvas(ctx, width, height, "暂无情绪数据");
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  let start = -Math.PI / 2;
  entries.forEach(([key, value]) => {
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, height / 2);
    ctx.fillStyle = colors[key] || "#2868d8";
    ctx.arc(width / 2, height / 2, 92, start, start + angle);
    ctx.fill();
    start += angle;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#15181e";
  ctx.font = "700 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(total), width / 2, height / 2 + 7);
  ctx.textAlign = "left";
  entries.forEach(([key, value], index) => {
    ctx.fillStyle = colors[key] || palette[index];
    ctx.fillRect(18, 22 + index * 24, 12, 12);
    ctx.fillStyle = "#334155";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${key} ${value}`, 38, 33 + index * 24);
  });
}

function drawBars(canvas, record) {
  const ctx = setupCanvas(canvas);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  clear(ctx, width, height);
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, 7);
  if (!entries.length) return emptyCanvas(ctx, width, height, "暂无平台数据");
  const max = Math.max(...entries.map(([, value]) => value), 1);
  entries.forEach(([key, value], index) => {
    const y = 30 + index * 34;
    const barWidth = ((width - 150) * value) / max;
    ctx.fillStyle = palette[index % palette.length];
    ctx.fillRect(120, y, barWidth, 18);
    ctx.fillStyle = "#334155";
    ctx.font = "13px sans-serif";
    ctx.fillText(fit(key, 10), 12, y + 14);
    ctx.fillText(String(value), 128 + barWidth, y + 14);
  });
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function clear(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
}

function grid(ctx, width, height) {
  ctx.strokeStyle = "#e3e9f1";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = 22 + i * ((height - 60) / 4);
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();
  }
}

function line(ctx, points, color, dashed) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash(dashed ? [7, 7] : []);
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function setConnection(online) {
  els.connectionDot.classList.toggle("online", online);
  els.connectionText.textContent = online ? "真实数据连接" : "重连中";
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function value(selector) {
  return document.querySelector(selector).value.trim();
}

function emptyCanvas(ctx, width, height, message) {
  grid(ctx, width, height);
  ctx.fillStyle = "#637083";
  ctx.font = "15px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = "left";
}

function platformName(platform) {
  return { xiaohongshu: "小红书", douyin: "抖音", weibo: "微博" }[platform] || platform;
}

function fit(text, size) {
  return text.length > size ? `${text.slice(0, size - 1)}…` : text;
}

window.addEventListener("resize", () => render());
