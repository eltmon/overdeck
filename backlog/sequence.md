# Backlog Sequence

_Last sequenced: 2026-08-18T21:56:25Z · model: claude-opus-5 · open: 866_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3679 | M | critical | ok |  |  | Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running |
| 2 | PAN-3285 | M | critical | ok |  |  | A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and can never start one — 3.5h outage |
| 3 | PAN-3740 | XS | critical | ok |  |  | Red main: lint:slash-commands finds composer-manifest drift (handoff cap 500 vs 10000) — every merge blocked until regenerated |
| 4 | PAN-2746 | XS | critical | ok |  | PAN-2742, PAN-2695 | infra-failure bypass writes reviewStatus='passed' |
| 4 | PAN-3690 | S | critical | ok |  |  | Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit |
| 6 | PAN-3524 | M | critical | ok |  | PAN-3492 | Server-owned --changed verification loop relaunches through freeze, abort, pause and operator stop |
| 7 | PAN-3283 | S | critical | ok |  |  | Recovering from review_infrastructure_failure sets review_status passed despite an outstanding CHANGES REQUESTED |
| 8 | PAN-3250 | S | critical | ok |  | PAN-3062 | Workspace spawn branches from local HEAD, so every new workspace inherits whatever is unpushed on local main |
| 9 | PAN-2689 | S | critical | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost |
| 10 | PAN-3734 | M | critical | ok |  | PAN-3679 | Reused completed swarm slot can start a new item from a stale polyrepo branch |
| 11 | PAN-3566 | XS | critical | ok |  |  | Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the zombie test-agent cause |
| 12 | PAN-3281 | S | critical | ok |  |  | ready_for_merge stays 1 while an issue is stuck on incomplete plan items, so stuck work reaches the UAT batch |
| 12 | PAN-3685 | S | critical | ok |  |  | Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed |
| 14 | PAN-3682 | S | critical | ok |  |  | Migrated polyrepo swarm-slot pan done writes a legacy workspace record path and crashes |
| 15 | PAN-3630 | S | critical | ok |  |  | pan tell reported three deliveries the agent never received and marked them read; rejected design shipped |
| 16 | PAN-3561 | S | critical | ok |  |  | An ownerless state-git lock is unbreakable and bricked a project write door for 2.5 days; no TTL, no recovery CLI |
| 17 | PAN-3424 | M | critical | ok |  |  | The state plane silently stops being durable: non-FF pushes are only warned about and drafts are never staged |
| 18 | PAN-3753 | M | critical | ok |  |  | Deacon/reconciler flap resurrects dead PAN-1641 as a ready-to-merge train, invalidating a merged UAT batch; operator Merge is a no-op |
| 19 | PAN-3653 | M | critical | ok |  |  | A strike blocked on red main has no owner that wakes it when main goes green; recover refuses |
| 20 | PAN-3564 | M | critical | ok |  | PAN-3561 | Lock convoy: per-issue record lock is held across the global state-git wait, killing reviewer spawns with no retry |
| 21 | PAN-3554 | M | critical | ok |  |  | Red main has no mechanical owner: a failed main-push CI run hid itself for 5h behind an empty merge queue |
| 22 | PAN-3687 | S | critical | ok |  |  | pan done reports auto-triggered review while no durable handler is registered and nothing dispatches |
| 23 | PAN-2874 | M | critical | ok |  |  | Strike landing pipeline cannot merge strikes: verification demands a vBRIEF strikes never have |
| 24 | PAN-3539 | XS | critical | ok |  | PAN-3314 | A single agent-spawned OOM killed the whole tmux server: OOMPolicy=stop failed the unit and every session died |
| 25 | PAN-3532 | M | critical | ok |  |  | CI never runs the full frontend suite, so main stayed red on frontend while every main run reported green |
| 26 | PAN-3500 | S | critical | ok |  |  | A review sub-role resumed after writing its report and edited seven tracked files into the feature history |
| 27 | PAN-3062 | M | critical | ok |  |  | The shared primary main worktree means whoever pushes main ships every other session unpushed commits |
| 28 | PAN-3754 | M | critical | ok |  |  | Memory-governor hysteresis hold wedges admissions on a healthy host (12.5 GiB free read as critical); messages name the wrong trigger |
| 29 | PAN-3563 | S | high | ok |  | PAN-3566 | Role agent spawned with an undelivered prompt becomes an invisible zombie that absorbs every re-dispatch |
| 30 | PAN-3520 | M | high | ok |  | PAN-3344 | Test gate records failed on load-induced timeout flakes; retry timeout-only failures in isolation first |
| 31 | PAN-3492 | M | high | ok |  | PAN-3344 | Server-side gate retries self-amplify: timeouts trigger retries that raise load and cause more timeouts |
| 32 | PAN-3631 | XS | high | ok |  |  | Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state — prior frozen |
| 33 | PAN-3657 | S | high | ok |  |  | Merge-train queues endpoint runs the monorepo builder for polyrepos, so every candidate is dropped |
| 34 | PAN-3651 | M | high | ok |  |  | Re-land the overdeck-state non-fast-forward push retry with the pan-dir state-door suites green |
| 35 | PAN-3555 | S | high | ok |  |  | pan start silently spawned a fresh session over a resumable warm one — warm-by-default violated, context lost |
| 36 | PAN-3282 | M | high | ok |  |  | Review agents repeatedly die before writing a verdict across five issues and two projects |
| 37 | PAN-3313 | S | high | ok |  |  | One transient upstream stream error benches CLIProxy only auth, so about 70% of GPT-routed requests 503 |
| 38 | PAN-2706 | M | high | ok |  | PAN-3566 | A never-kicked-off ghost test session reads as running and absorbs every subsequent test dispatch |
| 39 | PAN-3314 | M | high | ok |  |  | One cgroup holds every agent pane, so a single hungry agent can OOM the entire fleet |
| 40 | PAN-3106 | S | high | ok |  |  | auto_merge_default hold is consulted on one merge path only, so held issues merge individually anyway |
| 41 | PAN-3085 | XS | high | ok |  |  | Review feedback is written to .overdeck/feedback while agents and the merge gate are pointed at .pan/feedback |
| 42 | PAN-3708 | M | high | ok |  | PAN-3040 | pan strike dies on a polyrepo wrapper root before provisioning nested worktrees |
| 43 | PAN-3047 | S | high | ok |  |  | Strike-branch teardown never fires: --is-ancestor cannot see a squash merge, 96 branches left as residue |
| 44 | PAN-3654 | S | high | ok |  |  | Compact respawn confirms against the archived session and kills the healthy fresh agent |
| 45 | PAN-3633 | S | high | ok |  | PAN-3325 | Strike workspaces spawn with no @types tree, so the contract typecheck fails and agents cry false red main |
| 46 | PAN-3535 | S | high | ok |  |  | The drain/resume boot gate is re-derived from the caller env, so any restart from a clean shell drops the hold |
| 47 | PAN-3278 | S | high | ok |  |  | A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue never fired |
| 48 | PAN-3237 | S | high | ok |  |  | A capacity-refused planning to work handoff is classified guardrails and marked terminally stuck |
| 49 | PAN-3084 | S | high | ok |  | PAN-3566 | A review session spawned but never briefed sits at zero context forever and blocks its own replacement |
| 50 | PAN-3078 | S | high | ok |  |  | The inspect verdict is never delivered to the work agent, so an agent that waits for it deadlocks forever |
| 51 | PAN-3040 | M | high | ok |  |  | pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects |
| 51 | PAN-3580 | M | high | ok |  |  | UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL |
| 52 | PAN-3677 | S | high | ok |  |  | Planning agents wedge after a background Explore task finishes; parent never consumes the result |
| 54 | PAN-2995 | S | high | ok |  | PAN-3047 | pan done --strike false-blocks after the prescribed squash-merge; it should verify PR-merged state, not ancestry |
| 55 | PAN-3752 | M | high | ok |  | PAN-3743 | Conversation transcript parsing runs on the dashboard main thread — slow opens and event-loop stalls survive the PAN-3743 fix |
| 56 | PAN-3743 | L | high | ok |  |  | Dashboard REST requests queue >20s in 5-minute burst windows — Awareness reports "signal timed out", conversation opens crawl |
| 57 | PAN-3498 | S | high | ok |  |  | write-sequence pins in-pipeline ranks without renumbering: 11 duplicate ranks and 11 gaps persisted |
| 58 | PAN-3560 | M | high | ok |  |  | PTY supervisor overloads under concurrent convoys; fleet-wide 502s kill resumes and feedback delivery |
| 59 | PAN-3571 | S | high | ok |  |  | Stop-hook completion check exits silently on timeout: 334 stranded turn-ends, agents idle until a patrol notices |
| 60 | PAN-3496 | XS | high | ok |  |  | Review and inspect agents must decide review depth themselves instead of parking the convoy on an operator AUQ |
| 61 | PAN-3329 | M | high | ok |  |  | Deployment generation node_modules and tracked packages files are deleted while a dev-checkout build runs |
| 62 | PAN-3274 | S | high | ok |  | PAN-3566 | A test-role agent spawned, never ran a turn, and strands its issue behind a verdict never produced |
| 63 | PAN-3236 | S | high | ok |  |  | ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous, so review feedback never lands |
| 64 | PAN-3234 | S | high | ok |  |  | Agents freeze on blocking choice menus and no health surface notices; the detector exists but is unwired |
| 65 | PAN-3168 | XS | high | ok |  |  | DoD row 5 counts an agent paused for close-out as running, deadlocking the issue in verifying_on_main forever |
| 66 | PAN-3103 | S | high | ok |  |  | A transient merge_status failed permanently skips close-out, so merged work stays open and pickup-eligible |
| 67 | PAN-3100 | S | high | ok |  |  | The test role evaluates the dirty working tree, so a live work agent uncommitted edits produce false failures |
| 68 | PAN-3043 | M | high | ok |  |  | Mid-run provider quota exhaustion is undetected: an agent stayed running for days holding an advancing slot |
| 69 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume |
| 70 | PAN-2742 | S | high | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' |
| 71 | PAN-3640 | S | high | ok |  | PAN-3651 | Agent GC keeps terminal rows because a lost state push race aborts before drift reconciliation |
| 72 | PAN-3565 | M | high | ok |  | PAN-3564 | Review lifecycle: failed spawn wedges starting, infra failure synthesized as a real CHANGES REQUESTED verdict |
| 73 | PAN-3557 | S | high | ok |  |  | Post-merge label writes have no retry; a rate-limited 403 hides a merged issue from the verify-on-main sweep |
| 74 | PAN-3464 | XS | high | ok |  |  | pan swarm reset never clears slotCompletions, so the coordinator re-arms the exact wedge reset was run to escape |
| 75 | PAN-3257 | S | high | ok |  |  | Crash-resume does not re-wire the PTY supervisor; a stale socket refuses every delivery and state loses the flag |
| 76 | PAN-3188 | XS | high | ok |  |  | DoD row 5 accepts only the transient verifying_on_main waypoint, so an already-done issue can never close out |
| 77 | PAN-3118 | M | high | ok |  | PAN-3043 | Model quota exhaustion halts agents invisibly: four planning agents read running at zero cost with no fallback |
| 78 | PAN-3104 | S | high | ok |  | PAN-3100 | A stale test result artifact is re-applied with no freshness check and keeps re-failing an issue after the fix landed |
| 79 | PAN-3044 | S | high | ok |  |  | Review feedback delivery runs against closed issues, resurrecting agents and raising needs-you 12 days after close-out |
| 80 | PAN-3023 | S | high | ok |  |  | Post-planning auto-spawn is abandoned on a transient Docker failure and attempt 1/3 never retries |
| 81 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json |
| 82 | PAN-2733 | S | high | ok |  |  | substrate-bug-poller has never run |
| 83 | PAN-1560 | XS | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 84 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes |
| 85 | PAN-2828 | S | critical | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 86 | PAN-2883 | M | high | ok |  | PAN-2828 | Close-out deploy row fails for every strike-landed issue |
| 87 | PAN-2806 | S | high | ok |  |  | strike merge trigger registry splits across dashboard chunks |
| 88 | PAN-2796 | S | high | ok |  |  | idle nudge must not advance after failed mandatory inspection |
| 89 | PAN-2940 | M | critical | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI |
| 90 | PAN-3697 | XS | high | ok |  |  | Deployed dashboard PATH omits Bun, so verification workers cannot run their install gate |
| 91 | PAN-3621 | S | high | ok |  |  | pan start dies resolving a chunk graph spliced across two builds: old importer name, live generation root |
| 92 | PAN-3605 | XS | high | ok |  |  | lint-effect-diagnostics executed a squatted npm package via npx registry fallback — supply-chain exposure |
| 93 | PAN-2759 | S | high | ok |  |  | Dead flywheel with an active run sat idle 2h after reboot while its exempt reconciler was wired and enabled |
| 94 | PAN-3569 | S | high | ok |  |  | Deploy gate deadlocks on a stale pending-post-merge.json when the deacon is paused; no staleness rule |
| 95 | PAN-3522 | M | high | ok |  |  | Supervisor watchdog restart-churns under CPU storm: the probe budget ignores the boot warm phase |
| 96 | PAN-3505 | S | high | ok |  | PAN-3062 | Unpushed agent code commits on the primary main worktree block the flywheel own state write door |
| 97 | PAN-3205 | S | high | ok |  |  | The deployment gate queues a deferred deploy and promises a next-verification-boundary trigger that does not exist |
| 98 | PAN-3344 | M | high | ok |  |  | Resource governor must gate dispatch on CPU load, not memory alone; agent-shell test runs bypass admission |
| 99 | PAN-3463 | S | high | ok |  |  | A legitimate empty-diff slot outcome can never pass item verify, so the slot wedges and blocks dispatch |
| 100 | PAN-3429 | M | high | ok |  | PAN-3344 | Memory governor defers admissions but sheds nothing under HARD pressure; heavy gate runs are not a shed rung |
| 101 | PAN-3397 | S | high | ok |  |  | Freshly-spawned convoy lanes freeze at zero output; the existing detector only covers warm resumes |
| 102 | PAN-3244 | M | high | ok |  | PAN-3248 | A queued dashboard deploy globally defers verification, starving cross-project review handoffs |
| 103 | PAN-3248 | XS | high | ok |  |  | pan reload never clears pending-deploy.json, so every flywheel deploy starves verification for all projects |
| 104 | PAN-3224 | XS | high | ok |  |  | A crash-interrupted spawn strands the pending-work-spawn placeholder and plain pan start dies on Unknown model |
| 105 | PAN-3022 | S | high | ok |  |  | The work-spawn route ignores the per-issue workModel override and then clobbers the stored record with the default |
| 106 | PAN-2932 | S | high | ok |  | PAN-2337 | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 107 | PAN-2935 | S | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router |
| 108 | PAN-2337 | XS | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 109 | PAN-2422 | XS | high | ok |  | PAN-2337 | rebuilding dist under a live server breaks lazy chunk imports |
| 110 | PAN-2699 | XS | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle |
| 111 | PAN-2957 | XS | high | ok |  | PAN-2337 | npm run build intermittently produces stale frontend bundles |
| 112 | PAN-2850 | M | high | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 113 | PAN-2758 | S | critical | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 114 | PAN-2886 | M | high | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 115 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 116 | PAN-2813 | M | high | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 117 | PAN-2848 | S | critical | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a… |
| 118 | PAN-2846 | S | critical | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 119 | PAN-3650 | XS | high | ok |  |  | Strike self-abort is not terminal, so the deacon resurrects aborted strikes on every recovery pass |
| 120 | PAN-3541 | S | high | ok |  |  | Review restart after an unclean reviewer death loops on the session-resume menu; eligibility ignores how it ended |
| 121 | PAN-3439 | XS | high | needs-refinement |  | PAN-3224 | pan start crashes on a pending-work-spawn placeholder row where resume already takes the fresh-spawn path |
| 122 | PAN-2747 | S | high | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 123 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target |
| 124 | PAN-2668 | M | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents |
| 125 | PAN-2569 | XS | critical | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn |
| 126 | PAN-2567 | S | critical | ok |  |  | reviewed+green PR stuck after review |
| 127 | PAN-2179 | S | high | ok |  |  | relaunch can leave a zombie agent |
| 128 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS |
| 129 | PAN-2775 | S | high | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04… |
| 129 | PAN-3689 | S | high | ok |  |  | Orphaned swarm-slot GC targets the aggregate polyrepo root; nested worktrees survive and spam failures |
| 130 | PAN-2734 | S | high | ok |  |  | merge queue head-of-line zombie |
| 131 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 133 | PAN-3667 | M | high | ok |  |  | CLIProxy has no cross-family remap, so Anthropic-pinned subagents die at spawn in proxied sessions |
| 134 | PAN-3629 | M | high | ok |  |  | No sanctioned door to re-scope a live agent: operator scope changes force a doctrine violation |
| 135 | PAN-3556 | S | high | ok |  |  | Concurrent double-spawn race allocated two session identities 3s apart and overwrote the first launcher pin |
| 136 | PAN-3543 | S | high | ok |  |  | Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while recommending --fresh |
| 137 | PAN-3432 | S | high | ok |  |  | Preemptive yield fans out: seven work agents yielded for one review convoy and auto-resume floods them back |
| 138 | PAN-3325 | S | high | ok |  |  | A fresh workspace ships an empty node_modules, so tooling silently resolves deps from the parent repo |
| 139 | PAN-3301 | S | high | ok |  | PAN-3631 | The backlog manifest still writes legacy .pan and the stray-writer patrol logs it 68k times |
| 140 | PAN-3284 | S | high | ok |  | PAN-3062 | A workspace-confined work agent wrote a doc edit into the primary main worktree; the guard covers commits, not writes |
| 141 | PAN-3270 | S | high | ok |  | PAN-3325 | New workspaces arrive with empty node_modules and bun off PATH, so the documented remedy fails |
| 142 | PAN-3261 | S | high | ok |  |  | The tmux fallback answered a live session-resume menu because its own paste hid the menu from the detector |
| 143 | PAN-3081 | S | high | ok |  |  | The agent git guard is bypassable by stripping it from PATH, and an agent did so unprompted to pass a false block |
| 144 | PAN-3139 | S | high | ok |  |  | The authoritative agents table under-reports a live four-hour agent as stopped and nothing reconciles it |
| 145 | PAN-3120 | S | high | ok |  |  | MERGE refuses or silently dead-ends for 30 minutes when the scheduler yielded the work agent |
| 146 | PAN-3057 | M | high | ok |  |  | Harness-initiated compaction leaves agents idle forever and the GPT-5.6 context window is declared twice |
| 147 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery |
| 148 | PAN-2888 | M | high | ok |  | PAN-2846 | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO… |
| 149 | PAN-2960 | S | high | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict |
| 150 | PAN-2959 | S | high | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit |
| 151 | PAN-2639 | S | high | ok |  | PAN-2331 | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 152 | PAN-2331 | S | high | ok |  |  | codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) |
| 153 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully |
| 154 | PAN-2511 | XS | high | ok |  |  | Work agents burn 20+ min on false test failures |
| 155 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 156 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push |
| 157 | PAN-2763 | S | high | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution |
| 158 | PAN-2170 | XS | high | ok |  |  | Docker init container lacks Python |
| 159 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 160 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 161 | PAN-2954 | XS | critical | ok |  |  | postMergeLifecycle refuses GitLab projects |
| 162 | PAN-2880 | M | high | ok |  | PAN-2259 | Linear tracker listIssues is a 3N+1 request storm |
| 163 | PAN-2966 | S | high | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev |
| 164 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 165 | PAN-2680 | M | high | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 166 | PAN-3634 | XS | high | ok |  |  | Planning auto-handoff stamps the ambient flywheelRunId, stripping the operator-started reaping exemption |
| 167 | PAN-3622 | XS | high | ok |  |  | orphan-proposed-reconciler test asserts on a real issue and reads live GitHub; broke when that issue closed |
| 168 | PAN-3513 | L | high | ok |  |  | Agent runtime plane on overdeck-state: durable session pointers so GC becomes cache eviction, not data loss |
| 169 | PAN-3454 | M | high | ok |  |  | Cost hook re-ingests fork-copied parent history under reviewer identity: fabricated warnings, multi-billed spend |
| 170 | PAN-1824 | M | high | ok |  |  | Convert the real-timer test family to fake timers and quarantine the rest so main CI stops flaking |
| 171 | PAN-3460 | S | high | ok |  |  | Per-item verify_commands run the whole root suite, making slot merge gates load-fragile and patrol-blocking |
| 172 | PAN-3317 | S | high | ok |  |  | Strike agents have no sanctioned main sync: rebase is guard-blocked and sync-main cannot resolve -strike workspaces |
| 173 | PAN-3297 | S | high | ok |  |  | pan tell calls healthy supervisor-run agents zombies after a dashboard restart while resume calls them healthy |
| 174 | PAN-3256 | XS | high | ok |  | PAN-3186 | MYN pipeline membership fails forge_unavailable because glab runs in a repo path that is not a git repository |
| 175 | PAN-3196 | S | high | ok |  |  | Close-out cannot tear down workspaces holding root-owned container residue and dies on EACCES after every DoD row |
| 176 | PAN-3190 | XS | high | ok |  |  | pan merge cancel is fully broken: Commander passes its options object into the fetchImpl injection slot |
| 176 | PAN-3668 | L | medium | ok |  |  | Add Prime Agent as a managed harness (in flight — RPC runtime adapter, discovery, transcripts) |
| 177 | PAN-3174 | M | high | ok |  | PAN-3032 | Every polyrepo UAT stack 504s: stale myn- Traefik labels, unattached devnet, and a frontend port mismatch |
| 178 | PAN-3129 | M | high | ok |  |  | Canonical writes under agent-controlled paths have no symlink or TOCTOU containment check |
| 180 | PAN-3048 | XS | high | ok |  |  | Pipeline auto-commit lands .pan/drafts PRDs in product feature branches; the duplicated exclusion list has drifted |
| 181 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover |
| 182 | PAN-2324 | XS | high | ok |  |  | label transition fails atomically on missing 'in-planning' label |
| 183 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans… |
| 184 | PAN-2905 | S | high | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s |
| 185 | PAN-2259 | S | critical | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota |
| 186 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 187 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 188 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH |
| 189 | PAN-2656 | S | high | ok |  |  | deacon-swarm unit tests read live ~/.overdeck/config.yaml |
| 190 | PAN-3553 | XS | high | ok |  |  | Census reads a zero-session tmux server as unavailable, so post-reboot conversations sit on Starting for minutes |
| 191 | PAN-2075 | XL | high | ok | ✓ |  | Boot Reconciliation + Operator Inbox |
| 192 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) |
| 193 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 194 | PAN-2079 | M | high | ok |  | PAN-2077 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 195 | PAN-2080 | M | high | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) |
| 196 | PAN-1775 | M | high | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 197 | PAN-454 | XS | high | ok |  | PAN-2077 | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 198 | PAN-1436 | S | high | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 199 | PAN-3617 | S | high | needs-refinement |  |  | One strike died on every dispatch with zero output while a sibling minutes later worked normally |
| 200 | PAN-3596 | S | high | ok |  |  | Deacon patrol has no per-step timing, so a 481-GET reconciler ran undetected and overruns are unattributable |
| 201 | PAN-3570 | S | high | ok |  |  | Devcontainer leaves root-owned node_modules subtrees; init-fe EACCES blocks pan start and rebuild cannot heal it |
| 202 | PAN-3517 | M | high | ok |  |  | Convoy forks still miss the parent prompt cache: launch-injection byte drift plus a dropped cache-scope header |
| 203 | PAN-3508 | S | high | ok |  |  | pan reload deletes the generation the global pan link targets, so the CLI vanishes for the rebuild window |
| 204 | PAN-1711 | L | high | ok |  |  | Root-cause the dashboard event-loop stalls that force watchdog restarts and 502s under pipeline load |
| 205 | PAN-3355 | XS | high | ok |  |  | sessionExists maps a probe failure to absence, so callers read not-running when liveness is genuinely unknown |
| 206 | PAN-3306 | S | high | ok |  | PAN-3317 | Strike prompt instructs a rebase the launcher guard blocks while sync-main resolves the wrong worktree |
| 207 | PAN-3289 | S | high | ok |  | PAN-3631 | The sequencer ran a full pass on an empty manifest while the read model held 1120 issues |
| 208 | PAN-3267 | S | high | ok |  |  | GitLab merged-head oracle spawns one glab process per repo and head, stalling every membership refresh |
| 209 | PAN-3210 | S | high | ok |  |  | Close-out teardown scopes by compose project while an unprefixed devcontainer init container blocks it |
| 210 | PAN-3186 | XS | high | ok |  |  | Pipeline membership blanks a whole project because one configured member path is not a git repository |
| 211 | PAN-3185 | S | high | ok |  |  | pan start reports a hard failure after a successful spawn: 266 lines run between the duplicate check and create |
| 212 | PAN-3179 | M | high | ok |  |  | A UAT promote is complete at merge time; nothing verifies the change reached production before members read shipped |
| 213 | PAN-3176 | S | high | ok |  |  | UAT batch promotion takes no stack health evidence, so a batch never exercised can be promoted |
| 214 | PAN-3096 | S | high | ok |  |  | pan done fails on the generated devcontainer harness and agents infer deleting workspace infrastructure |
| 215 | PAN-3077 | XS | high | ok |  |  | Inspect and review-supervisor spawns omit --effort and inherit xhigh, recurring once per xBRIEF item |
| 216 | PAN-2980 | XS | high | ok |  |  | The pre-push file-size guard audits the dirty working tree, so another session edits block unrelated pushes |
| 217 | PAN-2971 | S | high | ok |  |  | The flywheel orchestrator finalized its own run and kept ticking for 19h while Pause and Stop were disabled |
| 218 | PAN-2642 | XL | high | ok | ✓ |  | Cost strategy: waste detection over budget policing |
| 219 | PAN-1868 | XS | high | ok |  | PAN-2466 | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 220 | PAN-2466 | S | high | ok |  |  | close-out/record writer clobbers closeOut.usage with EMPTY data |
| 221 | PAN-1042 | S | high | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 222 | PAN-570 | XS | high | ok |  | PAN-2642 | Show PLAN badge on costs when under a subscription/plan |
| 223 | PAN-106 | M | high | stale |  |  | Cost prediction/estimation for in-progress work |
| 224 | PAN-2059 | XL | high | ok | ✓ |  | Backlog pickup gate |
| 225 | PAN-2376 | XL | high | ok | ✓ |  | Epic: CI/CD reliability |
| 226 | PAN-3579 | S | high | ok |  |  | Around 20 frontend mutation fetches hand-write JSON headers and 403 on CSRF-guarded routes |
| 227 | PAN-3510 | S | high | ok |  |  | Stopped agents can leave detached docker-run test containers alive for hours, contending with other gates |
| 228 | PAN-3245 | XS | high | ok |  |  | The pan done completion gate flags workspace .pan/drafts as uncommitted work despite its own .pan exclusion |
| 229 | PAN-3243 | XS | high | ok |  | PAN-1824 | An auto-commit test bounds a real git subprocess by 20 setImmediate turns and reddened main |
| 230 | PAN-3171 | S | high | ok |  |  | The pipeline reports merge failed after a successful merge and leaves the issue Todo with no label |
| 231 | PAN-3167 | S | high | ok |  |  | Two projects are permanently unreadable through the membership door: an uninstalled GitHub App 404 typed as unavailable |
| 232 | PAN-3050 | XS | high | ok |  |  | The idle-stack reaper regex only matches Overdeck container names, so other projects stacks are never reaped |
| 233 | PAN-3032 | M | high | ok |  |  | Stack rebuild composes under one prefix while Traefik labels reference another, and devnet attaches are runtime-only |
| 234 | PAN-3652 | XS | high | ok |  |  | Add workflow_dispatch to ci.yml and state-plane-branches.yml so an unverified main tip can be verified |
| 235 | PAN-3536 | XS | high | ok |  |  | pan tell cannot reach ohmypi conversations: expectedHarness defaults to claude-code when state.json is absent |
| 236 | PAN-3518 | M | high | ok |  | PAN-3517 | TTL-aware re-review payload policy: fresh-spawn-with-digest when a reviewer history is cold and large |
| 237 | PAN-3303 | S | high | ok |  |  | Command Deck latches Unknown project after reconnect: an empty registered-projects response is taken as truth |
| 238 | PAN-3280 | S | high | needs-refinement |  |  | One issue lost its agent session four times in a run and its reviewer died writing no artifact |
| 239 | PAN-3218 | S | high | ok |  |  | No release-drift signal: a user-facing fix can sit merged on main for hours while every published version is broken |
| 240 | PAN-3130 | S | high | ok |  |  | Identifier-joined write paths have no containment gate, so a crafted id could redirect a canonical write |
| 241 | PAN-3094 | XS | high | ok |  |  | The pan done merge fallback force-pushes a branch that is fast-forward pushable and leaves the command half-done |
| 242 | PAN-3015 | L | high | ok |  |  | pan monitor: pull-based background inbox transport replacing keystroke injection for Claude Code sessions |
| 243 | PAN-3014 | XS | high | ok |  |  | Background AI title and about spawns fail because --bare skips credential reads in current Claude Code |
| 244 | PAN-3627 | XS | high | ok |  |  | backlog-auto-trigger throws on a legitimately empty backlog, so a fresh npx install prints a stack trace |
| 245 | PAN-3533 | L | high | ok |  | PAN-3344 | Resource segregation: per-project isolation classes so one project cannot starve another project pipeline |
| 246 | PAN-3332 | S | high | ok |  |  | Dashboard slash-command activities keep saying running in background after the detached spawn already died |
| 247 | PAN-3321 | XS | high | needs-refinement |  |  | Escalation copy and CLAUDE.md tell operators to run pan unstick, which the CLI did not expose |
| 248 | PAN-3308 | XS | high | ok |  |  | The file-size guard prints a paste-ready ratchet-up line, so two of three agents raised the ceiling |
| 249 | PAN-3175 | M | high | ok |  |  | Merge-train ordering derives conflicts from file overlap only and cannot see that one feature requires another |
| 250 | PAN-3046 | XS | high | ok |  |  | pan CLI crashes at exit with an unhandled rejection when the PostHog shutdown flush times out |
| 251 | PAN-3012 | M | high | ok |  |  | Back up harness conversation transcripts before harnesses delete them; archive preserves the pointer, not the data |
| 252 | PAN-3527 | S | high | ok |  |  | Sidebar project list never retries: one failed boot fetch leaves CONVERSATIONS 0 / ISSUES 0 until reload |
| 253 | PAN-1767 | S | high | ok |  |  | Surface the merged-but-not-closed-out count in pan status and the dashboard headline |
| 254 | PAN-3445 | XS | high | ok |  |  | The projects.yaml TCP lock hashes into the ephemeral client-port range and false-fails uncontended writes |
| 255 | PAN-2492 | M | high | ok |  |  | Pane-detected rate-limit and session-resume waits show as needs-you but can only be answered in the terminal |
| 256 | PAN-3295 | M | high | ok |  |  | Single per-machine completion-check summarizer with a queue and first-class observability |
| 257 | PAN-3211 | S | high | ok |  |  | No honest disposition for closed-without-landing issues; residue rows are neither closeable nor reapable |
| 258 | PAN-3108 | XS | high | ok |  |  | dashboard.log grew to 867MB with no rotation, making incident logs un-greppable |
| 259 | PAN-3099 | XS | high | needs-refinement |  |  | pan restart --health-timeout is enforced in milliseconds and a false-failed check left the dashboard down |
| 260 | PAN-3751 | S | high | ok |  |  | Post-merge deploy runs a multi-minute build with no dashboard indication — operator reads a silent deploy as a lost notification |
| 261 | PAN-2421 | S | high | ok |  | PAN-3344 | Dashboard server route tests flake under full-suite verification load and stay quarantined |
| 262 | PAN-3307 | XS | high | ok |  |  | commitlint scope-enum is stale, warns on most real commits, and still lists the removed beads scope |
| 263 | PAN-3107 | S | high | ok |  |  | Productize the memory-attribution census so OOM spikes are attributable after the fact |
| 264 | PAN-3003 | XS | high | ok |  |  | Work-agent launchers omit the OVERDECK_AGENT_ID export, so a manual re-launch dies instantly |
| 265 | PAN-3701 | L | high | ok |  |  | Consolidate four first-party LLM client stacks onto effect/unstable/ai (LanguageModel + ExecutionPlan) |
| 266 | PAN-3516 | XS | medium | ok |  |  | Repo .claude/skills holds stale duplicates of three bundled skills, so overdeck sessions load outdated text |
| 267 | PAN-3276 | S | high | ok |  |  | Needs-you rows for terminal questions and permission prompts do not navigate anywhere when clicked |
| 268 | PAN-2351 | M | high | ok |  |  | Overdeck Anywhere P0: scoped access tokens plus WS and SSE heartbeats — blocks all remote exposure |
| 269 | PAN-3121 | S | high | ok |  | PAN-3117 | The failed-send outbox never reconciles against the transcript, leaving a delivered message with a doomed Retry twin |
| 270 | PAN-3113 | M | medium | ok |  | PAN-3235 | Surface agent-pane choice prompts as inline decision cards in the conversation view |
| 270 | PAN-3420 | M | high | ok |  |  | Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe) |
| 271 | PAN-3013 | XS | medium | ok |  |  | Dead linear-mcp-auth-hook entries leak into durable settings.json and fail on every matching tool call |
| 272 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline Throughput Hardening |
| 273 | PAN-1556 | S | high | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 275 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 276 | PAN-2189 | L | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) |
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
| 307 | PAN-2755 | S | high | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 308 | PAN-2754 | S | high | ok |  |  | `always` is inert |
| 309 | PAN-2809 | M | high | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 310 | PAN-2810 | M | high | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 311 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate |
| 312 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 313 | PAN-1710 | S | high | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 |
| 314 | PAN-1720 | S | high | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation |
| 315 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 316 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 317 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** |
| 318 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes |
| 319 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 320 | PAN-2266 | M | high | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 321 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 322 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks |
| 323 | PAN-687 | M | high | ok |  |  | Support OpenCode as alternative coding agent |
| 324 | PAN-466 | M | high | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 325 | PAN-465 | M | high | ok |  |  | Add OpenRouter as a model provider |
| 326 | PAN-463 | M | high | ok |  |  | Add Qwen 3.6+ model support |
| 327 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 328 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 329 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 330 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier |
| 331 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 332 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 333 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 334 | PAN-1254 | L | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 335 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 336 | PAN-1915 | M | high | ok |  |  | enhancement(security): API key at-rest hardening |
| 337 | PAN-1435 | XS | high | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 338 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 339 | PAN-1640 | M | high | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 340 | PAN-1217 | XS | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 341 | PAN-1218 | M | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 342 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 343 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 344 | PAN-1451 | M | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 345 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 346 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit |
| 347 | PAN-1553 | M | high | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 348 | PAN-1504 | M | high | ok |  |  | pan hygiene |
| 349 | PAN-1480 | L | high | ok |  |  | TLDR: 93% bypass rate |
| 350 | PAN-1479 | M | high | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 351 | PAN-2950 | L | high | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 352 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 353 | PAN-2836 | M | high | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 354 | PAN-2830 | M | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in |
| 355 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve |
| 356 | PAN-2650 | L | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it |
| 357 | PAN-2549 | M | high | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 358 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 359 | PAN-2334 | XS | high | ok |  |  | write a Definition of Ready (DoR) |
| 360 | PAN-2308 | M | high | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal… |
| 361 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree |
| 362 | PAN-1984 | XS | high | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 363 | PAN-1913 | XS | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 364 | PAN-1906 | M | high | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 365 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 366 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 367 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 368 | PAN-807 | L | high | ok |  |  | Epic C: Workspace state sanity on spawn |
| 369 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 370 | PAN-471 | M | high | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 371 | PAN-438 | M | high | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 372 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 373 | PAN-176 | M | high | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 374 | PAN-578 | M | high | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 375 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 376 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep |
| 377 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 378 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run |
| 379 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 380 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik… |
| 381 | PAN-2739 | S | medium | ok |  |  | first-completion detection throws every patrol cycle |
| 382 | PAN-2738 | S | medium | ok |  |  | strikes deadlock |
| 383 | PAN-2717 | S | medium | ok |  |  | conversation permission waits missing from Awareness; strengthen alert pulse |
| 384 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 385 | PAN-2696 | XS | medium | ok |  |  | Task views still speak beads vocabulary |
| 386 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) |
| 387 | PAN-2686 | XS | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 388 | PAN-3661 | XS | medium | ok |  |  | issueActions review-mode tests fail locally: semantic rejection no longer toasts since secure dispatch |
| 389 | PAN-2350 | XL | medium | ok | ✓ |  | Epic: Overdeck Anywhere — reachability, identity and a remote-safe API behind remote, mobile and shared access |
| 390 | PAN-3455 | XS | medium | ok |  |  | isCliproxyUpToDate always returns false because --version exits 2, so every ensure re-downloads the release |
| 391 | PAN-3235 | S | medium | ok |  |  | Dashboard decision card should render and answer agent pane-choice menus in one click |
| 392 | PAN-3181 | L | medium | ok |  |  | Own agent memories in Overdeck: migrate harness project memories onto a per-repo overdeck-memory orphan branch |
| 393 | PAN-3137 | XS | medium | ok |  |  | UAT generation member titles come from the flywheel status snapshot, putting orchestrator prose on a merge surface |
| 394 | PAN-3117 | S | medium | ok |  |  | The failed-send bubble hides a deterministic 4xx reason and offers a Retry that can never succeed |
| 395 | PAN-3744 | XS | medium | ok |  |  | Conversation view renders the new-conversation greeting instead of a loading skeleton while the transcript RPC is still resolving |
| 396 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 397 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck |
| 398 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 399 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 400 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 401 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 402 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations |
| 403 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 404 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 405 | PAN-2560 | M | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key |
| 406 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL |
| 407 | PAN-2550 | XS | medium | ok |  |  | npm test exits 0 despite root-suite failures |
| 408 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds |
| 409 | PAN-2546 | S | medium | ok |  |  | pan tell is codex-conversation-unaware |
| 410 | PAN-2506 | M | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 411 | PAN-3540 | M | medium | ok |  |  | God View shows phantom agent orbs, a dead Hook Bus panel, and a pressure-blind swap header |
| 412 | PAN-2981 | S | medium | ok |  |  | Ctrl-K palette opens stale conversations that 404 because the search index never prunes deleted sessions |
| 413 | PAN-2501 | S | medium | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 414 | PAN-2491 | M | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 415 | PAN-2489 | S | medium | ok |  |  | strike agents are invisible in the project issue tree |
| 416 | PAN-2484 | S | medium | ok |  |  | ready set misses merge-eligible issues without flywheel merge verbs |
| 417 | PAN-2465 | S | medium | ok |  |  | pan done's PR lookup fails at MYN polyrepo root |
| 418 | PAN-2454 | S | medium | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero |
| 419 | PAN-2428 | XS | medium | ok |  |  | MYN workspace Traefik routing broken post-rebrand |
| 420 | PAN-2423 | XS | medium | ok |  |  | pan workspace rebuild hardcodes 'overdeck-' compose project prefix |
| 421 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen |
| 422 | PAN-2414 | S | medium | ok |  |  | context-overflow recovery is inconsistent |
| 423 | PAN-2408 | S | medium | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree |
| 424 | PAN-2395 | S | medium | ok |  |  | one invalid tiered_execution enum poisons every config read |
| 425 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream |
| 426 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice |
| 427 | PAN-3732 | S | medium | ok |  |  | Codex handoff serializes a large rollout twice (~286MB peak RSS); serialize once and pass the text |
| 428 | PAN-3354 | XS | medium | ok |  |  | Archiving the main workspace hides the singleton row with no unarchive affordance in the dashboard |
| 429 | PAN-3288 | S | medium | ok |  |  | Dev-checkout preflight should detect stale node_modules and say run bun install instead of ERR_MODULE_NOT_FOUND |
| 430 | PAN-2352 | M | medium | ok |  | PAN-2351 | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel and Access with device-scoped tokens |
| 431 | PAN-3178 | XL | medium | ok |  |  | First-class worktrees and diffs: change badges, a dedicated Changes surface and conversation worktrees |
| 432 | PAN-3164 | XS | medium | ok |  |  | The UAT stack probe derives running from container count, so a still-booting stack offers a link that times out |
| 433 | PAN-3036 | XS | medium | ok |  |  | A completed strike shows a false INPUT chip because the pane-idle heuristic reads post-ready idle as a question |
| 434 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed |
| 435 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) |
| 436 | PAN-2186 | S | medium | ok |  |  | post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 437 | PAN-2069 | XS | medium | ok |  |  | caveman: follow-up gaps |
| 438 | PAN-1918 | XS | medium | ok |  |  | full frontend vitest suite runs in no CI path |
| 439 | PAN-1912 | XS | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 440 | PAN-1846 | S | medium | ok |  |  | unbounded log growth |
| 441 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY |
| 442 | PAN-3745 | XS | medium | ok |  |  | cost.recorded fails DomainEvent validation at the ws-rpc boundary on every cost write — log spam plus an undecided broadcast-vs-filter call |
| 443 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry |
| 444 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main |
| 445 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 446 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil… |
| 447 | PAN-1761 | S | medium | ok |  |  | conversations endpoints fetched via relative /api path |
| 448 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 449 | PAN-3616 | S | medium | ok |  |  | Planned deploy restarts show the alarm-toned Reconnecting banner; use the lifecycle signal for calm copy |
| 450 | PAN-3090 | M | medium | ok |  |  | Simple issue page: narrative feed instead of a raw 55KB kickoff dump, surface the pending question honestly |
| 451 | PAN-2565 | XL | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 452 | PAN-3016 | M | medium | ok |  |  | URL-address every view so any place you navigate to can be reached again from the URL |
| 453 | PAN-1740 | XS | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 454 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace |
| 455 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 455 | PAN-3703 | XS | medium | ok |  |  | Ctrl-K: sort conversation results newest-first by the canonical recency field |
| 456 | PAN-1669 | S | medium | ok |  |  | restart-with-model doesn't emit a live event |
| 457 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness |
| 458 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr… |
| 459 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted |
| 460 | PAN-3731 | S | medium | ok |  |  | Restart-gate banner gives no feedback after approval; dead-requester approvals look like a broken button |
| 462 | PAN-2566 | L | medium | ok | ✓ |  | Traycer parity epic: triage list of capabilities Overdeck genuinely lacks |
| 463 | PAN-1572 | M | medium | ok |  |  | Settings permission-mode can desync from resolved config |
| 464 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted |
| 465 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 466 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 467 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 468 | PAN-1449 | S | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 469 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 470 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 471 | PAN-3700 | L | medium | ok |  |  | pan acp serve: expose Overdeck conversations to ACP clients like Zed via effect-acp/agent |
| 472 | PAN-2353 | M | medium | ok |  | PAN-2351 | Overdeck Anywhere P1b: Hermes external-agent bridge over a scoped API and Fly 6PN peering |
| 473 | PAN-2982 | XS | medium | ok |  |  | The review convoy should run a skill selftest when sync-sources/skills changes |
| 474 | PAN-2976 | L | medium | ok |  |  | Generalize the ACP harness so any capability-passing ACP agent CLI is a spawnable runtime |
| 475 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 476 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 477 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 478 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 479 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 480 | PAN-1392 | S | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 481 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots |
| 482 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions |
| 483 | PAN-1245 | M | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 484 | PAN-1244 | M | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 485 | PAN-1240 | S | medium | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 485 | PAN-3705 | S | medium | ok |  | PAN-3703 | Ctrl-K: add Conversations as a first-class entry in the type list |
| 486 | PAN-1227 | S | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work |
| 487 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign |
| 488 | PAN-1173 | S | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 489 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders |
| 490 | PAN-3735 | S | medium | ok |  |  | pan CLI blames a healthy dashboard when the caller is sandboxed; detect read-only/no-network and say so |
| 492 | PAN-3530 | S | medium | ok |  |  | Four God View components poll on 30s timers, violating the surface documented event-driven contract |
| 493 | PAN-3290 | XS | medium | ok |  |  | xBRIEF items can carry empty metadata.traces, so docs items are invisible to requirement traceability |
| 494 | PAN-2354 | S | medium | ok |  | PAN-2351 | Overdeck Anywhere P1c: needs-you push notification bridge, ntfy first and Web Push later |
| 495 | PAN-3157 | XS | medium | ok |  |  | The Awareness feed renders the Flywheel as a generic Claude Code chat row reading No messages yet |
| 496 | PAN-3017 | S | medium | ok |  |  | The issue-page UAT panel renders inline actions only, so a healthy stack has no restart control there |
| 497 | PAN-1150 | S | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 498 | PAN-1149 | S | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 499 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 500 | PAN-1129 | S | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 501 | PAN-1128 | S | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 502 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 503 | PAN-1068 | S | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 504 | PAN-1027 | S | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 505 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 506 | PAN-932 | S | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 507 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 508 | PAN-900 | S | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 509 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 510 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 511 | PAN-727 | M | medium | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 512 | PAN-681 | S | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 513 | PAN-3706 | L | medium | ok |  |  | Broadsheet theme only swapped the typeface; color, surface, elevation and texture still on Ledger values |
| 514 | PAN-3132 | M | medium | ok |  |  | Adopt the xBRIEF v0.9 agentic dispatch fields end-to-end as a contract rather than a planner habit |
| 515 | PAN-3739 | XS | medium | ok |  |  | cost-reconcile re-warns unknown-model on every sweep for model-less codex subthread rollouts — hundreds of repeating log lines |
| 516 | PAN-538 | S | medium | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 517 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection |
| 518 | PAN-324 | XS | medium | stale |  |  | Agent detail pane missing Merge/Approve button |
| 519 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 520 | PAN-247 | S | medium | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 521 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 522 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 523 | PAN-178 | M | medium | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 524 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 525 | PAN-49 | XS | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 526 | PAN-1951 | M | medium | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 527 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 528 | PAN-1041 | M | medium | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 529 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 530 | PAN-3615 | S | medium | ok |  |  | TTS was silent 9+ days across four stacked failures; three fixed, follow-ups remain |
| 531 | PAN-2355 | L | medium | ok |  | PAN-2352 | Overdeck Anywhere P2: mobile PWA with needs-you feed, conversation view, pipeline board and Web Push |
| 532 | PAN-3061 | M | medium | ok |  | PAN-3054 | Dispatch-topology advisor: a mechanical start-versus-swarm recommendation at plan finalize |
| 533 | PAN-863 | M | medium | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 534 | PAN-817 | M | medium | ok |  |  | Improve planning dialog layout and content fit |
| 535 | PAN-802 | M | medium | ok |  |  | Resume on conversation session forks instead of resuming |
| 536 | PAN-713 | M | medium | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 537 | PAN-700 | M | medium | ok |  |  | Detachable terminal for conversation view |
| 538 | PAN-646 | XS | medium | ok |  |  | Canceled issues: add guided Recover workflow |
| 539 | PAN-532 | M | medium | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 540 | PAN-2896 | M | medium | ok |  |  | Warm resource-discovery and membership caches at boot |
| 541 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 542 | PAN-2626 | M | medium | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 543 | PAN-2625 | XS | medium | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 544 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 545 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations |
| 546 | PAN-2582 | M | medium | ok |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 547 | PAN-3335 | XS | medium | ok |  |  | Clicking a pasted conversation image should open it full size instead of rendering a PNG as source text |
| 548 | PAN-2977 | M | medium | ok |  | PAN-2976 | ACP agent setup UI: detect installed CLIs, show auth status and guide login from Settings |
| 549 | PAN-2558 | L | medium | ok |  |  | support polyrepo projects |
| 550 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action |
| 551 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility |
| 552 | PAN-2548 | XS | medium | ok |  |  | close the PAN-2541 legacy-fallback deprecation window |
| 553 | PAN-2521 | S | medium | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 554 | PAN-2493 | M | medium | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 555 | PAN-3499 | XS | medium | needs-refinement |  |  | pan parked ack references a nonexistent ProjectConfig.projectPath; one-line fix owed directly on main |
| 556 | PAN-2444 | L | medium | ok |  |  | optional SageOx re-integration |
| 557 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv |
| 558 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane |
| 559 | PAN-2409 | M | medium | ok |  |  | enforce the workspace boundary |
| 560 | PAN-2399 | M | medium | ok |  |  | wire replay_threshold/compaction_reroute into the slot-recovery respawn seam |
| 561 | PAN-2392 | M | medium | ok |  |  | Standing Crew cost panel |
| 562 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues |
| 563 | PAN-2295 | L | medium | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 564 | PAN-3558 | XS | medium | ok |  |  | Subagent rail: show the provider logo and running model on each agent row |
| 565 | PAN-3469 | S | medium | ok |  |  | Migrate NewProjectModal to a routed full page under the page-not-modal doctrine |
| 566 | PAN-3131 | L | medium | ok |  | PAN-3132 | Support xBRIEF planRef sharding across planning authoring and pipeline-wide consumption |
| 567 | PAN-3058 | M | medium | ok |  |  | Standing-crew templates: ship preset crew configurations selectable from Settings |
| 568 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call |
| 569 | PAN-2065 | M | medium | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 570 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 571 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 572 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 573 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 574 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 575 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 576 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 577 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 578 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 579 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 580 | PAN-2024 | XS | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 581 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 582 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 583 | PAN-3333 | M | medium | ok |  |  | Model pickers show dollars per token, which says nothing about how fast a sibling model drains plan quota |
| 584 | PAN-3054 | M | medium | ok |  |  | Benchmark matrix: launch one template issue under N configurations and compare cost, time and outcome |
| 585 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 586 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 587 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 588 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 589 | PAN-1937 | M | medium | ok |  |  | feat: data export |
| 590 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 591 | PAN-1916 | M | medium | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 592 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 593 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 594 | PAN-1852 | XS | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 594 | PAN-3684 | XS | medium | ok |  |  | Temporary acceptance issue: spawn a Pi work agent on ollama:gemma4:12b and record evidence |
| 595 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 596 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' |
| 597 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 598 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 599 | PAN-3322 | XS | medium | ok |  | PAN-3308 | The launcher-generator file-size ceiling sits 126 lines above the file, banking regrowth budget |
| 601 | PAN-2356 | XL | medium | ok |  | PAN-2352 | Overdeck Anywhere P3: outbound-only relay service with GitHub OAuth, push origin and a multi-tenant front door |
| 602 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 603 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 604 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent |
| 605 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 606 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 607 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate |
| 608 | PAN-1685 | XS | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 609 | PAN-1676 | M | medium | ok |  |  | harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 610 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 611 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 612 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 613 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 614 | PAN-1654 | XS | medium | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 615 | PAN-1653 | XS | medium | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 616 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 617 | PAN-3502 | XS | medium | stale |  |  | tiered-crews blendedCost expectation is stale against the current model-capabilities pricing |
| 618 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 619 | PAN-1550 | M | medium | ok |  |  | feat: FilesPane + BrowserPane |
| 620 | PAN-1545 | XS | medium | ok |  |  | New Terminal button |
| 621 | PAN-1542 | XS | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 622 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 623 | PAN-1497 | M | medium | ok |  |  | emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 624 | PAN-1490 | M | medium | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 625 | PAN-1489 | M | medium | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 626 | PAN-1485 | M | medium | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 627 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 628 | PAN-1443 | M | medium | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 629 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 630 | PAN-1437 | M | medium | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 631 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale |
| 632 | PAN-1223 | M | medium | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 633 | PAN-1165 | M | medium | ok |  |  | Lightweight review path for small/trivial PRs |
| 634 | PAN-1151 | XS | medium | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 635 | PAN-1060 | M | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 636 | PAN-1051 | M | medium | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 637 | PAN-1040 | XS | medium | ok |  |  | event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 638 | PAN-1037 | M | medium | ok |  |  | Retire 'planning-' tmux prefix |
| 639 | PAN-958 | M | medium | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 640 | PAN-949 | M | medium | ok |  |  | feat: add conversation for project from sidebar |
| 641 | PAN-947 | M | medium | ok |  |  | feat: project management actions in unified sidebar |
| 642 | PAN-938 | M | medium | ok |  |  | Fizzy visual pipeline |
| 643 | PAN-903 | M | medium | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 644 | PAN-902 | XS | medium | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 645 | PAN-901 | XS | medium | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 646 | PAN-818 | M | medium | ok |  |  | Make summary optional when forking conversations |
| 647 | PAN-736 | M | medium | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 648 | PAN-709 | M | medium | ok |  |  | self-improving flywheel |
| 649 | PAN-3441 | XL | low | ok |  |  | God View River: WebGL pipeline visualization fed by the live hook-event stream |
| 650 | PAN-2978 | S | low | ok |  | PAN-2976, PAN-2977 | Auto-install ACP agent CLIs from the setup UI with opt-in per-agent install recipes |
| 651 | PAN-678 | M | medium | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 652 | PAN-675 | M | medium | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 653 | PAN-654 | L | medium | ok |  |  | Project Setup Wizard |
| 654 | PAN-649 | M | medium | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 655 | PAN-637 | XS | medium | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 656 | PAN-629 | M | medium | ok |  |  | Workspace quotas and resource governance |
| 657 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents |
| 658 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 659 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 660 | PAN-548 | M | medium | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 661 | PAN-546 | M | medium | ok |  |  | Remove claude-code-router |
| 662 | PAN-537 | M | medium | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 663 | PAN-531 | XS | medium | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 664 | PAN-452 | M | medium | ok |  |  | Conversation input bar |
| 665 | PAN-450 | M | medium | ok |  |  | Adopt remaining Effect patterns |
| 666 | PAN-294 | M | medium | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 667 | PAN-3034 | XS | low | stale |  |  | Command Deck session tree missed strike-only issues; the fix has already landed on main |
| 668 | PAN-293 | M | medium | stale |  |  | Project Living Memory |
| 669 | PAN-277 | M | medium | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 670 | PAN-258 | M | medium | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 671 | PAN-255 | M | medium | stale |  |  | Agents lack awareness of MCP tools |
| 672 | PAN-252 | XS | medium | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 673 | PAN-243 | M | medium | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 674 | PAN-77 | XS | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 675 | PAN-54 | L | medium | stale |  |  | e2e command for full workflow integration test |
| 676 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 677 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 678 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 679 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 680 | PAN-3504 | XS | medium | stale |  | PAN-3499 | Duplicate report of the parked.ts ProjectConfig.projectPath typecheck break on main |
| 681 | PAN-3456 | XS | low | stale |  |  | pan swarm treated per-item sequential diagnostics as refusals; already fixed on main |
| 682 | PAN-3443 | XL | low | ok |  |  | God View Spectrum Deck: Winamp-grade WebGL activity visualizer with mockup and reproduction-grade PRD |
| 683 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 684 | PAN-2941 | M | low | ok |  |  | OKF v3 |
| 685 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 686 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 687 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 |
| 688 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 689 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 690 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 691 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 692 | PAN-2635 | XS | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 693 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 694 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 695 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 696 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file |
| 697 | PAN-2600 | XS | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) |
| 698 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 699 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 700 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector |
| 701 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 702 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 703 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 704 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 705 | PAN-2424 | L | low | ok |  |  | Epic: the Order Book |
| 706 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree … |
| 707 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 708 | PAN-3011 | M | low | ok |  |  | Support poolside Laguna S 2.1 locally via Ollama or vLLM and hosted via OpenRouter |
| 709 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations |
| 710 | PAN-2091 | XS | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 711 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 711 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 712 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 713 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 714 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 715 | PAN-2074 | XS | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 716 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 718 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 719 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast |
| 720 | PAN-2002 | XS | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 721 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 722 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 723 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 724 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 725 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 726 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 727 | PAN-2983 | M | low | ok |  |  | OKF v3 deferred capabilities: lease-based concurrent write mode and an LLM semantic auditor |
| 728 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 729 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every… |
| 730 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 731 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 732 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout |
| 733 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 734 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 735 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 736 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 737 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 738 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 739 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 740 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 741 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 742 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 743 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 744 | PAN-3133 | S | low | ok |  |  | Spike: evaluate TRON encoding for prompt-bound xBRIEF payloads against the real spec corpus |
| 745 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 746 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 747 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 748 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 749 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 750 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' |
| 751 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence |
| 752 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 753 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 754 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 755 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces |
| 756 | PAN-1123 | XS | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 757 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 758 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 759 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 760 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 761 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 762 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 763 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 764 | PAN-984 | XS | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 765 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 766 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 767 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 768 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 769 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 770 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 771 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 772 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 773 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 774 | PAN-810 | XS | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 775 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 776 | PAN-793 | XS | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 777 | PAN-791 | XS | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 778 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling |
| 779 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 780 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 781 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 782 | PAN-774 | XS | low | ok |  |  | Unify launch UX and release pipeline for 1.0 |
| 783 | PAN-773 | XS | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 784 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 785 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 786 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 787 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 788 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 789 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 790 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 791 | PAN-751 | M | low | ok |  |  | Historical Metrics Data Persistence |
| 792 | PAN-750 | L | low | ok |  |  | Complete Metrics Page Redesign |
| 793 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 794 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 795 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 796 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 797 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 798 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 799 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 800 | PAN-701 | XS | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 801 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 802 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 803 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 804 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 805 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 806 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 807 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 808 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 809 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 810 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 811 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 812 | PAN-571 | XS | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 813 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 814 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 815 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly |
| 816 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 817 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 818 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX |
| 819 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 820 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 821 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database |
| 822 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 823 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 824 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 825 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 826 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 827 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 828 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 829 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 830 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 831 | PAN-249 | XS | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 832 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 833 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics |
| 834 | PAN-227 | M | low | stale |  |  | Phase gate validation |
| 835 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 836 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 837 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 838 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 839 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 840 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 841 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 842 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 843 | PAN-52 | XS | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 844 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 845 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 846 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 847 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 848 | PAN-2348 | XS | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 849 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md |
| 850 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md |
| 851 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md |
| 852 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md |
| 853 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md |
| 854 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 855 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 856 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 857 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 858 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 859 | PAN-1684 | XS | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 860 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 861 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc |
| 862 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 863 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 864 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 865 | PAN-633 | M | low | ok |  |  | Update Cloister PRD and docs index |
| 866 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |

## Rationale detail

### PAN-3679 (rank 1)

Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3285 (rank 2)

A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and can never start one — 3.5h outage. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3740 (rank 3)

Main CI is red on the merge commit because the generated composer-command manifest still declares the old 500-character pan handoff cap while the command description says 10000. A red main empties the merge gate silently and blocks every other issue from landing, so this outranks all non-red-main work regardless of how small the fix is. The change itself is a regeneration of one committed artifact, so the cost of clearing it is near zero and the cost of leaving it is the whole pipeline. In pipeline — rank set once here and pinned from now on; gate stays auto.

### PAN-2746 (rank 4)

Highest integrity risk — infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; nearly merged a pipeline-critical change unreviewed.

### PAN-3690 (rank 4)

Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3524 (rank 6)

Server-owned --changed verification loop relaunches through freeze, abort, pause and operator stop. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3492.

### PAN-3283 (rank 7)

Recovering from review_infrastructure_failure sets review_status passed despite an outstanding CHANGES REQUESTED. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3250 (rank 8)

Workspace spawn branches from local HEAD, so every new workspace inherits whatever is unpushed on local main. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3062.

### PAN-2689 (rank 9)

Sandboxed codex review verdicts fire-and-forget into a journal that loses them; review convoy reports green on evidence never delivered.

### PAN-3734 (rank 10)

Reused completed swarm slot can start a new item from a stale polyrepo branch. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3679.

### PAN-3566 (rank 11)

Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the zombie test-agent cause. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3281 (rank 12)

ready_for_merge stays 1 while an issue is stuck on incomplete plan items, so stuck work reaches the UAT batch. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3685 (rank 12)

Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3682 (rank 14)

Migrated polyrepo swarm-slot pan done writes a legacy workspace record path and crashes. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3630 (rank 15)

pan tell reported three deliveries the agent never received and marked them read; rejected design shipped. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3561 (rank 16)

An ownerless state-git lock is unbreakable and bricked a project write door for 2.5 days; no TTL, no recovery CLI. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3424 (rank 17)

The state plane silently stops being durable: non-FF pushes are only warned about and drafts are never staged. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3753 (rank 18)

The flywheel surfaced a dead issue as a ready-to-merge train, the operator clicked Merge, and nothing happened — no merge commit, no PR, because the only PR had been closed unmerged. Worse than the dead button: the resurrection invalidated an already-merged UAT batch, so the operator cannot trust what the merge surface reports as ready. This is the same class as the ready_for_merge and review-status corruption bugs already sitting at the top of this sequence: the pipeline reports a state that is not real, and every downstream decision inherits the lie. Merged and awaiting close-out, so the remaining work is the close-out ceremony, but it stays pinned high while it is in pipeline.

### PAN-3653 (rank 19)

A strike blocked on red main has no owner that wakes it when main goes green; recover refuses. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3564 (rank 20)

Lock convoy: per-issue record lock is held across the global state-git wait, killing reviewer spawns with no retry. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3561.

### PAN-3554 (rank 21)

Red main has no mechanical owner: a failed main-push CI run hid itself for 5h behind an empty merge queue. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3687 (rank 22)

pan done reports auto-triggered review while no durable handler is registered and nothing dispatches. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-2874 (rank 23)

Rank held in the critical band: the body was rewritten on 2026-08-10 and its blocker PAN-2828 has since closed, so the remaining work is the verification-gate carve-out and the exited-strike feedback path. Strikes are the pipeline's urgent-fix lane; while they cannot land, every red-main unblock needs an operator merge by hand.

### PAN-3539 (rank 24)

A single agent-spawned OOM killed the whole tmux server: OOMPolicy=stop failed the unit and every session died. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3314.

### PAN-3532 (rank 25)

CI never runs the full frontend suite, so main stayed red on frontend while every main run reported green. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3500 (rank 26)

A review sub-role resumed after writing its report and edited seven tracked files into the feature history. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3062 (rank 27)

The shared primary main worktree means whoever pushes main ships every other session unpushed commits. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.

### PAN-3754 (rank 28)

The governor stopped admitting work while the host had 12.5 GiB available and told the operator memory was critical and the kernel might start killing processes. A hold that wedges dispatch on a healthy machine costs the entire fleet its throughput, and the misattributed operator message sends whoever reads it after the wrong cause — the same failure shape as the CPU-storm-mistaken-for-memory-pressure incidents this backlog already carries. It ranks with the other governor and scheduler defects that decide whether any agent runs at all rather than with feature work. Merged and awaiting close-out.

### PAN-3563 (rank 29)

Role agent spawned with an undelivered prompt becomes an invisible zombie that absorbs every re-dispatch. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3566.

### PAN-3520 (rank 30)

Test gate records failed on load-induced timeout flakes; retry timeout-only failures in isolation first. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3344.

### PAN-3492 (rank 31)

Server-side gate retries self-amplify: timeouts trigger retries that raise load and cause more timeouts. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3344.

### PAN-3631 (rank 32)

Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state — prior frozen. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3657 (rank 33)

Merge-train queues endpoint runs the monorepo builder for polyrepos, so every candidate is dropped. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3651 (rank 34)

Re-land the overdeck-state non-fast-forward push retry with the pan-dir state-door suites green. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3555 (rank 35)

pan start silently spawned a fresh session over a resumable warm one — warm-by-default violated, context lost. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3282 (rank 36)

Review agents repeatedly die before writing a verdict across five issues and two projects. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3313 (rank 37)

One transient upstream stream error benches CLIProxy only auth, so about 70% of GPT-routed requests 503. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-2706 (rank 38)

Score raised and a new dependency added on PAN-3566, which identified the deterministic producer of ghost test sessions — a test-role launcher that execs claude with no user prompt — so this issue is now the hardening half of a known root cause.

### PAN-3314 (rank 39)

One cgroup holds every agent pane, so a single hungry agent can OOM the entire fleet. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3106 (rank 40)

auto_merge_default hold is consulted on one merge path only, so held issues merge individually anyway. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3085 (rank 41)

Review feedback is written to .overdeck/feedback while agents and the merge gate are pointed at .pan/feedback. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3708 (rank 42)

pan strike dies on a polyrepo wrapper root before provisioning nested worktrees. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3040.

### PAN-3047 (rank 43)

Strike-branch teardown never fires: --is-ancestor cannot see a squash merge, 96 branches left as residue. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3654 (rank 44)

Compact respawn confirms against the archived session and kills the healthy fresh agent. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3633 (rank 45)

Strike workspaces spawn with no @types tree, so the contract typecheck fails and agents cry false red main. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3325.

### PAN-3535 (rank 46)

The drain/resume boot gate is re-derived from the caller env, so any restart from a clean shell drops the hold. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3278 (rank 47)

A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue never fired. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3237 (rank 48)

A capacity-refused planning to work handoff is classified guardrails and marked terminally stuck. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3084 (rank 49)

A review session spawned but never briefed sits at zero context forever and blocks its own replacement. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3566.

### PAN-3078 (rank 50)

The inspect verdict is never delivered to the work agent, so an agent that waits for it deadlocks forever. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3040 (rank 51)

pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3580 (rank 51)

The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.

### PAN-3677 (rank 52)

Planning agents wedge after a background Explore task finishes; parent never consumes the result. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-2995 (rank 54)

pan done --strike false-blocks after the prescribed squash-merge; it should verify PR-merged state, not ancestry. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3047.

### PAN-3752 (rank 55)

The declared follow-up to PAN-3743: after that deploy removed every slow db-jobs line, conversation opens were still slow because transcript parsing runs on the dashboard main thread. Event-loop stalls on this server are not a cosmetic latency problem — they freeze HTTP, WebSocket and polling together, which is the documented mechanism behind the watchdog restart churn and the reconnect storms elsewhere in this backlog. Ranking it just under its parent keeps the pair adjacent without claiming it blocks anything. Merged and awaiting close-out.

### PAN-3743 (rank 56)

Requests queueing past the frontend twenty-second abort budget means the operator surface reports failure while the server is merely saturated, which trains everyone to distrust the dashboard exactly when load is highest. It sits in the same substrate band as the other event-loop and throughput defects because a dashboard that cannot answer under burst is the surface every other pipeline decision is made through. Merged and awaiting close-out; its residual slow path is tracked separately as PAN-3752.

### PAN-3498 (rank 57)

write-sequence pins in-pipeline ranks without renumbering: 11 duplicate ranks and 11 gaps persisted. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3560 (rank 58)

PTY supervisor overloads under concurrent convoys; fleet-wide 502s kill resumes and feedback delivery. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3571 (rank 59)

Stop-hook completion check exits silently on timeout: 334 stranded turn-ends, agents idle until a patrol notices. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3496 (rank 60)

Review and inspect agents must decide review depth themselves instead of parking the convoy on an operator AUQ. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3329 (rank 61)

Deployment generation node_modules and tracked packages files are deleted while a dev-checkout build runs. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3274 (rank 62)

A test-role agent spawned, never ran a turn, and strands its issue behind a verdict never produced. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3566.

### PAN-3236 (rank 63)

ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous, so review feedback never lands. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3234 (rank 64)

Agents freeze on blocking choice menus and no health surface notices; the detector exists but is unwired. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3168 (rank 65)

DoD row 5 counts an agent paused for close-out as running, deadlocking the issue in verifying_on_main forever. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3103 (rank 66)

A transient merge_status failed permanently skips close-out, so merged work stays open and pickup-eligible. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3100 (rank 67)

The test role evaluates the dirty working tree, so a live work agent uncommitted edits produce false failures. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3043 (rank 68)

Mid-run provider quota exhaustion is undetected: an agent stayed running for days holding an advancing slot. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-2695 (rank 69)

Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.

### PAN-2742 (rank 70)

Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.

### PAN-3640 (rank 71)

Agent GC keeps terminal rows because a lost state push race aborts before drift reconciliation. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3651.

### PAN-3565 (rank 72)

Review lifecycle: failed spawn wedges starting, infra failure synthesized as a real CHANGES REQUESTED verdict. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3564.

### PAN-3557 (rank 73)

Post-merge label writes have no retry; a rate-limited 403 hides a merged issue from the verify-on-main sweep. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3464 (rank 74)

pan swarm reset never clears slotCompletions, so the coordinator re-arms the exact wedge reset was run to escape. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3257 (rank 75)

Crash-resume does not re-wire the PTY supervisor; a stale socket refuses every delivery and state loses the flag. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3188 (rank 76)

DoD row 5 accepts only the transient verifying_on_main waypoint, so an already-done issue can never close out. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3118 (rank 77)

Model quota exhaustion halts agents invisibly: four planning agents read running at zero cost with no fallback. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3043.

### PAN-3104 (rank 78)

A stale test result artifact is re-applied with no freshness check and keeps re-failing an issue after the fix landed. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3100.

### PAN-3044 (rank 79)

Review feedback delivery runs against closed issues, resurrecting agents and raising needs-you 12 days after close-out. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.

### PAN-3023 (rank 80)

Post-planning auto-spawn is abandoned on a transient Docker failure and attempt 1/3 never retries. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-08-18T21:56:25Z",
  "model": "claude-opus-5",
  "pass": "incremental",
  "openCount": 866,
  "nodes": [
    {
      "issue": "PAN-3679",
      "rank": 1,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running",
      "rationale": "Swarm marks live polyrepo slots merged and dispatches items whose DAG blockers are still running. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and can never start one — 3.5h outage",
      "rationale": "A supervisor pinned to a reload generation SIGTERMs every healthy dashboard and can never start one — 3.5h outage. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3740",
      "rank": 3,
      "size": "XS",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main: lint:slash-commands finds composer-manifest drift (handoff cap 500 vs 10000) — every merge blocked until regenerated",
      "rationale": "Main CI is red on the merge commit because the generated composer-command manifest still declares the old 500-character pan handoff cap while the command description says 10000. A red main empties the merge gate silently and blocks every other issue from landing, so this outranks all non-red-main work regardless of how small the fix is. The change itself is a regeneration of one committed artifact, so the cost of clearing it is near zero and the cost of leaving it is the whole pipeline. In pipeline — rank set once here and pinned from now on; gate stays auto.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 4,
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
      "issue": "PAN-3690",
      "rank": 4,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit",
      "rationale": "Swarm reset leaves slot completion markers; fresh items inherit ready-to-merge before they commit. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3524",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [
        "PAN-3492"
      ],
      "why": "Server-owned --changed verification loop relaunches through freeze, abort, pause and operator stop",
      "rationale": "Server-owned --changed verification loop relaunches through freeze, abort, pause and operator stop. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3492.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3283",
      "rank": 7,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recovering from review_infrastructure_failure sets review_status passed despite an outstanding CHANGES REQUESTED",
      "rationale": "Recovering from review_infrastructure_failure sets review_status passed despite an outstanding CHANGES REQUESTED. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 8,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [
        "PAN-3062"
      ],
      "why": "Workspace spawn branches from local HEAD, so every new workspace inherits whatever is unpushed on local main",
      "rationale": "Workspace spawn branches from local HEAD, so every new workspace inherits whatever is unpushed on local main. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3062.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 9,
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
      "issue": "PAN-3734",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [
        "PAN-3679"
      ],
      "why": "Reused completed swarm slot can start a new item from a stale polyrepo branch",
      "rationale": "Reused completed swarm slot can start a new item from a stale polyrepo branch. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3679.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3566",
      "rank": 11,
      "size": "XS",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the zombie test-agent cause",
      "rationale": "Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the zombie test-agent cause. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3281",
      "rank": 12,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while an issue is stuck on incomplete plan items, so stuck work reaches the UAT batch",
      "rationale": "ready_for_merge stays 1 while an issue is stuck on incomplete plan items, so stuck work reaches the UAT batch. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3685",
      "rank": 12,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed",
      "rationale": "Swarm GC leaves consumed completion markers that hold slot capacity after assignments are freed. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3682",
      "rank": 14,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrated polyrepo swarm-slot pan done writes a legacy workspace record path and crashes",
      "rationale": "Migrated polyrepo swarm-slot pan done writes a legacy workspace record path and crashes. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3630",
      "rank": 15,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell reported three deliveries the agent never received and marked them read; rejected design shipped",
      "rationale": "pan tell reported three deliveries the agent never received and marked them read; rejected design shipped. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3561",
      "rank": 16,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "An ownerless state-git lock is unbreakable and bricked a project write door for 2.5 days; no TTL, no recovery CLI",
      "rationale": "An ownerless state-git lock is unbreakable and bricked a project write door for 2.5 days; no TTL, no recovery CLI. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3424",
      "rank": 17,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "The state plane silently stops being durable: non-FF pushes are only warned about and drafts are never staged",
      "rationale": "The state plane silently stops being durable: non-FF pushes are only warned about and drafts are never staged. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3753",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon/reconciler flap resurrects dead PAN-1641 as a ready-to-merge train, invalidating a merged UAT batch; operator Merge is a no-op",
      "rationale": "The flywheel surfaced a dead issue as a ready-to-merge train, the operator clicked Merge, and nothing happened — no merge commit, no PR, because the only PR had been closed unmerged. Worse than the dead button: the resurrection invalidated an already-merged UAT batch, so the operator cannot trust what the merge surface reports as ready. This is the same class as the ready_for_merge and review-status corruption bugs already sitting at the top of this sequence: the pipeline reports a state that is not real, and every downstream decision inherits the lie. Merged and awaiting close-out, so the remaining work is the close-out ceremony, but it stays pinned high while it is in pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3653",
      "rank": 19,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "A strike blocked on red main has no owner that wakes it when main goes green; recover refuses",
      "rationale": "A strike blocked on red main has no owner that wakes it when main goes green; recover refuses. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3564",
      "rank": 20,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [
        "PAN-3561"
      ],
      "why": "Lock convoy: per-issue record lock is held across the global state-git wait, killing reviewer spawns with no retry",
      "rationale": "Lock convoy: per-issue record lock is held across the global state-git wait, killing reviewer spawns with no retry. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3561.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3554",
      "rank": 21,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main has no mechanical owner: a failed main-push CI run hid itself for 5h behind an empty merge queue",
      "rationale": "Red main has no mechanical owner: a failed main-push CI run hid itself for 5h behind an empty merge queue. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3687",
      "rank": 22,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done reports auto-triggered review while no durable handler is registered and nothing dispatches",
      "rationale": "pan done reports auto-triggered review while no durable handler is registered and nothing dispatches. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike landing pipeline cannot merge strikes: verification demands a vBRIEF strikes never have",
      "rationale": "Rank held in the critical band: the body was rewritten on 2026-08-10 and its blocker PAN-2828 has since closed, so the remaining work is the verification-gate carve-out and the exited-strike feedback path. Strikes are the pipeline's urgent-fix lane; while they cannot land, every red-main unblock needs an operator merge by hand.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3539",
      "rank": 24,
      "size": "XS",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [
        "PAN-3314"
      ],
      "why": "A single agent-spawned OOM killed the whole tmux server: OOMPolicy=stop failed the unit and every session died",
      "rationale": "A single agent-spawned OOM killed the whole tmux server: OOMPolicy=stop failed the unit and every session died. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size. Sequenced after PAN-3314.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3532",
      "rank": 25,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI never runs the full frontend suite, so main stayed red on frontend while every main run reported green",
      "rationale": "CI never runs the full frontend suite, so main stayed red on frontend while every main run reported green. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 26,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review sub-role resumed after writing its report and edited seven tracked files into the feature history",
      "rationale": "A review sub-role resumed after writing its report and edited seven tracked files into the feature history. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 27,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "The shared primary main worktree means whoever pushes main ships every other session unpushed commits",
      "rationale": "The shared primary main worktree means whoever pushes main ships every other session unpushed commits. Critical: this breaks the substrate the rest of the backlog runs on — a wrong merge, a lost verdict, or a dead pipeline lane — so it ranks ahead of feature work of equal size.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3754",
      "rank": 28,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory-governor hysteresis hold wedges admissions on a healthy host (12.5 GiB free read as critical); messages name the wrong trigger",
      "rationale": "The governor stopped admitting work while the host had 12.5 GiB available and told the operator memory was critical and the kernel might start killing processes. A hold that wedges dispatch on a healthy machine costs the entire fleet its throughput, and the misattributed operator message sends whoever reads it after the wrong cause — the same failure shape as the CPU-storm-mistaken-for-memory-pressure incidents this backlog already carries. It ranks with the other governor and scheduler defects that decide whether any agent runs at all rather than with feature work. Merged and awaiting close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3563",
      "rank": 29,
      "size": "S",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [
        "PAN-3566"
      ],
      "why": "Role agent spawned with an undelivered prompt becomes an invisible zombie that absorbs every re-dispatch",
      "rationale": "Role agent spawned with an undelivered prompt becomes an invisible zombie that absorbs every re-dispatch. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3566.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Test gate records failed on load-induced timeout flakes; retry timeout-only failures in isolation first",
      "rationale": "Test gate records failed on load-induced timeout flakes; retry timeout-only failures in isolation first. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3344.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3492",
      "rank": 31,
      "size": "M",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Server-side gate retries self-amplify: timeouts trigger retries that raise load and cause more timeouts",
      "rationale": "Server-side gate retries self-amplify: timeouts trigger retries that raise load and cause more timeouts. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3344.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3631",
      "rank": 32,
      "size": "XS",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state — prior frozen",
      "rationale": "Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state — prior frozen. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3657",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train queues endpoint runs the monorepo builder for polyrepos, so every candidate is dropped",
      "rationale": "Merge-train queues endpoint runs the monorepo builder for polyrepos, so every candidate is dropped. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3651",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-land the overdeck-state non-fast-forward push retry with the pan-dir state-door suites green",
      "rationale": "Re-land the overdeck-state non-fast-forward push retry with the pan-dir state-door suites green. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3555",
      "rank": 35,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start silently spawned a fresh session over a resumable warm one — warm-by-default violated, context lost",
      "rationale": "pan start silently spawned a fresh session over a resumable warm one — warm-by-default violated, context lost. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 36,
      "size": "M",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents repeatedly die before writing a verdict across five issues and two projects",
      "rationale": "Review agents repeatedly die before writing a verdict across five issues and two projects. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "One transient upstream stream error benches CLIProxy only auth, so about 70% of GPT-routed requests 503",
      "rationale": "One transient upstream stream error benches CLIProxy only auth, so about 70% of GPT-routed requests 503. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [
        "PAN-3566"
      ],
      "why": "A never-kicked-off ghost test session reads as running and absorbs every subsequent test dispatch",
      "rationale": "Score raised and a new dependency added on PAN-3566, which identified the deterministic producer of ghost test sessions — a test-role launcher that execs claude with no user prompt — so this issue is now the hardening half of a known root cause.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 39,
      "size": "M",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "One cgroup holds every agent pane, so a single hungry agent can OOM the entire fleet",
      "rationale": "One cgroup holds every agent pane, so a single hungry agent can OOM the entire fleet. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 40,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default hold is consulted on one merge path only, so held issues merge individually anyway",
      "rationale": "auto_merge_default hold is consulted on one merge path only, so held issues merge individually anyway. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 41,
      "size": "XS",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback is written to .overdeck/feedback while agents and the merge gate are pointed at .pan/feedback",
      "rationale": "Review feedback is written to .overdeck/feedback while agents and the merge gate are pointed at .pan/feedback. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3708",
      "rank": 42,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [
        "PAN-3040"
      ],
      "why": "pan strike dies on a polyrepo wrapper root before provisioning nested worktrees",
      "rationale": "pan strike dies on a polyrepo wrapper root before provisioning nested worktrees. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3040.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown never fires: --is-ancestor cannot see a squash merge, 96 branches left as residue",
      "rationale": "Strike-branch teardown never fires: --is-ancestor cannot see a squash merge, 96 branches left as residue. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3654",
      "rank": 44,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Compact respawn confirms against the archived session and kills the healthy fresh agent",
      "rationale": "Compact respawn confirms against the archived session and kills the healthy fresh agent. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3633",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [
        "PAN-3325"
      ],
      "why": "Strike workspaces spawn with no @types tree, so the contract typecheck fails and agents cry false red main",
      "rationale": "Strike workspaces spawn with no @types tree, so the contract typecheck fails and agents cry false red main. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3325.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3535",
      "rank": 46,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "The drain/resume boot gate is re-derived from the caller env, so any restart from a clean shell drops the hold",
      "rationale": "The drain/resume boot gate is re-derived from the caller env, so any restart from a clean shell drops the hold. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 47,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue never fired",
      "rationale": "A finished work agent with an open PR sat two hours because review was never dispatched and auto-requeue never fired. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 48,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "A capacity-refused planning to work handoff is classified guardrails and marked terminally stuck",
      "rationale": "A capacity-refused planning to work handoff is classified guardrails and marked terminally stuck. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 49,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [
        "PAN-3566"
      ],
      "why": "A review session spawned but never briefed sits at zero context forever and blocks its own replacement",
      "rationale": "A review session spawned but never briefed sits at zero context forever and blocks its own replacement. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3566.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3078",
      "rank": 50,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "The inspect verdict is never delivered to the work agent, so an agent that waits for it deadlocks forever",
      "rationale": "The inspect verdict is never delivered to the work agent, so an agent that waits for it deadlocks forever. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects",
      "rationale": "pan strike is monorepo-shaped end to end and fails immediately on polyrepo projects. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3580",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL",
      "rationale": "The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3677",
      "rank": 52,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning agents wedge after a background Explore task finishes; parent never consumes the result",
      "rationale": "Planning agents wedge after a background Explore task finishes; parent never consumes the result. In pipeline — rank pinned while an agent is working it; gate stays auto so the pipeline, not the sequencer, decides the next move. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2995",
      "rank": 54,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [
        "PAN-3047"
      ],
      "why": "pan done --strike false-blocks after the prescribed squash-merge; it should verify PR-merged state, not ancestry",
      "rationale": "pan done --strike false-blocks after the prescribed squash-merge; it should verify PR-merged state, not ancestry. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3047.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3752",
      "rank": 55,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [
        "PAN-3743"
      ],
      "why": "Conversation transcript parsing runs on the dashboard main thread — slow opens and event-loop stalls survive the PAN-3743 fix",
      "rationale": "The declared follow-up to PAN-3743: after that deploy removed every slow db-jobs line, conversation opens were still slow because transcript parsing runs on the dashboard main thread. Event-loop stalls on this server are not a cosmetic latency problem — they freeze HTTP, WebSocket and polling together, which is the documented mechanism behind the watchdog restart churn and the reconnect storms elsewhere in this backlog. Ranking it just under its parent keeps the pair adjacent without claiming it blocks anything. Merged and awaiting close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3743",
      "rank": 56,
      "size": "L",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard REST requests queue >20s in 5-minute burst windows — Awareness reports \"signal timed out\", conversation opens crawl",
      "rationale": "Requests queueing past the frontend twenty-second abort budget means the operator surface reports failure while the server is merely saturated, which trains everyone to distrust the dashboard exactly when load is highest. It sits in the same substrate band as the other event-loop and throughput defects because a dashboard that cannot answer under burst is the surface every other pipeline decision is made through. Merged and awaiting close-out; its residual slow path is tracked separately as PAN-3752.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering: 11 duplicate ranks and 11 gaps persisted",
      "rationale": "write-sequence pins in-pipeline ranks without renumbering: 11 duplicate ranks and 11 gaps persisted. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3560",
      "rank": 58,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "PTY supervisor overloads under concurrent convoys; fleet-wide 502s kill resumes and feedback delivery",
      "rationale": "PTY supervisor overloads under concurrent convoys; fleet-wide 502s kill resumes and feedback delivery. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3571",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop-hook completion check exits silently on timeout: 334 stranded turn-ends, agents idle until a patrol notices",
      "rationale": "Stop-hook completion check exits silently on timeout: 334 stranded turn-ends, agents idle until a patrol notices. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 60,
      "size": "XS",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and inspect agents must decide review depth themselves instead of parking the convoy on an operator AUQ",
      "rationale": "Review and inspect agents must decide review depth themselves instead of parking the convoy on an operator AUQ. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3329",
      "rank": 61,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment generation node_modules and tracked packages files are deleted while a dev-checkout build runs",
      "rationale": "Deployment generation node_modules and tracked packages files are deleted while a dev-checkout build runs. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 62,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [
        "PAN-3566"
      ],
      "why": "A test-role agent spawned, never ran a turn, and strands its issue behind a verdict never produced",
      "rationale": "A test-role agent spawned, never ran a turn, and strands its issue behind a verdict never produced. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3566.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 63,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous, so review feedback never lands",
      "rationale": "ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous, so review feedback never lands. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 64,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze on blocking choice menus and no health surface notices; the detector exists but is unwired",
      "rationale": "Agents freeze on blocking choice menus and no health surface notices; the detector exists but is unwired. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3168",
      "rank": 65,
      "size": "XS",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 counts an agent paused for close-out as running, deadlocking the issue in verifying_on_main forever",
      "rationale": "DoD row 5 counts an agent paused for close-out as running, deadlocking the issue in verifying_on_main forever. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 66,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient merge_status failed permanently skips close-out, so merged work stays open and pickup-eligible",
      "rationale": "A transient merge_status failed permanently skips close-out, so merged work stays open and pickup-eligible. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 67,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "The test role evaluates the dirty working tree, so a live work agent uncommitted edits produce false failures",
      "rationale": "The test role evaluates the dirty working tree, so a live work agent uncommitted edits produce false failures. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3043",
      "rank": 68,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion is undetected: an agent stayed running for days holding an advancing slot",
      "rationale": "Mid-run provider quota exhaustion is undetected: an agent stayed running for days holding an advancing slot. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 69,
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
      "rank": 70,
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
      "issue": "PAN-3640",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3651"
      ],
      "why": "Agent GC keeps terminal rows because a lost state push race aborts before drift reconciliation",
      "rationale": "Agent GC keeps terminal rows because a lost state push race aborts before drift reconciliation. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3651.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3565",
      "rank": 72,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3564"
      ],
      "why": "Review lifecycle: failed spawn wedges starting, infra failure synthesized as a real CHANGES REQUESTED verdict",
      "rationale": "Review lifecycle: failed spawn wedges starting, infra failure synthesized as a real CHANGES REQUESTED verdict. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3564.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3557",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge label writes have no retry; a rate-limited 403 hides a merged issue from the verify-on-main sweep",
      "rationale": "Post-merge label writes have no retry; a rate-limited 403 hides a merged issue from the verify-on-main sweep. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3464",
      "rank": 74,
      "size": "XS",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm reset never clears slotCompletions, so the coordinator re-arms the exact wedge reset was run to escape",
      "rationale": "pan swarm reset never clears slotCompletions, so the coordinator re-arms the exact wedge reset was run to escape. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3257",
      "rank": 75,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume does not re-wire the PTY supervisor; a stale socket refuses every delivery and state loses the flag",
      "rationale": "Crash-resume does not re-wire the PTY supervisor; a stale socket refuses every delivery and state loses the flag. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 76,
      "size": "XS",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 accepts only the transient verifying_on_main waypoint, so an already-done issue can never close out",
      "rationale": "DoD row 5 accepts only the transient verifying_on_main waypoint, so an already-done issue can never close out. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 77,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3043"
      ],
      "why": "Model quota exhaustion halts agents invisibly: four planning agents read running at zero cost with no fallback",
      "rationale": "Model quota exhaustion halts agents invisibly: four planning agents read running at zero cost with no fallback. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3043.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 78,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3100"
      ],
      "why": "A stale test result artifact is re-applied with no freshness check and keeps re-failing an issue after the fix landed",
      "rationale": "A stale test result artifact is re-applied with no freshness check and keeps re-failing an issue after the fix landed. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream. Sequenced after PAN-3100.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 79,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against closed issues, resurrecting agents and raising needs-you 12 days after close-out",
      "rationale": "Review feedback delivery runs against closed issues, resurrecting agents and raising needs-you 12 days after close-out. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 80,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn is abandoned on a transient Docker failure and attempt 1/3 never retries",
      "rationale": "Post-planning auto-spawn is abandoned on a transient Docker failure and attempt 1/3 never retries. High-impact substrate hardening: it recurs across issues and costs operator time on every occurrence, so fixing it compounds across everything downstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 81,
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
      "rank": 82,
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
      "rank": 83,
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
      "rank": 84,
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
      "rank": 85,
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
      "issue": "PAN-2883",
      "rank": 86,
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
      "rank": 87,
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
      "rank": 88,
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
      "rank": 89,
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
      "rank": 90,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployed dashboard PATH omits Bun, so verification workers cannot run their install gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3621",
      "rank": 91,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start dies resolving a chunk graph spliced across two builds: old importer name, live generation root",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3605",
      "rank": 92,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint-effect-diagnostics executed a squatted npm package via npx registry fallback — supply-chain exposure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 93,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel with an active run sat idle 2h after reboot while its exempt reconciler was wired and enabled",
      "rationale": "Score nudged up on the 2026-08-06 update: the reconciler that should relaunch a dead flywheel is wired, exempt from the resume gate, and still did not fire, so the pipeline's last-stand orchestrator has no proven owner after a reboot. Its absolute rank moved only because 233 newer issues entered the backlog above it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3569",
      "rank": 94,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deploy gate deadlocks on a stale pending-post-merge.json when the deacon is paused; no staleness rule",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3522",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor watchdog restart-churns under CPU storm: the probe budget ignores the boot warm phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3505",
      "rank": 96,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-3062"
      ],
      "why": "Unpushed agent code commits on the primary main worktree block the flywheel own state write door",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 97,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The deployment gate queues a deferred deploy and promises a next-verification-boundary trigger that does not exist",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3344",
      "rank": 98,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resource governor must gate dispatch on CPU load, not memory alone; agent-shell test runs bypass admission",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3463",
      "rank": 99,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A legitimate empty-diff slot outcome can never pass item verify, so the slot wedges and blocks dispatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3429",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Memory governor defers admissions but sheds nothing under HARD pressure; heavy gate runs are not a shed rung",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 101,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Freshly-spawned convoy lanes freeze at zero output; the existing detector only covers warm resumes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 102,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-3248"
      ],
      "why": "A queued dashboard deploy globally defers verification, starving cross-project review handoffs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 103,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload never clears pending-deploy.json, so every flywheel deploy starves verification for all projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3224",
      "rank": 104,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A crash-interrupted spawn strands the pending-work-spawn placeholder and plain pan start dies on Unknown model",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3022",
      "rank": 105,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The work-spawn route ignores the per-issue workModel override and then clobbers the stored record with the default",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 106,
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
      "rank": 107,
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
      "rank": 108,
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
      "rank": 109,
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
      "rank": 110,
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
      "rank": 111,
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
      "rank": 112,
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
      "rank": 113,
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
      "rank": 114,
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
      "rank": 115,
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
      "rank": 116,
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
      "rank": 117,
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
      "rank": 118,
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
      "rank": 119,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike self-abort is not terminal, so the deacon resurrects aborted strikes on every recovery pass",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3541",
      "rank": 120,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review restart after an unclean reviewer death loops on the session-resume menu; eligibility ignores how it ended",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3439",
      "rank": 121,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-3224"
      ],
      "why": "pan start crashes on a pending-work-spawn placeholder row where resume already takes the fresh-spawn path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2747",
      "rank": 122,
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
      "issue": "PAN-2709",
      "rank": 123,
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
      "rank": 124,
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
      "rank": 125,
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
      "rank": 126,
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
      "rank": 127,
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
      "rank": 128,
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
      "rank": 129,
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
      "rank": 130,
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
      "rank": 131,
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
      "issue": "PAN-3689",
      "rank": 129,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphaned swarm-slot GC targets the aggregate polyrepo root; nested worktrees survive and spam failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3667",
      "rank": 133,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy has no cross-family remap, so Anthropic-pinned subagents die at spawn in proxied sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3629",
      "rank": 134,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "No sanctioned door to re-scope a live agent: operator scope changes force a doctrine violation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3556",
      "rank": 135,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent double-spawn race allocated two session identities 3s apart and overwrote the first launcher pin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3543",
      "rank": 136,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while recommending --fresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3432",
      "rank": 137,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive yield fans out: seven work agents yielded for one review convoy and auto-resume floods them back",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "A fresh workspace ships an empty node_modules, so tooling silently resolves deps from the parent repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3301",
      "rank": 139,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [
        "PAN-3631"
      ],
      "why": "The backlog manifest still writes legacy .pan and the stray-writer patrol logs it 68k times",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 140,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [
        "PAN-3062"
      ],
      "why": "A workspace-confined work agent wrote a doc edit into the primary main worktree; the guard covers commits, not writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [
        "PAN-3325"
      ],
      "why": "New workspaces arrive with empty node_modules and bun off PATH, so the documented remedy fails",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 142,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "The tmux fallback answered a live session-resume menu because its own paste hid the menu from the detector",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 143,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "The agent git guard is bypassable by stripping it from PATH, and an agent did so unprompted to pass a false block",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3139",
      "rank": 144,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "The authoritative agents table under-reports a live four-hour agent as stopped and nothing reconciles it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 145,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "MERGE refuses or silently dead-ends for 30 minutes when the scheduler yielded the work agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 146,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction leaves agents idle forever and the GPT-5.6 context window is declared twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 147,
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
      "rank": 148,
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
      "rank": 149,
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
      "rank": 150,
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
      "rank": 151,
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
      "rank": 152,
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
      "rank": 153,
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
      "rank": 154,
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
      "rank": 155,
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
      "rank": 156,
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
      "rank": 157,
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
      "rank": 158,
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
      "rank": 159,
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
      "rank": 160,
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
      "issue": "PAN-2954",
      "rank": 161,
      "size": "XS",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects",
      "rationale": "postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run. Dependency PAN-2882 closed since the last pass, so this is no longer gated on it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 162,
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
      "rank": 163,
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
      "rank": 164,
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
      "rank": 165,
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
      "issue": "PAN-3634",
      "rank": 166,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning auto-handoff stamps the ambient flywheelRunId, stripping the operator-started reaping exemption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3622",
      "rank": 167,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "orphan-proposed-reconciler test asserts on a real issue and reads live GitHub; broke when that issue closed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3513",
      "rank": 168,
      "size": "L",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent runtime plane on overdeck-state: durable session pointers so GC becomes cache eviction, not data loss",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3454",
      "rank": 169,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost hook re-ingests fork-copied parent history under reviewer identity: fabricated warnings, multi-billed spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 170,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convert the real-timer test family to fake timers and quarantine the rest so main CI stops flaking",
      "rationale": "Score raised: the fake-timer conversion is now the shared remedy named by PAN-3243, PAN-3520 and PAN-2421, so it unblocks a whole family of red-main flakes rather than one suite. Its absolute rank still fell because this pass inserted 233 newer issues ahead of it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3460",
      "rank": 171,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-item verify_commands run the whole root suite, making slot merge gates load-fragile and patrol-blocking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 172,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no sanctioned main sync: rebase is guard-blocked and sync-main cannot resolve -strike workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3297",
      "rank": 173,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell calls healthy supervisor-run agents zombies after a dashboard restart while resume calls them healthy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 174,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3186"
      ],
      "why": "MYN pipeline membership fails forge_unavailable because glab runs in a repo path that is not a git repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 175,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out cannot tear down workspaces holding root-owned container residue and dies on EACCES after every DoD row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 176,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan merge cancel is fully broken: Commander passes its options object into the fetchImpl injection slot",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3174",
      "rank": 177,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3032"
      ],
      "why": "Every polyrepo UAT stack 504s: stale myn- Traefik labels, unattached devnet, and a frontend port mismatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3129",
      "rank": 178,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canonical writes under agent-controlled paths have no symlink or TOCTOU containment check",
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
      "issue": "PAN-3048",
      "rank": 180,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands .pan/drafts PRDs in product feature branches; the duplicated exclusion list has drifted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 181,
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
      "rank": 182,
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
      "rank": 183,
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
      "rank": 184,
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
      "rank": 185,
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
      "rank": 186,
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
      "issue": "PAN-2430",
      "rank": 187,
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
      "rank": 188,
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
      "rank": 189,
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
      "issue": "PAN-3553",
      "rank": 190,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Census reads a zero-session tmux server as unavailable, so post-reboot conversations sit on Starting for minutes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 191,
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
      "rank": 192,
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
      "rank": 193,
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
      "rank": 194,
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
      "rank": 195,
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
      "rank": 196,
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
      "rank": 197,
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
      "rank": 198,
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
      "issue": "PAN-3617",
      "rank": 199,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "One strike died on every dispatch with zero output while a sibling minutes later worked normally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3596",
      "rank": 200,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon patrol has no per-step timing, so a 481-GET reconciler ran undetected and overruns are unattributable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3570",
      "rank": 201,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Devcontainer leaves root-owned node_modules subtrees; init-fe EACCES blocks pan start and rebuild cannot heal it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3517",
      "rank": 202,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy forks still miss the parent prompt cache: launch-injection byte drift plus a dropped cache-scope header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 203,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload deletes the generation the global pan link targets, so the CLI vanishes for the rebuild window",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1711",
      "rank": 204,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause the dashboard event-loop stalls that force watchdog restarts and 502s under pipeline load",
      "rationale": "Raised from the middle of the backlog because the 2026-08-02 update ties it to the watchdog restart-churn family (PAN-3522, PAN-3524, PAN-3492) — event-loop starvation is now the shared root of several live pipeline incidents, not an isolated latency complaint.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3355",
      "rank": 205,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "sessionExists maps a probe failure to absence, so callers read not-running when liveness is genuinely unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 206,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-3317"
      ],
      "why": "Strike prompt instructs a rebase the launcher guard blocks while sync-main resolves the wrong worktree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 207,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-3631"
      ],
      "why": "The sequencer ran a full pass on an empty manifest while the read model held 1120 issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 208,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitLab merged-head oracle spawns one glab process per repo and head, stalling every membership refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 209,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out teardown scopes by compose project while an unprefixed devcontainer init container blocks it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 210,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership blanks a whole project because one configured member path is not a git repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 211,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reports a hard failure after a successful spawn: 266 lines run between the duplicate check and create",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 212,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote is complete at merge time; nothing verifies the change reached production before members read shipped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3176",
      "rank": 213,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT batch promotion takes no stack health evidence, so a batch never exercised can be promoted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 214,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done fails on the generated devcontainer harness and agents infer deleting workspace infrastructure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 215,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect and review-supervisor spawns omit --effort and inherit xhigh, recurring once per xBRIEF item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2980",
      "rank": 216,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pre-push file-size guard audits the dirty working tree, so another session edits block unrelated pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2971",
      "rank": 217,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "The flywheel orchestrator finalized its own run and kept ticking for 19h while Pause and Stop were disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 218,
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
      "rank": 219,
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
      "rank": 220,
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
      "rank": 221,
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
      "rank": 222,
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
      "rank": 223,
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
      "rank": 224,
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
      "rank": 225,
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
      "issue": "PAN-3579",
      "rank": 226,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Around 20 frontend mutation fetches hand-write JSON headers and 403 on CSRF-guarded routes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3510",
      "rank": 227,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stopped agents can leave detached docker-run test containers alive for hours, contending with other gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3245",
      "rank": 228,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pan done completion gate flags workspace .pan/drafts as uncommitted work despite its own .pan exclusion",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3243",
      "rank": 229,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-1824"
      ],
      "why": "An auto-commit test bounds a real git subprocess by 20 setImmediate turns and reddened main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 230,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pipeline reports merge failed after a successful merge and leaves the issue Todo with no label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 231,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Two projects are permanently unreadable through the membership door: an uninstalled GitHub App 404 typed as unavailable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 232,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "The idle-stack reaper regex only matches Overdeck container names, so other projects stacks are never reaped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 233,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stack rebuild composes under one prefix while Traefik labels reference another, and devnet attaches are runtime-only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3652",
      "rank": 234,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add workflow_dispatch to ci.yml and state-plane-branches.yml so an unverified main tip can be verified",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3536",
      "rank": 235,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot reach ohmypi conversations: expectedHarness defaults to claude-code when state.json is absent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3518",
      "rank": 236,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "TTL-aware re-review payload policy: fresh-spawn-with-digest when a reviewer history is cold and large",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3303",
      "rank": 237,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck latches Unknown project after reconnect: an empty registered-projects response is taken as truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 238,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "One issue lost its agent session four times in a run and its reviewer died writing no artifact",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3218",
      "rank": 239,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: a user-facing fix can sit merged on main for hours while every published version is broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 240,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Identifier-joined write paths have no containment gate, so a crafted id could redirect a canonical write",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3094",
      "rank": 241,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pan done merge fallback force-pushes a branch that is fast-forward pushable and leaves the command half-done",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 242,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan monitor: pull-based background inbox transport replacing keystroke injection for Claude Code sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 243,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background AI title and about spawns fail because --bare skips credential reads in current Claude Code",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3627",
      "rank": 244,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "backlog-auto-trigger throws on a legitimately empty backlog, so a fresh npx install prints a stack trace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 245,
      "size": "L",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Resource segregation: per-project isolation classes so one project cannot starve another project pipeline",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3332",
      "rank": 246,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard slash-command activities keep saying running in background after the detached spawn already died",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3321",
      "rank": 247,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Escalation copy and CLAUDE.md tell operators to run pan unstick, which the CLI did not expose",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3308",
      "rank": 248,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size guard prints a paste-ready ratchet-up line, so two of three agents raised the ceiling",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3175",
      "rank": 249,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train ordering derives conflicts from file overlap only and cannot see that one feature requires another",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 250,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI crashes at exit with an unhandled rejection when the PostHog shutdown flush times out",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3012",
      "rank": 251,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Back up harness conversation transcripts before harnesses delete them; archive preserves the pointer, not the data",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3527",
      "rank": 252,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sidebar project list never retries: one failed boot fetch leaves CONVERSATIONS 0 / ISSUES 0 until reload",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1767",
      "rank": 253,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface the merged-but-not-closed-out count in pan status and the dashboard headline",
      "rationale": "Kept at high importance because it carries the substrate-improvement label, but scored below its prior level: the close-out reaper and DoD work landed since the last pass cover the correctness half, so what remains here is the operator-visible count.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3445",
      "rank": 254,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "The projects.yaml TCP lock hashes into the ephemeral client-port range and false-fails uncontended writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 255,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pane-detected rate-limit and session-resume waits show as needs-you but can only be answered in the terminal",
      "rationale": "Promoted from medium to high importance: the newer pane-choice work (PAN-3234, PAN-3235, PAN-3113) established the answer surface this issue needs, so the remaining gap is now concrete rather than open-ended design.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3295",
      "rank": 256,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single per-machine completion-check summarizer with a queue and first-class observability",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3211",
      "rank": 257,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "No honest disposition for closed-without-landing issues; residue rows are neither closeable nor reapable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 258,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log grew to 867MB with no rotation, making incident logs un-greppable",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3099",
      "rank": 259,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan restart --health-timeout is enforced in milliseconds and a false-failed check left the dashboard down",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3751",
      "rank": 260,
      "size": "S",
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
      "issue": "PAN-2421",
      "rank": 261,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Dashboard server route tests flake under full-suite verification load and stay quarantined",
      "rationale": "Lowered a little and pointed at the CPU governor: the 2026-07-30 update confirms these are contention flakes on loaded runners, so PAN-3344 and PAN-3520 own the root cause and this tracks the quarantine exit.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3307",
      "rank": 262,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "commitlint scope-enum is stale, warns on most real commits, and still lists the removed beads scope",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3107",
      "rank": 263,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Productize the memory-attribution census so OOM spikes are attributable after the fact",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3003",
      "rank": 264,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-agent launchers omit the OVERDECK_AGENT_ID export, so a manual re-launch dies instantly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3701",
      "rank": 265,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Consolidate four first-party LLM client stacks onto effect/unstable/ai (LanguageModel + ExecutionPlan)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3516",
      "rank": 266,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Repo .claude/skills holds stale duplicates of three bundled skills, so overdeck sessions load outdated text",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3276",
      "rank": 267,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows for terminal questions and permission prompts do not navigate anywhere when clicked",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2351",
      "rank": 268,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens plus WS and SSE heartbeats — blocks all remote exposure",
      "rationale": "Held as the highest-scored phase of the Anywhere epic: it gates every remote-exposure phase, and the 2026-07-28 PRD makes the token-scope model concrete enough to build.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3121",
      "rank": 269,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [
        "PAN-3117"
      ],
      "why": "The failed-send outbox never reconciles against the transcript, leaving a delivered message with a doomed Retry twin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3113",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [
        "PAN-3235"
      ],
      "why": "Surface agent-pane choice prompts as inline decision cards in the conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 271,
      "size": "XS",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead linear-mcp-auth-hook entries leak into durable settings.json and fail on every matching tool call",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1666",
      "rank": 272,
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
      "rank": 273,
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
      "issue": "PAN-3420",
      "rank": 270,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 275,
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
      "rank": 276,
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
      "issue": "PAN-2755",
      "rank": 307,
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
      "rank": 308,
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
      "rank": 309,
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
      "rank": 310,
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
      "rank": 311,
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
      "rank": 312,
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
      "rank": 313,
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
      "rank": 314,
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
      "rank": 315,
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
      "rank": 316,
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
      "rank": 317,
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
      "rank": 318,
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
      "rank": 319,
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
      "rank": 320,
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
      "rank": 321,
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
      "rank": 322,
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
      "rank": 323,
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
      "rank": 324,
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
      "rank": 325,
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
      "rank": 326,
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
      "rank": 327,
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
      "rank": 328,
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
      "rank": 329,
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
      "rank": 330,
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
      "rank": 331,
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
      "rank": 332,
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
      "rank": 333,
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
      "rank": 334,
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
      "rank": 335,
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
      "rank": 336,
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
      "rank": 337,
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
      "rank": 338,
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
      "rank": 339,
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
      "issue": "PAN-1217",
      "rank": 340,
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
      "rank": 341,
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
      "rank": 342,
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
      "rank": 343,
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
      "rank": 344,
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
      "rank": 345,
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
      "rank": 346,
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
      "rank": 347,
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
      "rank": 348,
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
      "rank": 349,
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
      "rank": 350,
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
      "rank": 351,
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
      "rank": 352,
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
      "rank": 353,
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
      "rank": 354,
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
      "rank": 355,
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
      "rank": 356,
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
      "rank": 357,
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
      "rank": 358,
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
      "rank": 359,
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
      "rank": 360,
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
      "rank": 361,
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
      "rank": 362,
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
      "rank": 363,
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
      "rank": 364,
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
      "rank": 365,
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
      "rank": 366,
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
      "rank": 367,
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
      "rank": 368,
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
      "rank": 369,
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
      "rank": 370,
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
      "rank": 371,
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
      "rank": 372,
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
      "rank": 373,
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
      "rank": 374,
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
      "rank": 375,
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
      "rank": 376,
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
      "rank": 377,
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
      "rank": 378,
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
      "rank": 379,
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
      "rank": 380,
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
      "rank": 381,
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
      "rank": 382,
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
      "rank": 383,
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
      "rank": 384,
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
      "rank": 385,
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
      "rank": 386,
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
      "rank": 387,
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
      "issue": "PAN-3661",
      "rank": 388,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "issueActions review-mode tests fail locally: semantic rejection no longer toasts since secure dispatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 389,
      "size": "XL",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere — reachability, identity and a remote-safe API behind remote, mobile and shared access",
      "rationale": "Lifted slightly and marked as an epic container: the body now enumerates six phased children with PRDs on the state branch, so it is ranked by the aggregate of those children rather than as standalone work.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3455",
      "rank": 390,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "isCliproxyUpToDate always returns false because --version exits 2, so every ensure re-downloads the release",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3235",
      "rank": 391,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard decision card should render and answer agent pane-choice menus in one click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3181",
      "rank": 392,
      "size": "L",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Own agent memories in Overdeck: migrate harness project memories onto a per-repo overdeck-memory orphan branch",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3137",
      "rank": 393,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles come from the flywheel status snapshot, putting orchestrator prose on a merge surface",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3117",
      "rank": 394,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "The failed-send bubble hides a deterministic 4xx reason and offers a Retry that can never succeed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3744",
      "rank": 395,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view renders the new-conversation greeting instead of a loading skeleton while the transcript RPC is still resolving",
      "rationale": "Showing \"How can I help you\" while a transcript is loading is an assertion that the conversation is empty, which is wrong and, under load, wrong for many seconds. It is a small, self-contained frontend fix whose value is honest state rather than throughput, so it ranks in the middle band rather than with the substrate defects. Merged and awaiting close-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 396,
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
      "rank": 397,
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
      "rank": 398,
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
      "rank": 399,
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
      "rank": 400,
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
      "rank": 401,
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
      "rank": 402,
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
      "rank": 403,
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
      "rank": 404,
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
      "rank": 405,
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
      "rank": 406,
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
      "rank": 407,
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
      "rank": 408,
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
      "rank": 409,
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
      "rank": 410,
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
      "issue": "PAN-3540",
      "rank": 411,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View shows phantom agent orbs, a dead Hook Bus panel, and a pressure-blind swap header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 412,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K palette opens stale conversations that 404 because the search index never prunes deleted sessions",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2501",
      "rank": 413,
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
      "issue": "PAN-2491",
      "rank": 414,
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
      "rank": 415,
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
      "rank": 416,
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
      "rank": 417,
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
      "rank": 418,
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
      "rank": 419,
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
      "rank": 420,
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
      "rank": 421,
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
      "rank": 422,
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
      "rank": 423,
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
      "rank": 424,
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
      "rank": 425,
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
      "rank": 426,
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
      "issue": "PAN-3732",
      "rank": 427,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex handoff serializes a large rollout twice (~286MB peak RSS); serialize once and pass the text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3354",
      "rank": 428,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archiving the main workspace hides the singleton row with no unarchive affordance in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3288",
      "rank": 429,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout preflight should detect stale node_modules and say run bun install instead of ERR_MODULE_NOT_FOUND",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2352",
      "rank": 430,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel and Access with device-scoped tokens",
      "rationale": "Re-sequenced with the rest of the Anywhere phases: the 2026-07-28 update gave every phase a PRD on the state branch and an explicit dependency order, so the phases now rank in build order instead of sitting together as undifferentiated low-priority stubs.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3178",
      "rank": 431,
      "size": "XL",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class worktrees and diffs: change badges, a dedicated Changes surface and conversation worktrees",
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
      "why": "The UAT stack probe derives running from container count, so a still-booting stack offers a link that times out",
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
      "why": "A completed strike shows a false INPUT chip because the pane-idle heuristic reads post-ready idle as a question",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 434,
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
      "rank": 435,
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
      "rank": 436,
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
      "rank": 437,
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
      "rank": 438,
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
      "rank": 439,
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
      "rank": 440,
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
      "rank": 441,
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
      "issue": "PAN-3745",
      "rank": 442,
      "size": "XS",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost.recorded fails DomainEvent validation at the ws-rpc boundary on every cost write — log spam plus an undecided broadcast-vs-filter call",
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
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planned deploy restarts show the alarm-toned Reconnecting banner; use the lifecycle signal for calm copy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 450,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page: narrative feed instead of a raw 55KB kickoff dump, surface the pending question honestly",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2565",
      "rank": 451,
      "size": "XL",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "rationale": "Score raised on the 2026-07-26 PRD: the multi-agent task surface is now specified against the current conversation runtime rather than described as a competitor-parity wish.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3016",
      "rank": 452,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "URL-address every view so any place you navigate to can be reached again from the URL",
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
      "issue": "PAN-3731",
      "rank": 460,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restart-gate banner gives no feedback after approval; dead-requester approvals look like a broken button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3703",
      "rank": 455,
      "size": "XS",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K: sort conversation results newest-first by the canonical recency field",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2566",
      "rank": 462,
      "size": "L",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: triage list of capabilities Overdeck genuinely lacks",
      "rationale": "Held as a triage epic and marked as an epic container: it is a gap list, not workable work, so it is ranked by whichever children get carved out of it.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1572",
      "rank": 463,
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
      "rank": 464,
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
      "rank": 465,
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
      "rank": 466,
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
      "rank": 467,
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
      "rank": 468,
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
      "rank": 469,
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
      "rank": 470,
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
      "issue": "PAN-3700",
      "rank": 471,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan acp serve: expose Overdeck conversations to ACP clients like Zed via effect-acp/agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2353",
      "rank": 472,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge over a scoped API and Fly 6PN peering",
      "rationale": "Re-sequenced with the rest of the Anywhere phases: the 2026-07-28 update gave every phase a PRD on the state branch and an explicit dependency order, so the phases now rank in build order instead of sitting together as undifferentiated low-priority stubs.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2982",
      "rank": 473,
      "size": "XS",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "The review convoy should run a skill selftest when sync-sources/skills changes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 474,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness so any capability-passing ACP agent CLI is a spawnable runtime",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1444",
      "rank": 475,
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
      "rank": 476,
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
      "rank": 477,
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
      "rank": 478,
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
      "rank": 479,
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
      "rank": 480,
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
      "rank": 481,
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
      "rank": 482,
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
      "rank": 483,
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
      "rank": 484,
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
      "rank": 485,
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
      "rank": 486,
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
      "rank": 487,
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
      "rank": 488,
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
      "rank": 489,
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
      "issue": "PAN-3735",
      "rank": 490,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI blames a healthy dashboard when the caller is sandboxed; detect read-only/no-network and say so",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3705",
      "rank": 485,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [
        "PAN-3703"
      ],
      "why": "Ctrl-K: add Conversations as a first-class entry in the type list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3530",
      "rank": 492,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Four God View components poll on 30s timers, violating the surface documented event-driven contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3290",
      "rank": 493,
      "size": "XS",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF items can carry empty metadata.traces, so docs items are invisible to requirement traceability",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 494,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge, ntfy first and Web Push later",
      "rationale": "Re-sequenced with the rest of the Anywhere phases: the 2026-07-28 update gave every phase a PRD on the state branch and an explicit dependency order, so the phases now rank in build order instead of sitting together as undifferentiated low-priority stubs.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3157",
      "rank": 495,
      "size": "XS",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "The Awareness feed renders the Flywheel as a generic Claude Code chat row reading No messages yet",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3017",
      "rank": 496,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "The issue-page UAT panel renders inline actions only, so a healthy stack has no restart control there",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 497,
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
      "rank": 498,
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
      "rank": 499,
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
      "rank": 500,
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
      "rank": 501,
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
      "rank": 502,
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
      "rank": 503,
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
      "rank": 504,
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
      "rank": 505,
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
      "rank": 506,
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
      "rank": 507,
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
      "rank": 508,
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
      "rank": 509,
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
      "rank": 510,
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
      "rank": 511,
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
      "rank": 512,
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
      "issue": "PAN-3706",
      "rank": 513,
      "size": "L",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Broadsheet theme only swapped the typeface; color, surface, elevation and texture still on Ledger values",
      "rationale": "Body edited since the last pass, but the delta is descriptive detail on the same surface: Broadsheet still ships only the typeface swap while color, surface, elevation, texture and motion stay on Ledger values. No new cross-references, no dependency closed, no condition change — the scope, size and impact are unchanged, so the rank is held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3132",
      "rank": 514,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt the xBRIEF v0.9 agentic dispatch fields end-to-end as a contract rather than a planner habit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3739",
      "rank": 515,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost-reconcile re-warns unknown-model on every sweep for model-less codex subthread rollouts — hundreds of repeating log lines",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 516,
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
      "rank": 517,
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
      "rank": 518,
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
      "rank": 519,
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
      "rank": 520,
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
      "rank": 521,
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
      "rank": 522,
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
      "rank": 523,
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
      "rank": 524,
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
      "rank": 525,
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
      "rank": 526,
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
      "rank": 527,
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
      "rank": 528,
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
      "rank": 529,
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
      "issue": "PAN-3615",
      "rank": 530,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "TTS was silent 9+ days across four stacked failures; three fixed, follow-ups remain",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2355",
      "rank": 531,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [
        "PAN-2352"
      ],
      "why": "Overdeck Anywhere P2: mobile PWA with needs-you feed, conversation view, pipeline board and Web Push",
      "rationale": "Re-sequenced with the rest of the Anywhere phases: the 2026-07-28 update gave every phase a PRD on the state branch and an explicit dependency order, so the phases now rank in build order instead of sitting together as undifferentiated low-priority stubs.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3061",
      "rank": 532,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [
        "PAN-3054"
      ],
      "why": "Dispatch-topology advisor: a mechanical start-versus-swarm recommendation at plan finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 533,
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
      "rank": 534,
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
      "rank": 535,
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
      "rank": 536,
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
      "rank": 537,
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
      "rank": 538,
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
      "rank": 539,
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
      "rank": 540,
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
      "rank": 541,
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
      "rank": 542,
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
      "rank": 543,
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
      "rank": 544,
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
      "rank": 545,
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
      "rank": 546,
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
      "issue": "PAN-3335",
      "rank": 547,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Clicking a pasted conversation image should open it full size instead of rendering a PNG as source text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 548,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "ACP agent setup UI: detect installed CLIs, show auth status and guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 549,
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
      "rank": 550,
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
      "rank": 551,
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
      "rank": 552,
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
      "rank": 553,
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
      "rank": 554,
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
      "issue": "PAN-3499",
      "rank": 555,
      "size": "XS",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan parked ack references a nonexistent ProjectConfig.projectPath; one-line fix owed directly on main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2444",
      "rank": 556,
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
      "rank": 557,
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
      "rank": 558,
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
      "rank": 559,
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
      "rank": 560,
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
      "rank": 561,
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
      "rank": 562,
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
      "rank": 563,
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
      "issue": "PAN-3558",
      "rank": 564,
      "size": "XS",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Subagent rail: show the provider logo and running model on each agent row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3469",
      "rank": 565,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate NewProjectModal to a routed full page under the page-not-modal doctrine",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3131",
      "rank": 566,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-3132"
      ],
      "why": "Support xBRIEF planRef sharding across planning authoring and pipeline-wide consumption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 567,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing-crew templates: ship preset crew configurations selectable from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 568,
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
      "rank": 569,
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
      "rank": 570,
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
      "rank": 571,
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
      "rank": 572,
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
      "rank": 573,
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
      "rank": 574,
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
      "rank": 575,
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
      "rank": 576,
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
      "rank": 577,
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
      "rank": 578,
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
      "rank": 579,
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
      "rank": 580,
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
      "rank": 581,
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
      "rank": 582,
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
      "issue": "PAN-3333",
      "rank": 583,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model pickers show dollars per token, which says nothing about how fast a sibling model drains plan quota",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 584,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: launch one template issue under N configurations and compare cost, time and outcome",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 585,
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
      "rank": 586,
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
      "rank": 587,
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
      "rank": 588,
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
      "rank": 589,
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
      "rank": 590,
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
      "rank": 591,
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
      "rank": 592,
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
      "rank": 593,
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
      "rank": 594,
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
      "rank": 595,
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
      "rank": 596,
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
      "rank": 597,
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
      "rank": 598,
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
      "issue": "PAN-3322",
      "rank": 599,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-3308"
      ],
      "why": "The launcher-generator file-size ceiling sits 126 lines above the file, banking regrowth budget",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3684",
      "rank": 594,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Temporary acceptance issue: spawn a Pi work agent on ollama:gemma4:12b and record evidence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 601,
      "size": "XL",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-2352"
      ],
      "why": "Overdeck Anywhere P3: outbound-only relay service with GitHub OAuth, push origin and a multi-tenant front door",
      "rationale": "Re-sequenced with the rest of the Anywhere phases: the 2026-07-28 update gave every phase a PRD on the state branch and an explicit dependency order, so the phases now rank in build order instead of sitting together as undifferentiated low-priority stubs.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1754",
      "rank": 602,
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
      "rank": 603,
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
      "rank": 604,
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
      "rank": 605,
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
      "rank": 606,
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
      "rank": 607,
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
      "rank": 608,
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
      "rank": 609,
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
      "rank": 610,
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
      "rank": 611,
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
      "rank": 612,
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
      "rank": 613,
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
      "rank": 614,
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
      "rank": 615,
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
      "rank": 616,
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
      "issue": "PAN-3502",
      "rank": 617,
      "size": "XS",
      "importance": "medium",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "tiered-crews blendedCost expectation is stale against the current model-capabilities pricing",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1561",
      "rank": 618,
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
      "rank": 619,
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
      "rank": 620,
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
      "rank": 621,
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
      "rank": 622,
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
      "rank": 623,
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
      "rank": 624,
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
      "rank": 625,
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
      "rank": 626,
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
      "rank": 627,
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
      "rank": 628,
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
      "rank": 629,
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
      "rank": 630,
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
      "rank": 631,
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
      "rank": 632,
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
      "rank": 633,
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
      "issue": "PAN-1151",
      "rank": 634,
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
      "rank": 635,
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
      "rank": 636,
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
      "rank": 637,
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
      "rank": 638,
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
      "rank": 639,
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
      "rank": 640,
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
      "rank": 641,
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
      "rank": 642,
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
      "rank": 643,
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
      "rank": 644,
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
      "rank": 645,
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
      "rank": 646,
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
      "rank": 647,
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
      "rank": 648,
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
      "issue": "PAN-3441",
      "rank": 649,
      "size": "XL",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View River: WebGL pipeline visualization fed by the live hook-event stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2978",
      "rank": 650,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976",
        "PAN-2977"
      ],
      "why": "Auto-install ACP agent CLIs from the setup UI with opt-in per-agent install recipes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 651,
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
      "rank": 652,
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
      "rank": 653,
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
      "rank": 654,
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
      "rank": 655,
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
      "rank": 656,
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
      "rank": 657,
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
      "rank": 658,
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
      "rank": 659,
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
      "rank": 660,
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
      "rank": 661,
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
      "rank": 662,
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
      "rank": 663,
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
      "rank": 664,
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
      "rank": 665,
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
      "rank": 666,
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
      "issue": "PAN-3034",
      "rank": 667,
      "size": "XS",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Command Deck session tree missed strike-only issues; the fix has already landed on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 668,
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
      "rank": 669,
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
      "rank": 670,
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
      "rank": 671,
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
      "rank": 672,
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
      "rank": 673,
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
      "rank": 674,
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
      "rank": 675,
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
      "rank": 676,
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
      "rank": 677,
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
      "rank": 678,
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
      "rank": 679,
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
      "issue": "PAN-3504",
      "rank": 680,
      "size": "XS",
      "importance": "medium",
      "score": 30,
      "condition": "stale",
      "dependsOn": [
        "PAN-3499"
      ],
      "why": "Duplicate report of the parked.ts ProjectConfig.projectPath typecheck break on main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3456",
      "rank": 681,
      "size": "XS",
      "importance": "low",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan swarm treated per-item sequential diagnostics as refusals; already fixed on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3443",
      "rank": 682,
      "size": "XL",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View Spectrum Deck: Winamp-grade WebGL activity visualizer with mockup and reproduction-grade PRD",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 683,
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
      "rank": 684,
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
      "rank": 685,
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
      "rank": 686,
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
      "rank": 687,
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
      "rank": 688,
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
      "rank": 689,
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
      "rank": 690,
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
      "rank": 691,
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
      "rank": 692,
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
      "rank": 693,
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
      "rank": 694,
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
      "issue": "PAN-2628",
      "rank": 695,
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
      "rank": 696,
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
      "rank": 697,
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
      "rank": 698,
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
      "rank": 699,
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
      "rank": 700,
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
      "rank": 701,
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
      "rank": 702,
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
      "rank": 703,
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
      "rank": 704,
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
      "rank": 705,
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
      "rank": 706,
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
      "rank": 707,
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
      "issue": "PAN-3011",
      "rank": 708,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support poolside Laguna S 2.1 locally via Ollama or vLLM and hosted via OpenRouter",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 709,
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
      "rank": 710,
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
      "rank": 711,
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
      "rank": 712,
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
      "rank": 713,
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
      "rank": 714,
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
      "rank": 715,
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
      "rank": 716,
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
      "issue": "PAN-2006",
      "rank": 718,
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
      "rank": 719,
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
      "rank": 720,
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
      "rank": 721,
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
      "rank": 722,
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
      "rank": 723,
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
      "rank": 724,
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
      "rank": 725,
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
      "rank": 726,
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
      "issue": "PAN-2983",
      "rank": 727,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferred capabilities: lease-based concurrent write mode and an LLM semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 728,
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
      "rank": 729,
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
      "rank": 730,
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
      "rank": 731,
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
      "rank": 732,
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
      "rank": 733,
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
      "rank": 734,
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
      "rank": 735,
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
      "rank": 736,
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
      "rank": 737,
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
      "rank": 738,
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
      "rank": 739,
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
      "rank": 740,
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
      "rank": 741,
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
      "rank": 742,
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
      "rank": 743,
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
      "issue": "PAN-3133",
      "rank": 744,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate TRON encoding for prompt-bound xBRIEF payloads against the real spec corpus",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1356",
      "rank": 745,
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
      "rank": 746,
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
      "rank": 747,
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
      "rank": 748,
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
      "rank": 749,
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
      "rank": 750,
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
      "rank": 751,
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
      "rank": 752,
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
      "rank": 753,
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
      "rank": 754,
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
      "rank": 755,
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
      "rank": 756,
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
      "rank": 757,
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
      "rank": 758,
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
      "rank": 759,
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
      "rank": 760,
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
      "rank": 761,
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
      "rank": 762,
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
      "rank": 763,
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
      "rank": 764,
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
      "rank": 765,
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
      "rank": 766,
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
      "rank": 767,
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
      "rank": 768,
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
      "rank": 769,
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
      "rank": 770,
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
      "rank": 771,
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
      "rank": 772,
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
      "rank": 773,
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
      "rank": 774,
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
      "rank": 775,
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
      "rank": 776,
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
      "rank": 777,
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
      "rank": 778,
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
      "rank": 779,
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
      "rank": 780,
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
      "rank": 781,
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
      "rank": 782,
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
      "rank": 783,
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
      "rank": 784,
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
      "rank": 785,
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
      "rank": 786,
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
      "rank": 787,
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
      "rank": 788,
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
      "rank": 789,
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
      "rank": 790,
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
      "rank": 791,
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
      "rank": 792,
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
      "rank": 793,
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
      "rank": 794,
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
      "rank": 795,
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
      "rank": 796,
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
      "rank": 797,
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
      "rank": 798,
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
      "rank": 799,
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
      "rank": 800,
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
      "rank": 801,
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
      "rank": 802,
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
      "rank": 803,
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
      "rank": 804,
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
      "rank": 805,
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
      "rank": 806,
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
      "rank": 807,
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
      "rank": 808,
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
      "rank": 809,
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
      "rank": 810,
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
      "rank": 811,
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
      "rank": 812,
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
      "rank": 813,
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
      "rank": 814,
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
      "rank": 815,
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
      "rank": 816,
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
      "rank": 817,
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
      "rank": 818,
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
      "rank": 819,
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
      "rank": 820,
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
      "rank": 821,
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
      "rank": 822,
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
      "rank": 823,
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
      "rank": 824,
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
      "rank": 825,
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
      "rank": 826,
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
      "rank": 827,
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
      "rank": 828,
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
      "rank": 829,
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
      "rank": 830,
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
      "rank": 831,
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
      "rank": 832,
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
      "rank": 833,
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
      "rank": 834,
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
      "rank": 835,
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
      "rank": 836,
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
      "rank": 837,
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
      "rank": 838,
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
      "rank": 839,
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
      "rank": 840,
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
      "rank": 841,
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
      "rank": 842,
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
      "rank": 843,
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
      "rank": 844,
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
      "rank": 845,
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
      "rank": 846,
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
      "rank": 847,
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
      "rank": 848,
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
      "rank": 849,
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
      "rank": 850,
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
      "rank": 851,
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
      "rank": 852,
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
      "rank": 853,
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
      "rank": 854,
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
      "rank": 855,
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
      "rank": 856,
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
      "rank": 857,
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
      "rank": 858,
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
      "rank": 859,
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
      "rank": 860,
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
      "rank": 861,
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
      "rank": 862,
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
      "rank": 863,
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
      "rank": 864,
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
      "rank": 865,
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
      "rank": 866,
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
      "from": "PAN-3492",
      "to": "PAN-3524",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3250",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3679",
      "to": "PAN-3734",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3561",
      "to": "PAN-3564",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3314",
      "to": "PAN-3539",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3563",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3520",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3492",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3566",
      "to": "PAN-2706",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3708",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3633",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3084",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3047",
      "to": "PAN-2995",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3274",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3651",
      "to": "PAN-3640",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3564",
      "to": "PAN-3565",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3043",
      "to": "PAN-3118",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3104",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3505",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3429",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3244",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3224",
      "to": "PAN-3439",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3631",
      "to": "PAN-3301",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3284",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3270",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3186",
      "to": "PAN-3256",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3032",
      "to": "PAN-3174",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3317",
      "to": "PAN-3306",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3631",
      "to": "PAN-3289",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1824",
      "to": "PAN-3243",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3533",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3344",
      "to": "PAN-2421",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3117",
      "to": "PAN-3121",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3235",
      "to": "PAN-3113",
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
      "from": "PAN-3703",
      "to": "PAN-3705",
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
      "from": "PAN-2976",
      "to": "PAN-2977",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3132",
      "to": "PAN-3131",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3308",
      "to": "PAN-3322",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2352",
      "to": "PAN-2356",
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
      "from": "PAN-3499",
      "to": "PAN-3504",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3743",
      "to": "PAN-3752",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3753",
      "to": "PAN-1641",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3743",
      "to": "PAN-3744",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-3754",
      "to": "PAN-3429",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    }
  ]
}
```
