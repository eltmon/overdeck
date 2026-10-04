# Operator UI parity: run Overdeck without the terminal

**Issue:** none yet (draft; file one issue per theme or one epic with the work items below)
**Planned against:** `main` @ `9e82cde41a3` (2026-09-30)
**Status:** draft for operator review. Not committed.

## Summary

The operator wants to drive Overdeck from the dashboard alone. Today most per-issue lifecycle
actions already have a button (the issue-action registry, `ISSUE_ACTIONS`), but the actions the
operator actually reached for in the last two days did not: diagnosing and unsticking a PR,
relaying a CI failure to the agent, reloading the dashboard onto new code, closing out a merged
issue whose Definition-of-Done gate misses a row, waiving a test removal, clearing a troubled
gate, cutting a release, pairing a device, managing the Session Vault, and finding which
workspaces eat the disk. Several of these already have server machinery with no UI
(`runComposerReload`, `/api/pairing/*`, `/api/devices`, `/api/workspaces/:issueId/clean/preview`,
`collectHygieneReport`, close-out `acceptedRows`), so much of this PRD is wiring, not new engines.

This PRD inventories every operator-facing `pan` verb against the dashboard (Appendix A), groups
the gaps into seven themes, ranks them by operator pain, and specifies 17 work items. Open issues
that already own part of the work are dependencies, not duplicated (see "Dependencies").

## Glossary

- **Command Deck** - the three-column primary surface: left sidebar (conversations + issue tree),
  center Stage, right Awareness rail. `src/dashboard/frontend/src/components/CommandDeck/index.tsx`.
- **Stage** - the project-scoped tabbed pane deck inside Command Deck.
  `src/dashboard/frontend/src/components/Stage/index.tsx`.
- **Cockpit** - the body of an `issue` pane: header (phase pill, PR/CI stats, `MergeCta`,
  `IssueActionMegaMenu`, `StatusNarrative`) over a three-column body.
  `src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx`.
- **Blocker spotlight** - the cockpit's single hero banner naming why an issue is blocked.
  Pure derivation `deriveSpotlight()` in `Stage/cockpit/spotlight.ts`, rendered by
  `Stage/cockpit/IssueBlockerSpotlight.tsx`. Returns at most one reason today.
- **Issue-action registry** - `ISSUE_ACTIONS` in `src/dashboard/frontend/src/lib/issueActions.ts`
  (entries at lines 608-634). Each entry has `key`, `label`, `panVerb`, `endpoint`, `enabledWhen`,
  `kind` (`safe` | `dialog` | `destructive`), `group`, `placement`. Parity tests
  `issueActions.no-actions-lost` and `.parity` block drift. Every issue-scoped button reuses it.
- **IssueActionState** - the input every registry predicate reads (`issueActions.ts:79`), built in
  `components/IssueActionMenu/useIssueActions.ts` (search `const state: IssueActionState = useMemo`).
- **Awareness rail / Needs-you** - right rail `SessionFeedSidebar`; its `NeedsYouSection`
  (`components/sessionFeed/SessionFeedSidebar.tsx:181-191`) lists only pending-input subjects
  (AskUserQuestion, plan approval, permission, session-resume) from `usePendingInputSubjects()`
  (`lib/useDecisions.ts:144`).
- **Restart gate** - server-side queue of restart requests waiting for operator approval.
  Routes in `src/dashboard/server/routes/restart-gate.ts` (`GET /api/restart-gate`,
  `POST /api/restart-gate/approve`, lines 42-105). UI: `components/RestartApprovalBanner.tsx:76`
  mounted at `App/AppChrome.tsx:85`.
- **Deploy staleness** - running build commit vs `origin/main`. `hooks/useDeployStaleness.ts`,
  shown by `components/StaleBuildChip.tsx` (mounted at `App/AppChrome.tsx:213`).
- **`pan reload`** - builds CI-green `origin/main` into a new deployment generation, waits on the
  restart gate, restarts the dashboard. It ships `origin/main`, not the repo HEAD.
- **Composer `/pan` commands** - typing `/pan <verb>` in a conversation composer runs the verb
  server-side through `src/lib/composer-commands/router.ts` (`handleComposerCommand`, line 97).
  The policy table `src/lib/composer-commands/policy.ts` (`COMPOSER_COMMAND_POLICIES`) enables
  only `start`, `plan`, `reload` (detached), `show`, `status`, `tell` (captured), and `handoff`,
  `fork` (ui). Every other verb falls to `DEFAULT_POLICY = { mode: 'terminal-only' }` and is
  rejected with "must run in a terminal".
- **`runComposerReload`** - `src/lib/composer-commands/reload.ts:16`. Spawns a detached
  `pan reload` with a log under `~/.overdeck/logs/composer-reload-<uuid>.log`, sets
  `OVERDECK_RESTART_INITIATOR=operator:composer`, and reports phases (`building`,
  `awaiting-approval`, `restarting`, `completed`, `failed`) to the Activity feed.
- **Deploy progress projection** - `src/dashboard/server/services/deploy-progress.ts`; re-derives
  reload progress from the restart lock, restart gate and reload log, and emits
  `project.deploy_changed` over `/ws/rpc`. Nothing stored.
- **DoD gate / rows** - Definition-of-Done rows checked by close-out (`src/lib/lifecycle/dod.ts`,
  `src/lib/lifecycle/dod-gate.ts`). Rows marked `overridable` may be accepted by the operator.
- **Close-out dispositions** - `pan close --abandon <reason>` (close without landing evidence,
  PAN-3211) and `--residue <reason>` (close stale convention PRs, PAN-3396). CLI-only today
  (`src/cli/commands/close.ts:61-62`).
- **Test-skip gate** - verification gate named `test-skip`
  (`src/lib/cloister/verification-runner.ts:568`) that fails on added `.skip`/`.only` and on
  removed test cases (`removed-test`).
- **Test-removal waiver** - an operator decision recorded on the issue's continue file as a
  decision id `D-test-removal-waived:<headAnchor>` that demotes `removed-test` violations to
  evidence for exactly that head. Reader: `resolveActiveTestSkipWaiver()`
  (`src/lib/cloister/test-skip-waiver.ts:41`). There is **no writer**: the documented verb
  `pan verify waive-test-removal` does not exist (see Appendix A).
- **Head anchor** - `snapshotWorkspaceHeads(issueId, workspacePath)` in
  `src/lib/git-utils.ts:391`; the value the verification runner passes to the waiver lookup
  (`verification-runner.ts:349`).
- **Continue file** - `<planHome>/.pan/continues/<ISSUE>.xbrief.json`, type `ContinueState`
  (`src/lib/xbrief/continue-state.ts:174`), decisions array of `ContinueDecision { id, summary,
  recordedAt }` (lines 44-51). Read workspace-first by `readContinueStateForIssue`
  (`src/lib/xbrief/lifecycle-io.ts:328`).
- **Paused / troubled gate** - persistent per-agent start gates. The dashboard start route can
  clear both when the request is operator-origin with `clearGates` (`resolveStartAgentGateForRoute`,
  `src/dashboard/server/routes/agents/spawn.ts:172-225`).
- **Reclaim candidate** - a Machine Room suggestion to free RAM/disk; kinds `stack` and `venv`
  only (`src/dashboard/server/routes/resources/reclaim.ts:79,90`).
- **Closed-issue workspace report** - `collectClosedIssueWorkspaces()` in
  `src/lib/workspaces/closed-issue-workspaces.ts` (PAN-4283); lists only workspaces of closed
  issues with sizes. Surfaced in Settings > Close-out.
- **Hygiene report** - `collectHygieneReport()` (`src/lib/hygiene.ts:111`), schema
  `HygieneReport` in `@overdeck/contracts`; audits push, worktree, PR, agent, session, branch,
  workspace and disk hygiene. CLI only (`pan hygiene`).
- **Paired device** - a browser/desktop holding a revocable `odk_` device token obtained by
  exchanging a one-time `odp_` pairing credential (`src/dashboard/server/routes/pairing.ts`).
  Distinct from **scoped access tokens** (PAN-2351, UI in PAN-4435).
- **Session Vault** - encrypted off-machine store for conversation transcripts (`src/lib/vault/`,
  CLI `pan vault`). Dashboard consumer is PAN-4307 (auto-settle, eviction panel), PAN-4436
  (browse copies), PAN-4437 (Continue here).
- **Operator inbox** - new in this PRD: one derived list of everything waiting on the operator.
- **No-loss matrix** - `tests/unit/lib/overdeck/no-loss-matrix.ts`; every HTTP route needs a row
  or CI fails.

## Evidence

### Frequency source

Counts of Bash tool calls (`"name":"Bash","input":{"command":"...pan <verb>`) in Claude Code
transcripts modified in the last 48 h (`~/.claude/projects/**/*.jsonl`, 2026-09-28 to
2026-09-30); both columns use the same tool_use-anchored match. "All" = every session including
work agents; "Op" = only operator-level conversations (`-home-eltmon-Projects-overdeck`,
`-home-eltmon`, `-home-eltmon-Projects-myn*`). Human-typed shell commands are not in transcripts,
so Op undercounts; the operator's own friction list is the primary signal.

| Verb | All | Op | Verb | All | Op |
| --- | --- | --- | --- | --- | --- |
| `pan review request` | 29 | 3 | `pan close` | 5 | 4 |
| `pan tell` (all targets) | 36 | 13 | `pan kill` | 7 | 3 |
| `pan sync-main` | 21 | 0 | `pan reload` | 3 | 3 |
| `pan start` | 11 | 10 | `pan release stable` | 3 | 3 |
| `pan status` (+`--json`) | 10 | 8 | `pan verify waive-test-removal` | 2 | 1 |
| `pan show` | 7 | 4 | `pan vault *` | 15 | 2 |
| `pan swarm status` | 6 | 0 | `pan workspace destroy` | 2 | 2 |
| `pan memory search` | 6 | 5 | `pan unpause` | 2 | 1 |

`pan verify waive-test-removal` was attempted twice; each attempt printed top-level help
because the verb does not exist.

### Dwell times caused by the gaps (open issues)

- PAN-4432: three PRs sat 13-26 h on one red `test-shard` each; the operator relayed failures by
  hand with `pan tell`.
- PAN-4433: a dispatched reviewer never ran; PR #4387 sat 21 h unreviewed.
- PAN-4383: a work agent blocked on an operator decision sat 16 h; nothing reached Needs-you.

## Current code (verified 2026-09-30)

1. **Palette `pan …` entries only copy text.** `src/dashboard/server/routes/palette.ts:45-114`
   lists ~50 `pan` commands; selecting one runs `copyToClipboard(cmd.name)`
   (`components/CommandPalette.tsx:769`). This is not coverage.
2. **Reload has machinery but no button.** `StaleBuildChip.tsx` renders "build stale xN" with no
   action. The Force Restart path (`App.tsx`, `restartBackendMutation`) posts
   `/api/system/restart-dashboard` (`src/dashboard/server/routes/misc/meta.ts:412-450`), which
   spawns `pan restart --dashboard` (no build). `/api/dev/rebuild` is dev-mode only (meta.ts,
   search `Rebuild only available in dev mode`). `runComposerReload` exists and is reachable only
   by typing `/pan reload` in a composer.
3. **Close-out cannot override or dispose.** The route accepts `acceptedRows`
   (`src/dashboard/server/routes/issues.ts:552-567`) but `CloseOutIssueButton.tsx:34` posts no
   body; on failure it prints the missed rows as text (lines 17-25). No abandon/residue path.
4. **Stuck-PR diagnosis is one banner.** `deriveSpotlight()` returns the first match among
   api-error, stuck, changes-requested, red checks, conflicts, ready (`spotlight.ts:31-82`).
   `ReviewVerificationCard.tsx:80-112` lists failing check names only; `IssueCheckRun` already
   carries `detailsUrl` and `htmlUrl` (`ZoneCOverviewTabs/queries.ts:266-277`) which are not shown.
   Nothing names "reviewer dispatched but never started", "test-skip gate failed", or "agent
   paused/troubled".
5. **Review request predicate and endpoint drift.** `canRequestReview` requires no PR
   (`issueActions.ts:538`) and the registry posts `/api/review/:id/trigger`, while
   `pan review request` posts `/api/review/:issueId/request`
   (`src/cli/commands/request-review.ts:54`; route `routes/workspaces/review-pipeline.ts:728`).
   `canRestartReview` only allows `in-review` / `changes-requested` (`issueActions.ts:545-548`).
6. **Gate hints send the operator to the CLI.** `routes/agents/shared.ts:576` ("Run pan unpause
   ... before starting it from the dashboard") and `:590` ("... run pan untroubled ..."), although
   the same server clears both gates when start is called with `clearGates`
   (`routes/agents/spawn.ts:172-225`). There is no `untroubled` registry key and no
   `/api/agents/:id/untroubled` route; `AGENT_SCOPE_ACTION_KEYS`
   (`IssueActionMenu.tsx:49-56`) has no `untroubled` (the OKF page
   `overdeck-knowledge/frontend/issue-actions.md` claims it does; that is doc drift).
7. **Start needs a plan.** `canStartAgent` requires `hasPlan && hasTasks` (`issueActions.ts:528`).
   An unplanned issue must go through the Plan dialog, choose Auto, and tick "start after
   planning" (`PlanDialog.tsx:112-113,219`, body `{ auto, autoStart }` to
   `/api/issues/:id/start-planning`).
8. **Test-removal waiver has no writer.** `docs/PIPELINE-GATES.md:162`,
   `src/lib/cloister/test-skip-gate.ts:19` and `test-skip-waiver.ts:6` document
   `pan verify waive-test-removal`; `src/cli/index.ts` registers no `verify` command. Same drift
   pattern as PAN-3321 (`pan unstick`).
9. **Pairing and devices have routes and zero UI.** `POST /api/pairing/credentials`
   (`pairing.ts:64-91`, 403 for a paired device), `GET /api/devices` (149), `DELETE
   /api/devices/:id` (161). No frontend file references `/api/devices` or `/api/pairing`
   except the WS transport.
10. **Vault has no server route and no UI.** No file under `src/dashboard/server/routes` or
    `src/dashboard/frontend/src` mentions `vault`. Setup and join orchestration live in
    `src/cli/commands/vault/setup.ts` (198 lines) and `join.ts` (166 lines), which the server
    must not import.
11. **Disk: partial.** Machine Room shows a disk vital (`components/resources/VitalsStrip.tsx:13-25`)
    and reclaim candidates for stacks and venvs only. Settings > Close-out lists closed-issue
    workspaces (`Settings/sections/CloseOutSection.tsx:58` -> `GET /api/cloister/close-out/disk`,
    `routes/cloister.ts:265-274`). Open or stale workspaces are invisible; `Delete workspace`
    is enabled only for done/canceled issues (`issueActions.ts:575`).
    `POST /api/workspaces/:issueId/clean/preview` exists (`routes/workspaces/stash-clean.ts:201`)
    with no frontend caller. `pan workspace list` computes sizes with `dirSizeBytes`
    (`src/cli/commands/workspace-list.ts:88`); `closed-issue-workspaces.ts` duplicates it by design
    (server must not import `src/cli`).
12. **"What needs me" is split.** Needs-you shows pending inputs only. `/api/parked`
    (`routes/parked.ts:149`) is consumed only by God View
    (`GodView/confluence/useConfluenceData.ts`). Awaiting merge has its own page
    (`components/AwaitingMergePage.tsx`, route `/awaiting-merge`). Restart approvals are a banner;
    merged-not-closed issues, red CI, conflicts and paused/troubled agents appear nowhere as a list.
13. **Release is read-only.** `Stage/HomePane/ProjectReleasePanel.tsx:50` fetches
    `/api/projects/:projectKey/release-status` (workflow runs). No control runs `pan release check`,
    `notes`, `stable` or `canary`, or `pan rollout status/retry`. `release.ts:393` refuses a dirty
    tree.

## Themes, ranked by operator pain

| Rank | Theme | Why this rank | Work items |
| --- | --- | --- | --- |
| 1 | **A. Pipeline unsticking** | Longest dwell (13-26 h), highest verb volume (`review request` 29, `tell` 36). | WI-1, WI-3, WI-4, WI-5, WI-6 |
| 2 | **B. Operator inbox ("what needs me")** | 16 h unnoticed block (PAN-4383); every other theme feeds it. | WI-7 |
| 3 | **C. Deploy and close-out** | Daily: `reload` + approve, `close --force` after every merge. | WI-8, WI-9, WI-10 |
| 4 | **D. Agent messaging** | Manual `pan tell` relays of CI failures and review findings. | WI-2 |
| 5 | **E. Machine health and disk** | Periodic, but disk-full incidents stall everything. | WI-11, WI-12 |
| 6 | **F. Anywhere: devices and vault** | Setup-time and cross-machine; mostly covered by dependencies. | WI-13, WI-14 |
| 7 | **G. Long-tail escape hatch** | Covers the verbs no theme gives a button, without a generic shell. | WI-15, WI-16 |
| - | Documentation | Required. | WI-17 |

### Top 10 gaps (ranked)

1. Stuck PR shows one reason; failing shard has no log link, reviewer-never-started and gate
   failures are invisible (WI-1).
2. No single "needs me" list beyond pending questions (WI-7).
3. `pan reload` has no button; staleness chip is inert (WI-8).
4. Close-out cannot accept a missed DoD row, abandon, or record residue (WI-9).
5. Relaying a failing check or review finding to the agent is a hand-typed `pan tell` (WI-2).
6. Test-removal waiver exists nowhere, CLI or UI (WI-5).
7. "Request review" disappears once a PR exists and uses a different endpoint than the CLI (WI-3).
8. Paused/troubled gate errors tell the operator to run the CLI; no `untroubled` control (WI-4).
9. No view of all workspace sizes and no removal of stale non-closed workspaces (WI-11).
10. Release (`check`, `notes`, `stable`) and rollout retry are CLI-only (WI-10).

## Requirements

### Functional

- **FR-1** The cockpit shows every current blocking reason for an issue, ordered by severity,
  each with its unblocking action(s): provider errors, stuck, paused, troubled, awaiting operator
  decision, changes requested, each failing check (by name), test-skip gate failure, reviewer
  dispatched without activity, branch conflicts, ready to merge.
- **FR-2** Each failing check row shows an "Open log" link (`htmlUrl ?? detailsUrl`) and a "Send
  to agent" action that delivers a prefilled message (check name, URL, PR head SHA, instruction)
  to the issue's work agent through `POST /api/agents/:agentId/tell`, editable before sending.
  The same relay component is offered on a failed verification gate and on a review finding.
- **FR-3** "Request review" is available whenever a workspace exists, the agent is not running,
  the issue is not merged/closed, and no review is running, with or without a PR; it posts the
  same endpoint as `pan review request` (`/api/review/:issueId/request`).
- **FR-4** A paused or troubled agent shows "Clear gate and start" (start with `clearGates:
  true`) and standalone "Let agent continue" (unpause) / "Clear troubled" (untroubled) actions.
  Server hints name the dashboard control, not the CLI.
- **FR-5** An operator can record a test-removal waiver for the current head from the dashboard
  (with a required reason) and from the CLI (`pan verify waive-test-removal <id> --reason`);
  the next verification run demotes `removed-test` violations; a new commit voids it.
- **FR-6** An unplanned, startable issue offers "Plan & start" (auto plan, then start) as one
  click; the Plan dialog remains for other choices.
- **FR-7** An Operator Inbox page lists every item waiting on the operator, grouped: Answer,
  Unstick, Land, Close out, Deploy, Parked. Each row links to its subject and offers its primary
  action inline. A count badge appears in the app chrome. The Awareness Needs-you section links
  to it.
- **FR-8** "Reload now" on the stale-build chip and in the Inbox Deploy group runs `pan reload`
  via `runComposerReload`, shows phase progress, and hands off to the existing restart approval
  banner.
- **FR-9** Close-out failure renders each DoD row with status; each missed overridable row has an
  "Accept" checkbox; "Close out with accepted rows" re-posts with `acceptedRows`. The dialog also
  offers "Abandon" and "Close as residue", each requiring a reason, mapped to the CLI's
  `--abandon` / `--residue` semantics.
- **FR-10** A Release panel on the project home runs release preflight, drafts notes, cuts a stable
  or canary release with a typed version, pushes `main` and the tag, and shows per-issue rollout
  status with Retry.
- **FR-11** A Workspaces disk view lists every workspace directory on disk with size, issue state
  class (active, open-idle, merged-not-closed, closed, orphan), last commit age, unpushed-work flag,
  and offers remove for safe classes and deep-clean preview for any.
- **FR-12** A Hygiene panel shows the `collectHygieneReport` findings and offers "Fix safe"
  (same semantics as `pan hygiene --fix-safe`).
- **FR-13** Settings > Devices mints a one-time pairing URL (shown as text and QR, once), and
  lists paired devices with created/last-used/revoked and a Revoke action.
- **FR-14** Settings > Session Vault shows status (backend, this machine, owned records, last
  sync, machines), runs Sync now, supports Setup and Join (recovery phrase shown once), manages
  exclusions, allow-secret, passphrase on/off and key rotation.
- **FR-15** Composer `/pan` executes the operator verbs listed in WI-15 instead of rejecting them
  as terminal-only, with dialog/destructive confirmation per policy.
- **FR-16** Palette `pan …` entries that map to a dashboard action run that action; the rest are
  labeled "Copy command" so no entry pretends to run.
- **FR-17** Documentation reflects every new control and removes references to non-existent verbs.

### Non-functional

- **NFR-1 (derive, never store).** Every new inbox row, blocker, disk class and badge is derived at
  read time from existing facts (derived issue state, check runs, pending inputs, restart gate,
  deploy staleness, `/api/parked`, agent state, git, filesystem). No new status field, table or
  file is written to represent "needs operator". The waiver (WI-5) is an operator decision on the
  continue file, which is where decisions already live.
- **NFR-2 (one registry).** Every issue-scoped control is an `ISSUE_ACTIONS` entry with a
  `panVerb` and the same endpoint the CLI uses; parity tests must pass. Every new route gets a
  `tests/unit/lib/overdeck/no-loss-matrix.ts` row.
- **NFR-3 (server boundary).** Server code never imports `src/cli` (see the header of
  `closed-issue-workspaces.ts`). Logic needed by both moves to `src/lib`. No `execSync`/`spawnSync`
  in the server; long-running verbs spawn detached via `panCliInvocation`
  (`src/lib/pan-cli-invocation.ts:17`) or `spawnPanCli`, as `runComposerReload` does.
- **NFR-4 (safety).** Destructive actions use the registry's typed confirm. Secrets (pairing
  credential, vault recovery phrase, passphrase) are shown once, sent with `Cache-Control:
  no-store`, never logged or emitted to activity details. A paired-device session gets 403 on
  pairing mint, vault setup/join/rotate and release (reuse the `kind === 'device'` check in
  `pairing.ts:70-72`). Never call `deep-wipe` speculatively in tests or UAT.
- **NFR-5 (GitHub quota).** No new GitHub API calls on render. The relay sends the check URL; the
  agent fetches logs itself (`gh run view --log-failed`). Inbox rows reuse data already in the
  store.
- **NFR-6 (expensive reads on demand).** Directory sizing (`du`-equivalent) runs only when the
  Workspaces disk view is open or refreshed, with a 60 s server-side memo, async only.
- **NFR-7 (style).** Follow the pan-style-guide skill: no pill badges, no decorative color, blue =
  machine working, red = fail, emerald = pass, purple reserved for review/ship/planning.
  Settings sections autosave; no Save buttons. New pages are URL-addressable (`TAB_PATHS`).
- **NFR-8 (tests).** Delay/timer tests use fake timers; with happy-dom use `AbortController` +
  `setTimeout`, not `AbortSignal.timeout`. Run only touched files with `npx vitest run <files>`.
  No tests that grep source text, no added `skipIf`/`.only` (the test-skip gate fails them).
- **NFR-9 (file size).** When a touched file would exceed its file-size allowlist row, extract a
  module; never raise the row.
- **NFR-10 (imports).** New lib modules import `getAgentState` from `agent-state-read.js` (leaf)
  to avoid `lint:circular` failures.

## Dependencies (existing open issues; do not duplicate)

| Issue | Owns | This PRD's relation |
| --- | --- | --- |
| PAN-4432 CI test-failure relay never fires | Automatic red-shard -> agent feedback | WI-2 is the manual one-click path and the fallback when the relay cannot deliver. |
| PAN-4433 Stalled reviewer detection | Detect and re-dispatch reviewers with no output | WI-1 renders "reviewer not started" from live data now; once PAN-4433 lands, WI-1 reads its journal entry. |
| PAN-4383 Blocked-agent operator channel | Agent-raised operator decisions into Needs-you | WI-7 renders those rows in the Answer group; WI-7 does not define the channel. |
| PAN-4307, PAN-4436, PAN-4437 Session Vault dashboard | Auto-settle, browse copies, Continue here, eviction panel, Settings > Session Vault section | WI-14 extends the section PAN-4307 creates; blocked by PAN-4307. |
| PAN-4407 `pan vault` verbs throw `io.out is not a function` | CLI vault bug | WI-14's lib extraction must not regress the fix; land after it. |
| PAN-2351, PAN-4435 Scoped access tokens | Tokens and their Settings UI | WI-13 covers devices/pairing only and sits beside the tokens section. |
| PAN-4330 Settings > Anywhere / account | Sign-in client | WI-13 and WI-14 place their sections so PAN-4330 can group them under Anywhere later. |
| PAN-4405 Anywhere aggregated Needs-You | Cross-environment inbox | WI-7's derivation is per-host and exported so PAN-4405 can aggregate it. |
| PAN-3731 Restart banner gives no feedback | Approval feedback | WI-8 relies on the banner; does not fix it. |
| PAN-3616 Planned restarts show generic Reconnecting | Calm copy | Complementary to WI-8. |
| PAN-3235, PAN-2492, PAN-3276 Needs-you answering/navigation | Pane-choice cards, pane waits, row navigation | WI-7 reuses their responders; does not re-implement them. |
| PAN-4204 Sync-main conflicts count + Replan | Conflict UX | WI-1's conflict blocker links to it when present. |
| PAN-3090 Simple issue page narrative | Simple-mode page | WI-1 blockers feed the same derivation. |
| PAN-3218 Release-drift signal | Merged-but-unreleased signal | WI-10 shows it when available. |
| PAN-3108 dashboard.log unbounded, PAN-4248 Ollama models | Log rotation, model disk | WI-11 lists them as disk consumers only. |
| PAN-3630 `pan tell` marks read without delivering | Tell receipts | WI-2 shows the tell route's response verbatim; receipts are PAN-3630. |
| PAN-3321 `pan unstick` does not exist | Doc drift | WI-17 sweeps the same class for `pan verify`. |

## Work items

Each item lists files, steps, and tests. Traces: FR ids in brackets.

### WI-1 Blockers list in the cockpit [FR-1]

**What/why.** Replace the single spotlight with an ordered list so a PR with a red shard AND a
stalled reviewer shows both.

**Files.**
- `src/dashboard/frontend/src/components/Stage/cockpit/spotlight.ts`
- `src/dashboard/frontend/src/components/Stage/cockpit/IssueBlockerSpotlight.tsx`
- new `src/dashboard/frontend/src/components/Stage/cockpit/blockers.ts` (if `spotlight.ts` would
  exceed its allowlist row)

**Steps.**
1. Add `export interface BlockerContext { checkRuns?: IssueCheckRun[]; verification?: { gates:
   Array<{ name: string; passed: boolean }> } | null; agent?: { paused?: boolean; troubled?:
   boolean } | null; review?: { dispatchedAt?: string | null; liveReviewers: number;
   hasAnyReport: boolean } | null; pendingInput?: boolean; now: number }`.
2. Add `export function deriveBlockers(issue, ctx): SpotlightState[]`. Order: `api-error`,
   `stuck`, `paused`, `troubled`, `pendingInput` ("Waiting on your answer"), `changes-requested`,
   one entry per failing check run (`conclusion` `failure` | `timed_out`, title
   `Check failing: <name>`, actions `['relayCheck', 'viewPr']`), `test-skip` gate failed (actions
   `['waiveTestRemoval', 'tell']`), reviewer not started (review dispatched more than 15 min ago,
   `liveReviewers === 0`, `!hasAnyReport`; actions `['requestReview']`), conflicts (`pr.mergeable
   === false`; actions `['syncMain', 'viewPr']`), `ready`. Keep `deriveSpotlight(issue)` as
   `deriveBlockers(issue, { now: Date.now() })[0] ?? null` so existing callers are unchanged.
3. `IssueBlockerSpotlight` renders the first blocker as today's hero and the rest as a compact
   list below it (one row each: title, detail, buttons resolved through the registry exactly as
   the hero does).
4. Feed `ctx` from hooks already used by the cockpit: `useIssueCheckRunsQuery` (queries.ts:297),
   `useReviewStatusQuery`, the verification fetch used by
   `CommandDeck/SessionView/VerificationGatesPanel.tsx:68`, and the agent from the dashboard store.
   Add `troubled` to `IssueActionState.agent`'s `Pick`. The field exists on the agent event
   schema (`packages/contracts/src/events.ts:250`) and the read-model reducer copies it
   (`packages/contracts/src/event-reducers.ts:527`), but the frontend `Agent` type in
   `src/dashboard/frontend/src/types.ts` does not declare it: add `troubled?: boolean` there and
   confirm the WS agent payload carries it (checkpoint: if it does not, add it to the agent
   projection's serialized fields in `src/dashboard/server/services/agent-projection.ts`).

**Implementation checkpoint.** Confirm which review-status field carries the dispatch time. If none
does, use the review agent's `startedAt` from the specialists query; if neither exists, omit the
"reviewer not started" row until PAN-4433 lands (do not invent a stored timestamp).

**Tests.** New `Stage/cockpit/__tests__/blockers.test.ts`: red check + stalled reviewer yields two
entries in order; paused before changes-requested; `deriveSpotlight` equals first blocker; fake
time for the 15-minute threshold (pass `now`, no timers). Update
`IssueMissionControl.test.tsx` for a two-blocker render.

### WI-2 Relay to agent [FR-2]

**What/why.** One component that turns a failure into a prefilled, editable `tell`.

**Files.**
- new `src/dashboard/frontend/src/components/relay/RelayToAgentDialog.tsx`
- new `src/dashboard/frontend/src/lib/relayMessages.ts`
- `Stage/cockpit/ReviewVerificationCard.tsx` (failing rows, lines 103-112)
- `CommandDeck/SessionView/VerificationGatesPanel.tsx` (failed gate)
- `src/dashboard/frontend/src/lib/issueActions.ts` (new key `relayCheck`)

**Steps.**
1. `relayMessages.ts`: pure builders `checkFailureMessage({ issueId, checkName, url, headSha })`,
   `gateFailureMessage({ issueId, gateName, outputTail })` (last 40 lines), and
   `reviewFindingMessage({ issueId, reviewer, finding })`. Each ends with the instruction: "Fetch
   the failing log yourself (`gh run view <run> --log-failed` or the URL above), fix, push, and
   run `pan done` again."
2. `RelayToAgentDialog` shows the message in a textarea, a "Steer (interrupt current turn)"
   checkbox mapping to `deliverAs: 'steer'`, and Send, which POSTs `{ message, deliverAs? }` to
   `/api/agents/:agentId/tell` (body fields verified in `routes/agents/messaging.ts:166-177`).
   Show the response's message verbatim (no invented receipt; PAN-3630 owns receipts).
3. Failing check rows: add "Open log" link (`run.htmlUrl ?? run.detailsUrl`) and "Send to agent".
   Disabled with a tooltip when the issue has no work agent id.
4. Registry: `{ key: 'relayCheck', label: 'Send failure to agent', panVerb: 'tell', endpoint:
   '/api/agents/:agentId/tell', kind: 'dialog', group: 'communicate', placement: 'contextual',
   enabledWhen: (s) => !!s.agent && s.derived?.pr?.checks === 'red' }`.

**Tests.** `lib/__tests__/relayMessages.test.ts` (message contains name, URL, SHA, instruction);
`components/relay/__tests__/RelayToAgentDialog.test.tsx` (posts body with and without steer;
renders server error); update `issueActions.parity` expectations for the new key.

### WI-3 Review request parity [FR-3]

**Files.** `src/dashboard/frontend/src/lib/issueActions.ts` (lines 538, 614).

**Steps.**
1. Change the `requestReview` entry's endpoint to `/api/review/:id/request` (same as
   `request-review.ts:54`). Keep `restartReview` on `/trigger?force=true`.
2. New predicate:
   ```ts
   // before
   const canRequestReview = (state) => hasWorkspace(state) && hasStoppedAgent(state) && !state.derived?.pr && !isMerged(state) && !isDoneOrCanceled(state) && derivedState(state) === 'working';
   // after
   const canRequestReview = (state) => hasWorkspace(state) && hasStoppedAgent(state) && !isMerged(state) && !isDoneOrCanceled(state) && !canRestartReview(state) && derivedState(state) !== 'ready';
   ```
   (`canRestartReview` covers in-review/changes-requested, so the two never show together.)
3. Confirm `/api/review/:issueId/request` accepts an empty body; if it requires fields, send the
   same body the CLI sends (read `request-review.ts:54-60`).

**Tests.** `lib/__tests__/issueActions.test.ts`: enabled with an open PR and no review; disabled
while in review; endpoint equals CLI endpoint.

### WI-4 Clear paused/troubled gates [FR-4]

**Files.**
- `src/dashboard/server/routes/agents/shared.ts` (hints at 576, 590)
- new route in `src/dashboard/server/routes/agents/lifecycle-stop.ts` or its sibling that hosts
  `/unpause` (search `'/api/agents/:id/unpause'`): `POST /api/agents/:id/untroubled`
- `src/dashboard/frontend/src/lib/issueActions.ts`, `IssueActionMenu.tsx:49-56`
- `tests/unit/lib/overdeck/no-loss-matrix.ts`

**Steps.**
1. Route calls the same `clearAgentTroubled` used by `spawn.ts` and appends
   `operatorInterventionEvent({ issueId, kind: 'untroubled', source: 'dashboard' })`.
   Guard with `rejectUnsafeDashboardMutationRequest` (`routes/dashboard-auth.ts:187`).
2. Registry: `untroubled` (label "Clear troubled", `panVerb: 'untroubled'`, `kind: 'safe'`,
   `enabledWhen: s => s.agent?.troubled === true`) and `startClearingGates` (label "Clear gate
   and start", `panVerb: 'start --force'`, endpoint `/api/agents`, body adds `clearGates: true`,
   `enabledWhen: s => s.agent?.paused === true || s.agent?.troubled === true`). The wire field is
   verified: the start route reads `(body as any).clearGates === true` (`spawn.ts:356`) and clears
   only when the request is operator-origin. Add `untroubled` to `AGENT_SCOPE_ACTION_KEYS`.
3. Hint text, before (`shared.ts:576`, `:590`):
   ```ts
   hint: `Run pan unpause ${agentId} before starting it from the dashboard.`,
   hint: `Investigate the crash cause, then run pan untroubled ${agentId} before starting it from the dashboard.`,
   ```
   after:
   ```ts
   hint: `Use "Let agent continue" or "Clear gate and start" in the dashboard (CLI: pan unpause ${agentId}).`,
   hint: `Investigate the crash cause, then use "Clear troubled" or "Clear gate and start" in the dashboard (CLI: pan untroubled ${agentId}).`,
   ```

**Tests.** Server route test (clears gate, emits intervention event, 403 without mutation auth);
registry parity; `shared.ts` hint snapshot updated in its existing test.

### WI-5 Test-removal waiver writer, CLI and UI [FR-5]

**Files.**
- `src/lib/cloister/test-skip-waiver.ts` (add writer)
- new `src/cli/commands/verify.ts`; register in `src/cli/index.ts`
- new route `POST /api/issues/:id/test-removal-waiver` in `src/dashboard/server/routes/issues.ts`
  (or a new `routes/verification.ts` if issues.ts is at its size row)
- `src/dashboard/frontend/src/lib/issueActions.ts` (key `waiveTestRemoval`, `kind: 'dialog'`)
- `CommandDeck/SessionView/VerificationGatesPanel.tsx` (button on failed `test-skip` gate)
- `tests/unit/lib/overdeck/no-loss-matrix.ts`

**Steps.**
1. Writer:
   ```ts
   export async function recordTestSkipWaiver(input: { issueId: string; reason: string; by: string }): Promise<TestSkipWaiver> {
     const project = resolveProjectForIssue(input.issueId);
     if (!project) throw new Error(`No project for ${input.issueId}`);
     const planHome = resolveIssueWorkspacePlanHome(project.path, input.issueId.toUpperCase());
     if (!planHome) throw new Error(`${input.issueId} has no workspace`);
     const workspacePath = /* base workspace dir for the issue, same resolver lifecycle-io uses */;
     const head = await snapshotWorkspaceHeads(input.issueId, workspacePath);
     if (!head) throw new Error('Could not read the workspace head');
     const at = new Date().toISOString();
     updateContinueState(planHome, input.issueId.toUpperCase(), (s) => ({
       ...s,
       decisions: [...s.decisions, { id: `${TEST_SKIP_WAIVER_DECISION_PREFIX}${head}`, summary: input.reason, recordedAt: at }],
     }));
     return { sha: head, reason: input.reason, at, by: input.by };
   }
   ```
   Reason must be non-empty after trim; reject otherwise.
2. The continue-file write is **not committed**. Committing would move the head and void the
   waiver; the reader already reads the workspace plan home first
   (`issueContinueReadPlanHomes`, `lifecycle-io.ts:322`).
   Verified: the anchor is `git rev-parse HEAD` per repo root (`git-utils.ts:391-410`), so a dirty
   continue file does not move it, and the `pan done` preflight drops `.pan/` lines from its
   uncommitted-changes check (`filterUncommittedPorcelainLines`,
   `src/lib/work/done-preflight.ts:56-60`), so the write does not block the agent.
   **Implementation checkpoint:** confirm no other gate (review dispatch, verification runner
   sync step) refuses a dirty `.pan/continues/` file. Fallback if one does: record the waiver in
   the primary checkout's plan home instead (the second entry of `issueContinueReadPlanHomes`),
   which the reader already consults.
3. CLI: `pan verify waive-test-removal <id> --reason <text>` calls the writer and prints the
   anchor short form. `by` = `OVERDECK_CONVERSATION_ID` when set, else `operator`.
4. Route: body `{ reason }`, mutation-guarded, 403 for device sessions (NFR-4), returns the
   waiver. After success the UI offers "Re-run verification" (existing review trigger).
5. `VerificationGatesPanel`: when gate `test-skip` has `passed: false` and its output contains
   `[removed-test]`, render "Waive test removal" opening a reason dialog. Note in the dialog that
   `.skip`/`.only` are never waivable.

**Tests.** `tests/unit/lib/cloister/test-skip-waiver.test.ts`: write then
`resolveActiveTestSkipWaiver(issueId, head)` returns it; different head returns null; empty
reason rejected. CLI command test with injected writer. Route test (400 on empty reason).

### WI-6 Plan & start [FR-6]

**Files.** `src/dashboard/frontend/src/lib/issueActions.ts`,
`components/IssueActionMenu/useIssueActions.ts` (`bodyForAction`).

**Steps.** Add `{ key: 'planAndStart', label: 'Plan & start', panVerb: 'start --plan auto',
endpoint: '/api/issues/:id/start-planning', kind: 'safe', enabledWhen: canPlan, group:
'lifecycle', placement: 'menu' }` with body `{ auto: true, autoStart: true }` and config defaults
for the rest. Make it the phase-primary action for unplanned issues; "Plan…" stays in the menu.

**Tests.** `issueActions.test.ts` (enabled only when `canPlan`), `useIssueActions` body test.

### WI-7 Operator Inbox [FR-7]

**Files.**
- new `src/dashboard/frontend/src/lib/operatorInbox.ts` (pure derivation, exported for PAN-4405)
- new `src/dashboard/frontend/src/components/OperatorInbox/OperatorInboxPage.tsx`
- new `src/dashboard/frontend/src/components/OperatorInbox/InboxCountBadge.tsx`
- `src/dashboard/frontend/src/App/routes.ts` (`TAB_PATHS`: `inbox: '/inbox'`, `Tab` union)
- `src/dashboard/frontend/src/App/AppRoutes.tsx` (switch branch)
- `src/dashboard/frontend/src/App/AppChrome.tsx` (badge next to `StaleBuildChip`)
- `components/sessionFeed/SessionFeedSidebar.tsx` (link "N more in Inbox" under Needs-you)

**Steps.**
1. `deriveInboxRows(input): InboxRow[]` where input = `{ issues: DerivedIssueState[] (with agent
   and IssueActionState per issue), pendingInputs: PendingInputSubject[], restartGate:
   RestartGateSnapshot | null, staleness, parked: ParkedRow[] }`. Groups and rules:
   - **Answer**: every pending input subject (same filtering as `NeedsYouSection`), plus agent
     decision requests once PAN-4383 exposes them.
   - **Unstick**: issues with any WI-1 blocker whose tone is `blocked`.
   - **Land**: `canMerge` true (same predicate as the registry; supersedes the list on
     `/awaiting-merge`, which stays as a route and links here, no-loss).
   - **Close out**: `canCloseOut` true (merged, not closed). Group action: "Close out all" using
     the existing `POST /api/issues/bulk-close-out`.
   - **Deploy**: restart gate has waiting requests (action: approve, same call as
     `RestartApprovalBanner.tsx:97`); staleness `stale` (action: Reload now, WI-8).
   - **Parked**: rows from `GET /api/parked` with their release condition.
2. Use the registry predicates directly (import from `issueActions.ts`) so the inbox and buttons
   cannot disagree.
3. Page: one section per group with count, rows = subject link + reason + primary action
   (resolved through the registry). Empty state: "Nothing needs you."
4. Badge: total rows excluding Parked; hidden at zero; click navigates to `/inbox`.

**Tests.** `lib/__tests__/operatorInbox.test.ts`: one fixture per group; merged issue appears only
in Close out; ready issue only in Land; parked excluded from badge count. Page render test with
the store mocked. Update `App.test.tsx` route table.

### WI-8 Reload now [FR-8]

**Files.**
- `src/dashboard/server/routes/misc/meta.ts` (new `POST /api/system/reload`)
- `src/dashboard/frontend/src/components/StaleBuildChip.tsx`
- `tests/unit/lib/overdeck/no-loss-matrix.ts`

**Steps.**
1. Route: mutation-guarded, 403 for device sessions, calls `runComposerReload([])`
   (`src/lib/composer-commands/reload.ts:16`) and returns its result
   (`{ kind: 'activity', status: 'accepted', activityId, message }`) with 202. Server-reachable
   already (lib), no CLI import.
2. Chip becomes a button "build stale xN, Reload" with a confirm popover showing
   `buildCommit` -> `originMainSha` from `useDeployStaleness` and the sentence "Reload ships the
   CI-green origin/main, not your local checkout." While a reload is in flight (deploy progress
   projection shows `building`), render "Reloading…" and disable.
3. Approval continues through `RestartApprovalBanner` (PAN-3731 owns its feedback).

**Tests.** Route test with injected `runComposerReload` (202, 403 for device). Chip test: hidden
when fresh; button posts; disabled while building.

### WI-9 Close-out with DoD overrides and dispositions [FR-9]

**Files.**
- `src/dashboard/frontend/src/components/CloseOutIssueButton.tsx`
- new `src/dashboard/frontend/src/components/CloseOutDialog.tsx`
- `src/dashboard/server/routes/issues.ts` (close-out body, lines 552-567)
- `src/lib/lifecycle/` close-out entry used by `closeOutIssue` and by `src/cli/commands/close.ts`
  for abandon/residue (move the disposition logic from `close.ts` into lib if it lives only in
  the CLI; NFR-3)

**Steps.**
1. Route body type, before (`issues.ts:552`):
   ```ts
   let body: { acceptedRows?: unknown } = {};
   ```
   after:
   ```ts
   let body: { acceptedRows?: unknown; disposition?: unknown } = {};
   // disposition must be { kind: 'abandon' | 'residue'; reason: string } with a non-empty reason
   ```
   Reject a disposition combined with `acceptedRows` (CLI rule, `close.ts` help text: "cannot be
   combined with --accept-* flags"). Empty reason -> 400.
2. **Implementation checkpoint:** find where `--abandon`/`--residue` are executed
   (`close.ts:61-80`). If execution is CLI-only, extract it to
   `src/lib/lifecycle/close-dispositions.ts` and call it from both. Fallback if extraction exceeds
   this item: ship accept-rows only and file a follow-up for dispositions.
3. `CloseOutDialog`: on a failed close-out response with `dodGate.rows`, list all rows (pass/miss);
   each missed row with `overridable` gets an Accept checkbox; "Close out with N accepted rows"
   re-posts `{ acceptedRows }`. A "Close without landing" disclosure offers Abandon / Residue with a
   required reason and typed confirm of the issue id.
4. Remove the separate "--force" concept: the dashboard never prompts twice.

**Tests.** Route tests for disposition validation. Dialog test: miss rows render checkboxes;
re-post includes accepted ids; abandon requires reason.

### WI-10 Release and rollout panel [FR-10]

**Files.**
- new `src/lib/release/` module extracted from `src/cli/commands/release.ts` (preflight checks at
  lines ~405-495, notes drafting at ~275-295) so the server can call it
- new `src/dashboard/server/routes/release.ts`: `GET /api/projects/:projectKey/release/preflight`,
  `GET /api/projects/:projectKey/release/notes`, `POST /api/projects/:projectKey/release`
  (`{ channel: 'stable' | 'canary', version }`), `GET /api/issues/:id/rollout`,
  `POST /api/issues/:id/rollout/retry`
- `src/dashboard/frontend/src/components/Stage/HomePane/ProjectReleasePanel.tsx`
- `tests/unit/lib/overdeck/no-loss-matrix.ts`

**Steps.**
1. Where to cut. The primary checkout is routinely dirty (server writers and `.pan/specs`
   edits; it is dirty at the time of writing), so "cut in the primary checkout" would leave the
   panel inert. Decision: cut from a throwaway worktree created by the route at the CI-green
   `origin/main` SHA (the same SHA `pan reload` builds; read it from the deploy staleness
   source), under `~/.overdeck/tmp/release-<uuid>/`, then remove the worktree afterwards.
2. POST release runs, in that worktree and in order, each step awaited to exit 0 before the
   next: `pan release <channel> --version <v>` via `panCliInvocation`, then `git push origin
   HEAD:main` (never the local `main` ref, which lives in the drifting primary checkout), then
   `git push origin v<version>`, all async `execFile`/`spawn` with a log at
   `~/.overdeck/logs/release-<uuid>.log`. The whole sequence runs in a detached supervisor
   function so the HTTP call returns 202 with the log id; progress goes to the Activity feed.
   Never pass `--no-verify`; never run `npm version` or create tags by hand (hooks enforce;
   restate in the route header).
   **Implementation checkpoint:** confirm `pan release stable` accepts running on a detached-HEAD
   worktree at `origin/main`. Fallback: create a local branch `release/<v>` at that SHA in the
   worktree and run the same steps from it.
   Preflight renders each check with pass/fail (`release check` logic, run against the same
   SHA).
3. Version input validates semver and must exceed the latest tag. Typed confirm of the version.
4. Rollout: per-issue release set with component status and Retry (wraps the same lib the
   `pan rollout` CLI calls; extract if CLI-only).
5. Only the host session may cut a release (403 for device and token sessions).

**Tests.** Lib preflight tests on a temp repo. Route tests with injected spawner: worktree created
at the given SHA, argv exact, steps run sequentially and stop at the first non-zero exit, no
`--no-verify`, worktree removed afterwards. Panel test (Cut disabled until preflight passes and
the typed version matches).

### WI-11 Workspaces disk view [FR-11]

**Files.**
- `src/lib/workspaces/closed-issue-workspaces.ts` -> generalize into new
  `src/lib/workspaces/workspace-disk-report.ts` (`collectWorkspaceDiskReport()`); keep
  `collectClosedIssueWorkspaces` as a filter over it
- new route `GET /api/workspaces/disk` (in `routes/workspaces.ts` or a new file)
- new `src/dashboard/frontend/src/components/resources/WorkspacesDiskSection.tsx`, mounted in
  `components/resources/MachineRoom.tsx`
- `tests/unit/lib/overdeck/no-loss-matrix.ts`

**Steps.**
1. For each registered project, enumerate `workspaces/feature-*` dirs (same pattern
   `WORKSPACE_ISSUE_DIR_PATTERN`), size each (async, memoized 60 s, NFR-6), and classify:
   `active` (live agent per `src/lib/agents/liveness.ts`), `merged-not-closed`, `closed`,
   `open-idle` (open issue, no live agent, last commit older than 7 days), `orphan` (no tracker
   issue resolvable). While a GitHub quota pause is active (`readActivePause`, already imported
   by `closed-issue-workspaces.ts`), classify unresolvable issues as `unknown`, never `orphan`.
   Add `unpushed: boolean`: true when the branch has commits not on its upstream, AND true when
   the branch has no upstream at all (`git status -sb` shows no ahead count then). Also report the
   sizes of `~/.overdeck/logs/dashboard.log` and per-workspace `.venv` as named consumers.
2. Section: sortable table (size desc default), total, filters by class. Actions: `closed` and
   `merged-not-closed` -> existing `destroyWorkspace` / close-out; `open-idle` and `orphan` ->
   "Remove workspace" with typed confirm, refused server-side when `unpushed` is true (show the
   reason); any row -> "Deep-clean preview" calling the existing `POST
   /api/workspaces/:issueId/clean/preview` then `/clean`.
3. Widen `canDestroyWorkspace` only in this view (a view-local action, not the registry predicate),
   so the cockpit's rule stays "done or canceled".

**Tests.** Lib test with a temp tree (classification, unpushed refusal). Route test. Section test
(sorting, confirm required).

### WI-12 Hygiene panel [FR-12]

**Files.** new route `GET /api/hygiene` and `POST /api/hygiene/fix-safe` (new
`routes/hygiene.ts`); new `components/resources/HygieneSection.tsx` in Machine Room;
no-loss-matrix rows.

**Steps.** GET returns `collectHygieneReport()` validated against the contracts schema. POST runs
the same fix-safe path `pan hygiene --fix-safe` uses (read `src/cli/commands/hygiene.ts`; if the
fix logic is in the CLI file, move it to `src/lib/hygiene.ts`). Render findings grouped by check
(push, tree, prs, agents, sessions, branches, workspaces) with counts and the fix-safe button
(typed confirm listing what will be deleted).

**Tests.** Route tests with injected collector; section render test.

### WI-13 Devices and pairing in Settings [FR-13]

**Files.** new `Settings/sections/DevicesSection.tsx`; `Settings/settingsPageConstants.ts`
(`SETTINGS_NAV_ITEMS` entry `{ id: 'devices', label: 'Devices', icon: Smartphone }`);
`Settings/SettingsPage.tsx` render slot.

**Steps.** "Pair a device" (optional label, base URL field) POSTs `/api/pairing/credentials`;
builds the URL as `<base URL><pairingPath>`. The base URL defaults to the advertised remote origin
when one is configured (Settings > Remote / `configuration/remote-access.mdx`), else
`window.location.origin`, and shows a warning when it is loopback ("another device cannot reach
127.0.0.1"), mirroring `pan pair --url`. Shows the URL as text and a QR code (generate
client-side; no new server call), with the expiry countdown; cleared when the dialog closes.
Device table from `GET /api/devices`; Revoke calls `DELETE /api/devices/:id` with confirm. A 403
(device session) renders "Pair from the host dashboard." No server changes.

**Implementation checkpoint.** QR library: use one already in `package.json` if present; else
render the URL only and file a follow-up (do not add a dependency in this item).

**Tests.** Section test: credential shown once and cleared; revoke calls DELETE; 403 message.

### WI-14 Session Vault controls [FR-14] (blocked by PAN-4307, PAN-4407)

**Files.**
- new `src/lib/vault/enroll.ts` (setup and join orchestration moved out of
  `src/cli/commands/vault/setup.ts` and `join.ts`; CLI calls it)
- new `src/lib/vault/status.ts` if status assembly is CLI-only (`vault/status.ts`, 61 lines)
- new `src/dashboard/server/routes/vault.ts`: `GET /api/vault/status`, `POST /api/vault/sync`,
  `POST /api/vault/setup`, `POST /api/vault/join`, `GET/POST/DELETE /api/vault/exclusions`,
  `POST /api/vault/allow-secret`, `POST /api/vault/passphrase`, `POST /api/vault/rotate-key`
- the Settings > Session Vault section created by PAN-4307
- no-loss-matrix rows

**Steps.** Status card (backend, machine, owned records, last sync, machines) + Sync now
(`syncOnce`, `src/lib/vault/sync.ts:89`). Not enabled -> Setup (git URL, optional passphrase with
strength meter via `checkPassphraseStrength`) or Join (git URL + passphrase or recovery phrase).
The recovery phrase returned by setup/rotate is shown once, `no-store`, never logged (NFR-4).
Exclusions list with add/remove (`addExclusion`/`removeExclusion`, `src/lib/vault/exclude.ts:41,50`).
Allow-secret takes a record id and line. Device sessions get 403 on setup/join/passphrase/rotate.

**Tests.** Lib tests for `enroll.ts` against a temp dir store (`DirVaultStore`); route tests with
injected lib; CLI tests for setup/join still pass unchanged.

### WI-15 Composer `/pan` verb coverage [FR-15]

**Files.** `src/lib/composer-commands/policy.ts`; tests in `src/lib/composer-commands/__tests__/`.

**Steps.** Add policies (paths must match exactly one manifest entry; `assertPolicyOverlayIntegrity`
enforces):

| Path | mode | safety |
| --- | --- | --- |
| `unpause`, `untroubled`, `review request`, `review restart`, `sync-main`, `parked`, `hygiene`, `vault status`, `vault list`, `vault sync`, `devices list`, `release check`, `release notes`, `rollout status`, `workspace list`, `resources`, `health`, `doctor` | captured | safe |
| `kill`, `pause`, `review abort`, `rollout retry`, `verify waive-test-removal` | captured | dialog (confirmationText names the effect) |
| `close`, `workspace destroy`, `devices revoke` | captured | destructive (typedConfirmation = the id) |

Do not use `detached` for these: `runDetachedCommand` (`src/lib/composer-commands/detached.ts:244`)
is built for agent-launching verbs (it requires an issue id and writes to the agent's
`spawn.log`). Instead add an optional per-path `timeoutMs` to `ComposerCommandPolicy`
(`packages/contracts/src/composer-commands.ts:28`) and pass it to `runCapturedCommand`
(`executors.ts:16`, default `CAPTURED_COMMAND_TIMEOUT_MS` = 30 s); set 180 s for `vault sync`,
`doctor`, `hygiene`, `sync-main`.

Keep `vault setup/join/rotate-key/passphrase`, `release stable/canary`, `wipe`, `deep-clean`
terminal-only in the composer (they have dedicated UI or secrets). `restart approve` stays
terminal-only (the banner owns it).

**Tests.** Policy integrity test passes; router test per new safety class (dialog issues a
confirmation; destructive requires typed text).

### WI-16 Palette honesty [FR-16]

**Files.** `src/dashboard/server/routes/palette.ts` (entries 45-114, add optional `action` field),
`components/CommandPalette.tsx` (line 769).

**Steps.** Each `pan` entry gets `action?: { kind: 'navigate'; tab: Tab } | { kind: 'api';
method: 'POST'; path: string } | { kind: 'composer' }`. Map: `pan reload` -> WI-8 route;
`pan status` / `pan issues` -> navigate `agents` / `pipeline`; `pan resources` -> `resources`;
`pan cost` -> `costs`; `pan flywheel` -> `flywheel`; `pan close`/`pan tell`/per-issue verbs ->
`composer` (focus the composer with `/pan <verb> ` prefilled). Entries without `action` render
the row label "Copy command" and keep clipboard behavior.

**Tests.** Palette test: an entry with `api` action POSTs; one without shows "Copy command".

### WI-17 Documentation [FR-17]

**Files.**
- `docs/PIPELINE-GATES.md` (line 162: waiver now exists in CLI and dashboard; describe the button)
- `docs/DASHBOARD-ARCHITECTURE.md` (Operator Inbox page, new routes)
- `docs/MERGE-WORKFLOW.md` (close-out dialog: accept rows, abandon, residue)
- `configuration/remote-access.mdx` (pairing from Settings > Devices)
- the Session Vault user page (the page PAN-2609 adds under `configuration/`), Settings section
- `CLAUDE.md` "Critical Operational Facts": note that reload, close-out, release and waiver have
  dashboard controls
- `sync-sources/skills/pan-reload/SKILL.md`, `pan-close/SKILL.md`, `pan-release/SKILL.md`:
  one line each naming the dashboard control
- OKF bundle `../overdeck-knowledge/frontend/issue-actions.md` (new keys; fix the `untroubled`
  drift) and `frontend/command-deck.md` (Inbox), edited via `/okf author`
- Module headers of every new file

**Steps.** Update each file; remove every reference to non-existent verbs found by
`grep -rn "pan verify\|pan unstick" docs configuration reference sync-sources src`.

**Tests.** Docs build (Mintlify config lint if present); the grep above returns only valid verbs.

## Acceptance criteria

| AC | Work item | Check |
| --- | --- | --- |
| AC-1 | WI-1 | With a red check and a reviewer dispatched 20 min ago with no activity, the cockpit shows two blocker rows in that order; `blockers.test.ts` passes. |
| AC-2 | WI-2 | Clicking "Send to agent" on a failing check posts `/api/agents/<id>/tell` with a message containing the check name, URL and head SHA; dialog test passes. |
| AC-3 | WI-3 | With an open PR and no running review, "Request review" is enabled and posts `/api/review/<id>/request`; parity test passes. |
| AC-4 | WI-4 | A troubled agent shows "Clear troubled"; `POST /api/agents/<id>/untroubled` clears it and appends an `untroubled` intervention; hints no longer contain only a CLI instruction. |
| AC-5 | WI-5 | `pan verify waive-test-removal <id> --reason x` and the dashboard button each write a `D-test-removal-waived:<head>` decision; the next verification run reports "waiver: removed tests waived"; a new commit makes `resolveActiveTestSkipWaiver` return null. |
| AC-6 | WI-6 | An unplanned issue's primary action is "Plan & start", posting `{ auto: true, autoStart: true }`. |
| AC-7 | WI-7 | `/inbox` renders Answer, Unstick, Land, Close out, Deploy, Parked groups from fixtures; the chrome badge equals rows excluding Parked; no new stored field (review the diff for writes). |
| AC-8 | WI-8 | With a stale build, clicking Reload returns 202 with an activity id and the restart banner later appears; device session gets 403. |
| AC-9 | WI-9 | A close-out that misses an overridable row can be completed from the dialog by accepting it; the close-out record shows `acceptedBy: dashboard-operator`; abandon without reason returns 400. |
| AC-10 | WI-10 | Preflight lists checks; Cut runs in a throwaway worktree at the CI-green `origin/main` SHA even when the primary checkout is dirty; the spawned argv is exactly `release stable --version <v>`, then pushes of `main` and `v<v>`, each awaited, never `--no-verify`. |
| AC-11 | WI-11 | Machine Room lists every `feature-*` workspace with size and class; removing an `open-idle` workspace with unpushed commits is refused with the reason. |
| AC-12 | WI-12 | Machine Room shows hygiene findings from `/api/hygiene`; fix-safe requires typed confirm. |
| AC-13 | WI-13 | Settings > Devices mints a pairing URL shown once, lists devices, revokes one; a device session sees the host-only message. |
| AC-14 | WI-14 | Settings > Session Vault shows status and Sync now; setup shows the recovery phrase once; `pan vault setup/join` CLI tests still pass. |
| AC-15 | WI-15 | `/pan unpause <id>` in a composer clears the gate; `/pan close <id>` requires typed confirmation; policy integrity test passes. |
| AC-16 | WI-16 | No palette `pan` entry both claims to run and only copies; entries with actions execute them. |
| AC-17 | WI-17 | Every file listed in WI-17 is updated; `grep -rn "pan verify waive-test-removal"` matches only valid docs of the now-existing verb; `grep -rn "pan unstick"` returns nothing. |

Quality gates for every item: `npm run typecheck`, `npm run lint`, `npx vitest run <touched test
files>`.

## Out of scope

- A generic "run any shell command" box. The long tail is served by composer `/pan` policies
  (WI-15), which keep per-verb safety.
- Agent-protocol verbs (`pan task *`, `pan lane report`, `pan worker report`, `pan monitor`,
  `pan backlog write-sequence`, `pan done` as run by agents). They are agent-facing by design.
- `pan admin *` plumbing (specialists, cloister, db, config, hooks, tldr, fpp, tracker).
- `pan up` / `pan down` (the dashboard cannot start itself; the desktop app and supervisor own it).

## Appendix A: inventory of operator-facing verbs

Legend: **Covered** = a button exists and matches the CLI; **Partial** = exists with a gap noted;
**Gap** = no dashboard control; **Clipboard** = only the palette's copy-to-clipboard entry;
**Composer** = runnable as `/pan <verb>` in a conversation composer. Frequency = All/Op from the
Evidence table, or a scale (daily / weekly / rare) from the operator's friction list when zero.

### Pipeline and agents

| Verb | What it does | Dashboard today | Status | Freq |
| --- | --- | --- | --- | --- |
| `pan start <id> [--plan auto]` | Workspace + agent; plans first if unplanned | "Start work" needs plan+tasks (`issueActions.ts:528`); unplanned path via Plan dialog Auto + "start after planning" (`PlanDialog.tsx:112`); Composer | Partial (WI-6) | 11/10 |
| `pan start --force` / `--fresh` | Clear gates / fresh session | Start route `clearGates` exists, no control; fresh via "Restart agent…" dialog | Partial (WI-4) | weekly |
| `pan plan <id> [--auto]` | Planning | "Plan…" dialog; Composer | Covered | - |
| `pan plan finalize/done` | Accept plan | "Accept plan" | Covered | agent-run |
| `pan tell <id> <msg> [--steer]` | Message an agent | "Message agent" dialog; Composer; no prefilled relay | Partial (WI-2) | 36/13 |
| `pan answer <id> [n]` | Answer a pane choice | Needs-you + `/api/agents/:id/pane-choice`; PAN-3235/2492 open | Partial (deps) | rare |
| `pan kill\|stop <id>` | Stop agent(s) | "Stop agent" | Covered | 7/3 |
| `pan pause <id>` | Pause gate | "Pause agent" | Covered | rare |
| `pan unpause <id>` | Clear pause | "Let agent continue"; server hint still says CLI (`shared.ts:576`) | Partial (WI-4) | 2/1 |
| `pan untroubled <id>` | Clear troubled | none; hint says CLI (`shared.ts:590`) | Gap (WI-4) | weekly |
| `pan recover [id]` | Recover crashed agent | "Recover agent" | Covered | - |
| `pan resume <id>` | Resume saved session | "Resume" | Covered | - |
| `pan reset-session <id>` | Drop session pointers | registry `resetSession` | Covered | - |
| `pan sync-main <id>` | Merge main into branch | "Update from main" | Covered | 21/0 |
| `pan done <id>` | Signal work complete | "Finish work and start review" | Covered | agent-run |
| `pan review request <id>` | Re-request review | only when no PR, `/trigger` endpoint (`issueActions.ts:538,614`) vs CLI `/request` | Partial (WI-3) | 29/3 |
| `pan review restart <id>` | Re-dispatch reviewers | "Review again" (in-review/changes-requested only) | Covered | - |
| `pan review abort <id>` | Kill reviewers | conversation panel only | Partial (WI-15) | rare |
| `pan verify waive-test-removal` | Waive removed tests for one head | verb does not exist; reader only | Gap (WI-5) | 2/1 attempts |
| `pan reopen <id>` | Re-enter pipeline | "Reopen" | Covered | - |
| `pan wipe <id>` / `destroy <id>` | Destroy workspace/branch | "Reset to Todo" / "Delete workspace" (typed confirm) | Covered | rare |
| `pan close <id> [--accept-*] [--abandon] [--residue]` | Close-out ceremony | "Close out" with no overrides (`CloseOutIssueButton.tsx:34`) | Partial (WI-9) | 5/4, daily |
| `pan merge cancel <id>` | Cancel auto-merge | `AutoMergeToggle` | Covered | - |
| `pan swarm <id>` / `swarm status` | Parallel slots | Swarming settings; slot nodes in tree | Partial (not audited) | 6/0 |
| `pan strike <ids>` | Strike fix PR | tree/strike UI (3 frontend refs, not audited) | Partial | rare |
| `pan show <id>` | Issue lens | cockpit; Composer | Covered | 7/4 |
| `pan staffing <id>` | Model + swarm policy | cockpit header (1 ref) | Partial | rare |
| `pan task *` | xBRIEF item protocol | "Show plan and tasks" (read) | Out of scope (agent) | agent-run |

### What needs me

| Verb | What it does | Dashboard today | Status | Freq |
| --- | --- | --- | --- | --- |
| `pan status [--json]` | Running agents overview | Agents page, `RunningAgentsPill`, Composer | Covered | 10/8 |
| `pan parked` | Stall-orbit list with release condition | only God View consumes `/api/parked` | Gap (WI-7) | daily |
| `pipeline-status` / `pipeline-list` skills | Per-issue status matrix | Pipeline page | Covered | - |
| (none) "what needs me" | union of the above | Needs-you = pending inputs only (`SessionFeedSidebar.tsx:181`) | Gap (WI-7) | daily |
| `pan inbox` / `monitor` | Agent mail | none | Out of scope (agent mail) | rare |

### Deploy, release, close-out

| Verb | What it does | Dashboard today | Status | Freq |
| --- | --- | --- | --- | --- |
| `pan reload` | Build origin/main, gate, restart | Composer `/pan reload`; chip inert; Force Restart does no build | Partial (WI-8) | 3/3, daily |
| `pan restart approve` | Approve waiting restarts | `RestartApprovalBanner` (PAN-3731 open) | Covered | daily |
| `pan restart [--dashboard]` | Restart without build | Force Restart | Covered | - |
| `pan restart --cliproxy` | Restart sidecar | CLIProxy restart | Covered | - |
| `pan release check/notes` | Preflight / notes | none; Clipboard | Gap (WI-10) | 1/1 |
| `pan release stable/canary --version` | Cut release | none; Clipboard | Gap (WI-10) | 3/3, weekly |
| `pan rollout status/retry <id>` | Release set per issue | none | Gap (WI-10) | rare |
| `pan update` | Update Overdeck | `UpdateDialog` | Covered | - |
| `pan sync` | Sync skills/context | automatic after reload (`sync-auto-service.ts`); no manual control verified | Partial | -/3 |
| `pan up` / `pan down` / `pan dev` | Lifecycle | n/a | Out of scope | - |

### Anywhere: devices and vault

| Verb | What it does | Dashboard today | Status | Freq |
| --- | --- | --- | --- | --- |
| `pan pair` | Mint pairing URL | route exists (`pairing.ts:64`), no UI | Gap (WI-13) | rare, setup |
| `pan devices list/revoke` | Paired devices | routes exist (`pairing.ts:149,161`), no UI | Gap (WI-13) | rare |
| `pan token` (PAN-2351) | Scoped tokens | PAN-4435 | Dependency | - |
| `pan vault setup/join` | Enable/join vault | none | Gap (WI-14) | rare, setup |
| `pan vault status/sync/list/show` | Inspect and sync | none (PAN-4307 adds auto-settle) | Gap (WI-14, deps) | 15/2 total vault |
| `pan vault resume <id>` | Continue here | PAN-4437 | Dependency | - |
| `pan vault exclude/include/allow-secret` | Privacy controls | none | Gap (WI-14) | rare |
| `pan vault evict/restore` | Eviction batch | PAN-4307 panel | Dependency | - |
| `pan vault passphrase/rotate-key` | Key management | none | Gap (WI-14) | rare |

### Machine health and disk

| Verb | What it does | Dashboard today | Status | Freq |
| --- | --- | --- | --- | --- |
| `pan workspace list` (sizes) | All workspaces with size | only closed-issue workspaces (Settings > Close-out) | Partial (WI-11) | weekly |
| `pan workspace destroy <id>` | Remove workspace | only done/canceled (`issueActions.ts:575`) | Partial (WI-11) | 2/2 |
| `pan workspace deep-clean <id>` | git clean with protection | routes exist, no UI (`stash-clean.ts:201`) | Gap (WI-11) | rare |
| `pan workspace reap` | Orphan stacks/networks | UAT stack reap in tree | Covered | - |
| `pan hygiene [--fix-safe]` | Push/branch/workspace/disk audit | none | Gap (WI-12) | weekly |
| `pan resources` | RAM by agents | Machine Room | Covered | - |
| `pan health` / `pan doctor` | Service health / checks | `/health` page, `SystemHealthPill`; doctor checks not surfaced | Partial (WI-15 composer) | rare |
| `pan doctor github-quota` | Quota per caller | `GitHubQuotaPill` | Covered | - |
| `pan backup list/clean`, `pan restore` | Backups | none; Clipboard | Gap (not prioritized) | rare |
| `pan cost *` | Cost reports | `/costs` | Covered | - |

### Configuration and knowledge (no gaps prioritized)

| Verb | Dashboard today | Status |
| --- | --- | --- |
| `pan skills list/set/pack` | `SkillOverridesPanel`, `SkillPacksSection` | Covered |
| `pan context *` | `/context` page | Covered |
| `pan project add/clone/finish-setup/rename` | Add-project dialog, rename route | Covered |
| `pan project remove` | no route found | Gap (not prioritized) |
| `pan memory search/status` | palette search; Settings > Memory | Partial |
| `pan knowledge open` | `/knowledge` | Covered |
| `pan orders *` | `/orders` | Covered |
| `pan flywheel *` | `/flywheel` | Covered |
| `pan lane *`, `pan worker list` | lanes feed, Agents directory | Covered (read); reports are agent-run |
| `pan fork` / `handoff` / `unarchive-conversation` | conversation UI (handoff/fork dialogs; unarchive 1 ref) | Covered |
| `pan tts *` | Settings > TTS | Covered |
| `pan admin *` | plumbing | Out of scope |
