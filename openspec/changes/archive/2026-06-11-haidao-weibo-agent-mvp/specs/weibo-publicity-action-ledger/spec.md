## ADDED Requirements

### Requirement: Weibo publicity action records
The system SHALL record Weibo publicity actions separately from Agent suggestions and event records.

#### Scenario: Agent suggestion creates pending action
- **WHEN** the Agent suggests a Weibo publicity action
- **THEN** the system MUST create a publicity action record with source `agent_recommended`, confirmation status `pending`, related evidence IDs, and recommended check-after time

#### Scenario: User logs real-world action
- **WHEN** a user records a real Weibo publicity action that differs from the Agent suggestion
- **THEN** the system MUST store it as `user_confirmed` or `manual_log` and MUST NOT overwrite the original Agent recommendation

### Requirement: Weibo source account tracking
The system SHALL maintain Weibo source accounts for official, artist, producer, marketing, suspected matrix, media, fan, organic, and unknown sources.

#### Scenario: User confirms account type
- **WHEN** a user classifies a Weibo account as official, artist, marketing, fan, or another source type
- **THEN** future targets/posts from that account MUST carry the confirmed source type

#### Scenario: Unknown account discovered
- **WHEN** a Weibo target/post comes from an account not in the source account table
- **THEN** the system MUST store or expose it as `unknown` or a heuristic source type with confidence

#### Scenario: Stable account identifier available
- **WHEN** a Weibo target/post includes an author external ID or author URL
- **THEN** the system MUST use that stable identifier for source account matching instead of display name alone

#### Scenario: Stable account identifier missing
- **WHEN** a Weibo target/post lacks author external ID and author URL
- **THEN** the system MAY use a display-name-derived fallback identifier but MUST mark the source match confidence lower than a stable identifier match

### Requirement: Observed official or marketing actions
The system SHALL identify Weibo official or marketing-account posts as possible publicity actions when they match project keywords or content fingerprints.

#### Scenario: Official account action observed
- **WHEN** a known official Weibo account posts content related to 《海岛舒服日志》
- **THEN** the system MUST create an `official_observed` action with pending or confirmed state, source account, URL, content summary, and observed time

#### Scenario: Suspected matrix action inferred
- **WHEN** multiple Weibo accounts publish similar project-related content in a short time window
- **THEN** the system MUST create or expose a `matrix_inferred` action with confidence and MUST require user confirmation before treating it as a known campaign action

### Requirement: Simple Weibo action backtesting
The system SHALL produce simple before/after backtest summaries only for confirmed or observed Weibo actions with enough data.

#### Scenario: Confirmed action has enough data
- **WHEN** a confirmed Weibo action has a timestamp and related pre/post collection windows
- **THEN** the system MUST compute metric changes, signal level, attribution confidence, confounders, and next recommendation

#### Scenario: Action lacks enough data
- **WHEN** a Weibo action lacks timestamp, related event, or enough pre/post evidence
- **THEN** the system MUST return backtest result `unknown` and explain the missing data

#### Scenario: First confirmed action has no post window yet
- **WHEN** a user confirms a Weibo action but there is not enough post-action evidence to compare windows
- **THEN** the backtest result `unknown` MUST be treated as a valid MVP output and MUST explain what data window is still needed

### Requirement: Action timestamps
The system SHALL preserve action timing fields required for Weibo backtesting.

#### Scenario: Action timing stored
- **WHEN** a Weibo publicity action is created or confirmed
- **THEN** the system MUST preserve observed time when available, confirmed time when the user confirms it, and an effective time used for backtest window selection

### Requirement: No causal overclaiming
The system SHALL describe action effectiveness as evidence signals, not guaranteed causality.

#### Scenario: Multiple confounders exist
- **WHEN** multiple Weibo actions or external events overlap the backtest window
- **THEN** the backtest MUST include confounders and MUST NOT claim the action alone caused the metric change
