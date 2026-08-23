# Backlog Sequence

_Last sequenced: 2026-08-23T08:27:51Z · model: claude-opus-5 · open: 862_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3679 | S | critical | ok |  |  | Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running |
| 2 | PAN-3285 | M | critical | ok |  |  | Supervisor pinned to a reload generation SIGTERMs every healthy dashboard and cannot start one — 3.5h outage |
| 3 | PAN-3740 | XS | critical | ok |  |  | Red main: lint:slash-commands finds composer-manifest drift (handoff cap 500 vs 10000) — every merge blocked until regenerated |
| 3 | PAN-3539 | XS | critical | ok |  |  | OOMPolicy=stop lets one OOM-killed child fail the whole tmux unit — every agent session lost at once |
| 4 | PAN-3250 | S | critical | ok |  |  | Workspaces branch from local HEAD instead of origin/main, so every new branch inherits unpushed local main commits |
| 4 | PAN-3690 | S | high | ok |  |  | Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit |
| 5 | PAN-2746 | XS | critical | ok |  | PAN-2742, PAN-2695 | infra-failure bypass writes reviewStatus='passed' |
| 6 | PAN-3566 | XS | critical | ok |  |  | Test-role launcher execs claude with no prompt, booting an idle REPL — the deterministic cause of zombie test agents |
| 7 | PAN-3524 | M | critical | ok |  |  | Server-owned --changed verification loop survives freeze, review abort, pause and operator-stop; blocked a red-main fix |
| 8 | PAN-2689 | S | critical | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost |
| 9 | PAN-3630 | S | critical | ok |  |  | pan tell moves messages to read/ and reports delivery while the agent receives nothing — silent message loss |
| 10 | PAN-3554 | S | critical | ok |  |  | Red main has no mechanical owner: a failed main-push run sat unnoticed 5h with no escalation or strike |
| 11 | PAN-3283 | S | critical | ok |  |  | Recovering from review_infrastructure_failure sets review_status=passed over an outstanding CHANGES REQUESTED |
| 12 | PAN-3761 | M | critical | ok |  |  | Ready-to-merge issues never form a UAT train: durable review status re-dispatch loop yanks members from the queue |
| 12 | PAN-3685 | S | high | ok |  |  | Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed |
| 13 | PAN-3657 | S | critical | ok |  |  | Merge-train queues endpoint drops every polyrepo candidate, so MYN and Auricle trains are permanently empty |
| 14 | PAN-3561 | S | critical | ok |  |  | Ownerless state-git lock is immortal — a crash between mkdir and owner.json bricks a project's write door |
| 15 | PAN-3532 | S | critical | ok |  |  | CI never runs the full frontend suite — main was red on frontend for hours while every run reported green |
| 16 | PAN-3424 | M | critical | ok |  |  | State plane silently stops being durable: non-FF overdeck-state pushes unreconciled, drafts/ PRDs never staged |
| 18 | PAN-3564 | S | critical | ok |  |  | Per-issue record lock held across the global state-git wait — 100% duty cycle, reviewer spawns die with no retry |
| 19 | PAN-3687 | S | critical | ok |  |  | pan done prints success while no durable review handler exists — verification silently never starts |
| 20 | PAN-3631 | S | high | ok |  |  | Sequencer reads its prior from legacy .pan/backlog/sequence.md while writes go to overdeck-state — prior frozen at Jul 20 |
| 21 | PAN-3520 | S | critical | ok |  |  | Test gate records verdicts from load-induced timeout-only failures; retry them in isolation before deciding |
| 22 | PAN-3313 | S | critical | ok |  |  | A transient upstream stream error benches CLIProxy's only auth — ~70% of GPT-routed requests 503 auth_unavailable |
| 23 | PAN-3282 | M | critical | ok |  |  | Review agents die before writing a verdict across 5 issues and 2 projects, leaving a stuck flag and no artifact |
| 24 | PAN-3492 | S | critical | ok |  |  | Server-side gate retries self-amplify: timeouts trigger retries that raise load and cause more timeouts |
| 25 | PAN-3281 | S | critical | ok |  |  | ready_for_merge stays 1 while an issue is stuck on incomplete plan items, so unfinished work reaches the UAT batch |
| 26 | PAN-3234 | S | critical | ok |  |  | Agents freeze on blocking choice menus with no health detection — the check is wired only to delivery refusal |
| 28 | PAN-3682 | S | high | ok |  |  | Migrated polyrepo slot pan done writes a legacy workspace record path and crashes, stalling swarm reconciliation |
| 29 | PAN-3498 | S | high | ok |  |  | write-sequence pins in-pipeline ranks without renumbering, leaving 11 duplicate ranks and 11 gaps in the sequence |
| 30 | PAN-3429 | S | critical | ok |  |  | Memory governor only defers admissions under HARD pressure and never sheds — PSI 41.9 with 2.2GB left |
| 31 | PAN-3314 | M | critical | ok |  |  | One cgroup holds every agent pane, so a single hungry agent's OOM can take down the whole fleet |
| 32 | PAN-3278 | S | critical | ok |  |  | Work finished with an open PR but review was never dispatched — auto-requeue had 25 attempts and fired none |
| 33 | PAN-3248 | S | critical | ok |  |  | pan reload leaves pending-deploy.json set, so every project's verification stalls until a patrol notices |
| 34 | PAN-3085 | XS | critical | ok |  |  | Review feedback is written to .overdeck/feedback while agents and the merge gate read a nonexistent .pan/feedback |
| 35 | PAN-3062 | S | critical | ok |  |  | The shared primary main worktree stacks every session's commits, so whoever pushes main ships everyone else's work |
| 37 | PAN-3560 | M | high | ok |  |  | PTY supervisor overloads under review convoys: fleet-wide 502 echo-confirmation failures kill resumes and feedback |
| 38 | PAN-3301 | S | high | ok |  |  | Backlog manifest still writes the legacy .pan path; the stray-writer patrol logs 68k lines hiding that defect |
| 39 | PAN-3237 | S | critical | ok |  |  | A capacity-refused planning→work handoff is marked terminally stuck: every 409 becomes 'guardrails' and stuck |
| 40 | PAN-3100 | S | critical | ok |  |  | The test role evaluates the dirty working tree, so a live agent's uncommitted edits produce false test failures |
| 41 | PAN-2954 | XS | critical | ok |  |  | postMergeLifecycle refuses GitLab projects |
| 43 | PAN-3653 | S | high | ok |  |  | A strike stopped by red main never wakes when main goes green — no recovery path, strike sits idle forever |
| 44 | PAN-3605 | XS | high | ok |  |  | lint-effect-diagnostics npx fell back to the registry and executed a squatted package — pin the local bin |
| 45 | PAN-3236 | S | critical | ok |  |  | ECONNREFUSED on a dead supervisor socket reads as ambiguous keyed delivery, so review feedback never lands |
| 46 | PAN-3205 | S | critical | ok |  |  | The deployment gate queues a deferred deploy and promises a next-verification-boundary trigger that does not exist |
| 47 | PAN-3118 | S | critical | ok |  |  | Model quota exhaustion halts agents invisibly — four planning agents 'running' at $0.00 with no capacity fallback |
| 48 | PAN-3106 | S | critical | ok |  |  | auto_merge_default: hold is consulted on one merge path only, so held issues still auto-merge individually |
| 49 | PAN-3084 | S | critical | ok |  |  | A review session spawned but never briefed sits at zero context forever and blocks its own replacement |
| 50 | PAN-3057 | S | critical | ok |  |  | Harness-initiated compaction is invisible to every recovery path, and the GPT-5.6 window is declared twice |
| 51 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume |
| 51 | PAN-3580 | S | high | ok |  |  | UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL |
| 52 | PAN-3677 | M | high | ok |  |  | Planning agents wedge after a background Explore task finishes; parent never consumes the result |
| 52 | PAN-2742 | S | high | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' |
| 53 | PAN-3734 | M | high | ok |  |  | Reused completed swarm slot can start a new item from a stale polyrepo branch — silent wrong-base work |
| 54 | PAN-3633 | S | high | ok |  |  | Strike workspaces get an incomplete dep tree, so typecheck:evals fails and agents abort on a false 'main is red' |
| 56 | PAN-3563 | S | high | ok |  |  | Role agent with an undelivered prompt stays 'running' forever; dispatcher no-ops and pan unstick can't see it |
| 57 | PAN-3543 | S | high | ok |  |  | Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while recommending --fresh |
| 58 | PAN-3103 | S | critical | ok |  |  | A transient merge_status=failed skips close-out permanently, leaving merged work open and pickup-eligible |
| 59 | PAN-3078 | S | critical | ok |  |  | Inspect verdicts are persisted but never delivered, so a work agent that waits for one deadlocks forever |
| 60 | PAN-3043 | S | critical | ok |  |  | Mid-run provider quota exhaustion is undetected: an agent stays 'running' for days holding a slot at a 403 wall |
| 61 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch |
| 62 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json |
| 63 | PAN-2733 | S | high | ok |  |  | substrate-bug-poller has never run |
| 64 | PAN-1560 | XS | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 65 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes |
| 66 | PAN-2828 | S | critical | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 67 | PAN-2874 | M | critical | ok |  | PAN-2828 | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli… |
| 68 | PAN-2883 | M | high | ok |  | PAN-2828 | Close-out deploy row fails for every strike-landed issue |
| 69 | PAN-2806 | S | high | ok |  |  | strike merge trigger registry splits across dashboard chunks |
| 70 | PAN-2796 | S | high | ok |  |  | idle nudge must not advance after failed mandatory inspection |
| 71 | PAN-2940 | M | critical | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI |
| 72 | PAN-3697 | XS | high | ok |  |  | Deployed dashboard PATH omits Bun, so verification workers fail their dependency-install gate |
| 73 | PAN-3654 | S | high | ok |  |  | Compact respawn confirms against the archived session and kills the fresh agent that already accepted recovery |
| 74 | PAN-3621 | S | high | ok |  |  | pan start dies at spawn on a chunk graph spliced across two builds — silent module-not-found, retry succeeds |
| 75 | PAN-3522 | S | high | ok |  |  | Supervisor watchdog restart-churns under CPU storm because the probe budget ignores the boot warm phase |
| 76 | PAN-3496 | XS | high | ok |  |  | A review convoy member blocked on an operator AskUserQuestion; review and inspect roles must decide, not ask |
| 77 | PAN-3344 | M | high | ok |  |  | Resource governor gates only on memory; CPU load storms from concurrent agent test runs go unchecked |
| 78 | PAN-3274 | S | high | ok |  |  | A test-role agent can spawn and never run a turn, stranding its issue behind a verdict that never existed |
| 79 | PAN-3244 | S | high | ok |  |  | A queued dashboard deploy defers verification globally, starving cross-project review handoffs for 30+ minutes |
| 80 | PAN-2932 | S | high | ok |  | PAN-2337 | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 81 | PAN-2935 | S | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router |
| 82 | PAN-2337 | XS | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 83 | PAN-2422 | XS | high | ok |  | PAN-2337 | rebuilding dist under a live server breaks lazy chunk imports |
| 84 | PAN-2699 | XS | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle |
| 85 | PAN-2957 | XS | high | ok |  | PAN-2337 | npm run build intermittently produces stale frontend bundles |
| 86 | PAN-2850 | M | high | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 87 | PAN-2758 | S | critical | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 88 | PAN-2886 | M | high | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 89 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 90 | PAN-2813 | M | high | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 91 | PAN-2848 | S | critical | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a… |
| 92 | PAN-2846 | S | critical | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 93 | PAN-3650 | S | high | ok |  |  | Strike self-abort leaves state.json running, so every deacon recovery pass resurrects the aborted strike |
| 94 | PAN-3571 | XS | high | ok |  |  | Stop-hook completion check exits silently on timeout — 334 stranded turn-ends with no nudge or escalation |
| 95 | PAN-3329 | S | high | ok |  |  | Dev-checkout builds delete the deployment generation's node_modules and tracked packages/ files (2nd occurrence) |
| 96 | PAN-2747 | S | high | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 97 | PAN-2759 | S | high | ok |  |  | Dead flywheel with an active run was never auto-relaunched after a reboot |
| 98 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target |
| 99 | PAN-2668 | M | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents |
| 100 | PAN-2569 | XS | critical | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn |
| 101 | PAN-2567 | S | critical | ok |  |  | reviewed+green PR stuck after review |
| 102 | PAN-2179 | S | high | ok |  |  | relaunch can leave a zombie agent |
| 103 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS |
| 104 | PAN-2775 | S | high | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04… |
| 105 | PAN-2734 | S | high | ok |  |  | merge queue head-of-line zombie |
| 106 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 107 | PAN-3708 | S | high | ok |  |  | pan strike dies on polyrepo wrappers before worktree provisioning — the urgent-unblock path is unavailable there |
| 108 | PAN-3622 | XS | high | ok |  |  | orphan-proposed-reconciler test asserts on a real GitHub issue; its closure now reds pan release check on a green main |
| 109 | PAN-3565 | M | high | ok |  |  | Review lifecycle: failed spawn wedges 'starting', infra-failure fabricates a CHANGES REQUESTED verdict, pan tell hangs |
| 110 | PAN-3541 | S | high | ok |  |  | Review restart after unclean reviewer death loops on the session-resume menu; eligibility ignores how it ended |
| 111 | PAN-3397 | S | high | ok |  |  | Freshly-spawned convoy lanes freeze at 0 output; the PAN-3375 detector only covers warm resumes |
| 112 | PAN-3270 | S | high | ok |  |  | New workspaces arrive with empty node_modules and bun off PATH, so the documented bun install remedy fails |
| 113 | PAN-3188 | S | high | ok |  |  | DoD row 5 accepts only the transient verifying_on_main waypoint, so an already-done issue can never close out |
| 114 | PAN-3139 | S | high | ok |  |  | Agents-table liveness drifts stale toward 'stopped' for live agents, and pan start's refusal contradicts it |
| 115 | PAN-3104 | S | high | ok |  |  | Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix landed |
| 116 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery |
| 117 | PAN-2888 | M | high | ok |  | PAN-2846 | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO… |
| 118 | PAN-2960 | S | high | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict |
| 119 | PAN-2959 | S | high | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit |
| 120 | PAN-2639 | S | high | ok |  | PAN-2331 | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 121 | PAN-2331 | S | high | ok |  |  | codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) |
| 122 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully |
| 123 | PAN-2511 | XS | high | ok |  |  | Work agents burn 20+ min on false test failures |
| 124 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 125 | PAN-3569 | S | high | ok |  |  | Stale pending-post-merge.json deadlocks the deploy gate with no staleness rule and no non-force exit |
| 126 | PAN-3325 | S | high | ok |  |  | Fresh workspaces ship an empty node_modules, so tooling silently resolves deps from the parent repo |
| 127 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push |
| 128 | PAN-2763 | S | high | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution |
| 129 | PAN-2170 | XS | high | ok |  |  | Docker init container lacks Python |
| 129 | PAN-3689 | S | medium | ok |  |  | Orphaned swarm-slot GC targets the aggregate polyrepo root; nested worktrees survive and spam failures |
| 130 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 131 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 132 | PAN-2880 | M | high | ok |  | PAN-2259 | Linear tracker listIssues is a 3N+1 request storm |
| 133 | PAN-2966 | S | high | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev |
| 134 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 135 | PAN-2680 | M | high | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 136 | PAN-3667 | M | high | ok |  |  | CLIProxy has no cross-family remap, so every model-pinned subagent dies at spawn inside proxied GPT sessions |
| 137 | PAN-3651 | S | high | ok |  |  | Re-land the reverted overdeck-state non-fast-forward push retry with the pan-dir state-door suites green |
| 138 | PAN-3617 | S | high | ok |  |  | Three strike dispatches produced zero output and zero transcript while a sibling strike ran normally |
| 139 | PAN-3555 | S | high | ok |  |  | Plain pan start spawned a FRESH session over a resumable warm one — warm-by-default silently violated |
| 140 | PAN-3535 | S | high | ok |  |  | Drain hold lives in the caller's env, so any restart from a clean shell silently drops the no-resume gate |
| 141 | PAN-3500 | S | high | ok |  |  | A review sub-role resumed after writing its report and edited the branch, breaking the read-only review contract |
| 142 | PAN-3499 | XS | high | ok |  |  | pan parked ack calls ProjectConfig.projectPath, which does not exist — a tsc error landed on main |
| 143 | PAN-3464 | XS | high | ok |  |  | pan swarm reset never clears slotCompletions, so a stale marker re-arms the exact wedge the operator just cleared |
| 144 | PAN-3297 | S | high | ok |  |  | After a dashboard restart pan tell calls healthy supervisor-run agents zombies while resume calls them healthy |
| 145 | PAN-3257 | S | high | ok |  |  | Crash-resume leaves a stale PTY socket and drops supervisorEnabled, so every delivery afterwards is refused |
| 146 | PAN-3190 | XS | high | ok |  |  | pan merge cancel has never worked: Commander's options object lands in the fetchImpl injection slot |
| 147 | PAN-3179 | S | high | ok |  |  | A UAT promote completes at merge time with no production evidence, so members read shipped while prod serves the old build |
| 148 | PAN-3168 | XS | high | ok |  |  | DoD row 5 counts an agent paused for close-out as running, deadlocking the close-out that paused it |
| 149 | PAN-3081 | S | high | ok |  |  | The agent git guard is PATH-based and removable by the agent it constrains — one did so unprompted |
| 150 | PAN-3044 | S | high | ok |  |  | Review feedback delivery runs against closed issues, resurrecting agents and raising needs-you days after close-out |
| 151 | PAN-3040 | S | high | ok |  |  | pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects |
| 152 | PAN-3023 | S | high | ok |  |  | Post-planning auto-spawn is abandoned on a transient Docker failure — 'attempt 1/3' never retries and nothing re-drives |
| 153 | PAN-3022 | XS | high | ok |  |  | The work-spawn route ignores the per-issue workModel override, then clobbers the record with the role default |
| 154 | PAN-1711 | S | high | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 155 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover |
| 156 | PAN-2324 | XS | high | ok |  |  | label transition fails atomically on missing 'in-planning' label |
| 157 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans… |
| 158 | PAN-2905 | S | high | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s |
| 159 | PAN-2259 | S | critical | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota |
| 160 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 161 | PAN-2421 | XS | high | ok |  |  | dashboard server route tests flake under full-suite verification load |
| 162 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 163 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH |
| 164 | PAN-2656 | S | high | ok |  |  | deacon-swarm unit tests read live ~/.overdeck/config.yaml |
| 165 | PAN-3596 | S | high | ok |  |  | Deacon patrol has no per-step timing, so overruns in the central scheduler cannot be attributed to a step |
| 166 | PAN-3505 | S | high | ok |  |  | Unpushed agent code commits on the primary main worktree make the guard refuse the flywheel's state push |
| 167 | PAN-3439 | XS | high | ok |  |  | pan start crashes on a pending-work-spawn placeholder row instead of taking the fresh-spawn path resume already guards |
| 168 | PAN-1824 | S | high | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 169 | PAN-2075 | XL | high | ok | ✓ |  | Boot Reconciliation + Operator Inbox |
| 170 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) |
| 171 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 172 | PAN-2079 | M | high | ok |  | PAN-2077 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 173 | PAN-2080 | M | high | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) |
| 174 | PAN-1775 | M | high | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 175 | PAN-454 | XS | high | ok |  | PAN-2077 | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 176 | PAN-1436 | S | high | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 176 | PAN-3668 | L | medium | ok |  |  | Add Prime Agent as a managed harness (in flight — RPC runtime adapter, discovery, transcripts) |
| 177 | PAN-3634 | XS | high | ok |  |  | Planning auto-handoff stamps the ambient flywheelRunId on operator-started agents, stripping reaping exemption |
| 178 | PAN-3556 | S | high | ok |  |  | Two spawn flows raced the same agent at UAT promote and allocated two fresh session identities 3s apart |
| 179 | PAN-3517 | M | high | ok |  |  | Convoy forks still miss the parent prompt cache: launch-injection byte drift plus resume dropping the scope header |
| 180 | PAN-3432 | S | high | ok |  |  | Preemptive yield fans out: seven work agents paused to make room for one review convoy |
| 181 | PAN-3317 | XS | high | ok |  |  | Strike agents have no sanctioned main sync: rebase is guard-blocked and pan sync-main can't resolve -strike workspaces |
| 182 | PAN-3306 | S | high | ok |  |  | Strike rebase has no working path: the role prompt tells it to, the launcher guard blocks it, sync-main resolves elsewhere |
| 183 | PAN-3289 | S | high | ok |  |  | Sequencer ran a full pass on a transiently empty manifest while the tracker held ~750 open issues |
| 184 | PAN-3280 | S | high | ok |  |  | One issue's agent sessions vanished four times in a single run, each recovery needing a manual pan start |
| 185 | PAN-3261 | S | high | ok |  |  | tmux fallback answers a live resume-choice menu its own paste hid from the detector, silently compacting the session |
| 186 | PAN-3256 | XS | high | ok |  |  | MYN pipeline membership reports forge_unavailable because glab runs in the polyrepo root, which is not a git repo |
| 187 | PAN-3224 | XS | high | ok |  |  | A crash-interrupted spawn strands model 'pending-work-spawn'; plain pan start dies and only --fresh recovers |
| 188 | PAN-3186 | S | high | ok |  |  | One configured member that is not a git repo blanks pipeline membership for the whole auricle project |
| 189 | PAN-3174 | S | high | ok |  |  | Every polyrepo UAT stack 504s: stale myn- Traefik prefix, Traefik off the devnet, and a 4173/5173 port mismatch |
| 190 | PAN-3120 | S | high | ok |  |  | MERGE refuses or dead-ends when the preemptive scheduler yielded the work agent the merge path requires |
| 191 | PAN-3096 | XS | high | ok |  |  | pan done fails on the generated devcontainer harness, so agents infer they should delete workspace infrastructure |
| 192 | PAN-3077 | XS | high | ok |  |  | Inspect/review-supervisor spawns omit --effort and inherit the harness xhigh default, once per xBRIEF item |
| 193 | PAN-3047 | S | high | ok |  |  | --is-ancestor can't see a squash merge, so strike-branch teardown never fires and 96 strike/* branches persist |
| 194 | PAN-3012 | S | high | ok |  |  | Archived conversations die when the harness deletes its JSONL — back transcripts up before that happens |
| 195 | PAN-2995 | XS | high | needs-refinement |  |  | Same squash-merge ancestry defect as PAN-2828: pan done --strike false-blocks after a gh-API squash merge |
| 196 | PAN-2642 | XL | high | ok | ✓ |  | Cost strategy: waste detection over budget policing |
| 197 | PAN-1868 | XS | high | ok |  | PAN-2466 | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 198 | PAN-2466 | S | high | ok |  |  | close-out/record writer clobbers closeOut.usage with EMPTY data |
| 199 | PAN-1042 | S | high | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 200 | PAN-570 | XS | high | ok |  | PAN-2642 | Show PLAN badge on costs when under a subscription/plan |
| 201 | PAN-106 | M | high | stale |  |  | Cost prediction/estimation for in-progress work |
| 202 | PAN-2059 | XL | high | ok | ✓ |  | Backlog pickup gate |
| 203 | PAN-2376 | XL | high | ok | ✓ |  | Epic: CI/CD reliability |
| 204 | PAN-3557 | XS | high | ok |  |  | Post-merge label application has no retry; a rate-limited 403 hides the issue from the verify-on-main sweep |
| 205 | PAN-2351 | XS | high | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 206 | PAN-3629 | M | high | ok |  |  | No sanctioned door to re-scope a live agent, so rejected in-flight designs can still land |
| 207 | PAN-3553 | S | high | ok |  |  | Census treats a zero-session tmux server as unavailable, so post-reboot conversations sit on 'Starting…' for minutes |
| 208 | PAN-3460 | S | high | ok |  |  | Per-item verify_commands run the whole root suite, making slot merge gates load-fragile and expensive |
| 209 | PAN-3355 | XS | high | ok |  |  | sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is actually unknown |
| 210 | PAN-3308 | XS | high | ok |  |  | The file-size guard prints a paste-ready ceiling-raise line, so agents ratchet the limit instead of shrinking the file |
| 211 | PAN-3295 | M | high | ok |  |  | One per-machine completion-check summarizer with a queue — today's unbounded haiku fan-out froze the box |
| 212 | PAN-3284 | S | high | ok |  |  | A work agent's file write landed in the primary main worktree; the guard covers commits and pushes, not writes |
| 213 | PAN-3267 | S | high | ok |  |  | GitLab merged-head oracle spawns one glab subprocess per repo×head, so every pipeline-membership refresh fails |
| 214 | PAN-3185 | XS | high | ok |  |  | pan start reports a hard failure when the deacon wins the spawn race — duplicate-session TOCTOU inside spawn.ts |
| 215 | PAN-3171 | S | high | ok |  |  | Pipeline reports 'merge failed' after a successful merge and cleanup, leaving the issue Todo with the commit on main |
| 216 | PAN-3129 | S | high | ok |  |  | Security: an agent can plant a symlink in its workspace and steer the next canonical write outside its root |
| 217 | PAN-3050 | XS | high | ok |  |  | Idle-stack reaper matches only overdeck-feature-* names, so MYN stacks hold GBs of RAM long after their agents die |
| 218 | PAN-3048 | XS | high | ok |  |  | Pipeline auto-commit lands .pan/drafts/<issue>.md in product feature branches; the exclusion list has drifted |
| 219 | PAN-3015 | L | high | ok |  |  | pan monitor: a pull-based background inbox transport, replacing keystroke injection as the delivery path |
| 220 | PAN-2971 | S | high | ok |  |  | Flywheel orchestrator finalized its own run and kept ticking for 19h as a zombie with Pause/Stop disabled |
| 221 | PAN-1767 | M | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 222 | PAN-3760 | S | high | ok |  |  | permissionMode 'auto' maps to --permission-mode default; invalid values drop silently, operator gets unexpected prompts |
| 223 | PAN-3570 | S | high | ok |  |  | Root-owned node_modules/.pnpm-store from container runs EACCES-blocks pan start; workspace rebuild no-ops |
| 224 | PAN-3536 | XS | high | ok |  |  | pan tell can't reach ohmypi conversations: expectedHarness defaults to claude-code when state.json is absent |
| 225 | PAN-3513 | L | high | ok |  |  | Agent runtime plane on overdeck-state: durable session pointers and GC-as-cache-eviction — the Anywhere data plane |
| 226 | PAN-3454 | S | high | ok |  |  | Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated cache warnings, double-billed spend |
| 227 | PAN-3303 | S | high | ok |  |  | An empty registered-projects response is treated as authoritative, latching Command Deck on 'Unknown project' |
| 228 | PAN-3243 | XS | high | ok |  |  | auto-commit test polls a fixed 20 setImmediate turns for a real git subprocess — flakes main and blocks close-out |
| 229 | PAN-3196 | S | high | ok |  |  | Close-out passes every DoD row then dies on EACCES removing root-owned container residue in the workspace |
| 230 | PAN-3176 | S | high | ok |  |  | UAT batch promotion takes no health evidence, so a degraded or still-booting stack can be promoted to main |
| 231 | PAN-3099 | XS | high | ok |  |  | pan restart --health-timeout 120 is enforced as 120ms, false-failing the probe and leaving the dashboard down |
| 232 | PAN-3032 | S | high | ok |  |  | Stack rebuild composes under overdeck-feature- while Traefik labels name myn-feature- devnet; attaches are runtime-only |
| 233 | PAN-2980 | XS | high | ok |  |  | The pre-push file-size guard audits the dirty working tree, so another session's edits block unrelated pushes |
| 234 | PAN-3518 | M | high | needs-refinement |  | PAN-3517 | TTL-aware re-review payload policy: fresh-spawn-with-digest for cold, large histories (needs-design) |
| 235 | PAN-3463 | S | high | ok |  |  | A legitimate no-op slot outcome can never satisfy its item verify_commands, so the slot wedges permanently |
| 236 | PAN-3218 | S | high | ok |  |  | No release-drift signal: a user-facing fix can sit merged on main while every published version stays broken |
| 237 | PAN-3210 | S | high | ok |  |  | Teardown scopes containers by compose project while the guard scopes by working_dir, so close-out blocks on residue |
| 238 | PAN-3113 | M | high | ok |  |  | Surface agent-pane choice prompts as inline decision cards so a blocked agent is answerable without the terminal |
| 239 | PAN-3762 | XL | high | ok |  |  | Overdeck Anywhere: federate one dashboard client across per-machine Overdeck servers (t3code model) |
| 241 | PAN-3130 | S | high | ok |  |  | Security: identifier-joined write paths have no mechanical containment under their intended root |
| 242 | PAN-3652 | XS | high | ok |  |  | Add workflow_dispatch to ci.yml and state-plane-branches.yml so a never-run main tip can be verified on demand |
| 243 | PAN-3533 | L | high | ok |  |  | Per-project resource isolation classes so one project's stacks cannot starve another project's pipeline |
| 244 | PAN-3510 | S | medium | ok |  |  | Stopped agents leave detached docker-run test containers alive for hours, contending with other gates |
| 245 | PAN-3167 | S | medium | ok |  |  | krux and lexerra are permanently unreadable: the App isn't installed on them and 404 is typed as forge_unavailable |
| 246 | PAN-3108 | XS | medium | ok |  |  | dashboard.log grows unbounded (867MB) with no rotation, costing disk and making incident logs un-greppable |
| 247 | PAN-3046 | XS | medium | ok |  |  | pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out |
| 248 | PAN-3701 | L | high | ok |  |  | Four unrelated first-party LLM client stacks; consolidate onto effect/unstable/ai LanguageModel + ExecutionPlan |
| 249 | PAN-3579 | S | medium | ok |  |  | Audit frontend mutations that hand-write JSON headers and so omit the CSRF token, 403ing guarded routes |
| 250 | PAN-3527 | XS | medium | ok |  |  | One failed boot-time fetch leaves the sidebar at CONVERSATIONS 0 / ISSUES 0 with no retry until manual reload |
| 251 | PAN-3321 | XS | medium | ok |  |  | Escalation copy and CLAUDE.md tell operators to run pan unstick, which errors as an unknown command |
| 252 | PAN-3245 | XS | medium | ok |  |  | pan done flags the generated .pan/drafts/<issue>.md as uncommitted work despite its own .pan exclusion |
| 253 | PAN-3094 | XS | medium | ok |  |  | pan done's merge fallback still force-pushes a branch a normal push would fast-forward, half-completing the command |
| 254 | PAN-3003 | XS | medium | ok |  |  | Generated launcher.sh omits the OVERDECK_AGENT_ID export the PTY supervisor hard-requires, so manual re-launch dies |
| 255 | PAN-3445 | XS | medium | ok |  |  | projects.yaml TCP lock ports overlap the ephemeral client range, so uncontended config writes randomly fail |
| 256 | PAN-3332 | S | medium | ok |  |  | Dashboard slash-command activities leave 'running in background' standing after the spawn already died |
| 257 | PAN-3288 | XS | medium | ok |  |  | Dev-checkout preflight should say 'run bun install' instead of dying on a raw ERR_MODULE_NOT_FOUND after git pull |
| 258 | PAN-3181 | L | high | ok |  |  | Own agent memories: migrate harness project memories to a per-repo overdeck-memory orphan branch so they travel |
| 259 | PAN-3107 | S | medium | ok |  |  | Productize the memory-attribution census so OOM spikes remain attributable after the fact |
| 260 | PAN-3013 | XS | medium | ok |  |  | Role-scoped linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp paths |
| 260 | PAN-3751 | S | medium | ok |  |  | Post-merge deploy runs a multi-minute build with no dashboard indication — operator reads a silent deploy as a lost notification |
| 261 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline Throughput Hardening |
| 262 | PAN-1556 | S | high | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 263 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 264 | PAN-2189 | L | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) |
| 265 | PAN-2190 | L | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) |
| 266 | PAN-2233 | L | high | ok |  |  | decompose merge-agent.ts (1,414 lines) into focused modules |
| 267 | PAN-2526 | M | high | ok |  |  | Refactor deacon.ts below file-size baseline |
| 268 | PAN-2008 | XS | high | ok |  | PAN-1936 | store-access guard |
| 269 | PAN-1936 | M | high | ok |  |  | Single source-of-truth reads |
| 270 | PAN-3420 | M | high | ok |  |  | Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe) |
| 270 | PAN-1988 | M | high | ok |  | PAN-1936 | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 271 | PAN-1910 | XS | high | ok |  | PAN-1936 | fast-follow(PAN-1908): collapse issue status to ONE canonical field |
| 272 | PAN-1325 | M | high | ok |  |  | Artifact storage model is unsafe for polyrepo projects |
| 273 | PAN-1728 | S | high | ok |  |  | PAN-1700 agent committed .pan/specs/*.vbrief.json mutations |
| 274 | PAN-2651 | S | high | ok |  |  | simplify lifecycle reconciliation and add a safe post-planning reset |
| 275 | PAN-2678 | M | high | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 276 | PAN-2241 | S | high | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 277 | PAN-2242 | S | high | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 278 | PAN-2240 | S | high | ok |  |  | pan tell contradicts itself on dead ohmypi sessions |
| 279 | PAN-2243 | S | high | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 280 | PAN-2244 | S | high | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main |
| 281 | PAN-2202 | S | high | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion |
| 282 | PAN-2195 | M | high | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 283 | PAN-2237 | S | high | ok |  |  | pan plan done swallows vbrief quality lint details |
| 284 | PAN-2487 | M | high | ok |  |  | CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 285 | PAN-2469 | M | high | ok |  |  | issue-level assembly owner |
| 286 | PAN-2212 | M | high | ok |  |  | Swarm slot dispatch has no reserved budget |
| 287 | PAN-2213 | M | high | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 288 | PAN-2211 | M | high | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 289 | PAN-2210 | M | high | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 290 | PAN-2201 | XS | high | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo |
| 291 | PAN-2718 | M | high | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag |
| 292 | PAN-2646 | XS | high | ok |  |  | configurable global/project/issue policy UI with default OFF |
| 293 | PAN-2652 | M | high | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso… |
| 294 | PAN-2667 | M | high | ok |  |  | Reimplement the task-progress admission signal in resource discovery |
| 295 | PAN-2755 | S | high | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 296 | PAN-2754 | S | high | ok |  |  | `always` is inert |
| 297 | PAN-2809 | M | high | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 298 | PAN-2810 | M | high | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 299 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate |
| 300 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 301 | PAN-1710 | S | high | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 |
| 302 | PAN-1720 | S | high | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation |
| 303 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 304 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 305 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** |
| 306 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes |
| 307 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 308 | PAN-2266 | M | high | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 309 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 310 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks |
| 311 | PAN-687 | M | high | ok |  |  | Support OpenCode as alternative coding agent |
| 312 | PAN-466 | M | high | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 313 | PAN-465 | M | high | ok |  |  | Add OpenRouter as a model provider |
| 314 | PAN-463 | M | high | ok |  |  | Add Qwen 3.6+ model support |
| 315 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 316 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 317 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 318 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier |
| 319 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 320 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 321 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 322 | PAN-1254 | L | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 323 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 324 | PAN-1915 | M | high | ok |  |  | enhancement(security): API key at-rest hardening |
| 325 | PAN-1435 | XS | high | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 326 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 327 | PAN-1640 | M | high | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 328 | PAN-2350 | L | high | needs-refinement | ✓ |  | Epic: Overdeck Anywhere |
| 329 | PAN-1217 | XS | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 330 | PAN-1218 | M | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 331 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 332 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 333 | PAN-1451 | M | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 334 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 335 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit |
| 336 | PAN-1553 | M | high | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 337 | PAN-1504 | M | high | ok |  |  | pan hygiene |
| 338 | PAN-1480 | L | high | ok |  |  | TLDR: 93% bypass rate |
| 339 | PAN-1479 | M | high | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 340 | PAN-2950 | L | high | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 341 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 342 | PAN-2836 | M | high | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 343 | PAN-2830 | M | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in |
| 344 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve |
| 345 | PAN-2650 | L | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it |
| 346 | PAN-2549 | M | high | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 347 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 348 | PAN-2334 | XS | high | ok |  |  | write a Definition of Ready (DoR) |
| 349 | PAN-2308 | M | high | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal… |
| 350 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree |
| 351 | PAN-1984 | XS | high | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 352 | PAN-1913 | XS | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 353 | PAN-1906 | M | high | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 354 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 355 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 356 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 357 | PAN-807 | L | high | ok |  |  | Epic C: Workspace state sanity on spawn |
| 358 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 359 | PAN-471 | M | high | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 360 | PAN-438 | M | high | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 361 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 362 | PAN-176 | M | high | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 363 | PAN-578 | M | high | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 364 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 365 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep |
| 366 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 367 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run |
| 368 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 369 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik… |
| 370 | PAN-2739 | S | medium | ok |  |  | first-completion detection throws every patrol cycle |
| 371 | PAN-2738 | S | medium | ok |  |  | strikes deadlock |
| 372 | PAN-2717 | S | medium | ok |  |  | conversation permission waits missing from Awareness; strengthen alert pulse |
| 373 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 374 | PAN-2696 | XS | medium | ok |  |  | Task views still speak beads vocabulary |
| 375 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) |
| 376 | PAN-2686 | XS | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 377 | PAN-3516 | XS | medium | ok |  |  | Stale bundled-skill duplicates in repo .claude/skills shadow the canonical sync-sources copies |
| 378 | PAN-3455 | XS | medium | ok |  |  | cliproxy --version exits 2, so the up-to-date check always fails and every ensure re-downloads the release |
| 379 | PAN-3307 | XS | medium | ok |  |  | commitlint scope-enum is stale and warns on most real commits, training everyone to ignore its output |
| 380 | PAN-3276 | XS | medium | ok |  |  | NEEDS YOU rows don't navigate: clicking a terminal question or permission prompt does nothing |
| 381 | PAN-3211 | S | medium | ok |  |  | Closed-without-landing issues leave review_status residue that pan close can never honestly pass |
| 382 | PAN-3175 | M | medium | ok |  |  | Merge-train ordering derives conflict only from file overlap and cannot see that one feature requires another |
| 383 | PAN-3034 | XS | medium | ok |  |  | Command Deck session tree enumerates only workspace dirs, so strike-only and workspace-less issues show no node |
| 384 | PAN-3014 | XS | medium | ok |  |  | Background AI title/about spawns fail because claude -p --bare skips credential reads in 2.1.209 |
| 385 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 386 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck |
| 387 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 388 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 389 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 390 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 391 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations |
| 392 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 393 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 394 | PAN-2560 | M | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key |
| 395 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL |
| 396 | PAN-2550 | XS | medium | ok |  |  | npm test exits 0 despite root-suite failures |
| 397 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds |
| 398 | PAN-2546 | S | medium | ok |  |  | pan tell is codex-conversation-unaware |
| 399 | PAN-2506 | M | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 402 | PAN-3508 | XS | medium | ok |  |  | pan reload rebuilds the linked generation in place, so the global pan CLI vanishes for the whole deploy |
| 403 | PAN-3354 | XS | medium | ok |  |  | Archiving the main workspace drops the singleton row from every view with no unarchive affordance |
| 404 | PAN-3235 | S | medium | ok |  |  | Dashboard decision card should render and answer agent pane-choice menus (follow-up split out of PAN-3228) |
| 405 | PAN-3164 | XS | medium | ok |  |  | UAT stack offers 'Open UAT frontend' while still booting, so the operator gets a Gateway Timeout with no explanation |
| 406 | PAN-3121 | XS | medium | ok |  |  | Failed-send outbox never reconciles against the transcript, so a delivered message keeps a doomed Retry twin |
| 407 | PAN-3016 | M | medium | ok |  |  | URL-address every view so any place you navigate to in Overdeck can be reached again from the URL |
| 408 | PAN-2982 | XS | medium | ok |  |  | Review convoy should run a skill's own selftest when a PR touches sync-sources/skills/** |
| 409 | PAN-2501 | S | medium | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 410 | PAN-2492 | S | medium | ok |  |  | pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard |
| 411 | PAN-2491 | M | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 412 | PAN-2489 | S | medium | ok |  |  | strike agents are invisible in the project issue tree |
| 413 | PAN-2484 | S | medium | ok |  |  | ready set misses merge-eligible issues without flywheel merge verbs |
| 414 | PAN-2465 | S | medium | ok |  |  | pan done's PR lookup fails at MYN polyrepo root |
| 415 | PAN-2454 | S | medium | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero |
| 416 | PAN-2428 | XS | medium | ok |  |  | MYN workspace Traefik routing broken post-rebrand |
| 417 | PAN-2423 | XS | medium | ok |  |  | pan workspace rebuild hardcodes 'overdeck-' compose project prefix |
| 418 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen |
| 419 | PAN-2414 | S | medium | ok |  |  | context-overflow recovery is inconsistent |
| 420 | PAN-2408 | S | medium | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree |
| 421 | PAN-2395 | S | medium | ok |  |  | one invalid tiered_execution enum poisons every config read |
| 422 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream |
| 423 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice |
| 425 | PAN-3627 | XS | medium | ok |  |  | backlog-auto-trigger throws on an empty manifest, so plain npx @overdeck/core in a non-project dir stack-traces |
| 426 | PAN-3504 | XS | medium | needs-refinement |  |  | Duplicate of PAN-3499: parked.ts references ProjectConfig.projectPath, which does not exist |
| 427 | PAN-3290 | XS | medium | ok |  |  | xBRIEF items can carry empty metadata.traces, so docs items are invisible to requirement traceability |
| 428 | PAN-3157 | XS | medium | ok |  |  | Awareness feed renders the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of run activity |
| 429 | PAN-3137 | XS | medium | ok |  |  | UAT generation member titles come from the Flywheel status snapshot, leaking orchestrator prose to the operator |
| 430 | PAN-3131 | M | medium | ok |  |  | Support xBRIEF planRef sharding in planning authoring and pipeline-wide consumption for very large specs |
| 431 | PAN-3117 | XS | medium | ok |  |  | Failed-send bubble hides a deterministic 4xx reason and offers a Retry that can never succeed |
| 432 | PAN-3090 | M | medium | ok |  |  | Simple issue page: narrative feed instead of a 55KB raw kickoff dump, surface the pending question, honest blocked state |
| 433 | PAN-3036 | XS | medium | ok |  |  | Pane-idle heuristic misreads post-strike-ready idle as a pending question, showing a false ! INPUT chip |
| 434 | PAN-2981 | XS | medium | ok |  |  | Ctrl-K conversation hits 404 because the search index never prunes chunks for deleted JSONL sessions |
| 435 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed |
| 436 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) |
| 437 | PAN-2186 | S | medium | ok |  |  | post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 438 | PAN-2069 | XS | medium | ok |  |  | caveman: follow-up gaps |
| 439 | PAN-1918 | XS | medium | ok |  |  | full frontend vitest suite runs in no CI path |
| 440 | PAN-1912 | XS | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 441 | PAN-1846 | S | medium | ok |  |  | unbounded log growth |
| 442 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY |
| 443 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry |
| 444 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main |
| 445 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 446 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil… |
| 447 | PAN-1761 | S | medium | ok |  |  | conversations endpoints fetched via relative /api path |
| 448 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 449 | PAN-3616 | XS | medium | ok |  |  | Planned deploy restarts show the generic Reconnecting banner; reuse the 4503 lifecycle signal for calm copy |
| 450 | PAN-3178 | L | medium | ok |  |  | First-class worktrees and diffs: +/- changes badge, a dedicated Changes surface, conversation worktrees |
| 451 | PAN-3017 | S | medium | ok |  |  | Issue-page UAT panel should expose the full stack action menu and render consistently, including for absent stacks |
| 452 | PAN-2976 | L | medium | ok |  |  | Generalize the ACP harness so any capability-advertising ACP agent CLI is a spawnable Overdeck runtime |
| 453 | PAN-1740 | XS | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 454 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace |
| 455 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 455 | PAN-3703 | XS | low | ok |  |  | Ctrl-K: sort conversation results newest-first by the canonical recency field |
| 456 | PAN-1669 | S | medium | ok |  |  | restart-with-model doesn't emit a live event |
| 457 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness |
| 458 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr… |
| 459 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted |
| 460 | PAN-3700 | M | medium | ok |  |  | pan acp serve: expose Overdeck as an ACP agent so Zed and other ACP clients can drive conversations |
| 461 | PAN-3540 | M | medium | ok |  |  | God View: phantom agent orbs with no liveness check, dead Hook Bus panel, pressure-blind swap header |
| 462 | PAN-3502 | XS | medium | ok |  |  | tiered-crews blendedCost expectation is stale against current model-capabilities pricing |
| 463 | PAN-3132 | M | medium | ok |  |  | Adopt xBRIEF v0.9 agentic dispatch fields end-to-end, aligning with the upstream deftai/xBRIEF proposal |
| 464 | PAN-1572 | M | medium | ok |  |  | Settings permission-mode can desync from resolved config |
| 465 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted |
| 466 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 467 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 468 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 469 | PAN-1449 | S | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 470 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 471 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 472 | PAN-3530 | S | medium | ok |  |  | Four God View components poll on 30s timers, contradicting its documented /ws/rpc event-driven contract |
| 473 | PAN-3061 | M | medium | ok |  | PAN-3054 | Dispatch-topology advisor: a mechanical start-vs-swarm recommendation computed at plan finalize |
| 474 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 475 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 476 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 477 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 478 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 479 | PAN-1392 | S | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 480 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots |
| 481 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions |
| 482 | PAN-1245 | M | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 483 | PAN-1244 | M | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 484 | PAN-1240 | S | medium | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 485 | PAN-1227 | S | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work |
| 485 | PAN-3705 | XS | low | ok |  |  | Ctrl-K: add Conversations as a first-class entry in the type list |
| 486 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign |
| 487 | PAN-1173 | S | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 488 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders |
| 489 | PAN-3731 | XS | medium | ok |  |  | Restart-gate banner gives no feedback after approval; dead-requester approvals look like a broken button |
| 490 | PAN-3054 | M | medium | ok |  |  | Benchmark matrix: run one template issue under N configurations and compare cost, time and outcome |
| 491 | PAN-1150 | S | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 492 | PAN-1149 | S | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 493 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 494 | PAN-1129 | S | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 495 | PAN-1128 | S | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 496 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 497 | PAN-1068 | S | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 498 | PAN-1027 | S | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 499 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 500 | PAN-932 | S | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 501 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 502 | PAN-900 | S | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 503 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 504 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 505 | PAN-727 | M | medium | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 506 | PAN-681 | S | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 507 | PAN-3732 | S | medium | ok |  |  | Codex handoff serializes large rollouts twice (~286MB peak RSS on a 50MB rollout) |
| 508 | PAN-3615 | S | medium | ok |  |  | TTS silent 9+ days from four stacked failures; three fixed, remaining watchdog/surfacing follow-ups |
| 509 | PAN-3058 | M | medium | ok |  |  | Ship standing-crew templates so tiered execution can be configured from a preset instead of hand-built YAML |
| 510 | PAN-2977 | M | medium | ok |  | PAN-2976 | ACP agent setup UI: detect installed ACP CLIs, show auth status and guide login from Settings |
| 511 | PAN-538 | S | medium | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 512 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection |
| 513 | PAN-324 | XS | medium | stale |  |  | Agent detail pane missing Merge/Approve button |
| 514 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 515 | PAN-247 | S | medium | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 516 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 517 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 518 | PAN-178 | M | medium | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 519 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 520 | PAN-49 | XS | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 521 | PAN-1951 | M | medium | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 522 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 523 | PAN-1041 | M | medium | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 524 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 525 | PAN-3735 | S | medium | ok |  |  | pan CLI blames a down dashboard when the real cause is a sandboxed shell with no network |
| 526 | PAN-3706 | L | medium | ok |  |  | Broadsheet shipped typography only; color, surface, elevation and texture are still on Ledger values |
| 527 | PAN-3333 | M | medium | ok |  |  | Model pickers show $/1M, which answers the wrong question on a subscription — show relative plan drain |
| 528 | PAN-863 | M | medium | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 529 | PAN-817 | M | medium | ok |  |  | Improve planning dialog layout and content fit |
| 530 | PAN-802 | M | medium | ok |  |  | Resume on conversation session forks instead of resuming |
| 531 | PAN-713 | M | medium | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 532 | PAN-700 | M | medium | ok |  |  | Detachable terminal for conversation view |
| 533 | PAN-646 | XS | medium | ok |  |  | Canceled issues: add guided Recover workflow |
| 534 | PAN-532 | M | medium | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 535 | PAN-2896 | M | medium | ok |  |  | Warm resource-discovery and membership caches at boot |
| 536 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 537 | PAN-2626 | M | medium | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 538 | PAN-2625 | XS | medium | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 539 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 540 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations |
| 541 | PAN-2582 | M | medium | ok |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 542 | PAN-2566 | L | medium | ok | ✓ |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 543 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 544 | PAN-2558 | L | medium | ok |  |  | support polyrepo projects |
| 545 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action |
| 546 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility |
| 547 | PAN-2548 | XS | medium | ok |  |  | close the PAN-2541 legacy-fallback deprecation window |
| 548 | PAN-2521 | S | medium | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 549 | PAN-2493 | M | medium | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 550 | PAN-3661 | XS | medium | ok |  |  | issueActions review-mode tests fail locally while CI is green — semantic-rejection toast never fires |
| 551 | PAN-2444 | L | medium | ok |  |  | optional SageOx re-integration |
| 552 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv |
| 553 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane |
| 554 | PAN-2409 | M | medium | ok |  |  | enforce the workspace boundary |
| 555 | PAN-2399 | M | medium | ok |  |  | wire replay_threshold/compaction_reroute into the slot-recovery respawn seam |
| 556 | PAN-2392 | M | medium | ok |  |  | Standing Crew cost panel |
| 557 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues |
| 558 | PAN-2295 | L | medium | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 559 | PAN-3469 | S | low | ok |  |  | Migrate NewProjectModal to a routed full page under the PAN-3410 page-not-modal doctrine |
| 560 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call |
| 561 | PAN-2065 | M | medium | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 562 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 563 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 564 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 565 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 566 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 567 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 568 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 569 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 570 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 571 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 572 | PAN-2024 | XS | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 573 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 574 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 576 | PAN-2978 | S | low | ok |  | PAN-2976, PAN-2977 | Offer per-agent install recipes from the ACP setup UI instead of linking the operator to vendor docs |
| 577 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 578 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 579 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 580 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 581 | PAN-1937 | M | medium | ok |  |  | feat: data export |
| 582 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 583 | PAN-1916 | M | medium | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 584 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 585 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 586 | PAN-1852 | XS | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 587 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 588 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' |
| 589 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 590 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 593 | PAN-3335 | XS | low | ok |  |  | Pasted conversation screenshots have no click-to-enlarge, so the operator can't check what was attached |
| 594 | PAN-3684 | XS | low | ok |  | PAN-1641 | Temporary acceptance issue: spawn a Pi work agent on ollama:gemma4:12b and record evidence |
| 594 | PAN-3322 | XS | low | ok |  |  | launcher-generator.ts allowlist sits 126 lines above reality — a temporary ceiling raise became regrowth budget |
| 595 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 596 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 597 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent |
| 598 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 599 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 600 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate |
| 601 | PAN-1685 | XS | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 602 | PAN-1676 | M | medium | ok |  |  | harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 603 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 604 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 605 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 606 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 607 | PAN-1654 | XS | medium | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 608 | PAN-1653 | XS | medium | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 609 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 610 | PAN-3739 | XS | low | ok |  |  | cost-reconcile re-warns model-less codex subthread rollouts every sweep, flooding the dashboard log |
| 611 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 612 | PAN-1550 | M | medium | ok |  |  | feat: FilesPane + BrowserPane |
| 613 | PAN-1545 | XS | medium | ok |  |  | New Terminal button |
| 614 | PAN-1542 | XS | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 615 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 616 | PAN-1497 | M | medium | ok |  |  | emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 617 | PAN-1490 | M | medium | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 618 | PAN-1489 | M | medium | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 619 | PAN-1485 | M | medium | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 620 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 621 | PAN-1443 | M | medium | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 622 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 623 | PAN-1437 | M | medium | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 624 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale |
| 625 | PAN-1223 | M | medium | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 626 | PAN-1165 | M | medium | ok |  |  | Lightweight review path for small/trivial PRs |
| 627 | PAN-3558 | XS | low | ok |  |  | Subagent rail rows should show the provider logo and model id, including the main-agent row |
| 628 | PAN-1151 | XS | medium | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 629 | PAN-1060 | M | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 630 | PAN-1051 | M | medium | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 631 | PAN-1040 | XS | medium | ok |  |  | event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 632 | PAN-1037 | M | medium | ok |  |  | Retire 'planning-' tmux prefix |
| 633 | PAN-958 | M | medium | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 634 | PAN-949 | M | medium | ok |  |  | feat: add conversation for project from sidebar |
| 635 | PAN-947 | M | medium | ok |  |  | feat: project management actions in unified sidebar |
| 636 | PAN-938 | M | medium | ok |  |  | Fizzy visual pipeline |
| 637 | PAN-903 | M | medium | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 638 | PAN-902 | XS | medium | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 639 | PAN-901 | XS | medium | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 640 | PAN-818 | M | medium | ok |  |  | Make summary optional when forking conversations |
| 641 | PAN-736 | M | medium | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 642 | PAN-709 | M | medium | ok |  |  | self-improving flywheel |
| 643 | PAN-3011 | S | low | ok |  | PAN-1641 | Support poolside Laguna S 2.1 (118B MoE, 1M ctx) locally via Ollama/vLLM and hosted via OpenRouter |
| 644 | PAN-678 | M | medium | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 645 | PAN-675 | M | medium | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 646 | PAN-654 | L | medium | ok |  |  | Project Setup Wizard |
| 647 | PAN-649 | M | medium | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 648 | PAN-637 | XS | medium | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 649 | PAN-629 | M | medium | ok |  |  | Workspace quotas and resource governance |
| 650 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents |
| 651 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 652 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 653 | PAN-548 | M | medium | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 654 | PAN-546 | M | medium | ok |  |  | Remove claude-code-router |
| 655 | PAN-537 | M | medium | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 656 | PAN-531 | XS | medium | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 657 | PAN-452 | M | medium | ok |  |  | Conversation input bar |
| 658 | PAN-450 | M | medium | ok |  |  | Adopt remaining Effect patterns |
| 659 | PAN-294 | M | medium | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 660 | PAN-3133 | S | low | ok |  |  | Spike: evaluate TRON encoding for prompt-bound xBRIEF payloads (claimed 35-40% token reduction vs JSON) |
| 661 | PAN-293 | M | medium | stale |  |  | Project Living Memory |
| 662 | PAN-277 | M | medium | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 663 | PAN-258 | M | medium | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 664 | PAN-255 | M | medium | stale |  |  | Agents lack awareness of MCP tools |
| 665 | PAN-252 | XS | medium | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 666 | PAN-243 | M | medium | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 667 | PAN-77 | XS | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 668 | PAN-54 | L | medium | stale |  |  | e2e command for full workflow integration test |
| 669 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 670 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 671 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 672 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 673 | PAN-3441 | L | low | ok |  |  | God View 'The River': WebGL pipeline visualization fed by the live hook-event stream (full PRD exists) |
| 674 | PAN-2983 | M | low | ok |  |  | OKF v3 deferred capabilities: lease-based concurrent write mode and an LLM semantic auditor |
| 675 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 676 | PAN-2941 | M | low | ok |  |  | OKF v3 |
| 677 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 678 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 679 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 |
| 680 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 681 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 682 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 683 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 684 | PAN-2635 | XS | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 685 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 686 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 687 | PAN-3443 | L | low | ok |  |  | God View 'Spectrum Deck': Winamp-style GPU-shader activity visualizer, mockup and PRD already captured |
| 688 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 689 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file |
| 690 | PAN-2600 | XS | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) |
| 691 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 692 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 693 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector |
| 694 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 695 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 696 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 697 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 698 | PAN-2424 | L | low | ok |  |  | Epic: the Order Book |
| 699 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree … |
| 700 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 701 | PAN-2356 | M | low | needs-refinement |  |  | Overdeck Anywhere P3: relay service |
| 702 | PAN-2355 | M | low | needs-refinement |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 703 | PAN-2354 | M | low | needs-refinement |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 704 | PAN-2352 | M | low | needs-refinement |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 705 | PAN-2353 | M | low | needs-refinement |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 706 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations |
| 707 | PAN-2091 | XS | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 708 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 709 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 710 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 711 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 711 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 712 | PAN-2074 | XS | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 713 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 714 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 715 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast |
| 716 | PAN-2002 | XS | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 717 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 718 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 719 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 720 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 721 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 722 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 723 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 724 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every… |
| 725 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 726 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 727 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout |
| 728 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 729 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 730 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 731 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 733 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 734 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 735 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 736 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 737 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 738 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 739 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 740 | PAN-3456 | XS | low | stale |  |  | Already fixed in 4117c9a777 — per-item swarm diagnostics no longer act as eligibility gates |
| 741 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 742 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 743 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 744 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 745 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 746 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' |
| 747 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence |
| 748 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 749 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 750 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 751 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces |
| 752 | PAN-1123 | XS | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 753 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 754 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 755 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 756 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 757 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 758 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 759 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 760 | PAN-984 | XS | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 761 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 762 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 763 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 764 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 765 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 766 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 767 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 768 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 769 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 770 | PAN-810 | XS | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 771 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 772 | PAN-793 | XS | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 773 | PAN-791 | XS | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 774 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling |
| 775 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 776 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 777 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 778 | PAN-774 | XS | low | ok |  |  | Unify launch UX and release pipeline for 1.0 |
| 779 | PAN-773 | XS | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 780 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 781 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 782 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 783 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 784 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 785 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 786 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 787 | PAN-751 | M | low | ok |  |  | Historical Metrics Data Persistence |
| 788 | PAN-750 | L | low | ok |  |  | Complete Metrics Page Redesign |
| 789 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 790 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 791 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 792 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 793 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 794 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 795 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 796 | PAN-701 | XS | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 797 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 798 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 799 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 800 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 801 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 802 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 803 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 804 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 805 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 806 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 807 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 808 | PAN-571 | XS | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 809 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 810 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 811 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly |
| 812 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 813 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 814 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX |
| 815 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 816 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 817 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database |
| 818 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 819 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 820 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 821 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 822 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 823 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 824 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 825 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 826 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 827 | PAN-249 | XS | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 828 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 829 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics |
| 830 | PAN-227 | M | low | stale |  |  | Phase gate validation |
| 831 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 832 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 833 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 834 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 835 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 836 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 837 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 838 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 839 | PAN-52 | XS | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 840 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 841 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 842 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 843 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 844 | PAN-2348 | XS | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 845 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md |
| 846 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md |
| 847 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md |
| 848 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md |
| 849 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md |
| 850 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 851 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 852 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 853 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 854 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 855 | PAN-1684 | XS | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 856 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 857 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc |
| 858 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 859 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 860 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 861 | PAN-633 | M | low | ok |  |  | Update Cloister PRD and docs index |
| 862 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |

## Rationale detail

### PAN-3679 (rank 1)

Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3285 (rank 2)

When the supervisor unit is pinned to a pan reload deployment generation it SIGTERMs every correctly-running dashboard and is structurally incapable of starting a replacement — a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and zero escalation. The component whose whole job is keeping the dashboard alive becomes the thing killing it, and manual recovery from the primary checkout also failed. Carries bug + critical + substrate-improvement labels and sits at the top of the substrate tier.

### PAN-3740 (rank 3)

Main CI is red on the merge commit because the generated composer-command manifest still declares the old 500-character pan handoff cap while the command description says 10000. A red main empties the merge gate silently and blocks every other issue from landing, so this outranks all non-red-main work regardless of how small the fix is. The change itself is a regeneration of one committed artifact, so the cost of clearing it is near zero and the cost of leaving it is the whole pipeline. In pipeline — rank set once here and pinned from now on; gate stays auto.

### PAN-3539 (rank 3)

One agent-spawned python process ballooned to 41GB and the kernel correctly killed it, but because every agent pane lives in the overdeck-tmux-server.service cgroup, systemd's default OOMPolicy=stop failed the whole unit and took every session on the machine with it. The blast radius of any single runaway agent is currently the entire fleet. The immediate fix is a one-line unit property, which makes this the highest impact-per-effort item in the resilience group; PAN-3314 covers the deeper cgroup partitioning.

### PAN-3250 (rank 4)

New workspaces branch from local HEAD rather than origin/main, so every feature branch created while the shared primary checkout carries unpushed commits inherits them — verified spreading across four branches at filing time, two of which showed MERGEABLE/CLEAN on GitHub while carrying 14 unrelated commits. This silently contaminates what merges, and it pairs with PAN-3062 (whoever pushes main ships everyone else's work). Labelled substrate-improvement and blocks-main.

### PAN-3690 (rank 4)

Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-2746 (rank 5)

Highest integrity risk — infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; nearly merged a pipeline-critical change unreviewed.

### PAN-3566 (rank 6)

The test-role launcher's final exec has no -p, no positional prompt and no piped stdin, so Claude Code boots an interactive REPL with the role text loaded only as a system prompt and sits at the prompt forever — no turn, no JSONL, no verdict. Reproduced deterministically across eight session IDs, this is the root cause of the zombie-test-agent family (PAN-3274, PAN-3563) rather than another symptom of it. A one-line launcher fix retires several downstream issues.

### PAN-3524 (rank 7)

A server-side --changed verification loop relaunched continuously and survived every documented suppression gate — Deacon freeze, review abort, pause, and operator stop — while blocking a red-main fix from reaching its test gate across four attempts. A control plane with no lever that actually stops a runaway is the failure mode every other gate presumes cannot happen. Ranked immediately below the outage-class items because it is P0-tagged and reproducible.

### PAN-2689 (rank 8)

Sandboxed codex review verdicts fire-and-forget into a journal that loses them; review convoy reports green on evidence never delivered.

### PAN-3630 (rank 9)

pan tell reported successful delivery three times to a live healthy agent, moved all three messages into the read/ mailbox, and the agent's transcript shows it received none of them. Message delivery is the substrate every recovery path, feedback relay and operator intervention rides on, so a delivery door that lies about success makes every downstream 'we told the agent' assumption unsafe. Labelled substrate-improvement.

### PAN-3554 (rank 10)

A failed main-push CI run sat unnoticed for roughly five hours because nothing owns red main mechanically — no needs-you escalation, no activity entry, no strike. Red main empties the merge gate for every project, so the cost of the detection gap compounds with the size of the ready queue. This is the systemic owner for the recurring red-main incidents that keep arriving as one-off strike issues.

### PAN-3283 (rank 11)

Recovering an issue from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 even when the most recent verdict written was CHANGES REQUESTED — observed on two issues that were both already sitting in a UAT batch. This converts a recovery action into a silent approval, which is the worst class of pipeline bug: it does not stall, it ships. Labelled blocks-main.

### PAN-3761 (rank 12)

Issue cards read ready-to-merge but no UAT train ever forms, because the durable review status still satisfies needsReviewDispatch even when the PR carries passing review and test stamps; the host-side re-dispatch attempt fires every ~30s and yanks the member back out of the ready queue. The verified reproducer is PAN-3668/PR #3670. Anything that cannot keep a train membership cannot ship through the UAT path at all, so this gates the whole merge-train model.

### PAN-3685 (rank 12)

Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3657 (rank 13)

GET /api/merge-train/queues returns an empty queue for every polyrepo project while monorepo projects populate normally, so the MYN and Auricle trains are permanently empty even with fully-verified members open on the forge. Polyrepo is where the multi-repo work actually happens, so this silently removes an entire class of project from the merge-train model. Root cause is verified in code, which makes it a contained fix.

### PAN-3561 (rank 14)

A writer that crashes between mkdir(lockPath) and writing owner.json leaves an ownerless state-git lock with no TTL and no recovery CLI — it bricked every canonical-state write for the mind-your-now project for 2.5 days, deterministically, across four issues. The write door is the single path for all durable state, so an immortal lock on it is a total project outage that no other machinery can route around.

### PAN-3532 (rank 15)

Two frontend test files were red on main for hours while every main CI run reported green, because CI never runs the full frontend suite. Green main is the gate every merge and every verification presumes, so a CI configuration that cannot see a whole test tree makes that gate advisory rather than real. Cheap to fix and it retires a recurring class of 'main was red and nobody knew'.

### PAN-3424 (rank 16)

Two independent ways the state plane stops being durable with nothing detecting either: a non-fast-forward push on overdeck-state is only warned about and never reconciled, and drafts/ PRDs are never staged — 16 orphaned PRDs found, one two weeks old. The state branch is the canonical plane for records, specs and drafts, so silent non-durability there loses exactly the artifacts nothing else can rebuild. Pairs with PAN-3651, which re-lands the reverted push-retry fix.

### PAN-3564 (rank 18)

Record writes take the per-issue lock first and then block waiting on the global state-git lock, so under a review convoy the per-issue lock ran at effectively 100% duty cycle — all four reviewer lanes died at spawn on lock-held errors with no retry. This is a lock-ordering defect, so it gets worse exactly when the pipeline is busiest. Fixing the ordering (or releasing before the global wait) removes a whole class of convoy failure.

### PAN-3687 (rank 19)

pan done printed success and 'Review & test started automatically' while logging that no durable review pipeline handler was registered — no review or test session was ever created, and a manual pan review request was required. A completion command that reports a next stage nobody owns turns a hand-off into a silent stall, which is the exact failure the mechanical-owner doctrine exists to prevent.

### PAN-3631 (rank 20)

The sequencer reads its prior from the legacy project-local .pan/backlog/sequence.md while pan backlog write-sequence persists only to overdeck-state, so nothing writes the legacy copy any more and every incremental pass is handed the same frozen July 20 document as its prior — including this one. Backlog rank is what the Flywheel picks from, so a prior that can never advance quietly degrades every future pass. Read-side twin of PAN-3301.

### PAN-3520 (rank 21)

Multiple branches loop on test-failed verdicts that are not defects: uniform 'Test timed out in 5000ms' signatures under host load, with every configured gate otherwise green. Recording a verdict from a load-induced timeout burns a full rework cycle per false failure and is the mechanism behind the PAN-3344 storm class. Retrying timeout-only failures in isolation before writing a verdict is a contained change to the gate.

### PAN-3313 (rank 22)

A transient upstream stream error takes CLIProxy's only auth entry out of rotation, so every GPT-routed request returns 503 auth_unavailable until an internal cooldown lapses — 14 successes against 35 failures in one hour with valid credentials the whole time, and an error message that blames missing auth. Since the operator deliberately routes GPT models through CLIProxy, roughly 70% inference failure is a fleet-wide capacity loss.

### PAN-3282 (rank 23)

Review agents repeatedly terminate without writing their report across five issues and two projects, leaving a status that looks like a verdict, no artifact to read, and a stuck flag that blocks progress until someone restarts the reviewer by hand — recurring even on issues already recovered once. Review is the mandatory gate between work and merge, so a reviewer that dies silently converts autonomous throughput into operator babysitting.

### PAN-3492 (rank 24)

Server-side verification retries form a self-amplifying loop: timeouts trigger retries, retries raise load, and higher load causes more timeouts — four concurrent vitest generations for a single issue at host load 18.5, all parented by the dashboard server itself. A gate that manufactures the pressure it is failing under cannot converge, and it starves every other project's verification while it spins. Labelled substrate-improvement.

### PAN-3281 (rank 25)

An issue can carry ready_for_merge=1 and stuck=1/verification_stuck simultaneously, and the merge-ready flag wins on every surface consulted — so an issue whose own verification failed for incomplete work was assembled into a UAT batch and recommended for promotion. Two contradictory facts about the same issue with no resolver is precisely what the one-read-door tenet exists to prevent.

### PAN-3234 (rank 26)

Two agents froze on blocking choice menus within two Flywheel ticks and no health surface detected either; both were found only by an orchestrator reading the tmux pane by hand. paneHasBlockingChoiceMenu is wired to delivery refusal but never to health, so a frozen agent looks perfectly healthy while holding its slot indefinitely. Wiring the existing detector into health is a small change with fleet-wide effect.

### PAN-3682 (rank 28)

A migrated polyrepo slot's pan done tries to auto-commit the workspace-local record path against the canonical state worktree, git rejects it as outside the repository, and the retry path then runs from the polyrepo wrapper root, which has no .git. The result is a crash at the exact moment the slot's work should be recorded, stalling swarm reconciliation and new-wave dispatch for both MIN-888 and MIN-889.

### PAN-3498 (rank 29)

writeSequenceMd pins in-pipeline issues back to their prior rank without renumbering the rest of the document, so the dense 1..N ranking the sequencer submits comes back with 11 duplicate ranks and 11 gaps. Rank stops being a total order, and the persisted document is what the Flywheel picks from — so the pickup order it drives is not the order any pass actually produced. Labelled substrate-improvement and it degrades every future sequencer run, including this one.

### PAN-3429 (rank 30)

The host reached 2.2GB available with memory PSI full avg60 near 42 — OOM territory — while the deacon's memory governor only logged soft deferrals of new admissions and shed nothing for the entire 30-minute climb. The flywheel had to pause a gate run by hand to recover 2.4GB. A governor that cannot act under HARD pressure is the reason single-agent OOMs keep escalating into machine-wide incidents.

### PAN-3314 (rank 31)

Every agent pane is a child of the single overdeck-tmux-server.service transient unit, so agent memory is the unit's memory and one hungry agent's OOM can take the whole fleet down. PAN-3539 is the immediate one-line mitigation; this is the structural containment that makes the blast radius per-agent rather than per-machine. Ranked high because the fleet-wide loss recurs.

### PAN-3278 (rank 32)

A work agent finished, opened a PR, and sat idle for two hours because review was never dispatched — the auto-requeue machinery existed, had capacity, and fired none of its 25 attempts. Identical cost to four decimal places across two hours is the tell. A requeue that never requeues means every completion silently depends on someone noticing, which is exactly the autonomy the pipeline is supposed to provide.

### PAN-3248 (rank 33)

A successful pan reload leaves the deploy queue set, and both verification-runner and verification-worker-supervisor defer while any deploy is queued — so every project's verification stops until a patrol happens to notice the build is fresh. Since the flywheel deploys after every merge, this starves verification repeatedly on exactly the nights the pipeline is busiest. Pairs with PAN-3244 and PAN-3205.

### PAN-3085 (rank 34)

Review feedback is written to the resolved workspace runtime directory .overdeck/feedback/ while the path handed to the work agent — and read by the deacon merge gate — is a hardcoded .pan/feedback/ that no longer exists after the rebrand. Agents are told to fix findings at an empty path and the merge gate sees zero feedback files regardless of what review produced. Trivially small fix, whole-pipeline consequence.

### PAN-3062 (rank 35)

The primary worktree is checked out on main and shared by every conversation and the Flywheel, so commits from independent sessions stack on one branch and whoever pushes main next ships everyone else's work, verified or not. This is the write-side twin of PAN-3250 and the mechanism behind several unexplained main regressions. Ranked with the other main-integrity items.

### PAN-3560 (rank 37)

Under a window of concurrent review convoys every session resume and message delivery through the PTY supervisor failed with 502 'input echo confirmation failed', hitting at least six unrelated agents at once. The supervisor is the primary delivery transport, so overload there converts a busy pipeline into a fleet-wide communications outage — and busy is exactly when recovery matters. Related to PAN-3564 and PAN-3492 as load-coupled failures.

### PAN-3301 (rank 38)

The state-recreation patrol logs a stray-writer warning every cycle — 68k log lines — and behind it sit two real defects: the backlog manifest still writes the legacy .pan path, and the patrol flags stale directories forever. The write-side twin of PAN-3631; together they explain why the backlog machinery keeps reading and writing different places. Labelled substrate-improvement.

### PAN-3237 (rank 39)

Three issues sat simultaneously stuck on the same failure because every HTTP 409 from a work-agent spawn is flattened to 'guardrails' and every skip reason calls markWorkspaceStuck — so a capacity refusal, which is transient and expected, is recorded as a terminal stuck state with no re-drive owner. Capacity pressure is normal operation; treating it as terminal converts a queue into a graveyard. Labelled substrate-improvement.

### PAN-3100 (rank 40)

The test role evaluates the workspace working tree rather than the reviewed commit, so a live work agent's uncommitted edits are counted against the issue and produce a test_status: failed verdict for code that was never reviewed and would never merge. Combined with PAN-3104 (stale results re-applied with no freshness check) it forms a durable trap that re-fails an issue after the fix has landed.

### PAN-2954 (rank 41)

postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run. Blocker PAN-2882 closed since the prior pass, so this is now unblocked.

### PAN-3653 (rank 43)

A strike that correctly stopped after proving its gate was blocked by red main has no path that wakes it when main goes green again — main was reverted, the whole workflow set turned green, and five minutes later the strike was still idle at its old readiness with no recovery. Strikes exist to unblock the pipeline fast, so a strike that cannot resume after the blocker clears defeats its own purpose. Labelled substrate-improvement and blocks-main.

### PAN-3605 (rank 44)

scripts/lint-effect-diagnostics.sh runs npx effect-language-service; on a checkout whose node_modules predates the dependency addition, npx missed the local bin, fell back to the npm registry, and non-interactively installed and executed a third-party squatter package under that unscoped name. The payload was benign this time. A lint script that can execute arbitrary registry code on a stale checkout is a supply-chain hole, and pinning the local bin closes it outright.

### PAN-3236 (rank 45)

ECONNREFUSED against a dead supervisor socket is misclassified as ambiguous keyed delivery, so review feedback that was written to disk is never delivered — the issue goes stuck at feedback_delivery_needs_you while the agent sits idle and the file sits there unread. Four review cycles were burned on one issue this way. Misclassifying a hard connection failure as an ambiguity means the retry path that would fix it never runs.

### PAN-3205 (rank 46)

The deployment gate refuses and queues a deploy with an operator-facing promise that it will fire automatically at the next verification boundary — and that trigger does not exist anywhere. The message explicitly tells the operator not to retry or force, so the queued deploy simply never happens. A gate that queues into a void is worse than one that refuses, because it suppresses the manual recovery too.

### PAN-3118 (rank 47)

Four planning agents were reported running by the registry while producing nothing at all: 0% context, zero output, $0.0000 spend, because the model's quota was exhausted and nothing detects that state or falls back to available capacity. Quota exhaustion is routine on subscription plans, so an undetected halt converts a recoverable condition into hours of dead slots. Same family as PAN-3043.

### PAN-3106 (rank 48)

auto_merge_default: hold is consulted on exactly one merge path, so every other path merges a ready issue without asking whether the project requires UAT first — an operator who configured hold still got individual auto-merges. This directly defeats the UAT batch-train model, since issues merge one at a time before a generation can assemble them. The fix is routing every merge path through the same policy check.

### PAN-3084 (rank 49)

A review session that spawns but is never briefed sits at zero context and zero tokens forever, and both recovery paths treat it as healthy work in progress — auto-dispatch no-ops because a session exists, and restart 'preserves' it. Review can then never start for that issue: the dead session blocks its own replacement. Detecting never-briefed sessions is the common fix with PAN-3397 and PAN-3563.

### PAN-3057 (rank 50)

Two coupled defects: a compaction the harness initiated on its own is invisible to every recovery path Overdeck has, so agents go silently idle after it, and the GPT-5.6 context window is declared twice with different values (372K vs 150K). Six MYN agents went idle after a host restart from the first; the second makes window-dependent behaviour non-deterministic depending on which declaration a code path reads.

### PAN-2695 (rank 51)

Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.

### PAN-3580 (rank 51)

The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.

### PAN-3677 (rank 52)

Planning agents wedge after a background Explore task finishes; parent never consumes the result. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-2742 (rank 52)

Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.

### PAN-3734 (rank 53)

A normally completed swarm slot can be reassigned while its polyrepo worktree is still on the old slot branch, so the new agent starts from stale code instead of the current issue parent — reproduced live with a reused worktree still at an old item's HEAD. Starting from the wrong base is silent: the work looks fine and the diff is wrong. PAN-3724 hardened the blocked-slot path; this completed-slot path is still open.

### PAN-3633 (rank 54)

pan strike created a workspace whose dependency tree was incomplete, so typecheck:evals failed there while npm run typecheck was green on the primary main worktree — and the agent reasonably concluded main was red, implemented its fix, then aborted without pushing. An environment defect that makes agents report false pipeline state wastes the strike and poisons the operator's picture of main. Labelled substrate-improvement.

### PAN-3563 (rank 56)

A role agent whose PTY prompt delivery failed never boots, but its state.json is left as running forever — so the dispatcher no-ops on 'already in progress', review reports already-passed, and pan unstick cannot even see role agents. An invisible zombie that absorbs every subsequent dispatch is the shape shared by PAN-3566, PAN-3274 and PAN-3084; this one covers the state-plane half.

### PAN-3543 (rank 57)

After a work agent finishes, is reaped, and review comes back blocked, pan start refuses and recommends --fresh, pan start --fresh gives the identical refusal recommending --fresh, and reset-session refuses too. The agent is unstartable by every documented door while the rework it needs to do is owed. Self-contradictory deadlocks like this one and PAN-3526 cost an operator intervention each time rework is required.

### PAN-3103 (rank 58)

A transient merge_status: failed reading taken immediately after a successful merge makes automatic close-out skip the issue permanently, with nothing retrying once the status self-heals — so the issue stays merged but open, reads as pickup-eligible, and got a fresh planning agent spawned on already-shipped work. Spending a planning agent on merged work is the most visible symptom; the open row also corrupts every backlog count.

### PAN-3078 (rank 59)

Per-item inspect verdicts are persisted to review_status and checkpointed, but nothing delivers them to the work agent — so an agent that parks deliberately to wait for its verdict waits forever. The inspection gate is only meaningful if its result reaches the thing it gates; today passing inspection and never hearing about it are indistinguishable to the agent.

### PAN-3043 (rank 60)

An agent has been registered running since a hard provider refusal 3.5 days earlier, tmux session alive, pane showing a 403 usage-limit wall, holding its slot the whole time. Mid-run quota exhaustion is undetected, so the capacity accounting the scheduler depends on is simply wrong. Detecting the provider-refusal pane state is the same work as PAN-3118 and should land together.

### PAN-2706 (rank 61)

Ghost test sessions that never received kickoff absorb every dispatch, marking testing with no prompt delivered.

### PAN-2700 (rank 62)

Stale .pan/test/result.json is consumed by the next cycle, insta-failing with the previous run verdict.

### PAN-2733 (rank 63)

substrate-bug-poller has never run — BOT_LOGIN is a git author string not a GitHub login; the auto-triage loop is inert.

### PAN-1560 (rank 64)

Re-review after a PR head moves never re-posts status, stranding otherwise-green PRs at BLOCKED.

### PAN-2769 (rank 65)

review_status rows are never reconciled when an issue closes, so closed issues keep advertising stale review state.

### PAN-2828 (rank 66)

pan done --strike structurally refuses every squash-merged strike — the landing path doctrine mandates is rejected by its own ancestry check.

### PAN-2874 (rank 67)

Strike landing cannot merge: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback wedges on exited strike agents.

### PAN-2883 (rank 68)

Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ and cannot find strike/ PRs.

### PAN-2806 (rank 69)

Strike merge trigger registry splits across dashboard chunks, so the trigger is never registered in the chunk that runs it.

### PAN-2796 (rank 70)

Idle nudge advances a work agent past a failed mandatory inspection, bypassing the inspection gate.

### PAN-2940 (rank 71)

Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.

### PAN-3697 (rank 72)

The deployed Node 22 dashboard was launched with a PATH that omits ~/.bun/bin, so verification workers logged 'bun: not found' before their required dependency-install gate. Verification is the gate every merge waits on, and an environment-dependent failure there produces false verdicts rather than an honest error. pan reload should resolve the Bun directory deterministically at launch.

### PAN-3654 (rank 73)

pan recover --compact reported kickoff-not-confirmed twice and killed a replacement session that had already accepted the recovery prompt and was doing real work — it was confirming against the archived session rather than the fresh one. A recovery command that destroys the recovery it just performed is worse than no recovery, because the operator's next move is to run it again.

### PAN-3621 (rank 74)

pan start aborted at spawn resolving a chunk graph spliced across two builds — an importer name from the primary dist build with a path rooted in the live deployment generation — and an immediate identical retry succeeded with nothing changed in between. Intermittent spawn death with a raw Node module-resolution message blocks work dispatch and pipeline recovery, and it is silent about the real condition. Labelled substrate-improvement.

### PAN-3522 (rank 75)

Under a machine-wide CPU storm the :3012 supervisor watchdog entered a restart-churn loop on the dashboard because the health-probe timeout budget takes no account of the boot warm phase — a healthy but slow server gets killed and the replacement is killed the same way. Restart churn during load is how a recoverable pressure spike becomes an outage; it also produced the orphaned-server symptoms tracked elsewhere.

### PAN-3496 (rank 76)

A review convoy member blocked on an operator AskUserQuestion asking which review depth to use, wedging the convoy — and because convoys respawn, the operator got the same dialog repeatedly. The review pipeline's entire purpose is autonomy, so a review or inspect agent that parks itself on an operator question converts autonomous motion into a queue of identical prompts. Decide, don't ask, enforced mechanically. Labelled substrate-improvement.

### PAN-3344 (rank 77)

The dev box hit load average ~48 on 24 cores with memory fine, because the resource governor gates dispatch on memory alone while the actual pressure came from concurrent agent-shell test runs. Nearly every load-coupled failure filed since — the watchdog churn, the self-amplifying retry loop, the timeout-only test verdicts — traces back to unbounded concurrent gate runs. It has a PRD and it is the systemic fix beneath several symptom issues.

### PAN-3274 (rank 78)

A test-role agent spawned, never executed a single turn, and held its issue out of the merge gate indefinitely — review approved, CI green, blocked only by a verdict that was never produced. Zero context, zero output, zero cost is a distinguishable state, and nothing checks for it. PAN-3566 supplies the deterministic cause for the claude-code case; this issue owns the detection and recovery side.

### PAN-3244 (rank 79)

A dashboard deploy queued by the deploy patrol globally defers verification, so a myn issue's review convoy never spawned for 30+ minutes despite its durable review intent being written correctly. The deploy window is flywheel-owned and frequent, so a global defer means cross-project review handoffs starve on a cadence nobody chose. Same defect family as PAN-3248 and PAN-3205.

### PAN-2932 (rank 80)

Intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-08-23T08:27:51Z",
  "model": "claude-opus-5",
  "pass": "incremental",
  "openCount": 862,
  "nodes": [
    {
      "issue": "PAN-3740",
      "rank": 3,
      "size": "XS",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main: lint:slash-commands finds composer-manifest drift (handoff cap 500 vs 10000) — every merge blocked until regenerated",
      "rationale": "Main CI is red on the merge commit because the generated composer-command manifest still declares the old 500-character pan handoff cap while the command description says 10000. A red main empties the merge gate silently and blocks every other issue from landing, so this outranks all non-red-main work regardless of how small the fix is. The change itself is a regeneration of one committed artifact, so the cost of clearing it is near zero and the cost of leaving it is the whole pipeline. In pipeline — rank set once here and pinned from now on; gate stays auto.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor pinned to a reload generation SIGTERMs every healthy dashboard and cannot start one — 3.5h outage",
      "rationale": "When the supervisor unit is pinned to a pan reload deployment generation it SIGTERMs every correctly-running dashboard and is structurally incapable of starting a replacement — a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and zero escalation. The component whose whole job is keeping the dashboard alive becomes the thing killing it, and manual recovery from the primary checkout also failed. Carries bug + critical + substrate-improvement labels and sits at the top of the substrate tier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3539",
      "rank": 3,
      "size": "XS",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "OOMPolicy=stop lets one OOM-killed child fail the whole tmux unit — every agent session lost at once",
      "rationale": "One agent-spawned python process ballooned to 41GB and the kernel correctly killed it, but because every agent pane lives in the overdeck-tmux-server.service cgroup, systemd's default OOMPolicy=stop failed the whole unit and took every session on the machine with it. The blast radius of any single runaway agent is currently the entire fleet. The immediate fix is a one-line unit property, which makes this the highest impact-per-effort item in the resilience group; PAN-3314 covers the deeper cgroup partitioning.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 4,
      "size": "S",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspaces branch from local HEAD instead of origin/main, so every new branch inherits unpushed local main commits",
      "rationale": "New workspaces branch from local HEAD rather than origin/main, so every feature branch created while the shared primary checkout carries unpushed commits inherits them — verified spreading across four branches at filing time, two of which showed MERGEABLE/CLEAN on GitHub while carrying 14 unrelated commits. This silently contaminates what merges, and it pairs with PAN-3062 (whoever pushes main ships everyone else's work). Labelled substrate-improvement and blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 5,
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
      "issue": "PAN-3566",
      "rank": 6,
      "size": "XS",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test-role launcher execs claude with no prompt, booting an idle REPL — the deterministic cause of zombie test agents",
      "rationale": "The test-role launcher's final exec has no -p, no positional prompt and no piped stdin, so Claude Code boots an interactive REPL with the role text loaded only as a system prompt and sits at the prompt forever — no turn, no JSONL, no verdict. Reproduced deterministically across eight session IDs, this is the root cause of the zombie-test-agent family (PAN-3274, PAN-3563) rather than another symptom of it. A one-line launcher fix retires several downstream issues.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3524",
      "rank": 7,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Server-owned --changed verification loop survives freeze, review abort, pause and operator-stop; blocked a red-main fix",
      "rationale": "A server-side --changed verification loop relaunched continuously and survived every documented suppression gate — Deacon freeze, review abort, pause, and operator stop — while blocking a red-main fix from reaching its test gate across four attempts. A control plane with no lever that actually stops a runaway is the failure mode every other gate presumes cannot happen. Ranked immediately below the outage-class items because it is P0-tagged and reproducible.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 8,
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
      "issue": "PAN-3630",
      "rank": 9,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell moves messages to read/ and reports delivery while the agent receives nothing — silent message loss",
      "rationale": "pan tell reported successful delivery three times to a live healthy agent, moved all three messages into the read/ mailbox, and the agent's transcript shows it received none of them. Message delivery is the substrate every recovery path, feedback relay and operator intervention rides on, so a delivery door that lies about success makes every downstream 'we told the agent' assumption unsafe. Labelled substrate-improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3554",
      "rank": 10,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main has no mechanical owner: a failed main-push run sat unnoticed 5h with no escalation or strike",
      "rationale": "A failed main-push CI run sat unnoticed for roughly five hours because nothing owns red main mechanically — no needs-you escalation, no activity entry, no strike. Red main empties the merge gate for every project, so the cost of the detection gap compounds with the size of the ready queue. This is the systemic owner for the recurring red-main incidents that keep arriving as one-off strike issues.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3283",
      "rank": 11,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recovering from review_infrastructure_failure sets review_status=passed over an outstanding CHANGES REQUESTED",
      "rationale": "Recovering an issue from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 even when the most recent verdict written was CHANGES REQUESTED — observed on two issues that were both already sitting in a UAT batch. This converts a recovery action into a silent approval, which is the worst class of pipeline bug: it does not stall, it ships. Labelled blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3761",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ready-to-merge issues never form a UAT train: durable review status re-dispatch loop yanks members from the queue",
      "rationale": "Issue cards read ready-to-merge but no UAT train ever forms, because the durable review status still satisfies needsReviewDispatch even when the PR carries passing review and test stamps; the host-side re-dispatch attempt fires every ~30s and yanks the member back out of the ready queue. The verified reproducer is PAN-3668/PR #3670. Anything that cannot keep a train membership cannot ship through the UAT path at all, so this gates the whole merge-train model.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3657",
      "rank": 13,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train queues endpoint drops every polyrepo candidate, so MYN and Auricle trains are permanently empty",
      "rationale": "GET /api/merge-train/queues returns an empty queue for every polyrepo project while monorepo projects populate normally, so the MYN and Auricle trains are permanently empty even with fully-verified members open on the forge. Polyrepo is where the multi-repo work actually happens, so this silently removes an entire class of project from the merge-train model. Root cause is verified in code, which makes it a contained fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3561",
      "rank": 14,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ownerless state-git lock is immortal — a crash between mkdir and owner.json bricks a project's write door",
      "rationale": "A writer that crashes between mkdir(lockPath) and writing owner.json leaves an ownerless state-git lock with no TTL and no recovery CLI — it bricked every canonical-state write for the mind-your-now project for 2.5 days, deterministically, across four issues. The write door is the single path for all durable state, so an immortal lock on it is a total project outage that no other machinery can route around.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3532",
      "rank": 15,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI never runs the full frontend suite — main was red on frontend for hours while every run reported green",
      "rationale": "Two frontend test files were red on main for hours while every main CI run reported green, because CI never runs the full frontend suite. Green main is the gate every merge and every verification presumes, so a CI configuration that cannot see a whole test tree makes that gate advisory rather than real. Cheap to fix and it retires a recurring class of 'main was red and nobody knew'.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3424",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "State plane silently stops being durable: non-FF overdeck-state pushes unreconciled, drafts/ PRDs never staged",
      "rationale": "Two independent ways the state plane stops being durable with nothing detecting either: a non-fast-forward push on overdeck-state is only warned about and never reconciled, and drafts/ PRDs are never staged — 16 orphaned PRDs found, one two weeks old. The state branch is the canonical plane for records, specs and drafts, so silent non-durability there loses exactly the artifacts nothing else can rebuild. Pairs with PAN-3651, which re-lands the reverted push-retry fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3679",
      "rank": 1,
      "size": "S",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running",
      "rationale": "Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3564",
      "rank": 18,
      "size": "S",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-issue record lock held across the global state-git wait — 100% duty cycle, reviewer spawns die with no retry",
      "rationale": "Record writes take the per-issue lock first and then block waiting on the global state-git lock, so under a review convoy the per-issue lock ran at effectively 100% duty cycle — all four reviewer lanes died at spawn on lock-held errors with no retry. This is a lock-ordering defect, so it gets worse exactly when the pipeline is busiest. Fixing the ordering (or releasing before the global wait) removes a whole class of convoy failure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3687",
      "rank": 19,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done prints success while no durable review handler exists — verification silently never starts",
      "rationale": "pan done printed success and 'Review & test started automatically' while logging that no durable review pipeline handler was registered — no review or test session was ever created, and a manual pan review request was required. A completion command that reports a next stage nobody owns turns a hand-off into a silent stall, which is the exact failure the mechanical-owner doctrine exists to prevent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3631",
      "rank": 20,
      "size": "S",
      "importance": "high",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sequencer reads its prior from legacy .pan/backlog/sequence.md while writes go to overdeck-state — prior frozen at Jul 20",
      "rationale": "The sequencer reads its prior from the legacy project-local .pan/backlog/sequence.md while pan backlog write-sequence persists only to overdeck-state, so nothing writes the legacy copy any more and every incremental pass is handed the same frozen July 20 document as its prior — including this one. Backlog rank is what the Flywheel picks from, so a prior that can never advance quietly degrades every future pass. Read-side twin of PAN-3301.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 21,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test gate records verdicts from load-induced timeout-only failures; retry them in isolation before deciding",
      "rationale": "Multiple branches loop on test-failed verdicts that are not defects: uniform 'Test timed out in 5000ms' signatures under host load, with every configured gate otherwise green. Recording a verdict from a load-induced timeout burns a full rework cycle per false failure and is the mechanism behind the PAN-3344 storm class. Retrying timeout-only failures in isolation before writing a verdict is a contained change to the gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 22,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient upstream stream error benches CLIProxy's only auth — ~70% of GPT-routed requests 503 auth_unavailable",
      "rationale": "A transient upstream stream error takes CLIProxy's only auth entry out of rotation, so every GPT-routed request returns 503 auth_unavailable until an internal cooldown lapses — 14 successes against 35 failures in one hour with valid credentials the whole time, and an error message that blames missing auth. Since the operator deliberately routes GPT models through CLIProxy, roughly 70% inference failure is a fleet-wide capacity loss.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents die before writing a verdict across 5 issues and 2 projects, leaving a stuck flag and no artifact",
      "rationale": "Review agents repeatedly terminate without writing their report across five issues and two projects, leaving a status that looks like a verdict, no artifact to read, and a stuck flag that blocks progress until someone restarts the reviewer by hand — recurring even on issues already recovered once. Review is the mandatory gate between work and merge, so a reviewer that dies silently converts autonomous throughput into operator babysitting.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3492",
      "rank": 24,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Server-side gate retries self-amplify: timeouts trigger retries that raise load and cause more timeouts",
      "rationale": "Server-side verification retries form a self-amplifying loop: timeouts trigger retries, retries raise load, and higher load causes more timeouts — four concurrent vitest generations for a single issue at host load 18.5, all parented by the dashboard server itself. A gate that manufactures the pressure it is failing under cannot converge, and it starves every other project's verification while it spins. Labelled substrate-improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3281",
      "rank": 25,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while an issue is stuck on incomplete plan items, so unfinished work reaches the UAT batch",
      "rationale": "An issue can carry ready_for_merge=1 and stuck=1/verification_stuck simultaneously, and the merge-ready flag wins on every surface consulted — so an issue whose own verification failed for incomplete work was assembled into a UAT batch and recommended for promotion. Two contradictory facts about the same issue with no resolver is precisely what the one-read-door tenet exists to prevent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 26,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze on blocking choice menus with no health detection — the check is wired only to delivery refusal",
      "rationale": "Two agents froze on blocking choice menus within two Flywheel ticks and no health surface detected either; both were found only by an orchestrator reading the tmux pane by hand. paneHasBlockingChoiceMenu is wired to delivery refusal but never to health, so a frozen agent looks perfectly healthy while holding its slot indefinitely. Wiring the existing detector into health is a small change with fleet-wide effect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3690",
      "rank": 4,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit",
      "rationale": "Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3682",
      "rank": 28,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrated polyrepo slot pan done writes a legacy workspace record path and crashes, stalling swarm reconciliation",
      "rationale": "A migrated polyrepo slot's pan done tries to auto-commit the workspace-local record path against the canonical state worktree, git rejects it as outside the repository, and the retry path then runs from the polyrepo wrapper root, which has no .git. The result is a crash at the exact moment the slot's work should be recorded, stalling swarm reconciliation and new-wave dispatch for both MIN-888 and MIN-889.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 29,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering, leaving 11 duplicate ranks and 11 gaps in the sequence",
      "rationale": "writeSequenceMd pins in-pipeline issues back to their prior rank without renumbering the rest of the document, so the dense 1..N ranking the sequencer submits comes back with 11 duplicate ranks and 11 gaps. Rank stops being a total order, and the persisted document is what the Flywheel picks from — so the pickup order it drives is not the order any pass actually produced. Labelled substrate-improvement and it degrades every future sequencer run, including this one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3429",
      "rank": 30,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory governor only defers admissions under HARD pressure and never sheds — PSI 41.9 with 2.2GB left",
      "rationale": "The host reached 2.2GB available with memory PSI full avg60 near 42 — OOM territory — while the deacon's memory governor only logged soft deferrals of new admissions and shed nothing for the entire 30-minute climb. The flywheel had to pause a gate run by hand to recover 2.4GB. A governor that cannot act under HARD pressure is the reason single-agent OOMs keep escalating into machine-wide incidents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 31,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "One cgroup holds every agent pane, so a single hungry agent's OOM can take down the whole fleet",
      "rationale": "Every agent pane is a child of the single overdeck-tmux-server.service transient unit, so agent memory is the unit's memory and one hungry agent's OOM can take the whole fleet down. PAN-3539 is the immediate one-line mitigation; this is the structural containment that makes the blast radius per-agent rather than per-machine. Ranked high because the fleet-wide loss recurs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 32,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work finished with an open PR but review was never dispatched — auto-requeue had 25 attempts and fired none",
      "rationale": "A work agent finished, opened a PR, and sat idle for two hours because review was never dispatched — the auto-requeue machinery existed, had capacity, and fired none of its 25 attempts. Identical cost to four decimal places across two hours is the tell. A requeue that never requeues means every completion silently depends on someone noticing, which is exactly the autonomy the pipeline is supposed to provide.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 33,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload leaves pending-deploy.json set, so every project's verification stalls until a patrol notices",
      "rationale": "A successful pan reload leaves the deploy queue set, and both verification-runner and verification-worker-supervisor defer while any deploy is queued — so every project's verification stops until a patrol happens to notice the build is fresh. Since the flywheel deploys after every merge, this starves verification repeatedly on exactly the nights the pipeline is busiest. Pairs with PAN-3244 and PAN-3205.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 34,
      "size": "XS",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback is written to .overdeck/feedback while agents and the merge gate read a nonexistent .pan/feedback",
      "rationale": "Review feedback is written to the resolved workspace runtime directory .overdeck/feedback/ while the path handed to the work agent — and read by the deacon merge gate — is a hardcoded .pan/feedback/ that no longer exists after the rebrand. Agents are told to fix findings at an empty path and the merge gate sees zero feedback files regardless of what review produced. Trivially small fix, whole-pipeline consequence.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3062",
      "rank": 35,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "The shared primary main worktree stacks every session's commits, so whoever pushes main ships everyone else's work",
      "rationale": "The primary worktree is checked out on main and shared by every conversation and the Flywheel, so commits from independent sessions stack on one branch and whoever pushes main next ships everyone else's work, verified or not. This is the write-side twin of PAN-3250 and the mechanism behind several unexplained main regressions. Ranked with the other main-integrity items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3677",
      "rank": 52,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning agents wedge after a background Explore task finishes; parent never consumes the result",
      "rationale": "Planning agents wedge after a background Explore task finishes; parent never consumes the result. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3560",
      "rank": 37,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "PTY supervisor overloads under review convoys: fleet-wide 502 echo-confirmation failures kill resumes and feedback",
      "rationale": "Under a window of concurrent review convoys every session resume and message delivery through the PTY supervisor failed with 502 'input echo confirmation failed', hitting at least six unrelated agents at once. The supervisor is the primary delivery transport, so overload there converts a busy pipeline into a fleet-wide communications outage — and busy is exactly when recovery matters. Related to PAN-3564 and PAN-3492 as load-coupled failures.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3301",
      "rank": 38,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog manifest still writes the legacy .pan path; the stray-writer patrol logs 68k lines hiding that defect",
      "rationale": "The state-recreation patrol logs a stray-writer warning every cycle — 68k log lines — and behind it sit two real defects: the backlog manifest still writes the legacy .pan path, and the patrol flags stale directories forever. The write-side twin of PAN-3631; together they explain why the backlog machinery keeps reading and writing different places. Labelled substrate-improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 39,
      "size": "S",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "A capacity-refused planning→work handoff is marked terminally stuck: every 409 becomes 'guardrails' and stuck",
      "rationale": "Three issues sat simultaneously stuck on the same failure because every HTTP 409 from a work-agent spawn is flattened to 'guardrails' and every skip reason calls markWorkspaceStuck — so a capacity refusal, which is transient and expected, is recorded as a terminal stuck state with no re-drive owner. Capacity pressure is normal operation; treating it as terminal converts a queue into a graveyard. Labelled substrate-improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 40,
      "size": "S",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "The test role evaluates the dirty working tree, so a live agent's uncommitted edits produce false test failures",
      "rationale": "The test role evaluates the workspace working tree rather than the reviewed commit, so a live work agent's uncommitted edits are counted against the issue and produce a test_status: failed verdict for code that was never reviewed and would never merge. Combined with PAN-3104 (stale results re-applied with no freshness check) it forms a durable trap that re-fails an issue after the fix has landed.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2954",
      "rank": 41,
      "size": "XS",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects",
      "rationale": "postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run. Blocker PAN-2882 closed since the prior pass, so this is now unblocked.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3685",
      "rank": 12,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed",
      "rationale": "Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3653",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A strike stopped by red main never wakes when main goes green — no recovery path, strike sits idle forever",
      "rationale": "A strike that correctly stopped after proving its gate was blocked by red main has no path that wakes it when main goes green again — main was reverted, the whole workflow set turned green, and five minutes later the strike was still idle at its old readiness with no recovery. Strikes exist to unblock the pipeline fast, so a strike that cannot resume after the blocker clears defeats its own purpose. Labelled substrate-improvement and blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3605",
      "rank": 44,
      "size": "XS",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint-effect-diagnostics npx fell back to the registry and executed a squatted package — pin the local bin",
      "rationale": "scripts/lint-effect-diagnostics.sh runs npx effect-language-service; on a checkout whose node_modules predates the dependency addition, npx missed the local bin, fell back to the npm registry, and non-interactively installed and executed a third-party squatter package under that unscoped name. The payload was benign this time. A lint script that can execute arbitrary registry code on a stale checkout is a supply-chain hole, and pinning the local bin closes it outright.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 45,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket reads as ambiguous keyed delivery, so review feedback never lands",
      "rationale": "ECONNREFUSED against a dead supervisor socket is misclassified as ambiguous keyed delivery, so review feedback that was written to disk is never delivered — the issue goes stuck at feedback_delivery_needs_you while the agent sits idle and the file sits there unread. Four review cycles were burned on one issue this way. Misclassifying a hard connection failure as an ambiguity means the retry path that would fix it never runs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 46,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "The deployment gate queues a deferred deploy and promises a next-verification-boundary trigger that does not exist",
      "rationale": "The deployment gate refuses and queues a deploy with an operator-facing promise that it will fire automatically at the next verification boundary — and that trigger does not exist anywhere. The message explicitly tells the operator not to retry or force, so the queued deploy simply never happens. A gate that queues into a void is worse than one that refuses, because it suppresses the manual recovery too.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 47,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model quota exhaustion halts agents invisibly — four planning agents 'running' at $0.00 with no capacity fallback",
      "rationale": "Four planning agents were reported running by the registry while producing nothing at all: 0% context, zero output, $0.0000 spend, because the model's quota was exhausted and nothing detects that state or falls back to available capacity. Quota exhaustion is routine on subscription plans, so an undetected halt converts a recoverable condition into hours of dead slots. Same family as PAN-3043.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 48,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default: hold is consulted on one merge path only, so held issues still auto-merge individually",
      "rationale": "auto_merge_default: hold is consulted on exactly one merge path, so every other path merges a ready issue without asking whether the project requires UAT first — an operator who configured hold still got individual auto-merges. This directly defeats the UAT batch-train model, since issues merge one at a time before a generation can assemble them. The fix is routing every merge path through the same policy check.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 49,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever and blocks its own replacement",
      "rationale": "A review session that spawns but is never briefed sits at zero context and zero tokens forever, and both recovery paths treat it as healthy work in progress — auto-dispatch no-ops because a session exists, and restart 'preserves' it. Review can then never start for that issue: the dead session blocks its own replacement. Detecting never-briefed sessions is the common fix with PAN-3397 and PAN-3563.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 50,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction is invisible to every recovery path, and the GPT-5.6 window is declared twice",
      "rationale": "Two coupled defects: a compaction the harness initiated on its own is invisible to every recovery path Overdeck has, so agents go silently idle after it, and the GPT-5.6 context window is declared twice with different values (372K vs 150K). Six MYN agents went idle after a host restart from the first; the second makes window-dependent behaviour non-deterministic depending on which declaration a code path reads.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 51,
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
      "rank": 52,
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
      "issue": "PAN-3734",
      "rank": 53,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reused completed swarm slot can start a new item from a stale polyrepo branch — silent wrong-base work",
      "rationale": "A normally completed swarm slot can be reassigned while its polyrepo worktree is still on the old slot branch, so the new agent starts from stale code instead of the current issue parent — reproduced live with a reused worktree still at an old item's HEAD. Starting from the wrong base is silent: the work looks fine and the diff is wrong. PAN-3724 hardened the blocked-slot path; this completed-slot path is still open.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3633",
      "rank": 54,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike workspaces get an incomplete dep tree, so typecheck:evals fails and agents abort on a false 'main is red'",
      "rationale": "pan strike created a workspace whose dependency tree was incomplete, so typecheck:evals failed there while npm run typecheck was green on the primary main worktree — and the agent reasonably concluded main was red, implemented its fix, then aborted without pushing. An environment defect that makes agents report false pipeline state wastes the strike and poisons the operator's picture of main. Labelled substrate-improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3580",
      "rank": 51,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL",
      "rationale": "The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3563",
      "rank": 56,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role agent with an undelivered prompt stays 'running' forever; dispatcher no-ops and pan unstick can't see it",
      "rationale": "A role agent whose PTY prompt delivery failed never boots, but its state.json is left as running forever — so the dispatcher no-ops on 'already in progress', review reports already-passed, and pan unstick cannot even see role agents. An invisible zombie that absorbs every subsequent dispatch is the shape shared by PAN-3566, PAN-3274 and PAN-3084; this one covers the state-plane half.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3543",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while recommending --fresh",
      "rationale": "After a work agent finishes, is reaped, and review comes back blocked, pan start refuses and recommends --fresh, pan start --fresh gives the identical refusal recommending --fresh, and reset-session refuses too. The agent is unstartable by every documented door while the rework it needs to do is owed. Self-contradictory deadlocks like this one and PAN-3526 cost an operator intervention each time rework is required.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 58,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient merge_status=failed skips close-out permanently, leaving merged work open and pickup-eligible",
      "rationale": "A transient merge_status: failed reading taken immediately after a successful merge makes automatic close-out skip the issue permanently, with nothing retrying once the status self-heals — so the issue stays merged but open, reads as pickup-eligible, and got a fresh planning agent spawned on already-shipped work. Spending a planning agent on merged work is the most visible symptom; the open row also corrupts every backlog count.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3078",
      "rank": 59,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect verdicts are persisted but never delivered, so a work agent that waits for one deadlocks forever",
      "rationale": "Per-item inspect verdicts are persisted to review_status and checkpointed, but nothing delivers them to the work agent — so an agent that parks deliberately to wait for its verdict waits forever. The inspection gate is only meaningful if its result reaches the thing it gates; today passing inspection and never hearing about it are indistinguishable to the agent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3043",
      "rank": 60,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion is undetected: an agent stays 'running' for days holding a slot at a 403 wall",
      "rationale": "An agent has been registered running since a hard provider refusal 3.5 days earlier, tmux session alive, pane showing a 403 usage-limit wall, holding its slot the whole time. Mid-run quota exhaustion is undetected, so the capacity accounting the scheduler depends on is simply wrong. Detecting the provider-refusal pane state is the same work as PAN-3118 and should land together.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 61,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch",
      "rationale": "Ghost test sessions that never received kickoff absorb every dispatch, marking testing with no prompt delivered.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 62,
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
      "rank": 63,
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
      "rank": 64,
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
      "rank": 65,
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
      "rank": 66,
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
      "issue": "PAN-2874",
      "rank": 67,
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
      "rank": 68,
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
      "rank": 69,
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
      "issue": "PAN-2796",
      "rank": 70,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "idle nudge must not advance after failed mandatory inspection",
      "rationale": "Idle nudge advances a work agent past a failed mandatory inspection, bypassing the inspection gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 71,
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
      "issue": "PAN-3697",
      "rank": 72,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployed dashboard PATH omits Bun, so verification workers fail their dependency-install gate",
      "rationale": "The deployed Node 22 dashboard was launched with a PATH that omits ~/.bun/bin, so verification workers logged 'bun: not found' before their required dependency-install gate. Verification is the gate every merge waits on, and an environment-dependent failure there produces false verdicts rather than an honest error. pan reload should resolve the Bun directory deterministically at launch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3654",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Compact respawn confirms against the archived session and kills the fresh agent that already accepted recovery",
      "rationale": "pan recover --compact reported kickoff-not-confirmed twice and killed a replacement session that had already accepted the recovery prompt and was doing real work — it was confirming against the archived session rather than the fresh one. A recovery command that destroys the recovery it just performed is worse than no recovery, because the operator's next move is to run it again.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3621",
      "rank": 74,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start dies at spawn on a chunk graph spliced across two builds — silent module-not-found, retry succeeds",
      "rationale": "pan start aborted at spawn resolving a chunk graph spliced across two builds — an importer name from the primary dist build with a path rooted in the live deployment generation — and an immediate identical retry succeeded with nothing changed in between. Intermittent spawn death with a raw Node module-resolution message blocks work dispatch and pipeline recovery, and it is silent about the real condition. Labelled substrate-improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3522",
      "rank": 75,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor watchdog restart-churns under CPU storm because the probe budget ignores the boot warm phase",
      "rationale": "Under a machine-wide CPU storm the :3012 supervisor watchdog entered a restart-churn loop on the dashboard because the health-probe timeout budget takes no account of the boot warm phase — a healthy but slow server gets killed and the replacement is killed the same way. Restart churn during load is how a recoverable pressure spike becomes an outage; it also produced the orphaned-server symptoms tracked elsewhere.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 76,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review convoy member blocked on an operator AskUserQuestion; review and inspect roles must decide, not ask",
      "rationale": "A review convoy member blocked on an operator AskUserQuestion asking which review depth to use, wedging the convoy — and because convoys respawn, the operator got the same dialog repeatedly. The review pipeline's entire purpose is autonomy, so a review or inspect agent that parks itself on an operator question converts autonomous motion into a queue of identical prompts. Decide, don't ask, enforced mechanically. Labelled substrate-improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3344",
      "rank": 77,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resource governor gates only on memory; CPU load storms from concurrent agent test runs go unchecked",
      "rationale": "The dev box hit load average ~48 on 24 cores with memory fine, because the resource governor gates dispatch on memory alone while the actual pressure came from concurrent agent-shell test runs. Nearly every load-coupled failure filed since — the watchdog churn, the self-amplifying retry loop, the timeout-only test verdicts — traces back to unbounded concurrent gate runs. It has a PRD and it is the systemic fix beneath several symptom issues.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3274",
      "rank": 78,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A test-role agent can spawn and never run a turn, stranding its issue behind a verdict that never existed",
      "rationale": "A test-role agent spawned, never executed a single turn, and held its issue out of the merge gate indefinitely — review approved, CI green, blocked only by a verdict that was never produced. Zero context, zero output, zero cost is a distinguishable state, and nothing checks for it. PAN-3566 supplies the deterministic cause for the claude-code case; this issue owns the detection and recovery side.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 79,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A queued dashboard deploy defers verification globally, starving cross-project review handoffs for 30+ minutes",
      "rationale": "A dashboard deploy queued by the deploy patrol globally defers verification, so a myn issue's review convoy never spawned for 30+ minutes despite its durable review intent being written correctly. The deploy window is flywheel-owned and frequent, so a global defer means cross-project review handoffs starve on a cadence nobody chose. Same defect family as PAN-3248 and PAN-3205.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 80,
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
      "rank": 81,
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
      "rank": 82,
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
      "rank": 83,
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
      "rank": 84,
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
      "rank": 85,
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
      "rank": 86,
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
      "rank": 87,
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
      "rank": 88,
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
      "rank": 89,
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
      "rank": 90,
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
      "rank": 91,
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
      "rank": 92,
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
      "issue": "PAN-3650",
      "rank": 93,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike self-abort leaves state.json running, so every deacon recovery pass resurrects the aborted strike",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3571",
      "rank": 94,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop-hook completion check exits silently on timeout — 334 stranded turn-ends with no nudge or escalation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3329",
      "rank": 95,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout builds delete the deployment generation's node_modules and tracked packages/ files (2nd occurrence)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 96,
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
      "rank": 97,
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
      "rank": 98,
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
      "rank": 99,
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
      "rank": 100,
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
      "rank": 101,
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
      "issue": "PAN-2179",
      "rank": 102,
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
      "rank": 103,
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
      "rank": 104,
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
      "rank": 105,
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
      "rank": 106,
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
      "issue": "PAN-3708",
      "rank": 107,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike dies on polyrepo wrappers before worktree provisioning — the urgent-unblock path is unavailable there",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3622",
      "rank": 108,
      "size": "XS",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "orphan-proposed-reconciler test asserts on a real GitHub issue; its closure now reds pan release check on a green main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3565",
      "rank": 109,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review lifecycle: failed spawn wedges 'starting', infra-failure fabricates a CHANGES REQUESTED verdict, pan tell hangs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3541",
      "rank": 110,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review restart after unclean reviewer death loops on the session-resume menu; eligibility ignores how it ended",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 111,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Freshly-spawned convoy lanes freeze at 0 output; the PAN-3375 detector only covers warm resumes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 112,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "New workspaces arrive with empty node_modules and bun off PATH, so the documented bun install remedy fails",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 113,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 accepts only the transient verifying_on_main waypoint, so an already-done issue can never close out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3139",
      "rank": 114,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents-table liveness drifts stale toward 'stopped' for live agents, and pan start's refusal contradicts it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 115,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix landed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 116,
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
      "rank": 117,
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
      "issue": "PAN-2960",
      "rank": 118,
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
      "rank": 119,
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
      "rank": 120,
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
      "rank": 121,
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
      "rank": 122,
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
      "rank": 123,
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
      "rank": 124,
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
      "issue": "PAN-3569",
      "rank": 125,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale pending-post-merge.json deadlocks the deploy gate with no staleness rule and no non-force exit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 126,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fresh workspaces ship an empty node_modules, so tooling silently resolves deps from the parent repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 127,
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
      "rank": 128,
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
      "rank": 129,
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
      "rank": 130,
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
      "rank": 131,
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
      "issue": "PAN-2880",
      "rank": 132,
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
      "rank": 133,
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
      "rank": 134,
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
      "rank": 135,
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
      "issue": "PAN-3667",
      "rank": 136,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy has no cross-family remap, so every model-pinned subagent dies at spawn inside proxied GPT sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3651",
      "rank": 137,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-land the reverted overdeck-state non-fast-forward push retry with the pan-dir state-door suites green",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3617",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three strike dispatches produced zero output and zero transcript while a sibling strike ran normally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3555",
      "rank": 139,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plain pan start spawned a FRESH session over a resumable warm one — warm-by-default silently violated",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3535",
      "rank": 140,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Drain hold lives in the caller's env, so any restart from a clean shell silently drops the no-resume gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review sub-role resumed after writing its report and edited the branch, breaking the read-only review contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3499",
      "rank": 142,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan parked ack calls ProjectConfig.projectPath, which does not exist — a tsc error landed on main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3464",
      "rank": 143,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm reset never clears slotCompletions, so a stale marker re-arms the exact wedge the operator just cleared",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3297",
      "rank": 144,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "After a dashboard restart pan tell calls healthy supervisor-run agents zombies while resume calls them healthy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 145,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume leaves a stale PTY socket and drops supervisorEnabled, so every delivery afterwards is refused",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 146,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan merge cancel has never worked: Commander's options object lands in the fetchImpl injection slot",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3179",
      "rank": 147,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote completes at merge time with no production evidence, so members read shipped while prod serves the old build",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3168",
      "rank": 148,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 counts an agent paused for close-out as running, deadlocking the close-out that paused it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 149,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "The agent git guard is PATH-based and removable by the agent it constrains — one did so unprompted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 150,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against closed issues, resurrecting agents and raising needs-you days after close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 151,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 152,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn is abandoned on a transient Docker failure — 'attempt 1/3' never retries and nothing re-drives",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3022",
      "rank": 153,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "The work-spawn route ignores the per-issue workModel override, then clobbers the record with the role default",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 154,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "rationale": "Event-loop stalls under load turned out to be the shared root cause behind a whole cluster of incidents filed since the last pass: the supervisor watchdog restart-churn (PAN-3522), the self-amplifying verification retry loop (PAN-3492), and the P0 runaway --changed loop (PAN-3524) all present as a starved server. Lifted from medium to high — fixing the stall removes the mechanism those symptoms share.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2627",
      "rank": 155,
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
      "rank": 156,
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
      "rank": 157,
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
      "rank": 158,
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
      "rank": 159,
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
      "rank": 160,
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
      "rank": 161,
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
      "rank": 162,
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
      "rank": 163,
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
      "rank": 164,
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
      "issue": "PAN-3596",
      "rank": 165,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon patrol has no per-step timing, so overruns in the central scheduler cannot be attributed to a step",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3505",
      "rank": 166,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unpushed agent code commits on the primary main worktree make the guard refuse the flywheel's state push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3439",
      "rank": 167,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start crashes on a pending-work-spawn placeholder row instead of taking the fresh-spawn path resume already guards",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1824",
      "rank": 168,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "rationale": "Flaky main CI — needs fake timers + @slow exclusion for the real-timer test family.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2075",
      "rank": 169,
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
      "rank": 170,
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
      "rank": 171,
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
      "rank": 172,
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
      "rank": 173,
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
      "rank": 174,
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
      "rank": 175,
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
      "rank": 176,
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
      "issue": "PAN-3634",
      "rank": 177,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning auto-handoff stamps the ambient flywheelRunId on operator-started agents, stripping reaping exemption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3556",
      "rank": 178,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Two spawn flows raced the same agent at UAT promote and allocated two fresh session identities 3s apart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3517",
      "rank": 179,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy forks still miss the parent prompt cache: launch-injection byte drift plus resume dropping the scope header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3432",
      "rank": 180,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive yield fans out: seven work agents paused to make room for one review convoy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 181,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no sanctioned main sync: rebase is guard-blocked and pan sync-main can't resolve -strike workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 182,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike rebase has no working path: the role prompt tells it to, the launcher guard blocks it, sync-main resolves elsewhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 183,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sequencer ran a full pass on a transiently empty manifest while the tracker held ~750 open issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 184,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "One issue's agent sessions vanished four times in a single run, each recovery needing a manual pan start",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 185,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux fallback answers a live resume-choice menu its own paste hid from the detector, silently compacting the session",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 186,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN pipeline membership reports forge_unavailable because glab runs in the polyrepo root, which is not a git repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3224",
      "rank": 187,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A crash-interrupted spawn strands model 'pending-work-spawn'; plain pan start dies and only --fresh recovers",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3186",
      "rank": 188,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "One configured member that is not a git repo blanks pipeline membership for the whole auricle project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3174",
      "rank": 189,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every polyrepo UAT stack 504s: stale myn- Traefik prefix, Traefik off the devnet, and a 4173/5173 port mismatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 190,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "MERGE refuses or dead-ends when the preemptive scheduler yielded the work agent the merge path requires",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 191,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done fails on the generated devcontainer harness, so agents infer they should delete workspace infrastructure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 192,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect/review-supervisor spawns omit --effort and inherit the harness xhigh default, once per xBRIEF item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3047",
      "rank": 193,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "--is-ancestor can't see a squash merge, so strike-branch teardown never fires and 96 strike/* branches persist",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3012",
      "rank": 194,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archived conversations die when the harness deletes its JSONL — back transcripts up before that happens",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2995",
      "rank": 195,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Same squash-merge ancestry defect as PAN-2828: pan done --strike false-blocks after a gh-API squash merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 196,
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
      "rank": 197,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2466"
      ],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "rationale": "Cost-bleed circuit breaker — progress-aware, always-on guard against runaway spend; the one real guard the epic authorizes.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2466",
      "rank": 198,
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
      "rank": 199,
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
      "rank": 200,
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
      "rank": 201,
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
      "rank": 202,
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
      "rank": 203,
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
      "issue": "PAN-3557",
      "rank": 204,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge label application has no retry; a rate-limited 403 hides the issue from the verify-on-main sweep",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2351",
      "rank": 205,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "rationale": "Scoped access tokens are the security prerequisite for BOTH candidate Anywhere directions — the original relay/tunnel phases of PAN-2350 and the new per-machine federation proposal in PAN-3762 name it as a hard dependency. It is the one Anywhere phase whose value does not depend on which direction wins, so it is lifted out of the contested block.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3629",
      "rank": 206,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "No sanctioned door to re-scope a live agent, so rejected in-flight designs can still land",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3553",
      "rank": 207,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Census treats a zero-session tmux server as unavailable, so post-reboot conversations sit on 'Starting…' for minutes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3460",
      "rank": 208,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-item verify_commands run the whole root suite, making slot merge gates load-fragile and expensive",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3355",
      "rank": 209,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is actually unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3308",
      "rank": 210,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size guard prints a paste-ready ceiling-raise line, so agents ratchet the limit instead of shrinking the file",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3295",
      "rank": 211,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "One per-machine completion-check summarizer with a queue — today's unbounded haiku fan-out froze the box",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 212,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "A work agent's file write landed in the primary main worktree; the guard covers commits and pushes, not writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 213,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitLab merged-head oracle spawns one glab subprocess per repo×head, so every pipeline-membership refresh fails",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 214,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reports a hard failure when the deacon wins the spawn race — duplicate-session TOCTOU inside spawn.ts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 215,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline reports 'merge failed' after a successful merge and cleanup, leaving the issue Todo with the commit on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3129",
      "rank": 216,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: an agent can plant a symlink in its workspace and steer the next canonical write outside its root",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 217,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper matches only overdeck-feature-* names, so MYN stacks hold GBs of RAM long after their agents die",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 218,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands .pan/drafts/<issue>.md in product feature branches; the exclusion list has drifted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 219,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan monitor: a pull-based background inbox transport, replacing keystroke injection as the delivery path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2971",
      "rank": 220,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator finalized its own run and kept ticking for 19h as a zombie with Pause/Stop disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 221,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "rationale": "Now labelled `planned` as well as `substrate-improvement`: the plan exists, so the merged-but-not-closed-out counter is immediately startable rather than needing a planning pass first. Lifted accordingly.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3760",
      "rank": 222,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "permissionMode 'auto' maps to --permission-mode default; invalid values drop silently, operator gets unexpected prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3570",
      "rank": 223,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-owned node_modules/.pnpm-store from container runs EACCES-blocks pan start; workspace rebuild no-ops",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3536",
      "rank": 224,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell can't reach ohmypi conversations: expectedHarness defaults to claude-code when state.json is absent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3513",
      "rank": 225,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent runtime plane on overdeck-state: durable session pointers and GC-as-cache-eviction — the Anywhere data plane",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3454",
      "rank": 226,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated cache warnings, double-billed spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3303",
      "rank": 227,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "An empty registered-projects response is treated as authoritative, latching Command Deck on 'Unknown project'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3243",
      "rank": 228,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit test polls a fixed 20 setImmediate turns for a real git subprocess — flakes main and blocks close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 229,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out passes every DoD row then dies on EACCES removing root-owned container residue in the workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3176",
      "rank": 230,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT batch promotion takes no health evidence, so a degraded or still-booting stack can be promoted to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 231,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout 120 is enforced as 120ms, false-failing the probe and leaving the dashboard down",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3032",
      "rank": 232,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stack rebuild composes under overdeck-feature- while Traefik labels name myn-feature- devnet; attaches are runtime-only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 233,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pre-push file-size guard audits the dirty working tree, so another session's edits block unrelated pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3518",
      "rank": 234,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "TTL-aware re-review payload policy: fresh-spawn-with-digest for cold, large histories (needs-design)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3463",
      "rank": 235,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "A legitimate no-op slot outcome can never satisfy its item verify_commands, so the slot wedges permanently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3218",
      "rank": 236,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: a user-facing fix can sit merged on main while every published version stays broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 237,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Teardown scopes containers by compose project while the guard scopes by working_dir, so close-out blocks on residue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3113",
      "rank": 238,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface agent-pane choice prompts as inline decision cards so a blocked agent is answerable without the terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3762",
      "rank": 239,
      "size": "XL",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere: federate one dashboard client across per-machine Overdeck servers (t3code model)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3420",
      "rank": 270,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 241,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: identifier-joined write paths have no mechanical containment under their intended root",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3652",
      "rank": 242,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add workflow_dispatch to ci.yml and state-plane-branches.yml so a never-run main tip can be verified on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 243,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project resource isolation classes so one project's stacks cannot starve another project's pipeline",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3510",
      "rank": 244,
      "size": "S",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stopped agents leave detached docker-run test containers alive for hours, contending with other gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 245,
      "size": "S",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux and lexerra are permanently unreadable: the App isn't installed on them and 404 is typed as forge_unavailable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 246,
      "size": "XS",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log grows unbounded (867MB) with no rotation, costing disk and making incident logs un-greppable",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3046",
      "rank": 247,
      "size": "XS",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3701",
      "rank": 248,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Four unrelated first-party LLM client stacks; consolidate onto effect/unstable/ai LanguageModel + ExecutionPlan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3579",
      "rank": 249,
      "size": "S",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit frontend mutations that hand-write JSON headers and so omit the CSRF token, 403ing guarded routes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3527",
      "rank": 250,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "One failed boot-time fetch leaves the sidebar at CONVERSATIONS 0 / ISSUES 0 with no retry until manual reload",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3321",
      "rank": 251,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Escalation copy and CLAUDE.md tell operators to run pan unstick, which errors as an unknown command",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3245",
      "rank": 252,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done flags the generated .pan/drafts/<issue>.md as uncommitted work despite its own .pan exclusion",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3094",
      "rank": 253,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's merge fallback still force-pushes a branch a normal push would fast-forward, half-completing the command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3003",
      "rank": 254,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generated launcher.sh omits the OVERDECK_AGENT_ID export the PTY supervisor hard-requires, so manual re-launch dies",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3445",
      "rank": 255,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "projects.yaml TCP lock ports overlap the ephemeral client range, so uncontended config writes randomly fail",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3332",
      "rank": 256,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard slash-command activities leave 'running in background' standing after the spawn already died",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3288",
      "rank": 257,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout preflight should say 'run bun install' instead of dying on a raw ERR_MODULE_NOT_FOUND after git pull",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3181",
      "rank": 258,
      "size": "L",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Own agent memories: migrate harness project memories to a per-repo overdeck-memory orphan branch so they travel",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3107",
      "rank": 259,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Productize the memory-attribution census so OOM spikes remain attributable after the fact",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3013",
      "rank": 260,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role-scoped linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp paths",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1666",
      "rank": 261,
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
      "rank": 262,
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
      "rank": 263,
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
      "issue": "PAN-2189",
      "rank": 264,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines)",
      "rationale": "Decompose deacon.ts (3,394 lines) — pipeline-runtime machinery; supervised handoff only, not autonomous pickup.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2190",
      "rank": 265,
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
      "rank": 266,
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
      "rank": 267,
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
      "rank": 268,
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
      "rank": 269,
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
      "rank": 270,
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
      "rank": 271,
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
      "rank": 272,
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
      "rank": 273,
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
      "rank": 274,
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
      "rank": 275,
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
      "rank": 276,
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
      "rank": 277,
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
      "rank": 278,
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
      "rank": 279,
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
      "rank": 280,
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
      "rank": 281,
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
      "rank": 282,
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
      "rank": 283,
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
      "rank": 284,
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
      "rank": 285,
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
      "rank": 286,
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
      "rank": 287,
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
      "rank": 288,
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
      "rank": 289,
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
      "rank": 290,
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
      "rank": 291,
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
      "rank": 292,
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
      "rank": 293,
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
      "rank": 294,
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
      "issue": "PAN-2755",
      "rank": 295,
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
      "rank": 296,
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
      "rank": 297,
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
      "rank": 298,
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
      "rank": 299,
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
      "rank": 300,
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
      "rank": 301,
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
      "rank": 302,
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
      "rank": 303,
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
      "rank": 304,
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
      "rank": 305,
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
      "rank": 306,
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
      "rank": 307,
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
      "rank": 308,
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
      "rank": 309,
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
      "rank": 310,
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
      "rank": 311,
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
      "rank": 312,
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
      "rank": 313,
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
      "rank": 314,
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
      "rank": 315,
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
      "rank": 316,
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
      "rank": 317,
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
      "rank": 318,
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
      "rank": 319,
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
      "rank": 320,
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
      "rank": 321,
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
      "rank": 322,
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
      "rank": 323,
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
      "rank": 324,
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
      "rank": 325,
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
      "rank": 326,
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
      "rank": 327,
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
      "issue": "PAN-2350",
      "rank": 328,
      "size": "L",
      "importance": "high",
      "score": 69,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere",
      "rationale": "Epic container for the Anywhere phases P0-P3; ranked by aggregate child impact, never picked up directly. Marked needs-refinement because PAN-3762 proposes a materially different default direction (a complete Overdeck server per machine with the dashboard client as the federation layer, cloud relay optional) — the transport-first phase breakdown here needs an operator decision before its later phases are worth planning.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1217",
      "rank": 329,
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
      "rank": 330,
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
      "rank": 331,
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
      "rank": 332,
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
      "rank": 333,
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
      "rank": 334,
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
      "rank": 335,
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
      "rank": 336,
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
      "rank": 337,
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
      "rank": 338,
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
      "rank": 339,
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
      "rank": 340,
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
      "rank": 341,
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
      "rank": 342,
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
      "rank": 343,
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
      "rank": 344,
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
      "rank": 345,
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
      "rank": 346,
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
      "rank": 347,
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
      "rank": 348,
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
      "rank": 349,
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
      "rank": 350,
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
      "rank": 351,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1913",
      "rank": 352,
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
      "rank": 353,
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
      "rank": 354,
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
      "rank": 355,
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
      "rank": 356,
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
      "rank": 357,
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
      "rank": 358,
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
      "issue": "PAN-471",
      "rank": 359,
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
      "rank": 360,
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
      "rank": 361,
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
      "rank": 362,
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
      "rank": 363,
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
      "issue": "PAN-2921",
      "rank": 364,
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
      "rank": 365,
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
      "rank": 366,
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
      "rank": 367,
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
      "rank": 368,
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
      "rank": 369,
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
      "rank": 370,
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
      "rank": 371,
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
      "rank": 372,
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
      "rank": 373,
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
      "rank": 374,
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
      "rank": 375,
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
      "rank": 376,
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
      "issue": "PAN-3516",
      "rank": 377,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale bundled-skill duplicates in repo .claude/skills shadow the canonical sync-sources copies",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3455",
      "rank": 378,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "cliproxy --version exits 2, so the up-to-date check always fails and every ensure re-downloads the release",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3307",
      "rank": 379,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "commitlint scope-enum is stale and warns on most real commits, training everyone to ignore its output",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3276",
      "rank": 380,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "NEEDS YOU rows don't navigate: clicking a terminal question or permission prompt does nothing",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3211",
      "rank": 381,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Closed-without-landing issues leave review_status residue that pan close can never honestly pass",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3175",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train ordering derives conflict only from file overlap and cannot see that one feature requires another",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 383,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck session tree enumerates only workspace dirs, so strike-only and workspace-less issues show no node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 384,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background AI title/about spawns fail because claude -p --bare skips credential reads in 2.1.209",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 385,
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
      "rank": 386,
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
      "rank": 387,
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
      "rank": 388,
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
      "rank": 389,
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
      "rank": 390,
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
      "rank": 391,
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
      "rank": 392,
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
      "rank": 393,
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
      "rank": 394,
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
      "rank": 395,
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
      "rank": 396,
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
      "rank": 397,
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
      "rank": 398,
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
      "rank": 399,
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
      "issue": "PAN-3751",
      "rank": 260,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge deploy runs a multi-minute build with no dashboard indication — operator reads a silent deploy as a lost notification",
      "rationale": "Deploy is a Definition-of-Done row, and it currently runs with no visible progress anywhere in the dashboard, so an operator waiting for the restart ask concludes the notification was lost when the build is simply still running. That misread costs real time on flywheel nights when deploys stack up, and it is the visibility half of the deploy-gate defects already ranked above it. In pipeline and planned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3668",
      "rank": 176,
      "size": "L",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Prime Agent as a managed harness (in flight — RPC runtime adapter, discovery, transcripts)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 402,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload rebuilds the linked generation in place, so the global pan CLI vanishes for the whole deploy",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3354",
      "rank": 403,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archiving the main workspace drops the singleton row from every view with no unarchive affordance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3235",
      "rank": 404,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard decision card should render and answer agent pane-choice menus (follow-up split out of PAN-3228)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3164",
      "rank": 405,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT stack offers 'Open UAT frontend' while still booting, so the operator gets a Gateway Timeout with no explanation",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3121",
      "rank": 406,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send outbox never reconciles against the transcript, so a delivered message keeps a doomed Retry twin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3016",
      "rank": 407,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "URL-address every view so any place you navigate to in Overdeck can be reached again from the URL",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2982",
      "rank": 408,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review convoy should run a skill's own selftest when a PR touches sync-sources/skills/**",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 409,
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
      "rank": 410,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 411,
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
      "rank": 412,
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
      "rank": 413,
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
      "rank": 414,
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
      "rank": 415,
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
      "rank": 416,
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
      "rank": 417,
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
      "rank": 418,
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
      "rank": 419,
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
      "rank": 420,
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
      "rank": 421,
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
      "rank": 422,
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
      "rank": 423,
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
      "issue": "PAN-3689",
      "rank": 129,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphaned swarm-slot GC targets the aggregate polyrepo root; nested worktrees survive and spam failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3627",
      "rank": 425,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "backlog-auto-trigger throws on an empty manifest, so plain npx @overdeck/core in a non-project dir stack-traces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3504",
      "rank": 426,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Duplicate of PAN-3499: parked.ts references ProjectConfig.projectPath, which does not exist",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3290",
      "rank": 427,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF items can carry empty metadata.traces, so docs items are invisible to requirement traceability",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3157",
      "rank": 428,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awareness feed renders the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of run activity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3137",
      "rank": 429,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles come from the Flywheel status snapshot, leaking orchestrator prose to the operator",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3131",
      "rank": 430,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support xBRIEF planRef sharding in planning authoring and pipeline-wide consumption for very large specs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3117",
      "rank": 431,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send bubble hides a deterministic 4xx reason and offers a Retry that can never succeed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 432,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page: narrative feed instead of a 55KB raw kickoff dump, surface the pending question, honest blocked state",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3036",
      "rank": 433,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pane-idle heuristic misreads post-strike-ready idle as a pending question, showing a false ! INPUT chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 434,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K conversation hits 404 because the search index never prunes chunks for deleted JSONL sessions",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2280",
      "rank": 435,
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
      "rank": 436,
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
      "rank": 437,
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
      "rank": 438,
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
      "rank": 439,
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
      "rank": 440,
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
      "rank": 441,
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
      "rank": 442,
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
      "rank": 443,
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
      "rank": 444,
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
      "rank": 445,
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
      "rank": 446,
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
      "rank": 447,
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
      "rank": 448,
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
      "issue": "PAN-3616",
      "rank": 449,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planned deploy restarts show the generic Reconnecting banner; reuse the 4503 lifecycle signal for calm copy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3178",
      "rank": 450,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class worktrees and diffs: +/- changes badge, a dedicated Changes surface, conversation worktrees",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3017",
      "rank": 451,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue-page UAT panel should expose the full stack action menu and render consistently, including for absent stacks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 452,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness so any capability-advertising ACP agent CLI is a spawnable Overdeck runtime",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1740",
      "rank": 453,
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
      "rank": 454,
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
      "rank": 455,
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
      "rank": 456,
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
      "rank": 457,
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
      "rank": 458,
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
      "rank": 459,
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
      "issue": "PAN-3700",
      "rank": 460,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan acp serve: expose Overdeck as an ACP agent so Zed and other ACP clients can drive conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3540",
      "rank": 461,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View: phantom agent orbs with no liveness check, dead Hook Bus panel, pressure-blind swap header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3502",
      "rank": 462,
      "size": "XS",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "tiered-crews blendedCost expectation is stale against current model-capabilities pricing",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3132",
      "rank": 463,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt xBRIEF v0.9 agentic dispatch fields end-to-end, aligning with the upstream deftai/xBRIEF proposal",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1572",
      "rank": 464,
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
      "rank": 465,
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
      "rank": 466,
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
      "rank": 467,
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
      "rank": 468,
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
      "rank": 469,
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
      "rank": 470,
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
      "rank": 471,
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
      "issue": "PAN-3530",
      "rank": 472,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Four God View components poll on 30s timers, contradicting its documented /ws/rpc event-driven contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 473,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [
        "PAN-3054"
      ],
      "why": "Dispatch-topology advisor: a mechanical start-vs-swarm recommendation computed at plan finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 474,
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
      "rank": 475,
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
      "rank": 476,
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
      "rank": 477,
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
      "rank": 478,
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
      "rank": 479,
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
      "rank": 480,
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
      "rank": 481,
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
      "rank": 482,
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
      "rank": 483,
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
      "rank": 484,
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
      "rank": 485,
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
      "rank": 486,
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
      "issue": "PAN-1173",
      "rank": 487,
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
      "rank": 488,
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
      "issue": "PAN-3731",
      "rank": 489,
      "size": "XS",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restart-gate banner gives no feedback after approval; dead-requester approvals look like a broken button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: run one template issue under N configurations and compare cost, time and outcome",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 491,
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
      "rank": 492,
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
      "rank": 493,
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
      "rank": 494,
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
      "rank": 495,
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
      "rank": 496,
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
      "rank": 497,
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
      "rank": 498,
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
      "rank": 499,
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
      "rank": 500,
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
      "rank": 501,
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
      "rank": 502,
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
      "rank": 503,
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
      "rank": 504,
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
      "rank": 505,
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
      "rank": 506,
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
      "rank": 507,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex handoff serializes large rollouts twice (~286MB peak RSS on a 50MB rollout)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3615",
      "rank": 508,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "TTS silent 9+ days from four stacked failures; three fixed, remaining watchdog/surfacing follow-ups",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 509,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship standing-crew templates so tiered execution can be configured from a preset instead of hand-built YAML",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 510,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "ACP agent setup UI: detect installed ACP CLIs, show auth status and guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 511,
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
      "rank": 512,
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
      "rank": 513,
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
      "rank": 514,
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
      "rank": 515,
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
      "rank": 516,
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
      "rank": 517,
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
      "rank": 518,
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
      "rank": 519,
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
      "rank": 520,
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
      "issue": "PAN-1951",
      "rank": 521,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1164",
      "rank": 522,
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
      "rank": 523,
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
      "rank": 524,
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
      "issue": "PAN-3735",
      "rank": 525,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI blames a down dashboard when the real cause is a sandboxed shell with no network",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3706",
      "rank": 526,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Broadsheet shipped typography only; color, surface, elevation and texture are still on Ledger values",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3333",
      "rank": 527,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model pickers show $/1M, which answers the wrong question on a subscription — show relative plan drain",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 528,
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
      "rank": 529,
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
      "rank": 530,
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
      "rank": 531,
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
      "rank": 532,
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
      "rank": 533,
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
      "rank": 534,
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
      "rank": 535,
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
      "rank": 536,
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
      "rank": 537,
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
      "rank": 538,
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
      "rank": 539,
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
      "rank": 540,
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
      "rank": 541,
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
      "rank": 542,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "rationale": "Container for the Traycer gap-analysis dispositions (PAN-2565, PAN-2608, PAN-2609, PAN-277, PAN-658); it closes when every gap has a disposition, so it is scored by aggregate child impact and never picked up directly.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2565",
      "rank": 543,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2558",
      "rank": 544,
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
      "rank": 545,
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
      "rank": 546,
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
      "rank": 547,
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
      "rank": 548,
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
      "rank": 549,
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
      "issue": "PAN-3661",
      "rank": 550,
      "size": "XS",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "issueActions review-mode tests fail locally while CI is green — semantic-rejection toast never fires",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 551,
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
      "rank": 552,
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
      "rank": 553,
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
      "rank": 554,
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
      "rank": 555,
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
      "rank": 556,
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
      "rank": 557,
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
      "rank": 558,
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
      "issue": "PAN-3469",
      "rank": 559,
      "size": "S",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate NewProjectModal to a routed full page under the PAN-3410 page-not-modal doctrine",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2288",
      "rank": 560,
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
      "rank": 561,
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
      "rank": 562,
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
      "rank": 563,
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
      "rank": 564,
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
      "rank": 565,
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
      "rank": 566,
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
      "rank": 567,
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
      "rank": 568,
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
      "rank": 569,
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
      "rank": 570,
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
      "rank": 571,
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
      "rank": 572,
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
      "rank": 573,
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
      "rank": 574,
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
      "issue": "PAN-3684",
      "rank": 594,
      "size": "XS",
      "importance": "low",
      "score": 42,
      "condition": "ok",
      "dependsOn": [
        "PAN-1641"
      ],
      "why": "Temporary acceptance issue: spawn a Pi work agent on ollama:gemma4:12b and record evidence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2978",
      "rank": 576,
      "size": "S",
      "importance": "low",
      "score": 42,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976",
        "PAN-2977"
      ],
      "why": "Offer per-agent install recipes from the ACP setup UI instead of linking the operator to vendor docs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 577,
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
      "rank": 578,
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
      "rank": 579,
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
      "rank": 580,
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
      "issue": "PAN-1937",
      "rank": 581,
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
      "rank": 582,
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
      "rank": 583,
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
      "rank": 584,
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
      "rank": 585,
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
      "rank": 586,
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
      "rank": 587,
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
      "rank": 588,
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
      "rank": 589,
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
      "rank": 590,
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
      "issue": "PAN-3705",
      "rank": 485,
      "size": "XS",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K: add Conversations as a first-class entry in the type list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3703",
      "rank": 455,
      "size": "XS",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K: sort conversation results newest-first by the canonical recency field",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3335",
      "rank": 593,
      "size": "XS",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pasted conversation screenshots have no click-to-enlarge, so the operator can't check what was attached",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3322",
      "rank": 594,
      "size": "XS",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "launcher-generator.ts allowlist sits 126 lines above reality — a temporary ceiling raise became regrowth budget",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1754",
      "rank": 595,
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
      "rank": 596,
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
      "rank": 597,
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
      "rank": 598,
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
      "rank": 599,
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
      "rank": 600,
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
      "rank": 601,
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
      "rank": 602,
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
      "rank": 603,
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
      "rank": 604,
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
      "rank": 605,
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
      "rank": 606,
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
      "rank": 607,
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
      "rank": 608,
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
      "rank": 609,
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
      "issue": "PAN-3739",
      "rank": 610,
      "size": "XS",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost-reconcile re-warns model-less codex subthread rollouts every sweep, flooding the dashboard log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 611,
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
      "rank": 612,
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
      "rank": 613,
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
      "rank": 614,
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
      "rank": 615,
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
      "rank": 616,
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
      "rank": 617,
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
      "rank": 618,
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
      "rank": 619,
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
      "rank": 620,
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
      "rank": 621,
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
      "rank": 622,
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
      "rank": 623,
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
      "rank": 624,
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
      "rank": 625,
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
      "rank": 626,
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
      "issue": "PAN-3558",
      "rank": 627,
      "size": "XS",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Subagent rail rows should show the provider logo and model id, including the main-agent row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 628,
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
      "rank": 629,
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
      "rank": 630,
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
      "issue": "PAN-1040",
      "rank": 631,
      "size": "XS",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 632,
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
      "rank": 633,
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
      "rank": 634,
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
      "rank": 635,
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
      "rank": 636,
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
      "rank": 637,
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
      "rank": 638,
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
      "rank": 639,
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
      "rank": 640,
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
      "rank": 641,
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
      "rank": 642,
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
      "issue": "PAN-3011",
      "rank": 643,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [
        "PAN-1641"
      ],
      "why": "Support poolside Laguna S 2.1 (118B MoE, 1M ctx) locally via Ollama/vLLM and hosted via OpenRouter",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 644,
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
      "rank": 645,
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
      "rank": 646,
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
      "rank": 647,
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
      "rank": 648,
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
      "rank": 649,
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
      "rank": 650,
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
      "rank": 651,
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
      "rank": 652,
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
      "rank": 653,
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
      "rank": 654,
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
      "rank": 655,
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
      "rank": 656,
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
      "rank": 657,
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
      "rank": 658,
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
      "rank": 659,
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
      "issue": "PAN-3133",
      "rank": 660,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate TRON encoding for prompt-bound xBRIEF payloads (claimed 35-40% token reduction vs JSON)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-293",
      "rank": 661,
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
      "rank": 662,
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
      "rank": 663,
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
      "rank": 664,
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
      "rank": 665,
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
      "rank": 666,
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
      "rank": 667,
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
      "rank": 668,
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
      "rank": 669,
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
      "rank": 670,
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
      "rank": 671,
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
      "rank": 672,
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
      "rank": 673,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View 'The River': WebGL pipeline visualization fed by the live hook-event stream (full PRD exists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 674,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferred capabilities: lease-based concurrent write mode and an LLM semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 675,
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
      "rank": 676,
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
      "rank": 677,
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
      "rank": 678,
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
      "rank": 679,
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
      "rank": 680,
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
      "rank": 681,
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
      "rank": 682,
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
      "rank": 683,
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
      "rank": 684,
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
      "rank": 685,
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
      "rank": 686,
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
      "rank": 687,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View 'Spectrum Deck': Winamp-style GPU-shader activity visualizer, mockup and PRD already captured",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 688,
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
      "rank": 689,
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
      "rank": 690,
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
      "rank": 691,
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
      "rank": 692,
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
      "rank": 693,
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
      "rank": 694,
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
      "rank": 695,
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
      "rank": 696,
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
      "rank": 697,
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
      "rank": 698,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2406",
      "rank": 699,
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
      "issue": "PAN-2394",
      "rank": 700,
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
      "rank": 701,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service",
      "rationale": "PAN-3762 proposes federating per-machine servers from the dashboard client and explicitly makes a cloud relay optional, so the shape of this phase is contested. Rank held; condition flipped pending the direction call.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2355",
      "rank": 702,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "rationale": "Mobile PWA scope assumes the relay/tunnel phase breakdown that PAN-3762 would replace with client-side federation. Rank held pending the direction call.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2354",
      "rank": 703,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "rationale": "Push-notification bridge is defined against the PAN-2350 phase model that PAN-3762 would restructure. Rank held pending the direction call.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2352",
      "rank": 704,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "rationale": "Cloudflare Tunnel remote access is one of the two competing transports; PAN-3762 proposes direct HTTPS/Tailscale plus desktop-managed SSH forwarding instead. Rank held pending the direction call.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2353",
      "rank": 705,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "rationale": "The Hermes bridge assumes the PAN-2350 transport model; PAN-3762 would reach machines through the federating client instead. Rank held pending the direction call.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2282",
      "rank": 706,
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
      "rank": 707,
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
      "rank": 708,
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
      "rank": 709,
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
      "rank": 710,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2082",
      "rank": 711,
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
      "rank": 712,
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
      "rank": 713,
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
      "rank": 714,
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
      "issue": "PAN-2005",
      "rank": 715,
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
      "rank": 716,
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
      "rank": 717,
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
      "rank": 718,
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
      "rank": 719,
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
      "rank": 720,
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
      "rank": 721,
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
      "rank": 722,
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
      "rank": 723,
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
      "rank": 724,
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
      "rank": 725,
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
      "rank": 726,
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
      "rank": 727,
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
      "rank": 728,
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
      "rank": 729,
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
      "rank": 730,
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
      "rank": 731,
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
      "issue": "PAN-1641",
      "rank": 711,
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
      "issue": "PAN-1592",
      "rank": 733,
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
      "rank": 734,
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
      "rank": 735,
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
      "rank": 736,
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
      "rank": 737,
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
      "rank": 738,
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
      "rank": 739,
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
      "issue": "PAN-3456",
      "rank": 740,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Already fixed in 4117c9a777 — per-item swarm diagnostics no longer act as eligibility gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 741,
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
      "rank": 742,
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
      "rank": 743,
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
      "rank": 744,
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
      "rank": 745,
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
      "rank": 746,
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
      "rank": 747,
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
      "rank": 748,
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
      "rank": 749,
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
      "rank": 750,
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
      "rank": 751,
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
      "rank": 752,
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
      "rank": 753,
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
      "rank": 754,
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
      "rank": 755,
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
      "rank": 756,
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
      "rank": 757,
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
      "rank": 758,
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
      "issue": "PAN-1049",
      "rank": 759,
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
      "rank": 760,
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
      "rank": 761,
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
      "rank": 762,
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
      "rank": 763,
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
      "rank": 764,
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
      "rank": 765,
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
      "rank": 766,
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
      "rank": 767,
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
      "rank": 768,
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
      "rank": 769,
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
      "rank": 770,
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
      "rank": 771,
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
      "rank": 772,
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
      "rank": 773,
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
      "rank": 774,
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
      "rank": 775,
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
      "rank": 776,
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
      "rank": 777,
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
      "issue": "PAN-774",
      "rank": 778,
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
      "rank": 779,
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
      "rank": 780,
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
      "rank": 781,
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
      "rank": 782,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 783,
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
      "rank": 784,
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
      "rank": 785,
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
      "rank": 786,
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
      "rank": 787,
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
      "rank": 788,
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
      "rank": 789,
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
      "rank": 790,
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
      "rank": 791,
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
      "rank": 792,
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
      "rank": 793,
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
      "rank": 794,
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
      "rank": 795,
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
      "rank": 796,
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
      "rank": 797,
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
      "rank": 798,
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
      "rank": 799,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-624",
      "rank": 800,
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
      "rank": 801,
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
      "rank": 802,
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
      "rank": 803,
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
      "rank": 804,
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
      "rank": 805,
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
      "rank": 806,
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
      "rank": 807,
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
      "rank": 808,
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
      "rank": 809,
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
      "rank": 810,
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
      "rank": 811,
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
      "rank": 812,
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
      "rank": 813,
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
      "rank": 814,
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
      "rank": 815,
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
      "rank": 816,
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
      "rank": 817,
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
      "rank": 818,
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
      "rank": 819,
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
      "rank": 820,
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
      "rank": 821,
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
      "rank": 822,
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
      "rank": 823,
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
      "rank": 824,
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
      "rank": 825,
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
      "rank": 826,
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
      "rank": 827,
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
      "rank": 828,
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
      "rank": 829,
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
      "rank": 830,
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
      "rank": 831,
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
      "rank": 832,
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
      "rank": 833,
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
      "rank": 834,
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
      "rank": 835,
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
      "rank": 836,
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
      "rank": 837,
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
      "rank": 838,
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
      "rank": 839,
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
      "rank": 840,
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
      "rank": 841,
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
      "rank": 842,
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
      "rank": 843,
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
      "rank": 844,
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
      "rank": 845,
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
      "rank": 846,
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
      "rank": 847,
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
      "rank": 848,
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
      "rank": 849,
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
      "rank": 850,
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
      "rank": 851,
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
      "rank": 852,
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
      "rank": 853,
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
      "rank": 854,
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
      "rank": 855,
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
      "rank": 856,
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
      "rank": 857,
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
      "rank": 858,
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
      "rank": 859,
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
      "rank": 860,
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
      "rank": 861,
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
      "rank": 862,
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
      "from": "PAN-2189",
      "to": "PAN-2190",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
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
      "from": "PAN-2566",
      "to": "PAN-2565",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2566",
      "to": "PAN-2608",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2566",
      "to": "PAN-2609",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2566",
      "to": "PAN-277",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2566",
      "to": "PAN-658",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1166",
      "to": "PAN-2351",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
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
      "from": "PAN-2351",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-2352",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
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
      "confidence": 0.95
    },
    {
      "from": "PAN-3054",
      "to": "PAN-3061",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1641",
      "to": "PAN-3684",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-1641",
      "to": "PAN-3011",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3499",
      "to": "PAN-3504",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2995",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-3464",
      "to": "PAN-3685",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3464",
      "to": "PAN-3690",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3274",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3539",
      "to": "PAN-3314",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3631",
      "to": "PAN-3301",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3244",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3708",
      "to": "PAN-3040",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3762",
      "to": "PAN-2350",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3104",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3313",
      "to": "PAN-3667",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    }
  ]
}
```
