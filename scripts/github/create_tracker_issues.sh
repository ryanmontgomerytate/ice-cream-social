#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-ryanmontgomerytate/ice-cream-social}"
EVOLVE_TRACKER="docs/EVOLVE_ICS_TRACKER.md"
CLIP_TRACKER="docs/TIKTOK_CLIP_FEED_TRACKER.md"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

status_to_label() {
  case "$1" in
    done) echo "status:done" ;;
    in_progress) echo "status:in_progress" ;;
    blocked) echo "status:blocked" ;;
    *) echo "status:not_started" ;;
  esac
}

extract_rows() {
  local file="$1"
  local start_heading="$2"
  local end_heading="$3"
  local prefix="$4"

  awk -v start="$start_heading" -v stop="$end_heading" -v pref="$prefix" '
    $0 ~ "^## "start"$" { in_section=1; next }
    in_section && $0 ~ "^## "stop"$" { in_section=0 }
    in_section && $0 ~ /^\|/ {
      if ($0 ~ /^\|[- ]+\|/) next
      n=split($0, cells, "|")
      if (n < 4) next
      title=cells[2]
      status=cells[3]
      gsub(/^[ \t`]+|[ \t`]+$/, "", title)
      gsub(/^[ \t`]+|[ \t`]+$/, "", status)
      if (title == "Phase" || title == "Workstream" || title == "") next
      print pref title "\t" status
    }
  ' "$file"
}

ensure_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" >/dev/null 2>&1 || true
}

issue_number_by_title() {
  local title="$1"
  gh issue list --repo "$REPO" --state all --search "in:title \"$title\"" --limit 100 --json number,title \
    --jq "map(select(.title==\"$title\"))[0].number // empty"
}

create_issue_if_missing() {
  local title="$1"
  local tracker="$2"
  local status_raw="$3"
  local domain_label="$4"
  local status
  local status_label
  local issue_number
  status="$(echo "$status_raw" | tr '[:upper:]' '[:lower:]' | tr '-' '_')"
  status_label="$(status_to_label "$status")"
  issue_number="$(issue_number_by_title "$title")"

  if [ -n "${issue_number}" ]; then
    echo "exists:  #${issue_number} ${title}"
    return
  fi

  local body
  body=$(
    cat <<EOF
Tracker-backed task generated from \`$tracker\`.

- Tracker status: \`$status_raw\`
- Source of truth: \`$tracker\`
- Sync command:
  - \`bash scripts/github/create_tracker_issues.sh\`
  - \`bash scripts/github/seed_tracker_project.sh\`
EOF
  )

  local issue_url
  issue_url="$(
    gh issue create \
      --repo "$REPO" \
      --title "$title" \
      --body "$body" \
      --label "type:feature" \
      --label "$domain_label" \
      --label "$status_label"
  )"

  local number
  number="$(echo "$issue_url" | sed -E 's#.*/issues/([0-9]+)$#\1#')"
  echo "created: #${number} ${title}"
}

require_cmd gh
require_cmd awk
require_cmd jq

ensure_label "status:not_started" "d4c5f9" "Tracker status: not started"
ensure_label "status:in_progress" "f9d0c4" "Tracker status: in progress"
ensure_label "status:blocked" "b60205" "Tracker status: blocked"
ensure_label "status:done" "0e8a16" "Tracker status: done"
ensure_label "type:feature" "a2eeef" "Feature work item"
ensure_label "tracker:evolve" "1d76db" "Roadmap tracker task"
ensure_label "tracker:clip-feed" "5319e7" "TikTok clip feed tracker task"

while IFS=$'\t' read -r title status; do
  [ -z "${title:-}" ] && continue
  create_issue_if_missing "[Evolve] ${title}" "$EVOLVE_TRACKER" "$status" "tracker:evolve"
done < <(
  extract_rows "$EVOLVE_TRACKER" "Phase Tracker" "Active Workstreams" ""
  extract_rows "$EVOLVE_TRACKER" "Active Workstreams" "Current Blockers" ""
)

while IFS=$'\t' read -r title status; do
  [ -z "${title:-}" ] && continue
  create_issue_if_missing "[Clip Feed] ${title}" "$CLIP_TRACKER" "$status" "tracker:clip-feed"
done < <(
  extract_rows "$CLIP_TRACKER" "Phase Tracker" "Core Workstreams" ""
  extract_rows "$CLIP_TRACKER" "Core Workstreams" "Current Blockers" ""
)
