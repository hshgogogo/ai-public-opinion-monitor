import os
import re

os.environ.setdefault("YUQING_SKIP_ENV_FILE", "1")

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


PUBLIC_AGENT_LOOP_MODES = {"manual", "scheduled", "after_collection"}
PUBLIC_CREWAI_PROPOSAL_FIELDS = {"projectId", "stage", "evidenceIds", "knowledgeQuery"}
PUBLIC_JUDGE_REVIEW_FIELDS = {"projectId", "proposalAuditId", "stepRunId", "maxAttempts", "maxRetries", "fixtureOutputs"}
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


def create_app(legacy_adapter=None, crewai_proposal_service=None, judge_review_service=None):
    adapter = legacy_adapter or LegacyWorkerAdapter()
    proposal_service = crewai_proposal_service or CrewAIProposalService()
    judge_service = judge_review_service or JudgeReviewService()
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
        return JSONResponse(agent_loop_status_response(result), status_code=status_for(result))

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

    proposal_audit_id = optional_positive_integer(payload.get("proposalAuditId"))
    if proposal_audit_id is None:
        return invalid_judge_review_payload_error(
            "Judge review requires a valid proposalAuditId.",
            "The public payload proposalAuditId must be a positive integer.",
            "Pass a proposalAuditId returned by the CrewAI proposal Harness.",
        )

    if "stepRunId" in payload and optional_positive_integer(payload.get("stepRunId")) is None:
        return invalid_judge_review_payload_error(
            "Judge review stepRunId is invalid.",
            "The public payload stepRunId must be a positive integer when provided.",
            "Pass a positive integer stepRunId or omit it.",
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
    if not isinstance(fixture_outputs, list) or not fixture_outputs:
        return invalid_judge_review_payload_error(
            "Judge review fixtureOutputs are required for this fake-output slice.",
            "This slice only supports service-level fake outputs and does not read proposal audit output yet.",
            "Pass fixtureOutputs as a non-empty array, or wait for the proposal audit lookup slice.",
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
        "proposalAuditId": optional_positive_integer(payload.get("proposalAuditId")),
        "maxAttempts": max_attempts,
    }
    step_run_id = optional_positive_integer(payload.get("stepRunId"))
    if step_run_id is not None:
        service_payload["stepRunId"] = step_run_id
    if "fixtureOutputs" in payload:
        service_payload["fixtureOutputs"] = payload["fixtureOutputs"]
    return service_payload


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
    run = payload.get("run") or {}
    return {
        **payload,
        "agentLoopRunId": payload.get("agentLoopRunId", run.get("id")),
        "status": payload.get("status", run.get("status")),
    }


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


def agent_loop_status_response(payload):
    if payload.get("ok") is False:
        return payload
    run = payload.get("run") or {}
    judge_reviews = payload.get("judgeReviews") or []
    manual_handoffs = payload.get("manualHandoffs")
    if manual_handoffs is None:
        manual_handoffs = [
            item for item in payload.get("feedbackItems", [])
            if item.get("feedback_type") == "manual_handoff" or item.get("feedbackType") == "manual_handoff"
        ]
    public_payload = {key: value for key, value in payload.items() if key != "feedbackItems"}
    return {
        **public_payload,
        "agentLoopRunId": payload.get("agentLoopRunId", run.get("id")),
        "status": payload.get("status", run.get("status")),
        "currentStep": payload.get("currentStep", run.get("current_step") or run.get("currentStep")),
        "retryCount": payload.get("retryCount", retry_count_from(judge_reviews)),
        "manualHandoffs": manual_handoffs,
    }


def retry_count_from(judge_reviews):
    retry_count = 0
    for item in judge_reviews:
        count = item.get("retry_count", item.get("retryCount", 0))
        if isinstance(count, int) and count > retry_count:
            retry_count = count
    return retry_count


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
        "invalid_agent_run_id",
        "invalid_legacy_worker_payload",
        "legacy_worker_command_not_allowed",
        "project_not_found",
    }:
        return 400
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
