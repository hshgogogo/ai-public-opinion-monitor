#!/usr/bin/env node
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
}

function readPayload(raw) {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const payload = readPayload(input);
const eventName = payload.hook_event_name || payload.hookEventName || payload.event || "SubagentEvent";
const record = {
  ts: new Date().toISOString(),
  event: eventName,
  turn_id: payload.turn_id || null,
  agent_id: payload.agent_id || null,
  agent_type: payload.agent_type || null,
  transcript: payload.agent_transcript_path || null,
};

const logPath = join(".codex", "agent-loop", "subagent-events.jsonl");
mkdirSync(dirname(logPath), { recursive: true });
appendFileSync(logPath, `${JSON.stringify(record)}\n`);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: eventName,
    additionalContext: "Subagent event recorded for agent-loop evidence.",
  },
}));
