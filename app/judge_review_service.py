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
                        WHERE id=%s AND loop_run_id=%s AND project_id=%s
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


class JudgeReviewService:
    def __init__(self, run_repository=None, source_repository=None):
        self.run_repository = run_repository or MySQLAgentRunRepository()
        self.source_repository = source_repository or MySQLJudgeReviewSourceRepository()
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

        final_review = None
        for index, item in enumerate(fixture_outputs[:max_attempts]):
            output = item.get("output") if isinstance(item, dict) else {}
            final_review = rule_judge_step_output(output if isinstance(output, dict) else {}, retry_count=index)
            if final_review["status"] in {"passed", "needs_human"}:
                break

        if final_review is None:
            final_review = rule_judge_step_output({}, retry_count=0)

        return {
            "ok": True,
            "mode": "weibo-agent-mvp",
            "review": final_review,
            "retryCount": final_review.get("retry_count", 0),
            "proposalAuditId": payload.get("proposalAuditId"),
            "stepRunId": payload.get("stepRunId"),
        }
