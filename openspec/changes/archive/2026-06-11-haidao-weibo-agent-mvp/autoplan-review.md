# Autoplan Review: haidao-weibo-agent-mvp

Reviewed input:

- `openspec/changes/haidao-weibo-agent-mvp/proposal.md`
- `openspec/changes/haidao-weibo-agent-mvp/design.md`
- `openspec/changes/haidao-weibo-agent-mvp/tasks.md`
- `openspec/changes/haidao-weibo-agent-mvp/specs/*/spec.md`
- Current app anchors in `ai-public-opinion-monitor/src/server.js`, `workers/enterprise_worker.py`, `workers/db.py`, `workers/collectors/weibo.py`, `public/app.js`, and `migrations/001_enterprise_mysql.sql`

Status: DONE_WITH_CONCERNS

The plan is directionally strong. It correctly cuts scope to Weibo, keeps MediaCrawler as a tool rather than the product, and preserves the important Agent distinction between recommendation, real-world action, and evidence-backed backtest.

The plan is not yet implementation-tight. The biggest gaps are not product taste. They are contract gaps that will cause drift during `/opsx:apply`: target-specific MediaCrawler detail collection, exact API/worker command contracts, schema naming, and the first-screen workbench payload.

## Plan Summary

The MVP proves one loop on Weibo:

```text
Weibo search -> discovered targets -> Agent recommendation -> user selection
-> Weibo detail comments -> topic analysis -> event/lead -> action suggestion
-> user-confirmed action -> backtest/unknown -> cited Q&A
```

That is the right first proof. It tests whether this can become a publicity Agent instead of a generic public-opinion dashboard.

## CEO Review

### Premise Challenge

| Premise | Verdict | Notes |
| --- | --- | --- |
| Weibo is the right first platform | Valid | The existing reference data is Weibo-heavy, Weibo has topic/post/comment shapes that fit event detection, and it is the fastest way to prove Agent value. |
| The MVP should prove the Agent loop, not all data coverage | Valid | This keeps the plan from collapsing back into crawler integration. |
| Action ledger/backtest belongs in MVP | Mostly valid | It is core to the Agent thesis, but the MVP should accept `unknown` backtests as success. Requiring strong effect signals early would overfit to sparse data. |
| MediaCrawler can support target-specific detail collection | Unproven | This is the highest strategic risk. If detail collection cannot target selected Weibo posts reliably, the user-selection workflow breaks. |
| Source-account/matrix detection should start in MVP | Valid if lightweight | Seed accounts and text fingerprints are enough. Do not attempt graph/image/OCR logic now. |

### What Already Exists

| Sub-problem | Existing code | Reuse decision |
| --- | --- | --- |
| HTTP service | `src/server.js` | Reuse and add explicit endpoints. Avoid one mega `/api/collect`. |
| Worker command bridge | `workers/enterprise_worker.py` | Reuse as command entry point, but split commands by action. |
| Base schema | `migrations/001_enterprise_mysql.sql` | Extend additively. Do not replace. |
| Default project/auth states | `workers/db.py` | Reuse but change default active MVP platform to Weibo for this flow. |
| Weibo collector placeholder | `workers/collectors/weibo.py` | Replace or bypass with MediaCrawler adapter. Current scrapling placeholder is not the PRD path. |
| Sentiment local fallback | `workers/agents/sentiment_agent.py` | Reuse as fallback, but mark fallback explicitly. |
| Dashboard rendering | `public/app.js`, `public/index.html` | Reuse shell, but workbench needs a new payload hierarchy. |

### Dream State Delta

```text
CURRENT
  Broad dashboard shell, MySQL base schema, fake-resistant but no real Weibo loop.

THIS PLAN
  Weibo-only Agent proof with target selection, events, action ledger, backtest unknowns, cited answers.

12-MONTH IDEAL
  Three-platform campaign memory: official/matrix/natural source separation,
  durable event timeline, action effectiveness history, and cross-platform strategy recall.
```

### Strategic Findings

1. **Critical: target-specific detail collection is underspecified.**
   The plan says selected targets run MediaCrawler detail, but it does not specify the exact input contract needed to make MediaCrawler collect comments for a selected Weibo target. The implementation needs a spike before treating detail collection as guaranteed.

   Fix: add a task and spec scenario for a `target_locator` contract: external ID, URL, mid/status ID, author, target type, and fallback behavior when MediaCrawler cannot detail that target.

2. **High: the MVP success definition should include fixture E2E as first-class.**
   Real Weibo auth/CDP may be brittle. The plan includes fixtures, but final acceptance still leans on real MediaCrawler availability. The team should treat fixture E2E as required and real Weibo search as opportunistic evidence.

   Fix: split acceptance into `must pass fixture E2E` and `run real Weibo search when environment available`.

3. **Medium: action backtest can be in MVP, but only as "backtest readiness + unknown" first.**
   If the team tries to produce meaningful effect judgments before enough windows exist, it will either block or overclaim.

   Fix: make `unknown with missing evidence` a successful MVP outcome for first confirmed action.

### NOT In Scope

- Xiaohongshu/Douyin collection.
- Cross-platform strategy comparison.
- Image hash/OCR/video fingerprint matrix detection.
- Automated posting.
- Vector memory.
- Strong causal attribution.

## Design Review

UI scope: yes. The plan includes a new Agent workbench, target review, event detail, pending action confirmation, and Q&A.

### Design Scorecard

| Dimension | Score | Reason |
| --- | ---: | --- |
| Information hierarchy | 7/10 | Agent-first direction is right, but exact sections and priority rules are not contract-level yet. |
| Empty/error states | 8/10 | No-data and setup gaps are explicitly required. Partial data states need more detail. |
| User journey | 7/10 | Discovery -> select -> event -> action is coherent. First-run onboarding is still thin. |
| Specific UI contract | 6/10 | Specs name panels, but not payload shape, table fields, or primary actions per card. |
| Accessibility/responsiveness | 4/10 | Not specified. Existing app is canvas-heavy and card-heavy. MVP needs keyboard/action semantics. |
| Domain fit | 8/10 | Workbench model fits publicity work better than generic BI. |

### Design Findings

1. **High: workbench payload and first-screen sections need a stable contract.**
   "Show current Agent judgments" is too open. Implementers need the exact object shape or they will wire arbitrary snapshot fragments.

   Fix: add a `GET /api/weibo/workbench` contract with:

   ```json
   {
     "mode": "weibo-agent-mvp",
     "setup": {},
     "judgments": [],
     "recommendedTargets": [],
     "events": [],
     "pendingActions": [],
     "dataGaps": [],
     "citations": []
   }
   ```

2. **Medium: target cards need a decision-oriented layout.**
   A Weibo target is not just content. It needs: why collect, what question it answers, evidence confidence, risk, and action buttons.

   Fix: define target card fields in the workbench spec.

3. **Medium: pending action confirmation should be a small queue, not buried in event detail.**
   In real use, these confirmations are the bridge between reality and Agent memory.

   Fix: put pending confirmations in the first viewport when present.

4. **Medium: partial states are underspecified.**
   Likely states: search succeeded/no detail, detail succeeded/no analysis, analysis succeeded/no event, event exists/no action, action exists/no backtest.

   Fix: add partial-state scenarios to `weibo-agent-workbench`.

## Engineering Review

### Architecture Diagram

```text
src/server.js
   │
   ▼
workers/enterprise_worker.py
   ├── health/migrate/snapshot existing commands
   ├── weibo_discover(keyword)
   │      └── MediaCrawler wb search -> JSONL archive
   │             └── adapter -> discovered_targets
   ├── weibo_collect_target(target_id)
   │      └── MediaCrawler wb detail -> JSONL archive
   │             └── adapter -> social_posts/social_comments
   ├── analyze_weibo_comments()
   │      └── DeepSeek/local fallback -> sentiment_results
   ├── merge_weibo_events()
   │      └── artist_public_opinion_events + evidence/status
   ├── action_ledger()
   │      └── publicity_actions + source_accounts
   ├── backtest_action(action_id)
   │      └── action_backtests
   └── workbench_payload()
          └── JSON for public/app.js
```

### Engineering Findings

1. **Critical: API/worker command contract is unresolved.**
   Tasks say "API endpoints or worker commands". That ambiguity will create mismatched front-end and worker implementations.

   Auto-decision: use explicit HTTP endpoints in `src/server.js` that call explicit worker subcommands. Worker commands are allowed internally, but the product contract is HTTP.

   Required endpoints:

   - `GET /api/weibo/workbench`
   - `POST /api/weibo/discovery`
   - `GET /api/weibo/targets`
   - `POST /api/weibo/targets/select`
   - `POST /api/weibo/targets/ignore`
   - `POST /api/weibo/targets/:id/collect-comments`
   - `GET /api/weibo/events`
   - `GET /api/weibo/events/:id`
   - `GET /api/weibo/actions/pending`
   - `PATCH /api/weibo/actions/:id/confirmation`
   - `POST /api/weibo/actions/:id/backtest`
   - `POST /api/weibo/bot/messages`

2. **Critical: schema names conflict between plan sections.**
   Design says `public_opinion_events` or `artist_public_opinion_events`. Tasks say `artist_public_opinion_events`. Specs say "Weibo public-opinion event" without a table name.

   Auto-decision: use `artist_public_opinion_events` to match the PRD and tasks. Do not introduce `public_opinion_events`.

3. **High: migration task is too large for one implementation chunk.**
   Task 1.2 adds 12 tables plus extensions. This is doable but high blast radius.

   Auto-decision: split migration into:
   - core ingestion tables/columns;
   - event/action/backtest tables;
   - bot/report tables.

4. **High: `platform_auth_states.status` enum needs planned migration.**
   Existing enum only supports `missing/configured/invalid`. New health wants expired, verification-required, rate-limited. MySQL enum alteration needs explicit migration and compatibility.

   Fix: add task for enum expansion and old `configured` mapping.

5. **High: source accounts cannot be reliable unless adapter preserves account identity.**
   The adapter must map Weibo account external ID or URL into `source_accounts`. Author display name alone is not enough.

   Fix: require `author_external_id` or `author_url` where available, plus fallback hash when missing.

6. **Medium: backtest queries need time fields on actions and collected comments.**
   `social_comments.collected_at` exists. Actions need `observed_at`, `confirmed_at`, and maybe `effective_at`. Specs mention timestamp but tasks do not force field names.

   Fix: add exact MVP columns to the schema task.

7. **Medium: DeepSeek batching needs rate-limit and retry policy.**
   The plan says batch pending comments but not max batch size, retry count, or timeout.

   Auto-decision: MVP defaults: batch 20 comments, timeout 60s, one retry, failure writes `agent_runs` and leaves comments pending or fallback-marked.

8. **Medium: old `/api/collect` can violate Weibo-only scope.**
   Existing `collect` loops over project active platforms. If default project remains three platforms or old data persists, `/api/collect` may run old collectors.

   Fix: either make default project active platforms `["weibo"]` for MVP or make `/api/collect` reject in favor of `/api/weibo/discovery`.

### Test Diagram

| Flow | Unit tests | Integration tests | E2E/fixture |
| --- | --- | --- | --- |
| Health blocks missing MediaCrawler/CDP/auth | yes | yes | no |
| Weibo search JSONL -> targets | yes | yes | yes |
| Target recommendation | yes | yes | yes |
| Select/ignore target | yes | yes | yes |
| Detail JSONL -> posts/comments | yes | yes | yes |
| DeepSeek/fallback analysis | yes | yes | fixture with mocked DeepSeek |
| Event threshold -> lead/event | yes | yes | yes |
| Action suggestion != execution | yes | yes | yes |
| Official/matrix source typing | yes | yes | fixture |
| Backtest unknown/signal | yes | yes | yes |
| Workbench no-data/active/partial | component or DOM tests | API payload tests | browser smoke |
| Q&A source citations | yes | yes | yes |

### Failure Modes Registry

| Failure mode | Severity | Required handling |
| --- | --- | --- |
| MediaCrawler missing | High | Health error, no task start |
| CDP unavailable | High | Health error, no task start |
| Weibo verification required | High | Platform-level block, service remains up |
| MediaCrawler detail cannot target selected post | Critical | Task fails with `target_detail_unsupported`, target remains selected, user sees remediation |
| JSONL schema drift | High | Raw archive, adapter error counts, partial status |
| DeepSeek timeout | Medium | `agent_runs` failure, fallback or pending state |
| Sparse evidence | Medium | Observation lead, no formal event |
| Multiple overlapping actions | Medium | Backtest with confounders, no causal claim |
| Old three-platform collector invoked | High | Reject or route to Weibo-only flow |

## DX Review

DX scope: yes. The plan adds environment variables, migrations, worker commands, APIs, and setup docs.

### Developer Journey

| Stage | Current plan quality | Needed improvement |
| --- | --- | --- |
| Read setup | Good | Add Weibo MVP quickstart. |
| Configure env | Medium | Include MediaCrawler/CDP exact commands. |
| Run migration | Medium | Name new migration and verify tables. |
| Check health | Good | Include sample JSON responses. |
| Run fixture E2E | Missing | Add a copy-paste command. |
| Run real Weibo search | Medium | Document prerequisites and expected failure modes. |
| Debug adapter | Medium | Raw JSONL path helps, but error examples needed. |
| Test | Good | Test list is strong. |
| Extend to next platform | Deferred | Explicitly state not covered. |

### DX Findings

1. **High: there is no "hello world" path.**
   A developer needs a deterministic way to prove the MVP without Weibo auth and MediaCrawler.

   Fix: add fixture E2E command, e.g. `python workers/enterprise_worker.py weibo-fixture-e2e`.

2. **Medium: error messages need problem/cause/fix shape.**
   Specs require machine-readable errors but not human remediation.

   Fix: every health/task error should include `error_type`, `message`, `cause`, `fix`, and optional `docs_anchor`.

3. **Medium: README update should be promoted from final task to acceptance criterion.**
   This feature has setup complexity. Docs are not polish; they are how anyone runs it.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | CEO | Keep Weibo-only MVP scope | Mechanical | P1/P3 | Proves Agent loop without three-platform instability | Three-platform first delivery |
| 2 | CEO | Treat `unknown` backtest as valid MVP output | Mechanical | P5 | Honest evidence boundary beats fake effect claims | Require strong action-effect result |
| 3 | Eng | Use explicit HTTP endpoints plus worker subcommands | Mechanical | P5 | Removes "API or worker" ambiguity | Leave interface unspecified |
| 4 | Eng | Standardize on `artist_public_opinion_events` | Mechanical | P4 | Matches PRD/tasks and avoids duplicate event tables | Add `public_opinion_events` |
| 5 | Eng | Split migration into logical chunks | Mechanical | P2 | Reduces blast radius and review pain | One huge migration task |
| 6 | DX | Add fixture E2E as required developer path | Mechanical | P1 | Lets team verify the loop without real Weibo auth | Real-only manual verification |

## Required Plan Revisions

Apply these before `/opsx:apply` if possible. They are small and reduce implementation drift.

- [ ] R1 Add a target-detail locator contract to `weibo-real-data-ingestion` specs.
- [ ] R2 Replace "API endpoints or worker commands" with the explicit endpoint list in design and tasks.
- [ ] R3 Standardize event table naming on `artist_public_opinion_events`.
- [ ] R4 Split migration tasks into ingestion, event/action/backtest, and memory/report chunks.
- [ ] R5 Add `platform_auth_states.status` enum expansion and compatibility task.
- [ ] R6 Add `author_external_id` or `author_url` requirements for source account matching.
- [ ] R7 Add DeepSeek batch/timeout/retry defaults.
- [ ] R8 Add fixture E2E command and make it required before real Weibo verification.
- [ ] R9 Add workbench payload contract and partial-state scenarios.
- [ ] R10 Add human-facing error payload fields: problem/cause/fix/docs anchor.

## Review Scores

| Area | Score | Summary |
| --- | ---: | --- |
| CEO | 8/10 | Right platform cut and right Agent thesis. Detail-target feasibility is the main unproven premise. |
| Design | 7/10 | Workbench direction is strong. Needs payload contract and partial-state detail. |
| Engineering | 7/10 | Architecture is viable on existing code. Needs endpoint/schema/detail contracts tightened. |
| DX | 6/10 | Setup complexity is under-controlled. Fixture E2E is needed as the developer hello world. |

## Final Recommendation

Approve the plan after applying R1-R10. None of the findings require changing the core product direction. They make the MVP more implementable and less likely to drift into a half-wired dashboard.

