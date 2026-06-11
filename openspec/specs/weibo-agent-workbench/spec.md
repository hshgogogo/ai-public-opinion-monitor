# weibo-agent-workbench Specification

## Purpose
Define the Weibo MVP Agent workbench experience, API payloads, evidence surfaces, and human confirmation flow.
## Requirements
### Requirement: Weibo Agent workbench first screen
The system SHALL provide a Weibo MVP Agent workbench that makes Agent judgments, pending confirmations, and evidence entry points visible before generic charts.

#### Scenario: Workbench with no real data
- **WHEN** no real Weibo targets or comments have been collected
- **THEN** the workbench MUST show Weibo setup/data gaps and MUST NOT show mock charts, fabricated events, or fabricated advice

#### Scenario: Workbench with active evidence
- **WHEN** Weibo targets, comments, events, or actions exist
- **THEN** the workbench MUST show current Agent judgments, recommended collections, event cards, pending action confirmations, and source citations

#### Scenario: Workbench payload shape
- **WHEN** `GET /api/weibo/workbench` is requested
- **THEN** the response MUST include `mode`, `setup`, `judgments`, `recommendedTargets`, `events`, `pendingActions`, `dataGaps`, and `citations`

#### Scenario: Workbench partial states
- **WHEN** the Weibo MVP has partial progress such as search-only, detail-without-analysis, analysis-without-event, event-without-action, or action-without-backtest
- **THEN** the workbench MUST show the current partial state and next available action instead of fabricating downstream results

### Requirement: Weibo target review UI/API
The system SHALL let users review Agent-recommended Weibo targets and select or ignore them.

#### Scenario: Select recommended target
- **WHEN** a user selects a recommended Weibo target
- **THEN** the system MUST update target state and allow detail comment collection for that target

#### Scenario: Ignore target
- **WHEN** a user ignores a Weibo target
- **THEN** the system MUST keep the target record for audit and MUST NOT collect comments for it by default

#### Scenario: Recommended target card fields
- **WHEN** the workbench shows a Weibo recommended target
- **THEN** the target card MUST include target ID, title or summary, author, URL when available, hot score or rank, recommendation reason, expected question answered, confidence, and select/ignore actions

### Requirement: Weibo event detail view
The system SHALL provide event details with facts, interpretation, suggestions, and evidence links.

#### Scenario: Open Weibo event detail
- **WHEN** a user opens a Weibo event
- **THEN** the system MUST show timeline, related artists, status, risk level, platform/source distribution, representative targets/comments, impact assessment, recommended actions, and evidence IDs

### Requirement: Pending action confirmation UI/API
The system SHALL expose Weibo actions that need user confirmation.

#### Scenario: Confirm observed action
- **WHEN** a user confirms an observed Weibo action
- **THEN** the system MUST update confirmation status and make it eligible for backtesting when enough data exists

#### Scenario: Reject inferred action
- **WHEN** a user rejects a suspected matrix or observed action
- **THEN** the system MUST record the rejection and MUST NOT use that action as a confirmed campaign action

#### Scenario: Pending actions appear before event detail
- **WHEN** there are Weibo actions with pending confirmation
- **THEN** the workbench first screen MUST expose the pending action queue without requiring the user to open an event detail view

### Requirement: Weibo Q&A entry
The system SHALL let users ask Weibo MVP questions and receive evidence-bound answers.

#### Scenario: Ask about why negativity rose
- **WHEN** a user asks why Weibo negativity increased
- **THEN** the system MUST answer from stored Weibo targets, comments, events, and analysis records or state that trend evidence is insufficient

#### Scenario: Ask about action effect
- **WHEN** a user asks whether a Weibo action helped
- **THEN** the system MUST answer from action and backtest records or state that no confirmed action/backtest exists

### Requirement: Weibo-only MVP navigation
The workbench SHALL clearly indicate that the current MVP runs only Weibo.

#### Scenario: Non-Weibo platform displayed
- **WHEN** the Weibo MVP workbench is rendered
- **THEN** it MUST NOT present Xiaohongshu or Douyin as active MVP data sources

### Requirement: Weibo API contract
The system SHALL expose explicit HTTP endpoints for the Weibo MVP rather than relying on ambiguous worker-only commands.

#### Scenario: Weibo workbench endpoint
- **WHEN** the front-end needs the Weibo MVP first-screen state
- **THEN** it MUST call `GET /api/weibo/workbench`

#### Scenario: Weibo target endpoints
- **WHEN** the front-end reviews, selects, ignores, or collects comments for Weibo targets
- **THEN** it MUST use `/api/weibo/targets` endpoints and MUST NOT call an unspecified worker command directly

#### Scenario: Weibo action and bot endpoints
- **WHEN** the front-end confirms actions, requests backtests, or sends bot messages
- **THEN** it MUST use the explicit `/api/weibo/actions/...` or `/api/weibo/bot/messages` endpoints
