#!/usr/bin/env bash
#
# guard-agent-dir-removal.sh — PAN-3357: agent state directories have one
# deletion door (src/lib/agents/state-dir-removal.ts). Direct rm/rmSync/rmdir
# calls can destroy JSONL transcripts, so new cleanup must use that door.
set -euo pipefail
cd "$(dirname "$0")/.."

collect_candidates() {
  find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) \
    ! -path '*/__tests__/*' \
    ! -name '*.test.ts' \
    ! -name '*.test.tsx' \
    ! -name '*.test.js' \
    -print0 |
    perl -0ne '
      chomp;
      my $file = $_;
      next if $file eq "src/lib/agents/state-dir-removal.ts";
      open my $source, "<", $file or die "cannot read $file: $!";
      local $/ = "\n";
      my %tainted;
      my $line_number = 0;
      while (my $content = <$source>) {
        $line_number++;
        if ($content =~ /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/) {
          my ($name, $rhs) = ($1, $2);
          my $is_tainted = $rhs =~ /\bAGENTS_DIR\b|\bgetAgentDir\s*\(|\bgetOverdeckHome\s*\(.*["\x27]agents["\x27]/;
          for my $tainted (keys %tainted) {
            $is_tainted = 1 if $rhs =~ /\b\Q$tainted\E\b/;
          }
          $tainted{$name} = 1 if $is_tainted;
        }

        next unless $content =~ /\b(?:rm|rmSync|rmdir|rmdirSync)\s*\(/;
        my $is_candidate = $content =~ /\bAGENTS_DIR\b|\bgetAgentDir\s*\(|\bgetOverdeckHome\s*\(.*["\x27]agents["\x27]/;
        for my $tainted (keys %tainted) {
          $is_candidate = 1 if $content =~ /\b\Q$tainted\E\b/;
        }
        $is_candidate = 1
          if $file eq "src/lib/cloister/review-convoy.ts" && $content =~ /rm\(outputPath/;
        print "$file:$line_number:$content" if $is_candidate;
      }
      close $source;
    '
}

is_allowlisted() {
  local file=$1
  local content=$2

  [[ "$content" == *'PAN-3357: not a dir removal'* ]] || return 1

  case "$file" in
    src/lib/cloister/review-convoy.ts)
      [[ "$content" == *'rm(outputPath'* ||
         "$content" == *'reviewer-signaled'* ||
         "$content" == *'reviewer-launcher.pid'* ]]
      ;;
    src/dashboard/server/routes/agents/lifecycle-restart.ts)
      [[ "$content" == *"join(agentDir, 'session.id')"* ||
         "$content" == *"join(agentDir, 'sessions.json')"* ]]
      ;;
    src/lib/agents/termination.ts)
      [[ "$content" == *"join(AGENTS_DIR, normalizedId, 'git-guard')"* ]]
      ;;
    src/lib/cloister/deacon-review-status.ts)
      [[ "$content" == *'rmSync(completedFile)'* ||
         "$content" == *'rmSync(processedFile)'* ]]
      ;;
    src/lib/cloister/deacon.ts)
      [[ "$content" == *'rmSync(sessionFile)'* ]]
      ;;
    src/lib/overdeck/conversation-runtime.ts)
      [[ "$content" == *'rm(sessionIdPath'* ]]
      ;;
    *)
      return 1
      ;;
  esac
}

candidates=$(collect_candidates)
violations=''
while IFS= read -r candidate; do
  [[ -z "$candidate" ]] && continue
  file=${candidate%%:*}
  remainder=${candidate#*:}
  line_number=${remainder%%:*}
  content=${remainder#*:}

  if ! is_allowlisted "$file" "$content"; then
    violations+="$file:$line_number:$content"$'\n'
  fi
done <<< "$candidates"

if [[ -n "$violations" ]]; then
  echo '✗ direct agent state directory removal outside removeAgentStateDir:' >&2
  printf '%s' "$violations" >&2
  echo 'Route directory cleanup through src/lib/agents/state-dir-removal.ts.' >&2
  echo 'Named-file exemptions must be allowlisted and carry: // PAN-3357: not a dir removal' >&2
  exit 1
fi

echo '✓ agent-dir-removal guard passed (all agent state cleanup uses removeAgentStateDir)'
