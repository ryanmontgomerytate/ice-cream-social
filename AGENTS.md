# AGENTS

This file defines the shared context workflow for switching between Claude Code and Codex in this repo. It is intentionally short and action-focused.

## Purpose
Use this file to keep cross-tool context consistent when one provider hits a rate limit. The goal is to maximize weekly usage across both tools without losing project state.

## Source Of Truth Files (Read First)
- `CLAUDE.md` (architecture, stack, rules)
- `ARCHITECTURE.md` (database + pipeline specs)
- `SESSIONS.md` (chronological work log and current state)

## Handoff Template (Paste Into New Tool)
Use 5–10 lines max.

```
Project: ice-cream-social (Tauri/Rust + React)
Goal: [current goal in 1 line]
State: [what is working + what is pending]
Decisions: [1–3 key decisions]
Next: [top 1–3 tasks]
Files: [paths touched/important]
Constraints: [limits, do/don'ts, stack rules]
```

## Rotation Rules
- When you hit a rate limit, switch tools and paste the handoff template.
- Before continuing, read the Source Of Truth files.
- After finishing a task, append a short “Current State” update to `SESSIONS.md`.

## Safety
- Never read or modify any secret files (e.g., `.env`, `.env.local`, `.env.*.local`, `.claude/settings.local.json`).
- Never hardcode tokens or API keys. Use environment variables only.

## Logging
- Every completed task ends with a `SESSIONS.md` update.
- If you change architecture or schema, update `ARCHITECTURE.md` immediately.
