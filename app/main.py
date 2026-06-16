import os

os.environ.setdefault("YUQING_SKIP_ENV_FILE", "1")

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .legacy_worker import (
    ALLOWED_LEGACY_COMMANDS,
    LegacyWorkerAdapter,
    command_not_allowed_error,
    mysql_unavailable_error,
    sanitize_for_public,
)


PUBLIC_AGENT_LOOP_MODES = {"manual", "scheduled", "after_collection"}


def create_app(legacy_adapter=None):
    adapter = legacy_adapter or LegacyWorkerAdapter()
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


def agent_loop_run_response(payload):
    if payload.get("ok") is False:
        return payload
    run = payload.get("run") or {}
    return {
        **payload,
        "agentLoopRunId": payload.get("agentLoopRunId", run.get("id")),
        "status": payload.get("status", run.get("status")),
    }


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
    if error_type in {
        "invalid_agent_loop_payload",
        "invalid_agent_loop_mode",
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
