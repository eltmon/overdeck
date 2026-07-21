import { join } from 'node:path';
import { getOverdeckHome } from './paths.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildGitGuardLines(agentId: string): string[] {
  const guardDir = join(getOverdeckHome(), 'agents', agentId, 'git-guard');
  const guardPath = join(guardDir, 'git');
  const pathForDoubleQuotes = guardDir.replace(/([\\"$`])/g, '\\$1');

  return [
    '_OVERDECK_REAL_GIT="$(command -v git)"',
    `mkdir -p ${shellQuote(guardDir)}`,
    `cat > ${shellQuote(guardPath)} <<EOF`,
    '#!/bin/sh',
    '_OVERDECK_REAL_GIT="$_OVERDECK_REAL_GIT"',
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
    '_overdeck_git_command="\\$(_overdeck_git_find_command "\\$@")"',
    'case "\\$_overdeck_git_command" in',
    '  rebase|stash)',
    '    echo "Overdeck agents must not run git \\$_overdeck_git_command directly. Use pan sync-main to sync main or pan done to submit." >&2',
    '    exit 1',
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
