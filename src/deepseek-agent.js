export async function analyzeWithDeepSeek(items, apiKey) {
  if (!apiKey || !items.length) return null;
  const sample = items.slice(0, 80).map((item) => ({
    source: item.source,
    content: item.content,
    sentiment: item.sentimentLabel,
    topics: item.topics
  }));

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你是影视宣发舆情分析Agent。只输出JSON，字段为 sentiment_readout, key_risks, marketing_actions, evidence_notes。"
        },
        {
          role: "user",
          content: `请基于以下《海岛舒服日志》小红书/抖音/微博相关舆情样本做情感分析和宣发建议：\n${JSON.stringify(sample, null, 2)}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "";
  return parseJsonContent(content);
}

function parseJsonContent(content) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return {
      sentiment_readout: trimmed,
      key_risks: [],
      marketing_actions: [],
      evidence_notes: []
    };
  }
}
