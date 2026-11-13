#!/usr/bin/env bash
# Upstream port records (PAN-5183, FR-17).
#
# Overdeck ports some logic file by file from Orca and t3code. Each ported
# file starts with a port header, and scripts/upstream-ports.json records
# { local, upstream, path, commit } for it. This script:
#
#   --check                  validates every record against its file's header
#                            (run by `npm run lint`; needs no upstream checkout)
#   [orca|t3code] [--patch]  lists upstream commits that touched each recorded
#                            path since its recorded commit (no filter = both);
#                            --patch also prints the diff
#
# Environment: UPSTREAM_PORTS_FILE (default scripts/upstream-ports.json),
# UPSTREAM_PORTS_ROOT (default the repo root; `local` paths resolve against it),
# ORCA_REPO (default ~/Projects/orca), T3CODE_REPO (default ~/Projects/t3code),
# UPSTREAM_REF (default origin/main).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS_FILE="${UPSTREAM_PORTS_FILE:-$REPO_ROOT/scripts/upstream-ports.json}"
PORTS_ROOT="${UPSTREAM_PORTS_ROOT:-$REPO_ROOT}"
ORCA_REPO="${ORCA_REPO:-$HOME/Projects/orca}"
T3CODE_REPO="${T3CODE_REPO:-$HOME/Projects/t3code}"
UPSTREAM_REF="${UPSTREAM_REF:-origin/main}"

usage() {
  echo "usage: upstream-port-diff.sh --check | [orca|t3code] [--patch]" >&2
}

# Prints one tab-separated line per record: local, upstream, path, commit.
records() {
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      console.error(`upstream-ports: ${file}: ${error.message}`);
      process.exit(1);
    }
    if (!Array.isArray(data)) {
      console.error(`upstream-ports: ${file}: expected a JSON array`);
      process.exit(1);
    }
    for (const r of data) {
      const fields = [r?.local, r?.upstream, r?.path, r?.commit].map((v) => (typeof v === "string" ? v : ""));
      console.log(fields.join("\t"));
    }
  ' "$PORTS_FILE"
}

header_for() {
  case "$1" in
    orca) echo '// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)' ;;
    t3code) echo '// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)' ;;
    *) return 1 ;;
  esac
}

repo_for() {
  case "$1" in
    orca) echo "$ORCA_REPO" ;;
    t3code) echo "$T3CODE_REPO" ;;
  esac
}

check() {
  local data
  data="$(records)" || exit 1
  local failed=0 count=0 local_path upstream path commit file header head10
  while IFS=$'\t' read -r local_path upstream path commit; do
    [[ -z "$local_path$upstream$path$commit" ]] && continue
    count=$((count + 1))
    if [[ -z "$local_path" || -z "$path" ]]; then
      echo "upstream-ports: ${local_path:-<record $count>}: record needs local and path"
      failed=1
      continue
    fi
    file="$PORTS_ROOT/$local_path"
    if [[ ! -f "$file" ]]; then
      echo "upstream-ports: $local_path: file not found"
      failed=1
      continue
    fi
    if ! header="$(header_for "$upstream")"; then
      echo "upstream-ports: $local_path: unknown upstream '$upstream' (expected orca or t3code)"
      failed=1
      continue
    fi
    if [[ ! "$commit" =~ ^[0-9a-f]{7,40}$ ]]; then
      echo "upstream-ports: $local_path: commit '$commit' is not 7-40 lowercase hex"
      failed=1
    fi
    head10="$(head -n 10 "$file")"
    if ! grep -qxF -- "$header" <<<"$head10"; then
      echo "upstream-ports: $local_path: first 10 lines lack the header '$header'"
      failed=1
    fi
    if ! grep -qxF -- "// upstream: $path @ $commit" <<<"$head10"; then
      echo "upstream-ports: $local_path: first 10 lines lack '// upstream: $path @ $commit'"
      failed=1
    fi
  done <<<"$data"
  if [[ "$failed" -ne 0 ]]; then
    exit 1
  fi
  echo "upstream-ports: $count records OK"
}

diff_mode() {
  local filter="" patch=0 arg
  for arg in "$@"; do
    case "$arg" in
      orca | t3code) filter="$arg" ;;
      --patch) patch=1 ;;
      *)
        usage
        exit 2
        ;;
    esac
  done

  local data
  data="$(records)" || exit 1
  local up repo local_path upstream path commit log
  for up in orca t3code; do
    [[ -n "$filter" && "$filter" != "$up" ]] && continue
    repo="$(repo_for "$up")"
    if [[ ! -d "$repo" ]]; then
      echo "skip $up: $repo not found"
      continue
    fi
    if ! git -C "$repo" fetch --quiet 2>/dev/null; then
      echo "warning: git fetch failed for $up ($repo); using local refs" >&2
    fi
    while IFS=$'\t' read -r local_path upstream path commit; do
      [[ "$upstream" != "$up" || -z "$local_path" ]] && continue
      if ! log="$(git -C "$repo" log --oneline "$commit..$UPSTREAM_REF" -- "$path" 2>&1)"; then
        echo "$local_path: cannot compare $commit..$UPSTREAM_REF: $log"
        continue
      fi
      if [[ -z "$log" ]]; then
        echo "$local_path: up to date"
        continue
      fi
      echo "$local_path ($path):"
      sed 's/^/  /' <<<"$log"
      if [[ "$patch" -eq 1 ]]; then
        git -C "$repo" --no-pager diff "$commit..$UPSTREAM_REF" -- "$path"
      fi
    done <<<"$data"
  done
  exit 0
}

if [[ "${1:-}" == "--check" ]]; then
  if [[ $# -ne 1 ]]; then
    usage
    exit 2
  fi
  check
else
  diff_mode "$@"
fi
