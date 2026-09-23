/**
 * Per-agent `git` shim installed on the agent's PATH by its launcher.
 *
 * The shim blocks the three history-moving commands agents must never run
 * against their own worktree (`rebase`, state-moving `stash`, `reset --hard`)
 * and passes everything else through to the real git.
 *
 * Two scoping rules keep the guard honest (PAN-3189):
 *
 *   1. It only fires when the git invocation targets the agent's own worktree
 *      (`guardRoot`). A `git rebase` inside a test fixture's temp repo is not
 *      the behavior this guard exists to prevent, and blocking it made the
 *      workspace test suite untrustworthy — which pushed agents onto weaker
 *      gates, or onto stripping the guard entirely.
 *   2. The launcher drops any *other* agent's guard directory from PATH before
 *      prepending its own, so a Flywheel-spawned agent never runs behind the
 *      orchestrator's shim inherited through the environment.
 *
 * `read-only` mode (PAN-3920 workers, `pan worker run --read-only`) is scoped
 * to the guarded workspace's *repository*, not its directory: a git call that
 * resolves (through the cwd, `-C`, `--git-dir`/`GIT_DIR` and `--work-tree`) to
 * the same `git rev-parse --git-common-dir` is refused unless it is a read.
 * That covers the primary checkout, every other worktree, and subdirectories.
 * It is a PATH shim that prevents accidental git writes, not a sandbox: an
 * absolute `/usr/bin/git` bypasses it, so does `OVERDECK_PAN_GIT_OP=1` (the
 * switch `pan`'s own git operations use), and file-system and network writes are
 * not restricted at all.
 */
import { join } from 'node:path';
import { getOverdeckHome } from './paths.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type GitGuardMode = 'default' | 'read-only';

/**
 * The read-only shim's decision logic, as plain POSIX sh. Every `$` is a
 * runtime expansion inside the shim, so `readOnlyShimLines` escapes them for
 * the unquoted heredoc the launcher writes the shim with.
 *
 * `_overdeck_ro_allowed` answers "is this invocation a read?":
 *   - always-read subcommands (status, diff, log, show, rev-parse, ...);
 *   - `config` only when its FIRST argument is --get, --get-all,
 *     --get-regexp, --list/-l (or the `get`/`list` subcommands), followed
 *     only by read options from an exact list;
 *   - `remote` only bare, `-v`, `show [-n]` or `get-url [--push|--all]`;
 *   - `branch` only `--show-current`, `--list`/`-l` with patterns, a bare
 *     listing, and the exact listing options (-a, -r, -v, -vv, --contains,
 *     --merged, --no-merged, --points-at, --sort=, --format=);
 *   - never `fetch`: it writes refs.
 *
 * `_overdeck_ro_common_dir` prints the canonical common git dir the
 * invocation resolves to, or nothing when it is not inside a repository.
 */
const READ_ONLY_SHIM_SH = [
  '_overdeck_ro_allowed() {',
  '  while [ "$#" -gt 0 ]; do',
  '    case "$1" in',
  '      -C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)',
  '        shift',
  '        [ "$#" -gt 0 ] && shift',
  '        ;;',
  '      --) shift; break ;;',
  '      -*) shift ;;',
  '      *) break ;;',
  '    esac',
  '  done',
  '  _ro_cmd="${1:-}"',
  '  [ "$#" -gt 0 ] && shift',
  '  case "$_ro_cmd" in',
  '    ""|status|diff|log|show|rev-parse|rev-list|ls-files|ls-tree|blame|cat-file|merge-base|describe|grep|shortlog|for-each-ref|show-ref|help|version)',
  '      return 0 ;;',
  // Exact-token allowlists only: git accepts unique prefixes of long options
  // and stops option parsing at the first plain argument, so a denylist or an
  // "a read flag appears somewhere" check can always be walked around.
  '    config)',
  '      case "${1:-}" in',
  '        --get|--get-all|--get-regexp|--list|-l|get|list) shift ;;',
  '        *) return 1 ;;',
  '      esac',
  '      for _ro_arg in "$@"; do',
  '        case "$_ro_arg" in',
  '          --local|--global|--system|--worktree|--show-origin|--show-scope|-z|--null|--name-only|--includes|--no-includes|--all|--regexp|--type=*|--default=*|--value=*|--url=*) ;;',
  '          -*) return 1 ;;',
  '        esac',
  '      done',
  '      return 0 ;;',
  '    remote)',
  '      while [ "$#" -gt 0 ]; do',
  '        case "$1" in -v|--verbose) shift ;; *) break ;; esac',
  '      done',
  '      [ "$#" -eq 0 ] && return 0',
  '      _ro_sub="$1"',
  '      shift',
  '      case "$_ro_sub" in',
  '        show) _ro_ok=" -n " ;;',
  '        get-url) _ro_ok=" --push --all " ;;',
  '        *) return 1 ;;',
  '      esac',
  '      for _ro_arg in "$@"; do',
  '        case "$_ro_arg" in',
  '          -*) case "$_ro_ok" in *" $_ro_arg "*) ;; *) return 1 ;; esac ;;',
  '        esac',
  '      done',
  '      return 0 ;;',
  '    branch)',
  '      _ro_list=0',
  '      _ro_value=0',
  '      for _ro_arg in "$@"; do',
  // --contains/--merged/--no-merged/--points-at take the next word as their commit.
  '        if [ "$_ro_value" = 1 ]; then',
  '          _ro_value=0',
  '          case "$_ro_arg" in -*) ;; *) continue ;; esac',
  '        fi',
  '        case "$_ro_arg" in',
  '          --show-current|--list|-l) _ro_list=1 ;;',
  '          -a|-r|-v|-vv|--all|--remotes|--verbose|--sort=*|--format=*) ;;',
  '          --contains|--no-contains|--merged|--no-merged|--points-at) _ro_list=1; _ro_value=1 ;;',
  '          --contains=*|--no-contains=*|--merged=*|--no-merged=*|--points-at=*) _ro_list=1 ;;',
  '          -*) return 1 ;;',
  // A plain word is a pattern in list mode, and a new branch name otherwise.
  '          *) [ "$_ro_list" = 1 ] || return 1 ;;',
  '        esac',
  '      done',
  '      return 0 ;;',
  '  esac',
  '  return 1',
  '}',
  '_overdeck_ro_common_dir() {',
  '  _ro_dir="$(pwd -P 2>/dev/null || pwd)"',
  '  _ro_gitdir=""',
  '  _ro_worktree=""',
  '  while [ "$#" -gt 0 ]; do',
  '    case "$1" in',
  '      -C)',
  '        shift',
  '        [ "$#" -gt 0 ] || break',
  '        case "$1" in /*) _ro_dir="$1" ;; *) _ro_dir="$_ro_dir/$1" ;; esac',
  '        shift ;;',
  '      -C?*)',
  '        _ro_c="${1#-C}"',
  '        case "$_ro_c" in /*) _ro_dir="$_ro_c" ;; *) _ro_dir="$_ro_dir/$_ro_c" ;; esac',
  '        shift ;;',
  '      --git-dir) shift; [ "$#" -gt 0 ] || break; _ro_gitdir="$1"; shift ;;',
  '      --git-dir=*) _ro_gitdir="${1#--git-dir=}"; shift ;;',
  '      --work-tree) shift; [ "$#" -gt 0 ] || break; _ro_worktree="$1"; shift ;;',
  '      --work-tree=*) _ro_worktree="${1#--work-tree=}"; shift ;;',
  '      -c|--namespace|--config-env|--super-prefix|--attr-source) shift; [ "$#" -gt 0 ] && shift ;;',
  '      --) break ;;',
  '      -*) shift ;;',
  '      *) break ;;',
  '    esac',
  '  done',
  '  (',
  '    cd "$_ro_dir" 2>/dev/null || exit 1',
  '    if [ -n "$_ro_gitdir" ]; then GIT_DIR="$_ro_gitdir"; export GIT_DIR; fi',
  '    if [ -n "$_ro_worktree" ]; then GIT_WORK_TREE="$_ro_worktree"; export GIT_WORK_TREE; fi',
  '    _ro_common="$("$_OVERDECK_REAL_GIT" rev-parse --git-common-dir 2>/dev/null)" || exit 1',
  '    [ -n "$_ro_common" ] || exit 1',
  '    cd "$_ro_common" 2>/dev/null && pwd -P',
  '  )',
  '}',
  '_overdeck_ro_allowed "$@" && exec "$_OVERDECK_REAL_GIT" "$@"',
  'if [ -n "$_OVERDECK_GUARD_COMMON" ]; then',
  '  _ro_target="$(_overdeck_ro_common_dir "$@")"',
  '  [ "$_ro_target" = "$_OVERDECK_GUARD_COMMON" ] || exec "$_OVERDECK_REAL_GIT" "$@"',
  'else',
  // Not a repository at launch: fall back to the directory scope.
  '  _ro_target="$(_overdeck_git_target_dir "$@")"',
  '  case "$_ro_target" in',
  '    "$_OVERDECK_GUARD_ROOT"|"$_OVERDECK_GUARD_ROOT"/*) ;;',
  '    *) exec "$_OVERDECK_REAL_GIT" "$@" ;;',
  '  esac',
  'fi',
  'echo "This worker is read-only: git $_overdeck_git_command is blocked in its repository (reads such as status, diff, log and show are allowed)." >&2',
  'exit 1',
];

/** The read-only tail of the shim, escaped for the launcher's unquoted heredoc. */
function readOnlyShimLines(): string[] {
  return READ_ONLY_SHIM_SH.map((line) => line.replace(/\$/g, '\\$'));
}

/**
 * Emit the launcher lines that materialize and install the per-agent git guard.
 *
 * @param agentId   Owning agent id — the guard lives in `~/.overdeck/agents/<id>/git-guard`.
 * @param guardRoot The agent's worktree. Only git commands targeting this
 *                  directory (or a descendant) are guarded.
 * @param mode      `read-only` refuses every non-read git subcommand in `guardRoot`.
 */
export function buildGitGuardLines(agentId: string, guardRoot: string, mode: GitGuardMode = 'default'): string[] {
  const readOnly = mode === 'read-only';
  const guardDir = join(getOverdeckHome(), 'agents', agentId, 'git-guard');
  const guardPath = join(guardDir, 'git');
  const pathForDoubleQuotes = guardDir.replace(/([\\"$`])/g, '\\$1');

  return [
    // Drop guard dirs inherited from whoever spawned us (the Flywheel
    // orchestrator, most often) so this agent runs behind its own guard only.
    // This MUST precede `command -v git`, or the agent's guard would resolve
    // "real git" to the foreign shim and delegate every call back into it.
    'IFS=\':\' read -r -a _overdeck_path_segments <<< "$PATH"',
    '_overdeck_kept_path=()',
    'for _overdeck_path_segment in "${_overdeck_path_segments[@]}"; do',
    '  [[ "$_overdeck_path_segment" == */git-guard ]] || _overdeck_kept_path+=("$_overdeck_path_segment")',
    'done',
    'PATH="$(IFS=\':\'; echo "${_overdeck_kept_path[*]}")"',
    'unset _overdeck_path_segments _overdeck_kept_path _overdeck_path_segment',
    '_OVERDECK_REAL_GIT="$(command -v git)"',
    // Resolve the worktree once, at launch, so the shim compares canonical paths.
    `_OVERDECK_GUARD_ROOT="$(cd ${shellQuote(guardRoot)} 2>/dev/null && pwd -P)"`,
    `[ -n "$_OVERDECK_GUARD_ROOT" ] || _OVERDECK_GUARD_ROOT=${shellQuote(guardRoot)}`,
    // Read-only mode guards the whole repository: resolve its common git dir once.
    ...(readOnly
      ? [`_OVERDECK_GUARD_COMMON="$(cd ${shellQuote(guardRoot)} 2>/dev/null && _overdeck_c="$("$_OVERDECK_REAL_GIT" rev-parse --git-common-dir 2>/dev/null)" && [ -n "$_overdeck_c" ] && cd "$_overdeck_c" 2>/dev/null && pwd -P)"`]
      : []),
    `mkdir -p ${shellQuote(guardDir)}`,
    `cat > ${shellQuote(guardPath)} <<EOF`,
    '#!/bin/sh',
    '_OVERDECK_REAL_GIT="$_OVERDECK_REAL_GIT"',
    '_OVERDECK_GUARD_ROOT="$_OVERDECK_GUARD_ROOT"',
    ...(readOnly ? ['_OVERDECK_GUARD_COMMON="$_OVERDECK_GUARD_COMMON"'] : []),
    'if [ "\\$OVERDECK_PAN_GIT_OP" = "1" ]; then',
    '  exec "\\$_OVERDECK_REAL_GIT" "\\$@"',
    'fi',
    '_overdeck_git_find_command() {',
    '  while [ "\\$#" -gt 0 ]; do',
    '    case "\\$1" in',
    '      -C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)',
    '        shift',
    '        [ "\\$#" -gt 0 ] && shift',
    '        ;;',
    '      -C?*|-c?*|--git-dir=*|--work-tree=*|--namespace=*|--config-env=*|--super-prefix=*|--attr-source=*)',
    '        shift',
    '        ;;',
    '      --)',
    '        shift',
    '        break',
    '        ;;',
    '      -*)',
    '        shift',
    '        ;;',
    '      *)',
    '        printf "%s\\n" "\\$1"',
    '        return',
    '        ;;',
    '    esac',
    '  done',
    '  [ "\\$#" -gt 0 ] && printf "%s\\n" "\\$1"',
    '}',
    // Which directory does this invocation actually operate on? `-C` values
    // accumulate relative to the previous one, exactly as real git resolves them.
    '_overdeck_git_target_dir() {',
    '  _overdeck_dir="\\$(pwd -P 2>/dev/null || pwd)"',
    '  while [ "\\$#" -gt 0 ]; do',
    '    case "\\$1" in',
    '      -C)',
    '        shift',
    '        [ "\\$#" -gt 0 ] || break',
    '        case "\\$1" in',
    '          /*) _overdeck_dir="\\$1" ;;',
    '          *) _overdeck_dir="\\$_overdeck_dir/\\$1" ;;',
    '        esac',
    '        shift',
    '        ;;',
    '      -C?*)',
    '        _overdeck_c_value="\\${1#-C}"',
    '        case "\\$_overdeck_c_value" in',
    '          /*) _overdeck_dir="\\$_overdeck_c_value" ;;',
    '          *) _overdeck_dir="\\$_overdeck_dir/\\$_overdeck_c_value" ;;',
    '        esac',
    '        shift',
    '        ;;',
    '      -c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)',
    '        shift',
    '        [ "\\$#" -gt 0 ] && shift',
    '        ;;',
    '      -c?*|--git-dir=*|--work-tree=*|--namespace=*|--config-env=*|--super-prefix=*|--attr-source=*)',
    '        shift',
    '        ;;',
    '      --)',
    '        break',
    '        ;;',
    '      -*)',
    '        shift',
    '        ;;',
    '      *)',
    '        break',
    '        ;;',
    '    esac',
    '  done',
    '  if [ -d "\\$_overdeck_dir" ]; then',
    '    (cd "\\$_overdeck_dir" 2>/dev/null && pwd -P) || printf "%s\\n" "\\$_overdeck_dir"',
    '  else',
    '    printf "%s\\n" "\\$_overdeck_dir"',
    '  fi',
    '}',
    '_overdeck_git_command="\\$(_overdeck_git_find_command "\\$@")"',
    ...(readOnly ? readOnlyShimLines() : [
      'case "\\$_overdeck_git_command" in',
      '  rebase|stash|reset) ;;',
      '  *) exec "\\$_OVERDECK_REAL_GIT" "\\$@" ;;',
      'esac',
      // Outside the agent's own worktree the guard has no business firing — that
      // is someone else's repository, most often a test fixture's temp repo.
      '_overdeck_git_target="\\$(_overdeck_git_target_dir "\\$@")"',
      'case "\\$_overdeck_git_target" in',
      '  "\\$_OVERDECK_GUARD_ROOT"|"\\$_OVERDECK_GUARD_ROOT"/*) ;;',
      '  *) exec "\\$_OVERDECK_REAL_GIT" "\\$@" ;;',
      'esac',
      'case "\\$_overdeck_git_command" in',
      '  rebase)',
      '    echo "Overdeck agents must not run git rebase directly. Use pan sync-main to sync main or pan done to submit." >&2',
      '    exit 1',
      '    ;;',
      '  stash)',
      '    _overdeck_stash_sub=""',
      '    _overdeck_after_stash=0',
      '    for _overdeck_git_arg in "\\$@"; do',
      '      if [ "\\$_overdeck_after_stash" = "1" ]; then',
      '        case "\\$_overdeck_git_arg" in',
      '          -*) ;;',
      '          *)',
      '            _overdeck_stash_sub="\\$_overdeck_git_arg"',
      '            break',
      '            ;;',
      '        esac',
      '      elif [ "\\$_overdeck_git_arg" = "stash" ]; then',
      '        _overdeck_after_stash=1',
      '      fi',
      '    done',
      '    case "\\$_overdeck_stash_sub" in',
      '      list|show)',
      '        ;;',
      '      *)',
      '        echo "Overdeck agents must not run git stash directly (read-only stash list/show are allowed). Use pan sync-main to sync main or pan done to submit." >&2',
      '        exit 1',
      '        ;;',
      '    esac',
      '    ;;',
      '  reset)',
      '    for _overdeck_git_arg in "\\$@"; do',
      '      if [ "\\$_overdeck_git_arg" = "--hard" ]; then',
      '        echo "Overdeck agents must not run git reset --hard. Commit, explicitly discard, or surface the state instead." >&2',
      '        exit 1',
      '      fi',
      '    done',
      '    ;;',
      'esac',
      'exec "\\$_OVERDECK_REAL_GIT" "\\$@"',
    ]),
    'EOF',
    `chmod 0755 ${shellQuote(guardPath)}`,
    `export PATH="${pathForDoubleQuotes}:$PATH"`,
  ];
}
