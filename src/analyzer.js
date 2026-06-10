const positiveTerms = [
  "爆款",
  "抓人",
  "高级",
  "喜欢",
  "premium",
  "潜质",
  "不错",
  "稳",
  "高",
  "扩散",
  "转化",
  "名场面",
  "二创",
  "反馈强",
  "真实",
  "期待",
  "满意",
  "相信",
  "官宣",
  "强强联合",
  "治愈",
  "舒服",
  "质感",
  "赢在起跑线",
  "狠狠期待",
  "好美",
  "萌",
  "潜力黑马",
  "热播基本盘"
];

const negativeTerms = [
  "担心",
  "悬浮",
  "劝退",
  "危险",
  "分流",
  "控评",
  "质疑",
  " confused",
  "怕",
  "负面",
  "撞上",
  "一般",
  "过头"
  ,
  "怀疑",
  "不相信",
  "不信",
  "溜粉",
  "辟谣",
  "质疑",
  "非官宣",
  "被踩",
  "粤语能力",
  "扑",
  "争议"
];

const topicRules = [
  ["剧情口碑", ["剧情", "反转", "角色", "动机", "正片", "悬疑", "反派"]],
  ["演员与角色", ["主演", "男主", "女主", "角色", "CP", "营业"]],
  ["短视频扩散", ["短视频", "二创", "切片", "竖屏", "完播", "挑战赛"]],
  ["海外发行", ["overseas", "International", "subtitles", "legally", "海外", "多语种"]],
  ["档期竞争", ["档期", "竞品", "撞上", "首周", "分流", "排播"]],
  ["视觉与妆造", ["预告", "美术", "海报", "妆造", "noir", "visuals", "镜头"]],
  ["路人转化", ["路人", "非粉", "下沉", "中年", "家庭", "真实路演"]],
  ["演员讨论", ["刘昊然", "李兰迪", "刘奕铁", "颜卓灵", "尹正", "程潇", "男女主", "演员阵容"]],
  ["官宣可信度", ["官宣", "非官宣", "不相信", "不信", "溜粉", "辟谣", "相信"]],
  ["地域与语言", ["海岛", "福建", "闽南", "广东", "粤语", "渔村"]]
];

export function scoreSentiment(text) {
  const normalized = String(text || "").toLowerCase();
  let score = 0;
  for (const term of positiveTerms) {
    if (normalized.includes(term.toLowerCase())) score += 1;
  }
  for (const term of negativeTerms) {
    if (normalized.includes(term.toLowerCase())) score -= 1;
  }
  return Math.max(-1, Math.min(1, score / 4));
}

export function sentimentLabel(score) {
  if (score >= 0.18) return "positive";
  if (score <= -0.18) return "negative";
  return "neutral";
}

export function detectTopics(text) {
  const haystack = String(text || "");
  const topics = topicRules
    .filter(([, terms]) => terms.some((term) => haystack.toLowerCase().includes(term.toLowerCase())))
    .map(([topic]) => topic);
  return topics.length ? topics : ["综合声量"];
}

export function normalizeItem(item) {
  const sentiment = scoreSentiment(item.content);
  return {
    ...item,
    sentiment,
    sentimentLabel: sentimentLabel(sentiment),
    topics: detectTopics(item.content),
    heat: Math.round((Number(item.engagement || 0) / 1000) * (1 + Math.abs(sentiment)))
  };
}

export function buildAnalytics(items, config) {
  const normalized = items.map(normalizeItem);
  const total = normalized.length || 1;
  const sentimentCounts = countBy(normalized, "sentimentLabel");
  const sourceCounts = countBy(normalized, "source");
  const topicCounts = normalized.reduce((acc, item) => {
    item.topics.forEach((topic) => {
      acc[topic] = (acc[topic] || 0) + 1;
    });
    return acc;
  }, {});
  const avgSentiment = normalized.reduce((sum, item) => sum + item.sentiment, 0) / total;
  const heat = normalized.reduce((sum, item) => sum + item.heat, 0);
  const riskScore = clamp(
    (sentimentCounts.negative || 0) / total * 50 +
      (topicCounts["档期竞争"] || 0) * 7 +
      (topicCounts["路人转化"] || 0) * 4 -
      avgSentiment * 16,
    0,
    100
  );
  const trend = buildHourlyTrend(normalized);
  const forecast = forecastTrend(trend);
  const topItems = [...normalized].sort((a, b) => b.heat - a.heat).slice(0, 8);
  const opportunities = rankOpportunities(topicCounts, sourceCounts, avgSentiment, config);

  return {
    generatedAt: new Date().toISOString(),
    config,
    kpis: {
      totalMentions: normalized.length,
      heat,
      avgSentiment: round(avgSentiment),
      positiveRate: round((sentimentCounts.positive || 0) / total),
      negativeRate: round((sentimentCounts.negative || 0) / total),
      riskScore: Math.round(riskScore)
    },
    sentimentCounts,
    sourceCounts,
    topicCounts,
    trend,
    forecast,
    topItems,
    opportunities,
    strategy: buildStrategy({ topicCounts, sourceCounts, avgSentiment, riskScore, topItems, config, forecast })
  };
}

function buildHourlyTrend(items) {
  const buckets = new Map();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = `${String(date.getHours()).padStart(2, "0")}:00`;
    const previous = buckets.get(key) || { label: key, mentions: 0, heat: 0, sentiment: 0 };
    previous.mentions += 1;
    previous.heat += item.heat;
    previous.sentiment += item.sentiment;
    buckets.set(key, previous);
  }
  return [...buckets.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((bucket) => ({
      ...bucket,
      sentiment: round(bucket.sentiment / bucket.mentions)
    }));
}

function forecastTrend(trend) {
  if (!trend.length) return [];
  const latest = trend.at(-1);
  const previous = trend.at(-2) || latest;
  const heatDelta = latest.heat - previous.heat;
  const mentionDelta = latest.mentions - previous.mentions;
  return [1, 2, 3, 4, 5, 6].map((step) => ({
    label: `+${step}h`,
    mentions: Math.max(0, Math.round(latest.mentions + mentionDelta * step * 0.7)),
    heat: Math.max(0, Math.round(latest.heat + heatDelta * step * 0.7)),
    sentiment: round(clamp(latest.sentiment + (latest.sentiment - previous.sentiment) * step * 0.35, -1, 1))
  }));
}

function rankOpportunities(topicCounts, sourceCounts, avgSentiment, config) {
  const sourceLeader = topKey(sourceCounts) || "Douyin";
  const topicLeader = topKey(topicCounts) || "剧情口碑";
  const audience = config?.audience || "大众观众";
  const tone = avgSentiment >= 0 ? "放大正向声量" : "先处理信任风险";
  return [
    {
      title: `${sourceLeader} 主阵地：${topicLeader}`,
      evidence: `${topicLeader} 是当前最高频议题，${sourceLeader} 声量占优。`,
      action: `用 3 条素材连续测试：冲突钩子、角色反差、口碑长评，各投 6 小时看完播和评论情绪。`
    },
    {
      title: `${audience} 转化窗口`,
      evidence: `当前平均情绪为 ${round(avgSentiment)}，策略重心应 ${tone}。`,
      action: `把关键词组 "${(config?.keywords || []).join(" / ")}" 拆成粉丝词、路人词、行业词，分别设置监控阈值。`
    },
    {
      title: "竞品与档期预警",
      evidence: `档期竞争相关讨论 ${topicCounts["档期竞争"] || 0} 条，需持续观察声量分流。`,
      action: "每天 10:00 和 18:00 输出竞品对照简报，若负面率超过 28% 立即切换释疑物料。"
    }
  ];
}

function buildStrategy({ topicCounts, sourceCounts, avgSentiment, riskScore, topItems, config, forecast }) {
  const leadingTopic = topKey(topicCounts) || "剧情口碑";
  const leadingSource = topKey(sourceCounts) || "Douyin";
  const forecastHeat = forecast.reduce((sum, point) => sum + point.heat, 0);
  const crisis = riskScore >= 65;
  const keywords = (config?.keywords || []).join("、") || "核心片名、主演、角色名";
  return {
    headline: crisis ? "先降风险，再放大声量" : "用类型钩子放大路人转化",
    summary: `当前讨论集中在「${leadingTopic}」，主阵地是 ${leadingSource}。未来 6 小时预测热度约 ${forecastHeat}，关键词 ${keywords} 需要分层监控。`,
    plays: [
      {
        name: "6小时快反",
        steps: [
          `围绕「${leadingTopic}」发布一条官方解释或花絮，回应评论区最高频疑问。`,
          `把高热评论转成短视频标题 A/B 测试，保留情绪词但去掉粉圈黑话。`,
          "安排客服式账号在高热帖下补充播出平台、更新时间、主创信息。"
        ],
        metric: "负面率下降 5 个百分点，收藏/转发比高于 0.18。"
      },
      {
        name: "24小时种草",
        steps: [
          "剪 15 秒、30 秒、60 秒三档物料，同步测试剧情钩子、演员表演、视觉妆造。",
          "邀请垂类账号做非剧透长评，补齐路人判断所需证据。",
          "针对海外用户发布英文/繁中平台信息卡，减少观看路径流失。"
        ],
        metric: "自然搜索占比提升，海外负面评论中信息不清类低于 10%。"
      },
      {
        name: "72小时稳态",
        steps: [
          "建立竞品词包，监控同档项目的热搜词、差评点和物料节奏。",
          "把高口碑片段沉淀成素材库，供达人二创和媒体引用。",
          "每晚输出制片人简报：声量、情绪、风险、明日动作。"
        ],
        metric: "连续三天正向率高于 45%，核心话题榜单维持前 3。"
      }
    ],
    evidence: topItems.slice(0, 3).map((item) => ({
      source: item.source,
      content: item.content,
      heat: item.heat,
      sentiment: item.sentimentLabel
    }))
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function topKey(record) {
  return Object.entries(record).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
