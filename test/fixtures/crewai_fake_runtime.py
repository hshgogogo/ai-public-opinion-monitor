import inspect
import json
import os
import sys
import time


FORBIDDEN_MARKERS = (
    "config/cookies/weibo.json",
    "mysql://",
    "root:secret",
    "private_cookie_path",
    "database_url",
)


def run(request, tools):
    mode = request.get("fixture_mode", "success")
    if mode == "exception":
        raise RuntimeError(
            "traceback prompt text DEEPSEEK_API_KEY=sk-secret "
            "mysql://root:secret@localhost/weibo "
            "config/cookies/weibo.json worker stderr hidden"
        )
    if mode == "timeout":
        raise TimeoutError(
            "timeout while using prompt text and mysql://root:secret@localhost/weibo"
        )
    if mode == "sleep":
        time.sleep(5)
        return _success_payload(request)
    if mode == "malformed":
        return {
            "proposal_type": "database_write",
            "project_id": 2,
            "agent_loop_run_id": 10,
            "agent_name": "Strategy Agent",
            "stage": "strategy",
            "facts": [{"text": "RAW MODEL OUTPUT with mysql://root:secret@localhost/db", "evidence_ids": []}],
            "inferences": [],
            "recommendations": [],
            "write_intent": "proposal_only",
            "knowledge_card_ids": [],
            "raw_model_output": "prompt text with Cookie SUB=secret",
            "raw_model_output_ref": None,
        }
    if mode == "adversarial":
        _assert_no_parent_gateway_visible(tools)
    if mode == "env_probe":
        _assert_sensitive_env_scrubbed()

    tool_result = tools.call_tool("get_loop_context", {"project_id": 2, "run_id": 10})
    assert tool_result["ok"] is True, tool_result
    serialized_tool = json.dumps(tool_result, ensure_ascii=False)
    for forbidden in FORBIDDEN_MARKERS:
        assert forbidden not in serialized_tool, serialized_tool

    return _success_payload(request)


def _success_payload(request):
    return {
        "proposal_type": request.get("proposal_type", "strategy_action"),
        "project_id": request["project_id"],
        "agent_loop_run_id": request["agent_loop_run_id"],
        "agent_name": request.get("agent_name", "Strategy Agent"),
        "stage": request.get("stage", "strategy"),
        "facts": [{"text": "Scoped context was inspected.", "evidence_ids": ["comment:123"]}],
        "inferences": [
            {"text": "The discussion is heating up.", "confidence": "medium", "evidence_ids": ["comment:123"]}
        ],
        "recommendations": [
            {"text": "Prepare a measured reply.", "risk_notes": ["Avoid overclaiming."], "evidence_ids": ["event:7"]}
        ],
        "write_intent": "proposal_only",
        "knowledge_card_ids": [5],
        "raw_model_output_ref": None,
    }


def callable_run(request, tools):
    result = run({**request, "proposal_type": "report_note", "agent_name": "Report Agent", "stage": "report"}, tools)
    result["inferences"] = []
    result["recommendations"] = []
    return result


def _assert_no_parent_gateway_visible(tools):
    assert hasattr(tools, "call_tool"), tools
    assert not hasattr(tools, "repository"), tools
    assert not hasattr(tools, "_gateway"), tools

    leaked_refs = []
    for frame in sys._current_frames().values():
        while frame is not None:
            for value in frame.f_locals.values():
                gateway = getattr(value, "tool_gateway", None)
                repository = getattr(value, "repository", None)
                if gateway is not None:
                    leaked_refs.append(repr(gateway))
                    leaked_refs.append(repr(getattr(gateway, "repository", None)))
                if repository is not None:
                    leaked_refs.append(repr(repository))
            frame = frame.f_back

    own_stack_refs = []
    frame = inspect.currentframe()
    while frame is not None:
        own_stack_refs.extend(repr(value) for value in frame.f_locals.values() if value is tools)
        frame = frame.f_back

    serialized = json.dumps({"leaked_refs": leaked_refs, "own_stack_refs": own_stack_refs}, ensure_ascii=False)
    for forbidden in FORBIDDEN_MARKERS:
        assert forbidden not in serialized, serialized


def _assert_sensitive_env_scrubbed():
    sensitive_names = (
        "MYSQL_URL",
        "DEEPSEEK_API_KEY",
        "WEIBO_COOKIE_FILE",
        "MEDIACRAWLER_HOME",
        "MEDIACRAWLER_CDP_PORT",
    )
    leaked = {name: os.environ.get(name) for name in sensitive_names if os.environ.get(name)}
    assert not leaked, leaked
    assert os.environ.get("YUQING_SKIP_ENV_FILE") == "1", dict(os.environ)
