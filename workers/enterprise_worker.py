#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import socket
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workers import db
from workers.agents.sentiment_agent import analyze_comment
from workers.collectors import douyin, weibo, xiaohongshu


PLATFORM_LABELS = {
    "weibo": "微博",
}

COLLECTORS = {
    "xiaohongshu": xiaohongshu.collect,
    "douyin": douyin.collect,
    "weibo": weibo.collect,
}


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health")
    sub.add_parser("migrate")
    sub.add_parser("weibo-fixture-hello")
    add_payload_parser(sub, "weibo-workbench")
    add_payload_parser(sub, "weibo-discovery")
    add_payload_parser(sub, "weibo-targets")
    add_payload_parser(sub, "weibo-target-select")
    add_payload_parser(sub, "weibo-target-ignore")
    add_payload_parser(sub, "weibo-source-account-upsert")
    collect_target = add_payload_parser(sub, "weibo-collect-target")
    collect_target.add_argument("--target-id", required=True)
    events = add_payload_parser(sub, "weibo-events")
    events.add_argument("--event-id")
    add_payload_parser(sub, "weibo-actions-pending")
    action_confirm = add_payload_parser(sub, "weibo-action-confirm")
    action_confirm.add_argument("--action-id", required=True)
    action_backtest = add_payload_parser(sub, "weibo-action-backtest")
    action_backtest.add_argument("--action-id", required=True)
    add_payload_parser(sub, "weibo-bot-message")
    e2e_fixture = sub.add_parser("weibo-fixture-e2e")
    e2e_fixture.add_argument("--now", required=True)
    search_fixture = sub.add_parser("weibo-parse-search-fixture")
    search_fixture.add_argument("--fixture", required=True)
    search_fixture.add_argument("--limit", type=int, default=10)
    locator = sub.add_parser("weibo-validate-target-locator")
    locator.add_argument("--locator-json", required=True)
    detail_fixture = sub.add_parser("weibo-parse-detail-fixture")
    detail_fixture.add_argument("--fixture", required=True)
    detail_fixture.add_argument("--target-id", required=True)
    detail_fixture.add_argument("--task-id", required=True)
    analysis_fixture = sub.add_parser("weibo-analyze-comments-fixture")
    analysis_fixture.add_argument("--fixture", required=True)
    analysis_fixture.add_argument("--now", required=True)
    deepseek_fixture = sub.add_parser("weibo-deepseek-fixture")
    deepseek_fixture.add_argument("--comments", required=True)
    deepseek_fixture.add_argument("--now", required=True)
    deepseek_fixture.add_argument("--response")
    deepseek_fixture.add_argument("--simulate-failure")
    deepseek_fixture.add_argument("--persist-project-id", type=int)
    events_fixture = sub.add_parser("weibo-build-events-fixture")
    events_fixture.add_argument("--fixture", required=True)
    events_fixture.add_argument("--persist-project-id", type=int)
    actions_fixture = sub.add_parser("weibo-actions-fixture")
    actions_fixture.add_argument("--accounts", required=True)
    actions_fixture.add_argument("--posts", required=True)
    actions_fixture.add_argument("--event-id", required=True)
    actions_fixture.add_argument("--now", required=True)
    actions_fixture.add_argument("--persist-project-id", type=int)
    backtest_fixture = sub.add_parser("weibo-backtest-fixture")
    backtest_fixture.add_argument("--fixture", required=True)
    memory_fixture = sub.add_parser("weibo-memory-report-fixture")
    memory_fixture.add_argument("--fixture", required=True)
    memory_fixture.add_argument("--question", required=True)
    memory_fixture.add_argument("--now", required=True)
    memory_fixture.add_argument("--persist-project-id", type=int)
    snapshot = sub.add_parser("snapshot")
    snapshot.add_argument("--project-id", type=int)
    collect = sub.add_parser("collect")
    collect.add_argument("--project-id", type=int)
    collect.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    try:
        if args.command == "health":
            emit(health_payload())
        elif args.command == "migrate":
            db.run_migration()
            emit({"ok": True, "database": db.health()})
        elif args.command == "weibo-fixture-hello":
            emit(weibo_fixture_hello())
        elif args.command == "weibo-workbench":
            emit(weibo_workbench_payload())
        elif args.command == "weibo-discovery":
            emit(weibo_discovery_payload(args.payload_json))
        elif args.command == "weibo-targets":
            emit(weibo_targets_payload(args.payload_json))
        elif args.command == "weibo-target-select":
            emit(weibo_target_state_payload(args.payload_json, "selected"))
        elif args.command == "weibo-target-ignore":
            emit(weibo_target_state_payload(args.payload_json, "ignored"))
        elif args.command == "weibo-source-account-upsert":
            emit(weibo_source_account_upsert_payload(args.payload_json))
        elif args.command == "weibo-collect-target":
            emit(weibo_collect_target_payload(args.payload_json, args.target_id))
        elif args.command == "weibo-events":
            emit(real_weibo_endpoint_payload("GET /api/weibo/events", args.payload_json, event_id=args.event_id))
        elif args.command == "weibo-actions-pending":
            emit(weibo_actions_pending_payload(args.payload_json))
        elif args.command == "weibo-action-confirm":
            emit(weibo_action_confirm_payload(args.payload_json, args.action_id))
        elif args.command == "weibo-action-backtest":
            emit(real_weibo_endpoint_payload("POST /api/weibo/actions/:id/backtest", args.payload_json, action_id=args.action_id))
        elif args.command == "weibo-bot-message":
            emit(real_weibo_endpoint_payload("POST /api/weibo/bot/messages", args.payload_json))
        elif args.command == "weibo-fixture-e2e":
            emit(weibo_fixture_e2e(args.now))
        elif args.command == "weibo-parse-search-fixture":
            emit(parse_weibo_search_fixture(args.fixture, args.limit))
        elif args.command == "weibo-validate-target-locator":
            emit(validate_weibo_target_locator(json.loads(args.locator_json)))
        elif args.command == "weibo-parse-detail-fixture":
            emit(parse_weibo_detail_fixture(args.fixture, args.target_id, args.task_id))
        elif args.command == "weibo-analyze-comments-fixture":
            emit(analyze_weibo_comments_fixture(args.fixture, args.now))
        elif args.command == "weibo-deepseek-fixture":
            emit(run_deepseek_fixture(args.comments, args.now, args.response, args.simulate_failure, args.persist_project_id))
        elif args.command == "weibo-build-events-fixture":
            emit(build_weibo_events_fixture(args.fixture, args.persist_project_id))
        elif args.command == "weibo-actions-fixture":
            emit(build_weibo_actions_fixture(args.accounts, args.posts, args.event_id, args.now, args.persist_project_id))
        elif args.command == "weibo-backtest-fixture":
            emit(build_weibo_backtest_fixture(args.fixture))
        elif args.command == "weibo-memory-report-fixture":
            emit(build_weibo_memory_report_fixture(args.fixture, args.question, args.now, args.persist_project_id))
        elif args.command == "snapshot":
            emit(snapshot_payload(args.project_id))
        elif args.command == "collect":
            emit(run_collection(args.project_id, args.limit))
    except Exception as exc:
        emit({"ok": False, "error": str(exc)}, code=1)


def emit(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False, default=str))
    sys.exit(code)


def add_payload_parser(subparsers, name):
    parser = subparsers.add_parser(name)
    parser.add_argument("--payload-json", default="{}")
    return parser


def health_payload():
    database = db.health()
    auth = []
    if database.get("connected"):
        db.ensure_default_auth_states()
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT platform, cookie_file, status, last_checked_at FROM platform_auth_states ORDER BY platform")
                auth = cur.fetchall()
    weibo_auth = next((row for row in auth if row.get("platform") == "weibo"), None)
    if not weibo_auth:
        weibo_auth = {"platform": "weibo", "cookie_file": os.environ.get("WEIBO_COOKIE_FILE", "config/cookies/weibo.json"), "status": auth_status_from_cookie()}
    weibo_status = normalize_auth_status(weibo_auth.get("status"))
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "database": database,
        "auth": auth,
        "weiboMvp": {
            "database": database,
            "mediacrawler": mediacrawler_health(),
            "cdp": cdp_health(),
            "auth": {
                "platform": "weibo",
                "cookie_file": weibo_auth.get("cookie_file"),
                "status": weibo_status,
                "error": auth_error(weibo_status),
            },
        },
        "platforms": list(PLATFORM_LABELS.keys()),
    }


def snapshot_payload(project_id=None):
    database = db.health()
    if not database.get("connected"):
        return empty_snapshot(database)
    db.ensure_default_auth_states()
    project = get_project(project_id)
    if not project:
        return empty_snapshot(database, "No monitor project found")
    comments = load_comments(project["id"])
    results = load_sentiments([row["id"] for row in comments])
    items = [comment_to_item(row, results.get(row["id"])) for row in comments]
    strategy = load_strategy(project["id"]) or build_strategy(items, project)
    return build_snapshot(project, items, database, strategy)


def empty_snapshot(database, message=None):
    now = datetime.utcnow().isoformat() + "Z"
    return {
        "generatedAt": now,
        "config": db.DEFAULT_PROJECT,
        "enterprise": {
            "mode": "real-data-only",
            "database": database,
            "auth": [],
            "allowedPlatforms": list(PLATFORM_LABELS.keys()),
            "message": message or database.get("error") or "Database is not connected",
        },
        "kpis": {"totalMentions": 0, "heat": 0, "avgSentiment": 0, "positiveRate": 0, "negativeRate": 0, "riskScore": 0},
        "sentimentCounts": {},
        "sourceCounts": {},
        "topicCounts": {},
        "trend": [],
        "forecast": [],
        "topItems": [],
        "strategy": {
            "headline": "等待真实数据采集",
            "summary": "系统已切换为真实数据模式；未连接 MySQL 或未采集到真实评论时不会展示模拟数据。",
            "plays": [],
            "evidence": [],
        },
        "agents": enterprise_agents(database, []),
        "events": [],
        "rawItems": [],
    }


def get_project(project_id=None):
    with db.connect() as conn:
        with conn.cursor() as cur:
            if project_id:
                cur.execute("SELECT * FROM monitor_projects WHERE id=%s", (project_id,))
            else:
                cur.execute("SELECT * FROM monitor_projects ORDER BY updated_at DESC, id DESC LIMIT 1")
            row = cur.fetchone()
            if row:
                row["keywords"] = db.jloads(row.get("keywords"), [])
                row["actors"] = db.jloads(row.get("actors"), [])
                row["active_platforms"] = db.jloads(row.get("active_platforms"), [])
            return row


def load_comments(project_id):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, p.keyword, p.url, p.engagement AS post_engagement
                FROM social_comments c
                JOIN social_posts p ON p.id=c.post_id
                WHERE c.project_id=%s
                ORDER BY c.collected_at DESC
                LIMIT 500
                """,
                (project_id,),
            )
            return cur.fetchall()


def load_sentiments(comment_ids):
    if not comment_ids:
        return {}
    placeholders = ",".join(["%s"] * len(comment_ids))
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT * FROM sentiment_results WHERE comment_id IN ({placeholders}) ORDER BY created_at DESC",
                comment_ids,
            )
            rows = cur.fetchall()
    results = {}
    for row in rows:
        results.setdefault(row["comment_id"], row)
    return results


def comment_to_item(row, sentiment):
    label = sentiment["sentiment"] if sentiment else "neutral"
    score = float(sentiment["score"]) if sentiment else 0
    topics = db.jloads(sentiment.get("topics") if sentiment else None, ["待分析"])
    return {
        "id": row["id"],
        "source": PLATFORM_LABELS[row["platform"]],
        "platform": row["platform"],
        "author": row.get("author_name") or "匿名用户",
        "content": row["content"],
        "keyword": row["keyword"],
        "engagement": row["like_count"] or row["post_engagement"] or 0,
        "createdAt": row["collected_at"].isoformat() if hasattr(row["collected_at"], "isoformat") else str(row["collected_at"]),
        "sentimentLabel": label,
        "sentiment": score,
        "topics": topics,
        "heat": int((row["like_count"] or 0) + abs(score) * 10 + 1),
        "authenticity": "真实采集",
        "evidence": sentiment.get("evidence") if sentiment else "",
    }


def build_snapshot(project, items, database, strategy):
    total = len(items) or 1
    sentiment_counts = count_by(items, "sentimentLabel")
    source_counts = count_by(items, "source")
    topic_counts = {}
    for item in items:
        for topic in item["topics"]:
            topic_counts[topic] = topic_counts.get(topic, 0) + 1
    heat = sum(item["heat"] for item in items)
    avg = sum(item["sentiment"] for item in items) / total
    negative_rate = sentiment_counts.get("negative", 0) / total
    positive_rate = sentiment_counts.get("positive", 0) / total
    risk_score = min(100, round(negative_rate * 60 + len([i for i in items if i.get("evidence")]) * 0.2))
    trend = build_trend(items)
    return {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "config": {
            "projectName": project["project_name"],
            "category": project["category"],
            "audience": project["audience"],
            "keywords": project["keywords"],
            "actors": project["actors"],
            "activePlatforms": project["active_platforms"],
            "realtime": True,
            "refreshSeconds": 30,
        },
        "enterprise": {
            "mode": "real-data-only",
            "database": database,
            "auth": auth_states(),
            "allowedPlatforms": list(PLATFORM_LABELS.keys()),
            "message": "所有指标来自 MySQL 中的真实采集评论；无数据时不使用 mock。",
        },
        "kpis": {
            "totalMentions": len(items),
            "heat": heat,
            "avgSentiment": round(avg, 2),
            "positiveRate": round(positive_rate, 2),
            "negativeRate": round(negative_rate, 2),
            "riskScore": risk_score,
        },
        "sentimentCounts": sentiment_counts,
        "sourceCounts": source_counts,
        "topicCounts": topic_counts,
        "trend": trend,
        "forecast": forecast_trend(trend),
        "topItems": sorted(items, key=lambda item: item["heat"], reverse=True)[:8],
        "strategy": strategy,
        "agents": enterprise_agents(database, auth_states()),
        "events": recent_agent_events(project["id"]),
        "rawItems": items[:80],
    }


def run_collection(project_id=None, limit=20):
    return weibo_error(
        "legacy_collect_disabled",
        "Legacy collection is disabled in Weibo MVP mode.",
        "The old /api/collect path can run broad platform loops and is not the Weibo Agent contract.",
        "Use POST /api/weibo/discovery for Weibo search discovery.",
        docs_anchor="weibo-discovery",
    )


def run_platform_keyword(project, platform, keyword, limit):
    if platform not in COLLECTORS:
        return {"platform": platform, "keyword": keyword, "status": "failed", "error": "Unsupported platform"}
    auth = auth_state(platform)
    task_id = create_task(project["id"], platform, keyword, limit)
    if not auth or auth["status"] != "configured":
        error = f"{platform} cookie state is {auth['status'] if auth else 'missing'}"
        finish_task(task_id, "failed", error, 0, 0)
        return {"platform": platform, "keyword": keyword, "status": "failed", "error": error}
    try:
        posts = COLLECTORS[platform](keyword, auth["cookie_file"], limit)
        post_count = 0
        comment_count = 0
        for post in posts:
            post_id = upsert_post(project["id"], platform, post)
            post_count += 1
            for comment in post.get("comments", []):
                comment_id = upsert_comment(project["id"], post_id, platform, comment)
                analysis = analyze_comment(comment.get("content", ""))
                upsert_sentiment(comment_id, analysis)
                comment_count += 1
        finish_task(task_id, "succeeded", None, post_count, comment_count)
        return {"platform": platform, "keyword": keyword, "status": "succeeded", "posts": post_count, "comments": comment_count}
    except Exception as exc:
        finish_task(task_id, "failed", str(exc), 0, 0)
        return {"platform": platform, "keyword": keyword, "status": "failed", "error": str(exc)}


def create_task(project_id, platform, keyword, limit):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO collection_tasks(project_id, platform, keyword, status, requested_limit, started_at) VALUES (%s,%s,%s,'running',%s,NOW())",
                (project_id, platform, keyword, limit),
            )
            return cur.lastrowid


def finish_task(task_id, status, error, posts, comments):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE collection_tasks SET status=%s, error_message=%s, collected_posts=%s, collected_comments=%s, finished_at=NOW() WHERE id=%s",
                (status, error, posts, comments, task_id),
            )


def auth_state(platform):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM platform_auth_states WHERE platform=%s", (platform,))
            return cur.fetchone()


def auth_states():
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT platform, cookie_file, status, last_checked_at FROM platform_auth_states ORDER BY platform")
            return cur.fetchall()


def upsert_post(project_id, platform, post):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO social_posts(project_id, platform, external_id, url, author_name, title, content, keyword, engagement, raw_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE content=VALUES(content), engagement=VALUES(engagement), raw_json=VALUES(raw_json)
                """,
                (
                    project_id,
                    platform,
                    post["external_id"],
                    post.get("url"),
                    post.get("author_name"),
                    post.get("title"),
                    post["content"],
                    post["keyword"],
                    post.get("engagement", 0),
                    json.dumps(post.get("raw_json", {}), ensure_ascii=False),
                ),
            )
            cur.execute(
                "SELECT id FROM social_posts WHERE project_id=%s AND platform=%s AND external_id=%s",
                (project_id, platform, post["external_id"]),
            )
            return cur.fetchone()["id"]


def upsert_comment(project_id, post_id, platform, comment):
    external_id = comment.get("external_id") or f"{post_id}-{abs(hash(comment.get('content', '')))}"
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO social_comments(post_id, project_id, platform, external_id, author_name, content, like_count, raw_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE content=VALUES(content), like_count=VALUES(like_count), raw_json=VALUES(raw_json)
                """,
                (
                    post_id,
                    project_id,
                    platform,
                    external_id,
                    comment.get("author_name"),
                    comment.get("content", ""),
                    int(comment.get("like_count") or 0),
                    json.dumps(comment, ensure_ascii=False),
                ),
            )
            cur.execute(
                "SELECT id FROM social_comments WHERE project_id=%s AND platform=%s AND external_id=%s",
                (project_id, platform, external_id),
            )
            return cur.fetchone()["id"]


def upsert_sentiment(comment_id, analysis):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sentiment_results(comment_id, model, sentiment, score, confidence, topics, risks, evidence)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE sentiment=VALUES(sentiment), score=VALUES(score), confidence=VALUES(confidence), topics=VALUES(topics), risks=VALUES(risks), evidence=VALUES(evidence)
                """,
                (
                    comment_id,
                    analysis.get("model", "local-rules"),
                    analysis["sentiment"],
                    analysis["score"],
                    analysis.get("confidence", 0),
                    json.dumps(analysis.get("topics", []), ensure_ascii=False),
                    json.dumps(analysis.get("risks", []), ensure_ascii=False),
                    analysis.get("evidence", ""),
                ),
            )


def load_strategy(project_id):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM strategy_reports WHERE project_id=%s ORDER BY created_at DESC LIMIT 1", (project_id,))
            row = cur.fetchone()
            if not row:
                return None
            return {
                "headline": row["headline"],
                "summary": row["summary"],
                "plays": db.jloads(row["actions"], []),
                "evidence": db.jloads(row["evidence"], []),
            }


def build_strategy(items, project):
    negative = [item for item in items if item["sentimentLabel"] == "negative"]
    leading_source = max(count_by(items, "source").items(), key=lambda kv: kv[1])[0] if items else "微博"
    headline = "真实评论不足，先完成采集" if not items else "先修复官宣可信度，再放大演员合作声量"
    summary = (
        "当前没有真实评论入库，请先配置微博 Cookie 并运行微博发现任务。"
        if not items
        else f"当前样本主阵地为{leading_source}，负向评论 {len(negative)} 条。策略应围绕官宣可信度、演员合作与地域语言争议做微博回应。"
    )
    plays = [
        {"name": "微博", "steps": ["发布官方阵容确认信息", "把演员讨论导向角色关系与导演合作", "监控非官宣不信、溜粉、辟谣"], "metric": "负向率低于25%"},
    ]
    return {"headline": headline, "summary": summary, "plays": plays, "evidence": items[:3]}


def recent_agent_events(project_id):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT agent_name, status, error_message, started_at, finished_at
                FROM agent_runs
                WHERE project_id=%s OR project_id IS NULL
                ORDER BY started_at DESC
                LIMIT 20
                """,
                (project_id,),
            )
            runs = cur.fetchall()
            cur.execute(
                """
                SELECT platform, keyword, status, error_message, collected_comments, created_at
                FROM collection_tasks
                WHERE project_id=%s
                ORDER BY created_at DESC
                LIMIT 20
                """,
                (project_id,),
            )
            tasks = cur.fetchall()
    events = []
    for task in tasks:
        events.append({
            "type": "真实采集",
            "message": f"{PLATFORM_LABELS[task['platform']]} / {task['keyword']}：{task['status']}，评论 {task['collected_comments']} 条" + (f"，{task['error_message']}" if task.get("error_message") else ""),
            "at": task["created_at"].isoformat() if hasattr(task["created_at"], "isoformat") else str(task["created_at"]),
        })
    for run in runs:
        events.append({
            "type": run["agent_name"],
            "message": f"{run['status']}" + (f"，{run['error_message']}" if run.get("error_message") else ""),
            "at": run["started_at"].isoformat() if hasattr(run["started_at"], "isoformat") else str(run["started_at"]),
        })
    return events[:20]


def enterprise_agents(database, auth):
    auth_by_platform = {row["platform"]: row["status"] for row in auth}
    return [
        {"name": "真实采集 Agent", "status": "就绪" if database.get("connected") else "阻塞", "work": "只采集微博授权评论", "output": database.get("error") or "等待微博发现任务"},
        {"name": "清洗入库 Agent", "status": "就绪" if database.get("connected") else "阻塞", "work": "去重、字段标准化、写入 MySQL", "output": "MySQL 已连接" if database.get("connected") else "MySQL 未连接"},
        {"name": "DeepSeek 情感 Agent", "status": "就绪" if __import__("os").environ.get("DEEPSEEK_API_KEY") else "降级", "work": "逐评论情绪、风险、证据归因", "output": "deepseek-chat" if __import__("os").environ.get("DEEPSEEK_API_KEY") else "本地规则兜底"},
        {"name": "账号态 Agent", "status": "运行中", "work": "检查微博 Cookie 文件", "output": " / ".join([f"{p}:{auth_by_platform.get(p, 'missing')}" for p in PLATFORM_LABELS])},
    ]


def mediacrawler_health():
    home = Path(os.environ.get("MEDIACRAWLER_HOME", "")).expanduser()
    python = Path(os.environ.get("MEDIACRAWLER_PYTHON", "")).expanduser()
    output_dir = Path(os.environ.get("MEDIACRAWLER_OUTPUT_DIR", "storage/mediacrawler")).expanduser()
    commit = os.environ.get("MEDIACRAWLER_COMMIT", "")
    return {
        "home": file_check(home, "mediacrawler_missing", "MEDIACRAWLER_HOME does not point to an existing directory.", "Set MEDIACRAWLER_HOME to your local MediaCrawler checkout."),
        "commit": {"ok": bool(commit), "value": commit or None, "error": None if commit else weibo_error("mediacrawler_commit_missing", "MediaCrawler commit is not configured.", "MEDIACRAWLER_COMMIT is empty.", "Set MEDIACRAWLER_COMMIT to the verified MediaCrawler revision.")},
        "python": file_check(python, "mediacrawler_python_missing", "MEDIACRAWLER_PYTHON does not point to an executable file.", "Set MEDIACRAWLER_PYTHON to the Python executable used by MediaCrawler.", require_file=True),
        "output_dir": output_dir_check(output_dir),
    }


def file_check(path, error_type, cause, fix, require_file=False):
    ok = path.exists() and ((path.is_file() and os.access(path, os.X_OK)) if require_file else path.is_dir())
    return {
        "ok": ok,
        "path": str(path) if str(path) != "." else "",
        "error": None if ok else weibo_error(error_type, cause, cause, fix),
    }


def output_dir_check(path):
    try:
        path.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": str(path), "error": None}
    except Exception as exc:
        return {"ok": False, "path": str(path), "error": weibo_error("mediacrawler_output_unwritable", "MediaCrawler output directory is not writable.", str(exc), "Choose a writable MEDIACRAWLER_OUTPUT_DIR.")}


def cdp_health():
    port = int(os.environ.get("MEDIACRAWLER_CDP_PORT", "9222") or "9222")
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return {"ok": True, "host": "127.0.0.1", "port": port, "error": None}
    except Exception as exc:
        return {
            "ok": False,
            "host": "127.0.0.1",
            "port": port,
            "error": weibo_error("chrome_cdp_unavailable", "Chrome CDP is unavailable.", str(exc), "Start Chrome with remote debugging enabled and set MEDIACRAWLER_CDP_PORT."),
        }


def auth_status_from_cookie():
    cookie_file = Path(os.environ.get("WEIBO_COOKIE_FILE", "config/cookies/weibo.json"))
    return "configured" if cookie_file.exists() else "missing"


def normalize_auth_status(status):
    return status if status in {"missing", "configured", "invalid", "expired", "verification_required", "rate_limited", "unknown"} else "unknown"


def auth_error(status):
    if status == "configured":
        return None
    mapping = {
        "missing": ("auth_required", "Weibo auth cookie is missing.", "WEIBO_COOKIE_FILE does not point to an existing cookie file.", "Log in to Weibo and export cookies to the configured local cookie file."),
        "invalid": ("auth_invalid", "Weibo auth cookie is invalid.", "The stored cookie cannot authenticate Weibo requests.", "Refresh the Weibo cookie file from a valid browser session."),
        "expired": ("auth_expired", "Weibo auth cookie is expired.", "The stored cookie has expired.", "Refresh the Weibo cookie file from a valid browser session."),
        "verification_required": ("platform_verification_required", "Weibo requires account verification.", "The current Weibo session is blocked by a verification challenge.", "Complete verification in the browser before retrying."),
        "rate_limited": ("platform_rate_limited", "Weibo is rate limited.", "The account or IP is currently throttled by Weibo.", "Wait before retrying and reduce collection frequency."),
        "unknown": ("auth_unknown", "Weibo auth state is unknown.", "The system could not determine whether the cookie is usable.", "Run health again after checking the cookie file and browser session."),
    }
    error_type, message, cause, fix = mapping.get(status, mapping["unknown"])
    return weibo_error(error_type, message, cause, fix)


def weibo_error(error_type, message, cause, fix, docs_anchor=None):
    payload = {
        "ok": False,
        "mode": "weibo-agent-mvp",
        "error_type": error_type,
        "message": message,
        "cause": cause,
        "fix": fix,
    }
    if docs_anchor:
        payload["docs_anchor"] = docs_anchor
    return payload


def weibo_fixture_hello():
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "workbench": {
            "mode": "weibo-agent-mvp",
            "setup": {"source": "fixture", "platforms": ["weibo"]},
            "judgments": [],
            "recommendedTargets": [
                {
                    "targetId": "fixture-search-1",
                    "platform": "weibo",
                    "title": "海岛舒服日志 微博搜索 fixture",
                    "recommendationReason": "用于验证无真实登录状态下的 Weibo MVP workbench 入口。",
                    "confidence": 0.5,
                }
            ],
            "events": [],
            "pendingActions": [],
            "dataGaps": ["real_weibo_auth", "mediacrawler_runtime", "real_search_jsonl"],
            "citations": [],
        },
    }


def weibo_workbench_payload():
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload("GET /api/weibo/workbench", database)
    return {
        "mode": "weibo-agent-mvp",
        "setup": {
            "activePlatform": "weibo",
            "partialState": "no-data",
            "health": health_payload(),
        },
        "judgments": [],
        "recommendedTargets": [],
        "events": [],
        "pendingActions": [],
        "dataGaps": [
            {
                "code": "weibo_real_data_missing",
                "message": "No real Weibo targets, comments, events, or actions are available yet.",
                "nextAction": "Run Weibo discovery after MediaCrawler and Weibo auth are configured.",
            }
        ],
        "citations": [],
    }


def real_weibo_endpoint_payload(endpoint, payload_json="{}", **ids):
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        error = mysql_unavailable_payload(endpoint, database, **ids)
        return error
    error = weibo_error(
        "weibo_endpoint_pending_real_data_implementation",
        f"{endpoint} is reserved for the real Weibo MVP workflow.",
        "The explicit API and worker command exist, but this local slice has not implemented the MySQL-backed business operation yet.",
        "Complete the corresponding OpenSpec task before using this endpoint with real data.",
        docs_anchor="weibo-api-contract",
    )
    error.update({
        "endpoint": endpoint,
        "database": database,
        "payload_keys": sorted(payload.keys()),
        "request": {key: value for key, value in ids.items() if value is not None},
    })
    return error


def weibo_discovery_payload(payload_json="{}"):
    endpoint = "POST /api/weibo/discovery"
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload(endpoint, database)
    project = project_from_payload(payload)
    keyword = payload.get("keyword") or first_project_keyword(project)
    limit = int(payload.get("limit") or 10)
    fixture_path = payload.get("fixturePath")
    if fixture_path:
        fixture_path, fixture_error = resolve_fixture_path(fixture_path)
        if fixture_error:
            return fixture_error
    task_id = create_weibo_collection_task(
        project["id"],
        keyword,
        limit,
        "search",
        output_path=fixture_path,
        raw_files=[fixture_path] if fixture_path else [],
    )
    if not fixture_path:
        finish_weibo_collection_task(
            task_id,
            "failed",
            "mediacrawler_not_run",
            "Local persistence slice requires fixturePath and does not invoke real MediaCrawler.",
            parsed_records=0,
            failed_records=0,
            posts=0,
            comments=0,
        )
        return {
            **weibo_error(
                "mediacrawler_not_run",
                "Weibo discovery task was created but real MediaCrawler search was not invoked.",
                "This local slice only persists fixture search JSONL into MySQL.",
                "Pass fixturePath for local verification, or complete the real MediaCrawler search task later.",
                docs_anchor="weibo-discovery",
            ),
            "task": task_payload(task_id, "weibo", keyword, "search"),
            "database": database,
        }
    search = parse_weibo_search_fixture(fixture_path, limit)
    persisted_targets = persist_discovered_targets(project["id"], search["targets"])
    finish_weibo_collection_task(
        task_id,
        "succeeded",
        None,
        None,
        parsed_records=len(persisted_targets),
        failed_records=0,
        posts=len(persisted_targets),
        comments=0,
    )
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "database": database,
        "task": task_payload(task_id, "weibo", keyword, "search"),
        "targets": persisted_targets,
        "persisted_targets": len(persisted_targets),
    }


def weibo_targets_payload(payload_json="{}"):
    endpoint = "GET /api/weibo/targets"
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload(endpoint, database)
    project = project_from_payload(payload)
    status = payload.get("selectedStatus")
    with db.connect() as conn:
        with conn.cursor() as cur:
            if status:
                cur.execute(
                    """
                    SELECT *
                    FROM discovered_targets
                    WHERE project_id=%s AND selected_status=%s
                    ORDER BY selected_status='selected' DESC, `rank` IS NULL, `rank`, hot_score DESC, id DESC
                    """,
                    (project["id"], status),
                )
            else:
                cur.execute(
                    """
                    SELECT *
                    FROM discovered_targets
                    WHERE project_id=%s
                    ORDER BY selected_status='selected' DESC, `rank` IS NULL, `rank`, hot_score DESC, id DESC
                    """,
                    (project["id"],),
                )
            rows = cur.fetchall()
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "database": database,
        "targets": [target_row_to_payload(row) for row in rows],
    }


def weibo_target_state_payload(payload_json, selected_status):
    endpoint = "POST /api/weibo/targets/select" if selected_status == "selected" else "POST /api/weibo/targets/ignore"
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload(endpoint, database)
    project = project_from_payload(payload)
    target = find_discovered_target(project["id"], payload.get("targetId"))
    if not target:
        return weibo_error(
            "target_not_found",
            "Selected Weibo target was not found.",
            "The targetId does not match a persisted discovered target.",
            "Run discovery first and choose a target from GET /api/weibo/targets.",
            docs_anchor="weibo-targets",
        )
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE discovered_targets SET selected_status=%s WHERE id=%s",
                (selected_status, target["id"]),
            )
            cur.execute("SELECT * FROM discovered_targets WHERE id=%s", (target["id"],))
            updated = cur.fetchone()
    if selected_status == "selected":
        write_memory_item(
            project["id"],
            "target",
            updated["id"],
            updated.get("title") or "Weibo target selected",
            updated.get("summary") or "Selected Weibo target for detail monitoring.",
            [updated["id"]],
            {"selected_status": selected_status, "external_id": updated.get("external_id")},
            0.55,
        )
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "target": target_row_to_payload(updated),
    }


def weibo_source_account_upsert_payload(payload_json="{}"):
    endpoint = "POST /api/weibo/source-accounts"
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload(endpoint, database)
    project = project_from_payload(payload)
    source_type = payload.get("sourceType") or payload.get("source_type") or "unknown"
    if source_type not in {"official", "artist", "producer", "marketing", "suspected_matrix", "media", "fan", "organic", "unknown"}:
        return weibo_error(
            "invalid_source_type",
            "Weibo source account type is invalid.",
            "sourceType is not supported by the MVP source account enum.",
            "Use official, artist, producer, marketing, suspected_matrix, media, fan, organic, or unknown.",
            docs_anchor="weibo-source-accounts",
        )
    account = {
        "external_id": payload.get("externalId") or payload.get("external_id"),
        "profile_url": payload.get("profileUrl") or payload.get("profile_url"),
        "display_name": payload.get("displayName") or payload.get("display_name"),
        "source_type": source_type,
        "confirmed_by_user": bool(payload.get("confirmedByUser") or payload.get("confirmed_by_user")),
        "match_confidence": float(payload.get("matchConfidence") or payload.get("match_confidence") or 1),
    }
    if not account["display_name"]:
        return weibo_error(
            "source_account_display_name_required",
            "Weibo source account display name is required.",
            "The source account payload did not include displayName.",
            "Retry with displayName and a stable externalId or profileUrl when available.",
            docs_anchor="weibo-source-accounts",
        )
    account_ids = persist_source_accounts(project["id"], [account])
    account_id = account_ids["all_ids"][0]
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM source_accounts WHERE id=%s", (account_id,))
            row = cur.fetchone()
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "account": source_account_row_to_payload(row),
    }


def weibo_collect_target_payload(payload_json, target_id):
    endpoint = "POST /api/weibo/targets/:id/collect-comments"
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload(endpoint, database, target_id=target_id)
    project = project_from_payload(payload)
    target = find_discovered_target(project["id"], target_id)
    if not target:
        return weibo_error(
            "target_not_found",
            "Selected Weibo target was not found.",
            "The targetId does not match a persisted discovered target.",
            "Run discovery first and choose a target from GET /api/weibo/targets.",
            docs_anchor="weibo-targets",
        )
    if target["selected_status"] != "selected":
        return {
            **weibo_error(
                "target_not_selected",
                "Only selected Weibo targets can collect detail comments.",
                f"Target {target_id} is {target['selected_status']}.",
                "Select the target before running collect-comments.",
                docs_anchor="weibo-target-selection",
            ),
            "target_selected_state": target["selected_status"],
            "target": target_row_to_payload(target),
        }
    locator = db.jloads(target.get("target_locator"), {})
    locator_check = validate_weibo_target_locator(locator)
    keyword = target.get("keyword") or first_project_keyword(project)
    fixture_path = payload.get("fixturePath")
    if fixture_path:
        fixture_path, fixture_error = resolve_fixture_path(fixture_path)
        if fixture_error:
            return fixture_error
    task_id = create_weibo_collection_task(
        project["id"],
        keyword,
        int(payload.get("limit") or 0),
        "detail",
        target_id=target["id"],
        output_path=fixture_path,
        raw_files=[fixture_path] if fixture_path else [],
    )
    link_target_collection(target["id"], task_id)
    if not locator_check.get("ok"):
        finish_weibo_collection_task(
            task_id,
            "failed",
            locator_check.get("error_type", "target_detail_unsupported"),
            locator_check.get("message"),
            parsed_records=0,
            failed_records=1,
            posts=0,
            comments=0,
        )
        locator_check.update({"task": task_payload(task_id, "weibo", keyword, "detail", target["id"])})
        return locator_check
    if not fixture_path:
        finish_weibo_collection_task(
            task_id,
            "failed",
            "mediacrawler_not_run",
            "Local persistence slice requires fixturePath and does not invoke real MediaCrawler.",
            parsed_records=0,
            failed_records=0,
            posts=0,
            comments=0,
        )
        return {
            **weibo_error(
                "mediacrawler_not_run",
                "Weibo detail task was created but real MediaCrawler detail was not invoked.",
                "This local slice only persists fixture detail JSONL into MySQL.",
                "Pass fixturePath for local verification, or complete the real MediaCrawler detail task later.",
                docs_anchor="weibo-detail",
            ),
            "task": task_payload(task_id, "weibo", keyword, "detail", target["id"]),
        }
    detail = parse_weibo_detail_fixture(fixture_path, str(target["id"]), str(task_id))
    persisted_posts, post_ids_by_external = persist_detail_posts(project["id"], detail["posts"])
    persisted_comments = persist_detail_comments(project["id"], detail["comments"], post_ids_by_external)
    finish_weibo_collection_task(
        task_id,
        detail["status"],
        "adapter_parse_failed" if detail["failed_records"] else None,
        json.dumps(detail["errors"], ensure_ascii=False) if detail["errors"] else None,
        parsed_records=detail["parsed_records"],
        failed_records=detail["failed_records"],
        posts=persisted_posts,
        comments=persisted_comments,
    )
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "database": database,
        "status": detail["status"],
        "task": task_payload(task_id, "weibo", keyword, "detail", target["id"]),
        "target": target_row_to_payload(target),
        "parsed_records": detail["parsed_records"],
        "failed_records": detail["failed_records"],
        "persisted_posts": persisted_posts,
        "persisted_comments": persisted_comments,
        "errors": detail["errors"],
    }


def project_from_payload(payload):
    project = get_project(payload.get("projectId"))
    if project:
        return project
    return get_project(db.ensure_default_project())


def strict_project_from_payload(payload):
    if payload.get("projectId") is None:
        return project_from_payload(payload)
    return get_project(payload.get("projectId"))


def first_project_keyword(project):
    keywords = project.get("keywords") or db.DEFAULT_PROJECT["keywords"]
    return keywords[0] if keywords else db.DEFAULT_PROJECT["keywords"][0]


def resolve_fixture_path(fixture_path):
    if os.environ.get("WEIBO_FIXTURE_MODE") != "1":
        return None, weibo_error(
            "invalid_fixture_path",
            "Fixture paths are only accepted in explicit fixture mode.",
            "WEIBO_FIXTURE_MODE is not enabled for this worker process.",
            "Do not pass fixturePath through production HTTP APIs; use local fixture tests instead.",
            docs_anchor="weibo-fixtures",
        )
    root = Path.cwd().resolve()
    allowed_root = (root / "test" / "fixtures").resolve()
    candidate = (root / fixture_path).resolve()
    if not candidate.is_file() or allowed_root not in [candidate, *candidate.parents]:
        return None, weibo_error(
            "invalid_fixture_path",
            "Fixture path is outside the allowed test fixture directory.",
            f"{fixture_path} is not under test/fixtures.",
            "Use a fixture under test/fixtures for local persistence verification.",
            docs_anchor="weibo-fixtures",
        )
    return str(candidate), None


def create_weibo_collection_task(project_id, keyword, limit, crawler_type, target_id=None, output_path=None, raw_files=None):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO collection_tasks(
                  project_id, platform, keyword, status, requested_limit, started_at,
                  crawler_engine, crawler_type, output_path, raw_files, target_id
                )
                VALUES (%s,'weibo',%s,'running',%s,NOW(),%s,%s,%s,%s,%s)
                """,
                (
                    project_id,
                    keyword,
                    int(limit or 0),
                    "fixture" if output_path else "mediacrawler",
                    crawler_type,
                    output_path,
                    json.dumps(raw_files or [], ensure_ascii=False),
                    target_id,
                ),
            )
            return cur.lastrowid


def finish_weibo_collection_task(task_id, status, error_type, error_message, parsed_records, failed_records, posts, comments):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE collection_tasks
                SET status=%s, error_type=%s, error_message=%s, parsed_records=%s,
                    failed_records=%s, collected_posts=%s, collected_comments=%s, finished_at=NOW()
                WHERE id=%s
                """,
                (status, error_type, error_message, parsed_records, failed_records, posts, comments, task_id),
            )


def task_payload(task_id, platform, keyword, crawler_type, target_id=None):
    return {
        "id": task_id,
        "platform": platform,
        "keyword": keyword,
        "crawler_type": crawler_type,
        "target_id": target_id,
    }


def persist_discovered_targets(project_id, targets):
    persisted = []
    with db.connect() as conn:
        with conn.cursor() as cur:
            for target in targets:
                values = (
                    target["target_type"],
                    target.get("external_id"),
                    target.get("url"),
                    target.get("weibo_mid"),
                    target.get("author_external_id"),
                    target.get("author_url"),
                    target.get("title"),
                    target.get("summary"),
                    target.get("keyword") or "",
                    target.get("rank"),
                    target.get("hot_score") or 0,
                    json.dumps(target.get("target_locator", {}), ensure_ascii=False),
                    target.get("content_fingerprint"),
                    json.dumps(target.get("raw_json", {}), ensure_ascii=False),
                    json.dumps(target.get("recommendation_metadata", {}), ensure_ascii=False),
                    target.get("selected_status", "pending"),
                )
                cur.execute(
                    """
                    INSERT INTO discovered_targets(
                      project_id, platform, target_type, external_id, url, weibo_mid,
                      author_external_id, author_url, title, summary, keyword, `rank`,
                      hot_score, target_locator, content_fingerprint, raw_json,
                      recommendation_metadata, selected_status
                    )
                    VALUES (%s,'weibo',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                      id=LAST_INSERT_ID(id),
                      target_type=VALUES(target_type),
                      url=VALUES(url),
                      weibo_mid=VALUES(weibo_mid),
                      author_external_id=VALUES(author_external_id),
                      author_url=VALUES(author_url),
                      title=VALUES(title),
                      summary=VALUES(summary),
                      keyword=VALUES(keyword),
                      `rank`=VALUES(`rank`),
                      hot_score=VALUES(hot_score),
                      target_locator=VALUES(target_locator),
                      content_fingerprint=VALUES(content_fingerprint),
                      raw_json=VALUES(raw_json),
                      recommendation_metadata=VALUES(recommendation_metadata),
                      selected_status=IF(selected_status IN ('selected','ignored'), selected_status, VALUES(selected_status))
                    """,
                    (project_id, *values),
                )
                target_db_id = cur.lastrowid
                cur.execute("SELECT * FROM discovered_targets WHERE id=%s", (target_db_id,))
                persisted.append(target_row_to_payload(cur.fetchone()))
    return persisted


def find_discovered_target(project_id, target_id):
    if target_id is None:
        return None
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM discovered_targets
                WHERE project_id=%s AND (CAST(id AS CHAR)=%s OR external_id=%s)
                ORDER BY id
                LIMIT 1
                """,
                (project_id, str(target_id), str(target_id)),
            )
            return cur.fetchone()


def target_row_to_payload(row):
    return {
        "id": row["id"],
        "targetId": str(row["id"]),
        "platform": row["platform"],
        "target_type": row["target_type"],
        "external_id": row.get("external_id"),
        "url": row.get("url"),
        "weibo_mid": row.get("weibo_mid"),
        "author_external_id": row.get("author_external_id"),
        "author_url": row.get("author_url"),
        "title": row.get("title"),
        "summary": row.get("summary"),
        "keyword": row.get("keyword"),
        "rank": row.get("rank"),
        "hot_score": float(row.get("hot_score") or 0),
        "target_locator": db.jloads(row.get("target_locator"), {}),
        "content_fingerprint": row.get("content_fingerprint"),
        "raw_json": db.jloads(row.get("raw_json"), {}),
        "recommendation_metadata": db.jloads(row.get("recommendation_metadata"), {}),
        "selected_status": row.get("selected_status"),
    }


def link_target_collection(target_id, task_id):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT IGNORE INTO target_collection_links(target_id, collection_task_id, link_type)
                VALUES (%s,%s,'detail')
                """,
                (target_id, task_id),
            )


def persist_detail_posts(project_id, posts):
    post_ids_by_external = {}
    with db.connect() as conn:
        with conn.cursor() as cur:
            for post in posts:
                cur.execute(
                    """
                    INSERT INTO social_posts(
                      project_id, platform, external_id, url, author_name, title, content,
                      keyword, engagement, raw_json, source_account_external_id,
                      source_account_url, content_fingerprint
                    )
                    VALUES (%s,'weibo',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                      url=VALUES(url),
                      author_name=VALUES(author_name),
                      title=VALUES(title),
                      content=VALUES(content),
                      keyword=VALUES(keyword),
                      engagement=VALUES(engagement),
                      raw_json=VALUES(raw_json),
                      source_account_external_id=VALUES(source_account_external_id),
                      source_account_url=VALUES(source_account_url),
                      content_fingerprint=VALUES(content_fingerprint)
                    """,
                    (
                        project_id,
                        post["external_id"],
                        post.get("url"),
                        post.get("author_name"),
                        post.get("title"),
                        post.get("content") or "",
                        post.get("keyword") or "",
                        int(post.get("engagement") or 0),
                        json.dumps(post.get("raw_json", {}), ensure_ascii=False),
                        post.get("source_account_external_id"),
                        post.get("source_account_url"),
                        post.get("content_fingerprint"),
                    ),
                )
                cur.execute(
                    "SELECT id FROM social_posts WHERE project_id=%s AND platform='weibo' AND external_id=%s",
                    (project_id, post["external_id"]),
                )
                post_ids_by_external[post["external_id"]] = cur.fetchone()["id"]
    return len(post_ids_by_external), post_ids_by_external


def persist_detail_comments(project_id, comments, post_ids_by_external):
    persisted = 0
    with db.connect() as conn:
        with conn.cursor() as cur:
            for comment in comments:
                post_id = post_ids_by_external.get(comment.get("post_external_id"))
                if not post_id:
                    continue
                cur.execute(
                    """
                    INSERT INTO social_comments(
                      post_id, project_id, platform, external_id, author_name, content,
                      like_count, raw_json, source_account_external_id,
                      content_fingerprint, comment_weight, reply_count
                    )
                    VALUES (%s,%s,'weibo',%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                      post_id=VALUES(post_id),
                      content=VALUES(content),
                      like_count=VALUES(like_count),
                      raw_json=VALUES(raw_json),
                      source_account_external_id=VALUES(source_account_external_id),
                      content_fingerprint=VALUES(content_fingerprint),
                      comment_weight=VALUES(comment_weight),
                      reply_count=VALUES(reply_count)
                    """,
                    (
                        post_id,
                        project_id,
                        comment["external_id"],
                        comment.get("author_name"),
                        comment.get("content") or "",
                        int(comment.get("like_count") or 0),
                        json.dumps(comment.get("raw_json", {}), ensure_ascii=False),
                        comment.get("source_account_external_id"),
                        comment.get("content_fingerprint"),
                        float(comment.get("comment_weight") or 1),
                        int(comment.get("reply_count") or 0),
                    ),
                )
                persisted += 1
    return persisted


def weibo_actions_pending_payload(payload_json="{}"):
    endpoint = "GET /api/weibo/actions/pending"
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload(endpoint, database)
    project = strict_project_from_payload(payload)
    if not project:
        return weibo_error(
            "project_not_found",
            "Monitor project was not found.",
            "The request projectId does not match an existing monitor project.",
            "Refresh the project context and retry.",
            docs_anchor="weibo-project",
        )
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM publicity_actions
                WHERE project_id=%s AND confirmation_status='pending'
                ORDER BY priority DESC, created_at DESC, id DESC
                """,
                (project["id"],),
            )
            actions = cur.fetchall()
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "actions": [action_row_to_payload(action) for action in actions],
    }


def weibo_action_confirm_payload(payload_json, action_id):
    endpoint = "PATCH /api/weibo/actions/:id/confirmation"
    payload = json.loads(payload_json or "{}")
    database = db.health()
    if not database.get("connected"):
        return mysql_unavailable_payload(endpoint, database, action_id=action_id)
    status = payload.get("confirmationStatus") or payload.get("confirmation_status")
    if status not in {"confirmed", "rejected", "partial", "uncertain"}:
        return weibo_error(
            "invalid_confirmation_status",
            "Action confirmation status is invalid.",
            "confirmationStatus must be confirmed, rejected, partial, or uncertain.",
            "Retry with one of the supported confirmation statuses.",
            docs_anchor="weibo-action-confirmation",
        )
    effective_at = mysql_timestamp(payload.get("effectiveAt") or payload.get("effective_at"))
    project = strict_project_from_payload(payload)
    if not project:
        return weibo_error(
            "project_not_found",
            "Monitor project was not found.",
            "The request projectId does not match an existing monitor project.",
            "Refresh the project context and retry.",
            docs_anchor="weibo-project",
        )
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM publicity_actions WHERE id=%s AND project_id=%s", (action_id, project["id"]))
            before = cur.fetchone()
            if not before:
                return weibo_error(
                    "action_not_found",
                    "Weibo publicity action was not found.",
                    "The action id does not match a persisted action.",
                    "Refresh pending actions and retry.",
                    docs_anchor="weibo-action-confirmation",
                )
            cur.execute(
                """
                UPDATE publicity_actions
                SET confirmation_status=%s,
                    confirmed_at=NOW(),
                    effective_at=COALESCE(%s, effective_at)
                WHERE id=%s AND project_id=%s
                """,
                (status, effective_at, action_id, project["id"]),
            )
            cur.execute("SELECT * FROM publicity_actions WHERE id=%s AND project_id=%s", (action_id, project["id"]))
            updated = cur.fetchone()
    write_memory_item(
        updated["project_id"],
        "action",
        updated["id"],
        f"Weibo action {status}",
        updated.get("content_summary") or updated.get("reason") or "User updated a Weibo action confirmation.",
        [updated["id"]],
        {"from_status": before.get("confirmation_status"), "to_status": status},
        0.65,
    )
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "action": action_row_to_payload(updated),
    }


def action_row_to_payload(row):
    return {
        "id": row["id"],
        "platform": row["platform"],
        "related_event_id": row.get("related_event_id"),
        "related_target_id": row.get("related_target_id"),
        "source": row["source"],
        "confirmation_status": row["confirmation_status"],
        "action_type": row["action_type"],
        "content_summary": row.get("content_summary"),
        "reason": row.get("reason"),
        "evidence_ids": db.jloads(row.get("evidence_ids"), []),
        "priority": row.get("priority"),
        "confidence": float(row.get("confidence") or 0),
        "source_account_id": row.get("source_account_id"),
        "url": row.get("url"),
        "observed_at": iso_or_none(row.get("observed_at")),
        "confirmed_at": iso_or_none(row.get("confirmed_at")),
        "effective_at": iso_or_none(row.get("effective_at")),
        "recommended_check_after_at": iso_or_none(row.get("recommended_check_after_at")),
        "raw_json": db.jloads(row.get("raw_json"), {}),
    }


def source_account_row_to_payload(row):
    return {
        "id": row["id"],
        "platform": row["platform"],
        "external_id": row.get("external_id"),
        "profile_url": row.get("profile_url"),
        "display_name": row.get("display_name"),
        "source_type": row.get("source_type"),
        "match_confidence": float(row.get("match_confidence") or 0),
        "confirmed_by_user": bool(row.get("confirmed_by_user")),
        "raw_json": db.jloads(row.get("raw_json"), {}),
    }


def persist_analysis_payload(payload, project_id, comments_path):
    if not project_id:
        return
    persisted = 0
    with db.connect() as conn:
        with conn.cursor() as cur:
            for run in payload.get("agent_runs", []):
                status = run.get("status", "succeeded")
                error_message = run.get("error_type") or run.get("fallback_type")
                cur.execute(
                    """
                    INSERT INTO agent_runs(project_id, agent_name, status, input_json, output_json, error_message, finished_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        project_id,
                        run.get("agent_name", "DeepSeek Weibo Analysis"),
                        status,
                        json.dumps({"comments_path": comments_path}, ensure_ascii=False),
                        json.dumps(run, ensure_ascii=False),
                        error_message if status == "failed" else None,
                        None if status == "running" else datetime.utcnow(),
                    ),
                )
                persisted += 1
    write_memory_item(
        project_id,
        "analysis",
        None,
        "Weibo analysis fixture run",
        f"Persisted {len(payload.get('analyses', []))} Weibo analysis records with agent run lifecycle.",
        [item.get("comment_id") for item in payload.get("analyses", []) if item.get("comment_id")],
        {"deepseek": payload.get("deepseek"), "defaults": payload.get("defaults")},
        0.6,
    )
    payload["persisted_agent_runs"] = persisted


def persist_events(project_id, events):
    persisted = 0
    with db.connect() as conn:
        with conn.cursor() as cur:
            for event in events:
                title = event.get("title") or "Weibo observation"
                first_seen_at = mysql_timestamp(event.get("first_seen_at"))
                cur.execute(
                    """
                    SELECT id
                    FROM artist_public_opinion_events
                    WHERE project_id=%s AND platform='weibo' AND title=%s
                      AND (first_seen_at <=> %s)
                    ORDER BY id LIMIT 1
                    """,
                    (project_id, title, first_seen_at),
                )
                existing = cur.fetchone()
                values = (
                    event.get("event_type", "observation_lead"),
                    title,
                    event.get("trigger_summary") or "",
                    json.dumps(event.get("related_artists", []), ensure_ascii=False),
                    event.get("status", "observing"),
                    event.get("risk_level", "unknown"),
                    float(event.get("event_score") or 0),
                    json.dumps(event.get("evidence_ids", []), ensure_ascii=False),
                    json.dumps(event.get("timeline_json") or [], ensure_ascii=False),
                    event.get("impact_assessment"),
                    json.dumps(event.get("recommended_actions") or [], ensure_ascii=False),
                    first_seen_at,
                    mysql_timestamp(event.get("last_seen_at")),
                )
                if existing:
                    event_id = existing["id"]
                    cur.execute(
                        """
                        UPDATE artist_public_opinion_events
                        SET event_type=%s, title=%s, trigger_summary=%s,
                            related_artists=%s, status=%s, risk_level=%s,
                            event_score=%s, evidence_ids=%s, timeline_json=%s,
                            impact_assessment=%s, recommended_actions=%s,
                            first_seen_at=%s, last_seen_at=%s
                        WHERE id=%s
                        """,
                        (*values, event_id),
                    )
                    cur.execute("DELETE FROM event_evidence_links WHERE event_id=%s", (event_id,))
                    cur.execute("DELETE FROM event_status_history WHERE event_id=%s", (event_id,))
                else:
                    cur.execute(
                        """
                        INSERT INTO artist_public_opinion_events(
                          project_id, platform, event_type, title, trigger_summary,
                          related_artists, status, risk_level, event_score, evidence_ids,
                          timeline_json, impact_assessment, recommended_actions,
                          first_seen_at, last_seen_at
                        )
                        VALUES (%s,'weibo',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (project_id, *values),
                    )
                    event_id = cur.lastrowid
                persisted += 1
                for evidence_id in event.get("evidence_ids", []):
                    cur.execute(
                        """
                        INSERT IGNORE INTO event_evidence_links(event_id, evidence_type, evidence_id, weight)
                        VALUES (%s,'comment',%s,%s)
                        """,
                        (event_id, numeric_id(evidence_id), 1),
                    )
                for history in event.get("status_history", []):
                    cur.execute(
                        """
                        INSERT INTO event_status_history(event_id, from_status, to_status, reason)
                        VALUES (%s,%s,%s,%s)
                        """,
                        (
                            event_id,
                            history.get("from_status"),
                            history.get("to_status", event.get("status", "observing")),
                            history.get("reason"),
                        ),
                    )
                write_memory_item(
                    project_id,
                    "event",
                    event_id,
                    event.get("title") or "Weibo event",
                    event.get("trigger_summary") or "Persisted Weibo event from evidence.",
                    event.get("evidence_ids", []),
                    event,
                    0.75,
                )
    return persisted


def persist_source_accounts(project_id, accounts):
    by_external_id = {}
    by_display_name = {}
    all_ids = []
    with db.connect() as conn:
        with conn.cursor() as cur:
            for account in accounts:
                external_id = account.get("external_id")
                display_name = account.get("display_name") or external_id or "unknown"
                if external_id:
                    cur.execute(
                        "SELECT id FROM source_accounts WHERE project_id=%s AND platform='weibo' AND external_id=%s",
                        (project_id, external_id),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id
                        FROM source_accounts
                        WHERE project_id=%s AND platform='weibo' AND external_id IS NULL AND display_name=%s
                        ORDER BY id LIMIT 1
                        """,
                        (project_id, display_name),
                    )
                existing = cur.fetchone()
                values = (
                    project_id,
                    external_id,
                    account.get("profile_url"),
                    display_name,
                    account.get("source_type", "unknown"),
                    float(account.get("match_confidence") or (1 if account.get("confirmed_by_user") else 0.5)),
                    1 if account.get("confirmed_by_user") else 0,
                    json.dumps(account, ensure_ascii=False),
                )
                if existing:
                    account_id = existing["id"]
                    cur.execute(
                        """
                        UPDATE source_accounts
                        SET project_id=%s, external_id=%s, profile_url=%s, display_name=%s,
                            source_type=%s, match_confidence=%s, confirmed_by_user=%s, raw_json=%s
                        WHERE id=%s
                        """,
                        (*values, account_id),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO source_accounts(
                          project_id, platform, external_id, profile_url, display_name,
                          source_type, match_confidence, confirmed_by_user, raw_json
                        )
                        VALUES (%s,'weibo',%s,%s,%s,%s,%s,%s,%s)
                        """,
                        values,
                    )
                    account_id = cur.lastrowid
                all_ids.append(account_id)
                if external_id:
                    by_external_id[external_id] = account_id
                by_display_name[display_name] = account_id
    return {"by_external_id": by_external_id, "by_display_name": by_display_name, "all_ids": sorted(set(all_ids))}


def persist_publicity_actions(project_id, actions, account_ids):
    persisted = 0
    with db.connect() as conn:
        with conn.cursor() as cur:
            for action in actions:
                source_account_id = account_ids["by_external_id"].get(action.get("source_account_external_id"))
                related_event_id = int(action["related_event_id"]) if str(action.get("related_event_id") or "").isdigit() else None
                cur.execute(
                    """
                    INSERT INTO publicity_actions(
                      project_id, platform, related_event_id, related_target_id, source,
                      confirmation_status, action_type, content_summary, reason, evidence_ids,
                      priority, owner_suggestion, confidence, source_account_id, url,
                      observed_at, confirmed_at, effective_at, recommended_check_after_at, raw_json
                    )
                    VALUES (%s,'weibo',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        project_id,
                        related_event_id,
                        numeric_nullable(action.get("related_target_id")),
                        action.get("source"),
                        action.get("confirmation_status", "pending"),
                        action.get("action_type", "unknown"),
                        action.get("content_summary"),
                        action.get("reason"),
                        json.dumps(action.get("evidence_ids", []), ensure_ascii=False),
                        action.get("priority", "medium"),
                        action.get("owner_suggestion"),
                        float(action.get("confidence") or 0),
                        source_account_id,
                        action.get("url"),
                        mysql_timestamp(action.get("observed_at")),
                        mysql_timestamp(action.get("confirmed_at")),
                        mysql_timestamp(action.get("effective_at")),
                        mysql_timestamp(action.get("recommended_check_after_at")),
                        json.dumps(action, ensure_ascii=False),
                    ),
                )
                action_id = cur.lastrowid
                persisted += 1
                write_memory_item(
                    project_id,
                    "action",
                    action_id,
                    f"Weibo action: {action.get('action_type', 'unknown')}",
                    action.get("content_summary") or action.get("reason") or "Persisted Weibo publicity action.",
                    action.get("evidence_ids", []),
                    action,
                    0.7,
                )
    return persisted


def persist_memory_report(project_id, records, report, now):
    report_date = (now or datetime.utcnow().isoformat())[:10]
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO daily_reports(report_date, project_id, markdown_body, data_coverage, top_judgments, evidence_ids)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                  markdown_body=VALUES(markdown_body),
                  data_coverage=VALUES(data_coverage),
                  top_judgments=VALUES(top_judgments),
                  evidence_ids=VALUES(evidence_ids)
                """,
                (
                    report_date,
                    project_id,
                    report.get("markdown", ""),
                    json.dumps(report.get("dataCoverage", {}), ensure_ascii=False),
                    json.dumps(records.get("events", []), ensure_ascii=False),
                    json.dumps(report.get("evidence_ids", []), ensure_ascii=False),
                ),
            )
            cur.execute("SELECT id FROM daily_reports WHERE project_id=%s AND report_date=%s", (project_id, report_date))
            report_id = cur.fetchone()["id"]
    write_memory_item(
        project_id,
        "report",
        report_id,
        f"Weibo daily report {report_date}",
        report.get("markdown", "")[:500] or "Persisted Weibo daily report.",
        report.get("evidence_ids", []),
        {"dataCoverage": report.get("dataCoverage", {})},
        0.5,
    )
    persisted = 1
    for item in records.get("memory", []):
        write_memory_item(
            project_id,
            item.get("source_kind", "event") if item.get("source_kind") in {"target", "comment", "analysis", "event", "action", "backtest", "report", "preference", "conversation"} else "event",
            numeric_nullable(item.get("source_id")),
            item.get("title") or "Imported Weibo memory",
            item.get("summary") or "",
            item.get("evidence_ids", []),
            item,
            0.4,
        )
        persisted += 1
    return persisted


def write_memory_item(project_id, source_kind, source_id, title, summary, evidence_ids, memory_json, importance):
    if not project_id:
        return None
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bot_memory_items(
                  project_id, source_kind, source_id, title, summary,
                  evidence_ids, memory_json, importance
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    project_id,
                    source_kind,
                    numeric_nullable(source_id),
                    str(title or source_kind)[:240],
                    summary or "",
                    json.dumps(evidence_ids or [], ensure_ascii=False),
                    json.dumps(memory_json or {}, ensure_ascii=False, default=str),
                    float(importance or 0),
                ),
            )
            return cur.lastrowid


def numeric_nullable(value):
    if value is None:
        return None
    text = str(value)
    return int(text) if text.isdigit() else None


def numeric_id(value):
    numeric = numeric_nullable(value)
    if numeric is not None:
        return numeric
    return int(hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:15], 16)


def mysql_timestamp(value):
    if not value:
        return None
    return str(value).replace("T", " ").replace("Z", "")


def iso_or_none(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def mysql_unavailable_payload(endpoint, database, **ids):
    error = weibo_error(
        "mysql_unavailable",
        f"{endpoint} requires MySQL-backed real Weibo records.",
        database.get("error") or "MYSQL_URL is not configured or MySQL is unreachable.",
        "Set MYSQL_URL, run migrations, and retry the Weibo MVP endpoint.",
        docs_anchor="weibo-mysql",
    )
    error.update({
        "endpoint": endpoint,
        "database": database,
        "request": {key: value for key, value in ids.items() if value is not None},
    })
    return error


def weibo_fixture_e2e(now):
    migrations = [
        "migrations/002_weibo_mvp_ingestion.sql",
        "migrations/003_weibo_mvp_event_action.sql",
        "migrations/004_weibo_mvp_memory_report.sql",
        "migrations/005_weibo_mvp_sentiment.sql",
    ]
    migration_checked = [{"path": path, "exists": Path(path).exists()} for path in migrations]
    search = parse_weibo_search_fixture("test/fixtures/weibo-search.jsonl", 10)
    selected = next(
        target for target in search["targets"]
        if target["recommendation_metadata"]["state"] == "recommended"
    )
    detail = parse_weibo_detail_fixture("test/fixtures/weibo-detail.jsonl", selected["external_id"], "fixture-detail-task")
    analysis = analyze_weibo_comments_fixture("test/fixtures/weibo-comments-analysis.jsonl", now)
    events = build_weibo_events_fixture("test/fixtures/weibo-event-evidence.jsonl")
    event_id = events["events"][0]["issue_key"] if events["events"] else "fixture-event"
    actions = build_weibo_actions_fixture(
        "test/fixtures/weibo-source-accounts.json",
        "test/fixtures/weibo-action-posts.jsonl",
        event_id,
        now,
    )
    backtest = build_weibo_backtest_fixture("test/fixtures/weibo-backtest-scenarios.json")
    qa = build_weibo_memory_report_fixture("test/fixtures/weibo-memory-records.json", "为什么微博负面升高", now)
    workbench = fixture_workbench(search, events, actions, qa)
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "noExternalDependencies": True,
        "steps": [
            "migration_checked",
            "search_targets",
            "target_selected",
            "detail_comments",
            "analysis",
            "event_lead",
            "action_logged",
            "backtest",
            "qa_answer",
            "workbench",
        ],
        "migrationChecked": migration_checked,
        "search": search,
        "selectedTarget": selected,
        "detail": detail,
        "analysis": analysis,
        "events": events,
        "actions": actions,
        "backtest": backtest,
        "qa": qa,
        "workbench": workbench,
    }


def fixture_workbench(search, events, actions, qa):
    return {
        "mode": "weibo-agent-mvp",
        "setup": {"activePlatform": "weibo", "partialState": "fixture-e2e"},
        "judgments": [
            {"type": "fixture", "summary": "Fixture E2E produced traceable Weibo evidence without real external dependencies."}
        ],
        "recommendedTargets": [
            target for target in search["targets"]
            if target["recommendation_metadata"]["state"] == "recommended"
        ],
        "events": events["events"],
        "pendingActions": [
            action for action in actions["actions"]
            if action.get("confirmation_status") == "pending"
        ],
        "dataGaps": [
            {"code": "real_weibo_auth_missing", "message": "Fixture E2E did not use real Weibo auth."},
            {"code": "real_mediacrawler_not_run", "message": "Fixture E2E did not run MediaCrawler."},
        ],
        "citations": qa["answer"]["citations"],
    }


def parse_weibo_search_fixture(fixture_path, limit=10):
    records = []
    for line in Path(fixture_path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        records.append(json.loads(line))
    targets = [normalize_weibo_search_target(record) for record in records]
    targets.sort(key=lambda target: (-target["hot_score"], target["external_id"]))
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "targets": [
            {**target, "rank": index + 1}
            for index, target in enumerate(targets[: max(limit, 0)])
        ],
    }


def normalize_weibo_search_target(raw):
    text = raw.get("text") or raw.get("content") or raw.get("title") or ""
    external_id = str(raw.get("id") or raw.get("mid") or content_fingerprint(text))
    author_external_id = raw.get("author_id") or raw.get("user_id")
    target_locator = {
        "platform": "weibo",
        "target_type": "weibo_post",
        "external_id": external_id,
        "url": raw.get("url"),
        "weibo_mid": raw.get("mid"),
        "author_external_id": author_external_id,
        "author_url": raw.get("author_url"),
        "raw_json": raw,
    }
    recommendation = recommend_weibo_target(external_id, text, raw)
    return {
        "platform": "weibo",
        "target_type": "weibo_post",
        "external_id": external_id,
        "url": raw.get("url"),
        "weibo_mid": raw.get("mid"),
        "author_external_id": author_external_id,
        "author_url": raw.get("author_url"),
        "title": raw.get("title") or text[:80],
        "summary": text[:200],
        "keyword": raw.get("keyword") or "",
        "hot_score": hot_score(text, raw),
        "target_locator": target_locator,
        "content_fingerprint": content_fingerprint(text),
        "raw_json": raw,
        "recommendation_metadata": recommendation,
        "selected_status": "pending",
    }


def hot_score(text, raw):
    likes = int(raw.get("attitudes_count") or raw.get("likes") or 0)
    comments = int(raw.get("comments_count") or raw.get("comments") or 0)
    reposts = int(raw.get("reposts_count") or raw.get("reposts") or 0)
    return likes + comments * 2 + reposts * 3


def recommend_weibo_target(external_id, text, raw):
    terms = project_relevance_terms(text)
    if not terms:
        return {
            "state": "not_recommended",
            "target_id": external_id,
            "reason": "未命中《海岛舒服日志》、刘昊然或李兰迪等 MVP 项目范围。",
            "expected_question_answered": "该目标暂不能回答项目相关舆情问题。",
            "confidence": 0.2,
        }
    likes = int(raw.get("attitudes_count") or raw.get("likes") or 0)
    comments = int(raw.get("comments_count") or 0)
    confidence = min(0.95, 0.45 + len(terms) * 0.12 + min(likes + comments, 120) / 400)
    return {
        "state": "recommended",
        "target_id": external_id,
        "reason": "命中" + "、".join(terms) + "，且具备可观察互动。",
        "expected_question_answered": "该目标可用于判断微博讨论中演员、官宣节奏或项目可信度的主要反馈。",
        "confidence": round(confidence, 4),
    }


def project_relevance_terms(text):
    return [term for term in ["海岛舒服日志", "刘昊然", "李兰迪"] if term in text]


def content_fingerprint(text):
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:32]


def validate_weibo_target_locator(locator):
    if locator.get("platform") != "weibo":
        return unsupported_target_locator(locator, "Target locator platform must be weibo.")
    detail_id = locator.get("weibo_mid") or status_id_from_weibo_url(locator.get("url"))
    if not detail_id:
        return unsupported_target_locator(locator, "Selected target cannot be resolved for MediaCrawler detail collection.")
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "detail_locator": {
            "platform": "weibo",
            "crawler_type": "detail",
            "external_id": locator.get("external_id"),
            "url": locator.get("url"),
            "weibo_mid": detail_id,
            "author_external_id": locator.get("author_external_id"),
            "author_url": locator.get("author_url"),
        },
    }


def unsupported_target_locator(locator, cause):
    return {
        **weibo_error(
            "target_detail_unsupported",
            "Selected Weibo target is not compatible with MediaCrawler detail collection.",
            cause,
            "Select a target with a weibo_mid, status external_id, or detail URL before collecting comments.",
            docs_anchor="weibo-target-locator",
        ),
        "target_selected_state": "selected",
        "preserved_locator": locator,
    }


def status_id_from_weibo_url(url):
    if not url or "/status/" not in url:
        return None
    return url.rstrip("/").split("/status/")[-1].split("?")[0] or None


def parse_weibo_detail_fixture(fixture_path, target_id, task_id):
    posts = {}
    comments = {}
    errors = []
    parsed = 0
    for line_number, line in enumerate(Path(fixture_path).read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
            post = raw.get("post") if isinstance(raw, dict) else None
            raw_comments = raw.get("comments") if isinstance(raw, dict) else None
            if not isinstance(post, dict) or not isinstance(raw_comments, list):
                raise ValueError("detail row must contain post object and comments array")
            normalized_post = normalize_weibo_detail_post(raw)
            posts[normalized_post["external_id"]] = {**posts.get(normalized_post["external_id"], {}), **normalized_post}
            for comment in raw_comments:
                normalized_comment = normalize_weibo_detail_comment(normalized_post["external_id"], comment)
                comments[normalized_comment["external_id"]] = {**comments.get(normalized_comment["external_id"], {}), **normalized_comment}
            parsed += 1
        except Exception as exc:
            errors.append({
                "line": line_number,
                "error_type": "adapter_parse_failed",
                "message": str(exc),
            })
    failed = len(errors)
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "status": "partial" if failed and parsed else ("failed" if failed else "succeeded"),
        "parsed_records": parsed,
        "failed_records": failed,
        "posts": list(posts.values()),
        "comments": list(comments.values()),
        "errors": errors,
        "target_collection_link": {
            "target_id": str(target_id),
            "collection_task_id": str(task_id),
            "link_type": "detail",
        },
    }


def normalize_weibo_detail_post(raw):
    post = raw["post"]
    text = post.get("text") or post.get("content") or ""
    return {
        "platform": "weibo",
        "external_id": str(post.get("id") or post.get("mid") or content_fingerprint(text)),
        "weibo_mid": post.get("mid"),
        "url": post.get("url"),
        "author_name": post.get("screen_name") or post.get("author"),
        "source_account_external_id": post.get("author_id") or post.get("user_id"),
        "source_account_url": post.get("author_url"),
        "title": post.get("title") or text[:80],
        "content": text,
        "keyword": post.get("keyword") or "",
        "engagement": int(post.get("attitudes_count") or post.get("likes") or 0),
        "content_fingerprint": content_fingerprint(text),
        "raw_json": raw,
    }


def normalize_weibo_detail_comment(post_external_id, comment):
    if not isinstance(comment, dict):
        raise ValueError("comment must be an object")
    text = comment.get("text") or comment.get("content") or ""
    external_id = str(comment.get("id") or content_fingerprint(post_external_id + text))
    like_count = int(comment.get("like_count") or comment.get("likes") or 0)
    reply_count = int(comment.get("reply_count") or 0)
    return {
        "platform": "weibo",
        "post_external_id": post_external_id,
        "external_id": external_id,
        "author_name": comment.get("screen_name") or comment.get("author"),
        "source_account_external_id": comment.get("user_id") or comment.get("author_id"),
        "content": text,
        "like_count": like_count,
        "reply_count": reply_count,
        "comment_weight": comment_weight(like_count, reply_count),
        "content_fingerprint": content_fingerprint(text),
        "raw_json": comment,
    }


def comment_weight(like_count, reply_count, author_verified=False, collected_at=None, now=None):
    base = 1 + min(like_count, 100) / 20 + min(reply_count, 50) / 10
    verified_bonus = 0.5 if author_verified else 0
    recency_bonus = recency_weight(collected_at, now)
    return round(base + verified_bonus + recency_bonus, 4)


def recency_weight(collected_at, now):
    if not collected_at or not now:
        return 0
    try:
        collected = datetime.fromisoformat(str(collected_at).replace("Z", "+00:00"))
        current = datetime.fromisoformat(str(now).replace("Z", "+00:00"))
        age_hours = max((current - collected).total_seconds() / 3600, 0)
    except Exception:
        return 0
    if age_hours <= 6:
        return 0.5
    if age_hours <= 24:
        return 0.25
    if age_hours <= 72:
        return 0.1
    return 0


def analyze_weibo_comments_fixture(fixture_path, now):
    analyses = []
    for line in Path(fixture_path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        comment = json.loads(line)
        analyses.append(analyze_weibo_comment_record(comment, now))
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "analyses": analyses,
    }


def analyze_weibo_comment_record(comment, now):
    content = comment.get("text") or comment.get("content") or ""
    base = analyze_comment(content)
    risks = base.get("risks") or []
    weight = comment_weight(
        int(comment.get("like_count") or 0),
        int(comment.get("reply_count") or 0),
        bool(comment.get("author_verified")),
        comment.get("collected_at"),
        now,
    )
    result = {
        "comment_id": str(comment.get("id") or content_fingerprint(content)),
        "sentiment": base.get("sentiment", "neutral"),
        "score": float(base.get("score") or 0),
        "confidence": float(base.get("confidence") or 0),
        "topics": base.get("topics") or [],
        "risks": risks,
        "stance": infer_stance(content, base.get("sentiment"), risks),
        "issue_summary": issue_summary(content, risks),
        "intensity": round(min(1, abs(float(base.get("score") or 0)) + min(weight, 10) / 20), 4),
        "weight": weight,
        "evidence": base.get("evidence") or content[:240],
        "model": base.get("model", "local-rules"),
        "fallback_type": "local_rules" if base.get("model") == "local-rules" else "none",
        "analyzed_at": now,
    }
    result["analysis_json"] = {
        "source": "fixture",
        "deterministic_weight_inputs": {
            "like_count": int(comment.get("like_count") or 0),
            "reply_count": int(comment.get("reply_count") or 0),
            "author_verified": bool(comment.get("author_verified")),
            "collected_at": comment.get("collected_at"),
        },
    }
    return result


def infer_stance(content, sentiment, risks):
    if risks or any(term in content for term in ["担心", "质疑", "非官宣", "溜粉", "控评"]):
        return "questioning"
    if sentiment == "positive":
        return "supportive"
    if sentiment == "negative":
        return "opposed"
    return "neutral"


def issue_summary(content, risks):
    if risks:
        return "、".join(risks)
    if "刘昊然" in content or "李兰迪" in content:
        return "演员讨论"
    if "海岛舒服日志" in content:
        return "项目声量"
    return "综合讨论"


def run_deepseek_fixture(comments_path, now, response_path=None, simulate_failure=None, persist_project_id=None):
    comments = load_jsonl(comments_path)
    defaults = {"batch_size": 20, "timeout_seconds": 60, "retries": 1}
    if simulate_failure:
        payload = {
            "ok": True,
            "mode": "weibo-agent-mvp",
            "fixture": True,
            "defaults": defaults,
            "deepseek": {
                "status": "failed",
                "error_type": "deepseek_failed",
                "message": f"Simulated DeepSeek failure: {simulate_failure}",
            },
            "raw_comments": comments,
            "analyses": [analyze_weibo_comment_record(comment, now) for comment in comments],
            "agent_runs": [
                {"agent_name": "DeepSeek Weibo Analysis", "status": "running"},
                {"agent_name": "DeepSeek Weibo Analysis", "status": "failed", "error_type": "deepseek_failed"},
                {"agent_name": "DeepSeek Weibo Analysis", "status": "failed", "error_type": "retry_exhausted", "retries": defaults["retries"]},
                {"agent_name": "DeepSeek Weibo Analysis", "status": "succeeded", "fallback_type": "local_rules"},
            ],
        }
        persist_analysis_payload(payload, persist_project_id, comments_path)
        return payload
    response_items = parse_deepseek_response(Path(response_path).read_text(encoding="utf-8"))
    response_by_id = {str(item.get("comment_id")): item for item in response_items}
    analyses = [
        analysis_from_deepseek(comment, response_by_id.get(str(comment.get("id")), {}), now)
        for comment in comments
    ]
    payload = {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "defaults": defaults,
        "deepseek": {"status": "succeeded"},
        "raw_comments": comments,
        "analyses": analyses,
        "agent_runs": [
            {"agent_name": "DeepSeek Weibo Analysis", "status": "running"},
            {"agent_name": "DeepSeek Weibo Analysis", "status": "succeeded"},
        ],
    }
    persist_analysis_payload(payload, persist_project_id, comments_path)
    return payload


def load_jsonl(path):
    return [
        json.loads(line)
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def parse_deepseek_response(text):
    stripped = text.strip()
    if stripped.startswith("```json"):
        stripped = stripped.removeprefix("```json").strip()
    if stripped.endswith("```"):
        stripped = stripped.removesuffix("```").strip()
    parsed = json.loads(stripped)
    return parsed if isinstance(parsed, list) else [parsed]


def analysis_from_deepseek(comment, model_item, now):
    content = comment.get("text") or comment.get("content") or ""
    fallback = analyze_weibo_comment_record(comment, now)
    like_count = int(comment.get("like_count") or 0)
    reply_count = int(comment.get("reply_count") or 0)
    ignored = {
        key: model_item.get(key)
        for key in ["weight", "event_score", "backtest_signal"]
        if key in model_item
    }
    return {
        "comment_id": str(comment.get("id") or content_fingerprint(content)),
        "sentiment": model_item.get("sentiment", fallback["sentiment"]),
        "score": float(model_item.get("score", fallback["score"])),
        "confidence": float(model_item.get("confidence", fallback["confidence"])),
        "topics": model_item.get("topics") or fallback["topics"],
        "risks": model_item.get("risks") or fallback["risks"],
        "stance": model_item.get("stance") or fallback["stance"],
        "issue_summary": model_item.get("issue_summary") or fallback["issue_summary"],
        "intensity": float(model_item.get("intensity", fallback["intensity"])),
        "weight": comment_weight(like_count, reply_count, bool(comment.get("author_verified")), comment.get("collected_at"), now),
        "evidence": model_item.get("evidence") or fallback["evidence"],
        "model": "deepseek-chat",
        "fallback_type": "none",
        "analyzed_at": now,
        "analysis_json": {
            "source": "deepseek_fixture",
            "ignored_model_numbers": ignored,
        },
    }


def build_weibo_events_fixture(fixture_path, persist_project_id=None):
    evidence = load_jsonl(fixture_path)
    if not evidence:
        return {"ok": True, "mode": "weibo-agent-mvp", "fixture": True, "events": [], "data_gap": "no_evidence"}
    grouped = {}
    for item in evidence:
        for issue in recall_issue_keys(item):
            grouped.setdefault(issue, []).append(item)
    events = []
    for issue_key, items in grouped.items():
        for cluster in merge_evidence_window(items):
            events.append(build_event_from_evidence(issue_key, cluster))
    payload = {"ok": True, "mode": "weibo-agent-mvp", "fixture": True, "events": events}
    if persist_project_id:
        payload["persisted_events"] = persist_events(persist_project_id, events)
    return payload


def recall_issue_keys(item):
    risks = item.get("risks") or []
    if risks:
        return risks
    topics = item.get("topics") or []
    return topics or ["综合声量"]


def merge_evidence_window(items):
    sorted_items = sorted(items, key=lambda item: item.get("created_at") or "")
    clusters = []
    current = []
    current_start = None
    for item in sorted_items:
        seen_at = parse_time(item.get("created_at"))
        if not current:
            current = [item]
            current_start = seen_at
            continue
        if current_start and seen_at and (seen_at - current_start).total_seconds() <= 72 * 3600:
            current.append(item)
        else:
            clusters.append(current)
            current = [item]
            current_start = seen_at
    if current:
        clusters.append(current)
    return clusters


def build_event_from_evidence(issue_key, evidence_items):
    evidence_ids = [str(item.get("comment_id") or item.get("id")) for item in evidence_items]
    score = event_score(evidence_items)
    event_type = "formal_event" if len(evidence_items) >= 3 and score >= 8 else "observation_lead"
    status = event_status(event_type, score, evidence_items)
    risk_level = event_risk_level(score, evidence_items)
    first_seen = min([item.get("created_at") for item in evidence_items if item.get("created_at")] or [None])
    last_seen = max([item.get("created_at") for item in evidence_items if item.get("created_at")] or [None])
    return {
        "issue_key": issue_key,
        "platform": "weibo",
        "event_type": event_type,
        "title": f"微博{issue_key}观察",
        "trigger_summary": f"{len(evidence_items)} 条微博证据触发 {issue_key}",
        "related_artists": sorted(related_artists(evidence_items)),
        "status": status,
        "risk_level": risk_level,
        "event_score": score,
        "evidence_ids": evidence_ids,
        "first_seen_at": first_seen,
        "last_seen_at": last_seen,
        "status_history": [
            {"from_status": None, "to_status": "observing", "reason": "evidence_created"},
            {"from_status": "observing", "to_status": status, "reason": "deterministic_threshold"},
        ],
    }


def event_score(evidence_items):
    weight_sum = sum(float(item.get("weight") or 1) for item in evidence_items)
    negative_count = sum(1 for item in evidence_items if item.get("sentiment") == "negative")
    questioning_count = sum(1 for item in evidence_items if item.get("stance") == "questioning")
    return round(weight_sum + negative_count + questioning_count * 0.5, 4)


def event_status(event_type, score, evidence_items):
    if event_type == "observation_lead":
        return "observing"
    if score >= 8 and any(item.get("sentiment") == "negative" for item in evidence_items):
        return "escalating"
    return "stable"


def event_risk_level(score, evidence_items):
    if not any(item.get("risks") for item in evidence_items):
        return "low"
    if score >= 8:
        return "high"
    if score >= 4:
        return "medium"
    return "low"


def related_artists(evidence_items):
    artists = set()
    for item in evidence_items:
        content = item.get("content") or ""
        for artist in ["刘昊然", "李兰迪"]:
            if artist in content:
                artists.add(artist)
    return artists


def parse_time(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def build_weibo_actions_fixture(accounts_path, posts_path, event_id, now, persist_project_id=None):
    accounts = json.loads(Path(accounts_path).read_text(encoding="utf-8"))
    posts = [normalize_action_post(post, accounts) for post in load_jsonl(posts_path)]
    actions = []
    for post in posts:
        if post["source_type"] == "official" and is_project_related(post["content"]):
            actions.append(official_observed_action(post))
    matrix = matrix_action(posts)
    if matrix:
        actions.append(matrix)
    actions.append(agent_recommended_action(event_id, now))
    actions.append(user_confirmed_action(event_id, actions[0] if actions else None, now))
    payload = {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "posts": posts,
        "actions": actions,
    }
    if persist_project_id:
        account_ids = persist_source_accounts(persist_project_id, accounts)
        payload["persisted_source_accounts"] = len(account_ids["all_ids"])
        payload["persisted_actions"] = persist_publicity_actions(persist_project_id, actions, account_ids)
    return payload


def normalize_action_post(raw, accounts):
    text = raw.get("text") or raw.get("content") or ""
    match = match_source_account(raw, accounts)
    return {
        "platform": "weibo",
        "external_id": str(raw.get("id")),
        "author_external_id": raw.get("author_id"),
        "author_name": raw.get("author_name"),
        "url": raw.get("url"),
        "content": text,
        "published_at": raw.get("published_at"),
        "source_type": match["source_type"],
        "source_match_method": match["method"],
        "source_match_confidence": match["confidence"],
        "source_account_external_id": match.get("external_id"),
        "content_fingerprint": content_fingerprint(text),
        "raw_json": raw,
    }


def match_source_account(raw, accounts):
    author_id = raw.get("author_id")
    author_url = raw.get("author_url")
    author_name = raw.get("author_name")
    for account in accounts:
        if author_id and account.get("external_id") == author_id:
            return {**account, "method": "stable_id", "confidence": 1}
        if author_url and account.get("profile_url") == author_url:
            return {**account, "method": "stable_url", "confidence": 0.95}
    for account in accounts:
        if author_name and account.get("display_name") == author_name:
            return {**account, "method": "display_name", "confidence": 0.55}
    return {"source_type": "unknown", "method": "unknown", "confidence": 0.2}


def official_observed_action(post):
    return {
        "id": f"official-{post['external_id']}",
        "source": "official_observed",
        "platform": "weibo",
        "confirmation_status": "pending",
        "action_type": "official_post",
        "source_account_external_id": post.get("author_external_id"),
        "url": post.get("url"),
        "content_summary": post["content"][:160],
        "observed_at": post.get("published_at"),
        "confirmed_at": None,
        "effective_at": post.get("published_at"),
        "evidence_ids": [post["external_id"]],
    }


def matrix_action(posts):
    buckets = {}
    for post in posts:
        if not is_project_related(post["content"]):
            continue
        buckets.setdefault(post["content_fingerprint"], []).append(post)
    candidates = [items for items in buckets.values() if len(items) >= 3]
    if not candidates:
        return None
    items = sorted(candidates, key=len, reverse=True)[0]
    return {
        "id": "matrix-" + items[0]["content_fingerprint"][:10],
        "source": "matrix_inferred",
        "platform": "weibo",
        "confirmation_status": "pending",
        "action_type": "suspected_matrix_posting",
        "confidence": min(0.95, 0.4 + len(items) * 0.15),
        "related_post_ids": [item["external_id"] for item in items],
        "observed_at": min(item.get("published_at") for item in items),
        "confirmed_at": None,
        "effective_at": min(item.get("published_at") for item in items),
        "evidence_ids": [item["external_id"] for item in items],
    }


def agent_recommended_action(event_id, now):
    return {
        "id": f"agent-{event_id}",
        "source": "agent_recommended",
        "platform": "weibo",
        "related_event_id": event_id,
        "confirmation_status": "pending",
        "action_type": "clarify_official_announcement",
        "reason": "事件证据提示需要澄清官宣节奏。",
        "evidence_ids": [event_id],
        "observed_at": None,
        "confirmed_at": None,
        "effective_at": None,
        "recommended_check_after_at": now,
        "confidence": 0.7,
    }


def user_confirmed_action(event_id, observed_action, now):
    effective_at = observed_action.get("effective_at") if observed_action else now
    return {
        "id": f"user-confirmed-{event_id}",
        "source": "user_confirmed",
        "platform": "weibo",
        "related_event_id": event_id,
        "confirmation_status": "confirmed",
        "action_type": "confirmed_publicity_action",
        "evidence_ids": [event_id],
        "observed_at": observed_action.get("observed_at") if observed_action else None,
        "confirmed_at": now,
        "effective_at": effective_at,
    }


def is_project_related(text):
    return any(term in (text or "") for term in ["海岛舒服日志", "刘昊然", "李兰迪"])


def build_weibo_backtest_fixture(fixture_path):
    scenarios = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    return {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "results": [backtest_scenario(scenario) for scenario in scenarios],
    }


def backtest_scenario(scenario):
    missing = backtest_missing_reason(scenario)
    if missing:
        return {
            "scenario_id": scenario.get("id"),
            "action_id": (scenario.get("action") or {}).get("id"),
            "eligible": False,
            "result": "unknown",
            "signal_level": "unknown",
            "attribution_confidence": 0,
            "metric_changes": {},
            "confounders": [],
            "next_recommendation": "Collect pre/post Weibo evidence windows before interpreting action effect.",
            "missing_data_reason": missing,
        }
    baseline = scenario["baseline"]
    window_name, post = preferred_post_window(scenario["post"])
    negative_delta = round(post["negative_rate"] - baseline["negative_rate"], 4)
    sentiment_delta = round(post["avg_sentiment"] - baseline["avg_sentiment"], 4)
    result = classify_backtest_signal(negative_delta, sentiment_delta)
    return {
        "scenario_id": scenario.get("id"),
        "action_id": scenario["action"]["id"],
        "eligible": True,
        "result": result,
        "signal_level": result.replace("no_signal", "none"),
        "attribution_confidence": attribution_confidence(negative_delta, sentiment_delta, baseline, post),
        "baseline_window": baseline,
        "post_window": {"name": window_name, **post},
        "metric_changes": {
            "negative_rate_delta": negative_delta,
            "avg_sentiment_delta": sentiment_delta,
            "mentions_delta": int(post.get("mentions", 0)) - int(baseline.get("mentions", 0)),
        },
        "confounders": backtest_confounders(baseline, post),
        "next_recommendation": next_backtest_recommendation(result),
        "missing_data_reason": None,
    }


def backtest_missing_reason(scenario):
    action = scenario.get("action") or {}
    missing = []
    if action.get("confirmation_status") not in {"confirmed", "observed"}:
        missing.append("confirmed action")
    if not action.get("effective_at"):
        missing.append("effective_at")
    if not action.get("related_event_id") and not action.get("related_target_id"):
        missing.append("related event or target")
    if not scenario.get("baseline"):
        missing.append("baseline window")
    if not scenario.get("post"):
        missing.append("post window")
    return ", ".join(missing)


def preferred_post_window(post_windows):
    for name in ["72h", "48h", "24h", "6h"]:
        if name in post_windows:
            return name, post_windows[name]
    name = sorted(post_windows.keys())[0]
    return name, post_windows[name]


def classify_backtest_signal(negative_delta, sentiment_delta):
    if negative_delta >= 0.1 and sentiment_delta <= -0.15:
        return "negative"
    if negative_delta <= -0.25 and sentiment_delta >= 0.4:
        return "strong"
    if negative_delta <= -0.1 and sentiment_delta >= 0.2:
        return "medium"
    if negative_delta <= -0.05 or sentiment_delta >= 0.07:
        return "weak"
    return "no_signal"


def attribution_confidence(negative_delta, sentiment_delta, baseline, post):
    sample_factor = min(0.3, (int(baseline.get("mentions", 0)) + int(post.get("mentions", 0))) / 1000)
    change_factor = min(0.6, abs(negative_delta) + abs(sentiment_delta))
    return round(min(0.9, 0.1 + sample_factor + change_factor), 4)


def backtest_confounders(baseline, post):
    baseline_mentions = max(int(baseline.get("mentions", 0)), 1)
    post_mentions = int(post.get("mentions", 0))
    if post_mentions > baseline_mentions * 1.5:
        return ["post_action_volume_spike"]
    return []


def next_backtest_recommendation(result):
    if result in {"strong", "medium"}:
        return "continue the action pattern and monitor the next Weibo window"
    if result == "weak":
        return "monitor more evidence before scaling the action"
    if result == "negative":
        return "pause similar action and inspect confounders before repeating"
    return "monitor more windows before changing strategy"


def build_weibo_memory_report_fixture(fixture_path, question, now, persist_project_id=None):
    records = load_memory_fixture(fixture_path)
    answer = answer_weibo_question(records, question)
    payload = {
        "ok": True,
        "mode": "weibo-agent-mvp",
        "fixture": True,
        "answer": answer,
        "dailyReport": daily_report(records, now),
    }
    if persist_project_id:
        payload["persisted_memory_items"] = persist_memory_report(persist_project_id, records, payload["dailyReport"], now)
    return payload


def load_memory_fixture(path):
    text = Path(path).read_text(encoding="utf-8").strip()
    if not text:
        return {"targets": [], "comments": [], "events": [], "actions": [], "backtests": [], "memory": []}
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return {
                "targets": parsed.get("targets", []),
                "comments": parsed.get("comments", []),
                "events": parsed.get("events", []),
                "actions": parsed.get("actions", []),
                "backtests": parsed.get("backtests", []),
                "memory": parsed.get("memory", []),
            }
    except Exception:
        pass
    return {"targets": [], "comments": [], "events": [], "actions": [], "backtests": [], "memory": []}


def answer_weibo_question(records, question):
    citations = []
    if not any(records.values()):
        return {
            "text": "Current real Weibo evidence is insufficient to answer this question.",
            "citations": [],
            "error": standard_answer_error("insufficient_evidence", "No stored Weibo evidence is available.", "Run Weibo discovery and analysis first."),
        }
    if any(term in question for term in ["行动", "有效", "效果", "backtest"]):
        if not records.get("backtests"):
            citations = [action["id"] for action in records.get("actions", []) if action.get("id")]
            return {
                "text": "There is no confirmed action/backtest yet, so action effect evidence is insufficient.",
                "citations": citations,
                "error": standard_answer_error("insufficient_backtest_data", "No confirmed action backtest exists.", "Confirm/log an action and collect post-action windows."),
            }
    events = records.get("events", [])
    comments = records.get("comments", [])
    memory = records.get("memory", [])
    citations = [item["id"] for item in [*events, *comments, *memory] if item.get("id")]
    return {
        "text": "微博负面升高主要来自官宣可信度、非官宣消息和溜粉担忧，相关评论与事件仍在升级观察中。",
        "citations": citations,
        "error": None,
    }


def daily_report(records, now):
    event_ids = [event.get("id") for event in records.get("events", []) if event.get("id")]
    action_ids = [action.get("id") for action in records.get("actions", []) if action.get("id")]
    comment_ids = [comment.get("id") for comment in records.get("comments", []) if comment.get("id")]
    evidence_ids = [*event_ids, *action_ids, *comment_ids]
    markdown = "\n".join([
        "# Weibo MVP Daily Report",
        "",
        f"Generated: {now}",
        f"Events: {len(event_ids)}",
        f"Actions: {len(action_ids)}",
        f"Comments: {len(comment_ids)}",
        "Evidence: " + (", ".join(evidence_ids) if evidence_ids else "insufficient"),
    ])
    return {
        "markdown": markdown,
        "dataCoverage": {
            "events": len(event_ids),
            "actions": len(action_ids),
            "comments": len(comment_ids),
            "backtests": len(records.get("backtests", [])),
        },
        "evidence_ids": evidence_ids,
    }


def standard_answer_error(error_type, cause, fix):
    return {
        "error_type": error_type,
        "message": cause,
        "cause": cause,
        "fix": fix,
    }


def build_trend(items):
    buckets = {}
    for item in items:
        label = item["createdAt"][11:13] + ":00" if len(item["createdAt"]) >= 13 else "00:00"
        bucket = buckets.setdefault(label, {"label": label, "mentions": 0, "heat": 0, "sentiment": 0})
        bucket["mentions"] += 1
        bucket["heat"] += item["heat"]
        bucket["sentiment"] += item["sentiment"]
    return [
        {**bucket, "sentiment": round(bucket["sentiment"] / max(bucket["mentions"], 1), 2)}
        for _, bucket in sorted(buckets.items())
    ]


def forecast_trend(trend):
    if not trend:
        return []
    latest = trend[-1]
    return [{"label": f"+{i}h", "mentions": latest["mentions"], "heat": latest["heat"], "sentiment": latest["sentiment"]} for i in range(1, 7)]


def count_by(items, key):
    counts = {}
    for item in items:
        counts[item[key]] = counts.get(item[key], 0) + 1
    return counts


if __name__ == "__main__":
    main()
