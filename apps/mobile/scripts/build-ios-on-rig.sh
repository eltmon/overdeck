#!/usr/bin/env bash
# Build, archive and upload the Overdeck iOS app on the Mac rig, from this host (PAN-4841 WI-7).
#
#   apps/mobile/scripts/build-ios-on-rig.sh --build <n> --rig <user@host>
#       [--team <id>] [--key <path>] [--no-upload] [--dry-run]
#
# Signing needs the rig's unlocked login keychain, which an SSH session cannot use. So the script
# writes ~/release-ios/overdeck-<n>.command on the rig, opens it in Terminal on the rig's desktop,
# and follows its log (~/release-ios/overdeck-<n>.log) until it ends with "== DONE ==" or
# "== FAILED: <step> ==".

set -euo pipefail

usage() {
    cat >&2 <<'USAGE'
Usage: apps/mobile/scripts/build-ios-on-rig.sh --build <n> --rig <user@host> [options]

  --build <n>         CFBundleVersion for the app and both extensions, a positive integer (required).
  --rig <user@host>   The Mac rig's SSH address (required; DHCP changes it).
  --team <id>         Apple Developer team (default KUU2VM9GB9).
  --key <path>        SSH key for the rig (default ~/.ssh/gauntlet_air).
  --no-upload         Archive only; skip the export and App Store Connect upload.
  --dry-run           Print every command and the generated .command file; run nothing.
USAGE
}

build=""
rig=""
team="KUU2VM9GB9"
key="$HOME/.ssh/gauntlet_air"
upload=1
dry_run=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --build) build="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --rig) rig="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --team) team="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --key) key="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --no-upload) upload=0; shift ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    esac
done

if [[ ! "$build" =~ ^[1-9][0-9]*$ || -z "$rig" ]]; then
    usage
    exit 2
fi

cd "$(dirname "$0")/../../.."

readonly REMOTE_ROOT="overdeck-mobile"
readonly RELEASE_DIR="release-ios"
readonly NAME="overdeck-$build"
ssh_opts=(-o BatchMode=yes -i "$key")
rsync_ssh="ssh -o BatchMode=yes -i $(printf '%q' "$key")"

# Print a command; run it unless this is a dry run.
run() {
    printf '+'
    printf ' %q' "$@"
    printf '\n'
    if [[ "$dry_run" -eq 0 ]]; then
        "$@"
    fi
}

run npm --prefix apps/mobile run build
run npm --prefix apps/mobile run cap:sync -- ios

# The local Swift packages Capacitor references, as paths relative to the repo root.
spm_dir="apps/mobile/ios/App/CapApp-SPM"
packages=()
while IFS= read -r package_path; do
    packages+=("$(realpath -m --relative-to=. "$spm_dir/$package_path")")
done < <(grep -o 'path: "[^"]*"' "$spm_dir/Package.swift" | sed 's/^path: "//; s/"$//')

remote_dirs=("$REMOTE_ROOT/apps/mobile/ios" "$RELEASE_DIR")
for package in "${packages[@]}"; do
    remote_dirs+=("$REMOTE_ROOT/$package")
done
run ssh "${ssh_opts[@]}" "$rig" mkdir -p "${remote_dirs[@]}"
run rsync -aL --delete -e "$rsync_ssh" apps/mobile/ios/ "$rig:$REMOTE_ROOT/apps/mobile/ios/"
for package in "${packages[@]}"; do
    run rsync -aL --delete -e "$rsync_ssh" "$package/" "$rig:$REMOTE_ROOT/$package/"
done

project="\$HOME/$REMOTE_ROOT/apps/mobile/ios/App"
archive="\$HOME/$RELEASE_DIR/$NAME.xcarchive"
command_file="$(cat <<COMMAND
#!/bin/zsh
set -euo pipefail
export PATH=/opt/homebrew/bin:\$PATH
log="\$HOME/$RELEASE_DIR/$NAME.log"
: > "\$log"
exec >>"\$log" 2>&1

if ! xcodebuild -project "$project/App.xcodeproj" -scheme App -configuration Release \\
    -destination generic/platform=iOS -archivePath "$archive" \\
    -derivedDataPath "\$HOME/$REMOTE_ROOT/DerivedData" -allowProvisioningUpdates \\
    DEVELOPMENT_TEAM=$team CURRENT_PROJECT_VERSION=$build archive; then
    echo "== FAILED: archive =="
    exit 1
fi
COMMAND
)"
if [[ "$upload" -eq 1 ]]; then
    command_file+=$'\n'"$(cat <<COMMAND

if ! xcodebuild -exportArchive -archivePath "$archive" \\
    -exportOptionsPlist "$project/ExportOptions.plist" \\
    -exportPath "\$HOME/$RELEASE_DIR/$NAME-export" -allowProvisioningUpdates; then
    echo "== FAILED: export and upload =="
    exit 1
fi
COMMAND
)"
fi
command_file+=$'\necho "== DONE =="\n'

remote_command="$RELEASE_DIR/$NAME.command"
remote_log="$RELEASE_DIR/$NAME.log"
echo "+ write $rig:$remote_command:"
printf '%s' "$command_file" | sed 's/^/    /'
if [[ "$dry_run" -eq 0 ]]; then
    printf '%s' "$command_file" | ssh "${ssh_opts[@]}" "$rig" "cat > $remote_command && chmod +x $remote_command && rm -f $remote_log"
fi
run ssh "${ssh_opts[@]}" "$rig" open -a Terminal "$remote_command"

if [[ "$dry_run" -eq 1 ]]; then
    echo "+ follow $rig:$remote_log until == DONE == or == FAILED (60 minutes at most)"
    exit 0
fi

# Follow the log: print its last line when it changes, for up to 60 minutes.
last=""
deadline=$((SECONDS + 3600))
while (( SECONDS < deadline )); do
    line="$(ssh "${ssh_opts[@]}" "$rig" "tail -n 1 $remote_log 2>/dev/null" || true)"
    if [[ "$line" != "$last" ]]; then
        echo "$line"
        last="$line"
    fi
    if [[ "$line" == "== DONE ==" ]]; then
        ssh "${ssh_opts[@]}" "$rig" "/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' -c 'Print :ApplicationProperties:CFBundleVersion' $RELEASE_DIR/$NAME.xcarchive/Info.plist" \
            | paste -d' ' <(printf 'CFBundleShortVersionString\nCFBundleVersion\n') -
        exit 0
    fi
    if [[ "$line" == "== FAILED"* ]]; then
        ssh "${ssh_opts[@]}" "$rig" "tail -n 40 $remote_log" >&2 || true
        exit 1
    fi
    sleep 30
done
echo "Timed out after 60 minutes; the log is $rig:$remote_log" >&2
exit 1
