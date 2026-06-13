import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const testMysqlUrl = process.env.WEIBO_DB_PERSISTENCE_TEST_URL;
const fakeWeiboCookieFile = "test/fixtures/weibo-cookie.json";

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

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}
