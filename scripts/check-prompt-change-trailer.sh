#!/usr/bin/env bash
#
# PAN-2229 — CI prompt-gate trailer check.
#
# Args: <base-ref> <head-ref>
#
# Computes the diff of files between base-ref and head-ref. If none of the
# changed files match a gated path, prints an informational message and exits
# 0. Otherwise scans the commit messages added by head-ref (those not in
# base-ref) for a `Prompt-Change: <value>` trailer line — the load-bearing
# marker the PAN-2229 prompt-regression protection requires on every commit
# that diffs a gated prompt surface.
#
# Gated paths:
#   - roles/*.md          (every role prompt the Flywheel coordinates)
#   - docs/flywheel-brief.md
#
# Exit codes:
#   0 — gated paths unchanged, OR every commit touching a gated path carries
#       a Prompt-Change: trailer.
#   1 — a gated path was changed but the trailer is missing on at least one
#       commit in the range. The output is operator-facing: it lists the
#       gated files that changed, names the trailer contract in full
#       sentences, shows a concrete `git commit --allow-empty` example, and
#       never suggests amending or force-pushing.
#
# Pure git + bash. No Node/Bun/setup-node needed.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <base-ref> <head-ref>" >&2
  exit 2
fi

BASE_REF="$1"
HEAD_REF="$2"

# Map of changed file paths in the PR range. Use --name-only on the
# three-dot form so we only see changes introduced by the head side of
# the merge.
mapfile -t CHANGED_FILES < <(git diff --name-only "${BASE_REF}...${HEAD_REF}")

GATED_FILES=()
for file in "${CHANGED_FILES[@]}"; do
  if [[ "$file" =~ ^roles/.*\.md$ ]] || [[ "$file" == "docs/flywheel-brief.md" ]]; then
    GATED_FILES+=("$file")
  fi
done

if [[ ${#GATED_FILES[@]} -eq 0 ]]; then
  echo "prompt-gate: no gated prompt files changed"
  exit 0
fi

# Scan every commit in the PR range for a `Prompt-Change: <value>` line.
# The trailer must appear in the commit message body. We use --format=%B
# (raw body, no extra headers) and grep each entry line-by-line so a
# wrapped trailer still matches.
TRAILER_FOUND=0
TRAILER_COMMIT=""
while IFS= read -r commit; do
  [[ -z "$commit" ]] && continue
  if git log -1 --format=%B "$commit" | grep -Eq '^Prompt-Change:[[:space:]]+.+'; then
    TRAILER_FOUND=1
    TRAILER_COMMIT="$commit"
    break
  fi
done < <(git log --format=%H "${BASE_REF}..${HEAD_REF}")

if [[ "$TRAILER_FOUND" -eq 1 ]]; then
  echo "prompt-gate: Prompt-Change: trailer present on commit ${TRAILER_COMMIT}"
  echo "prompt-gate: gated files in this range:"
  for file in "${GATED_FILES[@]}"; do
    echo "  - $file"
  done
  exit 0
fi

cat >&2 <<EOF
prompt-gate: Prompt-Change: trailer missing on a commit that diffs a gated path.

Gated paths are load-bearing safety surfaces (PAN-2229):
  - roles/*.md           — every role prompt the Flywheel coordinates
  - docs/flywheel-brief.md — the operating contract the orchestrator reads

Files changed in this range that matched a gated path:
EOF
for file in "${GATED_FILES[@]}"; do
  echo "  - $file" >&2
done

cat >&2 <<'EOF'

What the protection is for
--------------------------
roles/flywheel.md, docs/flywheel-brief.md, and the rest of roles/*.md are
load-bearing safety surfaces. A prior incident showed that well-intentioned
commits can silently strip rail text (author/assignee allowlists, the
vetoed-is-absolute rule, the saturation cap, the auto_pickup_backlog switch)
without any test catching the regression. PAN-2229 added three layers of
protection; this CI gate is one of them.

What to do
----------
1. Run the live prompt evals locally before adding the trailer, so the
   commit message can name a real eval run instead of a hand-wave:

       export OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001
       npm run eval

2. Add a follow-up commit whose body contains a single `Prompt-Change:`
   trailer line. The key must be exact; the value is free-form. Example:

       git commit --allow-empty -m "fix(flywheel): restore author-gate rail

       Restored the allowlist line that the prior commit stripped.

       Prompt-Change: restored author/assignee allowlist; eval run green on Haiku"

3. Push the follow-up commit. The trailer is then visible to CI on the
   next run.

Do NOT
------
- Do NOT amend or force-push the existing commits to add the trailer.
  History rewriting on pushed commits is a one-way door (rule:
  "operator-authorized merges and the recoverability principle").
- Do NOT bypass the trailer by renaming the gated file path or by
  splitting the change across non-gated paths.
- Do NOT disable this CI job. The prompt-gate is a required check; the
  PR cannot merge until every gated-path commit carries a trailer.
EOF

exit 1