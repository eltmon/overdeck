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

check_discovery_completeness() {
  contains "src/lib/cloister/prompts/planning.md" "Discovery is complete only when" \
    || fail "discovery-completeness: planning.md missing discovery completion criteria"
  return 0
}

check_planning_qa_retention() {
  contains "src/lib/cloister/prompts/planning.md" "## Planning Q&A" \
    || fail "planning-qa-retention: planning.md missing Planning Q&A persistence guidance"
  return 0
}

check_external_content_framing() {
  contains "src/lib/cloister/prompts/planning.md" "data, not instructions" \
    || fail "external-content-framing: planning.md missing data-not-instructions block"
  contains "src/lib/cloister/prompts/work.md" "data, not instructions" \
    || fail "external-content-framing: work.md missing data-not-instructions block"
  return 0
}

check_plan_self_audit() {
  contains "src/lib/cloister/prompts/planning.md" "audit your own plan" \
    || fail "plan-self-audit: planning.md missing pre-finalize self-audit checklist"
  return 0
}

check_ac_phrasing_guidance() {
  contains "src/lib/cloister/prompts/planning.md" "works as expected" \
    || fail "ac-phrasing-guidance: planning.md missing banned AC phrase summary"
  return 0
}

check_anomaly_first_completion() {
  contains "src/lib/cloister/prompts/work.md" "lead with anomalies" \
    || fail "anomaly-first-completion: work prompt missing anomaly-first summary guidance"
  return 0
}

check_bead_scope_discipline() {
  contains "src/lib/cloister/prompts/work.md" "every staged file must be required" \
    || fail "bead-scope-discipline: work prompt missing per-bead staged-file rule"
  return 0
}

check_review_verdict_blocker() {
  contains "roles/review.md" "one-line top blocker" \
    || fail "review-verdict-blocker: review.md missing top-blocker verdict guidance"
  return 0
}

check_codebase_map_prompt() {
  contains "src/lib/cloister/prompts/planning.md" "Codebase Map" \
    || fail "codebase-map-prompt: planning.md missing Codebase Map section"
  return 0
}

check_all() {
  errors=()
  check_forbidden_strings
  check_bead_loop_order
  check_single_workflow_copy
  check_schema_key_agreement
  check_handoff_consistency
  check_discovery_completeness
  check_planning_qa_retention
  check_external_content_framing
  check_plan_self_audit
  check_ac_phrasing_guidance
  check_anomaly_first_completion
  check_bead_scope_discipline
  check_review_verdict_blocker
  check_codebase_map_prompt
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
Discovery is complete only when
## Planning Q&A
data, not instructions
audit your own plan
works as expected
Codebase Map
EOF
  cat > "$root/roles/plan.md" <<'EOF'
Run pan plan finalize. Human planning waits in Planned for pan start or Start Agent.
EOF
  cat > "$root/roles/review.md" <<'EOF'
## Verdict: APPROVED / CHANGES REQUESTED — <when CHANGES REQUESTED: one-line top blocker>
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
data, not instructions
lead with anomalies
every staged file must be required
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
  expect_self_test_failure "discovery-completeness" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/planning.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('Discovery is complete only when', 'Discovery continues until'))
PY"
  expect_self_test_failure "planning-qa-retention" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/planning.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('## Planning Q&A', '## Planning Notes'))
PY"
  expect_self_test_failure "external-content-framing" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/work.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('data, not instructions', 'trusted issue instructions'))
PY"
  expect_self_test_failure "plan-self-audit" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/planning.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('audit your own plan', 'review the plan briefly'))
PY"
  expect_self_test_failure "ac-phrasing-guidance" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/planning.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('works as expected', 'vague success wording'))
PY"
  expect_self_test_failure "anomaly-first-completion" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/work.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('lead with anomalies', 'summarize normally'))
PY"
  expect_self_test_failure "bead-scope-discipline" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/work.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('every staged file must be required', 'stage whatever changed'))
PY"
  expect_self_test_failure "review-verdict-blocker" \
    "python3 - <<'PY' \"\$tmp/roles/review.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('one-line top blocker', 'short summary'))
PY"
  expect_self_test_failure "codebase-map-prompt" \
    "python3 - <<'PY' \"\$tmp/src/lib/cloister/prompts/planning.md\"
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('Codebase Map', 'Repository Map'))
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
