import re


JUDGE_EVIDENCE_PREFIXES = {"target", "post", "comment", "analysis", "event", "action", "memory"}
JUDGE_EVIDENCE_ID_PATTERN = re.compile(r"^([a-z][a-z0-9_-]*)-([1-9]\d*)$")
KNOWLEDGE_CARD_ID_PATTERN = re.compile(r"^knowledge-card-([1-9]\d*)$")
PLATFORM_EVIDENCE_ID_PATTERN = re.compile(
    r"^([a-z][a-z0-9_-]*):project:([1-9]\d*):(item|comment):([A-Za-z0-9][A-Za-z0-9_-]{0,127})$"
)
PLATFORM_TEXT_EVIDENCE_ID_PATTERN = re.compile(
    r"^([a-z][a-z0-9_-]*):project:([1-9]\d*):text:([A-Za-z0-9][A-Za-z0-9_-]{0,127}):(?:(transcript):([A-Za-z0-9][A-Za-z0-9_-]{0,63})|(body))$"
)
PLATFORM_EVIDENCE_LABELS = {
    ("bilibili", "item"): ("B站", "B站视频"),
    ("bilibili", "comment"): ("B站", "B站评论"),
    ("xiaohongshu", "item"): ("小红书", "小红书笔记"),
    ("xiaohongshu", "comment"): ("小红书", "小红书评论"),
}
PLATFORM_TEXT_EVIDENCE_LABELS = {
    ("bilibili", "transcript"): ("B站", "B站字幕"),
    ("bilibili", "body"): ("B站", "B站正文"),
}


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
    boundary_errors, boundary_required_changes, boundary_feedback = validate_rule_judge_boundaries(output)
    evidence_errors.extend(boundary_errors)
    required_changes.extend(boundary_required_changes)
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
            "checked": ["evidence_ids", "knowledge_references", "deterministic_boundaries"],
            "evidence_ids": valid_evidence_ids,
            "knowledge_references": valid_knowledge_references,
            **boundary_feedback,
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


def validate_judge_evidence_ids(evidence_ids, existing_evidence_ids=None, project_id=None):
    valid = []
    errors = []
    existing = set(existing_evidence_ids) if existing_evidence_ids is not None else None
    scoped_project_id = positive_int(project_id)
    for evidence_id in evidence_ids:
        parsed = parse_judge_evidence_id(evidence_id)
        if parsed.get("error"):
            errors.append(parsed["error"])
            continue
        if (
            scoped_project_id is not None
            and parsed.get("kind") == "platform"
            and parsed.get("project_id") != scoped_project_id
        ):
            errors.append(evidence_error(
                "evidence_project_mismatch",
                parsed["raw"],
                "Platform evidence ID belongs to a different project.",
            ))
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


def validate_rule_judge_boundaries(output):
    if not isinstance(output, dict):
        return [], [], {"boundary_checks": []}

    errors = []
    required_changes = []
    boundary_checks = []

    for error in detect_vague_action_errors(output):
        errors.append(error)
        required_changes.append(
            "vague_action_without_operational_fields: Add owner, priority, check_after, and a concrete evidence-linked action."
        )
    if any(error["error_type"] == "vague_action_without_operational_fields" for error in errors):
        boundary_checks.append("vague_action_without_operational_fields")

    for error in detect_knowledge_card_fact_errors(output):
        errors.append(error)
        required_changes.append(
            "knowledge_card_as_current_fact: Move knowledge-card content to strategy rationale or knowledge_references; current Weibo facts must cite real project evidence."
        )
    if any(error["error_type"] == "knowledge_card_as_current_fact" for error in errors):
        boundary_checks.append("knowledge_card_as_current_fact")

    c_level_errors, weak_references = detect_c_level_hard_rule_errors(output)
    errors.extend(c_level_errors)
    if c_level_errors:
        boundary_checks.append("c_level_knowledge_card_hard_rule")
        required_changes.append(
            "c_level_knowledge_card_hard_rule: Treat C-level knowledge cards only as weak inspiration and keep real Weibo evidence as the basis."
        )

    metric_errors = detect_deterministic_metric_errors(output)
    errors.extend(metric_errors)
    if metric_errors:
        boundary_checks.append("deterministic_metric_overclaim")
        required_changes.append(
            "deterministic_metric_overclaim: Do not present model or Judge metric outputs as authoritative sentiment, event, trend, or backtest values; cite deterministic calculations or existing records."
        )

    causal_errors = detect_single_cause_errors(output)
    errors.extend(causal_errors)
    if causal_errors:
        boundary_checks.append("single_cause_overclaim")
        required_changes.append(
            "single_cause_overclaim: Rewrite action effects as signals with uncertainty and confounders instead of single-cause certainty."
        )

    return errors, unique_evidence_ids(required_changes), {
        "boundary_checks": unique_evidence_ids(boundary_checks),
        "weak_knowledge_references": weak_references,
    }


VAGUE_ACTION_PHRASES = (
    "继续关注",
    "加强沟通",
    "持续关注",
    "保持关注",
    "密切关注",
    "关注舆情",
    "及时沟通",
    "follow up",
    "keep watching",
    "continue monitoring",
    "strengthen communication",
)

ACTION_COLLECTION_KEYS = (
    "actions",
    "action_items",
    "actionItems",
    "recommendations",
    "suggestions",
    "next_steps",
    "nextSteps",
)

ACTION_TEXT_KEYS = ("text", "summary", "content", "reason", "recommendation", "action", "next_step", "nextStep")
ACTION_OWNER_KEYS = ("owner", "owner_suggestion", "ownerSuggestion", "assignee")
ACTION_PRIORITY_KEYS = ("priority",)
ACTION_CHECK_AFTER_KEYS = ("check_after", "checkAfter", "check_after_at", "checkAfterAt", "review_after", "reviewAfter")


def detect_vague_action_errors(output):
    errors = []
    action_items = collect_action_items(output)
    if not action_items:
        text = " ".join(text_fragments(output))
        if contains_vague_action_phrase(text) and not has_concrete_action_shape(output):
            return [boundary_error(
                "vague_action_without_operational_fields",
                "output",
                "Action advice is vague and lacks owner, priority, check-after, or concrete evidence action.",
            )]
        return []
    for index, item in enumerate(action_items):
        text = action_item_text(item)
        if not has_concrete_action_shape(item):
            errors.append(boundary_error(
                "vague_action_without_operational_fields",
                f"output.action[{index}]",
                "Action advice is vague and lacks owner, priority, check-after, or concrete evidence action.",
            ))
    return errors


def collect_action_items(output):
    items = []
    for key in ACTION_COLLECTION_KEYS:
        if key not in output:
            continue
        value = output.get(key)
        if isinstance(value, list):
            items.extend(value)
        elif value is not None:
            items.append(value)
    return items


def action_item_text(item):
    if isinstance(item, dict):
        values = []
        for key in ACTION_TEXT_KEYS:
            if key in item and item[key] is not None:
                values.append(str(item[key]))
        return " ".join(values)
    return str(item or "")


def has_concrete_action_shape(item):
    if not isinstance(item, dict):
        return False
    has_owner = any(non_empty_value(item.get(key)) for key in ACTION_OWNER_KEYS)
    has_priority = any(non_empty_value(item.get(key)) for key in ACTION_PRIORITY_KEYS)
    has_check_after = any(non_empty_value(item.get(key)) for key in ACTION_CHECK_AFTER_KEYS)
    has_action_evidence = bool(judge_output_evidence_ids(item)) or contains_supported_evidence_id(action_item_text(item))
    return has_owner and has_priority and has_check_after and has_action_evidence


def contains_vague_action_phrase(text):
    normalized = str(text or "").lower()
    return any(phrase.lower() in normalized for phrase in VAGUE_ACTION_PHRASES)


def detect_knowledge_card_fact_errors(output):
    errors = []
    facts = output.get("facts")
    if facts is None:
        facts = output.get("current_facts") or output.get("currentFacts")
    if facts is not None:
        if not isinstance(facts, list):
            facts = [facts]
        for index, fact in enumerate(facts):
            fact_text = " ".join(text_fragments(fact))
            fact_refs = collect_knowledge_card_like_values(fact)
            if fact_refs or re.search(r"knowledge-card-\d+|知识卡|knowledge card", fact_text, re.I):
                errors.append(boundary_error(
                    "knowledge_card_as_current_fact",
                    f"output.facts[{index}]",
                    "Knowledge cards cannot be written as current Weibo facts.",
                ))
    for path, text in iter_boundary_text_values(output):
        if is_knowledge_card_current_fact_text(text):
            errors.append(boundary_error(
                "knowledge_card_as_current_fact",
                f"output.{path}",
                "Knowledge cards cannot be written as current Weibo facts.",
            ))
    return errors


def detect_c_level_hard_rule_errors(output):
    errors = []
    weak_references = []
    details = collect_knowledge_reference_details(output)
    if not details:
        return [], []

    public_text_values = [text for _, text in iter_boundary_text_values(output)]
    for index, detail in enumerate(details):
        if not isinstance(detail, dict):
            continue
        reference_id = str(detail.get("id") or detail.get("card_id") or detail.get("cardId") or f"knowledge_reference[{index}]")
        reliability = str(
            detail.get("reliability_level")
            or detail.get("reliabilityLevel")
            or detail.get("source_reliability")
            or detail.get("sourceReliability")
            or ""
        ).strip().upper()
        if reliability != "C":
            continue
        usage = str(detail.get("usage") or detail.get("boundary") or detail.get("role") or "").strip().lower()
        detail_text = " ".join(text_fragments(detail))
        is_weak_reference = is_weak_inspiration_usage(usage) or is_weak_inspiration_usage(detail_text)
        if (
            is_hard_rule_usage(usage)
            or has_c_level_card_hard_rule_claim(detail_text)
            or any(has_c_level_card_hard_rule_claim(text) for text in public_text_values)
        ):
            errors.append(boundary_error(
                "c_level_knowledge_card_hard_rule",
                reference_id,
                "C-level knowledge cards may only be weak inspiration, not hard rules or sole support.",
            ))
            continue
        if is_weak_reference:
            weak_references.append(reference_id)
            continue
        if not usage:
            errors.append(boundary_error(
                "c_level_knowledge_card_hard_rule",
                reference_id,
                "C-level knowledge cards may only be weak inspiration, not hard rules or sole support.",
            ))
    return errors, unique_evidence_ids(weak_references)


def collect_knowledge_reference_details(output):
    details = []
    for key in ("knowledge_reference_details", "knowledgeReferenceDetails", "knowledge_cards", "knowledgeCards"):
        value = output.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            details.extend(value)
        else:
            details.append(value)
    for key in ("knowledge_references", "knowledgeReferences"):
        value = output.get(key)
        if value is None:
            continue
        if not isinstance(value, list):
            value = [value]
        details.extend(item for item in value if isinstance(item, dict))
    return details


DETERMINISTIC_METRIC_KEYS = {
    "sentimentscore",
    "sentimentscorevalue",
    "eventscore",
    "eventscorevalue",
    "commentscore",
    "commentweight",
    "trendwindow",
    "backtestsignal",
    "attributionsignal",
}


def detect_deterministic_metric_errors(output):
    errors = []
    for path, key, value in iter_key_values(output):
        normalized_key = normalize_key(key)
        if normalized_key in DETERMINISTIC_METRIC_KEYS and non_empty_value(value):
            errors.append(boundary_error(
                "deterministic_metric_overclaim",
                f"output.{path}",
                "Judge output must not present model-generated metrics as authoritative deterministic values.",
            ))
    metric_text = " ".join(text_fragments(output))
    if re.search(r"(sentiment|event)\s+score\s*[:=]\s*\d|情感分数\s*[:=]?\s*\d|事件分数\s*[:=]?\s*\d", metric_text, re.I):
        errors.append(boundary_error(
            "deterministic_metric_overclaim",
            "output.text",
            "Judge output must not present model-generated metrics as authoritative deterministic values.",
        ))
    if re.search(r"backtest\s+signal\s*[:=]\s*\w|trend\s+window\s*[:=]\s*\w|回测信号\s*[:=]?|趋势窗口\s*[:=]?", metric_text, re.I):
        errors.append(boundary_error(
            "deterministic_metric_overclaim",
            "output.text",
            "Judge output must not present model-generated metrics as authoritative deterministic values.",
        ))
    return dedupe_errors(errors)


SINGLE_CAUSE_PATTERNS = (
    r"单独导致",
    r"唯一导致",
    r"直接导致",
    r"完全归因",
    r"确定由.+导致",
    r"alone caused",
    r"single[- ]cause",
    r"solely caused",
    r"directly caused",
    r"guaranteed",
)

BOUNDARY_QUALIFIER_PATTERNS = (
    r"signal",
    r"signals",
    r"uncertain",
    r"uncertainty",
    r"confounder",
    r"confounders",
    r"相关",
    r"信号",
    r"不确定",
    r"混杂",
    r"干扰因素",
)

ACTION_EFFECT_CONTEXT_PATTERNS = (
    r"宣发",
    r"行动",
    r"动作",
    r"效果",
    r"舆情",
    r"负面",
    r"评论",
    r"action",
    r"effect",
    r"public[- ]opinion",
    r"sentiment",
    r"comment",
)


def detect_single_cause_errors(output):
    text = " ".join(text_fragments(output))
    if not text:
        return []
    has_overclaim = has_non_negated_pattern(text, SINGLE_CAUSE_PATTERNS)
    has_action_context = any(re.search(pattern, text, re.I) for pattern in ACTION_EFFECT_CONTEXT_PATTERNS)
    if has_overclaim and has_action_context:
        return [boundary_error(
            "single_cause_overclaim",
            "output.text",
            "Action effects must be framed as signals with uncertainty and confounders, not single-cause certainty.",
        )]
    return []


def text_fragments(value):
    fragments = []
    if isinstance(value, dict):
        for item in value.values():
            fragments.extend(text_fragments(item))
    elif isinstance(value, list):
        for item in value:
            fragments.extend(text_fragments(item))
    elif isinstance(value, str):
        fragments.append(value)
    return fragments


def collect_knowledge_card_like_values(value):
    refs = []
    if isinstance(value, dict):
        for key, item in value.items():
            if "knowledge" in str(key).lower():
                refs.extend(collect_scalar_knowledge_refs(item))
            else:
                refs.extend(collect_knowledge_card_like_values(item))
    elif isinstance(value, list):
        for item in value:
            refs.extend(collect_knowledge_card_like_values(item))
    elif isinstance(value, str) and KNOWLEDGE_CARD_ID_PATTERN.search(value):
        refs.append(value)
    return refs


def collect_scalar_knowledge_refs(value):
    refs = []
    if isinstance(value, dict):
        for item in value.values():
            refs.extend(collect_scalar_knowledge_refs(item))
    elif isinstance(value, list):
        for item in value:
            refs.extend(collect_scalar_knowledge_refs(item))
    elif isinstance(value, str):
        refs.extend(KNOWLEDGE_CARD_ID_PATTERN.findall(value))
        if "knowledge-card-" in value:
            refs.append(value)
    return refs


BOUNDARY_TEXT_SKIP_KEYS = {
    "knowledge_references",
    "knowledgereferences",
    "knowledge_reference_details",
    "knowledgereferencedetails",
    "knowledge_cards",
    "knowledgecards",
}


def iter_boundary_text_values(value, path=""):
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            if normalize_key(key_text) in BOUNDARY_TEXT_SKIP_KEYS:
                continue
            child_path = f"{path}.{key_text}" if path else key_text
            yield from iter_boundary_text_values(item, child_path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            child_path = f"{path}[{index}]" if path else f"[{index}]"
            yield from iter_boundary_text_values(item, child_path)
    elif isinstance(value, str):
        yield path or "text", value


def is_knowledge_card_current_fact_text(text):
    value = str(text or "")
    has_knowledge_reference = re.search(r"knowledge-card-\d+|知识卡|knowledge card", value, re.I)
    if not has_knowledge_reference:
        return False
    current_fact_patterns = (
        r"当前微博",
        r"current\s+weibo",
        r"current\s+public[- ]opinion",
        r"证明.+当前",
        r"显示.+当前",
        r"表明.+当前",
        r"当前.+已经",
        r"当前.+接受",
        r"已经.+接受",
    )
    return any(re.search(pattern, value, re.I) for pattern in current_fact_patterns)


def iter_key_values(value, path=""):
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            child_path = f"{path}.{key_text}" if path else key_text
            yield child_path, key_text, item
            yield from iter_key_values(item, child_path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            child_path = f"{path}[{index}]" if path else f"[{index}]"
            yield from iter_key_values(item, child_path)


def normalize_key(key):
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def non_empty_value(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def contains_supported_evidence_id(text):
    for match in re.finditer(r"\b[a-z][a-z0-9_-]*-[1-9]\d*\b", str(text or "")):
        parsed = parse_judge_evidence_id(match.group(0))
        if not parsed.get("error"):
            return True
    for match in re.finditer(r"\b[a-z][a-z0-9_-]*:project:[1-9]\d*:(?:item|comment):[A-Za-z0-9][A-Za-z0-9_-]{0,127}\b", str(text or "")):
        parsed = parse_judge_evidence_id(match.group(0))
        if not parsed.get("error"):
            return True
    for match in re.finditer(r"\b[a-z][a-z0-9_-]*:project:[1-9]\d*:text:[A-Za-z0-9][A-Za-z0-9_-]{0,127}:(?:transcript:[A-Za-z0-9][A-Za-z0-9_-]{0,63}|body)\b", str(text or "")):
        parsed = parse_judge_evidence_id(match.group(0))
        if not parsed.get("error"):
            return True
    return False


def has_non_negated_pattern(text, patterns):
    value = str(text or "")
    for pattern in patterns:
        for match in re.finditer(pattern, value, re.I):
            if not is_negated_causal_match(value, match.start()):
                return True
    return False


def is_negated_causal_match(text, start):
    prefix = text[max(0, start - 16):start].lower()
    return any(marker in prefix for marker in (
        "不是",
        "并非",
        "不能",
        "不可",
        "不应",
        "无法",
        "未能",
        "不能说",
        "not ",
        "not be",
        "cannot",
        "can't",
        "should not",
        "must not",
    ))


def has_required_causal_boundary(text):
    value = str(text or "")
    has_signal = any(re.search(pattern, value, re.I) for pattern in (
        r"signal",
        r"signals",
        r"相关",
        r"信号",
    ))
    has_uncertainty = any(re.search(pattern, value, re.I) for pattern in (
        r"uncertain",
        r"uncertainty",
        r"不确定",
    ))
    has_confounder = any(re.search(pattern, value, re.I) for pattern in (
        r"confounder",
        r"confounders",
        r"混杂",
        r"干扰因素",
    ))
    return has_signal and has_uncertainty and has_confounder


def is_weak_inspiration_usage(text):
    normalized = str(text or "").lower()
    return any(phrase in normalized for phrase in (
        "weak_inspiration",
        "weak inspiration",
        "weak reference",
        "参考启发",
        "弱启发",
        "弱引用",
    ))


def is_hard_rule_usage(text):
    normalized = str(text or "").lower()
    return any(phrase in normalized for phrase in (
        "hard_rule",
        "hard rule",
        "must",
        "always",
        "sole basis",
        "only basis",
        "唯一依据",
        "硬规则",
        "必须",
        "一定",
    ))


def has_c_level_card_hard_rule_claim(text):
    for clause in re.split(r"[.;。；,，\n]+", str(text or "")):
        if is_negated_knowledge_card_basis_clause(clause):
            continue
        if is_hard_rule_usage(clause) and has_knowledge_card_rule_context(clause):
            return True
    return False


def is_negated_knowledge_card_basis_clause(text):
    value = str(text or "").lower()
    has_negation = any(marker in value for marker in (
        "must not",
        "should not",
        "do not",
        "does not",
        "cannot",
        "can't",
        "not treat",
        "不是",
        "并非",
        "不能",
        "不可",
        "不应",
        "不得",
    ))
    if not has_negation:
        return False
    has_basis_term = any(re.search(pattern, value, re.I) for pattern in (
        r"evidence",
        r"basis",
        r"sole support",
        r"hard rule",
        r"依据",
        r"证据",
        r"硬规则",
        r"唯一",
    ))
    return has_basis_term and has_knowledge_card_rule_context(value)


def has_knowledge_card_rule_context(text):
    return any(re.search(pattern, str(text or ""), re.I) for pattern in (
        r"knowledge-card-\d+",
        r"knowledge card",
        r"c-level card",
        r"c\s+level card",
        r"知识卡",
        r"卡片",
        r"卡经验",
        r"知识库经验",
    ))


def boundary_error(error_type, evidence_id, message):
    return evidence_error(error_type, evidence_id, message)


def dedupe_errors(errors):
    seen = set()
    unique = []
    for error in errors:
        key = (error.get("error_type"), error.get("evidence_id"), error.get("message"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(error)
    return unique


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
    platform_match = PLATFORM_EVIDENCE_ID_PATTERN.match(raw)
    if platform_match:
        platform = platform_match.group(1)
        source_type = platform_match.group(3)
        labels = PLATFORM_EVIDENCE_LABELS.get((platform, source_type))
        if not labels:
            return {
                "raw": raw,
                "error": evidence_error(
                    "unsupported_platform_evidence_id",
                    raw,
                    f"Platform evidence IDs for '{platform}' are not supported by Judge yet.",
                ),
            }
        platform_label, label = labels
        return {
            "raw": raw,
            "kind": "platform",
            "prefix": platform,
            "platform": platform,
            "project_id": int(platform_match.group(2)),
            "source_type": source_type,
            "external_id": platform_match.group(4),
            "platform_label": platform_label,
            "label": label,
        }
    platform_text_match = PLATFORM_TEXT_EVIDENCE_ID_PATTERN.match(raw)
    if platform_text_match:
        platform = platform_text_match.group(1)
        text_type = platform_text_match.group(4) or platform_text_match.group(6)
        labels = PLATFORM_TEXT_EVIDENCE_LABELS.get((platform, text_type))
        if not labels:
            return {
                "raw": raw,
                "error": evidence_error(
                    "unsupported_platform_evidence_id",
                    raw,
                    f"Platform text evidence IDs for '{platform}' are not supported by Judge yet.",
                ),
            }
        platform_label, label = labels
        content_item_external_id = platform_text_match.group(3)
        language = platform_text_match.group(5)
        external_parts = [content_item_external_id, text_type]
        if language:
            external_parts.append(language)
        return {
            "raw": raw,
            "kind": "platform",
            "prefix": platform,
            "platform": platform,
            "project_id": int(platform_text_match.group(2)),
            "source_type": "text",
            "text_type": text_type,
            "text_language": language,
            "external_id": ":".join(external_parts),
            "content_item_external_id": content_item_external_id,
            "platform_label": platform_label,
            "label": label,
        }
    match = JUDGE_EVIDENCE_ID_PATTERN.match(raw)
    if not match:
        return {
            "raw": raw,
            "error": evidence_error(
                "invalid_evidence_id_format",
                raw,
                "Evidence IDs must use <prefix>-<numeric-id> or supported platform:project:<id>:item|comment:<external-id> or bilibili:project:<id>:text:<bvid>:transcript:<language>|body format.",
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
    return {"raw": f"{prefix}-{int(match.group(2))}", "kind": "legacy", "prefix": prefix, "id": int(match.group(2))}


def judge_evidence_citation_detail(evidence_id):
    parsed = parse_judge_evidence_id(evidence_id)
    if parsed.get("error") or parsed.get("kind") != "platform":
        return None
    return {
        "id": parsed["raw"],
        "platform": parsed["platform"],
        "platform_label": parsed["platform_label"],
        "source_type": parsed["source_type"],
        "label": parsed["label"],
    }


def judge_evidence_citation_details(evidence_ids):
    details = []
    for evidence_id in unique_evidence_ids(evidence_ids or []):
        detail = judge_evidence_citation_detail(evidence_id)
        if detail:
            details.append(detail)
    return details


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


def positive_int(value):
    try:
        integer = int(value)
    except Exception:
        return None
    return integer if integer > 0 else None
