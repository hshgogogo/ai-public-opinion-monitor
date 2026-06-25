import json
import re

from app.crewai_proposal import validate_crewai_proposal
from app.crewai_runtime import CrewAIRuntimeAdapter
from app.legacy_worker import sanitize_for_public


class InMemoryProposalAuditRepository:
    def __init__(self):
        self.records = []
        self.fact_write_count = 0
        self._next_id = 1

    def create(self, status, payload):
        audit_id = f"audit-{self._next_id}"
        self._next_id += 1
        record = {
            "id": audit_id,
            "status": status,
            "payload": payload,
        }
        self.records.append(record)
        return record


class InMemoryAgentRunRepository:
    def __init__(self, runs=None):
        self.runs = set(runs or [])

    def has_run(self, run_id, project_id):
        return (project_id, run_id) in self.runs


class MySQLAgentRunRepository:
    def has_run(self, run_id, project_id):
        try:
            from workers import db

            with db.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT id FROM agent_loop_runs WHERE id=%s AND project_id=%s LIMIT 1",
                        (run_id, project_id),
                    )
                    return cur.fetchone() is not None
        except Exception:
            return False


class MySQLEvidenceRepository:
    def existing_evidence_ids(self, project_id, evidence_ids):
        parsed = [parse_evidence_reference(item) for item in evidence_ids]
        existing = set()
        try:
            from workers import db
            with db.connect() as conn:
                with conn.cursor() as cur:
                    for ref in parsed:
                        if ref["kind"] == "unsupported":
                            continue
                        if ref["kind"] == "sentiment":
                            cur.execute(
                                """
                                SELECT sr.id
                                FROM sentiment_results sr
                                JOIN social_comments c ON c.id = sr.comment_id
                                WHERE c.project_id=%s AND sr.id=%s
                                LIMIT 1
                                """,
                                (project_id, ref["id"]),
                            )
                        else:
                            table = _EVIDENCE_TABLES[ref["kind"]]
                            cur.execute(
                                f"SELECT id FROM {table} WHERE project_id=%s AND id=%s LIMIT 1",
                                (project_id, ref["id"]),
                            )
                        if cur.fetchone():
                            existing.add(ref["raw"])
        except Exception:
            return existing
        return existing


class MySQLProposalAuditRepository:
    def __init__(self):
        self.fact_write_count = 0

    def create(self, status, payload):
        project_id = payload["project_id"]
        loop_run_id = payload["run_id"]
        error_type = payload.get("error_type")
        proposal = payload.get("proposal")
        response_payload = payload.get("response_payload")
        evidence_ids = []
        if isinstance(proposal, dict):
            evidence_ids = _collect_evidence_ids(proposal)

        step_status = _step_status_for(status)
        step_name = "crewai_proposal_audit"
        agent_name = payload.get("agent_name") or "CrewAI Proposal Harness"

        from workers import db

        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_step_runs(
                        loop_run_id, project_id, agent_name, step_name, status,
                        input_json, output_json, evidence_ids, error_type, error_message,
                        started_at, finished_at
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                    """,
                    (
                        loop_run_id,
                        project_id,
                        agent_name,
                        step_name,
                        step_status,
                        _json_for_db(payload.get("request_payload")),
                        _json_for_db(response_payload),
                        _json_for_db(evidence_ids, []),
                        error_type,
                        payload.get("error_message"),
                    ),
                )
                row_id = cur.lastrowid
        return {
            "id": row_id,
            "status": status,
        }


class CrewAIProposalService:
    def __init__(self, runtime_adapter=None, audit_repository=None, run_repository=None, evidence_repository=None):
        self.runtime_adapter = runtime_adapter or CrewAIRuntimeAdapter()
        self.audit_repository = audit_repository or MySQLProposalAuditRepository()
        self.run_repository = run_repository or MySQLAgentRunRepository()
        self.evidence_repository = evidence_repository or MySQLEvidenceRepository()

    def is_mysql_available(self):
        try:
            from workers import db

            return bool(db.health().get("connected"))
        except Exception:
            return False

    def has_agent_run(self, run_id, project_id):
        return self.run_repository.has_run(run_id, project_id)

    def create_proposal(self, run_id, payload):
        runtime_request = {
            "project_id": payload["projectId"],
            "agent_loop_run_id": run_id,
            "stage": payload["stage"],
        }
        if payload.get("evidenceIds"):
            runtime_request["evidence_ids"] = payload["evidenceIds"]
        if payload.get("knowledgeQuery"):
            runtime_request["knowledge_query"] = payload["knowledgeQuery"]

        request_evidence_rejection = _validate_request_evidence_scope(payload, self.evidence_repository)
        if request_evidence_rejection:
            audit = self.audit_repository.create("rejected", {
                "run_id": run_id,
                "project_id": payload["projectId"],
                "agent_name": "CrewAI Proposal Harness",
                "proposal": None,
                "error_type": "crewai_evidence_rejected",
                "error_message": request_evidence_rejection["cause"],
                "request_payload": sanitize_for_public(runtime_request),
                "response_payload": request_evidence_rejection,
            })
            return {
                **request_evidence_rejection,
                "proposalAuditId": audit["id"],
            }

        runtime_result = self.runtime_adapter.run_proposal(runtime_request)
        public_result = sanitize_for_public(runtime_result)

        if public_result.get("ok") is True:
            public_result = sanitize_for_public(validate_crewai_proposal(public_result.get("proposal")))

        evidence_rejection = _validate_public_proposal_scope(public_result, payload["projectId"], run_id, self.evidence_repository)
        if evidence_rejection:
            audit = self.audit_repository.create("rejected", {
                "run_id": run_id,
                "project_id": payload["projectId"],
                "agent_name": _proposal_agent_name(public_result),
                "proposal": public_result.get("proposal"),
                "error_type": "crewai_evidence_rejected",
                "error_message": evidence_rejection["cause"],
                "request_payload": sanitize_for_public(runtime_request),
                "response_payload": evidence_rejection,
            })
            return {
                **evidence_rejection,
                "proposalAuditId": audit["id"],
            }

        status = _audit_status_for(public_result)
        audit = self.audit_repository.create(status, {
            "run_id": run_id,
            "project_id": payload["projectId"],
            "agent_name": _proposal_agent_name(public_result),
            "proposal": public_result.get("proposal"),
            "error_type": public_result.get("error_type"),
            "error_message": public_result.get("message"),
            "request_payload": sanitize_for_public(runtime_request),
            "response_payload": public_result,
        })
        return {
            **public_result,
            "proposalAuditId": audit["id"],
        }


def agent_run_not_found_error(run_id, project_id):
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": "agent_loop_not_found",
        "message": "Agent Loop run was not found.",
        "cause": f"Run {run_id} was not found in project {project_id}.",
        "fix": "Retry with an existing Agent Loop run id from the same project.",
    }


def _proposal_agent_name(result):
    proposal = result.get("proposal")
    if isinstance(proposal, dict):
        agent_name = proposal.get("agent_name")
        if isinstance(agent_name, str) and agent_name.strip():
            return agent_name.strip()
    return "CrewAI Proposal Harness"


def _audit_status_for(result):
    if result.get("ok") is True:
        return "accepted"
    if result.get("error_type") == "crewai_runtime_failed":
        return "runtime_error"
    return "rejected"


def _step_status_for(status):
    if status == "accepted":
        return "succeeded"
    if status == "runtime_error":
        return "failed"
    return "partial"


def _collect_evidence_ids(proposal):
    evidence_ids = []
    for section in ("facts", "inferences", "recommendations"):
        for item in proposal.get(section, []) or []:
            for evidence_id in item.get("evidence_ids", []) or []:
                if isinstance(evidence_id, str) and evidence_id not in evidence_ids:
                    evidence_ids.append(evidence_id)
    return evidence_ids


def _validate_public_proposal_scope(result, expected_project_id, expected_run_id, evidence_repository):
    proposal = result.get("proposal")
    if not isinstance(proposal, dict):
        return None

    if proposal.get("project_id") != expected_project_id or proposal.get("agent_loop_run_id") != expected_run_id:
        return {
            "ok": False,
            "mode": "weibo-agent-mvp",
            "error_type": "crewai_evidence_rejected",
            "message": "CrewAI proposal scope does not match the requested run.",
            "cause": "Proposal project_id or agent_loop_run_id does not match the requested Harness scope.",
            "fix": "Retry with a proposal that matches the requested Agent Loop run and project.",
        }

    evidence_ids = _collect_evidence_ids(proposal)
    if evidence_ids:
        existing = load_existing_evidence_ids(evidence_repository, expected_project_id, evidence_ids)
        if set(existing) != set(evidence_ids):
            return {
                "ok": False,
                "mode": "weibo-agent-mvp",
                "error_type": "crewai_evidence_rejected",
                "message": "CrewAI proposal references missing or cross-project evidence.",
                "cause": "One or more evidence IDs do not exist in the requested project.",
                "fix": "Retry with evidence IDs that exist in the same project.",
            }
    return None


def _validate_request_evidence_scope(payload, evidence_repository):
    evidence_ids = payload.get("evidenceIds") or []
    if not evidence_ids:
        return None
    existing = load_existing_evidence_ids(evidence_repository, payload["projectId"], evidence_ids)
    if set(existing) == set(evidence_ids):
        return None
    return {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": "crewai_evidence_rejected",
        "message": "CrewAI proposal request references missing or cross-project evidence.",
        "cause": "One or more requested evidence IDs do not exist in the requested project.",
        "fix": "Retry with request evidence IDs that exist in the same project.",
    }


def parse_evidence_reference(value):
    raw = str(value).strip()
    match = re.match(r"^(comment|event|action|memory|post|target|sentiment):([1-9]\d*)$", raw)
    if match:
        return {"raw": raw, "kind": match.group(1), "id": int(match.group(2))}
    return {"raw": raw, "kind": "unsupported", "id": None}


def load_existing_evidence_ids(evidence_repository, project_id, evidence_ids):
    if hasattr(evidence_repository, "existing_evidence_ids"):
        return evidence_repository.existing_evidence_ids(project_id, evidence_ids)
    if hasattr(evidence_repository, "find_existing"):
        grouped = {}
        for ref in [parse_evidence_reference(item) for item in evidence_ids]:
            grouped.setdefault(ref["kind"], []).append(ref)
        existing = set()
        for kind, refs in grouped.items():
            if kind == "unsupported":
                continue
            found_ids = evidence_repository.find_existing(project_id, kind, {ref["id"] for ref in refs})
            for ref in refs:
                if ref["id"] in found_ids:
                    existing.add(ref["raw"])
        return existing
    return set()


_EVIDENCE_TABLES = {
    "comment": "social_comments",
    "post": "social_posts",
    "target": "discovered_targets",
    "event": "artist_public_opinion_events",
    "action": "publicity_actions",
    "memory": "bot_memory_items",
}


def _json_for_db(value, fallback=None):
    if value is None:
        return json.dumps(fallback if fallback is not None else {}, ensure_ascii=False)
    return json.dumps(value, ensure_ascii=False)
