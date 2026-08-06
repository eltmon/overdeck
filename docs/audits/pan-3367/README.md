# PAN-3367 — Audit synthesis: were the "laundered" passes actually earned?

**Read-only audit. Nothing re-verdicted, nothing fixed here — see [worklist.md](worklist.md) for the
evidence-gathering method and NonGoals.**

## Headline answers

1. **How many merged diffs did NOT satisfy the failing acceptance criterion? Zero, of 30 audited.**
   Every issue in the worklist — the 25 named in the PAN-3367 issue body plus 5 derived zero-commit
   extras — carries a **satisfied** verdict for the specific failing AC this audit traced. The sharp
   signature (negative verdict → reset to `pending/pending` → `passed/passed` within 60 minutes, often
   with zero commits in the recorded window) reliably flags episodes worth investigating, but in every
   case investigated here it flagged a *real* review cycle whose fix commit either fell outside the
   recorded window (see the methodology corrections below) or genuinely wasn't needed (the diff was
   already correct and the negative state was infra noise). **No case in this worklist matches the
   "pass replaced a defect with nothing" pattern the mechanism in [PAN-3365](https://github.com/eltmon/overdeck/issues/3365)
   made possible.**
2. **How many ACs remain unverifiable ("cannot determine")? Three, all within one issue,
   [PAN-3356](https://github.com/eltmon/overdeck/issues/3356).** PAN-3356's *specific audited finding* (a
   Needs-You stuck-gate recovery bug) is **satisfied** — a fix commit and regression test confirm it. But
   PAN-3356 is the large issue-cockpit redesign, and 3 of its broader cockpit-level acceptance criteria —
   (1) the six-tab information architecture, (2) the Needs-You slot's correct prioritization across all
   redesign states, and (3) the crew spine — were never exercised end-to-end, because
   [PAN-3362](https://github.com/eltmon/overdeck/issues/3362) — "No way to seed tracker-backed issue
   fixtures in workspace containers" — is still **open** and blocks the browser UAT that would verify
   them. See [pan-3356.md](pan-3356.md)'s "Broader-scope caveat" for the full enumeration. PAN-3356 is
   deliberately not closed out pending PAN-3362, per the PAN-3367 issue body. **Re-verification gate:
   PAN-3362.**
3. **Variance versus the expected ~29: worklist totals 30 (+1), fully explained.** 25 mandatory issues
   (24 with surviving event evidence + PAN-1525, whose evidence is compacted) plus 5 derived zero-commit
   extras (well under the cap of 10, no overflow). The flywheel's exact dedup to 29 could not be
   mechanically reconstructed at planning time; see [worklist.md](worklist.md#final-count-and-variance-from-29)
   for the full derivation and the reproduction script's 61-candidate superset.

## Verdict table

Genuine findings are ranked above environment-blocked cases per the issue's stated triage order — a real
finding that got a fix is the higher-value thing to have checked; an environment-blocked case had nothing
to launder in the first place.

| Issue | Classification | Verdict | Report | Follow-up |
| --- | --- | --- | --- | --- |
| [PAN-2467](https://github.com/eltmon/overdeck/issues/2467) | genuine-finding | satisfied | [pan-2467.md](pan-2467.md) | none |
| [PAN-2876](https://github.com/eltmon/overdeck/issues/2876) | genuine-finding | satisfied | [pan-2876.md](pan-2876.md) | none |
| [PAN-3037](https://github.com/eltmon/overdeck/issues/3037) | genuine-finding | satisfied | [pan-3037.md](pan-3037.md) | none |
| [PAN-3097](https://github.com/eltmon/overdeck/issues/3097) | genuine-finding (mechanical) | satisfied | [pan-3097.md](pan-3097.md) | none |
| [PAN-3110](https://github.com/eltmon/overdeck/issues/3110) | genuine-finding | satisfied | [pan-3110.md](pan-3110.md) | none |
| [PAN-3115](https://github.com/eltmon/overdeck/issues/3115) | genuine-finding | satisfied | [pan-3115.md](pan-3115.md) | none |
| [PAN-3155](https://github.com/eltmon/overdeck/issues/3155) | genuine-finding | satisfied | [pan-3155.md](pan-3155.md) | none |
| [PAN-3158](https://github.com/eltmon/overdeck/issues/3158) | genuine-finding | satisfied | [pan-3158.md](pan-3158.md) | none |
| [PAN-3183](https://github.com/eltmon/overdeck/issues/3183) | genuine-finding | satisfied | [pan-3183.md](pan-3183.md) | none |
| [PAN-3184](https://github.com/eltmon/overdeck/issues/3184) | genuine-finding | satisfied | [pan-3184.md](pan-3184.md) | none |
| [PAN-3192](https://github.com/eltmon/overdeck/issues/3192) | genuine-finding | satisfied | [pan-3192.md](pan-3192.md) | none |
| [PAN-3206](https://github.com/eltmon/overdeck/issues/3206) | genuine-finding | satisfied | [pan-3206.md](pan-3206.md) | none |
| [PAN-3230](https://github.com/eltmon/overdeck/issues/3230) | genuine-finding | satisfied | [pan-3230.md](pan-3230.md) | none |
| [PAN-3356](https://github.com/eltmon/overdeck/issues/3356) | genuine-finding | satisfied (finding); cockpit ACs cannot determine | [pan-3356.md](pan-3356.md) | none (PAN-3362 gates re-verification) |
| [PAN-1525](https://github.com/eltmon/overdeck/issues/1525) | genuine-finding (mechanical, lower confidence) | satisfied | [pan-1525.md](pan-1525.md) | none |
| MIN-879 | genuine-finding | satisfied | [min-879.md](min-879.md) | none |
| MIN-896 | genuine-finding | satisfied | [min-896.md](min-896.md) | none |
| [PAN-3076](https://github.com/eltmon/overdeck/issues/3076) | genuine-finding (extra) | satisfied | [extras/pan-3076.md](extras/pan-3076.md) | none |
| [PAN-3128](https://github.com/eltmon/overdeck/issues/3128) | genuine-finding (extra) | satisfied | [extras/pan-3128.md](extras/pan-3128.md) | none |
| [PAN-3093](https://github.com/eltmon/overdeck/issues/3093) | genuine-finding (extra) | satisfied | [extras/pan-3093.md](extras/pan-3093.md) | none |
| [PAN-3049](https://github.com/eltmon/overdeck/issues/3049) | genuine-finding (extra) | satisfied | [extras/pan-3049.md](extras/pan-3049.md) | none |
| [PAN-3229](https://github.com/eltmon/overdeck/issues/3229) | genuine-finding (extra) | satisfied | [extras/pan-3229.md](extras/pan-3229.md) | none |
| [PAN-3052](https://github.com/eltmon/overdeck/issues/3052) | environment-blocked | satisfied | [pan-3052.md](pan-3052.md) | none |
| [PAN-3083](https://github.com/eltmon/overdeck/issues/3083) | environment-blocked | satisfied | [pan-3083.md](pan-3083.md) | none |
| [PAN-3109](https://github.com/eltmon/overdeck/issues/3109) | environment-blocked | satisfied | [pan-3109.md](pan-3109.md) | none |
| [PAN-3114](https://github.com/eltmon/overdeck/issues/3114) | environment-blocked | satisfied | [pan-3114.md](pan-3114.md) | none |
| [PAN-3147](https://github.com/eltmon/overdeck/issues/3147) | environment-blocked | satisfied | [pan-3147.md](pan-3147.md) | none |
| [PAN-3216](https://github.com/eltmon/overdeck/issues/3216) | environment-blocked | satisfied | [pan-3216.md](pan-3216.md) | none |
| MIN-858 | environment-blocked (false positive) | satisfied | [min-858.md](min-858.md) | none |
| MIN-901 | environment-blocked (false positive) | satisfied | [min-901.md](min-901.md) | none |

## Classification breakdown

- **genuine-finding: 22 of 30.** A real review finding (correctness, security, or requirements gap) was
  raised, and the merged diff contains a fix commit that matches the finding's own description — confirmed
  by reading the actual diff for every one of the 22, not by trusting the commit message alone. Two of
  these (PAN-3097, PAN-1525) are mechanical: a generated-artifact-freshness lint gate rather than a logic
  defect. One (PAN-3356) covers only its narrowly-traced finding, not the issue's full scope (see headline
  answer 2).
- **environment-blocked: 8 of 30.** No finding was ever recorded, or the recorded finding was a confirmed
  false positive unrelated to the diff's actual changed files (MIN-858, MIN-901 — the identical finding
  text attached to two unrelated merge requests in two different private repositories, neither of which
  touches the file the finding concerns; see the confidentiality note in each report for why the specific
  finding text isn't reproduced here). The remaining 6 (PAN-3052, PAN-3083, PAN-3109, PAN-3114, PAN-3147,
  PAN-3216) are pure infra/dispatch retries — tmux launch failures, a database lock, a verification-worker
  crash — with the pipeline's own notes in several cases explicitly stating no code finding was made
  (PAN-3114: "no code findings were emitted").
- **unknown: 0.**

## Why "zero not-satisfied" doesn't mean the audited episodes were simple

Several issues required real forensic work to reach their verdict, and three methodology hazards emerged
during the audit that materially changed what "the failing AC" actually was for a given issue. These are
recorded in full in `.overdeck/continue.json` (H8-H13 equivalents) and summarized here because they explain
why a "0 commits in the recorded window" signal, taken alone, is not proof of anything:

- **H11 — stale first-note artifact.** `worklist.md`'s `negNotes` cell can show an early, often
  infra-flavored note instead of the real finding, because the reproduction script's state-collapse keeps
  only the first note per contiguous `reviewStatus/testStatus` run. Confirmed for roughly a third of the
  mandatory issues (PAN-3192, PAN-3206, PAN-3230, PAN-3110, PAN-3115, PAN-3155, PAN-3183, MIN-858,
  MIN-896, and all five derived extras). For the affected **PAN** issues, every report reads the full
  committed `evidence/events-<issue>.json.gz` dump rather than trusting the worklist row — that dump is
  public, reproducible evidence anyone can inspect. For the affected **MIN** issues (MIN-858, MIN-896),
  the same full-history read happened, but against a raw event dump generated locally and never committed
  to this public repository (see the confidentiality note in each `min-*.md` report) — the finding text
  quoted in those reports is independently reproducible only by someone with `mind-your-now` access
  re-running the (also-committed) generator locally, not from this repo's own tree.
- **H12 — transient passes.** A `passed/passed` state can revert to `blocked/passed` milliseconds to
  minutes later when a re-review immediately surfaces a regression or an unrelated new finding. Confirmed
  for MIN-879 (a fix for one PostHog-identity bug introduced a second one, caught and fixed 14 minutes
  later) and for the derived extras PAN-3049 and PAN-3229. Where this happened, the report traces forward
  to the true durable pass rather than stopping at the worklist's recorded `passAt`.
- **H9 (both directions) — rebase timestamp drift.** A branch-wide `git merge main` / rebase can either
  **inflate** a window's commit count with unrelated noise (confirmed for PAN-3230: 24 total commits, most
  sharing one `committedDate` from a merge batch unrelated to the issue) or **deflate** it to a false zero
  (confirmed for the derived extras PAN-3128 and PAN-3093: both showed 0 commits by `committedDate` but a
  real, matching fix commit by `authoredDate`). Every "0 commits, environment-blocked" verdict in the final
  table was cross-checked against an explicit pipeline note confirming no finding was ever recorded, not
  against the commit count alone — this is what rules out H9's deflation direction as an unnoticed false
  negative.

**What this means for reading "0 not-satisfied":** it is not the ceiling of what this audit could have
found — every genuine finding this audit traced back to a specific negative-verdict episode did, in fact,
have a fix commit landing in the actual diff. It does not certify the diffs are defect-free in some
absolute sense; it certifies that the specific gap each review flagged before the reset-and-pass sequence
was closed by the time the code merged.

## What this audit did not check

Per [worklist.md](worklist.md)'s NonGoals and the PRD: this audit did not re-run or re-verdict any
review/test cycle, did not treat "the suite passes now" as evidence, and did not audit issues outside the
sharp-signature worklist (the flywheel's broader ~74-issue loose set is normal rework, explicitly excluded
by its own analysis). It answers one narrow question per issue — did the diff close the gap the review
actually flagged — not a general code-quality review.
