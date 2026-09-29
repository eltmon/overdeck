#!/usr/bin/env bash
# Vendors the OKF skill from its canonical home, eltmon/okf
# (https://github.com/eltmon/okf), into sync-sources/skills/okf. Never edit
# that destination directly: change the skill in eltmon/okf, tag a release,
# and re-run this script to re-vendor it.
#
# Usage:
#   scripts/vendor-okf-skill.sh <tag> [--tarball <file>] [--dest <dir>]
#   scripts/vendor-okf-skill.sh --check [--tarball <file>] [--dest <dir>]
#
# Vendor mode replaces --dest with the tag's tree (minus repo-tooling paths)
# and writes .okf-skill-version. Check mode verifies --dest still matches the
# tag recorded in its .okf-skill-version and exits non-zero on drift.
set -euo pipefail

# Tag-root paths that are repo tooling, not skill content. Anchored to the
# root: templates/repo/.github/ and templates/repo/.gitignore are skill content.
EXCLUDES=(.github .pan .overdeck tests CHANGELOG.md .gitignore .gitattributes)

usage() {
  cat >&2 <<'EOF'
usage: scripts/vendor-okf-skill.sh <tag> [--tarball <file>] [--dest <dir>]
       scripts/vendor-okf-skill.sh --check [--tarball <file>] [--dest <dir>]
EOF
}

tag=""
check_mode=0
tarball=""
dest=""

while [ $# -gt 0 ]; do
  case "$1" in
    --check)
      check_mode=1
      shift
      ;;
    --tarball)
      if [ $# -lt 2 ]; then
        usage
        exit 2
      fi
      tarball="$2"
      shift 2
      ;;
    --dest)
      if [ $# -lt 2 ]; then
        usage
        exit 2
      fi
      dest="$2"
      shift 2
      ;;
    -*)
      usage
      exit 2
      ;;
    *)
      if [ -n "$tag" ] || [ "$check_mode" -eq 1 ]; then
        usage
        exit 2
      fi
      tag="$1"
      shift
      ;;
  esac
done

if [ "$check_mode" -eq 1 ] && [ -n "$tag" ]; then
  usage
  exit 2
fi

if [ "$check_mode" -eq 0 ] && [ -z "$tag" ]; then
  usage
  exit 2
fi

if [ -n "$tag" ] && ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  usage
  exit 2
fi

if [ -z "$dest" ]; then
  dest="$(git rev-parse --show-toplevel)/sync-sources/skills/okf"
fi

tmp="$(mktemp -d)"
trap 'rm -rf -- "${tmp:?}"' EXIT

filters=()
for entry in "${EXCLUDES[@]}"; do
  filters+=("--exclude=/${entry}")
done

fetch_and_extract() {
  local fetch_tag="$1"
  local out_dir="$2"
  mkdir -p "$out_dir"
  local tgz
  if [ -n "$tarball" ]; then
    tgz="$tarball"
  else
    tgz="$tmp/okf.tgz"
    curl -fsSL "https://github.com/eltmon/okf/archive/refs/tags/${fetch_tag}.tar.gz" -o "$tgz"
  fi
  tar -xzf "$tgz" -C "$out_dir" --strip-components=1
}

if [ "$check_mode" -eq 0 ]; then
  fetch_and_extract "$tag" "$tmp/src"

  if [ ! -f "$tmp/src/LICENSE" ]; then
    echo "error: ${tag} tarball has no LICENSE" >&2
    exit 1
  fi
  if [ ! -f "$tmp/src/NOTICE" ]; then
    echo "error: ${tag} tarball has no NOTICE" >&2
    exit 1
  fi

  mkdir -p "$dest"
  rsync -a --delete "${filters[@]}" "$tmp/src/" "$dest/"
  printf '%s\n' "$tag" > "$dest/.okf-skill-version"
  echo "vendored eltmon/okf ${tag} into ${dest}"
else
  if [ ! -f "$dest/.okf-skill-version" ]; then
    echo "::error::${dest}/.okf-skill-version is missing. Run scripts/vendor-okf-skill.sh <tag> to vendor a release." >&2
    exit 1
  fi
  pinned_tag="$(cat "$dest/.okf-skill-version")"

  fetch_and_extract "$pinned_tag" "$tmp/src"
  mkdir -p "$tmp/expected"
  rsync -a --delete "${filters[@]}" "$tmp/src/" "$tmp/expected/"
  printf '%s\n' "$pinned_tag" > "$tmp/expected/.okf-skill-version"

  diff_output=""
  if ! diff_output="$(diff -r -x __pycache__ "$tmp/expected" "$dest")"; then
    echo "::error::sync-sources/skills/okf differs from eltmon/okf ${pinned_tag}. Edit the skill in eltmon/okf, tag a release, and re-vendor with scripts/vendor-okf-skill.sh ${pinned_tag}." >&2
    echo "$diff_output" >&2
    exit 1
  fi
  echo "okf skill matches eltmon/okf ${pinned_tag}"
fi
