#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const bundledPython = "/Users/mini-002/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const pythonBin = process.env.PYTHON_BIN
  || (existsSync(".venv/bin/python3") ? ".venv/bin/python3" : bundledPython);
const env = { ...process.env };

for (const key of [
  "MYSQL_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_API_URL",
  "DEEPSEEK_MODEL",
  "WEIBO_COOKIE_FILE",
  "MEDIACRAWLER_HOME",
  "MEDIACRAWLER_PYTHON",
  "MEDIACRAWLER_OUTPUT_DIR",
  "MEDIACRAWLER_CDP_PORT",
  "MEDIACRAWLER_COMMIT",
]) {
  delete env[key];
}

env.PYTHON_BIN = pythonBin;
env.YUQING_SKIP_ENV_FILE = "1";

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env,
});

process.exit(result.status ?? 1);
