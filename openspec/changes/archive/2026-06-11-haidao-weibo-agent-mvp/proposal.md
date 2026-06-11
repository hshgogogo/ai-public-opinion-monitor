## Why

The full PRD defines a half-year public-opinion agent for 《海岛舒服日志》, but implementing all three platforms at once would blur the MVP and delay proof of value. We should first prove the agent loop on Weibo: real data in, evidence-backed interpretation out, human-confirmed publicity actions recorded, and follow-up questions answered without inventing facts.

This change turns the PRD into a narrow MVP that validates the product shape of a publicity public-opinion Agent rather than a traditional dashboard.

## What Changes

- Add a Weibo-only MVP mode for the fixed 《海岛舒服日志》 project with monitored entities 刘昊然 and 李兰迪.
- Connect MediaCrawler as the Weibo search/detail collection worker using real login state, JSONL output, and project-owned MySQL tables.
- Store Weibo discovery targets, selected targets, posts, comments, source accounts, agent runs, events, action records, and report/memory records with traceable IDs.
- Add an evidence-bound Weibo Agent loop:
  - discover high-heat Weibo topics/posts;
  - recommend which targets deserve comment collection;
  - analyze comments into topics, stances, sentiment, risks, and evidence;
  - merge evidence into Weibo public-opinion events or observation leads;
  - produce action suggestions with explicit evidence and confidence.
- Add a minimum publicity action ledger for Weibo:
  - distinguish agent recommendations from user-confirmed real-world actions;
  - record observed official/marketing-account actions when available;
  - support simple before/after backtest summaries when a confirmed action has enough data.
- Add a Weibo Agent workbench surface showing current status, recommended collections, evidence-backed events, pending action confirmations, and a natural-language question entry.
- Preserve `real-data-only`: no mock comments, no fabricated events, no non-Weibo platform display in the MVP.
- Keep Xiaohongshu and Douyin out of the MVP except as future scope.

## Capabilities

### New Capabilities

- `weibo-real-data-ingestion`: Weibo-only MediaCrawler environment checks, search/detail task creation, JSONL archival, adapter parsing, deduplication, and MySQL persistence.
- `weibo-public-opinion-agent`: Evidence-bound Weibo candidate recommendation, comment analysis, event/observation lead creation, strategy suggestion, and no-data/no-evidence behavior.
- `weibo-publicity-action-ledger`: Weibo publicity action records, user confirmation states, observed official/marketing-account actions, and simple action backtest summaries.
- `weibo-agent-workbench`: Weibo MVP front-end/API experience for health status, discovery targets, agent recommendations, event evidence, action confirmations, reports, and question answering.

### Modified Capabilities

- None.

## Impact

- Affected app area: `ai-public-opinion-monitor`.
- Affected docs: derived from `ai-public-opinion-monitor/docs/PRD-Haidao-Public-Opinion-Agent.md`.
- Affected persistence: existing enterprise MySQL schema plus new/expanded tables for Weibo discovery targets, source accounts, public-opinion events, action ledger, backtests, memory, reports, and agent logs.
- Affected workers: MediaCrawler adapter, Weibo search/detail task runner, JSONL adapter, DeepSeek topic analysis, event merge worker, action/backtest worker, report/memory writer.
- Affected APIs: health, tasks, discovery targets, target selection, comments, events, source accounts, actions, backtests, reports, bot conversations/messages.
- Affected UI: Weibo-only Agent workbench; no Xiaohongshu/Douyin MVP views.
- External dependencies: MediaCrawler, Chrome CDP login state, MySQL, DeepSeek API.
