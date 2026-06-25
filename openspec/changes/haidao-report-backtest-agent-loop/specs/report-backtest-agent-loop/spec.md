## ADDED Requirements

### Requirement: Report Agent step audit
The system SHALL generate Weibo daily reports as Agent Loop steps with data coverage, cited evidence, insufficient-evidence notes, and Judge status.

#### Scenario: Daily report has evidence and coverage
- **WHEN** Report Agent generates a daily report for a project with stored Weibo comments, analyses, events, actions, backtests, or memory records
- **THEN** the system MUST record a `report` Agent step with report ID, data coverage counts, evidence IDs, citation details, generated report summary, and Judge review status

#### Scenario: Daily report lacks enough evidence
- **WHEN** Report Agent runs without enough stored evidence for a useful report
- **THEN** the system MUST record a partial or needs-human step with `error_type`, coverage gaps, next data collection recommendation, and MUST NOT fabricate comments, events, actions, or trends

#### Scenario: Report cites only scoped records
- **WHEN** Report Agent output includes comment, analysis, event, action, backtest, report, memory, or knowledge-card citations
- **THEN** the Harness MUST verify that citations exist and belong to the requested project before accepting the step

### Requirement: Backtest Agent step audit
The system SHALL run Weibo action backtests as Agent Loop steps with deterministic metric changes, evidence windows, confounders, and Judge status.

#### Scenario: Backtest has enough windows
- **WHEN** a confirmed or observed Weibo action has effective timing and related pre/post evidence windows
- **THEN** the system MUST record a `backtest` Agent step with action ID, baseline window, post window, deterministic metric changes, signal level, attribution confidence, confounders, next recommendation, evidence IDs, and Judge review status

#### Scenario: Backtest result is unknown
- **WHEN** an action lacks effective time, related event or target, baseline window, or post window
- **THEN** the system MUST record `result: "unknown"` as a valid partial backtest output with `missing_data_reason` and a next data collection recommendation

#### Scenario: Backtest does not run for unscoped action
- **WHEN** a requested action does not exist or belongs to another project
- **THEN** the system MUST reject the request before running the adapter and return a stable error payload with `error_type` and an actionable fix

### Requirement: Report and backtest Judge gate
The system SHALL run Judge review over report and backtest step outputs before treating them as accepted Agent Loop outputs.

#### Scenario: Judge passes bounded output
- **WHEN** a report or backtest output has scoped evidence IDs, separates facts from inference, preserves deterministic metrics, and avoids causal overclaiming
- **THEN** the system MUST record a passed Judge review linked to the same loop, project, and step

#### Scenario: Judge rejects unsafe output
- **WHEN** a report or backtest output has missing evidence, cross-project evidence, empty generic advice, model-provided metric authority, secret-like values, or causal overclaiming
- **THEN** the system MUST record a failed Judge review with required changes, evidence errors, retry count, and a redacted failed-output summary

#### Scenario: Repeated Judge failures need human
- **WHEN** report or backtest output fails after the configured maximum total attempts
- **THEN** the system MUST mark the step and loop as needing human handling and create a manual handoff feedback item

### Requirement: Report and backtest safety boundary
The system SHALL keep Report Agent and Backtest Agent execution inside local Harness-controlled adapters and MUST NOT use real account state or external platform calls automatically.

#### Scenario: Adapter input is caller controlled
- **WHEN** a public request includes command names, fixture paths, raw artifact refs, Cookie/token-like values, database URLs, or arbitrary file paths
- **THEN** the Harness MUST reject or ignore those fields before invoking any runtime or legacy worker adapter

#### Scenario: Local fixture validation
- **WHEN** automated tests exercise report or backtest execution
- **THEN** they MUST use fixture data, fake runtime services, or explicitly configured local test MySQL and MUST NOT require real Weibo Cookie, browser login state, MediaCrawler, real CrewAI model calls, or production data

### Requirement: Report and backtest Harness API contract
The system SHALL expose explicit FastAPI Harness boundaries for running daily report and action backtest steps inside an existing Agent Loop run.

#### Scenario: Trigger daily report step
- **WHEN** a client POSTs to `/api/weibo/agent-runs/{run_id}/reports/daily` with a valid same-project payload
- **THEN** the system MUST return a stable response containing `ok`, `agentLoopRunId`, `step`, `status`, report summary, coverage, evidence IDs, and Judge review status

#### Scenario: Trigger action backtest step
- **WHEN** a client POSTs to `/api/weibo/agent-runs/{run_id}/actions/{action_id}/backtests` with a valid same-project payload
- **THEN** the system MUST return a stable response containing `ok`, `agentLoopRunId`, `step`, `status`, backtest result, missing data reason when present, confounders, evidence IDs, and Judge review status

#### Scenario: MySQL unavailable
- **WHEN** the report or backtest Harness endpoint cannot access MySQL
- **THEN** the system MUST return a non-2xx response with `error_type: "mysql_unavailable"`, a cause, and an actionable fix instead of silently succeeding
