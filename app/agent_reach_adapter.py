import re
from copy import deepcopy

from .legacy_worker import sanitize_for_public


ALLOWED_AGENT_REACH_COMMANDS = {
    "bilibili": frozenset({"doctor", "health"}),
    "douyin": frozenset({"doctor", "capability"}),
}

SENSITIVE_AGENT_REACH_KEY_PARTS = (
    "browser_state",
    "browser_storage",
    "collector_transcript",
    "database_url",
    "db_url",
    "mysql_url",
    "raw_stdout",
    "raw_stderr",
    "raw_transcript",
    "storage_state",
    "stdout",
    "worker_stderr",
    "storage",
    "qr",
)

SENSITIVE_AGENT_REACH_KEY_COMPACT = {
    "browserstate",
    "browserstorage",
    "collectortranscript",
    "databaseurl",
    "dburl",
    "dsn",
    "mysqlurl",
    "qrtoken",
    "rawstdout",
    "rawstderr",
    "rawtranscript",
    "stdout",
    "storage",
    "storagestate",
    "workerstderr",
}

DEFERRED_DOUYIN_COLLECTION_COMMANDS = frozenset({"search", "detail", "collect"})

SENSITIVE_ARTIFACT_REF_MARKERS = (
    "browserstate",
    "collectortranscript",
    "cookie",
    "database",
    "db",
    "dsn",
    "mysql",
    "rawstderr",
    "rawstdout",
    "secret",
    "stderr",
    "storagestate",
    "token",
)

SENSITIVE_AGENT_REACH_VALUE_MARKERS = (
    "browser/storage",
    "collector transcript",
    "raw stdout",
    "raw transcript",
    "storage_state",
    "qr token",
    "qrcode",
)

SENSITIVE_AGENT_REACH_VALUE_COMPACT_MARKERS = (
    "browserstate",
    "browserstorage",
    "collectortranscript",
    "rawstderr",
    "rawstdout",
    "rawtranscript",
    "stderr",
    "storagestate",
    "stdout",
    "stdouttranscript",
)

DOUYIN_RUNNER_PAYLOAD_ALLOWLIST = (
    "projectId",
    "project_id",
    "safeQuery",
)


def agent_reach_platform_not_allowed_error(platform, command):
    return {
        "ok": False,
        "platform": _safe_label(platform),
        "command": _safe_label(command),
        "status": "rejected",
        "error_type": "agent_reach_platform_not_allowed",
        "message": "Agent-Reach platform is not allowlisted.",
        "cause": "The requested platform is outside the current Adapter Foundation whitelist.",
        "fix": "Use bilibili doctor or health until the next platform slice adds an explicit contract.",
    }


def agent_reach_command_not_allowed_error(platform, command):
    if platform == "douyin" and command in DEFERRED_DOUYIN_COLLECTION_COMMANDS:
        return {
            "ok": False,
            "platform": _safe_label(platform),
            "command": _safe_label(command),
            "status": "rejected",
            "error_type": "agent_reach_command_not_allowed",
            "message": "Douyin collection runner contract is not clear.",
            "cause": "The adapter blocks douyin search/detail/collect before invoking any runner because the upstream runner schema is still unclear.",
            "fix": "Keep douyin real collection blocked until a dedicated slice defines the safe runner contract and fixtures.",
        }
    return {
        "ok": False,
        "platform": _safe_label(platform),
        "command": _safe_label(command),
        "status": "rejected",
        "error_type": "agent_reach_command_not_allowed",
        "message": "Agent-Reach command is not allowlisted for this platform.",
        "cause": "The adapter rejects command execution before invoking any runner.",
        "fix": "Use an allowlisted command for this platform or add a new command in a dedicated slice.",
    }


def agent_reach_runner_unavailable_error(platform, command):
    return {
        "ok": False,
        "platform": _safe_label(platform),
        "command": _safe_label(command),
        "status": "failed",
        "error_type": "agent_reach_runner_unavailable",
        "message": "Agent-Reach runner is not configured.",
        "cause": "Adapter Foundation only supports injected runner execution.",
        "fix": "Inject a controlled runner from the Harness collection slice.",
    }


def agent_reach_runner_failed_error(platform, command, artifact_ref=None, summary=None):
    payload = {
        "ok": False,
        "platform": _safe_label(platform),
        "command": _safe_label(command),
        "status": "failed",
        "error_type": "agent_reach_runner_failed",
        "message": "Agent-Reach runner failed.",
        "cause": "The controlled runner did not report a successful status.",
        "fix": "Inspect private runner logs and retry after correcting the local runner setup.",
        "summary": sanitize_agent_reach_summary(platform, summary or {}),
    }
    safe_artifact_ref = safe_agent_reach_artifact_ref(platform, artifact_ref)
    if safe_artifact_ref:
        payload["artifact_ref"] = safe_artifact_ref
    return payload


def sanitize_agent_reach_public(value):
    sanitized = sanitize_for_public(deepcopy(value))
    return _sanitize_agent_reach_specific(sanitized)


def sanitize_agent_reach_summary(platform, value):
    sanitized = sanitize_agent_reach_public(value)
    if platform == "douyin":
        return _sanitize_platform_artifact_refs(platform, sanitized)
    return sanitized


def safe_agent_reach_artifact_ref(platform, value):
    if platform == "douyin":
        return safe_douyin_artifact_ref(value)
    return sanitize_agent_reach_public(value)


def safe_douyin_artifact_ref(value):
    safe = sanitize_agent_reach_public(value)
    if not isinstance(safe, str):
        return None

    safe = safe.strip()
    prefix = "artifacts/agent-reach/douyin/"
    if not safe.startswith(prefix):
        return None
    if safe.startswith("/") or "\\" in safe or ":" in safe:
        return None
    if any(part in {"", ".", ".."} for part in safe.split("/")):
        return None
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", safe):
        return None
    compact = re.sub(r"[^A-Za-z0-9]", "", safe).lower()
    if any(marker in compact for marker in SENSITIVE_ARTIFACT_REF_MARKERS):
        return None
    return safe


class AgentReachAdapter:
    def __init__(self, runner=None, allowed_commands=None):
        self.runner = runner
        self.allowed_commands = allowed_commands or ALLOWED_AGENT_REACH_COMMANDS

    def run(self, platform, command, payload=None):
        if platform not in self.allowed_commands:
            return agent_reach_platform_not_allowed_error(platform, command)
        if command not in self.allowed_commands[platform]:
            return agent_reach_command_not_allowed_error(platform, command)
        if self.runner is None:
            return agent_reach_runner_unavailable_error(platform, command)

        runner_payload = payload or {}
        if platform == "douyin":
            runner_payload = sanitize_douyin_runner_payload(runner_payload)

        runner_request = {
            "platform": platform,
            "command": command,
            "payload": runner_payload,
        }
        try:
            runner_result = self.runner(runner_request)
        except Exception:
            return agent_reach_runner_failed_error(platform, command)

        if not isinstance(runner_result, dict):
            return agent_reach_runner_failed_error(platform, command)

        return self._public_result(platform, command, runner_result)

    def _public_result(self, platform, command, runner_result):
        status = _safe_status(runner_result.get("status"))
        summary = sanitize_agent_reach_summary(platform, runner_result.get("summary") or {})
        artifact_ref = safe_agent_reach_artifact_ref(platform, runner_result.get("artifact_ref"))

        if status != "ok":
            return agent_reach_runner_failed_error(platform, command, artifact_ref, summary)

        payload = {
            "ok": True,
            "platform": _safe_label(platform),
            "command": _safe_label(command),
            "status": status,
            "artifact_ref": artifact_ref,
            "summary": summary,
        }
        return sanitize_agent_reach_public(payload)


def _safe_status(value):
    if value == "ok":
        return "ok"
    return "failed"


def sanitize_douyin_runner_payload(payload):
    if not isinstance(payload, dict):
        return {}

    result = {}
    for key in DOUYIN_RUNNER_PAYLOAD_ALLOWLIST:
        if key not in payload:
            continue
        safe_value = sanitize_agent_reach_public(payload[key])
        if _is_safe_douyin_runner_payload_value(safe_value):
            result[key] = safe_value
    return result


def _is_safe_douyin_runner_payload_value(value):
    return isinstance(value, (str, int, float, bool))


def _safe_label(value):
    sanitized = sanitize_agent_reach_public(value)
    if isinstance(sanitized, str) and sanitized:
        return sanitized
    return "redacted"


def _sanitize_agent_reach_specific(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if _is_agent_reach_sensitive_key(str(key)):
                continue
            sanitized_item = _sanitize_agent_reach_specific(item)
            if sanitized_item is not None:
                result[key] = sanitized_item
        return result
    if isinstance(value, list):
        result = []
        for item in value:
            sanitized_item = _sanitize_agent_reach_specific(item)
            if sanitized_item is not None:
                result.append(sanitized_item)
        return result
    if isinstance(value, str) and _is_agent_reach_sensitive_value(value):
        return None
    return value


def _sanitize_platform_artifact_refs(platform, value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            normalized_key = _normalize_key(str(key))
            if normalized_key in {"artifact_ref", "raw_artifact_ref"}:
                safe_ref = safe_agent_reach_artifact_ref(platform, item)
                if safe_ref:
                    result.setdefault(normalized_key, safe_ref)
                continue
            sanitized_item = _sanitize_platform_artifact_refs(platform, item)
            if sanitized_item is not None:
                result[key] = sanitized_item
        return result
    if isinstance(value, list):
        result = []
        for item in value:
            sanitized_item = _sanitize_platform_artifact_refs(platform, item)
            if sanitized_item is not None:
                result.append(sanitized_item)
        return result
    return value


def _is_agent_reach_sensitive_key(key):
    normalized = _normalize_key(key)
    compact = re.sub(r"[^a-z0-9]", "", normalized)
    return compact in SENSITIVE_AGENT_REACH_KEY_COMPACT or any(
        part in normalized for part in SENSITIVE_AGENT_REACH_KEY_PARTS
    )


def _normalize_key(key):
    text = str(key).replace("-", "_").replace(" ", "_")
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    return re.sub(r"_+", "_", text).lower()


def _is_agent_reach_sensitive_value(value):
    lowered = value.lower()
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    return any(marker in lowered for marker in SENSITIVE_AGENT_REACH_VALUE_MARKERS) or any(
        marker in compact for marker in SENSITIVE_AGENT_REACH_VALUE_COMPACT_MARKERS
    )
