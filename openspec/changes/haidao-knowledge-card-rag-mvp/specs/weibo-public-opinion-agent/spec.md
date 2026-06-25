## ADDED Requirements

### Requirement: Weibo Agent uses knowledge cards as references
The system SHALL allow Weibo Agent suggestions and answers to cite knowledge cards while keeping knowledge references separate from observed Weibo facts.

#### Scenario: Q&A cites knowledge card
- **WHEN** a user asks for strategy reasoning and matching active knowledge cards exist
- **THEN** the Agent answer MUST include cited knowledge card IDs
- **AND** the answer MUST label those citations as knowledge references rather than observed Weibo facts

#### Scenario: Knowledge card cannot replace evidence
- **WHEN** stored Weibo comments, events, actions, or memory do not provide enough evidence
- **THEN** the Agent MUST state that real Weibo evidence is insufficient
- **AND** the Agent MUST NOT use a knowledge card alone to fabricate current public-opinion facts

#### Scenario: C-level source in Q&A
- **WHEN** a matching knowledge card comes only from a C-level source
- **THEN** the Agent MAY mention it as weak inspiration
- **AND** the Agent MUST NOT present it as an authoritative rule or primary basis for action
