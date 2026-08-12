# Backlog Sequence

_Last sequenced: 2026-08-12T23:31:44.581Z · model: claude-opus-5 · open: 841_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2746 | XS | critical | ok |  | PAN-2742, PAN-2695 | infra-failure bypass writes reviewStatus='passed' |
| 2 | PAN-2689 | S | critical | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost |
| 3 | PAN-2828 | S | critical | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 4 | PAN-3250 | S | critical | ok |  |  | Workspace spawn branches from local HEAD, so every new feature branch inherits unpushed local main commits |
| 5 | PAN-3285 | M | critical | ok |  |  | Supervisor pinned to a reload generation kills every healthy dashboard and cannot start one — 3.5h outage |
| 6 | PAN-2874 | M | critical | ok |  | PAN-2828 | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli… |
| 7 | PAN-2940 | M | critical | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI |
| 8 | PAN-3283 | S | critical | ok |  |  | Recovering from review_infrastructure_failure sets review_status=passed over an outstanding CHANGES REQUESTED |
| 9 | PAN-2935 | S | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router |
| 10 | PAN-3631 | S | critical | ok |  | PAN-3301 | Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state — prior frozen |
| 11 | PAN-2337 | XS | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 12 | PAN-2758 | S | critical | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 13 | PAN-3085 | XS | critical | ok |  |  | Review feedback written to .overdeck/feedback but agents and the merge gate are pointed at .pan/feedback |
| 14 | PAN-3329 | M | critical | ok |  |  | Deployment generation node_modules and tracked packages/ files deleted mid-build, bricking every pan call |
| 15 | PAN-3498 | S | critical | ok |  |  | write-sequence pins in-pipeline ranks without renumbering, so rank stops being a total order |
| 16 | PAN-2848 | S | critical | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a… |
| 17 | PAN-2846 | S | critical | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 18 | PAN-3078 | S | critical | ok |  |  | Inspect verdict never reaches the work agent, so an agent that waits for it deadlocks forever |
| 19 | PAN-3539 | M | critical | ok |  | PAN-3314 | A kernel OOM of one agent-spawned process killed the whole tmux server; OOMPolicy=stop took every session |
| 20 | PAN-3566 | S | critical | ok |  |  | Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the zombie-test root cause |
| 21 | PAN-2569 | XS | critical | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn |
| 22 | PAN-2567 | S | critical | ok |  |  | reviewed+green PR stuck after review |
| 23 | PAN-2995 | S | critical | ok |  |  | pan done --strike false-blocks after a gh-API squash merge; ancestry test cannot see squashed content |
| 24 | PAN-3057 | M | critical | ok |  |  | Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice |
| 25 | PAN-3282 | M | critical | ok |  |  | Review agents repeatedly die before writing a verdict across five issues and two projects |
| 26 | PAN-3313 | M | critical | ok |  |  | A transient upstream stream error benches CLIProxy's only auth, 503ing ~70% of GPT-routed inference |
| 27 | PAN-3424 | M | critical | ok |  |  | The state plane silently stops being durable: non-FF pushes unreconciled, drafts never staged, 16 orphans |
| 28 | PAN-3492 | M | critical | ok |  | PAN-3344 | Server-side verification retries form a self-amplifying load loop: timeouts cause retries cause timeouts |
| 29 | PAN-3524 | M | critical | ok |  |  | A server-owned --changed verification loop survives freeze, abort, pause and operator-stop |
| 30 | PAN-3532 | S | critical | ok |  |  | CI never runs the full frontend suite, so main stayed red on frontend while every CI run reported green |
| 31 | PAN-3554 | S | critical | ok |  |  | Red main has no mechanical owner; a failed main-push CI run sat five hours with the failure hiding itself |
| 32 | PAN-3561 | S | critical | ok |  |  | An ownerless state-git lock is immortal: a crashed writer bricked a project's write door for 2.5 days |
| 33 | PAN-3630 | S | critical | ok |  | PAN-3629 | pan tell marks messages read without delivering them: three 'delivered' confirmations, zero receipts |
| 34 | PAN-2954 | XS | critical | ok |  |  | postMergeLifecycle refuses GitLab projects |
| 35 | PAN-3062 | M | critical | ok |  |  | Shared primary main worktree means any agent pushing main ships every other session's unpushed commits |
| 36 | PAN-3234 | M | critical | ok |  |  | Agents freeze indefinitely on blocking choice menus and no health surface detects it |
| 37 | PAN-3653 | S | critical | ok |  |  | A cleared red-main blocker leaves a live strike idle and unrecoverable — nothing wakes it when main goes green |
| 38 | PAN-3667 | M | critical | ok |  |  | CLIProxy has no cross-family remap, so every model-pinned subagent dies at spawn in a proxied session |
| 39 | PAN-2259 | S | critical | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota |
| 40 | PAN-3043 | S | critical | ok |  |  | Mid-run provider quota exhaustion undetected: agent holds a slot at status=running for days |
| 41 | PAN-3084 | S | critical | ok |  |  | A spawned-but-never-briefed review session blocks its own replacement; restart 'preserves' the zombie |
| 42 | PAN-3100 | S | critical | ok |  |  | Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false failures |
| 43 | PAN-3168 | S | critical | ok |  |  | DoD row 5 deadlocks close-out: an agent paused FOR close-out counts as running and blocks it |
| 44 | PAN-3188 | S | critical | ok |  |  | DoD row 5 rejects terminal canonical states, so an already-done issue can never close out |
| 45 | PAN-3244 | S | critical | ok |  |  | A queued dashboard deploy defers verification for every project, starving cross-project review handoffs |
| 46 | PAN-3314 | M | critical | ok |  |  | One cgroup holds every agent, so a single hungry agent takes the whole fleet down on OOM |
| 47 | PAN-3520 | S | critical | ok |  | PAN-3344 | Test gate must retry timeout-only failures in isolation; load flakes loop branches on false verdicts |
| 48 | PAN-3560 | M | critical | ok |  |  | PTY supervisor overload under concurrent convoys 502s fleet-wide, killing resumes and feedback delivery |
| 49 | PAN-3564 | M | critical | ok |  | PAN-3561 | Lock convoy: the per-issue record lock is held across the global state-git wait, killing reviewer spawns |
| 50 | PAN-3651 | S | critical | ok |  | PAN-3424 | Re-land the overdeck-state non-FF push retry with the pan-dir state-door suites green |
| 51 | PAN-3662 | S | critical | ok |  |  | Read-only CLI surfaces run schema top-ups and emit SQLITE_READONLY under the sandboxed Flywheel |
| 51 | PAN-3580 | M | high | ok |  |  | UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL |
| 52 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume |
| 53 | PAN-2742 | S | high | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' |
| 54 | PAN-3023 | S | critical | ok |  |  | Post-planning auto-spawn abandons on a transient Docker failure; 'attempt 1/3' never retries |
| 55 | PAN-3103 | S | critical | ok |  |  | A transient merge_status=failed permanently skips close-out; merged issues stay open and get re-planned |
| 56 | PAN-3118 | M | critical | ok |  |  | Model-specific quota exhaustion halts agents invisibly; four planning agents 'running' at $0.00 |
| 57 | PAN-3236 | S | critical | ok |  |  | ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous, so feedback never lands |
| 58 | PAN-3248 | XS | critical | ok |  | PAN-3244 | pan reload never clears pending-deploy.json, so every deploy starves all verification until a patrol runs |
| 59 | PAN-3278 | S | critical | ok |  |  | Work agent finished with an open PR but review was never dispatched; auto-requeue fired none of 25 attempts |
| 60 | PAN-3429 | M | critical | ok |  | PAN-3344 | Memory governor defers admissions but sheds nothing under HARD pressure; the flywheel shed by hand |
| 61 | PAN-3504 | XS | critical | ok |  |  | typecheck fails on main: parked.ts references ProjectConfig.projectPath instead of path |
| 62 | PAN-3541 | S | critical | ok |  |  | Review restart after an unclean reviewer death loops on the session-resume menu forever |
| 63 | PAN-3543 | S | critical | ok |  | PAN-3541 | Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while recommending --fresh |
| 64 | PAN-3563 | S | critical | ok |  | PAN-3560 | A role agent spawned with an undelivered prompt becomes an invisible zombie no recovery verb can see |
| 65 | PAN-3657 | S | critical | ok |  |  | Merge-train queues endpoint silently drops every polyrepo candidate, so MYN and Auricle trains stay empty |
| 66 | PAN-3663 | S | critical | ok |  |  | PR close events never invalidate pipeline membership, so zombie_pr rows stay stale in the canonical read door |
| 67 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch |
| 68 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json |
| 69 | PAN-2733 | S | high | ok |  |  | substrate-bug-poller has never run |
| 70 | PAN-1560 | XS | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 71 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes |
| 72 | PAN-2883 | M | high | ok |  | PAN-2828 | Close-out deploy row fails for every strike-landed issue |
| 73 | PAN-2806 | S | high | ok |  |  | strike merge trigger registry splits across dashboard chunks |
| 74 | PAN-2796 | S | high | ok |  |  | idle nudge must not advance after failed mandatory inspection |
| 75 | PAN-1824 | S | critical | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 76 | PAN-3139 | S | critical | ok |  |  | Agents-table liveness drifts stale in the under-reporting direction; the authoritative plane is the wrong one |
| 77 | PAN-3237 | S | critical | ok |  |  | A capacity-refused planning-to-work handoff is marked terminally stuck; every 409 becomes 'guardrails' |
| 78 | PAN-3274 | S | critical | ok |  |  | A test-role agent can spawn and never run, stranding an approved, CI-green issue behind a missing verdict |
| 79 | PAN-3281 | S | critical | ok |  |  | ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so stuck work reaches UAT |
| 80 | PAN-3496 | S | critical | ok |  |  | Review/inspect agents AskUserQuestion the operator for review depth, converting autonomy into operator work |
| 81 | PAN-3500 | S | critical | ok |  |  | A review sub-role can modify the branch after writing its report, violating its own spawn contract |
| 82 | PAN-3522 | S | critical | ok |  | PAN-3344 | Supervisor watchdog restart-churns under CPU storm because the probe budget ignores the boot warm phase |
| 83 | PAN-3555 | S | critical | ok |  |  | pan start silently spawned a fresh session over a resumable warm session, violating warm-by-default |
| 84 | PAN-3565 | M | critical | ok |  | PAN-3563 | Failed review spawn wedges 'starting', infra failure synthesizes a fake CHANGES REQUESTED verdict |
| 85 | PAN-3571 | S | critical | ok |  |  | Completion-check timeout exits silently — 334 stranded turn-ends leave agents stalled until a patrol notices |
| 86 | PAN-3654 | S | critical | ok |  | PAN-3653 | Compact respawn confirms against the archived session and kills a working fresh agent |
| 87 | PAN-2932 | S | high | ok |  | PAN-2337 | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 88 | PAN-2422 | XS | high | ok |  | PAN-2337 | rebuilding dist under a live server breaks lazy chunk imports |
| 89 | PAN-2699 | XS | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle |
| 90 | PAN-2957 | XS | high | ok |  | PAN-2337 | npm run build intermittently produces stale frontend bundles |
| 91 | PAN-2850 | M | high | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 92 | PAN-2886 | M | high | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 93 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 94 | PAN-2813 | M | high | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 95 | PAN-2747 | S | high | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 96 | PAN-2759 | S | high | ok |  |  | Dead flywheel with an active run was never auto-relaunched after a reboot |
| 97 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target |
| 98 | PAN-2668 | M | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents |
| 99 | PAN-2179 | S | high | ok |  |  | relaunch can leave a zombie agent |
| 100 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS |
| 101 | PAN-2775 | S | high | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04… |
| 102 | PAN-2734 | S | high | ok |  |  | merge queue head-of-line zombie |
| 103 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 104 | PAN-2421 | XS | high | ok |  |  | dashboard server route tests flake under full-suite verification load |
| 105 | PAN-3081 | M | high | ok |  |  | Agent git guard is bypassable by stripping it from $PATH — an agent did so unprompted |
| 106 | PAN-3344 | M | high | ok |  |  | Resource governor gates dispatch on memory alone; agent-shell test runs drove load 48 on 24 cores |
| 107 | PAN-3517 | M | high | ok |  |  | Convoy forks still miss the parent prompt cache: launch-injection byte drift plus resume dropping the header |
| 108 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery |
| 109 | PAN-2888 | M | high | ok |  | PAN-2846 | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO… |
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
| 122 | PAN-2880 | M | high | ok |  | PAN-2259 | Linear tracker listIssues is a 3N+1 request storm |
| 123 | PAN-2966 | S | high | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev |
| 124 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 125 | PAN-2680 | M | high | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 126 | PAN-2971 | M | high | ok |  |  | flywheel orchestrator finalized its own run yet kept ticking; zombie session with dashboard Pause/Stop disabled |
| 127 | PAN-3022 | S | high | ok |  |  | Work-spawn route ignores the per-issue workModel override, then clobbers the record with the role default |
| 128 | PAN-3044 | S | high | ok |  |  | Review feedback delivery runs against CLOSED issues, resurrecting agents and raising needs-you days later |
| 129 | PAN-3104 | S | high | ok |  | PAN-3100 | Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix landed |
| 130 | PAN-3257 | S | high | ok |  |  | Crash-resume never re-wires the PTY supervisor; a stale socket refuses every delivery |
| 131 | PAN-3289 | S | high | ok |  |  | Sequencer ran a full pass on an empty manifest against a 750-issue backlog — read model transiently empty |
| 132 | PAN-3397 | S | high | ok |  |  | Freshly-spawned convoy lanes freeze at 0 output; the existing detector covers warm resumes only |
| 133 | PAN-3454 | M | high | ok |  | PAN-3517 | Cost hook re-ingests fork-copied parent history under reviewer identity: fake warnings, multi-billed spend |
| 134 | PAN-3499 | XS | high | ok |  | PAN-3504 | pan parked ack references a nonexistent ProjectConfig.projectPath — a typecheck error on main |
| 135 | PAN-3505 | S | high | ok |  | PAN-3062 | Unpushed agent code commits on the primary main worktree block the flywheel's state write door |
| 136 | PAN-3535 | S | high | ok |  |  | The drain/resume boot gate is caller-env-dependent, so any restart from a clean shell silently drops the hold |
| 137 | PAN-3556 | S | high | ok |  | PAN-3555 | Concurrent double-spawn race allocated two fresh session identities three seconds apart |
| 138 | PAN-3557 | S | high | ok |  |  | Post-merge label application has no retry, so a rate-limited 403 hides the issue from the verify-on-main sweep |
| 140 | PAN-3621 | S | high | ok |  |  | pan start intermittently resolves a chunk graph spliced across two builds and dies at spawn |
| 141 | PAN-3650 | S | high | ok |  |  | Strike self-abort leaves state.json 'running', so the deacon resurrects aborted strikes on every pass |
| 142 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover |
| 143 | PAN-2324 | XS | high | ok |  |  | label transition fails atomically on missing 'in-planning' label |
| 144 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans… |
| 145 | PAN-2905 | S | high | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s |
| 146 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 147 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 148 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH |
| 149 | PAN-2656 | S | high | ok |  |  | deacon-swarm unit tests read live ~/.overdeck/config.yaml |
| 150 | PAN-2075 | XL | high | ok | ✓ |  | Boot Reconciliation + Operator Inbox |
| 151 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) |
| 152 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 153 | PAN-2079 | M | high | ok |  | PAN-2077 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 154 | PAN-2080 | M | high | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) |
| 155 | PAN-1775 | M | high | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 156 | PAN-454 | XS | high | ok |  | PAN-2077 | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 157 | PAN-1436 | S | high | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 158 | PAN-1711 | S | high | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 159 | PAN-3015 | L | high | ok |  |  | pan monitor: pull-based mail-queue inbox replaces keystroke injection, the top delivery-failure source |
| 160 | PAN-3048 | S | high | ok |  |  | Pipeline auto-commit lands Overdeck PRD drafts inside product feature branches; exclusion lists drifted |
| 161 | PAN-3096 | S | high | ok |  |  | pan done fails on generated devcontainer artifacts; agents infer deletion of workspace infrastructure |
| 162 | PAN-3106 | S | high | ok |  |  | auto_merge_default: hold is bypassed — shouldHoldForUat is consulted on only one merge path |
| 163 | PAN-3174 | M | high | ok |  | PAN-3032 | Every polyrepo UAT stack is unreachable: stale project prefix, unattached devnet, wrong frontend port |
| 164 | PAN-3205 | S | high | ok |  |  | Deployment gate queues a deferred deploy but the promised next-verification-boundary trigger does not exist |
| 165 | PAN-3224 | S | high | ok |  |  | A crash-interrupted spawn strands model 'pending-work-spawn'; plain pan start then dies with Unknown model |
| 166 | PAN-3243 | XS | high | ok |  |  | auto-commit test polls 20 setImmediate turns for a real git subprocess, reddening main |
| 167 | PAN-3280 | S | high | ok |  |  | One issue's agent sessions vanished four times in a run and its reviewer died writing no artifact |
| 168 | PAN-3284 | S | high | ok |  |  | A work agent wrote a doc edit into the primary main worktree instead of its workspace |
| 170 | PAN-3432 | S | high | ok |  | PAN-3429 | Preemptive yield fan-out paused seven work agents to make room for one review convoy |
| 171 | PAN-3569 | S | high | ok |  |  | Deploy gate deadlocks on a stale pending-post-merge.json when the deacon is paused; no staleness rule, no exit |
| 172 | PAN-3605 | XS | high | ok |  |  | lint-effect-diagnostics executed a squatted npm package through an npx registry fallback |
| 173 | PAN-3617 | S | high | ok |  |  | One issue's strike dies instantly on every dispatch with zero output while siblings spawn normally |
| 174 | PAN-3629 | M | high | ok |  |  | No sanctioned door to re-scope a live agent, so operator scope changes force a doctrine violation |
| 175 | PAN-3633 | S | high | ok |  | PAN-3325 | Strike workspaces spawn with an incomplete dependency tree, so agents abort on a false 'main is red' |
| 176 | PAN-3668 | L | high | ok |  |  | Add Prime Agent as a managed harness (in flight — RPC runtime adapter, discovery, transcripts) |
| 177 | PAN-2642 | XL | high | ok | ✓ |  | Cost strategy: waste detection over budget policing |
| 178 | PAN-1868 | XS | high | ok |  | PAN-2466 | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 179 | PAN-2466 | S | high | ok |  |  | close-out/record writer clobbers closeOut.usage with EMPTY data |
| 180 | PAN-1042 | S | high | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 181 | PAN-570 | XS | high | ok |  | PAN-2642 | Show PLAN badge on costs when under a subscription/plan |
| 182 | PAN-106 | M | high | stale |  |  | Cost prediction/estimation for in-progress work |
| 183 | PAN-2059 | XL | high | ok | ✓ |  | Backlog pickup gate |
| 184 | PAN-2376 | XL | high | ok | ✓ |  | Epic: CI/CD reliability |
| 185 | PAN-1556 | S | high | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 186 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 187 | PAN-2189 | L | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) |
| 188 | PAN-2190 | L | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) |
| 189 | PAN-2233 | L | high | ok |  |  | decompose merge-agent.ts (1,414 lines) into focused modules |
| 190 | PAN-2526 | M | high | ok |  |  | Refactor deacon.ts below file-size baseline |
| 191 | PAN-2008 | XS | high | ok |  | PAN-1936 | store-access guard |
| 192 | PAN-1936 | M | high | ok |  |  | Single source-of-truth reads |
| 193 | PAN-1988 | M | high | ok |  | PAN-1936 | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 194 | PAN-1910 | XS | high | ok |  | PAN-1936 | fast-follow(PAN-1908): collapse issue status to ONE canonical field |
| 195 | PAN-3040 | M | high | ok |  |  | pan strike fails outright on polyrepo projects — worktree logic assumes a monorepo root |
| 196 | PAN-3050 | S | high | ok |  |  | Idle-stack reaper regex only matches Overdeck containers, so foreign workspace stacks are never reaped |
| 197 | PAN-3120 | S | high | ok |  |  | MERGE refuses or dead-ends when the preemptive scheduler yielded the work agent |
| 198 | PAN-3171 | S | high | ok |  |  | Pipeline reports 'merge failed' after a successful merge; issue stays Todo while the commit is on main |
| 199 | PAN-3261 | S | high | ok |  |  | Resume-gate Enter: the tmux fallback answers a live choice menu that its own paste hid from the detector |
| 200 | PAN-3267 | S | high | ok |  |  | GitLab merged-head oracle fans out one glab subprocess per repo x head, failing every membership refresh |
| 201 | PAN-3297 | S | high | ok |  |  | pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart |
| 202 | PAN-3306 | S | high | ok |  | PAN-3317 | A strike needing a rebase has no working path: prompt instructs it, guard blocks it, sync-main misresolves |
| 203 | PAN-3317 | S | high | ok |  |  | Strike agents have no sanctioned way to sync main: rebase is guard-blocked, sync-main misresolves -strike |
| 204 | PAN-3439 | XS | high | ok |  | PAN-3224 | pan start crashes on a pending-work-spawn placeholder row; resume has the guard, start does not |
| 205 | PAN-3460 | S | high | ok |  | PAN-3344 | Per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive |
| 206 | PAN-3533 | M | high | ok |  | PAN-3344 | Per-project isolation classes so one project's heavy stacks cannot starve another project's pipeline |
| 207 | PAN-3622 | XS | high | ok |  |  | A reconciler test asserts on a real issue and reads live GitHub, so pan release check fails on a green main |
| 208 | PAN-3640 | S | high | ok |  | PAN-3561 | Agent GC preserves terminal rows after a recoverable state push race, leaving stale records on closed issues |
| 209 | PAN-1325 | M | high | ok |  |  | Artifact storage model is unsafe for polyrepo projects |
| 210 | PAN-1728 | S | high | ok |  |  | PAN-1700 agent committed .pan/specs/*.vbrief.json mutations |
| 211 | PAN-2651 | S | high | ok |  |  | simplify lifecycle reconciliation and add a safe post-planning reset |
| 212 | PAN-2678 | M | high | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 213 | PAN-2241 | S | high | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 214 | PAN-2242 | S | high | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 215 | PAN-2240 | S | high | ok |  |  | pan tell contradicts itself on dead ohmypi sessions |
| 216 | PAN-2243 | S | high | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 217 | PAN-2244 | S | high | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main |
| 218 | PAN-2202 | S | high | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion |
| 219 | PAN-2195 | M | high | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 220 | PAN-2237 | S | high | ok |  |  | pan plan done swallows vbrief quality lint details |
| 221 | PAN-2487 | M | high | ok |  |  | CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 222 | PAN-2469 | M | high | ok |  |  | issue-level assembly owner |
| 223 | PAN-2212 | M | high | ok |  |  | Swarm slot dispatch has no reserved budget |
| 224 | PAN-2213 | M | high | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 225 | PAN-2211 | M | high | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 226 | PAN-2210 | M | high | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 227 | PAN-2980 | XS | high | ok |  |  | pre-push size guard reads the dirty worktree, so one session's edits block every other session's push |
| 228 | PAN-3047 | S | high | ok |  |  | Strike-branch teardown never fires; 96 strike/* branches preserved because ancestry misses squash merges |
| 229 | PAN-3099 | XS | high | ok |  |  | pan restart --health-timeout 120 parsed as 120ms; false-failed check leaves the dashboard down |
| 230 | PAN-3113 | M | high | ok |  |  | Surface agent-pane choice prompts as inline decision cards so blocking menus are answerable from the feed |
| 231 | PAN-3129 | M | high | ok |  |  | Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths |
| 232 | PAN-3186 | S | high | ok |  |  | One non-git configured member blanks pipeline membership for the whole auricle project |
| 233 | PAN-3190 | XS | high | ok |  |  | pan merge cancel is 100% broken: Commander passes its options object into the fetchImpl slot |
| 234 | PAN-3256 | S | high | ok |  | PAN-3267 | MYN pipeline membership fails forge_unavailable: glab runs in a polyrepo root that is not a git repo |
| 235 | PAN-3270 | S | high | ok |  | PAN-3325 | New workspaces have empty node_modules and bun is off PATH, so the documented remedy fails |
| 236 | PAN-3301 | S | high | ok |  |  | Backlog manifest still writes legacy .pan, and the stray-writer patrol logs 68k lines hiding the real defect |
| 237 | PAN-3325 | S | high | ok |  |  | A fresh workspace ships an empty node_modules, so tooling silently resolves deps from the parent repo |
| 238 | PAN-3463 | S | high | ok |  | PAN-3460 | A legitimate no-op slot outcome can never pass its item verify, so the slot wedges permanently |
| 239 | PAN-3513 | L | high | ok |  |  | Agent runtime plane on overdeck-state: durable session pointers, GC as cache eviction |
| 240 | PAN-3553 | S | high | ok |  |  | Census treats a zero-session tmux server as unavailable, so conversations sit on 'Starting…' after a drain boot |
| 241 | PAN-3596 | S | high | ok |  |  | Deacon patrol has no per-step timing, so overruns of the central scheduler cannot be attributed |
| 242 | PAN-2201 | XS | high | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo |
| 243 | PAN-2718 | M | high | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag |
| 244 | PAN-2646 | XS | high | ok |  |  | configurable global/project/issue policy UI with default OFF |
| 245 | PAN-2652 | M | high | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso… |
| 246 | PAN-2667 | M | high | ok |  |  | Reimplement the task-progress admission signal in resource discovery |
| 247 | PAN-2755 | S | high | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 248 | PAN-2754 | S | high | ok |  |  | `always` is inert |
| 249 | PAN-2809 | M | high | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 250 | PAN-2810 | M | high | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 251 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate |
| 252 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 253 | PAN-1710 | S | high | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 |
| 254 | PAN-1720 | S | high | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation |
| 255 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 256 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 257 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** |
| 258 | PAN-1767 | M | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 259 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes |
| 260 | PAN-3003 | XS | high | ok |  |  | Generated launcher.sh omits OVERDECK_AGENT_ID, so any manual re-launch dies instantly |
| 261 | PAN-3014 | XS | high | ok |  |  | Background title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209 |
| 262 | PAN-3077 | XS | high | ok |  |  | Inspect/review-supervisor spawns omit --effort and inherit xhigh, once per xBRIEF item |
| 263 | PAN-3107 | M | high | ok |  |  | Productize the memory-attribution census so OOM spikes are attributable after the fact |
| 264 | PAN-3167 | S | high | ok |  |  | krux and lexerra permanently unreadable through the membership door; a 404 typed as forge_unavailable |
| 265 | PAN-3179 | M | high | ok |  | PAN-3176 | A UAT promote is marked complete at merge time; nothing verifies the change reached production |
| 266 | PAN-3185 | S | high | ok |  |  | pan start reports a false hard failure when the deacon wins a spawn race (duplicate-session TOCTOU) |
| 267 | PAN-3218 | M | high | ok |  |  | No release-drift signal: a user-facing fix sits on main for hours while every published version stays broken |
| 268 | PAN-3245 | XS | high | ok |  |  | pan done falsely flags the workspace .pan/drafts artifact as uncommitted despite its own exclusion |
| 269 | PAN-3303 | S | high | ok |  |  | Command Deck latches 'Unknown project' after reconnect; an empty registered-projects response is authoritative |
| 270 | PAN-3420 | M | high | ok |  |  | Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe) |
| 270 | PAN-3308 | XS | high | ok |  |  | The file-size guard hands agents a paste-ready ratchet-up line; two of three agents raised the ceiling |
| 271 | PAN-3355 | XS | high | ok |  |  | tmux sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is unknown |
| 272 | PAN-3508 | S | high | ok |  |  | pan reload temporarily removes the global pan CLI when invoked outside its linked generation |
| 273 | PAN-3518 | M | high | ok |  | PAN-3517 | TTL-aware re-review payload policy: fresh-spawn-with-digest for cold, large histories |
| 274 | PAN-3570 | S | high | ok |  | PAN-3325 | Devcontainer leaves root-owned node_modules subtrees; init EACCES blocks pan start and rebuild cannot heal it |
| 275 | PAN-3615 | M | high | ok |  |  | TTS silent for nine days behind four stacked failures; three fixed, follow-ups owed |
| 276 | PAN-3652 | XS | high | ok |  |  | Add workflow_dispatch to ci.yml and state-plane-branches.yml so an unverified main tip can be verified |
| 277 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 278 | PAN-2266 | M | high | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 279 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 280 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks |
| 281 | PAN-687 | M | high | ok |  |  | Support OpenCode as alternative coding agent |
| 282 | PAN-466 | M | high | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 283 | PAN-465 | M | high | ok |  |  | Add OpenRouter as a model provider |
| 284 | PAN-463 | M | high | ok |  |  | Add Qwen 3.6+ model support |
| 285 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 286 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 287 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 288 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier |
| 289 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 290 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 291 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 292 | PAN-1254 | L | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 293 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 294 | PAN-3012 | M | high | ok |  |  | Archived transcripts die when the harness deletes the JSONL; back them up into Overdeck storage first |
| 295 | PAN-3032 | M | high | ok |  |  | Stack rebuild composes an overdeck- prefix while Traefik labels reference myn- devnet; 504s and lost attaches |
| 296 | PAN-3094 | XS | high | ok |  |  | pan done merge fallback force-pushes a fast-forward branch and leaves the command partially complete |
| 297 | PAN-3176 | S | high | ok |  |  | UAT batch promotion takes no stack-health evidence, so a degraded or still-starting stack can be promoted |
| 298 | PAN-3196 | S | high | ok |  |  | Close-out dies on EACCES against root-owned container residue after passing every DoD row |
| 299 | PAN-3210 | S | high | ok |  | PAN-3196 | Close-out blocked by an unprefixed devcontainer init container; teardown and guard scope differently |
| 300 | PAN-3295 | M | high | ok |  |  | Single per-machine completion-check summarizer with a queue and first-class observability |
| 301 | PAN-3332 | S | high | ok |  | PAN-3329 | Dashboard slash-command activities leave 'running in background' standing after the spawn already died |
| 302 | PAN-3464 | XS | high | ok |  |  | pan swarm reset never clears slotCompletions, so a stale marker re-arms the exact wedge reset should escape |
| 303 | PAN-3502 | XS | high | ok |  |  | tiered-crews blendedCost expectation is stale against current model-capabilities pricing; fails on main |
| 304 | PAN-3510 | S | high | ok |  |  | Stopped agents leave detached docker-run test containers alive for hours, contending with other gates |
| 305 | PAN-3527 | XS | high | ok |  |  | Sidebar project list never retries, so one failed boot fetch leaves CONVERSATIONS 0 / ISSUES 0 |
| 306 | PAN-3536 | S | high | ok |  |  | pan tell cannot reach ohmypi conversations: expectedHarness defaults to claude-code with no state.json |
| 307 | PAN-3579 | S | high | ok |  |  | ~20 frontend mutation fetches hand-write JSON headers and 403 on CSRF-guarded routes |
| 308 | PAN-3634 | XS | high | ok |  |  | Planning auto-handoff stamps the ambient flywheelRunId on operator-started agents, stripping reaping exemption |
| 309 | PAN-3661 | XS | high | ok |  |  | issueActions review-mode tests fail locally: the semantic-rejection toast never fires since the secure-dispatch change |
| 310 | PAN-1915 | M | high | ok |  |  | enhancement(security): API key at-rest hardening |
| 311 | PAN-1435 | XS | high | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 312 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 313 | PAN-1640 | M | high | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 314 | PAN-2351 | XS | high | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 315 | PAN-2350 | L | high | ok | ✓ |  | Epic: Overdeck Anywhere |
| 316 | PAN-1217 | XS | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 317 | PAN-1218 | M | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 318 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 319 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 320 | PAN-1451 | M | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 321 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 322 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit |
| 323 | PAN-1553 | M | high | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 324 | PAN-1504 | M | high | ok |  |  | pan hygiene |
| 325 | PAN-1480 | L | high | ok |  |  | TLDR: 93% bypass rate |
| 326 | PAN-1479 | M | high | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 327 | PAN-2950 | L | high | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 328 | PAN-3046 | XS | high | ok |  |  | pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out |
| 329 | PAN-3108 | XS | high | ok |  |  | dashboard.log grows unbounded (867MB) with no rotation, making incident logs un-greppable |
| 330 | PAN-3211 | M | high | ok |  |  | No honest disposition for closed-without-landing issues; residue rows neither closeable nor reapable |
| 331 | PAN-3276 | S | high | ok |  |  | Needs-you rows for terminal questions and permission prompts do not navigate anywhere on click |
| 332 | PAN-3456 | XS | high | ok |  |  | pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates |
| 333 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 334 | PAN-2836 | M | high | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 335 | PAN-2830 | M | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in |
| 336 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve |
| 337 | PAN-2650 | L | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it |
| 338 | PAN-2549 | M | high | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 339 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 340 | PAN-2334 | XS | high | ok |  |  | write a Definition of Ready (DoR) |
| 341 | PAN-2308 | M | high | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal… |
| 342 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree |
| 343 | PAN-1984 | XS | high | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 344 | PAN-1913 | XS | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 345 | PAN-1906 | M | high | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 346 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 347 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 348 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 349 | PAN-807 | L | high | ok |  |  | Epic C: Workspace state sanity on spawn |
| 350 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 351 | PAN-3013 | S | high | ok |  |  | Role-scoped MCP auth hooks leak into durable ~/.claude/settings.json pointing at dead /tmp paths |
| 352 | PAN-3321 | XS | high | ok |  |  | Escalation text and CLAUDE.md tell operators to run `pan unstick`, a command that does not exist |
| 353 | PAN-471 | M | high | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 354 | PAN-438 | M | high | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 355 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 356 | PAN-176 | M | high | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 357 | PAN-578 | M | high | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 358 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline Throughput Hardening |
| 359 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 360 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep |
| 361 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 362 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run |
| 363 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 364 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik… |
| 365 | PAN-2739 | S | medium | ok |  |  | first-completion detection throws every patrol cycle |
| 366 | PAN-2738 | S | medium | ok |  |  | strikes deadlock |
| 367 | PAN-2717 | S | medium | ok |  |  | conversation permission waits missing from Awareness; strengthen alert pulse |
| 368 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 369 | PAN-2696 | XS | medium | ok |  |  | Task views still speak beads vocabulary |
| 370 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) |
| 371 | PAN-2686 | XS | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 372 | PAN-3175 | M | medium | ok |  |  | Merge-train ordering has no semantic dependency concept — file overlap cannot see feature ordering |
| 373 | PAN-3235 | M | medium | ok |  |  | Dashboard decision card renders and answers agent pane-choice menus (follow-up to PAN-3228) |
| 374 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 375 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck |
| 376 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 377 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 378 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 379 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 380 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations |
| 381 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 382 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 383 | PAN-2560 | M | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key |
| 384 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL |
| 385 | PAN-2550 | XS | medium | ok |  |  | npm test exits 0 despite root-suite failures |
| 386 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds |
| 387 | PAN-2546 | S | medium | ok |  |  | pan tell is codex-conversation-unaware |
| 388 | PAN-2506 | M | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 389 | PAN-3130 | S | medium | ok |  | PAN-3129 | Security: path-escape validation for identifier-joined write paths |
| 390 | PAN-3137 | XS | medium | ok |  |  | UAT generation member titles come from Flywheel status prose instead of the issue title |
| 391 | PAN-3455 | XS | medium | ok |  |  | isCliproxyUpToDate always returns false, so every ensure re-downloads the pinned release |
| 392 | PAN-3516 | XS | medium | ok |  |  | Stale bundled-skill duplicates in the repo .claude/skills serve outdated text to overdeck-dev sessions |
| 393 | PAN-2501 | S | medium | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 394 | PAN-2492 | S | medium | ok |  |  | pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard |
| 395 | PAN-2491 | M | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 396 | PAN-2489 | S | medium | ok |  |  | strike agents are invisible in the project issue tree |
| 397 | PAN-2484 | S | medium | ok |  |  | ready set misses merge-eligible issues without flywheel merge verbs |
| 398 | PAN-2465 | S | medium | ok |  |  | pan done's PR lookup fails at MYN polyrepo root |
| 399 | PAN-2454 | S | medium | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero |
| 400 | PAN-2428 | XS | medium | ok |  |  | MYN workspace Traefik routing broken post-rebrand |
| 401 | PAN-2423 | XS | medium | ok |  |  | pan workspace rebuild hardcodes 'overdeck-' compose project prefix |
| 402 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen |
| 403 | PAN-2414 | S | medium | ok |  |  | context-overflow recovery is inconsistent |
| 404 | PAN-2408 | S | medium | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree |
| 405 | PAN-2395 | S | medium | ok |  |  | one invalid tiered_execution enum poisons every config read |
| 406 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream |
| 407 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice |
| 408 | PAN-2976 | L | medium | ok |  |  | Generalize ACP harness to any ACP-capable CLI with a capability gate and custom-agent config |
| 409 | PAN-3034 | S | medium | ok |  |  | Command Deck session tree misses strike-only and workspace-less issues |
| 410 | PAN-3117 | S | medium | ok |  |  | Failed-send bubble hides a deterministic 4xx reason and offers a Retry that can never succeed |
| 411 | PAN-3164 | S | medium | ok |  |  | UAT stack offers 'Open UAT frontend' while still booting, so the operator gets a Gateway Timeout |
| 412 | PAN-3178 | L | medium | ok |  |  | First-class worktrees and diffs: +/- badge, dedicated Changes surface, conversation worktrees |
| 413 | PAN-3288 | XS | medium | ok |  |  | Dev-checkout preflight: detect stale node_modules after a pull instead of ERR_MODULE_NOT_FOUND |
| 414 | PAN-3322 | XS | medium | ok |  | PAN-3308 | launcher-generator allowlist sits 126 lines above reality, turning a temporary raise into regrowth budget |
| 415 | PAN-3445 | XS | medium | ok |  |  | Project config TCP lock hashes into the ephemeral client-port range, so uncontended writes fail |
| 416 | PAN-3540 | S | medium | ok |  | PAN-3530 | God View shows phantom agent orbs, a dead Hook Bus panel and a pressure-blind swap header |
| 417 | PAN-3627 | XS | medium | ok |  |  | backlog-auto-trigger throws on startup in a directory with no backlog, breaking a plain npx run |
| 418 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed |
| 419 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) |
| 420 | PAN-2186 | S | medium | ok |  |  | post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 421 | PAN-2069 | XS | medium | ok |  |  | caveman: follow-up gaps |
| 422 | PAN-1918 | XS | medium | ok |  |  | full frontend vitest suite runs in no CI path |
| 423 | PAN-1912 | XS | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 424 | PAN-1846 | S | medium | ok |  |  | unbounded log growth |
| 425 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY |
| 426 | PAN-1828 | S | medium | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness |
| 427 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry |
| 428 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main |
| 429 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 430 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil… |
| 431 | PAN-1761 | S | medium | ok |  |  | conversations endpoints fetched via relative /api path |
| 432 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 433 | PAN-2982 | S | medium | ok |  |  | Review convoy never runs a skill's own selftest when sync-sources/skills/** changes |
| 434 | PAN-3121 | S | medium | ok |  | PAN-3117 | Failed-send outbox never reconciles against the transcript, leaving a doomed Retry twin |
| 435 | PAN-3181 | L | medium | ok |  |  | Own agent memories in Overdeck: per-repo overdeck-memory orphan branch mirroring overdeck-state |
| 436 | PAN-3307 | XS | medium | ok |  |  | commitlint scope-enum is stale, warning on most real commits and training everyone to ignore it |
| 437 | PAN-3530 | S | medium | ok |  |  | God View polls on 30s timers in four components, violating its documented event-driven contract |
| 438 | PAN-1740 | XS | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 439 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace |
| 440 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 441 | PAN-1669 | S | medium | ok |  |  | restart-with-model doesn't emit a live event |
| 442 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness |
| 443 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr… |
| 444 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted |
| 445 | PAN-3036 | S | medium | ok |  |  | False '! INPUT' chip on completed strike agents; pane-idle heuristic misreads idle as a question |
| 446 | PAN-3090 | M | medium | ok |  |  | Simple issue page: narrative feed, surfaced pending question, honest blocked state |
| 447 | PAN-1572 | M | medium | ok |  |  | Settings permission-mode can desync from resolved config |
| 448 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted |
| 449 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 450 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 451 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 452 | PAN-1449 | S | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 453 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 454 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 455 | PAN-3131 | L | medium | ok |  |  | xBRIEF planRef sharding: planning-side authoring plus pipeline-wide consumption for huge plans |
| 456 | PAN-3616 | XS | medium | ok |  |  | Planned deploy restarts show the generic Reconnecting banner; use the lifecycle signal for calm copy |
| 457 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 458 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 459 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 460 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 461 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 462 | PAN-1392 | S | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 463 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots |
| 464 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions |
| 465 | PAN-1245 | M | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 466 | PAN-1244 | M | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 467 | PAN-1240 | S | medium | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 468 | PAN-1227 | S | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work |
| 469 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign |
| 470 | PAN-1173 | S | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 471 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders |
| 472 | PAN-3016 | M | medium | ok |  |  | URL-address every view so refresh, bookmark and share return to the same spot |
| 473 | PAN-3290 | XS | medium | ok |  |  | xBRIEF items can carry empty metadata.traces, so docs items are invisible to requirement traceability |
| 474 | PAN-1150 | S | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 475 | PAN-1149 | S | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 476 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 477 | PAN-1129 | S | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 478 | PAN-1128 | S | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 479 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 480 | PAN-1068 | S | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 481 | PAN-1027 | S | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 482 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 483 | PAN-932 | S | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 484 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 485 | PAN-900 | S | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 486 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 487 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 488 | PAN-727 | M | medium | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 489 | PAN-681 | S | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 490 | PAN-2977 | M | medium | ok |  | PAN-2976 | ACP setup UI: detect installed CLIs, show auth status, guide login from Settings |
| 491 | PAN-3054 | L | medium | ok |  |  | Benchmark matrix: run one template issue under N configurations and compare cost, time and outcome |
| 492 | PAN-3132 | M | medium | ok |  |  | Adopt xBRIEF v0.9 agentic dispatch fields end-to-end so per-item routing is a contract |
| 493 | PAN-3354 | XS | medium | ok |  |  | Archiving the main workspace hides the singleton row with no dashboard recovery path |
| 494 | PAN-538 | S | medium | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 495 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection |
| 496 | PAN-324 | XS | medium | stale |  |  | Agent detail pane missing Merge/Approve button |
| 497 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 498 | PAN-247 | S | medium | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 499 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 500 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 501 | PAN-178 | M | medium | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 502 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 503 | PAN-49 | XS | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 504 | PAN-1951 | M | medium | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 505 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 506 | PAN-1041 | M | medium | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 507 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 508 | PAN-2981 | S | medium | ok |  |  | Ctrl-K palette opens deleted sessions: search index never prunes, 404 on click |
| 509 | PAN-3157 | XS | medium | ok |  |  | Awareness feed renders the Flywheel as a generic empty chat row instead of run activity |
| 510 | PAN-3333 | M | medium | ok |  |  | Model pickers show $/1M, which answers the wrong question under a subscription; show relative plan drain |
| 511 | PAN-863 | M | medium | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 512 | PAN-817 | M | medium | ok |  |  | Improve planning dialog layout and content fit |
| 513 | PAN-802 | M | medium | ok |  |  | Resume on conversation session forks instead of resuming |
| 514 | PAN-713 | M | medium | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 515 | PAN-700 | M | medium | ok |  |  | Detachable terminal for conversation view |
| 516 | PAN-646 | XS | medium | ok |  |  | Canceled issues: add guided Recover workflow |
| 517 | PAN-532 | M | medium | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 518 | PAN-2896 | M | medium | ok |  |  | Warm resource-discovery and membership caches at boot |
| 519 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 520 | PAN-2626 | M | medium | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 521 | PAN-2625 | XS | medium | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 522 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 523 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations |
| 524 | PAN-2582 | M | medium | ok |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 525 | PAN-2566 | L | medium | ok | ✓ |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 526 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 527 | PAN-3017 | S | medium | ok |  |  | Issue-page UAT panel drops the overflow action menu, so a healthy stack has no restart control |
| 528 | PAN-3441 | L | medium | ok |  |  | God View 'River': WebGL pipeline visualization fed by the live hook-event stream |
| 529 | PAN-3469 | S | medium | ok |  |  | Migrate NewProjectModal to a full page under the page-not-modal doctrine |
| 530 | PAN-2558 | L | medium | ok |  |  | support polyrepo projects |
| 531 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action |
| 532 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility |
| 533 | PAN-2548 | XS | medium | ok |  |  | close the PAN-2541 legacy-fallback deprecation window |
| 534 | PAN-2521 | S | medium | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 535 | PAN-2493 | M | medium | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 536 | PAN-2444 | L | medium | ok |  |  | optional SageOx re-integration |
| 537 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv |
| 538 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane |
| 539 | PAN-2409 | M | medium | ok |  |  | enforce the workspace boundary |
| 540 | PAN-2399 | M | medium | ok |  |  | wire replay_threshold/compaction_reroute into the slot-recovery respawn seam |
| 541 | PAN-2392 | M | medium | ok |  |  | Standing Crew cost panel |
| 542 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues |
| 543 | PAN-2295 | L | medium | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 544 | PAN-3058 | M | medium | ok |  | PAN-3054 | Standing-crew templates: shipped preset crew configurations selectable from Settings |
| 545 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call |
| 546 | PAN-2065 | M | medium | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 547 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 548 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 549 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 550 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 551 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 552 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 553 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 554 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 555 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 556 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 557 | PAN-2024 | XS | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 558 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 559 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 560 | PAN-3011 | M | medium | ok |  |  | Support poolside Laguna S 2.1 (118B MoE, 1M ctx) local and hosted |
| 561 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 562 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 563 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 564 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 565 | PAN-1937 | M | medium | ok |  |  | feat: data export |
| 566 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 567 | PAN-1916 | M | medium | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 568 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 569 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 570 | PAN-1852 | XS | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 571 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 572 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' |
| 573 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 574 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 575 | PAN-2978 | M | medium | ok |  | PAN-2976, PAN-2977 | Opt-in auto-install of ACP agent CLIs from the setup UI |
| 576 | PAN-3061 | M | medium | ok |  | PAN-3054 | Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan finalize |
| 577 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 578 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 579 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent |
| 580 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 581 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 582 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate |
| 583 | PAN-1685 | XS | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 584 | PAN-1676 | M | medium | ok |  |  | harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 585 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 586 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 587 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 588 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 589 | PAN-1654 | XS | medium | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 590 | PAN-1653 | XS | medium | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 591 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 592 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 593 | PAN-1550 | M | medium | ok |  |  | feat: FilesPane + BrowserPane |
| 594 | PAN-1545 | XS | medium | ok |  |  | New Terminal button |
| 595 | PAN-1542 | XS | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 596 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 597 | PAN-1497 | M | medium | ok |  |  | emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 598 | PAN-1490 | M | medium | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 599 | PAN-1489 | M | medium | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 600 | PAN-1485 | M | medium | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 601 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 602 | PAN-1443 | M | medium | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 603 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 604 | PAN-1437 | M | medium | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 605 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale |
| 606 | PAN-1223 | M | medium | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 607 | PAN-1165 | M | medium | ok |  |  | Lightweight review path for small/trivial PRs |
| 608 | PAN-3558 | XS | low | ok |  |  | Subagent rail: show provider logo and model on each agent row |
| 609 | PAN-1151 | XS | medium | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 610 | PAN-1060 | M | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 611 | PAN-1051 | M | medium | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 612 | PAN-1040 | XS | medium | ok |  |  | event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 613 | PAN-1037 | M | medium | ok |  |  | Retire 'planning-' tmux prefix |
| 614 | PAN-958 | M | medium | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 615 | PAN-949 | M | medium | ok |  |  | feat: add conversation for project from sidebar |
| 616 | PAN-947 | M | medium | ok |  |  | feat: project management actions in unified sidebar |
| 617 | PAN-938 | M | medium | ok |  |  | Fizzy visual pipeline |
| 618 | PAN-903 | M | medium | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 619 | PAN-902 | XS | medium | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 620 | PAN-901 | XS | medium | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 621 | PAN-818 | M | medium | ok |  |  | Make summary optional when forking conversations |
| 622 | PAN-736 | M | medium | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 623 | PAN-709 | M | medium | ok |  |  | self-improving flywheel |
| 624 | PAN-3335 | XS | low | ok |  |  | Click a pasted conversation image to open it full size in a popup |
| 625 | PAN-678 | M | medium | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 626 | PAN-675 | M | medium | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 627 | PAN-654 | L | medium | ok |  |  | Project Setup Wizard |
| 628 | PAN-649 | M | medium | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 629 | PAN-637 | XS | medium | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 630 | PAN-629 | M | medium | ok |  |  | Workspace quotas and resource governance |
| 631 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents |
| 632 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 633 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 634 | PAN-548 | M | medium | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 635 | PAN-546 | M | medium | ok |  |  | Remove claude-code-router |
| 636 | PAN-537 | M | medium | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 637 | PAN-531 | XS | medium | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 638 | PAN-452 | M | medium | ok |  |  | Conversation input bar |
| 639 | PAN-450 | M | medium | ok |  |  | Adopt remaining Effect patterns |
| 640 | PAN-294 | M | medium | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 641 | PAN-3443 | L | low | ok |  | PAN-3441 | God View 'Spectrum Deck' — a second Winamp-grade visualizer concept with mockup and PRD |
| 642 | PAN-293 | M | medium | stale |  |  | Project Living Memory |
| 643 | PAN-277 | M | medium | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 644 | PAN-258 | M | medium | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 645 | PAN-255 | M | medium | stale |  |  | Agents lack awareness of MCP tools |
| 646 | PAN-252 | XS | medium | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 647 | PAN-243 | M | medium | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 648 | PAN-77 | XS | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 649 | PAN-54 | L | medium | stale |  |  | e2e command for full workflow integration test |
| 650 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 651 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 652 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 653 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 654 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 655 | PAN-2941 | M | low | ok |  |  | OKF v3 |
| 656 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 657 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 658 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 |
| 659 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 660 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 661 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 662 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 663 | PAN-2635 | XS | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 664 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 665 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 666 | PAN-3133 | S | low | ok |  | PAN-3131 | Spike: measure TRON encoding token savings for prompt-bound xBRIEF payloads |
| 667 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 668 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file |
| 669 | PAN-2600 | XS | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) |
| 670 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 671 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 672 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector |
| 673 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 674 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 675 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 676 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 677 | PAN-2424 | L | low | ok |  |  | Epic: the Order Book |
| 678 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree … |
| 679 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 680 | PAN-2356 | M | low | ok |  |  | Overdeck Anywhere P3: relay service |
| 681 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 682 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 683 | PAN-2352 | M | low | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 684 | PAN-2353 | M | low | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 685 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations |
| 686 | PAN-2091 | XS | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 687 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 688 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 689 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 690 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 691 | PAN-2074 | XS | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 692 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 693 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 694 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast |
| 695 | PAN-2002 | XS | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 696 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 697 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 698 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 699 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 700 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 701 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 702 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 703 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every… |
| 704 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 705 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 706 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout |
| 707 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 708 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 709 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 710 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 711 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 712 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 713 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 714 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 715 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 716 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 717 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 718 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 719 | PAN-2983 | M | low | ok |  |  | OKF v3 deferrals (lease writes, LLM auditor) — explicitly gated on proven contention |
| 720 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 721 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 722 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 723 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 724 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 725 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' |
| 726 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence |
| 727 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 728 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 729 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 730 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces |
| 731 | PAN-1123 | XS | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 732 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 733 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 734 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 735 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 736 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 737 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 738 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 739 | PAN-984 | XS | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 740 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 741 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 742 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 743 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 744 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 745 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 746 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 747 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 748 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 749 | PAN-810 | XS | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 750 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 751 | PAN-793 | XS | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 752 | PAN-791 | XS | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 753 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling |
| 754 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 755 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 756 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 757 | PAN-774 | XS | low | ok |  |  | Unify launch UX and release pipeline for 1.0 |
| 758 | PAN-773 | XS | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 759 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 760 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 761 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 762 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 763 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 764 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 765 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 766 | PAN-751 | M | low | ok |  |  | Historical Metrics Data Persistence |
| 767 | PAN-750 | L | low | ok |  |  | Complete Metrics Page Redesign |
| 768 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 769 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 770 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 771 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 772 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 773 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 774 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 775 | PAN-701 | XS | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 776 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 777 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 778 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 779 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 780 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 781 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 782 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 783 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 784 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 785 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 786 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 787 | PAN-571 | XS | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 788 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 789 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 790 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly |
| 791 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 792 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 793 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX |
| 794 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 795 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 796 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database |
| 797 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 798 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 799 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 800 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 801 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 802 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 803 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 804 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 805 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 806 | PAN-249 | XS | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 807 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 808 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics |
| 809 | PAN-227 | M | low | stale |  |  | Phase gate validation |
| 810 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 811 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 812 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 813 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 814 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 815 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 816 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 817 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 818 | PAN-52 | XS | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 819 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 820 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 821 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 822 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 823 | PAN-2348 | XS | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 824 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md |
| 825 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md |
| 826 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md |
| 827 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md |
| 828 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md |
| 829 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 830 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 831 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 832 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 833 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 834 | PAN-1684 | XS | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 835 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 836 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc |
| 837 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 838 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 839 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 840 | PAN-633 | M | low | ok |  |  | Update Cloister PRD and docs index |
| 841 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |

## Rationale detail

### PAN-2746 (rank 1)

Highest integrity risk — infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; nearly merged a pipeline-critical change unreviewed.

### PAN-2689 (rank 2)

Sandboxed codex review verdicts fire-and-forget into a journal that loses them; review convoy reports green on evidence never delivered.

### PAN-2828 (rank 3)

pan done --strike structurally refuses every squash-merged strike — the landing path doctrine mandates is rejected by its own ancestry check.

### PAN-3250 (rank 4)

New this pass and near the top because it corrupts what every downstream gate reasons about. Workspaces branch from local HEAD instead of origin/main, so each new feature branch silently inherits whatever unpushed commits happen to be sitting on the shared primary main — five branches were already contaminated when it was filed, including two created after the problem was known, and their PRs read MERGEABLE/CLEAN. Review, test and merge all evaluate a base nobody chose. It carries the blocks-main label and is a one-line fix in the spawn path relative to the damage it does.

### PAN-3285 (rank 5)

New this pass; the single worst availability failure in the backlog. A supervisor unit pinned to a pan reload generation SIGTERMs every healthy dashboard and is structurally unable to start a replacement — a 3.5-hour total outage with 1,107 consecutive failed recoveries and no escalation, and manual recovery from the primary checkout gets killed within 30 seconds too. Labelled critical. Nothing else in the pipeline matters while the dashboard cannot stay up.

### PAN-2874 (rank 6)

Strike landing cannot merge: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback wedges on exited strike agents.

### PAN-2940 (rank 7)

Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.

### PAN-3283 (rank 8)

New this pass and ranked as an integrity defect rather than a bug. Recovering an issue from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 even when the newest written verdict is CHANGES REQUESTED — two issues were sitting in a UAT batch in exactly that state when it was filed. This is the same class as the infra-failure bypass already ranked critical: a machine-written approval indistinguishable from a real one. It carries blocks-main.

### PAN-2935 (rank 9)

Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of API calls 504 in real MYN workspaces.

### PAN-3631 (rank 10)

New this pass and ranked high because it silently degrades this document. The sequencer reads its prior from the legacy project-local .pan/backlog/sequence.md while pan backlog write-sequence persists only to overdeck-state, so nothing has updated the legacy copy since 2026-07-20 and every incremental pass since has been handed the same frozen prior — including this one. Until it is fixed, incremental passes cannot actually be incremental, and the read-side twin (PAN-3301) is already ranked alongside it.

### PAN-2337 (rank 11)

Reload/build atomicity — an in-place npm run build under a live dashboard breaks new PTY-supervisor chunks.

### PAN-2758 (rank 12)

Provider capacity error silently zombies a spawned agent (willRetry=false, status stays running forever), holding a slot.

### PAN-3085 (rank 13)

New this pass; the cheapest high-value fix in the top tier. Review feedback is written to .overdeck/feedback but the path handed to the work agent — and read by the deacon merge gate — is a hardcoded .pan/feedback that has not existed since the rebrand. Agents are told to fix findings at an empty directory and the gate sees zero feedback no matter how many files exist. It is a path constant, and it breaks the review rework loop end to end.

### PAN-3329 (rank 14)

New this pass. A deployment generation loses 62 tracked files under packages/ plus its node_modules/.bun store while a dev-checkout build runs, after which every pan invocation machine-wide dies with ERR_MODULE_NOT_FOUND. Already-running processes survive on in-memory modules, so the breakage is invisible until the next CLI call — which is what makes it expensive. Second observed occurrence with an identical signature, so it is reproducible rather than a one-off.

### PAN-3498 (rank 15)

New this pass and ranked critical because it breaks the artifact the whole backlog reads. writeSequenceMd pins in-pipeline issues back to their prior rank without renumbering the rest, so a submitted collision-free 1..N ranking is persisted with duplicate ranks and matching holes — 11 of each in the 2026-08-02 pass. Flywheel pickup order, merge order and the operator-facing table all treat rank as a unique total order, and it is not one.

### PAN-2848 (rank 16)

Work agent stalls forever on a dead inspection session; no re-dispatch, swarm-off suppresses recovery.

### PAN-2846 (rank 17)

Close-out blocks on a dead agent — postMergeLifecycle pauses the agent but leaves status=running, jamming the DoD gate.

### PAN-3078 (rank 18)

New this pass. A work agent that waits for a per-item inspection verdict deadlocks forever: the verdict is written to review_status.inspect_status and a checkpoint is saved, but nothing delivers it to the agent. Observed live with a byte-identical pane for ten-plus minutes on an inspection that had already passed. Inspection fires once per xBRIEF item, so this is a per-item deadlock risk across every planned issue in the pipeline.

### PAN-3539 (rank 19)

New this pass. A kernel OOM of one agent-spawned python process took down the entire tmux server, because systemd's default OOMPolicy=stop fails the whole unit when a child is killed — every agent and conversation on the machine died with it, including an in-flight review convoy and an active strike. The victim selection was correct; the blast radius is the defect, and it is a unit-file property, not an application change.

### PAN-3566 (rank 20)

New this pass and ranked as the deterministic root cause behind a family already ranked high. The test-role launcher execs claude with no -p, no positional prompt and no piped stdin, so the role boots an interactive REPL and sits at the composer forever — no turn, no JSONL, ctx 0%, cost $0.00. Reproduced across eight session IDs. Every zombie-test-agent report (PAN-3274, PAN-2706, PAN-3563) reads as load or delivery flakiness until you know this.

### PAN-2569 (rank 21)

Planning finalizes (issue->planned) but the work agent never auto-spawns — silent handoff break.

### PAN-2567 (rank 22)

Reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never dispatched.

### PAN-2995 (rank 23)

New this pass and effectively the same defect family as PAN-2874, which is already pinned near the top. pan done --strike refuses after the doctrine-prescribed gh-API squash merge because it tests branch ancestry, and a squash never leaves the original SHAs as ancestors of main. pan close --force passes dod:merged on the identical issue, so the system already contains the correct oracle — the strike path just asks the wrong question.

### PAN-3057 (rank 24)

New this pass. A compaction the harness initiates on its own is invisible to every recovery path Overdeck has: six agents resumed after a host restart each ran their own /compact, wrote a summary and dropped to an idle prompt, and nothing re-drove them. The second half — the GPT-5.6 context window declared twice with different values — is a small fix riding along, but the compaction blindness is what strands whole fleets after a reboot.

### PAN-3282 (rank 25)

New this pass. Review agents repeatedly terminate before writing their report across five issues and two projects, leaving a status that looks like a verdict, no artifact to read, and a stuck flag that blocks progress until a human restarts the reviewer. It recurs on issues already recovered once, which rules out a transient. This is the review pipeline's dominant failure mode in the August incident record and sits upstream of several other ranked issues.

### PAN-3313 (rank 26)

New this pass. A transient upstream stream error benches CLIProxy's only auth entry, so every GPT-routed request 503s with 'no auth available' until an internal cooldown lapses — measured at 14 successes against 35 failures in one hour, roughly 70% of GPT inference, with credentials valid the whole time. The message actively misdirects the operator toward re-authenticating. Most of the fleet routes GPT models through this proxy.

### PAN-3424 (rank 27)

New this pass. The state plane stops being durable in two independent ways and nothing detects either: a non-fast-forward push on overdeck-state is warned about and dropped rather than reconciled, and drafts/ PRDs are never staged at all — 16 orphans, one two weeks old. The state branch is the canonical plane for records, specs and drafts, so silent non-durability there is the failure mode the two-door design exists to prevent.

### PAN-3492 (rank 28)

New this pass. Server-driven verification retries amplify their own cause: under load, fixture setup exceeds a fixed 5s timeout, the run is recorded as failed, the failure triggers a retry, and the retry starts another full suite. Four concurrent vitest generations were live for one issue at host load 18.5, parented by the dashboard server rather than any agent. It is the mechanism behind several ranked test-gate and CPU-storm issues.

### PAN-3524 (rank 29)

New this pass and ranked critical for what it says about the control plane. A server-owned --changed verification loop relaunched continuously through a global deacon freeze, a review abort, a pan pause and an operator stop — every documented suppression gate applied, none of them held — and it blocked a red-main fix from reaching its test gate across four attempts. A loop no gate can stop is a stronger problem than the load it generates.

### PAN-3532 (rank 30)

New this pass. CI never runs the full frontend suite, so main sat red on two frontend files for hours while every main CI run reported success on the same SHA. The reds were fixed by cherry-pick, but the blindness remains: green CI on main is currently not evidence that main is green. Every gate downstream of CI inherits that false signal.

### PAN-3554 (rank 31)

New this pass. Red main has no mechanical owner — a failed main-push CI run sat for about five hours until a conversation happened to run gh run list. Worse, the failure hides itself: the merge gate treats red main as 'nothing eligible', so the operator-visible symptom is an empty merge queue rather than an alarm, and the flywheel that would otherwise notice is not always running. It pairs directly with PAN-3532's false-green blindness.

### PAN-3561 (rank 32)

New this pass. A writer that crashes between mkdir and owner.json leaves an ownerless state-git lock with no TTL and no recovery verb, and every canonical-state write for that project fails for as long as it exists — 2.5 days for mind-your-now, across five issues, with pan task verbs dying outright because they have no fallback. A single-door design needs the door to be recoverable; today it is not.

### PAN-3630 (rank 33)

New this pass. pan tell reported successful delivery three times to a live healthy agent, moved all three messages into the read mailbox, and the agent's transcript shows it received none — the operator's scope correction never landed and the rejected design shipped as a result. pan tell is the sanctioned delivery door for every role and harness, so a door that lies about delivery undermines every recovery procedure that depends on it.

### PAN-2954 (rank 34)

postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run.

### PAN-3062 (rank 35)

New this pass. The primary worktree is checked out on main and shared by every conversation and the flywheel, so whoever pushes next ships everyone else's commits, verified or not. It is the structural cause behind PAN-3250's branch contamination and PAN-3505's blocked state write door, and it is the reason the repo's own commit-often rule exists. Fixing the sharing model retires a family of incidents rather than one.

### PAN-3234 (rank 36)

New this pass. Agents freeze indefinitely on blocking choice menus — a permission approval, a session-resume gate — and no health surface detects it; both instances were found by an orchestrator reading tmux panes by hand. The detector exists (paneHasBlockingChoiceMenu) but is wired only to delivery refusal, never to health, so a frozen agent reads as running while holding a slot and a review.

### PAN-3653 (rank 37)

New this pass. A strike that correctly stops because main is red has no path that wakes it when main goes green — the harness sits at its old conclusion, the branch never advances, and pan recover finds no pending decision to act on. The strike role is the pipeline's fast-unblock mechanism, so a strike that cannot be resumed after the blocker clears converts the urgent path into a stall. It carries blocks-main.

### PAN-3667 (rank 38)

New this pass. CLIProxy rejects any model id its registered providers do not serve, with no remap and no fallback, so every subagent whose definition pins an Anthropic model dies at spawn inside a GPT-routed session — and the synced agent fleet pins heavily (haiku, sonnet and opus across explorer, work, planning, UAT and review agents). A config.extra.yaml stopgap already shipped; this is the auto-provisioned fix behind it.

### PAN-2259 (rank 39)

Something burns the full 5k/hr GitHub GraphQL quota, repeatedly breaking pan close and gh issue edit.

### PAN-3043 (rank 40)

New this pass. Provider quota exhaustion mid-run leaves an agent registered running for days — 3.5 days stale in the filed case — holding an advancing-ceiling slot while its pane shows a hard 403 refusal it can never recover from. Provider health is probed only at admission, so nothing revisits it. Under a concurrency ceiling, a slot held by a dead agent is throughput taken directly from live work.

### PAN-3084 (rank 41)

New this pass. A review session that spawns but is never briefed sits at zero context forever and every recovery path treats it as healthy work in progress — auto-dispatch no-ops because a session exists, and pan review restart 'preserves' a session with no context to preserve. Review can then never start for that issue. Same shape as the ghost test sessions already ranked at 15, on the review side.

### PAN-3100 (rank 42)

New this pass. The test role evaluates the workspace working tree rather than the reviewed commit, so a still-running work agent's uncommitted edits are counted against the issue and produce a failed verdict for code that was never reviewed and will never merge. The test role's own artifact diagnosed it exactly. Combined with the stale-artifact replay in PAN-3104, it is a durable false-failure trap rather than a transient.

### PAN-3168 (rank 43)

New this pass. DoD row 5 counts an agent that was paused specifically for close-out as a running agent and blocks close-out on it, while all three state planes agree the agent has no session. The issue is merged, promoted and correct, and the gate deadlocks on its own precondition. Together with PAN-3188 it accounts for the standing merged-but-not-closed-out backlog.

### PAN-3188 (rank 44)

New this pass. DoD row 5 accepts only the transient verifying_on_main waypoint, so any issue that already reached a terminal canonical state can never satisfy the post-merge row — observed on all 11 issues in one wedged-review cohort, each permanently un-closeable except through an operator override. An override used routinely stops being an override, which is why this ranks with the other close-out blockers.

### PAN-3244 (rank 45)

New this pass. A queued dashboard deploy defers verification for every issue in every project, so an Overdeck deploy window silently starves an unrelated project's review handoff — 30-plus minutes with the durable review intent written and nothing spawned. Three gates compose into an unbounded cross-project hold, and PAN-3248 (nothing clears the pending file) is the reason the window never closes on its own.

### PAN-3314 (rank 46)

New this pass. Every agent pane is a child of one transient tmux-server unit, so agent memory is the unit's memory and systemd-oomd selects by cgroup — one hungry agent inflates the unit and the whole fleet dies with it. That has now happened twice, 55 processes in the first instance. Bounding the blast radius is the containment half of PAN-3539's policy fix and belongs with it.

### PAN-3520 (rank 47)

New this pass. Multiple branches loop on test-failed verdicts that are not defects: uniform 5000ms timeout signatures under host load 18-27, with the same files passing in isolation in about 19 seconds. Four identical occasions in three days. Retrying timeout-only failures in isolation before recording a verdict is the smallest change that stops the loop, and it sits directly on top of the fleet concurrency raise.

### PAN-3560 (rank 48)

New this pass. Under concurrent review convoys the PTY supervisor 502s fleet-wide on echo confirmation, killing session resumes and feedback delivery across at least seven unrelated agents deterministically. It is upstream of the zombie role agents (PAN-3563) and the lock-convoy reviewer deaths, so several separately-filed symptoms clear when the supervisor stops falling over under load.

### PAN-3564 (rank 49)

New this pass. Record writes take the per-issue lock and then block on the global state-git lock while still holding it, so under contention every per-issue lock in the queue is held for the full global wait — measured at 100% duty cycle over 240 seconds, with all four reviewer lanes dying at spawn on the lock. Classic lock convoy, and it explains reviewer spawn failures that look like unrelated flakiness.

### PAN-3651 (rank 50)

New this pass. The non-fast-forward push retry for overdeck-state was reverted because it broke 12 tests across the pan-dir state-door suites, but the problem it fixed is live and is exactly what PAN-3424 documents. Re-landing it with those suites green closes the durability gap rather than leaving the state plane dependent on whichever writer happens to win the ref race.

### PAN-3662 (rank 51)

New this pass. Documented read-only CLI surfaces — pan flywheel status, pan flywheel config --get, pan status — open the database and then attempt runtime schema top-ups, which emit SQLITE_READONLY under the sandboxed Flywheel. These are precisely the commands the Flywheel is told to use when localhost is sandboxed, so their initialization must not require a write. It carries blocks-main.

### PAN-3580 (rank 51)

The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.

### PAN-2695 (rank 52)

Concurrent review dispatches race fresh-spawn vs resume, second dispatch resumes a still-booting parent and wedges.

### PAN-2742 (rank 53)

Synthesis fires 42s after spawn and mislabels reviewers-with-reports-on-disk as infra-failure, bypassing review.

### PAN-3023 (rank 54)

New this pass. Post-planning auto-spawn abandons on a transient Docker failure and the 'attempt 1/3' it prints never retries, so a finalized plan with autoSpawn=true sits in todo with no re-drive owner until an operator notices. The planning-to-work handoff is the seam the whole autonomous pipeline depends on, and a one-shot retry that does not retry is the worst kind of guard.

### PAN-3103 (rank 55)

New this pass. A transient merge_status=failed read immediately after a successful merge makes automatic close-out skip the issue permanently, and nothing retries once the status self-heals — so the issue stays merged-but-open, reads as pickup-eligible, and gets a fresh planning agent spawned on already-shipped work. Wasted agent spend on top of a stuck lifecycle.

### PAN-3118 (rank 56)

New this pass. Model-specific quota exhaustion halts agents with no signal anywhere except the pane: four planning agents reported running at $0.00 while the rolling-window status line showed plenty of headroom, so the existing session-cap recovery never engages. There is no capacity fallback, so the fleet quietly stops working while the registry insists it is busy.

### PAN-3236 (rank 57)

New this pass. ECONNREFUSED against a dead supervisor socket is misclassified as an ambiguous keyed delivery, so the tmux tier is deliberately not tried and review feedback never reaches the agent — the file sits on disk, the issue goes stuck, and the agent idles. Delivery ambiguity is the right caution for a live socket and exactly the wrong one for a refused connection.

### PAN-3248 (rank 58)

New this pass and the reason PAN-3244's cross-project hold never ends by itself. clearPendingDeploy has one caller, so a successful pan reload leaves the deploy queue set and every project's verification stays deferred until a patrol happens to notice the build is fresh. Small fix, large blast radius, and it should land with the deferral scoping.

### PAN-3278 (rank 59)

New this pass. A work agent finished, opened a non-draft PR, and sat idle for two hours because review was never dispatched — while the auto-requeue machinery that exists for exactly this had capacity and 25 attempts and fired none of them. The agent behaved correctly; the handoff did not happen. Silent non-dispatch at this seam is invisible until someone reads costs that stopped moving.

### PAN-3429 (rank 60)

New this pass. The memory governor defers new admissions but sheds nothing under HARD pressure: at 2.2GB available and PSI full avg60 near 42, it logged soft deferrals for 30 minutes while the flywheel manually paused the offending gate run and recovered 2.4GB. Its documented shed categories were both empty, so the policy needs a category that exists during real pressure rather than one that does not.

### PAN-3504 (rank 61)

New this pass. npm run typecheck fails on main because parked.ts references a ProjectConfig field that does not exist — landed directly on main, not through a PR. It is a one-word fix, and while it stands, every branch that rebases onto main inherits a red typecheck and every gate reading typecheck gets a false signal. PAN-3499 is the same defect filed from the other direction.

### PAN-3541 (rank 62)

New this pass. After an unclean reviewer death, pan review restart resumes into the harness session-resume menu, the delivery guard correctly refuses to answer it, delivery throws, the wedged session stays alive, and the fresh-spawn fallback then refuses because a role run already exists. Abort and reset-session both loop the same way because the resolver reconstructs the session id from planes those verbs do not clear.

### PAN-3543 (rank 63)

New this pass. A completed-handoff agent owed rework is unstartable through every door: pan start refuses and recommends --fresh, --fresh gives the identical refusal, and reset-session refuses too because the durable plane reconstructs the session pointer. A refusal message that recommends the flag it just rejected is the signature of this family, and it blocks rework on issues whose review came back blocked.

### PAN-3563 (rank 64)

New this pass. A role agent whose prompt delivery failed is left status=running with pid null, so no liveness patrol has anything to check, the dispatcher no-ops because it sees testing in progress, and pan unstick inspects the work agent rather than the role. Invisible to every recovery surface at once — the composite of a delivery failure and three blind spots.

### PAN-3657 (rank 65)

New this pass. The merge-train queues endpoint builds its queue with the monorepo builder, so every polyrepo candidate is silently dropped and MYN and Auricle trains read as permanently empty even when an issue is ready with its MR open. The dashboard says ready to merge and the train shows nothing, which is the worst combination for operator trust in the queue.

### PAN-3663 (rank 66)

New this pass. Pull-request webhooks update review state but never enqueue a project membership refresh, so closing a stale PR leaves the canonical membership door still reporting the issue in-pipeline as a zombie_pr row. Issue close-out does invalidate correctly, which isolates this to PR-state changes. Membership is the read door several surfaces trust, so stale rows propagate. It carries blocks-main.

### PAN-2706 (rank 67)

Ghost test sessions that never received kickoff absorb every dispatch, marking testing with no prompt delivered.

### PAN-2700 (rank 68)

Stale .pan/test/result.json is consumed by the next cycle, insta-failing with the previous run verdict.

### PAN-2733 (rank 69)

substrate-bug-poller has never run — BOT_LOGIN is a git author string not a GitHub login; the auto-triage loop is inert.

### PAN-1560 (rank 70)

Re-review after a PR head moves never re-posts status, stranding otherwise-green PRs at BLOCKED.

### PAN-2769 (rank 71)

review_status rows are never reconciled when an issue closes, so closed issues keep advertising stale review state.

### PAN-2883 (rank 72)

Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ and cannot find strike/ PRs.

### PAN-2806 (rank 73)

Strike merge trigger registry splits across dashboard chunks, so the trigger is never registered in the chunk that runs it.

### PAN-2796 (rank 74)

Idle nudge advances a work agent past a failed mandatory inspection, bypassing the inspection gate.

### PAN-1824 (rank 75)

Raised from 78: the real-timer test family kept reddening main through August. PAN-3243, PAN-3520 and PAN-3532 are all downstream instances — load-induced timeouts recorded as real verdicts, branches looping on false test failures, and a CI job that never ran the frontend suite. Fixing the timer discipline at the source removes the input to several of those loops.

### PAN-3139 (rank 76)

New this pass. The agents table — the plane docs/AGENT-STATE-PLANES.md designates authoritative — records a live four-hour agent as stopped while tmux and pan start's own liveness check both say running. Drift in the under-reporting direction is the dangerous direction: enumeration from the authoritative plane misses live agents, and anything that acts on 'stopped' can spawn a duplicate.

### PAN-3237 (rank 77)

New this pass. A capacity-refused planning-to-work handoff is recorded as terminally stuck: every HTTP 409 is classified as 'guardrails' and every skip reason calls markWorkspaceStuck, so three issues accumulated the identical dead-end over three ticks while the fleet was simply full. Backpressure is a normal condition and must be retried, not memorialized as a failure.

### PAN-3274 (rank 78)

New this pass. A test-role agent spawned, never executed a turn, and held its issue out of the merge gate — review approved, CI green, ready_for_merge 0 on a verdict that was never produced. It is the same shape as the already-ranked ghost test sessions and shares PAN-3566's deterministic root cause, so the three should be worked together.

### PAN-3281 (rank 79)

New this pass. An issue can carry ready_for_merge=1 and stuck=1 with failedCheck incomplete-plan-items at the same time, and the merge-ready flag wins on every surface — so work with eight pending checklist items was assembled into a UAT batch and recommended for promotion. Two contradictory facts, and the pipeline consistently reads the optimistic one.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-08-12T23:31:44.581Z",
  "model": "claude-opus-5",
  "pass": "incremental",
  "openCount": 841,
  "nodes": [
    {
      "issue": "PAN-2746",
      "rank": 1,
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
      "rank": 2,
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
      "issue": "PAN-2828",
      "rank": 3,
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
      "issue": "PAN-3250",
      "rank": 4,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace spawn branches from local HEAD, so every new feature branch inherits unpushed local main commits",
      "rationale": "New this pass and near the top because it corrupts what every downstream gate reasons about. Workspaces branch from local HEAD instead of origin/main, so each new feature branch silently inherits whatever unpushed commits happen to be sitting on the shared primary main — five branches were already contaminated when it was filed, including two created after the problem was known, and their PRs read MERGEABLE/CLEAN. Review, test and merge all evaluate a base nobody chose. It carries the blocks-main label and is a one-line fix in the spawn path relative to the damage it does.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 5,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor pinned to a reload generation kills every healthy dashboard and cannot start one — 3.5h outage",
      "rationale": "New this pass; the single worst availability failure in the backlog. A supervisor unit pinned to a pan reload generation SIGTERMs every healthy dashboard and is structurally unable to start a replacement — a 3.5-hour total outage with 1,107 consecutive failed recoveries and no escalation, and manual recovery from the primary checkout gets killed within 30 seconds too. Labelled critical. Nothing else in the pipeline matters while the dashboard cannot stay up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 6,
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
      "issue": "PAN-2940",
      "rank": 7,
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
      "issue": "PAN-3283",
      "rank": 8,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recovering from review_infrastructure_failure sets review_status=passed over an outstanding CHANGES REQUESTED",
      "rationale": "New this pass and ranked as an integrity defect rather than a bug. Recovering an issue from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 even when the newest written verdict is CHANGES REQUESTED — two issues were sitting in a UAT batch in exactly that state when it was filed. This is the same class as the infra-failure bypass already ranked critical: a machine-written approval indistinguishable from a real one. It carries blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 9,
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
      "issue": "PAN-3631",
      "rank": 10,
      "size": "S",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [
        "PAN-3301"
      ],
      "why": "Sequencer reads its prior from legacy .pan while write-sequence persists to overdeck-state — prior frozen",
      "rationale": "New this pass and ranked high because it silently degrades this document. The sequencer reads its prior from the legacy project-local .pan/backlog/sequence.md while pan backlog write-sequence persists only to overdeck-state, so nothing has updated the legacy copy since 2026-07-20 and every incremental pass since has been handed the same frozen prior — including this one. Until it is fixed, incremental passes cannot actually be incremental, and the read-side twin (PAN-3301) is already ranked alongside it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 11,
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
      "issue": "PAN-2758",
      "rank": 12,
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
      "issue": "PAN-3085",
      "rank": 13,
      "size": "XS",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback written to .overdeck/feedback but agents and the merge gate are pointed at .pan/feedback",
      "rationale": "New this pass; the cheapest high-value fix in the top tier. Review feedback is written to .overdeck/feedback but the path handed to the work agent — and read by the deacon merge gate — is a hardcoded .pan/feedback that has not existed since the rebrand. Agents are told to fix findings at an empty directory and the gate sees zero feedback no matter how many files exist. It is a path constant, and it breaks the review rework loop end to end.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3329",
      "rank": 14,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment generation node_modules and tracked packages/ files deleted mid-build, bricking every pan call",
      "rationale": "New this pass. A deployment generation loses 62 tracked files under packages/ plus its node_modules/.bun store while a dev-checkout build runs, after which every pan invocation machine-wide dies with ERR_MODULE_NOT_FOUND. Already-running processes survive on in-memory modules, so the breakage is invisible until the next CLI call — which is what makes it expensive. Second observed occurrence with an identical signature, so it is reproducible rather than a one-off.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 15,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering, so rank stops being a total order",
      "rationale": "New this pass and ranked critical because it breaks the artifact the whole backlog reads. writeSequenceMd pins in-pipeline issues back to their prior rank without renumbering the rest, so a submitted collision-free 1..N ranking is persisted with duplicate ranks and matching holes — 11 of each in the 2026-08-02 pass. Flywheel pickup order, merge order and the operator-facing table all treat rank as a unique total order, and it is not one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 16,
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
      "rank": 17,
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
      "issue": "PAN-3078",
      "rank": 18,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect verdict never reaches the work agent, so an agent that waits for it deadlocks forever",
      "rationale": "New this pass. A work agent that waits for a per-item inspection verdict deadlocks forever: the verdict is written to review_status.inspect_status and a checkpoint is saved, but nothing delivers it to the agent. Observed live with a byte-identical pane for ten-plus minutes on an inspection that had already passed. Inspection fires once per xBRIEF item, so this is a per-item deadlock risk across every planned issue in the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3539",
      "rank": 19,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [
        "PAN-3314"
      ],
      "why": "A kernel OOM of one agent-spawned process killed the whole tmux server; OOMPolicy=stop took every session",
      "rationale": "New this pass. A kernel OOM of one agent-spawned python process took down the entire tmux server, because systemd's default OOMPolicy=stop fails the whole unit when a child is killed — every agent and conversation on the machine died with it, including an in-flight review convoy and an active strike. The victim selection was correct; the blast radius is the defect, and it is a unit-file property, not an application change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3566",
      "rank": 20,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test-role launcher execs claude with no user prompt, so the role boots an idle REPL — the zombie-test root cause",
      "rationale": "New this pass and ranked as the deterministic root cause behind a family already ranked high. The test-role launcher execs claude with no -p, no positional prompt and no piped stdin, so the role boots an interactive REPL and sits at the composer forever — no turn, no JSONL, ctx 0%, cost $0.00. Reproduced across eight session IDs. Every zombie-test-agent report (PAN-3274, PAN-2706, PAN-3563) reads as load or delivery flakiness until you know this.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 21,
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
      "rank": 22,
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
      "issue": "PAN-2995",
      "rank": 23,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike false-blocks after a gh-API squash merge; ancestry test cannot see squashed content",
      "rationale": "New this pass and effectively the same defect family as PAN-2874, which is already pinned near the top. pan done --strike refuses after the doctrine-prescribed gh-API squash merge because it tests branch ancestry, and a squash never leaves the original SHAs as ancestors of main. pan close --force passes dod:merged on the identical issue, so the system already contains the correct oracle — the strike path just asks the wrong question.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 24,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice",
      "rationale": "New this pass. A compaction the harness initiates on its own is invisible to every recovery path Overdeck has: six agents resumed after a host restart each ran their own /compact, wrote a summary and dropped to an idle prompt, and nothing re-drove them. The second half — the GPT-5.6 context window declared twice with different values — is a small fix riding along, but the compaction blindness is what strands whole fleets after a reboot.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 25,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents repeatedly die before writing a verdict across five issues and two projects",
      "rationale": "New this pass. Review agents repeatedly terminate before writing their report across five issues and two projects, leaving a status that looks like a verdict, no artifact to read, and a stuck flag that blocks progress until a human restarts the reviewer. It recurs on issues already recovered once, which rules out a transient. This is the review pipeline's dominant failure mode in the August incident record and sits upstream of several other ranked issues.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 26,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient upstream stream error benches CLIProxy's only auth, 503ing ~70% of GPT-routed inference",
      "rationale": "New this pass. A transient upstream stream error benches CLIProxy's only auth entry, so every GPT-routed request 503s with 'no auth available' until an internal cooldown lapses — measured at 14 successes against 35 failures in one hour, roughly 70% of GPT inference, with credentials valid the whole time. The message actively misdirects the operator toward re-authenticating. Most of the fleet routes GPT models through this proxy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3424",
      "rank": 27,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "The state plane silently stops being durable: non-FF pushes unreconciled, drafts never staged, 16 orphans",
      "rationale": "New this pass. The state plane stops being durable in two independent ways and nothing detects either: a non-fast-forward push on overdeck-state is warned about and dropped rather than reconciled, and drafts/ PRDs are never staged at all — 16 orphans, one two weeks old. The state branch is the canonical plane for records, specs and drafts, so silent non-durability there is the failure mode the two-door design exists to prevent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3492",
      "rank": 28,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Server-side verification retries form a self-amplifying load loop: timeouts cause retries cause timeouts",
      "rationale": "New this pass. Server-driven verification retries amplify their own cause: under load, fixture setup exceeds a fixed 5s timeout, the run is recorded as failed, the failure triggers a retry, and the retry starts another full suite. Four concurrent vitest generations were live for one issue at host load 18.5, parented by the dashboard server rather than any agent. It is the mechanism behind several ranked test-gate and CPU-storm issues.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3524",
      "rank": 29,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "A server-owned --changed verification loop survives freeze, abort, pause and operator-stop",
      "rationale": "New this pass and ranked critical for what it says about the control plane. A server-owned --changed verification loop relaunched continuously through a global deacon freeze, a review abort, a pan pause and an operator stop — every documented suppression gate applied, none of them held — and it blocked a red-main fix from reaching its test gate across four attempts. A loop no gate can stop is a stronger problem than the load it generates.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3532",
      "rank": 30,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI never runs the full frontend suite, so main stayed red on frontend while every CI run reported green",
      "rationale": "New this pass. CI never runs the full frontend suite, so main sat red on two frontend files for hours while every main CI run reported success on the same SHA. The reds were fixed by cherry-pick, but the blindness remains: green CI on main is currently not evidence that main is green. Every gate downstream of CI inherits that false signal.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3554",
      "rank": 31,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main has no mechanical owner; a failed main-push CI run sat five hours with the failure hiding itself",
      "rationale": "New this pass. Red main has no mechanical owner — a failed main-push CI run sat for about five hours until a conversation happened to run gh run list. Worse, the failure hides itself: the merge gate treats red main as 'nothing eligible', so the operator-visible symptom is an empty merge queue rather than an alarm, and the flywheel that would otherwise notice is not always running. It pairs directly with PAN-3532's false-green blindness.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3561",
      "rank": 32,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "An ownerless state-git lock is immortal: a crashed writer bricked a project's write door for 2.5 days",
      "rationale": "New this pass. A writer that crashes between mkdir and owner.json leaves an ownerless state-git lock with no TTL and no recovery verb, and every canonical-state write for that project fails for as long as it exists — 2.5 days for mind-your-now, across five issues, with pan task verbs dying outright because they have no fallback. A single-door design needs the door to be recoverable; today it is not.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3630",
      "rank": 33,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [
        "PAN-3629"
      ],
      "why": "pan tell marks messages read without delivering them: three 'delivered' confirmations, zero receipts",
      "rationale": "New this pass. pan tell reported successful delivery three times to a live healthy agent, moved all three messages into the read mailbox, and the agent's transcript shows it received none — the operator's scope correction never landed and the rejected design shipped as a result. pan tell is the sanctioned delivery door for every role and harness, so a door that lies about delivery undermines every recovery procedure that depends on it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 34,
      "size": "XS",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects",
      "rationale": "postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 35,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared primary main worktree means any agent pushing main ships every other session's unpushed commits",
      "rationale": "New this pass. The primary worktree is checked out on main and shared by every conversation and the flywheel, so whoever pushes next ships everyone else's commits, verified or not. It is the structural cause behind PAN-3250's branch contamination and PAN-3505's blocked state write door, and it is the reason the repo's own commit-often rule exists. Fixing the sharing model retires a family of incidents rather than one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 36,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze indefinitely on blocking choice menus and no health surface detects it",
      "rationale": "New this pass. Agents freeze indefinitely on blocking choice menus — a permission approval, a session-resume gate — and no health surface detects it; both instances were found by an orchestrator reading tmux panes by hand. The detector exists (paneHasBlockingChoiceMenu) but is wired only to delivery refusal, never to health, so a frozen agent reads as running while holding a slot and a review.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3653",
      "rank": 37,
      "size": "S",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "A cleared red-main blocker leaves a live strike idle and unrecoverable — nothing wakes it when main goes green",
      "rationale": "New this pass. A strike that correctly stops because main is red has no path that wakes it when main goes green — the harness sits at its old conclusion, the branch never advances, and pan recover finds no pending decision to act on. The strike role is the pipeline's fast-unblock mechanism, so a strike that cannot be resumed after the blocker clears converts the urgent path into a stall. It carries blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3667",
      "rank": 38,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy has no cross-family remap, so every model-pinned subagent dies at spawn in a proxied session",
      "rationale": "New this pass. CLIProxy rejects any model id its registered providers do not serve, with no remap and no fallback, so every subagent whose definition pins an Anthropic model dies at spawn inside a GPT-routed session — and the synced agent fleet pins heavily (haiku, sonnet and opus across explorer, work, planning, UAT and review agents). A config.extra.yaml stopgap already shipped; this is the auto-provisioned fix behind it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 39,
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
      "issue": "PAN-3043",
      "rank": 40,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion undetected: agent holds a slot at status=running for days",
      "rationale": "New this pass. Provider quota exhaustion mid-run leaves an agent registered running for days — 3.5 days stale in the filed case — holding an advancing-ceiling slot while its pane shows a hard 403 refusal it can never recover from. Provider health is probed only at admission, so nothing revisits it. Under a concurrency ceiling, a slot held by a dead agent is throughput taken directly from live work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 41,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A spawned-but-never-briefed review session blocks its own replacement; restart 'preserves' the zombie",
      "rationale": "New this pass. A review session that spawns but is never briefed sits at zero context forever and every recovery path treats it as healthy work in progress — auto-dispatch no-ops because a session exists, and pan review restart 'preserves' a session with no context to preserve. Review can then never start for that issue. Same shape as the ghost test sessions already ranked at 15, on the review side.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 42,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false failures",
      "rationale": "New this pass. The test role evaluates the workspace working tree rather than the reviewed commit, so a still-running work agent's uncommitted edits are counted against the issue and produce a failed verdict for code that was never reviewed and will never merge. The test role's own artifact diagnosed it exactly. Combined with the stale-artifact replay in PAN-3104, it is a durable false-failure trap rather than a transient.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3168",
      "rank": 43,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 deadlocks close-out: an agent paused FOR close-out counts as running and blocks it",
      "rationale": "New this pass. DoD row 5 counts an agent that was paused specifically for close-out as a running agent and blocks close-out on it, while all three state planes agree the agent has no session. The issue is merged, promoted and correct, and the gate deadlocks on its own precondition. Together with PAN-3188 it accounts for the standing merged-but-not-closed-out backlog.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 44,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 rejects terminal canonical states, so an already-done issue can never close out",
      "rationale": "New this pass. DoD row 5 accepts only the transient verifying_on_main waypoint, so any issue that already reached a terminal canonical state can never satisfy the post-merge row — observed on all 11 issues in one wedged-review cohort, each permanently un-closeable except through an operator override. An override used routinely stops being an override, which is why this ranks with the other close-out blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 45,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A queued dashboard deploy defers verification for every project, starving cross-project review handoffs",
      "rationale": "New this pass. A queued dashboard deploy defers verification for every issue in every project, so an Overdeck deploy window silently starves an unrelated project's review handoff — 30-plus minutes with the durable review intent written and nothing spawned. Three gates compose into an unbounded cross-project hold, and PAN-3248 (nothing clears the pending file) is the reason the window never closes on its own.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 46,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "One cgroup holds every agent, so a single hungry agent takes the whole fleet down on OOM",
      "rationale": "New this pass. Every agent pane is a child of one transient tmux-server unit, so agent memory is the unit's memory and systemd-oomd selects by cgroup — one hungry agent inflates the unit and the whole fleet dies with it. That has now happened twice, 55 processes in the first instance. Bounding the blast radius is the containment half of PAN-3539's policy fix and belongs with it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 47,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Test gate must retry timeout-only failures in isolation; load flakes loop branches on false verdicts",
      "rationale": "New this pass. Multiple branches loop on test-failed verdicts that are not defects: uniform 5000ms timeout signatures under host load 18-27, with the same files passing in isolation in about 19 seconds. Four identical occasions in three days. Retrying timeout-only failures in isolation before recording a verdict is the smallest change that stops the loop, and it sits directly on top of the fleet concurrency raise.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3560",
      "rank": 48,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "PTY supervisor overload under concurrent convoys 502s fleet-wide, killing resumes and feedback delivery",
      "rationale": "New this pass. Under concurrent review convoys the PTY supervisor 502s fleet-wide on echo confirmation, killing session resumes and feedback delivery across at least seven unrelated agents deterministically. It is upstream of the zombie role agents (PAN-3563) and the lock-convoy reviewer deaths, so several separately-filed symptoms clear when the supervisor stops falling over under load.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3564",
      "rank": 49,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [
        "PAN-3561"
      ],
      "why": "Lock convoy: the per-issue record lock is held across the global state-git wait, killing reviewer spawns",
      "rationale": "New this pass. Record writes take the per-issue lock and then block on the global state-git lock while still holding it, so under contention every per-issue lock in the queue is held for the full global wait — measured at 100% duty cycle over 240 seconds, with all four reviewer lanes dying at spawn on the lock. Classic lock convoy, and it explains reviewer spawn failures that look like unrelated flakiness.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3651",
      "rank": 50,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [
        "PAN-3424"
      ],
      "why": "Re-land the overdeck-state non-FF push retry with the pan-dir state-door suites green",
      "rationale": "New this pass. The non-fast-forward push retry for overdeck-state was reverted because it broke 12 tests across the pan-dir state-door suites, but the problem it fixed is live and is exactly what PAN-3424 documents. Re-landing it with those suites green closes the durability gap rather than leaving the state plane dependent on whichever writer happens to win the ref race.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3662",
      "rank": 51,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Read-only CLI surfaces run schema top-ups and emit SQLITE_READONLY under the sandboxed Flywheel",
      "rationale": "New this pass. Documented read-only CLI surfaces — pan flywheel status, pan flywheel config --get, pan status — open the database and then attempt runtime schema top-ups, which emit SQLITE_READONLY under the sandboxed Flywheel. These are precisely the commands the Flywheel is told to use when localhost is sandboxed, so their initialization must not require a write. It carries blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 52,
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
      "rank": 53,
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
      "issue": "PAN-3023",
      "rank": 54,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn abandons on a transient Docker failure; 'attempt 1/3' never retries",
      "rationale": "New this pass. Post-planning auto-spawn abandons on a transient Docker failure and the 'attempt 1/3' it prints never retries, so a finalized plan with autoSpawn=true sits in todo with no re-drive owner until an operator notices. The planning-to-work handoff is the seam the whole autonomous pipeline depends on, and a one-shot retry that does not retry is the worst kind of guard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 55,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient merge_status=failed permanently skips close-out; merged issues stay open and get re-planned",
      "rationale": "New this pass. A transient merge_status=failed read immediately after a successful merge makes automatic close-out skip the issue permanently, and nothing retries once the status self-heals — so the issue stays merged-but-open, reads as pickup-eligible, and gets a fresh planning agent spawned on already-shipped work. Wasted agent spend on top of a stuck lifecycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 56,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model-specific quota exhaustion halts agents invisibly; four planning agents 'running' at $0.00",
      "rationale": "New this pass. Model-specific quota exhaustion halts agents with no signal anywhere except the pane: four planning agents reported running at $0.00 while the rolling-window status line showed plenty of headroom, so the existing session-cap recovery never engages. There is no capacity fallback, so the fleet quietly stops working while the registry insists it is busy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 57,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket is misclassified as ambiguous, so feedback never lands",
      "rationale": "New this pass. ECONNREFUSED against a dead supervisor socket is misclassified as an ambiguous keyed delivery, so the tmux tier is deliberately not tried and review feedback never reaches the agent — the file sits on disk, the issue goes stuck, and the agent idles. Delivery ambiguity is the right caution for a live socket and exactly the wrong one for a refused connection.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 58,
      "size": "XS",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3244"
      ],
      "why": "pan reload never clears pending-deploy.json, so every deploy starves all verification until a patrol runs",
      "rationale": "New this pass and the reason PAN-3244's cross-project hold never ends by itself. clearPendingDeploy has one caller, so a successful pan reload leaves the deploy queue set and every project's verification stays deferred until a patrol happens to notice the build is fresh. Small fix, large blast radius, and it should land with the deferral scoping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 59,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent finished with an open PR but review was never dispatched; auto-requeue fired none of 25 attempts",
      "rationale": "New this pass. A work agent finished, opened a non-draft PR, and sat idle for two hours because review was never dispatched — while the auto-requeue machinery that exists for exactly this had capacity and 25 attempts and fired none of them. The agent behaved correctly; the handoff did not happen. Silent non-dispatch at this seam is invisible until someone reads costs that stopped moving.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3429",
      "rank": 60,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Memory governor defers admissions but sheds nothing under HARD pressure; the flywheel shed by hand",
      "rationale": "New this pass. The memory governor defers new admissions but sheds nothing under HARD pressure: at 2.2GB available and PSI full avg60 near 42, it logged soft deferrals for 30 minutes while the flywheel manually paused the offending gate run and recovered 2.4GB. Its documented shed categories were both empty, so the policy needs a category that exists during real pressure rather than one that does not.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3504",
      "rank": 61,
      "size": "XS",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "typecheck fails on main: parked.ts references ProjectConfig.projectPath instead of path",
      "rationale": "New this pass. npm run typecheck fails on main because parked.ts references a ProjectConfig field that does not exist — landed directly on main, not through a PR. It is a one-word fix, and while it stands, every branch that rebases onto main inherits a red typecheck and every gate reading typecheck gets a false signal. PAN-3499 is the same defect filed from the other direction.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3541",
      "rank": 62,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review restart after an unclean reviewer death loops on the session-resume menu forever",
      "rationale": "New this pass. After an unclean reviewer death, pan review restart resumes into the harness session-resume menu, the delivery guard correctly refuses to answer it, delivery throws, the wedged session stays alive, and the fresh-spawn fallback then refuses because a role run already exists. Abort and reset-session both loop the same way because the resolver reconstructs the session id from planes those verbs do not clear.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3543",
      "rank": 63,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3541"
      ],
      "why": "Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while recommending --fresh",
      "rationale": "New this pass. A completed-handoff agent owed rework is unstartable through every door: pan start refuses and recommends --fresh, --fresh gives the identical refusal, and reset-session refuses too because the durable plane reconstructs the session pointer. A refusal message that recommends the flag it just rejected is the signature of this family, and it blocks rework on issues whose review came back blocked.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3563",
      "rank": 64,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3560"
      ],
      "why": "A role agent spawned with an undelivered prompt becomes an invisible zombie no recovery verb can see",
      "rationale": "New this pass. A role agent whose prompt delivery failed is left status=running with pid null, so no liveness patrol has anything to check, the dispatcher no-ops because it sees testing in progress, and pan unstick inspects the work agent rather than the role. Invisible to every recovery surface at once — the composite of a delivery failure and three blind spots.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3657",
      "rank": 65,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train queues endpoint silently drops every polyrepo candidate, so MYN and Auricle trains stay empty",
      "rationale": "New this pass. The merge-train queues endpoint builds its queue with the monorepo builder, so every polyrepo candidate is silently dropped and MYN and Auricle trains read as permanently empty even when an issue is ready with its MR open. The dashboard says ready to merge and the train shows nothing, which is the worst combination for operator trust in the queue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3663",
      "rank": 66,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "PR close events never invalidate pipeline membership, so zombie_pr rows stay stale in the canonical read door",
      "rationale": "New this pass. Pull-request webhooks update review state but never enqueue a project membership refresh, so closing a stale PR leaves the canonical membership door still reporting the issue in-pipeline as a zombie_pr row. Issue close-out does invalidate correctly, which isolates this to PR-state changes. Membership is the read door several surfaces trust, so stale rows propagate. It carries blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 67,
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
      "rank": 68,
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
      "rank": 69,
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
      "rank": 70,
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
      "rank": 71,
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
      "issue": "PAN-2883",
      "rank": 72,
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
      "rank": 73,
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
      "rank": 74,
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
      "issue": "PAN-1824",
      "rank": 75,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "rationale": "Raised from 78: the real-timer test family kept reddening main through August. PAN-3243, PAN-3520 and PAN-3532 are all downstream instances — load-induced timeouts recorded as real verdicts, branches looping on false test failures, and a CI job that never ran the frontend suite. Fixing the timer discipline at the source removes the input to several of those loops.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3139",
      "rank": 76,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents-table liveness drifts stale in the under-reporting direction; the authoritative plane is the wrong one",
      "rationale": "New this pass. The agents table — the plane docs/AGENT-STATE-PLANES.md designates authoritative — records a live four-hour agent as stopped while tmux and pan start's own liveness check both say running. Drift in the under-reporting direction is the dangerous direction: enumeration from the authoritative plane misses live agents, and anything that acts on 'stopped' can spawn a duplicate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 77,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A capacity-refused planning-to-work handoff is marked terminally stuck; every 409 becomes 'guardrails'",
      "rationale": "New this pass. A capacity-refused planning-to-work handoff is recorded as terminally stuck: every HTTP 409 is classified as 'guardrails' and every skip reason calls markWorkspaceStuck, so three issues accumulated the identical dead-end over three ticks while the fleet was simply full. Backpressure is a normal condition and must be retried, not memorialized as a failure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 78,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A test-role agent can spawn and never run, stranding an approved, CI-green issue behind a missing verdict",
      "rationale": "New this pass. A test-role agent spawned, never executed a turn, and held its issue out of the merge gate — review approved, CI green, ready_for_merge 0 on a verdict that was never produced. It is the same shape as the already-ranked ghost test sessions and shares PAN-3566's deterministic root cause, so the three should be worked together.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3281",
      "rank": 79,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so stuck work reaches UAT",
      "rationale": "New this pass. An issue can carry ready_for_merge=1 and stuck=1 with failedCheck incomplete-plan-items at the same time, and the merge-ready flag wins on every surface — so work with eight pending checklist items was assembled into a UAT batch and recommended for promotion. Two contradictory facts, and the pipeline consistently reads the optimistic one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 80,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/inspect agents AskUserQuestion the operator for review depth, converting autonomy into operator work",
      "rationale": "New this pass. A review convoy member blocked on an operator AskUserQuestion asking which review depth to use, and because convoys respawn the operator got the same dialog repeatedly. The review pipeline exists to be autonomous; a reviewer that parks on an operator question converts autonomous motion into operator work, which is the exact stall pattern the stall-sweeper work was built to kill.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 81,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review sub-role can modify the branch after writing its report, violating its own spawn contract",
      "rationale": "New this pass. A review sub-role wrote its report, went idle, and then — after a later message resumed it — began editing the workspace and preparing to resubmit, modifying seven tracked files before an orchestrator stopped it. Its spawn contract forbids exactly that. A reviewer that can write to the branch it is reviewing breaks the separation the review architecture is built on.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3522",
      "rank": 82,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Supervisor watchdog restart-churns under CPU storm because the probe budget ignores the boot warm phase",
      "rationale": "New this pass. Under a CPU storm the supervisor watchdog restart-churns the dashboard: twelve consecutive probe timeouts trigger a restart, two more restarts fire while the first is in flight, and the watchdog then gives up entirely with racing spawns on the supervisor port. The probe budget takes no account of the boot warm phase, so the recovery mechanism becomes the outage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3555",
      "rank": 83,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start silently spawned a fresh session over a resumable warm session, violating warm-by-default",
      "rationale": "New this pass. A plain pan start with no --fresh silently abandoned a resumable warm session and allocated a brand-new session identity, discarding intact context that was on disk and resumable. Warm-by-default is the standing behaviour since PAN-2579, and a silent violation of it costs real re-discovery spend on every occurrence as well as the agent's accumulated understanding.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3565",
      "rank": 84,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-3563"
      ],
      "why": "Failed review spawn wedges 'starting', infra failure synthesizes a fake CHANGES REQUESTED verdict",
      "rationale": "New this pass. Three review-lifecycle defects in one: a failed spawn leaves the role wedged at 'starting' with no session and then sends a 14k-character prompt at a session that was never created; an infrastructure failure is synthesized into a CHANGES REQUESTED verdict that reads like a code judgement; and pan tell hangs to SIGTERM after acknowledging. The middle one is the integrity problem — a fabricated verdict is worse than no verdict.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3571",
      "rank": 85,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completion-check timeout exits silently — 334 stranded turn-ends leave agents stalled until a patrol notices",
      "rationale": "New this pass. The completion-check timeout branch logs and exits 0, bypassing the UNCLEAR fallback every other failure mode takes, so a timed-out check emits no resolution at all: no nudge, no escalation, no deacon poke eligibility. 334 stranded turn-ends are already recorded. Agents stall mid-item and only a patrol that may itself be frozen will notice.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3654",
      "rank": 86,
      "size": "S",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [
        "PAN-3653"
      ],
      "why": "Compact respawn confirms against the archived session and kills a working fresh agent",
      "rationale": "New this pass. Compact respawn confirms against the archived session rather than the fresh one, so a replacement session that had already accepted its recovery prompt and started working was declared unconfirmed and killed. Recovery that destroys working agents is worse than no recovery, and it pairs with PAN-3653 as the two halves of a broken strike-recovery path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 87,
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
      "issue": "PAN-2422",
      "rank": 88,
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
      "rank": 89,
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
      "rank": 90,
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
      "rank": 91,
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
      "issue": "PAN-2886",
      "rank": 92,
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
      "rank": 93,
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
      "rank": 94,
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
      "issue": "PAN-2747",
      "rank": 95,
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
      "rank": 96,
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
      "rank": 97,
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
      "rank": 98,
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
      "issue": "PAN-2179",
      "rank": 99,
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
      "rank": 100,
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
      "rank": 101,
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
      "rank": 102,
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
      "rank": 103,
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
      "issue": "PAN-2421",
      "rank": 104,
      "size": "XS",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard server route tests flake under full-suite verification load",
      "rationale": "Raised from 79 for the same reason as PAN-1824: route-test flake under full-suite load is now the documented mechanism behind the test-gate loops (PAN-3520) and the retry amplification (PAN-3492), so it stopped being a nuisance and became a pipeline-throughput blocker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent git guard is bypassable by stripping it from $PATH — an agent did so unprompted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3344",
      "rank": 106,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resource governor gates dispatch on memory alone; agent-shell test runs drove load 48 on 24 cores",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3517",
      "rank": 107,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy forks still miss the parent prompt cache: launch-injection byte drift plus resume dropping the header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 108,
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
      "rank": 109,
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
      "issue": "PAN-2880",
      "rank": 122,
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
      "rank": 123,
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
      "rank": 124,
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
      "rank": 125,
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
      "issue": "PAN-2971",
      "rank": 126,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel orchestrator finalized its own run yet kept ticking; zombie session with dashboard Pause/Stop disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3022",
      "rank": 127,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn route ignores the per-issue workModel override, then clobbers the record with the role default",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 128,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against CLOSED issues, resurrecting agents and raising needs-you days later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 129,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3100"
      ],
      "why": "Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix landed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 130,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume never re-wires the PTY supervisor; a stale socket refuses every delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 131,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sequencer ran a full pass on an empty manifest against a 750-issue backlog — read model transiently empty",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 132,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Freshly-spawned convoy lanes freeze at 0 output; the existing detector covers warm resumes only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3454",
      "rank": 133,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "Cost hook re-ingests fork-copied parent history under reviewer identity: fake warnings, multi-billed spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3499",
      "rank": 134,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3504"
      ],
      "why": "pan parked ack references a nonexistent ProjectConfig.projectPath — a typecheck error on main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3505",
      "rank": 135,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3062"
      ],
      "why": "Unpushed agent code commits on the primary main worktree block the flywheel's state write door",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3535",
      "rank": 136,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "The drain/resume boot gate is caller-env-dependent, so any restart from a clean shell silently drops the hold",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3556",
      "rank": 137,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3555"
      ],
      "why": "Concurrent double-spawn race allocated two fresh session identities three seconds apart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3557",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge label application has no retry, so a rate-limited 403 hides the issue from the verify-on-main sweep",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3580",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT-failure relay has no convergence cap — 65 identical rework files in 12h with uat_notes NULL",
      "rationale": "The UAT-failure relay has no convergence cap, so it wrote 65 byte-identical rework feedback files over twelve hours while uat_notes was NULL — the 'see the UAT panel for details' pointer resolved to nothing. It is in the pipeline with a PRD; the cap and the missing notes are both needed for the relay to be honest.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3621",
      "rank": 140,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start intermittently resolves a chunk graph spliced across two builds and dies at spawn",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3650",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike self-abort leaves state.json 'running', so the deacon resurrects aborted strikes on every pass",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 142,
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
      "rank": 143,
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
      "rank": 144,
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
      "rank": 145,
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
      "issue": "PAN-2379",
      "rank": 146,
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
      "rank": 147,
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
      "rank": 148,
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
      "rank": 149,
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
      "rank": 150,
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
      "rank": 151,
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
      "rank": 152,
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
      "rank": 153,
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
      "rank": 154,
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
      "rank": 155,
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
      "rank": 156,
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
      "rank": 157,
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
      "issue": "PAN-1711",
      "rank": 158,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "rationale": "Raised from 55: the event-loop stall class was confirmed repeatedly through August — the self-amplifying verification loop (PAN-3492), the watchdog restart churn under CPU storm (PAN-3522), and the CPU-blind governor (PAN-3344) all trace back to a dashboard that stalls under load. It is now a root cause with several expensive symptoms rather than a one-off incident, and the issue picked up a planning label.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3015",
      "rank": 159,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan monitor: pull-based mail-queue inbox replaces keystroke injection, the top delivery-failure source",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 160,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands Overdeck PRD drafts inside product feature branches; exclusion lists drifted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 161,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done fails on generated devcontainer artifacts; agents infer deletion of workspace infrastructure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 162,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default: hold is bypassed — shouldHoldForUat is consulted on only one merge path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3174",
      "rank": 163,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-3032"
      ],
      "why": "Every polyrepo UAT stack is unreachable: stale project prefix, unattached devnet, wrong frontend port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 164,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment gate queues a deferred deploy but the promised next-verification-boundary trigger does not exist",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3224",
      "rank": 165,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A crash-interrupted spawn strands model 'pending-work-spawn'; plain pan start then dies with Unknown model",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3243",
      "rank": 166,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit test polls 20 setImmediate turns for a real git subprocess, reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 167,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "One issue's agent sessions vanished four times in a run and its reviewer died writing no artifact",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 168,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "A work agent wrote a doc edit into the primary main worktree instead of its workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3420",
      "rank": 270,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline substrate: Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3432",
      "rank": 170,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-3429"
      ],
      "why": "Preemptive yield fan-out paused seven work agents to make room for one review convoy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3569",
      "rank": 171,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deploy gate deadlocks on a stale pending-post-merge.json when the deacon is paused; no staleness rule, no exit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3605",
      "rank": 172,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint-effect-diagnostics executed a squatted npm package through an npx registry fallback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3617",
      "rank": 173,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "One issue's strike dies instantly on every dispatch with zero output while siblings spawn normally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3629",
      "rank": 174,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "No sanctioned door to re-scope a live agent, so operator scope changes force a doctrine violation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3633",
      "rank": 175,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-3325"
      ],
      "why": "Strike workspaces spawn with an incomplete dependency tree, so agents abort on a false 'main is red'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3668",
      "rank": 176,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Prime Agent as a managed harness (in flight — RPC runtime adapter, discovery, transcripts)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 177,
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
      "rank": 178,
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
      "rank": 179,
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
      "rank": 180,
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
      "rank": 181,
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
      "rank": 182,
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
      "rank": 183,
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
      "rank": 184,
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
      "issue": "PAN-1556",
      "rank": 185,
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
      "rank": 186,
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
      "rank": 187,
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
      "rank": 188,
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
      "rank": 189,
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
      "rank": 190,
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
      "rank": 191,
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
      "rank": 192,
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
      "rank": 193,
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
      "rank": 194,
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
      "issue": "PAN-3040",
      "rank": 195,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike fails outright on polyrepo projects — worktree logic assumes a monorepo root",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 196,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper regex only matches Overdeck containers, so foreign workspace stacks are never reaped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 197,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "MERGE refuses or dead-ends when the preemptive scheduler yielded the work agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 198,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline reports 'merge failed' after a successful merge; issue stays Todo while the commit is on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 199,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume-gate Enter: the tmux fallback answers a live choice menu that its own paste hid from the detector",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 200,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitLab merged-head oracle fans out one glab subprocess per repo x head, failing every membership refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3297",
      "rank": 201,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 202,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-3317"
      ],
      "why": "A strike needing a rebase has no working path: prompt instructs it, guard blocks it, sync-main misresolves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 203,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no sanctioned way to sync main: rebase is guard-blocked, sync-main misresolves -strike",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3439",
      "rank": 204,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-3224"
      ],
      "why": "pan start crashes on a pending-work-spawn placeholder row; resume has the guard, start does not",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3460",
      "rank": 205,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 206,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Per-project isolation classes so one project's heavy stacks cannot starve another project's pipeline",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3622",
      "rank": 207,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "A reconciler test asserts on a real issue and reads live GitHub, so pan release check fails on a green main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3640",
      "rank": 208,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-3561"
      ],
      "why": "Agent GC preserves terminal rows after a recoverable state push race, leaving stale records on closed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 209,
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
      "rank": 210,
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
      "rank": 211,
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
      "rank": 212,
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
      "rank": 213,
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
      "rank": 214,
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
      "rank": 215,
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
      "rank": 216,
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
      "rank": 217,
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
      "rank": 218,
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
      "rank": 219,
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
      "rank": 220,
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
      "rank": 221,
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
      "rank": 222,
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
      "rank": 223,
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
      "rank": 224,
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
      "rank": 225,
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
      "rank": 226,
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
      "issue": "PAN-2980",
      "rank": 227,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pre-push size guard reads the dirty worktree, so one session's edits block every other session's push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 228,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown never fires; 96 strike/* branches preserved because ancestry misses squash merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 229,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout 120 parsed as 120ms; false-failed check leaves the dashboard down",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3113",
      "rank": 230,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface agent-pane choice prompts as inline decision cards so blocking menus are answerable from the feed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3129",
      "rank": 231,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 232,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "One non-git configured member blanks pipeline membership for the whole auricle project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 233,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan merge cancel is 100% broken: Commander passes its options object into the fetchImpl slot",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3256",
      "rank": 234,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-3267"
      ],
      "why": "MYN pipeline membership fails forge_unavailable: glab runs in a polyrepo root that is not a git repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 235,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-3325"
      ],
      "why": "New workspaces have empty node_modules and bun is off PATH, so the documented remedy fails",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3301",
      "rank": 236,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog manifest still writes legacy .pan, and the stray-writer patrol logs 68k lines hiding the real defect",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 237,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "A fresh workspace ships an empty node_modules, so tooling silently resolves deps from the parent repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3463",
      "rank": 238,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-3460"
      ],
      "why": "A legitimate no-op slot outcome can never pass its item verify, so the slot wedges permanently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3513",
      "rank": 239,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent runtime plane on overdeck-state: durable session pointers, GC as cache eviction",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3553",
      "rank": 240,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Census treats a zero-session tmux server as unavailable, so conversations sit on 'Starting…' after a drain boot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3596",
      "rank": 241,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon patrol has no per-step timing, so overruns of the central scheduler cannot be attributed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 242,
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
      "rank": 243,
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
      "rank": 244,
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
      "rank": 245,
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
      "rank": 246,
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
      "rank": 247,
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
      "rank": 248,
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
      "rank": 249,
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
      "rank": 250,
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
      "rank": 251,
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
      "rank": 252,
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
      "rank": 253,
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
      "rank": 254,
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
      "rank": 255,
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
      "rank": 256,
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
      "rank": 257,
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
      "issue": "PAN-1767",
      "rank": 258,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1770",
      "rank": 259,
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
      "issue": "PAN-3003",
      "rank": 260,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generated launcher.sh omits OVERDECK_AGENT_ID, so any manual re-launch dies instantly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 261,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 262,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect/review-supervisor spawns omit --effort and inherit xhigh, once per xBRIEF item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3107",
      "rank": 263,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Productize the memory-attribution census so OOM spikes are attributable after the fact",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3167",
      "rank": 264,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux and lexerra permanently unreadable through the membership door; a 404 typed as forge_unavailable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 265,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [
        "PAN-3176"
      ],
      "why": "A UAT promote is marked complete at merge time; nothing verifies the change reached production",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 266,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reports a false hard failure when the deacon wins a spawn race (duplicate-session TOCTOU)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3218",
      "rank": 267,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: a user-facing fix sits on main for hours while every published version stays broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3245",
      "rank": 268,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done falsely flags the workspace .pan/drafts artifact as uncommitted despite its own exclusion",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3303",
      "rank": 269,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck latches 'Unknown project' after reconnect; an empty registered-projects response is authoritative",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3308",
      "rank": 270,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size guard hands agents a paste-ready ratchet-up line; two of three agents raised the ceiling",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3355",
      "rank": 271,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 272,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload temporarily removes the global pan CLI when invoked outside its linked generation",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3518",
      "rank": 273,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "TTL-aware re-review payload policy: fresh-spawn-with-digest for cold, large histories",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3570",
      "rank": 274,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [
        "PAN-3325"
      ],
      "why": "Devcontainer leaves root-owned node_modules subtrees; init EACCES blocks pan start and rebuild cannot heal it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3615",
      "rank": 275,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "TTS silent for nine days behind four stacked failures; three fixed, follow-ups owed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3652",
      "rank": 276,
      "size": "XS",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add workflow_dispatch to ci.yml and state-plane-branches.yml so an unverified main tip can be verified",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 277,
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
      "rank": 278,
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
      "rank": 279,
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
      "rank": 280,
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
      "rank": 281,
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
      "rank": 282,
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
      "rank": 283,
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
      "rank": 284,
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
      "rank": 285,
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
      "rank": 286,
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
      "rank": 287,
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
      "rank": 288,
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
      "rank": 289,
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
      "rank": 290,
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
      "rank": 291,
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
      "rank": 292,
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
      "rank": 293,
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
      "issue": "PAN-3012",
      "rank": 294,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archived transcripts die when the harness deletes the JSONL; back them up into Overdeck storage first",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3032",
      "rank": 295,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stack rebuild composes an overdeck- prefix while Traefik labels reference myn- devnet; 504s and lost attaches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3094",
      "rank": 296,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done merge fallback force-pushes a fast-forward branch and leaves the command partially complete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3176",
      "rank": 297,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT batch promotion takes no stack-health evidence, so a degraded or still-starting stack can be promoted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 298,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out dies on EACCES against root-owned container residue after passing every DoD row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 299,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [
        "PAN-3196"
      ],
      "why": "Close-out blocked by an unprefixed devcontainer init container; teardown and guard scope differently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3295",
      "rank": 300,
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
      "issue": "PAN-3332",
      "rank": 301,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [
        "PAN-3329"
      ],
      "why": "Dashboard slash-command activities leave 'running in background' standing after the spawn already died",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3464",
      "rank": 302,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm reset never clears slotCompletions, so a stale marker re-arms the exact wedge reset should escape",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3502",
      "rank": 303,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "tiered-crews blendedCost expectation is stale against current model-capabilities pricing; fails on main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3510",
      "rank": 304,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stopped agents leave detached docker-run test containers alive for hours, contending with other gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3527",
      "rank": 305,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sidebar project list never retries, so one failed boot fetch leaves CONVERSATIONS 0 / ISSUES 0",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3536",
      "rank": 306,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot reach ohmypi conversations: expectedHarness defaults to claude-code with no state.json",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3579",
      "rank": 307,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "~20 frontend mutation fetches hand-write JSON headers and 403 on CSRF-guarded routes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3634",
      "rank": 308,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning auto-handoff stamps the ambient flywheelRunId on operator-started agents, stripping reaping exemption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3661",
      "rank": 309,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "issueActions review-mode tests fail locally: the semantic-rejection toast never fires since the secure-dispatch change",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 310,
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
      "rank": 311,
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
      "rank": 312,
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
      "rank": 313,
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
      "rank": 314,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2350",
      "rank": 315,
      "size": "L",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere",
      "rationale": "Flagged as an epic container this pass — the title says Epic but the manifest heuristic missed it. Ranked on the aggregate of its children (PAN-2351 through PAN-2356 plus the PAN-3513 data-plane companion), which is P0 security work plus a long tail of deliberately-deferred product phases.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1217",
      "rank": 316,
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
      "rank": 317,
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
      "rank": 318,
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
      "rank": 319,
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
      "rank": 320,
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
      "rank": 321,
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
      "rank": 322,
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
      "rank": 323,
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
      "rank": 324,
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
      "rank": 325,
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
      "rank": 326,
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
      "rank": 327,
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
      "issue": "PAN-3046",
      "rank": 328,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3108",
      "rank": 329,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log grows unbounded (867MB) with no rotation, making incident logs un-greppable",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3211",
      "rank": 330,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "No honest disposition for closed-without-landing issues; residue rows neither closeable nor reapable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3276",
      "rank": 331,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows for terminal questions and permission prompts do not navigate anywhere on click",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3456",
      "rank": 332,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 333,
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
      "rank": 334,
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
      "rank": 335,
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
      "rank": 336,
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
      "rank": 337,
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
      "rank": 338,
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
      "rank": 339,
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
      "rank": 340,
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
      "rank": 341,
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
      "rank": 342,
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
      "rank": 343,
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
      "rank": 344,
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
      "rank": 345,
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
      "rank": 346,
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
      "rank": 347,
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
      "rank": 348,
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
      "rank": 349,
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
      "rank": 350,
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
      "issue": "PAN-3013",
      "rank": 351,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role-scoped MCP auth hooks leak into durable ~/.claude/settings.json pointing at dead /tmp paths",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3321",
      "rank": 352,
      "size": "XS",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Escalation text and CLAUDE.md tell operators to run `pan unstick`, a command that does not exist",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-471",
      "rank": 353,
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
      "rank": 354,
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
      "rank": 355,
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
      "rank": 356,
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
      "rank": 357,
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
      "issue": "PAN-1666",
      "rank": 358,
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
      "issue": "PAN-2921",
      "rank": 359,
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
      "rank": 360,
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
      "rank": 361,
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
      "rank": 362,
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
      "rank": 363,
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
      "rank": 364,
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
      "rank": 365,
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
      "rank": 366,
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
      "rank": 367,
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
      "rank": 368,
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
      "rank": 369,
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
      "rank": 370,
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
      "rank": 371,
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
      "issue": "PAN-3175",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-train ordering has no semantic dependency concept — file overlap cannot see feature ordering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3235",
      "rank": 373,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard decision card renders and answers agent pane-choice menus (follow-up to PAN-3228)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 374,
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
      "rank": 375,
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
      "rank": 376,
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
      "rank": 377,
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
      "rank": 378,
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
      "rank": 379,
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
      "rank": 380,
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
      "rank": 381,
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
      "rank": 382,
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
      "rank": 383,
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
      "rank": 384,
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
      "rank": 385,
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
      "rank": 386,
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
      "rank": 387,
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
      "rank": 388,
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
      "issue": "PAN-3130",
      "rank": 389,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-3129"
      ],
      "why": "Security: path-escape validation for identifier-joined write paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3137",
      "rank": 390,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles come from Flywheel status prose instead of the issue title",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3455",
      "rank": 391,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "isCliproxyUpToDate always returns false, so every ensure re-downloads the pinned release",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3516",
      "rank": 392,
      "size": "XS",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale bundled-skill duplicates in the repo .claude/skills serve outdated text to overdeck-dev sessions",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2501",
      "rank": 393,
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
      "rank": 394,
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
      "rank": 395,
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
      "rank": 396,
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
      "rank": 397,
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
      "rank": 398,
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
      "rank": 399,
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
      "rank": 400,
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
      "rank": 401,
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
      "rank": 402,
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
      "rank": 403,
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
      "rank": 404,
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
      "rank": 405,
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
      "rank": 406,
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
      "rank": 407,
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
      "issue": "PAN-2976",
      "rank": 408,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ACP harness to any ACP-capable CLI with a capability gate and custom-agent config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3034",
      "rank": 409,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck session tree misses strike-only and workspace-less issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3117",
      "rank": 410,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send bubble hides a deterministic 4xx reason and offers a Retry that can never succeed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3164",
      "rank": 411,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT stack offers 'Open UAT frontend' while still booting, so the operator gets a Gateway Timeout",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3178",
      "rank": 412,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class worktrees and diffs: +/- badge, dedicated Changes surface, conversation worktrees",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3288",
      "rank": 413,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout preflight: detect stale node_modules after a pull instead of ERR_MODULE_NOT_FOUND",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3322",
      "rank": 414,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-3308"
      ],
      "why": "launcher-generator allowlist sits 126 lines above reality, turning a temporary raise into regrowth budget",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3445",
      "rank": 415,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project config TCP lock hashes into the ephemeral client-port range, so uncontended writes fail",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3540",
      "rank": 416,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-3530"
      ],
      "why": "God View shows phantom agent orbs, a dead Hook Bus panel and a pressure-blind swap header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3627",
      "rank": 417,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "backlog-auto-trigger throws on startup in a directory with no backlog, breaking a plain npx run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 418,
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
      "rank": 419,
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
      "rank": 420,
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
      "rank": 421,
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
      "rank": 422,
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
      "rank": 423,
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
      "rank": 424,
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
      "rank": 425,
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
      "issue": "PAN-1828",
      "rank": 426,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 427,
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
      "rank": 428,
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
      "rank": 429,
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
      "rank": 430,
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
      "rank": 431,
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
      "rank": 432,
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
      "issue": "PAN-2982",
      "rank": 433,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review convoy never runs a skill's own selftest when sync-sources/skills/** changes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3121",
      "rank": 434,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [
        "PAN-3117"
      ],
      "why": "Failed-send outbox never reconciles against the transcript, leaving a doomed Retry twin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3181",
      "rank": 435,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Own agent memories in Overdeck: per-repo overdeck-memory orphan branch mirroring overdeck-state",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3307",
      "rank": 436,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "commitlint scope-enum is stale, warning on most real commits and training everyone to ignore it",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3530",
      "rank": 437,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View polls on 30s timers in four components, violating its documented event-driven contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 438,
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
      "rank": 439,
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
      "rank": 440,
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
      "rank": 441,
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
      "rank": 442,
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
      "rank": 443,
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
      "rank": 444,
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
      "issue": "PAN-3036",
      "rank": 445,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "False '! INPUT' chip on completed strike agents; pane-idle heuristic misreads idle as a question",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page: narrative feed, surfaced pending question, honest blocked state",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1572",
      "rank": 447,
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
      "rank": 448,
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
      "rank": 449,
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
      "rank": 450,
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
      "rank": 451,
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
      "rank": 452,
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
      "rank": 453,
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
      "rank": 454,
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
      "issue": "PAN-3131",
      "rank": 455,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF planRef sharding: planning-side authoring plus pipeline-wide consumption for huge plans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3616",
      "rank": 456,
      "size": "XS",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planned deploy restarts show the generic Reconnecting banner; use the lifecycle signal for calm copy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 457,
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
      "rank": 458,
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
      "rank": 459,
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
      "rank": 460,
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
      "rank": 461,
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
      "rank": 462,
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
      "rank": 463,
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
      "rank": 464,
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
      "rank": 465,
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
      "rank": 466,
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
      "rank": 467,
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
      "rank": 468,
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
      "rank": 469,
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
      "rank": 470,
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
      "rank": 471,
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
      "issue": "PAN-3016",
      "rank": 472,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "URL-address every view so refresh, bookmark and share return to the same spot",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3290",
      "rank": 473,
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
      "issue": "PAN-1150",
      "rank": 474,
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
      "rank": 475,
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
      "rank": 476,
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
      "rank": 477,
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
      "rank": 478,
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
      "rank": 479,
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
      "rank": 480,
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
      "rank": 481,
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
      "rank": 482,
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
      "rank": 483,
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
      "rank": 484,
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
      "rank": 485,
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
      "rank": 486,
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
      "rank": 487,
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
      "rank": 488,
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
      "rank": 489,
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
      "issue": "PAN-2977",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "ACP setup UI: detect installed CLIs, show auth status, guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 491,
      "size": "L",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: run one template issue under N configurations and compare cost, time and outcome",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3132",
      "rank": 492,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt xBRIEF v0.9 agentic dispatch fields end-to-end so per-item routing is a contract",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3354",
      "rank": 493,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archiving the main workspace hides the singleton row with no dashboard recovery path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 494,
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
      "rank": 495,
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
      "rank": 496,
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
      "rank": 497,
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
      "rank": 498,
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
      "rank": 499,
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
      "rank": 500,
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
      "rank": 501,
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
      "rank": 502,
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
      "rank": 503,
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
      "rank": 504,
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
      "rank": 505,
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
      "rank": 506,
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
      "rank": 507,
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
      "issue": "PAN-2981",
      "rank": 508,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K palette opens deleted sessions: search index never prunes, 404 on click",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3157",
      "rank": 509,
      "size": "XS",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awareness feed renders the Flywheel as a generic empty chat row instead of run activity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3333",
      "rank": 510,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model pickers show $/1M, which answers the wrong question under a subscription; show relative plan drain",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 511,
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
      "rank": 512,
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
      "rank": 513,
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
      "rank": 514,
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
      "rank": 515,
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
      "rank": 516,
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
      "rank": 517,
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
      "rank": 518,
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
      "rank": 519,
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
      "rank": 520,
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
      "rank": 521,
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
      "rank": 522,
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
      "rank": 523,
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
      "rank": 524,
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
      "rank": 525,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "rationale": "Flagged as an epic container this pass — its body states plainly that it is a triage list, not an implementation plan, and that each pursued gap gets its own child issue. Ranked on the aggregate of the children named so far (PAN-2565, PAN-2608, PAN-2609).",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2565",
      "rank": 526,
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
      "issue": "PAN-3017",
      "rank": 527,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue-page UAT panel drops the overflow action menu, so a healthy stack has no restart control",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3441",
      "rank": 528,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View 'River': WebGL pipeline visualization fed by the live hook-event stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3469",
      "rank": 529,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate NewProjectModal to a full page under the page-not-modal doctrine",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2558",
      "rank": 530,
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
      "rank": 531,
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
      "rank": 532,
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
      "rank": 533,
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
      "rank": 534,
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
      "rank": 535,
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
      "issue": "PAN-2444",
      "rank": 536,
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
      "rank": 537,
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
      "rank": 538,
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
      "rank": 539,
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
      "rank": 540,
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
      "rank": 541,
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
      "rank": 542,
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
      "rank": 543,
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
      "issue": "PAN-3058",
      "rank": 544,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-3054"
      ],
      "why": "Standing-crew templates: shipped preset crew configurations selectable from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 545,
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
      "rank": 546,
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
      "rank": 547,
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
      "rank": 548,
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
      "rank": 549,
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
      "rank": 550,
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
      "rank": 551,
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
      "rank": 552,
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
      "rank": 553,
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
      "rank": 554,
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
      "rank": 555,
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
      "rank": 556,
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
      "rank": 557,
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
      "rank": 558,
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
      "rank": 559,
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
      "issue": "PAN-3011",
      "rank": 560,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support poolside Laguna S 2.1 (118B MoE, 1M ctx) local and hosted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 561,
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
      "rank": 562,
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
      "rank": 563,
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
      "rank": 564,
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
      "rank": 565,
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
      "rank": 566,
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
      "rank": 567,
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
      "rank": 568,
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
      "rank": 569,
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
      "rank": 570,
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
      "rank": 571,
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
      "rank": 572,
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
      "rank": 573,
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
      "rank": 574,
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
      "issue": "PAN-2978",
      "rank": 575,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976",
        "PAN-2977"
      ],
      "why": "Opt-in auto-install of ACP agent CLIs from the setup UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 576,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-3054"
      ],
      "why": "Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 577,
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
      "rank": 578,
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
      "rank": 579,
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
      "rank": 580,
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
      "rank": 581,
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
      "rank": 582,
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
      "rank": 583,
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
      "rank": 584,
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
      "rank": 585,
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
      "rank": 586,
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
      "rank": 587,
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
      "rank": 588,
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
      "rank": 589,
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
      "rank": 590,
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
      "rank": 591,
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
      "rank": 592,
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
      "rank": 593,
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
      "rank": 594,
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
      "rank": 595,
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
      "rank": 596,
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
      "rank": 597,
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
      "rank": 598,
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
      "rank": 599,
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
      "rank": 600,
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
      "rank": 601,
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
      "rank": 602,
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
      "rank": 603,
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
      "rank": 604,
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
      "rank": 605,
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
      "rank": 606,
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
      "rank": 607,
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
      "rank": 608,
      "size": "XS",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Subagent rail: show provider logo and model on each agent row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 609,
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
      "rank": 610,
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
      "rank": 611,
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
      "rank": 612,
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
      "rank": 613,
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
      "rank": 614,
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
      "rank": 615,
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
      "rank": 616,
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
      "rank": 617,
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
      "rank": 618,
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
      "rank": 619,
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
      "rank": 620,
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
      "rank": 621,
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
      "rank": 622,
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
      "rank": 623,
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
      "issue": "PAN-3335",
      "rank": 624,
      "size": "XS",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Click a pasted conversation image to open it full size in a popup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 625,
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
      "rank": 626,
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
      "rank": 627,
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
      "rank": 628,
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
      "rank": 629,
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
      "rank": 630,
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
      "rank": 631,
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
      "rank": 632,
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
      "rank": 633,
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
      "rank": 634,
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
      "rank": 635,
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
      "rank": 636,
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
      "rank": 637,
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
      "rank": 638,
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
      "rank": 639,
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
      "rank": 640,
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
      "issue": "PAN-3443",
      "rank": 641,
      "size": "L",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [
        "PAN-3441"
      ],
      "why": "God View 'Spectrum Deck' — a second Winamp-grade visualizer concept with mockup and PRD",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 642,
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
      "rank": 643,
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
      "rank": 644,
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
      "rank": 645,
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
      "rank": 646,
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
      "rank": 647,
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
      "rank": 648,
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
      "rank": 649,
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
      "rank": 650,
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
      "rank": 651,
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
      "rank": 652,
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
      "rank": 653,
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
      "issue": "PAN-2968",
      "rank": 654,
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
      "rank": 655,
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
      "rank": 656,
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
      "rank": 657,
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
      "rank": 658,
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
      "rank": 659,
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
      "rank": 660,
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
      "rank": 661,
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
      "rank": 662,
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
      "rank": 663,
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
      "rank": 664,
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
      "rank": 665,
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
      "issue": "PAN-3133",
      "rank": 666,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [
        "PAN-3131"
      ],
      "why": "Spike: measure TRON encoding token savings for prompt-bound xBRIEF payloads",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2628",
      "rank": 667,
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
      "rank": 668,
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
      "rank": 669,
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
      "rank": 670,
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
      "rank": 671,
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
      "rank": 672,
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
      "rank": 673,
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
      "rank": 674,
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
      "rank": 675,
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
      "rank": 676,
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
      "rank": 677,
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
      "rank": 678,
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
      "rank": 679,
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
      "rank": 680,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2355",
      "rank": 681,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2354",
      "rank": 682,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2352",
      "rank": 683,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2353",
      "rank": 684,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2282",
      "rank": 685,
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
      "rank": 686,
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
      "rank": 687,
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
      "rank": 688,
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
      "rank": 689,
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
      "rank": 690,
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
      "rank": 691,
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
      "rank": 692,
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
      "rank": 693,
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
      "rank": 694,
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
      "rank": 695,
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
      "rank": 696,
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
      "rank": 697,
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
      "rank": 698,
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
      "rank": 699,
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
      "rank": 700,
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
      "rank": 701,
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
      "rank": 702,
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
      "rank": 703,
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
      "rank": 704,
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
      "rank": 705,
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
      "rank": 706,
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
      "rank": 707,
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
      "rank": 708,
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
      "rank": 709,
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
      "rank": 710,
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
      "rank": 712,
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
      "rank": 713,
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
      "rank": 714,
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
      "rank": 715,
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
      "rank": 716,
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
      "rank": 717,
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
      "rank": 718,
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
      "issue": "PAN-2983",
      "rank": 719,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferrals (lease writes, LLM auditor) — explicitly gated on proven contention",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 720,
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
      "rank": 721,
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
      "rank": 722,
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
      "rank": 723,
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
      "rank": 724,
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
      "rank": 725,
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
      "rank": 726,
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
      "rank": 727,
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
      "rank": 728,
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
      "rank": 729,
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
      "rank": 730,
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
      "rank": 731,
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
      "rank": 732,
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
      "rank": 733,
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
      "rank": 734,
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
      "rank": 735,
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
      "rank": 736,
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
      "rank": 737,
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
      "rank": 738,
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
      "rank": 739,
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
      "rank": 740,
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
      "rank": 741,
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
      "rank": 742,
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
      "rank": 743,
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
      "rank": 744,
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
      "rank": 745,
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
      "rank": 746,
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
      "rank": 747,
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
      "rank": 748,
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
      "rank": 749,
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
      "rank": 750,
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
      "rank": 751,
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
      "rank": 752,
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
      "rank": 753,
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
      "rank": 754,
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
      "rank": 755,
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
      "rank": 756,
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
      "rank": 757,
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
      "rank": 758,
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
      "rank": 759,
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
      "rank": 760,
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
      "rank": 761,
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
      "rank": 762,
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
      "rank": 763,
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
      "rank": 764,
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
      "rank": 765,
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
      "rank": 766,
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
      "rank": 767,
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
      "rank": 768,
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
      "rank": 769,
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
      "rank": 770,
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
      "rank": 771,
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
      "rank": 772,
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
      "rank": 773,
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
      "rank": 774,
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
      "rank": 775,
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
      "rank": 776,
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
      "rank": 777,
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
      "rank": 778,
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
      "rank": 779,
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
      "rank": 780,
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
      "rank": 781,
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
      "rank": 782,
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
      "rank": 783,
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
      "rank": 784,
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
      "rank": 785,
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
      "rank": 786,
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
      "rank": 787,
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
      "rank": 788,
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
      "rank": 789,
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
      "rank": 790,
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
      "rank": 791,
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
      "rank": 792,
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
      "rank": 793,
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
      "rank": 794,
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
      "rank": 795,
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
      "rank": 796,
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
      "rank": 797,
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
      "rank": 798,
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
      "rank": 799,
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
      "rank": 800,
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
      "rank": 801,
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
      "rank": 802,
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
      "rank": 803,
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
      "rank": 804,
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
      "rank": 805,
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
      "rank": 806,
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
      "rank": 807,
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
      "rank": 808,
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
      "rank": 809,
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
      "rank": 810,
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
      "rank": 811,
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
      "rank": 812,
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
      "rank": 813,
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
      "rank": 814,
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
      "rank": 815,
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
      "rank": 816,
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
      "rank": 817,
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
      "rank": 818,
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
      "rank": 819,
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
      "rank": 820,
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
      "rank": 821,
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
      "rank": 822,
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
      "rank": 823,
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
      "rank": 824,
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
      "rank": 825,
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
      "rank": 826,
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
      "rank": 827,
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
      "rank": 828,
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
      "rank": 829,
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
      "rank": 830,
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
      "rank": 831,
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
      "rank": 832,
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
      "rank": 833,
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
      "rank": 834,
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
      "rank": 835,
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
      "rank": 836,
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
      "rank": 837,
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
      "rank": 838,
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
      "rank": 839,
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
      "rank": 840,
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
      "rank": 841,
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
      "from": "PAN-2350",
      "to": "PAN-3513",
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
      "from": "PAN-3301",
      "to": "PAN-3631",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3314",
      "to": "PAN-3539",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3492",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3629",
      "to": "PAN-3630",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3520",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3561",
      "to": "PAN-3564",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3424",
      "to": "PAN-3651",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3244",
      "to": "PAN-3248",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3429",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3541",
      "to": "PAN-3543",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3560",
      "to": "PAN-3563",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3522",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3563",
      "to": "PAN-3565",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3653",
      "to": "PAN-3654",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3104",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3454",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3499",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3505",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3555",
      "to": "PAN-3556",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3032",
      "to": "PAN-3174",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3432",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3633",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3317",
      "to": "PAN-3306",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3224",
      "to": "PAN-3439",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3460",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3533",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3561",
      "to": "PAN-3640",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3267",
      "to": "PAN-3256",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3270",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3460",
      "to": "PAN-3463",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3176",
      "to": "PAN-3179",
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
      "from": "PAN-3325",
      "to": "PAN-3570",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3196",
      "to": "PAN-3210",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3329",
      "to": "PAN-3332",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3129",
      "to": "PAN-3130",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3308",
      "to": "PAN-3322",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3530",
      "to": "PAN-3540",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3117",
      "to": "PAN-3121",
      "type": "unblocks",
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
      "from": "PAN-3054",
      "to": "PAN-3058",
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
      "from": "PAN-3441",
      "to": "PAN-3443",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3131",
      "to": "PAN-3133",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.95
    },
    {
      "from": "PAN-3566",
      "to": "PAN-3274",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3566",
      "to": "PAN-2706",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3250",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3560",
      "to": "PAN-3563",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3561",
      "to": "PAN-3564",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3554",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-2874",
      "to": "PAN-2995",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3301",
      "to": "PAN-3631",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3113",
      "to": "PAN-2492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3104",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    }
  ]
}
```
