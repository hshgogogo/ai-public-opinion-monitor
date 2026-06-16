import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const python = process.env.PYTHON_BIN || "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const testMysqlUrl = process.env.WEIBO_DB_PERSISTENCE_TEST_URL;
const fakeWeiboCookieFile = "test/fixtures/weibo-cookie.json";

test("Weibo DB persistence subprocess helpers skip dotenv loading", () => {
  const source = readFileSync("test/weibo-db-persistence.test.js", "utf8");
  for (const helperName of ["runWorker", "queryRows", "runPythonSnippet"]) {
    assert.match(
      source,
      new RegExp(`function ${helperName}[\\s\\S]*?YUQING_SKIP_ENV_FILE:\\s*"1"`),
      `${helperName} must set YUQING_SKIP_ENV_FILE=1 before importing worker/db modules`
    );
  }
});

test(
  "runs Agent Harness loop migration twice and creates ledger tables",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["migrate"]).ok, true);

    const tables = queryRows(
      "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('agent_loop_runs','agent_step_runs','judge_reviews','feedback_items') ORDER BY TABLE_NAME"
    ).map((row) => row.table_name);
    assert.deepEqual(tables, [
      "agent_loop_runs",
      "agent_step_runs",
      "feedback_items",
      "judge_reviews"
    ]);
  }
);

test(
  "persists Agent Harness loop, step, Judge review, and manual handoff records via worker helpers",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const result = runPythonSnippet(`
import json
from workers import enterprise_worker as worker

project_id = int(__import__("os").environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    target_id=42,
    current_step="comment_analysis",
    input_json={"target_id": 42, "requested_by": "test"},
)
step = worker.record_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Issue Analysis Agent",
    step_name="comment_analysis",
    status="succeeded",
    input_json={"comment_ids": [1, 2]},
    output_json={"summary": "evidence-backed"},
    evidence_ids=["comment-1", "comment-2"],
)
review = worker.record_judge_review(
    loop_run_id=loop["id"],
    step_run_id=step["id"],
    project_id=project_id,
    judge_agent_name="Judge Agent",
    status="passed",
    passed=True,
    score=0.91,
    feedback_json={"verdict": "ok"},
    required_changes=[],
    evidence_errors=[],
)
handoff = worker.record_manual_handoff(
    project_id=project_id,
    source_type="step",
    source_id=step["id"],
    feedback_type="manual_handoff",
    note="needs producer confirmation",
    status="open",
    created_by="agent_harness",
)
print(json.dumps({"loop": loop, "step": step, "review": review, "handoff": handoff}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId) });

    assert.equal(result.loop.status, "running");
    assert.equal(result.step.status, "succeeded");
    assert.equal(result.review.status, "passed");
    assert.equal(result.handoff.feedback_type, "manual_handoff");

    assert.deepEqual(queryRows(
      "SELECT platform, trigger_mode, target_id, status, current_step, JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.requested_by')) AS requested_by FROM agent_loop_runs WHERE id=%s",
      [result.loop.id]
    )[0], {
      platform: "weibo",
      trigger_mode: "manual",
      target_id: 42,
      status: "running",
      current_step: "comment_analysis",
      requested_by: "test"
    });
    assert.deepEqual(queryRows(
      "SELECT agent_name, step_name, status, JSON_LENGTH(evidence_ids) AS evidence_count, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.summary')) AS summary FROM agent_step_runs WHERE id=%s",
      [result.step.id]
    )[0], {
      agent_name: "Issue Analysis Agent",
      step_name: "comment_analysis",
      status: "succeeded",
      evidence_count: 2,
      summary: "evidence-backed"
    });
    assert.deepEqual(queryRows(
      "SELECT judge_agent_name, status, passed, CAST(score AS CHAR) AS score, JSON_LENGTH(required_changes) AS required_change_count, JSON_LENGTH(evidence_errors) AS evidence_error_count FROM judge_reviews WHERE id=%s",
      [result.review.id]
    )[0], {
      judge_agent_name: "Judge Agent",
      status: "passed",
      passed: 1,
      score: "0.9100",
      required_change_count: 0,
      evidence_error_count: 0
    });
    assert.deepEqual(queryRows(
      "SELECT source_type, source_id, feedback_type, note, status, created_by FROM feedback_items WHERE id=%s",
      [result.handoff.id]
    )[0], {
      source_type: "step",
      source_id: result.step.id,
      feedback_type: "manual_handoff",
      note: "needs producer confirmation",
      status: "open",
      created_by: "agent_harness"
    });
  }
);

test(
  "FastAPI CrewAI proposal endpoint persists proposal audits into Agent Harness ledger",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    assert.equal(runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "1001" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-build-events-fixture",
      "--fixture",
      "test/fixtures/weibo-event-evidence.jsonl",
      "--persist-project-id",
      String(projectId)
    ]).ok, true);
    const commentId = queryRows("SELECT id FROM social_comments WHERE project_id=%s ORDER BY id LIMIT 1", [projectId])[0].id;
    const eventId = queryRows("SELECT id FROM artist_public_opinion_events WHERE project_id=%s ORDER BY id LIMIT 1", [projectId])[0].id;
    const factCountsBefore = queryRows(
      `
      SELECT
        (SELECT COUNT(*) FROM artist_public_opinion_events WHERE project_id=%s) AS events,
        (SELECT COUNT(*) FROM publicity_actions WHERE project_id=%s) AS actions,
        (SELECT COUNT(*) FROM bot_memory_items WHERE project_id=%s) AS memory_items
      `,
      [projectId, projectId, projectId]
    )[0];

    const result = runPythonSnippet(`
import json
import os
from app.crewai_proposal_service import CrewAIProposalService
from app.main import create_app
from fastapi.testclient import TestClient
from workers import enterprise_worker as worker

class FakeProposalRuntime:
    def __init__(self):
        self.calls = []

    def run_proposal(self, request):
        self.calls.append(request)
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "真实账本审计已写入。", "evidence_ids": [f"comment:{os.environ['COMMENT_ID']}"]}],
                "inferences": [{"text": "讨论热度需要继续观察。", "confidence": "medium", "evidence_ids": [f"comment:{os.environ['COMMENT_ID']}"]}],
                "recommendations": [{"text": "准备带证据的回应预案。", "risk_notes": ["不要过度归因。"], "evidence_ids": [f"event:{os.environ['EVENT_ID']}"]}],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [5],
                "raw_model_output_ref": "audit://raw-output/real-db-test"
            },
        }

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="strategy",
    input_json={"source": "crewai-proposal-test"},
)
runtime = FakeProposalRuntime()
service = CrewAIProposalService(runtime_adapter=runtime)
client = TestClient(create_app(crewai_proposal_service=service))
response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/crewai/proposals",
    json={
        "projectId": project_id,
        "stage": "strategy",
        "evidenceIds": [f"comment:{os.environ['COMMENT_ID']}", f"event:{os.environ['EVENT_ID']}"],
        "knowledgeQuery": "宣发回应",
    },
)
print(json.dumps({
    "status_code": response.status_code,
    "payload": response.json(),
    "runtime_calls": runtime.calls,
    "loop_id": loop["id"],
}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId), COMMENT_ID: String(commentId), EVENT_ID: String(eventId) });

    assert.equal(result.status_code, 200, result.payload);
    assert.equal(result.payload.ok, true, result.payload);
    assert.equal(typeof result.payload.proposalAuditId, "number", result.payload);
    assert.deepEqual(result.runtime_calls, [{
      project_id: projectId,
      agent_loop_run_id: result.loop_id,
      stage: "strategy",
      evidence_ids: [`comment:${commentId}`, `event:${eventId}`],
      knowledge_query: "宣发回应"
    }]);

    const auditRow = queryRows(
      "SELECT agent_name, step_name, status, JSON_LENGTH(evidence_ids) AS evidence_count, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.proposal.raw_model_output_ref')) AS raw_ref, JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.knowledge_query')) AS knowledge_query FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
      [result.payload.proposalAuditId, result.loop_id, projectId]
    )[0];
    assert.deepEqual(auditRow, {
      agent_name: "Strategy Agent",
      step_name: "crewai_proposal_audit",
      status: "succeeded",
      evidence_count: 2,
      raw_ref: "audit://raw-output/real-db-test",
      knowledge_query: "宣发回应"
    });
    assert.deepEqual(queryRows(
      `
      SELECT
        (SELECT COUNT(*) FROM artist_public_opinion_events WHERE project_id=%s) AS events,
        (SELECT COUNT(*) FROM publicity_actions WHERE project_id=%s) AS actions,
        (SELECT COUNT(*) FROM bot_memory_items WHERE project_id=%s) AS memory_items
      `,
      [projectId, projectId, projectId]
    )[0], factCountsBefore);
  }
);

test(
  "FastAPI CrewAI proposal endpoint records rejected and runtime_error proposal audits into agent_step_runs",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const result = runPythonSnippet(`
import json
import os
from app.crewai_proposal_service import CrewAIProposalService
from app.main import create_app
from fastapi.testclient import TestClient
from workers import enterprise_worker as worker

class RejectedRuntime:
    def __init__(self):
        self.calls = []

    def run_proposal(self, request):
        self.calls.append(request)
        return {
            "ok": False,
            "error_type": "crewai_evidence_rejected",
            "message": "Evidence was rejected.",
            "cause": "Cross-project evidence is not allowed.",
            "fix": "Retry with evidence IDs from the same project.",
        }

class RuntimeFailedRuntime:
    def __init__(self):
        self.calls = []

    def run_proposal(self, request):
        self.calls.append(request)
        return {
            "ok": False,
            "error_type": "crewai_runtime_failed",
            "message": "CrewAI runtime failed.",
            "cause": "private runtime details",
            "fix": "Retry with a healthy runtime.",
            "traceback": "hidden traceback",
            "stderr": "hidden stderr",
        }

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="strategy",
    input_json={"source": "crewai-proposal-test"},
)

rejected_runtime = RejectedRuntime()
rejected_service = CrewAIProposalService(runtime_adapter=rejected_runtime)
client = TestClient(create_app(crewai_proposal_service=rejected_service))
rejected_response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/crewai/proposals",
    json={
        "projectId": project_id,
        "stage": "strategy",
        "evidenceIds": ["comment:123"],
        "knowledgeQuery": "宣发回应",
    },
)

runtime_failed_runtime = RuntimeFailedRuntime()
runtime_failed_service = CrewAIProposalService(runtime_adapter=runtime_failed_runtime)
runtime_failed_client = TestClient(create_app(crewai_proposal_service=runtime_failed_service))
runtime_failed_response = runtime_failed_client.post(
    f"/api/weibo/agent-runs/{loop['id']}/crewai/proposals",
    json={
        "projectId": project_id,
        "stage": "strategy",
        "evidenceIds": ["comment:123"],
        "knowledgeQuery": "宣发回应",
    },
)

print(json.dumps({
    "rejected": rejected_response.json(),
    "runtime_failed": runtime_failed_response.json(),
    "loop_id": loop["id"],
}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId) });

    assert.equal(result.rejected.ok, false, result.rejected);
    assert.equal(result.rejected.error_type, "crewai_evidence_rejected", result.rejected);
    assert.equal(result.runtime_failed.ok, false, result.runtime_failed);
    assert.equal(result.runtime_failed.error_type, "crewai_runtime_failed", result.runtime_failed);

    const rejectedRow = queryRows(
      "SELECT agent_name, step_name, status, error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.error_type')) AS output_error_type FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
      [result.rejected.proposalAuditId, result.loop_id, projectId]
    )[0];
    assert.deepEqual(rejectedRow, {
      agent_name: "CrewAI Proposal Harness",
      step_name: "crewai_proposal_audit",
      status: "partial",
      error_type: "crewai_evidence_rejected",
      output_error_type: "crewai_evidence_rejected"
    });

    const runtimeFailedRow = queryRows(
      "SELECT agent_name, step_name, status, error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.error_type')) AS output_error_type FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
      [result.runtime_failed.proposalAuditId, result.loop_id, projectId]
    )[0];
    assert.deepEqual(runtimeFailedRow, {
      agent_name: "CrewAI Proposal Harness",
      step_name: "crewai_proposal_audit",
      status: "failed",
      error_type: "crewai_runtime_failed",
      output_error_type: "crewai_runtime_failed"
    });
  }
);

test(
  "FastAPI CrewAI proposal endpoint validates sentiment evidence ownership through comments",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("CrewAI sentiment cross-project evidence");
    const commentId = createEvidenceComment(projectId, "crewai-sentiment-same-project");
    const otherCommentId = createEvidenceComment(otherProjectId, "crewai-sentiment-cross-project");
    const sentimentId = createSentimentResult(commentId, "crewai-sentiment-same-project");
    const otherSentimentId = createSentimentResult(otherCommentId, "crewai-sentiment-cross-project");

    const result = runPythonSnippet(`
import json
import os
from app.crewai_proposal_service import CrewAIProposalService
from app.main import create_app
from fastapi.testclient import TestClient
from workers import enterprise_worker as worker

class SentimentRuntime:
    def __init__(self, sentiment_id):
        self.sentiment_id = sentiment_id

    def run_proposal(self, request):
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "comment_analysis",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Issue Analysis Agent",
                "stage": request["stage"],
                "facts": [{"text": "情绪分析证据已限定在项目评论内。", "evidence_ids": [f"sentiment:{self.sentiment_id}"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None
            },
        }

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="analysis",
    input_json={"source": "crewai-sentiment-evidence-test"},
)

accepted_client = TestClient(create_app(crewai_proposal_service=CrewAIProposalService(
    runtime_adapter=SentimentRuntime(int(os.environ["SENTIMENT_ID"]))
)))
accepted_response = accepted_client.post(
    f"/api/weibo/agent-runs/{loop['id']}/crewai/proposals",
    json={
        "projectId": project_id,
        "stage": "analysis",
        "evidenceIds": [f"sentiment:{os.environ['SENTIMENT_ID']}"],
    },
)

cross_client = TestClient(create_app(crewai_proposal_service=CrewAIProposalService(
    runtime_adapter=SentimentRuntime(int(os.environ["OTHER_SENTIMENT_ID"]))
)))
cross_response = cross_client.post(
    f"/api/weibo/agent-runs/{loop['id']}/crewai/proposals",
    json={
        "projectId": project_id,
        "stage": "analysis",
        "evidenceIds": [f"sentiment:{os.environ['OTHER_SENTIMENT_ID']}"],
    },
)

print(json.dumps({
    "accepted": accepted_response.json(),
    "cross": cross_response.json(),
    "loop_id": loop["id"],
}, ensure_ascii=False, default=str))
`, {
      PROJECT_ID: String(projectId),
      SENTIMENT_ID: String(sentimentId),
      OTHER_SENTIMENT_ID: String(otherSentimentId)
    });

    assert.equal(result.accepted.ok, true, result.accepted);
    assert.equal(result.accepted.proposalAuditId > 0, true, result.accepted);
    assert.equal(result.cross.ok, false, result.cross);
    assert.equal(result.cross.error_type, "crewai_evidence_rejected", result.cross);

    assert.deepEqual(queryRows(
      "SELECT status, JSON_CONTAINS(evidence_ids, JSON_QUOTE(%s)) AS has_sentiment FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
      [`sentiment:${sentimentId}`, result.accepted.proposalAuditId, result.loop_id, projectId]
    )[0], {
      status: "succeeded",
      has_sentiment: 1
    });
    assert.deepEqual(queryRows(
      "SELECT status, error_type FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
      [result.cross.proposalAuditId, result.loop_id, projectId]
    )[0], {
      status: "partial",
      error_type: "crewai_evidence_rejected"
    });
  }
);

test(
  "FastAPI CrewAI proposal endpoint rejects request evidence before runtime execution",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("CrewAI request evidence cross-project");
    const otherCommentId = createEvidenceComment(otherProjectId, "crewai-request-evidence-cross-project");

    const result = runPythonSnippet(`
import json
import os
from app.crewai_proposal_service import CrewAIProposalService
from app.main import create_app
from fastapi.testclient import TestClient
from workers import enterprise_worker as worker

class RuntimeShouldNotRun:
    def __init__(self):
        self.calls = 0

    def run_proposal(self, request):
        self.calls += 1
        return {
            "ok": True,
            "proposal": {
                "proposal_type": "strategy_action",
                "project_id": request["project_id"],
                "agent_loop_run_id": request["agent_loop_run_id"],
                "agent_name": "Strategy Agent",
                "stage": request["stage"],
                "facts": [{"text": "should not run", "evidence_ids": ["comment:1"]}],
                "inferences": [],
                "recommendations": [],
                "write_intent": "proposal_only",
                "knowledge_card_ids": [],
                "raw_model_output_ref": None
            },
        }

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="strategy",
    input_json={"source": "crewai-request-evidence-preflight-test"},
)
runtime = RuntimeShouldNotRun()
client = TestClient(create_app(crewai_proposal_service=CrewAIProposalService(runtime_adapter=runtime)))
response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/crewai/proposals",
    json={
        "projectId": project_id,
        "stage": "strategy",
        "evidenceIds": [f"comment:{os.environ['OTHER_COMMENT_ID']}"],
    },
)
print(json.dumps({
    "payload": response.json(),
    "runtime_calls": runtime.calls,
    "loop_id": loop["id"],
}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId), OTHER_COMMENT_ID: String(otherCommentId) });

    assert.equal(result.payload.ok, false, result.payload);
    assert.equal(result.payload.error_type, "crewai_evidence_rejected", result.payload);
    assert.equal(result.runtime_calls, 0, result);
    assert.deepEqual(queryRows(
      "SELECT status, error_type, JSON_CONTAINS(evidence_ids, JSON_QUOTE(%s)) AS has_cross_project_evidence FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
      [`comment:${otherCommentId}`, result.payload.proposalAuditId, result.loop_id, projectId]
    )[0], {
      status: "partial",
      error_type: "crewai_evidence_rejected",
      has_cross_project_evidence: 0
    });
  }
);

test(
  "FastAPI Judge review endpoint persists retry reviews and manual handoff",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const commentId = createEvidenceComment(projectId, "judge-review-passing-comment");

    const result = runPythonSnippet(`
import json
import os
from app.main import create_app
from fastapi.testclient import TestClient
from workers import enterprise_worker as worker

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="strategy",
    input_json={"source": "judge-review-persistence-test"},
)
proposal_audit = worker.record_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="CrewAI Proposal Harness",
    step_name="crewai_proposal_audit",
    status="succeeded",
    output_json={"proposal": {"summary": "candidate"}},
    evidence_ids=[],
)
strategy_step = worker.record_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Strategy Agent",
    step_name="strategy_review",
    status="succeeded",
    output_json={"draft": "candidate"},
    evidence_ids=[],
)
client = TestClient(create_app())
passing_response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/judge/reviews",
    json={
        "projectId": project_id,
        "proposalAuditId": proposal_audit["id"],
        "stepRunId": strategy_step["id"],
        "maxAttempts": 3,
        "fixtureOutputs": [
            {"output": {"summary": "missing evidence"}},
            {"output": {"summary": "still missing"}},
            {"output": {"summary": "bounded", "evidence_ids": [f"comment-{os.environ['COMMENT_ID']}"]}},
        ],
    },
)
exhausted_response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/judge/reviews",
    json={
        "projectId": project_id,
        "proposalAuditId": proposal_audit["id"],
        "stepRunId": strategy_step["id"],
        "maxAttempts": 3,
        "fixtureOutputs": [
            {"output": {"summary": "missing evidence"}},
            {"output": {"summary": "still missing"}},
            {"output": {"summary": "still missing again"}},
        ],
    },
)
print(json.dumps({
    "loop_id": loop["id"],
    "proposal_audit_id": proposal_audit["id"],
    "strategy_step_id": strategy_step["id"],
    "passing": passing_response.json(),
    "passing_status": passing_response.status_code,
    "exhausted": exhausted_response.json(),
    "exhausted_status": exhausted_response.status_code,
}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId), COMMENT_ID: String(commentId) });

    assert.equal(result.passing_status, 200, result.passing);
    assert.equal(result.passing.ok, true, result.passing);
    assert.equal(result.passing.review.status, "passed", result.passing);
    assert.equal(result.passing.retryCount, 2, result.passing);
    assert.equal(result.exhausted_status, 200, result.exhausted);
    assert.equal(result.exhausted.ok, true, result.exhausted);
    assert.equal(result.exhausted.review.status, "needs_human", result.exhausted);
    assert.equal(result.exhausted.manualHandoff.source_type, "judge_review", result.exhausted);

    assert.deepEqual(queryRows(
      `
      SELECT status, retry_count, JSON_UNQUOTE(JSON_EXTRACT(feedback_json, '$.failed_output_summary.summary')) AS failed_summary
      FROM judge_reviews
      WHERE loop_run_id=%s AND project_id=%s
      ORDER BY id
      `,
      [result.loop_id, projectId]
    ), [
      { status: "failed", retry_count: 0, failed_summary: "missing evidence" },
      { status: "failed", retry_count: 1, failed_summary: "still missing" },
      { status: "passed", retry_count: 2, failed_summary: "bounded" },
      { status: "failed", retry_count: 0, failed_summary: "missing evidence" },
      { status: "failed", retry_count: 1, failed_summary: "still missing" },
      { status: "needs_human", retry_count: 2, failed_summary: "still missing again" },
    ]);
    assert.deepEqual(queryRows(
      "SELECT status, current_step, error_type FROM agent_loop_runs WHERE id=%s AND project_id=%s",
      [result.loop_id, projectId]
    )[0], {
      status: "needs_human",
      current_step: "judge_review",
      error_type: "judge_retry_exhausted"
    });
    assert.deepEqual(queryRows(
      "SELECT status, error_type FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
      [result.strategy_step_id, result.loop_id, projectId]
    )[0], {
      status: "needs_human",
      error_type: "judge_retry_exhausted"
    });
    assert.deepEqual(queryRows(
      "SELECT source_type, source_id, feedback_type, status, created_by FROM feedback_items WHERE project_id=%s ORDER BY id",
      [projectId]
    ), [
      {
        source_type: "judge_review",
        source_id: result.exhausted.review.id,
        feedback_type: "manual_handoff",
        status: "open",
        created_by: "agent_harness"
      }
    ]);

    const status = runWorker([
      "weibo-agent-loop-status",
      "--payload-json",
      JSON.stringify({ projectId, loopRunId: result.loop_id })
    ]);
    assert.equal(status.ok, true, status);
    assert.equal(status.run.status, "needs_human", status);
    assert.equal(status.retryCount, 2, status);
    assert.equal(status.judgeReviews.length, 6, status);
    assert.equal(status.judgeReviews.at(-1).retry_count, 2, status);
    assert.equal(status.judgeReviews.at(-1).status, "needs_human", status);
    assert.deepEqual(status.manualHandoffs, [
      {
        ...status.feedbackItems[0],
      }
    ]);
    assert.equal(status.manualHandoffs[0].source_type, "judge_review", status);
    assert.equal(status.manualHandoffs[0].source_id, result.exhausted.review.id, status);
  }
);

test(
  "FastAPI Judge review endpoint maps comment analysis step output without fixtureOutputs",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("Judge step output cross-project fixture");
    const commentId = createEvidenceComment(projectId, "judge-step-output-comment-analysis");

    const result = runPythonSnippet(`
import json
import os
from app.main import create_app
from fastapi.testclient import TestClient
from workers import enterprise_worker as worker

project_id = int(os.environ["PROJECT_ID"])
other_project_id = int(os.environ["OTHER_PROJECT_ID"])
comment_id = int(os.environ["COMMENT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="comment_analysis",
    input_json={"source": "judge-step-output-review-test"},
)
analysis_step = worker.record_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Issue Analysis Agent",
    step_name="comment_analysis",
    status="succeeded",
    output_json={
        "command": "weibo-comments-analyze",
        "analyzed_comments": 1,
        "persisted_sentiments": 1,
        "deepseek": {"status": "disabled"},
    },
    evidence_ids=[f"comment-{comment_id}"],
)
same_project_other_loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="comment_analysis",
    input_json={"source": "judge-step-output-other-run"},
)
same_project_other_step = worker.record_agent_step_run(
    loop_run_id=same_project_other_loop["id"],
    project_id=project_id,
    agent_name="Issue Analysis Agent",
    step_name="comment_analysis",
    status="succeeded",
    output_json={
        "command": "weibo-comments-analyze",
        "analyzed_comments": 1,
        "persisted_sentiments": 1,
    },
    evidence_ids=[f"comment-{comment_id}"],
)
other_project_loop = worker.create_agent_loop_run(
    project_id=other_project_id,
    trigger_mode="manual",
    current_step="comment_analysis",
    input_json={"source": "judge-step-output-other-project"},
)
other_project_step = worker.record_agent_step_run(
    loop_run_id=other_project_loop["id"],
    project_id=other_project_id,
    agent_name="Issue Analysis Agent",
    step_name="comment_analysis",
    status="succeeded",
    output_json={
        "command": "weibo-comments-analyze",
        "analyzed_comments": 1,
        "persisted_sentiments": 1,
    },
    evidence_ids=[f"comment-{comment_id}"],
)
client = TestClient(create_app())
response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/judge/reviews",
    json={
        "projectId": project_id,
        "stepRunId": analysis_step["id"],
        "maxAttempts": 3,
    },
)
wrong_run_response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/judge/reviews",
    json={
        "projectId": project_id,
        "stepRunId": same_project_other_step["id"],
        "maxAttempts": 3,
    },
)
cross_project_response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/judge/reviews",
    json={
        "projectId": project_id,
        "stepRunId": other_project_step["id"],
        "maxAttempts": 3,
    },
)
print(json.dumps({
    "loop_id": loop["id"],
    "step_id": analysis_step["id"],
    "response_status": response.status_code,
    "response": response.json(),
    "wrong_run_status": wrong_run_response.status_code,
    "wrong_run": wrong_run_response.json(),
    "cross_project_status": cross_project_response.status_code,
    "cross_project": cross_project_response.json(),
}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId), OTHER_PROJECT_ID: String(otherProjectId), COMMENT_ID: String(commentId) });

    assert.equal(result.response_status, 200, result.response);
    assert.equal(result.response.ok, true, result.response);
    assert.equal(result.response.proposalAuditId, null, result.response);
    assert.equal(result.response.stepRunId, result.step_id, result.response);
    assert.equal(result.response.review.status, "passed", result.response);
    assert.equal(result.response.review.retry_count, 0, result.response);
    assert.deepEqual(result.response.review.evidence_errors, [], result.response);

    assert.deepEqual(queryRows(
      `
      SELECT
        step_run_id,
        status,
        passed,
        retry_count,
        JSON_UNQUOTE(JSON_EXTRACT(feedback_json, '$.proposal_audit_id')) AS proposal_audit_id,
        JSON_UNQUOTE(JSON_EXTRACT(feedback_json, '$.evidence_ids[0]')) AS evidence_id,
        JSON_UNQUOTE(JSON_EXTRACT(feedback_json, '$.failed_output_summary.summary')) AS summary,
        JSON_UNQUOTE(JSON_EXTRACT(feedback_json, '$.failed_output_summary.deepseek.status')) AS deepseek_status
      FROM judge_reviews
      WHERE loop_run_id=%s AND project_id=%s
      ORDER BY id
      `,
      [result.loop_id, projectId]
    ), [
      {
        step_run_id: result.step_id,
        status: "passed",
        passed: 1,
        retry_count: 0,
        proposal_audit_id: null,
        evidence_id: `comment-${commentId}`,
        summary: "weibo-comments-analyze persisted 1 sentiment result(s) from 1 analyzed comment(s).",
        deepseek_status: null
      }
    ]);

    assert.equal(result.wrong_run_status, 404, result.wrong_run);
    assert.equal(result.wrong_run.error_type, "judge_review_source_not_found", result.wrong_run);
    assert.equal(result.cross_project_status, 404, result.cross_project);
    assert.equal(result.cross_project.error_type, "judge_review_source_not_found", result.cross_project);
    assert.deepEqual(queryRows(
      "SELECT COUNT(*) AS count FROM judge_reviews WHERE loop_run_id=%s AND project_id=%s",
      [result.loop_id, projectId]
    )[0], { count: 1 });
  }
);

test(
  "FastAPI Judge review endpoint resolves owned evidence IDs and rejects cross-project analysis IDs",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("Judge evidence cross-project fixture");
    const targetId = createTarget(projectId, "judge-evidence-target");
    const commentId = createEvidenceComment(projectId, "judge-evidence-comment");
    const postId = queryRows("SELECT post_id FROM social_comments WHERE id=%s AND project_id=%s", [commentId, projectId])[0].post_id;
    const analysisId = createSentimentResult(commentId, "judge-evidence-analysis");
    const eventId = createEvent(projectId, "judge-evidence-event");
    const actionId = createAction(projectId, "judge-evidence-action");
    const memoryId = createMemory(projectId, "judge-evidence-memory");
    const knowledgeCardId = createKnowledgeCard("judge:evidence:knowledge-card");
    const otherCommentId = createEvidenceComment(otherProjectId, "judge-evidence-other-comment");
    const otherAnalysisId = createSentimentResult(otherCommentId, "judge-evidence-other-analysis");

    const result = runPythonSnippet(`
import json
import os
from app.main import create_app
from fastapi.testclient import TestClient
from workers import enterprise_worker as worker

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="strategy",
    input_json={"source": "judge-evidence-resolver-test"},
)
proposal_audit = worker.record_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="CrewAI Proposal Harness",
    step_name="crewai_proposal_audit",
    status="succeeded",
    output_json={"proposal": {"summary": "candidate"}},
    evidence_ids=[],
)
strategy_step = worker.record_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Strategy Agent",
    step_name="strategy_review",
    status="succeeded",
    output_json={"draft": "candidate"},
    evidence_ids=[],
)
client = TestClient(create_app())
passing_response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/judge/reviews",
    json={
        "projectId": project_id,
        "proposalAuditId": proposal_audit["id"],
        "stepRunId": strategy_step["id"],
        "maxAttempts": 1,
        "fixtureOutputs": [{
            "output": {
                "summary": "all evidence belongs to this project",
                "evidence_ids": [
                    f"target-{os.environ['TARGET_ID']}",
                    f"post-{os.environ['POST_ID']}",
                    f"comment-{os.environ['COMMENT_ID']}",
                    f"analysis-{os.environ['ANALYSIS_ID']}",
                    f"event-{os.environ['EVENT_ID']}",
                    f"action-{os.environ['ACTION_ID']}",
                    f"memory-{os.environ['MEMORY_ID']}",
                ],
                "knowledge_references": [f"knowledge-card-{os.environ['KNOWLEDGE_CARD_ID']}"],
            }
        }],
    },
)
cross_response = client.post(
    f"/api/weibo/agent-runs/{loop['id']}/judge/reviews",
    json={
        "projectId": project_id,
        "proposalAuditId": proposal_audit["id"],
        "stepRunId": strategy_step["id"],
        "maxAttempts": 1,
        "fixtureOutputs": [{
            "output": {
                "summary": "analysis belongs to another project",
                "evidence_ids": [f"analysis-{os.environ['OTHER_ANALYSIS_ID']}"],
            }
        }],
    },
)
print(json.dumps({
    "loop_id": loop["id"],
    "passing": passing_response.json(),
    "passing_status": passing_response.status_code,
    "cross": cross_response.json(),
    "cross_status": cross_response.status_code,
}, ensure_ascii=False, default=str))
`, {
      PROJECT_ID: String(projectId),
      TARGET_ID: String(targetId),
      POST_ID: String(postId),
      COMMENT_ID: String(commentId),
      ANALYSIS_ID: String(analysisId),
      EVENT_ID: String(eventId),
      ACTION_ID: String(actionId),
      MEMORY_ID: String(memoryId),
      KNOWLEDGE_CARD_ID: String(knowledgeCardId),
      OTHER_ANALYSIS_ID: String(otherAnalysisId)
    });

    assert.equal(result.passing_status, 200, result.passing);
    assert.equal(result.passing.review.status, "passed", result.passing);
    assert.deepEqual(result.passing.review.evidence_errors, [], result.passing);
    assert.equal(result.passing.review.feedback_json.knowledge_references[0], `knowledge-card-${knowledgeCardId}`, result.passing);
    assert.equal(result.cross_status, 200, result.cross);
    assert.equal(result.cross.review.status, "failed", result.cross);
    assert.equal(result.cross.review.passed, false, result.cross);
    assert.deepEqual(result.cross.review.evidence_errors, [{
      error_type: "evidence_not_found",
      evidence_id: `analysis-${otherAnalysisId}`,
      message: "Evidence ID does not exist in the requested project."
    }], result.cross);
    assert.deepEqual(queryRows(
      "SELECT status, passed, JSON_LENGTH(evidence_errors) AS evidence_error_count FROM judge_reviews WHERE loop_run_id=%s AND project_id=%s ORDER BY id",
      [result.loop_id, projectId]
    ), [
      { status: "passed", passed: 1, evidence_error_count: 0 },
      { status: "failed", passed: 0, evidence_error_count: 1 }
    ]);
  }
);

test(
  "protects Agent Harness terminal loop state and rejects passed Judge reviews with evidence errors",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const result = runPythonSnippet(`
import json
import os
from workers import enterprise_worker as worker

project_id = int(os.environ["PROJECT_ID"])
loop = worker.create_agent_loop_run(
    project_id=project_id,
    trigger_mode="manual",
    current_step="judge_review",
    input_json={"slice": "terminal-protection"},
)
failed_step = worker.fail_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Strategy Agent",
    step_name="strategy_review",
    output_json={"draft": "too vague"},
    evidence_ids=[],
    error_type="judge_failed",
    error_message="missing evidence",
)
late_success = worker.succeed_agent_step_run(
    loop_run_id=loop["id"],
    project_id=project_id,
    agent_name="Strategy Agent",
    step_name="strategy_review",
    output_json={"draft": "late success"},
    evidence_ids=["comment-1"],
    step_run_id=failed_step["id"],
)
try:
    worker.record_judge_review(
        loop_run_id=loop["id"],
        step_run_id=failed_step["id"],
        project_id=project_id,
        judge_agent_name="Judge Agent",
        status="passed",
        passed=True,
        evidence_errors=["missing-comment-99"],
    )
    invalid_review_error = None
except ValueError as exc:
    invalid_review_error = str(exc)
try:
    worker.fail_agent_step_run(
        loop_run_id=loop["id"],
        project_id=project_id,
        agent_name="Strategy Agent",
        step_name="missing_step",
        step_run_id=999999,
        error_type="missing_step",
        error_message="should not mutate loop",
    )
    missing_step_error = None
except ValueError as exc:
    missing_step_error = str(exc)
try:
    worker.record_judge_review(
        loop_run_id=loop["id"],
        step_run_id=failed_step["id"],
        project_id=project_id,
        judge_agent_name="Judge Agent",
        status="passed",
        passed=False,
    )
    contradictory_review_error = None
except ValueError as exc:
    contradictory_review_error = str(exc)
needs_human_review = worker.record_judge_review(
    loop_run_id=loop["id"],
    step_run_id=failed_step["id"],
    project_id=project_id,
    judge_agent_name="Judge Agent",
    status="needs_human",
    passed=False,
    evidence_errors=["missing-comment-99"],
)
print(json.dumps({
    "loop_id": loop["id"],
    "step_id": failed_step["id"],
    "late_success_status": late_success["status"],
    "invalid_review_error": invalid_review_error,
    "missing_step_error": missing_step_error,
    "contradictory_review_error": contradictory_review_error,
    "needs_human_review": needs_human_review,
}, ensure_ascii=False, default=str))
`, { PROJECT_ID: String(projectId) });

    assert.match(result.invalid_review_error, /evidence_errors/);
    assert.match(result.missing_step_error, /step_run_id/);
    assert.match(result.contradictory_review_error, /passed/);
    assert.equal(result.late_success_status, "failed");
    assert.equal(result.needs_human_review.status, "needs_human");

    assert.deepEqual(queryRows(
      "SELECT status, current_step, error_type, error_message, finished_at IS NOT NULL AS has_finished_at FROM agent_loop_runs WHERE id=%s",
      [result.loop_id]
    )[0], {
      status: "failed",
      current_step: "strategy_review",
      error_type: "judge_failed",
      error_message: "missing evidence",
      has_finished_at: 1
    });
    assert.deepEqual(queryRows(
      "SELECT status, error_type, error_message FROM agent_step_runs WHERE id=%s",
      [result.step_id]
    )[0], {
      status: "failed",
      error_type: "judge_failed",
      error_message: "missing evidence"
    });
    assert.equal(
      queryRows("SELECT COUNT(*) AS count FROM judge_reviews WHERE loop_run_id=%s", [result.loop_id])[0].count,
      1
    );
  }
);

test(
  "persists and reads Agent Harness worker-only command payloads",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const created = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({
        projectId,
        triggerMode: "manual",
        targetId: 88,
        currentStep: "comment_analysis",
        input: { requested_by: "worker-command-test" }
      })
    ]);
    assert.equal(created.ok, true);
    assert.equal(created.run.project_id, projectId);
    assert.equal(created.run.platform, "weibo");
    assert.equal(created.run.trigger_mode, "manual");
    assert.equal(created.run.status, "running");
    assert.equal(created.request.projectId, projectId);

    const started = runWorker([
      "weibo-agent-loop-step",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: created.run.id,
        agentName: "Issue Analysis Agent",
        stepName: "comment_analysis",
        status: "running",
        input: { comment_ids: [1, 2] }
      })
    ]);
    assert.equal(started.ok, true);
    assert.equal(started.step.status, "running");

    const succeeded = runWorker([
      "weibo-agent-loop-step",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: created.run.id,
        stepRunId: started.step.id,
        agentName: "Issue Analysis Agent",
        stepName: "comment_analysis",
        status: "succeeded",
        output: { summary: "done" },
        evidenceIds: ["comment-1"]
      })
    ]);
    assert.equal(succeeded.ok, true);
    assert.equal(succeeded.step.status, "succeeded");

    const review = runWorker([
      "weibo-agent-loop-judge-review",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: created.run.id,
        stepRunId: succeeded.step.id,
        judgeAgentName: "Judge Agent",
        status: "passed",
        passed: true,
        score: 0.95,
        feedback: { verdict: "ok" },
        requiredChanges: [],
        evidenceErrors: []
      })
    ]);
    assert.equal(review.ok, true);
    assert.equal(review.review.status, "passed");

    const handoff = runWorker([
      "weibo-agent-loop-handoff",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "step",
        sourceId: succeeded.step.id,
        feedbackType: "manual_handoff",
        note: "producer should confirm",
        status: "open",
        createdBy: "agent_harness"
      })
    ]);
    assert.equal(handoff.ok, true);
    assert.equal(handoff.feedback.status, "open");

    const status = runWorker([
      "weibo-agent-loop-status",
      "--payload-json",
      JSON.stringify({ projectId, loopRunId: created.run.id })
    ]);
    assert.equal(status.ok, true);
    assert.equal(status.run.id, created.run.id);
    assert.equal(status.steps.length, 1);
    assert.equal(status.steps[0].status, "succeeded");
    assert.equal(status.judgeReviews.length, 1);
    assert.equal(status.feedbackItems.length, 1);

    const invalidProject = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId: 999999, triggerMode: "manual", input: {} })
    ]);
    assert.equal(invalidProject.ok, false);
    assert.equal(invalidProject.error_type, "project_not_found");
  }
);

test(
  "persists loop step and judge review feedback as ledger-only records",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("cross-project-agent-loop-feedback");

    const run = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual", currentStep: "comment_analysis", input: { source: "feedback-test" } })
    ]);
    assert.equal(run.ok, true);
    const step = runWorker([
      "weibo-agent-loop-step",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: run.run.id,
        agentName: "Issue Analysis Agent",
        stepName: "comment_analysis",
        status: "succeeded",
        output: { summary: "ready for feedback" },
        evidenceIds: ["comment-1"]
      })
    ]);
    assert.equal(step.ok, true);
    const review = runWorker([
      "weibo-agent-loop-judge-review",
      "--payload-json",
      JSON.stringify({
        projectId,
        loopRunId: run.run.id,
        stepRunId: step.step.id,
        judgeAgentName: "Judge Agent",
        status: "passed",
        passed: true,
        score: 0.93,
        feedback: { verdict: "ok" },
        requiredChanges: [],
        evidenceErrors: []
      })
    ]);
    assert.equal(review.ok, true);
    const loopStateBeforeFeedback = queryRows("SELECT status, current_step FROM agent_loop_runs WHERE id=%s", [run.run.id])[0];
    const stepStatusBeforeFeedback = queryRows("SELECT status FROM agent_step_runs WHERE id=%s", [step.step.id])[0].status;
    const reviewStatusBeforeFeedback = queryRows("SELECT status FROM judge_reviews WHERE id=%s", [review.review.id])[0].status;

    const loopFeedback = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "loop",
        sourceId: run.run.id,
        feedbackType: "manual_handoff_note",
        note: "人工备注 loop。",
        status: "in_review",
        createdBy: "operator-test"
      })
    ]);
    const stepFeedback = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "step",
        sourceId: step.step.id,
        feedbackType: "manual_handoff_resolved",
        note: "人工确认 step 已处理。",
        status: "resolved",
        createdBy: "operator-test"
      })
    ]);
    const judgeFeedback = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "judge_review",
        sourceId: review.review.id,
        feedbackType: "manual_handoff_note",
        note: "人工补充 Judge 复核备注。",
        createdBy: "operator-test"
      })
    ]);

    assert.equal(loopFeedback.ok, true);
    assert.equal(stepFeedback.ok, true);
    assert.equal(judgeFeedback.ok, true);
    assert.equal(loopFeedback.memory, null);
    assert.equal(stepFeedback.memory, null);
    assert.equal(judgeFeedback.memory, null);
    assert.deepEqual(
      queryRows("SELECT source_type, source_id, feedback_type, note, status, created_by FROM feedback_items WHERE project_id=%s ORDER BY id", [projectId]),
      [
        {
          source_type: "loop",
          source_id: run.run.id,
          feedback_type: "manual_handoff_note",
          note: "人工备注 loop。",
          status: "in_review",
          created_by: "operator-test"
        },
        {
          source_type: "step",
          source_id: step.step.id,
          feedback_type: "manual_handoff_resolved",
          note: "人工确认 step 已处理。",
          status: "resolved",
          created_by: "operator-test"
        },
        {
          source_type: "judge_review",
          source_id: review.review.id,
          feedback_type: "manual_handoff_note",
          note: "人工补充 Judge 复核备注。",
          status: "open",
          created_by: "operator-test"
        }
      ]
    );
    assert.deepEqual(queryRows("SELECT status, current_step FROM agent_loop_runs WHERE id=%s", [run.run.id])[0], loopStateBeforeFeedback);
    assert.equal(queryRows("SELECT status FROM agent_step_runs WHERE id=%s", [step.step.id])[0].status, stepStatusBeforeFeedback);
    assert.equal(queryRows("SELECT status FROM judge_reviews WHERE id=%s", [review.review.id])[0].status, reviewStatusBeforeFeedback);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s", [projectId])[0].count, 0);

    const otherRun = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId: otherProjectId, triggerMode: "manual", input: {} })
    ]);
    const otherStep = runWorker([
      "weibo-agent-loop-step",
      "--payload-json",
      JSON.stringify({ projectId: otherProjectId, loopRunId: otherRun.run.id, agentName: "Other", stepName: "other_step", status: "running" })
    ]);
    const otherReview = runWorker([
      "weibo-agent-loop-judge-review",
      "--payload-json",
      JSON.stringify({
        projectId: otherProjectId,
        loopRunId: otherRun.run.id,
        stepRunId: otherStep.step.id,
        judgeAgentName: "Other Judge",
        status: "needs_human",
        passed: false,
        requiredChanges: ["人工处理"],
        evidenceErrors: []
      })
    ]);

    for (const item of [
      { sourceType: "loop", sourceId: otherRun.run.id, feedbackType: "manual_handoff_note", errorType: "loop_not_found" },
      { sourceType: "step", sourceId: otherStep.step.id, feedbackType: "manual_handoff_note", errorType: "step_not_found" },
      { sourceType: "judge_review", sourceId: otherReview.review.id, feedbackType: "manual_handoff_note", errorType: "judge_review_not_found" }
    ]) {
      const crossProject = runWorker([
        "weibo-feedback",
        "--payload-json",
        JSON.stringify({ projectId, ...item, note: "不应跨项目写入。" })
      ]);
      assert.equal(crossProject.ok, false);
      assert.equal(crossProject.error_type, item.errorType);
    }
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE project_id=%s", [projectId])[0].count, 3);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE project_id=%s", [otherProjectId])[0].count, 0);
  }
);

test(
  "runs feedback memory loop schema migration twice with OpenSpec-compatible enums",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["migrate"]).ok, true);

    const feedbackSourceType = columnType("feedback_items", "source_type");
    const feedbackType = columnType("feedback_items", "feedback_type");
    const eventStatus = columnType("artist_public_opinion_events", "status");
    const accountSourceType = columnType("source_accounts", "source_type");
    const memorySourceKind = columnType("bot_memory_items", "source_kind");

    assert.deepEqual(enumValues(feedbackSourceType), [
      "loop",
      "step",
      "judge_review",
      "event",
      "action",
      "account",
      "preference",
      "knowledge",
      "rule",
      "other",
      "source_account"
    ]);
    assert.deepEqual(enumValues(feedbackType), [
      "manual_handoff",
      "needs_human",
      "confirmed",
      "rejected",
      "modified",
      "comment",
      "preference",
      "other",
      "event_confirmed",
      "event_rejected",
      "event_observation_only",
      "event_note",
      "action_confirmed",
      "action_rejected",
      "action_partially_executed",
      "action_not_executed",
      "action_note",
      "source_type_corrected",
      "preference_added",
      "preference_updated",
      "manual_handoff_resolved",
      "manual_handoff_note"
    ]);
    assert.deepEqual(enumValues(eventStatus), [
      "observing",
      "escalating",
      "stable",
      "resolved",
      "archived",
      "confirmed",
      "rejected"
    ]);
    assert.deepEqual(enumValues(accountSourceType), [
      "official",
      "artist",
      "producer",
      "marketing",
      "suspected_matrix",
      "media",
      "fan",
      "organic",
      "unknown"
    ]);
    assert.deepEqual(enumValues(memorySourceKind), [
      "target",
      "comment",
      "analysis",
      "event",
      "action",
      "backtest",
      "report",
      "preference",
      "conversation",
      "source_account"
    ]);
  }
);

test(
  "runs knowledge card RAG schema migration twice and creates source/card tables",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["migrate"]).ok, true);

    const tables = queryRows(
      "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('knowledge_sources','knowledge_cards') ORDER BY TABLE_NAME"
    ).map((row) => row.table_name);
    assert.deepEqual(tables, ["knowledge_cards", "knowledge_sources"]);

    const sourceColumns = queryRows(
      "SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='knowledge_sources'"
    ).map((row) => row.column_name);
    for (const column of ["source_identity", "title", "source_type", "reliability_level", "citation_url", "publisher", "published_at", "notes", "raw_json"]) {
      assert.equal(sourceColumns.includes(column), true, `knowledge_sources.${column} should exist`);
    }

    const cardColumns = queryRows(
      "SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='knowledge_cards'"
    ).map((row) => row.column_name);
    for (const column of [
      "card_identity",
      "source_id",
      "framework_or_case",
      "applicable_scenario",
      "do_not_apply_when",
      "recommended_actions",
      "risk_warnings",
      "evidence_required",
      "judge_questions",
      "tags",
      "status",
      "raw_json"
    ]) {
      assert.equal(cardColumns.includes(column), true, `knowledge_cards.${column} should exist`);
    }

    const sourceUnique = queryRows("SHOW INDEX FROM knowledge_sources WHERE Key_name='uniq_knowledge_source_identity'");
    const cardUnique = queryRows("SHOW INDEX FROM knowledge_cards WHERE Key_name='uniq_knowledge_card_identity'");
    assert.equal(sourceUnique.length, 1);
    assert.equal(cardUnique.length, 1);
    assert.equal(sourceUnique[0].Non_unique, 0);
    assert.equal(cardUnique[0].Non_unique, 0);
  }
);

test(
  "seeds validated knowledge cards idempotently without long-form source text",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const invalid = runWorker([
      "weibo-knowledge-seed",
      "--payload-json",
      JSON.stringify({
        sources: [
          {
            sourceIdentity: "test:missing-url",
            title: "Missing URL source",
            sourceType: "award_case",
            reliabilityLevel: "B"
          }
        ],
        cards: [
          {
            cardIdentity: "test:missing-judge",
            sourceIdentity: "test:missing-url",
            frameworkOrCase: "Invalid card",
            applicableScenario: "测试适用条件",
            doNotApplyWhen: "测试禁用条件",
            recommendedActions: ["不要写入"],
            riskWarnings: ["缺少 URL 和 Judge questions"],
            evidenceRequired: ["真实证据"]
          }
        ]
      })
    ]);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error_type, "invalid_knowledge_source");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM knowledge_sources")[0].count, 0);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM knowledge_cards")[0].count, 0);

    const validSource = {
      sourceIdentity: "test:valid-source",
      title: "Valid source for invalid card cases",
      sourceType: "award_case",
      reliabilityLevel: "B",
      citationUrl: "https://example.com/valid-source"
    };
    const validCard = {
      cardIdentity: "test:invalid-card",
      sourceIdentity: validSource.sourceIdentity,
      frameworkOrCase: "Invalid card variants",
      applicableScenario: "测试适用条件",
      doNotApplyWhen: "测试禁用条件",
      recommendedActions: ["不要写入"],
      riskWarnings: ["缺少必填字段"],
      evidenceRequired: ["真实证据"],
      judgeQuestions: ["是否应该拒绝？"],
      tags: ["test"]
    };
    for (const missingField of [
      "applicableScenario",
      "doNotApplyWhen",
      "evidenceRequired",
      "judgeQuestions"
    ]) {
      const card = { ...validCard, cardIdentity: `test:missing-${missingField}` };
      delete card[missingField];
      const invalidCard = runWorker([
        "weibo-knowledge-seed",
        "--payload-json",
        JSON.stringify({ sources: [validSource], cards: [card] })
      ]);
      assert.equal(invalidCard.ok, false, `${missingField} should reject the card`);
      assert.equal(invalidCard.error_type, "invalid_knowledge_card");
      assert.equal(queryRows("SELECT COUNT(*) AS count FROM knowledge_sources")[0].count, 0);
      assert.equal(queryRows("SELECT COUNT(*) AS count FROM knowledge_cards")[0].count, 0);
    }

    const seeded = runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]);
    assert.equal(seeded.ok, true);
    assert.equal(seeded.seeded.sources >= 3, true);
    assert.equal(seeded.seeded.sources <= 5, true);
    assert.equal(seeded.seeded.cards >= 3, true);
    assert.equal(seeded.seeded.cards <= 5, true);

    const cards = queryRows(
      `
      SELECT
        c.card_identity,
        s.source_identity,
        s.citation_url,
        s.reliability_level,
        JSON_LENGTH(c.recommended_actions) AS recommended_action_count,
        JSON_LENGTH(c.risk_warnings) AS risk_warning_count,
        JSON_LENGTH(c.evidence_required) AS evidence_required_count,
        JSON_LENGTH(c.judge_questions) AS judge_question_count,
        CHAR_LENGTH(COALESCE(c.raw_json, JSON_OBJECT())) AS raw_length
      FROM knowledge_cards c
      JOIN knowledge_sources s ON s.id=c.source_id
      ORDER BY c.card_identity
      `
    );
    assert.equal(cards.length, seeded.seeded.cards);
    for (const card of cards) {
      assert.match(card.citation_url, /^https?:\/\//);
      assert.equal(["A", "B", "C"].includes(card.reliability_level), true);
      assert.equal(card.recommended_action_count > 0, true);
      assert.equal(card.risk_warning_count > 0, true);
      assert.equal(card.evidence_required_count > 0, true);
      assert.equal(card.judge_question_count > 0, true);
      assert.equal(card.raw_length < 2000, true, `${card.card_identity} raw_json should remain a short structured summary`);
    }

    const repeated = runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]);
    assert.equal(repeated.ok, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM knowledge_sources")[0].count, seeded.seeded.sources);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM knowledge_cards")[0].count, seeded.seeded.cards);
  }
);

test(
  "retrieves active knowledge cards with match reasons, blocked markers, and C-level weak inspiration",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);

    const amplification = runWorker([
      "weibo-knowledge-search",
      "--payload-json",
      JSON.stringify({
        platform: "weibo",
        topics: ["生活方式", "视觉符号"],
        risks: [],
        actionType: "weibo-amplification",
        query: "生活方式 earned media 放大"
      })
    ]);
    assert.equal(amplification.ok, true);
    assert.equal(amplification.command, "weibo-knowledge-search");
    assert.equal(amplification.results.length >= 1, true);
    assert.equal(amplification.results[0].card_identity, "case:barbie:earned-media-lifestyle-symbol");
    assert.equal(amplification.results[0].reliability_level, "B");
    assert.equal(amplification.results[0].blocked_by_do_not_apply, false);
    assert.equal(amplification.results[0].hard_rule_allowed, true);
    assert.equal(amplification.results[0].match_reasons.length > 0, true);
    assert.equal(amplification.results[0].match_reasons.some((reason) => reason.startsWith("platform:weibo")), true);
    assert.equal(amplification.results[0].match_reasons.some((reason) => reason.startsWith("topic:生活方式")), true);
    assert.equal(amplification.results[0].match_reasons.some((reason) => reason.startsWith("action_type:weibo-amplification")), true);
    assert.equal(amplification.results[0].match_reasons.some((reason) => reason.startsWith("query:earned")), true);
    assert.equal(Array.isArray(amplification.results[0].tags), true);
    assert.match(amplification.results[0].citation_url, /^https?:\/\//);
    assert.equal(typeof amplification.results[0].applicable_scenario, "string");
    assert.equal(typeof amplification.results[0].do_not_apply_when, "string");

    const crisis = runWorker([
      "weibo-knowledge-search",
      "--payload-json",
      JSON.stringify({
        platform: "weibo",
        topics: ["生活方式"],
        risks: ["艺人危机", "事实争议"],
        actionType: "amplify_positive_discussion",
        query: "生活方式 放大 事实争议"
      })
    ]);
    const blockedBarbie = crisis.results.find((item) => item.card_identity === "case:barbie:earned-media-lifestyle-symbol");
    assert.equal(Boolean(blockedBarbie), true);
    assert.equal(blockedBarbie.blocked_by_do_not_apply, true);
    assert.equal(blockedBarbie.match_reasons.some((reason) => reason.startsWith("risk_blocked:事实争议")), true);
    assert.equal(blockedBarbie.citation_role, "blocked_by_do_not_apply");
    assert.equal(blockedBarbie.hard_rule_allowed, false);

    const broad = runWorker([
      "weibo-knowledge-search",
      "--payload-json",
      JSON.stringify({
        platform: "weibo",
        query: "weibo"
      })
    ]);
    assert.equal(broad.ok, true);
    const cLevelIndex = broad.results.findIndex((item) => item.reliability_level === "C");
    const bLevelIndex = broad.results.findIndex((item) => item.reliability_level === "B");
    assert.equal(cLevelIndex > -1, true);
    assert.equal(bLevelIndex > -1, true);
    assert.equal(cLevelIndex > bLevelIndex, true, "C-level sources should rank below B-level sources for broad matches");
    const cLevel = broad.results[cLevelIndex];
    assert.equal(cLevel.citation_role, "weak_inspiration");
    assert.equal(cLevel.hard_rule_allowed, false);

    const unrelated = runWorker([
      "weibo-knowledge-search",
      "--payload-json",
      JSON.stringify({
        platform: "weibo",
        query: "totally unrelated pastry supply chain"
      })
    ]);
    assert.equal(unrelated.ok, true);
    assert.equal(unrelated.results.length, 0);

    const empty = runWorker([
      "weibo-knowledge-search",
      "--payload-json",
      JSON.stringify({})
    ]);
    assert.equal(empty.ok, true);
    assert.equal(empty.results.length, 0);
  }
);

test(
  "validates knowledge card applicability with Judge questions, blocked conditions, C-level boundaries, and evidence checks",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const evidenceCommentId = createEvidenceComment(projectId, "knowledge-validator-real-evidence");
    const evidenceEventId = createEvent(projectId, "knowledge-validator-event-evidence");
    const evidenceActionId = createAction(projectId, "knowledge-validator-action-evidence");
    const evidenceMemoryId = createMemory(projectId, "knowledge-validator-memory-evidence");
    const otherProjectId = createProject("knowledge-validator-cross-project");
    const crossProjectCommentId = createEvidenceComment(otherProjectId, "knowledge-validator-cross-project-evidence");

    const applicable = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        topics: ["生活方式", "视觉符号"],
        actionType: "weibo-amplification",
        query: "earned media 生活方式 放大",
        evidenceIds: [`comment-${evidenceCommentId}`]
      })
    ]);
    assert.equal(applicable.ok, true);
    assert.equal(applicable.command, "weibo-knowledge-validate");
    assert.equal(applicable.results.length, 1);
    assert.equal(applicable.results[0].passed, true);
    assert.equal(applicable.results[0].citation_role, "supporting_reference");
    assert.equal(applicable.results[0].hard_rule_allowed, true);
    assert.equal(applicable.results[0].judge_questions.length > 0, true);
    assert.equal(applicable.results[0].match_reasons.some((reason) => reason.startsWith("topic:生活方式")), true);

    const blocked = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        topics: ["生活方式"],
        risks: ["事实争议"],
        actionType: "weibo-amplification",
        query: "生活方式 事实争议 放大",
        evidenceIds: [`comment-${evidenceCommentId}`]
      })
    ]);
    assert.equal(blocked.ok, true);
    assert.equal(blocked.results[0].passed, false);
    assert.equal(blocked.results[0].status, "rejected");
    assert.equal(blocked.results[0].citation_role, "blocked_by_do_not_apply");
    assert.equal(blocked.results[0].hard_rule_allowed, false);
    assert.equal(blocked.results[0].failure_reasons.includes("blocked_by_do_not_apply"), true);

    const weak = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["framework:scct:risk-response-fit"],
        platform: "weibo",
        topics: ["危机回应"],
        risks: ["事实争议"],
        actionType: "risk-response",
        query: "危机回应 责任归因 事实争议",
        evidenceIds: [`comment-${evidenceCommentId}`]
      })
    ]);
    assert.equal(weak.ok, true);
    assert.equal(weak.results[0].passed, true);
    assert.equal(weak.results[0].citation_role, "weak_inspiration");
    assert.equal(weak.results[0].hard_rule_allowed, false);
    assert.equal(weak.results[0].failure_reasons.length, 0);

    const noEvidence = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        topics: ["生活方式"],
        actionType: "weibo-amplification",
        query: "生活方式 放大",
        evidenceIds: [],
        requireEvidence: true
      })
    ]);
    assert.equal(noEvidence.ok, true);
    assert.equal(noEvidence.results[0].passed, false);
    assert.equal(noEvidence.results[0].status, "needs_evidence");
    assert.equal(noEvidence.results[0].failure_reasons.includes("evidence_insufficient"), true);

    const fakeEvidence = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        topics: ["生活方式"],
        actionType: "weibo-amplification",
        query: "生活方式 放大",
        evidenceIds: ["comment-999999999"]
      })
    ]);
    assert.equal(fakeEvidence.ok, true);
    assert.equal(fakeEvidence.results[0].passed, false);
    assert.equal(fakeEvidence.results[0].status, "needs_evidence");
    assert.equal(fakeEvidence.results[0].failure_reasons.includes("evidence_not_found"), true);

    const missingProject = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        topics: ["生活方式"],
        actionType: "weibo-amplification",
        query: "生活方式 放大",
        evidenceIds: [`comment-${evidenceCommentId}`]
      })
    ]);
    assert.equal(missingProject.ok, true);
    assert.equal(missingProject.results[0].passed, false);
    assert.equal(missingProject.results[0].status, "needs_evidence");
    assert.equal(missingProject.results[0].failure_reasons.includes("evidence_project_required"), true);

    const crossProjectEvidence = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        topics: ["生活方式"],
        actionType: "weibo-amplification",
        query: "生活方式 放大",
        evidenceIds: [`comment-${crossProjectCommentId}`]
      })
    ]);
    assert.equal(crossProjectEvidence.ok, true);
    assert.equal(crossProjectEvidence.results[0].passed, false);
    assert.equal(crossProjectEvidence.results[0].status, "needs_evidence");
    assert.equal(crossProjectEvidence.results[0].failure_reasons.includes("evidence_not_found"), true);

    const multiEvidence = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        topics: ["生活方式"],
        actionType: "weibo-amplification",
        query: "生活方式 放大",
        evidenceIds: [
          `comment-${evidenceCommentId}`,
          `event-${evidenceEventId}`,
          `action-${evidenceActionId}`,
          `memory-${evidenceMemoryId}`
        ]
      })
    ]);
    assert.equal(multiEvidence.ok, true);
    assert.equal(multiEvidence.results[0].passed, true);
    assert.equal(multiEvidence.results[0].evidence_check.status, "ok");
    assert.deepEqual(
      multiEvidence.results[0].evidence_check.found.sort(),
      [
        `action-${evidenceActionId}`,
        `comment-${evidenceCommentId}`,
        `event-${evidenceEventId}`,
        `memory-${evidenceMemoryId}`
      ].sort()
    );

    const actionTextOnly = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIdentities: ["case:barbie:earned-media-lifestyle-symbol"],
        platform: "weibo",
        query: "轻量物料",
        evidenceIds: [`comment-${evidenceCommentId}`]
      })
    ]);
    assert.equal(actionTextOnly.ok, true);
    assert.equal(actionTextOnly.results[0].passed, false);
    assert.equal(actionTextOnly.results[0].status, "no_match");
    assert.equal(actionTextOnly.results[0].failure_reasons.includes("applicable_context_not_matched"), true);

    const inactiveCardId = queryRows("SELECT id FROM knowledge_cards WHERE card_identity='framework:aisas:social-sharing-path'")[0].id;
    queryRows("UPDATE knowledge_cards SET status='inactive' WHERE id=%s", [inactiveCardId]);
    const missingAndInactive = runWorker([
      "weibo-knowledge-validate",
      "--payload-json",
      JSON.stringify({
        projectId,
        cardIds: [999999999, inactiveCardId],
        platform: "weibo",
        query: "weibo",
        evidenceIds: [`comment-${evidenceCommentId}`]
      })
    ]);
    assert.equal(missingAndInactive.ok, true);
    assert.equal(missingAndInactive.results.length, 2);
    assert.equal(missingAndInactive.results.some((item) => item.status === "not_found" && item.card_id === 999999999), true);
    const inactiveResult = missingAndInactive.results.find((item) => item.status === "inactive" && item.card_id === inactiveCardId);
    assert.equal(Boolean(inactiveResult), true);
    assert.equal(inactiveResult.hard_rule_allowed, false);
    assert.notEqual(inactiveResult.citation_role, "supporting_reference");
  }
);

test(
  "writes applicable knowledge card citations into Weibo action recommendations while preserving real evidence",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const commentId = createEvidenceComment(projectId, "knowledge-action-real-comment");
    createKnowledgeActionEvent(projectId, "knowledge-action-event", [commentId]);
    const barbieCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='case:barbie:earned-media-lifestyle-symbol'"
    )[0].id;

    const builtActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(builtActions.ok, true);
    assert.equal(builtActions.persisted_actions, 1);
    assert.equal(builtActions.actions[0].evidence_ids.includes(commentId), true);
    assert.equal(builtActions.actions[0].raw_json.knowledge_card_ids.includes(barbieCardId), true);
    const barbieFit = builtActions.actions[0].raw_json.knowledge_fit.find((item) => item.card_id === barbieCardId);
    assert.equal(Boolean(barbieFit), true);
    assert.equal(barbieFit.citation_role, "supporting_reference");
    assert.equal(barbieFit.hard_rule_allowed, true);
    assert.match(builtActions.actions[0].reason, /知识卡/);

    const persisted = queryRows(
      `
      SELECT
        evidence_ids,
        raw_json
      FROM publicity_actions
      WHERE project_id=%s AND source='agent_recommended'
      ORDER BY id DESC
      LIMIT 1
      `,
      [projectId]
    )[0];
    const persistedEvidenceIds = JSON.parse(persisted.evidence_ids);
    const persistedRawJson = JSON.parse(persisted.raw_json);
    const persistedFit = persistedRawJson.raw_json.knowledge_fit.find((item) => item.card_id === barbieCardId);
    assert.equal(persistedEvidenceIds.includes(commentId), true);
    assert.equal(persistedRawJson.raw_json.knowledge_card_ids.includes(barbieCardId), true);
    assert.equal(persistedFit.citation_role, "supporting_reference");
  }
);

test(
  "keeps blocked knowledge cards out of Weibo actions and marks C-level cards as weak inspiration",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const barbieCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='case:barbie:earned-media-lifestyle-symbol'"
    )[0].id;
    const scctCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='framework:scct:risk-response-fit'"
    )[0].id;

    const blockedCommentId = createEvidenceComment(projectId, "knowledge-action-blocked-comment");
    createKnowledgeActionEvent(projectId, "knowledge-action-blocked-event", [blockedCommentId], {
      title: "生活方式视觉符号出现事实争议",
      triggerSummary: "评论一边讨论生活方式视觉符号，一边出现事实争议",
      impactAssessment: "当前舆情核心包含事实争议，不适合套用低争议生活方式放大案例",
      riskLevel: "medium",
      eventScore: 9.5
    });

    const blockedActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(blockedActions.ok, true);
    assert.equal(blockedActions.actions[0].evidence_ids.includes(blockedCommentId), true);
    assert.equal((blockedActions.actions[0].raw_json.knowledge_card_ids || []).includes(barbieCardId), false);
    assert.equal(
      (blockedActions.actions[0].raw_json.knowledge_fit || []).some((item) => item.card_id === barbieCardId),
      false
    );

    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const weakProjectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const weakCommentId = createEvidenceComment(weakProjectId, "knowledge-action-weak-comment");
    createKnowledgeActionEvent(weakProjectId, "knowledge-action-weak-event", [weakCommentId], {
      title: "危机回应需要判断责任归因",
      triggerSummary: "微博评论出现责任归因和事实争议，需要判断回应强度",
      impactAssessment: "讨论集中在事实争议与责任归因，不是普通剧情讨论或轻量玩梗",
      riskLevel: "high",
      eventScore: 12.5
    });

    const weakActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId: weakProjectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(weakActions.ok, true);
    assert.equal(weakActions.actions[0].evidence_ids.includes(weakCommentId), true);
    assert.deepEqual(weakActions.actions[0].raw_json.knowledge_card_ids, [scctCardId]);
    assert.equal(weakActions.actions[0].raw_json.knowledge_fit[0].card_id, scctCardId);
    assert.equal(weakActions.actions[0].raw_json.knowledge_fit[0].citation_role, "weak_inspiration");
    assert.equal(weakActions.actions[0].raw_json.knowledge_fit[0].hard_rule_allowed, false);
    assert.match(weakActions.actions[0].reason, /弱启发/);

    const workbench = runWorker([
      "weibo-workbench",
      "--payload-json",
      JSON.stringify({ projectId: weakProjectId })
    ]);
    assert.equal(workbench.ok, true);
    assert.equal(workbench.pendingActions.length, 1);
    const publicAction = workbench.pendingActions[0];
    assert.equal(Object.hasOwn(publicAction, "raw_json"), false);
    assert.deepEqual(publicAction.knowledgeReferences, [{
      card_id: scctCardId,
      title: "危机回应与责任感知适配",
      reliability_level: "C",
      citation_role: "weak_inspiration",
      fact_boundary: "knowledge_reference_not_observed_weibo_fact",
      applicable_scenario: "微博讨论出现责任归因、事实争议、误解扩散或需要判断回应强度时。",
      do_not_apply_when: "当前只是普通剧情讨论、演员好感讨论或轻量玩梗，不涉及责任归因。",
      citation_url: "https://en.wikipedia.org/wiki/Situational_crisis_communication_theory"
    }]);
    const publicActionText = JSON.stringify(publicAction);
    for (const forbidden of ["source_id", "source_identity", "match_reasons", "judge_questions", "raw_json", "cookie_file", "token"]) {
      assert.equal(publicActionText.includes(forbidden), false, `${forbidden} must not appear in workbench action payload`);
    }
    const publicWorkbenchText = JSON.stringify(workbench);
    for (const forbidden of ["raw_json", "target_locator", "recommendation_metadata", "content_fingerprint", "cookie_file", "config/cookies", "WEIBO_COOKIE_FILE", "token"]) {
      assert.equal(publicWorkbenchText.includes(forbidden), false, `${forbidden} must not appear in public workbench payload`);
    }
  }
);

test(
  "persists event feedback into feedback ledger, event status history, and memory in one MySQL transaction",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("cross-project-feedback-event");
    const eventId = createEvent(projectId, "event-feedback-confirmed");
    const observationEventId = createEvent(projectId, "event-feedback-observation-only");
    const otherEventId = createEvent(otherProjectId, "event-feedback-other-project");

    const confirmed = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "event",
        sourceId: eventId,
        feedbackType: "event_confirmed",
        note: "人工确认这是需要纳入复盘的真实舆情事件。",
        status: "resolved",
        createdBy: "operator-test"
      })
    ]);

    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.feedback.feedback_type, "event_confirmed");
    assert.equal(confirmed.updatedSource.type, "event");
    assert.equal(confirmed.updatedSource.status, "confirmed");
    assert.equal(confirmed.memory.source_kind, "event");

    assert.deepEqual(queryRows(
      "SELECT source_type, source_id, feedback_type, note, status, created_by FROM feedback_items WHERE id=%s",
      [confirmed.feedback.id]
    )[0], {
      source_type: "event",
      source_id: eventId,
      feedback_type: "event_confirmed",
      note: "人工确认这是需要纳入复盘的真实舆情事件。",
      status: "resolved",
      created_by: "operator-test"
    });
    assert.deepEqual(queryRows(
      "SELECT status FROM artist_public_opinion_events WHERE id=%s AND project_id=%s",
      [eventId, projectId]
    )[0], { status: "confirmed" });
    assert.deepEqual(queryRows(
      "SELECT from_status, to_status, reason FROM event_status_history WHERE event_id=%s ORDER BY id",
      [eventId]
    ), [{
      from_status: "observing",
      to_status: "confirmed",
      reason: "event_confirmed: 人工确认这是需要纳入复盘的真实舆情事件。"
    }]);
    assert.deepEqual(queryRows(
      "SELECT source_kind, source_id, memory_identity, title, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.feedback_type')) AS feedback_type FROM bot_memory_items WHERE id=%s",
      [confirmed.memory.id]
    )[0], {
      source_kind: "event",
      source_id: eventId,
      memory_identity: `feedback:event:${eventId}:event_confirmed`,
      title: "用户确认事件：测试事件 event-feedback-confirmed",
      feedback_type: "event_confirmed"
    });

    const noteOnly = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "event",
        sourceId: eventId,
        feedbackType: "event_note",
        note: "只补充观察备注，不改变事件状态。"
      })
    ]);
    assert.equal(noteOnly.ok, true);
    assert.equal(noteOnly.updatedSource.status, "confirmed");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM event_status_history WHERE event_id=%s", [eventId])[0].count, 1);

    const observationOnly = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "event",
        sourceId: observationEventId,
        feedbackType: "event_observation_only",
        note: "人工判断只作为观察线索，不升级为事件。"
      })
    ]);
    assert.equal(observationOnly.ok, true);
    assert.equal(observationOnly.updatedSource.status, "observing");
    assert.deepEqual(queryRows(
      "SELECT status FROM artist_public_opinion_events WHERE id=%s AND project_id=%s",
      [observationEventId, projectId]
    )[0], { status: "observing" });
    assert.deepEqual(queryRows(
      "SELECT from_status, to_status, reason FROM event_status_history WHERE event_id=%s ORDER BY id",
      [observationEventId]
    ), [{
      from_status: "observing",
      to_status: "observing",
      reason: "event_observation_only: 人工判断只作为观察线索，不升级为事件。"
    }]);

    const crossProject = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "event",
        sourceId: otherEventId,
        feedbackType: "event_rejected",
        note: "不应跨项目更新。"
      })
    ]);
    assert.equal(crossProject.ok, false);
    assert.equal(crossProject.error_type, "event_not_found");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE source_type='event' AND source_id=%s", [otherEventId])[0].count, 0);
    assert.equal(queryRows("SELECT status FROM artist_public_opinion_events WHERE id=%s", [otherEventId])[0].status, "observing");
  }
);

test(
  "persists action feedback into feedback ledger, action state, and memory in one MySQL transaction",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("cross-project-feedback-action");
    const actionId = createAction(projectId, "action-feedback-confirmed");
    const noteActionId = createAction(projectId, "action-feedback-note");
    const rejectedActionId = createAction(projectId, "action-feedback-rejected");
    const partialActionId = createAction(projectId, "action-feedback-partial");
    const notExecutedActionId = createAction(projectId, "action-feedback-not-executed");
    const otherActionId = createAction(otherProjectId, "action-feedback-other-project");

    const confirmed = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: actionId,
        feedbackType: "action_confirmed",
        note: "用户确认官号动作已执行，纳入后续回测窗口。",
        status: "resolved",
        effectiveAt: "2026-06-10T09:30:00Z",
        createdBy: "operator-test"
      })
    ]);

    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.feedback.feedback_type, "action_confirmed");
    assert.equal(confirmed.updatedSource.type, "action");
    assert.equal(confirmed.updatedSource.confirmation_status, "confirmed");
    assert.equal(confirmed.memory.source_kind, "action");

    assert.deepEqual(queryRows(
      "SELECT source_type, source_id, feedback_type, note, status, created_by FROM feedback_items WHERE id=%s",
      [confirmed.feedback.id]
    )[0], {
      source_type: "action",
      source_id: actionId,
      feedback_type: "action_confirmed",
      note: "用户确认官号动作已执行，纳入后续回测窗口。",
      status: "resolved",
      created_by: "operator-test"
    });
    const actionRow = queryRows(
      "SELECT confirmation_status, confirmed_at, effective_at FROM publicity_actions WHERE id=%s AND project_id=%s",
      [actionId, projectId]
    )[0];
    assert.equal(actionRow.confirmation_status, "confirmed");
    assert.notEqual(actionRow.confirmed_at, null);
    assert.match(actionRow.effective_at, /^2026-06-10 09:30:00/);
    queryRows("UPDATE publicity_actions SET confirmed_at='2026-06-10 09:31:00' WHERE id=%s", [actionId]);
    assert.deepEqual(queryRows(
      "SELECT source_kind, source_id, memory_identity, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.feedback_type')) AS feedback_type FROM bot_memory_items WHERE id=%s",
      [confirmed.memory.id]
    )[0], {
      source_kind: "action",
      source_id: actionId,
      memory_identity: `feedback:action:${actionId}:action_confirmed`,
      feedback_type: "action_confirmed"
    });

    const repeatedConfirmed = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: actionId,
        feedbackType: "action_confirmed",
        effectiveAt: "2026-06-11T10:00:00Z",
        note: "重复确认不应刷新首次确认时间。"
      })
    ]);
    assert.equal(repeatedConfirmed.ok, true);
    assert.deepEqual(queryRows(
      "SELECT confirmation_status, confirmed_at, effective_at FROM publicity_actions WHERE id=%s",
      [actionId]
    )[0], {
      confirmation_status: "confirmed",
      confirmed_at: "2026-06-10 09:31:00",
      effective_at: "2026-06-10 09:30:00"
    });

    const rejectedAfterConfirmed = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: actionId,
        feedbackType: "action_rejected",
        note: "已经确认的行动不应被后续普通反馈覆盖为 rejected。"
      })
    ]);
    assert.equal(rejectedAfterConfirmed.ok, true);
    assert.equal(rejectedAfterConfirmed.updatedSource.confirmation_status, "confirmed");
    assert.equal(queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [actionId])[0].confirmation_status, "confirmed");

    const noteOnly = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: noteActionId,
        feedbackType: "action_note",
        note: "只补充执行备注，不改变行动确认状态。"
      })
    ]);
    assert.equal(noteOnly.ok, true);
    assert.equal(noteOnly.updatedSource.confirmation_status, "pending");
    assert.equal(queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [noteActionId])[0].confirmation_status, "pending");

    const rejected = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: rejectedActionId,
        feedbackType: "action_rejected",
        note: "用户驳回这条行动建议。"
      })
    ]);
    assert.equal(rejected.ok, true);
    assert.equal(rejected.updatedSource.confirmation_status, "rejected");
    assert.equal(queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [rejectedActionId])[0].confirmation_status, "rejected");

    const partial = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: partialActionId,
        feedbackType: "action_partially_executed",
        note: "用户反馈只部分执行。"
      })
    ]);
    assert.equal(partial.ok, true);
    assert.equal(partial.updatedSource.confirmation_status, "partial");
    assert.equal(queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [partialActionId])[0].confirmation_status, "partial");

    const notExecuted = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: notExecutedActionId,
        feedbackType: "action_not_executed",
        note: "用户确认没有执行。"
      })
    ]);
    assert.equal(notExecuted.ok, true);
    assert.equal(notExecuted.updatedSource.confirmation_status, "rejected");
    assert.equal(queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [notExecutedActionId])[0].confirmation_status, "rejected");

    const invalidEffectiveAt = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: noteActionId,
        feedbackType: "action_confirmed",
        effectiveAt: "not-a-date"
      })
    ]);
    assert.equal(invalidEffectiveAt.ok, false);
    assert.equal(invalidEffectiveAt.error_type, "invalid_feedback_effective_at");
    assert.equal(queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [noteActionId])[0].confirmation_status, "pending");

    const crossProject = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: otherActionId,
        feedbackType: "action_rejected",
        note: "不应跨项目更新行动。"
      })
    ]);
    assert.equal(crossProject.ok, false);
    assert.equal(crossProject.error_type, "action_not_found");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE source_type='action' AND source_id=%s", [otherActionId])[0].count, 0);
    assert.equal(queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [otherActionId])[0].confirmation_status, "pending");

    const missingAction = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "action",
        sourceId: 999999999,
        feedbackType: "action_rejected",
        note: "不存在的行动不应写入反馈。"
      })
    ]);
    assert.equal(missingAction.ok, false);
    assert.equal(missingAction.error_type, "action_not_found");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE source_type='action' AND source_id=999999999")[0].count, 0);
  }
);

test(
  "persists source account feedback into feedback ledger, account type, and memory in one MySQL transaction",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const otherProjectId = createProject("cross-project-feedback-source-account");
    const accountId = createSourceAccount(projectId, "source-feedback-account", "unknown");
    const otherAccountId = createSourceAccount(otherProjectId, "source-feedback-other-project", "unknown");

    const corrected = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "source_account",
        sourceId: accountId,
        feedbackType: "source_type_corrected",
        sourceTypeValue: "official",
        note: "人工确认这是官方账号。",
        status: "resolved",
        createdBy: "operator-test"
      })
    ]);

    assert.equal(corrected.ok, true);
    assert.equal(corrected.feedback.feedback_type, "source_type_corrected");
    assert.equal(corrected.updatedSource.type, "source_account");
    assert.equal(corrected.updatedSource.source_type, "official");
    assert.equal(corrected.updatedSource.confirmed_by_user, true);
    assert.equal(corrected.memory.source_kind, "source_account");

    assert.deepEqual(queryRows(
      "SELECT source_type, source_id, feedback_type, note, status, created_by FROM feedback_items WHERE id=%s",
      [corrected.feedback.id]
    )[0], {
      source_type: "source_account",
      source_id: accountId,
      feedback_type: "source_type_corrected",
      note: "人工确认这是官方账号。",
      status: "resolved",
      created_by: "operator-test"
    });
    assert.deepEqual(queryRows(
      "SELECT source_type, confirmed_by_user FROM source_accounts WHERE id=%s AND project_id=%s",
      [accountId, projectId]
    )[0], {
      source_type: "official",
      confirmed_by_user: 1
    });
    assert.deepEqual(queryRows(
      "SELECT source_kind, source_id, memory_identity, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.source_type_value')) AS source_type_value FROM bot_memory_items WHERE id=%s",
      [corrected.memory.id]
    )[0], {
      source_kind: "source_account",
      source_id: accountId,
      memory_identity: `feedback:source_account:${accountId}:source_type_corrected`,
      source_type_value: "official"
    });

    const automaticDowngrade = runWorker([
      "weibo-source-account-upsert",
      "--payload-json",
      JSON.stringify({
        projectId,
        externalId: "account-source-feedback-account",
        profileUrl: "https://weibo.com/u/source-feedback-account",
        displayName: "账号 source-feedback-account",
        sourceType: "fan",
        confirmedByUser: false
      })
    ]);
    assert.equal(automaticDowngrade.ok, true);
    assert.deepEqual(queryRows(
      "SELECT source_type, confirmed_by_user FROM source_accounts WHERE id=%s",
      [accountId]
    )[0], {
      source_type: "official",
      confirmed_by_user: 1
    });

    const invalidType = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "source_account",
        sourceId: accountId,
        feedbackType: "source_type_corrected",
        sourceTypeValue: "celebrity"
      })
    ]);
    assert.equal(invalidType.ok, false);
    assert.equal(invalidType.error_type, "invalid_source_type_value");
    assert.equal(queryRows("SELECT source_type FROM source_accounts WHERE id=%s", [accountId])[0].source_type, "official");

    const crossProject = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "source_account",
        sourceId: otherAccountId,
        feedbackType: "source_type_corrected",
        sourceTypeValue: "marketing",
        note: "不应跨项目修正账号。"
      })
    ]);
    assert.equal(crossProject.ok, false);
    assert.equal(crossProject.error_type, "source_account_not_found");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE source_type='source_account' AND source_id=%s", [otherAccountId])[0].count, 0);
    assert.deepEqual(queryRows(
      "SELECT source_type, confirmed_by_user FROM source_accounts WHERE id=%s",
      [otherAccountId]
    )[0], {
      source_type: "unknown",
      confirmed_by_user: 0
    });
  }
);

test(
  "persists preference feedback into deterministic memory without duplicate preference rows",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const added = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preference: {
          preferenceId: "public-clarification-policy",
          preferenceType: "avoid_public_clarification",
          summary: "团队倾向先观察，不优先公开澄清。",
          reason: "避免把小范围争议放大。"
        },
        note: "来自宣发负责人确认。",
        status: "resolved",
        createdBy: "operator-test"
      })
    ]);

    assert.equal(added.ok, true);
    assert.equal(added.feedback.feedback_type, "preference_added");
    assert.equal(added.memory.source_kind, "preference");
    assert.equal(added.memory.memory_identity, "preference:id:public-clarification-policy");
    assert.deepEqual(queryRows(
      "SELECT source_type, source_id, feedback_type, note, status, created_by FROM feedback_items WHERE id=%s",
      [added.feedback.id]
    )[0], {
      source_type: "preference",
      source_id: null,
      feedback_type: "preference_added",
      note: "来自宣发负责人确认。",
      status: "resolved",
      created_by: "operator-test"
    });
    assert.deepEqual(queryRows(
      "SELECT source_kind, source_id, memory_identity, title, summary, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.preference_type')) AS preference_type, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.source_of_truth')) AS source_of_truth FROM bot_memory_items WHERE id=%s",
      [added.memory.id]
    )[0], {
      source_kind: "preference",
      source_id: null,
      memory_identity: "preference:id:public-clarification-policy",
      title: "用户偏好：avoid_public_clarification",
      summary: "团队倾向先观察，不优先公开澄清。",
      preference_type: "avoid_public_clarification",
      source_of_truth: "user_feedback"
    });

    const updated = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_updated",
        preferenceId: "public-clarification-policy",
        preferenceType: "avoid_public_clarification",
        summary: "团队倾向先观察，只有证据扩大时才公开澄清。"
      })
    ]);
    assert.equal(updated.ok, true);
    assert.equal(updated.memory.id, added.memory.id);
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='preference' AND memory_identity='preference:id:public-clarification-policy'",
      [projectId]
    )[0].count, 1);
    assert.equal(queryRows(
      "SELECT summary FROM bot_memory_items WHERE id=%s",
      [added.memory.id]
    )[0].summary, "团队倾向先观察，只有证据扩大时才公开澄清。");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE project_id=%s AND source_type='preference'", [projectId])[0].count, 2);

    const updatedType = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_updated",
        preferenceId: "public-clarification-policy",
        preferenceType: "evidence_first_response",
        summary: "团队改为证据优先，但仍沿用同一偏好记录。"
      })
    ]);
    assert.equal(updatedType.ok, true);
    assert.equal(updatedType.memory.id, added.memory.id);
    assert.equal(updatedType.memory.memory_identity, "preference:id:public-clarification-policy");
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='preference' AND memory_identity='preference:id:public-clarification-policy'",
      [projectId]
    )[0].count, 1);
    assert.equal(queryRows(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.preference_type')) AS preference_type FROM bot_memory_items WHERE id=%s",
      [added.memory.id]
    )[0].preference_type, "evidence_first_response");

    const hashedIdentity = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "evidence_first_response",
        summary: "所有对外回应必须先绑定可追溯证据。"
      })
    ]);
    assert.equal(hashedIdentity.ok, true);
    assert.match(hashedIdentity.memory.memory_identity, /^preference:evidence_first_response:[a-f0-9]{16}$/);

    const cjkPreferenceA = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "matrix_account_policy",
        preferenceId: "矩阵偏好甲",
        summary: "矩阵账号内容先做弱提醒。"
      })
    ]);
    const cjkPreferenceB = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "matrix_account_policy",
        preferenceId: "矩阵偏好乙",
        summary: "矩阵账号内容先做证据复核。"
      })
    ]);
    assert.equal(cjkPreferenceA.ok, true);
    assert.equal(cjkPreferenceB.ok, true);
    assert.notEqual(cjkPreferenceA.memory.memory_identity, cjkPreferenceB.memory.memory_identity);
    assert.notEqual(cjkPreferenceA.memory.id, cjkPreferenceB.memory.id);
    assert.match(cjkPreferenceA.memory.memory_identity, /^preference:id:id-[a-f0-9]{16}$/);
    assert.match(cjkPreferenceB.memory.memory_identity, /^preference:id:id-[a-f0-9]{16}$/);
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='preference' AND memory_identity IN (%s,%s)",
      [projectId, cjkPreferenceA.memory.memory_identity, cjkPreferenceB.memory.memory_identity]
    )[0].count, 2);

    const mixedCjkPreferenceA = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "mixed_policy",
        preferenceId: "甲abc",
        summary: "混合字符偏好甲。"
      })
    ]);
    const mixedCjkPreferenceB = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "mixed_policy",
        preferenceId: "乙abc",
        summary: "混合字符偏好乙。"
      })
    ]);
    const symbolPreferenceA = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "symbol_policy",
        preferenceId: "a/b",
        summary: "斜杠偏好。"
      })
    ]);
    const symbolPreferenceB = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "symbol_policy",
        preferenceId: "a b",
        summary: "空格偏好。"
      })
    ]);
    assert.equal(mixedCjkPreferenceA.ok, true);
    assert.equal(mixedCjkPreferenceB.ok, true);
    assert.equal(symbolPreferenceA.ok, true);
    assert.equal(symbolPreferenceB.ok, true);
    assert.notEqual(mixedCjkPreferenceA.memory.memory_identity, mixedCjkPreferenceB.memory.memory_identity);
    assert.notEqual(symbolPreferenceA.memory.memory_identity, symbolPreferenceB.memory.memory_identity);
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='preference' AND memory_identity IN (%s,%s,%s,%s)",
      [
        projectId,
        mixedCjkPreferenceA.memory.memory_identity,
        mixedCjkPreferenceB.memory.memory_identity,
        symbolPreferenceA.memory.memory_identity,
        symbolPreferenceB.memory.memory_identity
      ]
    )[0].count, 4);

    const longPreferenceType = `long_${"a".repeat(420)}`;
    const longPreferenceA = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: longPreferenceType,
        preferenceId: "long-type-a",
        summary: "超长偏好类型的第一条偏好。"
      })
    ]);
    const longPreferenceB = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: longPreferenceType,
        preferenceId: "long-type-b",
        summary: "超长偏好类型的第二条偏好。"
      })
    ]);
    assert.equal(longPreferenceA.ok, true);
    assert.equal(longPreferenceB.ok, true);
    assert.notEqual(longPreferenceA.memory.memory_identity, longPreferenceB.memory.memory_identity);
    assert.notEqual(longPreferenceA.memory.id, longPreferenceB.memory.id);
    assert.equal(longPreferenceA.memory.memory_identity, "preference:id:long-type-a");
    assert.equal(longPreferenceB.memory.memory_identity, "preference:id:long-type-b");
    assert.equal(longPreferenceA.memory.title.length <= 240, true);

    const preferenceAddedCountBeforeInvalid = queryRows(
      "SELECT COUNT(*) AS count FROM feedback_items WHERE project_id=%s AND feedback_type='preference_added'",
      [projectId]
    )[0].count;

    const missingProject = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId: 999999,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "avoid_public_clarification",
        summary: "不存在项目的偏好不应写入。"
      })
    ]);
    assert.equal(missingProject.ok, false);
    assert.equal(missingProject.error_type, "project_not_found");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE project_id=999999 AND source_type='preference'")[0].count, 0);

    const invalidPreference = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "avoid_public_clarification"
      })
    ]);
    assert.equal(invalidPreference.ok, false);
    assert.equal(invalidPreference.error_type, "invalid_preference_payload");
    assert.equal(
      queryRows("SELECT COUNT(*) AS count FROM feedback_items WHERE project_id=%s AND feedback_type='preference_added'", [projectId])[0].count,
      preferenceAddedCountBeforeInvalid
    );
  }
);

test(
  "uses preference memory to replace public clarification recommendations",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    queryRows(
      `
      INSERT INTO artist_public_opinion_events(
        project_id, platform, event_identity, event_type, title, trigger_summary,
        related_artists, status, risk_level, event_score, evidence_ids,
        timeline_json, impact_assessment, recommended_actions, first_seen_at, last_seen_at
      )
      VALUES (
        %s, 'weibo', 'preference-action-event', 'formal_event',
        '官宣可信度争议', '多条评论质疑官宣可信度',
        JSON_ARRAY('刘昊然'), 'observing', 'medium', 11.5,
        JSON_ARRAY(101,102), JSON_ARRAY(),
        '用户围绕官宣可信度反复争议', JSON_ARRAY(), NOW(), NOW()
      )
      `,
      [projectId]
    );
    const eventId = queryRows(
      "SELECT id FROM artist_public_opinion_events WHERE project_id=%s AND event_identity='preference-action-event'",
      [projectId]
    )[0].id;

    const initialActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T11:00:00Z" })
    ]);
    assert.equal(initialActions.ok, true);
    assert.equal(initialActions.actions[0].action_type, "clarify_official_announcement");
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND related_event_id=%s AND action_type='clarify_official_announcement' AND confirmation_status='pending'",
      [projectId, eventId]
    )[0].count, 1);

    const preference = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceId: "public-clarification-policy",
        preferenceType: "avoid_public_clarification",
        summary: "团队不希望默认推荐公开澄清，除非争议明显扩大。"
      })
    ]);
    assert.equal(preference.ok, true);

    const builtActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(builtActions.ok, true);
    assert.equal(builtActions.persisted_actions, 1);
    assert.equal(builtActions.actions.length, 1);
    assert.equal(builtActions.actions[0].related_event_id, eventId);
    assert.notEqual(builtActions.actions[0].action_type, "clarify_official_announcement");
    assert.equal(builtActions.actions[0].action_type, "monitor_and_prepare_material");
    assert.match(builtActions.actions[0].reason, /用户偏好/);
    assert.deepEqual(builtActions.actions[0].raw_json.preference_memory_ids, [preference.memory.id]);
    assert.equal(builtActions.actions[0].raw_json.preference_constraint_source, "user_feedback");

    const actionRow = queryRows(
      "SELECT action_type, reason, JSON_EXTRACT(raw_json, '$.raw_json.preference_memory_ids[0]') AS memory_id, JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.raw_json.preference_constraint_source')) AS source FROM publicity_actions WHERE project_id=%s AND related_event_id=%s",
      [projectId, eventId]
    )[0];
    assert.equal(actionRow.action_type, "monitor_and_prepare_material");
    assert.match(actionRow.reason, /用户偏好/);
    assert.equal(Number(actionRow.memory_id), preference.memory.id);
    assert.equal(actionRow.source, "user_feedback");
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND related_event_id=%s AND confirmation_status='pending'",
      [projectId, eventId]
    )[0].count, 1);
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND related_event_id=%s AND action_type='clarify_official_announcement' AND confirmation_status='pending'",
      [projectId, eventId]
    )[0].count, 0);

    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const legacyProjectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    queryRows(
      `
      INSERT INTO artist_public_opinion_events(
        project_id, platform, event_identity, event_type, title, trigger_summary,
        related_artists, status, risk_level, event_score, evidence_ids,
        timeline_json, impact_assessment, recommended_actions, first_seen_at, last_seen_at
      )
      VALUES (
        %s, 'weibo', 'legacy-preference-action-event', 'formal_event',
        '官宣可信度旧建议', '评论质疑官宣可信度',
        JSON_ARRAY('刘昊然'), 'observing', 'medium', 11.5,
        JSON_ARRAY(151,152), JSON_ARRAY(),
        '用户围绕官宣可信度争议', JSON_ARRAY(), NOW(), NOW()
      )
      `,
      [legacyProjectId]
    );
    const legacyEventId = queryRows(
      "SELECT id FROM artist_public_opinion_events WHERE project_id=%s AND event_identity='legacy-preference-action-event'",
      [legacyProjectId]
    )[0].id;
    queryRows(
      `
      INSERT INTO publicity_actions(
        project_id, platform, related_event_id, source, action_identity,
        confirmation_status, action_type, content_summary, reason, evidence_ids,
        priority, owner_suggestion, confidence, raw_json
      )
      VALUES (
        %s, 'weibo', %s, 'agent_recommended',
        CONCAT('agent_recommended::legacy-', %s),
        'pending', 'clarify_official_announcement',
        '旧版准备微博官宣节奏澄清素材', '旧版 action identity 行为',
        JSON_ARRAY(151,152), 'medium', '宣发负责人', 0.7, JSON_OBJECT('legacy', true)
      )
      `,
      [legacyProjectId, legacyEventId, legacyEventId]
    );
    const legacyPreference = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId: legacyProjectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "avoid_public_clarification",
        summary: "团队不希望默认推荐公开澄清。"
      })
    ]);
    assert.equal(legacyPreference.ok, true);
    const legacyRebuild = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId: legacyProjectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(legacyRebuild.ok, true);
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND related_event_id=%s AND source='agent_recommended'",
      [legacyProjectId, legacyEventId]
    )[0].count, 1);
    assert.deepEqual(queryRows(
      "SELECT action_type, confirmation_status FROM publicity_actions WHERE project_id=%s AND related_event_id=%s",
      [legacyProjectId, legacyEventId]
    )[0], {
      action_type: "monitor_and_prepare_material",
      confirmation_status: "pending"
    });
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND related_event_id=%s AND action_type='clarify_official_announcement'",
      [legacyProjectId, legacyEventId]
    )[0].count, 0);

    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const legacyRejectedProjectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    queryRows(
      `
      INSERT INTO artist_public_opinion_events(
        project_id, platform, event_identity, event_type, title, trigger_summary,
        related_artists, status, risk_level, event_score, evidence_ids,
        timeline_json, impact_assessment, recommended_actions, first_seen_at, last_seen_at
      )
      VALUES (
        %s, 'weibo', 'legacy-rejected-preference-action-event', 'formal_event',
        '官宣可信度旧驳回建议', '评论质疑官宣可信度',
        JSON_ARRAY('刘昊然'), 'observing', 'medium', 11.5,
        JSON_ARRAY(161,162), JSON_ARRAY(),
        '用户围绕官宣可信度争议', JSON_ARRAY(), NOW(), NOW()
      )
      `,
      [legacyRejectedProjectId]
    );
    const legacyRejectedEventId = queryRows(
      "SELECT id FROM artist_public_opinion_events WHERE project_id=%s AND event_identity='legacy-rejected-preference-action-event'",
      [legacyRejectedProjectId]
    )[0].id;
    queryRows(
      `
      INSERT INTO publicity_actions(
        project_id, platform, related_event_id, source, action_identity,
        confirmation_status, action_type, content_summary, reason, evidence_ids,
        priority, owner_suggestion, confidence, raw_json
      )
      VALUES (
        %s, 'weibo', %s, 'agent_recommended',
        CONCAT('agent_recommended::legacy-rejected-', %s),
        'rejected', 'clarify_official_announcement',
        '旧版已驳回官宣澄清建议', '用户已经驳回旧版建议',
        JSON_ARRAY(161,162), 'medium', '宣发负责人', 0.7, JSON_OBJECT('legacy', true)
      )
      `,
      [legacyRejectedProjectId, legacyRejectedEventId, legacyRejectedEventId]
    );
    const legacyRejectedPreference = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId: legacyRejectedProjectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "avoid_public_clarification",
        summary: "团队不希望默认推荐公开澄清。"
      })
    ]);
    assert.equal(legacyRejectedPreference.ok, true);
    const legacyRejectedRebuild = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId: legacyRejectedProjectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(legacyRejectedRebuild.ok, true);
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND related_event_id=%s AND source='agent_recommended'",
      [legacyRejectedProjectId, legacyRejectedEventId]
    )[0].count, 1);
    assert.deepEqual(queryRows(
      "SELECT action_type, confirmation_status FROM publicity_actions WHERE project_id=%s AND related_event_id=%s",
      [legacyRejectedProjectId, legacyRejectedEventId]
    )[0], {
      action_type: "clarify_official_announcement",
      confirmation_status: "rejected"
    });
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='action' AND memory_identity LIKE %s AND JSON_CONTAINS_PATH(memory_json, 'one', '$.raw_json.preference_memory_ids')",
      [legacyRejectedProjectId, "action:agent-event-%"]
    )[0].count, 0);

    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const rejectedProjectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    queryRows(
      `
      INSERT INTO artist_public_opinion_events(
        project_id, platform, event_identity, event_type, title, trigger_summary,
        related_artists, status, risk_level, event_score, evidence_ids,
        timeline_json, impact_assessment, recommended_actions, first_seen_at, last_seen_at
      )
      VALUES (
        %s, 'weibo', 'rejected-preference-action-event', 'formal_event',
        '官宣可信度二次争议', '评论继续质疑官宣可信度',
        JSON_ARRAY('刘昊然'), 'observing', 'medium', 11.5,
        JSON_ARRAY(201,202), JSON_ARRAY(),
        '用户围绕官宣可信度继续争议', JSON_ARRAY(), NOW(), NOW()
      )
      `,
      [rejectedProjectId]
    );
    const rejectedEventId = queryRows(
      "SELECT id FROM artist_public_opinion_events WHERE project_id=%s AND event_identity='rejected-preference-action-event'",
      [rejectedProjectId]
    )[0].id;
    const rejectedInitial = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId: rejectedProjectId, now: "2026-06-10T11:00:00Z" })
    ]);
    assert.equal(rejectedInitial.actions[0].action_type, "clarify_official_announcement");
    const rejectedAction = queryRows(
      "SELECT id FROM publicity_actions WHERE project_id=%s AND related_event_id=%s AND action_type='clarify_official_announcement'",
      [rejectedProjectId, rejectedEventId]
    )[0];
    const rejectedFeedback = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId: rejectedProjectId,
        sourceType: "action",
        sourceId: rejectedAction.id,
        feedbackType: "action_rejected",
        note: "用户已驳回这条 Agent 建议。"
      })
    ]);
    assert.equal(rejectedFeedback.ok, true);
    const rejectedPreference = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId: rejectedProjectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "avoid_public_clarification",
        summary: "团队不希望默认推荐公开澄清。"
      })
    ]);
    assert.equal(rejectedPreference.ok, true);
    const rebuildAfterRejected = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId: rejectedProjectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(rebuildAfterRejected.ok, true);
    assert.equal(queryRows(
      "SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND related_event_id=%s",
      [rejectedProjectId, rejectedEventId]
    )[0].count, 1);
    assert.deepEqual(queryRows(
      "SELECT confirmation_status, action_type FROM publicity_actions WHERE id=%s",
      [rejectedAction.id]
    )[0], {
      confirmation_status: "rejected",
      action_type: "clarify_official_announcement"
    });
    const rejectedActionMemory = queryRows(
      "SELECT summary, memory_json FROM bot_memory_items WHERE project_id=%s AND source_kind='action' AND memory_identity=%s",
      [rejectedProjectId, `action:agent-event-${rejectedEventId}`]
    )[0];
    assert.match(rejectedActionMemory.summary, /官宣节奏澄清/);
    assert.equal(
      queryRows(
        "SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='action' AND memory_identity=%s AND JSON_CONTAINS_PATH(memory_json, 'one', '$.raw_json.preference_memory_ids')",
        [rejectedProjectId, `action:agent-event-${rejectedEventId}`]
      )[0].count,
      0
    );

    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const neutralProjectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    queryRows(
      `
      INSERT INTO artist_public_opinion_events(
        project_id, platform, event_identity, event_type, title, trigger_summary,
        related_artists, status, risk_level, event_score, evidence_ids,
        timeline_json, impact_assessment, recommended_actions, first_seen_at, last_seen_at
      )
      VALUES (
        %s, 'weibo', 'neutral-preference-action-event', 'formal_event',
        '官宣可信度中性争议', '评论讨论官宣可信度',
        JSON_ARRAY('刘昊然'), 'observing', 'medium', 11.5,
        JSON_ARRAY(301,302), JSON_ARRAY(),
        '用户围绕官宣可信度讨论', JSON_ARRAY(), NOW(), NOW()
      )
      `,
      [neutralProjectId]
    );
    const neutralPreference = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId: neutralProjectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceType: "clarification_policy",
        summary: "团队不是不公开澄清，只是不反对先准备澄清材料。"
      })
    ]);
    assert.equal(neutralPreference.ok, true);
    const neutralActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId: neutralProjectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(neutralActions.ok, true);
    assert.equal(neutralActions.actions[0].action_type, "clarify_official_announcement");
  }
);

test(
  "answers Weibo Q&A with preference memory as team feedback, not external fact",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = createProject("海岛舒服日志 Q&A 偏好记忆");

    queryRows(
      `
      INSERT INTO social_posts(project_id, platform, external_id, url, author_name, title, content, keyword, engagement, raw_json)
      VALUES (%s,'weibo','qa-preference-post','https://weibo.test/qa-preference-post','测试营销号','官宣可信度讨论','围绕海岛舒服日志官宣可信度的讨论','海岛舒服日志',420,JSON_OBJECT())
      `,
      [projectId]
    );
    const postId = queryRows("SELECT id FROM social_posts WHERE project_id=%s AND external_id='qa-preference-post'", [projectId])[0].id;
    queryRows(
      `
      INSERT INTO social_comments(post_id, project_id, platform, external_id, author_name, content, like_count, reply_count, raw_json)
      VALUES (%s,%s,'weibo','qa-preference-comment','观众A','非官宣消息太多，担心又是在溜粉。',35,4,JSON_OBJECT())
      `,
      [postId, projectId]
    );
    const commentId = queryRows("SELECT id FROM social_comments WHERE project_id=%s AND external_id='qa-preference-comment'", [projectId])[0].id;
    queryRows(
      `
      INSERT INTO artist_public_opinion_events(
        project_id, platform, event_type, title, trigger_summary, related_artists, status,
        risk_level, event_score, evidence_ids, event_identity, first_seen_at, last_seen_at
      )
      VALUES (
        %s, 'weibo', 'formal_event', '官宣可信度被质疑',
        '高互动评论集中质疑非官宣消息和溜粉风险。',
        JSON_ARRAY('刘昊然','李兰迪'), 'observing',
        'high', 0.82, JSON_ARRAY(%s), 'qa-preference-event',
        '2026-06-10 10:00:00', '2026-06-10 11:00:00'
      )
      `,
      [projectId, commentId]
    );
    const eventId = queryRows("SELECT id FROM artist_public_opinion_events WHERE project_id=%s AND event_identity='qa-preference-event'", [projectId])[0].id;
    queryRows(
      `
      INSERT INTO publicity_actions(
        project_id, platform, related_event_id, source, action_identity, confirmation_status,
        action_type, content_summary, reason, evidence_ids, priority, confidence, raw_json
      )
      VALUES (
        %s, 'weibo', %s, 'agent_recommended', 'qa-preference-action', 'pending',
        'clarify_official_announcement', '准备公开澄清素材',
        '事件已有评论证据，需要人工确认是否公开澄清。',
        JSON_ARRAY(%s), 'high', 0.74, JSON_OBJECT()
      )
      `,
      [projectId, eventId, commentId]
    );

    const preference = runWorker([
      "weibo-feedback",
      "--payload-json",
      JSON.stringify({
        projectId,
        sourceType: "preference",
        feedbackType: "preference_added",
        preferenceId: "bot-answer-policy",
        preferenceType: "avoid_public_clarification",
        summary: "团队偏好是低调观察，避免默认公开澄清。",
        note: "来自宣发人工反馈"
      })
    ]);
    assert.equal(preference.ok, true);
    for (let index = 0; index < 25; index += 1) {
      queryRows(
        `
        INSERT INTO bot_memory_items(project_id, source_kind, source_id, memory_identity, title, summary, evidence_ids, memory_json, importance)
        VALUES (%s,'conversation',%s,%s,%s,'高权重历史对话记忆',JSON_ARRAY(),JSON_OBJECT(),0.99)
        `,
        [projectId, index + 1, `conversation:qa-noise-${index}`, `噪声记忆 ${index}`]
      );
    }

    const botAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, question: "现在该怎么回应？团队偏好是什么？" })
    ]);

    assert.equal(botAnswer.ok, true);
    assert.equal(botAnswer.answer.error, null);
    assert.equal(botAnswer.answer.preference_context.length, 1);
    assert.deepEqual(botAnswer.answer.preference_context[0], {
      id: `memory-${preference.memory.id}`,
      memory_identity: "preference:id:bot-answer-policy",
      source_of_truth: "user_feedback",
      summary: "团队偏好是低调观察，避免默认公开澄清。"
    });
    assert.equal(botAnswer.answer.citations.includes(`memory-${preference.memory.id}`), true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^comment-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^event-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^action-\d+$/.test(citation)), true);
    assert.match(botAnswer.answer.text, /团队偏好|人工反馈/);
    assert.match(botAnswer.answer.text, /不是外部事实|不作为外部事实/);
    assert.doesNotMatch(botAnswer.answer.facts.join("\n"), /低调观察|避免默认公开澄清/);

    const actionEffectAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, question: "行动效果怎么看？团队偏好是什么？" })
    ]);
    assert.equal(actionEffectAnswer.ok, true);
    assert.equal(actionEffectAnswer.answer.error.error_type, "insufficient_backtest_data");
    assert.equal(actionEffectAnswer.answer.preference_context.length, 1);
    assert.equal(actionEffectAnswer.answer.citations.includes(`memory-${preference.memory.id}`), true);
    assert.match(actionEffectAnswer.answer.text, /团队偏好|人工反馈/);
    assert.match(actionEffectAnswer.answer.text, /不是外部事实|不作为外部事实/);
    assert.doesNotMatch(actionEffectAnswer.answer.facts.join("\n"), /低调观察|避免默认公开澄清/);
  }
);

test(
  "answers Weibo Q&A with knowledge card citations as knowledge references",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const commentId = createEvidenceComment(projectId, "knowledge-qa-real-comment");
    const eventId = createKnowledgeActionEvent(projectId, "knowledge-qa-event", [commentId]);
    const actionId = createAction(projectId, "knowledge-qa-action");
    const barbieCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='case:barbie:earned-media-lifestyle-symbol'"
    )[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({
        projectId,
        triggerMode: "manual",
        input: { source: "knowledge-qa-test" }
      })
    ]);
    assert.equal(loop.ok, true);

    const botAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({
        projectId,
        agentLoopRunId: loop.run.id,
        question: "生活方式视觉符号讨论可以怎么回应？请说明知识依据。"
      })
    ]);

    assert.equal(botAnswer.ok, true);
    assert.equal(botAnswer.answer.error, null);
    assert.equal(botAnswer.answer.citations.includes(`comment-${commentId}`), true);
    assert.equal(botAnswer.answer.citations.includes(`event-${eventId}`), true);
    assert.equal(botAnswer.answer.citations.includes(`action-${actionId}`), true);
    assert.equal(botAnswer.answer.citations.includes(`knowledge-card-${barbieCardId}`), true);
    assert.equal(botAnswer.answer.knowledge_references.length > 0, true);
    const barbieReference = botAnswer.answer.knowledge_references.find((item) => item.card_id === barbieCardId);
    assert.equal(Boolean(barbieReference), true);
    assert.equal(barbieReference.id, `knowledge-card-${barbieCardId}`);
    assert.equal(barbieReference.card_identity, "case:barbie:earned-media-lifestyle-symbol");
    assert.equal(barbieReference.title, "影视项目的视觉符号与 earned media 扩散");
    assert.equal(barbieReference.reliability_level, "B");
    assert.equal(barbieReference.citation_role, "knowledge_reference");
    assert.equal(barbieReference.fact_boundary, "knowledge_reference_not_observed_weibo_fact");
    assert.equal(
      barbieReference.citation_url,
      "https://shortyawards.com/16th/barbie-the-movie-marketing-campaign"
    );
    for (const reference of botAnswer.answer.knowledge_references) {
      assert.equal(reference.fact_boundary, "knowledge_reference_not_observed_weibo_fact");
      assert.equal(reference.id.startsWith("knowledge-card-"), true);
      assert.deepEqual(Object.keys(reference).sort(), [
        "applicable_scenario",
        "card_id",
        "card_identity",
        "citation_role",
        "citation_url",
        "do_not_apply_when",
        "fact_boundary",
        "id",
        "reliability_level",
        "title"
      ]);
      for (const forbiddenKey of [
        "source_id",
        "source_identity",
        "source_title",
        "source_type",
        "match_reasons",
        "judge_questions",
        "raw_json",
        "publisher"
      ]) {
        assert.equal(Object.hasOwn(reference, forbiddenKey), false);
      }
    }
    assert.match(botAnswer.answer.text, /事实|微博证据/);
    assert.match(botAnswer.answer.text, /知识参考|知识卡/);
    assert.match(botAnswer.answer.text, /推断|建议/);
    assert.match(barbieReference.applicable_scenario, /生活方式|视觉符号/);
    assert.doesNotMatch(botAnswer.answer.facts.join("\n"), /Barbie|Shorty|知识卡|earned media/i);
    assert.equal(botAnswer.agentStepRun.evidence_ids.includes(`knowledge-card-${barbieCardId}`), false);
    assert.equal(botAnswer.agentStepRun.evidence_ids.every((citation) => /^(comment|event|action|memory)-\d+$/.test(citation)), true);
    const conversationMemoryEvidence = JSON.parse(queryRows(
      "SELECT evidence_ids FROM bot_memory_items WHERE project_id=%s AND source_kind='conversation' ORDER BY id DESC LIMIT 1",
      [projectId]
    )[0].evidence_ids);
    assert.equal(conversationMemoryEvidence.includes(`knowledge-card-${barbieCardId}`), false);
    assert.equal(conversationMemoryEvidence.every((citation) => /^(comment|event|action|memory)-\d+$/.test(citation)), true);
  }
);

test(
  "does not use knowledge cards to fabricate Weibo facts when current evidence is missing",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const projectId = createProject("海岛舒服日志 Q&A 知识不可替代证据");
    const barbieCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='case:barbie:earned-media-lifestyle-symbol'"
    )[0].id;
    queryRows(
      `
      INSERT INTO bot_memory_items(project_id, source_kind, source_id, memory_identity, title, summary, evidence_ids, memory_json, importance)
      VALUES (%s,'preference',NULL,'preference:knowledge-only','团队偏好','团队希望先观察生活方式讨论。',JSON_ARRAY(),JSON_OBJECT('source_of_truth','user_feedback'),0.8)
      `,
      [projectId]
    );

    const botAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, question: "生活方式视觉符号可以怎么回应？能参考知识卡吗？" })
    ]);

    assert.equal(botAnswer.ok, true);
    assert.equal(botAnswer.answer.error.error_type, "insufficient_evidence");
    assert.deepEqual(botAnswer.answer.citations, []);
    assert.deepEqual(botAnswer.answer.knowledge_references, []);
    assert.deepEqual(botAnswer.answer.facts, []);
    assert.doesNotMatch(botAnswer.answer.text, /Barbie|Shorty|knowledge-card|知识卡|生活方式视觉符号/i);
    assert.equal(
      queryRows(
        "SELECT COUNT(*) AS count FROM bot_messages WHERE project_id=%s AND role='assistant' AND JSON_CONTAINS(cited_source_ids, JSON_QUOTE(%s))",
        [projectId, `knowledge-card-${barbieCardId}`]
      )[0].count,
      0
    );
  }
);

test(
  "marks C-level knowledge cards as weak inspiration in Weibo Q&A",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const projectId = createProject("海岛舒服日志 Q&A C级知识弱启发");
    const commentId = createEvidenceComment(projectId, "knowledge-qa-c-level-comment");
    const eventId = createKnowledgeActionEvent(projectId, "knowledge-qa-c-level-event", [commentId], {
      title: "危机回应需要判断责任归因",
      triggerSummary: "微博评论出现责任归因和事实争议，需要判断回应强度",
      impactAssessment: "讨论集中在事实争议与责任归因，不是普通剧情讨论或轻量玩梗",
      riskLevel: "high",
      eventScore: 12.5
    });
    const actionId = createAction(projectId, "knowledge-qa-c-level-action");
    const scctCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='framework:scct:risk-response-fit'"
    )[0].id;

    const botAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, question: "责任归因和事实争议下应该怎么回应？" })
    ]);

    assert.equal(botAnswer.ok, true);
    assert.equal(botAnswer.answer.error, null);
    assert.equal(botAnswer.answer.citations.includes(`comment-${commentId}`), true);
    assert.equal(botAnswer.answer.citations.includes(`event-${eventId}`), true);
    assert.equal(botAnswer.answer.citations.includes(`action-${actionId}`), true);
    assert.equal(botAnswer.answer.citations.includes(`knowledge-card-${scctCardId}`), true);
    const scctReference = botAnswer.answer.knowledge_references.find((item) => item.card_id === scctCardId);
    assert.equal(Boolean(scctReference), true);
    assert.equal(scctReference.reliability_level, "C");
    assert.equal(scctReference.citation_role, "weak_inspiration");
    assert.equal(scctReference.fact_boundary, "knowledge_reference_not_observed_weibo_fact");
    assert.match(botAnswer.answer.text, /弱启发|不是硬规则|不作为硬规则/);
    assert.doesNotMatch(botAnswer.answer.facts.join("\n"), /SCCT|Situational Crisis|危机回应与责任感知适配/i);
  }
);

test(
  "discloses weak inspiration when C-level Q&A knowledge appears after stronger references",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    assert.equal(runWorker(["weibo-knowledge-seed", "--payload-json", "{}"]).ok, true);
    const projectId = createProject("海岛舒服日志 Q&A 混合知识引用");
    const commentId = createEvidenceComment(projectId, "knowledge-qa-mixed-comment");
    createKnowledgeActionEvent(projectId, "knowledge-qa-mixed-event", [commentId], {
      title: "生活方式视觉符号与事实争议并存",
      triggerSummary: "微博评论既讨论生活方式视觉符号，也出现责任归因和事实争议",
      impactAssessment: "正向扩散和危机回应都只能作为参考，不能替代当前评论证据",
      riskLevel: "high",
      eventScore: 12.5
    });
    createAction(projectId, "knowledge-qa-mixed-action");
    const barbieCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='case:barbie:earned-media-lifestyle-symbol'"
    )[0].id;
    const scctCardId = queryRows(
      "SELECT id FROM knowledge_cards WHERE card_identity='framework:scct:risk-response-fit'"
    )[0].id;

    queryRows(
      "UPDATE knowledge_cards SET do_not_apply_when='当前仅有线下执行计划且缺少微博讨论证据时。' WHERE card_identity='case:barbie:earned-media-lifestyle-symbol'"
    );

    const botAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, question: "生活方式视觉符号与责任归因并存时怎么回应？" })
    ]);

    assert.equal(botAnswer.ok, true);
    assert.equal(botAnswer.answer.error, null);
    const barbieIndex = botAnswer.answer.knowledge_references.findIndex((item) => item.card_id === barbieCardId);
    const scctIndex = botAnswer.answer.knowledge_references.findIndex((item) => item.card_id === scctCardId);
    assert.equal(barbieIndex >= 0, true);
    assert.equal(scctIndex > barbieIndex, true);
    assert.equal(botAnswer.answer.knowledge_references[barbieIndex].citation_role, "knowledge_reference");
    assert.equal(botAnswer.answer.knowledge_references[scctIndex].citation_role, "weak_inspiration");
    assert.match(botAnswer.answer.text, /弱启发|不是硬规则|不作为硬规则/);
  }
);

test(
  "persists Weibo discovery, target selection, and detail fixture rows into MySQL",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    const migration = runWorker(["migrate"]);
    assert.equal(migration.ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);

    assert.equal(discovery.ok, true);
    assert.equal(discovery.task.platform, "weibo");
    assert.equal(discovery.task.crawler_type, "search");
    assert.equal(discovery.task.keyword, "海岛舒服日志");
    assert.equal(discovery.persisted_targets, 10);
    assert.equal(discovery.targets.length, 10);
    assertPublicTargetPayload(discovery.targets[0], "discovery target");
    assertPublicPayloadText(discovery, "discovery payload");

    const listedTargets = runWorker([
      "weibo-targets",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(listedTargets.ok, true);
    assert.equal(listedTargets.targets.length, 10);
    assertPublicTargetPayload(listedTargets.targets[0], "targets list item");
    assertPublicPayloadText(listedTargets, "targets list payload");

    const workbenchAfterDiscovery = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterDiscovery.mode, "weibo-agent-mvp");
    assert.equal(workbenchAfterDiscovery.setup.partialState, "search-only");
    assert.equal(workbenchAfterDiscovery.recommendedTargets.length, 10);
    assert.equal(workbenchAfterDiscovery.recommendedTargets[0].external_id, "1004");
    assert.equal(workbenchAfterDiscovery.dataGaps.some((gap) => gap.code === "weibo_real_data_missing"), false);
    assert.equal(workbenchAfterDiscovery.dataGaps.some((gap) => gap.code === "weibo_detail_or_analysis_needed"), true);
    assert.equal(Object.hasOwn(workbenchAfterDiscovery.setup.latestTask, "output_path"), false);
    assert.equal(Object.hasOwn(workbenchAfterDiscovery.setup.latestTask, "raw_files"), false);
    assert.equal(workbenchAfterDiscovery.setup.latestTask.raw_file_count, 1);
    const publicTarget = workbenchAfterDiscovery.recommendedTargets[0];
    for (const forbiddenKey of ["raw_json", "target_locator", "recommendation_metadata", "content_fingerprint"]) {
      assert.equal(Object.hasOwn(publicTarget, forbiddenKey), false, `${forbiddenKey} must not appear on public workbench targets`);
    }
    const publicWorkbenchAfterDiscoveryText = JSON.stringify(workbenchAfterDiscovery);
    for (const forbidden of ["raw_json", "target_locator", "recommendation_metadata", "content_fingerprint", "cookie_file", "config/cookies", "WEIBO_COOKIE_FILE", "token"]) {
      assert.equal(publicWorkbenchAfterDiscoveryText.includes(forbidden), false, `${forbidden} must not appear in public workbench payload`);
    }
    queryRows(
      "INSERT INTO collection_tasks(project_id, platform, keyword, status, requested_limit, crawler_engine, crawler_type, error_type, error_message, output_path, raw_files, parsed_records, failed_records, collected_posts, collected_comments, finished_at) VALUES (%s,'weibo',%s,'failed',10,'mediacrawler','search','mediacrawler_runtime_failed','simulated latest failure','storage/mediacrawler/latest-failed',JSON_ARRAY(),0,0,0,0,NOW())",
      [projectId, "海岛舒服日志"]
    );
    const workbenchAfterFailedRetry = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterFailedRetry.recommendedTargets.length, 10);
    assert.equal(workbenchAfterFailedRetry.setup.latestTask.status, "failed");
    assert.equal(workbenchAfterFailedRetry.dataGaps.some((gap) => gap.code === "weibo_latest_task_failed"), true);

    const taskRows = queryRows(
      "SELECT platform, keyword, status, requested_limit, crawler_type, parsed_records, failed_records, collected_posts FROM collection_tasks WHERE id=%s",
      [discovery.task.id]
    );
    assert.deepEqual(taskRows[0], {
      platform: "weibo",
      keyword: "海岛舒服日志",
      status: "succeeded",
      requested_limit: 10,
      crawler_type: "search",
      parsed_records: 10,
      failed_records: 0,
      collected_posts: 10
    });

    const targetRows = queryRows(
      "SELECT external_id, selected_status, `rank`, JSON_UNQUOTE(JSON_EXTRACT(target_locator, '$.weibo_mid')) AS weibo_mid FROM discovered_targets ORDER BY `rank`, id"
    );
    assert.equal(targetRows.length, 10);
    assert.equal(targetRows[0].external_id, "1004");
    assert.equal(targetRows.some((row) => row.external_id === "1011"), false);
    assert.equal(targetRows.find((row) => row.external_id === "1001").weibo_mid, "m1001");

    const target1001 = targetRows.find((row) => row.external_id === "1001");
    const selected = runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ targetId: "1001" })
    ]);
    assert.equal(selected.ok, true);
    assert.equal(selected.target.external_id, "1001");
    assert.equal(selected.target.selected_status, "selected");
    assertPublicTargetPayload(selected.target, "selected target");
    assertPublicPayloadText(selected, "selected target payload");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE source_kind='target'")[0].count, 1);

    const ignored = runWorker([
      "weibo-target-ignore",
      "--payload-json",
      JSON.stringify({ targetId: "1004" })
    ]);
    assert.equal(ignored.ok, true);
    assert.equal(ignored.target.selected_status, "ignored");
    assertPublicTargetPayload(ignored.target, "ignored target");
    assertPublicPayloadText(ignored, "ignored target payload");

    const rediscovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(rediscovery.ok, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM discovered_targets")[0].count, 10);
    const rediscoveredStates = queryRows(
      "SELECT external_id, selected_status FROM discovered_targets WHERE external_id IN ('1001','1004') ORDER BY external_id"
    );
    assert.deepEqual(rediscoveredStates, [
      { external_id: "1001", selected_status: "selected" },
      { external_id: "1004", selected_status: "ignored" }
    ]);

    const blockedCollection = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1004",
      "--payload-json",
      JSON.stringify({ fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(blockedCollection.ok, false);
    assert.equal(blockedCollection.error_type, "target_not_selected");
    assertPublicTargetPayload(blockedCollection.target, "blocked collection target");
    assertPublicPayloadText(blockedCollection, "blocked collection payload");

    const detail = runWorker([
      "weibo-collect-target",
      "--target-id",
      target1001.external_id,
      "--payload-json",
      JSON.stringify({ fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(detail.ok, true);
    assert.equal(detail.task.crawler_type, "detail");
    assert.equal(detail.status, "partial");
    assert.equal(detail.persisted_posts, 2);
    assert.equal(detail.persisted_comments, 4);
    assert.equal(detail.failed_records, 2);
    assertPublicTargetPayload(detail.target, "detail collection target");
    assertPublicPayloadText(detail, "detail collection payload");

    const detailTaskRows = queryRows(
      "SELECT status, crawler_type, target_id, parsed_records, failed_records, collected_posts, collected_comments FROM collection_tasks WHERE id=%s",
      [detail.task.id]
    );
    assert.equal(detailTaskRows[0].status, "partial");
    assert.equal(detailTaskRows[0].crawler_type, "detail");
    assert.equal(detailTaskRows[0].parsed_records, 3);
    assert.equal(detailTaskRows[0].failed_records, 2);
    assert.equal(detailTaskRows[0].collected_posts, 2);
    assert.equal(detailTaskRows[0].collected_comments, 4);

    assert.equal(queryRows("SELECT COUNT(*) AS count FROM target_collection_links WHERE collection_task_id=%s", [detail.task.id])[0].count, 1);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_posts")[0].count, 2);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_comments")[0].count, 4);
    assert.equal(queryRows("SELECT like_count, reply_count FROM social_comments WHERE external_id='c1002'")[0].like_count, 21);
    const commentsList = runWorker([
      "weibo-comments",
      "--payload-json",
      JSON.stringify({ projectId, limit: 3 })
    ]);
    assert.equal(commentsList.ok, true);
    assert.equal(commentsList.mode, "weibo-agent-mvp");
    assert.equal(commentsList.total, 4);
    assert.equal(commentsList.comments.length, 3);
    assert.equal(commentsList.comments[0].platform, "weibo");
    assert.equal(commentsList.comments[0].comment_id > 0, true);
    assert.equal(commentsList.comments[0].post_external_id, "1001");
    assert.equal(typeof commentsList.comments[0].content, "string");
    assert.equal(Object.hasOwn(commentsList.comments[0], "like_count"), true);
    assert.equal(Object.hasOwn(commentsList.comments[0], "source_type"), true);
    assert.equal(commentsList.citations.includes(`comment-${commentsList.comments[0].comment_id}`), true);
    const workbenchAfterDetail = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterDetail.setup.partialState, "detail-without-analysis");
    assert.equal(workbenchAfterDetail.setup.progress.analysis_count, 0);
    assert.equal(workbenchAfterDetail.dataGaps.some((gap) => gap.code === "weibo_analysis_needed"), true);
    const localAnalysis = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10 })
    ]);
    assert.equal(localAnalysis.ok, true);
    assert.equal(localAnalysis.deepseek.status, "not_run");
    assert.equal(localAnalysis.persisted_sentiments, 4);
    assert.equal(localAnalysis.agent_run.status, "succeeded");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results WHERE model='local-rules'")[0].count, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs WHERE project_id=%s AND agent_name='Local Weibo Issue Analysis'", [projectId])[0].count, 1);
    const localAnalysisAgain = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10 })
    ]);
    assert.equal(localAnalysisAgain.persisted_sentiments, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results WHERE model='local-rules'")[0].count, 4);

    const deepSeekAnalysis = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({
        projectId,
        limit: 10,
        deepseekResponsePath: "test/fixtures/deepseek-response.md"
      })
    ]);
    assert.equal(deepSeekAnalysis.ok, true);
    assert.equal(deepSeekAnalysis.deepseek.status, "succeeded");
    assert.equal(deepSeekAnalysis.agent_run.agent_name, "DeepSeek Weibo Analysis");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results WHERE model='deepseek-chat'")[0].count, 4);
    const deepSeekRow = queryRows(
      "SELECT COUNT(*) AS count FROM sentiment_results WHERE model='deepseek-chat' AND JSON_EXTRACT(analysis_json, '$.ignored_model_numbers.weight') IS NOT NULL"
    )[0];
    assert.equal(deepSeekRow.count > 0, true);

    const deepSeekFailure = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({
        projectId,
        limit: 10,
        simulateDeepSeekFailure: "timeout"
      })
    ]);
    assert.equal(deepSeekFailure.ok, true);
    assert.equal(deepSeekFailure.deepseek.status, "failed");
    assert.equal(deepSeekFailure.agent_run.fallback_type, "local_rules");
    const workbenchAfterLocalAnalysis = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterLocalAnalysis.setup.progress.analysis_count, 4);
    assert.equal(workbenchAfterLocalAnalysis.setup.partialState, "analysis-without-event");
    const analysesList = runWorker([
      "weibo-analyses",
      "--payload-json",
      JSON.stringify({ projectId, limit: 3 })
    ]);
    assert.equal(analysesList.ok, true);
    assert.equal(analysesList.mode, "weibo-agent-mvp");
    assert.equal(analysesList.total, 4);
    assert.equal(analysesList.analyses.length, 3);
    assert.equal(analysesList.analyses[0].platform, "weibo");
    assert.equal(analysesList.analyses[0].comment_id > 0, true);
    assert.equal(typeof analysesList.analyses[0].content, "string");
    assert.equal(Object.hasOwn(analysesList.analyses[0], "sentiment"), true);
    assert.equal(Object.hasOwn(analysesList.analyses[0], "topics"), true);
    assert.equal(Object.hasOwn(analysesList.analyses[0], "risks"), true);
    assert.equal(Object.hasOwn(analysesList.analyses[0], "stance"), true);
    assert.equal(analysesList.citations.includes(`comment-${analysesList.analyses[0].comment_id}`), true);
    const analysisOnly = runWorker([
      "weibo-deepseek-fixture",
      "--comments",
      "test/fixtures/deepseek-comments.jsonl",
      "--now",
      "2026-06-10T12:00:00Z",
      "--simulate-failure",
      "timeout",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(analysisOnly.ok, true);
    const workbenchAfterAnalysisOnly = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterAnalysisOnly.setup.partialState, "analysis-without-event");
    assert.equal(workbenchAfterAnalysisOnly.setup.progress.analysis_count > 0, true);
    assert.equal(workbenchAfterAnalysisOnly.dataGaps.some((gap) => gap.code === "weibo_event_needed"), true);

    const builtEvents = runWorker([
      "weibo-events-build",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(builtEvents.ok, true);
    assert.equal(builtEvents.deepseek.status, "not_run");
    assert.equal(builtEvents.persisted_events > 0, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, builtEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM event_evidence_links")[0].count > 0, true);
    const builtEventsAgain = runWorker([
      "weibo-events-build",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(builtEventsAgain.persisted_events, builtEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, builtEvents.persisted_events);
    const realEvents = runWorker([
      "weibo-events",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(realEvents.ok, true);
    assert.equal(realEvents.events.length, builtEvents.persisted_events);
    assert.equal(realEvents.events[0].platform, "weibo");
    assert.equal(Object.hasOwn(realEvents.events[0], "evidence_ids"), true);
    const realEventDetail = runWorker([
      "weibo-events",
      "--event-id",
      String(realEvents.events[0].id),
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(realEventDetail.ok, true);
    assert.equal(realEventDetail.event.id, realEvents.events[0].id);

    const builtActions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(builtActions.ok, true);
    assert.equal(builtActions.persisted_actions > 0, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND source='agent_recommended'", [projectId])[0].count, builtActions.persisted_actions);
    const builtActionsAgain = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(builtActionsAgain.persisted_actions, builtActions.persisted_actions);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM publicity_actions WHERE project_id=%s AND source='agent_recommended'", [projectId])[0].count, builtActions.persisted_actions);
    const pendingActions = runWorker([
      "weibo-actions-pending",
      "--payload-json",
      JSON.stringify({ projectId })
    ]);
    assert.equal(pendingActions.ok, true);
    assert.equal(pendingActions.actions.some((action) => action.source === "agent_recommended"), true);
    const recommended = pendingActions.actions.find((action) => action.source === "agent_recommended");
    assert.equal(recommended.confirmation_status, "pending");
    assert.equal(recommended.related_event_id > 0, true);
    assert.equal(recommended.evidence_ids.length > 0, true);
    assert.equal(Object.hasOwn(recommended, "raw_json"), false);
    queryRows("UPDATE publicity_actions SET content_summary='人工保留的建议摘要' WHERE id=%s", [recommended.id]);
    const rejectedRecommendation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(recommended.id),
      "--payload-json",
      JSON.stringify({ projectId, confirmationStatus: "rejected", note: "人工驳回该建议" })
    ]);
    assert.equal(rejectedRecommendation.ok, true);
    assert.equal(rejectedRecommendation.action.confirmation_status, "rejected");
    const rebuildAfterRejection = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(rebuildAfterRejection.ok, true);
    const protectedRecommendation = queryRows("SELECT confirmation_status, content_summary FROM publicity_actions WHERE id=%s", [recommended.id])[0];
    assert.deepEqual(protectedRecommendation, {
      confirmation_status: "rejected",
      content_summary: "人工保留的建议摘要"
    });
    const botAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, question: "为什么微博负面升高，现在该做什么？" })
    ]);
    assert.equal(botAnswer.ok, true);
    assert.equal(botAnswer.answer.error, null);
    assert.equal(botAnswer.answer.facts.length > 0, true);
    assert.equal(botAnswer.answer.inferences.length > 0, true);
    assert.equal(botAnswer.answer.recommendations.length > 0, true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^comment-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^event-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.some((citation) => /^action-\d+$/.test(citation)), true);
    assert.equal(botAnswer.answer.citations.every((citation) => /^(comment|event|action)-\d+$/.test(citation)), true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_conversations WHERE project_id=%s", [projectId])[0].count, 1);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_messages WHERE project_id=%s", [projectId])[0].count, 2);

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 第二项目",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const secondProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 第二项目"])[0].id;
    runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId: secondProjectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ projectId: secondProjectId, targetId: "1001" })]);
    const secondDetail = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId: secondProjectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(secondDetail.ok, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_posts WHERE project_id=%s", [secondProjectId])[0].count, 2);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_comments WHERE project_id=%s", [secondProjectId])[0].count, 4);

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 Memory Only",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const memoryOnlyProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 Memory Only"])[0].id;
    queryRows(
      "INSERT INTO bot_memory_items(project_id, source_kind, source_id, memory_identity, title, summary, evidence_ids, memory_json, importance) VALUES (%s,'preference',NULL,'preference:memory-only','仅有记忆','只有历史偏好，没有当前微博证据',JSON_ARRAY(),JSON_OBJECT(),0.5)",
      [memoryOnlyProjectId]
    );
    const memoryOnlyAnswer = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId: memoryOnlyProjectId, question: "现在微博发生了什么？" })
    ]);
    assert.equal(memoryOnlyAnswer.ok, true);
    assert.equal(memoryOnlyAnswer.answer.error.error_type, "insufficient_evidence");
    assert.deepEqual(memoryOnlyAnswer.answer.citations, []);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_conversations WHERE project_id=%s", [memoryOnlyProjectId])[0].count, 1);
    assert.equal(queryRows("SELECT error_type FROM bot_messages WHERE project_id=%s AND role='assistant'", [memoryOnlyProjectId])[0].error_type, "insufficient_evidence");
  }
);

test(
  "runs MediaCrawler search and archives raw Weibo search JSONL before persisting targets",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const discovery = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        MEDIACRAWLER_CDP_PORT: "65533",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(discovery.ok, true);
    assert.equal(discovery.task.crawler_type, "search");
    assert.equal(discovery.persisted_targets, 2);
    assert.equal(discovery.targets[0].external_id, "mc-search-1");
    assert.equal(discovery.targets[0].url, "https://weibo.com/status/mc-search-1");
    assert.equal(discovery.targets[0].keyword, "海岛舒服日志");

    const taskRows = queryRows(
      "SELECT crawler_engine, status, output_path, raw_files, parsed_records, failed_records, collected_posts FROM collection_tasks WHERE id=%s",
      [discovery.task.id]
    );
    const task = taskRows[0];
    assert.equal(task.crawler_engine, "mediacrawler");
    assert.equal(task.status, "succeeded");
    assert.equal(task.parsed_records, 2);
    assert.equal(task.failed_records, 0);
    assert.equal(task.collected_posts, 2);
    assert.match(task.output_path, new RegExp(`storage/mediacrawler/${projectId}/${discovery.task.id}/weibo/`));

    const rawFiles = JSON.parse(task.raw_files);
    assert.equal(rawFiles.length, 1);
    assert.equal(rawFiles.every((file) => existsSync(file)), true);
    assert.equal(rawFiles.some((file) => file.includes("search_contents_")), true);
    assert.match(readFileSync(rawFiles.find((file) => file.includes("search_contents_")), "utf8"), /mc-search-1/);

    const targetIds = queryRows("SELECT external_id FROM discovered_targets ORDER BY `rank`, id").map((row) => row.external_id);
    assert.deepEqual(targetIds, ["mc-search-1", "mc-search-2"]);

    const invocation = JSON.parse(readFileSync(`${task.output_path}/invocation.json`, "utf8"));
    assert.equal(invocation.has_mysql_url, false);
    assert.equal(invocation.has_deepseek_key, false);
    assert.equal(invocation.has_cookies_arg, false);
    assert.equal(invocation.cookie_value_redacted, true);
    assert.equal(invocation.argv.includes("fake-sub-for-tests"), false);
    assert.equal(invocation.argv.includes("other-site-token"), false);
    assert.equal(invocation.config_cookie_present, true);
    assert.equal(invocation.config_cookie_value_recorded, false);
    assert.equal(invocation.config_cookie_has_unrelated, false);
    assert.equal(invocation.config_cdp_port, 65533);
    assert.equal(invocation.mediacrawler_cdp_port, "65533");
    assert.deepEqual(flagValue(invocation.argv, "--crawler_max_notes_count"), "10");
    assert.deepEqual(flagValue(invocation.argv, "--get_comment"), "false");
    assert.deepEqual(flagValue(invocation.argv, "--max_comments_count_singlenotes"), "0");
  }
);

test(
  "marks MediaCrawler search tasks failed when archived JSONL cannot be parsed",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);

    const failed = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志 bad-json",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "mediacrawler_parse_failed");
    const taskRows = queryRows("SELECT status, error_type, parsed_records, failed_records FROM collection_tasks WHERE id=%s", [failed.task.id]);
    assert.deepEqual(taskRows[0], {
      status: "failed",
      error_type: "mediacrawler_parse_failed",
      parsed_records: 0,
      failed_records: 1
    });
  }
);

test(
  "keeps valid MediaCrawler search rows and marks the task partial when some JSONL lines fail",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);

    const partial = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志 partial-json",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(partial.ok, true);
    assert.equal(partial.status, "partial");
    assert.equal(partial.persisted_targets, 1);
    assert.equal(partial.failed_records, 1);
    const taskRows = queryRows("SELECT status, parsed_records, failed_records, collected_posts FROM collection_tasks WHERE id=%s", [partial.task.id]);
    assert.deepEqual(taskRows[0], {
      status: "partial",
      parsed_records: 1,
      failed_records: 1,
      collected_posts: 1
    });
  }
);

test(
  "runs MediaCrawler detail for a selected target and archives raw Weibo detail JSONL",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    const selected = runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ targetId: "1001" })]);
    assert.equal(selected.ok, true);

    const detail = runWorker(
      [
        "weibo-collect-target",
        "--target-id",
        "1001",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 25
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        MEDIACRAWLER_CDP_PORT: "65533",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile
      }
    );

    assert.equal(detail.ok, true);
    assert.equal(detail.status, "succeeded");
    assert.equal(detail.persisted_posts, 1);
    assert.equal(detail.persisted_comments, 2);

    const taskRows = queryRows(
      "SELECT crawler_engine, status, output_path, raw_files, parsed_records, failed_records, collected_posts, collected_comments FROM collection_tasks WHERE id=%s",
      [detail.task.id]
    );
    const task = taskRows[0];
    assert.equal(task.crawler_engine, "mediacrawler");
    assert.equal(task.status, "succeeded");
    assert.equal(task.parsed_records, 3);
    assert.equal(task.failed_records, 0);
    assert.equal(task.collected_posts, 1);
    assert.equal(task.collected_comments, 2);
    assert.match(task.output_path, new RegExp(`storage/mediacrawler/${projectId}/${detail.task.id}/weibo/`));

    const rawFiles = JSON.parse(task.raw_files);
    assert.equal(rawFiles.length, 2);
    assert.equal(rawFiles.every((file) => existsSync(file)), true);
    assert.equal(rawFiles.some((file) => file.includes("detail_contents_")), true);
    assert.equal(rawFiles.some((file) => file.includes("detail_comments_")), true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM target_collection_links WHERE collection_task_id=%s", [detail.task.id])[0].count, 1);
    assert.equal(queryRows("SELECT external_id, source_account_external_id FROM social_posts WHERE external_id='m1001'")[0].source_account_external_id, "mc-detail-user");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM social_comments WHERE post_id=(SELECT id FROM social_posts WHERE external_id='m1001')")[0].count, 2);

    const invocation = JSON.parse(readFileSync(`${task.output_path}/invocation.json`, "utf8"));
    assert.equal(flagValue(invocation.argv, "--type"), "detail");
    assert.equal(flagValue(invocation.argv, "--specified_id"), "m1001");
    assert.equal(flagValue(invocation.argv, "--get_comment"), "true");
    assert.equal(flagValue(invocation.argv, "--max_comments_count_singlenotes"), "25");
    assert.equal(invocation.has_cookies_arg, false);
    assert.equal(invocation.argv.includes("fake-sub-for-tests"), false);
    assert.equal(invocation.config_cookie_present, true);
    assert.equal(invocation.config_cdp_port, 65533);
  }
);

test(
  "does not leak child process environment or stderr when MediaCrawler search fails",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    rmSync("storage/mediacrawler", { recursive: true, force: true });
    assert.equal(runWorker(["migrate"]).ok, true);

    const failed = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志 fail-runtime",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: fakeWeiboCookieFile,
        DEEPSEEK_API_KEY: "sk-parent-secret"
      }
    );

    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "mediacrawler_search_failed");
    assert.equal(failed.cause, "exit_code=2");
    assert.equal(JSON.stringify(failed).includes("sk-parent-secret"), false);
    assert.equal(JSON.stringify(failed).includes("should-not-leak"), false);
  }
);

test(
  "returns a standard MediaCrawler missing error for selected-target detail when runtime is unavailable",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    assert.equal(runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ targetId: "1001" })]).ok, true);

    const blocked = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 25
      })
    ]);

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "mediacrawler_missing");
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "mediacrawler_missing" });
  }
);

test(
  "rejects fixture paths outside the allowlisted test fixture directory",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const rejected = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: ".env.example"
      })
    ]);

    assert.equal(rejected.ok, false);
    assert.equal(rejected.error_type, "invalid_fixture_path");
  }
);

test(
  "returns a standard MediaCrawler missing error when real search runtime is unavailable",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const blocked = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        keyword: "海岛舒服日志",
        limit: 10
      })
    ]);

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "mediacrawler_missing");
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "mediacrawler_missing" });
  }
);

test(
  "returns a standard auth error when MediaCrawler search has no Weibo cookie file",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const blocked = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test"
      }
    );

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "auth_required");
    assertPublicPayloadText(blocked, "auth-required discovery error");
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "auth_required" });
  }
);

test(
  "rejects raw cookie header files because Weibo domains cannot be filtered",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);

    const blocked = runWorker(
      [
        "weibo-discovery",
        "--payload-json",
        JSON.stringify({
          keyword: "海岛舒服日志",
          limit: 10
        })
      ],
      {
        MEDIACRAWLER_HOME: "test/fixtures/fake-mediacrawler",
        MEDIACRAWLER_PYTHON: python,
        MEDIACRAWLER_OUTPUT_DIR: "storage/mediacrawler",
        MEDIACRAWLER_COMMIT: "fake-mediacrawler-test",
        WEIBO_COOKIE_FILE: "test/fixtures/weibo-cookie-header.json"
      }
    );

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error_type, "auth_invalid");
    assert.equal(blocked.cause.includes("Raw cookie header strings are not accepted"), true);
    assertPublicPayloadText(blocked, "auth-invalid discovery error");
    const taskRows = queryRows("SELECT status, error_type FROM collection_tasks WHERE id=%s", [blocked.task.id]);
    assert.deepEqual(taskRows[0], { status: "failed", error_type: "auth_invalid" });
  }
);

test(
  "persists Weibo target and post source types from stable source accounts before display-name fallback",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    for (const account of [
      {
        projectId,
        externalId: "u-stable",
        profileUrl: "https://weibo.com/u/stable",
        displayName: "稳定官号",
        sourceType: "official",
        confirmedByUser: true
      },
      {
        projectId,
        displayName: "重名娱乐号",
        sourceType: "media",
        confirmedByUser: true
      },
      {
        projectId,
        displayName: "无ID营销号",
        sourceType: "marketing",
        confirmedByUser: true
      },
      {
        projectId,
        displayName: "有ID同名粉丝",
        sourceType: "fan",
        confirmedByUser: true
      },
      {
        projectId,
        profileUrl: "https://weibo.com/u/url-only",
        displayName: "URL稳定艺人号",
        sourceType: "artist",
        confirmedByUser: true
      }
    ]) {
      const upsert = runWorker(["weibo-source-account-upsert", "--payload-json", JSON.stringify(account)]);
      assert.equal(upsert.ok, true);
    }

    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 4,
        fixturePath: "test/fixtures/weibo-source-type-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    assert.equal(discovery.persisted_targets, 4);

    const targetSourceRows = queryRows(
      "SELECT external_id, source_type, source_match_method, CAST(source_match_confidence AS CHAR) AS source_match_confidence FROM discovered_targets WHERE project_id=%s ORDER BY external_id",
      [projectId]
    );
    assert.deepEqual(targetSourceRows, [
      {
        external_id: "st1001",
        source_type: "official",
        source_match_method: "stable_id",
        source_match_confidence: "1.0000"
      },
      {
        external_id: "st1002",
        source_type: "marketing",
        source_match_method: "display_name",
        source_match_confidence: "0.5500"
      },
      {
        external_id: "st1003",
        source_type: "unknown",
        source_match_method: "stable_unmatched",
        source_match_confidence: "0.2000"
      },
      {
        external_id: "st1004",
        source_type: "artist",
        source_match_method: "stable_url",
        source_match_confidence: "0.9500"
      }
    ]);

    assert.equal(
      targetSourceRows.find((row) => row.external_id === "st1001").source_type,
      "official",
      "stable external ID should outrank a conflicting display-name account"
    );
    assert.equal(
      targetSourceRows.find((row) => row.external_id === "st1003").source_type,
      "unknown",
      "display-name fallback is not allowed when a stable account identifier is present"
    );

    const selected = runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "st1001" })
    ]);
    assert.equal(selected.ok, true);

    const detail = runWorker([
      "weibo-collect-target",
      "--target-id",
      "st1001",
      "--payload-json",
      JSON.stringify({
        projectId,
        fixturePath: "test/fixtures/weibo-source-type-detail.jsonl"
      })
    ]);
    assert.equal(detail.ok, true);
    assert.equal(detail.persisted_posts, 4);

    const postSourceRows = queryRows(
      "SELECT external_id, source_type, source_match_method, CAST(source_match_confidence AS CHAR) AS source_match_confidence FROM social_posts WHERE project_id=%s ORDER BY external_id",
      [projectId]
    );
    assert.deepEqual(postSourceRows, targetSourceRows);
  }
);

test(
  "attaches existing Weibo worker commands to Agent Loop run when exact agentLoopRunId is provided",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    assert.equal(runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "1001" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]).ok, true);

    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({
        projectId,
        triggerMode: "manual",
        input: { source: "step-attachment-test" }
      })
    ]);
    assert.equal(loop.ok, true);
    const agentLoopRunId = loop.run.id;

    const analysis = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10, agentLoopRunId })
    ]);
    assert.equal(analysis.ok, true);
    assert.equal(analysis.agentStepRun.step_name, "comment_analysis");
    assert.equal(analysis.agentStepRun.status, "succeeded");
    assert.equal(analysis.agentStepRun.evidence_ids.length > 0, true);

    const events = runWorker([
      "weibo-events-build",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId })
    ]);
    assert.equal(events.ok, true);
    assert.equal(events.persisted_events > 0, true);
    assert.equal(events.agentStepRun.step_name, "event_building");
    assert.equal(events.agentStepRun.status, "succeeded");
    assert.equal(events.agentStepRun.evidence_ids.length > 0, true);

    const actions = runWorker([
      "weibo-actions-build",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId, now: "2026-06-10T12:00:00Z" })
    ]);
    assert.equal(actions.ok, true);
    assert.equal(actions.persisted_actions > 0, true);
    assert.equal(actions.agentStepRun.step_name, "action_recommendation");
    assert.equal(actions.agentStepRun.status, "succeeded");
    assert.equal(actions.agentStepRun.evidence_ids.length > 0, true);

    const bot = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId, question: "为什么微博负面升高，现在该做什么？" })
    ]);
    assert.equal(bot.ok, true);
    assert.equal(bot.answer.error, null);
    assert.equal(bot.agentStepRun.step_name, "evidence_qa");
    assert.equal(bot.agentStepRun.status, "succeeded");
    assert.equal(bot.agentStepRun.evidence_ids.length > 0, true);

    const persistedSteps = queryRows(
      "SELECT agent_name, step_name, status, JSON_LENGTH(evidence_ids) AS evidence_count, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.command')) AS command FROM agent_step_runs WHERE loop_run_id=%s ORDER BY id",
      [agentLoopRunId]
    );
    assert.deepEqual(persistedSteps, [
      {
        agent_name: "Issue Analysis Agent",
        step_name: "comment_analysis",
        status: "succeeded",
        evidence_count: analysis.agentStepRun.evidence_ids.length,
        command: "weibo-comments-analyze"
      },
      {
        agent_name: "Event Agent",
        step_name: "event_building",
        status: "succeeded",
        evidence_count: events.agentStepRun.evidence_ids.length,
        command: "weibo-events-build"
      },
      {
        agent_name: "Strategy Agent",
        step_name: "action_recommendation",
        status: "succeeded",
        evidence_count: actions.agentStepRun.evidence_ids.length,
        command: "weibo-actions-build"
      },
      {
        agent_name: "QA Agent",
        step_name: "evidence_qa",
        status: "succeeded",
        evidence_count: bot.agentStepRun.evidence_ids.length,
        command: "weibo-bot-message"
      }
    ]);

    const status = runWorker([
      "weibo-agent-loop-status",
      "--payload-json",
      JSON.stringify({ projectId, loopRunId: agentLoopRunId })
    ]);
    assert.deepEqual(status.steps.map((step) => step.step_name), [
      "comment_analysis",
      "event_building",
      "action_recommendation",
      "evidence_qa"
    ]);
  }
);

test(
  "rejects invalid or cross-project agentLoopRunId before business writeback",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;

    assert.equal(runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "1001" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]).ok, true);

    const missingRun = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, limit: 10, agentLoopRunId: 999999 })
    ]);
    assert.equal(missingRun.ok, false);
    assert.equal(missingRun.error_type, "agent_loop_not_found");
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM sentiment_results")[0].count, 0);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs")[0].count, 0);

    for (const command of ["weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const missing = runWorker(commandArgs(command, { projectId, agentLoopRunId: 999999 }));
      assert.equal(missing.ok, false, command);
      assert.equal(missing.error_type, "agent_loop_not_found", command);
    }

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 Step Attachment 隔离项目",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const otherProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 Step Attachment 隔离项目"])[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const crossProject = runWorker(commandArgs(command, { projectId: otherProjectId, agentLoopRunId: loop.run.id }));
      assert.equal(crossProject.ok, false, command);
      assert.equal(crossProject.error_type, "agent_loop_not_found", command);
    }
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [otherProjectId])[0].count, 0);
  }
);

test(
  "rejects attached commands with explicit missing project before default project fallback",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    const before = writebackCounts(projectId);

    for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const result = runWorker(commandArgs(command, { projectId: 999999, agentLoopRunId: loop.run.id }));
      assert.equal(result.ok, false, command);
      assert.equal(result.error_type, "project_not_found", command);
    }

    assert.deepEqual(writebackCounts(projectId), before);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_step_runs WHERE loop_run_id=%s", [loop.run.id])[0].count, 0);
  }
);

test(
  "records no-evidence Agent Loop attachments as partial and ignores run id aliases",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    const agentLoopRunId = loop.run.id;

    for (const aliasKey of ["loopRunId", "agent_loop_run_id"]) {
      for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
        const aliasOnly = runWorker(commandArgs(command, { projectId, [aliasKey]: agentLoopRunId }));
        assert.equal(aliasOnly.ok, true, `${command} ${aliasKey}`);
      }
    }
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_step_runs WHERE loop_run_id=%s", [agentLoopRunId])[0].count, 0);

    for (const command of ["weibo-comments-analyze", "weibo-events-build", "weibo-actions-build", "weibo-bot-message"]) {
      const exact = runWorker(commandArgs(command, { projectId, agentLoopRunId }));
      assert.equal(exact.ok, true, command);
      assert.equal(exact.agentStepRun.status, "partial", command);
      assert.notEqual(exact.agentStepRun.step_name, undefined, command);
      assert.deepEqual(exact.agentStepRun.evidence_ids, [], command);
    }

    const stepRows = queryRows(
      "SELECT step_name, status, JSON_LENGTH(evidence_ids) AS evidence_count, error_type FROM agent_step_runs WHERE loop_run_id=%s ORDER BY id",
      [agentLoopRunId]
    );
    assert.deepEqual(stepRows, [
      { step_name: "comment_analysis", status: "partial", evidence_count: 0, error_type: "no_comments_to_analyze" },
      { step_name: "event_building", status: "partial", evidence_count: 0, error_type: "no_analysis_evidence" },
      { step_name: "action_recommendation", status: "partial", evidence_count: 0, error_type: "no_events_for_actions" },
      { step_name: "evidence_qa", status: "partial", evidence_count: 0, error_type: "insufficient_evidence" }
    ]);
  }
);

test(
  "preserves original worker error fields when an attached Agent Loop step fails",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);

    const failed = runWorker([
      "weibo-bot-message",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId: loop.run.id })
    ]);
    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "question_required");
    assert.equal(typeof failed.cause, "string");
    assert.equal(typeof failed.fix, "string");
    assert.equal(failed.agentStepRun.step_name, "evidence_qa");
    assert.equal(failed.agentStepRun.status, "failed");
    assert.equal(failed.agentStepRun.error_type, "question_required");

    const stepRow = queryRows(
      "SELECT status, error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.error_type')) AS output_error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.cause')) AS output_cause, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.fix')) AS output_fix FROM agent_step_runs WHERE loop_run_id=%s",
      [loop.run.id]
    )[0];
    assert.equal(stepRow.status, "failed");
    assert.equal(stepRow.error_type, "question_required");
    assert.equal(stepRow.output_error_type, "question_required");
    assert.equal(typeof stepRow.output_cause, "string");
    assert.equal(typeof stepRow.output_fix, "string");
  }
);

test(
  "records an attached failed step when worker execution raises unexpectedly",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const loop = runWorker([
      "weibo-agent-loop-run",
      "--payload-json",
      JSON.stringify({ projectId, triggerMode: "manual" })
    ]);
    assert.equal(runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-target-select",
      "--payload-json",
      JSON.stringify({ projectId, targetId: "1001" })
    ]).ok, true);
    assert.equal(runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]).ok, true);

    queryRows("DROP TABLE sentiment_results");

    const failed = runWorker([
      "weibo-comments-analyze",
      "--payload-json",
      JSON.stringify({ projectId, agentLoopRunId: loop.run.id })
    ]);
    assert.equal(failed.ok, false);
    assert.equal(failed.error_type, "worker_execution_failed");
    assert.equal(typeof failed.cause, "string");
    assert.equal(typeof failed.fix, "string");
    assert.equal(failed.agentStepRun.status, "failed");
    assert.equal(failed.agentStepRun.error_type, "worker_execution_failed");

    const stepRow = queryRows(
      "SELECT status, error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.error_type')) AS output_error_type, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.cause')) AS output_cause, JSON_UNQUOTE(JSON_EXTRACT(output_json, '$.fix')) AS output_fix FROM agent_step_runs WHERE loop_run_id=%s",
      [loop.run.id]
    )[0];
    assert.equal(stepRow.status, "failed");
    assert.equal(stepRow.error_type, "worker_execution_failed");
    assert.equal(stepRow.output_error_type, "worker_execution_failed");
    assert.equal(typeof stepRow.output_cause, "string");
    assert.equal(typeof stepRow.output_fix, "string");
  }
);

test(
  "persists agent runs, events, action ledger state, and bot memory items into MySQL",
  { skip: testMysqlUrl ? false : "set WEIBO_DB_PERSISTENCE_TEST_URL to run real MySQL persistence tests" },
  () => {
    resetTestDatabase();
    assert.equal(runWorker(["migrate"]).ok, true);
    const projectId = queryRows("SELECT id FROM monitor_projects ORDER BY id LIMIT 1")[0].id;
    const discovery = runWorker([
      "weibo-discovery",
      "--payload-json",
      JSON.stringify({
        projectId,
        keyword: "海岛舒服日志",
        limit: 10,
        fixturePath: "test/fixtures/weibo-search.jsonl"
      })
    ]);
    assert.equal(discovery.ok, true);
    assert.equal(runWorker(["weibo-target-select", "--payload-json", JSON.stringify({ projectId, targetId: "1001" })]).ok, true);
    const detail = runWorker([
      "weibo-collect-target",
      "--target-id",
      "1001",
      "--payload-json",
      JSON.stringify({ projectId, fixturePath: "test/fixtures/weibo-detail.jsonl" })
    ]);
    assert.equal(detail.ok, true);
    assert.equal(detail.persisted_comments > 0, true);

    const analysis = runWorker([
      "weibo-deepseek-fixture",
      "--comments",
      "test/fixtures/deepseek-comments.jsonl",
      "--now",
      "2026-06-10T12:00:00Z",
      "--simulate-failure",
      "timeout",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(analysis.ok, true);
    assert.equal(analysis.persisted_agent_runs, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs WHERE project_id=%s", [projectId])[0].count, 4);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM agent_runs WHERE error_message='retry_exhausted'")[0].count, 1);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE source_kind='analysis'")[0].count, 1);

    const fallbackEvents = runWorker([
      "weibo-build-events-fixture",
      "--fixture",
      "test/fixtures/weibo-event-evidence.jsonl",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(fallbackEvents.ok, true);
    assert.equal(fallbackEvents.persisted_events >= 2, true);

    const events = runWorker([
      "weibo-build-events-fixture",
      "--fixture",
      "test/fixtures/weibo-event-evidence.jsonl",
      "--deepseek-response",
      "test/fixtures/deepseek-event-response.md",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(events.ok, true);
    assert.equal(events.persisted_events, fallbackEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, fallbackEvents.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM event_evidence_links")[0].count > 0, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM event_status_history")[0].count > 0, true);
    const explainedEvent = queryRows(
      "SELECT title, event_score, risk_level, impact_assessment, JSON_LENGTH(recommended_actions) AS recommended_count FROM artist_public_opinion_events WHERE project_id=%s AND title=%s ORDER BY event_score DESC, id LIMIT 1",
      [projectId, "DeepSeek 官宣可信度风险升温"]
    )[0];
    assert.equal(explainedEvent.risk_level, "high");
    assert.notEqual(Number(explainedEvent.event_score), 999);
    assert.match(explainedEvent.impact_assessment, /官方澄清/);
    assert.equal(explainedEvent.recommended_count > 0, true);
    const repeatedEvents = runWorker([
      "weibo-build-events-fixture",
      "--fixture",
      "test/fixtures/weibo-event-evidence.jsonl",
      "--deepseek-response",
      "test/fixtures/deepseek-event-response.md",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(repeatedEvents.ok, true);
    assert.equal(repeatedEvents.persisted_events, events.persisted_events);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM artist_public_opinion_events WHERE project_id=%s", [projectId])[0].count, fallbackEvents.persisted_events);

    const eventId = queryRows("SELECT id FROM artist_public_opinion_events WHERE project_id=%s ORDER BY event_score DESC, id LIMIT 1", [projectId])[0].id;
    const manualAccount = runWorker([
      "weibo-source-account-upsert",
      "--payload-json",
      JSON.stringify({
        projectId,
        externalId: "u-manual-official",
        profileUrl: "https://weibo.com/u/manual-official",
        displayName: "手工确认官号",
        sourceType: "official",
        confirmedByUser: true
      })
    ]);
    assert.equal(manualAccount.ok, true);
    assert.equal(manualAccount.account.source_type, "official");
    assert.equal(manualAccount.account.confirmed_by_user, true);

    const actions = runWorker([
      "weibo-actions-fixture",
      "--accounts",
      "test/fixtures/weibo-source-accounts.json",
      "--posts",
      "test/fixtures/weibo-action-posts.jsonl",
      "--event-id",
      String(eventId),
      "--now",
      "2026-06-10T12:00:00Z",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(actions.ok, true);
    assert.equal(actions.persisted_source_accounts, 3);
    assert.equal(actions.persisted_actions >= 4, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM source_accounts WHERE project_id=%s", [projectId])[0].count, 4);

    const repeatedActions = runWorker([
      "weibo-actions-fixture",
      "--accounts",
      "test/fixtures/weibo-source-accounts.json",
      "--posts",
      "test/fixtures/weibo-action-posts.jsonl",
      "--event-id",
      String(eventId),
      "--now",
      "2026-06-10T12:00:00Z",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(repeatedActions.ok, true);
    assert.equal(repeatedActions.persisted_source_accounts, 3);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM source_accounts WHERE project_id=%s", [projectId])[0].count, 4);

    const pending = runWorker(["weibo-actions-pending", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(pending.ok, true);
    assert.equal(pending.actions.some((action) => action.source === "official_observed"), true);
    assert.equal(pending.actions.some((action) => action.source === "agent_recommended"), true);

    const officialAction = queryRows(
      "SELECT id, confirmation_status, observed_at, confirmed_at, effective_at FROM publicity_actions WHERE source='official_observed' ORDER BY id LIMIT 1"
    )[0];
    assert.equal(officialAction.confirmation_status, "pending");
    assert.notEqual(officialAction.observed_at, null);
    assert.notEqual(officialAction.effective_at, null);

    queryRows(
      "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,%s,%s,%s,%s,%s)",
      [
        "海岛舒服日志 行动隔离项目",
        "微博 MVP",
        "测试隔离",
        JSON.stringify(["海岛舒服日志"]),
        JSON.stringify(["刘昊然", "李兰迪"]),
        JSON.stringify(["weibo"])
      ]
    );
    const otherProjectId = queryRows("SELECT id FROM monitor_projects WHERE project_name=%s", ["海岛舒服日志 行动隔离项目"])[0].id;
    const wrongProjectConfirmation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(officialAction.id),
      "--payload-json",
      JSON.stringify({ projectId: otherProjectId, confirmationStatus: "rejected" })
    ]);
    assert.equal(wrongProjectConfirmation.ok, false);
    assert.equal(wrongProjectConfirmation.error_type, "action_not_found");

    const confirmation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(officialAction.id),
      "--payload-json",
      JSON.stringify({
        projectId,
        confirmationStatus: "confirmed",
        effectiveAt: "2026-06-10T08:00:00Z",
        note: "已核对官号发布时间和事件证据"
      })
    ]);
    assert.equal(confirmation.ok, true);
    assert.equal(confirmation.action.confirmation_status, "confirmed");
    assert.notEqual(queryRows("SELECT confirmed_at FROM publicity_actions WHERE id=%s", [officialAction.id])[0].confirmed_at, null);
    const confirmationMemory = queryRows(
      "SELECT summary, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.confirmation_note')) AS note FROM bot_memory_items WHERE project_id=%s AND source_kind='action' AND source_id=%s ORDER BY id DESC LIMIT 1",
      [projectId, officialAction.id]
    )[0];
    assert.equal(confirmationMemory.summary, "已核对官号发布时间和事件证据");
    assert.equal(confirmationMemory.note, "已核对官号发布时间和事件证据");

    const repeatedConfirmation = runWorker([
      "weibo-action-confirm",
      "--action-id",
      String(officialAction.id),
      "--payload-json",
      JSON.stringify({ projectId, confirmationStatus: "rejected" })
    ]);
    assert.equal(repeatedConfirmation.ok, false);
    assert.equal(repeatedConfirmation.error_type, "action_already_confirmed");
    assert.equal(
      queryRows("SELECT confirmation_status FROM publicity_actions WHERE id=%s", [officialAction.id])[0].confirmation_status,
      "confirmed"
    );

    const backtest = runWorker([
      "weibo-backtest-fixture",
      "--fixture",
      "test/fixtures/weibo-backtest-scenarios.json",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(backtest.ok, true);
    assert.equal(backtest.persisted_memory_items, backtest.results.length);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='backtest'", [projectId])[0].count, backtest.results.length);
    const workbenchAfterBacktestMemory = runWorker(["weibo-workbench", "--payload-json", JSON.stringify({ projectId })]);
    assert.equal(workbenchAfterBacktestMemory.setup.progress.backtest_count, backtest.results.length);
    assert.equal(workbenchAfterBacktestMemory.setup.partialState, "backtested");
    assert.equal(workbenchAfterBacktestMemory.dataGaps.some((gap) => gap.code === "weibo_backtest_needed"), false);
    const persistedBacktest = queryRows(
      "SELECT title, summary, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.result')) AS result FROM bot_memory_items WHERE project_id=%s AND source_kind='backtest' AND JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.scenario_id'))='strong' LIMIT 1",
      [projectId]
    )[0];
    assert.match(persistedBacktest.title, /strong/);
    assert.match(persistedBacktest.summary, /continue|monitor/i);
    assert.equal(persistedBacktest.result, "strong");
    const repeatedBacktest = runWorker([
      "weibo-backtest-fixture",
      "--fixture",
      "test/fixtures/weibo-backtest-scenarios.json",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(repeatedBacktest.ok, true);
    assert.equal(queryRows("SELECT COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s AND source_kind='backtest'", [projectId])[0].count, backtest.results.length);

    const report = runWorker([
      "weibo-memory-report-fixture",
      "--fixture",
      "test/fixtures/weibo-memory-records.json",
      "--question",
      "为什么微博负面升高",
      "--now",
      "2026-06-10T12:00:00Z",
      "--persist-project-id",
      String(projectId)
    ]);
    assert.equal(report.ok, true);
    assert.equal(report.persisted_memory_items >= 1, true);

    const memoryKinds = queryRows(
      "SELECT source_kind, COUNT(*) AS count FROM bot_memory_items WHERE project_id=%s GROUP BY source_kind ORDER BY source_kind",
      [projectId]
    );
    const kinds = new Set(memoryKinds.map((row) => row.source_kind));
    for (const kind of ["analysis", "event", "action", "backtest", "report", "preference"]) {
      assert.equal(kinds.has(kind), true, `${kind} memory item should be persisted`);
    }
    const preference = queryRows(
      "SELECT memory_identity, title, summary, JSON_UNQUOTE(JSON_EXTRACT(memory_json, '$.id')) AS fixture_id FROM bot_memory_items WHERE project_id=%s AND source_kind='preference' LIMIT 1",
      [projectId]
    )[0];
    assert.equal(preference.memory_identity, "preference:preference-1");
    assert.match(preference.title, /用户偏好/);
    assert.match(preference.summary, /可追溯证据/);
    assert.equal(preference.fixture_id, "preference-1");
  }
);

function runWorker(args, envOverrides = {}) {
  const result = spawnSync(python, ["workers/enterprise_worker.py", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_URL: testMysqlUrl,
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_API_URL: "",
      DEEPSEEK_MODEL: "",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json",
      MEDIACRAWLER_HOME: "/tmp/mediacrawler-does-not-exist",
      MEDIACRAWLER_PYTHON: "/tmp/python-does-not-exist",
      MEDIACRAWLER_OUTPUT_DIR: "/tmp/weibo-mvp-test-output",
      MEDIACRAWLER_CDP_PORT: "65534",
      WEIBO_FIXTURE_MODE: "1",
      ...envOverrides,
      YUQING_SKIP_ENV_FILE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function commandArgs(command, payload) {
  const commandPayload = { ...payload };
  if (command === "weibo-bot-message" && !Object.hasOwn(commandPayload, "question")) {
    commandPayload.question = "现在微博发生了什么？";
  }
  return [command, "--payload-json", JSON.stringify(commandPayload)];
}

function writebackCounts(projectId) {
  return queryRows(
    `
    SELECT
      (SELECT COUNT(*) FROM sentiment_results sr JOIN social_comments c ON c.id=sr.comment_id WHERE c.project_id=%s) AS sentiments,
      (SELECT COUNT(*) FROM agent_runs WHERE project_id=%s) AS agent_runs,
      (SELECT COUNT(*) FROM artist_public_opinion_events WHERE project_id=%s) AS events,
      (SELECT COUNT(*) FROM publicity_actions WHERE project_id=%s) AS actions,
      (SELECT COUNT(*) FROM bot_conversations WHERE project_id=%s) AS conversations,
      (SELECT COUNT(*) FROM bot_messages WHERE project_id=%s) AS messages
    `,
    [projectId, projectId, projectId, projectId, projectId, projectId]
  )[0];
}

function createProject(name) {
  queryRows(
    "INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms) VALUES (%s,'电影','测试受众',JSON_ARRAY('海岛舒服日志'),JSON_ARRAY('刘昊然','李兰迪'),JSON_ARRAY('weibo'))",
    [name]
  );
  return queryRows("SELECT id FROM monitor_projects WHERE project_name=%s ORDER BY id DESC LIMIT 1", [name])[0].id;
}

function createTarget(projectId, identity) {
  queryRows(
    `
    INSERT INTO discovered_targets(
      project_id, platform, target_type, external_id, url, title, summary, keyword,
      target_locator, raw_json, selected_status
    )
    VALUES (%s,'weibo','post',%s,%s,'测试目标','测试目标摘要','海岛舒服日志',JSON_OBJECT('identity', %s),JSON_OBJECT('identity', %s),'selected')
    `,
    [projectId, `target-${identity}`, `https://weibo.com/${identity}`, identity, identity]
  );
  return queryRows("SELECT id FROM discovered_targets WHERE project_id=%s AND external_id=%s", [projectId, `target-${identity}`])[0].id;
}

function createEvidenceComment(projectId, identity) {
  queryRows(
    `
    INSERT INTO social_posts(project_id, platform, external_id, author_name, title, content, keyword, engagement, raw_json)
    VALUES (%s,'weibo',%s,'测试账号','测试证据帖','测试证据帖内容','海岛舒服日志',1,JSON_OBJECT('identity', %s))
    `,
    [projectId, `post-${identity}`, identity]
  );
  const postId = queryRows("SELECT id FROM social_posts WHERE project_id=%s AND external_id=%s", [projectId, `post-${identity}`])[0].id;
  queryRows(
    `
    INSERT INTO social_comments(post_id, project_id, platform, external_id, author_name, content, like_count, raw_json)
    VALUES (%s,%s,'weibo',%s,'测试评论账号','真实评论证据：生活方式讨论正在形成。',1,JSON_OBJECT('identity', %s))
    `,
    [postId, projectId, `comment-${identity}`, identity]
  );
  return queryRows("SELECT id FROM social_comments WHERE project_id=%s AND external_id=%s", [projectId, `comment-${identity}`])[0].id;
}

function createSentimentResult(commentId, identity) {
  queryRows(
    `
    INSERT INTO sentiment_results(
      comment_id, model, sentiment, score, confidence, topics, risks, evidence, analysis_json
    )
    VALUES (%s,'test-model','positive',0.65,0.8,JSON_ARRAY('口碑'),JSON_ARRAY(),%s,JSON_OBJECT('identity', %s))
    `,
    [commentId, `sentiment evidence ${identity}`, identity]
  );
  return queryRows("SELECT id FROM sentiment_results WHERE comment_id=%s AND model='test-model' ORDER BY id DESC LIMIT 1", [commentId])[0].id;
}

function createEvent(projectId, identity) {
  queryRows(
    `
    INSERT INTO artist_public_opinion_events(
      project_id, platform, event_identity, event_type, title, trigger_summary,
      related_artists, status, risk_level, event_score, evidence_ids,
      timeline_json, impact_assessment, recommended_actions, first_seen_at, last_seen_at
    )
    VALUES (%s,'weibo',%s,'observation_lead',%s,'测试事件触发摘要',JSON_ARRAY('刘昊然'),'observing','medium',12.5,JSON_ARRAY(101,102),JSON_ARRAY(),NULL,JSON_ARRAY(),NOW(),NOW())
    `,
    [projectId, identity, `测试事件 ${identity}`]
  );
  return queryRows("SELECT id FROM artist_public_opinion_events WHERE project_id=%s AND event_identity=%s", [projectId, identity])[0].id;
}

function createAction(projectId, identity) {
  queryRows(
    `
    INSERT INTO publicity_actions(
      project_id, platform, source, action_identity, confirmation_status,
      action_type, content_summary, reason, evidence_ids, priority, confidence, raw_json
    )
    VALUES (%s,'weibo','agent_recommended',%s,'pending','monitor_and_prepare_material','测试行动建议','测试行动反馈原因',JSON_ARRAY(101),'medium',0.66,JSON_OBJECT('identity', %s))
    `,
    [projectId, identity, identity]
  );
  return queryRows("SELECT id FROM publicity_actions WHERE project_id=%s AND action_identity=%s", [projectId, identity])[0].id;
}

function createMemory(projectId, identity) {
  queryRows(
    `
    INSERT INTO bot_memory_items(project_id, source_kind, source_id, memory_identity, title, summary, evidence_ids, memory_json, importance)
    VALUES (%s,'preference',NULL,%s,'测试记忆','测试记忆证据',JSON_ARRAY(),JSON_OBJECT('identity', %s),0.5)
    `,
    [projectId, `memory-${identity}`, identity]
  );
  return queryRows("SELECT id FROM bot_memory_items WHERE project_id=%s AND memory_identity=%s", [projectId, `memory-${identity}`])[0].id;
}

function createKnowledgeCard(identity) {
  queryRows(
    `
    INSERT INTO knowledge_sources(
      source_identity, title, source_type, reliability_level, citation_url, raw_json
    )
    VALUES (%s,'测试知识来源','industry_report','A',%s,JSON_OBJECT('identity', %s))
    `,
    [`source-${identity}`, `https://example.test/${identity}`, identity]
  );
  const sourceId = queryRows("SELECT id FROM knowledge_sources WHERE source_identity=%s", [`source-${identity}`])[0].id;
  queryRows(
    `
    INSERT INTO knowledge_cards(
      card_identity, source_id, framework_or_case, applicable_scenario, do_not_apply_when,
      recommended_actions, risk_warnings, evidence_required, judge_questions, tags, status, raw_json
    )
    VALUES (
      %s,%s,'测试框架','适用于有真实微博证据时。','缺少当前微博证据时不可使用。',
      JSON_ARRAY('保留事实边界'),JSON_ARRAY('不要替代真实证据'),JSON_ARRAY('真实微博证据'),
      JSON_ARRAY('是否有真实 evidence_ids？'),JSON_ARRAY('judge-test'),'active',JSON_OBJECT('identity', %s)
    )
    `,
    [`card-${identity}`, sourceId, identity]
  );
  return queryRows("SELECT id FROM knowledge_cards WHERE card_identity=%s", [`card-${identity}`])[0].id;
}

function createKnowledgeActionEvent(projectId, identity, evidenceIds, overrides = {}) {
  const title = overrides.title || "生活方式视觉符号正向讨论";
  const triggerSummary = overrides.triggerSummary || "评论正在围绕生活方式和视觉符号自然二创";
  const impactAssessment = overrides.impactAssessment || "低争议生活方式讨论适合观察自然扩散";
  const riskLevel = overrides.riskLevel || "low";
  const eventScore = overrides.eventScore || 7.5;
  queryRows(
    `
    INSERT INTO artist_public_opinion_events(
      project_id, platform, event_identity, event_type, title, trigger_summary,
      related_artists, status, risk_level, event_score, evidence_ids,
      timeline_json, impact_assessment, recommended_actions, first_seen_at, last_seen_at
    )
    VALUES (
      %s, 'weibo', %s, 'observation_lead',
      %s, %s,
      JSON_ARRAY('刘昊然'), 'observing', %s, %s,
      %s, JSON_ARRAY(),
      %s, JSON_ARRAY(), NOW(), NOW()
    )
    `,
    [projectId, identity, title, triggerSummary, riskLevel, eventScore, JSON.stringify(evidenceIds), impactAssessment]
  );
  return queryRows("SELECT id FROM artist_public_opinion_events WHERE project_id=%s AND event_identity=%s", [projectId, identity])[0].id;
}

function createSourceAccount(projectId, identity, sourceType = "unknown") {
  queryRows(
    `
    INSERT INTO source_accounts(
      project_id, platform, external_id, profile_url, display_name,
      source_type, match_confidence, confirmed_by_user, raw_json
    )
    VALUES (%s,'weibo',%s,%s,%s,%s,0.5,0,JSON_OBJECT('identity', %s))
    `,
    [
      projectId,
      `account-${identity}`,
      `https://weibo.com/u/${identity}`,
      `账号 ${identity}`,
      sourceType,
      identity
    ]
  );
  return queryRows("SELECT id FROM source_accounts WHERE project_id=%s AND external_id=%s", [projectId, `account-${identity}`])[0].id;
}

function resetTestDatabase() {
  const result = spawnSync(
    python,
    [
      "-c",
      `
import os
from urllib.parse import urlparse
import pymysql

url = os.environ["WEIBO_DB_PERSISTENCE_TEST_URL"]
parsed = urlparse(url)
database = parsed.path.lstrip("/")
if not database.startswith("yuqing_monitor_test"):
    raise SystemExit("Refusing to reset non-test database: " + database)
conn = pymysql.connect(
    host=parsed.hostname or "127.0.0.1",
    port=parsed.port or 3306,
    user=parsed.username or "root",
    password=parsed.password or "",
    charset="utf8mb4",
    autocommit=True,
)
with conn.cursor() as cur:
    quoted = database.replace(chr(96), chr(96) * 2)
    cur.execute("DROP DATABASE IF EXISTS " + chr(96) + quoted + chr(96))
    cur.execute("CREATE DATABASE " + chr(96) + quoted + chr(96) + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
conn.close()
`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, WEIBO_DB_PERSISTENCE_TEST_URL: testMysqlUrl }
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function queryRows(sql, params = []) {
  const result = spawnSync(
    python,
    [
      "-c",
      `
import json
import os
from workers import db

sql = os.environ["SQL"]
params = json.loads(os.environ.get("PARAMS", "[]"))
with db.connect() as conn:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
print(json.dumps(rows, ensure_ascii=False, default=str))
`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MYSQL_URL: testMysqlUrl,
        SQL: sql,
        PARAMS: JSON.stringify(params),
        YUQING_SKIP_ENV_FILE: "1"
      }
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function columnType(table, column) {
  const rows = queryRows(
    "SELECT COLUMN_TYPE AS column_type FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s",
    [table, column]
  );
  assert.equal(rows.length, 1, `${table}.${column} should exist`);
  return rows[0].column_type;
}

function enumValues(columnTypeText) {
  const values = [];
  const regex = /'((?:''|[^'])*)'/g;
  let match;
  while ((match = regex.exec(columnTypeText)) !== null) {
    values.push(match[1].replaceAll("''", "'"));
  }
  return values;
}

function assertPublicTargetPayload(target, context) {
  assert.equal(Boolean(target), true, `${context} should exist`);
  for (const forbiddenKey of ["raw_json", "target_locator", "recommendation_metadata", "content_fingerprint"]) {
    assert.equal(Object.hasOwn(target, forbiddenKey), false, `${forbiddenKey} must not appear on ${context}`);
  }
}

function assertPublicPayloadText(payload, context) {
  const text = JSON.stringify(payload);
  for (const forbidden of ["raw_json", "target_locator", "recommendation_metadata", "content_fingerprint", "cookie_file", "config/cookies", "WEIBO_COOKIE_FILE", "token"]) {
    assert.equal(text.includes(forbidden), false, `${forbidden} must not appear in ${context}`);
  }
}

function runPythonSnippet(code, envOverrides = {}) {
  const result = spawnSync(python, ["-c", code], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_URL: testMysqlUrl,
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_API_URL: "",
      DEEPSEEK_MODEL: "",
      WEIBO_COOKIE_FILE: "/tmp/weibo-cookie-does-not-exist.json",
      MEDIACRAWLER_HOME: "/tmp/mediacrawler-does-not-exist",
      MEDIACRAWLER_PYTHON: "/tmp/python-does-not-exist",
      MEDIACRAWLER_OUTPUT_DIR: "/tmp/weibo-mvp-test-output",
      MEDIACRAWLER_CDP_PORT: "65534",
      WEIBO_FIXTURE_MODE: "1",
      ...envOverrides,
      YUQING_SKIP_ENV_FILE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}
