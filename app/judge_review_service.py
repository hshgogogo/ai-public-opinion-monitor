from app.crewai_proposal_service import MySQLAgentRunRepository
from workers.agents.judge_agent import rule_judge_step_output


class MySQLJudgeReviewSourceRepository:
    def has_sources(self, run_id, project_id, proposal_audit_id, step_run_id=None):
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
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
                        return True
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
    def __init__(self, run_repository=None, source_repository=None, review_repository=None):
        self.run_repository = run_repository or MySQLAgentRunRepository()
        self.source_repository = source_repository or MySQLJudgeReviewSourceRepository()
        self.review_repository = review_repository or MySQLJudgeReviewRepository()
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
        if not self.source_repository.has_sources(
            run_id,
            payload["projectId"],
            payload["proposalAuditId"],
            payload.get("stepRunId"),
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
        fixture_outputs = payload["fixtureOutputs"]
        source_step_id = payload.get("stepRunId") or payload["proposalAuditId"]

        final_review = None
        manual_handoff = None
        for index, item in enumerate(fixture_outputs[:max_attempts]):
            output = item.get("output") if isinstance(item, dict) else {}
            final_review = rule_judge_step_output(output if isinstance(output, dict) else {}, retry_count=index)
            final_review = with_failed_output_summary(final_review, output if isinstance(output, dict) else {})
            persisted_review = self.review_repository.record_review(
                run_id,
                payload["projectId"],
                payload["proposalAuditId"],
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
            "proposalAuditId": payload.get("proposalAuditId"),
            "stepRunId": source_step_id,
        }
        if manual_handoff:
            result["manualHandoff"] = manual_handoff
        return result


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
