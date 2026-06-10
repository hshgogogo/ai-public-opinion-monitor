import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics, detectTopics, normalizeItem, scoreSentiment } from "../src/analyzer.js";

test("scores sentiment from public opinion text", () => {
  assert.equal(scoreSentiment("预告很抓人，有爆款潜质") > 0, true);
  assert.equal(scoreSentiment("担心剧情悬浮，营销过头会劝退") < 0, true);
});

test("detects film marketing topics", () => {
  assert.deepEqual(detectTopics("短视频二创切片完播很高").includes("短视频扩散"), true);
  assert.deepEqual(detectTopics("海外用户关心 subtitles 和上线平台").includes("海外发行"), true);
});

test("normalizes item with sentiment, topics and heat", () => {
  const item = normalizeItem({
    source: "Douyin",
    content: "短视频二创扩散潜质不错",
    engagement: 4000,
    createdAt: "2026-06-04T01:00:00.000Z"
  });
  assert.equal(item.sentimentLabel, "positive");
  assert.equal(item.topics.includes("短视频扩散"), true);
  assert.equal(item.heat > 0, true);
});

test("builds analytics with synchronized charts and strategy evidence", () => {
  const analytics = buildAnalytics(
    [
      {
        source: "Weibo",
        content: "主演预告抓人，剧情反转有爆款潜质",
        engagement: 6000,
        createdAt: "2026-06-04T01:00:00.000Z"
      },
      {
        source: "Weibo",
        content: "担心剧情悬浮，档期撞上竞品很危险",
        engagement: 3000,
        createdAt: "2026-06-04T02:00:00.000Z"
      }
    ],
    { keywords: ["长夜追光"], audience: "制片人" }
  );
  assert.equal(analytics.kpis.totalMentions, 2);
  assert.equal(analytics.trend.length, 2);
  assert.equal(analytics.forecast.length, 6);
  assert.equal(analytics.strategy.evidence.length, 2);
  assert.equal(typeof analytics.strategy.summary, "string");
});
