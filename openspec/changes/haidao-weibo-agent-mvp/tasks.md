## 1. Schema and Configuration

- [x] 1.1 Add an idempotent ingestion migration chunk for Weibo MVP target/task/post/comment/source columns.
- [x] 1.2 Add `discovered_targets` with `target_locator` fields: platform, target type, external ID, URL, Weibo mid or equivalent status ID when available, author external ID or author URL when available, content fingerprint, raw JSON, rank, hot score, recommendation metadata, and selected status.
- [x] 1.3 Add `target_collection_links` and extend `collection_tasks` with crawler engine, crawler type, error type, output path, raw files, parsed/failed records, target ID, and partial/analyzing/analyzed-compatible status handling.
- [x] 1.4 Extend `social_posts` and `social_comments` with source type, source account identifiers, content fingerprint, comment weight, reply metadata, and raw JSON fields needed for Weibo MVP.
- [x] 1.5 Expand `platform_auth_states.status` to support `expired`, `verification_required`, `rate_limited`, and `unknown` while preserving existing `configured` compatibility.
- [x] 1.6 Add an idempotent event/action/backtest migration chunk for `source_accounts`, `artist_public_opinion_events`, `event_evidence_links`, `event_status_history`, `publicity_actions`, and `action_backtests`.
- [x] 1.7 Add an idempotent memory/report migration chunk for `bot_memory_items`, `bot_conversations`, `bot_messages`, and `daily_reports`.
- [x] 1.8 Extend `sentiment_results` with stance, issue summary, intensity, weight snapshot, analysis JSON, fallback type, and analyzed time.
- [x] 1.9 Update default project initialization so 《海岛舒服日志》 exists with Weibo as the active MVP platform and 刘昊然/李兰迪 keyword packs.
- [x] 1.10 Add `.env.example` entries for `MEDIACRAWLER_HOME`, `MEDIACRAWLER_COMMIT`, `MEDIACRAWLER_PYTHON`, `MEDIACRAWLER_OUTPUT_DIR`, and `MEDIACRAWLER_CDP_PORT`.

## 2. Weibo Health and Scope Guardrails

- [x] 2.1 Implement MediaCrawler home, commit, python executable, output directory, and Chrome CDP checks in the worker health path.
- [x] 2.2 Implement Weibo auth state reporting with machine-readable errors for missing, expired, invalid, verification-required, and rate-limited states.
- [x] 2.3 Standardize Weibo MVP error payloads with `error_type`, `message`, `cause`, `fix`, and optional `docs_anchor`.
- [x] 2.4 Ensure the Weibo MVP collection path rejects Xiaohongshu and Douyin requests without creating collection tasks.
- [x] 2.5 Ensure legacy `/api/collect` cannot silently run Xiaohongshu or Douyin in Weibo MVP mode and directs users to `/api/weibo/discovery` or rejects safely.
- [x] 2.6 Ensure `/api/health` and the worker health command keep the web service available when MySQL, MediaCrawler, CDP, or Weibo auth is unavailable.

## 3. Weibo Discovery and Target Recommendation

- [x] 3.1 Add `POST /api/weibo/discovery` and a matching internal worker command to create Weibo search discovery tasks for a single project keyword.
- [ ] 3.2 Invoke MediaCrawler in Weibo `search` mode with generated runtime config and task-specific output path.
- [ ] 3.3 Archive raw Weibo search JSONL under `storage/mediacrawler/<project_id>/<task_id>/weibo/<keyword_slug>/`.
- [x] 3.4 Parse Weibo search JSONL into at most 10 `discovered_targets` per keyword with rank, hot score, title/summary, author, URL, engagement fields, content fingerprint, and raw JSON.
- [x] 3.5 Extract and persist target locator fields for each Weibo target, including Weibo mid or equivalent status ID and author external ID/profile URL when available.
- [x] 3.6 Generate Agent recommendation metadata for each Weibo target, including recommendation state, reason, expected question answered, confidence, and target ID.
- [x] 3.7 Add fixture-based unit tests for Weibo search JSONL parsing, target locator extraction, hot score calculation, top-10 retention, and recommendation state.

## 4. Target Selection and Weibo Detail Collection

- [x] 4.1 Add `GET /api/weibo/targets`, `POST /api/weibo/targets/select`, and `POST /api/weibo/targets/ignore` backed by explicit worker subcommands.
- [x] 4.2 Prevent comment collection for pending or ignored Weibo targets.
- [x] 4.3 Add detail collection task creation for selected Weibo targets and link each task through `target_collection_links`.
- [x] 4.4 Add `POST /api/weibo/targets/:id/collect-comments` backed by an internal `weibo-collect-target` worker command.
- [x] 4.5 Validate the selected target's `target_locator` before MediaCrawler detail execution.
- [x] 4.6 If the target cannot be resolved for MediaCrawler detail, fail the task with `target_detail_unsupported`, keep the target selected, and return an actionable remediation payload.
- [ ] 4.7 Invoke MediaCrawler in Weibo `detail` mode for selected targets and archive raw detail JSONL.
- [x] 4.8 Parse Weibo detail JSONL into `social_posts` and `social_comments` with stable deduplication by platform and external ID.
- [x] 4.9 Record adapter failed record counts and partial/failure task status when detail JSONL contains bad records.
- [x] 4.10 Add fixture-based unit tests for Weibo detail parsing, deduplication, bad rows, unsupported locators, and target-task linking.

## 5. Weibo Topic Analysis

- [x] 5.1 Compute deterministic Weibo comment weights from like count, reply count, author verification, and collection recency.
- [x] 5.2 Extend the comment analysis worker to output sentiment, score, confidence, topics, risks, stance, issue summary, intensity, weight, evidence, model, fallback type, and analyzed time.
- [x] 5.3 Batch pending Weibo comments for DeepSeek analysis with MVP defaults: 20 comments per batch, 60 second timeout, and 1 retry.
- [x] 5.4 Preserve raw comments when DeepSeek fails and clearly mark local-rule fallback results.
- [x] 5.5 Write `agent_runs` for analysis start, success, failure, retry exhaustion, and fallback usage.
- [x] 5.6 Ignore any LLM-provided numeric weights, event scores, or backtest signal levels in favor of deterministic calculations.
- [x] 5.7 Add tests for DeepSeek JSON parsing, Markdown-wrapped JSON parsing, timeout/retry behavior, fallback marking, pending comments after failure, and no-comment data behavior.

## 6. Weibo Event and Observation Lead Agent

- [x] 6.1 Implement rule recall for Weibo comments/targets by drama name, actor names, configured keywords, topics, risks, and stance.
- [x] 6.2 Implement event evidence thresholds that distinguish observation leads from formal events.
- [x] 6.3 Implement event score and status assignment using deterministic counts/weights before any LLM explanation.
- [ ] 6.4 Use DeepSeek to generate event title, trigger summary, main stances, impact assessment, and recommended actions only after evidence exists.
- [x] 6.5 Write or update Weibo events only in `artist_public_opinion_events`, plus evidence links and status history records.
- [x] 6.6 Add tests for evidence thresholds, event upsert within the 72-hour merge window, status transitions, and no-evidence behavior.

## 7. Weibo Source Accounts and Action Ledger

- [x] 7.1 Add CRUD or worker support for Weibo source accounts and user-confirmed source types.
- [x] 7.2 Assign source type to Weibo targets/posts from known account records using author external ID or profile URL before falling back to display-name-derived matching.
- [x] 7.3 Implement text content fingerprinting for Weibo targets/posts.
- [x] 7.4 Detect simple suspected matrix actions from similar content fingerprints in a short time window.
- [x] 7.5 Create `official_observed` actions when known official Weibo accounts post project-related content.
- [x] 7.6 Create `agent_recommended` action records from event suggestions without marking them executed.
- [x] 7.7 Add user confirmation, rejection, partial, and uncertain state transitions for Weibo actions.
- [x] 7.8 Preserve action timing fields: observed time, confirmed time, and effective time used for backtest windows.
- [x] 7.9 Add tests proving Agent recommendations are separate from user-confirmed real-world actions and stable account identifiers outrank display-name fallback matching.

## 8. Weibo Action Backtesting

- [x] 8.1 Implement backtest eligibility checks requiring confirmed/observed action, action timestamp, related event or target, and pre/post data windows.
- [x] 8.2 Aggregate baseline and post-action metrics for related Weibo events/comments across 6h, 24h, 48h, and 72h windows when available.
- [x] 8.3 Compute signal level, attribution confidence, metric changes, confounders, and next recommendation.
- [x] 8.4 Return `unknown` with missing-data explanation when backtest evidence is insufficient.
- [x] 8.5 Treat `unknown` with missing evidence as a valid first-action MVP output when not enough post-action data exists.
- [x] 8.6 Add tests for strong, medium, weak, no-signal, negative, and unknown backtest outputs.

## 9. Weibo Agent Workbench and APIs

- [x] 9.1 Add explicit `GET /api/weibo/workbench` returning `mode`, `setup`, `judgments`, `recommendedTargets`, `events`, `pendingActions`, `dataGaps`, and `citations`.
- [x] 9.2 Add explicit Weibo HTTP endpoints for discovery, targets list/select/ignore/collect-comments, events list/detail, pending actions, action confirmation, action backtest, and bot messages.
- [x] 9.3 Add matching internal worker subcommands for the explicit `/api/weibo/...` endpoints.
- [x] 9.4 Update the front-end to show a Weibo MVP Agent workbench as the primary screen.
- [x] 9.5 Show setup/data gaps when no real Weibo data exists, without mock charts or fabricated advice.
- [x] 9.6 Show partial states for search-only, detail-without-analysis, analysis-without-event, event-without-action, and action-without-backtest.
- [x] 9.7 Show Agent target recommendations with target ID, title/summary, author, URL when available, hot score/rank, recommendation reason, expected question answered, confidence, and select/ignore actions.
- [x] 9.8 Show Weibo event cards and event detail with timeline, evidence, impact assessment, recommended actions, and citations.
- [x] 9.9 Show pending action confirmations in the first-screen queue and allow confirm/reject/uncertain/partial updates.
- [x] 9.10 Clearly label the current MVP as Weibo-only and avoid presenting Xiaohongshu/Douyin as active MVP sources.

## 10. Weibo Memory, Reports, and Q&A

- [ ] 10.1 Write target selections, analysis summaries, events, action records, backtest results, reports, and user preferences into `bot_memory_items`.
- [x] 10.2 Implement retrieval-first Q&A over Weibo targets, comments, events, actions, backtests, reports, and memory.
- [x] 10.3 Ensure Q&A responses include source IDs or explicit insufficient-data messages.
- [x] 10.4 Generate a Weibo MVP daily Markdown report with data coverage, top Agent judgments, events, actions, evidence, and next monitoring steps.
- [x] 10.5 Ensure Q&A and report error states use standardized error payloads where applicable.
- [x] 10.6 Add tests for source-cited answers, no-data answers, insufficient trend evidence, and action-effect questions without backtests.

## 11. Integration and End-to-End Verification

- [x] 11.1 Add or update automated tests for migration, health, Weibo discovery fixtures, detail fixtures, analysis, event creation, action ledger, backtest, and workbench payloads.
- [x] 11.2 Run existing Node and Python test suites and fix regressions caused by the Weibo MVP scope.
- [x] 11.3 Add a fixture E2E command or test that proves the full loop without real Weibo auth or MediaCrawler availability.
- [x] 11.4 Run an end-to-end fixture flow: migrate, parse fixture search targets, recommend target, select target, parse fixture detail comments, analyze locally or with mocked DeepSeek, create event/lead, create action suggestion, confirm/log action, produce backtest or unknown result, ask a cited Q&A question, and render workbench payload.
- [ ] 11.5 If a real Weibo login/CDP/MediaCrawler environment is available, run one real Weibo search task and document the raw JSONL path and task ID.
- [x] 11.6 Update README or implementation notes with setup, environment variables, fixture E2E command, Weibo auth troubleshooting, real-data-only rules, error payload examples, and MVP limitations.
