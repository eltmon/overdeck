#!/usr/bin/env bash
set -euo pipefail

ROOT="${PROMPT_LINT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

errors=()

fail() {
  errors+=("$1")
}

contains() {
  local file="$1"
  local needle="$2"
  grep -Fq -- "$needle" "$ROOT/$file"
}

count_fixed() {
  local file="$1"
  local needle="$2"
  grep -F -- "$needle" "$ROOT/$file" | wc -l | tr -d ' '
}

check_forbidden_strings() {
  contains "src/lib/cloister/prompts/planning.md" "click Done" \
    && fail "forbidden-string: planning.md contains 'click Done'"
  contains "roles/plan.md" "legacy Done" \
    && fail "forbidden-string: roles/plan.md contains 'legacy Done'"
  contains "src/lib/cloister/prompts/work.md" "node -e" \
    && fail "forbidden-string: work.md contains 'node -e'"
  contains "src/lib/cloister/verification-runner.ts" "plan.vbrief.json subItem" \
    && fail "forbidden-string: verification-runner.ts contains 'plan.vbrief.json subItem'"
  return 0
}

check_bead_order_file() {
  local file="$1"
  local heading="$2"
  local result
  result="$(
    awk -v heading="$heading" '
      index($0, heading) { in_section=1; next }
      in_section && /^## / { exit }
      in_section && /^[0-9]+\./ {
        step=$1
        sub(/\./, "", step)
        if (!close_step && index($0, "bd close")) close_step=step
        if (!inspect_step && index($0, "pan inspect")) inspect_step=step
      }
      END {
        if (!close_step || !inspect_step) print "missing"
        else if (close_step < inspect_step) print "ok"
        else print close_step ":" inspect_step
      }
    ' "$ROOT/$file"
  )"
  if [[ "$result" != "ok" ]]; then
    fail "bead-loop-order: $file has bd close not before pan inspect ($result)"
  fi
  return 0
}

check_bead_loop_order() {
  check_bead_order_file "roles/work.md" "## Per-Bead Workflow"
  check_bead_order_file "src/lib/cloister/prompts/work.md" "## MANDATORY: One Bead At A Time"
}

check_single_workflow_copy() {
  local count
  count="$(count_fixed "src/lib/cloister/prompts/work.md" "MANDATORY: One Bead At A Time")"
  [[ "$count" == "1" ]] || fail "single-workflow-copy: work.md has $count workflow headings"
  return 0
}

check_schema_key_agreement() {
  local file key
  local files=(
    "src/lib/cloister/prompts/planning.md"
    "sync-sources/skills/write-vbrief/SKILL.md"
    "docs/VBRIEF.md"
  )
  local keys=(
    "requiresInspection"
    "inspectionDepth"
    "issueLabel"
    "difficulty"
    "foundationFor"
    "acceptance_criterion"
    "NonGoals"
  )
  for file in "${files[@]}"; do
    for key in "${keys[@]}"; do
      contains "$file" "$key" || fail "schema-key-agreement: $file missing $key"
    done
  done
  return 0
}

check_handoff_consistency() {
  local file
  for file in "roles/plan.md" "src/lib/cloister/prompts/planning.md"; do
    contains "$file" "pan plan finalize" || fail "handoff-consistency: $file missing pan plan finalize"
    contains "$file" "pan start" || fail "handoff-consistency: $file missing pan start"
    contains "$file" "click Done" && fail "handoff-consistency: $file contains click Done"
  done
  return 0
}

check_all() {
  errors=()
  check_forbidden_strings
  check_bead_loop_order
  check_single_workflow_copy
  check_schema_key_agreement
  check_handoff_consistency
}

write_passing_fixture() {
  local root="$1"
  mkdir -p \
    "$root/src/lib/cloister/prompts" \
    "$root/src/lib/cloister" \
    "$root/roles" \
    "$root/sync-sources/skills/write-vbrief" \
    "$root/docs"

  cat > "$root/src/lib/cloister/prompts/planning.md" <<'EOF'
Run pan plan finalize. The issue waits in Planned until pan start or Start Agent unless --auto-start was stamped.
requiresInspection inspectionDepth issueLabel difficulty foundationFor acceptance_criterion NonGoals
EOF
  cat > "$root/roles/plan.md" <<'EOF'
Run pan plan finalize. Human planning waits in Planned for pan start or Start Agent.
EOF
  cat > "$root/src/lib/cloister/prompts/work.md" <<'EOF'
## MANDATORY: One Bead At A Time
1. bd ready -l issue
2. bd update bead --claim
3. implement
4. git commit
5. update continue
6. bd close bead
7. read metadata
8. skip if false
9. pan inspect ISSUE --bead bead
EOF
  cat > "$root/roles/work.md" <<'EOF'
## Per-Bead Workflow
1. bd ready -l issue
2. bd update bead --claim
3. implement
4. git commit
5. update continue
6. bd close bead
7. read metadata
8. pan inspect ISSUE --bead bead
EOF
  cat > "$root/src/lib/cloister/verification-runner.ts" <<'EOF'
Close every completed bead with bd close.
EOF
  for file in "$root/sync-sources/skills/write-vbrief/SKILL.md" "$root/docs/VBRIEF.md"; do
    cat > "$file" <<'EOF'
requiresInspection inspectionDepth issueLabel difficulty foundationFor acceptance_criterion NonGoals
EOF
  done
}

expect_self_test_failure() {
  local name="$1"
  local mutate="$2"
  local tmp
  tmp="$(mktemp -d)"
  write_passing_fixture "$tmp"
  eval "$mutate"
  if PROMPT_LINT_ROOT="$tmp" "$0" >/dev/null 2>&1; then
    echo "lint-prompts self-test failed: $name did not fail" >&2
    rm -rf "$tmp"
    return 1
  fi
  rm -rf "$tmp"
}

self_test() {
  expect_self_test_failure "forbidden-string" \
    "printf '%s\n' 'click Done' >> \"\$tmp/src/lib/cloister/prompts/planning.md\""
  expect_self_test_failure "bead-loop-order" \
    "python3 - <<'PY' \"\$tmp/roles/work.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('6. bd close bead\n7. read metadata\n8. pan inspect ISSUE --bead bead', '6. read metadata\n7. pan inspect ISSUE --bead bead\n8. bd close bead'))
PY"
  expect_self_test_failure "single-workflow-copy" \
    "printf '%s\n' '## MANDATORY: One Bead At A Time' >> \"\$tmp/src/lib/cloister/prompts/work.md\""
  expect_self_test_failure "schema-key-agreement" \
    "python3 - <<'PY' \"\$tmp/docs/VBRIEF.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('foundationFor ', ''))
PY"
  expect_self_test_failure "schema-key-agreement-nongoals" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/planning.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace(' NonGoals', ''))
PY"
  expect_self_test_failure "handoff-consistency" \
    "python3 - <<'PY' \"\$tmp/roles/plan.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('pan start', 'Start Agent'))
PY"
  echo "lint-prompts self-test passed"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit 0
fi

check_all
if ((${#errors[@]} > 0)); then
  echo "prompt lint failed:" >&2
  for error in "${errors[@]}"; do
    echo "  $error" >&2
  done
  exit 1
fi

echo "prompt lint passed"
