# GitHub Project Board (Tracker Mirror)

Last updated: February 27, 2026

Purpose:
- Mirror `docs/EVOLVE_ICS_TRACKER.md` and `docs/TIKTOK_CLIP_FEED_TRACKER.md` into a GitHub Project board.
- Give Kanban visibility from Issues/PRs and CI workflow activity.

## Target Board

- Owner: `ryanmontgomerytate`
- Title: `ICS Roadmap + Clip Feed Tracker`
- View: `Board` grouped by `Status`

Status mapping:
- `not_started` -> `Todo`
- `in_progress` -> `In Progress`
- `blocked` -> `Blocked`
- `done` -> `Done`

## One-Time Setup

1. Ensure `gh` token has project scopes:
   - `read:project`
   - `project`
2. Create the board:
```bash
gh project create --owner ryanmontgomerytate --title "ICS Roadmap + Clip Feed Tracker"
```
3. Capture board URL:
```bash
gh project list --owner ryanmontgomerytate --limit 50 --format json \
  --jq '.projects // . | map(select(.title=="ICS Roadmap + Clip Feed Tracker"))[0].url'
```
4. Seed tracker items:
```bash
bash scripts/github/seed_tracker_project.sh
```

## Repo Automation (Actions/PR Flow)

This repo includes `.github/workflows/project-board-sync.yml`.

Set these repo settings so workflow automation can add/update board items:
- Repository variable: `GITHUB_PROJECT_URL` = full project URL
- Repository secret: `PROJECTS_TOKEN` = PAT with `repo`, `read:project`, `project`

Workflow behavior:
- On issue open/reopen and PR open/reopen/ready/closed:
  - add item to project if missing
  - map labels/state to project `Status`:
    - `status:not_started` -> `Todo`
    - `status:in_progress` -> `In Progress`
    - `status:blocked` -> `Blocked`
    - `status:done` or closed PR/issue -> `Done`

## Tracker Update Rule

When updating either tracker doc:
1. Update tracker markdown status first.
2. Run `bash scripts/github/seed_tracker_project.sh` to sync/create draft items.
3. Update labels/status on corresponding Issues/PRs.
4. Append `SESSIONS.md` entry.
