import os
import re

os.environ["YUQING_SKIP_ENV_FILE"] = "1"

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .crewai_proposal_service import CrewAIProposalService, agent_run_not_found_error
from .crewai_tools import _sensitive_key as crewai_sensitive_key
from .crewai_tools import _sensitive_value as crewai_sensitive_value
from .judge_review_service import JudgeReviewService
from .legacy_worker import (
    ALLOWED_LEGACY_COMMANDS,
    LegacyWorkerAdapter,
    command_not_allowed_error,
    mysql_unavailable_error,
    sanitize_for_public,
)
from .report_backtest_agent_service import (
    ReportBacktestAgentService,
    action_backtest_public_response,
    build_action_backtest_service_payload,
    build_daily_report_service_payload,
    daily_report_public_response,
    invalid_action_id_error,
    validate_action_backtest_payload,
    validate_daily_report_payload,
)


PUBLIC_AGENT_LOOP_MODES = {"manual", "scheduled", "after_collection"}
PUBLIC_CREWAI_PROPOSAL_FIELDS = {"projectId", "stage", "evidenceIds", "knowledgeQuery"}
PUBLIC_JUDGE_REVIEW_FIELDS = {"projectId", "proposalAuditId", "stepRunId", "maxAttempts", "maxRetries", "fixtureOutputs"}
PUBLIC_PLATFORM_COLLECTION_FIELDS = {"projectId", "platform", "query", "keywords", "limit", "cursor"}
ALLOWED_PLATFORM_COLLECTIONS = {"bilibili", "xiaohongshu"}
PLATFORM_COLLECTION_PRIVATE_RESPONSE_KEYS = {
    "browser_state",
    "browser_state_ref",
    "browserstate",
    "browserstateref",
    "login_state",
    "loginstate",
    "path",
    "private",
    "private_login_state",
    "privateloginstate",
    "raw_output",
    "raw_runner_output",
    "raw_stderr",
    "raw_stdout",
    "rawoutput",
    "rawrunneroutput",
    "rawstderr",
    "rawstdout",
    "storage_state",
    "storage_state_ref",
    "storagestate",
    "storagestateref",
    "stderr",
    "stdout",
}
PLATFORM_COLLECTION_PRIVATE_VALUE_MARKERS = (
    "raw runner output",
    "raw_stdout",
    "raw-stdout",
    "rawstderr",
    "collector transcript",
    "collector_transcript",
    "browser state",
    "storage state",
    "login state",
    "private login state",
)
PLATFORM_COLLECTION_PRIVATE_VALUE_COMPACT_MARKERS = tuple(
    re.sub(r"[^a-z0-9]", "", marker) for marker in PLATFORM_COLLECTION_PRIVATE_VALUE_MARKERS
)
CREWAI_DANGEROUS_MARKERS = (
    ".env",
    "api_key",
    "bearer ",
    "database_url",
    "db_url",
    "dsn",
    "mariadb://",
    "mysql://",
    "mysql+pymysql://",
    "config/cookies",
    "weibo.json",
    "cookie",
    "raw_model_output",
    "secret",
    "token",
    "prompt",
    "traceback",
    "stderr",
    "raw model output",
)
JUDGE_DANGEROUS_KEYS = {
    "module",
    "runtime",
}
CREWAI_EVIDENCE_ID_PATTERN = re.compile(r"^(comment|post|target|event|action|memory|sentiment):[1-9][0-9]*$")


def create_app(
    legacy_adapter=None,
    crewai_proposal_service=None,
    judge_review_service=None,
    platform_collection_services=None,
    report_backtest_agent_service=None,
):
    adapter = legacy_adapter or LegacyWorkerAdapter()
    proposal_service = crewai_proposal_service or CrewAIProposalService()
    judge_service = judge_review_service or JudgeReviewService()
    collection_services = platform_collection_services or {}
    report_backtest_service = report_backtest_agent_service or ReportBacktestAgentService()
    api = FastAPI(title="Yuqing FastAPI Sidecar", version="0.1.0")

    @api.get("/health")
    async def health():
        return health_payload(adapter)

    @api.post("/api/weibo/agent-loop/run")
    async def run_agent_loop(request: Request):
        payload, error = await read_json_object(request, "invalid_agent_loop_payload", "Agent Loop payload")
        if error:
            return json_error(error, 400)

        validation_error = validate_agent_loop_payload(payload)
        if validation_error:
            return json_error(validation_error, 400)

        worker_payload = build_agent_loop_worker_payload(payload)
        result = sanitize_for_public(adapter.run_agent_loop(worker_payload))
        return JSONResponse(agent_loop_run_response(result), status_code=status_for(result))

    @api.get("/api/weibo/agent-runs/{run_id}")
    async def get_agent_run(run_id: str, request: Request):
        parsed_id = positive_integer(run_id)
        if parsed_id is None:
            return json_error(agent_loop_error(
                "invalid_agent_run_id",
                "Agent Loop run id is invalid.",
                "The path id must be a positive integer.",
                "Retry with an agentLoopRunId returned by POST /api/weibo/agent-loop/run.",
            ), 400)

        query_payload = dict(request.query_params)
        project_id = optional_positive_integer(query_payload.get("projectId"))
        if "projectId" in query_payload and project_id is None:
            return json_error(agent_loop_error(
                "invalid_project_id",
                "Agent Loop status requires a valid projectId.",
                "The query projectId must be a positive integer when provided.",
                "Pass a positive integer projectId or omit it to use the default project.",
            ), 400)

        worker_payload = {}
        if project_id is not None:
            worker_payload["projectId"] = project_id

        result = sanitize_for_public(adapter.get_agent_run(parsed_id, worker_payload))
        return JSONResponse(agent_loop_status_response(result, parsed_id), status_code=status_for(result))

    @api.post("/api/weibo/agent-runs/{run_id}/crewai/proposals")
    async def create_crewai_proposal(run_id: str, request: Request):
        parsed_id = positive_integer(run_id)
        if parsed_id is None:
            return json_error(agent_loop_error(
                "invalid_agent_run_id",
                "Agent Loop run id is invalid.",
                "The path id must be a positive integer.",
                "Retry with an agentLoopRunId returned by POST /api/weibo/agent-loop/run.",
            ), 400)

        payload, error = await read_json_object(request, "invalid_crewai_proposal_payload", "CrewAI proposal payload")
        if error:
            return json_error(error, 400)

        validation_error = validate_crewai_proposal_request_payload(payload)
        if validation_error:
            return json_error(validation_error, 400)

        project_id = optional_positive_integer(payload.get("projectId"))
        if not proposal_service.is_mysql_available():
            return json_error(mysql_unavailable_error(), 503)

        if not proposal_service.has_agent_run(parsed_id, project_id):
            return json_error(agent_run_not_found_error(parsed_id, project_id), 404)

        service_payload = build_crewai_proposal_service_payload(payload)
        result = sanitize_for_public(proposal_service.create_proposal(parsed_id, service_payload))
        return JSONResponse(result, status_code=status_for(result))

    @api.post("/api/weibo/agent-runs/{run_id}/judge/reviews")
    async def create_judge_review(run_id: str, request: Request):
        parsed_id = positive_integer(run_id)
        if parsed_id is None:
            return json_error(agent_loop_error(
                "invalid_agent_run_id",
                "Agent Loop run id is invalid.",
                "The path id must be a positive integer.",
                "Retry with an agentLoopRunId returned by POST /api/weibo/agent-loop/run.",
            ), 400)

        payload, error = await read_json_object(request, "invalid_judge_review_payload", "Judge review payload")
        if error:
            return json_error(error, 400)

        validation_error = validate_judge_review_request_payload(payload)
        if validation_error:
            return json_error(validation_error, 400)

        project_id = optional_positive_integer(payload.get("projectId"))
        if not judge_service.is_mysql_available():
            return json_error(mysql_unavailable_error(), 503)

        if not judge_service.has_agent_run(parsed_id, project_id):
            return json_error(agent_run_not_found_error(parsed_id, project_id), 404)

        service_payload = build_judge_review_service_payload(payload)
        result = sanitize_for_public(judge_service.create_review(parsed_id, service_payload))
        return JSONResponse(result, status_code=status_for(result))

    @api.post("/api/weibo/agent-runs/{run_id}/reports/daily")
    async def create_daily_report(run_id: str, request: Request):
        parsed_id = positive_integer(run_id)
        if parsed_id is None:
            return json_error(agent_loop_error(
                "invalid_agent_run_id",
                "Agent Loop run id is invalid.",
                "The path id must be a positive integer.",
                "Retry with an agentLoopRunId returned by POST /api/weibo/agent-loop/run.",
            ), 400)

        payload, error = await read_json_object(request, "report_backtest_payload_rejected", "Daily report payload")
        if error:
            error["error_type"] = "report_backtest_payload_rejected"
            return json_error(error, 400)

        validation_error = validate_daily_report_payload(payload)
        if validation_error:
            return json_error(validation_error, status_for(validation_error))

        if not report_backtest_service.is_mysql_available():
            return json_error(mysql_unavailable_error(), 503)

        service_payload = build_daily_report_service_payload(payload)
        result = daily_report_public_response(
            report_backtest_service.create_daily_report(parsed_id, service_payload),
            {**service_payload, "agent_loop_run_id": parsed_id},
        )
        return JSONResponse(result, status_code=status_for(result))

    @api.post("/api/weibo/agent-runs/{run_id}/actions/{action_id}/backtests")
    async def create_action_backtest(run_id: str, action_id: str, request: Request):
        parsed_id = positive_integer(run_id)
        if parsed_id is None:
            return json_error(agent_loop_error(
                "invalid_agent_run_id",
                "Agent Loop run id is invalid.",
                "The path id must be a positive integer.",
                "Retry with an agentLoopRunId returned by POST /api/weibo/agent-loop/run.",
            ), 400)

        parsed_action_id = positive_integer(action_id)
        if parsed_action_id is None:
            return json_error(invalid_action_id_error(), 400)

        payload, error = await read_json_object(request, "report_backtest_payload_rejected", "Action backtest payload")
        if error:
            error["error_type"] = "report_backtest_payload_rejected"
            return json_error(error, 400)

        validation_error = validate_action_backtest_payload(payload)
        if validation_error:
            return json_error(validation_error, status_for(validation_error))

        if not report_backtest_service.is_mysql_available():
            return json_error(mysql_unavailable_error(), 503)

        service_payload = build_action_backtest_service_payload(payload)
        result = action_backtest_public_response(
            report_backtest_service.create_action_backtest(parsed_id, parsed_action_id, service_payload),
            {**service_payload, "agent_loop_run_id": parsed_id, "action_id": parsed_action_id},
        )
        return JSONResponse(result, status_code=status_for(result))

    @api.post("/api/internal/agent-runs/{run_id}/platform-collections")
    async def trigger_platform_collection(run_id: str, request: Request):
        parsed_id = positive_integer(run_id)
        if parsed_id is None:
            return json_error(agent_loop_error(
                "invalid_agent_run_id",
                "Agent Loop run id is invalid.",
                "The path id must be a positive integer.",
                "Retry with an agentLoopRunId returned by POST /api/weibo/agent-loop/run.",
            ), 400)

        payload, error = await read_json_object(request, "invalid_platform_collection_payload", "Platform collection payload")
        if error:
            return json_error(error, 400)

        validation_error = validate_platform_collection_request_payload(payload)
        if validation_error:
            return json_error(validation_error, status_for(validation_error))

        service_payload = build_platform_collection_service_payload(parsed_id, payload)
        service = collection_services.get(service_payload["platform"])
        result = call_platform_collection_service(service, service_payload)
        safe_result = sanitize_platform_collection_public(result)
        if not is_plain_object(safe_result):
            safe_result = platform_collection_service_unavailable_error()
        return JSONResponse(safe_result, status_code=status_for(safe_result))

    @api.post("/api/tools/legacy-worker/{command}")
    async def legacy_worker_tool(command: str, request: Request):
        if command not in ALLOWED_LEGACY_COMMANDS:
            return json_error(command_not_allowed_error(command), 400)
        payload, error = await read_json_object(request, "invalid_legacy_worker_payload", "Legacy worker payload")
        if error:
            return json_error(error, 400)
        result = sanitize_for_public(adapter.call(command, payload))
        return JSONResponse(result, status_code=status_for(result))

    return api


def health_payload(adapter=None):
    base = {"service": "fastapi-sidecar"}
    legacy_worker = legacy_worker_readiness(adapter)
    if not os.environ.get("MYSQL_URL"):
        return {
            **base,
            "ok": False,
            "mysql": {"connected": False, "configured": False},
            "legacy_worker": legacy_worker,
            "error_type": "mysql_unavailable",
            "message": "MySQL is not available for the FastAPI sidecar.",
            "cause": "MYSQL_URL is not configured.",
            "fix": "Configure MYSQL_URL for real ledger access, or inject a test adapter for fixture validation.",
        }

    try:
        from workers import db

        status = db.health()
    except Exception:
        status = {"connected": False}
    mysql_status = {
        "connected": bool(status.get("connected")),
        "configured": True,
    }

    if status.get("connected"):
        if legacy_worker.get("configured") is True:
            return {**base, "ok": True, "mysql": mysql_status, "legacy_worker": legacy_worker}
        return {
            **base,
            "ok": False,
            "mysql": mysql_status,
            "legacy_worker": legacy_worker,
            "error_type": legacy_worker.get("error_type", "legacy_adapter_unavailable"),
            "message": legacy_worker.get("message", "Legacy worker adapter is not configured."),
            "cause": legacy_worker.get("cause", "Legacy worker adapter readiness did not report configured=true."),
            "fix": legacy_worker.get("fix", "Restore the legacy worker adapter configuration before serving Harness traffic."),
        }
    return {
        **base,
        "ok": False,
        "mysql": mysql_status,
        "legacy_worker": legacy_worker,
        "error_type": "mysql_unavailable",
        "message": "MySQL is not available for the FastAPI sidecar.",
        "cause": "MySQL is configured but the sidecar cannot reach it.",
        "fix": "Verify the local database is running and MYSQL_URL points to the Harness ledger.",
    }


def legacy_worker_readiness(adapter=None):
    try:
        readiness = adapter.readiness() if adapter and hasattr(adapter, "readiness") else {}
    except Exception:
        readiness = {
            "configured": False,
            "error_type": "legacy_adapter_unavailable",
            "message": "Legacy worker adapter readiness check failed.",
            "cause": "The adapter raised while reporting readiness.",
            "fix": "Inspect the adapter configuration and retry the health check.",
        }

    readiness = sanitize_for_public(readiness)
    if not is_plain_object(readiness):
        readiness = {}
    if "configured" not in readiness:
        readiness = {
            **readiness,
            "configured": False,
            "error_type": "legacy_adapter_unavailable",
            "message": "Legacy worker adapter is not configured.",
            "cause": "The adapter did not report readiness.",
            "fix": "Use a LegacyWorkerAdapter with a readiness report before serving Harness traffic.",
        }
    return readiness


async def read_json_object(request, error_type, label):
    try:
        payload = await request.json()
    except Exception as exc:
        return None, agent_loop_error(
            error_type,
            f"{label} must be valid JSON.",
            str(exc),
            "Send a valid JSON object request body.",
        )
    if not is_plain_object(payload):
        return None, agent_loop_error(
            error_type,
            f"{label} must be a JSON object.",
            f"Received {'array' if isinstance(payload, list) else type(payload).__name__}.",
            "Pass a JSON object request body.",
        )
    return payload, None


def validate_agent_loop_payload(payload):
    project_id = optional_positive_integer(payload.get("projectId"))
    if "projectId" in payload and project_id is None:
        return agent_loop_error(
            "invalid_project_id",
            "Agent Loop run requires a valid projectId.",
            "The public payload projectId must be a positive integer when provided.",
            "Pass a positive integer projectId or omit it to use the default project.",
        )

    target_id = optional_positive_integer(payload.get("targetId"))
    if "targetId" in payload and target_id is None:
        return agent_loop_error(
            "invalid_agent_loop_payload",
            "Agent Loop run targetId is invalid.",
            "The public payload targetId must be a positive integer when provided.",
            "Pass a positive integer targetId or omit it.",
        )

    mode = payload.get("mode", "manual")
    if mode not in PUBLIC_AGENT_LOOP_MODES:
        return agent_loop_error(
            "invalid_agent_loop_mode",
            "Agent Loop mode is not public.",
            "The public API only accepts manual, scheduled, or after_collection.",
            "Use one of manual, scheduled, or after_collection.",
        )

    if "input" in payload and not is_plain_object(payload["input"]):
        received = "array" if isinstance(payload["input"], list) else type(payload["input"]).__name__
        return agent_loop_error(
            "invalid_agent_loop_payload",
            "Agent Loop input must be a JSON object.",
            f"Received {received}.",
            "Pass input as a JSON object or omit it.",
        )
    return None


def build_agent_loop_worker_payload(payload):
    worker_payload = {"triggerMode": payload.get("mode", "manual")}
    project_id = optional_positive_integer(payload.get("projectId"))
    target_id = optional_positive_integer(payload.get("targetId"))
    if project_id is not None:
        worker_payload["projectId"] = project_id
    if target_id is not None:
        worker_payload["targetId"] = target_id
    if "input" in payload:
        worker_payload["input"] = payload["input"]
    return worker_payload


def validate_crewai_proposal_request_payload(payload):
    unknown_fields = set(payload.keys()) - PUBLIC_CREWAI_PROPOSAL_FIELDS
    if unknown_fields:
        return agent_loop_error(
            "invalid_crewai_proposal_payload",
            "CrewAI proposal payload contains unsupported public fields.",
            "Unsupported public fields were provided.",
            "Only pass projectId, stage, evidenceIds, and knowledgeQuery.",
        )

    project_id = optional_positive_integer(payload.get("projectId"))
    if project_id is None:
        return agent_loop_error(
            "invalid_project_id",
            "CrewAI proposal requires a valid projectId.",
            "The public payload projectId must be a positive integer.",
            "Pass a positive integer projectId from the existing Agent Loop run.",
        )

    stage = payload.get("stage")
    if not isinstance(stage, str) or not stage.strip():
        return agent_loop_error(
            "invalid_crewai_proposal_payload",
            "CrewAI proposal requires a stage.",
            "The public payload stage must be a non-empty string.",
            "Pass the current Agent Loop stage for this proposal request.",
        )
    if contains_dangerous_crewai_value(stage):
        return dangerous_crewai_value_error("stage")

    evidence_ids = payload.get("evidenceIds")
    if evidence_ids is not None:
        if not isinstance(evidence_ids, list) or not evidence_ids or not all(isinstance(item, str) and item.strip() for item in evidence_ids):
            return agent_loop_error(
                "invalid_crewai_proposal_payload",
                "CrewAI proposal evidenceIds are invalid.",
                "The public payload evidenceIds must be a non-empty array of strings when provided.",
                "Pass Harness-scoped evidence IDs only, or omit the field.",
            )
        for item in evidence_ids:
            if contains_dangerous_crewai_value(item) or not CREWAI_EVIDENCE_ID_PATTERN.match(item.strip()):
                return agent_loop_error(
                    "invalid_crewai_proposal_payload",
                    "CrewAI proposal evidenceIds are invalid.",
                    "Evidence IDs must use the public Harness evidence grammar and must not contain dangerous markers.",
                    "Pass evidence IDs like comment:123, event:7, action:9, memory:4, target:2, post:5, or sentiment:3.",
                )

    knowledge_query = payload.get("knowledgeQuery")
    if knowledge_query is not None and (not isinstance(knowledge_query, str) or not knowledge_query.strip()):
        return agent_loop_error(
            "invalid_crewai_proposal_payload",
            "CrewAI proposal knowledgeQuery is invalid.",
            "The public payload knowledgeQuery must be a non-empty string when provided.",
            "Pass a non-empty knowledge query or omit the field.",
        )
    if knowledge_query is not None and contains_dangerous_crewai_value(knowledge_query):
        return dangerous_crewai_value_error("knowledgeQuery")
    return None


def build_crewai_proposal_service_payload(payload):
    service_payload = {
        "projectId": optional_positive_integer(payload.get("projectId")),
        "stage": payload.get("stage", "").strip(),
    }
    evidence_ids = payload.get("evidenceIds")
    if evidence_ids is not None:
        service_payload["evidenceIds"] = evidence_ids
    knowledge_query = payload.get("knowledgeQuery")
    if isinstance(knowledge_query, str) and knowledge_query.strip():
        service_payload["knowledgeQuery"] = knowledge_query.strip()
    return service_payload


def validate_judge_review_request_payload(payload):
    unknown_fields = set(payload.keys()) - PUBLIC_JUDGE_REVIEW_FIELDS
    if unknown_fields:
        return invalid_judge_review_payload_error(
            "Judge review payload contains unsupported public fields.",
            "Unsupported public fields were provided.",
            "Only pass projectId, proposalAuditId, stepRunId, maxAttempts, maxRetries, and fixtureOutputs.",
        )

    if contains_dangerous_judge_value(payload):
        return invalid_judge_review_payload_error(
            "Judge review payload contains unsafe public values.",
            "The public Judge review payload contains blocked diagnostic, credential, storage, database, or model internals content.",
            "Remove blocked diagnostic, credential, storage, database, and model internals content.",
        )

    project_id = optional_positive_integer(payload.get("projectId"))
    if project_id is None:
        return agent_loop_error(
            "invalid_project_id",
            "Judge review requires a valid projectId.",
            "The public payload projectId must be a positive integer.",
            "Pass a positive integer projectId from the existing Agent Loop run.",
        )

    proposal_audit_id = None
    if "proposalAuditId" in payload:
        proposal_audit_id = optional_positive_integer(payload.get("proposalAuditId"))
    if "proposalAuditId" in payload and proposal_audit_id is None:
        return invalid_judge_review_payload_error(
            "Judge review requires a valid proposalAuditId.",
            "The public payload proposalAuditId must be a positive integer.",
            "Pass a proposalAuditId returned by the CrewAI proposal Harness.",
        )

    step_run_id = None
    if "stepRunId" in payload:
        step_run_id = optional_positive_integer(payload.get("stepRunId"))
    if "stepRunId" in payload and step_run_id is None:
        return invalid_judge_review_payload_error(
            "Judge review stepRunId is invalid.",
            "The public payload stepRunId must be a positive integer when provided.",
            "Pass a positive integer stepRunId or omit it.",
        )

    if proposal_audit_id is None and step_run_id is None:
        return invalid_judge_review_payload_error(
            "Judge review requires a proposalAuditId or stepRunId.",
            "The public payload did not include a CrewAI proposal audit id or an allowlisted Agent Loop step id.",
            "Pass proposalAuditId with fixtureOutputs, or pass stepRunId for an allowlisted step-output review.",
        )

    if "maxAttempts" in payload and optional_positive_integer(payload.get("maxAttempts")) is None:
        return invalid_judge_review_payload_error(
            "Judge review maxAttempts is invalid.",
            "The public payload maxAttempts must be a positive integer when provided.",
            "Pass maxAttempts between 1 and 3, or omit it.",
        )

    if "maxRetries" in payload and optional_positive_integer(payload.get("maxRetries")) is None:
        return invalid_judge_review_payload_error(
            "Judge review maxRetries is invalid.",
            "The public payload maxRetries must be a positive integer when provided.",
            "Pass maxRetries as a compatibility alias, or omit it.",
        )

    fixture_outputs = payload.get("fixtureOutputs")
    if fixture_outputs is None:
        if step_run_id is None:
            return invalid_judge_review_payload_error(
                "Judge review fixtureOutputs or stepRunId are required.",
                "This request did not include fake outputs or an allowlisted Agent Loop step id to review.",
                "Pass fixtureOutputs as a non-empty array, or pass stepRunId for an allowlisted step-output review.",
            )
        return None
    if proposal_audit_id is None:
        return invalid_judge_review_payload_error(
            "Judge review fixtureOutputs require a proposalAuditId.",
            "Service-level fake outputs must remain scoped to a CrewAI proposal audit source.",
            "Pass a proposalAuditId with fixtureOutputs, or omit fixtureOutputs when reviewing an allowlisted stepRunId.",
        )
    if not isinstance(fixture_outputs, list) or not fixture_outputs:
        return invalid_judge_review_payload_error(
            "Judge review fixtureOutputs are invalid.",
            "When provided, fixtureOutputs must be a non-empty array.",
            "Pass fixtureOutputs as a non-empty array, or omit it when reviewing an allowlisted stepRunId.",
        )
    if not all(is_plain_object(item) for item in fixture_outputs):
        return invalid_judge_review_payload_error(
            "Judge review fixtureOutputs are invalid.",
            "Each fixtureOutputs item must be a JSON object.",
            "Pass each fixture output as an object with an output object.",
        )
    return None


def build_judge_review_service_payload(payload):
    max_attempts = optional_positive_integer(payload.get("maxAttempts"))
    if max_attempts is None:
        max_retries = optional_positive_integer(payload.get("maxRetries"))
        max_attempts = max_retries if max_retries is not None else 3
    max_attempts = min(max_attempts, 3)

    service_payload = {
        "projectId": optional_positive_integer(payload.get("projectId")),
        "maxAttempts": max_attempts,
    }
    proposal_audit_id = optional_positive_integer(payload.get("proposalAuditId"))
    if proposal_audit_id is not None:
        service_payload["proposalAuditId"] = proposal_audit_id
    step_run_id = optional_positive_integer(payload.get("stepRunId"))
    if step_run_id is not None:
        service_payload["stepRunId"] = step_run_id
    if "fixtureOutputs" in payload:
        service_payload["fixtureOutputs"] = payload["fixtureOutputs"]
    return service_payload


def validate_platform_collection_request_payload(payload):
    unknown_fields = set(payload.keys()) - PUBLIC_PLATFORM_COLLECTION_FIELDS
    if unknown_fields:
        return platform_collection_payload_rejected_error()

    if contains_dangerous_platform_collection_value(payload):
        return platform_collection_payload_rejected_error()

    project_id = optional_positive_integer(payload.get("projectId"))
    if project_id is None:
        return agent_loop_error(
            "invalid_project_id",
            "Platform collection requires a valid projectId.",
            "The internal payload projectId must be a positive integer.",
            "Pass a positive integer projectId from the existing Agent Loop run.",
        )

    platform = normalize_platform_collection(payload.get("platform"))
    if platform not in ALLOWED_PLATFORM_COLLECTIONS:
        return platform_collection_not_allowed_error()

    if "query" in payload and (not isinstance(payload.get("query"), str) or not payload.get("query").strip()):
        return platform_collection_payload_rejected_error()

    if "keywords" in payload:
        keywords = payload.get("keywords")
        if not isinstance(keywords, list) or not all(isinstance(item, str) and item.strip() for item in keywords):
            return platform_collection_payload_rejected_error()

    if "limit" in payload and optional_positive_integer(payload.get("limit")) is None:
        return platform_collection_payload_rejected_error()

    if "cursor" in payload and not isinstance(payload.get("cursor"), str):
        return platform_collection_payload_rejected_error()
    return None


def build_platform_collection_service_payload(run_id, payload):
    project_id = optional_positive_integer(payload.get("projectId"))
    platform = normalize_platform_collection(payload.get("platform"))
    service_payload = {
        "projectId": project_id,
        "project_id": project_id,
        "platform": platform,
        "agentLoopRunId": run_id,
    }

    query = payload.get("query")
    if isinstance(query, str) and query.strip():
        service_payload["query"] = query.strip()

    keywords = payload.get("keywords")
    if isinstance(keywords, list):
        service_payload["keywords"] = [item.strip() for item in keywords if isinstance(item, str) and item.strip()]

    limit = optional_positive_integer(payload.get("limit"))
    if limit is not None:
        service_payload["limit"] = limit

    cursor = payload.get("cursor")
    if isinstance(cursor, str) and cursor.strip():
        service_payload["cursor"] = cursor.strip()
    return service_payload


def call_platform_collection_service(service, payload):
    if service is None:
        return platform_collection_service_unavailable_error()

    try:
        if hasattr(service, "collect") and callable(service.collect):
            result = service.collect(payload)
        elif callable(service):
            result = service(payload)
        else:
            return platform_collection_service_unavailable_error()
    except Exception:
        return platform_collection_service_unavailable_error()

    if not is_plain_object(result):
        return platform_collection_service_unavailable_error()
    return result


def normalize_platform_collection(value):
    if not isinstance(value, str):
        return None
    return value.strip().lower()


def contains_dangerous_platform_collection_value(value):
    if isinstance(value, dict):
        return any(contains_dangerous_platform_collection_value(item) for item in value.values())
    if isinstance(value, list):
        return any(contains_dangerous_platform_collection_value(item) for item in value)
    if isinstance(value, str):
        return contains_platform_collection_private_string(value)
    return False


def sanitize_platform_collection_public(value):
    return strip_platform_collection_private_response(sanitize_for_public(value))


def strip_platform_collection_private_response(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if is_platform_collection_private_response_key(key):
                continue
            sanitized_item = strip_platform_collection_private_response(item)
            if sanitized_item is not None:
                result[key] = sanitized_item
        return result
    if isinstance(value, list):
        result = []
        for item in value:
            sanitized_item = strip_platform_collection_private_response(item)
            if sanitized_item is not None:
                result.append(sanitized_item)
        return result
    if isinstance(value, str) and contains_platform_collection_private_string(value):
        return None
    return value


def is_platform_collection_private_response_key(key):
    normalized = normalize_public_key(key)
    compact = re.sub(r"[^a-z0-9]", "", normalized)
    if normalized in PLATFORM_COLLECTION_PRIVATE_RESPONSE_KEYS or compact in PLATFORM_COLLECTION_PRIVATE_RESPONSE_KEYS:
        return True
    if "stdout" in compact or "stderr" in compact:
        return True
    if "private" in compact or "loginstate" in compact:
        return True
    return "raw" in compact and ("output" in compact or "runner" in compact)


def normalize_public_key(key):
    text = str(key).replace("-", "_").replace(" ", "_")
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    return re.sub(r"_+", "_", text).lower()


def contains_platform_collection_private_string(value):
    if contains_dangerous_crewai_value(value):
        return True

    lowered = str(value).lower()
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    if any(marker in lowered for marker in PLATFORM_COLLECTION_PRIVATE_VALUE_MARKERS):
        return True
    if any(marker and marker in compact for marker in PLATFORM_COLLECTION_PRIVATE_VALUE_COMPACT_MARKERS):
        return True
    if "raw" in compact and ("stdout" in compact or "stderr" in compact):
        return True
    if "raw" in compact and "runner" in compact and "output" in compact:
        return True
    if "collector" in compact and "transcript" in compact:
        return True
    if "browser" in compact and ("state" in compact or "storage" in compact or "login" in compact):
        return True
    if "storage" in compact and "state" in compact:
        return True
    return "login" in compact and "state" in compact


def platform_collection_payload_rejected_error():
    return agent_loop_error(
        "platform_collection_payload_rejected",
        "Platform collection payload contains unsupported public fields or unsafe values.",
        "The internal payload did not match the allowlisted collection trigger contract.",
        "Only pass projectId, platform, query, keywords, limit, and cursor.",
    )


def platform_collection_not_allowed_error():
    return agent_loop_error(
        "platform_collection_not_allowed",
        "Platform collection is not allowlisted.",
        "The requested platform is not enabled for this internal collection trigger.",
        "Use bilibili or xiaohongshu; keep douyin collection blocked until its safe contract is implemented.",
    )


def platform_collection_service_unavailable_error():
    return agent_loop_error(
        "platform_collection_service_unavailable",
        "Platform collection service is not configured.",
        "No injected collection service is available for this platform.",
        "Inject a FastAPI Harness collection service for the requested allowlisted platform.",
    )


def invalid_judge_review_payload_error(message, cause, fix):
    return agent_loop_error("invalid_judge_review_payload", message, cause, fix)


def contains_dangerous_judge_value(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if dangerous_judge_key(key) or contains_dangerous_judge_value(item):
                return True
        return False
    if isinstance(value, list):
        return any(contains_dangerous_judge_value(item) for item in value)
    if isinstance(value, str):
        return contains_dangerous_crewai_value(value)
    return False


def dangerous_judge_key(key):
    text = str(key)
    normalized = re.sub(r"_+", "_", re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text).replace("-", "_").replace(" ", "_")).lower()
    return normalized in JUDGE_DANGEROUS_KEYS or crewai_sensitive_key(text) or contains_dangerous_crewai_value(text)


def agent_loop_run_response(payload):
    if payload.get("ok") is False:
        return payload
    raw_run = payload.get("run") or {}
    response = {
        **payload,
        "agentLoopRunId": safe_agent_loop_id(payload.get("agentLoopRunId"), raw_run.get("id")),
        "status": payload.get("status", raw_run.get("status")),
    }
    if isinstance(raw_run, dict) and raw_run:
        response["run"] = safe_agent_loop_run(raw_run, response["agentLoopRunId"])
    elif "run" in response:
        response.pop("run", None)
    return response


def dangerous_crewai_value_error(field_name):
    return agent_loop_error(
        "invalid_crewai_proposal_payload",
        "CrewAI proposal payload contains dangerous public values.",
        f"The public field {field_name} contains a blocked marker or unsafe content.",
        "Remove blocked diagnostic, credential, storage, database, and raw output content.",
    )


def contains_dangerous_crewai_value(value):
    text = str(value)
    lowered = text.lower()
    return crewai_sensitive_value(text) or any(marker in lowered for marker in CREWAI_DANGEROUS_MARKERS)


def agent_loop_status_response(payload, fallback_run_id=None):
    if payload.get("ok") is False:
        return payload
    raw_run = payload.get("run") or {}
    judge_reviews = payload.get("judgeReviews") or []
    manual_handoffs = payload.get("manualHandoffs")
    if manual_handoffs is None:
        manual_handoffs = [
            item for item in payload.get("feedbackItems", [])
            if item.get("feedback_type") == "manual_handoff" or item.get("feedbackType") == "manual_handoff"
        ]
    public_payload = {key: value for key, value in payload.items() if key != "feedbackItems"}
    response = {
        **public_payload,
        "agentLoopRunId": safe_agent_loop_id(payload.get("agentLoopRunId"), raw_run.get("id"), fallback_run_id),
        "status": payload.get("status", raw_run.get("status")),
        "currentStep": payload.get("currentStep", raw_run.get("current_step") or raw_run.get("currentStep")),
        "retryCount": payload.get("retryCount", retry_count_from(judge_reviews)),
        "manualHandoffs": manual_handoffs,
    }
    if isinstance(raw_run, dict) and raw_run:
        response["run"] = safe_agent_loop_run(raw_run, response["agentLoopRunId"], fallback_run_id)
    elif "run" in response:
        response.pop("run", None)
    return response


def retry_count_from(judge_reviews):
    retry_count = 0
    for item in judge_reviews:
        count = item.get("retry_count", item.get("retryCount", 0))
        if isinstance(count, int) and count > retry_count:
            retry_count = count
    return retry_count


def safe_agent_loop_id(*values):
    for value in values:
        parsed = positive_integer(value)
        if parsed is not None:
            return parsed
    return None


def safe_agent_loop_run(run, *fallback_ids):
    public_run = dict(run)
    safe_id = safe_agent_loop_id(run.get("id"), *fallback_ids)
    if safe_id is None:
        public_run.pop("id", None)
    else:
        public_run["id"] = safe_id
    return public_run


def optional_positive_integer(value):
    if value is None or value == "":
        return None
    return positive_integer(value)


def positive_integer(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.isdigit() and not value.startswith("0"):
        return int(value)
    return None


def is_plain_object(value):
    return isinstance(value, dict)


def status_for(payload):
    error_type = payload.get("error_type") if isinstance(payload, dict) else None
    if error_type == "mysql_unavailable":
        return 503
    if error_type == "agent_loop_not_found":
        return 404
    if error_type == "judge_review_source_not_found":
        return 404
    if error_type == "action_not_found":
        return 404
    if error_type in {
        "crewai_evidence_rejected",
        "crewai_evidence_required",
        "crewai_invalid_proposal",
        "crewai_tool_not_allowed",
        "crewai_tool_payload_rejected",
        "crewai_write_intent_not_allowed",
        "invalid_agent_loop_payload",
        "invalid_agent_loop_mode",
        "invalid_crewai_proposal_payload",
        "invalid_judge_review_payload",
        "invalid_project_id",
        "invalid_action_id",
        "invalid_agent_run_id",
        "invalid_legacy_worker_payload",
        "invalid_platform_collection_payload",
        "legacy_worker_command_not_allowed",
        "platform_collection_not_allowed",
        "platform_collection_payload_rejected",
        "project_not_found",
        "report_backtest_evidence_rejected",
        "report_backtest_payload_rejected",
    }:
        return 400
    if error_type in {"platform_auth_required", "platform_collection_service_unavailable"}:
        return 503
    if error_type == "report_backtest_runtime_failed":
        return 502
    if error_type == "legacy_worker_failed":
        return 502
    if isinstance(payload, dict) and payload.get("ok") is False:
        return 500
    return 200


def json_error(payload, status_code):
    return JSONResponse(sanitize_for_public(payload), status_code=status_code)


def agent_loop_error(error_type, message, cause, fix):
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": error_type,
        "message": message,
        "cause": cause,
        "fix": fix,
    }


app = create_app()
