## 1. Schema

- [x] 1.1 Add an idempotent migration for `agent_loop_runs`.
- [x] 1.2 Add an idempotent migration for `agent_step_runs`.
- [x] 1.3 Add an idempotent migration for `judge_reviews`.
- [x] 1.4 Add an idempotent migration for `feedback_items`.
- [x] 1.5 Add tests proving the migration is MySQL 8.0/8.4 safe and idempotent.

## 2. Worker Ledger Contract

- [x] 2.1 Add a worker helper to create an Agent Loop run with project, platform, trigger mode, target, status, and input JSON.
- [x] 2.2 Add worker helpers to start, succeed, partially complete, fail, or mark a step as needing human handling.
- [x] 2.3 Add a worker helper to record Judge review skeletons with pass/fail/needs-human status and evidence errors.
- [x] 2.4 Add a worker helper to record feedback/manual-handoff items.
- [x] 2.5 Add tests for loop run, step run, Judge review, and feedback persistence.

## 3. Worker Commands

- [x] 3.1 Add `weibo-agent-loop-run` worker command for creating a loop run.
- [x] 3.2 Add `weibo-agent-loop-status` worker command for reading run, step, Judge, and feedback state.
- [x] 3.3 Add worker-only commands or payload paths for recording a step, Judge review, and manual handoff skeleton.
- [x] 3.4 Add tests for MySQL unavailable, invalid project IDs, and stable worker payload shapes.

## 4. Compatibility Boundaries

- [x] 4.1 Preserve standalone behavior of `weibo-comments-analyze`, `weibo-events-build`, `weibo-actions-build`, and `weibo-bot-message`.
- [x] 4.2 Document that optional step attachment belongs to `haidao-agent-loop-step-attachment`.
- [x] 4.3 Ensure this change does not add public HTTP endpoints.
- [x] 4.4 Ensure this change does not add front-end workbench behavior.

## 5. Manual Handoff Skeleton

- [ ] 5.1 Store manual handoff skeletons in `feedback_items` without implementing full user feedback semantics.
- [ ] 5.2 Add tests proving manual handoff records preserve source type, source ID, status, note, and creator.
- [ ] 5.3 Document that full user confirmation/rejection/preference writeback belongs to `haidao-feedback-memory-loop`.

## 6. Verification and Documentation

- [ ] 6.1 Update README or implementation notes with Agent Harness worker commands and limitations.
- [ ] 6.2 Run `npm test`.
- [ ] 6.3 Run real MySQL persistence tests when `WEIBO_DB_PERSISTENCE_TEST_URL` is available.
- [ ] 6.4 Run `openspec validate haidao-agent-harness-loop-foundation --strict`.
- [ ] 6.5 Run `git diff --check`.
- [ ] 6.6 Run `npm run agent:guard`.
