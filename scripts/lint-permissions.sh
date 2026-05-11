#!/usr/bin/env bash
#
# lint-permissions.sh — repo-wide guard against permission-flag leaks.
#
# Background: when the user has set Panopticon's permission mode to Auto
# (the default), no spawned `claude` process may receive
# `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`,
# or a settings.json with `defaultMode: "bypassPermissions"`. A regression
# that emits any of those silently escalates the user to "yolo" without
# their consent — a P0 trust violation.
#
# The DSP/bypass tokens are deliberately concentrated in a small allowlist
# of files where their use is gated on the resolved permission mode. Any
# new occurrence outside the allowlist is a bug. This script fails CI in
# that case.
#
# Allowlist (files where the literal MAY appear):
#   - src/lib/claude-permissions.ts      — single source of truth
#   - src/lib/__tests__/                 — leak-prevention test assertions
#   - tests/                             — integration test assertions
#   - src/dashboard/frontend/src/components/Settings/  — UI strings explaining the setting
#   - src/cli/index.ts                   — --yolo flag help text
#   - docs/                              — documentation
#   - scripts/lint-permissions.sh        — this file
#
# Spawn sites (agents.ts, conversations.ts) must use DSP_FLAG /
# BYPASS_PERMISSION_MODE / bypassPrefixForAgentFlag / buildClaudeUserSettings
# from claude-permissions.ts — never the literal token.

set -euo pipefail

cd "$(dirname "$0")/.."

EXCLUDES=(
  ':!src/lib/claude-permissions.ts'
  ':!src/lib/__tests__/*'
  ':!tests/*'
  ':!src/dashboard/frontend/src/components/Settings/*'
  ':!src/cli/index.ts'
  ':!docs/*'
  ':!scripts/lint-permissions.sh'
  ':!*.md'
  ':!.pan/*'
)

# Restrict to source/config files we ship; ignore generated/dist/node_modules.
INCLUDES=(
  'src/'
  'packages/'
  'apps/'
)

# Match only QUOTED occurrences of the tokens — these are actual code
# emissions, not prose in comments / JSDoc. Permissible quote chars: ',
# ", `. The regex matches token surrounded by a quote on either side.
#
# Examples this catches (forbidden):
#   '--dangerously-skip-permissions'
#   "bypassPermissions"
#   `--dangerously-skip-permissions ${...}`
#
# Examples this ignores (allowed — prose):
#   // --dangerously-skip-permissions is added on top of --agent.
#   * pass --dangerously-skip-permissions --permission-mode bypassPermissions

# Two-phase: git grep finds candidate lines that mention the token at all
# (respects pathspec excludes), then perl filters to lines where the token
# appears inside a quote pair on the same line. This lets us keep the
# allowlist machinery (pathspec :!) while only failing on real code emissions.
candidates=$(
  { git grep -nE --untracked -e '--dangerously-skip-permissions' -e 'bypassPermissions' \
      -- "${INCLUDES[@]}" "${EXCLUDES[@]}"; } || true
)

violations=$(
  printf '%s\n' "$candidates" | perl -ne '
    next unless length;
    # git grep output format: path:lineno:content
    my ($prefix, $content) = /^([^:]+:\d+:)(.*)$/ ? ($1, $2) : ("", $_);
    # Skip lines that are comments. Block-comment continuation lines start
    # with optional whitespace then "*". Line comments start with "//". Both
    # may legitimately mention the tokens in prose / JSDoc and are safe.
    next if $content =~ m{^\s*(?://|\*)};
    # Skip lines that begin a block comment ("/**" or "/*").
    next if $content =~ m{^\s*/\*};
    # Token must appear inside a quote pair (single, double, or backtick)
    # on the same source line — that is the shape of an emitted string.
    next unless $content =~ m{
      ( ['"'"'"\x60] )                # opening quote (capture 1)
      [^'"'"'"\x60\n]*                # non-quote run
      (?: --dangerously-skip-permissions | bypassPermissions )
      [^'"'"'"\x60\n]*
      \1                              # matching closing quote
    }x;
    print;
  '
)

if [[ -n "$violations" ]]; then
  echo "✗ permission-flag leak: forbidden token outside allowlist" >&2
  echo "" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "The literal '--dangerously-skip-permissions' and 'bypassPermissions' must" >&2
  echo "only appear in src/lib/claude-permissions.ts (single source of truth) and" >&2
  echo "in tests/UI/docs. Spawn sites must import DSP_FLAG, BYPASS_PERMISSION_MODE," >&2
  echo "bypassPrefixForAgentFlag, or buildClaudeUserSettings from that module." >&2
  echo "" >&2
  echo "See scripts/lint-permissions.sh for the full allowlist and rationale." >&2
  exit 1
fi

# Positive-shape guard: files that construct Claude Code invocations must consult
# claude-permissions.ts, even if they forgot to emit any forbidden literal. This
# catches the PAN-1082 class where a spawn builder omitted the resolver entirely.
spawn_candidates=$(
  { git grep -nE --untracked \
      -e "baseCommand:[[:space:]]*['\"\x60]claude" \
      -e "exec claude" \
      -e "command[[:space:]]*=[[:space:]]*['\"]claude['\"]" \
      -e "execa\(['\"]claude['\"]" \
      -e "spawn\(['\"]claude['\"]" \
      -- src/lib src/cli packages; } || true
)

spawn_files=$(
  printf '%s\n' "$spawn_candidates" | perl -ne '
    next unless length;
    my ($path, $line, $content) = /^([^:]+):(\d+):(.*)$/ ? ($1, $2, $3) : next;
    next if $content =~ m{^\s*(?://|\*)};
    next if $content =~ m{^\s*/\*};
    next if $path =~ m{(^|/)__tests__/};
    next if $path =~ m{(^|/)node_modules/};
    print "$path\n";
  ' | sort -u
)

resolver_violations=""
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if ! git grep -q "claude-permissions" -- "$file"; then
    resolver_violations+="$file\n"
  fi
done <<< "$spawn_files"

if [[ -n "$resolver_violations" ]]; then
  echo "✗ permission resolver omission: Claude spawn builder lacks claude-permissions import" >&2
  echo "" >&2
  printf '%b' "$resolver_violations" >&2
  echo "" >&2
  echo "Any shipped source file that constructs a Claude Code invocation must import" >&2
  echo "from src/lib/claude-permissions.ts and use the shared resolver helpers." >&2
  exit 1
fi

echo "✓ permission-flag lint passed (no leaks or resolver omissions outside allowlist)"
