# Independent review — FEEDBACK (Kimi K3)

Reviewer: Kimi K3, adversarial pass over the five claims in `REVIEW-BRIEF.md`.
Method: every claim re-derived from source in the detached worktree
(`/home/eltmon/Projects/hoff-k3-review`, main @ 44eaa91f1a), cross-checked
against live state (deacon.log, `/api/review/MIN-901/status`, the MIN-901
workspace's git state, `~/.overdeck/projects.yaml`, the api sub-repo's
`.gitlab-ci.yml`).

**Headline: all five claims CONFIRMED.** One claim's proposed fix is
necessary but not sufficient — I found three more wrapper-blind sites in the
same defect class, including the main HTTP route that stamps
`reviewedAtCommit`. Two corrections to the brief's incident timeline
(cadence and loop start) that do not change any mechanism.

---

## Claim 1 — `checkPostReviewCommits` is polyrepo-blind → infinite review loop

**Verdict: CONFIRMED — and the proposed fix alone does not terminate every
variant of the loop.**

**Evidence.**

- `src/lib/cloister/deacon.ts:1597-1606`: raw `git rev-parse HEAD` at
  `workspacePath` compared with `===` against `status.reviewedAtCommit`.
  Live MIN-901 row: `reviewedAtCommit` is the composite
  `fe@52d65da6… api@025ec1f3… infra@f01de3d4… docs@3bd1e5d4… myn-skills@1af50d0d… openclaw-plugin@57e03cc9…`;
  wrapper HEAD is `7492ae82…`. String equality is impossible. Mechanism is
  exactly as claimed.
- Escape hatches all throw on the composite and fall through:
  - `:1613` — `git rev-parse ${reviewedAtCommit}^{tree}` with a composite is
    not a valid ref → throws → caught at `:1621` ("safer than skipping" —
    here it is the unsafe direction).
  - `:1631-1632` — `haveSameEffectiveCodeCommit` → `getEffectiveCodeCommit`
    (`src/lib/pipeline-state-paths.ts:31`) does `rev-parse <composite>` →
    rejects → the `||` never reaches `haveSameCodeContribution`; the throw
    is caught at `:1638` → falls through. (Even if reached,
    `haveSameCodeContribution` returns `false` on unresolvable refs —
    `pipeline-state-paths.ts:105-107` — so it too defaults to reset.)
- Live: deacon.log has **48** `Reset review for MIN-901` entries; earliest
  **08:46:42Z**, latest **12:10:37Z** (still cycling as I write this). Each
  reset re-dispatches a review convoy (`deacon.ts:1680-1699`), so the burn
  is a full convoy per cycle, not just a patrol line.
- The doc comment on `snapshotWorkspaceHeadsPromise`
  (`src/lib/git-utils.ts:356-359`) says consumers that misuse the anchor as
  a git ref "fall back to their conservative full-rerun path". That design
  assumption is wrong here: the "conservative" fallback is a review reset +
  convoy re-dispatch. The helper's contract invited exactly this failure.

**What the analysis missed — three more wrapper-blind stamp sites, one of
them the main route.** The brief frames Claim 1 as one missed comparison
site. The anchor is *written* wrapper-blind in three places:

1. **`src/dashboard/server/routes/workspaces.ts:1462-1466`** — the primary
   `POST /api/review/:issueId/status` route stamps
   `update.reviewedAtCommit = gitInfo.HEAD` via `getWorkspaceGitInfo`
   (wrapper-blind, `git-utils.ts:333-347`) on every `reviewStatus: 'passed'`
   POST. On a polyrepo this writes the **wrapper SHA**.
2. **`src/dashboard/server/routes/specialists/legacy-routes.ts:293-304`** —
   the mounted `specialists/done` HTTP route (confirmed mounted via
   `specialists.ts:42` → `server.ts:326`) stamps the same wrapper SHA via
   `getWorkspaceGitInfo`.
3. **`src/lib/cloister/deacon.ts:1519-1525`** — the verification-bypass
   path ("Bypassed review … review infra failed") stamps `reviewedAtCommit`
   from a raw `rev-parse HEAD` at the workspace root.

Consequence, and it cuts both ways:

- **Composite-stamped anchor** (via `deacon-review-signals.ts:240-241`,
  `deacon-review-status.ts:544`, or CLI `specialists/done.ts:146`) +
  wrapper comparison → the reset-forever loop MIN-901 is in now.
- **Wrapper-stamped anchor** (the three sites above) + wrapper comparison →
  `currentHead === reviewedAtCommit` is always true → post-review commits
  in sub-repos are **never detected**. Review is never invalidated no
  matter what lands after approval. This is the silent inverse of the loop
  and arguably worse: it ships unreviewed code with a green pipeline.

This also explains why the MIN-901 loop started when it did: the 09:55Z
pass was stamped composite by the *reconciliation* path (deacon.log:
`Reconciled journaled advancing verdict for MIN-901`, 09:55:14Z), not by
the HTTP route. Had the review agent POSTed normally, the route would have
stamped the wrapper SHA and the issue would have sat in the never-detect
mode instead.

**Fix critique.** `snapshotWorkspaceHeadsPromise` for `currentHead` is
correct and monorepo-safe (verified `computeWorkspaceRepoRootsSync`,
`project-repos.ts:139-166`: monorepo → single root, `isPolyrepo: false` →
bare SHA; comparison and hatches behave exactly as today). But it is **not
sufficient**:

- **Required addition A:** convert all three stamp sites to
  `snapshotWorkspaceHeadsPromise` as well. Otherwise any issue whose pass
  flows through the HTTP route gets a wrapper anchor, and after the fix a
  composite `currentHead` compared to a wrapper anchor mismatches → tree
  check throws on the composite → reset → re-review re-stamps wrapper →
  **the loop re-forms through mixed formats**. Fixing only the read side
  changes which issues loop; it does not end the looping.
- **Required addition B (semantics):** the per-sub-repo escape hatches need
  an explicit decision rule. Correct semantics: preserve verdicts only if
  **every** sub-repo head change is benign (tree-identical or same
  patch-id); **any** sub-repo with a real drift invalidates. Two sub-repos
  disagreeing is therefore well-defined. `parseCompositeSnapshot`
  (`src/lib/cloister/inspect-checkpoints.ts:~120`) already exists for
  splitting the anchor — reuse it rather than writing a third parser.
- The proposed regression test (polyrepo fixture, unchanged heads → zero
  actions) is right; add a second: wrapper-stamped legacy anchor +
  composite current → exactly one benign migration (advance the snapshot),
  not a reset. That pins the mixed-format behavior.

**Corrections to the brief (mechanism unaffected):** the loop cadence is
~1–2.5 min, not "roughly every 30 seconds"; and the first reset is
08:46:42Z, not "11:12Z onward" — the loop predates the window the brief
gives by ~2.5 h.

---

## Claim 2 — the test-role auto-skip can report "tests passed" when nothing ran tests

**Verdict: CONFIRMED — mechanism, live state, and no compensating safety
net.**

**Evidence.**

- `src/lib/review-status.ts:437-452`: skip condition and the direct write
  of `testStatus: 'passed'` / `'Skipped: no code changed since pre-review
  verification gate'` exactly as claimed.
- Live MIN-901 row: `testStatus: 'passed'`,
  `testNotes: 'Skipped: no code changed since pre-review verification gate'`,
  `reviewedAtCommit === lastVerifiedCommit` (identical composites). The
  skip is not hypothetical; it is the current pipeline state of a real
  issue whose last two api commits (`ed4fa482`, `025ec1f3`) have never had
  a test executed against them.
- `~/.overdeck/projects.yaml` MYN block has **two separate sections**:
  `tests:` (lines 84–107: `./mvnw test -Pfast-test`,
  `./mvnw test -Dtest=FlywayMigrationValidationTest`, `pnpm test -- --run`,
  `pnpm exec playwright test`) and `quality_gates:` (lines 108–132:
  `pnpm lint`, `pnpm typecheck`, `pnpm build:ci`, `./mvnw compile`). The
  verification runner executes `quality_gates` only — so "no code changed
  since verification" carries **zero** information about test results.
  `./mvnw compile` does not even test-compile.
- No external net: the api sub-repo's `.gitlab-ci.yml` (in the MIN-901
  workspace) is build/deploy only (kaniko image + kubectl apply); no maven
  test stage.
- The skip was introduced 2026-05-03 in `408185090c` ("feat(pipeline): skip
  redundant tests…"), predating both the `tests:`/`quality_gates:` split's
  practical divergence and PAN-2948. It encodes an assumption that was
  never true for MYN.

**What the analysis missed.**

1. **The skip also bypasses the UAT decision.** The test role's mandate
   includes deciding and running browser UAT
   (`test-agent-queue.ts:42-47`). The only other UAT machinery
   (`uat-assemble.ts`, PAN-1691) is the human-UAT bundle flow for
   auto-merge-OFF mode. For auto-merge projects (panopticon-cli has
   `auto_merge_default: auto`), a skip means no UAT evaluation happens
   anywhere in the pipeline. The claim undersells itself: the skip doesn't
   just skip tests, it skips the entire verification role.
2. **Which stamp path fired matters here too.** For MIN-901 the skip fired
   inside the reconciliation path's single `setReviewStatusSync` update
   (composite == composite). Had the HTTP route stamped the wrapper SHA,
   the skip would *not* have fired (wrapper ≠ composite) and the test role
   would have run — meaning the skip's behavior on polyrepos currently
   depends on which path happened to stamp the anchor. Another reason the
   stamp sites from Claim 1 must be fixed first or together.

**Fix critique.** A per-project opt-in flag is the right *shape*, and
default-false is the only safe default — but derive the default rather than
making it purely manual:

- **Better rule:** skip only if the project has **no `tests:` section**
  (nothing for the role to run) **or** sets an explicit
  `verification_covers_tests: true`. That makes MYN-class configs correct
  by default with zero operator action, and keeps the optimization
  available where gates genuinely run the suite (panopticon-cli's gates do
  execute vitest — but see the UAT hole above; even there the skip is only
  sound for issues with no UI surface).
- Deriving from gate definitions (a `kind: test` field) is worse: gate
  commands are free-form shell (`./mvnw test -Pfast-test` vs `pnpm test --
  --run`); classification will drift from reality. Don't parse shell.
- **Blast radius of default-false:** modest and one-directional. Projects
  where the skip fires today get one real test-role run per review pass,
  serialized through the existing advancing-slot ceiling
  (`deacon.ts:1314`) — no dispatch storm, just the cost the pipeline was
  always supposed to pay. The only projects that could *rely* on the skip
  are ones whose gates already run tests; for them the flag is a one-line
  config opt-in.
- Whatever the gating, the skip must not suppress the UAT decision for
  issues with acceptance criteria that name UI behavior. Cheapest correct
  version: when skipping, require either no UI-touching changed files in
  the review context manifest, or an explicit `skip_uat: true` project
  flag. If that feels like scope creep, say so in the issue and file the
  UAT half separately — but don't ship the flag pretending the skip only
  skips tests.

---

## Claim 3 — a test agent that objects instead of POSTing `failed` is invisible

**Verdict: CONFIRMED — and it is a missing feature, not a broken existing
one. The existing recovery machinery has a precise lane-coverage gap: two
patrols each believe the other owns this case.**

**Evidence.**

- Delivery trigger confirmed: `review-status.ts:465-470` fires
  `deliverTestFailureToWorkAgentHostSide` only on transition into
  `failed`/`dispatch_failed`. No transition → no feedback file, no message,
  no needs-you trip. `deliverTestFailureToWorkAgentHostSide` itself
  (`:641-669`) behaves as described.
- `maybeRecoverTestVerdictHostSide` (`review-status.ts:562-570`) exists but
  recovers only from a **written artifact** (`recoverTestVerdictHostSide`,
  `:580-582`: `if (!artifact) return`). An objecting agent writes nothing.
- The deacon failsafe `checkCompletedButUnsignaledTests`
  (`deacon.ts:1393+`) handles `testStatus ∈ {testing, pending}`, but its
  decision core (`test-verdict.ts:113-115`) returns `'none'` for
  dead-session + no-artifact, with a comment claiming
  "checkPendingTestDispatch / the orphan sweep own re-dispatch".
- **The comment is wrong for this lane.** `checkPendingTestDispatch`
  (`deacon.ts:1242-1243`) filters `testStatus ∈ {'pending',
  'dispatch_failed'}` — `testing` is excluded. I searched for any orphan /
  agent-stop path that flips `testing` back to `pending`; none exists.
- Net behavior for "agent stops while `testing`, no artifact, no POST":
  nothing re-dispatches, nothing surfaces, nothing tells the work agent.
  The issue sits at `testing` until a human looks at it. That is exactly
  the MIN-901 09:58Z episode (with the skip having coincidentally papered
  over the status).

**Fix critique.** The proposed fix (dead session + still `testing` + no
current-artifact → `dispatch_failed` with the agent's last message as
notes) routes into the existing recovery lane: `checkPendingTestDispatch`
retries up to 3 times then marks `stuck: test_signal_strand`
(`deacon.ts:1257-1274`), and the transition fires
`deliverTestFailureToWorkAgentHostSide`. I checked the 45 backend +
frontend consumers of `dispatch_failed`: all treat it as a terminal
test-blocked state needing attention — correct presentation for this case.
Two caveats:

1. **Message accuracy.** `deliverTestFailureToWorkAgentHostSide`'s text is
   hardcoded "test-agent reported FAILED" (`review-status.ts:656`). For a
   no-verdict stop that is a lie — nothing failed, the run never reported.
   Parameterize the message (or branch on a notes prefix) so the work agent
   isn't told to "fix failing tests" that don't exist. Small change, same
   door.
2. **False positives.** The natural home is the `'none'` branch of
   `decideUnsignaledTestAction` (it already has `sessionLive` and the H3
   mtime-guarded artifact). Dead-session detection there is sound — a
   tmux session that doesn't exist cannot be mid-run — but keep the D6
   rule intact: flip to `dispatch_failed` (a *re-dispatch* signal), never
   to `failed` on the merits, and never to `passed`. Operator-stopped test
   agents are the main false-positive class; check the agent's stop reason
   (paused/stoppedByUser gates) before flipping, or you'll fight the
   operator's deliberate pause.

---

## Claim 4 — the test-role prompt never tells the agent it is in a polyrepo

**Verdict: CONFIRMED — and the prompt is worse than incomplete: its first
two steps actively anchor the agent to the one directory where every git
command returns wrong answers.**

**Evidence.**

- `test-agent-queue.ts:20-63` emits one `WORKSPACE:` and one `BRANCH:` line
  — confirmed. Steps 1–2 instruct "verify you are in the workspace above
  with `pwd`" and "Work only in the workspace above. Never run … git …
  commands from the main checkout or another worktree."
- The MIN-901 workspace root is a wrapper repo tracking exactly two files
  (`.gitignore`, `.pan/drafts/MIN-901.md` — `git ls-files`). Its HEAD is a
  one-commit artifacts commit (`7492ae82`).
- **No ambient guidance exists at the root:** no `CLAUDE.md`/`AGENTS.md` in
  the workspace root (context files live only inside sub-repos:
  `api/CLAUDE.md`, `fe/CLAUDE.md`, …). `roles/test.md` and `roles/work.md`
  contain zero polyrepo guidance (grepped).
- So a test agent following the prompt's own step 1–2 runs
  `git cat-file -t 025ec1f3` at the wrapper, gets "not found", and —
  exactly as the incident shows — concludes the workspace is stale. The
  09:58Z objection is a direct, predictable product of this prompt.
- Contrast confirmed: `review-agent.ts:365-367` and `:548-550` resolve
  `resolveWorkspaceRepoRootsSync(...)[0]?.dir` with explicit PAN-2948
  comments.

**Fix critique.** The prompt is the right primary place — it is generated
per-dispatch and can carry live per-repo heads; a role-doc-only fix relies
on the agent remembering generic advice at the moment of failure. Emitting
the sub-repo block (dir, branch, head) plus the explicit "the workspace
root is a wrapper repo; its HEAD never changes; run every git command with
`git -C <subdir>`" is the correct content. `test-agent-queue.test.ts`
exists for the regression case. Two additions:

1. **Also fix `roles/test.md`** (one paragraph) so hand-written or
   re-dispatched prompts inherit the same mental model; the prompt is
   per-run, the role doc is the durable contract.
2. **Do not "make git commands repo-aware" structurally** (shims, wrapper
   scripts). That way lies magic; a confused agent is better fixed by
   telling it the truth.
3. While editing this prompt, note (don't necessarily fix here): step 3
   cites retired paths (`.pan/records/`, `.pan/specs/`) that post-PAN-2541
   projects no longer have — same class of stale-truth-telling.

---

## Claim 5 — `roleRunHead` is wrapper-only, so zombie role-run detection is inert on polyrepos

**Verdict: CONFIRMED — mechanism exact; consequence correctly stated; two
fix caveats the brief asked about.**

**Evidence.**

- `spawn.ts:467-471`: stamps `git rev-parse --short=8 HEAD` at the
  workspace root into `state.roleRunHead`.
- `service-reactive.ts:170-182`: reads the same root HEAD, compares,
  declares stale on mismatch. On a polyrepo both sides are the immutable
  wrapper SHA → never mismatches → the zombie check never fires; liveness
  degrades to status-only.
- Consequence: a finished-but-never-exited role session
  (`status: 'running'` forever) blocks re-dispatch of that role via
  `activeRoleRunExists`. Partial compensation exists for *dead* sessions
  (pane-death checks in `checkPendingTestDispatch` /
  `checkCompletedButUnsignaledTests`) and for the test role specifically
  (the unsignaled-verdict patrol), but the live-idling-zombie case this
  marker exists for is genuinely inert on polyrepos.
- DB column confirmed: `role_run_head TEXT` (`database/schema.ts:456`),
  existing rows are 8-char SHAs.

**Fix critique.** `snapshotWorkspaceHeadsPromise` on both sides is right.
Two caveats:

1. **Format-migration guard.** Existing stored values are short SHAs. A
   composite `currentHead` vs a legacy short-SHA `roleRunHead` mismatches →
   declares a genuinely-active legacy session stale → double-dispatch
   alongside the live one. Direction is the "safe" one for a zombie check
   (permits rather than blocks), but a double-spawned review convoy is real
   cost. Cheap guard: only compare when formats match (both composite or
   both bare); on format mismatch treat the marker as absent and fall back
   to status-only, and re-stamp on the next save.
2. **Interaction with Claim 1's fix.** Both make polyrepo drift newly
   visible. I traced the combined cycle: review passes → api commit lands
   → reset + re-dispatch (Claim 1) → new run stamps composite head → runs
   → passes → stable. No feedback loop between them; the zombie check only
   gates *re*-dispatch of an already-live role, and the reset path
   dispatches with `force: true` (`deacon.ts:1687`), which bypasses the
   staleness deferral. Safe to land together, but land them in one issue so
   the mixed-format comparison tests cover both.

**Adjacent finding (same file family, not one of the five):**
`review-agent.ts:365-367` and `:548-550` were only *half*-migrated by
PAN-2948 — they stamp runIds from `resolveWorkspaceRepoRootsSync(...)[0]`
(the first configured repo — `fe` for MYN), not a composite. On api-only
drift the fe-based runId still matches, so non-forced dispatch paths
consider a stale convoy current. Low frequency (forced paths bypass), but
it belongs in the same fix issue.

---

## Cross-cutting questions

### 1. Remaining raw-HEAD sites beyond the two named

Swept every `git rev-parse HEAD` in pipeline code. Report, by class:

**Same defect class (anchor stored/compared, wrapper-blind) — must fix with
Claims 1/5:**

- `src/dashboard/server/routes/workspaces.ts:1462-1466` — **the main
  review-status POST route stamps `reviewedAtCommit` wrapper-blind.** Most
  important find of this review.
- `src/dashboard/server/routes/specialists/legacy-routes.ts:293-304` —
  mounted legacy route, same stamp.
- `src/lib/cloister/deacon.ts:1519-1525` — verification-bypass path, same
  stamp.
- `src/lib/cloister/service-crash.ts:111` — `progressFingerprint` reads the
  wrapper HEAD as its git component; on polyrepos the component is frozen,
  so "no progress" detection leans entirely on pane output. Degraded, not
  broken — an agent committing silently between pokes can look stuck.

**Partial PAN-2948 migrations (first-repo-only, not composite):**

- `src/lib/cloister/review-agent.ts:365-367`, `:548-550` (runId stamping —
  see Claim 5's adjacent finding).

**Audited and clean:** `inspect-checkpoints.ts` (fully per-repo,
reuses composite parsing), `git-utils.ts:370` (the composite producer
itself). CLI/release/merge-ops sites operate on primary main checkouts,
not workspaces — except `merge-agent.ts:1119` and `validation.ts:290/302`,
which operate on `projectPath` during merge/auto-revert; whether MYN's
polyrepo merge flow reaches them with a wrapper `projectPath` I could not
confirm read-only. Flag for the fix issue's author to trace; do not assume
clean.

### 2. CI guard vs structural fix

A grep-style CI guard on `git rev-parse HEAD` with a workspace `cwd` is the
wrong tool — there are many legitimate per-repo uses, and the violation is
about *which directory* and *what you do with the result*, not the command.
The proportionate structural fix is a **typed head anchor**:

- One producer: `readWorkspaceHeadAnchor(issueId, workspace)` wrapping
  `snapshotWorkspaceHeadsPromise`, returning a branded type
  (`HeadAnchor = string & {__brand}`) that git-helper signatures refuse.
  The current bug class is possible because an anchor is a plain `string`
  and every git call accepts plain strings.
- One parser: `parseCompositeSnapshot` (already exists).
- Rename the raw helper (`getWorkspaceGitInfo` → something like
  `getRawRepoHeadAtPath`) so call sites self-document that they bypass the
  anchor. Then a *narrow* CI tripwire — flag new `getRawRepoHeadAtPath`
  imports under `src/lib/cloister/` and the dashboard routes — is cheap and
  won't false-positive.
- Unit-test invariant: `reviewedAtCommit`, `lastVerifiedCommit`,
  `roleRunHead` may only be produced by the anchor producer. That test
  would have caught all three stamp sites and both comparison sites today.

### 3. Severity ordering

The brief's implicit 1→5 ordering is almost right; I'd keep it, with one
argument sharpened:

1. **Claim 1 — fix first.** It is on fire *right now* (48 convoy
   re-dispatches and counting on one issue), and its inverse mode
   (wrapper-stamped anchor → never re-review) silently ships unreviewed
   code. One defect class, both failure modes, fix together with the three
   stamp sites.
2. **Claim 2.** The pipeline's core promise is "testStatus: passed means
   tests ran and passed." This violates it silently and durably — every
   skip is a lie of record in the DB. Less loud than Claim 1, more
   corrosive. Land immediately after; do not batch it behind anything.
3. **Claim 3.** Invisible stranding with a clean, well-located fix that
   reuses existing lanes. Real but narrow (requires agent stop + no
   artifact + no POST).
4. **Claim 4.** Caused the visible human-facing symptom (the objection),
   cheap to fix, but agents *can* recover and the blast radius is confusion
   rather than corruption.
5. **Claim 5.** Degraded signal with partial compensation elsewhere. Fix
   with Claim 1's issue since they share the anchor machinery and the
   mixed-format test matrix.

Interim containment (operator's call, not mine): MIN-901's loop is still
cycling; `deacon_ignored: true` on that issue stops the token burn while
the fix is built. Do not merge MIN-901 on the strength of its current
`testStatus: passed` — it is the Claim-2 skip artifact, and the fixed
commits have never been tested.

---

## Summary table

| # | Claim | Verdict | Proposed fix |
|---|-------|---------|--------------|
| 1 | `checkPostReviewCommits` polyrepo-blind loop | **CONFIRMED** (48 live resets) | Right direction, **insufficient alone** — must also convert 3 wrapper-blind stamp sites (workspaces.ts:1466, legacy-routes.ts:303, deacon.ts:1524) or the loop re-forms through mixed anchor formats |
| 2 | Auto-skip reports tests passed with no tests | **CONFIRMED** (live skip artifact; gates are lint/typecheck/build/compile only; no CI net) | Flag is the right shape; derive default from absence of `tests:` section; must also not skip the UAT decision |
| 3 | Objecting test agent is invisible | **CONFIRMED** — missing feature; lane gap between two patrols (`test-verdict.ts:115` vs `deacon.ts:1243`) | Sound; parameterize the "reported FAILED" message; respect operator-stop gates to avoid false positives |
| 4 | Test prompt polyrepo-blind | **CONFIRMED** — and steps 1–2 actively anchor to the wrapper; no CLAUDE.md at root to compensate | Prompt is the right place (+ one paragraph in roles/test.md); do not build git shims |
| 5 | `roleRunHead` wrapper-only zombie check | **CONFIRMED** | Right; add format-migration guard on legacy short-SHA rows; safe to land with Claim 1 in one issue |
