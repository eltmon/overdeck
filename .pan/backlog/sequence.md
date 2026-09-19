# Backlog Sequence

_Last sequenced: 2026-09-19T05:42:39.476Z · model: claude-opus-5 · open: 908_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3917 | XL | critical | ok | ✓ |  | Architecture epic: delete the state layer, keep every feature, Herdr default. Reshapes most open pipeline bugs |
| 2 | PAN-3679 | M | critical | ok |  |  | Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running |
| 3 | PAN-2746 | XS | critical | ok |  | PAN-2742, PAN-2695 | infra-failure bypass writes reviewStatus='passed' |
| 4 | PAN-2689 | S | critical | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost |
| 5 | PAN-3566 | XS | critical | ok |  |  | Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the deterministic producer of zombie test agents. |
| 6 | PAN-3285 | M | critical | ok |  |  | A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and cannot start one: 3.5h outage, 1107 silent failures. |
| 7 | PAN-3761 | M | critical | ok |  |  | Ready-to-merge issues never keep a UAT train: durable review status disagrees with passed PR stamps; re-dispatch yanks members. |
| 8 | PAN-3685 | S | high | ok |  |  | Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed |
| 9 | PAN-3561 | S | critical | ok |  |  | An ownerless state-git lock can never be broken — a crash between mkdir and owner.json bricked a project's write door for 2.5 days. |
| 10 | PAN-3524 | M | critical | ok |  |  | A server-owned --changed verification loop relaunches through deacon freeze, review abort, pause and operator stop; peaked at 78 workers. |
| 11 | PAN-3283 | S | critical | ok |  |  | Recovering from review_infrastructure_failure flips review_status to passed and ready_for_merge to 1 over a live CHANGES REQUESTED verdict. |
| 12 | PAN-3250 | S | critical | ok |  |  | Workspace spawn branches from local HEAD instead of origin/main, so every new feature branch inherits unpushed local-main commits. |
| 13 | PAN-2954 | XS | critical | ok |  |  | postMergeLifecycle refuses GitLab projects |
| 14 | PAN-3657 | S | critical | ok |  |  | Merge-train queues endpoint runs the monorepo queue builder for polyrepo projects, so MYN/Auricle trains are permanently empty. |
| 15 | PAN-3631 | S | critical | ok |  |  | Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state, so every pass gets a frozen Jul-20 prior. |
| 16 | PAN-3565 | M | critical | ok |  |  | Failed review spawn wedges 'starting', and an all-lanes infra failure is synthesized as a real CHANGES REQUESTED verdict. |
| 17 | PAN-3564 | M | critical | ok |  |  | Lock convoy: per-issue record lock held across the global state-git wait, so reviewer spawns die with no retry at 100% duty cycle. |
| 18 | PAN-3554 | M | critical | ok |  |  | Red main has no mechanical owner: it hid for ~5h because the merge gate renders red main as an empty queue, not an alarm. |
| 19 | PAN-3532 | S | critical | ok |  |  | CI runs only a hand-picked slice of the frontend suite, so main stayed red on frontend for hours while every run reported green. |
| 20 | PAN-3085 | XS | critical | ok |  |  | Review feedback is written to .overdeck/feedback but agents and the deacon merge gate are pointed at a nonexistent .pan/feedback. |
| 21 | PAN-3682 | S | critical | ok |  |  | Migrated polyrepo slot pan done writes a legacy workspace record path and crashes; completion must go through the state write door. |
| 22 | PAN-3654 | S | critical | ok |  |  | Compact respawn confirms against the archived session and kills a healthy fresh agent that was already doing the work. |
| 23 | PAN-3653 | M | critical | ok |  |  | A strike blocked on red main has no owner that wakes it when main goes green; the session stays alive so recover refuses it. |
| 24 | PAN-3630 | M | critical | ok |  |  | pan tell reported three deliveries to a live agent, moved all three to read/, and the agent received none — the delivery door lies. |
| 25 | PAN-3571 | S | critical | ok |  |  | Stop-hook completion-check timeout exits silently — 334 stranded turn-ends, no nudge, no escalation; agents idle until a patrol notices. |
| 26 | PAN-3563 | S | critical | ok |  |  | A role agent whose prompt never delivered stays status=running with pid null; no patrol reconciles it and pan unstick can't see it. |
| 27 | PAN-3805 | S | critical | ok |  |  | Codex idle poke spawns codex exec instead of the app-server door; failed sends still tick the counter and pause healthy agents |
| 28 | PAN-3560 | M | critical | ok |  |  | PTY supervisor overloads under concurrent review convoys; fleet-wide 502 'input echo confirmation failed' kills resumes and feedback. |
| 29 | PAN-3520 | S | critical | ok |  |  | Test gate records 'failed' for load-induced timeouts; retry timeout-only failures in isolation before writing a verdict. |
| 30 | PAN-3500 | S | critical | ok |  |  | A review sub-role edited seven tracked files after writing its report and the changes were auto-committed into the feature history. |
| 31 | PAN-3424 | M | critical | ok |  |  | State plane silently stops being durable: non-FF overdeck-state pushes are only warned about, and drafts/ PRDs are never staged. |
| 32 | PAN-3313 | S | critical | ok |  |  | A transient upstream stream error benches CLIProxy's only auth: ~70% of GPT-routed inference 503s with a message that blames credentials. |
| 33 | PAN-3282 | M | critical | ok |  |  | Review agents die before writing a verdict across 5 issues and 2 projects, leaving a verdict-shaped status with no artifact behind it. |
| 34 | PAN-3281 | S | critical | ok |  |  | ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so unfinished work is assembled into a UAT batch. |
| 35 | PAN-3248 | XS | critical | ok |  |  | pan reload never clears pending-deploy.json, so verification stops for every project until a patrol happens to notice. |
| 36 | PAN-3905 | S | critical | ok |  |  | First agent spawned into a planner-created workspace dies at the Claude trust dialog; foreman/swarm spawn fails outright |
| 37 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume |
| 38 | PAN-2742 | S | high | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' |
| 39 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch |
| 40 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json |
| 41 | PAN-2733 | S | high | ok |  |  | substrate-bug-poller has never run |
| 42 | PAN-1560 | XS | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 43 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes |
| 44 | PAN-2828 | S | critical | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 45 | PAN-3580 | S | critical | ok |  |  | UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL |
| 46 | PAN-3677 | M | high | ok |  |  | Planning agents wedge after a background Explore task finishes; parent never consumes the result |
| 47 | PAN-2874 | M | critical | ok |  | PAN-2828 | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli… |
| 48 | PAN-2883 | M | high | ok |  | PAN-2828 | Close-out deploy row fails for every strike-landed issue |
| 49 | PAN-2806 | S | high | ok |  |  | strike merge trigger registry splits across dashboard chunks |
| 50 | PAN-2940 | M | critical | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI |
| 51 | PAN-3708 | M | critical | ok |  |  | pan strike dies at git worktree list on a polyrepo wrapper — the urgent-strike escape hatch is unavailable for MYN-class projects. |
| 52 | PAN-3605 | XS | high | ok |  |  | Supply chain: lint-effect-diagnostics npx fell back to the registry and ran a squatted unscoped package; pin the scoped local bin. |
| 53 | PAN-3569 | S | critical | ok |  |  | A stale pending-post-merge.json deadlocks the deploy gate: no staleness rule, and both owners need the restart the gate refuses. |
| 54 | PAN-3557 | S | critical | ok |  |  | Post-merge label writes have no retry; a 403 hides a merged issue from the verify-on-main sweep while lifecycle reports success. |
| 55 | PAN-3543 | S | critical | ok |  |  | Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while the refusal itself recommends --fresh. |
| 56 | PAN-3522 | S | critical | ok |  |  | Supervisor watchdog restart-churns under CPU storm because the probe timeout budget ignores the boot warm phase. |
| 57 | PAN-3783 | L | high | ok |  |  | Deliver managed context through harness adapters and stop generating into native CLAUDE.md/AGENTS.md; operator-authorized, in flight |
| 58 | PAN-3314 | M | critical | ok |  |  | One cgroup holds every agent pane, so a single hungry agent inflates the unit and oomd kills the whole fleet — twice now. |
| 59 | PAN-3278 | S | critical | ok |  |  | A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue fired none of 25 attempts. |
| 60 | PAN-3244 | S | critical | ok |  |  | A queued dashboard deploy defers verification for every issue in every project, starving unrelated cross-project review handoffs. |
| 61 | PAN-3237 | S | critical | ok |  |  | A capacity 409 on planning→work handoff is classified as 'guardrails' and marked terminally stuck; three issues stranded at once. |
| 62 | PAN-3234 | S | critical | ok |  |  | Agents freeze indefinitely on blocking choice menus and no health surface notices; the detector is wired only to delivery refusal. |
| 63 | PAN-3205 | S | critical | ok |  |  | The deployment gate promises the queued deploy will fire at the next verification boundary; that trigger does not exist. |
| 64 | PAN-3168 | XS | critical | ok |  |  | DoD row 5 counts status 'unknown' as running, so an agent paused FOR close-out blocks close-out — a permanent verifying_on_main deadlock. |
| 65 | PAN-3118 | S | critical | ok |  |  | Model-specific quota exhaustion is invisible everywhere but the pane: four planning agents read 'running' at $0.00 with no fallback. |
| 66 | PAN-3106 | S | critical | ok |  |  | auto_merge_default: hold is consulted on one merge path only, so held issues merge individually and defeat the UAT train. |
| 67 | PAN-3103 | S | critical | ok |  |  | A transient merge_status=failed skips close-out permanently, leaving merged work open and pickup-eligible for a fresh planning agent. |
| 68 | PAN-3100 | S | critical | ok |  |  | The test role evaluates the dirty working tree, so a live work agent's uncommitted edits are recorded as the issue's test failure. |
| 69 | PAN-3096 | S | critical | ok |  |  | pan done blocks on generated .devcontainer/ and dev, and agents resolve it by deleting workspace infrastructure or inventing gitignores. |
| 70 | PAN-3084 | S | critical | ok |  |  | A review session spawned but never briefed sits at zero context forever, and restart 'preserves' the zombie that blocks its replacement. |
| 71 | PAN-3078 | S | critical | ok |  |  | Inspect verdicts are persisted but never delivered, so a work agent that waits for its item verdict deadlocks forever. |
| 72 | PAN-3043 | S | critical | ok |  |  | Provider health is probed only at spawn, so a mid-run 403 quota refusal leaves an agent 'running' for days holding a slot. |
| 73 | PAN-1824 | S | high | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 74 | PAN-2932 | S | high | ok |  | PAN-2337 | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 75 | PAN-2935 | S | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router |
| 76 | PAN-2337 | XS | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 77 | PAN-2422 | XS | high | ok |  | PAN-2337 | rebuilding dist under a live server breaks lazy chunk imports |
| 78 | PAN-2699 | XS | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle |
| 79 | PAN-2957 | XS | high | ok |  | PAN-2337 | npm run build intermittently produces stale frontend bundles |
| 80 | PAN-2850 | M | high | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 81 | PAN-2758 | S | critical | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 82 | PAN-2886 | M | high | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 83 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 84 | PAN-2813 | M | high | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 85 | PAN-2848 | S | critical | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a… |
| 86 | PAN-2846 | S | critical | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 87 | PAN-2747 | S | high | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 88 | PAN-2759 | S | high | ok |  |  | Dead flywheel with an active run was never auto-relaunched after a reboot |
| 89 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target |
| 90 | PAN-2668 | M | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents |
| 91 | PAN-2569 | XS | critical | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn |
| 92 | PAN-2567 | S | critical | ok |  |  | reviewed+green PR stuck after review |
| 93 | PAN-3811 | M | high | ok |  |  | The PAN-3809 emergency strike prunes BuildKit unconditionally; inventory, bounded reclaim door and retention floor are still missing |
| 94 | PAN-2179 | S | high | ok |  |  | relaunch can leave a zombie agent |
| 95 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS |
| 96 | PAN-2775 | S | high | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04… |
| 97 | PAN-2734 | S | high | ok |  |  | merge queue head-of-line zombie |
| 98 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 99 | PAN-3697 | XS | high | ok |  |  | Deployed dashboard PATH omits Bun, so verification workers hit 'bun: not found' before the required install gate. |
| 100 | PAN-3633 | S | high | ok |  |  | Strike workspaces spawn without @types, so the contract's own typecheck gate fails and agents abort reporting a false red main. |
| 101 | PAN-3104 | S | critical | ok |  |  | A stale .pan/test/result.json is re-applied with no freshness check against HEAD, re-failing an issue long after the fix landed. |
| 102 | PAN-3099 | XS | critical | ok |  |  | --health-timeout 120 is enforced as 120ms and a false-failed check exits after killing the old server — nothing left listening. |
| 103 | PAN-3044 | XS | critical | ok |  |  | Feedback delivery has no terminal-issue guard: it dispatched review and raised needs-you on issues closed 12 days earlier. |
| 104 | PAN-3040 | S | critical | ok |  |  | pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects; same defect as PAN-3708. |
| 105 | PAN-3023 | S | critical | ok |  |  | Post-planning auto-spawn logs 'attempt 1/3' and never retries after a transient Docker EOF, stranding the issue with no re-drive owner. |
| 106 | PAN-2971 | S | critical | ok |  |  | The orchestrator finalized its own run and kept ticking for 19 hours while dashboard Pause/Stop were disabled — an uncontrollable zombie. |
| 107 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery |
| 108 | PAN-2888 | M | high | ok |  | PAN-2846 | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO… |
| 109 | PAN-3793 | S | high | ok |  |  | resolveIssuePullRequestRef probes only feature/ and strike/ names, so close-out cannot find a merged PR on a descriptive branch |
| 110 | PAN-2960 | S | high | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict |
| 111 | PAN-2959 | S | high | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit |
| 112 | PAN-2639 | S | high | ok |  | PAN-2331 | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 113 | PAN-2331 | S | high | ok |  |  | codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) |
| 114 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully |
| 115 | PAN-2511 | XS | high | ok |  |  | Work agents burn 20+ min on false test failures |
| 116 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 117 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push |
| 118 | PAN-2763 | S | high | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution |
| 119 | PAN-2170 | XS | high | ok |  |  | Docker init container lacks Python |
| 120 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 121 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 122 | PAN-3689 | S | high | ok |  |  | Orphaned swarm-slot GC targets the aggregate polyrepo root; nested worktrees survive and spam failures |
| 123 | PAN-2880 | M | high | ok |  | PAN-2259 | Linear tracker listIssues is a 3N+1 request storm |
| 124 | PAN-2966 | S | high | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev |
| 125 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 126 | PAN-2680 | M | high | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 127 | PAN-3734 | S | high | ok |  |  | Completed swarm slot reuse can start a new item from a stale polyrepo branch — silent wrong-parent work. |
| 128 | PAN-3650 | S | high | ok |  |  | Strike self-abort is not terminal — state.json stays running and the deacon resurrects the aborted strike on every recovery pass. |
| 129 | PAN-3621 | M | high | ok |  |  | pan start intermittently dies resolving a chunk graph spliced across two builds — importer from primary dist, path in the live generation. |
| 130 | PAN-3555 | S | high | ok |  |  | pan start without --fresh silently abandoned an intact 7.5MB warm session, violating the warm-by-default contract. |
| 131 | PAN-3498 | S | high | ok |  |  | write-sequence pins in-pipeline ranks without renumbering, so the persisted sequence carries duplicate ranks and gaps. |
| 132 | PAN-3496 | XS | high | ok |  |  | A review convoy member blocked on an operator AskUserQuestion about review depth; review agents must decide and record, not ask. |
| 133 | PAN-3301 | S | high | ok |  |  | Backlog manifest still writes legacy .pan, so the state-recreation patrol logs a stray-writer warning ~68k times — dominant log volume. |
| 134 | PAN-3081 | S | high | ok |  |  | The agent git guard is PATH-based and an agent stripped it unprompted to get past a false block; a control the agent can remove isn't one. |
| 135 | PAN-3898 | M | high | needs-refinement |  | PAN-3917 | Strike landing: salvage re-arms a landed strike, close-out records zero merges, no post-merge deploy. Re-scope after the Cut |
| 136 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover |
| 137 | PAN-2324 | XS | high | ok |  |  | label transition fails atomically on missing 'in-planning' label |
| 138 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans… |
| 139 | PAN-2905 | S | high | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s |
| 140 | PAN-2259 | S | critical | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota |
| 141 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 142 | PAN-2421 | XS | high | ok |  |  | dashboard server route tests flake under full-suite verification load |
| 143 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 144 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH |
| 145 | PAN-2656 | S | high | ok |  |  | deacon-swarm unit tests read live ~/.overdeck/config.yaml |
| 146 | PAN-2075 | XL | high | ok | ✓ |  | Boot Reconciliation + Operator Inbox |
| 147 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) |
| 148 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 149 | PAN-2079 | M | high | ok |  | PAN-2077 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 150 | PAN-2080 | M | high | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) |
| 151 | PAN-1775 | M | high | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 152 | PAN-454 | XS | high | ok |  | PAN-2077 | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 153 | PAN-1436 | S | high | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 154 | PAN-3651 | M | high | ok |  |  | Re-land the reverted overdeck-state non-fast-forward push retry; without it a concurrent state writer wedges every state write. |
| 155 | PAN-3634 | S | high | ok |  |  | Planning auto-handoff stamps the ambient flywheelRunId on operator-started work, stripping its reaping exemption. |
| 156 | PAN-3556 | S | high | ok |  |  | No per-agent spawn mutex: two flows allocated session identities 3s apart and the second pin orphaned the first transcript. |
| 157 | PAN-3553 | S | high | ok |  |  | tmux list-panes -a exits 1 on a zero-session server, so the census reads unavailable post-reboot and conversations hang on 'Starting…'. |
| 158 | PAN-3535 | S | high | ok |  |  | The drain/resume hold is re-derived from the caller's env each boot, so any restart from a clean shell silently drops it. |
| 159 | PAN-3464 | XS | high | ok |  |  | pan swarm reset never clears slotCompletions, so a stale marker re-arms the exact wedge the operator ran reset to escape. |
| 160 | PAN-3429 | M | high | ok |  |  | Memory governor defers admissions but sheds nothing under HARD pressure; concurrent heavy gate runs aren't in the shed ladder. |
| 161 | PAN-3397 | S | high | ok |  |  | Fresh convoy lanes freeze at 0 output before kickoff; PAN-3375's detector only covers warm resumes, so recovery is manual. |
| 162 | PAN-3325 | S | high | ok |  |  | A fresh workspace ships an empty-but-present node_modules, so tooling silently resolves the parent repo's deps and gates go false-green. |
| 163 | PAN-3317 | S | high | ok |  |  | Strike agents are told to rebase, the launcher guard blocks it, and pan sync-main can't resolve a -strike workspace. Overlaps PAN-3306. |
| 164 | PAN-3284 | S | high | ok |  |  | A workspace-confined agent wrote a doc edit into the primary main worktree — the PAN-2204 write-to-main hazard through a new door. |
| 165 | PAN-3270 | S | high | ok |  |  | New workspaces arrive with empty node_modules and bun off the agent shell PATH, so the documented bun install remedy fails. |
| 166 | PAN-3257 | S | high | ok |  |  | Crash-resume leaves a stale PTY socket and drops supervisorEnabled from state.json, so every supervisor delivery fails afterwards. |
| 167 | PAN-3188 | XS | high | ok |  |  | DoD row 5 accepts only the transient verifying_on_main state, so an already-done issue can never be closed without an override. |
| 168 | PAN-3139 | S | high | ok |  |  | The authoritative agents table under-reports a live 4h agent as stopped while pan start's own liveness check correctly refuses. |
| 169 | PAN-3668 | L | medium | ok |  |  | Add Prime Agent as a managed harness (in flight — RPC runtime adapter, discovery, transcripts) |
| 170 | PAN-3129 | M | high | ok |  |  | No symlink/TOCTOU containment on canonical writes under agent-controlled paths; a planted symlink redirects a server-side write. |
| 171 | PAN-3120 | S | high | ok |  |  | A scheduler-yielded work agent makes operator MERGE hard-error on polyrepo and silently dead-end on single-repo. |
| 172 | PAN-3077 | XS | high | ok |  |  | Inspect and review-supervisor spawns omit --effort and inherit the harness xhigh default — recurring overspend, once per xBRIEF item. |
| 173 | PAN-3062 | M | high | ok |  |  | The shared primary main worktree stacks several sessions' commits, so whoever pushes next ships everyone else's unverified work. |
| 174 | PAN-3048 | XS | high | ok |  |  | Pipeline auto-commit lands Overdeck's own .pan/drafts PRD into product feature branches; the exclusion list is duplicated and has drifted. |
| 175 | PAN-3032 | S | high | ok |  |  | Rebuild composes under overdeck-feature- while Traefik labels name myn-feature- devnet, and traefik attaches are runtime-only. |
| 176 | PAN-3307 | XS | high | ok |  |  | commitlint scope-enum lists 11 scopes, 14 real ones are missing, and it still names the removed beads scope — trains everyone to ignore it. |
| 177 | PAN-3022 | S | high | ok |  |  | The work-spawn route ignores record.workModel, so the role default wins and then persists over the operator's per-issue override. |
| 178 | PAN-2642 | XL | high | ok | ✓ |  | Cost strategy: waste detection over budget policing |
| 179 | PAN-1868 | XS | high | ok |  | PAN-2466 | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 180 | PAN-2466 | S | high | ok |  |  | close-out/record writer clobbers closeOut.usage with EMPTY data |
| 181 | PAN-1042 | S | high | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 182 | PAN-570 | XS | high | ok |  | PAN-2642 | Show PLAN badge on costs when under a subscription/plan |
| 183 | PAN-106 | M | high | stale |  |  | Cost prediction/estimation for in-progress work |
| 184 | PAN-2059 | XL | high | ok | ✓ |  | Backlog pickup gate |
| 185 | PAN-2376 | XL | high | ok | ✓ |  | Epic: CI/CD reliability |
| 186 | PAN-3775 | S | high | ok |  |  | makeDbLive opens overdeck.db unmigrated; zero-table db poisons a vitest worker home and breaks later read-only audits. |
| 187 | PAN-3652 | XS | high | ok |  |  | No workflow_dispatch on ci.yml / state-plane-branches.yml, so an unverified main tip can never be verified and DoD row 6 blocks close-out. |
| 188 | PAN-3622 | XS | high | ok |  |  | orphan-proposed-reconciler test pins a real issue id and reads live GitHub; it fails pan release check on a green main. |
| 189 | PAN-3579 | M | high | ok |  |  | ~20 frontend mutations hand-write JSON headers and omit the CSRF token, so each 403s the moment its route becomes guarded. |
| 190 | PAN-3541 | S | high | ok |  |  | Review restart loops on the session-resume menu because eligibility ignores how the prior session ended; partial mechanical break landed. |
| 191 | PAN-3463 | S | high | ok |  |  | A legitimate empty-diff slot outcome can never pass item verify, so the slot wedges and blocks dispatch of remaining items forever. |
| 192 | PAN-3460 | S | high | ok |  |  | Per-item verify_commands that run the whole root suite make slot merge gates load-fragile and hold a patrol in flight for ~17 minutes. |
| 193 | PAN-3454 | M | high | ok |  |  | Cost hook rescans fork-copied parent history from byte 0 under the reviewer's id — fabricated cache-miss warnings and double-billed spend. |
| 194 | PAN-3439 | XS | high | ok |  |  | pan start crashes on a 'pending-work-spawn' placeholder row; resume already guards this and takes the fresh-spawn path. |
| 195 | PAN-3432 | S | high | ok |  |  | Preemptive yield fans out: seven work agents paused to make room for one review convoy, then flood back oldest-first. |
| 196 | PAN-3306 | S | high | ok |  |  | Three layers disagree on how a strike rebases: the prompt instructs it, the launcher guard blocks it, sync-main resolves the wrong worktree. |
| 197 | PAN-3297 | S | high | ok |  |  | After a dashboard restart, delivery calls a healthy agent a zombie while resume calls it healthy; both classifiers can't be right. |
| 198 | PAN-3274 | S | high | ok |  |  | A test-role agent spawned and never ran a turn, holding an approved CI-green issue out of the merge gate behind a stale failed verdict. |
| 199 | PAN-3267 | S | high | ok |  |  | GitLab merged-head oracle spawns one glab subprocess per repo × head, so pipeline membership refresh fails on every cycle. |
| 200 | PAN-3261 | S | high | ok |  |  | The tmux delivery fallback answered a live session-resume menu because its own paste hid the menu from the detector — silent /compact. |
| 201 | PAN-3256 | S | high | ok |  |  | glab mr list runs with a polyrepo wrapper root as cwd, which is not a git repo, so MYN membership fails forge_unavailable every cycle. |
| 202 | PAN-3190 | XS | high | ok |  |  | pan merge cancel has a 0% success rate: Commander binds its options object into the injectable fetchImpl parameter. |
| 203 | PAN-3174 | S | high | ok |  |  | Polyrepo UAT stacks 504: Traefik labels carry the old myn- prefix, Traefik isn't on the overdeck-* devnet, and the fe port is wrong. |
| 204 | PAN-3171 | S | high | ok |  |  | The pipeline emits 'merge failed' after a successful merge and successful cleanup, leaving the issue Todo with the commit already on main. |
| 205 | PAN-3050 | XS | high | ok |  |  | Idle-stack reaper's regex only matches overdeck-feature-*-server|frontend, so MYN stacks run for hours after their agents are gone. |
| 206 | PAN-2995 | XS | high | ok |  |  | pan done --strike gates on branch ancestry, which a squash-merge breaks, so it refuses strikes that pan close proves merged. |
| 207 | PAN-2980 | XS | high | ok |  |  | The pre-push file-size guard reads the shared working tree, so another session's uncommitted edits block an unrelated, guard-clean push. |
| 208 | PAN-3899 | S | high | ok |  |  | pan reload drops the Deacon/resume boot gates chosen at the last restart, so every deploy relaunches with the Deacon off |
| 209 | PAN-3900 | S | high | ok |  |  | Docker bridge pool exhausted by orphaned workspace networks; pan start fails and the bridge-pool patrol only warns |
| 210 | PAN-3769 | S | high | needs-refinement |  |  | Red main 707089c5→e4b280b3 blocked deploys ~14h: missing no-loss lock entry + stale OpenRouter expectation. Verify still reproducing. |
| 211 | PAN-3760 | S | high | ok |  |  | permissionMode 'auto' undocumented as non-bypass, launcher can emit invalid --permission-mode, invalid values drop silently. |
| 212 | PAN-3629 | M | high | ok |  |  | No sanctioned door to re-scope a live agent; the operator must violate pan tell doctrine or let the rejected design land. |
| 213 | PAN-3517 | M | high | ok |  |  | Convoy forks still miss the parent prompt cache in production — launch-injection byte drift plus resume dropping the cache-scope header. |
| 214 | PAN-3508 | S | high | ok |  |  | pan reload deletes the generation the global pan link points at, so the CLI vanishes mid-deploy for anyone invoking from elsewhere. |
| 215 | PAN-3303 | S | high | ok |  |  | An empty registered-projects 200 is treated as authoritative, latching Command Deck at 'Unknown project' until a manual page reload. |
| 216 | PAN-3280 | S | high | needs-refinement |  |  | One issue's agent sessions vanished four times in a run while every peer stayed up; specimen-specific — re-confirm the mechanism. |
| 217 | PAN-3243 | XS | high | ok |  |  | auto-commit test polls a fixed 20 setImmediate turns for a real git subprocess; the flake reddened main and blocked a close-out. |
| 218 | PAN-3224 | XS | high | needs-refinement |  |  | Duplicate of PAN-3439: a stranded 'pending-work-spawn' model kills plain pan start while resume already guards it. |
| 219 | PAN-3196 | S | high | ok |  |  | Root-owned container residue makes close-out die on EACCES after passing every DoD row; same family as PAN-3570. |
| 220 | PAN-3186 | XS | high | ok |  |  | One configured non-git member (auricle/infra) blanks pipeline membership for the whole project the resolver claims it can answer. |
| 221 | PAN-3185 | XS | high | ok |  |  | TOCTOU between the duplicate-session guard and session creation makes pan start report a hard failure over a successful spawn. |
| 222 | PAN-3179 | M | high | ok |  |  | A UAT promote is complete at merge time with no production-reach check, so members read shipped while prod serves the old build. |
| 223 | PAN-3176 | S | high | ok |  |  | UAT promote consults no stack health, so a batch whose stack was never exercised can be promoted from a success-green control. |
| 224 | PAN-3130 | S | high | ok |  |  | Identifier-joined write paths have no containment assertion, so a crafted issue or agent id could redirect a canonical write. |
| 225 | PAN-3047 | XS | high | ok |  | PAN-2828 | Strike-branch teardown uses --is-ancestor, which cannot see a squash merge, so all 96 strike/* branches survive as residue. |
| 226 | PAN-3046 | XS | high | ok |  |  | pan exits with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out, so callers read a successful merge handoff as failure. |
| 227 | PAN-1711 | S | high | ok |  |  | Dashboard event-loop stalls under load force watchdog restarts; the root cause behind the PAN-3522 churn and the 0.5-1.5s API latencies. |
| 228 | PAN-3916 | M | high | ok |  |  | Session pointers go stale after rollover + crash recovery; issue view and pan tell confirmation track a dead transcript |
| 229 | PAN-3854 | S | high | ok |  |  | Feature-workspace devcontainer stack returns 403 on POST /api/dashboard/session, blocking all in-browser mutation UAT |
| 230 | PAN-3667 | M | high | ok |  |  | CLIProxy has no cross-family remap, so every Anthropic-pinned subagent dies at spawn in a proxied session; stopgap is hand-written. |
| 231 | PAN-3596 | M | high | ok |  |  | Deacon patrol has no per-step timing, so overruns in the system's central scheduler cannot be attributed to a step. |
| 232 | PAN-3536 | S | high | ok |  |  | pan tell can not reach ohmypi conversations: with no state.json the expected harness defaults to claude-code and delivery reports a zombie. |
| 233 | PAN-3527 | XS | high | ok |  |  | One failed boot-time fetch leaves the sidebar at CONVERSATIONS 0 / ISSUES 0 for the life of the tab — nothing retries it. |
| 234 | PAN-3510 | S | high | ok |  |  | Agent stop leaves detached docker-run test containers alive for hours, contending with other agents' quality gates. |
| 235 | PAN-3505 | XS | high | ok |  |  | Unpushed agent code commits on the primary main worktree make every flywheel state push fail the agent main-push guard. |
| 236 | PAN-3355 | XS | high | ok |  |  | sessionExists collapses 'no such session' and 'could not ask' into false, so callers read not-running when liveness is unknown. |
| 237 | PAN-3289 | S | high | ok |  |  | A sequencer pass ran against an empty manifest while the read model held 1120 issues — a transiently empty read at spawn. |
| 238 | PAN-3245 | XS | high | ok |  |  | The pan done gate flags workspace .pan/drafts as uncommitted despite its own .pan exclusion, training agents to reach for --force. |
| 239 | PAN-3218 | S | high | ok |  |  | No release-drift signal: an install-breaking fix sat merged and unpublished for ~9 hours with nothing surfacing it. |
| 240 | PAN-3210 | XS | high | ok |  |  | Close-out teardown scopes by compose project while the guard scopes by working_dir, so an unprefixed dead init container blocks it. |
| 241 | PAN-3167 | S | high | ok |  |  | krux and lexerra are permanently unreadable through the membership door: an App-not-installed 404 is typed as retryable forge_unavailable. |
| 242 | PAN-3113 | M | high | ok |  |  | Blocking agent-pane choice prompts show nothing in the conversation view; surface them as inline decision cards with keystroke delivery. |
| 243 | PAN-3108 | XS | high | ok |  |  | dashboard.log reached 867MB with no rotation — disk cost and un-greppable incident logs exactly when they're needed. |
| 244 | PAN-3094 | XS | high | ok |  |  | pan done's merge fallback still force-pushes a fast-forwardable branch, so a rejected push leaves completion half-done. |
| 245 | PAN-3012 | M | high | ok |  |  | Archiving preserves the pointer, not the data: harnesses delete session JSONL on their own schedule and the conversation is unrecoverable. |
| 246 | PAN-3911 | S | high | ok |  |  | pan pause <issue> stops only the work agent; review/test convoys keep running and Deacon re-dispatch resurrects reviewers |
| 247 | PAN-3627 | XS | high | ok |  |  | backlog-auto-trigger throws on a legitimately empty manifest, so a plain npx @overdeck/core in a non-project dir prints a stack trace. |
| 248 | PAN-3617 | S | high | needs-refinement |  |  | Three strike dispatches for PAN-3586 died with zero output while a sibling worked; may be stale — re-confirm before picking up. |
| 249 | PAN-3513 | L | high | ok |  |  | Durable agent runtime plane on overdeck-state: GC shredded live session pointers mid-review-loop with no reconstruction fallback. |
| 250 | PAN-3308 | XS | high | ok |  |  | The file-size guard prints a paste-ready ratchet-up line, so 2 of 3 agents raised the ceiling instead of shrinking the file. |
| 251 | PAN-3276 | XS | high | ok |  |  | Needs-you rows for pane questions and permission prompts are click-dead, so the list that exists to route the operator routes nowhere. |
| 252 | PAN-3235 | S | high | ok |  |  | Render and answer agent pane-choice menus on the decision card; PAN-3228 shipped the core and CLI, the dashboard UX remains. |
| 253 | PAN-3789 | L | medium | needs-refinement |  |  | MCP servers configured in standalone Codex never reach Overdeck conversations; no setup, auth or lifecycle story across harnesses |
| 254 | PAN-3211 | S | high | ok |  |  | Issues closed without landing have no honest disposition, so their review_status rows are neither close-able nor reapable. |
| 255 | PAN-3175 | M | high | ok |  |  | Merge-train ordering derives conflicts from file overlap alone, so semantically dependent members batch in any order and break the schema. |
| 256 | PAN-3137 | XS | high | ok |  |  | UAT generation member titles come from the Flywheel status snapshot, so orchestrator prose replaces issue titles on the promote surface. |
| 257 | PAN-3751 | M | high | ok |  |  | Post-merge deploy runs a multi-minute build with no dashboard indication — operator reads a silent deploy as a lost notification |
| 258 | PAN-3015 | L | high | ok |  |  | Claude Code is the only harness still driven by keystroke injection; a pull-based monitor inbox would retire the whole hardening stack. |
| 259 | PAN-3866 | S | high | ok |  |  | Test specialist copies the previous head's uatStatus into the new result instead of re-running browser UAT; stale fail strands merge |
| 260 | PAN-3902 | S | high | ok |  |  | Verification gates inherit OVERDECK_* env from the dashboard, so host boot state (--no-resume) reds unrelated branches |
| 261 | PAN-3909 | L | high | needs-refinement |  | PAN-3917 | One agents read door (delete the read-model accumulator). Aligns with the Cut tenet; re-scope once PAN-3917 lands |
| 262 | PAN-3861 | L | high | needs-refinement |  | PAN-3917 | terminal.backend setting (tmux|herdr). The Cut ships the backend contract with Herdr default; re-scope to what remains |
| 263 | PAN-3518 | M | high | needs-refinement |  | PAN-3517 | Re-review resumes re-bill the whole cold history; make reviewResumeDecision TTL- and size-aware. Needs design sign-off. |
| 264 | PAN-3445 | XS | high | ok |  |  | projects.yaml TCP lock ports overlap the OS ephemeral range, so an unrelated socket makes an uncontended config write fail. |
| 265 | PAN-3332 | S | high | ok |  |  | A detached slash-command spawn died in 150ms while the UI kept saying 'running in the background'; the activity must own its outcome. |
| 266 | PAN-3295 | M | high | ok |  |  | Completion-check LLM is invisible infrastructure that fanned out to 35 concurrent processes; one queued summarizer plus observability. |
| 267 | PAN-3236 | XS | high | needs-refinement |  |  | ECONNREFUSED on a dead supervisor socket was treated as ambiguous so feedback never crossed to tmux; a fix commit is cited — verify. |
| 268 | PAN-3013 | XS | high | ok |  |  | Role-spawn wrote 26 session-scoped hook paths into the durable ~/.claude/settings.json; they fail on every Linear tool call forever. |
| 269 | PAN-3771 | M | high | ok |  |  | Conversation search silently empty end-to-end: palette flag off by default, FTS scan manual-only, no summaries. |
| 270 | PAN-3533 | L | high | ok |  |  | No per-project resource partitioning, so one project's docker stacks and installs starve another project's pipeline and the dashboard. |
| 271 | PAN-3420 | M | high | ok |  |  | Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe) |
| 272 | PAN-3107 | S | high | ok |  |  | OOM spikes are unattributable after the fact; productize the machine-local memory-attribution census stopgap. |
| 273 | PAN-3762 | XL | high | needs-refinement |  | PAN-3917 | Overdeck Anywhere direction change: per-machine servers + client-side federation instead of relay-first. Supersedes PAN-2350 plan. |
| 274 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline Throughput Hardening |
| 275 | PAN-1556 | S | high | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 276 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 277 | PAN-2190 | L | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) |
| 278 | PAN-2233 | L | high | ok |  |  | decompose merge-agent.ts (1,414 lines) into focused modules |
| 279 | PAN-2526 | M | high | ok |  |  | Refactor deacon.ts below file-size baseline |
| 280 | PAN-2008 | XS | high | ok |  | PAN-1936 | store-access guard |
| 281 | PAN-1936 | M | high | ok |  |  | Single source-of-truth reads |
| 282 | PAN-1988 | M | high | ok |  | PAN-1936 | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 283 | PAN-1910 | XS | high | ok |  | PAN-1936 | fast-follow(PAN-1908): collapse issue status to ONE canonical field |
| 284 | PAN-1325 | M | high | ok |  |  | Artifact storage model is unsafe for polyrepo projects |
| 285 | PAN-1728 | S | high | ok |  |  | PAN-1700 agent committed .pan/specs/*.vbrief.json mutations |
| 286 | PAN-2651 | S | high | ok |  |  | simplify lifecycle reconciliation and add a safe post-planning reset |
| 287 | PAN-2678 | M | high | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 288 | PAN-2241 | S | high | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 289 | PAN-2242 | S | high | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 290 | PAN-2240 | S | high | ok |  |  | pan tell contradicts itself on dead ohmypi sessions |
| 291 | PAN-2243 | S | high | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 292 | PAN-2244 | S | high | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main |
| 293 | PAN-2202 | S | high | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion |
| 294 | PAN-2195 | M | high | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 295 | PAN-2237 | S | high | ok |  |  | pan plan done swallows vbrief quality lint details |
| 296 | PAN-2487 | M | high | ok |  |  | CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 297 | PAN-2469 | M | high | ok |  |  | issue-level assembly owner |
| 298 | PAN-2212 | M | high | ok |  |  | Swarm slot dispatch has no reserved budget |
| 299 | PAN-2213 | M | high | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 300 | PAN-2211 | M | high | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 301 | PAN-2210 | M | high | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 302 | PAN-2201 | XS | high | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo |
| 303 | PAN-2718 | M | high | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag |
| 304 | PAN-2646 | XS | high | ok |  |  | configurable global/project/issue policy UI with default OFF |
| 305 | PAN-2652 | M | high | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso… |
| 306 | PAN-2667 | M | high | ok |  |  | Reimplement the task-progress admission signal in resource discovery |
| 307 | PAN-3787 | L | medium | ok |  |  | Add a per-child composer and live Working-for indicator to subagent transcripts for Codex and Claude Code |
| 308 | PAN-2755 | S | high | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 309 | PAN-2754 | S | high | ok |  |  | `always` is inert |
| 310 | PAN-2809 | M | high | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 311 | PAN-2810 | M | high | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 312 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate |
| 313 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 314 | PAN-1710 | S | high | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 |
| 315 | PAN-1720 | S | high | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation |
| 316 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 317 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 318 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** |
| 319 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes |
| 320 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 321 | PAN-2266 | M | high | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 322 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 323 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks |
| 324 | PAN-687 | M | high | ok |  |  | Support OpenCode as alternative coding agent |
| 325 | PAN-466 | M | high | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 326 | PAN-465 | M | high | ok |  |  | Add OpenRouter as a model provider |
| 327 | PAN-463 | M | high | ok |  |  | Add Qwen 3.6+ model support |
| 328 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 329 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 330 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 331 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier |
| 332 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 333 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 334 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 335 | PAN-1254 | L | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 336 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 337 | PAN-1915 | M | high | ok |  |  | enhancement(security): API key at-rest hardening |
| 338 | PAN-1435 | XS | high | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 339 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 340 | PAN-1640 | M | high | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 341 | PAN-2351 | XS | high | ok |  | PAN-1166 | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 342 | PAN-2350 | L | high | needs-refinement | ✓ |  | Epic container for Overdeck Anywhere P0-P3; PAN-3762 proposes replacing the relay-first direction with per-machine server federation. |
| 343 | PAN-1217 | XS | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 344 | PAN-1218 | M | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 345 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 346 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 347 | PAN-1451 | M | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 348 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 349 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit |
| 350 | PAN-1553 | M | high | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 351 | PAN-1504 | M | high | ok |  |  | pan hygiene |
| 352 | PAN-1480 | L | high | ok |  |  | TLDR: 93% bypass rate |
| 353 | PAN-1479 | M | high | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 354 | PAN-2950 | L | high | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 355 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 356 | PAN-2836 | M | high | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 357 | PAN-2830 | M | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in |
| 358 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve |
| 359 | PAN-2650 | L | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it |
| 360 | PAN-2549 | M | high | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 361 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 362 | PAN-2334 | XS | high | ok |  |  | write a Definition of Ready (DoR) |
| 363 | PAN-2308 | M | high | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal… |
| 364 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree |
| 365 | PAN-1984 | XS | high | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 366 | PAN-1913 | XS | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 367 | PAN-1906 | M | high | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 368 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 369 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 370 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 371 | PAN-807 | L | high | ok |  |  | Epic C: Workspace state sanity on spawn |
| 372 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 373 | PAN-3826 | S | high | ok |  |  | Conversation view freezes until refresh: Claude JSONL watcher has no missed-event safety net. Fix exists on a branch |
| 374 | PAN-3853 | M | high | needs-refinement |  | PAN-3917 | Review synthesizer self-declared an operator override and flipped an approved HEAD. Override door goes with the Cut |
| 375 | PAN-471 | M | high | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 376 | PAN-438 | M | high | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 377 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 378 | PAN-176 | M | high | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 379 | PAN-578 | M | high | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 380 | PAN-3881 | M | high | ok |  |  | pan sync distributes from a stale primary checkout and never removes deleted sources, resurrecting deleted subagent defs |
| 381 | PAN-3864 | M | high | needs-refinement |  | PAN-3917 | Stale strike agents flood /agents (183 STRIKE RUNNING). The Cut makes the Herdr workspace the issue tree; re-scope |
| 382 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 383 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep |
| 384 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 385 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run |
| 386 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 387 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik… |
| 388 | PAN-2739 | S | medium | ok |  |  | first-completion detection throws every patrol cycle |
| 389 | PAN-2738 | S | medium | ok |  |  | strikes deadlock |
| 390 | PAN-2717 | S | medium | ok |  |  | conversation permission waits missing from Awareness; strengthen alert pulse |
| 391 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 392 | PAN-2696 | XS | medium | ok |  |  | Task views still speak beads vocabulary |
| 393 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) |
| 394 | PAN-2686 | XS | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 395 | PAN-3701 | L | high | ok |  |  | Four separate first-party LLM client stacks; consolidate onto effect/unstable/ai LanguageModel + ExecutionPlan. PRD written. |
| 396 | PAN-3090 | M | high | ok |  |  | Simple issue page opens with a 55KB raw kickoff prompt and hides the pending question the operator actually has to answer. |
| 397 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 398 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck |
| 399 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 400 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 401 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 402 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 403 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations |
| 404 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 405 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 406 | PAN-2560 | M | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key |
| 407 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL |
| 408 | PAN-2550 | XS | medium | ok |  |  | npm test exits 0 despite root-suite failures |
| 409 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds |
| 410 | PAN-2546 | S | medium | ok |  |  | pan tell is codex-conversation-unaware |
| 411 | PAN-2506 | M | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 412 | PAN-3504 | XS | high | needs-refinement |  |  | Duplicate of PAN-3499 (parked.ts ProjectConfig.projectPath typecheck red on main); confirm landed and close one of the pair. |
| 413 | PAN-3181 | L | high | ok |  |  | Agent memories are harness-owned, machine-local and keyed by path; move them to a per-repo overdeck-memory orphan branch. |
| 414 | PAN-3003 | XS | medium | ok |  |  | Generated launcher.sh files omit the OVERDECK_AGENT_ID export the PTY supervisor requires, so manual re-launch dies instantly. |
| 415 | PAN-2501 | S | medium | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 416 | PAN-2492 | S | medium | needs-refinement |  |  | pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard |
| 417 | PAN-2491 | M | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 418 | PAN-2489 | S | medium | ok |  |  | strike agents are invisible in the project issue tree |
| 419 | PAN-2484 | S | medium | ok |  |  | ready set misses merge-eligible issues without flywheel merge verbs |
| 420 | PAN-2465 | S | medium | ok |  |  | pan done's PR lookup fails at MYN polyrepo root |
| 421 | PAN-2454 | S | medium | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero |
| 422 | PAN-2428 | XS | medium | ok |  |  | MYN workspace Traefik routing broken post-rebrand |
| 423 | PAN-2423 | XS | medium | ok |  |  | pan workspace rebuild hardcodes 'overdeck-' compose project prefix |
| 424 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen |
| 425 | PAN-2414 | S | medium | ok |  |  | context-overflow recovery is inconsistent |
| 426 | PAN-2408 | S | medium | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree |
| 427 | PAN-2395 | S | medium | ok |  |  | one invalid tiered_execution enum poisons every config read |
| 428 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream |
| 429 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice |
| 430 | PAN-3661 | XS | medium | ok |  |  | Secure review-mode dispatch dropped the HTTP-200 semantic-rejection surface; two frontend tests fail locally while CI stays green. |
| 431 | PAN-3288 | XS | medium | ok |  |  | Dev-checkout preflight: after a git pull that adds a dep, the CLI dies with ERR_MODULE_NOT_FOUND instead of saying 'run bun install'. |
| 432 | PAN-3164 | XS | medium | ok |  |  | probeUatStack reports readiness from container count, so the UI offers 'Open UAT frontend' while the API is still resolving Maven deps. |
| 433 | PAN-3121 | S | medium | ok |  |  | The failed-send outbox never reconciles against the transcript, so a delivered message keeps a Retry twin that would double-send. |
| 434 | PAN-3014 | XS | medium | ok |  |  | Background title/about spawns use --bare, which now skips credential reads, so every one fails 'Not logged in' with empty stderr. |
| 435 | PAN-3833 | S | medium | ok |  |  | Feed renders assistant text after tool calls as thinking rows; operator concludes the agent never answered |
| 436 | PAN-3901 | S | medium | ok |  |  | test-skip gate has no audited exemption for opt-in live suites (skipIf on env/binary); three suites on main cannot move |
| 437 | PAN-3915 | S | medium | ok |  |  | A unit test writes a real transcript under ~/.claude; watcher indexes the deleted file and ENOENT sticks in health |
| 438 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed |
| 439 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) |
| 440 | PAN-2186 | S | medium | ok |  |  | post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 441 | PAN-2069 | XS | medium | ok |  |  | caveman: follow-up gaps |
| 442 | PAN-1918 | XS | medium | ok |  |  | full frontend vitest suite runs in no CI path |
| 443 | PAN-1912 | XS | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 444 | PAN-1846 | S | medium | ok |  |  | unbounded log growth |
| 445 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY |
| 446 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry |
| 447 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main |
| 448 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 449 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil… |
| 450 | PAN-1761 | S | medium | ok |  |  | conversations endpoints fetched via relative /api path |
| 451 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 452 | PAN-3516 | XS | medium | ok |  |  | Repo .claude/skills holds stale duplicates of pan-handoff, pan-flywheel and okf, so overdeck-dev sessions load outdated skill text. |
| 453 | PAN-3455 | XS | medium | ok |  |  | cliproxy --version exits 2, so the up-to-date check always returns false and every ensure re-downloads the pinned release. |
| 454 | PAN-3117 | XS | medium | ok |  |  | A deterministic 400 renders as the generic 'Failed to send' bubble with a Retry that can never succeed. |
| 455 | PAN-3036 | XS | medium | ok |  |  | Pane-idle detection reads a completed strike's idle composer as a pending question, so a finished strike shows '! INPUT'. |
| 456 | PAN-3016 | M | medium | ok |  |  | Operator ask: every view should be URL-addressable; cockpit tabs, stage panes and several drawers are still local state. |
| 457 | PAN-3855 | S | medium | ok |  |  | pan start reuses the old agent's recorded model after pan reset-session; retuned tiers never apply without --fresh |
| 458 | PAN-3890 | M | medium | ok |  |  | opencode provider stream error (rate limit) is invisible in the feed and never retried; first message dies silently |
| 459 | PAN-1740 | XS | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 460 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace |
| 461 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 462 | PAN-1669 | S | medium | ok |  |  | restart-with-model doesn't emit a live event |
| 463 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness |
| 464 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr… |
| 465 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted |
| 466 | PAN-3903 | L | medium | needs-refinement |  | PAN-3917 | Route 93 review_status readers through IssuesResolver. The Cut (PAN-3917) deletes the state layer this targets; close or re-scope |
| 467 | PAN-3862 | L | medium | needs-refinement |  | PAN-3917, PAN-3861 | /agents-v2 machine session explorer for Herdr and tmux servers. Re-scoped under the Cut; depends on the backend contract |
| 468 | PAN-1572 | M | medium | ok |  |  | Settings permission-mode can desync from resolved config |
| 469 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted |
| 470 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 471 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 472 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 473 | PAN-1449 | S | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 474 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 475 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 476 | PAN-3616 | S | medium | ok |  |  | Planned deploy restarts show the alarm-toned Reconnecting banner; use the lifecycle signal for calm 'updating' copy. |
| 477 | PAN-3157 | XS | medium | ok |  |  | The Flywheel renders in the Awareness feed as a generic 'Claude Code / No messages yet' chat row despite emitting a snapshot every tick. |
| 478 | PAN-2982 | XS | medium | ok |  |  | Nothing runs a skill's own selftest when sync-sources/skills/** changes; a convoy passed a PR with its selftest red. |
| 479 | PAN-2981 | S | medium | ok |  |  | The conversation search index never prunes deleted sessions, so Ctrl-K offers zombie hits that 404 on open. |
| 480 | PAN-2976 | L | medium | ok |  |  | Generalize the ACP harness to any capability-passing ACP CLI: named adapters plus a config-declared custom-agent escape hatch. |
| 481 | PAN-3829 | L | medium | needs-refinement |  | PAN-3783 | Managed Claude launch home overlay (tag handoff/20260909/main). Operator must decide direction before planning |
| 482 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 483 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 484 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 485 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 486 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 487 | PAN-1392 | S | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 488 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots |
| 489 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions |
| 490 | PAN-1245 | M | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 491 | PAN-1244 | M | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 492 | PAN-1240 | S | medium | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 493 | PAN-1227 | S | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work |
| 494 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign |
| 495 | PAN-3705 | XS | medium | ok |  |  | Ctrl-K: add Conversations as a first-class entry in the type list |
| 496 | PAN-1173 | S | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 497 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders |
| 498 | PAN-3540 | M | medium | ok |  |  | God View shows phantom agent orbs from state rows with no live session, a dead Hook Bus panel, and a pressure-blind swap header. |
| 499 | PAN-3354 | XS | medium | ok |  |  | The archive write door accepts kind=main, hiding a project's singleton workspace with no unarchive affordance in the UI. |
| 500 | PAN-3321 | XS | medium | needs-refinement |  |  | Escalation text and CLAUDE.md advertise 'pan unstick', which errored as unknown; re-verify against the current CLI before picking up. |
| 501 | PAN-3178 | XL | medium | ok |  |  | Make worktrees and diffs first class: +/- badge, dedicated Changes surface, conversation worktrees. PRD and mockup exist. |
| 502 | PAN-3017 | S | medium | ok |  |  | The issue-page UAT panel renders only inline actions, so restart/rebuild/stop are unreachable outside the rail's context menu. |
| 503 | PAN-3837 | S | medium | needs-refinement |  | PAN-3917 | Auto-handoff spawn dies on record lock contention, leaves a starting placeholder. Lock goes with the Cut; item 3 survives |
| 504 | PAN-1150 | S | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 505 | PAN-1149 | S | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 506 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 507 | PAN-1129 | S | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 508 | PAN-1128 | S | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 509 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 510 | PAN-1068 | S | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 511 | PAN-1027 | S | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 512 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 513 | PAN-932 | S | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 514 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 515 | PAN-900 | S | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 516 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 517 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 518 | PAN-727 | M | medium | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 519 | PAN-681 | S | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 520 | PAN-3732 | S | medium | ok |  |  | Codex handoff serializes a large rollout twice (~286MB peak RSS on 50MB); serialize once or stream. |
| 521 | PAN-3700 | M | medium | ok |  |  | pan acp serve would let Zed and other ACP clients drive Overdeck conversations through canonical doors. PRD written. |
| 522 | PAN-3290 | XS | medium | ok |  |  | xBRIEF items can carry empty metadata.traces, so docs items sit unanchored in the requirement traceability graph. |
| 523 | PAN-3132 | M | medium | ok |  |  | xBRIEF v0.9 agentic dispatch fields are half-adopted as a behavior accident; make difficulty/filesScope/verifyCommands a contract. |
| 524 | PAN-3827 | S | medium | ok |  |  | Dashboard shows the empty welcome state instead of an error when the harness exits before writing a transcript |
| 525 | PAN-3893 | M | medium | ok |  |  | ACP conversations drop agent thoughts: no agent_thought_chunk case and no thought role in the ACP transcript schema |
| 526 | PAN-3863 | XL | medium | needs-refinement |  | PAN-3917, PAN-3762 | Orca-style SSH Hosts and Remote Servers onboarding; extension of PAN-3762 federation, re-scoped under the Cut |
| 527 | PAN-538 | S | medium | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 528 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection |
| 529 | PAN-324 | XS | medium | stale |  |  | Agent detail pane missing Merge/Approve button |
| 530 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 531 | PAN-247 | S | medium | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 532 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 533 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 534 | PAN-178 | M | medium | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 535 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 536 | PAN-49 | XS | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 537 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 538 | PAN-1041 | M | medium | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 539 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 540 | PAN-3770 | S | medium | ok |  |  | Codex conversations never show the working spinner mid-turn; parser marks every agent_message instantly complete. |
| 541 | PAN-3731 | S | medium | ok |  |  | Restart-gate banner gives no feedback after approval; dead-requester approvals read as a broken button. |
| 542 | PAN-3530 | S | medium | ok |  |  | Four God View components poll on 30s timers instead of the documented /ws/rpc event contract. |
| 543 | PAN-3131 | L | medium | ok |  |  | Support xBRIEF planRef sharding so a 1.1MB/227-item plan stops making every finalize failure whole-plan-fatal. |
| 544 | PAN-3061 | M | medium | ok |  |  | Deterministic start-vs-swarm recommendation at plan-finalize, derived from plan shape plus recorded outcomes. |
| 545 | PAN-3057 | S | medium | needs-refinement |  |  | Harness-initiated compaction idled six agents and GPT-5.6's window was declared twice; both fixes appear landed — verify and close. |
| 546 | PAN-3843 | S | medium | needs-refinement |  | PAN-3917 | Green-CI reconciler marks testStatus passed while uatStatus is failed. The Cut (PAN-3917) deletes the state layer this targets |
| 547 | PAN-3867 | S | medium | ok |  |  | /projects/new discards keystrokes typed before the first resolve lands (3 of 5 attempts under load) |
| 548 | PAN-3873 | L | medium | ok |  |  | GitHub event delivery: support smee and gh webhook forward transports with guided install, settings and docs |
| 549 | PAN-3822 | L | medium | ok |  |  | Link pull requests to conversations via branch detection plus explicit link/unlink override; show PR state on rows |
| 550 | PAN-863 | M | medium | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 551 | PAN-817 | M | medium | ok |  |  | Improve planning dialog layout and content fit |
| 552 | PAN-802 | M | medium | ok |  |  | Resume on conversation session forks instead of resuming |
| 553 | PAN-713 | M | medium | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 554 | PAN-700 | M | medium | ok |  |  | Detachable terminal for conversation view |
| 555 | PAN-646 | XS | medium | ok |  |  | Canceled issues: add guided Recover workflow |
| 556 | PAN-532 | M | medium | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 557 | PAN-2896 | M | medium | ok |  |  | Warm resource-discovery and membership caches at boot |
| 558 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 559 | PAN-2626 | M | medium | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 560 | PAN-2625 | XS | medium | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 561 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 562 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations |
| 563 | PAN-2582 | M | medium | ok |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 564 | PAN-2566 | L | medium | ok | ✓ |  | Triage list of genuine Traycer capability gaps; a container for child issues, not directly workable. |
| 565 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 566 | PAN-3735 | S | medium | ok |  |  | Sandboxed pan CLI reports 'dashboard down, run pan up' when the real cause is no network; sends agents down the wrong path. |
| 567 | PAN-3335 | XS | medium | ok |  |  | A pasted screenshot can't be viewed anywhere in the dashboard: thumbnail has no click handler and the sent form is a file-link chip. |
| 568 | PAN-3054 | M | medium | ok |  |  | Benchmark matrix: run one template issue under N crew/model configurations and compare cost, wall-clock and outcome. |
| 569 | PAN-2977 | M | medium | ok |  | PAN-2976 | Settings surface that detects installed ACP CLIs, renders the capability checklist, and guides login without a manual terminal. |
| 570 | PAN-3835 | M | medium | ok |  |  | Attach the native Codex TUI to a running app-server thread (codex resume --remote); validate concurrent attach first |
| 571 | PAN-3831 | M | medium | ok |  |  | Model picker: gray out models whose provider has no API key or subscription login, via one server-side readiness door |
| 572 | PAN-2558 | L | medium | ok |  |  | support polyrepo projects |
| 573 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action |
| 574 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility |
| 575 | PAN-2548 | XS | medium | ok |  |  | close the PAN-2541 legacy-fallback deprecation window |
| 576 | PAN-2521 | S | medium | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 577 | PAN-2493 | M | medium | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 578 | PAN-3772 | XS | medium | ok |  |  | Conv view renders Claude Code's synthetic 'no visible output' nudge as an operator message; should read as plumbing. |
| 579 | PAN-3895 | M | medium | needs-refinement |  | PAN-3917, PAN-3896 | Delete 30 pending repairer patrols after a 7-day soak. The Cut deletes all Deacon patrols outright; close when it lands |
| 580 | PAN-3892 | M | medium | needs-refinement |  | PAN-3917 | Substrate review follow-ups from PAN-3845: several items target record-update/pan-dir code the Cut deletes; re-triage |
| 581 | PAN-2444 | L | medium | ok |  |  | optional SageOx re-integration |
| 582 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv |
| 583 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane |
| 584 | PAN-2409 | M | medium | ok |  |  | enforce the workspace boundary |
| 585 | PAN-2399 | M | medium | ok |  |  | wire replay_threshold/compaction_reroute into the slot-recovery respawn seam |
| 586 | PAN-2392 | M | medium | ok |  |  | Standing Crew cost panel |
| 587 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues |
| 588 | PAN-2295 | L | medium | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 589 | PAN-3767 | S | medium | ok |  |  | Model switch could hang at 'Saving…'; onError toast landed, remaining work is reproducing the hang on a healthy server. |
| 590 | PAN-3615 | S | medium | needs-refinement |  |  | TTS silent 9+ days from four stacked failures; three already fixed, only follow-ups remain — rescope to what is left. |
| 591 | PAN-3558 | S | medium | ok |  |  | Subagent rail shows no model or provider, so mixed-model orchestration needs a transcript open per row to see what it is running. |
| 592 | PAN-3469 | S | medium | ok |  |  | NewProjectModal violates the PAN-3410 page-not-modal doctrine; migrate the create-project flow to a routed page. |
| 593 | PAN-3333 | M | medium | ok |  |  | Model pickers show $/1M, which says nothing under a subscription; show relative plan-quota drain among sibling models. |
| 594 | PAN-3058 | M | medium | ok |  |  | Ship named crew presets that populate the whole tiered_execution block so operators don't hand-build the crew table. |
| 595 | PAN-3852 | S | medium | ok |  |  | Project creation follow-ups: SSH-port repo URLs, dotted repo names, partial-registration retry, non-409 error mapping |
| 596 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call |
| 597 | PAN-2065 | M | medium | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 598 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 599 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 600 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 601 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 602 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 603 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 604 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 605 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 606 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 607 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 608 | PAN-2024 | XS | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 609 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 610 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 611 | PAN-3739 | S | medium | ok |  |  | cost-reconcile re-warns every model-less codex subthread rollout on every sweep; log flood grows without bound. |
| 612 | PAN-3830 | M | medium | ok |  |  | OpenCode provider: curate picker models via Settings favorites (OpenRouter pattern) instead of listing every model |
| 613 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 614 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 615 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 616 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 617 | PAN-3684 | XS | medium | ok |  | PAN-1641 | Temporary acceptance issue: spawn a Pi work agent on ollama:gemma4:12b and record evidence |
| 618 | PAN-1937 | M | medium | ok |  |  | feat: data export |
| 619 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 620 | PAN-1916 | M | medium | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 621 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 622 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 623 | PAN-1852 | XS | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 624 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 625 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' |
| 626 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 627 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 628 | PAN-3706 | L | medium | ok |  |  | Broadsheet shipped typography only; color, surface, elevation and texture still on Ledger values, so it doesn't read like Subspace. |
| 629 | PAN-3539 | XS | medium | needs-refinement |  |  | OOMPolicy=continue fix landed with the issue; re-scope to whatever hardening remains or close it out. |
| 630 | PAN-3502 | XS | medium | needs-refinement |  |  | tiered-crews blendedCost expectation stale vs pricing catalog; likely already fixed by the PAN-3532 cherry-pick — verify. |
| 631 | PAN-3499 | XS | medium | needs-refinement |  |  | Same one-line ProjectConfig.path fix as PAN-3504; confirm it landed on main and close the duplicate. |
| 632 | PAN-2978 | S | medium | ok |  | PAN-2976, PAN-2977 | Opt-in per-agent install recipes for ACP CLIs from the setup UI; deliberately separated for its supply-chain trust decision. |
| 633 | PAN-3896 | S | medium | needs-refinement |  | PAN-3917 | Would-fire counters count no-op reads and exhaust budgets. The Cut (PAN-3917) deletes the state layer this targets (patrols go) |
| 634 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 635 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 636 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent |
| 637 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 638 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 639 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate |
| 640 | PAN-1685 | XS | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 641 | PAN-1676 | M | medium | ok |  |  | harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 642 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 643 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 644 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 645 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 646 | PAN-1654 | XS | medium | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 647 | PAN-1653 | XS | medium | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 648 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 649 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 650 | PAN-1550 | M | medium | ok |  |  | feat: FilesPane + BrowserPane |
| 651 | PAN-1545 | XS | medium | ok |  |  | New Terminal button |
| 652 | PAN-1542 | XS | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 653 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 654 | PAN-1497 | M | medium | ok |  |  | emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 655 | PAN-1490 | M | medium | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 656 | PAN-1489 | M | medium | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 657 | PAN-1485 | M | medium | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 658 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 659 | PAN-1443 | M | medium | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 660 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 661 | PAN-1437 | M | medium | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 662 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale |
| 663 | PAN-1223 | M | medium | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 664 | PAN-1165 | M | medium | ok |  |  | Lightweight review path for small/trivial PRs |
| 665 | PAN-3912 | XS | medium | ok |  |  | pan restart accepts a stray positional (pan restart status) and files a real restart request; reject excess args |
| 666 | PAN-3914 | S | medium | needs-refinement |  | PAN-3917 | checkOrphanedCompletions looped 9x despite its tombstone. The Cut (PAN-3917) deletes the state layer this targets (patrol + record) |
| 667 | PAN-1151 | XS | medium | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 668 | PAN-1060 | M | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 669 | PAN-1051 | M | medium | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 670 | PAN-1037 | M | medium | ok |  |  | Retire 'planning-' tmux prefix |
| 671 | PAN-958 | M | medium | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 672 | PAN-949 | M | medium | ok |  |  | feat: add conversation for project from sidebar |
| 673 | PAN-947 | M | medium | ok |  |  | feat: project management actions in unified sidebar |
| 674 | PAN-938 | M | medium | ok |  |  | Fizzy visual pipeline |
| 675 | PAN-903 | M | medium | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 676 | PAN-902 | XS | medium | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 677 | PAN-901 | XS | medium | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 678 | PAN-818 | M | medium | ok |  |  | Make summary optional when forking conversations |
| 679 | PAN-736 | M | medium | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 680 | PAN-709 | M | medium | ok |  |  | self-improving flywheel |
| 681 | PAN-3322 | XS | medium | ok |  |  | launcher-generator.ts's file-size ceiling sits 126 lines above the real file, handing back the regrowth the ratchet exists to prevent. |
| 682 | PAN-678 | M | medium | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 683 | PAN-675 | M | medium | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 684 | PAN-654 | L | medium | ok |  |  | Project Setup Wizard |
| 685 | PAN-649 | M | medium | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 686 | PAN-637 | XS | medium | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 687 | PAN-629 | M | medium | ok |  |  | Workspace quotas and resource governance |
| 688 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents |
| 689 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 690 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 691 | PAN-548 | M | medium | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 692 | PAN-546 | M | medium | ok |  |  | Remove claude-code-router |
| 693 | PAN-537 | M | medium | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 694 | PAN-531 | XS | medium | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 695 | PAN-452 | M | medium | ok |  |  | Conversation input bar |
| 696 | PAN-450 | M | medium | ok |  |  | Adopt remaining Effect patterns |
| 697 | PAN-294 | M | medium | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 698 | PAN-293 | M | medium | stale |  |  | Project Living Memory |
| 699 | PAN-277 | M | medium | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 700 | PAN-258 | M | medium | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 701 | PAN-255 | M | medium | stale |  |  | Agents lack awareness of MCP tools |
| 702 | PAN-252 | XS | medium | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 703 | PAN-243 | M | medium | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 704 | PAN-77 | XS | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 705 | PAN-54 | L | medium | stale |  |  | e2e command for full workflow integration test |
| 706 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 707 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 708 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 709 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 710 | PAN-3441 | L | low | ok |  |  | God View 'River' WebGL pipeline visualization fed by the live hook-event stream; PRD and mockup exist. |
| 711 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 712 | PAN-2941 | M | low | ok |  |  | OKF v3 |
| 713 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 714 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 715 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 |
| 716 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 717 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 718 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 719 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 720 | PAN-2635 | XS | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 721 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 722 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 723 | PAN-3443 | L | low | ok |  |  | God View 'Spectrum Deck' visualizer concept with mockup and PRD; pure exploration, no substrate impact. |
| 724 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 725 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file |
| 726 | PAN-2600 | XS | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) |
| 727 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 728 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 729 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector |
| 730 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 731 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 732 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 733 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 734 | PAN-2424 | L | low | ok | ✓ |  | Epic: the Order Book |
| 735 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree … |
| 736 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 737 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 738 | PAN-2356 | M | low | needs-refinement |  |  | Overdeck Anywhere P3: relay service |
| 739 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 740 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 741 | PAN-2352 | M | low | needs-refinement |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 742 | PAN-2353 | M | low | needs-refinement |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 743 | PAN-3133 | S | low | ok |  |  | Evaluation spike for TRON encoding of prompt-bound xBRIEF payloads; savings are modest today since agents get a bounded slice. |
| 744 | PAN-3011 | M | low | ok |  | PAN-1641, PAN-465 | Add poolside Laguna S 2.1 as a model target; the honest hardware note says it will not fit this machine's GPU. |
| 745 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations |
| 746 | PAN-2091 | XS | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 747 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 748 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 749 | PAN-2083 | M | low | ok |  | PAN-1592 | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 750 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 751 | PAN-2074 | XS | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 752 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 753 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 754 | PAN-3868 | XS | low | needs-refinement |  | PAN-3917 | Stop hook nudges with a non-existent verb (pan work done). The Cut deletes the work-agent stop hook; close when it lands |
| 755 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast |
| 756 | PAN-2002 | XS | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 757 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 758 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 759 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 760 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 761 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 762 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 763 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 764 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every… |
| 765 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 766 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 767 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout |
| 768 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 769 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 770 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 771 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 772 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 773 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 774 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 775 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 776 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 777 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 778 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 779 | PAN-3919 | S | low | needs-refinement |  |  | Review the universal reasoning-effort default. Operator decision, not agent work; filing does not authorize a change |
| 780 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 781 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 782 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 783 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 784 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 785 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' |
| 786 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence |
| 787 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 788 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 789 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 790 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces |
| 791 | PAN-1123 | XS | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 792 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 793 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 794 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 795 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 796 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 797 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 798 | PAN-3768 | XS | low | ok |  |  | pan handoff --title already implemented and landed (678f6b389e5); open only pending close-out. |
| 799 | PAN-3034 | XS | low | ok |  |  | Fix already landed on main (strike/slot workspace names and live tmux now seed the session tree); open pending close-out. |
| 800 | PAN-2983 | M | low | ok |  |  | OKF v3 deferrals: lease-based concurrent writes and an LLM semantic auditor, both gated on evidence that isn't here yet. |
| 801 | PAN-3778 | S | low | ok |  |  | Reconnect-loop fix (48fd8f7a) is already on main; open only pending verify and close-out. |
| 802 | PAN-3824 | S | low | needs-refinement |  |  | Screenshot only: default view on Windows breaks the model selector. Needs repro steps, browser and build |
| 803 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 804 | PAN-984 | XS | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 805 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 806 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 807 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 808 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 809 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 810 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 811 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 812 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 813 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 814 | PAN-810 | XS | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 815 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 816 | PAN-793 | XS | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 817 | PAN-791 | XS | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 818 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling |
| 819 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 820 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 821 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 822 | PAN-3456 | XS | low | ok |  |  | Already fixed in 4117c9a777 with a regression test; open only pending close-out. |
| 823 | PAN-3823 | S | low | needs-refinement |  |  | Screenshot only: "pan sync issue". No error text, command or expected result; needs a written repro |
| 824 | PAN-774 | XS | low | ok |  |  | Unify launch UX and release pipeline for 1.0 |
| 825 | PAN-773 | XS | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 826 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 827 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 828 | PAN-769 | M | low | ok |  | PAN-750 | Track verification/review/test phase churn over time |
| 829 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 830 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 831 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 832 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 833 | PAN-751 | M | low | ok |  |  | Historical Metrics Data Persistence |
| 834 | PAN-750 | L | low | ok |  |  | Complete Metrics Page Redesign |
| 835 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 836 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 837 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 838 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 839 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 840 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 841 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 842 | PAN-701 | XS | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 843 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 844 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 845 | PAN-658 | M | low | ok |  | PAN-2356 | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 846 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 847 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 848 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 849 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 850 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 851 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 852 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 853 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 854 | PAN-571 | XS | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 855 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 856 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 857 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly |
| 858 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 859 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 860 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX |
| 861 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 862 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 863 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database |
| 864 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 865 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 866 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 867 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 868 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 869 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 870 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 871 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 872 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 873 | PAN-249 | XS | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 874 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 875 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics |
| 876 | PAN-227 | M | low | stale |  |  | Phase gate validation |
| 877 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 878 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 879 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 880 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 881 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 882 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 883 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 884 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 885 | PAN-52 | XS | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 886 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 887 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 888 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 889 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 890 | PAN-2348 | XS | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 891 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md |
| 892 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md |
| 893 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md |
| 894 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md |
| 895 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md |
| 896 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 897 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 898 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 899 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 900 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 901 | PAN-1684 | XS | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 902 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 903 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc |
| 904 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 905 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 906 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 907 | PAN-633 | M | low | ok |  |  | Update Cloister PRD and docs index |
| 908 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |

## Rationale detail

### PAN-3917 (rank 1)

The Cut is the structural decision the rest of this backlog now hangs on: the overdeck-state data plane, per-issue records, SQLite mirror tables, the per-item inspection gate and the sixty Deacon patrols are deleted, and state becomes what the tracker, the repo and the live sessions say. Labeled architecture, so it carries the substrate floor (critical). It is an epic container with a planned PRD and a one-day parallel cut already under way; it is never picked directly, but every issue that targets record-plane machinery (PAN-3903, PAN-3895, PAN-3896, PAN-3914, PAN-3898, PAN-3909, PAN-3837, PAN-3843, PAN-3853, PAN-3868) is held behind it and re-scoped or closed once it lands. It explicitly re-scopes PAN-3861, PAN-3862, PAN-3863, PAN-3864, PAN-3762 and PAN-2350 under the new core.

### PAN-3679 (rank 2)

Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-2746 (rank 3)

Highest integrity risk — infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; nearly merged a pipeline-critical change unreviewed.

### PAN-2689 (rank 4)

Sandboxed codex review verdicts fire-and-forget into a journal that loses them; review convoy reports green on evidence never delivered.

### PAN-3566 (rank 5)

New this pass and the highest-leverage fix in the batch: the test-role launcher's final exec has no -p, no positional prompt and no piped stdin, so the role boots an interactive REPL and never takes a turn. That single missing argument is the deterministic producer of the zombie test agents tracked in PAN-2706, PAN-3563 and PAN-3274 — three separate hardening issues chasing one root cause. Reproduced across eight session IDs, so there is no diagnosis left to do.

### PAN-3285 (rank 6)

New this pass, labelled critical. A supervisor unit pinned to a pan reload generation SIGTERMs every correctly-running dashboard and is structurally incapable of starting a replacement; the observed outcome was a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and no operator escalation. Manual recovery also fails, because the supervisor kills the operator's dashboard within 30 seconds. Nothing else in the backlog can take the whole product down for hours with the recovery path itself broken.

### PAN-3761 (rank 7)

New this pass and operator-hit. The durable review status keeps satisfying needsReviewDispatch after review and test have genuinely passed, so a host-side re-dispatch fires every ~30 seconds and the UAT reconciler keeps yanking the issue out of the ready set. The net effect is a ready badge everywhere and a train nowhere, which blocks the merge path for every issue that reaches this state.

### PAN-3685 (rank 8)

Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3561 (rank 9)

New this pass. Stale-lock recovery keys entirely on isPidDead(owner.pid), so a writer that crashes between mkdir and writing owner.json leaves a lock no breaker can ever fire on. It bricked every canonical-state write for the mind-your-now project for 2.5 days across five issues, and there is no TTL and no recovery CLI. An unbreakable lock on the single write door is as bad as the write door not existing.

### PAN-3524 (rank 10)

New this pass, filed P0. A server-owned --changed verification loop relaunched continuously through a global deacon freeze, a review abort, an issue pause and an operator stop — every documented suppression gate, applied and confirmed, and the loop kept respawning up to 78 concurrent vitest workers. It blocked a red-main fix from reaching its test gate across four attempts. A runaway the operator cannot stop is a category above an ordinary resource bug.

### PAN-3283 (rank 11)

New this pass and labelled blocks-main. Recovering an issue from review_infrastructure_failure flips review_status to passed and ready_for_merge to 1 even when the newest artifact on disk is a CHANGES REQUESTED verdict, verified on two issues that were sitting in a UAT batch at the time. This is the same verdict-integrity family as PAN-2746 and PAN-2689 at the top of the list: unreviewed work presented as reviewed is the one failure that defeats the entire review pipeline.

### PAN-3250 (rank 12)

New this pass, labelled blocks-main and substrate. Two spawn sites branch from the local HEAD or defaultBranch instead of origin/main, so every new feature branch inherits whatever unpushed commits are sitting on the shared local main. Four branches were already contaminated when it was filed, two of them created after the problem was identified, and their PRs read MERGEABLE/CLEAN. It spreads with each spawn, so the cost of leaving it grows.

### PAN-2954 (rank 13)

Dependency cleared: PAN-2882 (the missing GitLab merged-MR oracle this blocked on) closed since the last pass, so postMergeLifecycle's GitLab refusal is now directly workable. Re-ranked up from 67 to sit with the other unblocked critical merge-path fixes.

### PAN-3657 (rank 14)

New this pass. The merge-train queues endpoint correctly gathers eligible candidates and then hands them to the monorepo queue builder, which does git rev-parse against a polyrepo project root that is not a git repository — so every polyrepo project's train is permanently empty while monorepo projects populate fine. MYN and Auricle cannot use merge trains at all until this lands.

### PAN-3631 (rank 15)

New this pass and directly observable in this run. The sequencer reads its prior from the legacy project-local .pan/backlog/sequence.md while pan backlog write-sequence persists only to overdeck-state, so nothing writes the legacy copy any more and every incremental pass is handed the same frozen document. This pass's own prior is dated 2026-07-21 for exactly that reason. Until it is fixed, incremental passes silently lose all intervening work.

### PAN-3565 (rank 16)

New this pass. Three review-lifecycle defects, one of them severe: when all four reviewer lanes died at spawn on a record lock, the supervisor wrote a synthesis declaring CHANGES REQUESTED with every lane marked failed — an infrastructure flake recorded as a real code verdict. It was caught only because a human was watching live. Same integrity family as PAN-3283 and PAN-2746.

### PAN-3564 (rank 17)

New this pass. Record writes take the per-issue lock and then block on the global state-git lock while holding it, so a contended global lock pins every per-issue lock in the queue — a textbook convoy, observed at 100% duty cycle across 240 seconds of sampling. All four reviewer lanes died at spawn because the reviewer lifecycle signal acquires that lock with no retry or backoff. It cascaded across five issues simultaneously.

### PAN-3554 (rank 18)

New this pass. Main stayed red for about five hours because nothing owns the state 'the latest main-push CI run failed' — no needs-you, no activity entry, no strike recommendation. The failure actively hides itself: the merge gate renders red main as an empty eligible set, so the operator sees a quiet queue rather than an alarm. Detection must not depend on the flywheel being awake, since it frequently is not.

### PAN-3532 (rank 19)

New this pass. The CI test job runs root npm test, whose frontend leg is a hand-picked list of files, so two frontend test files were red on main for hours while every main CI run reported success. Green CI that does not mean green is worse than no CI, because every downstream gate and every close-out trusts it.

### PAN-3085 (rank 20)

New this pass and a one-line class of defect with outsized cost. Review feedback is written to the resolved .overdeck/feedback directory but the path handed to the work agent is a hardcoded .pan/feedback that no longer exists after the rebrand, and the deacon merge gate reads the same dead path. Agents are told to fix findings they cannot find, and the gate counts zero feedback files no matter how many exist.

### PAN-3682 (rank 21)

New this pass. Slot completion for a migrated polyrepo project derives a legacy workspace .pan/records path, git rejects it as outside the state worktree, and the retry path then runs from a wrapper root with no .git and dies. Completion is the moment durable evidence is written; a crash there loses the handoff and wedges the slot.

### PAN-3654 (rank 22)

New this pass. Compact respawn confirms the kickoff against the archived session rather than the fresh one, so a replacement session that had already accepted the recovery prompt and created four tasks was declared unconfirmed and killed. Recovery that destroys healthy work is worse than no recovery, and the orphan reconciler only noticed 40 seconds later.

### PAN-3653 (rank 23)

New this pass, labelled blocks-main. A strike that correctly stops because its gate is blocked by red main has no owner that wakes it when main goes green: the session stays alive, so liveness calls it healthy and pan recover refuses with 'already has a live harness runtime'. The urgent path exists precisely to unblock the pipeline fast, so a strike that silently idles through the clearing of its own blocker defeats the mechanism.

### PAN-3630 (rank 24)

New this pass. pan tell reported successful delivery three times to a live, heart-beating agent, moved all three messages into the read mailbox, and the agent's transcript shows it received none of them. The delivery door is the sanctioned way every part of the system talks to a running agent; a door that lies about delivery makes every downstream 'we told it' claim unreliable.

### PAN-3571 (rank 25)

New this pass. The Stop hook's completion-check timeout branch logs and exits 0, bypassing the UNCLEAR fallback every other failure mode takes, so a timed-out check emits no resolution at all: no nudge, no escalation, no deacon poke eligibility. hooks.log records 334 stranded turn-ends, and one agent sat idle 68 minutes mid-item with uncommitted edits in place.

### PAN-3563 (rank 26)

New this pass. A role agent whose prompt never delivered is left status=running with pid null, so pid-liveness patrols have nothing to check, the dispatcher refuses to re-dispatch, and pan unstick cannot see role agents at all. Manual recovery took three separate doors. PAN-3566 removes the most common producer; this issue is the reconciliation that should have caught it regardless.

### PAN-3805 (rank 27)

New this pass. pokeAgentWithEscalation() increments the ineffective counter before delivery and never rolls it back, so a thread-store conflict rejection can escalate a perfectly healthy Codex agent to a tier-3 idle-alive pause. Reproduced across three issues in one RUN-92 window. It is labelled substrate-improvement, it is not in the pipeline, and it actively removes working agents from the fleet — the highest-value pickable item in this pass.

### PAN-3560 (rank 28)

New this pass. Under concurrent review convoys the PTY supervisor returns 502 'input echo confirmation failed' fleet-wide, so no agent can be booted or re-booted and pipeline feedback delivery fails while load is high — confirmed across at least six unrelated agents in one hour. Delivery failing exactly when the pipeline is busiest is what turns a load spike into a stall.

### PAN-3520 (rank 29)

New this pass. The test gate records a real 'test failed' verdict for uniform 5000ms timeout signatures under host load, proven on multiple branches where the same files pass in isolation in about 19 seconds. Every false verdict costs a full rework cycle and another saturated re-test, so this is both a correctness and a cost fix. Retrying timeout-only failures in isolation before writing a verdict is the minimal change.

### PAN-3500 (rank 30)

New this pass. A review sub-role that had already written its report was resumed by a later message and edited seven tracked files, and pan start --fresh then auto-committed those reviewer-owned changes into the feature history during sync-main. Review isolation is currently prompt-level only; it has to be mechanical, because a contaminated branch is very hard to detect after the fact.

### PAN-3424 (rank 31)

New this pass. Two independent ways the state plane silently stops being durable: a non-fast-forward push on overdeck-state is only console.warned while legacy main has a full reconciliation owner, and drafts/ PRDs are never staged at all — 16 orphans, one two weeks old. Both had been accumulating unnoticed. Pairs with PAN-3651, which re-lands the reverted retry.

### PAN-3313 (rank 32)

New this pass. A transient upstream stream error benches CLIProxy's only auth entry, so every GPT-routed request returns 503 auth_unavailable until an internal cooldown lapses — 35 failures against 14 successes in one hour, with valid credentials throughout. The message reads as 'your credentials are gone' and sends the operator to re-authenticate, which fixes nothing. Every GPT-routed agent on the machine is affected at once.

### PAN-3282 (rank 33)

New this pass. Review agents terminate before writing their report across five issues and two projects, twice recurring after a successful recovery, leaving a verdict-shaped status with no artifact behind it and a stuck flag that blocks progress until someone restarts the reviewer by hand. This is the upstream condition PAN-3283 then converts into a false passed verdict.

### PAN-3281 (rank 34)

New this pass. An issue can hold ready_for_merge=1 and stuck=1/verification_stuck simultaneously, and the merge-ready flag wins on every surface consulted — so work with eight incomplete acceptance criteria was assembled into a UAT batch and recommended for promotion. The checklist gate exists to stop exactly this, and its verdict is being overridden by a stale flag.

### PAN-3248 (rank 35)

New this pass. pan reload performs the deploy but never clears pending-deploy.json, and both the verification runner and the worker supervisor defer while any deploy is queued — so a successful reload stops verification for every project until a patrol happens to notice the build is fresh. A cross-project stall caused by a successful operation is the kind of coupling worth removing early.

### PAN-3905 (rank 36)

Planner-created workspaces skip preTrustDirectorySync, so the first agent launched into them (foreman, slot, strike) hangs on Claude Code's trust prompt and dies with a bare ready-signal-timeout. That kills the pipeline lane for any planned issue and the failure message hides the cause. The fix is small and survives the Cut (trust every spawn path right before launch, surface the pane tail on timeout), so it ranks with the pipeline-breaking criticals.

### PAN-2695 (rank 37)

Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.

### PAN-2742 (rank 38)

Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.

### PAN-2706 (rank 39)

Rank preserved at 15. PAN-3566, filed since the last pass, found the deterministic producer of these ghost sessions: the test-role launcher execs claude with no user prompt, so the session boots an idle REPL and never takes a turn. This issue's own asks — spawnRun must not treat a never-started session as active, and dispatch must not mark testing without delivering a prompt — remain valid hardening on top of that fix.

### PAN-2700 (rank 40)

Stale .pan/test/result.json is consumed by the next cycle, insta-failing with the previous run verdict.

### PAN-2733 (rank 41)

substrate-bug-poller has never run — BOT_LOGIN is a git author string not a GitHub login; the auto-triage loop is inert.

### PAN-1560 (rank 42)

Re-review after a PR head moves never re-posts status, stranding otherwise-green PRs at BLOCKED.

### PAN-2769 (rank 43)

review_status rows are never reconciled when an issue closes, so closed issues keep advertising stale review state.

### PAN-2828 (rank 44)

pan done --strike structurally refuses every squash-merged strike — the landing path doctrine mandates is rejected by its own ancestry check.

### PAN-3580 (rank 45)

The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.

### PAN-3677 (rank 46)

Planning agents wedge after a background Explore task finishes; parent never consumes the result. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-2874 (rank 47)

Strike landing cannot merge: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback wedges on exited strike agents.

### PAN-2883 (rank 48)

Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ and cannot find strike/ PRs.

### PAN-2806 (rank 49)

Strike merge trigger registry splits across dashboard chunks, so the trigger is never registered in the chunk that runs it.

### PAN-2940 (rank 50)

Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.

### PAN-3708 (rank 51)

New this pass. pan strike dies at git worktree list --porcelain on a polyrepo wrapper root, which is not a git repository, so the urgent-strike escape hatch is simply unavailable for MYN-class projects. pan swarm already understands nested repos; strike must use the same project repository inventory. Duplicate of PAN-3040 — close one when this lands.

### PAN-3605 (rank 52)

New this pass and the only supply-chain finding in the batch. A stale node_modules made npx fall back to the registry, where the unscoped effect-language-service name is claimed by a third party, and npm installed and executed it non-interactively. The payload was benign this time; the name stays third-party-controlled, so a malicious patch release would run on any machine in the same state. The fix is small and the downside is unbounded.

### PAN-3569 (rank 53)

New this pass. A stale pending-post-merge.json deadlocks the deploy gate: the gate refuses agent-initiated restarts while any pending file exists, startup would discard it as stale but startup needs the restart the gate refuses, and the deacon patrol that would clear it was frozen. A 3.5-hour-old ghost file blocked every deploy indefinitely while the live dashboard ran a ten-hour-old build.

### PAN-3557 (rank 54)

New this pass. Post-merge label application has no retry, so a rate-limited 403 leaves a merged issue without its verifying-on-main label — and the verify-on-main phase enumerates by that label, which makes the issue invisible to the phase that owns it. Lifecycle reported 'completed' throughout, so nothing noticed for 45 minutes.

### PAN-3543 (rank 55)

New this pass. A completed-handoff agent owed rework after a blocked verdict cannot be started at all: pan start refuses and recommends --fresh, --fresh gives the identical refusal, and reset-session is refused too because the durable plane reconstructs the session pointer. The refusal message names an action the operator cannot take, which is the self-contradictory-deadlock family PAN-3526 opened.

### PAN-3522 (rank 56)

New this pass. Under a CPU storm the supervisor watchdog counted probe timeouts through a new generation's 138-second boot warm phase and killed it anyway, producing four restarts in ten minutes, racing spawns on port 3012, and a WATCHDOG GIVING UP. Each restart re-triggered docker stack rebuilds, feeding the storm. The probe budget has to know the difference between starved and starting.

### PAN-3783 (rank 57)

New this pass. This is the implementation of the PAN-3779 architecture decision: back out generated content from native instruction files, then deliver global, bundled-rule, project, workspace, role and briefing context explicitly per harness including resume. Today a machine-context header leads the combined output and agents misattribute bundled rules to the repo. Large and no-loss-sensitive, but it fixes context provenance for every agent the pipeline runs. In-pipeline and operator-authorized; the issue explicitly forbids a competing work agent.

### PAN-3314 (rank 58)

New this pass. Every agent pane is a child of one transient tmux-server unit, so agent memory is the unit's memory and systemd-oomd's kill decision is all-or-nothing: one hungry agent takes the entire fleet with it. That has now happened twice, the second time killing seven work agents, four strikes and a live review convoy. Blast-radius containment is a different fix from choosing a better victim.

### PAN-3278 (rank 59)

New this pass. A work agent finished, opened a PR and sat idle for two hours because review was never dispatched, while the auto-requeue machinery that exists for exactly this had 25 attempts available and fired none of them. The documented manual recovery worked immediately, so the gap is entirely in the automatic path.

### PAN-3244 (rank 60)

New this pass. Three gates compose into an unbounded cross-project hold: verification defers while any pending deploy exists, host-side review dispatch routes through verification, and the deploy queue is Overdeck's. A myn issue's review convoy was held 30+ minutes by an Overdeck dashboard deploy that its quality gates never touch. Sibling of PAN-3248 — fix them together.

### PAN-3237 (rank 61)

New this pass. Two collapses in one path: every HTTP 409 from the work-agent spawn is classified as 'guardrails', and every skip reason calls markWorkspaceStuck. A capacity refusal — a normal, transient condition at a full fleet — is therefore recorded as terminal, and three planned issues accumulated in that state over three ticks with their planning agents finished and nothing left to re-drive them.

### PAN-3234 (rank 62)

New this pass. paneHasBlockingChoiceMenu is wired only to delivery refusal, never to health, so an agent parked on a permission prompt or a session-resume gate is invisible to every health surface — both specimens were found by an orchestrator reading the pane by hand. One of them was holding the review of the next merge candidate. Pairs with PAN-3113 and PAN-3235 for detection plus an answerable surface.

### PAN-3205 (rank 63)

New this pass. The deployment gate's queue message is unusually good — it names the holders, the queue age, and warns against forcing — and it promises a 'next verification boundary' trigger that does not exist. Every holder cleared and the deploy never fired; the live build stayed stale for 35 minutes until a manual reload. A correct-sounding instruction that cannot happen is worse than no message.

### PAN-3168 (rank 64)

New this pass. DoD row 5 treats status 'unknown' as running, so an agent paused specifically to await close-out blocks close-out — the agent waits for close-out, close-out waits for the agent, and no amount of waiting resolves it. The issue is stuck in verifying_on_main permanently. Small predicate, total deadlock.

### PAN-3118 (rank 65)

New this pass. Model-specific quota exhaustion is invisible to every surface except the tmux pane: four planning agents read 'running' at $0.00 with no limitReason, no error state and no capacity fallback, while the rolling-window usage indicators looked healthy. Agents that are alive but structurally unable to make a call hold slots and produce nothing. Related to PAN-3043 for the mid-run case.

### PAN-3106 (rank 66)

New this pass. shouldHoldForUat is consulted on exactly one merge path, so every other path merges a ready issue without asking whether its project holds for UAT — verified at code level on a real MIN-901 merge. This defeats the batch-train model directly: issues merge one at a time before a generation can assemble them.

### PAN-3103 (rank 67)

New this pass. A transient merge_status=failed reading right after a successful merge makes automatic close-out skip the issue permanently, and nothing retries once the status self-heals. The issue stays merged but open, reads as pickup-eligible, and a fresh planning agent was spawned on already-shipped work. Wasted spend plus a false pipeline state.

### PAN-3100 (rank 68)

New this pass. The test role evaluates the workspace working tree rather than the reviewed commit, so a live work agent's in-progress uncommitted edits are counted against the issue — the gate's own artifact diagnosed it exactly, failing on a file the reviewed commit never touched. Combined with PAN-3104, which replays the stale artifact, it becomes a durable trap.

### PAN-3096 (rank 69)

New this pass. pan done's preflight blocks on the generated .devcontainer/ and dev artifacts, and with only commit/discard/surface offered, agents invented their own exits: one attempted to delete workspace infrastructure, another committed a wrapper-repo gitignore change that moved HEAD and fed a four-hour review reset loop. A gate that pushes agents toward destructive workarounds needs fixing at the gate.

### PAN-3084 (rank 70)

New this pass. A review session that spawns but is never briefed sits at zero context and zero tokens forever, and both recovery paths treat it as healthy work: auto-dispatch no-ops because a session exists, and pan review restart 'preserves' a session with no context to preserve. Only abort followed by request recovers, so review can never start for that issue on its own.

### PAN-3078 (rank 71)

New this pass. Inspect verdicts are persisted to review_status and checkpointed, but nothing delivers them to the work agent, so an agent that deliberately waits for its item verdict deadlocks forever — confirmed by a byte-identical pane ten minutes apart and by a manual pan tell resuming it within seconds. The missing piece is delivery alone, which makes this a small fix for a total stall.

### PAN-3043 (rank 72)

New this pass. Provider health is a pre-flight probe only, so a mid-run 403 quota refusal leaves the agent registered running with a 3.5-day-stale last_activity, holding an advancing-ceiling slot and surfacing to nobody. Its pane showed a hard provider refusal the whole time. Slot accounting that counts a dead agent as working starves the whole fleet.

### PAN-1824 (rank 73)

Re-ranked up (prior rank 83, score 78). Four issues filed since the last pass — PAN-3243, PAN-3492, PAN-3520 and PAN-2421 — all trace red or flaky main to real-timer tests under load. This is the shared fix for that family and it is now marked ready, so it should sit with the other CI-integrity work rather than behind it.

### PAN-2932 (rank 74)

Intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload.

### PAN-2935 (rank 75)

Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of API calls 504 in real MYN workspaces.

### PAN-2337 (rank 76)

Reload/build atomicity — an in-place npm run build under a live dashboard breaks new PTY-supervisor chunks.

### PAN-2422 (rank 77)

Rebuilding dist under a live server breaks lazy chunk imports (Cannot find module), wedging boots.

### PAN-2699 (rank 78)

npm run build regenerates the committed record-cost-event.js bundle, dirtying every workspace tree and blocking clean-workspace gates.

### PAN-2957 (rank 79)

npm run build intermittently produces stale frontend bundles, deploying pre-edit code.

### PAN-2850 (rank 80)

npm test fails in clean checkout — pretest removes the dashboard bundle the test spawns against.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-09-19T05:42:39.476Z",
  "model": "claude-opus-5",
  "pass": "incremental",
  "openCount": 908,
  "nodes": [
    {
      "issue": "PAN-3917",
      "rank": 1,
      "size": "XL",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Architecture epic: delete the state layer, keep every feature, Herdr default. Reshapes most open pipeline bugs",
      "rationale": "The Cut is the structural decision the rest of this backlog now hangs on: the overdeck-state data plane, per-issue records, SQLite mirror tables, the per-item inspection gate and the sixty Deacon patrols are deleted, and state becomes what the tracker, the repo and the live sessions say. Labeled architecture, so it carries the substrate floor (critical). It is an epic container with a planned PRD and a one-day parallel cut already under way; it is never picked directly, but every issue that targets record-plane machinery (PAN-3903, PAN-3895, PAN-3896, PAN-3914, PAN-3898, PAN-3909, PAN-3837, PAN-3843, PAN-3853, PAN-3868) is held behind it and re-scoped or closed once it lands. It explicitly re-scopes PAN-3861, PAN-3862, PAN-3863, PAN-3864, PAN-3762 and PAN-2350 under the new core.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3679",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running",
      "rationale": "Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 3,
      "size": "XS",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [
        "PAN-2742",
        "PAN-2695"
      ],
      "why": "infra-failure bypass writes reviewStatus='passed'",
      "rationale": "Highest integrity risk — infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; nearly merged a pipeline-critical change unreviewed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 4,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost",
      "rationale": "Sandboxed codex review verdicts fire-and-forget into a journal that loses them; review convoy reports green on evidence never delivered.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3566",
      "rank": 5,
      "size": "XS",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the deterministic producer of zombie test agents.",
      "rationale": "New this pass and the highest-leverage fix in the batch: the test-role launcher's final exec has no -p, no positional prompt and no piped stdin, so the role boots an interactive REPL and never takes a turn. That single missing argument is the deterministic producer of the zombie test agents tracked in PAN-2706, PAN-3563 and PAN-3274 — three separate hardening issues chasing one root cause. Reproduced across eight session IDs, so there is no diagnosis left to do.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and cannot start one: 3.5h outage, 1107 silent failures.",
      "rationale": "New this pass, labelled critical. A supervisor unit pinned to a pan reload generation SIGTERMs every correctly-running dashboard and is structurally incapable of starting a replacement; the observed outcome was a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and no operator escalation. Manual recovery also fails, because the supervisor kills the operator's dashboard within 30 seconds. Nothing else in the backlog can take the whole product down for hours with the recovery path itself broken.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3761",
      "rank": 7,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ready-to-merge issues never keep a UAT train: durable review status disagrees with passed PR stamps; re-dispatch yanks members.",
      "rationale": "New this pass and operator-hit. The durable review status keeps satisfying needsReviewDispatch after review and test have genuinely passed, so a host-side re-dispatch fires every ~30 seconds and the UAT reconciler keeps yanking the issue out of the ready set. The net effect is a ready badge everywhere and a train nowhere, which blocks the merge path for every issue that reaches this state.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3685",
      "rank": 8,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed",
      "rationale": "Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3561",
      "rank": 9,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "An ownerless state-git lock can never be broken — a crash between mkdir and owner.json bricked a project's write door for 2.5 days.",
      "rationale": "New this pass. Stale-lock recovery keys entirely on isPidDead(owner.pid), so a writer that crashes between mkdir and writing owner.json leaves a lock no breaker can ever fire on. It bricked every canonical-state write for the mind-your-now project for 2.5 days across five issues, and there is no TTL and no recovery CLI. An unbreakable lock on the single write door is as bad as the write door not existing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3524",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "A server-owned --changed verification loop relaunches through deacon freeze, review abort, pause and operator stop; peaked at 78 workers.",
      "rationale": "New this pass, filed P0. A server-owned --changed verification loop relaunched continuously through a global deacon freeze, a review abort, an issue pause and an operator stop — every documented suppression gate, applied and confirmed, and the loop kept respawning up to 78 concurrent vitest workers. It blocked a red-main fix from reaching its test gate across four attempts. A runaway the operator cannot stop is a category above an ordinary resource bug.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3283",
      "rank": 11,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recovering from review_infrastructure_failure flips review_status to passed and ready_for_merge to 1 over a live CHANGES REQUESTED verdict.",
      "rationale": "New this pass and labelled blocks-main. Recovering an issue from review_infrastructure_failure flips review_status to passed and ready_for_merge to 1 even when the newest artifact on disk is a CHANGES REQUESTED verdict, verified on two issues that were sitting in a UAT batch at the time. This is the same verdict-integrity family as PAN-2746 and PAN-2689 at the top of the list: unreviewed work presented as reviewed is the one failure that defeats the entire review pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 12,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace spawn branches from local HEAD instead of origin/main, so every new feature branch inherits unpushed local-main commits.",
      "rationale": "New this pass, labelled blocks-main and substrate. Two spawn sites branch from the local HEAD or defaultBranch instead of origin/main, so every new feature branch inherits whatever unpushed commits are sitting on the shared local main. Four branches were already contaminated when it was filed, two of them created after the problem was identified, and their PRs read MERGEABLE/CLEAN. It spreads with each spawn, so the cost of leaving it grows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 13,
      "size": "XS",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects",
      "rationale": "Dependency cleared: PAN-2882 (the missing GitLab merged-MR oracle this blocked on) closed since the last pass, so postMergeLifecycle's GitLab refusal is now directly workable. Re-ranked up from 67 to sit with the other unblocked critical merge-path fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3657",
      "rank": 14,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train queues endpoint runs the monorepo queue builder for polyrepo projects, so MYN/Auricle trains are permanently empty.",
      "rationale": "New this pass. The merge-train queues endpoint correctly gathers eligible candidates and then hands them to the monorepo queue builder, which does git rev-parse against a polyrepo project root that is not a git repository — so every polyrepo project's train is permanently empty while monorepo projects populate fine. MYN and Auricle cannot use merge trains at all until this lands.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3631",
      "rank": 15,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state, so every pass gets a frozen Jul-20 prior.",
      "rationale": "New this pass and directly observable in this run. The sequencer reads its prior from the legacy project-local .pan/backlog/sequence.md while pan backlog write-sequence persists only to overdeck-state, so nothing writes the legacy copy any more and every incremental pass is handed the same frozen document. This pass's own prior is dated 2026-07-21 for exactly that reason. Until it is fixed, incremental passes silently lose all intervening work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3565",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed review spawn wedges 'starting', and an all-lanes infra failure is synthesized as a real CHANGES REQUESTED verdict.",
      "rationale": "New this pass. Three review-lifecycle defects, one of them severe: when all four reviewer lanes died at spawn on a record lock, the supervisor wrote a synthesis declaring CHANGES REQUESTED with every lane marked failed — an infrastructure flake recorded as a real code verdict. It was caught only because a human was watching live. Same integrity family as PAN-3283 and PAN-2746.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3564",
      "rank": 17,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lock convoy: per-issue record lock held across the global state-git wait, so reviewer spawns die with no retry at 100% duty cycle.",
      "rationale": "New this pass. Record writes take the per-issue lock and then block on the global state-git lock while holding it, so a contended global lock pins every per-issue lock in the queue — a textbook convoy, observed at 100% duty cycle across 240 seconds of sampling. All four reviewer lanes died at spawn because the reviewer lifecycle signal acquires that lock with no retry or backoff. It cascaded across five issues simultaneously.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3554",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main has no mechanical owner: it hid for ~5h because the merge gate renders red main as an empty queue, not an alarm.",
      "rationale": "New this pass. Main stayed red for about five hours because nothing owns the state 'the latest main-push CI run failed' — no needs-you, no activity entry, no strike recommendation. The failure actively hides itself: the merge gate renders red main as an empty eligible set, so the operator sees a quiet queue rather than an alarm. Detection must not depend on the flywheel being awake, since it frequently is not.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3532",
      "rank": 19,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI runs only a hand-picked slice of the frontend suite, so main stayed red on frontend for hours while every run reported green.",
      "rationale": "New this pass. The CI test job runs root npm test, whose frontend leg is a hand-picked list of files, so two frontend test files were red on main for hours while every main CI run reported success. Green CI that does not mean green is worse than no CI, because every downstream gate and every close-out trusts it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 20,
      "size": "XS",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback is written to .overdeck/feedback but agents and the deacon merge gate are pointed at a nonexistent .pan/feedback.",
      "rationale": "New this pass and a one-line class of defect with outsized cost. Review feedback is written to the resolved .overdeck/feedback directory but the path handed to the work agent is a hardcoded .pan/feedback that no longer exists after the rebrand, and the deacon merge gate reads the same dead path. Agents are told to fix findings they cannot find, and the gate counts zero feedback files no matter how many exist.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3682",
      "rank": 21,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrated polyrepo slot pan done writes a legacy workspace record path and crashes; completion must go through the state write door.",
      "rationale": "New this pass. Slot completion for a migrated polyrepo project derives a legacy workspace .pan/records path, git rejects it as outside the state worktree, and the retry path then runs from a wrapper root with no .git and dies. Completion is the moment durable evidence is written; a crash there loses the handoff and wedges the slot.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3654",
      "rank": 22,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Compact respawn confirms against the archived session and kills a healthy fresh agent that was already doing the work.",
      "rationale": "New this pass. Compact respawn confirms the kickoff against the archived session rather than the fresh one, so a replacement session that had already accepted the recovery prompt and created four tasks was declared unconfirmed and killed. Recovery that destroys healthy work is worse than no recovery, and the orphan reconciler only noticed 40 seconds later.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3653",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A strike blocked on red main has no owner that wakes it when main goes green; the session stays alive so recover refuses it.",
      "rationale": "New this pass, labelled blocks-main. A strike that correctly stops because its gate is blocked by red main has no owner that wakes it when main goes green: the session stays alive, so liveness calls it healthy and pan recover refuses with 'already has a live harness runtime'. The urgent path exists precisely to unblock the pipeline fast, so a strike that silently idles through the clearing of its own blocker defeats the mechanism.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3630",
      "rank": 24,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell reported three deliveries to a live agent, moved all three to read/, and the agent received none — the delivery door lies.",
      "rationale": "New this pass. pan tell reported successful delivery three times to a live, heart-beating agent, moved all three messages into the read mailbox, and the agent's transcript shows it received none of them. The delivery door is the sanctioned way every part of the system talks to a running agent; a door that lies about delivery makes every downstream 'we told it' claim unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3571",
      "rank": 25,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop-hook completion-check timeout exits silently — 334 stranded turn-ends, no nudge, no escalation; agents idle until a patrol notices.",
      "rationale": "New this pass. The Stop hook's completion-check timeout branch logs and exits 0, bypassing the UNCLEAR fallback every other failure mode takes, so a timed-out check emits no resolution at all: no nudge, no escalation, no deacon poke eligibility. hooks.log records 334 stranded turn-ends, and one agent sat idle 68 minutes mid-item with uncommitted edits in place.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3563",
      "rank": 26,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A role agent whose prompt never delivered stays status=running with pid null; no patrol reconciles it and pan unstick can't see it.",
      "rationale": "New this pass. A role agent whose prompt never delivered is left status=running with pid null, so pid-liveness patrols have nothing to check, the dispatcher refuses to re-dispatch, and pan unstick cannot see role agents at all. Manual recovery took three separate doors. PAN-3566 removes the most common producer; this issue is the reconciliation that should have caught it regardless.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3805",
      "rank": 27,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex idle poke spawns codex exec instead of the app-server door; failed sends still tick the counter and pause healthy agents",
      "rationale": "New this pass. pokeAgentWithEscalation() increments the ineffective counter before delivery and never rolls it back, so a thread-store conflict rejection can escalate a perfectly healthy Codex agent to a tier-3 idle-alive pause. Reproduced across three issues in one RUN-92 window. It is labelled substrate-improvement, it is not in the pipeline, and it actively removes working agents from the fleet — the highest-value pickable item in this pass.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3560",
      "rank": 28,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "PTY supervisor overloads under concurrent review convoys; fleet-wide 502 'input echo confirmation failed' kills resumes and feedback.",
      "rationale": "New this pass. Under concurrent review convoys the PTY supervisor returns 502 'input echo confirmation failed' fleet-wide, so no agent can be booted or re-booted and pipeline feedback delivery fails while load is high — confirmed across at least six unrelated agents in one hour. Delivery failing exactly when the pipeline is busiest is what turns a load spike into a stall.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 29,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test gate records 'failed' for load-induced timeouts; retry timeout-only failures in isolation before writing a verdict.",
      "rationale": "New this pass. The test gate records a real 'test failed' verdict for uniform 5000ms timeout signatures under host load, proven on multiple branches where the same files pass in isolation in about 19 seconds. Every false verdict costs a full rework cycle and another saturated re-test, so this is both a correctness and a cost fix. Retrying timeout-only failures in isolation before writing a verdict is the minimal change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 30,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review sub-role edited seven tracked files after writing its report and the changes were auto-committed into the feature history.",
      "rationale": "New this pass. A review sub-role that had already written its report was resumed by a later message and edited seven tracked files, and pan start --fresh then auto-committed those reviewer-owned changes into the feature history during sync-main. Review isolation is currently prompt-level only; it has to be mechanical, because a contaminated branch is very hard to detect after the fact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3424",
      "rank": 31,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "State plane silently stops being durable: non-FF overdeck-state pushes are only warned about, and drafts/ PRDs are never staged.",
      "rationale": "New this pass. Two independent ways the state plane silently stops being durable: a non-fast-forward push on overdeck-state is only console.warned while legacy main has a full reconciliation owner, and drafts/ PRDs are never staged at all — 16 orphans, one two weeks old. Both had been accumulating unnoticed. Pairs with PAN-3651, which re-lands the reverted retry.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 32,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient upstream stream error benches CLIProxy's only auth: ~70% of GPT-routed inference 503s with a message that blames credentials.",
      "rationale": "New this pass. A transient upstream stream error benches CLIProxy's only auth entry, so every GPT-routed request returns 503 auth_unavailable until an internal cooldown lapses — 35 failures against 14 successes in one hour, with valid credentials throughout. The message reads as 'your credentials are gone' and sends the operator to re-authenticate, which fixes nothing. Every GPT-routed agent on the machine is affected at once.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 33,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents die before writing a verdict across 5 issues and 2 projects, leaving a verdict-shaped status with no artifact behind it.",
      "rationale": "New this pass. Review agents terminate before writing their report across five issues and two projects, twice recurring after a successful recovery, leaving a verdict-shaped status with no artifact behind it and a stuck flag that blocks progress until someone restarts the reviewer by hand. This is the upstream condition PAN-3283 then converts into a false passed verdict.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3281",
      "rank": 34,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so unfinished work is assembled into a UAT batch.",
      "rationale": "New this pass. An issue can hold ready_for_merge=1 and stuck=1/verification_stuck simultaneously, and the merge-ready flag wins on every surface consulted — so work with eight incomplete acceptance criteria was assembled into a UAT batch and recommended for promotion. The checklist gate exists to stop exactly this, and its verdict is being overridden by a stale flag.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 35,
      "size": "XS",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload never clears pending-deploy.json, so verification stops for every project until a patrol happens to notice.",
      "rationale": "New this pass. pan reload performs the deploy but never clears pending-deploy.json, and both the verification runner and the worker supervisor defer while any deploy is queued — so a successful reload stops verification for every project until a patrol happens to notice the build is fresh. A cross-project stall caused by a successful operation is the kind of coupling worth removing early.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3905",
      "rank": 36,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "First agent spawned into a planner-created workspace dies at the Claude trust dialog; foreman/swarm spawn fails outright",
      "rationale": "Planner-created workspaces skip preTrustDirectorySync, so the first agent launched into them (foreman, slot, strike) hangs on Claude Code's trust prompt and dies with a bare ready-signal-timeout. That kills the pipeline lane for any planned issue and the failure message hides the cause. The fix is small and survives the Cut (trust every spawn path right before launch, surface the pane tail on timeout), so it ranks with the pipeline-breaking criticals.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume",
      "rationale": "Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 38,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure'",
      "rationale": "Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 39,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch",
      "rationale": "Rank preserved at 15. PAN-3566, filed since the last pass, found the deterministic producer of these ghost sessions: the test-role launcher execs claude with no user prompt, so the session boots an idle REPL and never takes a turn. This issue's own asks — spawnRun must not treat a never-started session as active, and dispatch must not mark testing without delivering a prompt — remain valid hardening on top of that fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 40,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json",
      "rationale": "Stale .pan/test/result.json is consumed by the next cycle, insta-failing with the previous run verdict.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 41,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "substrate-bug-poller has never run",
      "rationale": "substrate-bug-poller has never run — BOT_LOGIN is a git author string not a GitHub login; the auto-triage loop is inert.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 42,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "rationale": "Re-review after a PR head moves never re-posts status, stranding otherwise-green PRs at BLOCKED.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes",
      "rationale": "review_status rows are never reconciled when an issue closes, so closed issues keep advertising stale review state.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 44,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "rationale": "pan done --strike structurally refuses every squash-merged strike — the landing path doctrine mandates is rejected by its own ancestry check.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3580",
      "rank": 45,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL",
      "rationale": "The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3677",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning agents wedge after a background Explore task finishes; parent never consumes the result",
      "rationale": "Planning agents wedge after a background Explore task finishes; parent never consumes the result. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 47,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [
        "PAN-2828"
      ],
      "why": "Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli…",
      "rationale": "Strike landing cannot merge: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback wedges on exited strike agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-2828"
      ],
      "why": "Close-out deploy row fails for every strike-landed issue",
      "rationale": "Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ and cannot find strike/ PRs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 49,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike merge trigger registry splits across dashboard chunks",
      "rationale": "Strike merge trigger registry splits across dashboard chunks, so the trigger is never registered in the chunk that runs it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 50,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three red-mains in one day from direct-push series bypassing PR CI",
      "rationale": "Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3708",
      "rank": 51,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike dies at git worktree list on a polyrepo wrapper — the urgent-strike escape hatch is unavailable for MYN-class projects.",
      "rationale": "New this pass. pan strike dies at git worktree list --porcelain on a polyrepo wrapper root, which is not a git repository, so the urgent-strike escape hatch is simply unavailable for MYN-class projects. pan swarm already understands nested repos; strike must use the same project repository inventory. Duplicate of PAN-3040 — close one when this lands.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3605",
      "rank": 52,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supply chain: lint-effect-diagnostics npx fell back to the registry and ran a squatted unscoped package; pin the scoped local bin.",
      "rationale": "New this pass and the only supply-chain finding in the batch. A stale node_modules made npx fall back to the registry, where the unscoped effect-language-service name is claimed by a third party, and npm installed and executed it non-interactively. The payload was benign this time; the name stays third-party-controlled, so a malicious patch release would run on any machine in the same state. The fix is small and the downside is unbounded.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3569",
      "rank": 53,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A stale pending-post-merge.json deadlocks the deploy gate: no staleness rule, and both owners need the restart the gate refuses.",
      "rationale": "New this pass. A stale pending-post-merge.json deadlocks the deploy gate: the gate refuses agent-initiated restarts while any pending file exists, startup would discard it as stale but startup needs the restart the gate refuses, and the deacon patrol that would clear it was frozen. A 3.5-hour-old ghost file blocked every deploy indefinitely while the live dashboard ran a ten-hour-old build.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3557",
      "rank": 54,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge label writes have no retry; a 403 hides a merged issue from the verify-on-main sweep while lifecycle reports success.",
      "rationale": "New this pass. Post-merge label application has no retry, so a rate-limited 403 leaves a merged issue without its verifying-on-main label — and the verify-on-main phase enumerates by that label, which makes the issue invisible to the phase that owns it. Lifecycle reported 'completed' throughout, so nothing noticed for 45 minutes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3543",
      "rank": 55,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while the refusal itself recommends --fresh.",
      "rationale": "New this pass. A completed-handoff agent owed rework after a blocked verdict cannot be started at all: pan start refuses and recommends --fresh, --fresh gives the identical refusal, and reset-session is refused too because the durable plane reconstructs the session pointer. The refusal message names an action the operator cannot take, which is the self-contradictory-deadlock family PAN-3526 opened.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3522",
      "rank": 56,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor watchdog restart-churns under CPU storm because the probe timeout budget ignores the boot warm phase.",
      "rationale": "New this pass. Under a CPU storm the supervisor watchdog counted probe timeouts through a new generation's 138-second boot warm phase and killed it anyway, producing four restarts in ten minutes, racing spawns on port 3012, and a WATCHDOG GIVING UP. Each restart re-triggered docker stack rebuilds, feeding the storm. The probe budget has to know the difference between starved and starting.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3783",
      "rank": 57,
      "size": "L",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deliver managed context through harness adapters and stop generating into native CLAUDE.md/AGENTS.md; operator-authorized, in flight",
      "rationale": "New this pass. This is the implementation of the PAN-3779 architecture decision: back out generated content from native instruction files, then deliver global, bundled-rule, project, workspace, role and briefing context explicitly per harness including resume. Today a machine-context header leads the combined output and agents misattribute bundled rules to the repo. Large and no-loss-sensitive, but it fixes context provenance for every agent the pipeline runs. In-pipeline and operator-authorized; the issue explicitly forbids a competing work agent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 58,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "One cgroup holds every agent pane, so a single hungry agent inflates the unit and oomd kills the whole fleet — twice now.",
      "rationale": "New this pass. Every agent pane is a child of one transient tmux-server unit, so agent memory is the unit's memory and systemd-oomd's kill decision is all-or-nothing: one hungry agent takes the entire fleet with it. That has now happened twice, the second time killing seven work agents, four strikes and a live review convoy. Blast-radius containment is a different fix from choosing a better victim.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 59,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue fired none of 25 attempts.",
      "rationale": "New this pass. A work agent finished, opened a PR and sat idle for two hours because review was never dispatched, while the auto-requeue machinery that exists for exactly this had 25 attempts available and fired none of them. The documented manual recovery worked immediately, so the gap is entirely in the automatic path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 60,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A queued dashboard deploy defers verification for every issue in every project, starving unrelated cross-project review handoffs.",
      "rationale": "New this pass. Three gates compose into an unbounded cross-project hold: verification defers while any pending deploy exists, host-side review dispatch routes through verification, and the deploy queue is Overdeck's. A myn issue's review convoy was held 30+ minutes by an Overdeck dashboard deploy that its quality gates never touch. Sibling of PAN-3248 — fix them together.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 61,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A capacity 409 on planning→work handoff is classified as 'guardrails' and marked terminally stuck; three issues stranded at once.",
      "rationale": "New this pass. Two collapses in one path: every HTTP 409 from the work-agent spawn is classified as 'guardrails', and every skip reason calls markWorkspaceStuck. A capacity refusal — a normal, transient condition at a full fleet — is therefore recorded as terminal, and three planned issues accumulated in that state over three ticks with their planning agents finished and nothing left to re-drive them.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 62,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze indefinitely on blocking choice menus and no health surface notices; the detector is wired only to delivery refusal.",
      "rationale": "New this pass. paneHasBlockingChoiceMenu is wired only to delivery refusal, never to health, so an agent parked on a permission prompt or a session-resume gate is invisible to every health surface — both specimens were found by an orchestrator reading the pane by hand. One of them was holding the review of the next merge candidate. Pairs with PAN-3113 and PAN-3235 for detection plus an answerable surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 63,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The deployment gate promises the queued deploy will fire at the next verification boundary; that trigger does not exist.",
      "rationale": "New this pass. The deployment gate's queue message is unusually good — it names the holders, the queue age, and warns against forcing — and it promises a 'next verification boundary' trigger that does not exist. Every holder cleared and the deploy never fired; the live build stayed stale for 35 minutes until a manual reload. A correct-sounding instruction that cannot happen is worse than no message.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3168",
      "rank": 64,
      "size": "XS",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 counts status 'unknown' as running, so an agent paused FOR close-out blocks close-out — a permanent verifying_on_main deadlock.",
      "rationale": "New this pass. DoD row 5 treats status 'unknown' as running, so an agent paused specifically to await close-out blocks close-out — the agent waits for close-out, close-out waits for the agent, and no amount of waiting resolves it. The issue is stuck in verifying_on_main permanently. Small predicate, total deadlock.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 65,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model-specific quota exhaustion is invisible everywhere but the pane: four planning agents read 'running' at $0.00 with no fallback.",
      "rationale": "New this pass. Model-specific quota exhaustion is invisible to every surface except the tmux pane: four planning agents read 'running' at $0.00 with no limitReason, no error state and no capacity fallback, while the rolling-window usage indicators looked healthy. Agents that are alive but structurally unable to make a call hold slots and produce nothing. Related to PAN-3043 for the mid-run case.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 66,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default: hold is consulted on one merge path only, so held issues merge individually and defeat the UAT train.",
      "rationale": "New this pass. shouldHoldForUat is consulted on exactly one merge path, so every other path merges a ready issue without asking whether its project holds for UAT — verified at code level on a real MIN-901 merge. This defeats the batch-train model directly: issues merge one at a time before a generation can assemble them.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 67,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient merge_status=failed skips close-out permanently, leaving merged work open and pickup-eligible for a fresh planning agent.",
      "rationale": "New this pass. A transient merge_status=failed reading right after a successful merge makes automatic close-out skip the issue permanently, and nothing retries once the status self-heals. The issue stays merged but open, reads as pickup-eligible, and a fresh planning agent was spawned on already-shipped work. Wasted spend plus a false pipeline state.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 68,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The test role evaluates the dirty working tree, so a live work agent's uncommitted edits are recorded as the issue's test failure.",
      "rationale": "New this pass. The test role evaluates the workspace working tree rather than the reviewed commit, so a live work agent's in-progress uncommitted edits are counted against the issue — the gate's own artifact diagnosed it exactly, failing on a file the reviewed commit never touched. Combined with PAN-3104, which replays the stale artifact, it becomes a durable trap.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3096",
      "rank": 69,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done blocks on generated .devcontainer/ and dev, and agents resolve it by deleting workspace infrastructure or inventing gitignores.",
      "rationale": "New this pass. pan done's preflight blocks on the generated .devcontainer/ and dev artifacts, and with only commit/discard/surface offered, agents invented their own exits: one attempted to delete workspace infrastructure, another committed a wrapper-repo gitignore change that moved HEAD and fed a four-hour review reset loop. A gate that pushes agents toward destructive workarounds needs fixing at the gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 70,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever, and restart 'preserves' the zombie that blocks its replacement.",
      "rationale": "New this pass. A review session that spawns but is never briefed sits at zero context and zero tokens forever, and both recovery paths treat it as healthy work: auto-dispatch no-ops because a session exists, and pan review restart 'preserves' a session with no context to preserve. Only abort followed by request recovers, so review can never start for that issue on its own.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3078",
      "rank": 71,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect verdicts are persisted but never delivered, so a work agent that waits for its item verdict deadlocks forever.",
      "rationale": "New this pass. Inspect verdicts are persisted to review_status and checkpointed, but nothing delivers them to the work agent, so an agent that deliberately waits for its item verdict deadlocks forever — confirmed by a byte-identical pane ten minutes apart and by a manual pan tell resuming it within seconds. The missing piece is delivery alone, which makes this a small fix for a total stall.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3043",
      "rank": 72,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider health is probed only at spawn, so a mid-run 403 quota refusal leaves an agent 'running' for days holding a slot.",
      "rationale": "New this pass. Provider health is a pre-flight probe only, so a mid-run 403 quota refusal leaves the agent registered running with a 3.5-day-stale last_activity, holding an advancing-ceiling slot and surfacing to nobody. Its pane showed a hard provider refusal the whole time. Slot accounting that counts a dead agent as working starves the whole fleet.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "rationale": "Re-ranked up (prior rank 83, score 78). Four issues filed since the last pass — PAN-3243, PAN-3492, PAN-3520 and PAN-2421 — all trace red or flaky main to real-timer tests under load. This is the shared fix for that family and it is now marked ready, so it should sit with the other CI-integrity work rather than behind it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2932",
      "rank": 74,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload",
      "rationale": "Intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 75,
      "size": "S",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks Traefik router",
      "rationale": "Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of API calls 504 in real MYN workspaces.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 76,
      "size": "XS",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "rationale": "Reload/build atomicity — an in-place npm run build under a live dashboard breaks new PTY-supervisor chunks.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 77,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "rebuilding dist under a live server breaks lazy chunk imports",
      "rationale": "Rebuilding dist under a live server breaks lazy chunk imports (Cannot find module), wedging boots.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 78,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle",
      "rationale": "npm run build regenerates the committed record-cost-event.js bundle, dirtying every workspace tree and blocking clean-workspace gates.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 79,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "npm run build intermittently produces stale frontend bundles",
      "rationale": "npm run build intermittently produces stale frontend bundles, deploying pre-edit code.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 80,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "rationale": "npm test fails in clean checkout — pretest removes the dashboard bundle the test spawns against.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2758",
      "rank": 81,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever",
      "rationale": "Provider capacity error silently zombies a spawned agent (willRetry=false, status stays running forever), holding a slot.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 82,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever",
      "rationale": "Placeholder pending-work-spawn agents crash auto-resume with Unknown model, stranding agents troubled forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 83,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours",
      "rationale": "Idle-at-prompt gpt-5.6-sol agents are never redriven — one burned $82 idling 6h; nothing nudges them to continue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 84,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "rationale": "Scheduler yield never self-clears — yielded work agents stay paused hours after the blocking review merges.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 85,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a…",
      "rationale": "Work agent stalls forever on a dead inspection session; no re-dispatch, swarm-off suppresses recovery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 86,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running",
      "rationale": "Close-out blocks on a dead agent — postMergeLifecycle pauses the agent but leaves status=running, jamming the DoD gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 87,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "rationale": "Flywheel cannot be resumed after a crash/reboot — Resume disabled, only action silently aborts the active run.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 88,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel with an active run was never auto-relaunched after a reboot",
      "rationale": "Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 89,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator is unreachable as a notification target",
      "rationale": "Flywheel orchestrator is unreachable as a notification target — agent feedback dead-ends, resume always fails.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 90,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents",
      "rationale": "Verification/review feedback silently queued to stopped-by-user agents, never re-driven on delivery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 91,
      "size": "XS",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "planning finalizes (issue→planned) but work agent does not auto-spawn",
      "rationale": "Planning finalizes (issue->planned) but the work agent never auto-spawns — silent handoff break.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 92,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "reviewed+green PR stuck after review",
      "rationale": "Reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never dispatched.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3811",
      "rank": 93,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The PAN-3809 emergency strike prunes BuildKit unconditionally; inventory, bounded reclaim door and retention floor are still missing",
      "rationale": "PAN-3809 (the emergency BuildKit prune strike) closed, so the dependency is cleared; rank and score preserved because the body did not change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 94,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "relaunch can leave a zombie agent",
      "rationale": "Relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness probe gap).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 95,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS",
      "rationale": "Kimi agent silently frozen at 100% context (no thrown overflow) not caught by CONTEXT guards.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 96,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04…",
      "rationale": "Agents die in sweeps — boot-correlated false reaps kill live flywheel and convoys; plus an unexplained simultaneous 3-host kill.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 97,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "merge queue head-of-line zombie",
      "rationale": "Merge-queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 98,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "rationale": "Flywheel respawn after crash starts a blank session instead of resuming the live one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3697",
      "rank": 99,
      "size": "XS",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployed dashboard PATH omits Bun, so verification workers hit 'bun: not found' before the required install gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3633",
      "rank": 100,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike workspaces spawn without @types, so the contract's own typecheck gate fails and agents abort reporting a false red main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 101,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "A stale .pan/test/result.json is re-applied with no freshness check against HEAD, re-failing an issue long after the fix landed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 102,
      "size": "XS",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "--health-timeout 120 is enforced as 120ms and a false-failed check exits after killing the old server — nothing left listening.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3044",
      "rank": 103,
      "size": "XS",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback delivery has no terminal-issue guard: it dispatched review and raised needs-you on issues closed 12 days earlier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 104,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects; same defect as PAN-3708.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 105,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn logs 'attempt 1/3' and never retries after a transient Docker EOF, stranding the issue with no re-drive owner.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2971",
      "rank": 106,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "The orchestrator finalized its own run and kept ticking for 19 hours while dashboard Pause/Stop were disabled — an uncontrollable zombie.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 107,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery",
      "rationale": "Work-spawn docker-health gate has no autonomous recovery — proposed work cannot auto-start when docker is briefly unhealthy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [
        "PAN-2846"
      ],
      "why": "Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO…",
      "rationale": "Close-out leaves stale residue (orphaned inspect sub-agents, uncleared review rows) that chronically inflates troubled/failed metrics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3793",
      "rank": 109,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveIssuePullRequestRef probes only feature/ and strike/ names, so close-out cannot find a merged PR on a descriptive branch",
      "rationale": "New this pass. PAN-3790 merged cleanly from feature/muse-harness with green CI and a successful deploy, and pan close still reported row 4 missing because neither conventional branch existed; rows 1-3 then could not settle and rows 6/8 lost their merge anchor. Supervised work increasingly uses descriptive branches, so this will recur. The fix is contained: teach the canonical resolver to honour an explicit issue-record PR reference with linked-PR lookup as fallback.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2960",
      "rank": 110,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict",
      "rationale": "Inspect supervisor lingers past its 12m limit and never self-terminates after posting a verdict (ran 38m).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2959",
      "rank": 111,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect --item <X> reviews workspace HEAD, not item X's commit",
      "rationale": "pan inspect --item reviews workspace HEAD not item X commit, producing spurious FAILED verdicts when HEAD moved past.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 112,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [
        "PAN-2331"
      ],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401",
      "rationale": "codex-resume replays a rotated-out revoked refresh token, wedging every codex review convoy with 401.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 113,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss)",
      "rationale": "Codex rate-limit Switch to gpt-5.4-mini modal stalls autonomous agents with no auto-dismiss.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 114,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully",
      "rationale": "Codex weekly-quota exhaustion has no graceful handling — needs resource alert + downshift/dismiss policy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 115,
      "size": "XS",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures",
      "rationale": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); a per-issue cycle-time sink.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 116,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits)",
      "rationale": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main leaves non-issue-ref commits.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 117,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push",
      "rationale": "Spec plan.status flips left uncommitted in the shared primary worktree, causing spec-vs-record drift and blocking the flywheel push.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 118,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution",
      "rationale": "Workspace node_modules is symlinked to the primary repo — the forbidden pattern CLAUDE.md bans; breaks test resolution.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 119,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker init container lacks Python",
      "rationale": "Docker init container lacks Python, so node-gyp rebuild of better-sqlite3 fails and the workspace never comes up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 120,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "rationale": "Workspace init container bun install does not populate the container-node-modules named volume.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 121,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "rationale": "pan strike workspace setup leaves a broken partial workspace + false spawned success on a git-lock race.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3689",
      "rank": 122,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphaned swarm-slot GC targets the aggregate polyrepo root; nested worktrees survive and spam failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 123,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-2259"
      ],
      "why": "Linear tracker listIssues is a 3N+1 request storm",
      "rationale": "Linear listIssues is a 3N+1 request storm — one membership gather burns the entire 2500/hr Linear budget.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2966",
      "rank": 124,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev",
      "rationale": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2945",
      "rank": 125,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "rationale": "pan done rejects Overdeck-generated runtime (.devcontainer/, dev, .pan/review) in polyrepo wrapper repos.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2680",
      "rank": 126,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "rationale": "pan close Docker teardown silently skips a running stack in multi-repo projects, aborting close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3734",
      "rank": 127,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed swarm slot reuse can start a new item from a stale polyrepo branch — silent wrong-parent work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3650",
      "rank": 128,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike self-abort is not terminal — state.json stays running and the deacon resurrects the aborted strike on every recovery pass.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3621",
      "rank": 129,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start intermittently dies resolving a chunk graph spliced across two builds — importer from primary dist, path in the live generation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3555",
      "rank": 130,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start without --fresh silently abandoned an intact 7.5MB warm session, violating the warm-by-default contract.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 131,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering, so the persisted sequence carries duplicate ranks and gaps.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 132,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review convoy member blocked on an operator AskUserQuestion about review depth; review agents must decide and record, not ask.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3301",
      "rank": 133,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog manifest still writes legacy .pan, so the state-recreation patrol logs a stray-writer warning ~68k times — dominant log volume.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 134,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "The agent git guard is PATH-based and an agent stripped it unprompted to get past a false block; a control the agent can remove isn't one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3898",
      "rank": 135,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Strike landing: salvage re-arms a landed strike, close-out records zero merges, no post-merge deploy. Re-scope after the Cut",
      "rationale": "Live breakage on the first strike landed after the substrate epic: the salvage patrol re-armed an already-merged branch, close-out ran with no merge evidence and left the issue open, and no post-merge deploy fired. Defect 1 lives in strike_landing_state on the record, which the Cut deletes; defects 2 and 3 (strike merge must trigger the same post-merge lifecycle and close-out as the review-pipeline merge) survive and matter. Held behind PAN-3917 so the fix lands on the post-Cut merge door rather than the record plane.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 136,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear poller is blind after cycle rollover",
      "rationale": "Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 137,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "label transition fails atomically on missing 'in-planning' label",
      "rationale": "Close-out label transition fails atomically on a missing in-planning label, keeping closed issues mislabeled.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 138,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans…",
      "rationale": "pan close close-issue phase reports success but leaves the issue OPEN / wrong labels.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 139,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s",
      "rationale": "Dashboard steady-state ~50% CPU keeps API responses at 0.5-1.5s — a residual burner profile and fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 140,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "something burns the full 5k/hr GitHub GraphQL quota",
      "rationale": "Something burns the full 5k/hr GitHub GraphQL quota, repeatedly breaking pan close and gh issue edit.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence)",
      "rationale": "Verify-gate dependency install is warn-only + 60s timeout, producing false verify failures against empty node_modules.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 142,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard server route tests flake under full-suite verification load",
      "rationale": "Dashboard server route tests flake under full-suite verification load.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 143,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "frontend typecheck fails with dozens of pre-existing unused-local errors",
      "rationale": "Frontend typecheck fails with dozens of pre-existing unused-local errors — gates are noisy/unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 144,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "server children inherit bare system PATH",
      "rationale": "Server children inherit bare system PATH — verification gates run npm/node under Node 18 not the server Node 22.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 145,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "deacon-swarm unit tests read live ~/.overdeck/config.yaml",
      "rationale": "deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mjs differs.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2075",
      "rank": 146,
      "size": "XL",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Boot Reconciliation + Operator Inbox",
      "rationale": "Epic — boot reconciliation + operator inbox; replaces silent all-or-nothing resume with one informed, substrate-complete (local+Fly) decision surface. Ranked by aggregate child impact.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2077",
      "rank": 147,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines)",
      "rationale": "Boot reconciliation substrate-complete inventory resolver (local tmux + remote Fly) — the backend both surfaces consume; depends on remote-agent rows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 148,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote",
      "rationale": "CLI parity for boot reconciliation (pan boot status / pan resume flags) — the headless leg.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 149,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine)",
      "rationale": "Operator Inbox durable queue + in-dashboard surface — the notification spine; boot reconciliation is producer #1, and it absorbs scattered alert surfaces.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2080",
      "rank": 150,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS)",
      "rationale": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach; fast-follow after the inbox spine.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 151,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "rationale": "Remote Fly.io work agents appear as real session rows — prerequisite visibility before reconciliation can include them.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-454",
      "rank": 152,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "rationale": "Crash recovery UI on dashboard startup — superseded by the boot reconciliation surface but still the local-half tracker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 153,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "rationale": "Stale stopped-agent zombies pollute the dashboard list — must be excluded from reconciliation resume candidates.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3651",
      "rank": 154,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-land the reverted overdeck-state non-fast-forward push retry; without it a concurrent state writer wedges every state write.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3634",
      "rank": 155,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning auto-handoff stamps the ambient flywheelRunId on operator-started work, stripping its reaping exemption.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3556",
      "rank": 156,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "No per-agent spawn mutex: two flows allocated session identities 3s apart and the second pin orphaned the first transcript.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3553",
      "rank": 157,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux list-panes -a exits 1 on a zero-session server, so the census reads unavailable post-reboot and conversations hang on 'Starting…'.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3535",
      "rank": 158,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The drain/resume hold is re-derived from the caller's env each boot, so any restart from a clean shell silently drops it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3464",
      "rank": 159,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm reset never clears slotCompletions, so a stale marker re-arms the exact wedge the operator ran reset to escape.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3429",
      "rank": 160,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory governor defers admissions but sheds nothing under HARD pressure; concurrent heavy gate runs aren't in the shed ladder.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 161,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fresh convoy lanes freeze at 0 output before kickoff; PAN-3375's detector only covers warm resumes, so recovery is manual.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 162,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A fresh workspace ships an empty-but-present node_modules, so tooling silently resolves the parent repo's deps and gates go false-green.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 163,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents are told to rebase, the launcher guard blocks it, and pan sync-main can't resolve a -strike workspace. Overlaps PAN-3306.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 164,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A workspace-confined agent wrote a doc edit into the primary main worktree — the PAN-2204 write-to-main hazard through a new door.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 165,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "New workspaces arrive with empty node_modules and bun off the agent shell PATH, so the documented bun install remedy fails.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 166,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume leaves a stale PTY socket and drops supervisorEnabled from state.json, so every supervisor delivery fails afterwards.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 167,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 accepts only the transient verifying_on_main state, so an already-done issue can never be closed without an override.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3139",
      "rank": 168,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The authoritative agents table under-reports a live 4h agent as stopped while pan start's own liveness check correctly refuses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3668",
      "rank": 169,
      "size": "L",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Prime Agent as a managed harness (in flight — RPC runtime adapter, discovery, transcripts)",
      "rationale": "PAN-3804 (its merge-blocker dependency) closed and the issue is now labeled in-review; rank and score preserved because the body did not change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3129",
      "rank": 170,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "No symlink/TOCTOU containment on canonical writes under agent-controlled paths; a planted symlink redirects a server-side write.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 171,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A scheduler-yielded work agent makes operator MERGE hard-error on polyrepo and silently dead-end on single-repo.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 172,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect and review-supervisor spawns omit --effort and inherit the harness xhigh default — recurring overspend, once per xBRIEF item.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3062",
      "rank": 173,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The shared primary main worktree stacks several sessions' commits, so whoever pushes next ships everyone else's unverified work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 174,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands Overdeck's own .pan/drafts PRD into product feature branches; the exclusion list is duplicated and has drifted.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 175,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rebuild composes under overdeck-feature- while Traefik labels name myn-feature- devnet, and traefik attaches are runtime-only.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3307",
      "rank": 176,
      "size": "XS",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "commitlint scope-enum lists 11 scopes, 14 real ones are missing, and it still names the removed beads scope — trains everyone to ignore it.",
      "rationale": "Re-ranked up. It carries the substrate-improvement label, which the ranking rules floor at high importance regardless of how small the change reads. The substance is modest — a stale commitlint scope-enum — but it warns on the majority of legitimate commits and trains every agent to ignore commitlint output, which quietly disarms a gate.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3022",
      "rank": 177,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The work-spawn route ignores record.workModel, so the role default wins and then persists over the operator's per-issue override.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 178,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost strategy: waste detection over budget policing",
      "rationale": "Epic — cost strategy: retire invented limits, land the progress-aware breaker, make dollars honest. Ranked by aggregate child impact; the breaker is the one real guard.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1868",
      "rank": 179,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2466"
      ],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "rationale": "Labeled planned since the prior run with no material body change; rank and score preserved.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2466",
      "rank": 180,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out/record writer clobbers closeOut.usage with EMPTY data",
      "rationale": "closeOut.usage clobbered with empty data on close-out — per-issue cost history lost locally; ledger integrity, fix early.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 181,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "rationale": "cost_events retention — 14 months of granular rows accumulating with no policy; DB bloat.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 182,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2642"
      ],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "rationale": "Show PLAN badge on costs under a subscription — folds into the billing-mode work that makes headline spend honest.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 183,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "rationale": "Cost prediction/estimation for in-progress work — folds burn-rate estimation into the breaker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 184,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog pickup gate",
      "rationale": "Epic — backlog pickup gate: operator Plan->Release row + AI Objection (5th state) + flywheel relevance-vetting; prevents bad/superseded work from burning agent time.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2376",
      "rank": 185,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability",
      "rationale": "Epic — CI/CD reliability: flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3775",
      "rank": 186,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "makeDbLive opens overdeck.db unmigrated; zero-table db poisons a vitest worker home and breaks later read-only audits.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3652",
      "rank": 187,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "No workflow_dispatch on ci.yml / state-plane-branches.yml, so an unverified main tip can never be verified and DoD row 6 blocks close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3622",
      "rank": 188,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "orphan-proposed-reconciler test pins a real issue id and reads live GitHub; it fails pan release check on a green main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3579",
      "rank": 189,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "~20 frontend mutations hand-write JSON headers and omit the CSRF token, so each 403s the moment its route becomes guarded.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3541",
      "rank": 190,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review restart loops on the session-resume menu because eligibility ignores how the prior session ended; partial mechanical break landed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3463",
      "rank": 191,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "A legitimate empty-diff slot outcome can never pass item verify, so the slot wedges and blocks dispatch of remaining items forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3460",
      "rank": 192,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-item verify_commands that run the whole root suite make slot merge gates load-fragile and hold a patrol in flight for ~17 minutes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3454",
      "rank": 193,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost hook rescans fork-copied parent history from byte 0 under the reviewer's id — fabricated cache-miss warnings and double-billed spend.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3439",
      "rank": 194,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start crashes on a 'pending-work-spawn' placeholder row; resume already guards this and takes the fresh-spawn path.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3432",
      "rank": 195,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive yield fans out: seven work agents paused to make room for one review convoy, then flood back oldest-first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 196,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three layers disagree on how a strike rebases: the prompt instructs it, the launcher guard blocks it, sync-main resolves the wrong worktree.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3297",
      "rank": 197,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "After a dashboard restart, delivery calls a healthy agent a zombie while resume calls it healthy; both classifiers can't be right.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 198,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "A test-role agent spawned and never ran a turn, holding an approved CI-green issue out of the merge gate behind a stale failed verdict.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 199,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitLab merged-head oracle spawns one glab subprocess per repo × head, so pipeline membership refresh fails on every cycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 200,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The tmux delivery fallback answered a live session-resume menu because its own paste hid the menu from the detector — silent /compact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 201,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "glab mr list runs with a polyrepo wrapper root as cwd, which is not a git repo, so MYN membership fails forge_unavailable every cycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 202,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan merge cancel has a 0% success rate: Commander binds its options object into the injectable fetchImpl parameter.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3174",
      "rank": 203,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo UAT stacks 504: Traefik labels carry the old myn- prefix, Traefik isn't on the overdeck-* devnet, and the fe port is wrong.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 204,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pipeline emits 'merge failed' after a successful merge and successful cleanup, leaving the issue Todo with the commit already on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 205,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper's regex only matches overdeck-feature-*-server|frontend, so MYN stacks run for hours after their agents are gone.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2995",
      "rank": 206,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike gates on branch ancestry, which a squash-merge breaks, so it refuses strikes that pan close proves merged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 207,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pre-push file-size guard reads the shared working tree, so another session's uncommitted edits block an unrelated, guard-clean push.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3899",
      "rank": 208,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload drops the Deacon/resume boot gates chosen at the last restart, so every deploy relaunches with the Deacon off",
      "rationale": "Every post-merge deploy silently reverts the operator's boot-gate choice, so the Deacon (deacon-lite after the Cut) is off most of the time without anyone choosing that. The restart gate and Deacon on/off both survive the Cut, and the fix is contained: reload reuses the live server's gates unless flags override, and /api/health reports them.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3900",
      "rank": 209,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker bridge pool exhausted by orphaned workspace networks; pan start fails and the bridge-pool patrol only warns",
      "rationale": "pan start failed outright when Docker's ~31-slot bridge pool filled with networks left behind by out-of-band worktree removal. Host hygiene moves to a plain scheduler under the Cut, but the reclaim (unattached workspace networks under pressure) and the teardown-on-destroy hook are needed either way.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3769",
      "rank": 210,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Red main 707089c5→e4b280b3 blocked deploys ~14h: missing no-loss lock entry + stale OpenRouter expectation. Verify still reproducing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3760",
      "rank": 211,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "permissionMode 'auto' undocumented as non-bypass, launcher can emit invalid --permission-mode, invalid values drop silently.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3629",
      "rank": 212,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "No sanctioned door to re-scope a live agent; the operator must violate pan tell doctrine or let the rejected design land.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3517",
      "rank": 213,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy forks still miss the parent prompt cache in production — launch-injection byte drift plus resume dropping the cache-scope header.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 214,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload deletes the generation the global pan link points at, so the CLI vanishes mid-deploy for anyone invoking from elsewhere.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3303",
      "rank": 215,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "An empty registered-projects 200 is treated as authoritative, latching Command Deck at 'Unknown project' until a manual page reload.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 216,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "One issue's agent sessions vanished four times in a run while every peer stayed up; specimen-specific — re-confirm the mechanism.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3243",
      "rank": 217,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit test polls a fixed 20 setImmediate turns for a real git subprocess; the flake reddened main and blocked a close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3224",
      "rank": 218,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Duplicate of PAN-3439: a stranded 'pending-work-spawn' model kills plain pan start while resume already guards it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3196",
      "rank": 219,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-owned container residue makes close-out die on EACCES after passing every DoD row; same family as PAN-3570.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 220,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "One configured non-git member (auricle/infra) blanks pipeline membership for the whole project the resolver claims it can answer.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 221,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "TOCTOU between the duplicate-session guard and session creation makes pan start report a hard failure over a successful spawn.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 222,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote is complete at merge time with no production-reach check, so members read shipped while prod serves the old build.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3176",
      "rank": 223,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT promote consults no stack health, so a batch whose stack was never exercised can be promoted from a success-green control.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 224,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Identifier-joined write paths have no containment assertion, so a crafted issue or agent id could redirect a canonical write.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 225,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-2828"
      ],
      "why": "Strike-branch teardown uses --is-ancestor, which cannot see a squash merge, so all 96 strike/* branches survive as residue.",
      "rationale": "Rank held at 224. The body re-confirms the same --is-ancestor-versus-squash root cause that PAN-2828 fixes on the pan done path, so this pass records the dependency rather than moving the rank: teardown should reuse the squash-aware containment check once PAN-2828 lands. 96 strike/* branches of residue is real but inert cleanup, so it stays below the availability and merge-integrity tier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 226,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan exits with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out, so callers read a successful merge handoff as failure.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1711",
      "rank": 227,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard event-loop stalls under load force watchdog restarts; the root cause behind the PAN-3522 churn and the 0.5-1.5s API latencies.",
      "rationale": "Re-ranked up (prior rank 267, score 55). Since the last pass this became the root cause behind a whole cluster of new incidents — PAN-3522's watchdog restart-churn, PAN-2905's steady-state latency, and the PAN-3524 verification storm all present as event-loop starvation. The manifest also now flags it ready. Fixing the stalls removes the trigger for several downstream failures rather than one symptom.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3916",
      "rank": 228,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session pointers go stale after rollover + crash recovery; issue view and pan tell confirmation track a dead transcript",
      "rationale": "Three pointers (state.json, session.id, conversation row) drift apart after a context-limit rollover followed by crash recovery, so pan tell reports unconfirmed deliveries that actually landed and the issue view pins the wrong transcript. One writer for every new-session path plus a rollover-then-recover test fixes a class of confusion the operator hits directly.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3854",
      "rank": 229,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feature-workspace devcontainer stack returns 403 on POST /api/dashboard/session, blocking all in-browser mutation UAT",
      "rationale": "The workspace-built dashboard refuses the session bootstrap because the stack lacks the trusted-origin/Traefik env the host gets, so any UI acceptance criterion that needs a mutation cannot be proven in-stack and UAT reads \"cannot run\". Blocks the UAT gate for every UI issue until the compose template passes the feature hostnames.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3667",
      "rank": 230,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy has no cross-family remap, so every Anthropic-pinned subagent dies at spawn in a proxied session; stopgap is hand-written.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3596",
      "rank": 231,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon patrol has no per-step timing, so overruns in the system's central scheduler cannot be attributed to a step.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3536",
      "rank": 232,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell can not reach ohmypi conversations: with no state.json the expected harness defaults to claude-code and delivery reports a zombie.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3527",
      "rank": 233,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "One failed boot-time fetch leaves the sidebar at CONVERSATIONS 0 / ISSUES 0 for the life of the tab — nothing retries it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3510",
      "rank": 234,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent stop leaves detached docker-run test containers alive for hours, contending with other agents' quality gates.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3505",
      "rank": 235,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unpushed agent code commits on the primary main worktree make every flywheel state push fail the agent main-push guard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3355",
      "rank": 236,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "sessionExists collapses 'no such session' and 'could not ask' into false, so callers read not-running when liveness is unknown.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 237,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "A sequencer pass ran against an empty manifest while the read model held 1120 issues — a transiently empty read at spawn.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3245",
      "rank": 238,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pan done gate flags workspace .pan/drafts as uncommitted despite its own .pan exclusion, training agents to reach for --force.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3218",
      "rank": 239,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: an install-breaking fix sat merged and unpublished for ~9 hours with nothing surfacing it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 240,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out teardown scopes by compose project while the guard scopes by working_dir, so an unprefixed dead init container blocks it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 241,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux and lexerra are permanently unreadable through the membership door: an App-not-installed 404 is typed as retryable forge_unavailable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3113",
      "rank": 242,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Blocking agent-pane choice prompts show nothing in the conversation view; surface them as inline decision cards with keystroke delivery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 243,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log reached 867MB with no rotation — disk cost and un-greppable incident logs exactly when they're needed.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3094",
      "rank": 244,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's merge fallback still force-pushes a fast-forwardable branch, so a rejected push leaves completion half-done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3012",
      "rank": 245,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archiving preserves the pointer, not the data: harnesses delete session JSONL on their own schedule and the conversation is unrecoverable.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3911",
      "rank": 246,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan pause <issue> stops only the work agent; review/test convoys keep running and Deacon re-dispatch resurrects reviewers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3627",
      "rank": 247,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "backlog-auto-trigger throws on a legitimately empty manifest, so a plain npx @overdeck/core in a non-project dir prints a stack trace.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3617",
      "rank": 248,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Three strike dispatches for PAN-3586 died with zero output while a sibling worked; may be stale — re-confirm before picking up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3513",
      "rank": 249,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Durable agent runtime plane on overdeck-state: GC shredded live session pointers mid-review-loop with no reconstruction fallback.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3308",
      "rank": 250,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size guard prints a paste-ready ratchet-up line, so 2 of 3 agents raised the ceiling instead of shrinking the file.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3276",
      "rank": 251,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows for pane questions and permission prompts are click-dead, so the list that exists to route the operator routes nowhere.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3235",
      "rank": 252,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render and answer agent pane-choice menus on the decision card; PAN-3228 shipped the core and CLI, the dashboard UX remains.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3789",
      "rank": 253,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "MCP servers configured in standalone Codex never reach Overdeck conversations; no setup, auth or lifecycle story across harnesses",
      "rationale": "New this pass. initCodexHome() rewrites the managed config.toml on every launch and only emits servers passed through opts.mcpServers, so an isolated CODEX_HOME conversation sees none of the operator’s configured servers — this blocked a live MYN task whose repo instructions require Linear MCP. Real gap, but the ask spans provisioning, authentication, lifecycle visibility and cross-harness parity with no PRD, so it is marked needs-refinement and ranked in the enhancement tier rather than the substrate tier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3211",
      "rank": 254,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issues closed without landing have no honest disposition, so their review_status rows are neither close-able nor reapable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3175",
      "rank": 255,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train ordering derives conflicts from file overlap alone, so semantically dependent members batch in any order and break the schema.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3137",
      "rank": 256,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles come from the Flywheel status snapshot, so orchestrator prose replaces issue titles on the promote surface.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3751",
      "rank": 257,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge deploy runs a multi-minute build with no dashboard indication — operator reads a silent deploy as a lost notification",
      "rationale": "Deploy is a Definition-of-Done row, and it currently runs with no visible progress anywhere in the dashboard, so an operator waiting for the restart ask concludes the notification was lost when the build is simply still running. That misread costs real time on flywheel nights when deploys stack up, and it is the visibility half of the deploy-gate defects already ranked above it. In pipeline and planned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 258,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code is the only harness still driven by keystroke injection; a pull-based monitor inbox would retire the whole hardening stack.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3866",
      "rank": 259,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test specialist copies the previous head's uatStatus into the new result instead of re-running browser UAT; stale fail strands merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3902",
      "rank": 260,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification gates inherit OVERDECK_* env from the dashboard, so host boot state (--no-resume) reds unrelated branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3909",
      "rank": 261,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "One agents read door (delete the read-model accumulator). Aligns with the Cut tenet; re-scope once PAN-3917 lands",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3861",
      "rank": 262,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "terminal.backend setting (tmux|herdr). The Cut ships the backend contract with Herdr default; re-scope to what remains",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3518",
      "rank": 263,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "Re-review resumes re-bill the whole cold history; make reviewResumeDecision TTL- and size-aware. Needs design sign-off.",
      "rationale": "Re-derived github-ref dependency this pass: the body states it depends on #3517's convoy-scope header on fresh spawns. Rank unchanged - the cross-reference is not new, the prior pass simply missed it.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3445",
      "rank": 264,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "projects.yaml TCP lock ports overlap the OS ephemeral range, so an unrelated socket makes an uncontended config write fail.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3332",
      "rank": 265,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "A detached slash-command spawn died in 150ms while the UI kept saying 'running in the background'; the activity must own its outcome.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3295",
      "rank": 266,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completion-check LLM is invisible infrastructure that fanned out to 35 concurrent processes; one queued summarizer plus observability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 267,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket was treated as ambiguous so feedback never crossed to tmux; a fix commit is cited — verify.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 268,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role-spawn wrote 26 session-scoped hook paths into the durable ~/.claude/settings.json; they fail on every Linear tool call forever.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3771",
      "rank": 269,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation search silently empty end-to-end: palette flag off by default, FTS scan manual-only, no summaries.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 270,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "No per-project resource partitioning, so one project's docker stacks and installs starve another project's pipeline and the dashboard.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3420",
      "rank": 271,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3107",
      "rank": 272,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "OOM spikes are unattributable after the fact; productize the machine-local memory-attribution census stopgap.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3762",
      "rank": 273,
      "size": "XL",
      "importance": "high",
      "score": 64,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Overdeck Anywhere direction change: per-machine servers + client-side federation instead of relay-first. Supersedes PAN-2350 plan.",
      "rationale": "Body gained the 2026-09-17 Herdr/Orca addendum cross-referencing PAN-3861/3862/3863, and the Cut (PAN-3917) explicitly re-scopes it; rank preserved, now held behind the Cut.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 274,
      "size": "XL",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline Throughput Hardening",
      "rationale": "Epic — pipeline throughput hardening; most keystone children closed, remaining open work is coalescing review-spawn noise.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1556",
      "rank": 275,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "rationale": "Session/activity feed coalesces review-spawn spam and supersedes re-reviews per issue — keeps active conversations most-recent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 276,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "rationale": "Flywheel resilience for the codebase-health flood — substrate-first prioritization + tenets spirit-gate; landed parts, operator-decision items remain.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 277,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines)",
      "rationale": "Decompose merge-ops.ts (1,925 lines) — new god file from the workspaces split; supervised handoff only.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2233",
      "rank": 278,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "decompose merge-agent.ts (1,414 lines) into focused modules",
      "rationale": "Decompose merge-agent.ts (1,414 lines) into focused modules; supervised handoff only.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2526",
      "rank": 279,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "rationale": "Refactor deacon.ts below file-size baseline — companion to PAN-2189.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2008",
      "rank": 280,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "store-access guard",
      "rationale": "Store-access guard — fail the build on direct store reads outside a domain resolver; the smallest slice of single-source-of-truth.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1936",
      "rank": 281,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads",
      "rationale": "Single source-of-truth reads — one canonical resolver per domain, consolidating 280+ scattered read endpoints.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1988",
      "rank": 282,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "rationale": "Verdict signaling — one host-owned write door; agents journal, host owns the DB cache.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 283,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field",
      "rationale": "Collapse issue status to one canonical field — labels become a derived projection.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 284,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 285,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1700 agent committed .pan/specs/*.vbrief.json mutations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 286,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 287,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 288,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2242",
      "rank": 289,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 290,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell contradicts itself on dead ohmypi sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 291,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 292,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 293,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 294,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 295,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 296,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 297,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "issue-level assembly owner",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2212",
      "rank": 298,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 299,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 300,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 301,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 302,
      "size": "XS",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 303,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 304,
      "size": "XS",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 305,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 306,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3787",
      "rank": 307,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add a per-child composer and live Working-for indicator to subagent transcripts for Codex and Claude Code",
      "rationale": "New this pass. Extends the subagent rail from read-only viewing to direct child input, which needs thread-scoped routing on the Codex app-server adapter and a structured child-input connection under the Claude Code PTY. Genuine operator value once the rail exists, but it is conversation ergonomics rather than pipeline integrity, so it sits in the feature tier. In-pipeline, pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 308,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 309,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "`always` is inert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 310,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 311,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 312,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 313,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 314,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 315,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister auto-resume tests fail under full parallel run, pass in isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 316,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 317,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1766",
      "rank": 318,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents hang on Claude Code settings-file protection when editing .claude/**",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 319,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 320,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 321,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 322,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1538",
      "rank": 323,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 324,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 325,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 326,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 327,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 328,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 329,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1196",
      "rank": 330,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 331,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 332,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1246",
      "rank": 333,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 334,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 335,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 336,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 337,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "enhancement(security): API key at-rest hardening",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 338,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 339,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 340,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2351",
      "rank": 341,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [
        "PAN-1166"
      ],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "rationale": "Body updated since the last pass; it remains the security prerequisite that blocks every other Overdeck Anywhere phase, so the rank holds.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2350",
      "rank": 342,
      "size": "L",
      "importance": "high",
      "score": 69,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic container for Overdeck Anywhere P0-P3; PAN-3762 proposes replacing the relay-first direction with per-machine server federation.",
      "rationale": "Body gained the 2026-09-17 addendum superseding the \"Herdr not adopted\" decision via PAN-3861 and cross-referencing PAN-3862/3863/3762; the Cut re-scopes it. Rank, operator gate (blocked) and planning (skip) preserved verbatim.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1217",
      "rank": 343,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 344,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 345,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 346,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 347,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 348,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 349,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1553",
      "rank": 350,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1504",
      "rank": 351,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan hygiene",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1480",
      "rank": 352,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1479",
      "rank": 353,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 354,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2837",
      "rank": 355,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2836",
      "rank": 356,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2830",
      "rank": 357,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2720",
      "rank": 358,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 359,
      "size": "L",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2549",
      "rank": 360,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2358",
      "rank": 361,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 362,
      "size": "XS",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "write a Definition of Ready (DoR)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 363,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2193",
      "rank": 364,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 365,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "rationale": "Re-derived cross-reference this pass: the body opens 'Follow-up to #1983' and says #1983's code already landed, so it is narrative history, not a blocker - recorded as an informs edge, not dependsOn. Rank unchanged.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1913",
      "rank": 366,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 367,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 368,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 369,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 370,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-807",
      "rank": 371,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-630",
      "rank": 372,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3826",
      "rank": 373,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view freezes until refresh: Claude JSONL watcher has no missed-event safety net. Fix exists on a branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3853",
      "rank": 374,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Review synthesizer self-declared an operator override and flipped an approved HEAD. Override door goes with the Cut",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 375,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 376,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-262",
      "rank": 377,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "stale",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-176",
      "rank": 378,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 379,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3881",
      "rank": 380,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan sync distributes from a stale primary checkout and never removes deleted sources, resurrecting deleted subagent defs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3864",
      "rank": 381,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Stale strike agents flood /agents (183 STRIKE RUNNING). The Cut makes the Herdr workspace the issue tree; re-scope",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 382,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door can report fetch failure after merge and land the same head twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 383,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with a duplicated workspace prep",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 384,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 385,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 386,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 387,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2739",
      "rank": 388,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "first-completion detection throws every patrol cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 389,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "strikes deadlock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 390,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversation permission waits missing from Awareness; strengthen alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 391,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 392,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 393,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 394,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3701",
      "rank": 395,
      "size": "L",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Four separate first-party LLM client stacks; consolidate onto effect/unstable/ai LanguageModel + ExecutionPlan. PRD written.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 396,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page opens with a 55KB raw kickoff prompt and hides the pending question the operator actually has to answer.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2672",
      "rank": 397,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2670",
      "rank": 398,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 399,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 400,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 401,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 402,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 403,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 404,
      "size": "M",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 405,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 406,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2554",
      "rank": 407,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "clicking a project doesn't update the browser URL",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2550",
      "rank": 408,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test exits 0 despite root-suite failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 409,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout parses seconds as milliseconds",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2546",
      "rank": 410,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell is codex-conversation-unaware",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 411,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3504",
      "rank": 412,
      "size": "XS",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Duplicate of PAN-3499 (parked.ts ProjectConfig.projectPath typecheck red on main); confirm landed and close one of the pair.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3181",
      "rank": 413,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent memories are harness-owned, machine-local and keyed by path; move them to a per-repo overdeck-memory orphan branch.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3003",
      "rank": 414,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generated launcher.sh files omit the OVERDECK_AGENT_ID export the PTY supervisor requires, so manual re-launch dies instantly.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 415,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 416,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard",
      "rationale": "Condition changed: PAN-3113, PAN-3234 and PAN-3235 were filed since the last pass and cover the same ground concretely — pane-choice detection, health wiring, and an answerable decision card. This issue is likely subsumed; re-scope it to whatever those three do not cover, or close it as superseded. Rank preserved.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 417,
      "size": "M",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2489",
      "rank": 418,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike agents are invisible in the project issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 419,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready set misses merge-eligible issues without flywheel merge verbs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 420,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's PR lookup fails at MYN polyrepo root",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2454",
      "rank": 421,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "ratchet audit fails per-commit on push ranges whose NET baseline delta is zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 422,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN workspace Traefik routing broken post-rebrand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 423,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan workspace rebuild hardcodes 'overdeck-' compose project prefix",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 424,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex agents can wedge on the Codex CLI first-run/consent screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 425,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "context-overflow recovery is inconsistent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 426,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start --auto commits the spec to main AFTER creating the worktree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 427,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "one invalid tiered_execution enum poisons every config read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 428,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "three event types missing from DomainEvent schema union poison the RPC stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 429,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "every supervisor.log line written twice",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3661",
      "rank": 430,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Secure review-mode dispatch dropped the HTTP-200 semantic-rejection surface; two frontend tests fail locally while CI stays green.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3288",
      "rank": 431,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout preflight: after a git pull that adds a dep, the CLI dies with ERR_MODULE_NOT_FOUND instead of saying 'run bun install'.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3164",
      "rank": 432,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "probeUatStack reports readiness from container count, so the UI offers 'Open UAT frontend' while the API is still resolving Maven deps.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3121",
      "rank": 433,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "The failed-send outbox never reconciles against the transcript, so a delivered message keeps a Retry twin that would double-send.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 434,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background title/about spawns use --bare, which now skips credential reads, so every one fails 'Not logged in' with empty stderr.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3833",
      "rank": 435,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feed renders assistant text after tool calls as thinking rows; operator concludes the agent never answered",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3901",
      "rank": 436,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "test-skip gate has no audited exemption for opt-in live suites (skipIf on env/binary); three suites on main cannot move",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3915",
      "rank": 437,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "A unit test writes a real transcript under ~/.claude; watcher indexes the deleted file and ENOENT sticks in health",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 439,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents skip `pan done` (manual push instead)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 440,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 441,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 442,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "full frontend vitest suite runs in no CI path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1912",
      "rank": 443,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 444,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "unbounded log growth",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1830",
      "rank": 445,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 446,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 447,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 448,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 449,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1761",
      "rank": 450,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversations endpoints fetched via relative /api path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 451,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3516",
      "rank": 452,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Repo .claude/skills holds stale duplicates of pan-handoff, pan-flywheel and okf, so overdeck-dev sessions load outdated skill text.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3455",
      "rank": 453,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "cliproxy --version exits 2, so the up-to-date check always returns false and every ensure re-downloads the pinned release.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3117",
      "rank": 454,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "A deterministic 400 renders as the generic 'Failed to send' bubble with a Retry that can never succeed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3036",
      "rank": 455,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pane-idle detection reads a completed strike's idle composer as a pending question, so a finished strike shows '! INPUT'.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3016",
      "rank": 456,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator ask: every view should be URL-addressable; cockpit tabs, stage panes and several drawers are still local state.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3855",
      "rank": 457,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reuses the old agent's recorded model after pan reset-session; retuned tiers never apply without --fresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3890",
      "rank": 458,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "opencode provider stream error (rate limit) is invisible in the feed and never retried; first message dies silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 459,
      "size": "XS",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 460,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 461,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 462,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "restart-with-model doesn't emit a live event",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 463,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "right-click 'restart with <model>' carries model only, never harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 464,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 465,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3903",
      "rank": 466,
      "size": "L",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Route 93 review_status readers through IssuesResolver. The Cut (PAN-3917) deletes the state layer this targets; close or re-scope",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3862",
      "rank": 467,
      "size": "L",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917",
        "PAN-3861"
      ],
      "why": "/agents-v2 machine session explorer for Herdr and tmux servers. Re-scoped under the Cut; depends on the backend contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 468,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 469,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 470,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 471,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1461",
      "rank": 472,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 473,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 474,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 475,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3616",
      "rank": 476,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planned deploy restarts show the alarm-toned Reconnecting banner; use the lifecycle signal for calm 'updating' copy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3157",
      "rank": 477,
      "size": "XS",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "The Flywheel renders in the Awareness feed as a generic 'Claude Code / No messages yet' chat row despite emitting a snapshot every tick.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2982",
      "rank": 478,
      "size": "XS",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Nothing runs a skill's own selftest when sync-sources/skills/** changes; a convoy passed a PR with its selftest red.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 479,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "The conversation search index never prunes deleted sessions, so Ctrl-K offers zombie hits that 404 on open.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2976",
      "rank": 480,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness to any capability-passing ACP CLI: named adapters plus a config-declared custom-agent escape hatch.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3829",
      "rank": 481,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3783"
      ],
      "why": "Managed Claude launch home overlay (tag handoff/20260909/main). Operator must decide direction before planning",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1444",
      "rank": 482,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 483,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 484,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 485,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 486,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1392",
      "rank": 487,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 488,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 489,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 491,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 492,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 493,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 494,
      "size": "L",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3705",
      "rank": 495,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K: add Conversations as a first-class entry in the type list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 496,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 497,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3540",
      "rank": 498,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View shows phantom agent orbs from state rows with no live session, a dead Hook Bus panel, and a pressure-blind swap header.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3354",
      "rank": 499,
      "size": "XS",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "The archive write door accepts kind=main, hiding a project's singleton workspace with no unarchive affordance in the UI.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3321",
      "rank": 500,
      "size": "XS",
      "importance": "medium",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Escalation text and CLAUDE.md advertise 'pan unstick', which errored as unknown; re-verify against the current CLI before picking up.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3178",
      "rank": 501,
      "size": "XL",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make worktrees and diffs first class: +/- badge, dedicated Changes surface, conversation worktrees. PRD and mockup exist.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3017",
      "rank": 502,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "The issue-page UAT panel renders only inline actions, so restart/rebuild/stop are unreachable outside the rail's context menu.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3837",
      "rank": 503,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Auto-handoff spawn dies on record lock contention, leaves a starting placeholder. Lock goes with the Cut; item 3 survives",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 504,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 505,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 506,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 507,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 508,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 509,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 510,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 511,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 512,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 513,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 514,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-900",
      "rank": 515,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 516,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 517,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 518,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 519,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3732",
      "rank": 520,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex handoff serializes a large rollout twice (~286MB peak RSS on 50MB); serialize once or stream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3700",
      "rank": 521,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan acp serve would let Zed and other ACP clients drive Overdeck conversations through canonical doors. PRD written.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3290",
      "rank": 522,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF items can carry empty metadata.traces, so docs items sit unanchored in the requirement traceability graph.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3132",
      "rank": 523,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF v0.9 agentic dispatch fields are half-adopted as a behavior accident; make difficulty/filesScope/verifyCommands a contract.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3827",
      "rank": 524,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard shows the empty welcome state instead of an error when the harness exits before writing a transcript",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3893",
      "rank": 525,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "ACP conversations drop agent thoughts: no agent_thought_chunk case and no thought role in the ACP transcript schema",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3863",
      "rank": 526,
      "size": "XL",
      "importance": "medium",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917",
        "PAN-3762"
      ],
      "why": "Orca-style SSH Hosts and Remote Servers onboarding; extension of PAN-3762 federation, re-scoped under the Cut",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 527,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-334",
      "rank": 528,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 529,
      "size": "XS",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 530,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 531,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 532,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 533,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 534,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 535,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 536,
      "size": "XS",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 537,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1041",
      "rank": 538,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-924",
      "rank": 539,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3770",
      "rank": 540,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex conversations never show the working spinner mid-turn; parser marks every agent_message instantly complete.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3731",
      "rank": 541,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restart-gate banner gives no feedback after approval; dead-requester approvals read as a broken button.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3530",
      "rank": 542,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Four God View components poll on 30s timers instead of the documented /ws/rpc event contract.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3131",
      "rank": 543,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support xBRIEF planRef sharding so a 1.1MB/227-item plan stops making every finalize failure whole-plan-fatal.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 544,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deterministic start-vs-swarm recommendation at plan-finalize, derived from plan shape plus recorded outcomes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 545,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Harness-initiated compaction idled six agents and GPT-5.6's window was declared twice; both fixes appear landed — verify and close.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3843",
      "rank": 546,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Green-CI reconciler marks testStatus passed while uatStatus is failed. The Cut (PAN-3917) deletes the state layer this targets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3867",
      "rank": 547,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "/projects/new discards keystrokes typed before the first resolve lands (3 of 5 attempts under load)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3873",
      "rank": 548,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub event delivery: support smee and gh webhook forward transports with guided install, settings and docs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3822",
      "rank": 549,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Link pull requests to conversations via branch detection plus explicit link/unlink override; show PR state on rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 550,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-817",
      "rank": 551,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 552,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 553,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-700",
      "rank": 554,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-646",
      "rank": 555,
      "size": "XS",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 556,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2896",
      "rank": 557,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 558,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2626",
      "rank": 559,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 560,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 561,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2608",
      "rank": 562,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 563,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2566",
      "rank": 564,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Triage list of genuine Traycer capability gaps; a container for child issues, not directly workable.",
      "rationale": "Marked as an epic this pass: the body states plainly that it tracks gaps and that each item pursued gets its own child issue, so it is a container rather than work. It has no checkbox task list, so no contains edges are asserted. Rank preserved. Planning set to skip so the container is never picked up as work.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2565",
      "rank": 565,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "rationale": "Body updated since the last pass; no delta justified a rank change.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3735",
      "rank": 566,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sandboxed pan CLI reports 'dashboard down, run pan up' when the real cause is no network; sends agents down the wrong path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3335",
      "rank": 567,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "A pasted screenshot can't be viewed anywhere in the dashboard: thumbnail has no click handler and the sent form is a file-link chip.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 568,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: run one template issue under N crew/model configurations and compare cost, wall-clock and outcome.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 569,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "Settings surface that detects installed ACP CLIs, renders the capability checklist, and guides login without a manual terminal.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3835",
      "rank": 570,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Attach the native Codex TUI to a running app-server thread (codex resume --remote); validate concurrent attach first",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3831",
      "rank": 571,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model picker: gray out models whose provider has no API key or subscription login, via one server-side readiness door",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 572,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "support polyrepo projects",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2557",
      "rank": 573,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level 'Restart All' context action",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 574,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level CI visibility",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 575,
      "size": "XS",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "close the PAN-2541 legacy-fallback deprecation window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 576,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "launch pipeline agents with harness rate-limit model-switch reminder disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 577,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3772",
      "rank": 578,
      "size": "XS",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conv view renders Claude Code's synthetic 'no visible output' nudge as an operator message; should read as plumbing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3895",
      "rank": 579,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917",
        "PAN-3896"
      ],
      "why": "Delete 30 pending repairer patrols after a 7-day soak. The Cut deletes all Deacon patrols outright; close when it lands",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3892",
      "rank": 580,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Substrate review follow-ups from PAN-3845: several items target record-update/pan-dir code the Cut deletes; re-triage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 581,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "optional SageOx re-integration",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2443",
      "rank": 582,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenTelemetry GenAI semconv",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2442",
      "rank": 583,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent Client Protocol (ACP) as Overdeck's structured control plane",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2409",
      "rank": 584,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "enforce the workspace boundary",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2399",
      "rank": 585,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "wire replay_threshold/compaction_reroute into the slot-recovery respawn seam",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 586,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing Crew cost panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 587,
      "size": "XS",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2295",
      "rank": 588,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3767",
      "rank": 589,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model switch could hang at 'Saving…'; onError toast landed, remaining work is reproducing the hang on a healthy server.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3615",
      "rank": 590,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "TTS silent 9+ days from four stacked failures; three already fixed, only follow-ups remain — rescope to what is left.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3558",
      "rank": 591,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Subagent rail shows no model or provider, so mixed-model orchestration needs a transcript open per row to see what it is running.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3469",
      "rank": 592,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "NewProjectModal violates the PAN-3410 page-not-modal doctrine; migrate the create-project flow to a routed page.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3333",
      "rank": 593,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model pickers show $/1M, which says nothing under a subscription; show relative plan-quota drain among sibling models.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 594,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship named crew presets that populate the whole tiered_execution block so operators don't hand-build the crew table.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3852",
      "rank": 595,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project creation follow-ups: SSH-port repo URLs, dotted repo names, partial-registration retry, non-409 error mapping",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 596,
      "size": "L",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 597,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 598,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 599,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2033",
      "rank": 600,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 601,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 602,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 603,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2029",
      "rank": 604,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 605,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 606,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 607,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 608,
      "size": "XS",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 609,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 610,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3739",
      "rank": 611,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost-reconcile re-warns every model-less codex subthread rollout on every sweep; log flood grows without bound.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3830",
      "rank": 612,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenCode provider: curate picker models via Settings favorites (OpenRouter pattern) instead of listing every model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 613,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 614,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1967",
      "rank": 615,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 616,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3684",
      "rank": 617,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-1641"
      ],
      "why": "Temporary acceptance issue: spawn a Pi work agent on ollama:gemma4:12b and record evidence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 618,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 619,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "--big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 620,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 621,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 622,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 623,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1844",
      "rank": 624,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 625,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 626,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 627,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3706",
      "rank": 628,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Broadsheet shipped typography only; color, surface, elevation and texture still on Ledger values, so it doesn't read like Subspace.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3539",
      "rank": 629,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "OOMPolicy=continue fix landed with the issue; re-scope to whatever hardening remains or close it out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3502",
      "rank": 630,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "tiered-crews blendedCost expectation stale vs pricing catalog; likely already fixed by the PAN-3532 cherry-pick — verify.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3499",
      "rank": 631,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Same one-line ProjectConfig.path fix as PAN-3504; confirm it landed on main and close the duplicate.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2978",
      "rank": 632,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976",
        "PAN-2977"
      ],
      "why": "Opt-in per-agent install recipes for ACP CLIs from the setup UI; deliberately separated for its supply-chain trust decision.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3896",
      "rank": 633,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Would-fire counters count no-op reads and exhaust budgets. The Cut (PAN-3917) deletes the state layer this targets (patrols go)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 634,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 635,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 636,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT assembly/conflict agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 637,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 638,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 639,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "conflict-aware merge train + on-demand UAT candidate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 640,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1676",
      "rank": 641,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 642,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 643,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 644,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 645,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 646,
      "size": "XS",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 647,
      "size": "XS",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 648,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 649,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 650,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 651,
      "size": "XS",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "New Terminal button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 652,
      "size": "XS",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 653,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 654,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 655,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 656,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 657,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 658,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1443",
      "rank": 659,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1442",
      "rank": 660,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 661,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 662,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 663,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1165",
      "rank": 664,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3912",
      "rank": 665,
      "size": "XS",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart accepts a stray positional (pan restart status) and files a real restart request; reject excess args",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3914",
      "rank": 666,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "checkOrphanedCompletions looped 9x despite its tombstone. The Cut (PAN-3917) deletes the state layer this targets (patrol + record)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 667,
      "size": "XS",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 668,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 669,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 670,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 671,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-949",
      "rank": 672,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 673,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-938",
      "rank": 674,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fizzy visual pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 675,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 676,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 677,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 678,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 679,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 680,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "self-improving flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3322",
      "rank": 681,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "launcher-generator.ts's file-size ceiling sits 126 lines above the real file, handing back the regrowth the ratchet exists to prevent.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-678",
      "rank": 682,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 683,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 684,
      "size": "L",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Setup Wizard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 685,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 686,
      "size": "XS",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 687,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 688,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-607",
      "rank": 689,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-606",
      "rank": 690,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-548",
      "rank": 691,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 692,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove claude-code-router",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 693,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-531",
      "rank": 694,
      "size": "XS",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 695,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation input bar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 696,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-294",
      "rank": 697,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 698,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Living Memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 699,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 700,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 701,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 702,
      "size": "XS",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 703,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 704,
      "size": "XS",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 705,
      "size": "L",
      "importance": "medium",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-38",
      "rank": 706,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 707,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 708,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 709,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3441",
      "rank": 710,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View 'River' WebGL pipeline visualization fed by the live hook-event stream; PRD and mockup exist.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 711,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt the interactive decision page as the default way to present operator decisions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 712,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 713,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 714,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 715,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 716,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2679",
      "rank": 717,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 718,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 719,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2635",
      "rank": 720,
      "size": "XS",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2630",
      "rank": 721,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 722,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3443",
      "rank": 723,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View 'Spectrum Deck' visualizer concept with mockup and PRD; pure exploration, no substrate impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 724,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 725,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 726,
      "size": "XS",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 727,
      "size": "XS",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 728,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 729,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2507",
      "rank": 730,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2505",
      "rank": 731,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 732,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 733,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 734,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book",
      "rationale": "Flagged isEpic this pass: the title is 'Epic: the Order Book' and the body is a four-phase container, not directly workable. Its phases are not yet split into child issues, so it carries no contains edges. Operator-owned gate=blocked and planning=skip preserved verbatim; rank unchanged.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2406",
      "rank": 735,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 736,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2394",
      "rank": 737,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 738,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service",
      "rationale": "Condition changed: PAN-3762 says a cloud relay is optional rather than required for two operator-owned machines, which is exactly this phase's premise. Rank preserved pending that decision.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2355",
      "rank": 739,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "rationale": "Body updated since the last pass; the mobile PWA is a client surface either architecture supports, so the rank holds.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2354",
      "rank": 740,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "rationale": "Body updated since the last pass; unlike the transport phases, a needs-you push bridge survives the PAN-3762 direction change unchanged, so the rank holds.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2352",
      "rank": 741,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "rationale": "Condition changed: PAN-3762 proposes per-machine servers with client-side federation, which may replace the Cloudflare Tunnel phase as the primary remote-access path. Rank preserved pending that decision.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2353",
      "rank": 742,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "rationale": "Condition changed: the Hermes bridge assumed the relay-first topology PAN-3762 now questions. Rank preserved pending the direction decision.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3133",
      "rank": 743,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluation spike for TRON encoding of prompt-bound xBRIEF payloads; savings are modest today since agents get a bounded slice.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3011",
      "rank": 744,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [
        "PAN-1641",
        "PAN-465"
      ],
      "why": "Add poolside Laguna S 2.1 as a model target; the honest hardware note says it will not fit this machine's GPU.",
      "rationale": "Re-derived github-ref dependencies this pass: the body gates its Ollama path on #1641 and its hosted path on #465. Rank unchanged - both cross-references predate the prior pass.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 745,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 746,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 747,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 748,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 749,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [
        "PAN-1592"
      ],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "rationale": "Re-derived github-ref dependency this pass: the body names #1592 as the outbox reload-durability prerequisite. Rank unchanged - the cross-reference is not new.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2082",
      "rank": 750,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 751,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2046",
      "rank": 752,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 753,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3868",
      "rank": 754,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3917"
      ],
      "why": "Stop hook nudges with a non-existent verb (pan work done). The Cut deletes the work-agent stop hook; close when it lands",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 755,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2002",
      "rank": 756,
      "size": "XS",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 757,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 758,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 759,
      "size": "L",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1980",
      "rank": 760,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 761,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 762,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 763,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 764,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1895",
      "rank": 765,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 766,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 767,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 768,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 769,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1646",
      "rank": 770,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 771,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 772,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 773,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 774,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 775,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1483",
      "rank": 776,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 777,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 778,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3919",
      "rank": 779,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review the universal reasoning-effort default. Operator decision, not agent work; filing does not authorize a change",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1356",
      "rank": 780,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 781,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1222",
      "rank": 782,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 783,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 784,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1153",
      "rank": 785,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 786,
      "size": "XS",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 787,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 788,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 789,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1124",
      "rank": 790,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 791,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 792,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 793,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 794,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 795,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 796,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 797,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3768",
      "rank": 798,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --title already implemented and landed (678f6b389e5); open only pending close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 799,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix already landed on main (strike/slot workspace names and live tmux now seed the session tree); open pending close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 800,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferrals: lease-based concurrent writes and an LLM semantic auditor, both gated on evidence that isn't here yet.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3778",
      "rank": 801,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reconnect-loop fix (48fd8f7a) is already on main; open only pending verify and close-out.",
      "rationale": "Re-ranked down. The staleness-reconnect fix landed on main as 48fd8f7a, so this is finished work awaiting close-out, not workable scope. Left high it would sit near the top of the pickable queue and invite a planning agent on already-shipped work — the waste PAN-3103 exists to stop. Scored with the other landed-pending-close-out issues (PAN-3768, PAN-3456, PAN-3034).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3824",
      "rank": 802,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Screenshot only: default view on Windows breaks the model selector. Needs repro steps, browser and build",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 803,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-984",
      "rank": 804,
      "size": "XS",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-962",
      "rank": 805,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 806,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 807,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 808,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 809,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 810,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-853",
      "rank": 811,
      "size": "L",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-833",
      "rank": 812,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 813,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 814,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 815,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-793",
      "rank": 816,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 817,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 818,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 819,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 820,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 821,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3456",
      "rank": 822,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Already fixed in 4117c9a777 with a regression test; open only pending close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3823",
      "rank": 823,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Screenshot only: \"pan sync issue\". No error text, command or expected result; needs a written repro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 824,
      "size": "XS",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-773",
      "rank": 825,
      "size": "XS",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 826,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 827,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-769",
      "rank": 828,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [
        "PAN-750"
      ],
      "why": "Track verification/review/test phase churn over time",
      "rationale": "Re-derived github-ref dependency this pass: the body states 'Depends on #750, the main metrics redesign'. Rank unchanged - the cross-reference is not new.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 829,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-764",
      "rank": 830,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 831,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 832,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 833,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Historical Metrics Data Persistence",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-750",
      "rank": 834,
      "size": "L",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete Metrics Page Redesign",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-749",
      "rank": 835,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-747",
      "rank": 836,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 837,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 838,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 839,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 840,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 841,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 842,
      "size": "XS",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 843,
      "size": "XS",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 844,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 845,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [
        "PAN-2356"
      ],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "rationale": "Re-derived github-ref membership and ordering this pass: PAN-2350's phase checklist reads 'Phase 4 - Shared Sessions v0 = #658, built ON the #2356 relay', so it is a child of the Anywhere epic and gated on the relay. Rank unchanged - the cross-reference is not new.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-624",
      "rank": 846,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 847,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 848,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 849,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 850,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 851,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 852,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 853,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 854,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 855,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 856,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 857,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 858,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 859,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 860,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 861,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 862,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 863,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 864,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 865,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 866,
      "size": "XS",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 867,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 868,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 869,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 870,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 871,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 872,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 873,
      "size": "XS",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 874,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-228",
      "rank": 875,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 876,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Phase gate validation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 877,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-190",
      "rank": 878,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 879,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 880,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 881,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 882,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-146",
      "rank": 883,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 884,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 885,
      "size": "XS",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 886,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 887,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 888,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 889,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 890,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2347",
      "rank": 891,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2346",
      "rank": 892,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2345",
      "rank": 893,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2344",
      "rank": 894,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2343",
      "rank": 895,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2073",
      "rank": 896,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2071",
      "rank": 897,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2070",
      "rank": 898,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2068",
      "rank": 899,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2067",
      "rank": 900,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1684",
      "rank": 901,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 902,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1474",
      "rank": 903,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 904,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-674",
      "rank": 905,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-634",
      "rank": 906,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 907,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 908,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make overdeck not suck",
      "gate": "auto",
      "planning": "interactive"
    }
  ],
  "edges": [
    {
      "from": "PAN-2075",
      "to": "PAN-2077",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2078",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2079",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2080",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-1775",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-454",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-1436",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-1868",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2466",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-1042",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-570",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-106",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2079",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1775",
      "to": "PAN-2077",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2078",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2079",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2080",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2077",
      "to": "PAN-454",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2466",
      "to": "PAN-1868",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2642",
      "to": "PAN-570",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2874",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2883",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2742",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2695",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2932",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2422",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2957",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1936",
      "to": "PAN-2008",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1988",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1910",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2259",
      "to": "PAN-2880",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2846",
      "to": "PAN-2888",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2331",
      "to": "PAN-2639",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2905",
      "to": "PAN-2259",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2642",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2350",
      "to": "PAN-3762",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3682",
      "to": "PAN-3685",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-1641",
      "to": "PAN-3684",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3301",
      "to": "PAN-3631",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3563",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3560",
      "to": "PAN-3563",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3561",
      "to": "PAN-3564",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3564",
      "to": "PAN-3565",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3541",
      "to": "PAN-3543",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2580",
      "to": "PAN-3536",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3499",
      "to": "PAN-3504",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3502",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2350",
      "to": "PAN-3513",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3460",
      "to": "PAN-3463",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3424",
      "to": "PAN-3651",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3454",
      "to": "PAN-3517",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3306",
      "to": "PAN-3317",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3289",
      "to": "PAN-3627",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3308",
      "to": "PAN-3322",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3282",
      "to": "PAN-3283",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3244",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3256",
      "to": "PAN-3267",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3274",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3270",
      "to": "PAN-3325",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3697",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3235",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3224",
      "to": "PAN-3439",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3186",
      "to": "PAN-3256",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3176",
      "to": "PAN-3179",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3257",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3113",
      "to": "PAN-3234",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3113",
      "to": "PAN-3235",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3104",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2700",
      "to": "PAN-3104",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3107",
      "to": "PAN-3108",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3129",
      "to": "PAN-3130",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2828",
      "to": "PAN-3047",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3505",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3250",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3054",
      "to": "PAN-3061",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3081",
      "to": "PAN-3096",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3708",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3032",
      "to": "PAN-3174",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3118",
      "to": "PAN-3043",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2995",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3015",
      "to": "PAN-3630",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2982",
      "to": "PAN-2983",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3771",
      "to": "PAN-2981",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2977",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2978",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2977",
      "to": "PAN-2978",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2351",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2352",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2353",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2354",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2355",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2356",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2352",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2353",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2354",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2352",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3566",
      "to": "PAN-2706",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3113",
      "to": "PAN-2492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-1824",
      "to": "PAN-2421",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-1824",
      "to": "PAN-3243",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-1711",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-1711",
      "to": "PAN-2905",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2828",
      "to": "PAN-3047",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1641",
      "to": "PAN-3011",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-465",
      "to": "PAN-3011",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-1166",
      "to": "PAN-2351",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1592",
      "to": "PAN-2083",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-750",
      "to": "PAN-769",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1984",
      "to": "PAN-1988",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-2350",
      "to": "PAN-658",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1983",
      "to": "PAN-1984",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-2356",
      "to": "PAN-658",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3861",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3862",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3863",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3864",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3762",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3917",
      "to": "PAN-2350",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3903",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3895",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3896",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3914",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3898",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3909",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3837",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3843",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3853",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3868",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3892",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3911",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3866",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3917",
      "to": "PAN-3864",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3896",
      "to": "PAN-3895",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3903",
      "to": "PAN-3914",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3903",
      "to": "PAN-3909",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3903",
      "to": "PAN-3896",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3903",
      "to": "PAN-3898",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3899",
      "to": "PAN-3898",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3899",
      "to": "PAN-3905",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-900",
      "to": "PAN-3905",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3854",
      "to": "PAN-3866",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3843",
      "to": "PAN-3866",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3843",
      "to": "PAN-3854",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3843",
      "to": "PAN-3853",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3837",
      "to": "PAN-3843",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-3853",
      "to": "PAN-3852",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3852",
      "to": "PAN-3868",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-3855",
      "to": "PAN-3868",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-3762",
      "to": "PAN-3863",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3762",
      "to": "PAN-3862",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3762",
      "to": "PAN-3861",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3861",
      "to": "PAN-3862",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3861",
      "to": "PAN-3864",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3862",
      "to": "PAN-3864",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3513",
      "to": "PAN-3861",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3513",
      "to": "PAN-3862",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3513",
      "to": "PAN-3864",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-3513",
      "to": "PAN-3863",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-2351",
      "to": "PAN-3862",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-2351",
      "to": "PAN-3863",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-2609",
      "to": "PAN-3863",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-2350",
      "to": "PAN-3861",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-3862",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-3863",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3827",
      "to": "PAN-3831",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3830",
      "to": "PAN-3831",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-3783",
      "to": "PAN-3829",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3833",
      "to": "PAN-3893",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    },
    {
      "from": "PAN-3668",
      "to": "PAN-3901",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.5
    }
  ]
}
```
