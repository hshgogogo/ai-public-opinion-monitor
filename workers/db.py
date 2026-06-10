import json
import os
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

try:
    import pymysql
except Exception:  # pragma: no cover
    pymysql = None


DEFAULT_PROJECT = {
    "project_name": "海岛舒服日志",
    "category": "微博 MVP",
    "audience": "制片人与宣发团队",
    "keywords": ["海岛舒服日志", "刘昊然", "李兰迪"],
    "actors": ["刘昊然", "李兰迪"],
    "active_platforms": ["weibo"],
}


def load_env_file(path=".env"):
    env_path = Path(path)
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_env_file()


def mysql_url():
    return os.environ.get("MYSQL_URL", "")


def parse_mysql_url(url):
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": parsed.username or "root",
        "password": parsed.password or "",
        "database": parsed.path.lstrip("/") or "yuqing_monitor",
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor if pymysql else None,
        "autocommit": True,
    }


@contextmanager
def connect():
    if pymysql is None:
        raise RuntimeError("PyMySQL is not installed. Run: python -m pip install -r requirements.txt")
    url = mysql_url()
    if not url:
        raise RuntimeError("MYSQL_URL is not configured")
    conn = pymysql.connect(**parse_mysql_url(url))
    try:
        yield conn
    finally:
        conn.close()


def run_migration(sql_path=None):
    paths = [Path(sql_path)] if sql_path else [
        Path("migrations/001_enterprise_mysql.sql"),
        Path("migrations/002_weibo_mvp_ingestion.sql"),
        Path("migrations/003_weibo_mvp_event_action.sql"),
        Path("migrations/004_weibo_mvp_memory_report.sql"),
        Path("migrations/005_weibo_mvp_sentiment.sql"),
    ]
    with connect() as conn:
        with conn.cursor() as cur:
            for path in paths:
                sql = path.read_text(encoding="utf-8")
                statements = [part.strip() for part in sql.split(";") if part.strip()]
                for statement in statements:
                    cur.execute(statement)
    ensure_default_auth_states()
    ensure_default_project()


def ensure_default_project():
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM monitor_projects WHERE project_name=%s ORDER BY id LIMIT 1", (DEFAULT_PROJECT["project_name"],))
            row = cur.fetchone()
            if row:
                cur.execute(
                    """
                    UPDATE monitor_projects
                    SET category=%s, audience=%s, keywords=%s, actors=%s, active_platforms=%s
                    WHERE id=%s
                    """,
                    (
                        DEFAULT_PROJECT["category"],
                        DEFAULT_PROJECT["audience"],
                        json.dumps(DEFAULT_PROJECT["keywords"], ensure_ascii=False),
                        json.dumps(DEFAULT_PROJECT["actors"], ensure_ascii=False),
                        json.dumps(DEFAULT_PROJECT["active_platforms"], ensure_ascii=False),
                        row["id"],
                    ),
                )
                return row["id"]
            cur.execute(
                """
                INSERT INTO monitor_projects(project_name, category, audience, keywords, actors, active_platforms)
                VALUES (%s,%s,%s,%s,%s,%s)
                """,
                (
                    DEFAULT_PROJECT["project_name"],
                    DEFAULT_PROJECT["category"],
                    DEFAULT_PROJECT["audience"],
                    json.dumps(DEFAULT_PROJECT["keywords"], ensure_ascii=False),
                    json.dumps(DEFAULT_PROJECT["actors"], ensure_ascii=False),
                    json.dumps(DEFAULT_PROJECT["active_platforms"], ensure_ascii=False),
                ),
            )
            return cur.lastrowid


def ensure_default_auth_states():
    defaults = {
        "weibo": os.environ.get("WEIBO_COOKIE_FILE", "config/cookies/weibo.json"),
    }
    with connect() as conn:
        with conn.cursor() as cur:
            for platform, cookie_file in defaults.items():
                status = "configured" if Path(cookie_file).exists() else "missing"
                cur.execute(
                    """
                    INSERT INTO platform_auth_states(platform, cookie_file, status, last_checked_at)
                    VALUES (%s,%s,%s,NOW())
                    ON DUPLICATE KEY UPDATE cookie_file=VALUES(cookie_file), status=VALUES(status), last_checked_at=NOW()
                    """,
                    (platform, cookie_file, status),
                )


def health():
    if pymysql is None:
        return {"connected": False, "error": "PyMySQL is not installed"}
    if not mysql_url():
        return {"connected": False, "error": "MYSQL_URL is not configured"}
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
        return {"connected": True}
    except Exception as exc:
        return {"connected": False, "error": str(exc)}


def jloads(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return fallback
