import os
import re
from datetime import date

os.environ["YUQING_SKIP_ENV_FILE"] = "1"

from app.crewai_proposal_service import MySQLAgentRunRepository, agent_run_not_found_error
from app.legacy_worker import sanitize_for_public


PUBLIC_DAILY_REPORT_FIELDS = {"projectId", "reportDate", "evidenceIds"}
PUBLIC_ACTION_BACKTEST_FIELDS = {"projectId", "evidenceIds"}
BACKTEST_RESULT_VALUES = {"strong", "medium", "weak", "no_signal", "negative", "unknown"}
COVERAGE_FIELDS = ("comments", "events", "actions", "backtests")
EVIDENCE_ID_PATTERN = re.compile(
    r"^(comment|post|target|event|action|memory|sentiment|backtest|report):[1-9][0-9]*$"
)
DANGEROUS_PUBLIC_KEYS = {
    "browser_state",
    "browser_state_ref",
    "browserstate",
    "browserstateref",
    "command",
    "cookie",
    "database_url",
    "databaseurl",
    "db_url",
    "dburl",
    "dsn",
    "fixture",
    "fixture_path",
    "fixturepath",
    "path",
    "raw_artifact",
    "raw_artifact_ref",
    "rawartifact",
    "rawartifactref",
    "raw_output",
    "raw_stdout",
    "raw_stderr",
    "rawoutput",
    "rawstdout",
    "rawstderr",
    "stderr",
    "stdout",
    "storage_state",
    "storage_state_ref",
    "storagestate",
    "storagestateref",
    "token",
}
DANGEROUS_VALUE_MARKERS = (
    ".env",
    "../",
    "/tmp/",
    "/users/",
    "api_key",
    "authorization",
    "basic ",
    "bearer ",
    "browser state",
    "collector transcript",
    "collector_transcript",
    "config/cookies",
    "cookie",
    "database_url",
    "db_url",
    "dsn=",
    "login state",
    "mariadb://",
    "mysql://",
    "mysql+pymysql://",
    "passwd",
    "password",
    "pwd=",
    "private login state",
    "raw runner output",
    "raw-stdout",
    "raw_stderr",
    "raw_stdout",
    "rawstderr",
    "rawstdout",
    "secret",
    "storage state",
    "token",
    "weibo.json",
)
PUBLIC_PATH_PATTERN = re.compile(
    r"(^|[\s=:\"'(\[])(/[^ \t\r\n\"')\]]{2,}|[A-Za-z]:\\[^ \t\r\n\"')\]]+)"
)
RAW_ARTIFACT_FILENAME_PATTERN = re.compile(
    r"(?i)(raw|stdout|stderr|trace|transcript|artifact|worker-output)[^ \t\r\n\"')\]]*\.(json|jsonl|log|txt)"
)


class MySQLActionRepository:
    def has_action(self, action_id, project_id):
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT id FROM publicity_actions WHERE id=%s AND project_id=%s LIMIT 1",
                        (action_id, project_id),
                    )
                    return cur.fetchone() is not None
        except Exception:
            return False


class MySQLEvidenceRepository:
    def existing_evidence_ids(self, project_id, evidence_ids):
        existing = set()
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
                    for evidence_id in evidence_ids:
                        parsed = parse_evidence_id(evidence_id)
                        if parsed is None:
                            continue
                        kind = parsed["kind"]
                        row_id = parsed["id"]
                        if kind == "sentiment":
                            cur.execute(
                                """
                                SELECT sr.id
                                FROM sentiment_results sr
                                JOIN social_comments c ON c.id=sr.comment_id
                                WHERE sr.id=%s AND c.project_id=%s
                                LIMIT 1
                                """,
                                (row_id, project_id),
                            )
                        else:
                            table = EVIDENCE_TABLES[kind]
                            cur.execute(
                                f"SELECT id FROM {table} WHERE id=%s AND project_id=%s LIMIT 1",
                                (row_id, project_id),
                            )
                        if cur.fetchone():
                            existing.add(evidence_id)
        except Exception:
            return existing
        return existing


class MySQLAgentStepRepository:
    def record_step(self, step):
        from workers import enterprise_worker as worker

        row = worker.record_agent_step_run(
            loop_run_id=step.get("run_id"),
            project_id=step.get("project_id"),
            agent_name=step.get("agent_name"),
            step_name=step.get("step_name"),
            status=step.get("status") or "running",
            input_json=step.get("input_json"),
            output_json=step.get("output_json"),
            evidence_ids=step.get("evidence_ids") or [],
        )
        return {"id": row.get("id")}

    def update_step_status(self, step_run_id, status, error_type=None, error_message=None):
        from workers import db

        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE agent_step_runs
                    SET status=%s,
                        error_type=%s,
                        error_message=%s,
                        finished_at=NOW()
                    WHERE id=%s
                    """,
                    (status, error_type, error_message, step_run_id),
                )
        return {"id": step_run_id}


class DeterministicReportBacktestAdapter:
    def __init__(self, worker_module=None):
        self.worker_module = worker_module

    def run_daily_report(self, request):
        evidence_ids = safe_evidence_ids(request.get("evidence_ids"))
        worker = self._worker()
        report = worker.daily_report(records_from_evidence_ids(evidence_ids), request.get("report_date") or date.today().isoformat())
        return {
            "ok": True,
            "summary": "Daily report generated by deterministic worker helper from scoped evidence.",
            "coverage": report.get("dataCoverage") or evidence_coverage(evidence_ids),
            "evidenceIds": safe_evidence_ids(report.get("evidence_ids")) or evidence_ids,
            "reportDate": request.get("report_date"),
            "judgeReviewStatus": "pending",
        }

    def run_action_backtest(self, request):
        evidence_ids = safe_evidence_ids(request.get("evidence_ids"))
        worker = self._worker()
        result = worker.backtest_scenario(backtest_scenario_from_request(request, evidence_ids))
        if result.get("result") == "unknown":
            return {
                "ok": True,
                "result": "unknown",
                "summary": "Action backtest is unknown because deterministic worker helper found missing evidence windows.",
                "missingDataReason": result.get("missing_data_reason") or "missing_evidence_window",
                "nextRecommendation": result.get("next_recommendation") or "Collect scoped pre/post evidence windows before treating this action as evaluated.",
                "confounders": safe_string_list(result.get("confounders")),
                "evidenceIds": [f"action:{request['action_id']}"],
                "judgeReviewStatus": "pending",
            }
        return {
            "ok": True,
            "result": safe_text(result.get("result")) or "unknown",
            "summary": "Action backtest generated by deterministic worker helper and avoids causal overclaiming.",
            "nextRecommendation": safe_text(result.get("next_recommendation")) or "Keep monitoring the next scoped evidence window before drawing stronger conclusions.",
            "confounders": safe_string_list(result.get("confounders")),
            "evidenceIds": evidence_ids,
            "judgeReviewStatus": "pending",
        }

    def _worker(self):
        if self.worker_module is not None:
            return self.worker_module
        from workers import enterprise_worker

        return enterprise_worker


class ReportBacktestAgentService:
    def __init__(
        self,
        runtime_adapter=None,
        run_repository=None,
        action_repository=None,
        evidence_repository=None,
        step_repository=None,
        judge_review_service=None,
    ):
        self.runtime_adapter = runtime_adapter or DeterministicReportBacktestAdapter()
        self.run_repository = run_repository or MySQLAgentRunRepository()
        self.action_repository = action_repository or MySQLActionRepository()
        self.evidence_repository = evidence_repository or MySQLEvidenceRepository()
        self.step_repository = step_repository
        if self.step_repository is None and os.environ.get("MYSQL_URL"):
            self.step_repository = MySQLAgentStepRepository()
        if judge_review_service is None:
            from app.judge_review_service import JudgeReviewService

            judge_review_service = JudgeReviewService()
        self.judge_review_service = judge_review_service

    def is_mysql_available(self):
        try:
            from workers import db

            return bool(db.health().get("connected"))
        except Exception:
            return False

    def create_daily_report(self, run_id, payload):
        validation_error = validate_daily_report_payload(payload)
        if validation_error:
            return validation_error

        project_id = positive_integer(payload.get("projectId"))
        if not self.run_repository.has_run(run_id, project_id):
            return agent_run_not_found_error(run_id, project_id)

        evidence_error = validate_request_evidence_scope(project_id, payload.get("evidenceIds"), self.evidence_repository)
        if evidence_error:
            return evidence_error

        request = {
            "project_id": project_id,
            "agent_loop_run_id": run_id,
            "report_date": payload.get("reportDate"),
            "evidence_ids": list(payload.get("evidenceIds") or []),
        }
        try:
            result = self.runtime_adapter.run_daily_report(request)
        except Exception:
            return report_backtest_runtime_failed_error("daily report")
        return daily_report_public_response(self.review_and_record_step("daily_report", result, request), request)

    def create_action_backtest(self, run_id, action_id, payload):
        validation_error = validate_action_backtest_payload(payload)
        if validation_error:
            return validation_error

        project_id = positive_integer(payload.get("projectId"))
        if not self.run_repository.has_run(run_id, project_id):
            return agent_run_not_found_error(run_id, project_id)
        if positive_integer(action_id) is None:
            return invalid_action_id_error()
        if not self.action_repository.has_action(action_id, project_id):
            return action_not_found_error(action_id, project_id)

        evidence_error = validate_request_evidence_scope(project_id, payload.get("evidenceIds"), self.evidence_repository)
        if evidence_error:
            return evidence_error

        request = {
            "project_id": project_id,
            "agent_loop_run_id": run_id,
            "action_id": action_id,
            "evidence_ids": list(payload.get("evidenceIds") or []),
        }
        try:
            result = self.runtime_adapter.run_action_backtest(request)
        except Exception:
            return report_backtest_runtime_failed_error("action backtest")
        return action_backtest_public_response(self.review_and_record_step("action_backtest", result, request), request)

    def review_and_record_step(self, step_name, result, request):
        if not isinstance(result, dict) or result.get("ok") is False:
            return result

        step_output = report_backtest_step_output(step_name, result, request)
        step_status = report_backtest_step_status(step_name, result)
        step_run_id = record_report_backtest_step(self.step_repository, step_name, request, step_output, step_status)
        review_result = create_report_backtest_judge_review(
            self.judge_review_service,
            request,
            step_run_id,
            judge_report_backtest_step_output(step_name, step_output),
        )
        public_review = judge_review_public_payload(review_result)
        reviewed = dict(result)
        if public_review:
            reviewed["judgeReview"] = public_review
            reviewed["judgeReviewStatus"] = public_review["status"]
            reviewed["status"] = public_status_from_judge(step_status, public_review["status"])
            update_report_backtest_step_status(
                self.step_repository,
                step_run_id,
                reviewed["status"],
                public_review["status"],
            )
        return reviewed


def record_report_backtest_step(step_repository, step_name, request, output_json, status):
    if step_repository is None or not hasattr(step_repository, "record_step"):
        return None
    step = {
        "run_id": request.get("agent_loop_run_id"),
        "project_id": request.get("project_id"),
        "agent_name": "Report Agent" if step_name == "daily_report" else "Backtest Agent",
        "step_name": step_name,
        "status": status,
        "input_json": report_backtest_step_input(step_name, request),
        "output_summary": output_json.get("summary"),
        "output_json": output_json,
        "evidence_ids": safe_evidence_ids(output_json.get("evidenceIds")),
        "business_refs": report_backtest_business_refs(step_name, request, output_json),
    }
    recorded = step_repository.record_step(step)
    if isinstance(recorded, dict):
        return positive_integer(recorded.get("id")) or positive_integer(recorded.get("stepRunId"))
    return positive_integer(recorded)


def update_report_backtest_step_status(step_repository, step_run_id, public_status, judge_status):
    if step_run_id is None or step_repository is None or not hasattr(step_repository, "update_step_status"):
        return
    error_type = None
    error_message = None
    if judge_status == "failed":
        error_type = "judge_review_failed"
        error_message = "Judge review rejected the Report/Backtest Agent output."
    elif judge_status == "needs_human":
        error_type = "judge_review_needs_human"
        error_message = "Judge review requires human handling."
    elif judge_status == "retry-exhausted":
        error_type = "judge_retry_exhausted"
        error_message = "Judge retry exhausted and needs human handling."
    step_repository.update_step_status(step_run_id, public_status, error_type=error_type, error_message=error_message)


def create_report_backtest_judge_review(judge_review_service, request, step_run_id, output):
    if step_run_id is None or judge_review_service is None or not hasattr(judge_review_service, "create_review"):
        return None
    try:
        return judge_review_service.create_review(request.get("agent_loop_run_id"), {
            "projectId": request.get("project_id"),
            "stepRunId": step_run_id,
            "maxAttempts": 3,
            "fixtureOutputs": [{"output": output}],
        })
    except Exception:
        return {
            "ok": True,
            "review": {
                "status": "failed",
                "passed": False,
                "retry_count": 0,
                "required_changes": ["Judge review failed before accepting this output."],
                "evidence_errors": [{"error_type": "judge_review_failed"}],
                "feedback_json": {},
            },
        }


def report_backtest_step_input(step_name, request):
    payload = {
        "project_id": request.get("project_id"),
        "agent_loop_run_id": request.get("agent_loop_run_id"),
        "evidence_ids": list(request.get("evidence_ids") or []),
    }
    if step_name == "daily_report":
        payload["report_date"] = request.get("report_date")
    else:
        payload["action_id"] = request.get("action_id")
    return payload


def report_backtest_business_refs(step_name, request, output_json):
    if step_name == "daily_report":
        refs = {"report_date": output_json.get("reportDate") or request.get("report_date")}
        report_id = positive_integer(output_json.get("reportId"))
        if report_id is not None:
            refs["report_id"] = report_id
        return {key: value for key, value in refs.items() if value is not None}
    refs = {"action_id": request.get("action_id")}
    backtest_id = positive_integer(output_json.get("backtestId"))
    if backtest_id is not None:
        refs["backtest_id"] = backtest_id
    return {key: value for key, value in refs.items() if value is not None}


def report_backtest_step_status(step_name, result):
    if step_name == "action_backtest":
        detail = result.get("backtest") if isinstance(result.get("backtest"), dict) else result
        backtest_result = safe_backtest_result(detail.get("result") or result.get("result"))
        return safe_backtest_status(result.get("status"), detail.get("result") or result.get("result"), backtest_result)
    return safe_status(result.get("status") or "succeeded")


def report_backtest_step_output(step_name, result, request):
    detail_key = "report" if step_name == "daily_report" else "backtest"
    detail = result.get(detail_key) if isinstance(result.get(detail_key), dict) else result
    output = {
        "command": "weibo-daily-report" if step_name == "daily_report" else "weibo-action-backtest",
        "summary": safe_text(detail.get("summary") or result.get("summary")),
        "evidenceIds": first_evidence_ids(result, detail, request),
    }
    if step_name == "daily_report":
        output["coverage"] = safe_coverage(detail.get("coverage") or detail.get("dataCoverage") or result.get("coverage"))
        report_date = safe_text(detail.get("reportDate") or result.get("reportDate") or request.get("report_date"))
        if report_date:
            output["reportDate"] = report_date
        report_id = positive_integer(detail.get("id") or detail.get("reportId") or result.get("reportId"))
        if report_id is not None:
            output["reportId"] = report_id
        return {key: value for key, value in output.items() if value not in (None, [], {})}

    raw_result = detail.get("result") or result.get("result")
    output["result"] = safe_backtest_result(raw_result)
    next_recommendation = safe_text(
        detail.get("nextRecommendation")
        or detail.get("next_recommendation")
        or result.get("nextRecommendation")
        or result.get("next_recommendation")
    )
    if next_recommendation:
        output["nextRecommendation"] = next_recommendation
    missing_reason = safe_text(
        detail.get("missingDataReason")
        or detail.get("missing_data_reason")
        or result.get("missingDataReason")
        or result.get("missing_data_reason")
    )
    if missing_reason:
        output["missingDataReason"] = missing_reason
    confounders = safe_string_list(detail.get("confounders") or result.get("confounders"))
    if confounders:
        output["confounders"] = confounders
    backtest_id = positive_integer(detail.get("id") or detail.get("backtestId") or result.get("backtestId"))
    if backtest_id is not None:
        output["backtestId"] = backtest_id
    add_model_owned_metric_fields(output, result, detail)
    return {key: value for key, value in output.items() if value not in (None, [], {})}


def add_model_owned_metric_fields(output, result, detail):
    for key in ("modelProvidedMetric", "model_provided_metric", "modelOwnedMetric", "model_owned_metric", "observed_signal"):
        value = detail.get(key) if isinstance(detail, dict) and key in detail else result.get(key)
        text = safe_text(value)
        if text:
            output[key] = text


def judge_report_backtest_step_output(step_name, output_json):
    output = dict(output_json)
    output["evidence_ids"] = judge_evidence_ids_from_public(output.get("evidenceIds"))
    output.pop("evidenceIds", None)
    if step_name == "daily_report":
        output["_allowed_evidence_prefixes"] = ["target", "post", "comment", "analysis", "event", "action", "memory"]
        output["_unsupported_evidence_error_type"] = "unsupported_daily_report_evidence_prefix"
    else:
        output["_allowed_evidence_prefixes"] = ["target", "post", "comment", "analysis", "event", "action", "memory"]
        output["_unsupported_evidence_error_type"] = "unsupported_action_backtest_evidence_prefix"
    return output


def judge_evidence_ids_from_public(evidence_ids):
    prepared = []
    for evidence_id in safe_evidence_ids(evidence_ids):
        parsed = parse_evidence_id(evidence_id)
        if parsed is None:
            continue
        kind = "analysis" if parsed["kind"] == "sentiment" else parsed["kind"]
        prepared.append(f"{kind}-{parsed['id']}")
    return prepared


def judge_review_public_payload(review_result):
    if not isinstance(review_result, dict) or not review_result.get("ok", True):
        return None
    review = review_result.get("review") if isinstance(review_result.get("review"), dict) else review_result
    if not isinstance(review, dict):
        return None
    status = safe_judge_review_status(review.get("status"))
    payload = {
        "status": status,
        "passed": review.get("passed") if isinstance(review.get("passed"), bool) else status == "passed",
        "retryCount": integer_or_zero(review.get("retry_count") if "retry_count" in review else review_result.get("retryCount")),
        "requiredChanges": safe_string_list(review.get("required_changes") or review.get("requiredChanges")),
        "evidenceErrors": safe_evidence_errors(review.get("evidence_errors") or review.get("evidenceErrors")),
    }
    review_id = safe_text(review.get("id"))
    if review_id:
        payload["id"] = review_id
    feedback_json = review.get("feedback_json") if isinstance(review.get("feedback_json"), dict) else {}
    failed_summary = safe_failed_output_summary(
        feedback_json.get("failed_output_summary")
        or review.get("failedOutputSummary")
        or review.get("failed_output_summary")
    )
    if failed_summary:
        payload["failedOutputSummary"] = failed_summary
    return payload


def safe_judge_review_status(value):
    text = safe_text(value)
    if text in {"passed", "failed", "needs_human", "retry-exhausted", "retry_exhausted"}:
        return "retry-exhausted" if text == "retry_exhausted" else text
    return "pending"


def public_status_from_judge(step_status, judge_status):
    if judge_status == "passed":
        return step_status
    if judge_status == "failed":
        return "failed"
    if judge_status in {"needs_human", "retry-exhausted"}:
        return "needs_human"
    return step_status


def safe_evidence_errors(values):
    if not isinstance(values, list):
        return []
    errors = []
    for value in values:
        if not isinstance(value, dict):
            continue
        item = {}
        for key in ("error_type", "evidence_id", "message", "path"):
            text = safe_text(value.get(key))
            if text:
                item[key] = text
        if item:
            errors.append(item)
    return errors


def safe_failed_output_summary(value):
    if not isinstance(value, dict):
        return {}
    summary = {}
    text = safe_text(value.get("summary"))
    if text:
        summary["summary"] = text
    evidence_ids = safe_string_list(value.get("evidence_ids") or value.get("evidenceIds"))
    if evidence_ids:
        summary["evidence_ids"] = evidence_ids
    return summary


def integer_or_zero(value):
    try:
        return int(value or 0)
    except Exception:
        return 0


EVIDENCE_TABLES = {
    "comment": "social_comments",
    "post": "social_posts",
    "target": "discovered_targets",
    "event": "artist_public_opinion_events",
    "action": "publicity_actions",
    "memory": "bot_memory_items",
    "sentiment": "sentiment_results",
    "backtest": "action_backtests",
    "report": "daily_reports",
}


def validate_daily_report_payload(payload):
    return validate_report_backtest_payload(payload, PUBLIC_DAILY_REPORT_FIELDS, require_project=True)


def validate_action_backtest_payload(payload):
    return validate_report_backtest_payload(payload, PUBLIC_ACTION_BACKTEST_FIELDS, require_project=True)


def validate_report_backtest_payload(payload, allowed_fields, require_project):
    if not isinstance(payload, dict):
        return report_backtest_payload_rejected_error()
    if set(payload.keys()) - allowed_fields:
        return report_backtest_payload_rejected_error()
    if contains_dangerous_report_backtest_value(payload):
        return report_backtest_payload_rejected_error()
    if require_project and positive_integer(payload.get("projectId")) is None:
        return invalid_project_id_error()

    report_date = payload.get("reportDate")
    if report_date is not None:
        if not isinstance(report_date, str) or not report_date.strip():
            return report_backtest_payload_rejected_error()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", report_date.strip()):
            return report_backtest_payload_rejected_error()
        try:
            date.fromisoformat(report_date.strip())
        except ValueError:
            return report_backtest_payload_rejected_error()

    evidence_ids = payload.get("evidenceIds")
    if evidence_ids is not None:
        if not isinstance(evidence_ids, list) or not evidence_ids:
            return report_backtest_payload_rejected_error()
        for evidence_id in evidence_ids:
            if not isinstance(evidence_id, str) or not evidence_id.strip():
                return report_backtest_payload_rejected_error()
            if contains_dangerous_report_backtest_value(evidence_id):
                return report_backtest_payload_rejected_error()
            if not EVIDENCE_ID_PATTERN.match(evidence_id.strip()):
                return report_backtest_payload_rejected_error()
    return None


def build_daily_report_service_payload(payload):
    service_payload = {"projectId": positive_integer(payload.get("projectId"))}
    report_date = payload.get("reportDate")
    if isinstance(report_date, str) and report_date.strip():
        service_payload["reportDate"] = report_date.strip()
    evidence_ids = payload.get("evidenceIds")
    if isinstance(evidence_ids, list):
        service_payload["evidenceIds"] = [item.strip() for item in evidence_ids if isinstance(item, str) and item.strip()]
    return service_payload


def build_action_backtest_service_payload(payload):
    service_payload = {"projectId": positive_integer(payload.get("projectId"))}
    evidence_ids = payload.get("evidenceIds")
    if isinstance(evidence_ids, list):
        service_payload["evidenceIds"] = [item.strip() for item in evidence_ids if isinstance(item, str) and item.strip()]
    return service_payload


def daily_report_public_response(result, request_payload=None):
    result = sanitize_for_public(result if isinstance(result, dict) else {})
    if not isinstance(result, dict) or result.get("ok") is False:
        return public_error_response(result)

    request_payload = request_payload or {}
    report = result.get("report") if isinstance(result.get("report"), dict) else result
    response_report = {
        "summary": safe_text(report.get("summary") or result.get("summary") or "Daily report generated."),
        "coverage": safe_coverage(report.get("coverage") or report.get("dataCoverage") or result.get("coverage")),
    }
    report_date = safe_text(report.get("reportDate") or request_payload.get("report_date") or request_payload.get("reportDate"))
    if report_date:
        response_report["reportDate"] = report_date
    evidence_ids = first_evidence_ids(result, report, request_payload)
    response = {
        "ok": True,
        "agentLoopRunId": safe_public_id(result.get("agentLoopRunId"), request_payload.get("agent_loop_run_id")),
        "step": "daily_report",
        "status": safe_status(result.get("status") or "succeeded"),
        "report": response_report,
        "evidenceIds": evidence_ids,
        "judgeReviewStatus": safe_text(result.get("judgeReviewStatus") or report.get("judgeReviewStatus") or "pending") or "pending",
    }
    judge_review = judge_review_public_payload(result.get("judgeReview") or report.get("judgeReview"))
    if judge_review:
        response["judgeReview"] = judge_review
    return response


def action_backtest_public_response(result, request_payload=None):
    result = sanitize_for_public(result if isinstance(result, dict) else {})
    if not isinstance(result, dict) or result.get("ok") is False:
        return public_error_response(result)

    request_payload = request_payload or {}
    backtest = result.get("backtest") if isinstance(result.get("backtest"), dict) else result
    raw_backtest_result = backtest.get("result") or result.get("result")
    backtest_result = safe_backtest_result(raw_backtest_result)
    response_backtest = {
        "actionId": positive_integer(backtest.get("actionId")) or request_payload.get("action_id"),
        "result": backtest_result,
        "summary": safe_text(backtest.get("summary") or result.get("summary") or "Action backtest generated."),
        "confounders": safe_string_list(backtest.get("confounders") or result.get("confounders")),
        "nextRecommendation": safe_text(
            backtest.get("nextRecommendation")
            or backtest.get("next_recommendation")
            or result.get("nextRecommendation")
            or result.get("next_recommendation")
        ),
    }
    missing_reason = safe_text(
        backtest.get("missingDataReason")
        or backtest.get("missing_data_reason")
        or result.get("missingDataReason")
        or result.get("missing_data_reason")
    )
    if missing_reason:
        response_backtest["missingDataReason"] = missing_reason

    evidence_ids = first_evidence_ids(result, backtest, request_payload)
    status = safe_backtest_status(result.get("status"), raw_backtest_result, backtest_result)
    response = {
        "ok": True,
        "agentLoopRunId": safe_public_id(result.get("agentLoopRunId"), request_payload.get("agent_loop_run_id")),
        "step": "action_backtest",
        "status": status,
        "backtest": response_backtest,
        "evidenceIds": evidence_ids,
        "judgeReviewStatus": safe_text(result.get("judgeReviewStatus") or backtest.get("judgeReviewStatus") or "pending") or "pending",
    }
    judge_review = judge_review_public_payload(result.get("judgeReview") or backtest.get("judgeReview"))
    if judge_review:
        response["judgeReview"] = judge_review
    return response


def public_error_response(error):
    if not isinstance(error, dict):
        return report_backtest_runtime_failed_error("report/backtest")
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": safe_text(error.get("error_type") or "report_backtest_runtime_failed"),
        "message": safe_text(error.get("message") or "Report/backtest Agent step failed."),
        "cause": safe_text(error.get("cause") or "The Harness could not complete the requested step."),
        "fix": safe_text(error.get("fix") or "Retry after checking the scoped Agent Loop run and action."),
    }


def validate_request_evidence_scope(project_id, evidence_ids, evidence_repository):
    if not evidence_ids:
        return None
    if not hasattr(evidence_repository, "existing_evidence_ids"):
        return report_backtest_evidence_rejected_error()
    existing = set(evidence_repository.existing_evidence_ids(project_id, evidence_ids) or [])
    if existing == set(evidence_ids):
        return None
    return report_backtest_evidence_rejected_error()


def parse_evidence_id(value):
    match = EVIDENCE_ID_PATTERN.match(str(value or "").strip())
    if not match:
        return None
    return {"raw": match.group(0), "kind": match.group(1), "id": int(match.group(0).split(":", 1)[1])}


def first_evidence_ids(result, detail, request_payload):
    candidates = [
        result.get("evidenceIds"),
        result.get("evidence_ids"),
        detail.get("evidenceIds") if isinstance(detail, dict) else None,
        detail.get("evidence_ids") if isinstance(detail, dict) else None,
        request_payload.get("evidence_ids") if isinstance(request_payload, dict) else None,
        request_payload.get("evidenceIds") if isinstance(request_payload, dict) else None,
    ]
    for candidate in candidates:
        evidence_ids = safe_evidence_ids(candidate)
        if evidence_ids:
            return evidence_ids
    return []


def safe_evidence_ids(values):
    if not isinstance(values, list):
        return []
    evidence_ids = []
    for value in values:
        text = str(value or "").strip()
        if not text or contains_dangerous_report_backtest_value(text):
            continue
        if not EVIDENCE_ID_PATTERN.match(text):
            continue
        if text not in evidence_ids:
            evidence_ids.append(text)
    return evidence_ids


def evidence_coverage(evidence_ids):
    coverage = {"comments": 0, "events": 0, "actions": 0, "backtests": 0}
    for evidence_id in evidence_ids:
        if evidence_id.startswith("comment:"):
            coverage["comments"] += 1
        elif evidence_id.startswith("event:"):
            coverage["events"] += 1
        elif evidence_id.startswith("action:"):
            coverage["actions"] += 1
        elif evidence_id.startswith("backtest:"):
            coverage["backtests"] += 1
    return coverage


def records_from_evidence_ids(evidence_ids):
    records = {"targets": [], "comments": [], "events": [], "actions": [], "backtests": [], "memory": []}
    for evidence_id in evidence_ids:
        parsed = parse_evidence_id(evidence_id)
        if parsed is None:
            continue
        kind = parsed["kind"]
        if kind == "target":
            records["targets"].append({"id": evidence_id})
        elif kind == "comment":
            records["comments"].append({"id": evidence_id, "content": "Scoped Harness evidence comment."})
        elif kind == "event":
            records["events"].append({"id": evidence_id, "title": "Scoped Harness evidence event."})
        elif kind == "action":
            records["actions"].append({"id": evidence_id, "confirmation_status": "observed"})
        elif kind == "backtest":
            records["backtests"].append({"id": evidence_id, "result": "unknown"})
        elif kind == "memory":
            records["memory"].append({"id": evidence_id, "source_kind": "memory", "summary": "Scoped Harness memory."})
    return records


def backtest_scenario_from_request(request, evidence_ids):
    action_id = request.get("action_id")
    has_window_evidence = any(not item.startswith("action:") for item in evidence_ids)
    scenario = {
        "id": f"harness-action-{action_id}",
        "action": {
            "id": action_id,
            "confirmation_status": "confirmed" if has_window_evidence else "pending",
            "effective_at": "1970-01-01T00:00:00Z" if has_window_evidence else None,
            "related_event_id": next((item for item in evidence_ids if item.startswith("event:")), None),
            "related_target_id": next((item for item in evidence_ids if item.startswith("target:")), None),
        },
        "baseline": None,
        "post": {},
    }
    if has_window_evidence:
        scenario["baseline"] = {"negative_rate": 0.4, "avg_sentiment": -0.1, "mentions": 10}
        scenario["post"] = {"24h": {"negative_rate": 0.4, "avg_sentiment": -0.1, "mentions": 10}}
    return scenario


def contains_dangerous_report_backtest_value(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if dangerous_public_key(key) or contains_dangerous_report_backtest_value(item):
                return True
        return False
    if isinstance(value, list):
        return any(contains_dangerous_report_backtest_value(item) for item in value)
    if isinstance(value, str):
        lowered = value.lower()
        compact = re.sub(r"[^a-z0-9]", "", lowered)
        if any(marker in lowered for marker in DANGEROUS_VALUE_MARKERS):
            return True
        if PUBLIC_PATH_PATTERN.search(value) or RAW_ARTIFACT_FILENAME_PATTERN.search(value):
            return True
        if "raw" in compact and ("stdout" in compact or "stderr" in compact):
            return True
        return "collector" in compact and "transcript" in compact
    return False


def dangerous_public_key(key):
    normalized = normalize_public_key(key)
    compact = re.sub(r"[^a-z0-9]", "", normalized)
    return normalized in DANGEROUS_PUBLIC_KEYS or compact in DANGEROUS_PUBLIC_KEYS


def normalize_public_key(key):
    text = str(key).replace("-", "_").replace(" ", "_")
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    return re.sub(r"_+", "_", text).lower()


def safe_text(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or contains_dangerous_report_backtest_value(text):
        return None
    return text


def safe_dict(value):
    if not isinstance(value, dict):
        return {}
    safe = {}
    for key, item in value.items():
        text_key = safe_text(key)
        if not text_key:
            continue
        if isinstance(item, bool):
            safe[text_key] = item
        elif isinstance(item, (int, float)) and not isinstance(item, bool):
            safe[text_key] = item
        elif isinstance(item, str):
            text = safe_text(item)
            if text:
                safe[text_key] = text
    return safe


def safe_coverage(value):
    if not isinstance(value, dict):
        return {}
    safe = {}
    for key in COVERAGE_FIELDS:
        item = value.get(key)
        if isinstance(item, bool):
            continue
        if isinstance(item, int):
            safe[key] = item
        elif isinstance(item, float) and item.is_integer():
            safe[key] = int(item)
    return safe


def safe_backtest_result(value):
    text = safe_text(value)
    if text in BACKTEST_RESULT_VALUES:
        return text
    return "unknown"


def safe_string_list(values):
    if not isinstance(values, list):
        return []
    safe = []
    for value in values:
        text = safe_text(value)
        if text:
            safe.append(text)
    return safe


def safe_status(value):
    text = safe_text(value)
    if text in {"succeeded", "partial", "failed", "needs_human", "running"}:
        return text
    return "succeeded"


def safe_backtest_status(status_value, raw_result, safe_result):
    status = safe_status(status_value or ("partial" if safe_result == "unknown" else "succeeded"))
    if safe_result == "unknown":
        return status if status in {"failed", "needs_human"} else "partial"
    return status


def safe_public_id(*values):
    for value in values:
        parsed = positive_integer(value)
        if parsed is not None:
            return parsed
    return None


def positive_integer(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.isdigit() and not value.startswith("0"):
        return int(value)
    return None


def report_backtest_payload_rejected_error():
    return report_backtest_error(
        "report_backtest_payload_rejected",
        "Report/backtest payload contains unsupported public fields or unsafe values.",
        "The request did not match the allowlisted Report/Backtest Agent contract.",
        "Only pass projectId, reportDate for daily reports, and evidenceIds with scoped Harness evidence IDs.",
    )


def report_backtest_evidence_rejected_error():
    return report_backtest_error(
        "report_backtest_evidence_rejected",
        "Report/backtest request references missing or cross-project evidence.",
        "One or more requested evidence IDs do not exist in the requested project.",
        "Retry with evidence IDs that exist in the same project.",
    )


def invalid_project_id_error():
    return report_backtest_error(
        "invalid_project_id",
        "Report/backtest request requires a valid projectId.",
        "The public payload projectId must be a positive integer.",
        "Pass a positive integer projectId from the existing Agent Loop run.",
    )


def invalid_action_id_error():
    return report_backtest_error(
        "invalid_action_id",
        "Action backtest requires a valid action id.",
        "The path action_id must be a positive integer.",
        "Retry with an action ID returned by the same project action ledger.",
    )


def action_not_found_error(action_id, project_id):
    return report_backtest_error(
        "action_not_found",
        "Action was not found for this project.",
        f"Action {action_id} does not belong to project {project_id}.",
        "Retry with an action ID from the same project.",
    )


def report_backtest_runtime_failed_error(label):
    return report_backtest_error(
        "report_backtest_runtime_failed",
        f"{label} runtime failed.",
        "The deterministic Report/Backtest Agent adapter did not return a safe successful payload.",
        "Retry after checking the local fixture adapter and scoped input.",
    )


def report_backtest_error(error_type, message, cause, fix):
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": error_type,
        "message": message,
        "cause": cause,
        "fix": fix,
    }
