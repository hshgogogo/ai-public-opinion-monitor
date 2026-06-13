#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`agent loop guard: ${message}`);
  process.exitCode = 1;
}

const branch = run("git", ["branch", "--show-current"]);
const status = run("git", ["status", "--short"]);
const staged = run("git", ["diff", "--cached", "--name-only"]);
const changed = run("git", ["diff", "--name-only"]);
const files = new Set([...staged.split("\n"), ...changed.split("\n")].filter(Boolean));

if (branch === "main" || branch === "master") {
  fail("current branch is main/master. Create an agent feature branch before automated commit/push.");
}

for (const file of files) {
  if (/^\.env(\.|$)|^config\/cookies\/|cookie.*\.json$|token|secret/i.test(file)) {
    fail(`secret-like file is changed or staged: ${file}`);
  }
}

if (!existsSync("docs/agent-loop.md")) {
  fail("docs/agent-loop.md is missing.");
}

if (!existsSync("docs/verification-rubric.md")) {
  fail("docs/verification-rubric.md is missing.");
}

if (!existsSync("AGENTS.md") || !readFileSync("AGENTS.md", "utf8").includes("Outcome-Driven Agent Loop")) {
  fail("AGENTS.md does not contain the Outcome-Driven Agent Loop guidance.");
}

if (!status) {
  console.log("agent loop guard: working tree clean; branch and guidance checks passed.");
} else {
  console.log("agent loop guard: branch and secret checks passed; working tree has changes.");
}
