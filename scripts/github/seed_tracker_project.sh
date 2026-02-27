#!/usr/bin/env bash
set -euo pipefail

OWNER="${OWNER:-ryanmontgomerytate}"
PROJECT_TITLE="${PROJECT_TITLE:-ICS Roadmap + Clip Feed Tracker}"
EVOLVE_TRACKER="docs/EVOLVE_ICS_TRACKER.md"
CLIP_TRACKER="docs/TIKTOK_CLIP_FEED_TRACKER.md"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

status_to_option() {
  case "$1" in
    done) echo "Done" ;;
    in_progress) echo "In Progress" ;;
    blocked) echo "Blocked" ;;
    *) echo "Todo" ;;
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

require_cmd gh
require_cmd jq
require_cmd rg

echo "checking token scopes..."
if ! gh auth status -t 2>&1 | rg -q "project"; then
  echo "token missing project scopes. run: gh auth refresh -s read:project -s project" >&2
  exit 1
fi

echo "locating project..."
PROJECT_NUMBER="$(
  gh project list --owner "$OWNER" --limit 100 --format json \
    --jq ".projects // . | map(select(.title==\"$PROJECT_TITLE\"))[0].number // empty"
)"

if [ -z "${PROJECT_NUMBER}" ]; then
  echo "creating project: $PROJECT_TITLE"
  PROJECT_NUMBER="$(
    gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json \
      --jq '.number'
  )"
fi

echo "project number: $PROJECT_NUMBER"

PROJECT_ID="$(
  gh project list --owner "$OWNER" --limit 100 --format json \
    --jq ".projects // . | map(select(.number==$PROJECT_NUMBER))[0].id"
)"

STATUS_FIELD_ID="$(
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
    --jq '(.fields // .) | map(select(.name=="Status"))[0].id // empty'
)"

if [ -z "${STATUS_FIELD_ID}" ]; then
  echo "unable to find Status field on project $PROJECT_NUMBER" >&2
  exit 1
fi

create_or_update_item() {
  local title="$1"
  local status_raw="$2"
  local source_doc="$3"
  local status
  status="$(echo "$status_raw" | tr '[:upper:]' '[:lower:]' | tr '-' '_' )"
  local option_name
  option_name="$(status_to_option "$status")"
  local option_id
  option_id="$(
    gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
      --jq "(.fields // .) | map(select(.name==\"Status\"))[0].options[] | select(.name==\"$option_name\") | .id"
  )"

  if [ -z "${option_id}" ]; then
    echo "missing Status option '$option_name' on project. skipping: $title" >&2
    return
  fi

  local item_id
  item_id="$(
    gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --limit 500 --format json \
      --jq "(.items // .)[] | select((.title // .content.title // \"\")==\"$title\") | .id" | head -n 1
  )"

  if [ -z "${item_id}" ]; then
    local body
    body=$(
      cat <<EOF
Synced from \`$source_doc\`.

Tracker status: \`$status_raw\`
EOF
    )

    item_id="$(
      gh project item-create "$PROJECT_NUMBER" --owner "$OWNER" --title "$title" --body "$body" --format json \
        --jq '.id'
    )"
    echo "created: $title"
  else
    echo "exists:  $title"
  fi

  gh project item-edit \
    --id "$item_id" \
    --project-id "$PROJECT_ID" \
    --field-id "$STATUS_FIELD_ID" \
    --single-select-option-id "$option_id" >/dev/null
}

while IFS=$'\t' read -r title status; do
  [ -z "${title:-}" ] && continue
  create_or_update_item "Evolve: ${title}" "$status" "$EVOLVE_TRACKER"
done < <(
  extract_rows "$EVOLVE_TRACKER" "Phase Tracker" "Active Workstreams" ""
  extract_rows "$EVOLVE_TRACKER" "Active Workstreams" "Current Blockers" ""
)

while IFS=$'\t' read -r title status; do
  [ -z "${title:-}" ] && continue
  create_or_update_item "Clip Feed: ${title}" "$status" "$CLIP_TRACKER"
done < <(
  extract_rows "$CLIP_TRACKER" "Phase Tracker" "Core Workstreams" ""
  extract_rows "$CLIP_TRACKER" "Core Workstreams" "Current Blockers" ""
)

PROJECT_URL="$(
  gh project list --owner "$OWNER" --limit 100 --format json \
    --jq ".projects // . | map(select(.number==$PROJECT_NUMBER))[0].url"
)"

echo "sync complete: ${PROJECT_URL}"
