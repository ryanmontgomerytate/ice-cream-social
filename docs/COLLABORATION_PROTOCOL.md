# Collaboration Protocol — Claude ↔ Codex

This document defines how Claude Code and Codex CLI coordinate on the `ice-cream-social-app` monorepo without stepping on each other's work.

---

## 1. Read Before Coding

At the start of every session, read in this order:

1. `AGENTS.md` — workflow rules and handoff format
2. `CLAUDE.md` — architecture, stack, safety rules
3. `ARCHITECTURE.md` — database + pipeline specs
4. `SESSIONS.md` — most recent state and current WIP claims

Also check supplemental memory:
- **Claude local memory:** `~/.claude/projects/-Users-ryan-Desktop-Projects-ice-cream-social-app/memory/MEMORY.md`
- **Shared MCP memory:** `/Users/ryan/.agent-memory/ice-cream-social/memory.json` (if present)

> If MCP memory is missing or unavailable, continue — `SESSIONS.md` is canonical.

---

## 2. Claim Work Before Editing (WIP Lock)

Before touching any file, append a one-line WIP claim to `SESSIONS.md`:

```
[WIP — Claude] Goal: implement /episodes/[id] detail page | Files: web/app/(public)/episodes/[id]/page.tsx, web/lib/types.ts | ETA: this session
[WIP — Codex]  Goal: add psycopg2-binary to requirements.txt | Files: requirements.txt | ETA: <5 min
```

**Rules:**
- Do not edit a file currently claimed by the other agent unless explicitly coordinated.
- Remove or replace the WIP line with a "Done" summary when finished.
- If a claim is older than one session with no update, treat it as stale and feel free to take over.

---

## 3. Default Responsibilities

| Area | Default Owner |
|------|--------------|
| `web/` — Next.js pages, API routes, components | **Claude** |
| `web/supabase/migrations/` — schema changes | **Claude** |
| `web/lib/` — TypeScript types, Supabase clients | **Claude** |
| `src-tauri/` — Rust backend, Tauri commands | **Codex** |
| `scripts/` — Python pipeline scripts | **Codex** |
| `.github/` — CI/CD, PR templates | **Codex** |
| `docs/` — runbooks, operations | **Codex** |
| `ARCHITECTURE.md`, `SESSIONS.md`, `AGENTS.md`, `CLAUDE.md` | **Shared** (concise updates only) |

Either agent can work outside their default area when explicitly asked — just claim it first.

---

## 4. Handoff Format

After every task, append to `SESSIONS.md` using this format (5–10 lines max):

```
Project: ice-cream-social
Goal: [1-line description of what was done]
State: [working | pending | blocked]
Decisions: [1–3 key choices made]
Next tasks: [top 1–3 items for the next session]
Files touched: [list of files changed]
Tests run: [exact commands + pass/fail + short output]
Blockers: [or "None"]
```

---

## 5. Testing Requirement

Never mark a task complete without running relevant checks:

| What changed | Minimum check |
|-------------|--------------|
| Rust / Tauri commands | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| React / Next.js (web/) | `npm --prefix web run build` |
| Python scripts | `python3 -m py_compile scripts/<file>.py` |

Include exact command, pass/fail, and one-line output summary in the handoff.

---

## 6. Memory Sync Rule

- `SESSIONS.md` is the **canonical shared log** — always write there.
- After any significant state change, also update `/Users/ryan/.agent-memory/ice-cream-social/memory.json` with a short summary (entity observations, not full prose).
- If MCP memory is unavailable, skip it and log only in `SESSIONS.md`.

**What to write to MCP memory:**
- Current phase / milestone status
- Pending tasks tagged by agent (`ClaudeTask`, `CodexTask`)
- Key architectural decisions
- Infrastructure state (e.g. "Supabase not yet live — waiting on credentials")

---

## 7. Safety Rules

- **Never** read or modify: `.env`, `.env.local`, `.env.*.local`, `.claude/settings.local.json`, `*.secret.*`, `*credentials*`
- **Never** hardcode API keys, tokens, or passwords — use `os.getenv()` / `process.env`
- **Never** `sudo` in scripts — ask the user to run privileged commands manually
- **Always** document required env vars in `.env.example` with placeholder values only

---

*Last updated: 2026-02-26*
