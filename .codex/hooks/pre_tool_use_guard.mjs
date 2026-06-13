#!/usr/bin/env node
import { execFileSync } from "node:child_process";

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

function collectStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function currentBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

const payload = readPayload(input);
const command = collectStrings(payload).join("\n");
const normalized = command.replace(/\s+/g, " ").trim();
const branch = currentBranch();
const protectedBranch = branch === "main" || branch === "master";

if (!normalized) {
  process.exit(0);
}

if (/\bgit\s+commit\b/.test(normalized) && protectedBranch) {
  block("Agent loop guard: commits on main/master are not pre-authorized. Create an agent feature branch first.");
}

if (/\bgit\s+push\b/.test(normalized)) {
  if (protectedBranch || /\b(origin\s+)?(main|master)\b/.test(normalized) || /HEAD:(main|master)\b/.test(normalized)) {
    block("Agent loop guard: pushing main/master requires explicit human approval.");
  }
}

if (/\bgh\s+pr\s+merge\b|\bgit\s+merge\b|\bgit\s+rebase\b.*\b(main|master)\b/.test(normalized)) {
  block("Agent loop guard: merging or rebasing protected branches requires explicit human approval.");
}

if (/\b(npm|pnpm|yarn)\s+run\s+(deploy|release|publish)\b|\b(vercel|fly|render|netlify|railway)\s+(deploy|release|publish)\b/.test(normalized)) {
  block("Agent loop guard: production deploy/release commands require explicit human approval.");
}

if (/\bgit\s+add\b/.test(normalized)) {
  const secretPathPattern = /(^|[\s"'`])(\.env(\.[^\s"'`]*)?|config\/cookies\/|.*cookie.*\.json|.*token.*|.*secret.*)(?=$|[\s"'`])/i;
  if (secretPathPattern.test(normalized) || /\bgit\s+add\s+\.\b/.test(normalized) || /\bgit\s+add\s+-A\b/.test(normalized)) {
    block("Agent loop guard: broad or secret-like git add is blocked. Stage explicit safe files only; never stage .env, cookies, tokens, or secrets.");
  }
}

if (/\bWEIBO_COOKIE\b|\bCOOKIE\b|\bTOKEN\b|\bAPI_KEY\b|\b\.env\b/.test(normalized) && /\b(git\s+add|git\s+commit|git\s+push|cat|sed|awk|rg)\b/.test(normalized)) {
  block("Agent loop guard: command appears to touch secret-bearing material. Human approval is required.");
}
