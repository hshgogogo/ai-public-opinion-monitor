import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("front-end uses Weibo Agent workbench as the primary screen", async () => {
  const [html, settingsHtml, js, css] = await Promise.all([
    readFile("public/index.html", "utf8"),
    readFile("public/settings.html", "utf8"),
    readFile("public/app.js", "utf8"),
    readFile("public/styles.css", "utf8")
  ]);

  assert.match(html, /id="weiboWorkbench"/);
  assert.match(html, /id="recommendedTargets"/);
  assert.match(html, /id="pendingActions"/);
  assert.match(html, /id="comments"/);
  assert.match(html, /id="dataGaps"/);
  assert.match(html, /微博 Agent 工作台/);
  assert.match(html, /href="\/settings"/);
  assert.match(html, /微博搜索 \/ 选择后采评论/);
  assert.doesNotMatch(html, /MediaCrawler/);
  assert.doesNotMatch(html, /id="runDiscovery"/);
  assert.doesNotMatch(html, /id="setupStatus"/);
  assert.doesNotMatch(html, /id="nextStep"/);
  assert.doesNotMatch(html, /class="hero"/);
  assert.match(settingsHtml, /id="runDiscovery"/);
  assert.match(settingsHtml, /id="setupStatus"/);
  assert.match(settingsHtml, /id="nextStep"/);

  assert.match(js, /\/api\/weibo\/workbench/);
  assert.match(js, /renderOverview/);
  assert.match(js, /nextStepCard/);
  assert.match(js, /target\.external_id \|\| target\.targetId/);
  assert.equal(js.includes('postJson("/api/weibo/targets/select", { targetId })'), true);
  assert.match(js, /dataGapsFor/);
  assert.match(js, /workbench\.error_type/);
  assert.match(js, /依赖未就绪/);
  assert.match(css, /\.qa-panel \.strategy-summary/);
  assert.match(css, /max-width: 1124px/);
  assert.doesNotMatch(js, /new EventSource\("\/api\/stream"\)/);
  assert.doesNotMatch(js, /fetch\("\/api\/collect"/);
  assert.doesNotMatch(html, /小红书 \/ 抖音 \/ 微博/);
});

test("front-end renders a read-only Weibo comments evidence list", async () => {
  const [html, js] = await Promise.all([
    readFile("public/index.html", "utf8"),
    readFile("public/app.js", "utf8")
  ]);

  assert.match(html, /真实评论/);
  assert.match(html, /id="comments"/);
  assert.match(js, /\/api\/weibo\/comments\?limit=20/);
  assert.match(js, /renderComments/);
  assert.match(js, /comment\.source_type/);
  assert.match(js, /comment\.like_count/);
  assert.match(js, /comment\.citation/);
  assert.match(js, /comment\.content/);
  assert.match(js, /暂无真实评论/);
  assert.doesNotMatch(js, /\/api\/weibo\/comments[\s\S]*DeepSeek/);
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

test("front-end treats comment collection as a silent backend task", async () => {
  const js = await readFile("public/app.js", "utf8");

  assert.match(js, /setText\(els\.lastAction, "采集中"\)/);
  assert.match(js, /showCollectResult/);
  assert.match(js, /成功，采到 \$\{count\} 条评论/);
  assert.match(js, /persisted_comments/);
  assert.match(js, /task\?\.collected_comments/);
  assert.match(js, /失败，\$\{collectFailureReason\(result\)\}/);
  assert.match(js, /collectFailureReason/);
  assert.match(js, /userFacingCollectReason/);
  assert.match(js, /replaceAll\("MediaCrawler", "采集程序"\)/);
  assert.match(js, /replaceAll\("CDP", "采集连接"\)/);
});
