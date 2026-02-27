#!/usr/bin/env bash
set -euo pipefail

OWNER="${OWNER:-@me}"
PROJECT_NUMBER="${PROJECT_NUMBER:-1}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gh
require_cmd jq

PROJECT_ID="$(
  gh project list --owner "$OWNER" --limit 100 --format json \
    --jq ".projects // . | map(select(.number==$PROJECT_NUMBER))[0].id"
)"

STATUS_FIELD_ID="$(
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
    --jq '(.fields // .) | map(select(.name=="Status"))[0].id'
)"

TODO_OPTION_ID="$(
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
    --jq '(.fields // .) | map(select(.name=="Status"))[0].options[] | select(.name=="Todo") | .id'
)"
IN_PROGRESS_OPTION_ID="$(
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
    --jq '(.fields // .) | map(select(.name=="Status"))[0].options[] | select(.name=="In Progress") | .id'
)"
BLOCKED_OPTION_ID="$(
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
    --jq '(.fields // .) | map(select(.name=="Status"))[0].options[] | select(.name=="Blocked") | .id'
)"
DONE_OPTION_ID="$(
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
    --jq '(.fields // .) | map(select(.name=="Status"))[0].options[] | select(.name=="Done") | .id'
)"

gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --limit 500 --format json \
  --jq '(.items // .)[] | select(.content.type=="Issue") | {id, title, labels}' |
while IFS= read -r line; do
  [ -z "${line:-}" ] && continue
  item_id="$(echo "$line" | jq -r '.id')"
  title="$(echo "$line" | jq -r '.title')"
  labels="$(echo "$line" | jq -r '.labels[]?')"

  option_id="$TODO_OPTION_ID"
  if echo "$labels" | grep -q '^status:done$'; then
    option_id="$DONE_OPTION_ID"
  elif echo "$labels" | grep -q '^status:blocked$'; then
    option_id="$BLOCKED_OPTION_ID"
  elif echo "$labels" | grep -q '^status:in_progress$'; then
    option_id="$IN_PROGRESS_OPTION_ID"
  fi

  gh project item-edit \
    --id "$item_id" \
    --project-id "$PROJECT_ID" \
    --field-id "$STATUS_FIELD_ID" \
    --single-select-option-id "$option_id" >/dev/null
  echo "synced: $title"
done
