import { readFile, writeFile } from "node:fs/promises";
import { buildAnalytics, normalizeItem } from "../src/analyzer.js";
import { analyzeWithDeepSeek } from "../src/deepseek-agent.js";

const pptPath = process.argv[2] || "data/ppt-reference.json";
const collectionPath = process.argv[3] || "data/haidao-public-collection.json";
const outputPath = process.argv[4] || "data/haidao-analysis.json";

const ppt = JSON.parse(await readFile(pptPath, "utf8"));
const collection = JSON.parse(await readFile(collectionPath, "utf8"));

const pptItems = ppt.slides
  .flatMap((slide) => slide.lines.map((line, index) => ({ slide: slide.slide, index, line })))
  .filter(({ line }) => isOpinionLine(line))
  .map(({ slide, line, index }) => ({
    id: `ppt-${slide}-${index}`,
    source: "Weibo",
    author: `参考PPT第${slide}页`,
    keyword: "海岛舒服日志",
    domain: inferDomain(line),
    engagement: inferEngagement(line),
    content: line,
    createdAt: "2025-10-12T12:00:00.000Z"
  }));

const items = [...collection.items, ...pptItems].map(normalizeItem);
const analytics = buildAnalytics(items, {
  projectName: "海岛舒服日志",
  category: "小红书 / 抖音 / 微博",
  keywords: ["海岛舒服日志", "刘昊然", "李兰迪", "刘奕铁", "颜卓灵", "尹正", "程潇"],
  audience: "制片人与宣发团队",
  refreshSeconds: 8,
  realtime: false
});
let deepseekAgent = null;
try {
  deepseekAgent = await analyzeWithDeepSeek(items, process.env.DEEPSEEK_API_KEY);
} catch (error) {
  deepseekAgent = { error: error.message };
}

const actorMentions = countActorMentions(items, collection.actors);
const platformEvidence = groupBySource(items);
const limitations = [
  ...collection.limitations,
  {
    platform: "Xiaohongshu/Douyin/Weibo",
    reason: "本次未使用账号登录、未绕过反爬、未调用非公开接口；评论样本以公开网页摘要与用户提供PPT中的微博舆情素材为主。"
  }
];

const report = {
  generatedAt: new Date().toISOString(),
  project: "海岛舒服日志",
  dataBasis: {
    publicItems: collection.items.length,
    pptOpinionItems: pptItems.length,
    totalItems: items.length,
    pptSlides: ppt.slideCount
  },
  actors: actorMentions,
  analytics,
  analyzedItems: items,
  deepseekAgent,
  platformEvidence,
  limitations,
  executiveReadout: buildReadout(analytics, actorMentions, limitations)
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  outputPath,
  totalItems: report.dataBasis.totalItems,
  riskScore: analytics.kpis.riskScore,
  sentiment: analytics.sentimentCounts,
  leadingActors: actorMentions.slice(0, 5)
}, null, 2));

function isOpinionLine(line) {
  if (/请输入|文本内容|主标题|THANK YOU|对于《海岛舒服日志》舆论中有超过|对于《海岛舒服日志》舆论中有大约|主要的方向是|评论情绪是/.test(line)) {
    return false;
  }
  return /海岛舒服日志|刘昊然|李兰迪|评论|转发|点赞|热搜|微博|网友|观众|粉丝|舆情|正向|负向|中性|演员|角色|剧|播出|宣传|期待|官宣|合作|粤语|棋魂|溜粉|不信|不相信|定妆|置景车|妆造|余淮|余周周|搭配|满意/.test(line) && line.length >= 4;
}

function inferDomain(line) {
  if (/刘昊然|李兰迪|刘奕铁|颜卓灵|尹正|程潇/.test(line)) return "演员讨论";
  if (/热搜|微博|转发|点赞|评论/.test(line)) return "微博声量";
  if (/负向|争议|吐槽|担心|质疑/.test(line)) return "风险预警";
  return "项目口碑";
}

function inferEngagement(line) {
  const nums = [...line.matchAll(/\d+(?:\.\d+)?万?/g)].map((match) => {
    const raw = match[0];
    const value = Number(raw.replace("万", ""));
    return raw.includes("万") ? value * 10000 : value;
  });
  return Math.max(800, Math.min(50000, nums.reduce((sum, n) => sum + n, 0) || line.length * 90));
}

function countActorMentions(items, actors) {
  return actors
    .map((actor) => {
      const actorItems = items.filter((item) => item.content.includes(actor));
      return {
        actor,
        mentions: actorItems.length,
        positive: actorItems.filter((item) => item.sentimentLabel === "positive").length,
        negative: actorItems.filter((item) => item.sentimentLabel === "negative").length,
        avgSentiment: actorItems.length
          ? Math.round((actorItems.reduce((sum, item) => sum + item.sentiment, 0) / actorItems.length) * 100) / 100
          : 0
      };
    })
    .sort((a, b) => b.mentions - a.mentions);
}

function groupBySource(items) {
  return Object.values(
    items.reduce((acc, item) => {
      acc[item.source] ||= { source: item.source, count: 0, positive: 0, negative: 0, examples: [] };
      acc[item.source].count += 1;
      if (item.sentimentLabel === "positive") acc[item.source].positive += 1;
      if (item.sentimentLabel === "negative") acc[item.source].negative += 1;
      if (acc[item.source].examples.length < 3) {
        acc[item.source].examples.push({
          content: item.content,
          sentiment: item.sentimentLabel,
          topics: item.topics,
          heat: item.heat
        });
      }
      return acc;
    }, {})
  ).sort((a, b) => b.count - a.count);
}

function buildReadout(analytics, actorMentions, limitations) {
  const topActor = actorMentions.find((actor) => actor.mentions > 0);
  const negativeRate = Math.round(analytics.kpis.negativeRate * 100);
  const positiveRate = Math.round(analytics.kpis.positiveRate * 100);
  return {
    conclusion: `以公开样本和PPT微博舆情素材看，《海岛舒服日志》当前更像演员驱动型早期声量，正向率 ${positiveRate}%，负向率 ${negativeRate}%，风险分 ${analytics.kpis.riskScore}/100。`,
    actorFocus: topActor
      ? `${topActor.actor} 是样本中最高频演员，应作为话题锚点，但需要避免单一演员声量遮蔽剧集本身卖点。`
      : "公开样本中的演员指向分散，需要扩大评论采集量后再判断主锚点。",
    actions: [
      "微博：保留演员热度入口，同时把话题从演员扩展到岛屿治愈感、群像关系、轻喜剧节奏。",
      "抖音：用 15 秒竖屏测试刘昊然/李兰迪角色反差、海岛生活感、轻喜剧片段三类素材。",
      "小红书：重点投生活方式语境，标题围绕海岛、松弛感、穿搭、取景地、治愈氛围。",
      "评论 Agent：每天按平台输出正/中/负样本 Top 20，负向超过 25% 时触发主创解释或花絮释疑。"
    ],
    caveat: limitations.at(-1)?.reason
  };
}
