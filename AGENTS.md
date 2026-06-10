# Project Agent Notes

This is the application codebase inside the `yuqingjiance` workspace. The parent workspace has OpenSpec initialized, and gstack is installed globally for Codex.

## gstack

- gstack source: `/Users/mini-002/.gstack/repos/gstack`
- Codex runtime root: `/Users/mini-002/.codex/skills/gstack`
- Use gstack skills for structured planning, review, QA, security, shipping, and browser testing when the task matches them.
- Useful gstack skills include `office-hours`, `plan-ceo-review`, `plan-eng-review`, `review`, `qa`, `qa-only`, `investigate`, `cso`, `ship`, `land-and-deploy`, `browse`, and `gstack-upgrade`.
- For web app QA or browser verification, prefer gstack's browser runtime when explicitly using gstack; otherwise use the browser tools available in the current Codex session.

## OpenSpec

- OpenSpec files are in the parent workspace: `../openspec/`.
- OpenSpec Codex skills are in the parent workspace: `../.codex/skills/`.
- Use OpenSpec for spec-driven change proposals and validation.

## Superpowers

- Superpowers is enabled for this project only via `.claude/settings.json`.
- Do not install or enable Superpowers at the user/global scope for this project.
- Use Superpowers for TDD, systematic debugging, verification-before-completion, and code-review workflow discipline.
- Treat OpenSpec as the source of requirements, Superpowers as the quality gate, and gstack as the planning/QA/shipping workflow.
