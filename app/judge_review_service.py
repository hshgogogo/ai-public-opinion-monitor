from app.crewai_proposal_service import MySQLAgentRunRepository
from workers.agents.judge_agent import (
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
                        if parsed["prefix"] == "analysis":
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
    mapped = map_comment_analysis_step_output(loaded.get("step"))
    if not mapped.get("ok"):
        return mapped
    return {"ok": True, "output": mapped["output"]}


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


def unsupported_step_output_error():
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": "judge_review_source_not_found",
        "message": "Judge review step output is not allowlisted for this slice.",
        "cause": "Only weibo-comments-analyze comment_analysis step outputs can be reviewed without fixtureOutputs in this change slice.",
        "fix": "Pass a comment_analysis stepRunId from weibo-comments-analyze, or use fixtureOutputs for service-level tests.",
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
    evidence_errors = list(prepared.get("evidence_errors") or [])
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
            "message": "This step output can only use comment or analysis evidence IDs.",
        })

    if len(supported_evidence_ids) != len(evidence_ids):
        required_changes.append("Use only comment-* or analysis-* evidence IDs for comment analysis Judge reviews.")
    feedback_json["evidence_ids"] = supported_evidence_ids
    prepared["feedback_json"] = feedback_json
    prepared["evidence_errors"] = evidence_errors
    prepared["required_changes"] = unique_strings(required_changes)
    prepared["passed"] = not evidence_errors
    prepared["status"] = "passed" if prepared["passed"] else "failed"
    if prepared["status"] == "failed" and int(prepared.get("retry_count") or 0) >= 2:
        prepared["status"] = "needs_human"
    return prepared


def summarize_failed_output(output):
    if not isinstance(output, dict):
        return {}
    summary = {}
    for key in ("summary", "evidence_ids", "evidenceIds"):
        if key in output:
            summary[key] = output[key]
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

    existing_evidence_ids = load_existing_judge_evidence_ids(evidence_repository, project_id, evidence_ids)
    _, missing_evidence_errors = validate_judge_evidence_ids(evidence_ids, existing_evidence_ids)
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
