## ADDED Requirements

### Requirement: Controlled Agent-Reach adapter
系统 SHALL use Agent-Reach only through a FastAPI Harness-controlled adapter, not as a direct CrewAI tool.

#### Scenario: allowlisted platform command
- **WHEN** Harness triggers an Agent-Reach collection for an allowlisted platform and command
- **THEN** the adapter MUST execute only the allowlisted runner path
- **AND** response MUST include platform, status, artifact reference, and sanitized summary
- **AND** CrewAI MUST NOT receive direct command execution access

#### Scenario: non-allowlisted command rejected
- **WHEN** any caller requests a non-allowlisted platform or command
- **THEN** Harness MUST reject the request
- **AND** response MUST include a stable `error_type`
- **AND** no platform runner MUST be executed

#### Scenario: no credential leakage
- **WHEN** Agent-Reach, upstream runners, normalizers, or FastAPI adapter return output
- **THEN** public payloads and logs MUST NOT expose `.env`, Cookie, token, DB URL, browser state, QR login token, `config/cookies/*`, or raw stderr

### Requirement: Platform implementation order
系统 SHALL implement the multi-platform adapter in the order B站, 小红书, then 抖音.

#### Scenario: B站 is first
- **WHEN** this change begins implementation
- **THEN** the first collection slice MUST target B站 doctor/fixture/normalization before 小红书 or 抖音

#### Scenario: 抖音 is last
- **WHEN** B站 and 小红书 adapter contracts are not complete
- **THEN** 抖音 real collection MUST NOT be implemented
- **AND** 抖音 work MAY be limited to planning, doctor, or fixture contract tests

### Requirement: B站 evidence ingestion
系统 SHALL normalize B站 search/detail/comment/subtitle outputs into Harness evidence records.

#### Scenario: B站 fixture normalization
- **WHEN** a B站 fixture contains video title, author, URL, metrics, comments, or subtitle text
- **THEN** the normalizer MUST produce platform-scoped content and evidence objects
- **AND** each object MUST include `platform=bilibili`, project ownership, external ID, and raw artifact reference

#### Scenario: B站 idempotent persistence
- **WHEN** the same B站 external item is imported more than once for the same project
- **THEN** Harness MUST avoid duplicate source/content/evidence records
- **AND** it MAY update metrics and raw artifact references

### Requirement: 小红书 evidence ingestion
系统 SHALL normalize 小红书 note/search/detail/comment outputs into Harness evidence records while respecting login-state boundaries.

#### Scenario: 小红书 fixture normalization
- **WHEN** a 小红书 fixture contains note title/body, author, URL, metrics, or comments
- **THEN** the normalizer MUST produce platform-scoped content and evidence objects
- **AND** each object MUST include `platform=xiaohongshu`, project ownership, external ID, and raw artifact reference

#### Scenario: 小红书 auth required
- **WHEN** real 小红书 collection requires login state but no safe local login state is configured
- **THEN** Harness MUST return `error_type=platform_auth_required`
- **AND** MUST NOT fake success or fabricate data
- **AND** MUST NOT print or persist credential material

### Requirement: 抖音 evidence ingestion is deferred within this change
系统 SHALL treat 抖音 as the final platform slice in this change and MUST not block earlier B站/小红书 delivery on real 抖音 access.

#### Scenario: 抖音 fixture contract
- **WHEN** 抖音 upstream runner behavior is not yet stable
- **THEN** Harness MAY define doctor and fixture contract tests
- **AND** real 抖音 collection MUST remain unimplemented or blocked until the safe runner contract is clear

#### Scenario: 抖音 real access blocked
- **WHEN** real 抖音 collection requires high-risk login state, unstable tooling, or unsupported runner behavior
- **THEN** Harness MUST mark the real validation as blocked
- **AND** B站 and 小红书 validated paths MUST remain usable

### Requirement: Agent analysis consumes normalized evidence only
系统 SHALL allow CrewAI/Judge/Report to analyze B站、小红书 and 抖音 content only through normalized Harness evidence summaries.

#### Scenario: CrewAI reads cross-platform evidence
- **WHEN** CrewAI receives context for a multi-platform analysis
- **THEN** the context MUST contain evidence IDs, platform labels, summaries, and citations
- **AND** MUST NOT contain raw command output, login state, Cookie, token, or arbitrary platform runner access
