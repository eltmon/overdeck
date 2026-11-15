#!/bin/bash
# Bare-host smoke (PAN-5176): install Overdeck on a host that has Node 22, git
# and the OS's own system directories, and none of docker, tmux, systemctl,
# journalctl or brew on PATH, then check the three bug classes of PAN-5168,
# PAN-5169 and PAN-5170:
#
#   1. `pan up --no-resume --no-open --detach` must exit 0, pass /api/health and
#      print no line that asks for a tool the Herdr backend does not need.
#   2. The idle dashboard must stay within the per-OS idle budget per 30 s
#      window. On Linux the measure takes 3 back-to-back baseline windows and
#      3 idle windows and decides on min(idle) - min(baseline): the machine-
#      wide PID counter (every process AND thread, not just Overdeck's) sees
#      runner bursts of about +20 to +60 in either side in 5-7% of windows,
#      and min-of-3 keeps one such burst from moving the net by more than the
#      normal spread between that side's windows (PAN-5361). A failed Linux
#      check also reports a heuristic, /proc-based guess (traced spawn calls
#      plus live process-tree growth, never the verdict) at whether the
#      dashboard's own process tree accounts for the excess. On macOS it is
#      the traced spawn cost over one window each side, unchanged: the
#      child_process calls the dashboard makes, plus 5 for each call that
#      fails to spawn (macOS tries every one of the 6 PATH entries, one
#      process each). A hosted macOS runner's own process churn moves the
#      baseline by hundreds of PIDs per window, so the PID net cannot decide
#      there; it is still measured and reported (operator decision, PAN-5176).
#   3. No `spawn <tool> ENOENT` line may repeat in the logs.
#
# Every child runs under `env -i` with a fixed six-entry PATH and an isolated
# HOME inside --work-dir. The script refuses to run (exit 2) when any of ports
# 3010, 3011, 3012 or 8317 has a listener, because `pan up`/`pan down` stop
# whatever owns the dashboard ports. It deletes nothing: it creates --work-dir
# fresh and refuses when that directory already exists and is not empty.
#
# Runs under macOS /bin/bash 3.2: no associative arrays, no coreutils wall-clock
# wrapper, no GNU-only flags. Wall-clock caps use limit() below.
#
# Local usage (from the repo root, with no Overdeck dashboard running):
#   mkdir -p .tmp/smoke && bash scripts/bare-host-smoke.sh --tarball ".tmp/smoke/$(npm pack --ignore-scripts --pack-destination .tmp/smoke | tail -1)" --work-dir "$PWD/.tmp/smoke/run1"
#
# Exit codes: 0 every check passed, 1 a check failed, 2 setup error, 64 bad usage.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"

# PAN-5176 calibration 2026-11-13 (D14: budget = max(10, min(30, 3 x highest
# sample)), never above 30), from green runs on PR #5179:
#   macOS traced cost 25, 25, 25, 25, 25, 25 -> min(30, 75) = 30
#     (the known-bad 0.81.0 scores 126 on the same runner)
#   Linux PID net 10, 5, 6, 8 -> min(30, 30) = 30
#     (after the systemctl fix, #5181; 15 and 16 before it)
# PAN-5361 recalibration 2026-11-15 (same D14 rule) for the min-of-3 Linux
# measure, from 20 plain runs of the temporary bare-host-calibration workflow
# against @overdeck/core@0.86.0 (workflow run 43734201237; see "Calibration
# evidence" in .pan/drafts/pan-5361.md for the full table):
#   Linux PID net (min(idle)-min(baseline)): 27, 10, 6, 23, 12, 9, 24, 13, 26,
#     8, 13, 13, 14, 9, 2, 13, 13, 10, 24, 12 -> max(10, min(30, 3x27)) = 30
#     (unchanged; two --idle-spawner-ms 500 canary runs net 82 and 70, both
#     correctly failing and attributed to the dashboard tree)
#   macOS unchanged (one window per side, traced-cost): the 0.86.0 leg passed
#     at cost 25 with windowsPerSide 1; the 0.81.0 known-bad leg failed at
#     cost 127 with the expected tmux forbidden-tool lines.
IDLE_BUDGET_MACOS=30
IDLE_BUDGET_LINUX=30
BARE_PATH_ENTRIES=6
WINDOW_SECS=30
SETTLE_SECS=20
HEALTH_TIMEOUT_SECS=120
CHURN_SECS=20
# PAN-5361: Linux takes 3 windows per side (min-of-N absorbs one runner PID
# burst); macOS keeps the single window its traced-cost rule has always used.
WINDOWS_PER_SIDE_LINUX=3
WINDOWS_PER_SIDE_MACOS=1

DENIED_TOOLS="docker tmux systemctl journalctl brew"
GUARDED_PORTS="3010 3011 3012 8317"
# Lines that show pan up trying to install, or failing on, a tool the Herdr
# backend does not need. `tmux not found\. Installing` (v0.81.0) is matched,
# but not PAN-5169's intended warning "tmux not found — the Herdr terminal
# backend does not need it; ...", after which pan up carries on.
FORBIDDEN_LINE_RE='tmux not found\. Installing|Failed to install tmux|brew: command not found|Install manually: brew|docker: command not found|systemctl: command not found|journalctl: command not found'
HERDR_INSTALL_URL='https://herdr.dev/install.sh'

TARBALL=''
VERSION=''
WORK_DIR=''
OUT=''
BUDGET=''
IDLE_SPAWNER_MS=''
SUBJECT=''
OS_NAME=''
WINDOWS_PER_SIDE=''
BARE_PATH=''
RUN_USER=''
CORE=''
NODE_BIN=''

# Result fields, exported to write_result.
R_SETUP_ERROR=''
R_PANUP_RC=''
R_PANUP_HEALTHY=false
R_PANUP_PASS=false
R_IDLE_BOOTED=false
R_IDLE_STAYED_UP=false
R_ENOENT_PASS=false
# PAN-5361: one entry per window, space separated, appended by take_windows().
# R_IDLE_FROM/R_IDLE_TO are stamped for the idle side only. R_IDLE_TREE stays
# empty until WI-3 adds the /proc snapshot.
R_BASELINE_WINDOWS=''
R_IDLE_WINDOWS=''
R_IDLE_FROM=''
R_IDLE_TO=''
R_IDLE_TREE=''
R_IDLE_SPAWNER_MS=''

usage() {
  cat <<'EOF'
Usage: bare-host-smoke.sh (--tarball <path> | --version <npm version>) --work-dir <dir>
                          [--out <result.json>] [--budget <n>]

  --tarball <path>     Install this @overdeck/core tarball (from npm pack).
  --version <version>  Install @overdeck/core@<version> from npm.
  --work-dir <dir>     Fresh directory for HOME, tools and logs (required; must
                       not exist or must be empty).
  --out <file>         Where to write the JSON result (default <work-dir>/result.json).
  --budget <n>         Idle budget (default 30 on macOS and on Linux). On
                       Linux: new PIDs per 30 s window, min(idle) - min
                       (baseline) over 3 windows per side. On macOS: the
                       traced spawn cost over 1 window per side (unchanged).
  --idle-spawner-ms <n> Load a preload into the idle dashboard server only
                       that spawns `true` every <n> ms (whole number >= 50).
                       The positive control for the Linux idle measure: it
                       must fail pid-net and blame the dashboard tree.
  --help               Print this help.

Exit codes: 0 pass, 1 a check failed, 2 setup error, 64 bad usage.
EOF
}

bad_usage() {
  echo "bare-host-smoke: $1" >&2
  usage >&2
  exit 64
}

# limit <seconds> <cmd...>: run with a wall-clock cap (macOS has no coreutils
# wrapper for this). From the Flywheel reference check in the PAN-5176 issue,
# plus one change: the guard writes nothing to the caller's output, so a guard
# sleep that outlives a finished command holds no log or step output open.
limit() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) >/dev/null 2>&1 & local guard=$!
  wait "$pid" 2>/dev/null; local rc=$?
  kill "$guard" 2>/dev/null
  return $rc
}

# bare [NAME=value...] <cmd...>: exec cmd under env -i with only the FR-4
# variables. It execs, so call it only under limit or as a background job;
# then $! is the command's own PID.
bare() {
  exec env -i \
    HOME="$WORK_DIR/home" \
    PATH="$BARE_PATH" \
    USER="$RUN_USER" \
    LOGNAME="$RUN_USER" \
    SHELL=/bin/bash \
    LANG=en_US.UTF-8 \
    TMPDIR="$WORK_DIR/tmp" \
    OVERDECK_TELEMETRY=0 \
    "$@"
}

# new_pids <secs>: processes created on this machine in a <secs> window.
new_pids() {
  local a b
  a=$(sh -c 'echo $$')
  sleep "$1"
  b=$(sh -c 'echo $$')
  echo $((b - a))
}

# Linux only, called from take_windows at idle window boundaries. Builtins
# only (no command substitution, backtick or pipe): it adds no PID of its own
# to the counter. Sets TREE_PROCS and TREE_TASKS to the dashboard tree's
# totals: the root pid (the directly started server), every descendant
# reachable by its ppid chain, and any process whose /proc/<pid>/cmdline
# names a path under WORK_DIR/home or WORK_DIR/tools (the same two strings
# kill_work_processes matches, which also catches a daemonized child
# reparented away from the server). Indexed arrays only; bash 3.2 has no
# associative arrays.
tree_snapshot() {
  local root="$1" f line rest pid ppid thr i j n changed arg
  local -a all_pid all_ppid all_thr member
  TREE_PROCS=0
  TREE_TASKS=0
  n=0
  for f in /proc/[0-9]*/stat; do
    if ! read -r line 2>/dev/null <"$f"; then continue; fi
    pid=${line%% *}
    rest=${line##*) }
    set -f
    set -- $rest
    set +f
    ppid="$2"
    thr="${18}"
    all_pid[n]="$pid"
    all_ppid[n]="$ppid"
    all_thr[n]="$thr"
    member[n]=0
    if [ "$pid" = "$root" ]; then member[n]=1; fi
    while IFS= read -r -d '' arg; do
      case "$arg" in
        *"$WORK_DIR/home/"*) member[n]=1 ;;
      esac
      case "$arg" in
        *"$WORK_DIR/tools/"*) member[n]=1 ;;
      esac
    done 2>/dev/null <"/proc/$pid/cmdline"
    (( n += 1 ))
  done
  changed=1
  while [ "$changed" -eq 1 ]; do
    changed=0
    i=0
    while [ "$i" -lt "$n" ]; do
      if [ "${member[i]}" -eq 0 ]; then
        j=0
        while [ "$j" -lt "$n" ]; do
          if [ "${all_pid[j]}" = "${all_ppid[i]}" ] && [ "${member[j]}" -eq 1 ]; then
            member[i]=1
            changed=1
          fi
          (( j += 1 ))
        done
      fi
      (( i += 1 ))
    done
  done
  i=0
  while [ "$i" -lt "$n" ]; do
    if [ "${member[i]}" -eq 1 ]; then
      (( TREE_PROCS += 1 ))
      (( TREE_TASKS += all_thr[i] ))
    fi
    (( i += 1 ))
  done
}

# take_windows <side> [server]: side is "baseline" or "idle". Takes
# WINDOWS_PER_SIDE back-to-back WINDOW_SECS windows, appending each window's
# new-PID count to R_BASELINE_WINDOWS or R_IDLE_WINDOWS (space separated, one
# entry per window). For the idle side it also stamps each window's
# spawn-trace bounds into R_IDLE_FROM/R_IDLE_TO, so the traced cost never
# covers two windows: a retake after a PID-counter wrap restamps "from"
# before the retake, and the kept attempt's bounds are the ones appended. On
# Linux, for the idle side, it snapshots the dashboard tree (`server`)
# immediately before each window's "from" stamp as the start (replaced by a
# fresh snapshot before a retake's "from" stamp) and immediately after "to"
# as the end, appending "startProcs:startTasks:endProcs:endTasks" to
# R_IDLE_TREE. Call it directly, never in $(...), so its assignments reach
# the caller.
take_windows() {
  local side="$1" server="${2:-}" count=0 from to n start_procs start_tasks
  while [ "$count" -lt "$WINDOWS_PER_SIDE" ]; do
    if [ "$side" = idle ] && [ "$OS_NAME" = linux ]; then
      tree_snapshot "$server"
      start_procs=$TREE_PROCS
      start_tasks=$TREE_TASKS
    fi
    if [ "$OS_NAME" = darwin ]; then from="$(date +%s)000"; else from="$(date +%s%3N)"; fi
    n=$(new_pids "$WINDOW_SECS")
    if [ "$n" -lt 0 ]; then
      if [ "$side" = idle ] && [ "$OS_NAME" = linux ]; then
        tree_snapshot "$server"
        start_procs=$TREE_PROCS
        start_tasks=$TREE_TASKS
      fi
      if [ "$OS_NAME" = darwin ]; then from="$(date +%s)000"; else from="$(date +%s%3N)"; fi
      n=$(new_pids "$WINDOW_SECS")
    fi
    if [ "$OS_NAME" = darwin ]; then to="$(date +%s)999"; else to="$(date +%s%3N)"; fi
    if [ "$side" = idle ] && [ "$OS_NAME" = linux ]; then
      tree_snapshot "$server"
      R_IDLE_TREE="${R_IDLE_TREE:+$R_IDLE_TREE }${start_procs}:${start_tasks}:${TREE_PROCS}:${TREE_TASKS}"
    fi
    if [ "$side" = baseline ]; then
      R_BASELINE_WINDOWS="${R_BASELINE_WINDOWS:+$R_BASELINE_WINDOWS }$n"
    else
      R_IDLE_WINDOWS="${R_IDLE_WINDOWS:+$R_IDLE_WINDOWS }$n"
      R_IDLE_FROM="${R_IDLE_FROM:+$R_IDLE_FROM }$from"
      R_IDLE_TO="${R_IDLE_TO:+$R_IDLE_TO }$to"
    fi
    count=$((count + 1))
  done
}

write_result() {
  export R_SETUP_ERROR R_PANUP_RC R_PANUP_HEALTHY R_PANUP_PASS R_IDLE_BOOTED R_IDLE_STAYED_UP \
    R_BASELINE_WINDOWS R_IDLE_WINDOWS R_IDLE_FROM R_IDLE_TO R_IDLE_TREE R_IDLE_SPAWNER_MS R_ENOENT_PASS
  R_OS="$OS_NAME" R_SUBJECT="$SUBJECT" R_BUDGET="$BUDGET" R_WINDOW="$WINDOW_SECS" R_OUT="$OUT" \
    R_FORBIDDEN_FILE="$WORK_DIR/forbidden-lines.txt" R_ENOENT_FILE="$WORK_DIR/enoent-counts.txt" \
    R_TRACE_FILE="$WORK_DIR/spawn-trace.log" R_PATH_ENTRIES="$BARE_PATH_ENTRIES" \
    node "$SCRIPT_DIR/bare-host-smoke/result.mjs"
}

die_setup() {
  echo "bare-host-smoke: setup error: $1" >&2
  R_SETUP_ERROR="$1"
  write_result
  exit 2
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --tarball) [ $# -ge 2 ] || bad_usage "--tarball needs a path"; TARBALL="$2"; shift 2 ;;
      --version) [ $# -ge 2 ] || bad_usage "--version needs a version"; VERSION="$2"; shift 2 ;;
      --work-dir) [ $# -ge 2 ] || bad_usage "--work-dir needs a directory"; WORK_DIR="$2"; shift 2 ;;
      --out) [ $# -ge 2 ] || bad_usage "--out needs a file"; OUT="$2"; shift 2 ;;
      --budget) [ $# -ge 2 ] || bad_usage "--budget needs a number"; BUDGET="$2"; shift 2 ;;
      --idle-spawner-ms) [ $# -ge 2 ] || bad_usage "--idle-spawner-ms needs a number"; IDLE_SPAWNER_MS="$2"; shift 2 ;;
      *) bad_usage "unknown argument: $1" ;;
    esac
  done
  if [ -n "$TARBALL" ] && [ -n "$VERSION" ]; then bad_usage "pass exactly one of --tarball or --version"; fi
  if [ -z "$TARBALL" ] && [ -z "$VERSION" ]; then bad_usage "pass exactly one of --tarball or --version"; fi
  [ -n "$WORK_DIR" ] || bad_usage "--work-dir is required"
  case "$BUDGET" in
    '') ;;
    *[!0-9]*) bad_usage "--budget must be a whole number" ;;
  esac
  case "$IDLE_SPAWNER_MS" in
    '') ;;
    *[!0-9]*) bad_usage "--idle-spawner-ms must be a whole number" ;;
    *) [ "$IDLE_SPAWNER_MS" -ge 50 ] || bad_usage "--idle-spawner-ms must be >= 50" ;;
  esac
  R_IDLE_SPAWNER_MS="$IDLE_SPAWNER_MS"
  case "$WORK_DIR" in
    /*) ;;
    *) WORK_DIR="$PWD/$WORK_DIR" ;;
  esac
  while [ "${WORK_DIR%/}" != "$WORK_DIR" ] && [ "$WORK_DIR" != "/" ]; do WORK_DIR="${WORK_DIR%/}"; done
  [ "$WORK_DIR" != "/" ] || bad_usage "--work-dir must not be /"
  [ -n "$OUT" ] || OUT="$WORK_DIR/result.json"
  case "$OUT" in
    /*) ;;
    *) OUT="$PWD/$OUT" ;;
  esac
  # First check that can fail with a result file, so a refused directory is
  # never written to.
  check_work_dir_fresh

  case "$(uname -s)" in
    Darwin) OS_NAME=darwin; [ -n "$BUDGET" ] || BUDGET="$IDLE_BUDGET_MACOS"; WINDOWS_PER_SIDE="$WINDOWS_PER_SIDE_MACOS" ;;
    Linux) OS_NAME=linux; [ -n "$BUDGET" ] || BUDGET="$IDLE_BUDGET_LINUX"; WINDOWS_PER_SIDE="$WINDOWS_PER_SIDE_LINUX" ;;
    *) OS_NAME="$(uname -s)"; die_setup "unsupported OS $(uname -s); this smoke runs on macOS and Linux" ;;
  esac

  if [ -n "$TARBALL" ]; then
    [ -f "$TARBALL" ] || die_setup "tarball not found: $TARBALL"
    TARBALL="$(cd "$(dirname "$TARBALL")" && pwd -P)/$(basename "$TARBALL")"
    SUBJECT="$TARBALL"
  else
    SUBJECT="@overdeck/core@$VERSION"
  fi
}

# D8: refuse when a port has a listener on any address. Runs in the caller's
# normal environment, before the bare PATH exists. Fails closed.
check_ports() {
  local port probe=''
  if command -v lsof >/dev/null 2>&1; then
    probe=lsof
  elif command -v ss >/dev/null 2>&1; then
    probe=ss
  fi
  for port in $GUARDED_PORTS; do
    case "$probe" in
      lsof)
        if [ -n "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)" ]; then
          die_setup "port $port has a listener; stop Overdeck (or whatever owns port $port) before running the smoke"
        fi
        ;;
      ss)
        if [ -n "$(ss -ltnH "sport = :$port" 2>/dev/null)" ]; then
          die_setup "port $port has a listener; stop Overdeck (or whatever owns port $port) before running the smoke"
        fi
        ;;
      *) die_setup "cannot determine whether port $port is free: neither lsof nor ss is available" ;;
    esac
    if command -v curl >/dev/null 2>&1; then
      curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/" 2>/dev/null
      if [ $? -ne 7 ]; then
        die_setup "port $port answers on 127.0.0.1; stop Overdeck (or whatever owns port $port) before running the smoke"
      fi
    fi
  done
}

# Called from parse_args before any other check: a refused directory is left untouched.
check_work_dir_fresh() {
  if [ -e "$WORK_DIR" ]; then
    if [ ! -d "$WORK_DIR" ]; then
      case "$OUT" in "$WORK_DIR"/*) OUT='' ;; esac
      die_setup "--work-dir $WORK_DIR exists and is not a directory"
    fi
    if [ -n "$(ls -A "$WORK_DIR" 2>/dev/null)" ]; then
      # Never overwrite a previous run's result inside a directory we refuse.
      case "$OUT" in "$WORK_DIR"/*) OUT='' ;; esac
      die_setup "--work-dir $WORK_DIR exists and is not empty; pass a fresh directory"
    fi
  fi
}

create_work_dir() {
  mkdir -p "$WORK_DIR/home" "$WORK_DIR/tmp" "$WORK_DIR/tools/node-bin" "$WORK_DIR/tools/herdr-bin" \
    || die_setup "cannot create $WORK_DIR"
}

is_denied() {
  case " $DENIED_TOOLS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# D4: exactly six PATH entries on both OSes.
build_path() {
  local tools="$WORK_DIR/tools" node_dir tool src dir name entry path
  node_dir="$(dirname "$(command -v node)")" || die_setup "node is not on PATH"
  [ -n "$node_dir" ] || die_setup "node is not on PATH"
  for tool in node npm npx; do
    [ -x "$node_dir/$tool" ] || die_setup "$node_dir/$tool is missing"
    ln -s "$node_dir/$tool" "$tools/node-bin/$tool" || die_setup "cannot link $tool into $tools/node-bin"
  done
  NODE_BIN="$tools/node-bin/node"
  RUN_USER="$(id -un)"

  case "$OS_NAME" in
    darwin)
      BARE_PATH="$tools/node-bin:$tools/herdr-bin:/usr/bin:/bin:/usr/sbin:/sbin"
      ;;
    linux)
      for entry in usr-bin:/usr/bin bin:/bin usr-sbin:/usr/sbin sbin:/sbin; do
        dir="$tools/sys/${entry%%:*}"
        src="${entry#*:}"
        mkdir -p "$dir" || die_setup "cannot create $dir"
        for path in "$src"/*; do
          [ -e "$path" ] || [ -L "$path" ] || continue
          name="$(basename "$path")"
          if is_denied "$name"; then continue; fi
          ln -s "$path" "$dir/$name" 2>/dev/null
        done
      done
      BARE_PATH="$tools/node-bin:$tools/herdr-bin:$tools/sys/usr-bin:$tools/sys/bin:$tools/sys/usr-sbin:$tools/sys/sbin"
      ;;
  esac
}

check_denied_absent() {
  local tool found
  for tool in $DENIED_TOOLS; do
    found="$(PATH="$BARE_PATH"; hash -r; command -v "$tool" 2>/dev/null)"
    if [ -n "$found" ]; then die_setup "denied tool $tool is on the bare PATH at $found"; fi
  done
  found="$(PATH="$BARE_PATH"; hash -r; command -v node 2>/dev/null)"
  [ "$found" = "$NODE_BIN" ] || die_setup "node on the bare PATH is '$found', expected $NODE_BIN"
}

install_herdr() {
  local dir="$WORK_DIR/tools/herdr-bin" attempt
  for attempt in 1 2; do
    limit 180 sh -c 'curl -fsSL "$1" | HERDR_INSTALL_DIR="$2" sh' sh "$HERDR_INSTALL_URL" "$dir" \
      >>"$WORK_DIR/herdr-install.log" 2>&1
    if "$dir/herdr" --version >>"$WORK_DIR/herdr-install.log" 2>&1; then return 0; fi
    echo "bare-host-smoke: Herdr install attempt $attempt failed" >&2
  done
  die_setup "Herdr install failed twice; see $WORK_DIR/herdr-install.log"
}

install_subject() {
  local attempt
  CORE="$WORK_DIR/home/pkg/node_modules/@overdeck/core"
  for attempt in 1 2; do
    limit 600 bare "$WORK_DIR/tools/node-bin/npm" install --prefix "$WORK_DIR/home/pkg" --no-audit --no-fund "$SUBJECT" \
      >>"$WORK_DIR/install.log" 2>&1
    if [ -f "$CORE/dist/cli/index.js" ]; then return 0; fi
    echo "bare-host-smoke: npm install attempt $attempt failed" >&2
  done
  die_setup "npm install of $SUBJECT failed twice; see $WORK_DIR/install.log"
}

run_pan_up() {
  local up_log="$WORK_DIR/up.log"
  echo "== pan up --no-resume --no-open --detach"
  limit 180 bare "$NODE_BIN" "$CORE/dist/cli/index.js" up --no-resume --no-open --detach >"$up_log" 2>&1
  R_PANUP_RC=$?
  if grep -a -q 'passed /api/health' "$up_log"; then R_PANUP_HEALTHY=true; fi
  grep -a -i -E "$FORBIDDEN_LINE_RE" "$up_log" >"$WORK_DIR/forbidden-lines.txt"
  if [ "$R_PANUP_RC" -eq 0 ] && [ "$R_PANUP_HEALTHY" = true ] && [ ! -s "$WORK_DIR/forbidden-lines.txt" ]; then
    R_PANUP_PASS=true
  fi
  echo "pan up rc=$R_PANUP_RC healthy=$R_PANUP_HEALTHY"
}

kill_work_processes() {
  pkill "-$1" -f "$WORK_DIR/home/" 2>/dev/null
  pkill "-$1" -f "$WORK_DIR/tools/" 2>/dev/null
}

stop_all() {
  echo "== stop everything pan up started"
  limit 60 bare "$NODE_BIN" "$CORE/dist/cli/index.js" down >"$WORK_DIR/down.log" 2>&1
  kill_work_processes TERM
  sleep 3
  kill_work_processes KILL
  sleep 5
}

# Diagnostic only, never an assertion: a Node preload that appends one JSON
# line per child_process call (program, API, error code) to spawn-trace.log,
# so a failed idle window says which programs Overdeck spawned. It is loaded
# into the directly started dashboard (and the Node processes it starts) via
# NODE_OPTIONS; it spawns nothing itself.
write_spawn_tracer() {
  cat >"$WORK_DIR/tools/spawn-trace.cjs" <<'TRACER'
'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const file = process.env.OVERDECK_SPAWN_TRACE;
if (file && !cp.__overdeckSpawnTrace) {
  Object.defineProperty(cp, '__overdeckSpawnTrace', { value: true });
  let depth = 0;
  const optionsOf = (a) => a.slice(1, 3).find((x) => x && typeof x === 'object' && !Array.isArray(x));
  const shellOf = (api, a) => api === 'exec' || api === 'execSync' || Boolean(optionsOf(a)?.shell);
  const programOf = (api, a, shell) => {
    const target = String(a[0] ?? '');
    return path.basename(shell ? (target.trim().split(/\s+/)[0] || '') : target);
  };
  const log = (rec) => { try { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); } catch {} };
  for (const api of ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync']) {
    const orig = cp[api];
    if (typeof orig !== 'function') continue;
    const wrapped = function (...a) {
      if (depth > 0) return orig.apply(this, a);
      const shell = shellOf(api, a);
      const rec = { t: Date.now(), pid: process.pid, api, program: api === 'fork' ? 'node' : programOf(api, a, shell), shell };
      depth += 1;
      try {
        const r = orig.apply(this, a);
        // A shell that cannot find its program exits 127: a failure too.
        if (r && typeof r.once === 'function') {
          r.once('spawn', () => log({ ...rec, event: 'spawn' }));
          r.once('error', (e) => log({ ...rec, event: 'error', error: (e && e.code) || 'error' }));
          r.once('exit', (code) => { if (code === 127) log({ ...rec, event: 'exit', error: 'exit 127' }); });
        } else if (r && (r.error || r.status === 127)) {
          log({ ...rec, event: 'error', error: r.error ? r.error.code || 'error' : 'exit 127' });
        } else {
          log({ ...rec, event: 'spawn' });
        }
        return r;
      } catch (e) {
        log({ ...rec, event: 'error', error: e && e.status === 127 ? 'exit 127' : (e && e.code) || 'error' });
        throw e;
      } finally {
        depth -= 1;
      }
    };
    if (orig[promisify.custom]) {
      Object.defineProperty(wrapped, promisify.custom, {
        value: (...a) => {
          let child;
          const promise = new Promise((resolve, reject) => {
            child = wrapped(...a, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
          });
          promise.child = child;
          return promise;
        },
      });
    }
    cp[api] = wrapped;
  }
  require('module').syncBuiltinESMExports();
}
TRACER
}

# PAN-5361: the positive control for the Linux idle measure (--idle-spawner-ms).
# A Node preload that spawns `true` every <n> ms, loaded into the idle
# dashboard server only via NODE_OPTIONS: the argv[1] guard keeps it out of
# every other Node process the dashboard starts (child CLI invocations,
# etc.), since NODE_OPTIONS rides into all of them.
write_idle_spawner() {
  cat >"$WORK_DIR/tools/idle-spawner.cjs" <<'SPAWNER'
'use strict';
const ms = Number(process.env.OVERDECK_SMOKE_SPAWNER_MS);
if (ms > 0 && /[\\/]dist[\\/]dashboard[\\/]server\.js$/.test(process.argv[1] || '')) {
  const { spawn } = require('child_process');
  setInterval(() => { try { spawn('true', [], { stdio: 'ignore' }).on('error', () => {}); } catch {} }, ms).unref();
}
SPAWNER
}

# Diagnostic only, never an assertion, and outside both measured windows:
# with no Overdeck process alive, sample `ps` every 0.2 s for CHURN_SECS and
# count new processes by command, so a noisy baseline names its source.
# Short-lived processes between samples are missed, and ps and sleep from
# the sampler itself appear in the list.
sample_churn() {
  local end
  end=$(( $(date +%s) + CHURN_SECS ))
  {
    echo "== launchd jobs mentioning overdeck (darwin)"
    if [ "$OS_NAME" = darwin ]; then launchctl print "gui/$(id -u)" 2>/dev/null | grep -i overdeck; fi
    echo "== new processes per command in a ${CHURN_SECS} s ps sample, no Overdeck process alive"
    while [ "$(date +%s)" -lt "$end" ]; do ps -axo pid=,ppid=,comm= 2>/dev/null; echo '--'; sleep 0.2; done \
      | awk '$1 == "--" { n++; next } { pid = $1; $1 = ""; $2 = ""; sub(/^ +/, ""); if (!(pid in seen)) { seen[pid] = 1; if (n > 0) c[$0]++ } } END { for (k in c) printf "%6d %s\n", c[k], k }' \
      | sort -rn | head -25
  } >"$WORK_DIR/churn.log" 2>&1
  echo "== top background process churn (diagnostic, see churn.log)"
  sed -n '/^== new processes/,$p' "$WORK_DIR/churn.log" | sed -n '2,11p'
}

measure_idle() {
  local server waited=0 node_options
  sample_churn
  echo "== baseline window(s) (${WINDOWS_PER_SIDE} x ${WINDOW_SECS} s, no Overdeck process)"
  take_windows baseline
  echo "baseline new PIDs per window: $R_BASELINE_WINDOWS"

  echo "== dashboard server idle window"
  write_spawn_tracer
  node_options="--require \"$WORK_DIR/tools/spawn-trace.cjs\""
  if [ -n "$IDLE_SPAWNER_MS" ]; then
    write_idle_spawner
    node_options="$node_options --require \"$WORK_DIR/tools/idle-spawner.cjs\""
  fi
  bare OVERDECK_NO_RESUME=1 DASHBOARD_PORT=3010 API_PORT=3011 PORT=3011 OVERDECK_MODE=production \
    NODE_OPTIONS="$node_options" OVERDECK_SPAWN_TRACE="$WORK_DIR/spawn-trace.log" OVERDECK_SMOKE_SPAWNER_MS="$IDLE_SPAWNER_MS" \
    "$NODE_BIN" "$CORE/dist/dashboard/server.js" >"$WORK_DIR/server.log" 2>&1 &
  server=$!
  while [ "$waited" -lt "$HEALTH_TIMEOUT_SECS" ]; do
    if curl -sf --max-time 2 -o /dev/null http://127.0.0.1:3011/api/health; then R_IDLE_BOOTED=true; break; fi
    sleep 2
    waited=$((waited + 2))
  done

  if [ "$R_IDLE_BOOTED" = true ]; then
    sleep "$SETTLE_SECS"
    take_windows idle "$server"
    echo "idle new PIDs per window: $R_IDLE_WINDOWS (the verdict is in the summary below)"
    # A dashboard that died during the window spawns nothing, so an empty
    # trace would pass: it must still be running and healthy afterwards.
    if kill -0 "$server" 2>/dev/null && curl -sf --max-time 5 -o /dev/null http://127.0.0.1:3011/api/health; then
      R_IDLE_STAYED_UP=true
    else
      echo "the dashboard stopped or stopped answering /api/health during the idle window; see $WORK_DIR/server.log"
    fi
  else
    echo "dashboard never answered /api/health within ${HEALTH_TIMEOUT_SECS} s; see $WORK_DIR/server.log"
  fi

  kill -TERM "$server" 2>/dev/null
  sleep 5
  kill -KILL "$server" 2>/dev/null
  kill_work_processes TERM
  sleep 3
  kill_work_processes KILL
}

scan_enoent() {
  local file
  : >"$WORK_DIR/enoent-counts.txt"
  for file in "$WORK_DIR/up.log" "$WORK_DIR/server.log" "$WORK_DIR"/home/.overdeck/logs/*.log; do
    [ -f "$file" ] || continue
    grep -a -v -F '(skipped: not on PATH)' "$file" | grep -a -o -E 'spawn [A-Za-z0-9_./-]+ ENOENT'
  done | sort | uniq -c | sort -rn >"$WORK_DIR/enoent-counts.txt"
  if awk '$1 >= 2 { found = 1 } END { exit found ? 0 : 1 }' "$WORK_DIR/enoent-counts.txt"; then
    R_ENOENT_PASS=false
  else
    R_ENOENT_PASS=true
  fi
}

main() {
  parse_args "$@"
  check_ports
  create_work_dir
  build_path
  check_denied_absent
  install_herdr
  install_subject
  cd "$WORK_DIR/home" || die_setup "cannot enter $WORK_DIR/home"
  run_pan_up
  stop_all
  measure_idle
  scan_enoent
  # write_result decides the verdict (it owns the idle rule) and exits 0 on
  # pass, 1 otherwise.
  if write_result; then exit 0; fi
  exit 1
}

main "$@"
