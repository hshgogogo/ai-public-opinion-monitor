## MODIFIED Requirements

### Requirement: Weibo publicity action records
系统 SHALL record Weibo publicity actions separately from Agent suggestions and event records.

#### Scenario: Judge rejects action without evidence
- **WHEN** a Strategy Agent action proposal/suggestion lacks valid project evidence references such as target, post, comment, analysis, event, action, or memory IDs
- **THEN** the FastAPI Harness Judge retry loop MUST reject the suggestion
- **AND** the suggestion MUST NOT be treated as accepted loop output until the missing evidence is fixed or the item enters manual handling

#### Scenario: Judge rejects knowledge-only action
- **WHEN** a Strategy Agent action proposal/suggestion only cites `knowledge-card-*` references and has no real project evidence ID
- **THEN** the FastAPI Harness Judge retry loop MUST reject the suggestion as evidence insufficient
- **AND** required changes MUST ask for at least one real target, post, comment, analysis, event, action, or memory evidence ID
- **AND** knowledge cards MAY remain as `knowledge_references` for strategy rationale but MUST NOT be counted as current Weibo evidence

### Requirement: No causal overclaiming
系统 SHALL describe action effectiveness as evidence signals, not guaranteed causality.

#### Scenario: Judge rejects causal overclaim
- **WHEN** an action proposal/suggestion states that a publicity action alone caused public-opinion change without sufficient evidence and confounder handling
- **THEN** the FastAPI Harness Judge retry loop MUST reject the output
- **AND** required changes MUST ask the Strategy Agent to describe signals, uncertainty, and confounders instead of single-cause certainty
