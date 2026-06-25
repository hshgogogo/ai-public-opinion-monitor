from .agent_reach_adapter import sanitize_agent_reach_public
from .bilibili_normalizer import BilibiliNormalizer


PLATFORM = "bilibili"
AGENT_NAME = "Bilibili Collection Agent"
STEP_NAME = "bilibili_collection"
COLLECTION_COMMAND = "collect"
SAFE_ADAPTER_SUMMARY_FIELDS = frozenset({
    "capability",
    "diagnostic",
    "evidence_count",
    "item_count",
    "keyword",
    "query",
    "safeCount",
    "safe_count",
})


class BilibiliCollectionService:
    def __init__(self, adapter, normalizer=None, writer=None, step_recorder=None, loop_run_resolver=None):
        self.adapter = adapter
        self.normalizer = normalizer
        self.writer = writer
        self.step_recorder = step_recorder
        self.loop_run_resolver = loop_run_resolver

    def collect(self, payload=None):
        payload = payload or {}
        project_id = _positive_int(payload.get("projectId", payload.get("project_id")))
        loop_run_id = _positive_int(payload.get("agentLoopRunId")) if "agentLoopRunId" in payload else None
        if project_id is None:
            return self._finalize(
                _failed_result(
                    "invalid_project_id",
                    "Bilibili collection requires a positive project id.",
                    "Pass projectId as a positive integer.",
                    project_id=project_id,
                ),
                loop_run_id,
            )

        request = {
            "platform": PLATFORM,
            "project_id": project_id,
            "projectId": project_id,
            "payload": _runner_payload(payload),
        }

        adapter_result, adapter_error = self._run_adapter(request)
        if adapter_error:
            return self._finalize(adapter_error, loop_run_id)

        normalized, normalization_error = self._normalize(adapter_result, request)
        if normalization_error:
            return self._finalize(normalization_error, loop_run_id)

        normalized_counts = _normalized_counts(normalized)
        artifact_refs = _artifact_refs(adapter_result, normalized)
        if normalized_counts["content_items"] == 0 and normalized_counts["evidence_summaries"] == 0:
            return self._finalize(
                _partial_result(
                    "bilibili_no_persistable_evidence",
                    "Bilibili normalization succeeded but produced no persistable evidence.",
                    "Check the upstream fixture or runner output, then retry collection.",
                    project_id,
                    normalized_counts=normalized_counts,
                    persist_counts=_persist_counts({}),
                    evidence_ids=[],
                    artifact_refs=artifact_refs,
                    adapter_summary=_adapter_summary(adapter_result),
                ),
                loop_run_id,
            )

        writer_result, writer_error = self._persist(normalized)
        if writer_error:
            return self._finalize(writer_error, loop_run_id)

        evidence_ids = _evidence_ids(writer_result, normalized)
        persist_counts = _persist_counts(writer_result)
        if not writer_result.get("ok"):
            status_result = _partial_result(
                "bilibili_persistence_partial",
                _safe_message(writer_result.get("message"), "Bilibili persistence completed with a non-fatal failure."),
                _safe_message(writer_result.get("fix"), "Retry persistence after checking the skipped Bilibili evidence."),
                project_id,
                normalized_counts=normalized_counts,
                persist_counts=persist_counts,
                evidence_ids=evidence_ids,
                artifact_refs=artifact_refs,
                adapter_summary=_adapter_summary(adapter_result),
            )
            return self._finalize(status_result, loop_run_id)

        if not evidence_ids or not _has_persisted_records(persist_counts):
            return self._finalize(
                _partial_result(
                    "bilibili_persistence_partial",
                    "Bilibili persistence succeeded without persisted evidence records.",
                    "Check writer counts and evidence IDs before treating the collection as complete.",
                    project_id,
                    normalized_counts=normalized_counts,
                    persist_counts=persist_counts,
                    evidence_ids=evidence_ids,
                    artifact_refs=artifact_refs,
                    adapter_summary=_adapter_summary(adapter_result),
                ),
                loop_run_id,
            )

        return self._finalize(
            _succeeded_result(
                project_id,
                normalized_counts=normalized_counts,
                persist_counts=persist_counts,
                evidence_ids=evidence_ids,
                artifact_refs=artifact_refs,
                adapter_summary=_adapter_summary(adapter_result),
            ),
            loop_run_id,
        )

    def _run_adapter(self, request):
        try:
            if hasattr(self.adapter, "collect"):
                result = self.adapter.collect(request)
            elif callable(self.adapter):
                result = self.adapter(request)
            elif hasattr(self.adapter, "run"):
                result = self.adapter.run(PLATFORM, COLLECTION_COMMAND, request)
            else:
                return None, _adapter_failed_result({"message": "Bilibili adapter is not callable."}, request["project_id"])
        except Exception as exc:
            return None, _adapter_failed_result({"cause": type(exc).__name__}, request["project_id"])

        if not isinstance(result, dict) or not result.get("ok"):
            return None, _adapter_failed_result(result if isinstance(result, dict) else {}, request["project_id"])
        return sanitize_agent_reach_public(result), None

    def _normalize(self, adapter_result, request):
        normalizer = self.normalizer or BilibiliNormalizer(request["project_id"])
        try:
            if hasattr(normalizer, "normalize_adapter_result"):
                result = normalizer.normalize_adapter_result(adapter_result, request)
            elif callable(normalizer):
                result = normalizer(adapter_result, request)
            else:
                result = _normalize_fixture_result(normalizer, adapter_result, request)
        except Exception as exc:
            return None, _normalization_failed_result({"cause": type(exc).__name__}, request["project_id"])

        if not isinstance(result, dict) or not result.get("ok"):
            return None, _normalization_failed_result(result if isinstance(result, dict) else {}, request["project_id"])
        return sanitize_agent_reach_public(result), None

    def _persist(self, normalized):
        if self.writer is None:
            return None, _persistence_failed_result(
                {"message": "Bilibili persistence writer is not configured."},
                normalized.get("project_id"),
            )

        try:
            result = self.writer.persist(normalized)
        except Exception as exc:
            return None, _persistence_failed_result({"cause": type(exc).__name__}, normalized.get("project_id"))

        if not isinstance(result, dict):
            return None, _persistence_failed_result({}, normalized.get("project_id"))
        safe_result = sanitize_agent_reach_public(result)
        if not safe_result.get("ok") and safe_result.get("fatal") is not False:
            return None, _persistence_failed_result(safe_result, normalized.get("project_id"))
        return safe_result, None

    def _finalize(self, result, loop_run_id):
        output_json = _step_output(result)
        evidence_ids = result.get("evidence_ids") or []
        project_id = _positive_int(result.get("project_id"))
        if self.step_recorder and loop_run_id is not None and project_id is not None:
            validation_error = _agent_loop_validation_error(
                self.loop_run_resolver,
                self.step_recorder,
                project_id,
                loop_run_id,
            )
            if validation_error:
                result["agentStepError"] = validation_error
                return sanitize_agent_reach_public(result)
            try:
                step = _record_step(
                    self.step_recorder,
                    loop_run_id=loop_run_id,
                    project_id=project_id,
                    status=result.get("status"),
                    output_json=output_json,
                    evidence_ids=evidence_ids,
                    error_type=result.get("error_type"),
                    error_message=result.get("message") if result.get("status") != "succeeded" else None,
                )
                result["agentStepRun"] = sanitize_agent_reach_public(step)
            except Exception as exc:
                result["agentStepError"] = {
                    "error_type": "bilibili_agent_step_record_failed",
                    "message": "Bilibili Agent Loop step could not be recorded.",
                    "cause": type(exc).__name__,
                    "fix": "Check the injected Agent Loop step recorder and retry collection.",
                }
        return sanitize_agent_reach_public(result)


def _normalize_fixture_result(normalizer, adapter_result, request):
    fixture_kind = adapter_result.get("fixture_kind") or request["payload"].get("fixtureKind")
    fixture_path = adapter_result.get("fixture_path") or request["payload"].get("fixturePath")
    raw_artifact_ref = (
        adapter_result.get("artifact_ref")
        or adapter_result.get("raw_artifact_ref")
        or request["payload"].get("rawArtifactRef")
    )
    if fixture_kind == "search":
        return normalizer.normalize_search_fixture(fixture_path, raw_artifact_ref)
    if fixture_kind == "detail":
        return normalizer.normalize_detail_fixture(fixture_path, raw_artifact_ref)
    raise ValueError("unsupported bilibili fixture kind")


def _record_step(recorder, **kwargs):
    payload = {
        "loop_run_id": kwargs["loop_run_id"],
        "project_id": kwargs["project_id"],
        "agent_name": AGENT_NAME,
        "step_name": STEP_NAME,
        "status": kwargs["status"],
        "output_json": kwargs["output_json"],
        "evidence_ids": kwargs["evidence_ids"],
        "error_type": kwargs["error_type"],
        "error_message": kwargs["error_message"],
    }
    if hasattr(recorder, "record_step_run"):
        return recorder.record_step_run(**payload)
    if hasattr(recorder, "record"):
        return recorder.record(**payload)
    if callable(recorder):
        return recorder(**payload)
    raise ValueError("unsupported step recorder")


def _agent_loop_validation_error(loop_run_resolver, step_recorder, project_id, loop_run_id):
    resolver = loop_run_resolver or _recorder_resolver(step_recorder)
    if resolver is None:
        return _agent_step_error(
            "bilibili_agent_loop_run_unverified",
            "Bilibili Agent Loop run ownership could not be verified.",
            "No loop run resolver was configured for this collection service.",
            "Inject a resolver that confirms agentLoopRunId belongs to projectId before recording the step.",
        )
    try:
        row = _resolve_loop_run(resolver, project_id, loop_run_id)
    except Exception as exc:
        return _agent_step_error(
            "bilibili_agent_loop_run_unverified",
            "Bilibili Agent Loop run ownership could not be verified.",
            type(exc).__name__,
            "Check the injected loop run resolver and retry collection.",
        )
    if not row:
        return _agent_step_error(
            "bilibili_agent_loop_run_not_found",
            "Bilibili Agent Loop step was not recorded because the loop run was not found.",
            "The agentLoopRunId does not exist or is unavailable to the resolver.",
            "Pass an existing agentLoopRunId for the same projectId.",
        )
    if row is True:
        return None
    if not isinstance(row, dict):
        return _agent_step_error(
            "bilibili_agent_loop_run_unverified",
            "Bilibili Agent Loop run ownership could not be verified.",
            "The resolver did not return a boolean or loop run object.",
            "Return True after ownership validation, or return a loop run object with id and project_id.",
        )

    resolved_project_id = _positive_int(row.get("project_id", row.get("projectId")))
    if resolved_project_id != project_id:
        return _agent_step_error(
            "bilibili_agent_loop_project_mismatch",
            "Bilibili Agent Loop step was not recorded because the loop run belongs to another project.",
            "The resolved Agent Loop run project_id did not match projectId.",
            "Check projectId and agentLoopRunId, then retry collection.",
        )

    resolved_loop_id = _positive_int(row.get("id", row.get("loop_run_id", row.get("loopRunId"))))
    if resolved_loop_id is not None and resolved_loop_id != loop_run_id:
        return _agent_step_error(
            "bilibili_agent_loop_run_not_found",
            "Bilibili Agent Loop step was not recorded because the loop run was not found.",
            "The resolver returned a different loop run id.",
            "Pass the exact agentLoopRunId that belongs to projectId.",
        )
    return None


def _recorder_resolver(step_recorder):
    for method_name in ("resolve_loop_run", "load_agent_loop_run", "validate_loop_run"):
        if hasattr(step_recorder, method_name):
            return getattr(step_recorder, method_name)
    return None


def _resolve_loop_run(resolver, project_id, loop_run_id):
    if hasattr(resolver, "resolve_loop_run"):
        return resolver.resolve_loop_run(project_id, loop_run_id)
    if hasattr(resolver, "load_agent_loop_run"):
        return resolver.load_agent_loop_run(project_id, loop_run_id)
    if hasattr(resolver, "validate_loop_run"):
        return resolver.validate_loop_run(project_id, loop_run_id)
    if callable(resolver):
        return resolver(project_id, loop_run_id)
    return None


def _agent_step_error(error_type, message, cause, fix):
    return sanitize_agent_reach_public({
        "error_type": error_type,
        "message": message,
        "cause": cause,
        "fix": fix,
    })


def _succeeded_result(project_id, normalized_counts, persist_counts, evidence_ids, artifact_refs, adapter_summary):
    return {
        "ok": True,
        "platform": PLATFORM,
        "project_id": project_id,
        "status": "succeeded",
        "normalized_counts": normalized_counts,
        "persist_counts": persist_counts,
        "evidence_ids": evidence_ids,
        "artifact_refs": artifact_refs,
        "adapter_summary": adapter_summary,
    }


def _partial_result(error_type, message, fix, project_id, normalized_counts, persist_counts, evidence_ids, artifact_refs, adapter_summary):
    return {
        "ok": True,
        "platform": PLATFORM,
        "project_id": project_id,
        "status": "partial",
        "error_type": error_type,
        "message": sanitize_agent_reach_public(message),
        "fix": sanitize_agent_reach_public(fix),
        "normalized_counts": normalized_counts,
        "persist_counts": persist_counts,
        "evidence_ids": evidence_ids,
        "artifact_refs": artifact_refs,
        "adapter_summary": adapter_summary,
    }


def _failed_result(error_type, message, fix, project_id=None, cause=None, evidence_ids=None, artifact_refs=None):
    result = {
        "ok": False,
        "platform": PLATFORM,
        "project_id": project_id,
        "status": "failed",
        "error_type": error_type,
        "message": sanitize_agent_reach_public(message),
        "fix": sanitize_agent_reach_public(fix),
        "evidence_ids": _unique(evidence_ids or []),
        "artifact_refs": _unique(artifact_refs or []),
    }
    safe_cause = sanitize_agent_reach_public(cause)
    if safe_cause:
        result["cause"] = safe_cause
    return result


def _adapter_failed_result(result, project_id):
    return _failed_result(
        "bilibili_adapter_failed",
        _safe_message(result.get("message"), "Bilibili adapter failed before normalized evidence was available."),
        _safe_message(result.get("fix"), "Inspect the controlled Agent-Reach runner setup and retry collection."),
        project_id=project_id,
        cause=result.get("error_type") or result.get("cause"),
        artifact_refs=_unique([result.get("artifact_ref")]),
    )


def _normalization_failed_result(result, project_id):
    return _failed_result(
        "bilibili_normalization_failed",
        _safe_message(result.get("message"), "Bilibili normalization failed before persistence."),
        _safe_message(result.get("fix"), "Check the Bilibili fixture shape and normalizer contract, then retry collection."),
        project_id=project_id,
        cause=result.get("error_type") or result.get("cause"),
        artifact_refs=_unique([result.get("raw_artifact_ref"), result.get("artifact_ref")]),
    )


def _persistence_failed_result(result, project_id):
    return _failed_result(
        "bilibili_persistence_failed",
        _safe_message(result.get("message"), "Bilibili persistence failed."),
        _safe_message(result.get("fix"), "Check the Bilibili writer payload and storage backend, then retry collection."),
        project_id=project_id,
        cause=result.get("error_type") or result.get("cause"),
        evidence_ids=_unique(result.get("evidence_ids") or []),
    )


def _step_output(result):
    keys = [
        "platform",
        "project_id",
        "status",
        "normalized_counts",
        "persist_counts",
        "evidence_ids",
        "artifact_refs",
        "adapter_summary",
        "error_type",
        "message",
        "fix",
    ]
    output = {"command": STEP_NAME}
    for key in keys:
        if key in result and result[key] is not None:
            output[key] = result[key]
    return sanitize_agent_reach_public(output)


def _adapter_summary(adapter_result):
    summary = sanitize_agent_reach_public(adapter_result.get("summary") or {})
    if not isinstance(summary, dict):
        return {}
    return {
        key: summary[key]
        for key in SAFE_ADAPTER_SUMMARY_FIELDS
        if key in summary and summary[key] is not None
    }


def _normalized_counts(normalized):
    return {
        "content_items": len(normalized.get("content_items") or []),
        "evidence_summaries": len(normalized.get("evidence_summaries") or []),
    }


def _persist_counts(writer_result):
    return {
        "source_accounts": _safe_int(writer_result.get("persisted_source_accounts")),
        "posts": _safe_int(writer_result.get("persisted_posts")),
        "comments": _safe_int(writer_result.get("persisted_comments")),
        "updated_posts": _safe_int(writer_result.get("updated_posts")),
    }


def _has_persisted_records(persist_counts):
    return any(persist_counts[key] > 0 for key in ("posts", "comments"))


def _runner_payload(payload):
    safe_payload = sanitize_agent_reach_public(payload)
    if not isinstance(safe_payload, dict):
        return {}
    return {
        key: value
        for key, value in safe_payload.items()
        if key != "command"
    }


def _evidence_ids(writer_result, normalized):
    ids = []
    ids.extend(writer_result.get("evidence_ids") or [])
    for item in normalized.get("content_items") or []:
        ids.extend(item.get("evidence_ids") or [])
    for item in normalized.get("evidence_summaries") or []:
        ids.append(item.get("id"))
    return _unique(ids)


def _artifact_refs(adapter_result, normalized):
    refs = [
        adapter_result.get("artifact_ref"),
        adapter_result.get("raw_artifact_ref"),
        normalized.get("raw_artifact_ref"),
    ]
    for item in normalized.get("content_items") or []:
        refs.append(item.get("raw_artifact_ref"))
    for item in normalized.get("evidence_summaries") or []:
        refs.append(item.get("raw_artifact_ref"))
    return _unique(refs)


def _unique(values):
    result = []
    seen = set()
    for value in values:
        safe = sanitize_agent_reach_public(value)
        if safe is None:
            continue
        text = str(safe)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(safe)
    return result


def _positive_int(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed


def _safe_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _safe_message(value, fallback):
    safe = sanitize_agent_reach_public(value)
    if isinstance(safe, str) and safe:
        return safe
    return fallback
