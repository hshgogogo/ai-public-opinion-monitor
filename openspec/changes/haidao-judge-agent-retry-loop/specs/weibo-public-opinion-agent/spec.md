## MODIFIED Requirements

### Requirement: Weibo comment topic analysis
系统 SHALL analyze collected Weibo comments into sentiment, score, confidence, topics, risks, stance, issue summary, intensity, weight, evidence, and model.

#### Scenario: Judge rejects analysis without evidence
- **WHEN** a Weibo comment analysis proposal/step is attached to an Agent Loop run and its output lacks valid comment or analysis evidence IDs
- **THEN** the FastAPI Harness Judge retry loop MUST reject the proposal/step output
- **AND** the Agent Loop MUST NOT present the analysis proposal/step as fully accepted until a passed Judge review exists or the item enters manual handling

### Requirement: Weibo event and observation lead creation
系统 SHALL merge Weibo targets, comments, and analysis results into observation leads or formal public-opinion events.

#### Scenario: Judge rejects unsupported event
- **WHEN** an event-building proposal/step claims a formal event without valid comment, analysis, or event evidence IDs
- **THEN** the FastAPI Harness Judge retry loop MUST reject the output
- **AND** required changes MUST explain that the event needs real Weibo evidence before being treated as accepted
