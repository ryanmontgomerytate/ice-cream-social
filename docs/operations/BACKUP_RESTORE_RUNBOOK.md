# Data Backup and Restore Runbook

This runbook covers backup/restore for the current local SQLite workflow and the target hosted workflow.

## Scope

Primary data assets:
- `data/ice_cream_social.db` (SQLite)
- Transcript and audio artifacts under `scripts/transcripts/` and `scripts/episodes/` (as required)
- Voice library artifacts under `scripts/voice_library/`

## RPO / RTO Targets (Initial)

- RPO (max acceptable data loss): 24 hours
- RTO (target restore time): 2-4 hours for local restore

Adjust targets as hosted production requirements mature.

## Local SQLite Backup Procedure

Recommended cadence:
- Daily backup when active development/transcription is happening
- Pre-release backup before schema-impacting changes

Commands:

```bash
# from repo root
mkdir -p backups/sqlite
sqlite3 data/ice_cream_social.db ".backup backups/sqlite/ice_cream_social_$(date +%Y%m%d_%H%M%S).db"
```

Optional compressed copy:

```bash
gzip backups/sqlite/ice_cream_social_YYYYMMDD_HHMMSS.db
```

Verification:

```bash
sqlite3 backups/sqlite/ice_cream_social_YYYYMMDD_HHMMSS.db "PRAGMA integrity_check;"
```

Expected output: `ok`

## Local Restore Procedure

1. Stop running app/worker processes.
2. Preserve current DB before restore:

```bash
cp data/ice_cream_social.db data/ice_cream_social.pre_restore.$(date +%Y%m%d_%H%M%S).db
```

3. Restore from selected backup:

```bash
cp backups/sqlite/ice_cream_social_YYYYMMDD_HHMMSS.db data/ice_cream_social.db
```

4. Validate DB integrity:

```bash
sqlite3 data/ice_cream_social.db "PRAGMA integrity_check;"
```

5. Start app and run smoke checks (episode load, transcript load, speaker updates).

## Hosted Backup Strategy (Target)

When hosted DB is introduced (staging/prod):
- Enable automated daily DB backups.
- Keep point-in-time recovery where supported.
- Store backup retention policy (minimum 7-30 days depending on environment).
- Test restore in staging at least monthly.

## Backup Metadata to Record

For each backup operation, record:
- timestamp
- source environment
- backup filename/location
- schema/app version
- integrity check result
- operator

Log summary in `SESSIONS.md` for major backup/restore events.

## Failure Handling

If backup integrity check fails:
1. Retry backup immediately.
2. Check disk space and file permissions.
3. Do not proceed with migration/deploy until a valid backup exists.

If restore fails:
1. Revert to pre-restore preserved DB.
2. Escalate incident and capture logs.
3. Document recovery actions in `SESSIONS.md`.

