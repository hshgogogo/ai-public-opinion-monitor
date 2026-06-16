import json
import os
import subprocess
from pathlib import Path


ALLOWED_LEGACY_COMMANDS = {
    "weibo-agent-loop-run",
    "weibo-agent-loop-status",
}

SENSITIVE_KEY_PARTS = (
    "stderr",
    "traceback",
    "cookie",
    "database_url",
    "db_url",
    "dsn",
    "mysql_url",
    "prompt",
    "raw_model_output",
    "token",
    "secret",
    "password",
    "authorization",
    "api_key",
)

SENSITIVE_VALUE_MARKERS = (
    ".env",
    "cookie",
    "token",
    "config/cookies",
    "weibo.json",
    "stderr",
    "traceback",
    "sub=",
    "secret",
    "bearer ",
    "api_key",
    "prompt text",
    "raw model output",
    "mariadb://",
    "mysql://",
    "mysql+pymysql://",
)

WORKER_ENV_ALLOWLIST = (
    "MYSQL_URL",
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "PYTHONIOENCODING",
)

_DROP = object()


def mysql_unavailable_error():
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "mysql": {"connected": False, "configured": False},
        "error_type": "mysql_unavailable",
        "message": "MySQL is not available for the FastAPI sidecar.",
        "cause": "MYSQL_URL is not configured or the local database cannot be reached.",
        "fix": "Configure MYSQL_URL for real ledger access, or inject a test adapter for fixture validation.",
    }


def command_not_allowed_error(command):
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": "legacy_worker_command_not_allowed",
        "message": "Legacy worker command is not allowed.",
        "cause": f"{command} is not in the FastAPI sidecar whitelist.",
        "fix": "Add an explicit whitelist entry only after reviewing the command for side effects and secret access.",
    }


def legacy_worker_failed_error():
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": "legacy_worker_failed",
        "message": "Legacy worker command failed.",
        "cause": "The worker process did not return a successful JSON payload.",
        "fix": "Inspect local worker logs and retry after fixing the worker command.",
    }


def sanitize_for_public(value):
    sanitized = _sanitize(value)
    if sanitized is _DROP:
        return None
    return sanitized


def _sanitize(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            key_text = str(key)
            if _is_sensitive_key(key_text):
                continue
            sanitized_item = _sanitize(item)
            if sanitized_item is not _DROP:
                result[key] = sanitized_item
        return result
    if isinstance(value, list):
        result = []
        for item in value:
            sanitized_item = _sanitize(item)
            if sanitized_item is not _DROP:
                result.append(sanitized_item)
        return result
    if isinstance(value, str) and _is_sensitive_value(value):
        return _DROP
    return value


def _is_sensitive_key(key):
    lowered = key.lower()
    if lowered == "raw_model_output_ref":
        return False
    return any(part in lowered for part in SENSITIVE_KEY_PARTS)


def _is_sensitive_value(value):
    lowered = value.lower()
    return any(marker in lowered for marker in SENSITIVE_VALUE_MARKERS)


class LegacyWorkerAdapter:
    def __init__(self, python_bin=None, worker_script=None, cwd=None, timeout_seconds=30):
        self.cwd = Path(cwd or Path(__file__).resolve().parents[1])
        self.python_bin = python_bin or os.environ.get("PYTHON_BIN") or ".venv/bin/python"
        self.worker_script = worker_script or os.environ.get("ENTERPRISE_WORKER_SCRIPT") or "workers/enterprise_worker.py"
        self.timeout_seconds = timeout_seconds

    def run_agent_loop(self, payload):
        return self.call("weibo-agent-loop-run", payload)

    def get_agent_run(self, run_id, payload=None):
        worker_payload = {"loopRunId": run_id}
        if payload:
            worker_payload.update(payload)
        return self.call("weibo-agent-loop-status", worker_payload)

    def readiness(self):
        script_path = Path(self.worker_script)
        if not script_path.is_absolute():
            script_path = self.cwd / script_path
        python_configured = bool(self.python_bin)
        worker_script_configured = bool(self.worker_script) and script_path.exists()
        configured = python_configured and worker_script_configured and bool(ALLOWED_LEGACY_COMMANDS)
        status = {
            "configured": configured,
            "python_bin": {"configured": python_configured},
            "worker_script": {"configured": worker_script_configured},
            "allowed_commands": sorted(ALLOWED_LEGACY_COMMANDS),
        }
        if not configured:
            status.update({
                "error_type": "legacy_adapter_unavailable",
                "message": "Legacy worker adapter is not configured.",
                "cause": "Python binary, worker script, or command whitelist is unavailable.",
                "fix": "Restore workers/enterprise_worker.py and verify the sidecar Python configuration.",
            })
        return status

    def call(self, command, payload):
        if command not in ALLOWED_LEGACY_COMMANDS:
            return command_not_allowed_error(command)
        if not os.environ.get("MYSQL_URL"):
            return mysql_unavailable_error()

        args = [
            self.python_bin,
            self.worker_script,
            command,
            "--payload-json",
            json.dumps(payload or {}, ensure_ascii=False),
        ]
        env = self._worker_env()

        try:
            completed = subprocess.run(
                args,
                cwd=self.cwd,
                env=env,
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except Exception:
            return legacy_worker_failed_error()

        try:
            parsed = json.loads(completed.stdout or "{}")
        except json.JSONDecodeError:
            parsed = legacy_worker_failed_error()

        if completed.returncode != 0 and parsed.get("ok") is not False:
            parsed = legacy_worker_failed_error()
        return sanitize_for_public(parsed)

    def _worker_env(self):
        env = {
            key: os.environ[key]
            for key in WORKER_ENV_ALLOWLIST
            if key in os.environ
        }
        env["YUQING_SKIP_ENV_FILE"] = "1"
        return env
