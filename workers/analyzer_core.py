POSITIVE_TERMS = [
    "爆款", "抓人", "高级", "喜欢", "潜质", "不错", "稳", "扩散", "转化", "名场面", "二创",
    "期待", "满意", "相信", "官宣", "强强联合", "治愈", "舒服", "质感", "好美", "潜力黑马"
]

NEGATIVE_TERMS = [
    "担心", "悬浮", "劝退", "危险", "分流", "控评", "质疑", "负面", "撞上", "一般", "过头",
    "怀疑", "不相信", "不信", "溜粉", "辟谣", "非官宣", "被踩", "粤语能力", "争议"
]

TOPIC_RULES = [
    ("剧情口碑", ["剧情", "反转", "角色", "动机", "悬疑"]),
    ("演员讨论", ["刘昊然", "李兰迪", "刘奕铁", "颜卓灵", "尹正", "程潇", "男女主", "演员阵容"]),
    ("短视频扩散", ["短视频", "二创", "切片", "竖屏", "完播"]),
    ("官宣可信度", ["官宣", "非官宣", "不相信", "不信", "溜粉", "辟谣", "相信"]),
    ("视觉与妆造", ["预告", "美术", "海报", "妆造", "镜头", "定妆"]),
    ("地域与语言", ["海岛", "福建", "闽南", "广东", "粤语", "渔村"]),
]


def score_sentiment(text):
    lowered = (text or "").lower()
    score = 0
    for term in POSITIVE_TERMS:
        if term.lower() in lowered:
            score += 1
    for term in NEGATIVE_TERMS:
        if term.lower() in lowered:
            score -= 1
    return max(-1, min(1, score / 4))


def sentiment_label(score):
    if score >= 0.18:
        return "positive"
    if score <= -0.18:
        return "negative"
    return "neutral"


def detect_topics(text):
    topics = [name for name, terms in TOPIC_RULES if any(term.lower() in (text or "").lower() for term in terms)]
    return topics or ["综合声量"]


def fallback_analysis(text):
    score = score_sentiment(text)
    return {
        "sentiment": sentiment_label(score),
        "score": score,
        "confidence": 0.45,
        "topics": detect_topics(text),
        "risks": detect_risks(text),
        "evidence": text[:240],
    }


def detect_risks(text):
    risks = []
    if any(term in text for term in ["不信", "不相信", "非官宣", "溜粉", "辟谣"]):
        risks.append("官宣可信度")
    if "粤语" in text:
        risks.append("地域语言争议")
    if any(term in text for term in ["粉丝", "被踩", "控评"]):
        risks.append("粉丝对立")
    return risks
