---
specialist: verification-gate
issueId: PAN-714
outcome: failed
timestamp: 2026-04-15T02:48:09Z
---

VERIFICATION FAILED for PAN-714 (attempt 1/10):

Failed check: vbrief-ac

Acceptance criteria check FAILED — 35/35 AC incomplete:

### Regenerate .claude/skills/ as exact mirror of canonical skills/ (5/5 incomplete)
  - [ ] `rg -n "pan work list|pan cloister start|pan specialists wake" .claude/skills/` returns zero matches
  - [ ] Every directory in skills/ has a corresponding directory in .claude/skills/ with byte-identical SKILL.md contents (verify via `diff -rq skills/ .claude/skills/ | grep -v .gitignore` showing no differences)
  - [ ] .claude/skills/.gitignore is preserved unchanged (protects future Panopticon-managed symlinks)
  - [ ] No nested-duplicate directories remain (no `*/pan-new-project/pan-new-project`, no `*/work-complete/work-complete`)
  - [ ] Orphan skills hume-evi, pan-dashboard-restart, rebase-and-submit, test-specialist-workflow, update-panopticon-docs are deleted from .claude/skills/

### Extend pan sync to auto-mirror project-level .claude/skills/ from local skills/ (6/6 incomplete)
  - [ ] Running `pan sync` inside panopticon-cli on a clean tree (after regen-claude-skills) produces no changes to .claude/skills/ and reports 0 added / 0 updated / 0 removed
  - [ ] After touching one file under skills/ (e.g., adding a new line to skills/pan-help/SKILL.md), `pan sync` updates the corresponding .claude/skills/pan-help/SKILL.md to match and reports `1 updated`
  - [ ] After deleting a directory under skills/, `pan sync` removes the corresponding directory under .claude/skills/ and reports `1 removed`
  - [ ] Running `pan sync` inside a project without a top-level skills/ directory is a no-op for .claude/skills/ (the existing user-level sync behavior is unchanged)
  - [ ] The existing .claude/skills/.gitignore file is never deleted, overwritten, or moved by the mirror logic
  - [ ] Unit test in tests/lib/sync.test.ts (or similar) exercises the three cases above (no-op, update, remove) against a tmp-dir fixture

### Extract done.ts pre-flight checks into src/lib/work/done-preflight.ts (4/4 incomplete)
  - [ ] src/lib/work/done-preflight.ts exists and exports checkOpenBeads, checkUncommittedChanges, checkVBriefACStatus, runPreflightChecks
  - [ ] doneCommand in src/cli/commands/work/done.ts no longer contains inline bd/git/AC-check logic; it calls runPreflightChecks and handles the returned failure lines
  - [ ] Running `pan work done <issue>` against a workspace with known failures (open bead + uncommitted file + pending AC) produces the same stderr output as before the refactor (verify by comparing against a pre-refactor capture)
  - [ ] npm run typecheck and npm run lint pass

### Unit tests: checkOpenBeads helper (3/3 incomplete)
  - [ ] Test file exists at tests/lib/work/done-preflight.beads.test.ts and imports from src/lib/work/done-preflight.ts
  - [ ] Covers happy path (0 beads), failure path (N beads), bd-missing path, and issue-id casing
  - [ ] All tests pass under `npm test`

### Unit tests: checkUncommittedChanges helper (mono + polyrepo) (4/4 incomplete)
  - [ ] Covers monorepo-clean (returns []), monorepo-dirty (returns failure lines), polyrepo-mixed (returns failure lines scoped per subdir)
  - [ ] Covers polyrepo detection fallback: workspace with no top-level .git correctly walks subdirectories
  - [ ] Dotfile subdirectories (e.g., .planning/) are skipped during polyrepo walk
  - [ ] All tests pass under `npm test`

### Unit tests: checkVBriefACStatus helper (3/3 incomplete)
  - [ ] Covers all-completed, one-pending, multiple-pending, and no-vBRIEF cases
  - [ ] Test fixtures are created and torn down per-test (no leftover tmp dirs)
  - [ ] All tests pass under `npm test`

### Export and unit-test approve.ts helpers (3/3 incomplete)
  - [ ] findPRForBranch, mergePR, updateLinearStatus are exported from src/cli/commands/work/approve.ts
  - [ ] tests/cli/commands/work/approve.test.ts covers happy and failure paths for each of the three helpers
  - [ ] All tests pass under `npm test`

### Command-level tests: doneCommand behavior (force, shadow, id normalization) (5/5 incomplete)
  - [ ] --force flag skips pre-flight checks (runPreflightChecks spy asserts zero calls)
  - [ ] Shadow mode routes to updateShadowState and skips both Linear and GitHub tracker update paths
  - [ ] Issue-id normalization covered for agent-prefixed, lowercase, and uppercase inputs
  - [ ] PAN- prefix routes to GitHub branch; non-PAN routes to Linear branch
  - [ ] All tests pass under `npm test` and do not make real network calls

### Command-level tests: approveCommand behavior (2/2 incomplete)
  - [ ] Covers agent-not-found, pr-not-found, happy-path, and shadow-mode-skip
  - [ ] All tests pass under `npm test` and do not make real network or gh CLI calls

## REQUIRED: Complete all acceptance criteria BEFORE resubmitting

1. Review the incomplete AC above
2. Implement the missing requirements and write tests
3. Update plan.vbrief.json subItem statuses to 'completed'
4. Commit and push ALL changes
5. ONLY THEN resubmit: pan review request PAN-714 -m "Completed acceptance criteria"

Do NOT resubmit until all AC are completed.
