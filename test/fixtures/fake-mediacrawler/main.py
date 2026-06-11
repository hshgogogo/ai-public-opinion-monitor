#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

import config


def str_to_bool(value):
    return str(value).lower() in {"1", "true", "t", "yes", "y"}


def redacted_argv(argv):
    redacted = []
    skip_next = False
    for index, arg in enumerate(argv):
        if skip_next:
            skip_next = False
            continue
        redacted.append(arg)
        if arg == "--cookies" and index + 1 < len(argv):
            redacted.append("<redacted>")
            skip_next = True
    return redacted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform")
    parser.add_argument("--lt")
    parser.add_argument("--type")
    parser.add_argument("--keywords")
    parser.add_argument("--save_data_option")
    parser.add_argument("--save_data_path")
    parser.add_argument("--cookies")
    parser.add_argument("--get_comment", default="false")
    parser.add_argument("--crawler_max_notes_count")
    parser.add_argument("--max_comments_count_singlenotes")
    parser.add_argument("--specified_id")
    args, _ = parser.parse_known_args()

    output_dir = Path(args.save_data_path)
    jsonl_dir = output_dir / "weibo" / "jsonl"
    jsonl_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "invocation.json").write_text(
        json.dumps(
            {
                "argv": redacted_argv(sys.argv[1:]),
                "has_cookies_arg": "--cookies" in sys.argv,
                "cookie_value_redacted": args.cookies not in redacted_argv(sys.argv[1:]),
                "config_cookie_present": bool(config.COOKIES),
                "config_cookie_value_recorded": config.COOKIES in redacted_argv(sys.argv[1:]),
                "config_cookie_has_unrelated": "other-site-token" in config.COOKIES,
                "config_cdp_port": config.CDP_DEBUG_PORT,
                "mediacrawler_cdp_port": os.environ.get("MEDIACRAWLER_CDP_PORT"),
                "has_mysql_url": "MYSQL_URL" in os.environ,
                "has_deepseek_key": "DEEPSEEK_API_KEY" in os.environ,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    keyword = args.keywords or "\u6d77\u5c9b\u8212\u670d\u65e5\u5fd7"
    if args.type == "detail":
        note_id = args.specified_id or "mc-detail-1"
        content_file = jsonl_dir / "detail_contents_2026-06-10.jsonl"
        content_file.write_text(
            json.dumps(
                {
                    "note_id": note_id,
                    "content": "\u6d77\u5c9b\u8212\u670d\u65e5\u5fd7 \u5218\u660a\u7136 \u8be6\u60c5\u91c7\u96c6\u5e16",
                    "source_keyword": keyword,
                    "note_url": f"https://m.weibo.cn/detail/{note_id}",
                    "user_id": "mc-detail-user",
                    "nickname": "\u8be6\u60c5\u5b98\u53f7",
                    "liked_count": 77,
                    "comments_count": 2,
                    "shared_count": 4,
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        if str_to_bool(args.get_comment):
            (jsonl_dir / "detail_comments_2026-06-10.jsonl").write_text(
                "\n".join(
                    json.dumps(record, ensure_ascii=False)
                    for record in [
                        {
                            "comment_id": "mc-detail-comment-1",
                            "note_id": note_id,
                            "content": "\u5b98\u53f7\u8bc4\u8bba\u91cc\u7684\u6b63\u5411\u53cd\u9988",
                            "user_id": "comment-user-1",
                            "nickname": "\u8bc4\u8bba\u7528\u62371",
                            "comment_like_count": "9",
                            "sub_comment_count": "1",
                        },
                        {
                            "comment_id": "mc-detail-comment-2",
                            "note_id": note_id,
                            "content": "\u62c5\u5fc3\u8282\u594f\u7684\u8bc4\u8bba",
                            "user_id": "comment-user-2",
                            "nickname": "\u8bc4\u8bba\u7528\u62372",
                            "comment_like_count": "4",
                            "sub_comment_count": "0",
                        },
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
        print(json.dumps({"ok": True, "output": str(content_file), "platform": args.platform, "type": args.type}))
        return
    if "fail-runtime" in keyword:
        print("MYSQL_URL=mysql://should-not-leak DEEPSEEK_API_KEY=sk-should-not-leak", file=sys.stderr)
        raise SystemExit(2)
    if os.environ.get("FAKE_MEDIACRAWLER_BAD_JSON") == "1" or "bad-json" in keyword:
        (jsonl_dir / "search_contents_2026-06-10.jsonl").write_text("{bad json\n", encoding="utf-8")
        print(json.dumps({"ok": True, "bad_json": True}))
        return
    if "partial-json" in keyword:
        (jsonl_dir / "search_contents_2026-06-10.jsonl").write_text(
            json.dumps(
                {
                    "note_id": "mc-partial-1",
                    "content": keyword + " \u5218\u660a\u7136 \u6709\u6548\u884c",
                    "source_keyword": keyword,
                    "note_url": "https://weibo.com/status/mc-partial-1",
                    "user_id": "mc-user-partial",
                    "nickname": "\u90e8\u5206\u6210\u529f\u53f7",
                    "liked_count": 12,
                    "comments_count": 3,
                    "shared_count": 1,
                },
                ensure_ascii=False,
            )
            + "\n{bad json\n",
            encoding="utf-8",
        )
        print(json.dumps({"ok": True, "partial_json": True}))
        return
    records = [
        {
            "note_id": "mc-search-1",
            "content": keyword + " \u5218\u660a\u7136 \u5b98\u5ba3\u8282\u594f\u8ba8\u8bba",
            "source_keyword": keyword,
            "note_url": "https://weibo.com/status/mc-search-1",
            "user_id": "mc-user-1",
            "nickname": "\u6d4b\u8bd5\u5b98\u53f7",
            "liked_count": 42,
            "comments_count": 11,
            "shared_count": 5,
        },
        {
            "note_id": "mc-search-2",
            "content": keyword + " \u674e\u5170\u8fea \u8def\u900f\u53cd\u9988",
            "source_keyword": keyword,
            "note_url": "https://weibo.com/status/mc-search-2",
            "user_id": "mc-user-2",
            "nickname": "\u6d4b\u8bd5\u5a92\u4f53",
            "liked_count": 30,
            "comments_count": 8,
            "shared_count": 3,
        },
    ]
    output_file = jsonl_dir / "search_contents_2026-06-10.jsonl"
    output_file.write_text(
        "\n".join(json.dumps(record, ensure_ascii=False) for record in records) + "\n",
        encoding="utf-8",
    )
    if str_to_bool(args.get_comment):
        (jsonl_dir / "search_comments_2026-06-10.jsonl").write_text(
            json.dumps({"comment_id": "mc-comment-1", "note_id": "mc-search-1", "content": "\u8bc4\u8bba\u4e0d\u5e94\u8be5\u53d8\u6210\u76ee\u6807"}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (jsonl_dir / "search_creators_2026-06-10.jsonl").write_text(
            json.dumps({"user_id": "mc-user-1", "nickname": "\u521b\u4f5c\u8005\u4e0d\u5e94\u8be5\u53d8\u6210\u76ee\u6807"}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    print(json.dumps({"ok": True, "output": str(output_file), "platform": args.platform, "type": args.type}))


if __name__ == "__main__":
    main()
