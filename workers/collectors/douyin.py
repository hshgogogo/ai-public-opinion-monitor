from workers.collectors.base import load_cookie_state, stable_id


def collect(keyword, cookie_file, limit=20):
    cookies = load_cookie_state(cookie_file)
    try:
        from crawl4ai import AsyncWebCrawler  # noqa: F401
    except Exception as exc:
        raise RuntimeError(f"crawl4ai is not installed: {exc}") from exc

    raise RuntimeError(
        "Douyin authenticated browser collector is not configured. "
        f"Cookie state has {len(cookies)} entries, but no real comments were collected."
    )


def normalize_video(keyword, raw):
    text = raw.get("content") or raw.get("desc") or raw.get("title") or ""
    return {
        "external_id": raw.get("id") or stable_id("douyin", keyword, text),
        "url": raw.get("url"),
        "author_name": raw.get("author") or raw.get("nickname"),
        "title": raw.get("title"),
        "content": text,
        "keyword": keyword,
        "engagement": int(raw.get("likes") or raw.get("digg_count") or 0),
        "comments": raw.get("comments") or [],
        "raw_json": raw,
    }
