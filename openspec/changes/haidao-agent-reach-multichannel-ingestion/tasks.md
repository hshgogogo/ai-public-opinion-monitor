## 1. OpenSpec And Queue

- [x] 1.1 Create `haidao-agent-reach-multichannel-ingestion` proposal, design, tasks, and spec artifacts.
- [x] 1.2 Add the change to `docs/agent-loop-change-queue.md` after the current FastAPI/CrewAI/Judge/report/workbench path.
- [x] 1.3 Validate artifacts with `openspec validate haidao-agent-reach-multichannel-ingestion --strict`.
- [x] 1.4 Complete subagent planning review before implementation.

## 2. Adapter Foundation

- [x] 2.1 Write failing tests for Agent-Reach doctor/health with a fake runner.
- [x] 2.2 Implement minimal AgentReachAdapter service with command allowlist.
- [x] 2.3 Write failing tests rejecting non-whitelisted platforms and commands.
- [x] 2.4 Implement sanitized stdout/stderr/error payloads with stable `error_type`.
- [x] 2.5 Prove public payloads never expose `.env`, Cookie, token, DB URL, browser state, QR login token, or raw worker stderr.

## 3. B站 First Slice

- [x] 3.1 Write B站 search/detail fixture tests for content item normalization.
- [x] 3.2 Implement B站 normalizer for title/text/author/url/metrics/published time/raw artifact refs.
- [x] 3.3 Write persistence tests for B站 source accounts, posts/items, comments or evidence links.
- [x] 3.4 Implement idempotent persistence with project-scoped platform/external ID keys.
- [x] 3.5 Add Agent Loop step status for B站 collection success/partial/failure.

## 4. 小红书 Second Slice

- [x] 4.1 Write 小红书 fixture tests for note/search/detail normalization.
- [x] 4.2 Implement 小红书 normalizer with source account and note/comment evidence mapping.
- [x] 4.3 Write auth-required tests proving missing local login state returns `platform_auth_required` without fake success.
- [x] 4.4 Implement login-state boundary so credentials are only available inside the controlled runner.
- [x] 4.5 Add persistence tests and idempotent writes for 小红书 evidence.

## 5. 抖音 Final Slice

- [x] 5.1 Write 抖音 doctor/capability fixture tests after B站 and 小红书 slices pass.
- [ ] 5.2 Write 抖音 search/detail fixture tests only after the upstream runner contract is clear.
- [ ] 5.3 Implement 抖音 normalizer and persistence if local/fake runner contract is stable.
- [ ] 5.4 If real 抖音 access requires high-risk login or unstable tooling, leave real validation blocked with explicit evidence.

## 6. Harness Integration

- [ ] 6.1 Add FastAPI internal service/endpoint contract for platform collection trigger if needed.
- [ ] 6.2 Ensure CrewAI can only read normalized evidence summary, not call Agent-Reach directly.
- [ ] 6.3 Ensure Judge/Report can cite platform evidence IDs with platform labels.
- [ ] 6.4 Ensure old微博 paths continue to pass regression tests.

## 7. Verification And Review

- [ ] 7.1 Run targeted adapter and normalizer tests.
- [ ] 7.2 Run `npm test`.
- [ ] 7.3 Run real MySQL tests if schema or persistence changes.
- [ ] 7.4 Run `openspec validate haidao-agent-reach-multichannel-ingestion --strict`.
- [ ] 7.5 Run `git diff --check`.
- [ ] 7.6 Run `npm run agent:guard`.
- [ ] 7.7 Complete subagent review, evidence report, commit, push, and PR update.
