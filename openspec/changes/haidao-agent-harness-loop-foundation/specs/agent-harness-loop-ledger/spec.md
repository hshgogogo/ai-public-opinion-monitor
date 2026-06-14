## ADDED Requirements

### Requirement: Agent Loop run ledger
The system SHALL record each Weibo Agent Loop run in an auditable ledger before larger CrewAI or FastAPI orchestration is introduced.

#### Scenario: Manual loop run created
- **WHEN** a user or worker requests a Weibo Agent Loop run for a project
- **THEN** the system MUST create an `agent_loop_runs` record with project ID, platform `weibo`, trigger mode, status, current step, input JSON, and timestamps

#### Scenario: Loop run fails
- **WHEN** a loop run cannot continue because a required step fails
- **THEN** the system MUST mark the run `failed` or `needs_human` with `error_type`, `error_message`, and the current step instead of reporting success

### Requirement: Agent step ledger
The system SHALL record individual Agent steps under a loop run.

#### Scenario: Ledger step succeeds with evidence
- **WHEN** a ledger step is recorded under a loop run
- **THEN** the system MUST create or update an `agent_step_runs` record with agent name, step name, status, output JSON, and cited evidence IDs

#### Scenario: Existing command remains compatible
- **WHEN** this foundation change is implemented
- **THEN** existing Weibo analysis, event, action, and Q&A commands MUST preserve their current standalone behavior and MUST NOT require an Agent Loop run

### Requirement: Judge review skeleton
The system SHALL persist Judge review records separately from Agent output.

#### Scenario: Judge review recorded
- **WHEN** a step output is reviewed by deterministic checks or a future Judge Agent
- **THEN** the system MUST record `judge_reviews` with status, pass/fail result, score when available, retry count, required changes, feedback JSON, and evidence errors

#### Scenario: Evidence error detected
- **WHEN** a review detects missing evidence, nonexistent IDs, overclaiming, or unsupported source types
- **THEN** the review MUST be recorded as failed or needs-human and MUST NOT silently mark the step successful

### Requirement: Manual feedback queue
The system SHALL record manual feedback and handoff items for Agent Loop failures or user corrections.

#### Scenario: Needs human handling
- **WHEN** a loop step cannot pass validation or needs user confirmation
- **THEN** the system MUST create a `feedback_items` record with source type, source ID when available, feedback type, note, status, creator, and creation time

#### Scenario: Full feedback semantics deferred
- **WHEN** a user confirmation, rejection, modification, or preference writeback is needed
- **THEN** this foundation MUST preserve the manual handoff record shape but defer full feedback semantics to the feedback-memory change
