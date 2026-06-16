import json


ALLOWED_PROPOSAL_TYPES = {
    "comment_analysis",
    "event_draft",
    "strategy_action",
    "report_note",
    "memory_note",
}

ALLOWED_CONFIDENCE = {"low", "medium", "high"}
ALLOWED_WRITE_INTENT = "proposal_only"

REQUIRED_FIELDS = (
    "proposal_type",
    "project_id",
    "agent_loop_run_id",
    "agent_name",
    "stage",
    "facts",
    "inferences",
    "recommendations",
    "write_intent",
    "knowledge_card_ids",
    "raw_model_output_ref",
)

ALLOWED_TOP_LEVEL_FIELDS = set(REQUIRED_FIELDS)
ALLOWED_FACT_FIELDS = {"text", "evidence_ids"}
ALLOWED_INFERENCE_FIELDS = {"text", "confidence", "evidence_ids"}
ALLOWED_RECOMMENDATION_FIELDS = {"text", "risk_notes", "evidence_ids"}

SENSITIVE_KEY_PARTS = (
    "api_key",
    "authorization",
    "cookie",
    "database_url",
    "db_url",
    "dsn",
    "mysql_url",
    "password",
    "prompt",
    "raw_model_output",
    "secret",
    "stderr",
    "token",
    "traceback",
    "worker_stderr",
)

SENSITIVE_VALUE_MARKERS = (
    ".env",
    "api_key",
    "bearer ",
    "config/cookies",
    "cookie",
    "database_url",
    "db_url",
    "deepseek_api_key",
    "dsn",
    "mariadb://",
    "mysql://",
    "mysql+pymysql://",
    "prompt text",
    "raw model output",
    "stderr",
    "sub=",
    "token",
    "traceback",
    "weibo.json",
)


def validate_crewai_proposal(payload):
    parsed, error = _coerce_payload(payload)
    if error:
        return invalid_proposal_error()

    if _contains_sensitive_key(parsed):
        return invalid_proposal_error()

    missing_fields = [field for field in REQUIRED_FIELDS if field not in parsed]
    if missing_fields:
        return invalid_proposal_error()

    if set(parsed.keys()) != ALLOWED_TOP_LEVEL_FIELDS:
        return invalid_proposal_error()

    if parsed.get("write_intent") != ALLOWED_WRITE_INTENT:
        return write_intent_not_allowed_error()

    if _contains_sensitive_value(parsed):
        return invalid_proposal_error()

    if not _valid_base_shape(parsed):
        return invalid_proposal_error()

    evidence_error = _validate_evidence_bound_sections(parsed)
    if evidence_error:
        return evidence_error

    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "proposal": _normalized_proposal(parsed),
    }


def _coerce_payload(payload):
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return None, "invalid_json"
    if not isinstance(payload, dict):
        return None, "not_object"
    return payload, None


def _valid_base_shape(payload):
    if payload.get("proposal_type") not in ALLOWED_PROPOSAL_TYPES:
        return False
    if not _positive_int(payload.get("project_id")):
        return False
    if not _positive_int(payload.get("agent_loop_run_id")):
        return False
    if not _non_empty_string(payload.get("agent_name")):
        return False
    if not _non_empty_string(payload.get("stage")):
        return False
    if not isinstance(payload.get("knowledge_card_ids"), list):
        return False
    if not all(_positive_int(item) for item in payload["knowledge_card_ids"]):
        return False
    raw_ref = payload.get("raw_model_output_ref")
    if raw_ref is not None and not _non_empty_string(raw_ref):
        return False
    for section in ("facts", "inferences", "recommendations"):
        if not isinstance(payload.get(section), list):
            return False
    return True


def _validate_evidence_bound_sections(payload):
    for item in payload["facts"]:
        if _has_unknown_fields(item, ALLOWED_FACT_FIELDS):
            return invalid_proposal_error()
        if not _valid_claim_item(item):
            return invalid_proposal_error()
        if not _valid_evidence_ids(item.get("evidence_ids")):
            return evidence_required_error()

    for item in payload["inferences"]:
        if _has_unknown_fields(item, ALLOWED_INFERENCE_FIELDS):
            return invalid_proposal_error()
        if not _valid_claim_item(item):
            return invalid_proposal_error()
        if item.get("confidence") not in ALLOWED_CONFIDENCE:
            return invalid_proposal_error()
        if not _valid_evidence_ids(item.get("evidence_ids")):
            return evidence_required_error()

    for item in payload["recommendations"]:
        if _has_unknown_fields(item, ALLOWED_RECOMMENDATION_FIELDS):
            return invalid_proposal_error()
        if not _valid_claim_item(item):
            return invalid_proposal_error()
        if not isinstance(item.get("risk_notes"), list):
            return invalid_proposal_error()
        if not all(isinstance(note, str) for note in item["risk_notes"]):
            return invalid_proposal_error()
        if not _valid_evidence_ids(item.get("evidence_ids")):
            return evidence_required_error()

    return None


def _has_unknown_fields(item, allowed_fields):
    return not isinstance(item, dict) or bool(set(item.keys()) - allowed_fields)


def _valid_claim_item(item):
    return isinstance(item, dict) and _non_empty_string(item.get("text"))


def _valid_evidence_ids(value):
    return isinstance(value, list) and bool(value) and all(_non_empty_string(item) for item in value)


def _normalized_proposal(payload):
    return {
        "proposal_type": payload["proposal_type"],
        "project_id": payload["project_id"],
        "agent_loop_run_id": payload["agent_loop_run_id"],
        "agent_name": payload["agent_name"],
        "stage": payload["stage"],
        "facts": payload["facts"],
        "inferences": payload["inferences"],
        "recommendations": payload["recommendations"],
        "write_intent": payload["write_intent"],
        "knowledge_card_ids": payload["knowledge_card_ids"],
        "raw_model_output_ref": payload["raw_model_output_ref"],
    }


def _positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def _contains_sensitive_key(value):
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered != "raw_model_output_ref" and any(part in lowered for part in SENSITIVE_KEY_PARTS):
                return True
            if _contains_sensitive_key(item):
                return True
    if isinstance(value, list):
        return any(_contains_sensitive_key(item) for item in value)
    return False


def _contains_sensitive_value(value):
    if isinstance(value, dict):
        return any(_contains_sensitive_value(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_sensitive_value(item) for item in value)
    if isinstance(value, str):
        lowered = value.lower()
        return any(marker in lowered for marker in SENSITIVE_VALUE_MARKERS)
    return False


def invalid_proposal_error():
    return proposal_error(
        "crewai_invalid_proposal",
        "CrewAI proposal is invalid.",
        "The proposal must match the public proposal schema and pass sanitization.",
        "Return a structured proposal_only JSON object with valid enum values, confidence, evidence IDs, and no sensitive content.",
    )


def write_intent_not_allowed_error():
    return proposal_error(
        "crewai_write_intent_not_allowed",
        "CrewAI write intent is not allowed.",
        "CrewAI output may only request proposal review in this adapter boundary.",
        "Set write_intent to proposal_only and let the Harness decide any future write.",
    )


def evidence_required_error():
    return proposal_error(
        "crewai_evidence_required",
        "CrewAI proposal requires evidence IDs.",
        "Facts, inferences, and recommendations must cite scoped evidence IDs.",
        "Attach at least one Harness-provided evidence ID to each factual proposal item.",
    )


def proposal_error(error_type, message, cause, fix):
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": error_type,
        "message": message,
        "cause": cause,
        "fix": fix,
    }
