#!/usr/bin/env bash
# Retry-safe npm publish for the release workflow (PAN-5595). npm can hold a
# freshly accepted version as "staged": npm view cannot see it, the tarball
# 404s, and a second publish fails with E409 "Cannot publish over previously
# staged version". This script checks visibility before publishing (skips if
# already visible), treats that E409 as "already staged" rather than a
# failure, and then polls npm view until the version becomes visible or the
# poll times out (exit 3, with maintainer approval instructions).
#
# Usage:
#   scripts/npm-publish-retry-safe.sh --tag <dist-tag> <package.tgz|package-dir>
set -euo pipefail

usage() {
  echo "usage: scripts/npm-publish-retry-safe.sh --tag <dist-tag> <package.tgz|package-dir>" >&2
}

tag=""
pkg=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)
      if [ $# -lt 2 ]; then
        usage
        exit 2
      fi
      tag="$2"
      shift 2
      ;;
    -*)
      usage
      exit 2
      ;;
    *)
      if [ -n "$pkg" ]; then
        usage
        exit 2
      fi
      pkg="$1"
      shift
      ;;
  esac
done

if [ -z "$tag" ] || [ -z "$pkg" ]; then
  usage
  exit 2
fi

if [ -f "$pkg" ] && [[ "$pkg" == *.tgz ]]; then
  mode=tarball
elif [ -d "$pkg" ] && [ -f "$pkg/package.json" ]; then
  mode=dir
else
  usage
  exit 2
fi

if [ "$mode" = tarball ]; then
  if ! identity=$(tar -xOzf "$pkg" package/package.json | node -e 'const p=JSON.parse(require("fs").readFileSync(0));console.log(p.name+" "+p.version)'); then
    echo "could not read a package name and version from $pkg" >&2
    exit 1
  fi
else
  if ! identity=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(p.name+" "+p.version)' "$pkg/package.json"); then
    echo "could not read a package name and version from $pkg/package.json" >&2
    exit 1
  fi
fi
read -r name version <<< "$identity"
if [ -z "$name" ] || [ -z "$version" ]; then
  echo "could not read a package name and version from $pkg" >&2
  exit 1
fi

attempts="${NPM_VISIBILITY_POLL_ATTEMPTS:-40}"
interval="${NPM_VISIBILITY_POLL_INTERVAL_SECONDS:-30}"

is_visible() {
  local out
  out=$(npm view "${name}@${version}" version --prefer-online 2>/dev/null || true)
  [ "$(printf '%s' "$out" | tr -d '[:space:]')" = "$version" ]
}

print_timeout_message() {
  local staged_now="$1"
  if [ "$staged_now" -eq 1 ]; then
    echo "::error::${name}@${version} is not visible on npm after ${attempts} checks. npm holds it as a staged version that a maintainer must approve."
  else
    echo "::error::${name}@${version} is not visible on npm after ${attempts} checks. npm most likely holds it as a staged version that a maintainer must approve."
  fi
  cat <<EOF
On a machine logged in to npm as an @overdeck maintainer (npm 11.15 or later), confirm the staged version and find its stage id:
  npx --yes npm@11 stage list ${name}
  npx --yes npm@11 stage view <stage-id>
A package can have several staged versions. Approve only a stage id whose stage view output shows ${name} and version ${version}:
  npx --yes npm@11 stage approve <stage-id>    (prompts for 2FA)
Or approve it under Staged Packages in your npmjs.com account settings.
If stage list shows no staged ${version}, it is not staged: check registry visibility with npm view ${name}@${version} version and npm's status page instead of approving anything.
After the approval, re-run this failed job. The script finds the version and skips the publish.
Do not publish ${name}@${version} again: npm refuses a second publish of a staged version (E409).
EOF
}

if is_visible; then
  echo "${name}@${version} is already visible on npm. Skipping the publish (retry-safe)."
  exit 0
fi

staged=0
if [ "$mode" = tarball ]; then
  if output=$(npm publish "$pkg" --ignore-scripts --provenance --access public --tag "$tag" 2>&1); then
    status=0
  else
    status=$?
  fi
else
  if output=$(cd "$pkg" && npm publish --ignore-scripts --provenance --access public --tag "$tag" 2>&1); then
    status=0
  else
    status=$?
  fi
fi
printf '%s\n' "$output"

if [ "$status" -ne 0 ]; then
  if printf '%s' "$output" | grep -qi 'previously staged version'; then
    staged=1
    echo "${name}@${version} is already staged on npm. Skipping the publish and waiting for it to become visible."
  else
    exit "$status"
  fi
fi

for ((i = 1; i <= attempts; i++)); do
  if is_visible; then
    echo "${name}@${version} is visible on npm."
    exit 0
  fi
  if [ "$i" -lt "$attempts" ]; then
    sleep "$interval"
  fi
done

print_timeout_message "$staged"
exit 3
