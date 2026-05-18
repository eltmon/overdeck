#!/usr/bin/env bash
# Ad-hoc speak helper — POSTs arbitrary text to the local Qwen3-TTS daemon.
# Usage: say.sh "text to speak"
#
# Bypasses the activity-log feed so agents/humans can announce one-off
# messages (build complete, deploy finished, attention requests) without
# having to route through the dashboard event store.

set -euo pipefail

ENDPOINT="${QWEN_TTS_ENDPOINT:-http://127.0.0.1:8787/speak}"
TOKEN_PATH="${PANOPTICON_HOME:-$HOME/.panopticon}/secrets/qwen-tts.token"
TEXT="${*:-}"

if [[ -z "$TEXT" ]]; then
  echo "usage: say.sh \"text to speak\"" >&2
  exit 1
fi

python3 - "$TEXT" "$ENDPOINT" "$TOKEN_PATH" <<'PY'
import json, os, pathlib, sys, urllib.request, urllib.error
text, endpoint, token_path = sys.argv[1], sys.argv[2], sys.argv[3]
headers = {"Content-Type": "application/json"}
try:
    token = pathlib.Path(token_path).read_text(encoding="utf-8").strip()
except OSError:
    token = ""
token = token or os.environ.get("QWEN_TTS_AUTH_TOKEN", "").strip()
if token:
    headers["X-Panopticon-TTS-Token"] = token
body = json.dumps({"text": text}).encode("utf-8")
req = urllib.request.Request(endpoint, data=body, headers=headers)
try:
    resp = urllib.request.urlopen(req, timeout=5).read()
    print(resp.decode("utf-8"))
except urllib.error.URLError as e:
    print(f"[say] {e}", file=sys.stderr)
    sys.exit(1)
PY
