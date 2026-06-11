import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("front-end uses Weibo Agent workbench as the primary screen", async () => {
  const [html, js, css] = await Promise.all([
    readFile("public/index.html", "utf8"),
    readFile("public/app.js", "utf8"),
    readFile("public/styles.css", "utf8")
  ]);

  assert.match(html, /id="weiboWorkbench"/);
  assert.match(html, /class="command-center"/);
  assert.match(html, /id="nextStep"/);
  assert.match(html, /id="targetCount"/);
  assert.match(html, /id="recommendedTargets"/);
  assert.match(html, /id="pendingActions"/);
  assert.match(html, /id="dataGaps"/);
  assert.match(html, /微博 Agent 工作台/);
  assert.doesNotMatch(html, /class="hero"/);

  assert.match(js, /\/api\/weibo\/workbench/);
  assert.match(js, /renderOverview/);
  assert.match(js, /nextStepCard/);
  assert.match(js, /dataGapsFor/);
  assert.match(js, /workbench\.error_type/);
  assert.match(js, /依赖未就绪/);
  assert.match(css, /max-width: 1124px/);
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

  assert.match(js, /"confirm-action": "confirmed"/);
  assert.match(js, /"reject-action": "rejected"/);
  assert.match(js, /"uncertain-action": "uncertain"/);
  assert.match(js, /"partial-action": "partial"/);
  assert.match(js, /confirmationStatus: status/);
  assert.match(js, /confirmation-panel/);
  assert.match(js, /submittingActionIds/);
  assert.match(js, /submit-lock/);
  assert.match(js, /confirmation_note|note/);
});
