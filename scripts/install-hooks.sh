#!/bin/bash
# Install git hooks for the Ice Cream Social App project.
# Run from the project root: bash scripts/install-hooks.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "Error: .git/hooks directory not found. Are you in the project root?"
  exit 1
fi

cp "$SCRIPT_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

echo "✓ pre-commit hook installed at $HOOKS_DIR/pre-commit"
echo ""
echo "The hook will run:"
echo "  • cargo fmt --check + cargo clippy  (when src-tauri/ files are staged)"
echo "  • npm run build                     (when dashboard-react/src/ files are staged)"
