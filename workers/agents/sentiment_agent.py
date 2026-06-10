import json
import os
import requests

from workers.analyzer_core import fallback_analysis


DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"


def analyze_comment(content):
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        result = fallback_analysis(content)
        result["model"] = "local-rules"
        return result

    prompt = {
        "comment": content,
        "required_json_schema": {
            "sentiment": "positive|neutral|negative",
            "score": "-1.0 to 1.0",
            "confidence": "0.0 to 1.0",
            "topics": ["string"],
            "risks": ["string"],
            "evidence": "short evidence phrase",
        },
    }
    try:
        response = requests.post(
            DEEPSEEK_URL,
            timeout=30,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json={
                "model": "deepseek-chat",
                "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": "你是影视舆情评论情感分析Agent。只输出JSON，不要输出解释。"},
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
            },
        )
        response.raise_for_status()
        content_text = response.json()["choices"][0]["message"]["content"].strip()
        content_text = content_text.removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(content_text)
        parsed["model"] = "deepseek-chat"
        parsed["sentiment"] = parsed.get("sentiment", "neutral")
        parsed["score"] = float(parsed.get("score", 0))
        parsed["confidence"] = float(parsed.get("confidence", 0.7))
        parsed["topics"] = parsed.get("topics") or []
        parsed["risks"] = parsed.get("risks") or []
        parsed["evidence"] = parsed.get("evidence") or ""
        return parsed
    except Exception as exc:
        result = fallback_analysis(content)
        result["model"] = "local-rules"
        result["error"] = str(exc)
        return result
