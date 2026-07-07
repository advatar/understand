#!/usr/bin/env bash
#
# resolve_range.sh — resolve a diff range (git range OR a PR number) + optional pathspec into a
# deterministic, monorepo-safe descriptor, and write the raw diff to a work file.
#
# Portable: uses only `git` (+ `gh` as an optional convenience for PR mode). The FIRST thing it does
# inside `.understanding/` is write a `.gitignore` that excludes `.work/` and `.nonces/`, so the diff,
# the authored content spec, and the per-run nonces can never be accidentally committed. Prints a
# single JSON object to stdout.
#
# Usage:
#   resolve_range.sh [RANGE] [-- <pathspec>...]
#     RANGE       a git range ("HEAD~1..HEAD", "main..HEAD", "main...HEAD", "abc..def"),
#                 a single ref ("HEAD" -> its parent..itself),
#                 or a PR ("#123" / "123" -> uses `gh` if available, else errors clearly).
#     pathspec    optional git pathspec(s) after `--` to scope the diff (monorepo-safe).
#
# Output JSON: {mode, range, baseSha, headSha, rangeSha, slug, pathspec, diffFile, changedFiles}
set -euo pipefail

RANGE="${1:-HEAD~1..HEAD}"
if [ "$#" -gt 0 ]; then shift; fi

PATHSPEC=()
if [ "${1:-}" = "--" ]; then
  shift
  PATHSPEC=("$@")
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo '{"error":"not a git repository"}' >&2
  exit 2
fi

# --- close the leak window FIRST: nothing under .understanding/{.work,.nonces} may ever be committed ---
u_root="$repo_root/.understanding"
work_dir="$u_root/.work"
mkdir -p "$work_dir"
gi="$u_root/.gitignore"
for want in ".work/" ".nonces/"; do
  if [ ! -f "$gi" ] || ! grep -qxF "$want" "$gi" 2>/dev/null; then
    printf '%s\n' "$want" >> "$gi"
  fi
done

# minimal JSON string escaper (backslash, quote, control chars)
jesc() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  printf '%s' "$s"
}
sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}';
  else sha256sum | awk '{print $1}'; fi
}

mode="git"
base_sha=""
head_sha=""
sep=".."   # preserved diff operator (.. or ...)

is_pr=""
case "$RANGE" in
  \#[0-9]*) is_pr="${RANGE#\#}" ;;   # "#123" — an explicit PR reference
  *[!0-9]*) ;;                        # contains a non-digit (git range, sha, path) — NOT a PR
  [0-9]*)                             # all-digits: could be a PR number OR an all-digit short sha.
    # A real git commit wins over a PR-number guess (so an all-digit sha resolves correctly).
    if ! git rev-parse --verify --quiet "$RANGE^{commit}" >/dev/null 2>&1; then is_pr="$RANGE"; fi ;;
esac

diff_file="$work_dir/.tmp.$$.diff"

if [ -n "$is_pr" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "{\"error\":\"PR mode needs the gh CLI; not found. Use a plain git range instead, e.g. main..HEAD\"}" >&2
    exit 3
  fi
  mode="pr"
  base_sha="$(gh pr view "$is_pr" --json baseRefOid --jq .baseRefOid 2>/dev/null || true)"
  head_sha="$(gh pr view "$is_pr" --json headRefOid --jq .headRefOid 2>/dev/null || true)"
  if [ -z "$head_sha" ] || [ -z "$base_sha" ]; then
    echo "{\"error\":\"could not resolve PR #$is_pr via gh\"}" >&2
    exit 3
  fi
  sep="..."  # PRs are a merge-base (three-dot) comparison
  if [ "${#PATHSPEC[@]}" -gt 0 ]; then
    git diff "$base_sha...$head_sha" -- "${PATHSPEC[@]}" > "$diff_file"
  else
    # prefer gh's server-rendered diff; fall back to a local three-dot diff if empty/unavailable
    gh pr diff "$is_pr" > "$diff_file" 2>/dev/null || true
    if [ ! -s "$diff_file" ]; then
      git diff "$base_sha...$head_sha" > "$diff_file"
    fi
  fi
else
  # git range mode. Detect and PRESERVE the diff operator (... = symmetric/merge-base, .. = two-dot).
  if printf '%s' "$RANGE" | grep -q '\.\.\.'; then
    sep="..."
    base_ref="${RANGE%%...*}"
    head_ref="${RANGE##*...}"
  elif printf '%s' "$RANGE" | grep -q '\.\.'; then
    sep=".."
    base_ref="${RANGE%%..*}"
    head_ref="${RANGE##*..}"
  else
    # a single ref -> <ref>~1..<ref>
    sep=".."
    base_ref="$RANGE~1"
    head_ref="$RANGE"
  fi
  if [ -z "$base_ref" ] || [ -z "$head_ref" ]; then
    echo "{\"error\":\"incomplete range '$RANGE' — need BASE${sep}HEAD (e.g. main${sep}HEAD)\"}" >&2
    exit 3
  fi
  base_sha="$(git rev-parse --verify --quiet "$base_ref^{commit}" 2>/dev/null || true)"
  head_sha="$(git rev-parse --verify --quiet "$head_ref^{commit}" 2>/dev/null || true)"
  if [ -z "$base_sha" ] || [ -z "$head_sha" ]; then
    echo "{\"error\":\"could not resolve range '$RANGE' (base='$base_ref' head='$head_ref')\"}" >&2
    exit 3
  fi
  if [ "${#PATHSPEC[@]}" -gt 0 ]; then
    git diff "$base_sha$sep$head_sha" -- "${PATHSPEC[@]}" > "$diff_file"
  else
    git diff "$base_sha$sep$head_sha" > "$diff_file"
  fi
fi

# Deterministic range identity binds base, head, the operator AND pathspec.
pathspec_join=""
if [ "${#PATHSPEC[@]}" -gt 0 ]; then
  pathspec_join="$(printf '%s\0' "${PATHSPEC[@]}")"
fi
range_sha="$(printf '%s%s%s\0%s' "$base_sha" "$sep" "$head_sha" "$pathspec_join" | sha256)"

short() { printf '%s' "${1:0:7}"; }
slug="$(short "$base_sha")-$(short "$head_sha")"
if [ "${#PATHSPEC[@]}" -gt 0 ]; then
  ps_digest="$(printf '%s' "$pathspec_join" | sha256)"
  slug="$slug-${ps_digest:0:6}"
fi

final_diff="$work_dir/$slug.diff"
mv -f "$diff_file" "$final_diff"

if [ "${#PATHSPEC[@]}" -gt 0 ]; then
  changed_files="$(git diff --name-only "$base_sha$sep$head_sha" -- "${PATHSPEC[@]}" 2>/dev/null | wc -l | tr -d ' ')"
else
  changed_files="$(git diff --name-only "$base_sha$sep$head_sha" 2>/dev/null | wc -l | tr -d ' ')"
fi

# pathspec as a JSON array (escaped)
ps_json="[]"
if [ "${#PATHSPEC[@]}" -gt 0 ]; then
  ps_json="["
  first=1
  for p in "${PATHSPEC[@]}"; do
    [ $first -eq 1 ] && first=0 || ps_json="$ps_json,"
    ps_json="$ps_json\"$(jesc "$p")\""
  done
  ps_json="$ps_json]"
fi

printf '{"mode":"%s","range":"%s","baseSha":"%s","headSha":"%s","rangeSha":"%s","slug":"%s","pathspec":%s,"diffFile":"%s","changedFiles":%s}\n' \
  "$mode" "$(jesc "$RANGE")" "$base_sha" "$head_sha" "$range_sha" "$slug" "$ps_json" "$(jesc "$final_diff")" "${changed_files:-0}"
