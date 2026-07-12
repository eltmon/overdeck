#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
cd "$root"

if ! command -v rg >/dev/null 2>&1; then
  echo "beads access audit failed: ripgrep (rg) is required but was not found in PATH" >&2
  exit 2
fi

violations=""
append_matches() {
  local output
  local status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [[ $status -eq 1 ]]; then
    return
  fi
  if [[ $status -ne 0 ]]; then
    printf 'beads access audit failed: rg command failed with exit %s:\n%s\n' "$status" "$output" >&2
    exit 2
  fi
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
set +e
mutation_rg_matches="$(rg -n \
  --glob '*.ts' --glob 'SKILL.md' --glob 'work.md' \
  --glob '!**/__tests__/**' --glob '!**/*.test.ts' \
  --glob '!src/lib/beads/writer.ts' \
  --glob '!src/lib/beads/bootstrap.ts' \
  --glob '!src/lib/beads/reconcile.ts' \
  --glob '!src/lib/beads/bd-shim.ts' \
  --glob '!src/lib/remote-workspace.ts' \
  --glob '!src/lib/remote/fly-provider.ts' \
  "\\bbd +(create|update|close|delete|import|init|migrate|batch|dep +(add|remove)|dolt +(push|commit|reset)|config +(set|unset)|admin +compact)\\b" src sync-sources/skills 2>&1)"
mutation_rg_status=$?
set -e
if [[ $mutation_rg_status -eq 1 ]]; then
  mutation_matches=""
elif [[ $mutation_rg_status -ne 0 ]]; then
  printf 'beads access audit failed: rg command failed with exit %s:\n%s\n' "$mutation_rg_status" "$mutation_rg_matches" >&2
  exit 2
else
  mutation_matches="$(printf '%s\n' "$mutation_rg_matches" \
    | grep -Eiv "(:[0-9]+:[[:space:]]*(//|\\*)|never|do not|don't|replaces|without asking|must be run once|only sanctioned|not need to run)" || true)"
fi
if [[ -n "$mutation_matches" ]]; then violations+="$mutation_matches"$'\n'; fi

if [[ -n "$violations" ]]; then
  printf 'Direct beads authority access is forbidden; route reads through resolver.ts and mutations through writer.ts:\n%s' "$violations" >&2
  exit 1
fi

echo "beads access audit passed"
