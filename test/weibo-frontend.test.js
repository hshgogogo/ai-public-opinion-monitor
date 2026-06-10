import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("front-end uses Weibo Agent workbench as the primary screen", async () => {
  const [html, js] = await Promise.all([
    readFile("public/index.html", "utf8"),
    readFile("public/app.js", "utf8")
  ]);

  assert.match(html, /id="weiboWorkbench"/);
  assert.match(html, /id="recommendedTargets"/);
  assert.match(html, /id="pendingActions"/);
  assert.match(html, /id="dataGaps"/);
  assert.match(html, /微博 Agent 工作台/);

  assert.match(js, /\/api\/weibo\/workbench/);
  assert.doesNotMatch(js, /new EventSource\("\/api\/stream"\)/);
  assert.doesNotMatch(js, /fetch\("\/api\/collect"/);
  assert.doesNotMatch(html, /小红书 \/ 抖音 \/ 微博/);
});

test("front-end renders Weibo target, event, and action detail fields", async () => {
  const js = await readFile("public/app.js", "utf8");

  assert.match(js, /expected_question_answered|expectedQuestionAnswered/);
  assert.match(js, /recommendationReason|recommendation_reason|reason/);
  assert.match(js, /hot_score|hotScore/);
  assert.match(js, /rank/);
  assert.match(js, /select-target/);
  assert.match(js, /ignore-target/);

  assert.match(js, /timeline/);
  assert.match(js, /impact_assessment|impactAssessment/);
  assert.match(js, /recommended_actions|recommendedActions/);
  assert.match(js, /evidence_ids|evidenceIds/);

  assert.match(js, /confirmationStatus: "confirmed"/);
  assert.match(js, /confirmationStatus: "rejected"/);
  assert.match(js, /confirmationStatus: "uncertain"/);
  assert.match(js, /confirmationStatus: "partial"/);
});
