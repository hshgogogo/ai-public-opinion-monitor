## ADDED Requirements

### Requirement: Weibo action suggestions preserve knowledge card references
The system SHALL preserve knowledge card references and applicability checks when Agent-recommended Weibo publicity actions use marketing knowledge.

#### Scenario: Agent suggestion cites knowledge card
- **WHEN** Strategy Agent creates a Weibo `agent_recommended` action using a knowledge card
- **THEN** the publicity action MUST preserve knowledge card IDs in structured data
- **AND** the action reason or raw JSON MUST include a short applicability summary

#### Scenario: Disabled card is not used
- **WHEN** a knowledge card's `do_not_apply_when` condition matches the current event or action context
- **THEN** the Agent MUST NOT create an action that relies on that knowledge card
- **AND** the blocked card MUST NOT appear as a supporting citation

#### Scenario: C-level source not used as hard rule
- **WHEN** a suggested action only matches C-level knowledge cards
- **THEN** the action MUST either avoid knowledge-card-driven justification or explicitly mark the source as weak inspiration
- **AND** the action MUST still rely on real Weibo evidence IDs for its recommendation
