# Sentry Releases + Sourcemaps (Web)

This runbook documents how `web/` release creation, commit association, and sourcemap upload are handled.

## Purpose

When configured, each CI web build publishes a Sentry release so stack traces resolve to original TypeScript/TSX and issues are tied to Git commits.

## Where It Runs

Workflow: `.github/workflows/ci.yml`
Job: `web-build`

Behavior:
- Release name: `web@<git_sha>`
- Environment tag:
  - `production` on `push` to `main`/`master`
  - `staging` for PRs and non-prod builds
- Commit association: automatic (`setCommits.auto=true`)
- Sourcemap upload: enabled only when required Sentry credentials exist

## Required GitHub Secrets

Set these as repo-level or environment-level secrets used by CI:

- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`
- `NEXT_PUBLIC_SENTRY_DSN` (runtime client events)
- `SENTRY_DSN` (runtime server/edge events; optional override)

## Build-Time Controls

`web/next.config.ts` uses these env vars:

- `SENTRY_RELEASE` (set in CI to `web@<sha>`)
- `SENTRY_ENVIRONMENT` (`staging` or `production`)
- `SENTRY_UPLOAD_ENABLED` (`true`/`false` guard for upload)

If upload credentials are missing, CI logs a warning and sets `SENTRY_UPLOAD_ENABLED=false` so the build still succeeds.

## Verification Checklist

1. Trigger CI (`CI` workflow) on a branch/merge.
2. Open `web-build` job logs.
3. Confirm summary lines include:
   - `Sentry release: web@<sha>`
   - `Sentry upload enabled: true`
4. In Sentry, check the project release list for `web@<sha>`.
5. Open an error event and verify stack frames are source-mapped to `.ts/.tsx` files.
6. Confirm release shows associated commits.

## Troubleshooting

### Upload skipped

Symptom:
- CI warning: "Sentry sourcemap/release upload disabled (missing: ...)"

Fix:
- Add missing `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` secrets.

### Events missing at runtime

Symptom:
- No new errors/traces in Sentry despite successful build

Fix:
- Ensure `NEXT_PUBLIC_SENTRY_DSN` and/or `SENTRY_DSN` are set in runtime environment.
- Ensure `SENTRY_ENVIRONMENT` matches expected filter in Sentry UI.

### Release exists but frames are not source-mapped

Fix:
- Confirm web build ran with `SENTRY_UPLOAD_ENABLED=true`.
- Confirm release name in event matches CI release (`web@<sha>`).
- Verify `SENTRY_AUTH_TOKEN` has project release + artifact upload permissions.

## Security Notes

- Never commit real Sentry tokens.
- Use GitHub Secrets only.
- Rotate token immediately if exposure is suspected.
