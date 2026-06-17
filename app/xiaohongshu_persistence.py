import json

from .agent_reach_adapter import _is_agent_reach_sensitive_key, sanitize_agent_reach_public
from .xiaohongshu_normalizer import safe_xiaohongshu_artifact_ref


PLATFORM = "xiaohongshu"


class XiaohongshuEvidenceWriter:
    def __init__(self, repository):
        self.repository = repository

    def persist(self, payload):
        validation_error = _validate_payload(payload)
        if validation_error:
            return validation_error

        project_id = int(payload["project_id"])
        source_account_ids = set()
        post_ids = []
        comment_ids = []
        evidence_ids = []

        for item in payload.get("content_items") or []:
            account_id = self._upsert_source_account(project_id, item)
            if account_id:
                source_account_ids.add(account_id)
            post_ids.append(self.repository.upsert_post(project_id, item))
            evidence_ids.extend(item.get("evidence_ids") or [])

        for evidence in payload.get("evidence_summaries") or []:
            if evidence.get("source_type") != "comment":
                continue
            account_id = self._upsert_source_account(project_id, evidence)
            if account_id:
                source_account_ids.add(account_id)
            post_external_id = evidence.get("content_item_external_id")
            post_id = self.repository.find_post_id(project_id, PLATFORM, post_external_id)
            if post_id:
                comment_ids.append(self.repository.upsert_comment(project_id, post_id, evidence))

        return {
            "ok": True,
            "platform": PLATFORM,
            "project_id": project_id,
            "persisted_source_accounts": len(source_account_ids),
            "persisted_posts": len(post_ids),
            "persisted_comments": len(comment_ids),
            "updated_posts": len(post_ids),
            "evidence_ids": _dedupe(evidence_ids),
        }

    def _upsert_source_account(self, project_id, item):
        external_id = item.get("author_external_id")
        display_name = item.get("author_display_name")
        if not external_id and not display_name:
            return None
        return self.repository.upsert_source_account(project_id, {
            "platform": PLATFORM,
            "external_id": external_id,
            "display_name": display_name or external_id,
            "profile_url": item.get("author_url"),
            "raw_json": {
                "source": "xiaohongshu_normalizer",
                "external_id": external_id,
                "display_name": display_name,
            },
        })


class InMemoryXiaohongshuRepository:
    def __init__(self):
        self.source_accounts = {}
        self.posts = {}
        self.comments = {}
        self._next_id = 1

    def upsert_source_account(self, project_id, account):
        key = (project_id, account.get("platform") or PLATFORM, account.get("external_id") or f"display:{account.get('display_name')}")
        existing = self.source_accounts.get(key)
        row = {
            "id": existing["id"] if existing else self._id(),
            "project_id": project_id,
            "platform": key[1],
            "external_id": account.get("external_id"),
            "profile_url": account.get("profile_url"),
            "display_name": account.get("display_name") or account.get("external_id"),
            "raw_json": account.get("raw_json") or {},
        }
        self.source_accounts[key] = row
        return row["id"]

    def upsert_post(self, project_id, item):
        key = (project_id, PLATFORM, item.get("external_id"))
        existing = self.posts.get(key)
        row = {
            "id": existing["id"] if existing else self._id(),
            "project_id": project_id,
            "platform": PLATFORM,
            "external_id": item.get("external_id"),
            "url": item.get("url"),
            "author_name": item.get("author_display_name"),
            "title": item.get("title"),
            "content": item.get("text") or item.get("title") or "",
            "keyword": PLATFORM,
            "engagement": _engagement(item.get("metrics") or {}),
            "like_count": _int_metric(item, "like_count"),
            "reply_count": _int_metric(item, "comment_count"),
            "share_count": _int_metric(item, "share_count"),
            "raw_artifact_ref": item.get("raw_artifact_ref"),
            "raw_json": _post_raw_json(item),
        }
        self.posts[key] = row
        return row["id"]

    def upsert_comment(self, project_id, post_id, evidence):
        key = (project_id, PLATFORM, evidence.get("external_id"))
        existing = self.comments.get(key)
        metrics = evidence.get("metrics") or {}
        row = {
            "id": existing["id"] if existing else self._id(),
            "post_id": post_id,
            "project_id": project_id,
            "platform": PLATFORM,
            "external_id": evidence.get("external_id"),
            "author_name": evidence.get("author_display_name"),
            "content": evidence.get("summary") or "",
            "like_count": int(metrics.get("like_count") or 0),
            "reply_count": int(metrics.get("reply_count") or 0),
            "raw_artifact_ref": evidence.get("raw_artifact_ref"),
            "raw_json": _evidence_raw_json(evidence),
        }
        self.comments[key] = row
        return row["id"]

    def find_post_id(self, project_id, platform, external_id):
        row = self.posts.get((project_id, platform, external_id))
        return row["id"] if row else None

    def count(self, table, project_id):
        rows = getattr(self, table)
        return sum(1 for row in rows.values() if row["project_id"] == project_id)

    def post(self, project_id, external_id):
        return self.posts[(project_id, PLATFORM, external_id)]

    def comment(self, project_id, external_id):
        return self.comments[(project_id, PLATFORM, external_id)]

    def snapshot(self):
        return {
            "source_accounts": list(self.source_accounts.values()),
            "posts": list(self.posts.values()),
            "comments": list(self.comments.values()),
        }

    def _id(self):
        value = self._next_id
        self._next_id += 1
        return value


class MySQLXiaohongshuRepository:
    def __init__(self, db_module):
        self.db = db_module

    def upsert_source_account(self, project_id, account):
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO source_accounts(
                      project_id, platform, external_id, profile_url, display_name,
                      source_type, match_confidence, confirmed_by_user, raw_json
                    )
                    VALUES (%s,%s,%s,%s,%s,'unknown',0,0,%s)
                    ON DUPLICATE KEY UPDATE
                      id=LAST_INSERT_ID(id),
                      profile_url=VALUES(profile_url),
                      display_name=VALUES(display_name),
                      raw_json=VALUES(raw_json)
                    """,
                    (
                        project_id,
                        account.get("platform") or PLATFORM,
                        account.get("external_id"),
                        account.get("profile_url"),
                        account.get("display_name") or account.get("external_id"),
                        _json(account.get("raw_json") or {}),
                    ),
                )
                return cur.lastrowid

    def upsert_post(self, project_id, item):
        metrics = item.get("metrics") or {}
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO social_posts(
                      project_id, platform, external_id, url, author_name, title, content,
                      keyword, engagement, reply_count, share_count, source_account_external_id,
                      raw_json
                    )
                    VALUES (%s,'xiaohongshu',%s,%s,%s,%s,%s,'xiaohongshu',%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                      id=LAST_INSERT_ID(id),
                      url=VALUES(url),
                      author_name=VALUES(author_name),
                      title=VALUES(title),
                      content=VALUES(content),
                      engagement=VALUES(engagement),
                      reply_count=VALUES(reply_count),
                      share_count=VALUES(share_count),
                      source_account_external_id=VALUES(source_account_external_id),
                      raw_json=VALUES(raw_json)
                    """,
                    (
                        project_id,
                        item.get("external_id"),
                        item.get("url"),
                        item.get("author_display_name"),
                        item.get("title"),
                        item.get("text") or item.get("title") or "",
                        int(metrics.get("like_count") or 0),
                        int(metrics.get("comment_count") or 0),
                        int(metrics.get("share_count") or 0),
                        item.get("author_external_id"),
                        _json(_post_raw_json(item)),
                    ),
                )
                return cur.lastrowid

    def upsert_comment(self, project_id, post_id, evidence):
        metrics = evidence.get("metrics") or {}
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO social_comments(
                      post_id, project_id, platform, external_id, author_name, content,
                      like_count, reply_count, source_account_external_id, raw_json
                    )
                    VALUES (%s,%s,'xiaohongshu',%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                      id=LAST_INSERT_ID(id),
                      post_id=VALUES(post_id),
                      author_name=VALUES(author_name),
                      content=VALUES(content),
                      like_count=VALUES(like_count),
                      reply_count=VALUES(reply_count),
                      source_account_external_id=VALUES(source_account_external_id),
                      raw_json=VALUES(raw_json)
                    """,
                    (
                        post_id,
                        project_id,
                        evidence.get("external_id"),
                        evidence.get("author_display_name"),
                        evidence.get("summary") or "",
                        int(metrics.get("like_count") or 0),
                        int(metrics.get("reply_count") or 0),
                        evidence.get("author_external_id"),
                        _json(_evidence_raw_json(evidence)),
                    ),
                )
                return cur.lastrowid

    def find_post_id(self, project_id, platform, external_id):
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM social_posts WHERE project_id=%s AND platform=%s AND external_id=%s",
                    (project_id, platform, external_id),
                )
                row = cur.fetchone()
                return row["id"] if row else None


def _validate_payload(payload):
    if payload.get("platform") != PLATFORM:
        return {
            "ok": False,
            "error_type": "xiaohongshu_platform_not_allowed",
            "message": "Xiaohongshu persistence only accepts normalized 小红书 payloads.",
        }
    project_id = payload.get("project_id")
    if not isinstance(project_id, int) or isinstance(project_id, bool) or project_id <= 0:
        return {
            "ok": False,
            "error_type": "invalid_project_id",
            "message": "Xiaohongshu persistence requires a positive project_id.",
        }
    if (
        not _payload_is_safe(payload)
        or not _artifact_refs_are_safe(payload)
        or not _content_items_match_project(payload, project_id)
        or not _evidence_ids_match_project(payload, project_id)
    ):
        return {
            "ok": False,
            "error_type": "unsafe_xiaohongshu_payload",
            "message": "Xiaohongshu persistence rejected unsafe public payload values.",
        }
    return None


def _payload_is_safe(value):
    if isinstance(value, dict):
        return all(
            not _is_agent_reach_sensitive_key(key) and _payload_is_safe(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return all(_payload_is_safe(item) for item in value)
    if isinstance(value, str):
        return sanitize_agent_reach_public(value) == value
    return True


def _artifact_refs_are_safe(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "raw_artifact_ref" and item is not None and safe_xiaohongshu_artifact_ref(item) != item:
                return False
            if not _artifact_refs_are_safe(item):
                return False
        return True
    if isinstance(value, list):
        return all(_artifact_refs_are_safe(item) for item in value)
    return True


def _content_items_match_project(payload, project_id):
    for item in payload.get("content_items") or []:
        if item.get("platform") not in (None, PLATFORM):
            return False
        if item.get("project_id") not in (None, project_id):
            return False
    return True


def _evidence_ids_match_project(payload, project_id):
    expected_prefixes = (
        f"{PLATFORM}:project:{project_id}:item:",
        f"{PLATFORM}:project:{project_id}:comment:",
    )
    for item in payload.get("content_items") or []:
        for evidence_id in item.get("evidence_ids") or []:
            if not isinstance(evidence_id, str) or not evidence_id.startswith(expected_prefixes):
                return False
    for evidence in payload.get("evidence_summaries") or []:
        evidence_id = evidence.get("id")
        if evidence_id and (not isinstance(evidence_id, str) or not evidence_id.startswith(expected_prefixes)):
            return False
        if evidence.get("platform") not in (None, PLATFORM):
            return False
        if evidence.get("project_id") not in (None, project_id):
            return False
    return True


def _post_raw_json(item):
    return {
        "raw_artifact_ref": item.get("raw_artifact_ref"),
        "evidence_ids": item.get("evidence_ids") or [],
        "metrics": item.get("metrics") or {},
    }


def _evidence_raw_json(evidence):
    return {
        "raw_artifact_ref": evidence.get("raw_artifact_ref"),
        "evidence_id": evidence.get("id"),
        "source_type": evidence.get("source_type"),
        "content_item_external_id": evidence.get("content_item_external_id"),
        "metrics": evidence.get("metrics") or {},
    }


def _engagement(metrics):
    return int(metrics.get("like_count") or 0)


def _int_metric(item, key):
    return int((item.get("metrics") or {}).get(key) or 0)


def _dedupe(values):
    return list(dict.fromkeys(value for value in values if value))


def _json(value):
    return json.dumps(value, ensure_ascii=False)
