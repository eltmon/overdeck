# State-Plane Commit Policy — one rule set for pipeline state in worktrees

**Status:** adopted 2026-07-06 (operator-directed). **Owner:** pipeline substrate.
**Complements:** [`docs/AGENT-STATE-PLANES.md`](AGENT-STATE-PLANES.md) (what the planes are);
this page owns *who commits pipeline state, when, and which gates must tolerate it*.

## Why this page exists

Five open issues each patch one symptom of the same missing decision, and an agent
(PAN-2386) independently invented a sixth, wrong answer (gitignoring `.pan/records/`):

| Issue | Symptom of the gap |
| --- | --- |
| [PAN-2417](https://github.com/eltmon/overdeck/issues/2417) | Recording a verdict as a commit invalidates the verdict it records (self-feeding review loop) |
| [PAN-2167](https://github.com/eltmon/overdeck/issues/2167) | Pipeline-written records dirty the worktree and block the review clean-tree gate |
| [PAN-2406](https://github.com/eltmon/overdeck/issues/2406) | verify-merged rejects record-only deltas; polyrepo close-out teardown aborts |
| [PAN-2375](https://github.com/eltmon/overdeck/issues/2375) | Beads/records auto-commit churn on main (debounce/batch/push policy) |
| [PAN-2372](https://github.com/eltmon/overdeck/issues/2372) | Slot finishes without writing statusOverrides (durable completion lost) |
| [PAN-2386](https://github.com/eltmon/overdeck/issues/2386) | Dirty-workspace guard trips on pipeline-written state; agent tried to gitignore records |

Every fix for these MUST land against the rules below — not another local answer.

## Glossary

- **State-plane paths**: `.pan/records/`, `.pan/continues/`, `.pan/continue.json`,
  `.pan/specs/` (status-field flips only), `.beads/`, `.pan/test/`, `.pan/review/`,
  `.pan/feedback/`. Everything else is **source**.
- **Pipeline writer**: Overdeck code (CLI, server, deacon) acting as the single write
  door for a state file. Agents write state only through `bd`/`pan` commands, never
  by hand-editing state files.

## The rules

1. **State is committed, never ignored.** `.pan/records/` and its siblings are the
   permanent plane — durable, git-carried, portable. No `.gitignore` may cover them
   (exception: `.pan/continue.json` stays gitignored by existing policy — it is
   workspace-session state, mirrored durably into the per-issue record).
   Scaffold/workspace gitignores cover sub-repo checkouts and build ephemera only.

2. **Whoever writes state commits it, atomically, in the same operation.** A pipeline
   step that mutates a state file and returns with a dirty tree is a bug
   (PAN-2386's root cause). `commit-on-write` is the contract; batching/debounce
   (PAN-2375) may coalesce commits but never leaves dirt across an operation boundary.

3. **State-only commits are invisible to every gate.** A commit whose diff touches
   only state-plane paths must NOT: reset review/test verdicts or readyForMerge
   (PAN-2417), fail verify-merged (PAN-2406), trip the clean-tree gate (PAN-2167),
   or trip the dirty-workspace auto-start guard (PAN-2386). The shared predicate is
   one function — `isStatePlaneOnlyDiff(baseSha, tipSha)` — used by ALL of these
   gates; no gate re-implements the path list.

4. **Source commits still reset everything.** If a post-verdict diff touches any
   non-state path, verdicts reset and gates fire exactly as today. This policy
   loosens nothing about code review.

5. **Completion is durable or it didn't happen.** An agent/slot finishing work must
   write its statusOverrides/record delta *and commit it* before signaling done
   (PAN-2372). "Done" with uncommitted state is not done — the verification gate may
   check this mechanically.

6. **One path list, one place.** The canonical state-plane path list lives next to
   `isStatePlaneOnlyDiff` in `src/lib/` (single source; CI-guarded against parallel
   copies). Adding a new state file means adding it there, nowhere else.

## Acceptance for the cluster

Each cluster issue closes only when its gate consumes the shared predicate (rule 3/6)
or its writer honors commit-on-write (rule 2/5). A follow-up sweep verifies no
`.gitignore` in any template or scaffold covers a permanent-plane path (rule 1).

PAN-2167's working-tree clean gates consume the shared `isStatePlaneOnlyStatus`
predicate, the porcelain-status companion to `isStatePlaneOnlyDiff`, so
state-plane-only dirt does not block review or merge flow while mixed/source dirt
still blocks. The wired gates are:

- `src/dashboard/server/routes/workspaces/review-pipeline.ts` — `pan review request`
  dirty-workspace gate.
- `src/lib/work/done-preflight.ts` — `pan done` preflight uncommitted-changes gate.
- `src/dashboard/server/routes/workspaces/merge-ops.ts` — approve/merge pre-push
  dirty-workspace gate.
