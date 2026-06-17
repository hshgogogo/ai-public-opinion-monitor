import hashlib
import json
import re
from pathlib import Path

from .agent_reach_adapter import sanitize_agent_reach_public


PLATFORM = "xiaohongshu"

SENSITIVE_ARTIFACT_REF_MARKERS = (
    "browserstorage",
    "browserstate",
    "collectortranscript",
    "cookie",
    "databaseurl",
    "dburl",
    "mysqlurl",
    "rawstderr",
    "rawstdout",
    "secret",
    "stderr",
    "storagestate",
    "token",
)


class XiaohongshuNormalizer:
    def __init__(self, project_id):
        self.project_id = project_id

    def normalize_search_fixture(self, path, raw_artifact_ref):
        fixture = _read_json(path)
        safe_artifact_ref = _safe_artifact_ref(raw_artifact_ref)
        notes = _search_notes(fixture)
        evidence_summaries = [
            self._item_evidence_summary(note, safe_artifact_ref)
            for note in notes
        ]
        content_items = [
            self._content_item(note, safe_artifact_ref, [evidence["id"]])
            for note, evidence in zip(notes, evidence_summaries)
        ]
        return {
            "ok": True,
            "platform": PLATFORM,
            "project_id": self.project_id,
            "raw_artifact_ref": safe_artifact_ref,
            "content_items": content_items,
            "evidence_summaries": evidence_summaries,
        }

    def normalize_detail_fixture(self, path, raw_artifact_ref):
        fixture = _read_json(path)
        safe_artifact_ref = _safe_artifact_ref(raw_artifact_ref)
        note = _detail_note(fixture)
        evidence_summaries = self._detail_evidence_summaries(
            note,
            _detail_comments(fixture, note),
            safe_artifact_ref,
        )
        content_item = self._content_item(
            note,
            safe_artifact_ref,
            [item["id"] for item in evidence_summaries],
        )
        return {
            "ok": True,
            "platform": PLATFORM,
            "project_id": self.project_id,
            "raw_artifact_ref": safe_artifact_ref,
            "content_items": [content_item],
            "evidence_summaries": evidence_summaries,
        }

    def _content_item(self, note, raw_artifact_ref, evidence_ids):
        author = _author(note)
        return {
            "platform": PLATFORM,
            "project_id": self.project_id,
            "external_id": _safe_public(_note_external_id(note)),
            "title": _safe_public(_note_title(note)),
            "text": _safe_public(_note_text(note)),
            "url": _safe_public(_first(note, "url", "note_url", "link", "share_url")),
            "author_external_id": _safe_public(_author_external_id(author)),
            "author_display_name": _safe_public(_author_display_name(author)),
            "author_url": _safe_public(_author_url(author)),
            "published_at": _safe_public(_published_at(note)),
            "metrics": _note_metrics(note),
            "raw_artifact_ref": raw_artifact_ref,
            "evidence_ids": evidence_ids,
        }

    def _detail_evidence_summaries(self, note, comments, raw_artifact_ref):
        note_external_id = _note_external_id(note)
        evidence = [self._item_evidence_summary(note, raw_artifact_ref)]
        seen_ids = {evidence[0]["id"]}

        for comment in comments:
            comment_evidence = self._comment_evidence_summary(
                comment,
                note_external_id,
                raw_artifact_ref,
            )
            if comment_evidence["id"] in seen_ids:
                continue
            seen_ids.add(comment_evidence["id"])
            evidence.append(comment_evidence)

        return evidence

    def _item_evidence_summary(self, note, raw_artifact_ref):
        external_id = _note_external_id(note)
        return {
            "id": self._evidence_id("item", external_id),
            "platform": PLATFORM,
            "project_id": self.project_id,
            "source_type": "note",
            "external_id": _safe_public(external_id),
            "content_item_external_id": _safe_public(external_id),
            "summary": _safe_public(_join_text(_note_title(note), _note_text(note))),
            "raw_artifact_ref": raw_artifact_ref,
        }

    def _comment_evidence_summary(self, comment, note_external_id, raw_artifact_ref):
        author = _author(comment)
        external_id = _comment_external_id(comment, note_external_id)
        return {
            "id": self._evidence_id("comment", external_id),
            "platform": PLATFORM,
            "project_id": self.project_id,
            "source_type": "comment",
            "external_id": _safe_public(external_id),
            "content_item_external_id": _safe_public(note_external_id),
            "author_external_id": _safe_public(_author_external_id(author)),
            "author_display_name": _safe_public(_author_display_name(author)),
            "author_url": _safe_public(_author_url(author)),
            "summary": _safe_public(_comment_text(comment)),
            "metrics": _comment_metrics(comment),
            "raw_artifact_ref": raw_artifact_ref,
        }

    def _evidence_id(self, kind, *parts):
        safe_parts = [_safe_id_part(part) for part in parts]
        return ":".join([PLATFORM, "project", str(self.project_id), kind, *safe_parts])


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _search_notes(fixture):
    if isinstance(fixture, list):
        return fixture
    direct = _first(fixture, "notes", "items", "list", "results")
    if isinstance(direct, list):
        return direct
    data = fixture.get("data") if isinstance(fixture, dict) else None
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        nested = _first(data, "notes", "items", "list", "results")
        if isinstance(nested, list):
            return nested
    return []


def _detail_note(fixture):
    note = _first(fixture, "note", "item", "detail")
    if isinstance(note, dict):
        return note
    data = fixture.get("data") if isinstance(fixture, dict) else None
    if isinstance(data, dict):
        nested = _first(data, "note", "item", "detail")
        if isinstance(nested, dict):
            return nested
    return fixture if isinstance(fixture, dict) else {}


def _detail_comments(fixture, note):
    comments = _first(fixture, "comments", "comment_list")
    if isinstance(comments, list):
        return comments
    note_comments = _first(note, "comments", "comment_list")
    if isinstance(note_comments, list):
        return note_comments
    data = fixture.get("data") if isinstance(fixture, dict) else None
    if isinstance(data, dict):
        data_comments = _first(data, "comments", "comment_list")
        if isinstance(data_comments, list):
            return data_comments
    return []


def _note_external_id(note):
    value = _safe_public(_first(note, "note_id", "noteId", "id", "noteIdStr"))
    if value:
        return value
    return _stable_fallback("note", _note_title(note), _note_text(note), _first(note, "url", "note_url"))


def _comment_external_id(comment, note_external_id=None):
    value = _safe_public(_first(comment, "comment_id", "commentId", "id", "cid"))
    if value:
        return value
    return _stable_fallback(
        "comment",
        note_external_id,
        _comment_text(comment),
        _author_external_id(_author(comment)),
    )


def _note_title(note):
    return _first(note, "title", "display_title", "name")


def _note_text(note):
    return _first(note, "desc", "description", "content", "text", "body", "body_text")


def _comment_text(comment):
    content = _first(comment, "content", "text", "message", "comment_content", "desc")
    if isinstance(content, dict):
        return _first(content, "content", "text", "message")
    return content


def _author(container):
    author = _first(container, "author", "user", "user_info", "owner", "creator")
    return author if isinstance(author, dict) else {}


def _author_external_id(author):
    return _first(author, "user_id", "userId", "id", "uid", "userid")


def _author_display_name(author):
    return _first(author, "nickname", "name", "display_name", "uname")


def _author_url(author):
    return _first(author, "profile_url", "url", "homepage", "author_url")


def _published_at(note):
    return _first(note, "published_at", "publish_time", "created_at", "create_time", "time")


def _note_metrics(note):
    stats = _metrics_container(note)
    return {
        "like_count": _safe_int(_metric(stats, note, "like_count", "liked_count", "likes", "likedCount")),
        "collect_count": _safe_int(_metric(stats, note, "collect_count", "collected_count", "collects", "favorite_count")),
        "comment_count": _safe_int(_metric(stats, note, "comment_count", "comments_count", "comments", "comment")),
        "share_count": _safe_int(_metric(stats, note, "share_count", "shares", "share")),
    }


def _comment_metrics(comment):
    stats = _metrics_container(comment)
    return {
        "like_count": _safe_int(_metric(stats, comment, "like_count", "liked_count", "likes", "likedCount")),
        "reply_count": _safe_int(_metric(stats, comment, "reply_count", "sub_comment_count", "replies", "reply")),
    }


def _metrics_container(item):
    stats = _first(item, "stats", "stat", "interact_info", "interaction")
    return stats if isinstance(stats, dict) else {}


def _metric(stats, item, *keys):
    value = _first(stats, *keys)
    if value is not None:
        return value
    return _first(item, *keys)


def _first(mapping, *keys):
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return None


def _join_text(*values):
    return " ".join(str(value) for value in values if value)


def _safe_public(value):
    return sanitize_agent_reach_public(value)


def _safe_artifact_ref(value):
    safe = sanitize_agent_reach_public(value)
    if not isinstance(safe, str):
        return None

    safe = safe.strip()
    prefix = "artifacts/agent-reach/xiaohongshu/"
    if not safe.startswith(prefix):
        return None
    if safe.startswith("/") or "\\" in safe or ":" in safe:
        return None
    if any(part in {"", ".", ".."} for part in safe.split("/")):
        return None
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", safe):
        return None
    compact = re.sub(r"[^A-Za-z0-9]", "", safe).lower()
    if any(marker in compact for marker in SENSITIVE_ARTIFACT_REF_MARKERS):
        return None
    return safe


def _safe_id_part(value):
    safe = sanitize_agent_reach_public(value)
    if safe is None or safe == "":
        return "unknown"
    return str(safe)


def _safe_int(value):
    safe = sanitize_agent_reach_public(value)
    if safe is None or safe == "":
        return 0
    try:
        return int(float(str(safe).replace(",", "")))
    except (TypeError, ValueError):
        return 0


def _stable_fallback(prefix, *values):
    body = json.dumps([value for value in values if value], ensure_ascii=False, sort_keys=True)
    if not body or body == "[]":
        return f"{prefix}-unknown"
    digest = hashlib.sha1(body.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"
