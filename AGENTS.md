# AGENTS

This file defines the shared context workflow for switching between Claude Code and Codex in this repo. It is intentionally short and action-focused.

## Purpose
Use this file to keep cross-tool context consistent when one provider hits a rate limit. The goal is to maximize weekly usage across both tools without losing project state.

## Source Of Truth Files (Read First)
- `CLAUDE.md` (architecture, stack, rules)
- `ARCHITECTURE.md` (database + pipeline specs)
- `SESSIONS.md` (chronological work log and current state)
- `docs/COLLABORATION_PROTOCOL.md` (Claude ↔ Codex coordination rules)

## Claude Memory (Supplemental Context)
- When switching from Claude Code to Codex (or back), also check the Claude project memory directory if present:
  - `~/.claude/projects/.../memory/` (repo-specific path under `~/.claude/projects/`)
- Treat memory files as **supplemental context only** (helpful notes/handoffs), not the source of truth.
- If memory content conflicts with `CLAUDE.md`, `ARCHITECTURE.md`, or `SESSIONS.md`, follow the source-of-truth files.
- Use memory notes to quickly recover recent work, decisions, and unfinished tasks when rotating tools.

## Shared MCP Memory (Optional, Cross-Tool)
- A shared MCP knowledge-graph memory file can be used by both Codex and Claude:
  - `/Users/ryan/.agent-memory/ice-cream-social/memory.json`
- In Codex CLI, this is configured as global MCP server `memory` (via `@modelcontextprotocol/server-memory`).
- Claude can be pointed at the same file by configuring its MCP memory server to use the same `MEMORY_FILE_PATH`.
- Treat shared MCP memory as supplemental context (helpful for cross-tool recall), not a replacement for `CLAUDE.md` / `ARCHITECTURE.md` / `SESSIONS.md`.

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

**Concrete example:**
```
Project: ice-cream-social (Tauri/Rust + React)
Goal: Fix diarization regressions after torch upgrade
State: Pyannote imports clean; episodes 899–901 need requeue
Decisions: Keep Whisper+Pyannote; Qwen as post-processor only
Next: Requeue 899–901; verify diarization output
Files: scripts/speaker_diarization.py, SESSIONS.md
Constraints: No secrets; use env vars; update SESSIONS.md
```

## Session Start Checklist
Before writing any code, complete all of these:
- Read `CLAUDE.md`, `ARCHITECTURE.md`, and `SESSIONS.md`.
- Check Claude project memory (`~/.claude/projects/.../memory/`) for recent context.
- Confirm scope and goal for this session.
- Identify the next 1–3 tasks from the “Next” field in the last handoff.
- **Avoid repeating already-completed work** — check `SESSIONS.md` before starting any task.

## Rotation Rules
- When you hit a rate limit, switch tools and paste the handoff template.
- Before continuing, read the Source Of Truth files (see Session Start Checklist above).
- After finishing a task, append a short “Current State” update to `SESSIONS.md`.

## When To Update the Handoff / SESSIONS.md
- After completing any task.
- Before switching tools (rate limit or intentional).
- When making architectural or schema changes (also update `ARCHITECTURE.md`).

## Rate Limit Strategy
- If Claude is rate-limited, switch to Codex and continue using the handoff template.
- If Codex is rate-limited, switch back to Claude after reset.
- Keep handoffs small (5–10 lines) to reduce token waste on context recovery.

## Current State Format (for SESSIONS.md entries)
Every “Current State” update must include at minimum 3 bullets:
- **Done:** What was completed this session (be specific — include file names).
- **Pending:** What is next / in-progress but not finished.
- **Blockers:** Anything preventing forward progress (or “None”).

## Safety
- Never read or modify any secret files (e.g., `.env`, `.env.local`, `.env.*.local`, `.claude/settings.local.json`).
- Never hardcode tokens or API keys. Use environment variables only.

## Logging
- Every completed task ends with a `SESSIONS.md` update.
- If you change architecture or schema, update `ARCHITECTURE.md` immediately.

## Testing (Required)
- Do not consider a task complete until relevant tests/checks are run, or an explicit blocker is reported.
- Every completed coding task must include a `Tests Run` summary with:
  - exact command(s) run
  - pass/fail result
  - short output summary (or blocker explanation)
- Minimum default backend unit test command for this repo (when relevant): `cargo test --manifest-path src-tauri/Cargo.toml`
- If only a subset is run for speed, state why that subset is sufficient.
