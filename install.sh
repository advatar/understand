#!/usr/bin/env bash
#
# understanding — vendored installer (the plugin-averse path).
#
# The SIMPLEST install is the plugin marketplace (see README / INSTALL.md):
#   /plugin marketplace add advatar/understand
#   /plugin install understanding@understand
#
# This script is for people who'd rather vendor the skills straight into a repo's `.claude/`
# (no plugin system). It installs PROJECT-level so the skills' scripts resolve via the
# `${CLAUDE_PLUGIN_ROOT:-.claude}` fallback. Run it two ways:
#
#   ./install.sh [--target <repo-dir>] [--hook]        # from a clone of advatar/understand
#   curl -fsSL https://raw.githubusercontent.com/advatar/understand/main/install.sh | bash
#
#   --target <dir>   repo to install into (default: current git repo root, else CWD)
#   --hook           also install the git pre-push hook into that repo
set -euo pipefail

TARGET=""; WITH_HOOK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2;;
    --hook) WITH_HOOK=1; shift;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "install: unknown arg '$1'" >&2; exit 64;;
  esac
done

# Locate the source. When piped through curl there are no local files, so clone to a temp dir.
src="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -z "$src" ] || [ ! -d "$src/skills" ]; then
  command -v git >/dev/null || { echo "install: git required to fetch the source." >&2; exit 1; }
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  echo "install: fetching advatar/understand …"
  git clone --depth 1 https://github.com/advatar/understand.git "$tmp" >/dev/null 2>&1 \
    || { echo "install: clone failed." >&2; exit 1; }
  src="$tmp"
fi

base="${TARGET:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
dest="$base/.claude"
mkdir -p "$dest/skills" "$dest/commands"
cp -R "$src/skills/." "$dest/skills/"
cp -R "$src/commands/." "$dest/commands/"
# keep the shared assets/scripts executable
find "$dest/skills" -name '*.sh' -exec chmod +x {} + 2>/dev/null || true
echo "install: vendored skills + commands → $dest"

if [ "$WITH_HOOK" = "1" ]; then
  if repo="$(git -C "$base" rev-parse --show-toplevel 2>/dev/null)"; then
    hd="$(git -C "$repo" rev-parse --git-path hooks)"; mkdir -p "$hd"
    cp "$src/hooks/pre-push" "$hd/pre-push"; chmod +x "$hd/pre-push"
    echo "install: git pre-push hook installed (OFF until .understanding/config.json opts in)."
  else
    echo "install: --hook skipped ($base is not a git repo)." >&2
  fi
fi

echo "Done. In a Claude Code session in $base, try:  /explain-diff main..HEAD"
