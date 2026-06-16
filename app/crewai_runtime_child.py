import importlib
import json
import sys

from app.crewai_tools import ALLOWED_TOOLS, payload_rejected_error, tool_not_allowed_error


class ChildRuntimeToolFacade:
    __slots__ = ("_snapshots",)

    def __init__(self, snapshots):
        self._snapshots = snapshots

    def call_tool(self, name, payload):
        if name not in ALLOWED_TOOLS:
            return tool_not_allowed_error()
        key = _tool_key(name, payload)
        if key not in self._snapshots:
            return payload_rejected_error()
        return json.loads(json.dumps(self._snapshots[key], ensure_ascii=False))


def main():
    try:
        payload = json.loads(sys.stdin.read())
        module = importlib.import_module(payload["module"])
        runtime_callable = getattr(module, payload["callable_name"])
        tools = ChildRuntimeToolFacade(payload.get("tool_snapshots", {}))
        output = runtime_callable(payload.get("request", {}), tools)
        sys.stdout.write(json.dumps({"ok": True, "output": output}, ensure_ascii=False))
    except Exception:
        sys.stdout.write(json.dumps({"ok": False, "error_type": "crewai_runtime_failed"}, ensure_ascii=False))
        raise SystemExit(1)


def _tool_key(name, payload):
    return json.dumps({"name": name, "payload": payload}, sort_keys=True, separators=(",", ":"))


if __name__ == "__main__":
    main()
