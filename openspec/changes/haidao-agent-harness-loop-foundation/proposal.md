## Why

The Weibo MVP can already collect, analyze, build events, recommend actions, and answer evidence-bound questions. However, these steps are still mostly exposed as independent worker/API commands. The PRD requires an Agent Harness: a safe runtime layer that records the loop, separates facts from proposals, stores Judge feedback, and makes failures visible.

This change adds the minimal ledger and review foundation before larger FastAPI, React, CrewAI, and knowledge-base migrations. It keeps the current Node service and Python worker running, so the next product step is auditable orchestration rather than a risky full rewrite.

## What Changes

- Add additive MySQL tables for:
  - `agent_loop_runs`
  - `agent_step_runs`
  - `judge_reviews`
  - `feedback_items`
- Add worker-only contracts for creating a Weibo Agent Loop run, recording step status, recording Judge review skeletons, recording manual handoff skeletons, and reading run status.
- Standardize failure and manual-handoff states for loop steps and Judge reviews.
- Keep Agent output evidence-bound: facts, inferences, suggestions, and citations remain separate.

## Non-Goals

- Do not introduce FastAPI in this change.
- Do not introduce CrewAI runtime in this change.
- Do not migrate the front-end to React/Vite in this change.
- Do not add public HTTP endpoints in this change.
- Do not attach existing analysis, event, action, or bot commands to loop runs in this change.
- Do not call real MediaCrawler or require real Weibo login for automated tests.
- Do not require live DeepSeek calls; DeepSeek may be used in later authorized analysis slices, but this foundation must be testable with fixtures/local DB.
- Do not implement full user confirmation/rejection/preference writeback semantics; this change only reserves the manual handoff skeleton.
- Do not allow any Agent or Judge to publish externally or mark real-world actions as executed without user confirmation.

## Capabilities

### New Capabilities

- `agent-harness-loop-ledger`: Agent Loop run ledger, step run ledger, Judge review records, and feedback/manual-handoff queue.

## Impact

- Affected persistence: new additive migration after current Weibo MVP migrations.
- Affected worker: `workers/enterprise_worker.py` loop ledger commands and internal ledger helpers.
- Affected API: none in this change; HTTP endpoint exposure is reserved for `haidao-agent-loop-trigger-api`.
- Affected tests: migration tests, real MySQL persistence tests, worker contract tests, guard tests.
- External dependencies: MySQL only for the real persistence path. No real Weibo login, Cookie, MediaCrawler, or live DeepSeek is required for this change.
