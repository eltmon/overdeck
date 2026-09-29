#!/usr/bin/env bash
# PAN-4331 W3: run the windows-smoke B-flow steps (3a-4f) inside a WSL distro and
# write one results JSON file (schema: .pan/drafts/PAN-4331.md "Results JSON schema").
#
# Usage (inside the distro):
#   probe-wsl.sh --subject <tgz> --fixture <dir> --out <results.json> \
#                [--wsl-status <file>] [--env wsl2|wsl1-fallback]
#
# --subject and --fixture are usually /mnt/<drive> paths; both are copied into
# the Linux filesystem first, and the B-flow runs in ~/w/proj with a Linux HOME,
# never under /mnt. --wsl-status is the `wsl --status; wsl -l -v` output the
# workflow captured on the Windows side; it is the evidence of step 5a.
#
# Installs Node 22 into ~/node and `@anthropic-ai/claude-code` globally into it
# (3e/3g need a Linux claude). Steps 1a-2b are not-run: the dashboard is not in
# scope for the WSL row. Every step runs in its own function; a failing or
# broken step is recorded and the next one still runs (NFR-1).
set -o pipefail

ENV_NAME=wsl2
SUBJECT_IN=
FIXTURE_IN=
OUT=
WSL_STATUS=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --subject) SUBJECT_IN="$2"; shift 2 ;;
    --fixture) FIXTURE_IN="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --wsl-status) WSL_STATUS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$SUBJECT_IN" || -z "$FIXTURE_IN" || -z "$OUT" ]]; then
  echo "usage: $0 --subject <tgz> --fixture <dir> --out <json> [--wsl-status <file>] [--env <name>]" >&2
  exit 2
fi

CATALOGUE=(1a 1b 1c 1d 2a 2b 3a 3b 3c 3d 3e 3f 3g 4a 4b 4c 4d 4e 4f 5a)
ZERO_SESSION=00000000-0000-4000-8000-000000000000
WORK="$(mktemp -d)"
STEPS_FILE="$WORK/steps.jsonl"
: > "$STEPS_FILE"
CLONE="$HOME/w/proj"
export NO_COLOR=1

# ---- helpers ----------------------------------------------------------------

# run <timeout-s> <cmd...>: stdin closed; sets RUN_OUT (stdout+stderr) and RUN_CODE.
run() {
  RUN_OUT="$(timeout --kill-after=10 "$1" "${@:2}" </dev/null 2>&1)"
  RUN_CODE=$?
  if [[ $RUN_CODE -eq 124 || $RUN_CODE -eq 137 ]]; then RUN_OUT+=$'\n'"[probe: killed after $1 s]"; fi
}

run_pan() { run "${PAN_TIMEOUT:-300}" npx --yes -p "$SUBJECT" pan "$@"; }

# record <id> <status> <command> <exitCode or ""> <evidence> [note]
record() {
  ID="$1" STATUS="$2" COMMAND="$3" CODE="$4" EVIDENCE="$5" NOTE="${6:-}" STEPS_FILE="$STEPS_FILE" node -e '
const { appendFileSync } = require("node:fs");
const e = process.env;
const evidence = e.EVIDENCE.length > 4000 ? e.EVIDENCE.slice(-4000) : e.EVIDENCE;
const seconds = e.STEP_START ? Math.round((Date.now() / 1000 - Number(e.STEP_START)) * 10) / 10 : null;
appendFileSync(e.STEPS_FILE, JSON.stringify({
  id: e.ID, status: e.STATUS, command: e.COMMAND,
  exitCode: e.CODE === "" ? null : Number(e.CODE), evidence, note: e.NOTE, seconds,
}) + "\n");
'
}

# step <id> <function>: run one step body with errexit off inside it; a body
# that returns without recording anything is recorded as fail.
step() {
  local id="$1" fn="$2" before after
  before=$(wc -l < "$STEPS_FILE")
  set +e
  ( set +e; export STEP_START; STEP_START="$(date +%s.%N)"; "$fn" )
  local code=$?
  after=$(wc -l < "$STEPS_FILE")
  if [[ "$after" -eq "$before" ]]; then
    record "$id" fail "$fn" "$code" "the step body exited $code without recording a result" 'the probe step failed'
  fi
}

pass_if() { if "$@"; then echo pass; else echo fail; fi }
fixture_field() { node -p "require('$FIXTURE/fixture.json')$1"; }

# ---- setup ----------------------------------------------------------------

SETUP_LOG="$WORK/setup.log"
{
  set +e
  echo "uname -r: $(uname -r)"
  if [[ $EUID -eq 0 ]]; then SUDO=; else SUDO=sudo; fi
  for pkg in git curl xz-utils; do
    bin=$pkg; [[ $pkg == xz-utils ]] && bin=xz
    if ! command -v "$bin" >/dev/null; then
      $SUDO apt-get update -qq && $SUDO apt-get install -y -qq "$pkg"
    fi
  done
  if [[ ! -x "$HOME/node/bin/node" ]]; then
    NODE_DIST=https://nodejs.org/dist/latest-v22.x
    NODE_TAR=$(curl -fsSL "$NODE_DIST/SHASUMS256.txt" | awk '/linux-x64\.tar\.xz$/ { print $2 }')
    mkdir -p "$HOME/node"
    curl -fsSL "$NODE_DIST/$NODE_TAR" | tar -xJ -C "$HOME/node" --strip-components=1
  fi
  export PATH="$HOME/node/bin:$PATH"
  npm install -g --silent @anthropic-ai/claude-code
  echo "node: $(command -v node) $(node --version)"
  echo "npx: $(command -v npx)"
  echo "claude: $(command -v claude) $(claude --version 2>&1)"
  echo "git: $(git --version)"
} > "$SETUP_LOG" 2>&1
export PATH="$HOME/node/bin:$PATH"

mkdir -p "$HOME/fx"
cp -r "$FIXTURE_IN"/. "$HOME/fx/"
FIXTURE="$HOME/fx"
SUBJECT="$HOME/$(basename "$SUBJECT_IN")"
cp "$SUBJECT_IN" "$SUBJECT"
SESSION_ID="$(fixture_field .sessionId)"
VAULT_ID="$(fixture_field .vaultId)"

PAN_TIMEOUT=600 run_pan --version
WARM_CODE=$RUN_CODE WARM_OUT=$RUN_OUT
mkdir -p "$HOME/w"
CLONE_OUT="$(git clone "$FIXTURE/origin.git" "$CLONE" 2>&1)"
CLONE_CODE=$?
git_config() { git -C "$CLONE" config --get "$1" 2>/dev/null || echo '(unset)'; }

# ---- 1a-2b: out of scope --------------------------------------------------

for id in 1a 1b 1c 1d 2a 2b; do
  record "$id" not-run '' '' '' 'dashboard not in scope for WSL row'
done

# ---- 3a-3d ----------------------------------------------------------------

step_3a() {
  run_pan vault join "$FIXTURE/vault.git" --passphrase-file "$FIXTURE/passphrase.txt"
  record 3a "$( [[ $RUN_CODE -eq 0 ]] && echo pass || echo fail )" \
    "npx --yes -p $SUBJECT pan vault join $FIXTURE/vault.git --passphrase-file $FIXTURE/passphrase.txt" "$RUN_CODE" "$RUN_OUT"
}

step_3b() {
  run_pan vault list --json
  local status=fail
  [[ $RUN_CODE -eq 0 && "$RUN_OUT" == *"$SESSION_ID"* ]] && status=pass
  record 3b "$status" "npx --yes -p $SUBJECT pan vault list --json" "$RUN_CODE" "$RUN_OUT"
}

RESUME_OUT=
MATERIALIZED=
NEW_SESSION=
step_3c() {
  run_pan vault resume "$VAULT_ID" --cwd "$CLONE" --no-launch --on-drift continue
  printf '%s' "$RUN_OUT" > "$WORK/resume.out"
  local status=fail
  if [[ $RUN_CODE -eq 0 ]] && grep -qE '^Materialized [0-9]+ lines? to ' "$WORK/resume.out" \
    && grep -qE "claude --resume '?[0-9a-fA-F-]{36}" "$WORK/resume.out"; then
    status=pass
  fi
  record 3c "$status" "npx --yes -p $SUBJECT pan vault resume $VAULT_ID --cwd $CLONE --no-launch --on-drift continue" "$RUN_CODE" "$RUN_OUT"
}

step_3d() {
  if [[ -z "$MATERIALIZED" ]]; then
    record 3d not-run '' '' '' '3c failed: no "Materialized ... to <path>" line'
    return
  fi
  local projects="$HOME/.claude/projects" evidence status
  evidence="$(MAT="$MATERIALIZED" ROOT="$projects" CLONE="$CLONE" node -e '
const { existsSync, readFileSync } = require("node:fs");
const { resolve, dirname, basename, sep } = require("node:path");
const { MAT, ROOT, CLONE } = process.env;
const exists = existsSync(MAT);
const under = resolve(MAT).startsWith(resolve(ROOT) + sep);
let cwds = [];
if (exists) cwds = readFileSync(MAT, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l).cwd);
const cwdOk = cwds.length > 0 && cwds.every((c) => c === CLONE);
console.log([`path: ${MAT}`, `expected under: ${ROOT}`, `exists: ${exists}`, `under projects root: ${under}`,
  `directory name: ${basename(dirname(resolve(MAT)))}`, `line cwds: ${[...new Set(cwds)].join(" | ")}`,
  `clone path: ${CLONE}`, `RESULT ${exists && under && cwdOk ? "pass" : "fail"}`].join("\n"));
' 2>&1)"
  status=fail
  [[ "$evidence" == *"RESULT pass"* ]] && status=pass
  record 3d "$status" 'inspect the materialized transcript printed by 3c' '' "${evidence%$'\n'RESULT *}"
}

# ---- 4a-4f (before anything launches claude in the clone) ---------------------

step_4a() {
  local line status=fail
  line="$(grep -m1 'code snapshot' <<<"$RESUME_OUT")"
  [[ "$RESUME_OUT" == *"Applied code snapshot"* ]] && status=pass
  record 4a "$status" 'code snapshot outcome printed by 3c' '' "${line:-$RESUME_OUT}" \
    "$( [[ $status == pass ]] || echo 'no "Applied code snapshot" line' )"
}

step_4b() {
  local unpushed lf_ok log_ok=false untracked_ok=false log
  unpushed="$(fixture_field .expected.unpushedSubject)"
  lf_ok="$(CLONE="$CLONE" node -e '
const { existsSync, readFileSync } = require("node:fs");
const path = `${process.env.CLONE}/lf.txt`;
const expected = require(process.argv[1]).expected["lf.txt"];
console.log(existsSync(path) && readFileSync(path, "utf8").replace(/\r\n/g, "\n") === expected);
' "$FIXTURE/fixture.json" 2>&1)"
  [[ "$lf_ok" == true ]] || lf_ok=false
  log="$(git -C "$CLONE" log --format=%s 2>&1)"
  grep -qxF "$unpushed" <<<"$log" && log_ok=true
  [[ -f "$CLONE/notes-untracked.txt" ]] && untracked_ok=true
  local status=fail
  $lf_ok && $log_ok && $untracked_ok && status=pass
  record 4b "$status" 'compare lf.txt, git log and notes-untracked.txt with fixture.json' '' \
    "lf.txt matches after LF normalization: $lf_ok
git log contains '$unpushed': $log_ok
$log
notes-untracked.txt exists: $untracked_ok"
}

step_4c() {
  local porcelain code actual expected status=fail
  porcelain="$(git -C "$CLONE" status --porcelain 2>&1)"
  code=$?
  actual="$(cut -c4- <<<"$porcelain" | sed '/^$/d' | sort)"
  expected="$(node -p "require('$FIXTURE/fixture.json').expected.changedPaths.join('\n')" | sort)"
  [[ $code -eq 0 && "$actual" == "$expected" ]] && status=pass
  record 4c "$status" "git status --porcelain in $CLONE" "$code" \
    "$porcelain
expected paths: $(paste -sd, <<<"$expected")
actual paths: $(paste -sd, <<<"$actual")"
}

step_4d() {
  local evidence status note
  evidence="$(CLONE="$CLONE" node -e '
const { existsSync, readFileSync } = require("node:fs");
const counts = {};
const out = [];
for (const name of ["lf.txt", "crlf.txt"]) {
  const path = `${process.env.CLONE}/${name}`;
  if (!existsSync(path)) { counts[name] = null; out.push(`${name}: missing`); continue; }
  const bytes = readFileSync(path);
  let crlf = 0;
  for (let i = 1; i < bytes.length; i++) if (bytes[i] === 10 && bytes[i - 1] === 13) crlf++;
  counts[name] = crlf;
  out.push(`${name}: ${bytes.length} bytes, ${crlf} CRLF, hex ${bytes.toString("hex").toUpperCase()}`);
}
const missing = counts["lf.txt"] === null || counts["crlf.txt"] === null;
out.push(`RESULT ${missing ? "fail" : counts["lf.txt"] === 0 && counts["crlf.txt"] === 2 ? "pass" : "partial"}`);
console.log(out.join("\n"));
' 2>&1)"
  status=partial note='line endings differ from the Linux working tree (lf.txt 0 CRLF, crlf.txt 2 CRLF)'
  [[ "$evidence" == *"RESULT pass"* ]] && status=pass note=
  [[ "$evidence" == *"RESULT fail"* ]] && status=fail note='lf.txt or crlf.txt is missing'
  record 4d "$status" 'CRLF counts of lf.txt and crlf.txt' '' \
    "core.autocrlf: $(git_config core.autocrlf)
${evidence%$'\n'RESULT *}" "$note"
}

step_4e() {
  # The snapshot arrives unstaged, so run.sh is untracked; stage it into a
  # scratch index to read the mode git records without touching the clone's.
  local ls add mode status=fail
  add="$(GIT_INDEX_FILE="$WORK/exec-bit.index" git -C "$CLONE" read-tree HEAD 2>&1 \
    && GIT_INDEX_FILE="$WORK/exec-bit.index" git -C "$CLONE" add -- run.sh 2>&1)"
  ls="$(GIT_INDEX_FILE="$WORK/exec-bit.index" git -C "$CLONE" ls-files -s -- run.sh 2>&1)"
  mode="${ls%% *}"
  [[ "$mode" == 100755 ]] && status=pass
  record 4e "$status" 'git ls-files -s run.sh (staged into a scratch index)' '' \
    "core.filemode: $(git_config core.filemode)
$add$ls" "mode ${mode:-(none)}"
}

step_4f() {
  local path="$CLONE/link-to-lf" base
  base="core.symlinks: $(git_config core.symlinks)"
  if [[ -L "$path" ]]; then
    record 4f pass 'link-to-lf is a symlink?' '' "$base
symlink -> $(readlink "$path")"
  elif [[ -f "$path" ]]; then
    record 4f partial 'link-to-lf is a symlink?' '' "$base
plain file: $(cat "$path")" 'link-to-lf is a plain file, not a symlink'
  else
    record 4f fail 'link-to-lf is a symlink?' '' "$base
link-to-lf is missing"
  fi
}

# ---- 3e-3g ----------------------------------------------------------------

step_3e() {
  if [[ -z "$NEW_SESSION" ]]; then
    record 3e not-run '' '' '' '3c failed: no new session id'
    return
  fi
  local a b a_code b_code evidence
  cd "$CLONE" || return 1
  run 60 claude --resume "$NEW_SESSION" -p ping; a="$RUN_OUT"; a_code=$RUN_CODE
  run 60 claude --resume "$ZERO_SESSION" -p ping; b="$RUN_OUT"; b_code=$RUN_CODE
  evidence="--- resume $NEW_SESSION (exit $a_code) ---
$a
--- resume $ZERO_SESSION (exit $b_code) ---
$b
--- $HOME/.claude/projects ---
$(ls -1 "$HOME/.claude/projects" 2>&1)"
  local cmd="claude --resume <3c id> -p ping; claude --resume $ZERO_SESSION -p ping (in $CLONE, 60 s each)"
  if [[ $a_code -eq 127 ]]; then
    record 3e fail "$cmd" "$a_code" "$evidence" 'claude did not start'
  elif [[ "$(tr -s '[:space:]' ' ' <<<"${a//$NEW_SESSION/<id>}")" != "$(tr -s '[:space:]' ' ' <<<"${b//$ZERO_SESSION/<id>}")" ]]; then
    record 3e pass "$cmd" "$a_code" "$evidence" 'outputs differ between the materialized id and a random id'
  elif [[ "$a" == *"No conversation found"* ]]; then
    record 3e fail "$cmd" "$a_code" "$evidence" 'Claude Code did not find the materialized session'
  else
    record 3e partial "$cmd" "$a_code" "$evidence" "file path matches Overdeck's slug; pickup not exercised: no Claude credentials in CI"
  fi
}

step_3f() {
  local node_home overdeck_home status=fail
  node_home="$(node -p "require('os').homedir()")"
  overdeck_home="${OVERDECK_HOME:-$node_home/.overdeck}"
  if [[ -d "$overdeck_home/vault" && "$overdeck_home" == "$node_home"/* && "$MATERIALIZED" == "$node_home"/* ]]; then status=pass; fi
  record 3f "$status" 'record HOME, USERPROFILE, os.homedir(), OVERDECK_HOME and the materialized path' '' \
    "HOME: $HOME
USERPROFILE: ${USERPROFILE:-}
os.homedir(): $node_home
OVERDECK_HOME: $overdeck_home (vault dir exists: $( [[ -d "$overdeck_home/vault" ]] && echo True || echo False ))
materialized: $MATERIALIZED"
}

step_3g() {
  # After 3c adopted the session this machine owns it, so resume prints nothing
  # of its own before spawning claude: any output is claude's or a spawn error.
  if [[ -z "$NEW_SESSION" ]]; then
    record 3g not-run '' '' '' '3c failed: the session was not adopted'
    return
  fi
  cd "$CLONE" || return 1
  PAN_TIMEOUT=90 run_pan vault resume "$VAULT_ID" --cwd "$CLONE" --on-drift continue
  local cmd="npx --yes -p $SUBJECT pan vault resume $VAULT_ID --cwd $CLONE --on-drift continue (launches claude; 90 s, stdin closed)"
  local text="${RUN_OUT//\[probe: killed after 90 s\]/}"
  text="$(sed '/^npm warn/d' <<<"$text" | tr -d '[:space:]')"
  if grep -qE 'EINVAL|ENOENT|spawn .*claude' <<<"$RUN_OUT"; then
    record 3g fail "$cmd" "$RUN_CODE" "$RUN_OUT" 'spawn error'
  elif [[ -n "$text" ]]; then
    record 3g pass "$cmd" "$RUN_CODE" "$RUN_OUT" 'claude produced output'
  elif [[ $RUN_CODE -eq 124 || $RUN_CODE -eq 137 ]]; then
    record 3g partial "$cmd" '' "$RUN_OUT" 'no output within 90 s'
  else
    record 3g fail "$cmd" "$RUN_CODE" "$RUN_OUT" 'exited without output'
  fi
}

step_5a() {
  local status_text='' status=fail
  if [[ -n "$WSL_STATUS" && -f "$WSL_STATUS" ]]; then
    # wsl.exe writes UTF-16LE; dropping the NUL bytes leaves readable ASCII.
    status_text="$(tr -d '\000\r' < "$WSL_STATUS")"
  else
    status_text="(no --wsl-status file)"
  fi
  [[ "$(uname -r)" == *WSL2* ]] && status=pass
  record 5a "$status" 'wsl --status; wsl -l -v (captured by the workflow); uname -r' '' \
    "$status_text
uname -r: $(uname -r)"
}

step 3a step_3a
step 3b step_3b
RESUME_OUT="$(cat "$WORK/resume.out" 2>/dev/null)"
step 3c step_3c
RESUME_OUT="$(cat "$WORK/resume.out" 2>/dev/null)"
MATERIALIZED="$(sed -nE 's/^Materialized [0-9]+ lines? to (.+)$/\1/p' <<<"$RESUME_OUT" | head -n1)"
NEW_SESSION="$(grep -oE "claude --resume '?[0-9a-fA-F-]{36}" <<<"$RESUME_OUT" | grep -oE '[0-9a-fA-F-]{36}' | head -n1)"
step 3d step_3d
step 4a step_4a
step 4b step_4b
step 4c step_4c
step 4d step_4d
step 4e step_4e
step 4f step_4f
step 3e step_3e
step 3f step_3f
step 3g step_3g
step 5a step_5a

# ---- write ----------------------------------------------------------------

mkdir -p "$(dirname "$OUT")"
ENV_NAME="$ENV_NAME" STEPS_FILE="$STEPS_FILE" OUT="$OUT" SUBJECT="$SUBJECT" CATALOGUE="${CATALOGUE[*]}" \
SETUP_LOG="$SETUP_LOG" WARM_CODE="$WARM_CODE" WARM_OUT="$WARM_OUT" CLONE="$CLONE" CLONE_CODE="$CLONE_CODE" \
CLONE_OUT="$CLONE_OUT" AUTOCRLF="$(git_config core.autocrlf)" SYMLINKS="$(git_config core.symlinks)" \
FILEMODE="$(git_config core.filemode)" MATERIALIZED="$MATERIALIZED" GIT_VERSION="$(git --version)" OS_DESC="$( (. /etc/os-release && echo "$PRETTY_NAME") 2>/dev/null )" \
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const { basename } = require("node:path");
const e = process.env;
const tail = (s) => (s.length > 4000 ? s.slice(-4000) : s);
const recorded = new Map();
for (const line of readFileSync(e.STEPS_FILE, "utf8").split("\n").filter(Boolean)) {
  const s = JSON.parse(line);
  if (!recorded.has(s.id)) recorded.set(s.id, s);
}
const steps = e.CATALOGUE.split(" ").map((id) => recorded.get(id) ?? {
  id, status: "not-run", command: "", exitCode: null, evidence: "", note: "the probe did not reach this step",
});
// Steps whose subject never happened keep their evidence; the status says why.
const byId = new Map(steps.map((s) => [s.id, s]));
const demote = (id, note) => {
  const s = byId.get(id);
  if (s && s.status !== "not-run") Object.assign(s, { status: "not-run", note });
};
if (!e.MATERIALIZED) demote("3f", "3c failed: nothing was materialized");
if (byId.get("4a")?.status !== "pass") {
  for (const id of ["4b", "4c", "4d", "4e", "4f"]) demote(id, "4a failed: the code snapshot was not applied");
}
const result = {
  env: e.ENV_NAME,
  runner: `${process.env.ImageOS || "windows-2022"} WSL (${e.OS_DESC}, kernel ${require("os").release()})`,
  node: process.version,
  git: e.GIT_VERSION,
  subject: `${basename(e.SUBJECT)} @ ${e.GITHUB_SHA || "local"}`,
  setup: tail(readFileSync(e.SETUP_LOG, "utf8")),
  subjectInstall: { exitCode: Number(e.WARM_CODE), evidence: tail(e.WARM_OUT) },
  clone: { path: e.CLONE, exitCode: Number(e.CLONE_CODE), evidence: tail(e.CLONE_OUT),
    "core.autocrlf": e.AUTOCRLF, "core.symlinks": e.SYMLINKS, "core.filemode": e.FILEMODE },
  steps,
};
writeFileSync(e.OUT, JSON.stringify(result, null, 2) + "\n");
for (const s of steps) console.log(`${s.id.padEnd(3)} ${s.status.padEnd(8)} ${s.note}`);
'
echo "wrote $OUT"
