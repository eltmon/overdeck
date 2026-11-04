# Flywheel state

Durable memory across Flywheel runs: substrate fixes the loop drove and
learnings worth keeping. Append only. No pipeline status, run ids, or counters.

## Substrate fixes

### PAN-4383 review never starts → PAN-4506 (2026-10-04)

- **What broke:** every re-review of PR #4387 launches a fresh Claude Code
  reviewer pane that sits at an empty prompt (0% context, no transcript). The
  kickoff is rejected by Herdr with `invalid_request: unexpected end of hex
  escape at line 1 column 4021`, both delivery attempts fail, and deacon-lite
  logs `review.stalled` then `review.stall-escalated`. It happened on the
  17:24 and 20:40 UTC review requests of 2026-10-03.
- **Evidence:** review pane `wPT:pK` empty prompt; lifecycle log
  `~/.overdeck/agents/agent-pan-4383-review/lifecycle.log` shows transcript
  `734d5f07-…jsonl` never created; `.pan/review/agent-pan-4383-review-4e585623/`
  holds only `context.json`, no report.
- **Fix:** PAN-4506 (kickoff text near char ~4000 serializes to JSON Herdr
  rejects; a non-retryable `invalid_request` must fail the dispatch instead of
  looking like a silent reviewer). Do not `pan review restart` PAN-4383 until
  PAN-4506 lands: the same kickoff fails the same way.

## Open observations (not yet diagnosed to file:line)

### God View sinks issues with active work agents into the doldrums (2026-10-04)

- An operator screenshot at ~03:34 UTC showed PAN-4256, PAN-4260 and
  PAN-4508 as `❄ … 1h idle` (stale orbs), while each issue's work agent
  (`agent-pan-<n>`) had written its transcript within the last minute.
- The ~1h age matches when each issue's planning agent finished. The planning
  agents' `state.json` still says `running` with dead panes, but that is by
  design (`src/lib/overdeck/planning-promotion.ts` comment above
  `projectPlanningAgentStopped`, PAN-3917/PAN-4210), so the label is not the
  fault.
- Frost accrues client-side from `idleMin` in
  `src/dashboard/frontend/src/components/GodView/confluence/RiverCanvas.tsx`
  (stale label at line 567, reset only in `thaw`). Next step: find which
  events reset an orb's `idleMin` and whether a work agent's events reach the
  orb that the planning agent created.

## Learnings

- A review that stalls twice with an empty reviewer pane is a delivery
  failure, not a slow reviewer. Run `grep -a "Kickoff delivery attempt"
  ~/.overdeck/logs/dashboard.log` before re-dispatching (`-a` is required:
  the log holds NUL bytes, so plain grep silently matches nothing).
- To judge whether a work agent is alive, read the transcript path its own
  `lifecycle.log` resolved (`agent-pan-<n>`), not the newest `*.jsonl` in
  the workspace's project dir: the planning session's transcript lives there
  too and can mask an idle work agent, or the reverse.

### God View frozen orbs and river misdraws → PAN-4522, PAN-4523 (2026-10-04)

- Resolves the open observation above. The planning agents were not the
  cause. A dashboard restart boots the read model with an empty
  `agentRuntimeById` (`src/dashboard/server/read-model.ts` boot state), the
  client snapshot reducer replaces its runtime map wholesale
  (`packages/contracts/src/event-reducers.ts` line 337), and God View falls
  back to the spawn-time `state.json` `lastActivity`, so every busy agent
  reads as idle since spawn until its next tool beat → PAN-4522.
- Layout overlap of the shelf and doldrums bands, merged issues held on the
  shelf by the close-out pause, and PLAN/REVIEW counters counting stopped
  agents → PAN-4523 (God View frontend only).
- Learning: right after a `pan reload`, the God View and any other
  `agentRuntimeById` consumer under-report activity. Do not diagnose agent
  idleness from them in the first minutes after a restart.

### Stale verification worker fails a fixed head → PAN-4527 (2026-10-04, needs-handoff)

- PAN-4498's re-review after a fix push joined a verification worker started
  on the previous head, which then failed the new head with the old head's CI
  result ("The CI test job already failed on this head (c9994b06)") although
  CI on the new head had passed. Root cause:
  `src/lib/cloister/verification-worker-supervisor.ts` line 178 treats every
  review-verification worker as `sameHead`, and `verification-runner.ts`
  reads CI for the launch-time `headShort`. Review machinery (TENET-10), so
  filed `needs-handoff`, not started.
- Instance recovery: told the agent the failure was stale and to re-request
  review on its current head. Tell: a `verification.failed` whose gate record
  names a different head than its `head8`, or a test gate at `0ms`, is this bug.

## Run rules (operator decisions)

### Go idle when the pipeline is clear; stuck is not clear (2026-10-04, PAN-4530)

- With auto-pickup off, when nothing is pickable and the pipeline is clear,
  write and push `.pan/flywheel/report.md`, print `phase=idle needs-you=pipeline
  clear — ready for operator close-out`, stop scheduling ticks, and keep the
  conversation open. Only the operator ends the run.
- Clear = every drained issue merged, deployed (`/api/health` `buildCommit`
  contains it) and closed out or waiting only on automatic verify-on-main.
  Not in flight: `needs-handoff` / operator-decision items, parked or vetoed
  issues, other projects' long-paused agents.
- If an in-flight issue cannot move without the operator, keep ticking and
  name the blocker; a stopped loop must always mean clear, never stuck.
- PAN-4530 carries the skill-text change (needs-handoff, TENET-10).

### Overnight restart approval is per-run, never standing (2026-10-04)

- The operator authorized `pan restart approve` for the 2026-10-04 night only,
  after each merge with CI green on the exact `origin/main` tip, then verifying
  `/api/health` `buildCommit` contains the merge. Ask again on every new run.

### Doomed verification holds the single CPU admission slot → PAN-4531 (2026-10-04, needs-handoff)

- Verification runs all local gates (~25 min) before reading the CI test
  verdict, so a head whose CI already failed still holds the machine-wide
  admission slot, blocking every other verification and the agent's own
  isolation test runs (PAN-4259 at 04:37). Root cause:
  `src/lib/cloister/verification-runner.ts` ~line 581 computes `ciTestRed`
  after the gates. Not fixed by hand: killing a worker mid-run risks wedging
  its verification state.
- Learning: overnight throughput is bounded by the serialized gate queue,
  not by agents. Check `~/.overdeck/verification-workers/admission/owner.json`
  before calling a long verification "stuck".

### Restart during verification loses the review dispatch → PAN-4532 (2026-10-04, needs-handoff)

- Verification workers survive a dashboard restart, but the waiter that
  dispatches review after `passed` dies with the old process; the deacon's
  re-request then ignores the finished result
  (`verification-worker-supervisor.ts` line 174 joins only result-less
  workers) and re-runs every gate. PAN-4515 lost a passed verification this
  way after the 04:21 deploy.
- Run rule until PAN-4532 lands: never approve a dashboard restart while any
  `dist/verification-worker.js` process is alive. Deploy in a gap between
  verifications.
- Recovery for a restart-lost dispatch (until PAN-4532 lands): when the
  journal shows `verification.passed` but no reviewer spawned, and the newest
  `.overdeck/verification/*.json` `head8` equals both the workspace HEAD and
  the PR `headRefOid` with a clean tree, run `pan review restart <id>`. It
  dispatches the reviewer without re-verifying. Letting the deacon re-request
  instead re-runs every gate. Used on PAN-4257 (2026-10-04 04:57).
- Collision warning for that recovery: deacon-lite re-requests a lost
  dispatch on its own within minutes ("a dashboard restart during verification
  left the review undispatched"), and that re-request starts a full
  re-verification. On PAN-4498 and PAN-4508 (05:06) the deacon fired within a
  minute of `pan review restart`, giving each a reviewer plus a duplicate
  verification. Run `pan review restart` only right after `verification.passed`
  lands, and check that the journal has no later `review.requested` from
  deacon-lite first. Do not kill a duplicate worker: the supervisor records a
  killed worker as an `error`, which feeds back to the agent and adds a round.

### Deploys blocked by a comment the boot preflight reads as an import → PAN-4541 (2026-10-04, critical)

- Every `pan reload` since `66777e339e4` (PAN-4508) aborts with "Deployment
  cannot resolve custom from …/dist/dashboard/server.js". The preflight's
  regex scanner (`src/lib/bundle-imports.ts` line 16) matches `from "custom"`
  in a JSDoc comment PAN-4508 added to `src/lib/jev/settings-validation.ts`.
  The old dashboard keeps running (the preflight works); nothing ships.
- Learning: a failed reload leaves the gate `idle` and only says why in the
  reload log, so a deploy watcher that only checks `buildCommit` sees
  "not deployed" and nothing else. Read the newest `reload-*.log` after every
  reload attempt.
- Learning: a background deploy loop ran twice (origin unknown), which could
  race two reloads. Guard any deploy script with `flock`.

### Run end 2026-10-04 ~10:45 UTC: pipeline clear, loop idle

- 19 PRs merged, deployed and closed overnight. Close-out is NOT automatic
  here (`close_out.auto` unset): merged and deployed issues stay
  `verifying-on-main` until `pan close <id> --force` runs (no `--accept-*`).
  PAN-4543 removed the two flaky refusals (deploy probe vs the event-loop
  stall from sync cost reads; stale `running` verification artifacts).
- Throughput lesson: the night's bottleneck was the serialized gate queue
  plus the verification/merge bugs PAN-4527/4531/4532/4534/4540, not agents.

### Operator decisions after the 2026-10-04 run

- Release v0.65.0 (cut 2026-10-04).
- SHOULD-level review findings (CodeRabbit's included) that merge unaddressed
  are listed in every run report under "Unaddressed SHOULD-level review
  findings". The operator picks which become issues; none are auto-filed.
- Verification/auto-merge bugs PAN-4527/4532/4531/4540/4534 go through one
  supervised handoff (conversation 3230, held until the operator sends it).
- Two concurrent quality gates with a pressure fallback → PAN-4546
  (needs-handoff). Automatic close-out restored → PAN-4547 (needs-handoff;
  until it lands, the Flywheel closes deployed issues itself with
  `pan close <id> --force`, never with an override).

### Run start 2026-10-24 08:10 UTC (conversation 3302)

- `pan show <id> --health` is not a reliable stall signal on Herdr: it calls
  working agents `stuck` because the CLI never registers the transcript
  heartbeat lookup (`src/lib/agents/liveness.ts` line 72; registration only in
  `src/lib/runtimes/index.ts` line 162) → PAN-4595 (needs-handoff, agents
  runtime). Until it lands, judge activity by the newest transcript mtime
  under `~/.claude/projects/<workspace-slug>/` and workspace file changes.
- `pan show --health` on an issue still in planning pings `agent-<id>` and
  reports `dead`; the live agent is `planning-<id>`. Expected, not a stall.
- Conversation 3230 (the PAN-4527/4532/4531/4540/4534 held handoff) was never
  sent; its session ended 2026-10-15 with no transcript, and its worktree
  base is 352 commits behind main. The dashboard shows it as "no saved
  history" → PAN-4596 (needs-handoff, conversation live-control).
- 2026-10-24 08:25 UTC, operator-approved: conversation 3230 archived; the
  bundle restarted as conversation 3304 in `~/Projects/hoff-verify-merge-2`
  (fresh from `origin/main` `e8b715cf814`, refreshed brief with re-verified
  line numbers). PAN-4595 and PAN-4596 started with `pan start --plan auto`
  on the operator's request despite the needs-handoff marking. Watch both
  for PAN-4554 (planning finalizes but no work agent spawns).
- `pan handoff self` fails from the Flywheel's Bash ("Could not determine the
  current conversation"); name the source explicitly: `pan handoff conv-flywheel`.
- 2026-10-24 ~08:50 UTC: the merge train has not assembled a UAT batch since
  2026-09-20 (overdeck) / 2026-08-14 (MYN), so the Flywheel UAT card offers only
  the "Escape hatch: Merge one feature to main…" link; Awaiting Merge also
  drops approved PRs after 5 min (PAN-4597). Operator asked to restore
  in-Overdeck merging → PAN-4598 + PAN-4597 as supervised handoff conversation
  3305 (`~/Projects/hoff-merge-train`). Until they land, merge a ready
  feature with the Flywheel UAT card's "Merge one feature to main…" link.
- PAN-4584 deployed (build 8a41a2dff) and closed with `pan close --force`.
- 2026-10-24 08:43 UTC: operator granted the Flywheel merge authority for
  approved, green, clean PRs on a green main (memory
  `flywheel-may-merge-ready-prs`). Merged #4587 (PAN-4583) through
  `POST /api/issues/PAN-4583/merge`. The issue view's Merge action is hidden
  by the same 5-minute `ready` flag as Awaiting Merge
  (`issueActions.ts` line 553) → added to PAN-4597.
- `pan flywheel status` `liveAgents: 0` on a working issue usually means the
  agent ended a turn while a background task runs: Herdr reports the pane
  `agent_status: done` (✳ title) and `paneIsLive`
  (`src/lib/flywheel/derive-status.ts` line 162) drops `done` panes. Read the
  transcript tail before treating it as a stall (PAN-4585, PAN-4589,
  2026-10-24).
- Hold `pan reload` while `pgrep -af dist/verification-worker.js` shows a
  worker; the serialized gate queue means waiting for a gap between issues.
- A `pan handoff` conversation working in its own `hoff-*` worktree opens
  PRs the pipeline never sees: no `workspaces/feature-pan-<n>` means no
  verification, no review, and `pan review request` fails "Workspace does not
  exist". Every handoff brief must say: when a PR is ready, remove the hoff
  worktree, `pan workspace create PAN-<n>`, confirm HEAD = PR head, then
  `pan review request PAN-<n>` (sent to conversations 3304 and 3305 at 09:20).
- 2026-10-24 09:30 UTC disk cleanup (operator-approved): removed 19 MYN
  worktrees whose HEAD was on origin/main with no local changes (re-verified
  per repo, then `git worktree remove`), plus `docker image prune -a`
  (12.6 GB). `/` went from 29 GB to 48 GB free. Kept: cohesion,
  feature-min-1072, feature-min-1078, intro-video-api, restic-retry,
  hoff-restic (tracked brief edit, MIN-1053 open), site-style, and the
  papers-please and tindra workspaces. Restic home backups failed 8 times in
  7 days, all from a full disk on 2026-10-22.
- Merged #4600 (PAN-4582) at 09:32 through the merge door.
- 2026-10-24 10:20 UTC, operator-approved speedups: (1) local verification
  gates for panopticon-cli trimmed to install + typecheck + CI-deferred test
  in ~/.overdeck/projects.yaml (backup `projects.yaml.bak-2026-10-24-gates`;
  machine memory `overdeck-local-gates-trimmed`); CI owns lint, build and the
  server smoke test. (2) PAN-4546 (two concurrent gate slots) started with
  `pan start --plan auto` despite needs-handoff, on the operator's word.
  (3) PAN-4531 (skip gates when CI already failed) is in conversation 3304.
- Handoff-built issues have no xBRIEF, so verification fails
  `incomplete-plan-items`; handoff agents must write an xBRIEF and record items
  (told 3304/3305; added to PAN-4605).
- 2026-10-24 10:25 UTC operator instruction for THIS run: start no new
  work. When every in-flight Overdeck issue has merged (PAN-4583, 4585,
  4589, 4595, 4596, 4597, 4598, 4527, 4532, 4531, 4605, 4546, plus 3304's
  remaining PAN-4540 and PAN-4534, and the docs issue PAN-4609), cut an npm release with
  `pan release stable --version X.Y.Z`, push main + tag, write the report,
  then pause the Flywheel.
- PAN-4610 (2026-10-24): a verification worker can wait forever in CPU
  admission when another poller deletes its half-written ticket. Symptom:
  `phase: queued`, `admittedAt: null` for 30+ min and no
  `~/.overdeck/verification-workers/admission/waiter-*.json` for that issue.
  Recovery: stop the worker pid and `pan review request <id>`. Fix folded into
  PAN-4546. Used on PAN-4532 at 10:40.
- concerns.md conflicts recur on concurrent PRs (PAN-4595 hit it twice on
  2026-10-24) → PAN-4614 (`merge=union` in .gitattributes), started. The
  merge door rebases onto main, so a PR GitHub calls CLEAN can still be
  refused for a conflict. A first "not approved at PR HEAD" refusal right
  after a review lands can be stale PR facts; retry once after ~1 min.
- 2026-10-24 11:30: 95 of 99 CI runs on main that day came from
  `chore(workspace)` bookkeeping commits, starving PR checks → PAN-4618
  (paths-ignore `.pan/**` on push), started. Mistake: I started PAN-4616 by
  guessing the new issue's number; stopped it with `pan kill` and commented.
  Always read the number from `gh issue create` output before `pan start`.
- 2026-10-24 11:50: CI has no `concurrency` group, so superseded runs keep
  their runners (48 unfinished runs, 12 on one PR branch). Cancelled 34
  superseded runs by hand (kept each PR's head run and main's newest run);
  permanent fix added to PAN-4618. When reading main's CI state after a
  cancel, skip `cancelled` conclusions.
- Handoff-built issues hit a third gate: `pan plan finalize` refuses without a
  PRD draft (`.pan/drafts/pan-<n>.md`, PRD-first gate). Recipe for adopting an
  outside PR into the pipeline: pipeline workspace → short PRD → finalize →
  Item: commits + `pan task done` per item and AC (push after each) →
  `pan review request`. Conversation 3304 told to do this for PAN-4527, 4532,
  4531, 4540, 4534 at 12:00; all of it belongs in PAN-4605's fix.
- Cancel queued `chore(workspace)` runs on main while PAN-4618 is pending;
  the sequencer commits every few minutes.
- Release step for this run (operator, 12:55 UTC): before `pan release
  stable --version 0.70.0`, add an `<Update label="v0.70.0">` block to
  `changelog.mdx` with the user-facing changes since v0.69.0 (and move the
  matching `CHANGELOG.md` "Unreleased" items), commit
  `docs(infra): changelog for v0.70.0`, push main; see docs/RELEASING.md
  "Update the public changelog" and the pan-release skill.
- 2026-10-26 20:10 UTC (conv 3341): PAN-4630 (PR #4631, critical herdr PATH
  fix, CI green, CLEAN) stalled since 2026-10-25 20:22. Cause: PAN-4605's
  adoption path starts review (`pr-adoption-review.ts` line 133) but
  verification still runs `checkIncompletePlanItems`
  (`verification-runner.ts` line 816); only strikes pass `skipPlanChecklist`
  (`merge-strike.ts` line 50). No xBRIEF → `incomplete-plan-items`, and the
  feedback has no work agent to reach. Filed PAN-4636 (needs-handoff).
  Instance recovery: `pan start PAN-4630 --plan auto` so a planner writes the
  plan and a work agent records items on the existing PR head.
- PAN-4626's planner ran via `pan plan --auto` (plan-only), so it waits for
  the operator's `released` label; it is not a PAN-4554 instance.
- 2026-10-26 20:24 UTC: `pan start <id> --plan auto` on an adopted outside PR
  works as the instance recovery for PAN-4636. The planner finalized, the work
  agent recorded the items on the existing PR head, and verification passed
  in 17 minutes (PAN-4630). The first try failed with a transient
  "Tracker API error (github): fetch failed"; one retry succeeded.
- The merge door counts the "Non-blocking flake lane" CI job as a pending
  check (`summarizeStatusCheckRollup`, `src/lib/cloister/pr-facts.ts`
  line 242). The job usually takes about 5 min, but it can hold an approved
  PR for up to its 30-minute timeout. Seen once (PAN-4633); file it if it
  happens again.
- 2026-11-01 05:45 UTC (conv 3399): PAN-4645, 4648, 4649 and 4295 were
  refused with `stack-unhealthy` ("No Docker containers found"). The spawn
  self-heal rebuild (`spawn-prep.ts` near line 1101) failed with "all
  predefined address pools have been fully subnetted" (dashboard.log, not the
  systemd journal). Cause: the `init-perms` service in
  `infra/.devcontainer-template/docker-compose.devcontainer.yml.template`
  (PAN-2777) has no `networks:`, so every Overdeck stack adds an empty
  `<project>_default` network: two subnets per workspace, about 13 stacks per
  host. Filed PAN-4663 (`network_mode: none`), started with `--plan auto`.
  Instance recovery: `docker network rm` on the 11 empty
  `overdeck-feature-pan-*_default` networks (32 → 21). Distinct from PAN-3900
  (orphaned networks from removed worktrees). Check `docker network ls | wc -l`
  against ~31 whenever a stack rebuild fails.
- 2026-11-01 06:05 UTC: Anywhere epic (#2350, plan `.pan/drafts/pan-2350.md`
  rev 5) handed to the Flywheel by conv 20261029-6880 with operator approval.
  Ignore order book 2026-08-08-overdeck-anywhere (draft reference only).
  Start-when-prereqs-merged map: PAN-4650 (4645, 4646 mockup approved),
  PAN-2356 (4645, 4330, 4648), PAN-4404 (4645), PAN-4654 (4645), PAN-4656
  (4645, 4628), PAN-4651 (4650, 4649), PAN-4652 (4645, 4295, 4650), PAN-4296
  (4652), PAN-4638 (4651, 4652). PAN-4646 is a mockup only (no PR): surface,
  never merge or close. Operator authorized acknowledging agent-count
  guardrails for these launches, never memory or CPU.
- Guardrail acknowledgement has no CLI flag. Recipe: POST
  `/api/agents` with header `x-overdeck-internal-token: $(cat
  ~/.overdeck/internal-token)`, `origin: http://127.0.0.1:3011`, body
  `{"issueId":..,"role":"work","startedBy":"flywheel:conv-flywheel",
  "guardrailAcknowledgedWarnings":["agent_count_high","agent_count_ceiling"]}`.
  Any other `startedBy` is refused ("Invalid internal startedBy provenance").
- Until PAN-4663 merges, every new Overdeck stack recreates an empty
  `_default` network; remove empty `overdeck-feature-pan-*_default` networks
  each tick (32 → 26 at 06:00).
- PAN-4666 (needs-handoff): flywheel status drops agents whose Herdr pane says
  `done` (turn finished, process alive). Confirm liveness with
  `pan show <id> --health`, never the status list, before any respawn.
- 2026-11-01 06:15 UTC: PAN-4669 (needs-handoff): `idle-stack-reaper.ts`
  line 166 checks tmux sessions only, so on Herdr it stops every running
  agent's server/frontend containers after 10 min. Same class as PAN-4666
  (liveness decided outside `liveness.ts`). The dashboard offered "Start" on
  PAN-4643 while agent-pan-4643 was working, and the click failed with
  "Invalid CSRF token"; cause not yet found (token derivation is stable,
  dashboard not restarted since 2026-10-26). Operator also asked: deploy
  #4637 (7c97ec4ddaa) via `pan reload` on green main CI and verify
  buildCommit; track PAN-4626 (agent started by the operator).
- 2026-11-01 06:10 UTC: the PAN-4643 "Start work" + "Invalid CSRF token" was
  the simple-mode issue page: `postJson` in `lib/simple/useSimpleActions.ts`
  sends no CSRF header (every simple action 403s), and `isPlanReadyToStart`
  (`lib/simple/derive.ts`) lets an idle, finished planner override a running
  work agent. Filed and started PAN-4670. `pan reload` builds into the idle
  generation, then waits for `pan restart approve` from the operator; the
  reload process exits after the build, so check `/api/health` buildCommit
  with `git merge-base --is-ancestor` before calling it deployed.
- 2026-11-01 06:25 UTC: operator rule (memory `coderabbit-advisory-not-blocking`):
  review CodeRabbit findings when it posts; when rate-limited or silent, merge
  without it. The review context ingests CodeRabbit only at review start, so
  check for newer coderabbitai[bot] inline comments before every merge
  (PAN-4671, needs-handoff). Missed findings on #4662/#4637 → PAN-4672.
- 2026-11-01 06:35 UTC: PAN-4675 (needs-handoff). A `gh` network timeout in
  `addLabel` (`merge-agent.ts` ~line 500, `Effect.promise`) aborted
  PAN-4299's post-merge lifecycle after the merge door had merged it; the
  door then answers "Already merged". Instance recovery: `pan kill <id>`
  (stops agent and stack), then `pan close <id> --force` passed with no
  override. `pan close` blocks on a confirmation prompt: always pass
  `--force` and `< /dev/null` from the loop.
- 2026-11-01 07:15 UTC: sending late CodeRabbit findings to a work agent does
  not stop the merge train. PR #4667 (PAN-4642) merged at 07:02 while the
  agent was fixing them, and post-merge stopped the agent with the fix
  uncommitted; follow-up PAN-4681. Next time hold the PR first with
  `pan merge` (cancels the actionable auto-merge row), then route findings.
- Same merge turned main red with an unrelated flake
  (`run-gh.test.ts`, ledger appends race: PAN-4680, started). Re-ran failed
  jobs (run 41283191295 attempt 2). `gh run list` timed out on the workflow
  listing; `gh api repos/eltmon/overdeck/actions/runs?branch=main` works.
- 2026-11-01 07:55 UTC: PAN-4690 (needs-handoff). Review dispatch
  (`review-agent.ts` ~457, `clearFeedbackFiles` → `clearFeedbackForIssue`)
  rewrites the tracked `.pan/continues/<ID>.xbrief.json` without committing,
  so the dirty-tree gate blocks the review it was dispatching. Symptom:
  `verification.passed` then no reviewer, and dashboard.log "could not
  re-request the undispatched review — Workspace has uncommitted changes".
  Recovery: confirm the only dirty file is the continue file, commit it as
  bookkeeping on the feature branch, push, `pan review request <id>` (re-runs
  verification). Hit PAN-4643 and PAN-4626.
- 2026-11-01 08:05 UTC: PAN-4690 is a chain, not one bug. Reaper (PAN-4669)
  stops server/frontend → review spawn rebuilds the stack before spawning the
  reviewer and the rebuild hangs (containers "stuck Created") → review never
  dispatches → deacon re-request blocked by the continue file that
  `clearFeedbackForIssue` dirties on every dispatch (`writeContinueState`
  always bumps `updated`). Hit 4643, 4626, 2354, 4330. The commit-and-rerequest
  recovery only works when the stack is healthy at dispatch; until PAN-4669 and
  PAN-4690 land, every review is at risk.
- 2026-11-01 08:10 UTC: operator approved the machinery fixes for PAN-4669 and
  PAN-4690. Launched as strikes (`pan strike`), not `pan start`: the normal
  review path is what they fix, and strike PRs go to the operator to merge,
  which keeps the supervision TENET-10 asks for.
- 2026-11-01 09:10 UTC: PAN-4697 planner waited 40+ min on its plan critic
  (`agent-pan-4697-worker-1`, codex gpt-6-sol) that never started: state.json
  `status: starting`, appserver-events.jsonl held only remoteControl/account
  notifications and one `foreign-thread` thread/started, no turn. Hypothesis:
  the Codex app-server host never delivered the first prompt. Single instance;
  file it if a second worker sticks in `starting`. Recovery: `pan kill
  <worker>`, `pan tell planning-<id>` to re-run the critic and finalize.
- Conflict cascade: every merge re-conflicts all approved PRs on the
  package.json test:frontend-subset line, each costing a re-review. PAN-4697
  fixes it; land it first. (Use `git pull --rebase origin main` here: a
  multi-branch `git fetch` makes a bare `git pull --rebase` fail.)
- 2026-11-01 09:35 UTC: PAN-4702 (strike). GitHub stamped some records about
  an hour ahead today (mergedAt, review submitted_at; US DST change). The merge
  gate's `latestTrustedVerdicts` (`pr-facts.ts` ~785) ranks by submittedAt, so
  a stale ancestor-commit approval with a future stamp hid the head approval
  on #4699, #4692, #4686 ("not approved at PR HEAD" though GitHub shows it).
  Dismissing does not help (DISMISSED counts as a verdict). Fallback: after
  ~10:00 UTC re-request review so a fresh head approval outranks them.
- Verification-stuck cap: after 3/3 failed verification attempts the pipeline
  pauses the work agent as an operator signal (PAN-4628). When the failure is
  concrete, `pan unpause agent-<id>` resumes it and delivers queued mail.
- GitHub timestamp skew (2026-11-01) also scrambles CI `created_at`. Read
  main's verdict by run number:
  `gh api "repos/eltmon/overdeck/actions/workflows/ci.yml/runs?branch=main&per_page=6" --jq '.workflow_runs | sort_by(-.run_number)'`.
  Note the skill's `gh run list` query can time out; this endpoint has not.
- 2026-11-01 11:05 UTC: PAN-4710 (needs-handoff). Deferred planning hand-off
  retries (`deferred-handoff.ts` `defaultSpawn` ~150) send no guardrail ack,
  unlike the first hand-off, so they fail at "agent count high" and end in a
  silent `handoff.abandoned` gave-up. Cost PAN-4663 and PAN-4670 three hours.
  Each tick, scan workspaces whose last handoff.* entry is `handoff.abandoned`
  with no live agent and an unmerged issue; relaunch with `pan start <id>`.
- Re-staging a deploy: a `pan reload` waiting for restart approval keeps the
  build it staged. When main moves on while it waits, kill it and start a new
  one so the approval ships current main. Find it with
  `ps -eo pid,args | grep "[p]an reload"`: `pgrep -f "pan reload"` inside a
  `for … kill` also matches the shell running it and kills that shell
  (exit 144, 2026-11-01).
- 2026-11-01 13:06 UTC: PAN-4645 (Anywhere foundation) merged (#4715). Launched
  `pan start --plan auto` for PAN-4650, PAN-2356, PAN-4404, PAN-4654, PAN-4656.
  Still gated: PAN-4651 (4650), PAN-4652 (4650), PAN-4296 (4652), PAN-4638
  (4651, 4652). Every other Anywhere prerequisite (4330, 4648, 4628, 4649, 4295)
  is merged. Watch the five hand-offs for PAN-4710 give-ups.
- 2026-11-01 18:10 UTC: PAN-4650 merged (#4731). Launched PAN-4651 and
  PAN-4652 (`pan start --plan auto`). Anywhere remaining: PAN-4296 (waits on
  4652), PAN-4638 (waits on 4651 and 4652). Every other wave issue is merged
  and closed. PAN-4724 (cost rollup) is confirmed live: the
  getCostsByIssueSnapshot slow warning stopped at the 17:48 deploy.
- 2026-11-01 18:30 UTC: main red after PAN-4650 merge (run #12451). Not a
  flake: the re-run failed identically. `tests/e2e/linked-conversation-title-bar.spec.ts`
  starts a Vite dev server and a browser inside the default unit shards; the
  cold page load times out at 180 s on main (it passed on the PR). Fix
  PAN-4732 started, told to plan the smallest unblock first (slow convention
  or CI quarantine via `readQuarantineList`). A re-run that fails the same way
  means stop treating it as a flake. Hold merges and deploys until green.
- 2026-11-01 20:25 UTC: PAN-4652 raised a `pan ask` decision (od-3dc41e82) to
  re-attach its worktree after its own live Fly test detached HEAD. Flywheel
  verified it non-destructive (detached commit is a main commit, branch holds
  all pushed work, tree clean) and told the agent to `git switch` and withdraw
  the ask, rather than leave it blocked for the absent operator. `pan answer`
  only answers pane menus; `pan ask` decisions are answered in the dashboard
  Needs-you, or the asking agent withdraws them.
- A second `pan reload` started while one waits for approval exits at once
  with "restart in progress (held by PID …)"; the waiting one keeps its older
  staged build. Always stop the waiting reload first (find it with
  `ps -eo pid,args | grep "[n]ode .*bin/pan reload"`), then start the new one,
  and read the new log's first lines to confirm it started (2026-11-01 tick 98
  missed PAN-4727 this way until tick 102).
- 2026-11-01 23:58 UTC: the auto-merge scheduler (`auto-merge-scheduler.ts`,
  rows in overdeck.db `pending_auto_merges`) already merges approved, green,
  non-strike PRs after a 5-minute cancel window, and re-schedules when the PR
  head changes. Flywheel merge-door merges race it (PAN-4296: countdown reset,
  then "merged" mid-countdown; the row settled as `blocked: PR is already
  merged`). Going forward: let the scheduler merge; Flywheel only cancels
  (`pan merge cancel <id>`) to hold for unanswered CodeRabbit findings, and
  clears blockers. Strike PRs (`strike/<id>`) are excluded on purpose
  (PAN-3973): the operator merges them.
- 2026-11-02 00:20 UTC: strike PRs have been unmergeable through Overdeck since
  #4066 / PAN-4384 (Sept 25-29). `merge-gate.ts:136` requires head approval for
  every door, strikes included, and the operator authors strikes, so they cannot
  self-approve. Filed PAN-4750 (needs-handoff, merge route). Until it lands,
  strike PRs merge on GitHub by the operator. The Flywheel board's
  `PAN-<n>-STRIKE` rows are a parse artifact of `feature-pan-<n>-strike`
  dirs (PAN-4752).
- Operator 2026-11-02: roles.flywheel.maxAgents 4 -> 8; auto_pickup_backlog stays
  OFF. "Nothing pickable" means no ready+released backlog items, which is
  different from an empty pipeline. Say so explicitly when reporting.
- 2026-11-02 03:02 UTC: a push made after approval (for example, CodeRabbit fixes)
  leaves GitHub `reviewDecision=APPROVED`, but the merge gate wants an approval of
  the exact head, so the train skips the PR and logs nothing (PAN-4759 #4768,
  approved 1d360ce2d, head 697a05f82). Check `overdeck=<state> <sha>` against the
  head, not just reviewDecision. When routing CodeRabbit findings, always tell the
  agent to finish with `pan review request <id>` after pushing.
- 2026-11-02 03:15 UTC, operator launch queue (Anywhere finish + t3code parity; the
  2026-08-08 order book is finished, so do not use it):
  - Fly, in order, at most 3 at once (they touch the same files):
    4682, 4748, 4685, 4683, 4738, 4739, 4740, 4741, 4743, 4734, 4722, then 4696
    (verify reap and heartbeat after 1-10 merge).
  - Non-Fly, any time: 4775, 4776 (it stops at an operator checkpoint, which is
    expected), 4661.
  - LAST, after the Fly items merge: 4774 (release acceptance AC-1..15).
  - t3code parity, any time: 4653, 4655, 4657, 4658, 4659, 4660.
  - Watch PAN-4710: a planned issue with no work agent needs `pan start` again.
- 2026-11-02 03:20 UTC, queue change from the operator: do NOT start PAN-4776. The
  operator is deploying services/account and services/connect themselves. Its
  planner, started 03:12, was stopped and the workspace kept. HOLD PAN-4774 until
  PAN-4682 AND PAN-4748 merge; its body is being rewritten to run the hardware
  tests on Fly VMs.
- 2026-11-02 06:15 UTC, operator: hosted services are LIVE (account.overdeck.ai and
  connect.overdeck.ai; smoke `node scripts/anywhere/smoke-hosted.mjs` passes).
  PAN-4776 is closed; never start it. Start PAN-4774 as soon as #4796 (PAN-4748) is
  merged AND deployed. Tell its agent the hosted services are up and that it can sign
  Fly VMs in with `pan account login` (device flow): it should send the device code to
  conv-flywheel, and the operator has authorized the Flywheel to approve that code in
  the browser.

## 2026-11-02 12:35Z — stale workspaces stall PRs pushed from elsewhere (PAN-4810)
- Handoff PRs #4783/#4790/#4802 sat 5h without review. Cause: verification merges origin/main into the pipeline workspace without first moving it to the PR head (verification-runner.ts:116-125), so it verifies a tree missing the PR's newest commits; adoption refuses a stale existing workspace (pr-workspace-adoption.ts:220-233, workspace-head-mismatch), which also skips the PAN-4786 adopted-PR checklist exemption. Filed PAN-4810 (needs-handoff, routed to conv 3466). Instance recovery: reset 4772 to PR head (approved next cycle); worktree-removed 4785/4801 (journals backed up) and re-adopted.
- The loop went silent 07:56Z-12:20Z after an idle compaction: no heartbeat fired. Re-arm the background sleep on every resume.
- Operator correction (via Anywhere orchestrator): hold PAN-4774 until PAN-4740, 4741, 4743, 4734, 4722 and 4696 have merged and deployed.

## 2026-11-02 15:50Z — close-out "no pull request found" is a swallowed read error (PAN-4821)
- Three close-outs (PAN-4748, 4810, 4813) failed "no pull request found on the forge" for merged PRs, each the first close-out after a pan reload; all passed on immediate retry. dod-gate.ts:302-305 maps any fetchIssuePullRequest error to null, so a failed forge read is reported as absence, and the error response is cached. Filed PAN-4821 and started it via pan start.
- PAN-4810 shipped (#4814): verification now moves the workspace to the PR head before syncing main, re-decides the adopted-PR checklist skip at the checklist step, and a feedback-only continues file is not a plan. PAN-4803 closed as covered by #4802.
- Heartbeat now uses ScheduleWakeup (~1000s): the background sleep heartbeat was reaped once under host memory pressure, which silently stopped the loop.

## 2026-11-02 16:30Z — operator hold: PAN-4823 native phone app epic
- HOLD all 15 children (4828 4829 4830 4831 4833 4834 4835 4836 4843 4837 4838 4839 4840 4841 4842): never pan start any until PAN-4774 (Anywhere release acceptance) passes AND the release ships.
- After release, start in PRD build order (.pan/drafts/pan-4823.md): wave 1 = 4828, 4831, 4833; wave 2 = 4829, 4835; wave 3 = 4834, 4830, 4836, 4843; wave 4 = 4837; wave 5 = 4838, 4840, 4839.
- PAN-4841 (store/console setup) and PAN-4842 (docs) are orchestrator-driven: never start them.

## 2026-11-02 17:35Z — operator queue: Shared Sessions remaining slices
- share.overdeck.ai is deployed and smoke-tested; slice 1 is live.
- HOLD every remaining slice until the Anywhere release ships (same hold as PAN-4823). They may run alongside the PAN-4823 phone-app issues (separate code areas).
- Order (per each issue's Depends-on): PAN-4473 -> PAN-4474 -> PAN-4475; then PAN-4476, PAN-4477, PAN-4479, PAN-4480 in parallel; then PAN-4478 (needs 4476); PAN-4482 last (needs all).
- PAN-4481 (hosted web join page): HOLD for an operator decision; start only when the operator gives the answer.
- 2026-11-02 operator decision: PAN-4481 (hosted web join page) = BUILD IT. Hold released: queue it after PAN-4475 with slices 4476/4477/4479/4480 (still only after the Anywhere release ships). Conflict rule: PAN-4481 and phone-app PAN-4831 both touch services/account/src/pkce.ts, so never run them at the same time; start whichever comes second only after the first has merged.

## 2026-11-02 20:32Z — Fly queue done; PAN-4774 started
- All Anywhere Fly prerequisites merged and deployed (build 194adf91f96). Started PAN-4774 (release acceptance run); the operator's hosted-services and `pan account login` device-flow note was posted as an issue comment and sent to the planner. When the agent sends a device code, the Flywheel approves it (operator-authorized). PAN-4823 phone-app and Shared Sessions slices stay held until PAN-4774 passes and the release ships.

## 2026-11-02 23:40Z — PAN-4774 acceptance result: not releasable yet
- PAN-4774 posted AC-1..AC-15: 7 passed, 5 failed, 3 approximated. Defects filed: PAN-4859 (Open in editor targets ssh-remote+127.0.0.1), PAN-4860 (issue prefix with digits), PAN-4861 (removed SSH host's dashboard restarted by pan up supervisor), PAN-4862 (relay uses only UDP TURN URL), PAN-4863 (AC-10 needs a real VPS after a release that ships connect). Started 4859/4860/4861/4862; 4863 is operator/infra.
- AC-3 Tailscale-on-this-host is blocked on the operator decision (Flywheel declined to install system software / sign into the tailnet without authorization).
- Release still gated: PAN-4823 phone app and Shared Sessions slices stay held until the Anywhere release ships.

## 2026-11-03 02:28Z — Anywhere fixes deployed and closed
- Build 530ee175e8c is live and includes all PAN-4774 fixes: PAN-4774 (#4864), 4859 (#4867), 4860 (#4865), 4861 (#4866), 4862 (#4868). All five closed out; close-out PR lookup worked first try (PAN-4821 fix live).
- Deploy note: a reload started by another session held the restart lock ~2h with a pre-merge build; after the operator approved it, a second reload was needed. Starting a reload while another is pending is refused ("restart in progress"), so check the lock holder's build before telling the operator one approval ships everything.
- Release gate remaining (operator): AC-3 Tailscale on this host, AC-10 real VPS (PAN-4863), PAN-4862 live Fly relay check (device code needs operator OK), then `pan release stable`. PAN-4823 phone app and Shared Sessions slices start after the release ships.

## 2026-11-03 03:00Z — operator answers
- PAN-4773 decided: no auto-merge hold; CodeRabbit findings route to the work agent, which fixes the ones it agrees with and replies on the PR with its reason for each rejection. Routed to the merge-systems handoff (conv 3466, TENET-10).
- Release: ship as-is as v0.73.0; the Flywheel cuts it (`pan release stable --version 0.73.0`, then push main and the tag), but HOLD until the operator sends "go release". Known post-release gaps: AC-3 Tailscale on this host, AC-10 VPS (PAN-4863), PAN-4862 live relay re-check.
- After the release ships: start PAN-4823 phone-app wave 1 (4828, 4831, 4833) and Shared Sessions PAN-4473, per the recorded orders and the PAN-4481/PAN-4831 pkce.ts conflict rule.
- Standing rule (operator memory operator-decides-only-real-tradeoffs): decide routine pipeline and policy questions myself; only product direction, money, unapproved external publication or irreversible actions go to the operator. Fly device-code approvals: ask in this conversation, not via the operator dashboard.

## 2026-11-03 03:40Z — v0.73.0 cut
- Operator said "go release". Changelog drafted by a subagent (no "t3code"; features spelled out), finalized and committed (f92fcebfa65); `pan release stable --version 0.73.0 --skip-tests` (main CI already green on 04f8bccc9df; host must not run the full suite) made 7de98491242 + tag v0.73.0. PAN-4869 had no PR yet, so it goes in the next release.
- Gotchas: `pan release` needs a fully clean tree including untracked files (moved two .impeccable tool folders aside and restored them); the agent main-push guard refuses the release commit (package.json version bumps) — operator-directed release pushes use OVERDECK_OPERATOR_PUSH=1.
- Next: when the Release workflow publishes, start PAN-4823 wave 1 (4828, 4831, 4833) and Shared Sessions PAN-4473.
- 2026-11-03 operator: PAN-4869, PAN-4871 and PAN-4872 ship as a patch release (v0.73.1) when all three have merged and deployed. Cut it the same way as v0.73.0 (changelog block first, `pan release stable --version 0.73.1 --skip-tests` after green main CI, OVERDECK_OPERATOR_PUSH=1 for main, push tag). No separate "go" needed.
- 2026-11-03 03:55Z: v0.73.0 SHIPPED (Release workflow green; @overdeck/core, contracts, desktop 0.73.0 published 03:46-03:48Z; registry lag of a few minutes). Release hold lifted: started PAN-4828, PAN-4831 (phone wave 1) and PAN-4473 (Shared Sessions chain head). PAN-4833 takes the next free slot. Remember PAN-4481 must not run while PAN-4831 is in flight (pkce.ts).
- 2026-11-03 05:05Z: v0.73.1 cut and pushed (9c82bc4ee1e, tag v0.73.1): PAN-4869, 4871, 4872 (deployed, closed) plus PAN-4773 CodeRabbit routing (#4870) and PAN-4828 phone-app contracts (#4876), both CI-green on main. Next: deploy #4870/#4876 once main CI is green, close PAN-4773 and PAN-4828.
- 2026-11-03 05:50Z: v0.73.1 Release npm job failed on an order-dependent test (projects-rename.test.ts 401; filed and started PAN-4881); failed jobs re-run (run 41582696575). Started PAN-4882 (post-release gap checks: PAN-4862 live relay on Fly + re-run AC-2/3/4/6/15). Operator approves those Fly device codes: relay each code to the operator in this conversation, do not approve myself.
- 2026-11-03 06:15Z: HOLD home pan reload until PAN-4882 reports its Fly VMs torn down (live re-run pinned to home build b1d9d9dc554 / @overdeck/core 0.73.0 on the VMs). Cancelled reload41; restart gate empty.
- 2026-11-03 07:35Z: PAN-4882 done: AC-4, AC-6, AC-15 passed live; AC-2/AC-3 relay not-run (three device codes expired unapproved over 57 min). PAN-4862 live relay check is still an open gap. Home reload hold lifted; reload42 started from green main 2ea5e137e89.

- 2026-11-03 ~09:45Z memory pressure (operator report): PSI full avg300 ~18, swap 100%, 2 GB available. Top consumer was an orphaned scratchpad probe from the PAN-4888 work agent, `vitest run --root / <scratchpad>/probe.test.ts` (12 GB RSS after 4 min, parent reaped). `--root /` makes Vitest crawl the whole filesystem. Killed it and told the agent not to rerun it; PSI fell to 0 and available memory rose to 16 GB. One instance so far, so no issue filed; if another agent's probe outlives its shell, file the class (agent-spawned Vitest outside the quality-gate admission queue, no RSS cap). Also seen: about 17 PAN-4852 worker panes (~280 MB each, 4-6 h old), from another conversation, not this loop's.
- 2026-11-03 operator approved reload43 (build cb48d77e245, includes #4870/#4876/#4877/#4880/#4883/#4884). Closed out PAN-4773, 4828, 4831, 4473, 4833 and 4881. reload44 started for #4889/#4890/#4891.

- 2026-11-03 13:26Z clean host reboot (systemd shutdown, not OOM) killed reload44 and the PAN-4835/PAN-4475 work agents; resumed both (cause known: reboot, resume_agents_on_restore=false). reload45 shipped b569adb781e (#4889-#4892), closed out PAN-4474, 4882, 4829, 4888.
- Standing rule (orchestrator, 2026-11-03): the Flywheel approves its own deploy restarts with `pan restart approve` once the reload build succeeds; restart approval is never a needs-you item. Recorded as project memory flywheel-self-approves-deploy-restarts.

- 2026-11-03 PAN-4903 (Codex first message lost on herdr spawn) went through a supervised handoff (conv 3547), because conversation spawn is live-control (TENET-10). Root cause from the handoff: Codex conversation readiness never waited for the app-server socket, so the first message raced it and fell back to a tmux paste; fixed in #4907, and linked rows now carry spawnError. Learning: my handoff brief omitted the detach step, so `pan review request` refused adoption (branch checked out in hoff-pan-4903). Every handoff brief must end with: push, `git switch --detach`, then `pan review request <id>` (memory detach-branch-before-review-request).

- 2026-11-03 PAN-4917 filed + started: the CI `Prompt change trailer gate` (ci.yml:147-158, checkout fetch-depth 0 under timeout-minutes 5) timed out in checkout three times while GitHub was slow. A cancelled check counts as red, so main's run 41686923189 read `cancelled` (blocked deploy), and `evaluateConflictRepairGate` (merge-gate.ts, `facts.checks === 'red'`) declined to repair #4911/#4915, which sat approved + CONFLICTING with no repair while #4916 (green trailer) got one. Cause confirmed from job logs; re-ran the failed jobs once on main, #4911 and #4915. Learning: when the conflict-repair patrol skips an approved conflicting PR, check its head for a red/cancelled check first. Also: do not hand-nudge conflicts; the patrol does it (I sent PAN-4479 a redundant pan tell earlier).

- 2026-11-03 PAN-4918 (six Anywhere UI polish issues) is owned by conversation 20261103-87f8; the Flywheel does not start it.

- 2026-11-03 PAN-4925 filed + started: CI test-shard 3/4 intermittently ends with 'Worker exited unexpectedly' while all tests pass (2 of 8 main runs: c61fa3e86e9 attempt 1, 96d40a2186b attempt 1), no OOM/signal marker in the log. Each one turns main red; re-ran the shard once. Recurrence = class, so filed instead of re-running silently.

- 2026-11-03 PAN-4903 (#4907): verification passed 16:05Z, reviewer agent-pan-4903-review started 16:06Z, then nothing for 5h; review dir had only context.json (no report). Hypothesis: the reviewer session hung or died across the day's reloads without the review convergence gate re-dispatching it. First recovery: pan review restart PAN-4903. If it stalls the same way again, file the class (a reviewer with no report for hours is not re-dispatched).

- 2026-11-03 Operator queue: epic PAN-4927 (Overdeck MCP for agents and bots, PRD .pan/drafts/pan-4927.md), run through the pipeline alongside the phone app and Shared Sessions. Waves (an item starts once its wave's deps merged, within the agent cap):
  W1 4930, 4931, 4948, 4952 (started 21:2xZ) | W2 4932, 4936, 4939, 4944, 4945, 4949 | W3 4933, 4934, 4937, 4938, 4940, 4941, 4943, 4946, 4947, 4950, 4951 | W4 4942, 4953, 4954, 4955, 4956 | W5 4935, 4957 | last 4958 (docs).
  PAN-4950 also needs phone-app 4829/4833/4834/4835 (all merged 2026-11-03). Anything under services/ (PAN-4948 first) needs a production Worker redeploy after merge: tell the operator, they run wrangler. Never publish the integration packages to external registries.
  Also started independent of the epic: PAN-4929 (polyrepo root npm install blocks pan start for MYN, high priority); PAN-4896 (macOS connect prints Linux-only systemd-run warning) queued for the next free slot.

- 2026-11-03 Operator decision: PAN-4959 (Anywhere account management page) phase 1 ships now as a READ-ONLY page for invite-allowlisted testers, without waiting for billing PAN-4294. Phase 1 = services/account page (identity, plan free/tester, relay traffic vs 50 GB with reset date, machines with Remove, Delete account) + dashboard Settings > Anywhere Account card (identity, plan, relay used, Manage account link, PKCE Sign in). No checkout/upgrade/Add 50 GB/prices (phase 2 with PAN-4294). services/account change => tell the operator to redeploy the Worker after merge. Started 21:4xZ.

- 2026-11-03 ~21:50Z disk crisis: 6 starts at 15-17 GB free (PAN-4929/4930/4931/4948/4952/4959) took the disk to 4.9 GB in ~20 min. Each workspace costs ~2+ GB after the floor check (bun install + per-workspace Docker stack + 1.94 GB container-node-modules volume), and planning-only sessions already build the stack. Filed PAN-4961 (floor is point-in-time, not reserving). Cannot start it yet: the floor itself refuses new workspaces under 10 GB. Holding all new starts (PAN-4896, epic wave 2, PAN-4961) until the operator frees space. Learning: never start more workspaces than (free GB - 10) / 3 at once.

- 2026-11-03 ~22:00Z disk 4.5 GB: removed three dangling Docker volumes that hold only rebuildable caches (myn-feature-min-1072_desktop-target 2.34 GB, _desktop-cargo 0.27 GB, myn_feature_min_1039_wave3_fix1_review_node_modules 1.65 GB) -> 9.3 GB. Left the dangling *postgres*/redis volumes alone (data).

- 2026-11-03 23:5xZ operator clicked Merge batch to main on the Merge train page and nothing happened. Cause: two merge paths race (per-PR auto-merge train + UAT batch reconciler); each per-PR merge invalidates the batch, 30 generations today. Filed PAN-4970 (needs-handoff, TENET-10 merge machinery); route through a supervised handoff when a slot frees. Nothing was lost: per-PR train merged #4966/#4969.

- 2026-11-03 operator put PAN-4970 (dual merge paths) into the pipeline via pan start, overriding the TENET-10 handoff routing for this issue.

- 2026-11-04 PAN-4950 (W-CONN2) is held until the operator redeploys the connect Worker for PAN-4948 (W-DIR1): the PRD says W-CONN2 needs W-DIR1 'and its deploy'. All its other deps (W-CONN1 PAN-4949, W-MCP1) are merged.

## 2026-11-04 — PAN-4993: convergence gate withheld review feedback after an approval

- PAN-4947 (#4990) was approved twice; a conflict-repair merge brought in PAN-4951's ConnectBotDialog, and the next review blocked with 2 findings. `pan specialists done` printed "Review loop not converging (cycle counts: 0 → 0 → 2)" and sent needs-you instead of messaging the agent, so it idled 25+ min. Evidence: no `feedback.delivered` kind=review in `.overdeck/pipeline.jsonl`; the reason is in the review agent's transcript tool result.
- Cause: `evaluateReviewConvergence` (`src/lib/cloister/review-convergence.ts`) judges the whole series; the reversal rule fires on 0 → 2. A 0-blocker round is a converged loop, so blockers after it start a new episode. Filed PAN-4993 and launched a supervised handoff (conv 3601, worktree ~/Projects/hoff-pan-4993) because it is review-gate machinery (TENET-10).
- Instance recovery: `pan tell` re-delivered the feedback-file path. Learning: when an agent idles on CHANGES_REQUESTED, check the reviewer's `specialists done` output for "[feedback-target]" before assuming delivery failed.
- `pan handoff self` fails in conv-flywheel ("Could not determine the current conversation"); pass the conversation id (3399) instead.
