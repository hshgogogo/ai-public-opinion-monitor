import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const testMysqlUrl = process.env.WEIBO_DB_PERSISTENCE_TEST_URL;
const fakeWeiboCookieFile = "test/fixtures/weibo-cookie.json";

test(
  "runs Agent Harness loop migration twice and creates ledger tables",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["migrate"]).ok, true);

    const tables = queryRows(
      "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('agent_loop_runs','agent_step_runs','judge_reviews','feedback_items') ORDER BY TABLE_NAME"
    ).map((row) => row.table_name);
    assert.deepEqual(tables, [
      "agent_loop_runs",
      "agent_step_runs",
      "feedback_items",
      "judge_reviews"
    ]);
  }
);

test(
  "persists Agent Harness loop, step, Judge review, and manual handoff records via worker helpers",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const result = runPythonSnippet(`
import json
from workers import enterprise_worker as worker

project_id = int(__import__("os").environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    target_id=42,
    current_step="comment_analysis",
    input_json={"target_id": 42, "requested_by": "test"},
)
step = worker.record_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Issue Analysis Agent",
    step_name="comment_analysis",
    status="succeeded",
    input_json={"comment_ids": [1, 2]},
    output_json={"summary": "evidence-backed"},
    evidence_ids=["comment-1", "comment-2"],
)
review = worker.record_judge_review(
    loop_run_id=loop["id"],
    step_run_id=step["id"],
    project_id=project_id,
    judge_agent_name="Judge Agent",
    status="passed",
    passed=True,
    score=0.91,
    feedback_json={"verdict": "ok"},
    required_changes=[],
    evidence_errors=[],
)
handoff = worker.record_manual_handoff(
    project_id=project_id,
    source_type="step",
    source_id=step["id"],
    feedback_type="manual_handoff",
    note="needs producer confirmation",
    status="open",
    created_by="agent_harness",
)
print(json.dumps({"loop": loop, "step": step, "review": review, "handoff": handoff}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId) });

    assert.equal(result.loop.status, "running");
    assert.equal(result.step.status, "succeeded");
    assert.equal(result.review.status, "passed");
    assert.equal(result.handoff.feedback_type, "manual_handoff");

    assert.deepEqual(queryRows(
      "SELECT platform, trigger_mode, target_id, status, current_step, JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.requested_by')) AS requested_by FROM agent_loop_runs WHERE id=%s",
      [result.loop.id]
    )[0], {
      platform: "weibo",
      trigger_mode: "manual",
      target_id: 42,
      status: "running",
      current_step: "comment_analysis",
      requested_by: "test"
    });
    assert.deepEqual(queryRows(
      "SELECT agent_name, step_name, status, JSON_LENGTH(evidence_ids) AS evidence_count, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.summary')) AS summary FROM agent_step_runs WHERE id=%s",
      [result.step.id]
    )[0], {
      agent_name: "Issue Analysis Agent",
      step_name: "comment_analysis",
      status: "succeeded",
      evidence_count: 2,
      summary: "evidence-backed"
    });
    assert.deepEqual(queryRows(
      "SELECT judge_agent_name, status, passed, CAST(score AS CHAR) AS score, JSON_LENGTH(required_changes) AS required_change_count, JSON_LENGTH(evidence_errors) AS evidence_error_count FROM judge_reviews WHERE id=%s",
      [result.review.id]
    )[0], {
      judge_agent_name: "Judge Agent",
      status: "passed",
      passed: 1,
      score: "0.9100",
      required_change_count: 0,
      evidence_error_count: 0
    });
    assert.deepEqual(queryRows(
      "SELECT source_type, source_id, feedback_type, note, status, created_by FROM feedback_items WHERE id=%s",
      [result.handoff.id]
    )[0], {
      source_type: "step",
      source_id: result.step.id,
      feedback_type: "manual_handoff",
      note: "needs producer confirmation",
      status: "open",
      created_by: "agent_harness"
    });
  }
);

test(
  "protects Agent Harness terminal loop state and rejects passed Judge reviews with evidence errors",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const result = runPythonSnippet(`
import json
import os
from workers import enterprise_worker as worker

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="judge_review",
    input_json={"slice": "terminal-protection"},
)
failed_step = worker.fail_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Strategy Agent",
    step_name="strategy_review",
    output_json={"draft": "too vague"},
    evidence_ids=[],
    error_type="judge_failed",
    error_message="missing evidence",
)
late_success = worker.succeed_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Strategy Agent",
    step_name="strategy_review",
    output_json={"draft": "late success"},
    evidence_ids=["comment-1"],
    step_run_id=failed_step["id"],
)
try:
    worker.record_judge_review(
        loop_run_id=loop["id"],
        step_run_id=failed_step["id"],
        project_id=project_id,
        judge_agent_name="Judge Agent",
        status="passed",
        passed=True,
        evidence_errors=["missing-comment-99"],
    )
    invalid_review_error = None
except ValueError as exc:
    invalid_review_error = str(exc)
try:
    worker.fail_agent_step_run(
        loop_run_id=loop["id"],
        project_id=project_id,
        agent_name="Strategy Agent",
        step_name="missing_step",
        step_run_id=999999,
        error_type="missing_step",
        error_message="should not mutate loop",
    )
    missing_step_error = None
except ValueError as exc:
    missing_step_error = str(exc)
try:
    worker.record_judge_review(
        loop_run_id=loop["id"],
        step_run_id=failed_step["id"],
        project_id=project_id,
        judge_agent_name="Judge Agent",
        status="passed",
        passed=False,
    )
    contradictory_review_error = None
except ValueError as exc:
    contradictory_review_error = str(exc)
needs_human_review = worker.record_judge_review(
    loop_run_id=loop["id"],
    step_run_id=failed_step["id"],
    project_id=project_id,
    judge_agent_name="Judge Agent",
    status="needs_human",
    passed=False,
    evidence_errors=["missing-comment-99"],
)
print(json.dumps({
    "loop_id": loop["id"],
    "step_id": failed_step["id"],
    "late_success_status": late_success["status"],
    "invalid_review_error": invalid_review_error,
    "missing_step_error": missing_step_error,
    "contradictory_review_error": contradictory_review_error,
    "needs_human_review": needs_human_review,
}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId) });

    assert.match(result.invalid_review_error, /evidence_errors/);
    assert.match(result.missing_step_error, /step_run_id/);
    assert.match(result.contradictory_review_error, /passed/);
    assert.equal(result.late_success_status, "failed");
    assert.equal(result.needs_human_review.status, "needs_human");

    assert.deepEqual(queryRows(
      "SELECT status, current_step, error_type, error_message, finished_at IS NOT NULL AS has_finished_at FROM agent_loop_runs WHERE id=%s",
      [result.loop_id]
    )[0], {
      status: "failed",
      current_step: "strategy_review",
      error_type: "judge_failed",
      error_message: "missing evidence",
      has_finished_at: 1
    });
    assert.deepEqual(queryRows(
      "SELECT status, error_type, error_message FROM agent_step_runs WHERE id=%s",
      [result.step_id]
    )[0], {
      status: "failed",
      error_type: "judge_failed",
      error_message: "missing evidence"
    });
    assert.equal(
      queryRows("SELECT COUNT(*) AS count FROM judge_reviews WHERE loop_run_id=%s", [result.loop_id])[0].count,
      1
    );
  }
);

test(
  "persists and reads Agent Harness worker-only command payloads",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const created = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({
        projectId,
        triggerMode: "manual",
        targetId: 88,
        currentStep: "comment_analysis",
        input: { requested_by: "worker-command-test" }
      })
    ]);
    assert.equal(created.ok, true);
    assert.equal(created.run.project_id, projectId);
    assert.equal(created.run.platform, "weibo");
    assert.equal(created.run.trigger_mode, "manual");
    assert.equal(created.run.status, "running");
    assert.equal(created.request.projectId, projectId);

    const started = runWorker([
      "weibo-agent-loop-step",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: created.run.id,
        agentName: "Issue Analysis Agent",
        stepName: "comment_analysis",
        status: "running",
        input: { comment_ids: [1, 2] }
      })
    ]);
    assert.equal(started.ok, true);
    assert.equal(started.step.status, "running");

    const succeeded = runWorker([
      "weibo-agent-loop-step",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: created.run.id,
        stepRunId: started.step.id,
        agentName: "Issue Analysis Agent",
        stepName: "comment_analysis",
        status: "succeeded",
        output: { summary: "done" },
        evidenceIds: ["comment-1"]
      })
    ]);
    assert.equal(succeeded.ok, true);
    assert.equal(succeeded.step.status, "succeeded");

    const review = runWorker([
      "weibo-agent-loop-judge-review",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: created.run.id,
        stepRunId: succeeded.step.id,
        judgeAgentName: "Judge Agent",
        status: "passed",
        passed: true,
        score: 0.95,
        feedback: { verdict: "ok" },
        requiredChanges: [],
        evidenceErrors: []
      })
    ]);
    assert.equal(review.ok, true);
    assert.equal(review.review.status, "passed");

    const handoff = runWorker([
      "weibo-agent-loop-handoff",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "step",
        sourceId: succeeded.step.id,
        feedbackType: "manual_handoff",
        note: "producer should confirm",
        status: "open",
        createdBy: "agent_harness"
      })
    ]);
    assert.equal(handoff.ok, true);
    assert.equal(handoff.feedback.status, "open");

    const status = runWorker([
      "weibo-agent-loop-status",
      "--payload-json",
      JSON.stringify({ projectId, loopRunId: created.run.id })
    ]);
    assert.equal(status.ok, true);
    assert.equal(status.run.id, created.run.id);
    assert.equal(status.steps.length, 1);
    assert.equal(status.steps[0].status, "succeeded");
    assert.equal(status.judgeReviews.length, 1);
    assert.equal(status.feedbackItems.length, 1);

    const invalidProject = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId: 999999, triggerMode: "manual", input: {} })
    ]);
    assert.equal(invalidProject.ok, false);
    assert.equal(invalidProject.error_type, "project_not_found");
  }
);

test(
  "runs feedback memory loop schema migration twice with OpenSpec-compatible enums",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["migrate"]).ok, true);

    const feedbackSourceType = columnType("feedback_items", "source_type");
    const feedbackType = columnType("feedback_items", "feedback_type");
    const eventStatus = columnType("artist_public_opinion_events", "status");
    const accountSourceType = columnType("source_accounts", "source_type");
    const memorySourceKind = columnType("bot_memory_items", "source_kind");

    assert.deepEqual(enumValues(feedbackSourceType), [
      "loop",
      "step",
      "judge_review",
      "event",
      "action",
      "account",
      "preference",
      "knowledge",
      "rule",
      "other",
      "source_account"
    ]);
    assert.deepEqual(enumValues(feedbackType), [
      "manual_handoff",
      "needs_human",
      "confirmed",
      "rejected",
      "modified",
      "comment",
      "preference",
      "other",
      "event_confirmed",
      "event_rejected",
      "event_observation_only",
      "event_note",
      "action_confirmed",
      "action_rejected",
      "action_partially_executed",
      "action_not_executed",
      "action_note",
      "source_type_corrected",
      "preference_added",
      "preference_updated",
      "manual_handoff_resolved",
      "manual_handoff_note"
    ]);
    assert.deepEqual(enumValues(eventStatus), [
      "observing",
      "escalating",
      "stable",
      "resolved",
      "archived",
      "confirmed",
      "rejected"
    ]);
    assert.deepEqual(enumValues(accountSourceType), [
      "official",
      "artist",
      "producer",
      "marketing",
      "suspected_matrix",
      "media",
      "fan",
      "organic",
      "unknown"
    ]);
    assert.deepEqual(enumValues(memorySourceKind), [
      "target",
      "comment",
      "analysis",
      "event",
      "action",
      "backtest",
      "report",
      "preference",
      "conversation",
      "source_account"
    ]);
  }
);

test(
  "persists Weibo discovery, target selection, and detail fixture rows into MySQL",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    const migration = runWorker(["migrate"]);
    assert.equal(migration.ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);

    assert.equal(discovery.ok, true);
    assert.equal(discovery.task.platform, "weibo");
    assert.equal(discovery.task.crawler_type, "search");
    assert.equal(discovery.task.keyword, "海岛舒服日志");
    assert.equal(discovery.persisted_targets, 10);
    assert.equal(discovery.targets.length, 10);

    const workbenchAfterDiscovery = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterDiscovery.mode, "weibo-agent-mvp");
    assert.equal(workbenchAfterDiscovery.setup.partialState, "search-only");
    assert.equal(workbenchAfterDiscovery.recommendedTargets.length, 10);
    assert.equal(workbenchAfterDiscovery.recommendedTargets[0].external_id, "1004");
    assert.equal(workbenchAfterDiscovery.dataGaps.some((gap) => gap.code === "weibo_real_data_missing"), false);
    assert.equal(workbenchAfterDiscovery.dataGaps.some((gap) => gap.code === "weibo_detail_or_analysis_needed"), true);
    assert.equal(Object.hasOwn(workbenchAfterDiscovery.setup.latestTask, "output_path"), false);
    assert.equal(Object.hasOwn(workbenchAfterDiscovery.setup.latestTask, "raw_files"), false);
    assert.equal(workbenchAfterDiscovery.setup.latestTask.raw_file_count, 1);
    queryRows(
      "INSERT INTO collection_tasks(project_id, platform, keyword, status, requested_limit, crawler_engine, crawler_type, error_type, error_message, output_path, raw_files, parsed_records, failed_records, collected_posts, collected_comments, finished_at) VALUES (%s,'weibo',%s,'failed',10,'mediacrawler','search','mediacrawler_runtime_failed','simulated latest failure','storage/mediacrawler/latest-failed',JSON_ARRAY(),0,0,0,0,NOW())",
      [projectId, "海岛舒服日志"]
    );
    const workbenchAfterFailedRetry = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterFailedRetry.recommendedTargets.length, 10);
    assert.equal(workbenchAfterFailedRetry.setup.latestTask.status, "failed");
    assert.equal(workbenchAfterFailedRetry.dataGaps.some((gap) => gap.code === "weibo_latest_task_failed"), true);

    const taskRows = queryRows(
      "SELECT platform, keyword, status, requested_limit, crawler_type, parsed_records, failed_records, collected_posts FROM collection_tasks WHERE id=%s",
      [discovery.task.id]
    );
    assert.deepEqual(taskRows[0], {
      platform: "weibo",
      keyword: "海岛舒服日志",
      status: "succeeded",
      requested_limit: 10,
      crawler_type: "search",
      parsed_records: 10,
      failed_records: 0,
      collected_posts: 10
    });

    const targetRows = queryRows(
      "SELECT external_id, selected_status, `rank`, JSON_UNQUOTE(JSON_EXTRACT(target_locator, '$.weibo_mid')) AS weibo_mid FROM discovered_targets ORDER BY `rank`, id"
    );
    assert.equal(targetRows.length, 10);
    assert.equal(targetRows[0].external_id, "1004");
    assert.equal(targetRows.some((row) => row.external_id === "1011"), false);
    assert.equal(targetRows.find((row) => row.external_id === "1001").weibo_mid, "m1001");

    const target1001 = targetRows.find((row) => row.external_id === "1001");
    const selected = runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ targetId: "1001" })
    ]);
    assert.equal(selected.ok, true);
    assert.equal(selected.target.external_id, "1001");
    assert.equal(selected.target.selected_status, "selected");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE source_kind='target'")[0].count, 1);

    const ignored = runWorker([
      "weibo-target-ignore",
      "--payload-json",
      JSON.stringify({ targetId: "1004" })
    ]);
    assert.equal(ignored.ok, true);
    assert.equal(ignored.target.selected_status, "ignored");

    const rediscovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(rediscovery.ok, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM discovered_targets")[0].count, 10);
    const rediscoveredStates = queryRows(
      "SELECT external_id, selected_status FROM discovered_targets WHERE external_id IN ('1001','1004') ORDER BY external_id"
    );
    assert.deepEqual(rediscoveredStates, [
      { external_id: "1001", selected_status: "selected" },
      { external_id: "1004", selected_status: "ignored" }
    ]);

    const blockedCollection = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1004",
      "--payload-json",
      JSON.stringify({ fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(blockedCollection.ok, false);
    assert.equal(blockedCollection.error_type, "target_not_selected");

    const detail = runWorker([
      "weibo-collect-target",
      "--target-id",
      target1001.external_id,
      "--payload-json",
      JSON.stringify({ fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(detail.ok, true);
    assert.equal(detail.task.crawler_type, "detail");
    assert.equal(detail.status, "partial");
    assert.equal(detail.persisted_posts, 2);
    assert.equal(detail.persisted_comments, 4);
    assert.equal(detail.failed_records, 2);

    const detailTaskRows = queryRows(
      "SELECT status, crawler_type, target_id, parsed_records, failed_records, collected_posts, collected_comments FROM collection_tasks WHERE id=%s",
      [detail.task.id]
    );
    assert.equal(detailTaskRows[0].status, "partial");
    assert.equal(detailTaskRows[0].crawler_type, "detail");
    assert.equal(detailTaskRows[0].parsed_records, 3);
    assert.equal(detailTaskRows[0].failed_records, 2);
    assert.equal(detailTaskRows[0].collected_posts, 2);
    assert.equal(detailTaskRows[0].collected_comments, 4);

    assert.equal(queryRows("SELECT COUNT(*) AS count FROM target_collection_links WHERE collection_task_id=%s", [detail.task.id])[0].count, 1);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_posts")[0].count, 2);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_comments")[0].count, 4);
    assert.equal(queryRows("SELECT like_count, reply_count FROM social_comments WHERE external_id='c1002'")[0].like_count, 21);
    const commentsList = runWorker([
      "weibo-comments",
      "--payload-json",
      JSON.stringify({ projectId, limit: 3 })
    ]);
    assert.equal(commentsList.ok, true);
    assert.equal(commentsList.mode, "weibo-agent-mvp");
    assert.equal(commentsList.total, 4);
    assert.equal(commentsList.comments.length, 3);
    assert.equal(commentsList.comments[0].platform, "weibo");
    assert.equal(commentsList.comments[0].comment_id > 0, true);
    assert.equal(commentsList.comments[0].post_external_id, "1001");
    assert.equal(typeof commentsList.comments[0].content, "string");
    assert.equal(Object.hasOwn(commentsList.comments[0], "like_count"), true);
    assert.equal(Object.hasOwn(commentsList.comments[0], "source_type"), true);
    assert.equal(commentsList.citations.includes(`comment-${commentsList.comments[0].comment_id}`), true);
    const workbenchAfterDetail = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterDetail.setup.partialState, "detail-without-analysis");
    assert.equal(workbenchAfterDetail.setup.progress.analysis_count, 0);
    assert.equal(workbenchAfterDetail.dataGaps.some((gap) => gap.code === "weibo_analysis_needed"), true);
    const localAnalysis = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10 })
    ]);
    assert.equal(localAnalysis.ok, true);
    assert.equal(localAnalysis.deepseek.status, "not_run");
    assert.equal(localAnalysis.persisted_sentiments, 4);
    assert.equal(localAnalysis.agent_run.status, "succeeded");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results WHERE model='local-rules'")[0].count, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs WHERE project_id=%s AND agent_name='Local Weibo Issue Analysis'", [projectId])[0].count, 1);
    const localAnalysisAgain = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10 })
    ]);
    assert.equal(localAnalysisAgain.persisted_sentiments, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results WHERE model='local-rules'")[0].count, 4);

    const deepSeekAnalysis = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({
        projectId,
        limit: 10,
        deepseekResponsePath: "test/fixtures/deepseek-response.md"
      })
    ]);
    assert.equal(deepSeekAnalysis.ok, true);
    assert.equal(deepSeekAnalysis.deepseek.status, "succeeded");
    assert.equal(deepSeekAnalysis.agent_run.agent_name, "DeepSeek Weibo Analysis");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results WHERE model='deepseek-chat'")[0].count, 4);
    const deepSeekRow = queryRows(
      "SELECT COUNT(*) AS count FROM sentiment_results WHERE model='deepseek-chat' AND JSON_EXTRACT(analysis_json, '$.ignored_model_numbers.weight') IS NOT NULL"
    )[0];
    assert.equal(deepSeekRow.count > 0, true);

    const deepSeekFailure = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({
        projectId,
        limit: 10,
        simulateDeepSeekFailure: "timeout"
      })
    ]);
    assert.equal(deepSeekFailure.ok, true);
    assert.equal(deepSeekFailure.deepseek.status, "failed");
    assert.equal(deepSeekFailure.agent_run.fallback_type, "local_rules");
    const workbenchAfterLocalAnalysis = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterLocalAnalysis.setup.progress.analysis_count, 4);
    assert.equal(workbenchAfterLocalAnalysis.setup.partialState, "analysis-without-event");
    const analysesList = runWorker([
      "weibo-analyses",
      "--payload-json",
      JSON.stringify({ projectId, limit: 3 })
    ]);
    assert.equal(analysesList.ok, true);
    assert.equal(analysesList.mode, "weibo-agent-mvp");
    assert.equal(analysesList.total, 4);
    assert.equal(analysesList.analyses.length, 3);
    assert.equal(analysesList.analyses[0].platform, "weibo");
    assert.equal(analysesList.analyses[0].comment_id > 0, true);
    assert.equal(typeof analysesList.analyses[0].content, "string");
    assert.equal(Object.hasOwn(analysesList.analyses[0], "sentiment"), true);
    assert.equal(Object.hasOwn(analysesList.analyses[0], "topics"), true);
    assert.equal(Object.hasOwn(analysesList.analyses[0], "risks"), true);
    assert.equal(Object.hasOwn(analysesList.analyses[0], "stance"), true);
    assert.equal(analysesList.citations.includes(`comment-${analysesList.analyses[0].comment_id}`), true);
    const analysisOnly = runWorker([
      "weibo-deepseek-fixture",
      "--comments",
      "test/fixtures/deepseek-comments.jsonl",
      "--now",
      "2026-06-10T12:00:00Z",
      "--simulate-failure",
      "timeout",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(analysisOnly.ok, true);
    const workbenchAfterAnalysisOnly = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterAnalysisOnly.setup.partialState, "analysis-without-event");
    assert.equal(workbenchAfterAnalysisOnly.setup.progress.analysis_count > 0, true);
    assert.equal(workbenchAfterAnalysisOnly.dataGaps.some((gap) => gap.code === "weibo_event_needed"), true);

    const builtEvents = runWorker([
      "weibo-events-build",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(builtEvents.ok, true);
    assert.equal(builtEvents.deepseek.status, "not_run");
    assert.equal(builtEvents.persisted_events > 0, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, builtEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM event_evidence_links")[0].count > 0, true);
    const builtEventsAgain = runWorker([
      "weibo-events-build",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(builtEventsAgain.persisted_events, builtEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, builtEvents.persisted_events);
    const realEvents = runWorker([
      "weibo-events",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(realEvents.ok, true);
    assert.equal(realEvents.events.length, builtEvents.persisted_events);
    assert.equal(realEvents.events[0].platform, "weibo");
    assert.equal(Object.hasOwn(realEvents.events[0], "evidence_ids"), true);
    const realEventDetail = runWorker([
      "weibo-events",
      "--event-id",
      String(realEvents.events[0].id),
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(realEventDetail.ok, true);
    assert.equal(realEventDetail.event.id, realEvents.events[0].id);

    const builtActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(builtActions.ok, true);
    assert.equal(builtActions.persisted_actions > 0, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND source='agent_recommended'", [projectId])[0].count, builtActions.persisted_actions);
    const builtActionsAgain = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(builtActionsAgain.persisted_actions, builtActions.persisted_actions);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND source='agent_recommended'", [projectId])[0].count, builtActions.persisted_actions);
    const pendingActions = runWorker([
      "weibo-actions-pending",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(pendingActions.ok, true);
    assert.equal(pendingActions.actions.some((action) => action.source === "agent_recommended"), true);
    const recommended = pendingActions.actions.find((action) => action.source === "agent_recommended");
    assert.equal(recommended.confirmation_status, "pending");
    assert.equal(recommended.related_event_id > 0, true);
    assert.equal(recommended.evidence_ids.length > 0, true);
    queryRows("UPDATE publicity_actions SET content_summary='人工保留的建议摘要' WHERE id=%s", [recommended.id]);
    const rejectedRecommendation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(recommended.id),
      "--payload-json",
      JSON.stringify({ projectId, confirmationStatus: "rejected", note: "人工驳回该建议" })
    ]);
    assert.equal(rejectedRecommendation.ok, true);
    assert.equal(rejectedRecommendation.action.confirmation_status, "rejected");
    const rebuildAfterRejection = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(rebuildAfterRejection.ok, true);
    const protectedRecommendation = queryRows("SELECT confirmation_status, content_summary FROM publicity_actions WHERE id=%s", [recommended.id])[0];
    assert.deepEqual(protectedRecommendation, {
      confirmation_status: "rejected",
      content_summary: "人工保留的建议摘要"
    });
    const botAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, question: "为什么微博负面升高，现在该做什么？" })
    ]);
    assert.equal(botAnswer.ok, true);
    assert.equal(botAnswer.answer.error, null);
    assert.equal(botAnswer.answer.facts.length > 0, true);
    assert.equal(botAnswer.answer.inferences.length > 0, true);
    assert.equal(botAnswer.answer.recommendations.length > 0, true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^comment-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^event-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^action-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.every((citation) => /^(comment|event|action)-\d+$/.test(citation)), true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_conversations WHERE project_id=%s", [projectId])[0].count, 1);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_messages WHERE project_id=%s", [projectId])[0].count, 2);

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 第二项目",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const secondProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 第二项目"])[0].id;
    runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId: secondProjectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ projectId: secondProjectId, targetId: "1001" })]);
    const secondDetail = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId: secondProjectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(secondDetail.ok, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_posts WHERE project_id=%s", [secondProjectId])[0].count, 2);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_comments WHERE project_id=%s", [secondProjectId])[0].count, 4);

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 Memory Only",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const memoryOnlyProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 Memory Only"])[0].id;
    queryRows(
      "INSERT INTO bot_memory_items(project_id, source_kind, source_id, memory_identity, title, summary, evidence_ids, memory_json, importance) VALUES (%s,'preference',NULL,'preference:memory-only','仅有记忆','只有历史偏好，没有当前微博证据',JSON_ARRAY(),JSON_OBJECT(),0.5)",
      [memoryOnlyProjectId]
    );
    const memoryOnlyAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId: memoryOnlyProjectId, question: "现在微博发生了什么？" })
    ]);
    assert.equal(memoryOnlyAnswer.ok, true);
    assert.equal(memoryOnlyAnswer.answer.error.error_type, "insufficient_evidence");
    assert.deepEqual(memoryOnlyAnswer.answer.citations, []);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_conversations WHERE project_id=%s", [memoryOnlyProjectId])[0].count, 1);
    assert.equal(queryRows("SELECT error_type FROM bot_messages WHERE project_id=%s AND role='assistant'", [memoryOnlyProjectId])[0].error_type, "insufficient_evidence");
  }
);

test(
  "runs MediaCrawler search and archives raw Weibo search JSONL before persisting targets",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const discovery = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        MEDIACRAWLER_CDP_PORT: "65533",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(discovery.ok, true);
    assert.equal(discovery.task.crawler_type, "search");
    assert.equal(discovery.persisted_targets, 2);
    assert.equal(discovery.targets[0].external_id, "mc-search-1");
    assert.equal(discovery.targets[0].url, "https://weibo.com/status/mc-search-1");
    assert.equal(discovery.targets[0].keyword, "海岛舒服日志");

    const taskRows = queryRows(
      "SELECT crawler_engine, status, output_path, raw_files, parsed_records, failed_records, collected_posts FROM collection_tasks WHERE id=%s",
      [discovery.task.id]
    );
    const task = taskRows[0];
    assert.equal(task.crawler_engine, "mediacrawler");
    assert.equal(task.status, "succeeded");
    assert.equal(task.parsed_records, 2);
    assert.equal(task.failed_records, 0);
    assert.equal(task.collected_posts, 2);
    assert.match(task.output_path, new RegExp(`storage/mediacrawler/${projectId}/${discovery.task.id}/weibo/`));

    const rawFiles = JSON.parse(task.raw_files);
    assert.equal(rawFiles.length, 1);
    assert.equal(rawFiles.every((file) => existsSync(file)), true);
    assert.equal(rawFiles.some((file) => file.includes("search_contents_")), true);
    assert.match(readFileSync(rawFiles.find((file) => file.includes("search_contents_")), "utf8"), /mc-search-1/);

    const targetIds = queryRows("SELECT external_id FROM discovered_targets ORDER BY `rank`, id").map((row) => row.external_id);
    assert.deepEqual(targetIds, ["mc-search-1", "mc-search-2"]);

    const invocation = JSON.parse(readFileSync(`${task.output_path}/invocation.json`, "utf8"));
    assert.equal(invocation.has_mysql_url, false);
    assert.equal(invocation.has_deepseek_key, false);
    assert.equal(invocation.has_cookies_arg, false);
    assert.equal(invocation.cookie_value_redacted, true);
    assert.equal(invocation.argv.includes("fake-sub-for-tests"), false);
    assert.equal(invocation.argv.includes("other-site-token"), false);
    assert.equal(invocation.config_cookie_present, true);
    assert.equal(invocation.config_cookie_value_recorded, false);
    assert.equal(invocation.config_cookie_has_unrelated, false);
    assert.equal(invocation.config_cdp_port, 65533);
    assert.equal(invocation.mediacrawler_cdp_port, "65533");
    assert.deepEqual(flagValue(invocation.argv, "--crawler_max_notes_count"), "10");
    assert.deepEqual(flagValue(invocation.argv, "--get_comment"), "false");
    assert.deepEqual(flagValue(invocation.argv, "--max_comments_count_singlenotes"), "0");
  }
);

test(
  "marks MediaCrawler search tasks failed when archived JSONL cannot be parsed",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);

    const failed = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志 bad-json",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "mediacrawler_parse_failed");
    const taskRows = queryRows("SELECT status, error_type, parsed_records, failed_records FROM collection_tasks WHERE id=%s", [failed.task.id]);
    assert.deepEqual(taskRows[0], {
      status: "failed",
      error_type: "mediacrawler_parse_failed",
      parsed_records: 0,
      failed_records: 1
    });
  }
);

test(
  "keeps valid MediaCrawler search rows and marks the task partial when some JSONL lines fail",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);

    const partial = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志 partial-json",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(partial.ok, true);
    assert.equal(partial.status, "partial");
    assert.equal(partial.persisted_targets, 1);
    assert.equal(partial.failed_records, 1);
    const taskRows = queryRows("SELECT status, parsed_records, failed_records, collected_posts FROM collection_tasks WHERE id=%s", [partial.task.id]);
    assert.deepEqual(taskRows[0], {
      status: "partial",
      parsed_records: 1,
      failed_records: 1,
      collected_posts: 1
    });
  }
);

test(
  "runs MediaCrawler detail for a selected target and archives raw Weibo detail JSONL",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    const selected = runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ targetId: "1001" })]);
    assert.equal(selected.ok, true);

    const detail = runWorker(
      [
        "weibo-collect-target",
        "--target-id",
        "1001",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 25
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        MEDIACRAWLER_CDP_PORT: "65533",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(detail.ok, true);
    assert.equal(detail.status, "succeeded");
    assert.equal(detail.persisted_posts, 1);
    assert.equal(detail.persisted_comments, 2);

    const taskRows = queryRows(
      "SELECT crawler_engine, status, output_path, raw_files, parsed_records, failed_records, collected_posts, collected_comments FROM collection_tasks WHERE id=%s",
      [detail.task.id]
    );
    const task = taskRows[0];
    assert.equal(task.crawler_engine, "mediacrawler");
    assert.equal(task.status, "succeeded");
    assert.equal(task.parsed_records, 3);
    assert.equal(task.failed_records, 0);
    assert.equal(task.collected_posts, 1);
    assert.equal(task.collected_comments, 2);
    assert.match(task.output_path, new RegExp(`storage/mediacrawler/${projectId}/${detail.task.id}/weibo/`));

    const rawFiles = JSON.parse(task.raw_files);
    assert.equal(rawFiles.length, 2);
    assert.equal(rawFiles.every((file) => existsSync(file)), true);
    assert.equal(rawFiles.some((file) => file.includes("detail_contents_")), true);
    assert.equal(rawFiles.some((file) => file.includes("detail_comments_")), true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM target_collection_links WHERE collection_task_id=%s", [detail.task.id])[0].count, 1);
    assert.equal(queryRows("SELECT external_id, source_account_external_id FROM social_posts WHERE external_id='m1001'")[0].source_account_external_id, "mc-detail-user");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_comments WHERE post_id=(SELECT id FROM social_posts WHERE external_id='m1001')")[0].count, 2);

    const invocation = JSON.parse(readFileSync(`${task.output_path}/invocation.json`, "utf8"));
    assert.equal(flagValue(invocation.argv, "--type"), "detail");
    assert.equal(flagValue(invocation.argv, "--specified_id"), "m1001");
    assert.equal(flagValue(invocation.argv, "--get_comment"), "true");
    assert.equal(flagValue(invocation.argv, "--max_comments_count_singlenotes"), "25");
    assert.equal(invocation.has_cookies_arg, false);
    assert.equal(invocation.argv.includes("fake-sub-for-tests"), false);
    assert.equal(invocation.config_cookie_present, true);
    assert.equal(invocation.config_cdp_port, 65533);
  }
);

test(
  "does not leak child process environment or stderr when MediaCrawler search fails",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);

    const failed = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志 fail-runtime",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile,
        DEEPSEEK_API_KEY: "sk-parent-secret"
      }
    );

    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "mediacrawler_search_failed");
    assert.equal(failed.cause, "exit_code=2");
    assert.equal(JSON.stringify(failed).includes("sk-parent-secret"), false);
    assert.equal(JSON.stringify(failed).includes("should-not-leak"), false);
  }
);

test(
  "returns a standard MediaCrawler missing error for selected-target detail when runtime is unavailable",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    assert.equal(runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ targetId: "1001" })]).ok, true);

    const blocked = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 25
      })
    ]);

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "mediacrawler_missing");
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "mediacrawler_missing" });
  }
);

test(
  "rejects fixture paths outside the allowlisted test fixture directory",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const rejected = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: ".env.example"
      })
    ]);

    assert.equal(rejected.ok, false);
    assert.equal(rejected.error_type, "invalid_fixture_path");
  }
);

test(
  "returns a standard MediaCrawler missing error when real search runtime is unavailable",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const blocked = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10
      })
    ]);

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "mediacrawler_missing");
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "mediacrawler_missing" });
  }
);

test(
  "returns a standard auth error when MediaCrawler search has no Weibo cookie file",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const blocked = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test"
      }
    );

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "auth_required");
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "auth_required" });
  }
);

test(
  "rejects raw cookie header files because Weibo domains cannot be filtered",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const blocked = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: "test/fixtures/weibo-cookie-header.json"
      }
    );

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "auth_invalid");
    assert.equal(blocked.cause.includes("Raw cookie header strings are not accepted"), true);
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "auth_invalid" });
  }
);

test(
  "persists Weibo target and post source types from stable source accounts before display-name fallback",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    for (const account of [
      {
        projectId,
        externalId: "u-stable",
        profileUrl: "https://weibo.com/u/stable",
        displayName: "稳定官号",
        sourceType: "official",
        confirmedByUser: true
      },
      {
        projectId,
        displayName: "重名娱乐号",
        sourceType: "media",
        confirmedByUser: true
      },
      {
        projectId,
        displayName: "无ID营销号",
        sourceType: "marketing",
        confirmedByUser: true
      },
      {
        projectId,
        displayName: "有ID同名粉丝",
        sourceType: "fan",
        confirmedByUser: true
      },
      {
        projectId,
        profileUrl: "https://weibo.com/u/url-only",
        displayName: "URL稳定艺人号",
        sourceType: "artist",
        confirmedByUser: true
      }
    ]) {
      const upsert = runWorker(["weibo-source-account-upsert", "--payload-json", JSON.stringify(account)]);
      assert.equal(upsert.ok, true);
    }

    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 4,
        fixturePath: "test/fixtures/weibo-source-type-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    assert.equal(discovery.persisted_targets, 4);

    const targetSourceRows = queryRows(
      "SELECT external_id, source_type, source_match_method, CAST(source_match_confidence AS CHAR) AS source_match_confidence FROM discovered_targets WHERE project_id=%s ORDER BY external_id",
      [projectId]
    );
    assert.deepEqual(targetSourceRows, [
      {
        external_id: "st1001",
        source_type: "official",
        source_match_method: "stable_id",
        source_match_confidence: "1.0000"
      },
      {
        external_id: "st1002",
        source_type: "marketing",
        source_match_method: "display_name",
        source_match_confidence: "0.5500"
      },
      {
        external_id: "st1003",
        source_type: "unknown",
        source_match_method: "stable_unmatched",
        source_match_confidence: "0.2000"
      },
      {
        external_id: "st1004",
        source_type: "artist",
        source_match_method: "stable_url",
        source_match_confidence: "0.9500"
      }
    ]);

    assert.equal(
      targetSourceRows.find((row) => row.external_id === "st1001").source_type,
      "official",
      "stable external ID should outrank a conflicting display-name account"
    );
    assert.equal(
      targetSourceRows.find((row) => row.external_id === "st1003").source_type,
      "unknown",
      "display-name fallback is not allowed when a stable account identifier is present"
    );

    const selected = runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "st1001" })
    ]);
    assert.equal(selected.ok, true);

    const detail = runWorker([
      "weibo-collect-target",
      "--target-id",
      "st1001",
      "--payload-json",
      JSON.stringify({
        projectId,
        fixturePath: "test/fixtures/weibo-source-type-detail.jsonl"
      })
    ]);
    assert.equal(detail.ok, true);
    assert.equal(detail.persisted_posts, 4);

    const postSourceRows = queryRows(
      "SELECT external_id, source_type, source_match_method, CAST(source_match_confidence AS CHAR) AS source_match_confidence FROM social_posts WHERE project_id=%s ORDER BY external_id",
      [projectId]
    );
    assert.deepEqual(postSourceRows, targetSourceRows);
  }
);

test(
  "attaches existing Weibo worker commands to Agent Loop run when exact agentLoopRunId is provided",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    assert.equal(runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "1001" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]).ok, true);

    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({
        projectId,
        triggerMode: "manual",
        input: { source: "step-attachment-test" }
      })
    ]);
    assert.equal(loop.ok, true);
    const agentLoopRunId = loop.run.id;

    const analysis = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10, agentLoopRunId })
    ]);
    assert.equal(analysis.ok, true);
    assert.equal(analysis.agentStepRun.step_name, "comment_analysis");
    assert.equal(analysis.agentStepRun.status, "succeeded");
    assert.equal(analysis.agentStepRun.evidence_ids.length > 0, true);

    const events = runWorker([
      "weibo-events-build",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId })
    ]);
    assert.equal(events.ok, true);
    assert.equal(events.persisted_events > 0, true);
    assert.equal(events.agentStepRun.step_name, "event_building");
    assert.equal(events.agentStepRun.status, "succeeded");
    assert.equal(events.agentStepRun.evidence_ids.length > 0, true);

    const actions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(actions.ok, true);
    assert.equal(actions.persisted_actions > 0, true);
    assert.equal(actions.agentStepRun.step_name, "action_recommendation");
    assert.equal(actions.agentStepRun.status, "succeeded");
    assert.equal(actions.agentStepRun.evidence_ids.length > 0, true);

    const bot = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId, question: "为什么微博负面升高，现在该做什么？" })
    ]);
    assert.equal(bot.ok, true);
    assert.equal(bot.answer.error, null);
    assert.equal(bot.agentStepRun.step_name, "evidence_qa");
    assert.equal(bot.agentStepRun.status, "succeeded");
    assert.equal(bot.agentStepRun.evidence_ids.length > 0, true);

    const persistedSteps = queryRows(
      "SELECT agent_name, step_name, status, JSON_LENGTH(evidence_ids) AS evidence_count, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.command')) AS command FROM agent_step_runs WHERE loop_run_id=%s ORDER BY id",
      [agentLoopRunId]
    );
    assert.deepEqual(persistedSteps, [
      {
        agent_name: "Issue Analysis Agent",
        step_name: "comment_analysis",
        status: "succeeded",
        evidence_count: analysis.agentStepRun.evidence_ids.length,
        command: "weibo-comments-analyze"
      },
      {
        agent_name: "Event Agent",
        step_name: "event_building",
        status: "succeeded",
        evidence_count: events.agentStepRun.evidence_ids.length,
        command: "weibo-events-build"
      },
      {
        agent_name: "Strategy Agent",
        step_name: "action_recommendation",
        status: "succeeded",
        evidence_count: actions.agentStepRun.evidence_ids.length,
        command: "weibo-actions-build"
      },
      {
        agent_name: "QA Agent",
        step_name: "evidence_qa",
        status: "succeeded",
        evidence_count: bot.agentStepRun.evidence_ids.length,
        command: "weibo-bot-message"
      }
    ]);

    const status = runWorker([
      "weibo-agent-loop-status",
      "--payload-json",
      JSON.stringify({ projectId, loopRunId: agentLoopRunId })
    ]);
    assert.deepEqual(status.steps.map((step) => step.step_name), [
      "comment_analysis",
      "event_building",
      "action_recommendation",
      "evidence_qa"
    ]);
  }
);

test(
  "rejects invalid or cross-project agentLoopRunId before business writeback",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    assert.equal(runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "1001" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]).ok, true);

    const missingRun = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10, agentLoopRunId: 999999 })
    ]);
    assert.equal(missingRun.ok, false);
    assert.equal(missingRun.error_type, "agent_loop_not_found");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results")[0].count, 0);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs")[0].count, 0);

    for (const command of ["weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const missing = runWorker(commandArgs(command, { projectId, agentLoopRunId: 999999 }));
      assert.equal(missing.ok, false, command);
      assert.equal(missing.error_type, "agent_loop_not_found", command);
    }

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 Step Attachment 隔离项目",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const otherProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 Step Attachment 隔离项目"])[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const crossProject = runWorker(commandArgs(command, { projectId: otherProjectId, agentLoopRunId: loop.run.id }));
      assert.equal(crossProject.ok, false, command);
      assert.equal(crossProject.error_type, "agent_loop_not_found", command);
    }
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [otherProjectId])[0].count, 0);
  }
);

test(
  "rejects attached commands with explicit missing project before default project fallback",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    const before = writebackCounts(projectId);

    for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const result = runWorker(commandArgs(command, { projectId: 999999, agentLoopRunId: loop.run.id }));
      assert.equal(result.ok, false, command);
      assert.equal(result.error_type, "project_not_found", command);
    }

    assert.deepEqual(writebackCounts(projectId), before);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_step_runs WHERE loop_run_id=%s", [loop.run.id])[0].count, 0);
  }
);

test(
  "records no-evidence Agent Loop attachments as partial and ignores run id aliases",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    const agentLoopRunId = loop.run.id;

    for (const aliasKey of ["loopRunId", "agent_loop_run_id"]) {
      for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
        const aliasOnly = runWorker(commandArgs(command, { projectId, [aliasKey]: agentLoopRunId }));
        assert.equal(aliasOnly.ok, true, `${command} ${aliasKey}`);
      }
    }
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_step_runs WHERE loop_run_id=%s", [agentLoopRunId])[0].count, 0);

    for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const exact = runWorker(commandArgs(command, { projectId, agentLoopRunId }));
      assert.equal(exact.ok, true, command);
      assert.equal(exact.agentStepRun.status, "partial", command);
      assert.notEqual(exact.agentStepRun.step_name, undefined, command);
      assert.deepEqual(exact.agentStepRun.evidence_ids, [], command);
    }

    const stepRows = queryRows(
      "SELECT step_name, status, JSON_LENGTH(evidence_ids) AS evidence_count, error_type FROM agent_step_runs WHERE loop_run_id=%s ORDER BY id",
      [agentLoopRunId]
    );
    assert.deepEqual(stepRows, [
      { step_name: "comment_analysis", status: "partial", evidence_count: 0, error_type: "no_comments_to_analyze" },
      { step_name: "event_building", status: "partial", evidence_count: 0, error_type: "no_analysis_evidence" },
      { step_name: "action_recommendation", status: "partial", evidence_count: 0, error_type: "no_events_for_actions" },
      { step_name: "evidence_qa", status: "partial", evidence_count: 0, error_type: "insufficient_evidence" }
    ]);
  }
);

test(
  "preserves original worker error fields when an attached Agent Loop step fails",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);

    const failed = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId: loop.run.id })
    ]);
    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "question_required");
    assert.equal(typeof failed.cause, "string");
    assert.equal(typeof failed.fix, "string");
    assert.equal(failed.agentStepRun.step_name, "evidence_qa");
    assert.equal(failed.agentStepRun.status, "failed");
    assert.equal(failed.agentStepRun.error_type, "question_required");

    const stepRow = queryRows(
      "SELECT status, error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.error_type')) AS output_error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.cause')) AS output_cause, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.fix')) AS output_fix FROM agent_step_runs WHERE loop_run_id=%s",
      [loop.run.id]
    )[0];
    assert.equal(stepRow.status, "failed");
    assert.equal(stepRow.error_type, "question_required");
    assert.equal(stepRow.output_error_type, "question_required");
    assert.equal(typeof stepRow.output_cause, "string");
    assert.equal(typeof stepRow.output_fix, "string");
  }
);

test(
  "records an attached failed step when worker execution raises unexpectedly",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    assert.equal(runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "1001" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]).ok, true);

    queryRows("DROP TABLE sentiment_results");

    const failed = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId: loop.run.id })
    ]);
    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "worker_execution_failed");
    assert.equal(typeof failed.cause, "string");
    assert.equal(typeof failed.fix, "string");
    assert.equal(failed.agentStepRun.status, "failed");
    assert.equal(failed.agentStepRun.error_type, "worker_execution_failed");

    const stepRow = queryRows(
      "SELECT status, error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.error_type')) AS output_error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.cause')) AS output_cause, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.fix')) AS output_fix FROM agent_step_runs WHERE loop_run_id=%s",
      [loop.run.id]
    )[0];
    assert.equal(stepRow.status, "failed");
    assert.equal(stepRow.error_type, "worker_execution_failed");
    assert.equal(stepRow.output_error_type, "worker_execution_failed");
    assert.equal(typeof stepRow.output_cause, "string");
    assert.equal(typeof stepRow.output_fix, "string");
  }
);

test(
  "persists agent runs, events, action ledger state, and bot memory items into MySQL",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    assert.equal(runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ projectId, targetId: "1001" })]).ok, true);
    const detail = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(detail.ok, true);
    assert.equal(detail.persisted_comments > 0, true);

    const analysis = runWorker([
      "weibo-deepseek-fixture",
      "--comments",
      "test/fixtures/deepseek-comments.jsonl",
      "--now",
      "2026-06-10T12:00:00Z",
      "--simulate-failure",
      "timeout",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(analysis.ok, true);
    assert.equal(analysis.persisted_agent_runs, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs WHERE project_id=%s", [projectId])[0].count, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs WHERE error_message='retry_exhausted'")[0].count, 1);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE source_kind='analysis'")[0].count, 1);

    const fallbackEvents = runWorker([
      "weibo-build-events-fixture",
      "--fixture",
      "test/fixtures/weibo-event-evidence.jsonl",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(fallbackEvents.ok, true);
    assert.equal(fallbackEvents.persisted_events >= 2, true);

    const events = runWorker([
      "weibo-build-events-fixture",
      "--fixture",
      "test/fixtures/weibo-event-evidence.jsonl",
      "--deepseek-response",
      "test/fixtures/deepseek-event-response.md",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(events.ok, true);
    assert.equal(events.persisted_events, fallbackEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, fallbackEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM event_evidence_links")[0].count > 0, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM event_status_history")[0].count > 0, true);
    const explainedEvent = queryRows(
      "SELECT title, event_score, risk_level, impact_assessment, JSON_LENGTH(recommended_actions) AS recommended_count FROM artist_public_opinion_events WHERE project_id=%s AND title=%s ORDER BY event_score DESC, id LIMIT 1",
      [projectId, "DeepSeek 官宣可信度风险升温"]
    )[0];
    assert.equal(explainedEvent.risk_level, "high");
    assert.notEqual(Number(explainedEvent.event_score), 999);
    assert.match(explainedEvent.impact_assessment, /官方澄清/);
    assert.equal(explainedEvent.recommended_count > 0, true);
    const repeatedEvents = runWorker([
      "weibo-build-events-fixture",
      "--fixture",
      "test/fixtures/weibo-event-evidence.jsonl",
      "--deepseek-response",
      "test/fixtures/deepseek-event-response.md",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(repeatedEvents.ok, true);
    assert.equal(repeatedEvents.persisted_events, events.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, fallbackEvents.persisted_events);

    const eventId = queryRows("SELECT id FROM artist_public_opinion_events WHERE project_id=%s ORDER BY event_score DESC, id LIMIT 1", [projectId])[0].id;
    const manualAccount = runWorker([
      "weibo-source-account-upsert",
      "--payload-json",
      JSON.stringify({
        projectId,
        externalId: "u-manual-official",
        profileUrl: "https://weibo.com/u/manual-official",
        displayName: "手工确认官号",
        sourceType: "official",
        confirmedByUser: true
      })
    ]);
    assert.equal(manualAccount.ok, true);
    assert.equal(manualAccount.account.source_type, "official");
    assert.equal(manualAccount.account.confirmed_by_user, true);

    const actions = runWorker([
      "weibo-actions-fixture",
      "--accounts",
      "test/fixtures/weibo-source-accounts.json",
      "--posts",
      "test/fixtures/weibo-action-posts.jsonl",
      "--event-id",
      String(eventId),
      "--now",
      "2026-06-10T12:00:00Z",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(actions.ok, true);
    assert.equal(actions.persisted_source_accounts, 3);
    assert.equal(actions.persisted_actions >= 4, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM source_accounts WHERE project_id=%s", [projectId])[0].count, 4);

    const repeatedActions = runWorker([
      "weibo-actions-fixture",
      "--accounts",
      "test/fixtures/weibo-source-accounts.json",
      "--posts",
      "test/fixtures/weibo-action-posts.jsonl",
      "--event-id",
      String(eventId),
      "--now",
      "2026-06-10T12:00:00Z",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(repeatedActions.ok, true);
    assert.equal(repeatedActions.persisted_source_accounts, 3);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM source_accounts WHERE project_id=%s", [projectId])[0].count, 4);

    const pending = runWorker(["weibo-actions-pending", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(pending.ok, true);
    assert.equal(pending.actions.some((action) => action.source === "official_observed"), true);
    assert.equal(pending.actions.some((action) => action.source === "agent_recommended"), true);

    const officialAction = queryRows(
      "SELECT id, confirmation_status, observed_at, confirmed_at, effective_at FROM publicity_actions WHERE source='official_observed' ORDER BY id LIMIT 1"
    )[0];
    assert.equal(officialAction.confirmation_status, "pending");
    assert.notEqual(officialAction.observed_at, null);
    assert.notEqual(officialAction.effective_at, null);

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 行动隔离项目",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const otherProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 行动隔离项目"])[0].id;
    const wrongProjectConfirmation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(officialAction.id),
      "--payload-json",
      JSON.stringify({ projectId: otherProjectId, confirmationStatus: "rejected" })
    ]);
    assert.equal(wrongProjectConfirmation.ok, false);
    assert.equal(wrongProjectConfirmation.error_type, "action_not_found");

    const confirmation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(officialAction.id),
      "--payload-json",
      JSON.stringify({
        projectId,
        confirmationStatus: "confirmed",
        effectiveAt: "2026-06-10T08:00:00Z",
        note: "已核对官号发布时间和事件证据"
      })
    ]);
    assert.equal(confirmation.ok, true);
    assert.equal(confirmation.action.confirmation_status, "confirmed");
    assert.notEqual(queryRows("SELECT confirmed_at FROM publicity_actions WHERE id=%s", [officialAction.id])[0].confirmed_at, null);
    const confirmationMemory = queryRows(
      "SELECT summary, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.confirmation_note')) AS note FROM bot_memory_items WHERE project_id=%s AND source_kind='action' AND source_id=%s ORDER BY id DESC LIMIT 1",
      [projectId, officialAction.id]
    )[0];
    assert.equal(confirmationMemory.summary, "已核对官号发布时间和事件证据");
    assert.equal(confirmationMemory.note, "已核对官号发布时间和事件证据");

    const repeatedConfirmation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(officialAction.id),
      "--payload-json",
      JSON.stringify({ projectId, confirmationStatus: "rejected" })
    ]);
    assert.equal(repeatedConfirmation.ok, false);
    assert.equal(repeatedConfirmation.error_type, "action_already_confirmed");
    assert.equal(
      queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [officialAction.id])[0].confirmation_status,
      "confirmed"
    );

    const backtest = runWorker([
      "weibo-backtest-fixture",
      "--fixture",
      "test/fixtures/weibo-backtest-scenarios.json",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(backtest.ok, true);
    assert.equal(backtest.persisted_memory_items, backtest.results.length);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='backtest'", [projectId])[0].count, backtest.results.length);
    const workbenchAfterBacktestMemory = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterBacktestMemory.setup.progress.backtest_count, backtest.results.length);
    assert.equal(workbenchAfterBacktestMemory.setup.partialState, "backtested");
    assert.equal(workbenchAfterBacktestMemory.dataGaps.some((gap) => gap.code === "weibo_backtest_needed"), false);
    const persistedBacktest = queryRows(
      "SELECT title, summary, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.result')) AS result FROM bot_memory_items WHERE project_id=%s AND source_kind='backtest' AND JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.scenario_id'))='strong' LIMIT 1",
      [projectId]
    )[0];
    assert.match(persistedBacktest.title, /strong/);
    assert.match(persistedBacktest.summary, /continue|monitor/i);
    assert.equal(persistedBacktest.result, "strong");
    const repeatedBacktest = runWorker([
      "weibo-backtest-fixture",
      "--fixture",
      "test/fixtures/weibo-backtest-scenarios.json",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(repeatedBacktest.ok, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='backtest'", [projectId])[0].count, backtest.results.length);

    const report = runWorker([
      "weibo-memory-report-fixture",
      "--fixture",
      "test/fixtures/weibo-memory-records.json",
      "--question",
      "为什么微博负面升高",
      "--now",
      "2026-06-10T12:00:00Z",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(report.ok, true);
    assert.equal(report.persisted_memory_items >= 1, true);

    const memoryKinds = queryRows(
      "SELECT source_kind, COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s GROUP BY source_kind ORDER BY source_kind",
      [projectId]
    );
    const kinds = new Set(memoryKinds.map((row) => row.source_kind));
    for (const kind of ["analysis", "event", "action", "backtest", "report", "preference"]) {
      assert.equal(kinds.has(kind), true, `${kind} memory item should be persisted`);
    }
    const preference = queryRows(
      "SELECT memory_identity, title, summary, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.id')) AS fixture_id FROM bot_memory_items WHERE project_id=%s AND source_kind='preference' LIMIT 1",
      [projectId]
    )[0];
    assert.equal(preference.memory_identity, "preference:preference-1");
    assert.match(preference.title, /用户偏好/);
    assert.match(preference.summary, /可追溯证据/);
    assert.equal(preference.fixture_id, "preference-1");
  }
);

function runWorker(args, envOverrides = {}) {
  const result = spawnSync(python, ["workers/enterprise_worker.py", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_URL: testMysqlUrl,
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_API_URL: "",
      DEEPSEEK_MODEL: "",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json",
      MEDIACRAWLER_HOME: "/tmp/mediacrawler-does-not-exist",
      MEDIACRAWLER_PYTHON: "/tmp/python-does-not-exist",
      MEDIACRAWLER_OUTPUT_DIR: "/tmp/weibo-mvp-test-output",
      MEDIACRAWLER_CDP_PORT: "65534",
      WEIBO_FIXTURE_MODE: "1",
      ...envOverrides
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function commandArgs(command, payload) {
  const commandPayload = { ...payload };
  if (command === "weibo-bot-message" && !Object.hasOwn(commandPayload, "question")) {
    commandPayload.question = "现在微博发生了什么？";
  }
  return [command, "--payload-json", JSON.stringify(commandPayload)];
}

function writebackCounts(projectId) {
  return queryRows(
    `
    SELECT
      (SELECT COUNT(*) FROM sentiment_results sr JOIN social_comments c ON c.id=sr.comment_id WHERE c.project_id=%s) AS sentiments,
      (SELECT COUNT(*) FROM agent_runs WHERE project_id=%s) AS agent_runs,
      (SELECT COUNT(*) FROM artist_public_opinion_events WHERE project_id=%s) AS events,
      (SELECT COUNT(*) FROM publicity_actions WHERE project_id=%s) AS actions,
      (SELECT COUNT(*) FROM bot_conversations WHERE project_id=%s) AS conversations,
      (SELECT COUNT(*) FROM bot_messages WHERE project_id=%s) AS messages
    `,
    [projectId, projectId, projectId, projectId, projectId, projectId]
  )[0];
}

function resetTestDatabase() {
  const result = spawnSync(
    python,
    [
      "-c",
      `
import os
from urllib.parse import urlparse
import pymysql

url = os.environ["WEIBO_DB_PERSISTENCE_TEST_URL"]
parsed = urlparse(url)
database = parsed.path.lstrip("/")
if not database.startswith("yuqing_monitor_test"):
    raise SystemExit("Refusing to reset non-test database: " + database)
conn = pymysql.connect(
    host=parsed.hostname or "127.0.0.1",
    port=parsed.port or 3306,
    user=parsed.username or "root",
    password=parsed.password or "",
    charset="utf8mb4",
    autocommit=True,
)
with conn.cursor() as cur:
    quoted = database.replace(chr(96), chr(96) * 2)
    cur.execute("DROP DATABASE IF EXISTS " + chr(96) + quoted + chr(96))
    cur.execute("CREATE DATABASE " + chr(96) + quoted + chr(96) + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
conn.close()
`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, WEIBO_DB_PERSISTENCE_TEST_URL: testMysqlUrl }
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function queryRows(sql, params = []) {
  const result = spawnSync(
    python,
    [
      "-c",
      `
import json
import os
from workers import db

sql = os.environ["SQL"]
params = json.loads(os.environ.get("PARAMS", "[]"))
with db.connect() as conn:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
print(json.dumps(rows, ensure_ascii=False, default=str))
`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MYSQL_URL: testMysqlUrl,
        SQL: sql,
        PARAMS: JSON.stringify(params)
      }
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function columnType(table, column) {
  const rows = queryRows(
    "SELECT COLUMN_TYPE AS column_type FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s",
    [table, column]
  );
  assert.equal(rows.length, 1, `${table}.${column} should exist`);
  return rows[0].column_type;
}

function enumValues(columnTypeText) {
  const values = [];
  const regex = /'((?:''|[^'])*)'/g;
  let match;
  while ((match = regex.exec(columnTypeText)) !== null) {
    values.push(match[1].replaceAll("''", "'"));
  }
  return values;
}

function runPythonSnippet(code, envOverrides = {}) {
  const result = spawnSync(python, ["-c", code], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_URL: testMysqlUrl,
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_API_URL: "",
      DEEPSEEK_MODEL: "",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json",
      MEDIACRAWLER_HOME: "/tmp/mediacrawler-does-not-exist",
      MEDIACRAWLER_PYTHON: "/tmp/python-does-not-exist",
      MEDIACRAWLER_OUTPUT_DIR: "/tmp/weibo-mvp-test-output",
      MEDIACRAWLER_CDP_PORT: "65534",
      WEIBO_FIXTURE_MODE: "1",
      ...envOverrides
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}
