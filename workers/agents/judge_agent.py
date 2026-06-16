def rule_judge_step_output(output, retry_count=0):
    retry_count = int(retry_count or 0)
    evidence_ids = judge_output_evidence_ids(output)
    evidence_errors = []
    required_changes = []
    if not evidence_ids:
        evidence_errors.append({
            "error_type": "missing_evidence_ids",
            "message": "Step output must include at least one evidence ID.",
        })
        required_changes.append("Add at least one real project evidence ID to output.evidence_ids.")
    passed = not evidence_errors
    status = "passed" if passed else "failed"
    if status == "failed" and retry_count >= 2:
        status = "needs_human"
    return {
        "status": status,
        "passed": passed,
        "retry_count": retry_count,
        "required_changes": required_changes,
        "evidence_errors": evidence_errors,
        "feedback_json": {
            "judge": "rule_judge",
            "checked": ["evidence_ids"],
            "evidence_ids": evidence_ids,
        },
    }


def judge_output_evidence_ids(output):
    if not isinstance(output, dict):
        return []
    evidence_ids = output.get("evidence_ids")
    if evidence_ids is None:
        evidence_ids = output.get("evidenceIds")
    if evidence_ids is None:
        return []
    if not isinstance(evidence_ids, list):
        evidence_ids = [evidence_ids]
    return unique_evidence_ids(str(item).strip() for item in evidence_ids if str(item).strip())


def unique_evidence_ids(values):
    seen = set()
    unique = []
    for value in values:
        if value is None:
            continue
        text = str(value)
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(value)
    return unique
