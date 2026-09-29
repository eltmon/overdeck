#!/usr/bin/env bash
# PAN-4331 W1: build, on Linux, the vault fixture the Windows and WSL probes continue.
#
# Usage: SUBJECT_TGZ=<overdeck-core-*.tgz> make-fixture.sh <out-dir>
#
# Creates under <out-dir>:
#   origin.git      bare project origin with one pushed commit
#   src/proj        the Linux checkout, with an unpushed commit and uncommitted work
#   vault.git       bare git vault backend holding the saved conversation and its code
#   passphrase.txt  the fixed test passphrase that unlocks the vault (NFR-3)
#   fixture.json    what the probes compare against
#   home/           the isolated HOME (vault key, list cache, transcript, npm cache)
#
# Every write lands under <out-dir>: git and pan run with HOME=<out-dir>/home, and
# pan runs under `env -i`, so the runner's real ~/.overdeck and ~/.claude stay
# untouched. The workflow uploads only origin.git, vault.git, passphrase.txt and
# fixture.json.
#
# `vault list --json` rows carry the vault id and a title, not the native session
# id. The first user message starts with the session id so it becomes the title;
# fixture.json records the vault id the probes pass to `vault resume`.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: SUBJECT_TGZ=<tgz> $0 <out-dir>" >&2
  exit 2
fi
: "${SUBJECT_TGZ:?SUBJECT_TGZ must name the packed @overdeck/core tarball}"
if [[ ! -f "$SUBJECT_TGZ" ]]; then
  echo "SUBJECT_TGZ=$SUBJECT_TGZ is not a file" >&2
  exit 2
fi

mkdir -p "$1"
OUT="$(cd "$1" && pwd -P)"
SUBJECT_TGZ="$(cd "$(dirname "$SUBJECT_TGZ")" && pwd -P)/$(basename "$SUBJECT_TGZ")"
SESSION_ID='11111111-2222-4333-8444-555555555555'
PASSPHRASE='windows smoke fixture passphrase 42'

export HOME="$OUT/home"
export GIT_CONFIG_NOSYSTEM=1
unset XDG_CONFIG_HOME GIT_CONFIG_GLOBAL
mkdir -p "$HOME"

# Run the subject CLI with only PATH, HOME and OVERDECK_HOME, so no OVERDECK_*,
# XDG_*, CODEX_HOME or npm_config_* from the caller's shell can redirect it.
# `npx <path-to-tgz>` runs the path as a command, so the tarball goes in -p.
run_pan() {
  env -i PATH="$PATH" HOME="$HOME" OVERDECK_HOME="$HOME/.overdeck" \
    npx --yes -p "$SUBJECT_TGZ" pan "$@"
}

# 1. Bare origin with one pushed commit.
git init --quiet --bare --initial-branch=main "$OUT/origin.git"
mkdir -p "$OUT/src/proj"
PROJ="$(cd "$OUT/src/proj" && pwd -P)"
git -C "$PROJ" init --quiet --initial-branch=main
git -C "$PROJ" config user.name 'windows-smoke fixture'
git -C "$PROJ" config user.email 'windows-smoke@overdeck.local'
git -C "$PROJ" remote add origin "$OUT/origin.git"
printf '# windows-smoke fixture\n' > "$PROJ/README.md"
printf 'a\nb\n' > "$PROJ/lf.txt"
git -C "$PROJ" add README.md lf.txt
git -C "$PROJ" commit --quiet -m 'fixture: initial commit'
git -C "$PROJ" push --quiet -u origin main

# 2. Unpushed and uncommitted work of every kind the probes check (steps 4a-4f).
printf 'unpushed\n' > "$PROJ/unpushed.txt"
git -C "$PROJ" add unpushed.txt
git -C "$PROJ" commit --quiet -m 'fixture: unpushed commit'
printf 'a\nb\nc\n' > "$PROJ/lf.txt"
printf 'x\r\ny\r\n' > "$PROJ/crlf.txt"
git -C "$PROJ" add crlf.txt
printf '#!/bin/sh\necho ok\n' > "$PROJ/run.sh"
chmod 755 "$PROJ/run.sh"
git -C "$PROJ" add run.sh
ln -s lf.txt "$PROJ/link-to-lf"
git -C "$PROJ" add link-to-lf
printf 'untracked notes\n' > "$PROJ/notes-untracked.txt"

# 3. A four-line Claude Code transcript whose cwd is the checkout. Each line
# carries the fields of tests/unit/lib/vault/materialize.test.ts `line()` plus
# the parentUuid chain, timestamp and version Claude Code needs to load it:
# with only the minimal fields `claude --resume` answers "No conversation found".
SLUG="${PROJ//[^A-Za-z0-9-]/-}"
TRANSCRIPT_DIR="$HOME/.claude/projects/$SLUG"
mkdir -p "$TRANSCRIPT_DIR"
SESSION_ID="$SESSION_ID" PROJ="$PROJ" TRANSCRIPT="$TRANSCRIPT_DIR/$SESSION_ID.jsonl" node -e '
const { writeFileSync } = require("node:fs");
const { SESSION_ID: sessionId, PROJ: cwd, TRANSCRIPT: path } = process.env;
const turns = [
  ["user", `windows smoke fixture ${sessionId}: list the files`],
  ["assistant", "README.md, lf.txt, crlf.txt, run.sh, link-to-lf and notes-untracked.txt."],
  ["user", "Add a third line to lf.txt."],
  ["assistant", "Done: lf.txt now reads a, b, c."],
];
let parentUuid = null;
const lines = turns.map(([type, text], i) => {
  const uuid = `${String(i + 1).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  const message = type === "user"
    ? { role: "user", content: text }
    : { id: `msg_fixture_${i + 1}`, type: "message", role: "assistant", model: "claude-sonnet-4-5",
        content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 } };
  const line = JSON.stringify({
    parentUuid, isSidechain: false, userType: "external", cwd, sessionId, version: "2.1.0",
    gitBranch: "main", type, uuid, timestamp: `2026-09-29T12:00:0${i}.000Z`, message,
  });
  parentUuid = uuid;
  return line;
});
writeFileSync(path, lines.join("\n") + "\n");
'

# 4. The fixed test passphrase.
printf '%s' "$PASSPHRASE" > "$OUT/passphrase.txt"

# 5. Vault backend, save, then sync so the list cache holds the record.
git init --quiet --bare --initial-branch=main "$OUT/vault.git"
run_pan vault setup "$OUT/vault.git" --passphrase-file "$OUT/passphrase.txt"
if ! SAVE_OUT="$(run_pan vault save "$SESSION_ID" 2>&1)"; then
  printf 'vault save failed:\n%s\n' "$SAVE_OUT" >&2
  exit 1
fi
printf '%s\n' "$SAVE_OUT"
if ! grep -q 'appended' <<<"$SAVE_OUT"; then
  printf 'vault save did not append the transcript:\n%s\n' "$SAVE_OUT" >&2
  exit 1
fi
run_pan vault sync

LIST_JSON="$(run_pan vault list --json)"
if ! grep -q "$SESSION_ID" <<<"$LIST_JSON"; then
  printf 'vault list --json does not list session %s:\n%s\n' "$SESSION_ID" "$LIST_JSON" >&2
  exit 1
fi

# 6. What the probes compare against.
CHANGED_PATHS="$(git -C "$PROJ" status --porcelain | cut -c4-)"
SESSION_ID="$SESSION_ID" LIST_JSON="$LIST_JSON" CHANGED_PATHS="$CHANGED_PATHS" OUT_FILE="$OUT/fixture.json" node -e '
const { writeFileSync } = require("node:fs");
const { SESSION_ID: sessionId, LIST_JSON, CHANGED_PATHS, OUT_FILE } = process.env;
const row = JSON.parse(LIST_JSON).find((r) => r.title.includes(sessionId));
if (!row) throw new Error(`no list row titled with ${sessionId}`);
const fixture = {
  sessionId,
  vaultId: row.vaultId,
  originBranch: "main",
  expected: {
    "lf.txt": "a\nb\nc\n",
    unpushedSubject: "fixture: unpushed commit",
    changedPaths: CHANGED_PATHS.split("\n").filter(Boolean),
  },
};
writeFileSync(OUT_FILE, JSON.stringify(fixture, null, 2) + "\n");
'
cat "$OUT/fixture.json"
