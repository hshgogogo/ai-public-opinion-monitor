import importlib
import copy
import json
import os
import subprocess
import sys

from app.crewai_proposal import proposal_error, validate_crewai_proposal
from app.crewai_tools import ALLOWED_TOOLS, payload_rejected_error, tool_not_allowed_error


class CrewAIRuntimeAdapter:
    def __init__(self, runtime=None, tool_gateway=None):
        if tool_gateway is None:
            from app.crewai_tools import HarnessToolGateway

            tool_gateway = HarnessToolGateway()
        self.runtime = runtime
        self.tool_gateway = tool_gateway

    def run_proposal(self, request):
        try:
            runtime = self.runtime
            if runtime is None:
                loaded = load_crewai_runtime()
                if loaded.get("ok") is False:
                    return loaded
                runtime = loaded["runtime"]

            runtime_tools = _RuntimeToolFacade.from_gateway(self.tool_gateway, request)
            output = _run_runtime(runtime, request, runtime_tools)
        except Exception:
            return runtime_failed_error()

        return validate_crewai_proposal(output)


class PythonModuleRuntimeSpec:
    def __init__(self, module, callable_name="run", timeout_seconds=30):
        self.module = module
        self.callable_name = callable_name
        self.timeout_seconds = timeout_seconds


class _RuntimeToolFacade:
    __slots__ = ("_snapshots",)

    def __init__(self, snapshots):
        self._snapshots = snapshots

    def call_tool(self, name, payload):
        if name not in ALLOWED_TOOLS:
            return tool_not_allowed_error()
        key = _tool_key(name, payload)
        if key not in self._snapshots:
            return payload_rejected_error()
        return copy.deepcopy(self._snapshots[key])

    def snapshots_for_child_process(self):
        return {key: copy.deepcopy(value) for key, value in self._snapshots.items()}

    @classmethod
    def from_gateway(cls, gateway, request):
        snapshots = {}
        for name, payload in _tool_payloads_for_request(request):
            snapshots[_tool_key(name, payload)] = gateway.call_tool(name, payload)
        return cls(snapshots)


def _tool_payloads_for_request(request):
    if not isinstance(request, dict):
        return []

    project_id = request.get("project_id")
    run_id = request.get("agent_loop_run_id") or request.get("run_id")
    if _positive_int(project_id) and _positive_int(run_id):
        yield "get_loop_context", {"project_id": project_id, "run_id": run_id}

    evidence_ids = request.get("evidence_ids")
    if _positive_int(project_id) and _valid_string_list(evidence_ids):
        yield "get_evidence_summary", {"project_id": project_id, "evidence_ids": evidence_ids}

    query = request.get("knowledge_query") or request.get("query")
    if _positive_int(project_id) and _non_empty_string(query):
        yield "search_knowledge_cards", {"project_id": project_id, "query": query}


def _tool_key(name, payload):
    return json.dumps({"name": name, "payload": payload}, sort_keys=True, separators=(",", ":"))


def _run_runtime(runtime, request, tool_gateway):
    if isinstance(runtime, PythonModuleRuntimeSpec):
        return _run_python_module_runtime(runtime, request, tool_gateway)
    raise TypeError("CrewAI runtime must be a process-isolated PythonModuleRuntimeSpec.")


def _run_python_module_runtime(runtime, request, tool_gateway):
    payload = {
        "module": runtime.module,
        "callable_name": runtime.callable_name,
        "request": request,
        "tool_snapshots": tool_gateway.snapshots_for_child_process(),
    }
    completed = subprocess.run(
        [sys.executable, "-m", "app.crewai_runtime_child"],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
        env=_child_runtime_env(),
        timeout=runtime.timeout_seconds,
    )
    if completed.returncode != 0:
        raise RuntimeError("CrewAI child runtime failed.")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("CrewAI child runtime returned invalid JSON.") from exc
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeError("CrewAI child runtime failed.")
    return result.get("output")


def _child_runtime_env():
    env = {}
    for name in ("PATH", "PYTHONPATH", "VIRTUAL_ENV", "LANG", "LC_ALL", "LC_CTYPE"):
        value = os.environ.get(name)
        if value:
            env[name] = value
    env["YUQING_SKIP_ENV_FILE"] = "1"
    return env


def crewai_dependency_status(module_name="crewai"):
    try:
        module = importlib.import_module(module_name)
    except Exception:
        return dependency_unavailable_error()
    return {
        "ok": True,
        "module": module_name,
        "runtime": module,
    }


def load_crewai_runtime(module_name="crewai"):
    status = crewai_dependency_status(module_name=module_name)
    if status.get("ok") is False:
        return status
    return {
        "ok": True,
        "runtime": status["runtime"],
    }


def dependency_unavailable_error():
    return proposal_error(
        "crewai_dependency_unavailable",
        "CrewAI runtime dependency is unavailable.",
        "The optional CrewAI package could not be loaded in this environment.",
        "Install the pinned CrewAI dependency or inject a fake runtime for tests.",
    )


def runtime_failed_error():
    return proposal_error(
        "crewai_runtime_failed",
        "CrewAI runtime failed.",
        "The runtime raised, timed out, or could not be executed safely.",
        "Retry with a healthy runtime and inspect private server-side logs for details.",
    )


def _positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def _valid_string_list(value):
    return isinstance(value, list) and bool(value) and all(_non_empty_string(item) for item in value)
