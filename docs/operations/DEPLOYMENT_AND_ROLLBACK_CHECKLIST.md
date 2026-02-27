# Deployment and Rollback Checklist

Use this checklist for any staging/prod deployment.

## Pre-Deploy Checklist

- [ ] PR approved and merged with passing CI
- [ ] `SESSIONS.md` updated with release-relevant changes
- [ ] `ARCHITECTURE.md` updated for schema/architecture changes
- [ ] Migration impact reviewed (forward + backward compatibility)
- [ ] Backup snapshot completed and verified
- [ ] Release notes prepared (features, fixes, risks)
- [ ] Rollback trigger conditions agreed

## Staging Deploy Checklist

- [ ] Deploy candidate build to staging
- [ ] Apply migrations in staging
- [ ] Smoke test critical paths:
  - [ ] episode list/search
  - [ ] transcript load
  - [ ] speaker assignment update
  - [ ] queue/worker status
- [ ] Verify logs/metrics for errors
- [ ] Verify Sentry release `web@<sha>` exists with sourcemaps/commits (if configured)
- [ ] Verify environment secrets are correct

## Production Deploy Checklist

- [ ] Confirm staging checks passed
- [ ] Confirm current backup timestamp and restore point
- [ ] Deploy release artifact
- [ ] Apply migrations in controlled order
- [ ] Run production smoke test:
  - [ ] health endpoint / app startup
  - [ ] primary read paths
  - [ ] primary write path
- [ ] Confirm Sentry release deploy is visible in target environment
- [ ] Monitor for 15-30 minutes after deploy

## Rollback Checklist

Trigger rollback if:
- sustained 5xx/errors above baseline
- data corruption risk
- critical feature unavailable
- migration failure without safe forward fix

Steps:
1. [ ] Freeze new deploys
2. [ ] Announce incident + rollback start
3. [ ] Revert to previous known-good version
4. [ ] If needed, restore DB from last valid backup
5. [ ] Re-run smoke checks on rolled-back version
6. [ ] Confirm service health recovered
7. [ ] Record incident timeline, root cause, and follow-up actions

## Post-Deploy / Post-Rollback

- [ ] Update `SESSIONS.md` with outcome and timestamps
- [ ] File follow-up issues for defects/gaps
- [ ] Update runbooks/checklists based on lessons learned
