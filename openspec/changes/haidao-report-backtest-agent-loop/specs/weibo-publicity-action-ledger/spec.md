## MODIFIED Requirements

### Requirement: Simple Weibo action backtesting
The system SHALL produce simple before/after backtest summaries only for confirmed or observed Weibo actions with enough data, and SHALL audit those backtests through the Agent Loop Harness when an agent loop run is provided.

#### Scenario: Confirmed action has enough data
- **WHEN** a confirmed Weibo action has a timestamp and related pre/post collection windows
- **THEN** the system MUST compute metric changes, signal level, attribution confidence, confounders, and next recommendation

#### Scenario: Action lacks enough data
- **WHEN** a Weibo action lacks timestamp, related event, or enough pre/post evidence
- **THEN** the system MUST return backtest result `unknown` and explain the missing data

#### Scenario: First confirmed action has no post window yet
- **WHEN** a user confirms a Weibo action but there is not enough post-action evidence to compare windows
- **THEN** the backtest result `unknown` MUST be treated as a valid MVP output and MUST explain what data window is still needed

#### Scenario: Backtest is attached to Agent Loop
- **WHEN** a Weibo action backtest runs with a valid same-project Agent Loop run
- **THEN** the system MUST record a Backtest Agent step with evidence IDs, deterministic result fields, business persistence references, and linked Judge review status

#### Scenario: Backtest action belongs to another project
- **WHEN** a Weibo action backtest request references an action that does not belong to the requested project or loop
- **THEN** the system MUST reject the request before writing `action_backtests`, `bot_memory_items`, `agent_step_runs`, or `judge_reviews`

### Requirement: No causal overclaiming
The system SHALL describe action effectiveness as evidence signals, not guaranteed causality.

#### Scenario: Multiple confounders exist
- **WHEN** multiple Weibo actions or external events overlap the backtest window
- **THEN** the backtest MUST include confounders and MUST NOT claim the action alone caused the metric change

#### Scenario: Report summarizes a confounded backtest
- **WHEN** a daily report or Q&A answer cites a backtest with confounders or low attribution confidence
- **THEN** the text MUST state that the action is only correlated with observed changes and MUST NOT present it as a single-cause conclusion

#### Scenario: Model proposes backtest signal
- **WHEN** a model, proposal, report, or Judge output includes its own authoritative backtest signal, trend window, event score, or sentiment weight
- **THEN** the system MUST ignore or reject the model-provided metric authority and use deterministic records or an insufficient-evidence explanation
