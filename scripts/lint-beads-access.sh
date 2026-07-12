#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
cd "$root"

violations=""
append_matches() {
  local output
  output="$("$@" 2>/dev/null || true)"
  if [[ -n "$output" ]]; then
    violations+="$output"$'\n'
  fi
}

# JSONL is allowed only at derived export/recovery, reconciliation/doctor
# diagnostics, state auto-commit, and the explicitly legacy unmigrated Fly path.
append_matches rg -n --glob '*.ts' \
  --glob '!**/__tests__/**' --glob '!**/*.test.ts' \
  --glob '!src/lib/beads/export.ts' \
  --glob '!src/lib/beads/reconcile.ts' \
  --glob '!src/cli/commands/doctor.ts' \
  --glob '!src/lib/pan-dir/auto-commit.ts' \
  --glob '!src/lib/remote-workspace.ts' \
  --glob '!src/lib/remote/fly-provider.ts' \
  "(readFile|readFileSync|existsSync|statSync|\\.has|\\[ -f )[^\n]*issues\\.jsonl" src

# Canonical-state existence comes from the resolver, never an export file.
append_matches rg -n --glob '*.ts' \
  --glob '!**/__tests__/**' --glob '!**/*.test.ts' \
  --glob '!src/cli/commands/doctor.ts' \
  --glob '!src/lib/remote-workspace.ts' \
  "(existsSync|statSync|\\.has|\\[ -f )[^\n]*issues\\.jsonl" src

# Production code, active prompts, and skill entrypoints may not teach or run
# raw mutations. Writer/bootstrap/recovery adapters are the only executors.
mutation_matches="$(rg -n \
  --glob '*.ts' --glob 'SKILL.md' --glob 'work.md' \
  --glob '!**/__tests__/**' --glob '!**/*.test.ts' \
  --glob '!src/lib/beads/writer.ts' \
  --glob '!src/lib/beads/bootstrap.ts' \
  --glob '!src/lib/beads/reconcile.ts' \
  --glob '!src/lib/beads/bd-shim.ts' \
  --glob '!src/lib/remote-workspace.ts' \
  --glob '!src/lib/remote/fly-provider.ts' \
  "\\bbd +(create|update|close|delete|import|init|migrate|batch|dep +(add|remove)|dolt +(push|commit|reset)|config +(set|unset)|admin +compact)\\b" src sync-sources/skills 2>/dev/null \
  | grep -Eiv "(:[0-9]+:[[:space:]]*(//|\\*)|never|do not|don't|replaces|without asking|must be run once|only sanctioned|not need to run)" || true)"
if [[ -n "$mutation_matches" ]]; then violations+="$mutation_matches"$'\n'; fi

if [[ -n "$violations" ]]; then
  printf 'Direct beads authority access is forbidden; route reads through resolver.ts and mutations through writer.ts:\n%s' "$violations" >&2
  exit 1
fi

echo "beads access audit passed"
