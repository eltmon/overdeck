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
 */
import { join } from 'node:path';
import { getOverdeckHome } from './paths.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Emit the launcher lines that materialize and install the per-agent git guard.
 *
 * @param agentId   Owning agent id — the guard lives in `~/.overdeck/agents/<id>/git-guard`.
 * @param guardRoot The agent's worktree. Only git commands targeting this
 *                  directory (or a descendant) are guarded.
 */
export function buildGitGuardLines(agentId: string, guardRoot: string): string[] {
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
    `mkdir -p ${shellQuote(guardDir)}`,
    `cat > ${shellQuote(guardPath)} <<EOF`,
    '#!/bin/sh',
    '_OVERDECK_REAL_GIT="$_OVERDECK_REAL_GIT"',
    '_OVERDECK_GUARD_ROOT="$_OVERDECK_GUARD_ROOT"',
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
    'EOF',
    `chmod 0755 ${shellQuote(guardPath)}`,
    `export PATH="${pathForDoubleQuotes}:$PATH"`,
  ];
}
