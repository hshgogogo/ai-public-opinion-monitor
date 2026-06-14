## Context

The archived `haidao-weibo-agent-mvp` change proved the Weibo vertical path: discovery, target selection, detail comments, analysis, events, action recommendations, memory, reports, and Q&A. The new PRD asks for an Agent Harness that supervises this path with run state, Judge review, retries, feedback, and eventual CrewAI/FastAPI/React migration.

This change deliberately starts with a ledger and contract foundation. It should make the current system more auditable without replacing the existing Node/Python architecture.

## Design

### Data Model

Add an idempotent migration for four tables.

`agent_loop_runs` records one top-level Weibo loop:

- `id`
- `project_id`
- `platform`, initially `weibo`
- `trigger_mode`: `after_collection`, `scheduled`, `manual`, `fixture`
- `target_id`
- `status`: `pending`, `running`, `succeeded`, `partial`, `failed`, `needs_human`
- `current_step`
- `started_at`, `finished_at`
- `error_type`, `error_message`
- `input_json`, `summary_json`

`agent_step_runs` records each stage:

- `id`
- `loop_run_id`
- `project_id`
- `agent_name`
- `step_name`
- `status`
- `input_json`
- `output_json`
- `evidence_ids`
- `started_at`, `finished_at`
- `error_type`, `error_message`

`judge_reviews` records review results:

- `id`
- `loop_run_id`
- `step_run_id`
- `judge_agent_name`
- `status`: `pending`, `passed`, `failed`, `needs_human`
- `score`
- `passed`
- `feedback_json`
- `required_changes`
- `evidence_errors`
- `retry_count`
- `created_at`

`feedback_items` records manual handoff skeletons in this change. Full user feedback semantics are reserved for `haidao-feedback-memory-loop`:

- `id`
- `project_id`
- `source_type`
- `source_id`
- `feedback_type`
- `note`
- `status`
- `created_by`
- `created_at`
- `handled_at`

All tables are additive. No existing Weibo evidence tables are replaced.

### Worker Contract

Add small worker commands before orchestration grows:

- `weibo-agent-loop-run`: create a run without executing the downstream business loop.
- `weibo-agent-loop-status`: read one run with steps and Judge reviews.
- `weibo-agent-loop-step`: create or update a step record for tests and later integrations.
- `weibo-agent-loop-judge-review`: create a Judge review skeleton for tests and later integrations.
- `weibo-agent-loop-handoff`: create a manual handoff skeleton for tests and later integrations.
- Internal helpers:
  - create loop run
  - start/finish/fail step
  - create Judge review skeleton
  - create manual feedback item

Existing commands such as `weibo-comments-analyze`, `weibo-events-build`, `weibo-actions-build`, and `weibo-bot-message` remain unchanged in this foundation change. Optional `agentLoopRunId` attachment belongs to the later `haidao-agent-loop-step-attachment` change.

### API Contract

Do not expose new HTTP endpoints in this foundation change. The following endpoints belong to the later `haidao-agent-loop-trigger-api` change:

- `POST /api/weibo/agent-loop/run`
- `GET /api/weibo/agent-runs/:id`

The foundation only ensures the worker/status payload shape is ready for those endpoints.

### Judge Foundation

This change does not implement a full LLM Judge. It creates the persistence and deterministic guard shape:

- Judge reviews can be recorded as passed/failed/needs_human.
- Evidence errors include missing citation IDs, wrong source type, or insufficient evidence.
- Retry fields exist, but full retry orchestration is reserved for `haidao-judge-agent-retry-loop`.

### Failure Handling

- If MySQL is unavailable, worker commands return the existing `mysql_unavailable` payload style.
- If a step fails, the loop moves to `failed` or `needs_human` with `error_type`, `error_message`, and current step.
- Partial downstream completion must be visible as `partial`, not converted to success.

### Security

- No `.env`, Cookie, token, or browser state is read or printed by tests for this change.
- Real Weibo login and MediaCrawler remain outside this foundation.
- DeepSeek is user-authorized for later use, but live calls are not required for this ledger change.

## Validation Strategy

- Migration tests assert table and column declarations and no unsafe MySQL syntax.
- Real MySQL tests run migrations twice and verify loop/step/Judge/feedback records persist.
- Worker tests prove ledger commands write run, step, Judge review, and manual handoff records while existing Weibo commands remain compatible.
- OpenSpec validation runs for this change.
- `npm test`, real MySQL `npm test`, `git diff --check`, and `npm run agent:guard` run before commit.
