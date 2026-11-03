#!/usr/bin/env bash
# PAN-4852 WI-20: empty-HOME end-to-end check of the sageox pack build.
#
# Runs `pan skills pack add sageox --yes` (the pinned ref; needs Go and the
# network) with HOME set to a fresh temp dir, then checks that the build wrote
# nothing outside Overdeck's home and nothing under packs/ except sageox/.
# It never runs the built `ox`: `ox` writes ~/.config/sageox at run time.
#
# Not part of `npm run lint`. Run the branch build with:
#   PAN="node dist/cli/index.js" scripts/check-sageox-build-home.sh
set -euo pipefail

PAN="${PAN:-pan}"
H=$(mktemp -d)
PREFIX="${TMPDIR:-/tmp}/tmp."

# The Go toolchain that GOTOOLCHAIN=auto downloads into the module cache is
# read-only even with GOFLAGS=-modcacherw, so make it writable before removing.
# The delete names "$H" rather than a literal path because mktemp chooses the
# name; the case guard below only deletes a path under ${TMPDIR:-/tmp}/tmp.,
# which is exactly what mktemp -d returned above.
cleanup() {
  case "$H" in
    "$PREFIX"*) chmod -R u+w -- "$H" && rm -rf -- "$H" ;;
    *) echo "not removing $H: it does not start with $PREFIX" >&2 ;;
  esac
}
trap cleanup EXIT

echo "temp HOME: $H"
# $PAN is word-split on purpose so PAN="node dist/cli/index.js" works.
# shellcheck disable=SC2086
HOME="$H" OVERDECK_HOME="$H/.overdeck" $PAN skills pack add sageox --yes

status=0

outside=$(find "$H" -mindepth 1 -not -path "$H/.overdeck" -not -path "$H/.overdeck/*")
if [ -n "$outside" ]; then
  echo "FAIL: the build wrote outside \$HOME/.overdeck:" >&2
  echo "$outside" >&2
  status=1
fi

other_packs=$(find "$H/.overdeck/packs" -mindepth 1 -maxdepth 1 -not -name sageox)
if [ -n "$other_packs" ]; then
  echo "FAIL: the build wrote under \$HOME/.overdeck/packs outside sageox/:" >&2
  echo "$other_packs" >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "OK: nothing outside \$HOME/.overdeck and nothing under packs/ except sageox/"
fi
exit "$status"
