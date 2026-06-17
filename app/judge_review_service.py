from app.crewai_proposal_service import MySQLAgentRunRepository
from workers.agents.judge_agent import (
    judge_evidence_citation_details,
    parse_judge_evidence_id,
    rule_judge_step_output,
    validate_judge_evidence_ids,
    validate_knowledge_references,
)


class MySQLJudgeReviewSourceRepository:
    def has_sources(self, run_id, project_id, proposal_audit_id=None, step_run_id=None):
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
                    if proposal_audit_id is not None:
                        cur.execute(
                            """
                            SELECT id
                            FROM agent_step_runs
                            WHERE id=%s AND loop_run_id=%s AND project_id=%s AND step_name='crewai_proposal_audit'
                            LIMIT 1
                            """,
                            (proposal_audit_id, run_id, project_id),
                        )
                        if cur.fetchone() is None:
                            return False
                    if step_run_id is None:
                        return proposal_audit_id is not None
                    cur.execute(
                        """
                        SELECT id
                        FROM agent_step_runs
                        WHERE id=%s AND loop_run_id=%s AND project_id=%s
                        LIMIT 1
                        """,
                        (step_run_id, run_id, project_id),
                    )
                    return cur.fetchone() is not None
        except Exception:
            return False

    def step_output_for_review(self, run_id, project_id, step_run_id):
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id, loop_run_id, project_id, step_name, status, output_json, evidence_ids
                        FROM agent_step_runs
                        WHERE id=%s AND loop_run_id=%s AND project_id=%s
                        LIMIT 1
                        """,
                        (step_run_id, run_id, project_id),
                    )
                    row = cur.fetchone()
                    if not row:
                        return {
                            "ok": False,
                            "error_type": "judge_review_source_not_found",
                            "message": "Judge review step output was not found.",
                            "cause": "The stepRunId does not belong to the requested Agent Loop run and project.",
                            "fix": "Retry with a stepRunId from the same Harness run.",
                        }
                    return {
                        "ok": True,
                        "step": {
                            "id": row.get("id"),
                            "step_name": row.get("step_name"),
                            "status": row.get("status"),
                            "output_json": db.jloads(row.get("output_json"), {}),
                            "evidence_ids": db.jloads(row.get("evidence_ids"), []),
                        },
                    }
        except Exception:
            return {
                "ok": False,
                "error_type": "judge_review_source_not_found",
                "message": "Judge review step output could not be loaded.",
                "cause": "The Harness could not load the scoped Agent Loop step output.",
                "fix": "Check the Agent Loop ledger tables and retry.",
            }


class MySQLJudgeEvidenceRepository:
    def existing_evidence_ids(self, project_id, evidence_ids):
        existing = set()
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
                    for evidence_id in evidence_ids:
                        parsed = parse_judge_evidence_id(evidence_id)
                        if parsed.get("error"):
                            continue
                        if parsed.get("kind") == "platform":
                            if parsed.get("project_id") != project_id:
                                continue
                            if parsed.get("source_type") == "text":
                                cur.execute(
                                    """
                                    SELECT id
                                    FROM social_posts
                                    WHERE project_id=%s
                                      AND platform=%s
                                      AND external_id=%s
                                      AND JSON_CONTAINS(
                                        COALESCE(JSON_EXTRACT(raw_json, '$.evidence_ids'), JSON_ARRAY()),
                                        JSON_QUOTE(%s)
                                      )
                                    LIMIT 1
                                    """,
                                    (
                                        project_id,
                                        parsed["platform"],
                                        parsed["content_item_external_id"],
                                        parsed["raw"],
                                    ),
                                )
                            else:
                                table = "social_posts" if parsed.get("source_type") == "item" else "social_comments"
                                cur.execute(
                                    f"""
                                    SELECT id
                                    FROM {table}
                                    WHERE project_id=%s AND platform=%s AND external_id=%s
                                    LIMIT 1
                                    """,
                                    (project_id, parsed["platform"], parsed["external_id"]),
                                )
                        elif parsed["prefix"] == "analysis":
                            cur.execute(
                                """
                                SELECT sr.id
                                FROM sentiment_results sr
                                JOIN social_comments c ON c.id=sr.comment_id
                                WHERE sr.id=%s AND c.project_id=%s
                                LIMIT 1
                                """,
                                (parsed["id"], project_id),
                            )
                        else:
                            table = JUDGE_EVIDENCE_TABLES[parsed["prefix"]]
                            cur.execute(
                                f"SELECT id FROM {table} WHERE id=%s AND project_id=%s LIMIT 1",
                                (parsed["id"], project_id),
                            )
                        if cur.fetchone():
                            existing.add(parsed["raw"])
        except Exception:
            return existing
        return existing

    def existing_knowledge_card_ids(self, project_id, knowledge_references):
        existing = set()
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
                    for reference in knowledge_references:
                        parsed = parse_knowledge_card_id(reference)
                        if parsed is None:
                            continue
                        cur.execute(
                            "SELECT id FROM knowledge_cards WHERE id=%s AND status='active' LIMIT 1",
                            (parsed,),
                        )
                        if cur.fetchone():
                            existing.add(f"knowledge-card-{parsed}")
        except Exception:
            return existing
        return existing


JUDGE_EVIDENCE_TABLES = {
    "target": "discovered_targets",
    "post": "social_posts",
    "comment": "social_comments",
    "event": "artist_public_opinion_events",
    "action": "publicity_actions",
    "memory": "bot_memory_items",
}


class MySQLJudgeReviewRepository:
    def record_review(self, run_id, project_id, proposal_audit_id, step_run_id, review, output):
        from workers import enterprise_worker as worker

        feedback_json = dict(review.get("feedback_json") or {})
        feedback_json["proposal_audit_id"] = proposal_audit_id
        return worker.judge_review_to_payload(worker.record_judge_review(
            loop_run_id=run_id,
            project_id=project_id,
            step_run_id=step_run_id,
            judge_agent_name="Rule Judge Agent",
            status=review["status"],
            passed=review.get("passed"),
            feedback_json=feedback_json,
            required_changes=review.get("required_changes") or [],
            evidence_errors=review.get("evidence_errors") or [],
            retry_count=review.get("retry_count", 0),
        ))

    def mark_needs_human(self, run_id, project_id, step_run_id, review):
        if not step_run_id:
            raise ValueError("step_run_id is required to mark needs_human")

        from workers import db
        from workers import enterprise_worker as worker

        error_type = "judge_retry_exhausted"
        error_message = "Judge retry exhausted and needs human handling."
        with db.connect() as conn:
            try:
                conn.begin()
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT id FROM judge_reviews WHERE id=%s AND loop_run_id=%s AND project_id=%s",
                        (review.get("id"), run_id, project_id),
                    )
                    if cur.fetchone() is None:
                        raise ValueError(f"judge_review {review.get('id')} does not belong to loop_run_id {run_id}")
                    cur.execute(
                        "SELECT id, status, step_name FROM agent_step_runs WHERE id=%s AND loop_run_id=%s AND project_id=%s",
                        (step_run_id, run_id, project_id),
                    )
                    step = cur.fetchone()
                    if not step:
                        raise ValueError(f"step_run_id {step_run_id} does not exist for loop_run_id {run_id}")
                    cur.execute(
                        """
                        UPDATE agent_step_runs
                        SET status='needs_human',
                            error_type=%s,
                            error_message=%s,
                            finished_at=NOW()
                        WHERE id=%s AND loop_run_id=%s AND project_id=%s
                        """,
                        (error_type, error_message, step_run_id, run_id, project_id),
                    )
                    cur.execute(
                        """
                        UPDATE agent_loop_runs
                        SET current_step='judge_review',
                            status='needs_human',
                            error_type=%s,
                            error_message=%s,
                            finished_at=NOW()
                        WHERE id=%s AND project_id=%s
                        """,
                        (error_type, error_message, run_id, project_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO feedback_items(project_id, source_type, source_id, feedback_type, note, status, created_by)
                        VALUES (%s,'judge_review',%s,'manual_handoff',%s,'open','agent_harness')
                        """,
                        (
                            project_id,
                            review.get("id"),
                            "Judge retry exhausted; human review is required.",
                        ),
                    )
                    feedback = worker.fetch_feedback_item(cur, cur.lastrowid)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        return {"feedback": worker.feedback_item_to_payload(feedback)}


class JudgeReviewService:
    def __init__(self, run_repository=None, source_repository=None, review_repository=None, evidence_repository=None):
        self.run_repository = run_repository or MySQLAgentRunRepository()
        self.source_repository = source_repository or MySQLJudgeReviewSourceRepository()
        self.review_repository = review_repository or MySQLJudgeReviewRepository()
        self.evidence_repository = evidence_repository or MySQLJudgeEvidenceRepository()
        self.fact_write_count = 0

    def is_mysql_available(self):
        try:
            from workers import db

            return bool(db.health().get("connected"))
        except Exception:
            return False

    def has_agent_run(self, run_id, project_id):
        return self.run_repository.has_run(run_id, project_id)

    def create_review(self, run_id, payload):
        proposal_audit_id = payload.get("proposalAuditId")
        step_run_id = payload.get("stepRunId")
        if not self.source_repository.has_sources(
            run_id,
            payload["projectId"],
            proposal_audit_id,
            step_run_id,
        ):
            return {
                "ok": False,
                "mode": "weibo-agent-mvp",
                "error_type": "judge_review_source_not_found",
                "message": "Judge review source was not found.",
                "cause": "The proposalAuditId or stepRunId does not belong to the requested Agent Loop run and project.",
                "fix": "Retry with proposal and step ids from the same Harness run.",
            }

        max_attempts = max(1, min(int(payload.get("maxAttempts") or 3), 3))
        fixture_outputs = payload.get("fixtureOutputs")
        source_step_id = step_run_id or proposal_audit_id

        if not fixture_outputs:
            loaded = load_step_output_fixture(run_id, payload["projectId"], step_run_id, self.source_repository)
            if not loaded.get("ok"):
                return loaded
            fixture_outputs = [{"output": loaded["output"]}]

        final_review = None
        manual_handoff = None
        for index, item in enumerate(fixture_outputs[:max_attempts]):
            output = item.get("output") if isinstance(item, dict) else {}
            final_review = rule_judge_step_output(output if isinstance(output, dict) else {}, retry_count=index)
            final_review = apply_step_output_evidence_prefix_boundary(
                final_review,
                output if isinstance(output, dict) else {},
            )
            final_review = resolve_judge_evidence(
                final_review,
                payload["projectId"],
                self.evidence_repository,
            )
            final_review = with_failed_output_summary(final_review, output if isinstance(output, dict) else {})
            persisted_review = self.review_repository.record_review(
                run_id,
                payload["projectId"],
                proposal_audit_id,
                source_step_id,
                final_review,
                output if isinstance(output, dict) else {},
            )
            final_review = persisted_review
            if final_review["status"] in {"passed", "needs_human"}:
                if final_review["status"] == "needs_human":
                    handoff = self.review_repository.mark_needs_human(
                        run_id,
                        payload["projectId"],
                        source_step_id,
                        final_review,
                    )
                    manual_handoff = handoff.get("feedback") if isinstance(handoff, dict) else None
                break

        if final_review is None:
            final_review = rule_judge_step_output({}, retry_count=0)

        result = {
            "ok": True,
            "mode": "weibo-agent-mvp",
            "review": final_review,
            "retryCount": final_review.get("retry_count", 0),
            "proposalAuditId": proposal_audit_id,
            "stepRunId": source_step_id,
        }
        if manual_handoff:
            result["manualHandoff"] = manual_handoff
        return result


def load_step_output_fixture(run_id, project_id, step_run_id, source_repository):
    if not step_run_id:
        return {
            "ok": False,
            "mode": "weibo-agent-mvp",
            "error_type": "judge_review_source_not_found",
            "message": "Judge review stepRunId is required for step output review.",
            "cause": "No fixtureOutputs were provided and no Agent Loop step id was available.",
            "fix": "Pass fixtureOutputs or pass an allowlisted stepRunId.",
        }
    if not hasattr(source_repository, "step_output_for_review"):
        return {
            "ok": False,
            "mode": "weibo-agent-mvp",
            "error_type": "judge_review_source_not_found",
            "message": "Judge review step output lookup is not available.",
            "cause": "The configured source repository cannot load Agent Loop step outputs.",
            "fix": "Use a source repository that supports scoped step output lookup.",
        }
    loaded = source_repository.step_output_for_review(run_id, project_id, step_run_id)
    if not isinstance(loaded, dict) or not loaded.get("ok"):
        error = loaded if isinstance(loaded, dict) else {}
        return {
            "ok": False,
            "mode": "weibo-agent-mvp",
            "error_type": error.get("error_type", "judge_review_source_not_found"),
            "message": error.get("message", "Judge review step output was not found."),
            "cause": error.get("cause", "The stepRunId does not belong to the requested Agent Loop run and project."),
            "fix": error.get("fix", "Retry with a stepRunId from the same Harness run."),
        }
    mapped = map_step_output_for_review(loaded.get("step"))
    if not mapped.get("ok"):
        return mapped
    return {"ok": True, "output": mapped["output"]}


def map_step_output_for_review(step):
    if not isinstance(step, dict):
        return unsupported_step_output_error()
    output_json = step.get("output_json") if isinstance(step.get("output_json"), dict) else {}
    command = output_json.get("command")
    if step.get("step_name") == "comment_analysis" and command == "weibo-comments-analyze":
        return map_comment_analysis_step_output(step)
    if step.get("step_name") == "event_building" and command == "weibo-events-build":
        return map_event_building_step_output(step)
    if step.get("step_name") == "action_recommendation" and command == "weibo-actions-build":
        return map_action_recommendation_step_output(step)
    return unsupported_step_output_error()


def map_comment_analysis_step_output(step):
    if not isinstance(step, dict):
        return unsupported_step_output_error()
    output_json = step.get("output_json") if isinstance(step.get("output_json"), dict) else {}
    if step.get("step_name") != "comment_analysis" or output_json.get("command") != "weibo-comments-analyze":
        return unsupported_step_output_error()
    analyzed_comments = integer_or_zero(output_json.get("analyzed_comments"))
    persisted_sentiments = integer_or_zero(output_json.get("persisted_sentiments"))
    output = {
        "summary": f"weibo-comments-analyze persisted {persisted_sentiments} sentiment result(s) from {analyzed_comments} analyzed comment(s).",
        "evidence_ids": safe_string_list(step.get("evidence_ids")),
        "_allowed_evidence_prefixes": ["comment", "analysis"],
        "_unsupported_evidence_error_type": "unsupported_comment_analysis_evidence_prefix",
        "command": "weibo-comments-analyze",
        "analyzed_comments": analyzed_comments,
        "persisted_sentiments": persisted_sentiments,
    }
    return {"ok": True, "output": output}


def map_event_building_step_output(step):
    if not isinstance(step, dict):
        return unsupported_step_output_error()
    output_json = step.get("output_json") if isinstance(step.get("output_json"), dict) else {}
    if step.get("step_name") != "event_building" or output_json.get("command") != "weibo-events-build":
        return unsupported_step_output_error()
    evidence_count = integer_or_zero(output_json.get("evidence_count"))
    persisted_events = integer_or_zero(output_json.get("persisted_events"))
    output = {
        "summary": f"weibo-events-build persisted {persisted_events} event(s) with {evidence_count} evidence reference(s).",
        "evidence_ids": normalize_event_building_evidence_ids(step.get("evidence_ids")),
        "_allowed_evidence_prefixes": ["comment", "analysis", "event"],
        "_unsupported_evidence_error_type": "unsupported_event_building_evidence_prefix",
        "_unsupported_evidence_required_change": "Use only comment-*, analysis-*, or event-* evidence IDs for event-building Judge reviews.",
        "_unsupported_evidence_message": "This step output can only use comment, analysis, or event evidence IDs.",
        "_required_source_evidence_prefixes": ["comment", "analysis"],
        "_source_evidence_error_type": "event_building_source_evidence_required",
        "_source_evidence_required_change": "Add comment-* or analysis-* source evidence before treating an event-building output as accepted.",
        "command": "weibo-events-build",
        "evidence_count": evidence_count,
        "persisted_events": persisted_events,
    }
    return {"ok": True, "output": output}


def map_action_recommendation_step_output(step):
    if not isinstance(step, dict):
        return unsupported_step_output_error()
    output_json = step.get("output_json") if isinstance(step.get("output_json"), dict) else {}
    if step.get("step_name") != "action_recommendation" or output_json.get("command") != "weibo-actions-build":
        return unsupported_step_output_error()
    persisted_actions = integer_or_zero(output_json.get("persisted_actions"))
    candidate_events = action_candidate_event_count(output_json)
    output = {
        "summary": action_step_summary(output_json, persisted_actions, candidate_events),
        "evidence_ids": normalize_action_recommendation_evidence_ids(step.get("evidence_ids")),
        "knowledge_references": action_step_knowledge_references(output_json),
        "_allowed_evidence_prefixes": ["target", "post", "comment", "analysis", "event", "action", "memory"],
        "_unsupported_evidence_error_type": "unsupported_action_recommendation_evidence_prefix",
        "_unsupported_evidence_required_change": (
            "Use only target-*, post-*, comment-*, analysis-*, event-*, action-*, or memory-* evidence IDs "
            "for action recommendation Judge reviews."
        ),
        "_unsupported_evidence_message": "This step output can only use project evidence IDs for action recommendation reviews.",
        "_required_source_evidence_prefixes": ["target", "post", "comment", "analysis", "event", "memory"],
        "_source_evidence_error_type": "action_recommendation_source_evidence_required",
        "_source_evidence_required_change": (
            "Add at least one real target, post, comment, analysis, event, or memory evidence ID before "
            "treating an action recommendation output as accepted."
        ),
        "command": "weibo-actions-build",
        "candidate_events": candidate_events,
        "persisted_actions": persisted_actions,
    }
    recommendations = sanitized_action_recommendations(output_json.get("recommendations"))
    if recommendations:
        output["recommendations"] = recommendations
    suggestions = sanitized_action_recommendations(output_json.get("suggestions"))
    if suggestions:
        output["suggestions"] = suggestions
    knowledge_details = sanitized_knowledge_reference_details(output_json.get("knowledge_reference_details"))
    if knowledge_details:
        output["knowledge_reference_details"] = knowledge_details
    return {"ok": True, "output": output}


def action_candidate_event_count(output_json):
    if "candidate_events" in output_json:
        return integer_or_zero(output_json.get("candidate_events"))
    return integer_or_zero(output_json.get("events_considered"))


def action_step_summary(output_json, persisted_actions, candidate_events):
    summary = output_json.get("summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    return f"weibo-actions-build persisted {persisted_actions} action(s) from {candidate_events} candidate event(s)."


def action_step_knowledge_references(output_json):
    references = output_json.get("knowledge_references")
    if references is None:
        references = output_json.get("knowledgeReferences")
    return safe_knowledge_reference_list(references)


ACTION_RECOMMENDATION_TEXT_KEYS = ("text", "summary", "content", "recommendation", "action", "next_step", "nextStep")
ACTION_RECOMMENDATION_OWNER_KEYS = ("owner", "owner_suggestion", "ownerSuggestion", "assignee")
ACTION_RECOMMENDATION_CHECK_AFTER_KEYS = (
    "check_after",
    "checkAfter",
    "recommended_check_after_at",
    "recommendedCheckAfterAt",
    "review_after",
    "reviewAfter",
)


def sanitized_action_recommendations(values):
    if values is None:
        return []
    if not isinstance(values, list):
        values = [values]
    recommendations = []
    for value in values:
        item = sanitize_action_recommendation(value)
        if item:
            recommendations.append(item)
    return recommendations


def sanitize_action_recommendation(value):
    if isinstance(value, str):
        text = value.strip()
        return {"text": text} if text else {}
    if not isinstance(value, dict):
        return {}
    item = {}
    text = first_non_empty_text(value, ACTION_RECOMMENDATION_TEXT_KEYS)
    if text:
        item["text"] = text
    reason = value.get("reason")
    if isinstance(reason, str) and reason.strip():
        item["reason"] = reason.strip()
    owner = first_non_empty_text(value, ACTION_RECOMMENDATION_OWNER_KEYS)
    if owner:
        item["owner"] = owner
    priority = value.get("priority")
    if isinstance(priority, str) and priority.strip():
        item["priority"] = priority.strip()
    check_after = first_non_empty_text(value, ACTION_RECOMMENDATION_CHECK_AFTER_KEYS)
    if check_after:
        item["check_after"] = check_after
    action_type = value.get("action_type") or value.get("actionType")
    if isinstance(action_type, str) and action_type.strip():
        item["action_type"] = action_type.strip()
    evidence_ids = safe_string_list(value.get("evidence_ids") if "evidence_ids" in value else value.get("evidenceIds"))
    if evidence_ids:
        item["evidence_ids"] = evidence_ids
    related_event_id = value.get("related_event_id") or value.get("relatedEventId")
    if related_event_id is not None:
        text_event_id = str(related_event_id).strip()
        if text_event_id:
            item["related_event_id"] = text_event_id
    return item


def sanitized_knowledge_reference_details(values):
    if values is None:
        return []
    if not isinstance(values, list):
        values = [values]
    details = []
    for value in values:
        item = sanitize_knowledge_reference_detail(value)
        if item:
            details.append(item)
    return details


def sanitize_knowledge_reference_detail(value):
    if isinstance(value, str):
        text = value.strip()
        return {"id": text} if text else {}
    if not isinstance(value, dict):
        return {}
    item = {}
    reference_id = value.get("id") or value.get("card_id") or value.get("cardId")
    if reference_id is not None:
        text = str(reference_id).strip()
        if text:
            if text.isdigit() and not text.startswith("0"):
                text = f"knowledge-card-{text}"
            item["id"] = text
    reliability = value.get("reliability_level") or value.get("reliabilityLevel")
    if isinstance(reliability, str) and reliability.strip():
        item["reliability_level"] = reliability.strip()
    usage = value.get("usage") or value.get("citation_role") or value.get("citationRole") or value.get("role")
    if isinstance(usage, str) and usage.strip():
        item["usage"] = usage.strip()
    return item


def first_non_empty_text(values, keys):
    for key in keys:
        value = values.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def normalize_event_building_evidence_ids(values):
    normalized = []
    for value in safe_string_list(values):
        if value.isdigit() and not value.startswith("0"):
            normalized.append(f"comment-{value}")
            continue
        normalized.append(value)
    return normalized


def normalize_action_recommendation_evidence_ids(values):
    normalized = []
    raw_values = safe_string_list(values)
    event_suffixes = set()
    for value in raw_values:
        if value.startswith("event-"):
            parsed = parse_judge_evidence_id(value)
            if not parsed.get("error"):
                event_suffixes.add(str(parsed["id"]))
    for value in raw_values:
        if value.isdigit() and not value.startswith("0"):
            if value in event_suffixes:
                continue
            normalized.append(f"comment-{value}")
            continue
        normalized.append(value)
    return normalized


def unsupported_step_output_error():
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": "judge_review_source_not_found",
        "message": "Judge review step output is not allowlisted for this slice.",
        "cause": "Only allowlisted Agent Loop step outputs can be reviewed without fixtureOutputs in this change slice.",
        "fix": "Pass a comment_analysis stepRunId from weibo-comments-analyze, an event_building stepRunId from weibo-events-build, an action_recommendation stepRunId from weibo-actions-build, or use fixtureOutputs for service-level tests.",
    }


def integer_or_zero(value):
    try:
        return int(value or 0)
    except Exception:
        return 0


def safe_string_list(values):
    if not isinstance(values, list):
        return []
    prepared = []
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            prepared.append(text)
    return prepared


def safe_knowledge_reference_list(values):
    if values is None:
        return []
    if not isinstance(values, list):
        values = [values]
    prepared = []
    for value in values:
        if isinstance(value, dict):
            value = value.get("id") or value.get("card_id") or value.get("cardId")
            if value is None:
                continue
            text = str(value).strip()
            if text.isdigit() and not text.startswith("0"):
                text = f"knowledge-card-{text}"
            if text:
                prepared.append(text)
            continue
        if value is None:
            continue
        text = str(value).strip()
        if text:
            prepared.append(text)
    return prepared


def apply_step_output_evidence_prefix_boundary(review, output):
    if not isinstance(output, dict):
        return review
    allowed_prefixes = output.get("_allowed_evidence_prefixes")
    if not isinstance(allowed_prefixes, list) or not allowed_prefixes:
        return review

    allowed = {str(prefix) for prefix in allowed_prefixes}
    error_type = str(output.get("_unsupported_evidence_error_type") or "unsupported_step_evidence_prefix")
    prepared = dict(review)
    feedback_json = dict(prepared.get("feedback_json") or {})
    evidence_ids = list(feedback_json.get("evidence_ids") or [])
    evidence_errors = remap_step_unsupported_prefix_errors(
        prepared.get("evidence_errors") or [],
        output,
    )
    required_changes = list(prepared.get("required_changes") or [])
    supported_evidence_ids = []

    for evidence_id in evidence_ids:
        parsed = parse_judge_evidence_id(evidence_id)
        if parsed.get("error"):
            continue
        if parsed.get("prefix") in allowed:
            supported_evidence_ids.append(parsed["raw"])
            continue
        evidence_errors.append({
            "error_type": error_type,
            "evidence_id": parsed["raw"],
            "message": str(output.get("_unsupported_evidence_message") or "This step output uses an unsupported evidence ID prefix."),
        })

    if len(supported_evidence_ids) != len(evidence_ids):
        required_changes.append(str(
            output.get("_unsupported_evidence_required_change")
            or "Use only allowlisted evidence IDs for this step Judge review."
        ))
    source_prefixes = output.get("_required_source_evidence_prefixes")
    if isinstance(source_prefixes, list) and source_prefixes:
        required_source_prefixes = {str(prefix) for prefix in source_prefixes}
        has_source_evidence = False
        for evidence_id in supported_evidence_ids:
            parsed = parse_judge_evidence_id(evidence_id)
            if not parsed.get("error") and parsed.get("prefix") in required_source_prefixes:
                has_source_evidence = True
                break
        if not has_source_evidence and supported_evidence_ids:
            evidence_errors.append({
                "error_type": str(output.get("_source_evidence_error_type") or "source_evidence_required"),
                "message": "This step output needs source evidence IDs, not only derived records.",
            })
            required_changes.append(str(
                output.get("_source_evidence_required_change")
                or "Add source evidence IDs before accepting this step output."
            ))
    feedback_json["evidence_ids"] = supported_evidence_ids
    prepared["feedback_json"] = feedback_json
    prepared["evidence_errors"] = evidence_errors
    prepared["required_changes"] = unique_strings(required_changes)
    prepared["passed"] = not evidence_errors
    prepared["status"] = "passed" if prepared["passed"] else "failed"
    if prepared["status"] == "failed" and int(prepared.get("retry_count") or 0) >= 2:
        prepared["status"] = "needs_human"
    return prepared


def remap_step_unsupported_prefix_errors(evidence_errors, output):
    error_type = str(output.get("_unsupported_evidence_error_type") or "unsupported_step_evidence_prefix")
    message = str(output.get("_unsupported_evidence_message") or "This step output uses an unsupported evidence ID prefix.")
    remapped = []
    for error in evidence_errors:
        if not isinstance(error, dict) or error.get("error_type") != "unsupported_evidence_prefix":
            remapped.append(error)
            continue
        prepared = dict(error)
        prepared["error_type"] = error_type
        prepared["message"] = message
        remapped.append(prepared)
    return remapped


def summarize_failed_output(output):
    if not isinstance(output, dict):
        return {}
    summary = {}
    summary_text = output.get("summary")
    if isinstance(summary_text, str) and summary_text.strip():
        summary["summary"] = summary_text.strip()
    evidence_ids = safe_string_list(output.get("evidence_ids") if "evidence_ids" in output else output.get("evidenceIds"))
    if evidence_ids:
        summary["evidence_ids"] = evidence_ids
    recommendations = sanitized_action_recommendations(output.get("recommendations"))
    if recommendations:
        summary["recommendations"] = recommendations
    suggestions = sanitized_action_recommendations(output.get("suggestions"))
    if suggestions:
        summary["suggestions"] = suggestions
    knowledge_references = safe_knowledge_reference_list(
        output.get("knowledge_references") if "knowledge_references" in output else output.get("knowledgeReferences")
    )
    if knowledge_references:
        summary["knowledge_references"] = knowledge_references
    knowledge_details = sanitized_knowledge_reference_details(output.get("knowledge_reference_details"))
    if knowledge_details:
        summary["knowledge_reference_details"] = knowledge_details
    return summary


def with_failed_output_summary(review, output):
    prepared = dict(review)
    feedback_json = dict(prepared.get("feedback_json") or {})
    feedback_json["failed_output_summary"] = summarize_failed_output(output)
    prepared["feedback_json"] = feedback_json
    return prepared


def resolve_judge_evidence(review, project_id, evidence_repository):
    prepared = dict(review)
    feedback_json = dict(prepared.get("feedback_json") or {})
    evidence_ids = feedback_json.get("evidence_ids") or []
    knowledge_references = feedback_json.get("knowledge_references") or []
    evidence_errors = list(prepared.get("evidence_errors") or [])
    required_changes = list(prepared.get("required_changes") or [])

    project_evidence_ids, project_evidence_errors = validate_judge_evidence_ids(evidence_ids, project_id=project_id)
    if project_evidence_errors:
        evidence_errors.extend(project_evidence_errors)
        required_changes.append("Use only evidence IDs that belong to the current project.")
    feedback_json["evidence_ids"] = project_evidence_ids
    citation_details = judge_evidence_citation_details(project_evidence_ids)
    if citation_details:
        feedback_json["citation_details"] = citation_details

    existing_evidence_ids = load_existing_judge_evidence_ids(evidence_repository, project_id, project_evidence_ids)
    _, missing_evidence_errors = validate_judge_evidence_ids(
        project_evidence_ids,
        existing_evidence_ids,
        project_id=project_id,
    )
    if missing_evidence_errors:
        evidence_errors.extend(missing_evidence_errors)
        required_changes.append("Use only evidence IDs that exist in the current project.")

    existing_knowledge_references = load_existing_knowledge_references(
        evidence_repository,
        project_id,
        knowledge_references,
    )
    _, knowledge_errors = validate_knowledge_references(knowledge_references, existing_knowledge_references)
    if knowledge_errors:
        evidence_errors.extend(knowledge_errors)
        required_changes.append("Use only active knowledge-card references in output.knowledge_references.")

    prepared["evidence_errors"] = evidence_errors
    prepared["required_changes"] = unique_strings(required_changes)
    prepared["passed"] = not evidence_errors
    prepared["status"] = "passed" if prepared["passed"] else "failed"
    if prepared["status"] == "failed" and int(prepared.get("retry_count") or 0) >= 2:
        prepared["status"] = "needs_human"
    prepared["feedback_json"] = feedback_json
    return prepared


def load_existing_judge_evidence_ids(evidence_repository, project_id, evidence_ids):
    if not evidence_ids or not hasattr(evidence_repository, "existing_evidence_ids"):
        return set()
    return set(evidence_repository.existing_evidence_ids(project_id, evidence_ids) or [])


def load_existing_knowledge_references(evidence_repository, project_id, knowledge_references):
    if not knowledge_references or not hasattr(evidence_repository, "existing_knowledge_card_ids"):
        return set()
    return set(evidence_repository.existing_knowledge_card_ids(project_id, knowledge_references) or [])


def parse_knowledge_card_id(reference):
    text = str(reference).strip()
    prefix = "knowledge-card-"
    if not text.startswith(prefix):
        return None
    suffix = text[len(prefix):]
    if not suffix.isdigit() or suffix.startswith("0"):
        return None
    return int(suffix)


def unique_strings(values):
    seen = set()
    unique = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique
