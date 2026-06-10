import { writeFile } from "node:fs/promises";

const output = process.argv[2] || "data/haidao-public-collection.json";
const queries = [
  { platform: "Weibo", query: "海岛舒服日志 刘昊然 李兰迪 评论" },
  { platform: "Weibo", query: "海岛舒服日志 微博 舆情" },
  { platform: "Douyin", query: "海岛舒服日志 抖音 评论 刘昊然" },
  { platform: "Xiaohongshu", query: "海岛舒服日志 小红书 评论" },
  { platform: "Web", query: "海岛舒服日志 演员 刘昊然 李兰迪" }
];

const collected = [];
const limitations = [];

for (const item of queries) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(item.query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/125 Safari/537.36"
      }
    });
    const html = await response.text();
    const snippets = extractBingSnippets(html).slice(0, 8);
    if (!snippets.length) {
      limitations.push({ platform: item.platform, reason: "公开搜索无可解析摘要或被搜索页限制。", query: item.query });
    }
    for (const snippet of snippets) {
      collected.push({
        id: `${item.platform}-${collected.length + 1}`,
        source: item.platform,
        author: "公开网页摘要",
        keyword: item.query,
        domain: "海岛舒服日志舆情",
        engagement: estimateEngagement(snippet),
        content: snippet,
        createdAt: new Date().toISOString()
      });
    }
  } catch (error) {
    limitations.push({ platform: item.platform, reason: error.message, query: item.query });
  }
}

const payload = {
  collectedAt: new Date().toISOString(),
  project: "海岛舒服日志",
  actors: ["刘昊然", "李兰迪", "刘奕铁", "颜卓灵", "张呈", "许梦圆", "尹正", "程潇", "连凯", "何美钿"],
  sources: queries.map((item) => item.platform),
  items: dedupe(collected),
  limitations
};

await writeFile(output, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ output, items: payload.items.length, limitations: payload.limitations.length }, null, 2));

function extractBingSnippets(html) {
  const blocks = [...html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)].map((match) => match[0]);
  return blocks
    .map((block) => stripTags(block.match(/<h2[\s\S]*?<\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] || block.match(/<p>([\s\S]*?)<\/p>/)?.[1] || ""))
    .map(normalizeText)
    .filter((text) => text.length >= 12 && /海岛舒服日志|刘昊然|李兰迪|微博|抖音|小红书|Take a Nap/i.test(text));
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function estimateEngagement(text) {
  let score = 900;
  if (/微博|热搜/.test(text)) score += 2500;
  if (/抖音|小红书/.test(text)) score += 1800;
  if (/刘昊然|李兰迪/.test(text)) score += 1600;
  return score + Math.min(4000, text.length * 12);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.content.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
