from workers.collectors.base import load_cookie_state, stable_id


def collect(keyword, cookie_file, limit=20):
    cookies = load_cookie_state(cookie_file)
    try:
        import scrapling  # noqa: F401
    except Exception as exc:
        raise RuntimeError(f"scrapling is not installed: {exc}") from exc

    raise RuntimeError(
        "Weibo authenticated search/comment collector is not configured. "
        f"Cookie state has {len(cookies)} entries, but no real comments were collected."
    )


def normalize_post(keyword, raw):
    text = raw.get("content") or raw.get("text") or raw.get("title") or ""
    return {
        "external_id": raw.get("id") or stable_id("weibo", keyword, text),
        "url": raw.get("url"),
        "author_name": raw.get("author") or raw.get("screen_name"),
        "title": raw.get("title"),
        "content": text,
        "keyword": keyword,
        "engagement": int(raw.get("likes") or raw.get("attitudes_count") or 0),
        "comments": raw.get("comments") or [],
        "raw_json": raw,
    }
