import json
from pathlib import Path

from .agent_reach_adapter import sanitize_agent_reach_public


PLATFORM = "bilibili"


class BilibiliNormalizer:
    def __init__(self, project_id):
        self.project_id = project_id

    def normalize_search_fixture(self, path, raw_artifact_ref):
        fixture = _read_json(path)
        safe_artifact_ref = _safe_public(raw_artifact_ref)
        evidence_summaries = [
            self._item_evidence_summary(item, safe_artifact_ref)
            for item in fixture.get("items", [])
        ]
        content_items = [
            self._content_item(item, safe_artifact_ref, [evidence["id"]])
            for item, evidence in zip(fixture.get("items", []), evidence_summaries)
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
        safe_artifact_ref = _safe_public(raw_artifact_ref)
        video = fixture.get("video", {})
        evidence_summaries = self._detail_evidence_summaries(fixture, safe_artifact_ref)
        content_item = self._content_item(
            video,
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

    def _content_item(self, item, raw_artifact_ref, evidence_ids):
        author = item.get("author") or {}
        return {
            "platform": PLATFORM,
            "project_id": self.project_id,
            "external_id": _safe_public(item.get("bvid")),
            "title": _safe_public(item.get("title")),
            "text": _safe_public(item.get("description")),
            "url": _safe_public(item.get("url")),
            "author_external_id": _safe_public(author.get("mid")),
            "author_display_name": _safe_public(author.get("name")),
            "published_at": _safe_public(item.get("published_at")),
            "metrics": _metrics_from_stat(item.get("stat") or {}),
            "raw_artifact_ref": raw_artifact_ref,
            "evidence_ids": evidence_ids,
        }

    def _detail_evidence_summaries(self, fixture, raw_artifact_ref):
        video = fixture.get("video", {})
        bvid = video.get("bvid")
        evidence = [self._item_evidence_summary(video, raw_artifact_ref)]

        for comment in fixture.get("comments", []):
            member = comment.get("member") or {}
            content = comment.get("content") or {}
            evidence.append(
                {
                    "id": self._evidence_id("comment", comment.get("rpid")),
                    "platform": PLATFORM,
                    "project_id": self.project_id,
                    "source_type": "comment",
                    "external_id": _safe_public(comment.get("rpid")),
                    "content_item_external_id": _safe_public(bvid),
                    "author_external_id": _safe_public(member.get("mid")),
                    "author_display_name": _safe_public(member.get("uname")),
                    "summary": _safe_public(content.get("message")),
                    "metrics": {
                        "like_count": _safe_int(comment.get("like_count")),
                        "reply_count": _safe_int(comment.get("reply_count")),
                    },
                    "raw_artifact_ref": raw_artifact_ref,
                }
            )

        for subtitle in fixture.get("subtitles", []):
            language = _normalize_language(subtitle.get("language"))
            evidence.append(
                {
                    "id": self._evidence_id("text", bvid, "transcript", language),
                    "platform": PLATFORM,
                    "project_id": self.project_id,
                    "source_type": "transcript",
                    "external_id": _safe_public(f"{bvid}:transcript:{language}"),
                    "content_item_external_id": _safe_public(bvid),
                    "summary": _safe_public(_subtitle_summary(subtitle)),
                    "raw_artifact_ref": raw_artifact_ref,
                }
            )

        body_text = video.get("body_text")
        if body_text:
            evidence.append(
                {
                    "id": self._evidence_id("text", bvid, "body"),
                    "platform": PLATFORM,
                    "project_id": self.project_id,
                    "source_type": "body_text",
                    "external_id": _safe_public(f"{bvid}:body"),
                    "content_item_external_id": _safe_public(bvid),
                    "summary": _safe_public(body_text),
                    "raw_artifact_ref": raw_artifact_ref,
                }
            )

        return evidence

    def _item_evidence_summary(self, item, raw_artifact_ref):
        bvid = item.get("bvid")
        return {
            "id": self._item_evidence_id(item),
            "platform": PLATFORM,
            "project_id": self.project_id,
            "source_type": "video",
            "external_id": _safe_public(bvid),
            "content_item_external_id": _safe_public(bvid),
            "summary": _safe_public(_join_text(item.get("title"), item.get("description"))),
            "raw_artifact_ref": raw_artifact_ref,
        }

    def _item_evidence_id(self, item):
        return self._evidence_id("item", item.get("bvid"))

    def _evidence_id(self, kind, *parts):
        safe_parts = [_safe_id_part(part) for part in parts]
        return ":".join([PLATFORM, "project", str(self.project_id), kind, *safe_parts])


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _metrics_from_stat(stat):
    return {
        "view_count": _safe_int(stat.get("view")),
        "like_count": _safe_int(stat.get("like")),
        "comment_count": _safe_int(stat.get("reply")),
        "share_count": _safe_int(stat.get("share")),
    }


def _normalize_language(language):
    return str(language or "unknown").lower()


def _subtitle_summary(subtitle):
    return "".join(
        str(item.get("content") or "")
        for item in subtitle.get("body", [])
    )


def _join_text(*values):
    return " ".join(str(value) for value in values if value)


def _safe_public(value):
    return sanitize_agent_reach_public(value)


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
