## ADDED Requirements

### Requirement: Agent recommends Weibo targets with evidence
The system SHALL generate Agent recommendations for Weibo discovery targets using only target metadata and known project scope.

#### Scenario: Recommended Weibo target
- **WHEN** a Weibo target mentions 《海岛舒服日志》, 刘昊然, 李兰迪, or configured risk keywords and has meaningful engagement
- **THEN** the Agent MUST mark whether it recommends comment collection and MUST provide a reason, expected question answered, confidence, and target ID

#### Scenario: No evidence for recommendation
- **WHEN** a Weibo target has insufficient metadata or no relation to the fixed project scope
- **THEN** the Agent MUST mark it as not recommended or needs review and MUST NOT invent project relevance

### Requirement: Weibo comment topic analysis
The system SHALL analyze collected Weibo comments into sentiment, score, confidence, topics, risks, stance, issue summary, intensity, weight, evidence, and model.

#### Scenario: DeepSeek analysis succeeds
- **WHEN** collected Weibo comments are pending analysis and DeepSeek is available
- **THEN** the system MUST write one analysis result per comment with structured fields and evidence text

#### Scenario: DeepSeek batch defaults applied
- **WHEN** the system analyzes pending Weibo comments with DeepSeek
- **THEN** it MUST use MVP defaults of 20 comments per batch, 60 second timeout, and 1 retry unless explicitly configured otherwise

#### Scenario: DeepSeek analysis fails
- **WHEN** DeepSeek analysis fails for a Weibo comment batch
- **THEN** the system MUST keep raw comments, write an agent failure log, and mark any local fallback result as fallback instead of presenting it as model output

#### Scenario: DeepSeek failure leaves comments traceable
- **WHEN** DeepSeek analysis fails and no local fallback is written
- **THEN** the system MUST leave comments pending or failed with an `agent_runs` record and MUST NOT delete or hide the raw comments

### Requirement: Weibo event and observation lead creation
The system SHALL merge Weibo targets, comments, and analysis results into observation leads or formal public-opinion events.

#### Scenario: Evidence is enough for formal event
- **WHEN** related Weibo evidence meets the formal event threshold
- **THEN** the system MUST create or update an `artist_public_opinion_events` record with title, type, related artists, status, risk level, timeline, evidence IDs, impact assessment, and recommended actions

#### Scenario: Evidence is not enough for formal event
- **WHEN** related Weibo evidence is below the formal event threshold
- **THEN** the system MUST create or show an observation lead and MUST NOT label it as a formal high-risk event

### Requirement: Agent suggestions are evidence-bound
The system SHALL generate Weibo publicity suggestions only from stored targets, comments, analyses, events, and account/action records.

#### Scenario: Suggest action for escalating Weibo event
- **WHEN** a Weibo event is escalating and has negative/risk evidence
- **THEN** the Agent MUST produce action suggestions with action type, platform `weibo`, reason, evidence IDs, priority, owner suggestion, check-after time, and confidence

#### Scenario: Insufficient evidence for suggestion
- **WHEN** a user asks for advice and there is no relevant stored Weibo evidence
- **THEN** the Agent MUST answer that current real data is insufficient and MUST NOT fabricate comments, numbers, events, or strategy effects

### Requirement: Deterministic metrics remain outside LLM control
The system SHALL calculate numeric comment weights, event scores, trend windows, and backtest signals deterministically rather than asking the LLM to decide them.

#### Scenario: LLM returns numeric weights
- **WHEN** a DeepSeek response includes numeric weights, event scores, or backtest signal levels
- **THEN** the system MUST ignore those model-provided numbers for authoritative metrics and use deterministic calculations

### Requirement: Weibo long-memory answer constraints
The system SHALL answer Weibo MVP questions by retrieving stored evidence and memory before generating the final response.

#### Scenario: Answer cites sources
- **WHEN** a user asks about a Weibo event, target, action, or trend
- **THEN** the answer MUST include cited IDs for the underlying event, target, comment, action, backtest, report, or memory records

#### Scenario: Trend question without enough time windows
- **WHEN** a user asks whether Weibo risk is rising or falling and fewer than two relevant collection windows exist
- **THEN** the Agent MUST state that trend evidence is insufficient
