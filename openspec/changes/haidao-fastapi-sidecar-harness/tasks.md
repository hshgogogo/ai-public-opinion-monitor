## 1. Scope And Route Correction

- [x] 1.1 Remove or exclude unfinished old Judge helper 2.3/2.4 implementation diff from this change.
- [x] 1.2 Keep completed ledger, feedback, knowledge, and worker attachment specs as reusable Harness foundations.
- [x] 1.3 Document that old Node/Python worker is a legacy tool adapter, not the new Agent business host.
- [x] 1.4 Validate `haidao-fastapi-sidecar-harness` OpenSpec artifacts with `openspec validate --strict`.

## 2. FastAPI Sidecar Foundation

- [x] 2.1 Add project-local FastAPI/ASGI test dependencies without installing global packages.
- [x] 2.2 Write failing tests for `GET /health` with MySQL unavailable and sanitized payload.
- [x] 2.3 Implement minimal FastAPI app and health response.
- [x] 2.4 Add startup/import test proving sidecar does not load `.env`, Cookie, token, browser login state, or `config/cookies/weibo.json`.

## 3. Agent Loop Run And Status

- [x] 3.1 Write failing FastAPI tests for valid and invalid `/api/weibo/agent-loop/run` payloads.
- [x] 3.2 Implement FastAPI payload validation compatible with existing Node public contract.
- [x] 3.3 Write failing tests for `/api/weibo/agent-runs/{id}` invalid id and MySQL unavailable behavior.
- [x] 3.4 Implement status endpoint using existing Harness ledger adapter or legacy worker delegation.
- [x] 3.5 Run real MySQL integration test proving FastAPI can create and read an Agent Loop run.

## 4. Legacy Worker Adapter

- [x] 4.1 Write failing tests proving non-whitelisted legacy worker commands are rejected.
- [x] 4.2 Implement a strict legacy worker command whitelist.
- [x] 4.3 Write failing tests proving whitelisted adapter output omits stderr and secret-bearing fields.
- [x] 4.4 Implement sanitized worker subprocess adapter with JSON payload support.

## 5. Documentation And Verification

- [x] 5.1 Update README with FastAPI sidecar startup, legacy adapter role, and migration limits.
- [x] 5.2 Run targeted FastAPI tests.
- [x] 5.3 Run `npm test`.
- [x] 5.4 Run real MySQL tests when `WEIBO_DB_PERSISTENCE_TEST_URL` is available.
- [x] 5.5 Run `openspec validate haidao-fastapi-sidecar-harness --strict`.
- [x] 5.6 Run `git diff --check`.
- [x] 5.7 Run `npm run agent:guard`.
- [x] 5.8 Complete subagent review, evidence report, commit, push, and PR update.
