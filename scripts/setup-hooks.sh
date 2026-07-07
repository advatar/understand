#!/usr/bin/env bash
#
# setup-hooks.sh — install the understanding pre-push git hook into the CURRENT repo.
#
# The plugin system does not install git hooks, so this is the one manual step needed to turn on the
# (opt-in, default-OFF) pre-push gate. Safe to run anytime: the hook is a no-op until you add
# .understanding/config.json with gate.enabled=true. Run from inside the repo you want to gate:
#
#   bash "$CLAUDE_PLUGIN_ROOT/scripts/setup-hooks.sh"      # when installed as a plugin
#   ./scripts/setup-hooks.sh                                # when run from a clone of this repo
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
hook_src="$here/../hooks/pre-push"
[ -f "$hook_src" ] || { echo "setup-hooks: pre-push not found at $hook_src" >&2; exit 1; }

repo="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "setup-hooks: run inside a git repository." >&2; exit 1; }
hooks_dir="$(git rev-parse --git-path hooks)"          # respects core.hooksPath / worktrees
mkdir -p "$hooks_dir"
dest="$hooks_dir/pre-push"

if [ -e "$dest" ] && ! grep -q "understanding" "$dest" 2>/dev/null; then
  echo "setup-hooks: a different pre-push hook already exists at $dest." >&2
  echo "            Not overwriting. Merge them, or call this hook from yours:" >&2
  echo "              $hook_src" >&2
  exit 1
fi

cp "$hook_src" "$dest"
chmod +x "$dest"
echo "Installed understanding pre-push hook → $dest"
echo "It is a NO-OP until you opt in with .understanding/config.json, e.g.:"
echo '  { "gate": { "enabled": true, "base": "origin/main", "paths": ["src/"] } }'
