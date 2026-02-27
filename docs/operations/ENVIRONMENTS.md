# Environments

This project uses three standard environments: `local`, `staging`, and `prod`.

## Local

Purpose:
- Daily development, debugging, data curation, and pipeline iteration.

Runtime:
- Tauri desktop app + local React dev server (`cargo tauri dev`).

Data:
- Local SQLite database (`data/ice_cream_social.db`).
- Local filesystem artifacts (`scripts/episodes`, `scripts/transcripts`, `scripts/voice_library`).

Deployment:
- None (runs on developer machine).

Risk policy:
- Safe for schema experiments and iterative migration work.
- Do not treat local data as canonical backup.

## Staging

Purpose:
- Pre-production validation for hosted workflows and release candidates.

Runtime:
- Hosted web/API stack mirroring production architecture.
- Same app version as planned prod deploy candidate.

Data:
- Staging database and storage only (sanitized or non-sensitive data preferred).
- No production secrets/tokens in staging logs.

Deployment:
- Automatic from merge to `main` (or release branch), after CI passes.
- Manual promote gate to production.

Risk policy:
- Must pass smoke checks, rollback check, and migration checks before prod.

## Prod

Purpose:
- Public user-facing environment.

Runtime:
- Hosted web/API stack (target architecture) plus any required background jobs.

Data:
- Production database/storage only.
- Strict secret handling and least-privilege access.

Deployment:
- Controlled release with rollback plan.
- Only from tested, tagged commits/PRs.

Risk policy:
- Backups verified before schema-impacting releases.
- All incidents documented with postmortem follow-up.

## Environment Variables (Policy)

- Never commit real secrets to git.
- Keep required vars documented in `.env.example`.
- Use distinct credentials per environment (local/staging/prod).
- Rotate tokens if exposure is suspected.

## Promotion Rule

Code should progress:
1. `local` validation
2. `staging` verification
3. `prod` release

No direct untested `local -> prod` promotion.

