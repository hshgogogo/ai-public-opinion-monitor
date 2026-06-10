from workers.collectors.base import load_cookie_state, stable_id


def collect(keyword, cookie_file, limit=20):
    cookies = load_cookie_state(cookie_file)
    try:
        import scrapling  # noqa: F401
    except Exception as exc:
        raise RuntimeError(f"scrapling is not installed: {exc}") from exc

    # Enterprise hook: Spider_XHS should be mounted here when its repo is available.
    # This adapter deliberately does not fake comments when the authorized collector is absent.
    raise RuntimeError(
        "Spider_XHS adapter is not installed in this workspace. "
        f"Cookie state has {len(cookies)} entries, but real Xiaohongshu collection cannot run yet."
    )


def normalize_note(keyword, raw):
    text = raw.get("content") or raw.get("desc") or raw.get("title") or ""
    return {
        "external_id": raw.get("id") or stable_id("xiaohongshu", keyword, text),
        "url": raw.get("url"),
        "author_name": raw.get("author") or raw.get("nickname"),
        "title": raw.get("title"),
        "content": text,
        "keyword": keyword,
        "engagement": int(raw.get("likes") or raw.get("liked_count") or 0),
        "comments": raw.get("comments") or [],
        "raw_json": raw,
    }
