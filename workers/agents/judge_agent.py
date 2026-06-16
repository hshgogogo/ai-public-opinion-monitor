import re


JUDGE_EVIDENCE_PREFIXES = {"target", "post", "comment", "analysis", "event", "action", "memory"}
JUDGE_EVIDENCE_ID_PATTERN = re.compile(r"^([a-z][a-z0-9_-]*)-([1-9]\d*)$")
KNOWLEDGE_CARD_ID_PATTERN = re.compile(r"^knowledge-card-([1-9]\d*)$")


def rule_judge_step_output(output, retry_count=0):
    retry_count = int(retry_count or 0)
    evidence_ids = judge_output_evidence_ids(output)
    knowledge_references = judge_output_knowledge_references(output)
    evidence_errors = []
    required_changes = []
    if not evidence_ids:
        evidence_errors.append({
            "error_type": "missing_evidence_ids",
            "message": "Step output must include at least one evidence ID.",
        })
        required_changes.append("Add at least one real project evidence ID to output.evidence_ids.")
    valid_evidence_ids, evidence_id_errors = validate_judge_evidence_ids(evidence_ids)
    evidence_errors.extend(evidence_id_errors)
    valid_knowledge_references, knowledge_reference_errors = validate_knowledge_references(knowledge_references)
    evidence_errors.extend(knowledge_reference_errors)
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
            "checked": ["evidence_ids", "knowledge_references"],
            "evidence_ids": valid_evidence_ids,
            "knowledge_references": valid_knowledge_references,
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
    return unique_evidence_ids(str(item).strip() for item in evidence_ids if item is not None)


def judge_output_knowledge_references(output):
    if not isinstance(output, dict):
        return []
    references = output.get("knowledge_references")
    if references is None:
        references = output.get("knowledgeReferences")
    if references is None:
        return []
    if not isinstance(references, list):
        references = [references]
    values = []
    for item in references:
        if isinstance(item, dict):
            item = item.get("id")
        if item is not None:
            values.append(str(item).strip())
    return unique_evidence_ids(values)


def validate_judge_evidence_ids(evidence_ids, existing_evidence_ids=None):
    valid = []
    errors = []
    existing = set(existing_evidence_ids) if existing_evidence_ids is not None else None
    for evidence_id in evidence_ids:
        parsed = parse_judge_evidence_id(evidence_id)
        if parsed.get("error"):
            errors.append(parsed["error"])
            continue
        valid.append(parsed["raw"])
        if existing is not None and parsed["raw"] not in existing:
            errors.append(evidence_error(
                "evidence_not_found",
                parsed["raw"],
                "Evidence ID does not exist in the requested project.",
            ))
    return valid, errors


def validate_knowledge_references(knowledge_references, existing_knowledge_references=None):
    valid = []
    errors = []
    existing = set(existing_knowledge_references) if existing_knowledge_references is not None else None
    for reference in knowledge_references:
        match = KNOWLEDGE_CARD_ID_PATTERN.match(str(reference))
        if not match:
            errors.append(evidence_error(
                "invalid_knowledge_reference_format",
                reference,
                "Knowledge references must use knowledge-card-<id>.",
            ))
            continue
        value = f"knowledge-card-{int(match.group(1))}"
        valid.append(value)
        if existing is not None and value not in existing:
            errors.append(evidence_error(
                "knowledge_reference_not_found",
                value,
                "Knowledge card reference does not exist or is not active.",
            ))
    return valid, errors


def parse_judge_evidence_id(value):
    raw = str(value).strip()
    if raw.startswith("knowledge-card-"):
        return {
            "raw": raw,
            "error": evidence_error(
                "knowledge_card_in_evidence_ids",
                raw,
                "knowledge-card-* references must be placed in knowledge_references, not evidence_ids.",
            ),
        }
    match = JUDGE_EVIDENCE_ID_PATTERN.match(raw)
    if not match:
        return {
            "raw": raw,
            "error": evidence_error(
                "invalid_evidence_id_format",
                raw,
                "Evidence IDs must use <prefix>-<numeric-id> hyphen format.",
            ),
        }
    prefix = match.group(1)
    if prefix not in JUDGE_EVIDENCE_PREFIXES:
        return {
            "raw": raw,
            "error": evidence_error(
                "unsupported_evidence_prefix",
                raw,
                f"Evidence prefix '{prefix}' is not supported.",
            ),
        }
    return {"raw": f"{prefix}-{int(match.group(2))}", "prefix": prefix, "id": int(match.group(2))}


def evidence_error(error_type, evidence_id, message):
    return {
        "error_type": error_type,
        "evidence_id": str(evidence_id),
        "message": message,
    }


def unique_evidence_ids(values):
    seen = set()
    unique = []
    for value in values:
        if value is None:
            continue
        text = str(value)
        if text in seen:
            continue
        seen.add(text)
        unique.append(value)
    return unique
