# Autoplan Follow-ups

These items should be folded into the OpenSpec artifacts before implementation or handled as the first implementation tasks.

## Must Tighten Before Apply

- [ ] R1 Define `target_locator` for Weibo detail collection.
  - Required fields: `target_id`, `platform`, `target_type`, `external_id`, `url`, `weibo_mid` or equivalent status ID when available, `author_external_id` or `author_url`, `raw_json`.
  - Failure behavior: if MediaCrawler cannot detail a selected target, fail with `target_detail_unsupported` and keep the target selected.

- [ ] R2 Replace "API endpoints or worker commands" ambiguity with explicit API and worker contracts.
  - Public API should be HTTP.
  - Worker subcommands should be internal implementation details.

- [ ] R3 Standardize event table name as `artist_public_opinion_events`.
  - Do not create both `public_opinion_events` and `artist_public_opinion_events`.

- [ ] R4 Split migration work into three commits/tasks.
  - Ingestion: target, task, post/comment/source columns.
  - Event/action/backtest: event tables, evidence, status history, action ledger, backtests.
  - Memory/report: bot memory, conversations, messages, daily reports.

- [ ] R5 Expand `platform_auth_states.status` safely.
  - Add `expired`, `verification_required`, `rate_limited`, `unknown`.
  - Preserve compatibility for existing `configured`.

- [ ] R6 Require source-account matching fields.
  - Prefer Weibo account external ID or profile URL.
  - Fall back to display-name hash only when no stable account identifier exists.

- [ ] R7 Add DeepSeek batch defaults.
  - Batch size: 20 comments.
  - Timeout: 60 seconds.
  - Retry: 1.
  - On failure: write `agent_runs`, preserve raw comments, mark fallback or leave pending.

- [ ] R8 Add fixture E2E as the first "hello world" path.
  - Required command or test should prove the whole loop without real Weibo auth.
  - Real Weibo search remains an environment-dependent verification step.

- [ ] R9 Define `GET /api/weibo/workbench` payload.
  - Include `mode`, `setup`, `judgments`, `recommendedTargets`, `events`, `pendingActions`, `dataGaps`, `citations`.
  - Include partial states: search-only, detail-without-analysis, analysis-without-event, event-without-action, action-without-backtest.

- [ ] R10 Standardize error payloads.
  - Required fields: `error_type`, `message`, `cause`, `fix`, optional `docs_anchor`.

## Suggested Endpoint Contract

- `GET /api/weibo/workbench`
- `POST /api/weibo/discovery`
- `GET /api/weibo/targets`
- `POST /api/weibo/targets/select`
- `POST /api/weibo/targets/ignore`
- `POST /api/weibo/targets/:id/collect-comments`
- `GET /api/weibo/events`
- `GET /api/weibo/events/:id`
- `GET /api/weibo/actions/pending`
- `PATCH /api/weibo/actions/:id/confirmation`
- `POST /api/weibo/actions/:id/backtest`
- `POST /api/weibo/bot/messages`

## First Implementation Slice

Recommended first vertical slice:

```text
migration subset
-> fixture Weibo search JSONL
-> discovered_targets
-> Agent recommendation
-> target select
-> fixture detail JSONL
-> comments
-> local fallback analysis
-> observation lead
-> workbench payload
```

This slice proves the Agent product loop without depending on real Weibo auth or MediaCrawler detail feasibility.

