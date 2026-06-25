## MODIFIED Requirements

### Requirement: Weibo long-memory answer constraints
The system SHALL answer Weibo MVP questions and generate daily reports by retrieving stored evidence and memory before generating the final response.

#### Scenario: Answer cites sources
- **WHEN** a user asks about a Weibo event, target, action, or trend
- **THEN** the answer MUST include cited IDs for the underlying event, target, comment, action, backtest, report, or memory records

#### Scenario: Trend question without enough time windows
- **WHEN** a user asks whether Weibo risk is rising or falling and fewer than two relevant collection windows exist
- **THEN** the Agent MUST state that trend evidence is insufficient

#### Scenario: Daily report cites sources
- **WHEN** Report Agent generates a daily report from stored Weibo evidence and memory
- **THEN** the report MUST include cited IDs for the underlying target, comment, event, action, backtest, report, memory, or knowledge-card records and MUST include data coverage counts

#### Scenario: Attribution question without enough backtest evidence
- **WHEN** a user asks whether a Weibo action caused an effect and the system lacks an accepted backtest or has confounders
- **THEN** the Agent MUST state that attribution is insufficient or confounded and MUST NOT claim the action alone caused the metric change

#### Scenario: Report with no current evidence
- **WHEN** Report Agent runs with no current stored evidence or memory
- **THEN** the Agent MUST return an insufficient-evidence result with citations empty and MUST NOT fabricate comments, events, actions, reports, or recommendations
