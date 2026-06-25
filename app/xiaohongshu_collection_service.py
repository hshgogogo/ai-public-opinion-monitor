from copy import deepcopy

from .agent_reach_adapter import sanitize_agent_reach_public
from .xiaohongshu_normalizer import safe_xiaohongshu_artifact_ref


PLATFORM = "xiaohongshu"
XIAOHONGSHU_COLLECTION_COMMAND = "xiaohongshu_collect"

PUBLIC_REQUEST_FIELDS = frozenset(
    {
        "project_id",
        "query",
        "keywords",
        "limit",
        "cursor",
    }
)

PUBLIC_SUMMARY_FIELDS = frozenset(
    {
        "content_count",
        "evidence_count",
        "warnings",
    }
)

PUBLIC_CONTENT_ITEM_FIELDS = (
    "platform",
    "project_id",
    "external_id",
    "title",
    "text",
    "url",
    "author_external_id",
    "author_display_name",
    "author_url",
    "published_at",
    "metrics",
    "raw_artifact_ref",
    "evidence_ids",
)

PUBLIC_EVIDENCE_SUMMARY_FIELDS = (
    "id",
    "platform",
    "project_id",
    "source_type",
    "external_id",
    "content_item_external_id",
    "author_external_id",
    "author_display_name",
    "author_url",
    "summary",
    "metrics",
    "raw_artifact_ref",
)


class XiaohongshuCollectionService:
    def __init__(self, runner=None, login_state_provider=None):
        self.runner = runner
        self.login_state_provider = login_state_provider

    def collect(self, public_request=None):
        login_state = self._private_login_state()
        if not login_state:
            return xiaohongshu_auth_required_error()
        if self.runner is None:
            return xiaohongshu_runner_failed_error()

        runner_request = {
            "platform": PLATFORM,
            "command": XIAOHONGSHU_COLLECTION_COMMAND,
            "payload": _public_runner_payload(public_request or {}),
            "private": {
                "login_state": login_state,
            },
        }

        try:
            runner_result = self.runner(runner_request)
        except Exception:
            return xiaohongshu_runner_failed_error()

        if not isinstance(runner_result, dict):
            return xiaohongshu_runner_failed_error()

        return _public_collection_result(runner_result)

    def _private_login_state(self):
        if self.login_state_provider is None:
            return None
        try:
            return self.login_state_provider()
        except Exception:
            return None


def xiaohongshu_auth_required_error():
    return {
        "ok": False,
        "platform": PLATFORM,
        "command": XIAOHONGSHU_COLLECTION_COMMAND,
        "status": "failed",
        "error_type": "platform_auth_required",
        "message": "Xiaohongshu collection requires a safe local login provider.",
        "cause": "No injected private login state was available for the controlled runner.",
        "fix": "Configure a local private login provider before running real Xiaohongshu collection.",
    }


def xiaohongshu_runner_failed_error(error_type="xiaohongshu_runner_failed", runner_result=None):
    payload = {
        "ok": False,
        "platform": PLATFORM,
        "command": XIAOHONGSHU_COLLECTION_COMMAND,
        "status": "failed",
        "error_type": _safe_error_type(error_type),
        "message": "Xiaohongshu collection runner failed.",
    }
    if runner_result:
        artifact_ref = safe_xiaohongshu_artifact_ref(runner_result.get("artifact_ref"))
        summary = _public_summary(runner_result.get("summary"))
        if artifact_ref:
            payload["artifact_ref"] = artifact_ref
        if summary:
            payload["summary"] = summary
    return payload


def _public_collection_result(runner_result):
    status = "ok" if runner_result.get("status") == "ok" else "failed"
    if status != "ok":
        return xiaohongshu_runner_failed_error(
            runner_result.get("error_type", "xiaohongshu_runner_failed"),
            runner_result,
        )

    payload = {
        "ok": True,
        "platform": PLATFORM,
        "command": XIAOHONGSHU_COLLECTION_COMMAND,
        "status": "ok",
        "summary": _public_summary(runner_result.get("summary")),
        "content_items": _public_items(
            runner_result.get("content_items"),
            PUBLIC_CONTENT_ITEM_FIELDS,
        ),
        "evidence_summaries": _public_items(
            runner_result.get("evidence_summaries"),
            PUBLIC_EVIDENCE_SUMMARY_FIELDS,
        ),
    }
    artifact_ref = safe_xiaohongshu_artifact_ref(runner_result.get("artifact_ref"))
    if artifact_ref:
        payload["artifact_ref"] = artifact_ref
    return payload


def _public_runner_payload(public_request):
    if not isinstance(public_request, dict):
        return {}
    payload = {}
    for key in PUBLIC_REQUEST_FIELDS:
        if key not in public_request:
            continue
        sanitized = sanitize_agent_reach_public(deepcopy(public_request[key]))
        if sanitized is not None:
            payload[key] = sanitized
    artifact_ref = safe_xiaohongshu_artifact_ref(public_request.get("raw_artifact_ref"))
    if artifact_ref:
        payload["raw_artifact_ref"] = artifact_ref
    return payload


def _public_summary(summary):
    if not isinstance(summary, dict):
        return {}
    public = {}
    for key in PUBLIC_SUMMARY_FIELDS:
        if key not in summary:
            continue
        sanitized = sanitize_agent_reach_public(deepcopy(summary[key]))
        if sanitized is not None:
            public[key] = sanitized
    return public


def _public_items(items, allowed_fields):
    if not isinstance(items, list):
        return []
    public_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        public_item = {}
        for key in allowed_fields:
            if key not in item:
                continue
            sanitized = _safe_public_item_field(key, item[key])
            if sanitized is not None:
                public_item[key] = sanitized
        public_items.append(public_item)
    return public_items


def _safe_public_item_field(key, value):
    if key == "raw_artifact_ref":
        return safe_xiaohongshu_artifact_ref(value)
    return sanitize_agent_reach_public(deepcopy(value))


def _safe_error_type(value):
    sanitized = sanitize_agent_reach_public(value)
    if isinstance(sanitized, str) and sanitized:
        return sanitized
    return "xiaohongshu_runner_failed"
