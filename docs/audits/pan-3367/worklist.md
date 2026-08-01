# PAN-3367 — Audit worklist

Derived by running [`evidence/reproduce-worklist.mjs`](evidence/reproduce-worklist.mjs) against
`~/.overdeck/overdeck.db` (Node 22, `node:sqlite`, read-only) on 2026-08-01, followed by a
commit-count pass against each candidate's PR/MR (see "Commit-count method" below). Raw event
payloads for every PAN candidate are dumped verbatim to `evidence/events-<issue>.json.gz` (gzipped
— some issues generate hundreds to thousands of `review.status_changed` events from what looks
like review-thrash loops, producing multi-MB raw JSON per issue; `gunzip -k` to inspect). **Raw
event dumps for the 8 MIN candidates were generated locally but are not committed to this public
repository, and their notes/URLs/commit-headline detail are stripped from the committed metadata
files too** — `eltmon/overdeck` is public while the source repositories those payloads describe
(private Mind Your Now repositories) are private, and both the raw payloads and the per-row
notes/merge-request-URL/commit-headline fields can embed private source paths, review commentary,
and implementation detail. Every MIN report in this audit is written to avoid quoting that private
content; see the confidentiality note at the top of each `min-*.md` report and the "Confidentiality-
safe evidence contract" section below. The full candidate list (61 issues, full available window)
is at `evidence/candidates.json`; the commit-count computation output is at
`evidence/commit-counts.json` — for the 8 MIN rows, `negNotes`, `prUrl`, and `inRangeDetail` are
`null`/empty by design, not by omission.

## Confidentiality-safe evidence contract (added in review cycle 3, 2026-08-01)

The approved xBRIEF (FR-1, `snapshot-evidence.ac1`, `audit-batch-e.ac1-ac2`) requires a committed
raw event snapshot for every worklist candidate and quoted failing-criterion/failure-reason text
for the cross-tracker (MIN) batch. This audit's own security findings (review cycles 1-3)
established that literal compliance — publishing raw MIN payloads or quoting private Linear/GitLab
text verbatim — discloses private Mind Your Now material from a public repository, which is a worse
outcome than an incomplete deliverable. **This audit adopts a confidentiality-safe substitute for
the 8 MIN/non-public candidates, in deliberate deviation from the literal text of FR-1 and
`audit-batch-e.ac1-ac2`:**

- No raw event payload is committed for a non-public-prefix issue (`evidenceDumped: false` in
  `candidates.json`).
- No merge/pull-request URL, commit SHA, commit message, file path, line number, or endpoint name
  from a private repository is committed anywhere in this report set.
- No verbatim quotation of private Linear issue text or private review/commit commentary is
  committed; MIN reports state paraphrased scope and verdict only.
- Every MIN verdict still rests on the same standard as every PAN verdict — the auditor reading the
  actual merged diff directly, not trusting a secondhand summary — but the *evidence trail* proving
  that reading happened is not reproducible from this public repository alone. It is independently
  reproducible only by someone with access to the private Mind Your Now repositories, re-running
  this audit's method against the same merge requests (locatable via the MIN issue IDs already named
  in each report).

**Operator sign-off (2026-08-01).** This substitute was escalated to the repository operator as a
formal requirements-amendment decision (the literal text of FR-1 and `audit-batch-e.ac1-ac2` calls
for raw dumps and verbatim quotes for every candidate, including the 8 MIN/non-public ones). The
operator approved treating the paraphrase-only substitute above as satisfying the intent of those
acceptance criteria for non-public-prefix candidates, and separately confirmed the residual history
exposure below is an accepted risk, not a merge blocker. This is recorded here as the requirements
disposition for FR-1/`audit-batch-e.ac1-ac2` on the 8 MIN/non-public candidates; the literal text of
those criteria remains formally unamended, but the deviation is operator-approved rather than a
unilateral audit decision.

**`candidates.json` reproducibility note:** the generator emits `resetAt` for every candidate on a
fresh run. 59 of the 61 committed rows carry `resetAt`, backfilled from the committed
`events-<issue>.json.gz` dumps where the live DB had compacted further (see the "Reset at" column
note under "Mandatory worklist" below). The 2 exceptions are `MIN-911` and `MIN-928` — both
non-mandatory, non-worklist candidates (not among the 25 named issues or the 5 derived extras)
whose raw event dumps were deleted for the confidentiality reasons above before this backfill ran.
Their rows are intentionally incomplete rather than silently wrong; re-deriving `resetAt` for them
would require either re-fetching from the (further-compacted) live DB or re-generating and
re-deleting a private-repo evidence dump, neither of which is worth doing for two candidates this
audit never covers.

## History exposure — accepted risk (operator decision, 2026-08-01)

The review's cycle-2 and cycle-3 security findings correctly identified that an early commit on
this branch (since removed from the tree) briefly committed raw MIN event payloads and
private-repository detail; because that commit remains a reachable ancestor of this branch, its
blobs stay retrievable by SHA on the public GitHub PR even after later commits deleted the files.
Retracting a published commit from a public branch's history requires a repository-host history
purge or a clean-branch replacement — a one-way, destructive operation this audit does not have
standing authority to perform on its own. This was escalated to the repository operator, who
reviewed the exposure and explicitly accepted it as a known risk rather than requiring a history
rewrite. No further remediation of the historical commit is planned as part of this audit.

**Worklist total: 30** — 25 mandatory issues (named in the PAN-3367 body) + 5 derived
zero-commit extras. This is **+1 relative to the ~29 the issue body estimates**. The variance is
explained by:

1. **The flywheel's exact 29-issue dedup is not mechanically reconstructible from the issue text
   alone** (stated as a known limitation in the PRD). A straightforward collapsed-state
   reproduction of the sharp signature (negative → reset to `pending/pending` → `passed/passed`
   within 60 minutes) yields **61 distinct issues** over the full event-log window that survived
   compaction, and **45 issues** inside the 2026-07-25 → 2026-07-28 window the issue's four
   spot-checks were drawn from. All 24 of the 25 mandatory issues whose events survived
   compaction are contained in this reproduction (`PAN-1525` is not — see below) — the
   reproduction is a superset that agrees with the issue's own list wherever evidence exists.
2. **PAN-1525's negative/reset events are already gone to 7-day retention compaction** (verified:
   only `passed/passed` rows from 2026-07-25T03:06Z onward survive for this issue in the raw
   `events` table). It counts toward the mandatory 25 per the issue's explicit worklist, but its
   row below has no `negAt`/`passAt`/commit-count from the event-window method — see "PAN-1525"
   below.
3. **Derived extras are capped at 10, selected by largest pass-minus-negative gap, from the
   zero-commit-in-window subset of the 07-25→07-28 window's non-mandatory candidates.** Of the 22
   non-mandatory candidates in that window, **5 have zero commits between their negative verdict
   and their pass** (`PAN-3076`, `PAN-3128`, `PAN-3093`, `PAN-3049`, `PAN-3229`) — well under the
   cap of 10, so there is no overflow to report. The other 17 non-mandatory window candidates all
   have ≥1 commit in the window and are excluded from the worklist (they don't match the
   zero-commit discriminator the flywheel itself used).

**30 = 25 mandatory + 5 derived extras.**

## ⚠ Notable findings for downstream audit batches

These were discovered while gathering commit counts and materially affect how `audit-batch-a`
through `audit-batch-f` should read the data below. They are **observations from raw evidence,
not audit verdicts** — per NFR-1/NFR-3 this item does not re-verdict or fix anything.

1. **The "zero commits between failure and pass" spot-check in the PAN-3367 issue body does not
   reproduce for 3 of its 4 named cases.** The issue body states all four of `PAN-3216`,
   `PAN-3230`, `PAN-3206`, `PAN-3192` had **0** commits between their negative verdict and their
   pass. Recomputing via the PR-commits method (the same method the issue's own worked example
   uses for `PAN-3216`/PR #3219, which *does* reproduce at 0) gives:
   - `PAN-3216`: **0** commits — matches the issue body.
   - `PAN-3192`: **2** commits — one titled literally `fix: fail frontend guard on compiler crash
     (PAN-3192)` (2026-07-27T05:49:55Z, inside the window) plus a `Merge remote-tracking branch
     'origin/main'`.
   - `PAN-3206`: **2** commits, both explicitly tagged `PAN-3206` in the message (`chore(cli):
     refresh close command manifest PAN-3206`, `fix(review): harden verdict reconciliation
     PAN-3206`), both inside the window.
   - `PAN-3230`: **2** commits (`fix(infra): enforce durable state path writes`,
     `fix(infra): close state path review gaps`), inside the window, topically consistent with
     PAN-3230's title (state-path migration) but not issue-tagged in the message.
   Full commit detail (authored date, committed date, headline) for every in-window commit is in
   `evidence/commit-counts.json` under each issue's `inRangeDetail`. `audit-batch-a` (which owns
   these four issues) must verify this directly against the diff — do not treat the issue body's
   "0 commits" claim as established fact for `PAN-3192`, `PAN-3206`, or `PAN-3230`.
2. **Rebase/merge noise can inflate raw PR-commit counts.** `PAN-3230`'s PR (#3239) contains 24
   commits total, most with an identical `committedDate` of `2026-07-28T18:46:15Z` — a batch
   artifact of a `git merge main` / `pan sync-main` incorporating unrelated commits (docs
   entries, other issues' fixes) that happen to land on this branch. Their `authoredDate` values
   are scattered hours before the negAt/passAt window and correctly excluded by this script's
   window filter. Only the two commits with `authoredDate == committedDate` (i.e., genuinely
   fresh, not replayed) fall inside the window. This is why the commit-count method here filters
   by `committedDate` (a proxy for "date this became part of the branch"), not by counting all
   commits with any date overlap — but per finding 1, that filter is not sufficient on its own to
   distinguish "genuine fix for this issue" from "generic infra work landing on this branch in
   the window." Batch items must read commit *content*, not just the count.
3. **Several negative-verdict notes are recorded empty** — the raw event's `reviewNotes`/
   `testNotes` field is `null`/absent for `PAN-3109`, `PAN-3110`, `PAN-3147`, `PAN-3155`,
   `PAN-3183`, `PAN-3230`, `MIN-858`, `MIN-896`. For these, Method step 1 ("read the recorded
   failure reason") must fall back to `gh pr view <n> --comments` and the permanent record's
   `pipeline.reviewNotes`/`pipeline.testNotes` (which may hold the *final* passed-state note, not
   the failure note — check timestamps) rather than treating "no note" as "no finding."
4. **Several notes are visibly infra/environment noise, not review findings** — e.g. "Review role
   spawn failed: Command failed: tmux …", "database is locked", "Verification deferred: a
   dashboard deploy is queued", "Verification error: Verification worker … exited before writing
   a result", "Role run agent-pan-3049-review already running." These look like `H6`
   (environment-blocked) rather than `genuine-finding` per the PRD's classification scheme — but
   note the *reset-to-pending* event immediately after these can still be followed by a real
   `failed`/`blocked` state with a substantive note before the eventual pass (i.e. the collapsed
   sequence used here picks the *first* negative state in a run; a later, more substantive
   negative state in the same episode may exist in `evidence/events-<issue>.json.gz` and should
   be checked).

## PAN-1525 (compacted — special case)

Evidence is gone: `~/.overdeck/overdeck.db`'s `events` table only retains 7 days, and the last
dashboard restart already deleted PAN-1525's negative/reset events. The only surviving
`review.status_changed` rows for PAN-1525 are `passed/passed`, starting 2026-07-25T03:06Z — no
`negAt`, no `negState`, no `negNotes`. `audit-batch-e` (which owns PAN-1525) must build its report
from:
- The permanent record `~/.overdeck/state/panopticon-cli/records/pan-1525.json` (`pipeline`
  block) — its `reviewNotes` currently reads the **pass**-time note ("The regenerated composer
  manifest is committed, matches the rebased CLI registry, and passes the canonical drift gate
  and contract test."), not the failure reason; this is not usable as the failing-AC context.
- PR #3033 (`gh pr view 3033 --repo eltmon/overdeck --comments`) for review-thread history that
  may still show the original blocking comment.
- The issue's own acceptance criteria (`gh issue view 1525 --repo eltmon/overdeck`).
This must be stated explicitly in `audit-batch-e`'s PAN-1525 report per the PRD's evidence-source
guidance — it is not an omission, it is the documented compaction hazard (H1).

## Mandatory worklist (25, named in the PAN-3367 issue body)

Commit counts use the **primary method** (PR/MR commit list, branch-independent) throughout —
"Branch exists" is recorded for informational/cross-check purposes (per hazard H2), not as the
basis for the commit count. "Gap" is the pass-minus-negative time delta. "Reset at" is the first
`pending/pending` event after the negative verdict (the reset the issue's mechanism describes) —
for the 30 worklist rows this was backfilled from the already-committed
`evidence/events-<issue>.json.gz` dumps rather than a fresh DB query, because `overdeck.db`'s
7-day retention has compacted further since the initial snapshot; every backfilled value was
cross-checked against its row's recorded `negAt`/`passAt` and matched exactly (no silent
mismatches). `reproduce-worklist.mjs` itself now captures `resetAt` directly, so a future run
against a live DB no longer needs this backfill step. Quoted notes longer than 120 characters are
truncated at a word boundary with `…[truncated]`; the full text is in
`evidence/commit-counts.json`'s `negNotes` field for every row.

| Issue | Negative verdict | Quoted notes | Reset at | Pass at | Gap | Commits between | Branch exists | PR/MR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PAN-1525 | _(compacted)_<br>`_n/a_` | _(empty)_ | _(compacted)_ | _(compacted)_ | _n/a_ | _n/a — compacted_ | n/a | [3033](https://github.com/eltmon/overdeck/pull/3033) |
| PAN-2467 | 2026-07-25T22:34:35.893Z<br>`blocked/pending` | Review dispatch skipped — already running: agent-pan-2467-review | 2026-07-25T22:47:49.624Z | 2026-07-25T23:22:15.348Z | 48 min | 1 (pr-commits) | no (deleted) | [3080](https://github.com/eltmon/overdeck/pull/3080) |
| PAN-2876 | 2026-07-27T07:07:11.808Z<br>`blocked/pending` | Verification deferred: a dashboard deploy is queued (requested 2026-07-27T06:44:15.236Z by flywheel-orchestrator). It …[truncated] | 2026-07-27T07:14:35.226Z | 2026-07-27T07:42:31.368Z | 35 min | 1 (pr-commits) | yes | [3204](https://github.com/eltmon/overdeck/pull/3204) |
| PAN-3037 | 2026-07-25T22:38:57.993Z<br>`failed/passed` | Review role spawn failed: Command failed: tmux -L overdeck -f /home/eltmon/.overdeck/tmux/overdeck.tmux.conf …[truncated] | 2026-07-25T23:03:49.515Z | 2026-07-25T23:31:49.741Z | 53 min | 3 (pr-commits) | yes | [3079](https://github.com/eltmon/overdeck/pull/3079) |
| PAN-3052 | 2026-07-25T12:51:48.999Z<br>`failed/pending` | Review role spawn failed: Command failed: tmux -L overdeck -f /home/eltmon/.overdeck/tmux/overdeck.tmux.conf …[truncated] | 2026-07-25T12:55:14.605Z | 2026-07-25T13:15:05.225Z | 23 min | 0 (pr-commits) | no (deleted) | [3065](https://github.com/eltmon/overdeck/pull/3065) |
| PAN-3083 | 2026-07-25T23:55:09.301Z<br>`failed/pending` | Review role spawn failed: Command failed: tmux -L overdeck -f /home/eltmon/.overdeck/tmux/overdeck.tmux.conf …[truncated] | 2026-07-25T23:58:02.288Z | 2026-07-26T00:17:07.793Z | 22 min | 0 (pr-commits) | no (deleted) | [3089](https://github.com/eltmon/overdeck/pull/3089) |
| PAN-3097 | 2026-07-26T03:30:18.325Z<br>`failed/pending` | Review role spawn failed: Command failed: tmux -L overdeck -f /home/eltmon/.overdeck/tmux/overdeck.tmux.conf send-keys …[truncated] | 2026-07-26T03:30:55.924Z | 2026-07-26T03:50:03.364Z | 20 min | 10 (pr-commits) | no (deleted) | [3102](https://github.com/eltmon/overdeck/pull/3102) |
| PAN-3109 | 2026-07-26T06:27:58.716Z<br>`failed/pending` | _(empty)_ | 2026-07-26T06:30:31.344Z | 2026-07-26T06:50:05.157Z | 22 min | 0 (pr-commits) | no (deleted) | [3112](https://github.com/eltmon/overdeck/pull/3112) |
| PAN-3110 | 2026-07-26T12:02:21.024Z<br>`failed/pending` | _(empty)_ | 2026-07-26T12:02:45.956Z | 2026-07-26T12:43:15.248Z | 41 min | 2 (pr-commits) | no (deleted) | [3136](https://github.com/eltmon/overdeck/pull/3136) |
| PAN-3114 | 2026-07-26T10:38:07.947Z<br>`failed/pending` | Review role spawn failed: write failed for agents-db:agent-pan-3114-review: database is locked | 2026-07-26T10:39:12.236Z | 2026-07-26T11:09:56.090Z | 32 min | 0 (pr-commits) | yes | [3126](https://github.com/eltmon/overdeck/pull/3126) |
| PAN-3115 | 2026-07-26T11:22:23.081Z<br>`failed/pending` | Review role spawn failed: Command failed: tmux -L overdeck -f /home/eltmon/.overdeck/tmux/overdeck.tmux.conf …[truncated] | 2026-07-26T11:26:17.938Z | 2026-07-26T12:00:33.370Z | 38 min | 2 (pr-commits) | yes | [3134](https://github.com/eltmon/overdeck/pull/3134) |
| PAN-3147 | 2026-07-26T17:50:20.814Z<br>`failed/pending` | _(empty)_ | 2026-07-26T17:52:55.279Z | 2026-07-26T18:18:47.373Z | 28 min | 0 (pr-commits) | yes | [3149](https://github.com/eltmon/overdeck/pull/3149) |
| PAN-3155 | 2026-07-26T20:40:40.607Z<br>`blocked/pending` | _(empty)_ | 2026-07-26T20:40:54.244Z | 2026-07-26T21:22:35.349Z | 42 min | 1 (pr-commits) | yes | [3160](https://github.com/eltmon/overdeck/pull/3160) |
| PAN-3158 | 2026-07-26T20:49:03.785Z<br>`failed/pending` | Verification failed at test | 2026-07-26T20:51:00.705Z | 2026-07-26T21:10:09.850Z | 21 min | 2 (pr-commits) | yes | [3161](https://github.com/eltmon/overdeck/pull/3161) |
| PAN-3183 | 2026-07-27T06:31:02.917Z<br>`blocked/pending` | _(empty)_ | 2026-07-27T07:06:08.383Z | 2026-07-27T07:24:10.918Z | 53 min | 1 (pr-commits) | yes | [3201](https://github.com/eltmon/overdeck/pull/3201) |
| PAN-3184 | 2026-07-27T06:05:17.116Z<br>`blocked/pending` | FR-3 measures clean-shutdown freshness at grace expiry instead of bootStartedAt; the required marker round-trip test is …[truncated] | 2026-07-27T06:35:01.334Z | 2026-07-27T06:56:52.947Z | 52 min | 11 (pr-commits) | yes | [3199](https://github.com/eltmon/overdeck/pull/3199) |
| PAN-3192 | 2026-07-27T05:35:48.544Z<br>`blocked/pending` | Verification deferred: a dashboard deploy is queued (requested 2026-07-27T04:22:17.553Z by deploy-patrol, merge-step0). …[truncated] | 2026-07-27T05:50:13.044Z | 2026-07-27T06:10:50.739Z | 35 min | 2 (pr-commits) | yes | [3198](https://github.com/eltmon/overdeck/pull/3198) |
| PAN-3206 | 2026-07-27T18:37:07.982Z<br>`failed/pending` | Verification error: Verification worker 2045091 exited before writing a result | 2026-07-27T18:45:43.531Z | 2026-07-27T19:29:51.362Z | 53 min | 2 (pr-commits) | yes | [3213](https://github.com/eltmon/overdeck/pull/3213) |
| PAN-3216 | 2026-07-28T06:40:30.326Z<br>`failed/pending` | Verification error: Verification worker 1874133 exited before writing a result | 2026-07-28T07:07:50.045Z | 2026-07-28T07:25:42.825Z | 45 min | 0 (pr-commits) | yes | [3219](https://github.com/eltmon/overdeck/pull/3219) |
| PAN-3230 | 2026-07-28T19:07:34.616Z<br>`blocked/pending` | _(empty)_ | 2026-07-28T19:11:38.189Z | 2026-07-28T20:05:45.836Z | 58 min | 2 (pr-commits) | yes | [3239](https://github.com/eltmon/overdeck/pull/3239) |
| PAN-3356 | 2026-07-31T20:45:43.264Z<br>`blocked/pending` | [correctness] Review-stuck recovery invokes the wrong state transition — …[truncated] | 2026-07-31T21:15:00.405Z | 2026-07-31T21:31:46.047Z | 46 min | 1 (pr-commits) | yes | [3360](https://github.com/eltmon/overdeck/pull/3360) |
| MIN-858 | 2026-07-25T12:51:37.111Z<br>`blocked/pending` | _(redacted — private repo, see min-858.md)_ | 2026-07-25T12:57:45.130Z | 2026-07-25T13:07:47.534Z | 16 min | 0 (mr-commits) | n/a (private repo) | _(redacted — private repo)_ |
| MIN-879 | 2026-07-26T05:58:18.535Z<br>`passed/failed` | _(redacted — private repo, see min-879.md)_ | 2026-07-26T06:20:38.473Z | 2026-07-26T06:41:35.735Z | 43 min | 2 (mr-commits) | n/a (private repo) | _(redacted — private repo)_ |
| MIN-896 | 2026-07-26T01:54:56.569Z<br>`failed/pending` | _(redacted — private repo, see min-896.md)_ | 2026-07-26T01:55:12.065Z | 2026-07-26T02:38:31.158Z | 44 min | 2 (mr-commits) | n/a (private repo) | _(redacted — private repo)_ |
| MIN-901 | 2026-07-25T12:52:13.226Z<br>`blocked/pending` | _(redacted — private repo, see min-901.md)_ | 2026-07-25T12:54:03.350Z | 2026-07-25T13:08:06.763Z | 16 min | 0 (mr-commits) | n/a (private repo) | _(redacted — private repo)_ |

## Derived zero-commit extras (5, capped at 10 — no overflow)

Selected from the 22 non-mandatory candidates in the 2026-07-25→2026-07-28 window whose commit
count between negative verdict and pass is 0. All 5 that qualify are included below (well under
the cap of 10), sorted by largest gap first.

| Issue | Negative verdict | Quoted notes | Reset at | Pass at | Gap | Commits between | Branch exists | PR/MR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| derived extra: PAN-3076 | 2026-07-25T23:00:51.154Z<br>`blocked/pending` | Unchanged HEAD still preserves passed review on failed Git inspection; write-site guard still misses raw writes in …[truncated] | 2026-07-25T23:09:28.933Z | 2026-07-26T00:00:33.233Z | 60 min | 0 (pr-commits) | no (deleted) | [3082](https://github.com/eltmon/overdeck/pull/3082) |
| derived extra: PAN-3128 | 2026-07-26T14:45:23.661Z<br>`blocked/pending` | Agent re-review request (2/25): Fixed review issues | 2026-07-26T14:58:02.407Z | 2026-07-26T15:38:54.181Z | 54 min | 0 (pr-commits) | yes | [3141](https://github.com/eltmon/overdeck/pull/3141) |
| derived extra: PAN-3093 | 2026-07-26T18:36:03.067Z<br>`blocked/pending` | The configured branch-prefix fix reaches assembly but not reconciler anchors, so valid custom-prefix generations are …[truncated] | 2026-07-26T18:46:48.193Z | 2026-07-26T19:09:28.090Z | 33 min | 0 (pr-commits) | yes | [3145](https://github.com/eltmon/overdeck/pull/3145) |
| derived extra: PAN-3049 | 2026-07-28T16:42:28.831Z<br>`failed/pending` | Review role spawn failed: Role run agent-pan-3049-review already running. Use 'pan tell' to message it. | 2026-07-28T16:42:28.850Z | 2026-07-28T17:12:06.549Z | 30 min | 0 (pr-commits) | yes | [3223](https://github.com/eltmon/overdeck/pull/3223) |
| derived extra: PAN-3229 | 2026-07-28T22:29:59.530Z<br>`failed/pending` | Review role spawn failed: Role run agent-pan-3229-review already running. Use 'pan tell' to message it. | 2026-07-28T22:37:00.723Z | 2026-07-28T22:47:12.090Z | 17 min | 0 (pr-commits) | yes | [3246](https://github.com/eltmon/overdeck/pull/3246) |

## Commit-count method

Primary method for every row above: `gh pr view <n> --repo eltmon/overdeck --json commits`
(GitHub, PAN issues) or `glab api projects/<url-encoded-path>/merge_requests/<iid>/commits`
(GitLab, MIN issues), filtered to commits whose `committedDate`/`created_at` falls strictly
between the negative-verdict timestamp and the pass timestamp. This is branch-independent (works
even when the feature branch has been deleted post-merge, per hazard H2) and is the method the
PRD's own worked example uses. "Branch exists" was independently checked via
`git ls-remote --heads origin feature/<issue-id>` for every PAN issue (MIN issues live in
`~/Projects/myn` — a GitLab-backed polyrepo wrapper, see "PRD evidence-source correction" below —
so branch existence there is out of scope for this script and marked `n/a`).

Raw per-commit detail (`authoredDate`, `committedDate`, `headline`) for every commit that landed
inside a window is preserved in `evidence/commit-counts.json` under each row's `inRangeDetail` —
this is the evidence downstream batches should read before accepting or overriding a raw count.

## PRD evidence-source correction

The PRD (evidence source 7) states MYN's frontend lives on GitHub at `~/Projects/myn` and only
the backend is on GitLab. Verified while resolving MIN evidence sources: **this is incorrect.**
`~/Projects/myn` is a polyrepo wrapper directory with no `.git` of its own; its `frontend` and
`api` subdirectories are separate git checkouts, and **both are GitLab-hosted**, not split
GitHub/GitLab as the PRD assumed (a private-repo detail — specific remote URLs are withheld here
per the confidentiality findings from the PAN-3367 review; see the confidentiality note in each
`min-*.md` report). A third, unrelated local checkout referenced by the PRD is GitHub-hosted, but
none of the 4 mandatory MIN issues' merge requests resolved there. `audit-batch-e` should use the
local `myn/frontend` and `myn/api` checkouts (GitLab, `glab`) for MIN diffs, not `gh`/GitHub as the
PRD's source list implies.
