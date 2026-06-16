## 1. OpenSpec And Scope

- [x] 1.1 Create `haidao-crewai-runtime-adapter` proposal, design, tasks, and spec artifacts.
- [x] 1.2 Validate artifacts with `openspec validate haidao-crewai-runtime-adapter --strict`.
- [ ] 1.3 Update change queue only if scope or ordering changes.
- [x] 1.4 Complete subagent planning review before implementation.

## 2. Proposal Schema Foundation

- [x] 2.1 Write failing tests for valid proposal-only payloads.
- [x] 2.2 Write failing tests rejecting non-`proposal_only` write intents.
- [x] 2.3 Write failing tests rejecting facts/inferences/recommendations without evidence IDs.
- [x] 2.4 Implement minimal proposal schema/validator module.
- [x] 2.5 Write failing tests rejecting malformed JSON, missing required fields, invalid enum values, invalid confidence values, and raw model output leakage.
- [x] 2.6 Ensure validation errors use stable public `error_type=crewai_invalid_proposal` and do not expose raw model output.

## 3. Harness Tool Gateway

- [x] 3.1 Write failing tests proving only allowlisted tools can be called.
- [x] 3.2 Implement Harness tool gateway with explicit tool registry.
- [x] 3.3 Write failing tests proving tool payloads cannot include `.env`, Cookie path, DB URL, browser state, or arbitrary file paths.
- [x] 3.4 Implement sanitized tool input/output boundary.
- [x] 3.5 Add evidence summary tool using existing MySQL ledger or fixture/fake repository.
- [x] 3.6 Write failing tests proving `submit_proposal` or proposal recorder calls are not CrewAI-exposed tools.

## 4. CrewAI Runtime Adapter

- [x] 4.1 Add project-local CrewAI dependency or optional import wrapper without breaking tests when real package is absent.
- [x] 4.2 Write fake runtime tests for successful structured proposal generation.
- [x] 4.3 Implement `CrewAIRuntimeAdapter` with injectable runtime for tests.
- [x] 4.4 Write failure tests for runtime exception and malformed model output.
- [x] 4.5 Implement stable fallback/error payloads for `crewai_runtime_failed` and `crewai_invalid_proposal`.

## 5. FastAPI Integration

- [x] 5.1 Write FastAPI tests for creating a CrewAI proposal from an existing Agent Loop run.
- [x] 5.2 Implement minimal internal/public FastAPI endpoint or service wrapper.
- [x] 5.3 Write MySQL unavailable and run-not-found tests.
- [x] 5.4 Ensure endpoint never reads real Cookie, `.env`, browser state, or raw worker stderr.
- [x] 5.5 Ensure old FastAPI sidecar and Node tests still pass.

## 6. Evidence And Persistence Boundary

- [x] 6.1 Write tests proving accepted proposal audit records are mandatory and do not mutate event/action/memory fact tables.
- [x] 6.2 Write tests proving rejected proposals are recorded with reason and evidence errors.
- [x] 6.3 Write tests proving runtime errors are recorded as error proposal audit records.
- [x] 6.4 Write tests proving invalid submit attempts do not create accepted proposal records.
- [x] 6.5 Implement proposal audit persistence if existing ledger supports it, or create a non-destructive migration proposal if needed.
- [ ] 6.6 Run real MySQL tests when available.

## 7. Verification And Review

- [x] 7.1 Run targeted CrewAI adapter tests.
- [x] 7.2 Run `npm test`.
- [ ] 7.3 Run real MySQL test suite when `WEIBO_DB_PERSISTENCE_TEST_URL` is available.
- [x] 7.4 Run `openspec validate haidao-crewai-runtime-adapter --strict`.
- [x] 7.5 Run `git diff --check`.
- [x] 7.6 Run `npm run agent:guard`.
- [ ] 7.7 Complete subagent review, evidence report, commit, push, and PR update.
