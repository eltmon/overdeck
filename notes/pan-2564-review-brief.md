# Review brief — PAN-2564 PRD (Dolt-native cross-machine beads authority)

You are forked from conversation 798 ("Beads sync across machines via overdeck-state branch"), so you already hold the context for this problem. Your job: **critically review** the PRD and write feedback. Do NOT implement anything. Read-only.

## Read first
- The PRD: `/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2564.md` (full spec: glossary, decisions D1–D8, FR-1..8/NFR-1..3, verified file:line map in §5, work items WI-1..12, checkpoints C1–C3, ACs).
- The issue: https://github.com/eltmon/overdeck/issues/2564

## Write your feedback to
`/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2564-FEEDBACK-gpt5.6-conv798.md`

## Review these specifically (be concrete; cite FR/WI/file:line)
1. **Dolt-native design soundness** — is "refs/dolt/data canonical (git-hosted), local Dolt as gitignored disposable cache, single read door + single write door, issues.jsonl derived-only" the right model? Any flaw vs Overdeck's single-source-of-truth tenet?
2. **Conflict lifecycle (D6 / checkpoint C1)** — divergent Dolt histories across machines. Is "pull→mutate→commit→push, never blind --force, single-writer serialization, typed conflict on rejected push" sufficient? What real concurrency case breaks it? Is the single-writer assumption actually enforceable given workspaces + dashboard + CLI all mutate?
3. **Migration-refuse gate (WI-1)** — does the Dolt-layout detection cover every live-Dolt shape? Any way live Dolt still reaches overdeck-state?
4. **Read/write door completeness (WI-2/WI-3)** — check the §5 file:line map: is any live beads read or mutation missed and left touching issues.jsonl or bd directly? Especially the PURE-jsonl readers (done-preflight, orphan-reconciler, triggers mtime cache, the presence checks in backlog-input/lookups/backlog/flywheel).
5. **A→B→C staleness / data loss** — any path where C still shows stale/zero, or where the 3,291-vs-3,214 divergence gets resolved by silently picking a side. Is FR-7 reconciliation gated hard enough before cutover?
6. **PAN-1158 class** — under Dolt-canonical, can an empty/partial local DB still overwrite good remote history or delete the tracked export? Is WI-6's refuse-empty + WI-3's pull-before-mutate enough?
7. **Gaps/missing FRs/WIs** — keyless Fly VM path (C2), offline `pan done` (network dependency of FR-3), dashboard freshness without blocking the 10s poll (WI-5), and anything else.

## When done
Write the feedback file, then reply in this conversation: "Feedback written to <path>" with a one-line verdict (approve / approve-with-changes / needs-rework) and the top 3 issues.
