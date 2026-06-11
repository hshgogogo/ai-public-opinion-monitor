## ADDED Requirements

### Requirement: Weibo MVP environment health
The system SHALL expose Weibo MVP health status for MySQL, MediaCrawler, Chrome CDP, and Weibo login state before any real collection task can run.

#### Scenario: Weibo collection blocked by missing MediaCrawler
- **WHEN** the Weibo MVP health check runs and `MEDIACRAWLER_HOME` is missing or invalid
- **THEN** the system MUST report `mediacrawler_missing` and MUST NOT start a Weibo collection task

#### Scenario: Weibo collection blocked by expired auth
- **WHEN** the Weibo login state is missing, expired, invalid, rate limited, or verification-required
- **THEN** the system MUST report a platform-level Weibo auth error and MUST keep the web service available

#### Scenario: Health error is actionable
- **WHEN** the Weibo MVP health check reports an error
- **THEN** the error payload MUST include `error_type`, `message`, `cause`, `fix`, and optional `docs_anchor`

### Requirement: Weibo auth state migration
The system SHALL safely support the Weibo MVP auth states while preserving compatibility with existing auth records.

#### Scenario: Existing configured auth state
- **WHEN** an existing Weibo auth row has status `configured`
- **THEN** the Weibo MVP health check MUST treat it as configured-but-not-yet-verified or compatible with valid startup checks

#### Scenario: Expanded auth state stored
- **WHEN** Weibo auth is expired, verification-required, rate-limited, or unknown
- **THEN** the system MUST be able to store the corresponding status without failing the migration or health check

### Requirement: Weibo search discovery tasks
The system SHALL create Weibo search discovery tasks for the fixed 《海岛舒服日志》 project and its MVP keyword set.

#### Scenario: Create Weibo search task
- **WHEN** a user or schedule requests Weibo discovery for a project keyword
- **THEN** the system MUST create a `collection_tasks` record with platform `weibo`, crawler type `search`, task status, requested limit, and traceable task ID

#### Scenario: Store Weibo discovery targets
- **WHEN** a Weibo search task succeeds
- **THEN** the system MUST archive raw JSONL and store at most the top 10 Weibo targets per keyword with platform rank, hot score, title/summary, author, URL, engagement fields, raw JSON, and selected status

#### Scenario: Store target locator fields
- **WHEN** a Weibo discovery target is stored
- **THEN** the system MUST preserve target locator fields including target ID, platform, target type, external ID, URL, Weibo mid or equivalent status ID when available, author external ID or author URL when available, and raw JSON

### Requirement: Weibo detail comment collection
The system SHALL collect comments only for Weibo targets that have been selected or explicitly approved for collection.

#### Scenario: Unselected target cannot collect comments
- **WHEN** a Weibo target is still pending or ignored
- **THEN** the system MUST reject detail comment collection for that target

#### Scenario: Selected target collects comments
- **WHEN** a selected Weibo target is submitted for detail collection
- **THEN** the system MUST run a Weibo detail task, archive raw JSONL, upsert the related post, upsert comments, and link the task back to the selected target

#### Scenario: Selected target lacks detail locator
- **WHEN** a selected Weibo target cannot be resolved into a MediaCrawler-detail-compatible target locator
- **THEN** the system MUST fail the detail task with `target_detail_unsupported`, keep the target selected, preserve the raw search evidence, and return a remediation message

### Requirement: Weibo adapter traceability and deduplication
The system SHALL preserve raw Weibo records and deduplicate normalized posts and comments.

#### Scenario: Duplicate Weibo post or comment
- **WHEN** the same Weibo post or comment appears in multiple task outputs
- **THEN** the system MUST update the existing record by platform and external ID instead of inserting a duplicate

#### Scenario: Adapter partial failure
- **WHEN** some Weibo JSONL records cannot be normalized
- **THEN** the system MUST keep parsing valid records, record failed record counts and errors, and mark the task partial or failed according to failure rate

### Requirement: Fixture-first Weibo ingestion proof
The system SHALL provide a fixture-based Weibo ingestion path that proves the MVP loop without real Weibo auth or MediaCrawler availability.

#### Scenario: Fixture search and detail flow
- **WHEN** the fixture E2E command or test runs with Weibo search and detail JSONL fixtures
- **THEN** the system MUST create discovery targets, recommend a target, select a target, parse detail comments, and produce records needed by the workbench without requiring real Weibo login state

### Requirement: Weibo-only MVP platform scope
The system SHALL treat Weibo as the only active collection platform for this MVP.

#### Scenario: Non-Weibo MVP collection request
- **WHEN** the MVP collection API receives a Xiaohongshu or Douyin collection request
- **THEN** the system MUST reject the request as out of MVP scope without creating a collection task

#### Scenario: Legacy collect path in Weibo MVP mode
- **WHEN** the legacy `/api/collect` path would collect non-Weibo platforms during Weibo MVP mode
- **THEN** the system MUST reject the request or route the user to `/api/weibo/discovery` without starting Xiaohongshu or Douyin tasks
