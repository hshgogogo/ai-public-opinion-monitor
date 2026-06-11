## Context

The product PRD in `ai-public-opinion-monitor/docs/PRD-Haidao-Public-Opinion-Agent.md` defines a full three-platform publicity public-opinion Agent for 《海岛舒服日志》. This change intentionally narrows the first implementation to Weibo so the team can validate the core Agent loop before expanding to Xiaohongshu and Douyin.

Current system shape:

- `src/server.js` runs the web/API service on `0.0.0.0:8787` and delegates work to `workers/enterprise_worker.py`.
- `migrations/001_enterprise_mysql.sql` already creates `monitor_projects`, `platform_auth_states`, `collection_tasks`, `social_posts`, `social_comments`, `sentiment_results`, `agent_runs`, and `strategy_reports`.
- `workers/enterprise_worker.py` already has a platform loop, auth checks, post/comment upsert, local/DeepSeek sentiment flow, snapshot aggregation, and strategy output.
- `workers/collectors/weibo.py` exists as a Weibo collector placeholder, but the PRD calls for MediaCrawler JSONL as the real collection path.
- The current UI still reads a broad enterprise snapshot; the MVP must present Weibo-only Agent status and avoid implying Xiaohongshu/Douyin are ready.

The MVP must preserve real-data-only behavior: no mock comments, no fabricated sentiment, no fabricated events, and no fake action backtests.

## Goals / Non-Goals

**Goals:**

- Run the full Agent proof path on Weibo only:
  - MediaCrawler environment/auth check;
  - Weibo search discovery;
  - Agent target recommendation;
  - user target selection;
  - Weibo detail comment collection;
  - JSONL archival and adapter persistence;
  - topic/stance/sentiment/risk analysis;
  - event or observation lead generation;
  - action suggestion and action ledger recording;
  - simple action backtest when a real action is confirmed;
  - Weibo Agent workbench and traceable Q&A.
- Keep the fixed project scope: 《海岛舒服日志》, 刘昊然, 李兰迪.
- Keep the main service on `0.0.0.0:8787`.
- Reuse existing MySQL enterprise tables where possible and add new tables only for missing Agent concepts.
- Make every Agent conclusion traceable to IDs: target, post, comment, event, action, backtest, report, or memory.

**Non-Goals:**

- No Xiaohongshu or Douyin collection in this MVP.
- No automatic posting or external campaign execution.
- No account-password custody.
- No CAPTCHA bypass, anti-bot circumvention, signature cracking, or unauthorized high-volume scraping.
- No vector database in the first MVP; MySQL structured/text retrieval is enough.
- No half-year full analytics dashboard yet; this MVP proves the loop on Weibo.
- No claim that a publicity action caused an outcome unless the system has enough evidence; first MVP reports effect signals and attribution limits.

## Decisions

### Decision 1: Use Weibo-only MVP mode, not hidden three-platform mode

The server and UI will expose a Weibo MVP path whose active platform set is `["weibo"]` for Agent workbench flows. Existing platform whitelist behavior can remain for compatibility, but the MVP workbench and new endpoints MUST NOT show Xiaohongshu/Douyin collection status as if they are part of this delivery.

Alternatives considered:

- Implement all three platforms together. Rejected because it delays proof of the Agent product shape and increases auth/collector instability.
- Keep existing three-platform dashboard while only Weibo works. Rejected because it creates false product signals and weakens the real-data-only promise.

### Decision 2: Treat MediaCrawler as an external CLI worker with JSONL archival

MediaCrawler will be invoked as an external worker for `wb` search/detail tasks. The system will check `MEDIACRAWLER_HOME`, `MEDIACRAWLER_COMMIT`, `MEDIACRAWLER_PYTHON`, and Chrome CDP availability before starting real tasks. Raw JSONL output is archived under a task-specific storage path before adapter parsing.

Selected Weibo targets MUST be translated into a stable `target_locator` before detail collection starts. The locator is the contract between `discovered_targets`, the MediaCrawler wrapper, adapter parsing, and user-visible failure handling.

MVP `target_locator` fields:

- `target_id`
- `platform`, fixed to `weibo`
- `target_type`, such as `weibo_topic` or `weibo_post`
- `external_id`
- `url`
- `weibo_mid` or equivalent Weibo status ID when available
- `author_external_id` or `author_url` when available
- `raw_json`

If a selected target cannot be resolved into a MediaCrawler-detail-compatible locator, the detail task fails with `target_detail_unsupported`, keeps the target selected, preserves the raw search evidence, and gives the user a remediation message instead of pretending comments were collected.

Alternatives considered:

- Directly fork or modify MediaCrawler as the app base. Rejected because the main product owns project state, Agent logic, MySQL schema, workbench, and reports.
- Parse MediaCrawler output directly from stdout without archival. Rejected because troubleshooting and evidence traceability require raw files.
- Treat selected targets as keyword-only detail tasks. Rejected because it can collect the wrong comments and breaks the user's selection contract.

### Decision 3: Use additive schema migration for Agent concepts

Existing tables remain the business backbone. A new migration adds and/or expands:

- `discovered_targets` for Weibo search candidates.
- `target_collection_links` for selected candidate to detail task links.
- `source_accounts` for Weibo official/artist/marketing/fan/unknown accounts.
- `artist_public_opinion_events` for Weibo events and observation leads.
- `event_evidence_links` and `event_status_history`.
- `publicity_actions` for Agent recommendations, user-confirmed actions, official-observed actions, and matrix-inferred actions.
- `action_backtests` for simple before/after effect signals.
- `bot_memory_items`, `bot_conversations`, `bot_messages`.
- `daily_reports`.

Migration work is split into three additive chunks:

1. Ingestion: `discovered_targets`, `target_collection_links`, source columns, crawler/task columns, `platform_auth_states.status` enum expansion.
2. Event/action/backtest: `artist_public_opinion_events`, evidence links, status history, `source_accounts`, `publicity_actions`, `action_backtests`.
3. Memory/report: bot memory, conversations, messages, daily reports.

The existing `platform_auth_states.status='configured'` remains compatible. New MVP states include `expired`, `verification_required`, `rate_limited`, and `unknown`.

Alternatives considered:

- Store all Agent state in `agent_runs.output_json`. Rejected because Q&A, workbench filtering, and backtesting need stable relational records.
- Replace existing schema. Rejected because existing project tables and snapshot paths are useful and should not lose real data.

### Decision 4: Separate Agent recommendation from real-world execution

Agent suggestions are never automatically treated as executed. The action ledger stores source and confirmation state:

- `agent_recommended`
- `user_confirmed`
- `official_observed`
- `matrix_inferred`
- `manual_log`

Only user-confirmed or clearly observed actions can be used for backtesting, and all backtests include attribution confidence and confounders.

Alternatives considered:

- Infer execution from Agent suggestions. Rejected because real publicity teams often take different actions outside the system.
- Require manual entry for every action. Rejected because official-account monitoring can reduce user burden, while still requiring confirmation for strong claims.

### Decision 5: Start with deterministic scoring plus LLM interpretation

Deterministic code computes hot score, comment weight, event score, time windows, and signal level. DeepSeek interprets text into topics, stance, issue summary, risk labels, evidence, and suggested actions. The LLM does not decide numeric weights or invent missing evidence.

Alternatives considered:

- Let the LLM generate all scores. Rejected because repeated runs could produce inconsistent metrics.
- Use local rules only. Rejected because comments require nuanced interpretation of stance, joking, fan conflict, and uncertainty.

### Decision 6: Q&A must be retrieval-first and evidence-bound

The bot answers Weibo MVP questions by retrieving MySQL records first. It must quote or reference source IDs and must return no-data / insufficient-evidence messages instead of inventing facts.

Alternatives considered:

- Feed summarized reports only. Rejected because summaries are indexes, not primary evidence.
- Use vector search immediately. Deferred until structured MySQL retrieval is proven.

### Decision 7: Public contract is HTTP; worker commands are internal

The MVP exposes explicit HTTP endpoints from `src/server.js`. Each endpoint delegates to one explicit `workers/enterprise_worker.py` subcommand, but front-end and tests treat HTTP as the public contract.

Required HTTP endpoints:

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

Worker subcommands SHOULD mirror these endpoints with names such as `weibo-workbench`, `weibo-discovery`, `weibo-target-select`, `weibo-collect-target`, `weibo-events`, `weibo-action-confirm`, `weibo-backtest`, and `weibo-bot-message`.

The old `/api/collect` path MUST NOT silently run Xiaohongshu/Douyin during this MVP. It should either reject in Weibo MVP mode or route users toward `/api/weibo/discovery`.

### Decision 8: Workbench payload is a stable API object

`GET /api/weibo/workbench` returns the first-screen Agent object. The front-end must not assemble the primary workbench from arbitrary `/api/snapshot` fragments.

MVP payload shape:

```json
{
  "mode": "weibo-agent-mvp",
  "setup": {},
  "judgments": [],
  "recommendedTargets": [],
  "events": [],
  "pendingActions": [],
  "dataGaps": [],
  "citations": []
}
```

The workbench payload MUST represent partial states explicitly: search-only, detail-without-analysis, analysis-without-event, event-without-action, and action-without-backtest.

### Decision 9: Fixture E2E is the first verification path

The first vertical slice uses fixture Weibo search/detail JSONL before real Weibo auth/CDP is required. Real Weibo search remains an environment-dependent verification step.

The required fixture path:

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

This proves the Agent contract even when Weibo login state, CDP, or MediaCrawler detail targeting is unavailable.

### Decision 10: Errors are machine-readable and human-actionable

Every Weibo MVP health/task/API error returns:

- `error_type`
- `message`
- `cause`
- `fix`
- optional `docs_anchor`

Examples include `mediacrawler_missing`, `chrome_cdp_unavailable`, `auth_required`, `platform_verification_required`, `target_detail_unsupported`, `adapter_parse_failed`, `deepseek_failed`, and `insufficient_backtest_data`.

### Decision 11: DeepSeek batches are bounded

MVP comment analysis defaults:

- batch size: 20 comments
- timeout: 60 seconds
- retry count: 1
- failure behavior: write `agent_runs`, preserve raw comments, mark local fallback when used or leave comments pending

The LLM never decides numeric comment weights, event scores, or backtest signal levels.

## Risks / Trade-offs

- [Risk] Weibo login state expires or requires verification during collection. -> Mitigation: health check reports `auth_required` / `platform_verification_required`; collection tasks fail with machine-readable errors and do not block the web service.
- [Risk] MediaCrawler output fields change or differ across search/detail modes. -> Mitigation: archive raw JSONL, write adapter fixtures, tolerate missing fields, record adapter errors, and mark partial tasks.
- [Risk] Agent overstates evidence from small Weibo samples. -> Mitigation: evidence gates; observation leads are distinct from formal events; answers must include data coverage and confidence.
- [Risk] Matrix/official-account detection is weak in first MVP. -> Mitigation: start with user-managed seed accounts and text fingerprint heuristics; require user confirmation before strong claims.
- [Risk] Backtest attribution is misleading when multiple publicity actions happen together. -> Mitigation: output signal level and confounders, not causal certainty.
- [Risk] Adding too many tables slows MVP delivery. -> Mitigation: implement the minimal fields required by specs first; keep later embedding, image hash, and multi-platform fields nullable or deferred.
- [Risk] Existing snapshot/UI assumes three platforms. -> Mitigation: create Weibo MVP workbench sections and API payloads that explicitly declare active platform `weibo`.
- [Risk] MediaCrawler detail cannot collect comments for a selected target. -> Mitigation: require `target_locator`, fail with `target_detail_unsupported`, and use fixture E2E as the first proof path.
- [Risk] API and worker contracts drift. -> Mitigation: HTTP endpoints are canonical; worker subcommands mirror them internally.
- [Risk] Developers cannot run the MVP without real Weibo auth. -> Mitigation: fixture E2E is a required acceptance path.

## Migration Plan

1. Add a new idempotent migration after `001_enterprise_mysql.sql` for Weibo MVP Agent tables and safe column additions.
2. Initialize or update the default 《海岛舒服日志》 project with Weibo as the MVP active platform while preserving existing data.
3. Add MediaCrawler-related `.env.example` entries.
4. Implement health checks for MediaCrawler, Chrome CDP, and Weibo auth before enabling collection endpoints.
5. Add explicit `/api/weibo/...` endpoints and matching worker subcommands.
6. Add fixture E2E for search/detail JSONL, target recommendation, comments, local analysis, observation lead, and workbench payload.
7. Add real Weibo search/detail task flow using MediaCrawler and `target_locator`.
8. Backfill no data automatically. Existing old sample/PPT data must not be represented as real Weibo comments.
9. Rollback strategy: keep migration additive; disable Weibo MVP endpoints/workbench while preserving stored raw JSONL and MySQL records.

## Open Questions

- What are the initial Weibo seed accounts for official/artist/producer/known marketing sources?
- Which MediaCrawler Weibo fields are reliable enough to fill `weibo_mid` or the equivalent status ID in `target_locator`?
- Should weekly reports be part of the Weibo MVP or deferred until after one full daily report cycle is proven?
