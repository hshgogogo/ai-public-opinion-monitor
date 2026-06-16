import re


ALLOWED_TOOLS = {
    "get_loop_context",
    "get_evidence_summary",
    "search_knowledge_cards",
}

REDACTED = "[REDACTED]"

SENSITIVE_KEY_PARTS = (
    "api_key",
    "authorization",
    "browser_state",
    "cookie",
    "database_url",
    "db_url",
    "dsn",
    "env_file",
    "mysql_url",
    "password",
    "prompt",
    "raw_model_output",
    "secret",
    "stderr",
    "storage_state",
    "token",
    "traceback",
    "worker_stderr",
)

SENSITIVE_KEY_EXACT = {
    "file",
    "filepath",
    "file_path",
    "path",
}

SENSITIVE_KEY_COMPACT = {
    "apikey",
    "authorization",
    "browserstate",
    "cookie",
    "databaseurl",
    "dburl",
    "dsn",
    "envfile",
    "mysqlurl",
    "password",
    "prompt",
    "rawmodeloutput",
    "secret",
    "stderr",
    "storagestate",
    "token",
    "traceback",
    "workerstderr",
}

SENSITIVE_VALUE_MARKERS = (
    ".env",
    "api_key",
    "bearer ",
    "browser_state",
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
    "secret",
    "stderr",
    "storage_state",
    "sub=",
    "token",
    "traceback",
    "weibo.json",
)

PATH_PATTERN = re.compile(r"(^|[\s:=])(/|~/?|[A-Za-z]:[\\/]|\.{1,2}/|[A-Za-z0-9_.-]+/[A-Za-z0-9_.\\/-]+)")


class HarnessToolGateway:
    def __init__(self, repository=None):
        self.repository = repository or EmptyHarnessToolRepository()
        self._registry = {
            "get_loop_context": self._get_loop_context,
            "get_evidence_summary": self._get_evidence_summary,
            "search_knowledge_cards": self._search_knowledge_cards,
        }

    def call_tool(self, name, payload):
        if name not in ALLOWED_TOOLS:
            return tool_not_allowed_error()
        if not isinstance(payload, dict) or _payload_is_dangerous(payload):
            return payload_rejected_error()

        handler = self._registry[name]
        prepared = handler(payload)
        if prepared.get("ok") is False:
            return prepared

        result = prepared["result"]
        return {
            "ok": True,
            "tool": name,
            "result": sanitize_public_payload(result),
        }

    def _get_loop_context(self, payload):
        project_id = payload.get("project_id")
        run_id = payload.get("run_id")
        if not _positive_int(project_id) or not _positive_int(run_id):
            return payload_rejected_error()
        return {
            "ok": True,
            "result": self.repository.get_loop_context(project_id=project_id, run_id=run_id),
        }

    def _get_evidence_summary(self, payload):
        project_id = payload.get("project_id")
        evidence_ids = payload.get("evidence_ids")
        if not _positive_int(project_id) or not _valid_string_list(evidence_ids):
            return payload_rejected_error()
        return {
            "ok": True,
            "result": self.repository.get_evidence_summary(
                project_id=project_id,
                evidence_ids=evidence_ids,
            ),
        }

    def _search_knowledge_cards(self, payload):
        project_id = payload.get("project_id")
        query = payload.get("query")
        if not _positive_int(project_id) or not _non_empty_string(query):
            return payload_rejected_error()
        return {
            "ok": True,
            "result": self.repository.search_knowledge_cards(project_id=project_id, query=query),
        }


class EmptyHarnessToolRepository:
    def get_loop_context(self, *, project_id, run_id):
        return {
            "project_id": project_id,
            "run_id": run_id,
            "context": {},
        }

    def get_evidence_summary(self, *, project_id, evidence_ids):
        return {
            "project_id": project_id,
            "evidence": [{"id": evidence_id, "summary": None} for evidence_id in evidence_ids],
        }

    def search_knowledge_cards(self, *, project_id, query):
        return {
            "project_id": project_id,
            "query": query,
            "cards": [],
        }


def sanitize_public_payload(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if _sensitive_key(key):
                continue
            result[key] = sanitize_public_payload(item)
        return result
    if isinstance(value, list):
        return [sanitize_public_payload(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_public_payload(item) for item in value]
    if isinstance(value, str) and _sensitive_value(value):
        return REDACTED
    return value


def tool_not_allowed_error():
    return {
        "ok": False,
        "error_type": "crewai_tool_not_allowed",
        "message": "CrewAI tool call is not allowed.",
        "fix": "Use one of the Harness read-only allowlisted tools.",
    }


def payload_rejected_error():
    return {
        "ok": False,
        "error_type": "crewai_tool_payload_rejected",
        "message": "CrewAI tool payload was rejected.",
        "fix": "Send scoped project/run/evidence/query fields only.",
    }


def _payload_is_dangerous(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if _sensitive_key(key) or _payload_is_dangerous(item):
                return True
        return False
    if isinstance(value, list) or isinstance(value, tuple):
        return any(_payload_is_dangerous(item) for item in value)
    if isinstance(value, str):
        return _sensitive_value(value)
    return False


def _sensitive_key(key):
    normalized = _normalize_key(key)
    compact = re.sub(r"[^a-z0-9]", "", normalized)
    return (
        normalized in SENSITIVE_KEY_EXACT
        or compact in SENSITIVE_KEY_COMPACT
        or any(part in normalized for part in SENSITIVE_KEY_PARTS)
    )


def _normalize_key(key):
    text = str(key).replace("-", "_").replace(" ", "_")
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    return re.sub(r"_+", "_", text).lower()


def _sensitive_value(value):
    lowered = value.lower()
    return any(marker in lowered for marker in SENSITIVE_VALUE_MARKERS) or bool(PATH_PATTERN.search(value))


def _positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def _valid_string_list(value):
    return isinstance(value, list) and bool(value) and all(_non_empty_string(item) for item in value)
