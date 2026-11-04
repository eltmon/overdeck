#!/usr/bin/env bash
# Build a signed, verified Overdeck release App Bundle for Google Play (PAN-4841 WI-4).
#
#   apps/mobile/scripts/build-android.sh --build <n> [--version-name <x.y>]
#       [--keystore <path>] [--password-file <path>] [--alias <name>]
#
# The upload key's password is read from a file into the environment, never onto a command line.
# The bundle lands in apps/mobile/release/overdeck-<x.y>-<n>.aab (ignored by git).

set -euo pipefail

usage() {
    cat >&2 <<'USAGE'
Usage: apps/mobile/scripts/build-android.sh --build <n> [options]

  --build <n>             Android versionCode, a positive integer (required). Each Play upload needs a higher one.
  --version-name <x.y>    Android versionName (default 1.0).
  --keystore <path>       Upload keystore (default ~/.overdeck/secrets/android-upload.jks).
  --password-file <path>  File holding the keystore password (default ~/.overdeck/secrets/android-upload.password).
  --alias <name>          Key alias in the keystore (default overdeck-upload).
USAGE
}

build=""
version_name="1.0"
keystore="$HOME/.overdeck/secrets/android-upload.jks"
password_file="$HOME/.overdeck/secrets/android-upload.password"
alias_name="overdeck-upload"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --build) build="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --version-name) version_name="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --keystore) keystore="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --password-file) password_file="${2:-}"; shift 2 || { usage; exit 2; } ;;
        --alias) alias_name="${2:-}"; shift 2 || { usage; exit 2; } ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    esac
done

if [[ ! "$build" =~ ^[1-9][0-9]*$ ]]; then
    usage
    exit 2
fi

# Resolve the caller's paths before moving to the repo root.
keystore="$(realpath -m -- "$keystore")"
password_file="$(realpath -m -- "$password_file")"
cd "$(dirname "$0")/../../.."

readonly PIN_FILE="apps/mobile/android/upload-certificate.sha1"
readonly SERVICES_JSON="apps/mobile/android/app/google-services.json"
readonly AAB_PATH="apps/mobile/android/app/build/outputs/bundle/release/app-release.aab"

for required in "$keystore" "$password_file" "$PIN_FILE" "$SERVICES_JSON"; do
    if [[ ! -f "$required" ]]; then
        echo "Required file is missing: $required" >&2
        exit 1
    fi
done

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export PATH="$JAVA_HOME/bin:$PATH"
sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
printf 'sdk.dir=%s\n' "$sdk_dir" > apps/mobile/android/local.properties

npm --prefix apps/mobile run build
npm --prefix apps/mobile run cap:sync -- android

export OVERDECK_UPLOAD_KEYSTORE="$keystore"
export OVERDECK_UPLOAD_KEY_ALIAS="$alias_name"
export OVERDECK_UPLOAD_STORE_PASSWORD OVERDECK_UPLOAD_KEY_PASSWORD
OVERDECK_UPLOAD_STORE_PASSWORD="$(<"$password_file")"
OVERDECK_UPLOAD_KEY_PASSWORD="$OVERDECK_UPLOAD_STORE_PASSWORD"

(
    cd apps/mobile/android
    ./gradlew --no-daemon bundleRelease -PoverdeckVersionCode="$build" -PoverdeckVersionName="$version_name"
)

if [[ ! -f "$AAB_PATH" ]]; then
    echo "The release build did not produce $AAB_PATH" >&2
    exit 1
fi

if ! jarsigner -verify "$AAB_PATH" >/dev/null 2>&1; then
    echo "Signature verification failed for $AAB_PATH" >&2
    jarsigner -verify "$AAB_PATH" >&2 || true
    exit 1
fi

expected_sha1="$(tr -d '[:space:]' < "$PIN_FILE")"
actual_sha1="$({ keytool -printcert -jarfile "$AAB_PATH" 2>/dev/null || true; } | awk '/SHA1:/{print $2; exit}')"
if [[ "$actual_sha1" != "$expected_sha1" ]]; then
    echo "The bundle's signer does not match the pinned upload certificate ($PIN_FILE)." >&2
    echo "Expected SHA-1: $expected_sha1" >&2
    echo "Actual SHA-1:   ${actual_sha1:-<missing>}" >&2
    exit 1
fi

mkdir -p apps/mobile/release
output="apps/mobile/release/overdeck-$version_name-$build.aab"
cp "$AAB_PATH" "$output"
echo "Signed App Bundle: $PWD/$output"
echo "Upload certificate SHA-1: $actual_sha1"
