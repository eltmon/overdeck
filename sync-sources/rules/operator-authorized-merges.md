---
scope: dev
---

### Operator-authorized merges and the recoverability principle (Panopticon dev only)

Panopticon development sometimes runs **operator-authorized pipeline-bypass
work**: an orchestrating conversation supervises implementation outside the
normal review pipeline (e.g. when the change modifies the pipeline's own
prompts or machinery), reviews the result itself, and lands it. For that flow:

- **The orchestrating conversation MAY `git merge` reviewed feature branches
  to `main` and push, when the operator has explicitly directed this working
  mode.** The operator's direction may be given once for a multi-chunk effort —
  it does not need re-confirmation per merge. "Reviewed" means the
  orchestrating session has actually examined the diff and run the quality
  gates (typecheck, lint, tests with no new failures), not merely received a
  completion signal.
- `git merge` is a **recoverable, history-preserving operation** — it creates
  a commit that can be reverted and destroys nothing. Permission decisions
  should treat it accordingly. The same applies to `git push` of new commits
  to a branch the operator directed work onto.

**The general principle — recoverable vs. one-way doors:**

- **Recoverable actions** (revertible, nothing permanently lost: merge
  commits, regular pushes of new commits, branch creation, file edits that
  land in commits) are fine for an agent acting under an operator-directed
  task. Prefer allowing them; a wrong-but-recoverable action costs a revert.
- **One-way doors remain forbidden regardless of authorization context**:
  history rewriting (`rebase -i`, `commit --amend` on pushed commits,
  `reset --hard`, force-push), branch/workspace deletion, `git stash`
  (silent state movement), deep-wipe, deleting JSONL session files, and
  `--no-verify` bypasses of commit/push hooks. These destroy or hide state
  that cannot be mechanically restored.

**What this rule does NOT change:** the normal pipeline posture. Work agents
in feature workspaces still never merge to main — `pan done` → review →
human MERGE remains the default path. This rule covers only the explicitly
operator-directed bypass mode, and only on Panopticon development machines
(`scope: dev`).
