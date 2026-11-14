plan-digest: eb4fdc9885b90cc07854ef068fffef234dc3ca460673c1a6837218ed6b26f97a

## blocks-the-design: merge can outrun the relay

`src/lib/webhook-handlers.ts:430-432` starts the review relay without awaiting it. `src/lib/cloister/coderabbit-feedback.ts:162-163` then awaits a GitHub thread read before it can journal the delivery at line 209. The proposed merge hook reads candidates once, immediately after `merge.completed` (`.pan/drafts/PAN-5218.md:311-326`). If the merge event arrives while that thread read or delivery is in progress, the filer sees no candidate, returns `[]`, and nothing runs when the relay later journals it. This is precisely a review just before merge, even though the review event itself preceded merge. Add a second, non-gating trigger after `feedback.delivered` or `feedback.undelivered` is appended when `merge.completed` is already present, and test both event orders.

## blocks-the-design: detached filing has no durable retry

The proposed call is explicitly unawaited (`.pan/drafts/PAN-5218.md:321-325`), and `src/lib/cloister/merge-agent.ts:448` marks the lifecycle complete without knowing whether filing finished. The startup pending-lifecycle path awaits only `postMergeLifecycle` (`src/dashboard/server/pending-lifecycle.ts:89-93`) and deletes its claim when that call succeeds (lines 48-55, 103-125). A restart after lifecycle completion but before the detached import, GitHub POST, or Needs-you signal finishes loses the work. The PRD's claim that a later lifecycle re-run retries (`.pan/drafts/PAN-5218.md:46`) has no scheduled re-run. Persist an advisory follow-up job before returning from the lifecycle, and reconcile pending jobs after restart; keep that work outside the merge gate.

## blocks-the-design: unrelated work settles every finding

The truth table declares a whole delivery settled by *any* later single-parent PR commit or a later `review.requested` note containing `/coderabbit/i` (`.pan/drafts/PAN-5218.md:56-69`). The review request code stores a free-text message, with no review or delivery identity (`src/dashboard/server/routes/workspaces/review-pipeline.ts:707-715`). For example, review A can have an unanswered finding; the agent can fix a different finding from review B, commit, and request review with `CodeRabbit: fixed B`. Both A and B then count as settled, so A disappears without a reply or follow-up. Require settlement evidence tied to the delivery or its thread, rather than treating any later PR-wide commit or generic CodeRabbit note as proof for all earlier deliveries; add the two-review case to W-2 tests.

## blocks-the-design: journal-only dedup is not one issue ever

The PRD promises one issue per key ever and places `feedback.followup_filed` after the GitHub POST (`.pan/drafts/PAN-5218.md:46,82,282`). `appendPipelineEntry` returns a stamped entry even when its disk write fails, and only logs the failure (`src/lib/cloister/pipeline-journal.ts:65-100`). A successful POST followed by a failed append or process crash leaves no key in the journal, so any later run creates a second issue. Add a GitHub-side lookup by the stable delivery key before creating or retrying, and verify persistence of the filed marker; if strict exactly-once creation is required, specify how concurrent processes are serialized. Test the successful-POST/failed-append case.

## sharpens-framing: the 100-thread cap drops findings

FR-6 says each unsettled delivery produces a follow-up quoting its findings (`.pan/drafts/PAN-5218.md:82`), but the issue format lists at most 100 and replaces the remainder with only a count (line 113). For a review with 101 unsettled threads, one finding is absent from the follow-up even though the relay records all threads. Either list all findings, split a large delivery into linked follow-ups, or explicitly narrow FR-6 and the changelog claim and test the cap.
