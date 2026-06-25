## 1. Contract and Red Tests

- [x] 1.1 Add FastAPI contract red tests for `POST /api/weibo/agent-runs/{run_id}/reports/daily`, covering success, MySQL unavailable, invalid run ID, and dangerous caller-controlled fields.
- [x] 1.2 Add FastAPI contract red tests for `POST /api/weibo/agent-runs/{run_id}/actions/{action_id}/backtests`, covering success, `unknown`, cross-project action rejection, MySQL unavailable, and dangerous caller-controlled fields.
- [x] 1.3 Add Judge/service red tests proving report/backtest outputs with missing evidence, model-owned metrics, or causal overclaims are rejected with required changes and redacted failed-output summaries.

## 2. Harness Service Implementation

- [x] 2.1 Implement a Harness-owned report/backtest service that validates project/run/action ownership before invoking any runtime or legacy adapter.
- [x] 2.2 Add narrow allowlisted adapter calls for daily report and action backtest that reuse existing deterministic worker helpers without accepting caller-controlled command names, fixture paths, artifact refs, database URLs, Cookie/token-like values, or arbitrary filesystem paths.
- [ ] 2.3 Record Report Agent and Backtest Agent `agent_step_runs` with stable `step_name`, status, output summary, error payloads, evidence IDs, coverage/backtest fields, and business persistence references.
- [ ] 2.4 Wire report/backtest step outputs through existing Judge review service so passed, failed, retry-exhausted, and needs-human states are persisted and visible in Agent Loop status.

## 3. FastAPI API Boundary

- [x] 3.1 Add `POST /api/weibo/agent-runs/{run_id}/reports/daily` with stable success and failure payloads, including `error_type`, cause, and fix on failures.
- [x] 3.2 Add `POST /api/weibo/agent-runs/{run_id}/actions/{action_id}/backtests` with stable success and failure payloads, including `unknown` as a valid partial result.
- [x] 3.3 Ensure public responses are sanitized and field-whitelisted so raw worker output, secret-like values, raw artifact paths, stdout/stderr, and internal trace payloads cannot leak.

## 4. Persistence and Evidence Verification

- [ ] 4.1 Add real MySQL tests proving daily report execution writes scoped `daily_reports` or report memory, `agent_step_runs`, and linked `judge_reviews`.
- [ ] 4.2 Add real MySQL tests proving action backtest execution writes scoped `action_backtests` or backtest memory, `agent_step_runs`, and linked `judge_reviews`.
- [ ] 4.3 Add real MySQL tests proving cross-project action, report, backtest, or evidence IDs are rejected before service/runtime execution and do not write audit rows.

## 5. No-Causal-Overclaim and Unknown Handling

- [ ] 5.1 Extend deterministic backtest fixtures/tests so overlapping actions, external events, or volume spikes produce `confounders` and never single-cause wording.
- [ ] 5.2 Ensure Q&A/report summaries cite accepted backtest records or explicitly state insufficient/confounded attribution when backtest evidence is missing, unknown, or low confidence.
- [ ] 5.3 Ensure `unknown` backtest results produce actionable missing-window guidance and are shown as partial/accepted-with-limits rather than silent failure.

## 6. Documentation, Queue, and Handoff

- [ ] 6.1 Update README or project docs with the new local FastAPI report/backtest Harness endpoints, safety boundaries, and example fixture/local-DB commands.
- [x] 6.2 Update `docs/agent-loop-change-queue.md` so completed predecessor changes are not stale `active/planned`, and mark this change active only while it is being implemented.
- [ ] 6.3 Maintain a serial subagent handoff record for this change, including worker scope, validation commands, review results, lifecycle state, and remaining risks.

## 7. Verification and Acceptance

- [ ] 7.1 Run targeted FastAPI/report/backtest/Judge tests with `PYTHON_BIN=.venv/bin/python`.
- [ ] 7.2 Run full no-DB test suite with `PYTHON_BIN=.venv/bin/python npm test`.
- [ ] 7.3 Run env-gated real MySQL persistence tests with a safe local/test database URL.
- [ ] 7.4 Run `openspec validate haidao-report-backtest-agent-loop --strict`, `git diff --check`, and `npm run agent:guard`.
- [ ] 7.5 Complete subagent adversarial review and QA/browser/log spot check for report/backtest API behavior before marking tasks complete.
