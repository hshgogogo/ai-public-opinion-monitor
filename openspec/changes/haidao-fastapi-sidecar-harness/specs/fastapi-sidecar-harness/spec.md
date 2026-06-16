## ADDED Requirements

### Requirement: FastAPI sidecar health
系统 SHALL 提供 FastAPI sidecar health endpoint，用于确认新 Harness 后端、MySQL 配置状态和 legacy worker adapter 状态。

#### Scenario: sidecar health without MySQL
- **WHEN** FastAPI sidecar 没有可用 `MYSQL_URL`
- **THEN** `GET /health` MUST return `ok=false`
- **AND** response MUST include `error_type=mysql_unavailable`
- **AND** response MUST NOT include `.env`、Cookie、token、`config/cookies/weibo.json` 或 worker stderr

#### Scenario: sidecar health with dependencies configured
- **WHEN** MySQL is reachable and the legacy worker adapter is configured
- **THEN** `GET /health` MUST return `ok=true`
- **AND** response MUST identify the service as the FastAPI sidecar

### Requirement: FastAPI Agent Loop run and status
系统 SHALL expose FastAPI endpoints that create and read Agent Loop ledger records while preserving the existing MySQL-backed Harness ledger.

#### Scenario: create run through FastAPI
- **WHEN** a client posts a valid manual, scheduled, or after_collection payload to `/api/weibo/agent-loop/run`
- **THEN** FastAPI MUST create or delegate creation of an Agent Loop run
- **AND** response MUST include `ok=true`, `agentLoopRunId`, and `status`

#### Scenario: reject invalid run payload
- **WHEN** a client posts invalid `projectId`, `targetId`, `mode`, or non-object `input`
- **THEN** FastAPI MUST return `ok=false`
- **AND** response MUST include stable `error_type` and actionable `fix`

#### Scenario: read run status through FastAPI
- **WHEN** a client requests `/api/weibo/agent-runs/{id}` with a valid run id
- **THEN** FastAPI MUST return the run, steps, Judge reviews, and manual handoff records visible in the existing ledger

### Requirement: Legacy worker tool adapter
系统 SHALL expose an internal legacy worker adapter so the new Harness can reuse existing worker commands without continuing to add Agent orchestration into `enterprise_worker.py`.

#### Scenario: whitelisted legacy command
- **WHEN** FastAPI receives `POST /api/tools/legacy-worker/{command}` for a whitelisted command
- **THEN** it MUST execute only that worker command with JSON payload
- **AND** it MUST return sanitized JSON without worker stderr or secret-bearing environment values

#### Scenario: non-whitelisted legacy command
- **WHEN** FastAPI receives a legacy worker command that is not explicitly whitelisted
- **THEN** it MUST reject the request
- **AND** response MUST include `error_type=legacy_worker_command_not_allowed`

#### Scenario: no real credential access
- **WHEN** FastAPI handles health, run/status, or legacy adapter requests in this change
- **THEN** it MUST NOT read or print real Cookie, token, browser login state, or `config/cookies/weibo.json`
- **AND** tests MUST be able to prove this with sanitized fixtures or environment sentinels

### Requirement: Legacy Node compatibility
系统 SHALL keep the existing Node service and static workbench usable during the sidecar migration.

#### Scenario: existing Node tests still pass
- **WHEN** FastAPI sidecar code is added
- **THEN** existing Node API and frontend contract tests MUST continue to pass
- **AND** the old Node service MUST NOT be removed in this change
