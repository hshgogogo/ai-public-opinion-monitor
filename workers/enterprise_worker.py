#!/usr/bin/env python3
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workers import db
from workers.agents.sentiment_agent import analyze_comment
from workers.collectors import douyin, weibo, xiaohongshu


PLATFORM_LABELS = {
    "xiaohongshu": "小红书",
    "douyin": "抖音",
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
        elif args.command == "snapshot":
            emit(snapshot_payload(args.project_id))
        elif args.command == "collect":
            emit(run_collection(args.project_id, args.limit))
    except Exception as exc:
        emit({"ok": False, "error": str(exc)}, code=1)


def emit(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False, default=str))
    sys.exit(code)


def health_payload():
    database = db.health()
    auth = []
    if database.get("connected"):
        db.ensure_default_auth_states()
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT platform, cookie_file, status, last_checked_at FROM platform_auth_states ORDER BY platform")
                auth = cur.fetchall()
    return {
        "ok": database.get("connected", False),
        "database": database,
        "auth": auth,
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
    database = db.health()
    if not database.get("connected"):
        return {"ok": False, "database": database, "message": "MySQL is required before real collection can run"}
    db.ensure_default_auth_states()
    project = get_project(project_id)
    if not project:
        project_id = db.ensure_default_project()
        project = get_project(project_id)
    outcomes = []
    for platform in project["active_platforms"]:
        for keyword in project["keywords"]:
            outcomes.append(run_platform_keyword(project, platform, keyword, limit))
    return {"ok": True, "project": project["project_name"], "outcomes": outcomes}


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
            cur.execute("SELECT id FROM social_posts WHERE platform=%s AND external_id=%s", (platform, post["external_id"]))
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
            cur.execute("SELECT id FROM social_comments WHERE platform=%s AND external_id=%s", (platform, external_id))
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
    leading_source = max(count_by(items, "source").items(), key=lambda kv: kv[1])[0] if items else "三平台"
    headline = "真实评论不足，先完成采集" if not items else "先修复官宣可信度，再放大演员合作声量"
    summary = (
        "当前没有真实评论入库，请先配置三平台 Cookie 并运行采集任务。"
        if not items
        else f"当前样本主阵地为{leading_source}，负向评论 {len(negative)} 条。策略应围绕官宣可信度、演员合作与地域语言争议做分平台回应。"
    )
    plays = [
        {"name": "微博", "steps": ["发布官方阵容确认信息", "把演员讨论导向角色关系与导演合作", "监控非官宣不信、溜粉、辟谣"], "metric": "负向率低于25%"},
        {"name": "抖音", "steps": ["测试15秒角色反差切片", "发布海岛氛围和片场花絮", "跟踪评论情绪变化"], "metric": "完播与正向评论同步提升"},
        {"name": "小红书", "steps": ["投放海岛松弛感、妆造、取景地内容", "弱化粉圈话术", "沉淀生活方式种草笔记"], "metric": "收藏/评论比提升"},
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
        {"name": "真实采集 Agent", "status": "就绪" if database.get("connected") else "阻塞", "work": "只采集小红书、抖音、微博授权评论", "output": database.get("error") or "等待采集任务"},
        {"name": "清洗入库 Agent", "status": "就绪" if database.get("connected") else "阻塞", "work": "去重、字段标准化、写入 MySQL", "output": "MySQL 已连接" if database.get("connected") else "MySQL 未连接"},
        {"name": "DeepSeek 情感 Agent", "status": "就绪" if __import__("os").environ.get("DEEPSEEK_API_KEY") else "降级", "work": "逐评论情绪、风险、证据归因", "output": "deepseek-chat" if __import__("os").environ.get("DEEPSEEK_API_KEY") else "本地规则兜底"},
        {"name": "账号态 Agent", "status": "运行中", "work": "检查三平台 Cookie 文件", "output": " / ".join([f"{p}:{auth_by_platform.get(p, 'missing')}" for p in PLATFORM_LABELS])},
    ]


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
