import hashlib
import json
from pathlib import Path

ALLOWED_PLATFORMS = {"xiaohongshu", "douyin", "weibo"}


class AuthStateError(RuntimeError):
    pass


def load_cookie_state(cookie_file):
    path = Path(cookie_file)
    if not path.exists():
        raise AuthStateError(f"Cookie file not found: {cookie_file}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "cookies" in data:
        return data["cookies"]
    raise AuthStateError(f"Cookie file must be a cookie list or Playwright storageState: {cookie_file}")


def stable_id(platform, *parts):
    raw = "::".join([platform, *[str(part) for part in parts]])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
