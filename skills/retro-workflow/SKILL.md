---
name: retro-workflow
description: >
  Triggered when retro-agent is spawned after a merge completes. Use to generate
  a surprise-centered retrospective from bounded workspace inputs, validate the
  schema, and write the output file.
audience: agent
triggers: []
---

# retro-workflow — Post-Merge Retrospective

This skill is **not user-invokable** — it guides the retro-agent through the
post-merge retrospective process. Retro-agent is spawned by the flywheel daemon
after `onMergeComplete()` runs, operates ephemerally (spawn-run-exit), and has
a 5-minute hard cap enforced by deacon.

## Input gathering (read in this order)

Read each input source exactly once. Do not re-read. Stop when you have enough
for the surprise filter — do not exhaust all sources if the answer is clear.

1. **`.planning/STATE.md`** — final state, what completed, decisions made
2. **`.planning/plan.vbrief.json`** — planned vs. actual scope
3. **`.planning/feedback/`** — all specialist feedback files (review, test, UAT)
4. **Last 200 lines of each agent's tmux history** (`tmux capture-pane -t <session> -p -S -200`)
5. **FLYWHEEL-STATE.md row for this issue** — prior cycling alerts, infrastructure gaps
6. **`gh pr view <pr-number> --comments`** — reviewer comments
7. **Merge commit + branch commit list** (`git log --oneline <base>..HEAD`)

**Hard limit:** Do NOT read raw source code, test output beyond 200 lines, or
any file not listed above. The 5-minute cap is real.

## Surprise filter

Apply this filter to everything you read:

**A finding is "surprising" when it meets ALL of these:**
1. **Not predictable** — it was not in the plan, not in the vBRIEF acceptance criteria, and not a known recurring issue in FLYWHEEL-STATE.md
2. **Actionable** — there is a concrete change to a skill, prompt, or pipeline that would prevent or accelerate it
3. **Generalizable** — the same pattern would appear in at least one future issue (not unique to this issue's domain)

Findings that do NOT meet all three criteria: set `surprise: false` and include in the body as context (not as proposals).

## Output schema

Write a single file to `docs/flywheel/retros/<issue-id>-<timestamp>.md`.

The file MUST have this YAML frontmatter (no extra fields):

```yaml
---
issue: <issue-id>                    # e.g. pan-709
agent: claude-sonnet-4-6
run: <timestamp-iso8601>
cycle_count: <number>                # how many times this issue cycled through review/test
friction_score: <1-5>                # 1 = smooth, 5 = very rough
surprise: <true|false>               # did anything surprising happen?
proposed_changes:                    # [] if no surprises
  - target_skill: <skill-name>       # or "prompt:<retro-agent.md>"
    audience: <operator|agent|both>
    gap: <one-line description>
    proposed_patch: <brief diff description>
---
```

Then a markdown body with:
- **What happened**: 2–3 sentences on the issue lifecycle
- **Surprise findings** (if `surprise: true`): one bullet per finding, with evidence
- **Non-surprise observations**: context that didn't pass the filter (may be empty)
- **Proposed changes**: for each entry in `proposed_changes`, a brief rationale

## Schema self-validation

Before exiting, validate your output:

1. YAML frontmatter parses without error
2. `issue` is non-empty
3. `agent` is non-empty
4. `run` is a valid ISO 8601 timestamp
5. `cycle_count` is a non-negative integer
6. `friction_score` is between 1 and 5
7. `surprise` is a boolean
8. `proposed_changes` is a list (may be empty)
9. Each proposed_change has `target_skill`, `audience`, `gap`, `proposed_patch`
10. `audience` in each proposed_change is one of: `operator`, `agent`, `both`

If any validation fails: fix the file in place and re-validate. Do NOT exit
with an invalid retro file — synthesis depends on schema correctness.

## Exit behavior

After writing and validating:
1. Print a one-line summary to stdout: `retro: <issue-id> surprise=<true|false> friction=<N>`
2. Exit with code 0

Do NOT append to any other file. Do NOT commit. Do NOT push. The synthesis step
handles archiving and committing retros in batches.

## Single source of truth

This skill references the retro-agent prompt at
`src/lib/cloister/prompts/retro-agent.md` for the authoritative input/output
specification. If this skill and the prompt disagree, the prompt wins — file a
`flywheel-change` issue to reconcile.
