#!/usr/bin/env python3
"""Validate a Skill directory against Harness-style engineering constraints."""

from __future__ import annotations

import re
import sys
from pathlib import Path


DIR_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
FIELD_RE = re.compile(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$")


def extract_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---\n"):
        return "", text
    end = text.find("\n---", 4)
    if end == -1:
        return "", text
    return text[4:end].strip(), text[end + 4 :].lstrip()


def read_field(frontmatter: str, key: str) -> str:
    lines = frontmatter.splitlines()
    capture = False
    value: list[str] = []
    for line in lines:
        match = FIELD_RE.match(line)
        if match:
            if capture:
                break
            if match.group(1) == key:
                capture = True
                raw = match.group(2).strip()
                if raw not in {">", "|"}:
                    value.append(raw.strip('"').strip("'"))
        elif capture:
            if line.startswith(" ") or line.startswith("\t") or not line.strip():
                value.append(line.strip())
            else:
                break
    return " ".join(part for part in value if part).strip()


def main() -> int:
    if len(sys.argv) != 2:
        print("用法: validate_skill.py <skill-dir>")
        return 2

    root = Path(sys.argv[1]).expanduser()
    errors: list[str] = []
    warnings: list[str] = []

    if not root.exists() or not root.is_dir():
        errors.append(f"目标不是目录: {root}")
        return report(errors, warnings)

    name = root.name
    if len(name) > 64:
        errors.append("目录名超过 64 个字符")
    if not DIR_RE.match(name) or "--" in name:
        errors.append("目录名必须是 kebab-case：小写字母、数字、短横线；无首尾短横线和连续短横线")

    skill_file = root / "SKILL.md"
    if not skill_file.exists():
        case_variants = [p.name for p in root.iterdir() if p.name.lower() == "skill.md"]
        if case_variants:
            errors.append(f"主文件大小写错误，应为 SKILL.md；发现: {', '.join(case_variants)}")
        else:
            errors.append("缺少必需主文件 SKILL.md")
        return report(errors, warnings)

    text = skill_file.read_text(encoding="utf-8")
    frontmatter, body = extract_frontmatter(text)
    if not frontmatter:
        errors.append("SKILL.md 缺少 YAML frontmatter")

    skill_name = read_field(frontmatter, "name")
    description = read_field(frontmatter, "description")

    if not skill_name:
        warnings.append("frontmatter 未声明 name；部分宿主会退回使用目录名")
    elif skill_name != name:
        warnings.append(f"name 与目录名不一致: name={skill_name!r}, dir={name!r}")

    if not description:
        errors.append("frontmatter 缺少 description")
    else:
        desc_len = len(description)
        if desc_len > 1024:
            errors.append(f"description 超过 1024 字符: {desc_len}")
        elif desc_len > 800:
            warnings.append(f"description 超过 800 字符，可能挤占入口预算: {desc_len}")
        if "使用场景" not in description and "Use when" not in description:
            warnings.append("description 建议包含“使用场景”或 Use when")
        if "不适用" not in description and "Not for" not in description:
            warnings.append("description 建议包含不适用边界")

    line_count = len(text.splitlines())
    if line_count > 500:
        warnings.append(f"SKILL.md 超过 500 行，应拆分辅助文件: {line_count}")

    if re.search(r"Bash[（(]\s*\*\s*[）)]", frontmatter):
        errors.append("frontmatter 中发现 Bash(*)，高风险权限配置")

    if any(marker in body for marker in ["详见 `reference/", "see `reference/"]):
        warnings.append("检查辅助文件引用是否包含：何时加载、去哪加载、获得什么")

    for optional in ["reference", "templates", "scripts"]:
        path = root / optional
        if path.exists() and not path.is_dir():
            errors.append(f"{optional}/ 应为目录")

    return report(errors, warnings)


def report(errors: list[str], warnings: list[str]) -> int:
    for item in errors:
        print(f"ERROR: {item}")
    for item in warnings:
        print(f"WARN: {item}")
    if not errors and not warnings:
        print("OK: Skill 结构通过检查")
    elif not errors:
        print("OK_WITH_WARNINGS: 没有硬错误，但建议处理警告")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
