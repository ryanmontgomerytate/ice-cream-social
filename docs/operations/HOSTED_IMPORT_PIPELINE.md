# Hosted Import Pipeline (Phase 1)

This runbook moves read-only podcast data from local SQLite into hosted Postgres (Supabase).

## Prerequisites

1. Supabase project exists.
2. Hosted schema is applied:
   - `web/supabase/migrations/001_initial_schema.sql`
3. Environment variables are set (example templates):
   - `web/.env.example`
   - `scripts/.env.example`
4. PostgreSQL driver is installed in your Python environment:
   - `pip install psycopg2-binary`

## Commands

From repo root:

```bash
# Count-only validation (no writes)
python3 scripts/export_to_hosted.py --mode full --dry-run

# Export JSONL artifacts only
python3 scripts/export_to_hosted.py --mode export

# Import to hosted Postgres only
python3 scripts/export_to_hosted.py --mode import

# Full run (export + import)
python3 scripts/export_to_hosted.py --mode full

# Subset example
python3 scripts/export_to_hosted.py --mode full --tables shows episodes speakers
```

## Output

- JSONL exports + manifest per run:
  - `exports/<timestamp>/*.jsonl`
  - `exports/<timestamp>/manifest.json`
- Rolling run log:
  - `exports/import_log.json`

## Import Behavior

- FK-safe table order:
  - `shows -> episodes -> ... -> transcript_segments`
- Idempotent upserts:
  - `INSERT ... ON CONFLICT ... DO UPDATE`
- Large table chunking:
  - `transcript_segments` imported in batches of 1000 rows
- Import audit:
  - `import_batches` row updated to `complete` or `failed` when available

## Notes

- `DATABASE_URL` is required for `--mode import` and `--mode full` (unless `--dry-run`).
- Local SQLite remains source of truth in Phase 1.

## GitHub Hosted Verification

CI workflow `Hosted Import Verify` in `.github/workflows/ci.yml` runs on push/manual dispatch (non-PR):

- `verify` mode (full parity): runs when both are available:
  - `DATABASE_URL`
  - local `data/ice_cream_social.db` (or downloadable snapshot via `SQLITE_DB_URL`)
- `verify-hosted` mode (integrity fallback): runs when `DATABASE_URL` is reachable but SQLite is unavailable.

Required secrets:
- `DATABASE_URL` (required)
- `SQLITE_DB_URL` (optional, enables full parity in GitHub-hosted runners)

Recommended `SQLITE_DB_URL` format:
- direct HTTPS URL to a current SQLite snapshot (`.db` or `.gz`)
- accessible from GitHub Actions runner without auth prompts

CI summary behavior:
- `parity` -> success message (full check)
- `integrity` -> warning with guidance to add `SQLITE_DB_URL`
- `skipped` -> job fails (verification did not run)
