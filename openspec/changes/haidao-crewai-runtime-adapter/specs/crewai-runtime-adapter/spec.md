## ADDED Requirements

### Requirement: CrewAI proposal-only runtime
系统 SHALL run CrewAI through a FastAPI Harness adapter where Agent output is a structured proposal and not a direct database write.

#### Scenario: accepted proposal-only output
- **WHEN** CrewAI returns a valid proposal with `write_intent=proposal_only`
- **AND** all referenced evidence IDs exist within the same project
- **THEN** Harness MUST record an accepted proposal audit record
- **AND** response MUST include the accepted proposal audit ID
- **AND** Harness MUST NOT directly mutate event, action, memory, or fact tables as a side effect of the model output

#### Scenario: reject direct write intent
- **WHEN** CrewAI returns `write_intent` other than `proposal_only`
- **THEN** Harness MUST reject the proposal
- **AND** response MUST include `error_type=crewai_write_intent_not_allowed`
- **AND** Harness MUST record a rejected proposal audit record
- **AND** Harness MUST NOT create an accepted proposal record

### Requirement: Evidence-bound proposals
系统 SHALL require real evidence IDs for any CrewAI proposal that asserts facts, inferences, or recommendations.

#### Scenario: proposal without evidence
- **WHEN** CrewAI returns facts, inferences, or recommendations without evidence IDs
- **THEN** Harness MUST reject the proposal
- **AND** response MUST include `error_type=crewai_evidence_required`
- **AND** Harness MUST record a rejected proposal audit record
- **AND** Harness MUST NOT create an accepted proposal record

#### Scenario: proposal with cross-project evidence
- **WHEN** CrewAI references evidence outside the requested project
- **THEN** Harness MUST reject the proposal
- **AND** response MUST include `error_type=crewai_evidence_rejected`
- **AND** Harness MUST record a rejected proposal audit record
- **AND** Harness MUST NOT create an accepted proposal record

#### Scenario: knowledge-only support
- **WHEN** CrewAI references only knowledge cards without current Weibo evidence
- **THEN** Harness MUST treat the output as insufficient for factual claims
- **AND** response MUST NOT present the knowledge card as a substitute for real evidence

### Requirement: Proposal schema validation
系统 SHALL reject malformed CrewAI proposals with stable public errors before any accepted proposal is recorded.

#### Scenario: malformed proposal payload
- **WHEN** CrewAI returns malformed JSON, missing required fields, invalid enum values, invalid confidence values, or raw model output in public fields
- **THEN** Harness MUST reject the proposal
- **AND** response MUST include `error_type=crewai_invalid_proposal`
- **AND** Harness MUST record a rejected proposal audit record
- **AND** Harness MUST NOT create an accepted proposal record
- **AND** response MUST NOT expose raw model output, prompt text, traceback, API key, DB URL, Cookie path, or worker stderr

### Requirement: Harness tool boundary
系统 SHALL expose only allowlisted Harness tools to CrewAI and SHALL block arbitrary file, environment, database, Cookie, browser state, and worker access.

#### Scenario: allowlisted tool call
- **WHEN** CrewAI calls an allowlisted tool such as `get_loop_context`, `get_evidence_summary`, or `search_knowledge_cards`
- **THEN** Harness MUST validate the payload
- **AND** return a sanitized result scoped to the requested project

#### Scenario: proposal submission is Harness-owned
- **WHEN** CrewAI attempts to call `submit_proposal` or any proposal recorder as a tool
- **THEN** Harness MUST reject the call
- **AND** response MUST include `error_type=crewai_tool_not_allowed`
- **AND** Harness MUST NOT create an accepted proposal record

#### Scenario: non-allowlisted tool call
- **WHEN** CrewAI attempts to call a tool outside the allowlist
- **THEN** Harness MUST reject the call
- **AND** response MUST include `error_type=crewai_tool_not_allowed`

#### Scenario: no credential or secret access
- **WHEN** CrewAI runtime, tool gateway, or FastAPI endpoint handles a request
- **THEN** it MUST NOT read or print `.env`, Cookie, token, browser login state, DB URL, worker stderr, or `config/cookies/weibo.json`
- **AND** public payloads MUST be sanitized before returning

### Requirement: Runtime failure visibility
系统 SHALL turn CrewAI runtime failures into stable, auditable errors instead of silent success.

#### Scenario: CrewAI runtime raises
- **WHEN** CrewAI runtime raises, times out, or returns malformed output
- **THEN** Harness MUST return `ok=false`
- **AND** response MUST include stable `error_type` and actionable `fix`
- **AND** Harness MUST record an error proposal audit record
- **AND** response MUST NOT expose traceback, prompt, raw model output, API key, DB URL, Cookie path, or worker stderr

### Requirement: FastAPI sidecar compatibility
系统 SHALL keep existing FastAPI sidecar and old Node/worker compatibility while adding CrewAI runtime adapter.

#### Scenario: existing sidecar contracts still pass
- **WHEN** CrewAI adapter code is added
- **THEN** existing FastAPI sidecar health, Agent Loop run/status, and legacy worker adapter tests MUST continue to pass
- **AND** old Node tests MUST continue to pass
