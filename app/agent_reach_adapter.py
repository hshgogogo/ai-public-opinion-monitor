import re
from copy import deepcopy

from .legacy_worker import sanitize_for_public


ALLOWED_AGENT_REACH_COMMANDS = {
    "bilibili": frozenset({"doctor", "health"}),
}

SENSITIVE_AGENT_REACH_KEY_PARTS = (
    "browser_state",
    "browser_storage",
    "database_url",
    "db_url",
    "mysql_url",
    "raw_stderr",
    "storage_state",
    "worker_stderr",
    "storage",
    "qr",
)

SENSITIVE_AGENT_REACH_KEY_COMPACT = {
    "browserstate",
    "browserstorage",
    "databaseurl",
    "dburl",
    "dsn",
    "mysqlurl",
    "qrtoken",
    "rawstderr",
    "storage",
    "storagestate",
    "workerstderr",
}

SENSITIVE_AGENT_REACH_VALUE_MARKERS = (
    "browser/storage",
    "storage_state",
    "qr token",
    "qrcode",
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
        "summary": sanitize_agent_reach_public(summary or {}),
    }
    safe_artifact_ref = sanitize_agent_reach_public(artifact_ref)
    if safe_artifact_ref:
        payload["artifact_ref"] = safe_artifact_ref
    return payload


def sanitize_agent_reach_public(value):
    sanitized = sanitize_for_public(deepcopy(value))
    return _sanitize_agent_reach_specific(sanitized)


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

        runner_request = {
            "platform": platform,
            "command": command,
            "payload": payload or {},
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
        summary = sanitize_agent_reach_public(runner_result.get("summary") or {})
        artifact_ref = sanitize_agent_reach_public(runner_result.get("artifact_ref"))

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
    return any(marker in lowered for marker in SENSITIVE_AGENT_REACH_VALUE_MARKERS)
