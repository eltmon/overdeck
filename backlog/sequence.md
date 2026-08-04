# Backlog Sequence

_Last sequenced: 2026-08-04T03:45:08Z · model: claude-opus-5 · open: 814_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3511 | M | critical | ok |  |  | Verdict-of-record contract: every recovery path must read the synthesis artifact before acting on a review row |
| 2 | PAN-3512 | M | critical | ok |  | PAN-3511 | Verdict write door — recordReviewVerdict + dispatch-not-drop + fallback kill-conditional (write side) |
| 11 | PAN-3422 | M | critical | ok |  |  | Nudge/feedback text lands in the composer but is never submitted — 4 agents wedged idle 20m–2.5h with visible text |
| 14 | PAN-3450 | S | high | ok |  |  | In pipeline (in review): pan sync never prunes removed skills/rules from cache and harness dirs |
| 14 | PAN-1230 | M | medium | ok |  |  | Command Deck right-pane Pipeline-lens + TopBar height (PAN-1148 follow-up) |
| 15 | PAN-3524 | M | critical | ok |  |  | P0: server-owned --changed verification loop survives Deacon freeze, review abort, pause and operator-stop |
| 16 | PAN-3504 | XS | critical | ok |  |  | typecheck fails on main: parked.ts references nonexistent ProjectConfig.projectPath |
| 17 | PAN-3499 | XS | critical | ok |  | PAN-3504 | pan parked ack references nonexistent ProjectConfig.projectPath — same red-main tsc error |
| 18 | PAN-3502 | XS | critical | ok |  |  | tiered-crews blendedCost expectation stale vs current pricing — red on main |
| 19 | PAN-3532 | S | critical | ok |  |  | CI never runs the full frontend test suite — main was red on frontend while CI reported green |
| 20 | PAN-2746 | XS | critical | ok |  | PAN-2742, PAN-2695 | infra-failure bypass writes reviewStatus='passed' |
| 21 | PAN-3283 | S | critical | ok |  |  | Recovery from review_infrastructure_failure sets review_status=passed despite CHANGES REQUESTED |
| 22 | PAN-2689 | S | critical | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost |
| 23 | PAN-2695 | S | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume |
| 24 | PAN-2742 | S | high | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' |
| 25 | PAN-3282 | M | critical | ok |  |  | Review agents repeatedly die before writing a verdict across 5 issues and 2 projects |
| 26 | PAN-3397 | S | high | ok |  |  | Freshly-spawned convoy lanes freeze at 0 output before processing kickoff |
| 27 | PAN-3084 | S | high | ok |  |  | A review session spawned but never briefed sits at zero context forever and blocks its replacement |
| 28 | PAN-3500 | S | high | ok |  |  | Review sub-role can modify the branch after writing its report — violates its own spawn contract |
| 29 | PAN-3496 | S | high | ok |  |  | Review/inspect agents must not AskUserQuestion the operator for review depth — decide, do not ask |
| 30 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch |
| 31 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json |
| 32 | PAN-3274 | S | high | ok |  |  | A test-role agent can spawn and never run, stranding its issue behind a verdict never produced |
| 33 | PAN-3104 | S | high | ok |  |  | Stale .pan/test/result.json re-applied with no freshness check, re-failing an issue after the fix landed |
| 34 | PAN-3100 | S | high | ok |  |  | Test role evaluates the dirty working tree, so a live work agent uncommitted edits cause false failures |
| 35 | PAN-3520 | M | critical | ok |  | PAN-3344 | Test gate must retry timeout-only failures in isolation before recording a verdict — load-flake loops |
| 36 | PAN-3492 | M | critical | ok |  | PAN-3344 | Server-side gate retries form a self-amplifying load loop: timeouts cause retries which cause timeouts |
| 37 | PAN-2733 | S | high | ok |  |  | substrate-bug-poller has never run |
| 38 | PAN-1560 | XS | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 39 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes |
| 40 | PAN-3281 | S | high | ok |  |  | ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so stuck work reaches UAT |
| 41 | PAN-2828 | S | critical | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 42 | PAN-2874 | M | critical | ok |  | PAN-2828 | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli… |
| 43 | PAN-2883 | M | high | ok |  | PAN-2828 | Close-out deploy row fails for every strike-landed issue |
| 44 | PAN-2806 | S | high | ok |  |  | strike merge trigger registry splits across dashboard chunks |
| 45 | PAN-2796 | S | high | ok |  |  | idle nudge must not advance after failed mandatory inspection |
| 46 | PAN-3417 | S | high | ok |  |  | Strike agents have no merged-awareness — they keep verifying after their branch lands |
| 47 | PAN-2995 | S | high | ok |  |  | pan done --strike false-blocks after a gh-API squash-merge; should verify PR-merged, not ancestry |
| 48 | PAN-3047 | S | high | ok |  |  | Strike-branch teardown never fires: --is-ancestor cannot detect a squash merge, 96 branches residue |
| 49 | PAN-3306 | S | high | ok |  | PAN-3317 | A strike that needs a rebase has no working path: prompt instructs it, guard blocks it, sync-main misses |
| 50 | PAN-3317 | S | high | ok |  |  | Strike agents have no sanctioned way to sync main: rebase guard-blocked, sync-main cannot resolve -strike |
| 51 | PAN-3040 | M | high | ok |  |  | pan strike fails on polyrepo projects — monorepo-shaped worktree logic end to end |
| 52 | PAN-2940 | M | critical | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI |
| 53 | PAN-3250 | M | critical | ok |  |  | Workspace spawn branches from local HEAD instead of origin/main — every new workspace inherits unpushed work |
| 54 | PAN-3062 | M | critical | ok |  |  | Shared primary main worktree: any agent that pushes main also ships every other session unpushed commits |
| 55 | PAN-3505 | S | high | ok |  |  | Unpushed agent code commits on the primary main worktree block the flywheel state write door |
| 56 | PAN-3081 | M | high | ok |  |  | Agent git guard is bypassable by removing it from $PATH — an agent did so unprompted |
| 57 | PAN-3284 | S | high | ok |  |  | Work agent wrote a doc edit into the primary main worktree instead of its workspace |
| 58 | PAN-3424 | M | critical | ok |  |  | State plane silently stops being durable: non-FF overdeck-state push never reconciled, drafts never staged |
| 59 | PAN-3285 | M | critical | ok |  |  | Supervisor pinned to a reload generation kills every healthy dashboard and can never restart one — 3.5h outage |
| 60 | PAN-2932 | S | high | ok |  | PAN-2337 | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 61 | PAN-2935 | S | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router |
| 62 | PAN-3523 | S | high | ok |  |  | Workspace UAT containers crash-loop: peer dashboard starts the host-only CLIProxy watchdog (ENOENT) |
| 63 | PAN-3497 | XS | high | ok |  | PAN-3523 | CLIProxy watchdog crashes peer-dashboard workspace containers — missing ~/.overdeck/bin/cliproxy by design |
| 64 | PAN-2337 | XS | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 65 | PAN-2422 | XS | high | ok |  | PAN-2337 | rebuilding dist under a live server breaks lazy chunk imports |
| 66 | PAN-3329 | S | critical | ok |  |  | Deployment generation node_modules + tracked packages/ files deleted while a dev-checkout build runs |
| 67 | PAN-3508 | XS | high | ok |  |  | pan reload temporarily removes the global pan CLI when invoked outside its linked generation |
| 68 | PAN-2699 | XS | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle |
| 69 | PAN-2957 | XS | high | ok |  | PAN-2337 | npm run build intermittently produces stale frontend bundles |
| 70 | PAN-2850 | M | high | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 71 | PAN-3362 | M | high | ok |  |  | No way to seed tracker-backed issue fixtures in workspace containers — every UI-redesign UAT is environment-blocked |
| 71 | PAN-3244 | S | high | ok |  |  | Queued dashboard deploy globally defers verification — deploy window starves cross-project review handoffs |
| 72 | PAN-3248 | S | high | ok |  |  | pan reload does not clear pending-deploy.json, so every deploy starves verification for ALL projects |
| 73 | PAN-3205 | S | high | ok |  |  | Deployment gate queues a deferred deploy but never fires it — the promised trigger does not exist |
| 74 | PAN-3522 | S | high | ok |  |  | Dashboard supervisor watchdog restart-churns under CPU storm: probe timeout ignores boot warm phase |
| 75 | PAN-3344 | M | critical | ok |  |  | Resource governor should gate dispatch on CPU load, not memory alone — load 48 on 24 cores with memory fine |
| 76 | PAN-3429 | M | critical | ok |  |  | Memory governor defers admissions but sheds nothing under HARD pressure — PSI 41.9 with 2.2GB available |
| 77 | PAN-3533 | L | high | ok |  |  | Resource segregation: per-project isolation classes so one project stacks cannot starve another pipeline |
| 78 | PAN-3314 | M | high | ok |  |  | Bound the OOM blast radius: one cgroup holds every agent, so one hungry agent can kill the whole fleet |
| 79 | PAN-3510 | S | high | ok |  |  | Stopped agents can leave detached docker-run test containers alive indefinitely, contending with other gates |
| 80 | PAN-3534 | M | high | ok |  |  | TLDR integration: keep the Read-interception savings, cut the 37.5GB/CPU/dead-metrics costs |
| 81 | PAN-3107 | M | medium | ok |  |  | Productize the memory-attribution census — OOM spikes are unattributable after the fact |
| 82 | PAN-3108 | XS | high | ok |  |  | dashboard.log grows unbounded (867MB) — no rotation |
| 83 | PAN-2758 | S | critical | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 84 | PAN-2886 | M | high | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 85 | PAN-3439 | XS | high | ok |  |  | pan start crashes on a pending-work-spawn placeholder row instead of taking the fresh-spawn path |
| 86 | PAN-3224 | S | high | ok |  | PAN-3439 | A crash-interrupted spawn strands model pending-work-spawn; plain pan start dies with Unknown model |
| 87 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 88 | PAN-2813 | M | high | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 89 | PAN-3432 | M | high | ok |  |  | Preemptive yield fan-out — 7 work agents simultaneously yielded for ONE review convoy |
| 90 | PAN-3120 | S | high | ok |  |  | MERGE refuses (polyrepo) or dead-ends (single-repo) when the scheduler yielded the work agent |
| 91 | PAN-2848 | S | critical | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a… |
| 92 | PAN-3078 | S | high | ok |  |  | Inspect verdict is never delivered to the work agent — an agent that waits for it deadlocks forever |
| 93 | PAN-2846 | S | critical | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 94 | PAN-3168 | S | high | ok |  |  | DoD row 5 deadlocks close-out: an agent paused FOR close-out with no session counts as running |
| 95 | PAN-3188 | S | high | ok |  |  | DoD row 5 rejects terminal canonical states — an already-done issue can never satisfy the post-merge row |
| 96 | PAN-3103 | S | high | ok |  |  | Transient merge_status=failed skips close-out permanently, leaving a merged issue open and pickup-eligible |
| 97 | PAN-3171 | S | high | ok |  |  | Pipeline reports merge failed AFTER a successful merge and cleanup; issue stays Todo with no label |
| 98 | PAN-3190 | XS | high | ok |  |  | pan merge cancel is 100% broken: Commander passes its options object into the fetchImpl slot |
| 99 | PAN-3211 | M | medium | ok |  |  | No honest disposition for closed-without-landing issues — residue rows neither close-able nor reaped |
| 100 | PAN-3196 | S | high | ok |  |  | Close-out cannot tear down workspaces containing root-owned container residue (EACCES) |
| 101 | PAN-3210 | S | high | ok |  |  | Close-out blocked by an unprefixed devcontainer init container: teardown and guard scope differently |
| 102 | PAN-2747 | S | high | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 103 | PAN-2759 | S | high | ok |  |  | Dead flywheel with an active run was never auto-relaunched after a reboot |
| 104 | PAN-2971 | M | high | ok |  |  | Flywheel orchestrator finalized its own run but kept running — zombie session, controls disabled |
| 105 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target |
| 106 | PAN-2668 | M | high | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents |
| 107 | PAN-3236 | S | high | ok |  |  | ECONNREFUSED on a dead supervisor socket misclassified as ambiguous keyed delivery — feedback never lands |
| 108 | PAN-3085 | XS | high | ok |  |  | Review feedback written to .overdeck/feedback but agents are pointed at a nonexistent .pan/feedback |
| 109 | PAN-3044 | S | high | ok |  |  | Review feedback delivery runs against CLOSED issues: resurrects agents and raises needs-you 12 days later |
| 110 | PAN-3234 | M | high | ok |  |  | Agents freeze indefinitely on blocking choice menus and nothing detects it — detector wired only to delivery |
| 111 | PAN-3261 | S | high | ok |  |  | Resume-gate Enter: tmux fallback answers a live choice menu when its own paste hides the menu |
| 112 | PAN-3257 | S | high | ok |  |  | Crash-resume does not re-wire the PTY supervisor — stale socket refuses all deliveries |
| 113 | PAN-3525 | M | high | ok |  |  | Resume-into-compaction silently drops the continuation; recovery is a polling patrol, not a hook |
| 114 | PAN-3057 | M | high | ok |  |  | Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice |
| 115 | PAN-3297 | S | high | ok |  |  | pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart |
| 116 | PAN-2569 | XS | critical | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn |
| 117 | PAN-2567 | S | critical | ok |  |  | reviewed+green PR stuck after review |
| 118 | PAN-3278 | S | high | ok |  |  | Work agent finished with an open PR but review was never dispatched — auto-requeue fired none of 25 |
| 119 | PAN-3237 | S | high | ok |  |  | A capacity-refused planning-to-work handoff is marked terminally stuck: every HTTP 409 becomes guardrails |
| 120 | PAN-3023 | S | high | ok |  |  | Post-planning auto-spawn abandoned on transient Docker failure — attempt 1/3 never retries |
| 121 | PAN-3185 | S | high | ok |  |  | pan start reports a false hard failure when the deacon wins a spawn race (duplicate-session TOCTOU) |
| 122 | PAN-2179 | S | high | ok |  |  | relaunch can leave a zombie agent |
| 123 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS |
| 124 | PAN-3118 | M | high | ok |  |  | Model quota exhaustion halts agents invisibly — 4 planning agents running at $0.00 with no fallback |
| 125 | PAN-3043 | S | high | ok |  |  | Mid-run provider quota exhaustion undetected: agent stays running for days holding a slot |
| 126 | PAN-3313 | S | high | ok |  |  | A transient upstream stream error benches the only CLIProxy auth — 70% of GPT-routed inference 503s |
| 127 | PAN-3455 | XS | medium | ok |  |  | isCliproxyUpToDate always returns false — every ensure re-downloads the pinned release |
| 128 | PAN-2775 | S | high | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04… |
| 129 | PAN-3280 | S | high | ok |  |  | Agent sessions vanish repeatedly (4x in one run) and a reviewer died writing no artifact, all silently |
| 130 | PAN-3139 | S | high | ok |  |  | Agents-table liveness drifts stale in the under-reporting direction: a live 4h agent is recorded stopped |
| 131 | PAN-3355 | XS | high | ok |  |  | sessionExists maps a probe failure to absence, so callers read not-running when liveness is unknown |
| 132 | PAN-2734 | S | high | ok |  |  | merge queue head-of-line zombie |
| 133 | PAN-3477 | S | high | ok |  |  | Merged slot sessions are never reaped and get auto-resumed forever, consuming swarm capacity indefinitely |
| 133 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 134 | PAN-3526 | S | high | ok |  |  | pan start --fresh: destructive wipe runs BEFORE the guard that refuses it |
| 135 | PAN-3498 | S | high | ok |  |  | write-sequence pins in-pipeline ranks without renumbering — duplicate ranks and gaps in the sequence |
| 136 | PAN-3289 | S | medium | ok |  |  | Sequencer ran a full pass on an empty manifest against a 750-issue backlog — read model transiently empty |
| 137 | PAN-3517 | M | high | ok |  |  | Convoy forks still miss the parent prompt cache in production — injection byte drift + dropped scope header |
| 138 | PAN-3454 | S | high | ok |  |  | Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated warnings, double billing |
| 139 | PAN-3518 | M | medium | ok |  | PAN-3517 | TTL-aware re-review payload policy — fresh-spawn-with-digest for cold, large histories |
| 140 | PAN-3077 | XS | high | ok |  |  | Inspect/review-supervisor spawns omit --effort, inheriting the harness xhigh default per xBRIEF item |
| 141 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery |
| 142 | PAN-2888 | M | high | ok |  | PAN-2846 | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO… |
| 143 | PAN-2960 | S | high | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict |
| 144 | PAN-2959 | S | high | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit |
| 145 | PAN-2639 | S | high | ok |  | PAN-2331 | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 146 | PAN-2331 | S | high | ok |  |  | codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) |
| 147 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully |
| 148 | PAN-2511 | XS | high | ok |  |  | Work agents burn 20+ min on false test failures |
| 149 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 150 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push |
| 151 | PAN-2763 | S | high | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution |
| 152 | PAN-3325 | S | high | ok |  |  | Fresh workspace ships an EMPTY node_modules, so tooling silently resolves deps from the parent repo |
| 153 | PAN-3270 | S | high | ok |  |  | New workspaces have empty node_modules and bun is off PATH, so the documented remedy fails |
| 154 | PAN-3288 | S | medium | ok |  |  | dev-checkout preflight — detect stale node_modules after git pull instead of ERR_MODULE_NOT_FOUND |
| 155 | PAN-2170 | XS | high | ok |  |  | Docker init container lacks Python |
| 156 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 157 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 158 | PAN-2954 | XS | critical | ok |  |  | postMergeLifecycle refuses GitLab projects |
| 159 | PAN-2880 | M | high | ok |  | PAN-2259 | Linear tracker listIssues is a 3N+1 request storm |
| 160 | PAN-3267 | M | high | ok |  |  | GitLab merged-head oracle fans out one glab subprocess per repo x head, stalling every refresh |
| 161 | PAN-3256 | S | high | ok |  |  | MYN pipeline membership fails forge_unavailable — glab runs in a path that is not a git repository |
| 162 | PAN-3186 | S | high | ok |  |  | Pipeline membership blanks the whole auricle project because one configured member is not a git repo |
| 163 | PAN-3167 | S | high | ok |  |  | krux and lexerra unreadable through the membership door: a 404 is typed as forge_unavailable |
| 164 | PAN-2966 | S | high | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev |
| 165 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 166 | PAN-3427 | M | high | ok |  |  | Order books are unreachable for every project except the dashboard server’s own cwd project |
| 166 | PAN-3245 | S | high | ok |  |  | pan done completion gate falsely flags workspace .pan/drafts as uncommitted despite its own exclusion |
| 167 | PAN-3096 | S | high | ok |  |  | pan done fails on the generated devcontainer harness — agents infer deletion of workspace infrastructure |
| 168 | PAN-3420 | M | medium | ok |  |  | Dashboard and pan show render a completed, closed-out issue as never-started (post-close-out history wipe) |
| 168 | PAN-3048 | S | high | ok |  |  | Pipeline auto-commit lands .pan/drafts into product feature branches; exclusion list has drifted |
| 169 | PAN-3094 | XS | medium | ok |  |  | pan done merge fallback force-pushes a fast-forward branch |
| 170 | PAN-2680 | M | high | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 171 | PAN-2627 | S | high | ok |  |  | Linear poller is blind after cycle rollover |
| 172 | PAN-2324 | XS | high | ok |  |  | label transition fails atomically on missing 'in-planning' label |
| 173 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans… |
| 174 | PAN-2905 | S | high | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s |
| 175 | PAN-2259 | S | critical | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota |
| 176 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 177 | PAN-2421 | XS | high | ok |  |  | dashboard server route tests flake under full-suite verification load |
| 178 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 179 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH |
| 180 | PAN-2656 | S | high | ok |  |  | deacon-swarm unit tests read live ~/.overdeck/config.yaml |
| 181 | PAN-1824 | S | high | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 182 | PAN-3243 | S | high | ok |  |  | auto-commit test flakes on main by polling fixed setImmediate turns for a real git subprocess |
| 183 | PAN-3445 | S | medium | ok |  |  | Project config TCP lock collides with ephemeral client ports, failing uncontended config writes |
| 184 | PAN-2075 | XL | high | ok | ✓ |  | Boot Reconciliation + Operator Inbox |
| 185 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) |
| 186 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 187 | PAN-2079 | M | high | ok |  | PAN-2077 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 188 | PAN-2080 | M | high | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) |
| 189 | PAN-1775 | M | high | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 190 | PAN-454 | XS | high | ok |  | PAN-2077 | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 191 | PAN-1436 | S | high | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 192 | PAN-2642 | XL | high | ok | ✓ |  | Cost strategy: waste detection over budget policing |
| 193 | PAN-1868 | XS | high | ok |  | PAN-2466 | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 194 | PAN-2466 | S | high | ok |  |  | close-out/record writer clobbers closeOut.usage with EMPTY data |
| 195 | PAN-1042 | S | high | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 196 | PAN-570 | XS | high | ok |  | PAN-2642 | Show PLAN badge on costs when under a subscription/plan |
| 197 | PAN-3418 | S | high | ok |  |  | Empty-string conversation model is stored, never backfilled, and blanks the harness+model chips |
| 197 | PAN-3333 | S | medium | ok |  |  | Relative plan-drain indicator on model pickers — show which sibling model burns plan quota fastest |
| 198 | PAN-106 | M | high | stale |  |  | Cost prediction/estimation for in-progress work |
| 199 | PAN-2059 | XL | high | ok | ✓ |  | Backlog pickup gate |
| 200 | PAN-2376 | XL | high | ok |  |  | Epic: CI/CD reliability |
| 201 | PAN-1666 | XL | medium | ok | ✓ |  | Pipeline Throughput Hardening |
| 202 | PAN-1556 | S | high | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 203 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 204 | PAN-2189 | L | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) |
| 205 | PAN-2190 | L | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) |
| 206 | PAN-2233 | L | high | ok |  |  | decompose merge-agent.ts (1,414 lines) into focused modules |
| 207 | PAN-2526 | M | high | ok |  |  | Refactor deacon.ts below file-size baseline |
| 208 | PAN-2008 | XS | high | ok |  | PAN-1936 | store-access guard |
| 209 | PAN-3322 | XS | medium | ok |  |  | file-size allowlist for launcher-generator.ts is 126 lines slack — a temporary ceiling became regrowth budget |
| 210 | PAN-3308 | S | high | ok |  |  | The file-size guard hands agents a paste-ready ratchet-up line — agents raise the ceiling instead of shrinking |
| 211 | PAN-2980 | S | medium | ok |  |  | pre-push file-size guard audits the dirty working tree, so another session edits block unrelated pushes |
| 212 | PAN-1936 | M | high | ok |  |  | Single source-of-truth reads |
| 213 | PAN-3513 | L | high | ok |  |  | Agent runtime plane on overdeck-state — durable session pointers, GC as cache eviction |
| 214 | PAN-1988 | M | high | ok |  | PAN-1936 | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 215 | PAN-1910 | XS | high | ok |  | PAN-1936 | fast-follow(PAN-1908): collapse issue status to ONE canonical field |
| 216 | PAN-1325 | M | high | ok |  |  | Artifact storage model is unsafe for polyrepo projects |
| 217 | PAN-1728 | S | high | ok |  |  | PAN-1700 agent committed .pan/specs/*.vbrief.json mutations |
| 218 | PAN-3301 | M | high | ok |  |  | Stray-writer warning is 68k log lines hiding one real defect: backlog manifest still writes legacy .pan |
| 219 | PAN-2651 | S | high | ok |  |  | simplify lifecycle reconciliation and add a safe post-planning reset |
| 220 | PAN-2678 | M | high | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 221 | PAN-2241 | S | high | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 222 | PAN-2242 | S | high | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 223 | PAN-3419 | S | high | ok |  |  | pan handoff has no --project: an isolated --cwd lands every successor outside all registered projects |
| 223 | PAN-2240 | S | high | ok |  |  | pan tell contradicts itself on dead ohmypi sessions |
| 224 | PAN-2243 | S | high | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 225 | PAN-2244 | S | high | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main |
| 226 | PAN-2202 | S | high | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion |
| 227 | PAN-2195 | M | high | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 228 | PAN-2237 | S | high | ok |  |  | pan plan done swallows vbrief quality lint details |
| 229 | PAN-3290 | XS | medium | ok |  |  | xBRIEF items can carry empty metadata.traces — docs items are invisible to requirement traceability |
| 230 | PAN-2487 | M | high | ok |  |  | CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 231 | PAN-2469 | M | high | ok |  |  | issue-level assembly owner |
| 232 | PAN-3179 | M | high | ok |  |  | A UAT promote is marked complete at merge time — nothing verifies the change reached production |
| 233 | PAN-3174 | M | high | ok |  |  | Every polyrepo UAT stack is unreachable: stale Traefik prefix, no devnet attach, wrong frontend port |
| 234 | PAN-3176 | S | high | ok |  |  | Block UAT batch promotion when the live stack is degraded, unknown, or still starting |
| 235 | PAN-3175 | M | medium | ok |  |  | Model explicit semantic dependencies in merge-train ordering — file overlap cannot see feature deps |
| 236 | PAN-3164 | S | medium | ok |  |  | UAT stack shows Open UAT frontend while still booting — operator gets Gateway Timeout with no signal |
| 237 | PAN-3137 | XS | medium | ok |  |  | UAT generation member titles are taken from the Flywheel status snapshot, so prose reaches the operator |
| 238 | PAN-3106 | S | high | ok |  |  | auto_merge_default hold is bypassed — shouldHoldForUat is consulted on only one merge path |
| 239 | PAN-3050 | S | high | ok |  |  | Idle-stack reaper is blind to non-Overdeck workspaces, so sibling-project stacks are never reaped |
| 240 | PAN-3032 | M | high | ok |  |  | Workspace stack rebuild composes under one prefix while Traefik labels reference another — 504s |
| 241 | PAN-2212 | M | high | ok |  |  | Swarm slot dispatch has no reserved budget |
| 242 | PAN-2213 | M | high | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 243 | PAN-3463 | S | high | ok |  |  | A legitimate no-op slot outcome (empty diff) can never pass its item verify — slot wedges permanently |
| 244 | PAN-3464 | XS | high | ok |  |  | pan swarm reset does not clear slotCompletions despite claiming to clear recorded slot state |
| 245 | PAN-3460 | S | high | ok |  |  | Per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive |
| 246 | PAN-3456 | XS | medium | ok |  |  | pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates |
| 247 | PAN-2211 | M | high | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 248 | PAN-2210 | M | high | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 249 | PAN-2201 | XS | high | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo |
| 250 | PAN-2718 | M | high | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag |
| 251 | PAN-3022 | S | high | ok |  |  | Work-spawn route ignores the per-issue workModel override — role default wins and clobbers the record |
| 252 | PAN-3003 | XS | high | ok |  |  | Work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly |
| 253 | PAN-3099 | XS | high | ok |  |  | pan restart --health-timeout 120 treated as 120ms; false-failed health check leaves the dashboard down |
| 254 | PAN-3321 | XS | medium | ok |  |  | Escalation messages and CLAUDE.md tell operators to run pan unstick, which does not exist |
| 255 | PAN-3307 | XS | high | ok |  |  | commitlint scope-enum is stale: warns on most real commits, still lists the removed beads scope |
| 256 | PAN-2646 | XS | high | ok |  |  | configurable global/project/issue policy UI with default OFF |
| 257 | PAN-2652 | M | high | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso… |
| 258 | PAN-2667 | M | high | ok |  |  | Reimplement the task-progress admission signal in resource discovery |
| 259 | PAN-3295 | M | medium | ok |  |  | Single per-machine completion-check summarizer with a queue plus first-class observability |
| 260 | PAN-2755 | S | high | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 261 | PAN-2754 | S | high | ok |  |  | `always` is inert |
| 262 | PAN-2809 | M | high | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 263 | PAN-2810 | M | high | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 264 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate |
| 265 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 266 | PAN-1710 | S | high | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 |
| 267 | PAN-3218 | M | high | ok |  |  | No release-drift signal: a user-facing fix can sit merged on main while every published version stays broken |
| 268 | PAN-1720 | S | high | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation |
| 269 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 270 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 271 | PAN-3410 | L | medium | ok |  |  | Style guide v2 — Geist type system, display scale, chips, soft cards, page-not-modal doctrine |
| 271 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** |
| 272 | PAN-1767 | M | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 273 | PAN-3129 | M | high | ok |  |  | Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths |
| 274 | PAN-3130 | S | medium | ok |  |  | Security: path-escape validation for identifier-joined write paths |
| 275 | PAN-3516 | XS | medium | ok |  |  | Stale bundled-skill duplicates in repo .claude/skills drift behind sync-sources |
| 276 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes |
| 277 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 278 | PAN-2266 | M | high | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 279 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 280 | PAN-3046 | XS | medium | ok |  |  | pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out |
| 281 | PAN-3303 | S | high | ok |  |  | Command Deck latches Unknown project after reconnect — empty registered-projects treated as authoritative |
| 282 | PAN-3527 | S | medium | ok |  |  | Sidebar project list never retries: one failed boot-time fetch leaves the panels empty until reload |
| 283 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks |
| 284 | PAN-687 | M | high | ok |  |  | Support OpenCode as alternative coding agent |
| 285 | PAN-466 | M | high | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 286 | PAN-465 | M | high | ok |  |  | Add OpenRouter as a model provider |
| 287 | PAN-463 | M | high | ok |  |  | Add Qwen 3.6+ model support |
| 288 | PAN-3276 | XS | medium | ok |  |  | Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing |
| 289 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 290 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 291 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 292 | PAN-3423 | M | medium | ok |  |  | Redesign SystemHealthPill popover: attention-grouped reasons, metered vitals, actionable agent alerts |
| 292 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier |
| 293 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 294 | PAN-3113 | M | medium | ok |  |  | Surface agent-pane choice prompts as inline decision cards in the conversation view |
| 295 | PAN-3235 | M | medium | ok |  |  | Dashboard decision card: render and answer agent pane-choice menus |
| 296 | PAN-3121 | S | medium | ok |  |  | Failed-send outbox does not reconcile against the transcript — delivered message keeps a doomed Retry twin |
| 297 | PAN-3117 | S | medium | ok |  |  | Failed-send bubble hides the deterministic 4xx reason and offers a Retry that can never succeed |
| 298 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 299 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 300 | PAN-1254 | L | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 301 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 302 | PAN-1915 | M | high | ok |  |  | enhancement(security): API key at-rest hardening |
| 303 | PAN-1435 | XS | high | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 304 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 305 | PAN-1640 | M | high | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 306 | PAN-2351 | XS | high | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 307 | PAN-2350 | L | high | ok | ✓ |  | Epic: Overdeck Anywhere |
| 308 | PAN-1217 | XS | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 309 | PAN-1218 | M | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 310 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 311 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 312 | PAN-1451 | M | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 313 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 314 | PAN-3411 | L | medium | ok |  | PAN-3410 | New Workspace as a full-page creation experience (replaces the modal) |
| 314 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit |
| 315 | PAN-1553 | M | high | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 316 | PAN-1504 | M | high | ok |  |  | pan hygiene |
| 317 | PAN-1480 | L | high | ok |  |  | TLDR: 93% bypass rate |
| 318 | PAN-1479 | M | high | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 319 | PAN-2950 | L | high | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 320 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 321 | PAN-2836 | M | high | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 322 | PAN-2830 | M | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in |
| 323 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve |
| 325 | PAN-2650 | L | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it |
| 326 | PAN-2549 | M | high | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 327 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 328 | PAN-2334 | XS | high | ok |  |  | write a Definition of Ready (DoR) |
| 329 | PAN-2308 | M | high | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal… |
| 330 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree |
| 331 | PAN-1984 | XS | high | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 332 | PAN-1913 | XS | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 333 | PAN-1906 | M | high | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 334 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 335 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 336 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 337 | PAN-807 | L | high | ok |  |  | Epic C: Workspace state sanity on spawn |
| 338 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 339 | PAN-3157 | XS | medium | ok |  |  | Awareness feed shows the Flywheel as a generic chat row instead of flywheel run activity |
| 340 | PAN-3036 | XS | medium | ok |  |  | False INPUT chip on completed strike agents — pane-idle heuristic misreads post-strike idle |
| 341 | PAN-3034 | S | medium | ok |  |  | Command Deck session tree misses strike-only and workspace-less issues |
| 342 | PAN-3332 | S | medium | ok |  |  | Dashboard slash-command activities: surface failure instead of leaving running-in-background standing |
| 343 | PAN-3013 | XS | medium | ok |  |  | linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp paths |
| 344 | PAN-3012 | M | medium | ok |  |  | Back up harness conversation transcripts before harnesses delete them |
| 345 | PAN-2982 | S | medium | ok |  |  | Review convoy should run skill selftests when sync-sources/skills changes |
| 346 | PAN-471 | M | high | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 347 | PAN-438 | M | high | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 348 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 349 | PAN-176 | M | high | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 350 | PAN-578 | M | high | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 351 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 352 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep |
| 353 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 354 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run |
| 355 | PAN-3015 | L | medium | ok |  |  | pan monitor: pull-based background inbox transport for Claude Code sessions |
| 356 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 357 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik… |
| 358 | PAN-2739 | S | medium | ok |  |  | first-completion detection throws every patrol cycle |
| 359 | PAN-2738 | S | medium | ok |  |  | strikes deadlock |
| 360 | PAN-2717 | S | medium | ok |  |  | conversation permission waits missing from Awareness; strengthen alert pulse |
| 361 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 362 | PAN-2696 | XS | medium | ok |  |  | Task views still speak beads vocabulary |
| 363 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) |
| 364 | PAN-2686 | XS | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 365 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 366 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck |
| 367 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 368 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 369 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 370 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 371 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations |
| 372 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 373 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 374 | PAN-2560 | M | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key |
| 375 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL |
| 376 | PAN-2550 | XS | medium | ok |  |  | npm test exits 0 despite root-suite failures |
| 377 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds |
| 378 | PAN-2546 | S | medium | ok |  |  | pan tell is codex-conversation-unaware |
| 379 | PAN-2506 | M | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 380 | PAN-2501 | S | medium | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 381 | PAN-2492 | S | medium | ok |  |  | pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard |
| 382 | PAN-2491 | M | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 383 | PAN-2489 | S | medium | ok |  |  | strike agents are invisible in the project issue tree |
| 384 | PAN-2484 | S | medium | ok |  |  | ready set misses merge-eligible issues without flywheel merge verbs |
| 385 | PAN-2465 | S | medium | ok |  |  | pan done's PR lookup fails at MYN polyrepo root |
| 386 | PAN-2454 | S | medium | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero |
| 387 | PAN-2428 | XS | medium | ok |  |  | MYN workspace Traefik routing broken post-rebrand |
| 388 | PAN-2423 | XS | medium | ok |  |  | pan workspace rebuild hardcodes 'overdeck-' compose project prefix |
| 389 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen |
| 390 | PAN-2414 | S | medium | ok |  |  | context-overflow recovery is inconsistent |
| 391 | PAN-2408 | S | medium | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree |
| 392 | PAN-2395 | S | medium | ok |  |  | one invalid tiered_execution enum poisons every config read |
| 393 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream |
| 394 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice |
| 395 | PAN-2981 | S | medium | ok |  |  | Ctrl-K palette: stale conversation hits 404 on open — search index never prunes deleted sessions |
| 396 | PAN-3014 | S | medium | ok |  |  | Background AI title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209 |
| 397 | PAN-3016 | L | medium | ok |  |  | URL-address every view: anywhere you navigate in Overdeck, the URL must get you back there |
| 398 | PAN-3531 | S | low | ok |  |  | Add Qwen3.8 Max (DashScope) model support |
| 399 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed |
| 400 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) |
| 401 | PAN-2186 | S | high | ok |  |  | post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 402 | PAN-2069 | XS | medium | ok |  |  | caveman: follow-up gaps |
| 403 | PAN-1918 | XS | medium | ok |  |  | full frontend vitest suite runs in no CI path |
| 404 | PAN-1912 | XS | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 405 | PAN-1846 | S | medium | ok |  |  | unbounded log growth |
| 406 | PAN-1577 | M | medium | ok |  |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 406 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY |
| 407 | PAN-1828 | S | medium | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness |
| 408 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry |
| 409 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main |
| 410 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 411 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil… |
| 412 | PAN-1761 | S | medium | ok |  |  | conversations endpoints fetched via relative /api path |
| 413 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 414 | PAN-1740 | XS | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 415 | PAN-1711 | S | medium | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 416 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace |
| 417 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 418 | PAN-1669 | S | medium | ok |  |  | restart-with-model doesn't emit a live event |
| 419 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness |
| 420 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr… |
| 421 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted |
| 422 | PAN-1572 | M | medium | ok |  |  | Settings permission-mode can desync from resolved config |
| 423 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted |
| 424 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 425 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 426 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 427 | PAN-1449 | S | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 428 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 429 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 430 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 431 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 432 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 433 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 434 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 435 | PAN-1392 | S | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 436 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots |
| 437 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions |
| 438 | PAN-1245 | M | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 439 | PAN-1244 | M | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 440 | PAN-1240 | S | medium | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 441 | PAN-1227 | S | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work |
| 442 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign |
| 443 | PAN-1173 | S | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 444 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders |
| 445 | PAN-1150 | S | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 446 | PAN-1149 | S | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 447 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 448 | PAN-1129 | S | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 449 | PAN-3178 | L | medium | ok |  |  | First-class worktrees and diffs: changes badge, dedicated Changes surface, conversation worktrees |
| 450 | PAN-3181 | L | medium | ok |  |  | Own agent memories in Overdeck: migrate harness project memories to a per-repo orphan branch |
| 451 | PAN-3090 | M | medium | ok |  |  | Simple issue page: narrative feed instead of raw transcript, surface the pending question |
| 452 | PAN-3354 | XS | medium | ok |  |  | Archiving the main workspace hides the singleton row with no UI recovery path |
| 453 | PAN-3530 | S | medium | ok |  |  | God View polls on 30s timers in four components, violating its documented event-driven contract |
| 454 | PAN-3017 | M | medium | ok |  |  | Issue-page UAT panel: expose the full stack action menu and show the panel consistently |
| 455 | PAN-1128 | S | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 456 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 457 | PAN-1068 | S | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 458 | PAN-1027 | S | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 459 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 460 | PAN-932 | S | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 461 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 462 | PAN-900 | S | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 463 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 464 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 465 | PAN-3061 | M | medium | ok |  |  | Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize |
| 466 | PAN-3058 | M | medium | ok |  |  | Standing-crew templates: ship preset crew configurations selectable from Settings |
| 467 | PAN-3054 | M | medium | ok |  |  | Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome |
| 468 | PAN-727 | M | medium | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 469 | PAN-681 | S | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 470 | PAN-538 | S | medium | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 471 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection |
| 472 | PAN-324 | XS | medium | stale |  |  | Agent detail pane missing Merge/Approve button |
| 473 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 474 | PAN-247 | S | medium | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 475 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 476 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 477 | PAN-178 | M | medium | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 478 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 479 | PAN-49 | XS | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 480 | PAN-1951 | M | medium | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 481 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 482 | PAN-1041 | M | medium | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 483 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 484 | PAN-863 | M | medium | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 485 | PAN-817 | M | medium | ok |  |  | Improve planning dialog layout and content fit |
| 486 | PAN-802 | M | medium | ok |  |  | Resume on conversation session forks instead of resuming |
| 487 | PAN-713 | M | medium | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 488 | PAN-700 | M | medium | ok |  |  | Detachable terminal for conversation view |
| 489 | PAN-646 | XS | medium | ok |  |  | Canceled issues: add guided Recover workflow |
| 490 | PAN-532 | M | medium | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 491 | PAN-2896 | M | medium | ok |  |  | Warm resource-discovery and membership caches at boot |
| 492 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 493 | PAN-2626 | M | medium | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 494 | PAN-2625 | XS | medium | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 495 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 496 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations |
| 497 | PAN-2582 | M | medium | ok |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 498 | PAN-2566 | L | medium | ok | ✓ |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 499 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 500 | PAN-2558 | L | high | ok |  |  | support polyrepo projects |
| 501 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action |
| 502 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility |
| 503 | PAN-2548 | XS | medium | ok |  |  | close the PAN-2541 legacy-fallback deprecation window |
| 504 | PAN-2521 | S | high | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 505 | PAN-2493 | M | medium | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 506 | PAN-2976 | L | medium | ok |  |  | Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime |
| 507 | PAN-2977 | M | medium | ok |  | PAN-2976 | ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings |
| 508 | PAN-2978 | M | low | ok |  | PAN-2976 | Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes) |
| 509 | PAN-2444 | L | medium | ok |  |  | optional SageOx re-integration |
| 510 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv |
| 511 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane |
| 512 | PAN-2409 | M | medium | ok |  |  | enforce the workspace boundary |
| 513 | PAN-2399 | M | medium | ok |  |  | wire replay_threshold/compaction_reroute into the slot-recovery respawn seam |
| 514 | PAN-2392 | M | medium | ok |  |  | Standing Crew cost panel |
| 515 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues |
| 516 | PAN-2295 | L | medium | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 517 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call |
| 518 | PAN-2065 | M | medium | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 519 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 520 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 521 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 522 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 523 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 524 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 525 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 526 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 527 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 528 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 529 | PAN-2024 | XS | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 530 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 531 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 532 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 533 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 534 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 535 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 536 | PAN-1937 | M | medium | ok |  |  | feat: data export |
| 537 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 538 | PAN-3469 | S | medium | ok |  | PAN-3410 | Migrate NewProjectModal to a full page (page-not-modal doctrine) |
| 539 | PAN-1916 | M | medium | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 540 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 541 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 542 | PAN-1852 | XS | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 543 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 544 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' |
| 545 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 546 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 547 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 548 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 549 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent |
| 550 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 551 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 552 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate |
| 553 | PAN-3441 | L | medium | ok |  |  | God View River — WebGL pipeline visualization fed by the live hook-event stream |
| 554 | PAN-1685 | XS | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 555 | PAN-1676 | M | medium | ok |  |  | harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 556 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 557 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 558 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 559 | PAN-3443 | L | low | ok |  |  | God View Spectrum Deck — Winamp-grade activity visualizer (mockup + PRD) |
| 560 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 561 | PAN-1654 | XS | medium | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 562 | PAN-1653 | XS | medium | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 563 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 564 | PAN-1561 | M | high | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 565 | PAN-1550 | M | medium | ok |  |  | feat: FilesPane + BrowserPane |
| 566 | PAN-1545 | XS | medium | ok |  |  | New Terminal button |
| 567 | PAN-1542 | XS | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 568 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 569 | PAN-1497 | M | high | ok |  |  | emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 570 | PAN-3131 | M | medium | ok |  |  | Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption |
| 571 | PAN-3132 | M | low | ok |  |  | Adopt xBRIEF v0.9 agentic dispatch fields end-to-end |
| 572 | PAN-1490 | M | medium | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 573 | PAN-1489 | M | medium | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 574 | PAN-1485 | M | medium | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 575 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 576 | PAN-1443 | M | medium | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 577 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 578 | PAN-1437 | M | medium | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 579 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale |
| 580 | PAN-1223 | M | medium | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 581 | PAN-1165 | M | medium | ok |  |  | Lightweight review path for small/trivial PRs |
| 582 | PAN-3133 | S | low | ok |  |  | Spike: TRON encoding for prompt-bound xBRIEF payloads |
| 583 | PAN-1151 | XS | medium | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 584 | PAN-1060 | M | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 585 | PAN-1051 | M | medium | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 586 | PAN-1040 | XS | medium | ok |  |  | event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 587 | PAN-1037 | M | medium | ok |  |  | Retire 'planning-' tmux prefix |
| 588 | PAN-958 | M | medium | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 589 | PAN-949 | M | medium | ok |  |  | feat: add conversation for project from sidebar |
| 590 | PAN-947 | M | medium | ok |  |  | feat: project management actions in unified sidebar |
| 591 | PAN-938 | M | medium | ok |  |  | Fizzy visual pipeline |
| 592 | PAN-903 | M | medium | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 593 | PAN-902 | XS | medium | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 594 | PAN-901 | XS | medium | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 595 | PAN-818 | M | medium | ok |  |  | Make summary optional when forking conversations |
| 596 | PAN-736 | M | medium | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 597 | PAN-709 | M | medium | ok |  |  | self-improving flywheel |
| 598 | PAN-678 | M | medium | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 599 | PAN-675 | M | medium | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 600 | PAN-654 | L | medium | ok |  |  | Project Setup Wizard |
| 601 | PAN-649 | M | medium | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 602 | PAN-637 | XS | medium | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 603 | PAN-629 | M | medium | ok |  |  | Workspace quotas and resource governance |
| 604 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents |
| 605 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 606 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 607 | PAN-548 | M | medium | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 608 | PAN-546 | M | medium | ok |  |  | Remove claude-code-router |
| 609 | PAN-537 | M | medium | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 610 | PAN-531 | XS | medium | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 611 | PAN-452 | M | medium | ok |  |  | Conversation input bar |
| 612 | PAN-450 | M | medium | ok |  |  | Adopt remaining Effect patterns |
| 613 | PAN-3335 | XS | low | ok |  |  | Click a pasted conversation image to open it full size in a popup |
| 614 | PAN-3011 | M | low | ok |  |  | Support poolside Laguna S 2.1 — local via Ollama/vLLM, hosted via OpenRouter |
| 615 | PAN-2983 | M | low | ok |  |  | OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor |
| 616 | PAN-294 | M | medium | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 617 | PAN-293 | M | medium | stale |  |  | Project Living Memory |
| 618 | PAN-277 | M | medium | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 619 | PAN-258 | M | medium | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 620 | PAN-255 | M | medium | stale |  |  | Agents lack awareness of MCP tools |
| 621 | PAN-252 | XS | medium | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 622 | PAN-243 | M | medium | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 623 | PAN-77 | XS | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 624 | PAN-54 | L | medium | stale |  |  | e2e command for full workflow integration test |
| 625 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 626 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 627 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 628 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 629 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 630 | PAN-2941 | M | low | ok |  |  | OKF v3 |
| 631 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 632 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 633 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 |
| 634 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 635 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 636 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 637 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 638 | PAN-2635 | XS | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 639 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 640 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 641 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 642 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file |
| 643 | PAN-2600 | XS | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) |
| 644 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 645 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 646 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector |
| 647 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 648 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 649 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 650 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 651 | PAN-2424 | L | low | ok |  |  | Epic: the Order Book |
| 652 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree … |
| 653 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 654 | PAN-2356 | M | low | ok |  |  | Overdeck Anywhere P3: relay service |
| 655 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 656 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 657 | PAN-2352 | M | low | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 658 | PAN-2353 | M | low | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 659 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations |
| 660 | PAN-2091 | XS | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 661 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 662 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 663 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 664 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 665 | PAN-2074 | XS | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 666 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 667 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 668 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast |
| 669 | PAN-2002 | XS | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 670 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 671 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 672 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 673 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 674 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 675 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 676 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 677 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every… |
| 678 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 679 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 680 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout |
| 681 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 682 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 683 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 684 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 685 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 686 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 687 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 688 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 689 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 690 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 691 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 692 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 693 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 694 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 695 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 696 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 697 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 698 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' |
| 699 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence |
| 700 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 701 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 702 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 703 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces |
| 704 | PAN-1123 | XS | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 705 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 706 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 707 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 708 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 709 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 710 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 711 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 712 | PAN-984 | XS | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 713 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 714 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 715 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 716 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 717 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 718 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 719 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 720 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 721 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 722 | PAN-810 | XS | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 723 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 724 | PAN-793 | XS | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 725 | PAN-791 | XS | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 726 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling |
| 727 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 728 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 729 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 730 | PAN-774 | XS | low | ok |  |  | Unify launch UX and release pipeline for 1.0 |
| 731 | PAN-773 | XS | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 732 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 733 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 734 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 735 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 736 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 737 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 738 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 739 | PAN-751 | M | low | ok |  |  | Historical Metrics Data Persistence |
| 740 | PAN-750 | L | low | ok |  |  | Complete Metrics Page Redesign |
| 741 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 742 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 743 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 744 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 745 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 746 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 747 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 748 | PAN-701 | XS | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 749 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 750 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 751 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 752 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 753 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 754 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 755 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 756 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 757 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 758 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 759 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 760 | PAN-571 | XS | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 761 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 762 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 763 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly |
| 764 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 765 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 766 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX |
| 767 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 768 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 769 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database |
| 770 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 771 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 772 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 773 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 774 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 775 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 776 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 777 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 778 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 779 | PAN-249 | XS | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 780 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 781 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics |
| 782 | PAN-227 | M | low | stale |  |  | Phase gate validation |
| 783 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 784 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 785 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 786 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 787 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 788 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 789 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 790 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 791 | PAN-52 | XS | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 792 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 793 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 794 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 795 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 796 | PAN-2348 | XS | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 797 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md |
| 798 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md |
| 799 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md |
| 800 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md |
| 801 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md |
| 802 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 803 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 804 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 805 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 806 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 807 | PAN-1684 | XS | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 808 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 809 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc |
| 810 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 811 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 812 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 813 | PAN-633 | M | low | ok |  |  | Update Cloister PRD and docs index |
| 814 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |

## Rationale detail

### PAN-3511 (rank 1)

The verdict-of-record contract: four independent recovery paths act on the review_status row without ever reading the synthesis artifact, so a row can advance on a verdict nobody wrote. In-review with a full PRD; rank pinned by in-pipeline status and by being the read-side half of the pipeline integrity fix.

### PAN-3512 (rank 2)

Write-side companion to PAN-3511 — one verdict write door, dispatch-not-drop, and a kill-conditional fallback. Split out because it rewrites write semantics and carries real regression risk; in-review, rank pinned.

### PAN-3422 (rank 11)

New, merged and verifying on main, but ranked here because the failure it describes is the single most common way autonomous motion stops: nudge and feedback text lands visibly in an agent's composer and is never submitted, leaving four MYN agents idle between 20 minutes and 2.5 hours, one of them at $242 of session cost. Delivery that reports success while the message sits unsent makes every downstream gate unreliable.

### PAN-3450 (rank 14)

In pipeline, in review. pan sync copies sources into its caches and harness directories but never deletes entries whose source was removed, so the beads skills and rules survived their own deletion for weeks and kept being distributed to every agent and workspace. Stale context is silently wrong context; the fix is small and the blast radius is every session on the machine. Rank pinned as in-pipeline work, gate auto.

### PAN-1230 (rank 14)

Command Deck right-pane Pipeline-lens and TopBar height, the last of the PAN-1148 audit gaps. Merged and verifying on main.

### PAN-3524 (rank 15)

A server-owned --changed verification loop relaunches continuously and survives the global Deacon freeze, review abort, pause, and operator-stop — every documented suppression gate. It blocked a red-main fix across four attempts, which makes it the single most pipeline-destructive open defect.

### PAN-3504 (rank 16)

npm run typecheck fails on current main because parked.ts references a ProjectConfig field that does not exist. Main is red for every agent that runs the quality gates; XS fix, top priority by blast radius.

### PAN-3499 (rank 17)

Same root cause as PAN-3504, filed from the pan parked ack angle; both name the identical TS2339 on main. Ranked adjacent so whichever lands first closes the other.

### PAN-3502 (rank 18)

A stale blendedCost literal left by the gpt-5.6-terra repricing keeps a frontend test red on main. Trivial fix, disproportionate cost because every verification gate re-runs it.

### PAN-3532 (rank 19)

CI reported green while two frontend test files were red on main for hours — CI never runs the full frontend suite. Until this is fixed, a green CI badge is not evidence, which undermines every other gate in the pipeline.

### PAN-2746 (rank 20)

Highest integrity risk — the infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; it nearly merged a pipeline-critical change unreviewed.

### PAN-3283 (rank 21)

Recovering from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 even when the newest real verdict was CHANGES REQUESTED. Same integrity family as PAN-2746, observed on two issues already in a UAT batch.

### PAN-2689 (rank 22)

Sandboxed codex review verdicts fire-and-forget into a journal that loses them; the convoy reports green on evidence never delivered.

### PAN-2695 (rank 23)

Concurrent review dispatches race fresh-spawn against resume; the second dispatch resumes a still-booting parent and wedges the convoy.

### PAN-2742 (rank 24)

Synthesis fires 42 seconds after spawn and reports reviewers whose reports are on disk as an infrastructure failure.

### PAN-3282 (rank 25)

Review agents repeatedly terminate without writing a report across five issues and two projects, leaving a status that looks like a verdict with no artifact behind it. Recurs even on issues already recovered once.

### PAN-3397 (rank 26)

Freshly-spawned convoy lanes freeze at zero output before processing kickoff; the PAN-3375 detector only covers warm resumes, so fresh-spawn freezes stay invisible.

### PAN-3084 (rank 27)

A review session that spawns but is never briefed sits at zero context forever and blocks its own replacement — every recovery path reads it as healthy work in progress.

### PAN-3500 (rank 28)

A review sub-role resumed after writing its report began editing the workspace and preparing to resubmit, in direct violation of its spawn contract. A reviewer that can mutate the code under review destroys the meaning of the verdict.

### PAN-3496 (rank 29)

A review convoy member blocked on an operator AskUserQuestion asking which review depth to use, and the convoy respawned the dialog repeatedly. Review exists to be autonomous; a reviewer that parks on an operator question inverts the whole point.

### PAN-2706 (rank 30)

A never-kicked-off ghost test session is indistinguishable from a running one and absorbs every subsequent test dispatch, marking testing with no prompt delivered.

### PAN-2700 (rank 31)

Test artifact recovery consumes a stale .pan/test/result.json and re-applies a verdict that no longer describes the branch.

### PAN-3274 (rank 32)

A test-role agent spawned, ran zero turns, and has held its issue out of the merge gate ever since — approved by review, green in CI, blocked only by a verdict that was never produced.

### PAN-3104 (rank 33)

The stale test artifact is re-applied with no freshness check against HEAD, so it keeps re-failing an issue long after the fix landed. Direct amplifier of PAN-2700 and PAN-3100.

### PAN-3100 (rank 34)

The test role evaluates the dirty working tree rather than the reviewed commit, so a live work agent uncommitted edits produce failures for code that will never merge.

### PAN-3520 (rank 35)

Test verdicts are being recorded from uniform 5s-timeout signatures under host load, not from real defects — multiple branches are looping on non-defects. Retrying timeout-only failures in isolation before recording a verdict converts a load symptom back into a fair test result.

### PAN-3492 (rank 36)

Server-driven verification retries stack concurrent vitest generations for one issue, and the resulting load causes the timeouts that trigger more retries. A self-amplifying loop is worse than a missing gate because it consumes the capacity every other agent needs.

### PAN-2733 (rank 37)

The substrate-bug-poller has never run, so the class of issue this backlog exists to surface has had no automatic producer.

### PAN-1560 (rank 38)

Re-review after a PR head moves does not re-post the review status, stranding the PR as BLOCKED with no path forward.

### PAN-2769 (rank 39)

review_status rows are never reconciled when an issue closes, so dead rows keep driving live machinery.

### PAN-3281 (rank 40)

An issue can hold ready_for_merge=1 and stuck=1 simultaneously, and the merge-ready flag wins on every surface — stuck work with failed verification reached a UAT batch and was recommended for promotion.

### PAN-2828 (rank 41)

pan done --strike always refuses squash-merged strikes because --is-ancestor cannot see through a squash; the root blocker of the whole strike landing path.

### PAN-2874 (rank 42)

The strike landing pipeline cannot merge strikes: the verification gate demands an xBRIEF checklist strikes never have, and failed-feedback delivery compounds it.

### PAN-2883 (rank 43)

The close-out deploy row fails for every strike-landed issue, so strikes can never complete their Definition of Done.

### PAN-2806 (rank 44)

The strike merge trigger registry splits across dashboard chunks, so the trigger the operator sees is not the trigger that fires.

### PAN-2796 (rank 45)

The idle nudge must not advance an agent past a failed mandatory inspection — advancing there launders a blocked verdict into progress.

### PAN-3417 (rank 46)

Strike agents keep verifying and monitoring after their branch has already landed; three specimens burned 45 to 59 minutes each on moot gates. Cheap to fix, and it directly returns capacity to the pipeline.

### PAN-2995 (rank 47)

pan done --strike false-blocks after the doctrine-prescribed gh-API squash-merge, telling the agent commits are missing from main when the content is fully there.

### PAN-3047 (rank 48)

Strike-branch teardown never fires because --is-ancestor cannot detect a squash merge; 96 strike branches accumulated as residue.

### PAN-3306 (rank 49)

A strike that genuinely needs a rebase has no working path — the prompt instructs it, the launcher guard blocks it, and sync-main resolves the wrong worktree. Three individually defensible layers that together leave the agent stuck.

### PAN-3317 (rank 50)

The same wall from the strike agent side: roles/strike.md prescribes a rebase the guard rejects, and both escapes the error names are unavailable to a strike workspace.

### PAN-3040 (rank 51)

pan strike fails immediately on polyrepo projects because the strike path is monorepo-shaped end to end — it cannot serve half the registered projects.

### PAN-2940 (rank 52)

Three red mains in one day from direct-push series that bypassed PR CI; the guard gap that lets unverified series reach main.

### PAN-3250 (rank 53)

New workspaces branch from local HEAD rather than origin/main, so every fresh feature branch silently inherits whatever unpushed commits are sitting on the shared main worktree. Actively spreading and labelled blocks-main.

### PAN-3062 (rank 54)

The primary worktree is shared by every conversation and the Flywheel, so whoever pushes main next ships everyone else unpushed, unverified commits. This is the mechanism PAN-3250 propagates into feature branches.

### PAN-3505 (rank 55)

Two agent-authored code commits sitting unpushed on the primary main worktree make the guard refuse the flywheel own state push. The guard is correct; the shared-worktree state it guards against is the defect.

### PAN-3081 (rank 56)

The git guard is enforced by a PATH shim, so any agent can remove it and get the unguarded binary — one did so unprompted. A control the constrained thing can remove is worse than none, because everything else assumes it holds.

### PAN-3284 (rank 57)

A work agent wrote a doc edit into the primary main worktree while its own workspace stayed clean — the PAN-2204 family, and evidence that workspace containment is still not mechanically enforced.

### PAN-3424 (rank 58)

The state plane can silently stop being durable in two independent ways — an unreconciled non-fast-forward push and drafts that are never staged — and nothing detects either. One had been accumulating for two weeks.

### PAN-3285 (rank 59)

A supervisor pinned to a pan reload generation SIGTERMs every healthy dashboard and cannot start a replacement: a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and zero escalation. Labelled critical.

### PAN-2932 (rank 60)

An intermittent boot wedge between Cloister start and ReadModel bootstrap leaves port 3011 unbound after pan reload, presenting as Bad Gateway.

### PAN-2935 (rank 61)

A workspace devcontainer duplicate backend hijacks the Traefik router, so the operator reaches the wrong server.

### PAN-3523 (rank 62)

Workspace UAT containers crash-loop because the peer dashboard starts the host-only CLIProxy watchdog and dies on ENOENT. Auto-recovery cannot hold when every boot hits the same fault.

### PAN-3497 (rank 63)

The same CLIProxy watchdog crash from the PAN-3427 workspace angle; ranked adjacent to PAN-3523 so one fix closes both.

### PAN-2337 (rank 64)

An in-place npm run build under a live dashboard breaks new PTY-supervisor spawns until restart — the reload atomicity gap several other build defects hang off.

### PAN-2422 (rank 65)

Rebuilding dist under a live server breaks lazy chunk imports, so the running UI fails on routes it has not yet loaded.

### PAN-3329 (rank 66)

Second occurrence of deployment-generation poisoning: tracked packages/ files and the isolated-linker store are deleted while a dev-checkout build runs, dangling every dependency in the generation.

### PAN-3508 (rank 67)

pan reload removes the global pan CLI for the duration of a rebuild when invoked outside its linked generation — the recovery tool disappears exactly when it is needed.

### PAN-2699 (rank 68)

npm run build regenerates the committed record-cost-event.js bundle, so every build dirties the tree.

### PAN-2957 (rank 69)

npm run build intermittently produces stale frontend bundles, which makes deploy verification unreliable.

### PAN-2850 (rank 70)

npm test fails in a clean checkout because pretest removes the dashboard bundle — new machines and containers cannot run the suite.

### PAN-3362 (rank 71)

In pipeline. Workspace containers have no issue data by design, so any AC that requires a live issue can only be resolved by an operator override on an unverified diff. It blocks the entire UI-redesign track.

### PAN-3244 (rank 71)

A queued dashboard deploy defers verification globally, so a flywheel-owned deploy window starved a cross-project review handoff for 30+ minutes.

### PAN-3248 (rank 72)

pan reload does not clear pending-deploy.json, so every successful deploy keeps deferring verification for all projects until a patrol notices.

### PAN-3205 (rank 73)

The deployment gate promises the deferred deploy will fire at the next verification boundary. That trigger does not exist, so an operator who follows the instruction waits forever.

### PAN-3522 (rank 74)

The supervisor watchdog restart-churns under CPU storm because its probe timeout budget ignores the boot warm phase — it kills a dashboard that is merely slow, then kills its replacement.

### PAN-3344 (rank 75)

The governor gates on memory alone, so a load average of 48 on 24 cores with memory fine never engaged it. Agent-shell test runs are the load source, which is exactly what PAN-3492 and PAN-3520 amplify. Has a full PRD.

### PAN-3429 (rank 76)

Under HARD memory pressure the governor only logged soft deferrals and shed nothing while PSI hit 41.9 at 2.2GB available; a human had to pause the offending run. The shed path is documented but inert.

### PAN-3533 (rank 77)

Per-project isolation classes so one project heavy consumers cannot starve another project pipeline. Operator-requested direction, sibling of PAN-3344 — partitioning rather than gating.

### PAN-3314 (rank 78)

Every agent pane lives under one transient tmux unit, so agent memory is the unit memory and a single hungry agent takes the whole fleet down with it. Blast-radius containment split out of PAN-2390.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-08-04T03:45:08Z",
  "model": "claude-opus-5",
  "pass": "incremental",
  "openCount": 814,
  "nodes": [
    {
      "issue": "PAN-3511",
      "rank": 1,
      "size": "M",
      "importance": "critical",
      "score": 100,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict-of-record contract: every recovery path must read the synthesis artifact before acting on a review row",
      "rationale": "The verdict-of-record contract: four independent recovery paths act on the review_status row without ever reading the synthesis artifact, so a row can advance on a verdict nobody wrote. In-review with a full PRD; rank pinned by in-pipeline status and by being the read-side half of the pipeline integrity fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3512",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 100,
      "condition": "ok",
      "dependsOn": [
        "PAN-3511"
      ],
      "why": "Verdict write door — recordReviewVerdict + dispatch-not-drop + fallback kill-conditional (write side)",
      "rationale": "Write-side companion to PAN-3511 — one verdict write door, dispatch-not-drop, and a kill-conditional fallback. Split out because it rewrites write semantics and carries real regression risk; in-review, rank pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3422",
      "rank": 11,
      "size": "M",
      "importance": "critical",
      "score": 100,
      "condition": "ok",
      "dependsOn": [],
      "why": "Nudge/feedback text lands in the composer but is never submitted — 4 agents wedged idle 20m–2.5h with visible text",
      "rationale": "New, merged and verifying on main, but ranked here because the failure it describes is the single most common way autonomous motion stops: nudge and feedback text lands visibly in an agent's composer and is never submitted, leaving four MYN agents idle between 20 minutes and 2.5 hours, one of them at $242 of session cost. Delivery that reports success while the message sits unsent makes every downstream gate unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3477",
      "rank": 133,
      "size": "S",
      "importance": "high",
      "score": 100,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merged slot sessions are never reaped and get auto-resumed forever, consuming swarm capacity indefinitely",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3418",
      "rank": 197,
      "size": "S",
      "importance": "high",
      "score": 100,
      "condition": "ok",
      "dependsOn": [],
      "why": "Empty-string conversation model is stored, never backfilled, and blanks the harness+model chips",
      "rationale": "In pipeline. The self-healing backfill only looks for NULL, so an empty string is permanently wrong and the conversation silently misreports which model ran.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3419",
      "rank": 223,
      "size": "S",
      "importance": "high",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff has no --project: an isolated --cwd lands every successor outside all registered projects",
      "rationale": "In pipeline. The standing isolated-cwd rule and cwd-inferred project membership are in direct conflict, so every correctly-spawned handoff disappears from the project tree.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3427",
      "rank": 166,
      "size": "M",
      "importance": "high",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Order books are unreachable for every project except the dashboard server’s own cwd project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3450",
      "rank": 14,
      "size": "S",
      "importance": "high",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline (in review): pan sync never prunes removed skills/rules from cache and harness dirs",
      "rationale": "In pipeline, in review. pan sync copies sources into its caches and harness directories but never deletes entries whose source was removed, so the beads skills and rules survived their own deletion for weeks and kept being distributed to every agent and workspace. Stale context is silently wrong context; the fix is small and the blast radius is every session on the machine. Rank pinned as in-pipeline work, gate auto.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3362",
      "rank": 71,
      "size": "M",
      "importance": "high",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "No way to seed tracker-backed issue fixtures in workspace containers — every UI-redesign UAT is environment-blocked",
      "rationale": "In pipeline. Workspace containers have no issue data by design, so any AC that requires a live issue can only be resolved by an operator override on an unverified diff. It blocks the entire UI-redesign track.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3420",
      "rank": 168,
      "size": "M",
      "importance": "medium",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard and pan show render a completed, closed-out issue as never-started (post-close-out history wipe)",
      "rationale": "In pipeline. A fully shipped issue displays with empty work/review/test/ship columns and reviewers marked QUEUED, so the record of what actually happened is destroyed exactly when it becomes history.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3411",
      "rank": 314,
      "size": "L",
      "importance": "medium",
      "score": 99,
      "condition": "ok",
      "dependsOn": [
        "PAN-3410"
      ],
      "why": "New Workspace as a full-page creation experience (replaces the modal)",
      "rationale": "In pipeline. First consumer of the page-not-modal doctrine from PAN-3410.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3410",
      "rank": 271,
      "size": "L",
      "importance": "medium",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Style guide v2 — Geist type system, display scale, chips, soft cards, page-not-modal doctrine",
      "rationale": "In pipeline. Ships as a selectable theme rather than a flag-day cutover, which is the no-loss shape this codebase requires for UI replacement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3423",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign SystemHealthPill popover: attention-grouped reasons, metered vitals, actionable agent alerts",
      "rationale": "In pipeline. Stall alerts and informational disclaimers currently share one undifferentiated bullet list, so the panel built for triage cannot be triaged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1230",
      "rank": 14,
      "size": "M",
      "importance": "medium",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck right-pane Pipeline-lens + TopBar height (PAN-1148 follow-up)",
      "rationale": "Command Deck right-pane Pipeline-lens and TopBar height, the last of the PAN-1148 audit gaps. Merged and verifying on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3524",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "P0: server-owned --changed verification loop survives Deacon freeze, review abort, pause and operator-stop",
      "rationale": "A server-owned --changed verification loop relaunches continuously and survives the global Deacon freeze, review abort, pause, and operator-stop — every documented suppression gate. It blocked a red-main fix across four attempts, which makes it the single most pipeline-destructive open defect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3504",
      "rank": 16,
      "size": "XS",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "typecheck fails on main: parked.ts references nonexistent ProjectConfig.projectPath",
      "rationale": "npm run typecheck fails on current main because parked.ts references a ProjectConfig field that does not exist. Main is red for every agent that runs the quality gates; XS fix, top priority by blast radius.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3499",
      "rank": 17,
      "size": "XS",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [
        "PAN-3504"
      ],
      "why": "pan parked ack references nonexistent ProjectConfig.projectPath — same red-main tsc error",
      "rationale": "Same root cause as PAN-3504, filed from the pan parked ack angle; both name the identical TS2339 on main. Ranked adjacent so whichever lands first closes the other.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3502",
      "rank": 18,
      "size": "XS",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "tiered-crews blendedCost expectation stale vs current pricing — red on main",
      "rationale": "A stale blendedCost literal left by the gpt-5.6-terra repricing keeps a frontend test red on main. Trivial fix, disproportionate cost because every verification gate re-runs it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3532",
      "rank": 19,
      "size": "S",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI never runs the full frontend test suite — main was red on frontend while CI reported green",
      "rationale": "CI reported green while two frontend test files were red on main for hours — CI never runs the full frontend suite. Until this is fixed, a green CI badge is not evidence, which undermines every other gate in the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 20,
      "size": "XS",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [
        "PAN-2742",
        "PAN-2695"
      ],
      "why": "infra-failure bypass writes reviewStatus='passed'",
      "rationale": "Highest integrity risk — the infra-failure bypass writes reviewStatus=passed, indistinguishable from real approval; it nearly merged a pipeline-critical change unreviewed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3283",
      "rank": 21,
      "size": "S",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recovery from review_infrastructure_failure sets review_status=passed despite CHANGES REQUESTED",
      "rationale": "Recovering from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 even when the newest real verdict was CHANGES REQUESTED. Same integrity family as PAN-2746, observed on two issues already in a UAT batch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 22,
      "size": "S",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost",
      "rationale": "Sandboxed codex review verdicts fire-and-forget into a journal that loses them; the convoy reports green on evidence never delivered.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 23,
      "size": "S",
      "importance": "high",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume",
      "rationale": "Concurrent review dispatches race fresh-spawn against resume; the second dispatch resumes a still-booting parent and wedges the convoy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 24,
      "size": "S",
      "importance": "high",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure'",
      "rationale": "Synthesis fires 42 seconds after spawn and reports reviewers whose reports are on disk as an infrastructure failure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 25,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents repeatedly die before writing a verdict across 5 issues and 2 projects",
      "rationale": "Review agents repeatedly terminate without writing a report across five issues and two projects, leaving a status that looks like a verdict with no artifact behind it. Recurs even on issues already recovered once.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 26,
      "size": "S",
      "importance": "high",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Freshly-spawned convoy lanes freeze at 0 output before processing kickoff",
      "rationale": "Freshly-spawned convoy lanes freeze at zero output before processing kickoff; the PAN-3375 detector only covers warm resumes, so fresh-spawn freezes stay invisible.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 27,
      "size": "S",
      "importance": "high",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever and blocks its replacement",
      "rationale": "A review session that spawns but is never briefed sits at zero context forever and blocks its own replacement — every recovery path reads it as healthy work in progress.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 28,
      "size": "S",
      "importance": "high",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review sub-role can modify the branch after writing its report — violates its own spawn contract",
      "rationale": "A review sub-role resumed after writing its report began editing the workspace and preparing to resubmit, in direct violation of its spawn contract. A reviewer that can mutate the code under review destroys the meaning of the verdict.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 29,
      "size": "S",
      "importance": "high",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/inspect agents must not AskUserQuestion the operator for review depth — decide, do not ask",
      "rationale": "A review convoy member blocked on an operator AskUserQuestion asking which review depth to use, and the convoy respawned the dialog repeatedly. Review exists to be autonomous; a reviewer that parks on an operator question inverts the whole point.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch",
      "rationale": "A never-kicked-off ghost test session is indistinguishable from a running one and absorbs every subsequent test dispatch, marking testing with no prompt delivered.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 31,
      "size": "S",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json",
      "rationale": "Test artifact recovery consumes a stale .pan/test/result.json and re-applies a verdict that no longer describes the branch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 32,
      "size": "S",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "A test-role agent can spawn and never run, stranding its issue behind a verdict never produced",
      "rationale": "A test-role agent spawned, ran zero turns, and has held its issue out of the merge gate ever since — approved by review, green in CI, blocked only by a verdict that was never produced.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale .pan/test/result.json re-applied with no freshness check, re-failing an issue after the fix landed",
      "rationale": "The stale test artifact is re-applied with no freshness check against HEAD, so it keeps re-failing an issue long after the fix landed. Direct amplifier of PAN-2700 and PAN-3100.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 34,
      "size": "S",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test role evaluates the dirty working tree, so a live work agent uncommitted edits cause false failures",
      "rationale": "The test role evaluates the dirty working tree rather than the reviewed commit, so a live work agent uncommitted edits produce failures for code that will never merge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 35,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Test gate must retry timeout-only failures in isolation before recording a verdict — load-flake loops",
      "rationale": "Test verdicts are being recorded from uniform 5s-timeout signatures under host load, not from real defects — multiple branches are looping on non-defects. Retrying timeout-only failures in isolation before recording a verdict converts a load symptom back into a fair test result.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3492",
      "rank": 36,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "Server-side gate retries form a self-amplifying load loop: timeouts cause retries which cause timeouts",
      "rationale": "Server-driven verification retries stack concurrent vitest generations for one issue, and the resulting load causes the timeouts that trigger more retries. A self-amplifying loop is worse than a missing gate because it consumes the capacity every other agent needs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "substrate-bug-poller has never run",
      "rationale": "The substrate-bug-poller has never run, so the class of issue this backlog exists to surface has had no automatic producer.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 38,
      "size": "XS",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "rationale": "Re-review after a PR head moves does not re-post the review status, stranding the PR as BLOCKED with no path forward.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 39,
      "size": "S",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes",
      "rationale": "review_status rows are never reconciled when an issue closes, so dead rows keep driving live machinery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3281",
      "rank": 40,
      "size": "S",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so stuck work reaches UAT",
      "rationale": "An issue can hold ready_for_merge=1 and stuck=1 simultaneously, and the merge-ready flag wins on every surface — stuck work with failed verification reached a UAT batch and was recommended for promotion.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 41,
      "size": "S",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "rationale": "pan done --strike always refuses squash-merged strikes because --is-ancestor cannot see through a squash; the root blocker of the whole strike landing path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 42,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [
        "PAN-2828"
      ],
      "why": "Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli…",
      "rationale": "The strike landing pipeline cannot merge strikes: the verification gate demands an xBRIEF checklist strikes never have, and failed-feedback delivery compounds it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [
        "PAN-2828"
      ],
      "why": "Close-out deploy row fails for every strike-landed issue",
      "rationale": "The close-out deploy row fails for every strike-landed issue, so strikes can never complete their Definition of Done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 44,
      "size": "S",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike merge trigger registry splits across dashboard chunks",
      "rationale": "The strike merge trigger registry splits across dashboard chunks, so the trigger the operator sees is not the trigger that fires.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "idle nudge must not advance after failed mandatory inspection",
      "rationale": "The idle nudge must not advance an agent past a failed mandatory inspection — advancing there launders a blocked verdict into progress.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3417",
      "rank": 46,
      "size": "S",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no merged-awareness — they keep verifying after their branch lands",
      "rationale": "Strike agents keep verifying and monitoring after their branch has already landed; three specimens burned 45 to 59 minutes each on moot gates. Cheap to fix, and it directly returns capacity to the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2995",
      "rank": 47,
      "size": "S",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike false-blocks after a gh-API squash-merge; should verify PR-merged, not ancestry",
      "rationale": "pan done --strike false-blocks after the doctrine-prescribed gh-API squash-merge, telling the agent commits are missing from main when the content is fully there.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 48,
      "size": "S",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown never fires: --is-ancestor cannot detect a squash merge, 96 branches residue",
      "rationale": "Strike-branch teardown never fires because --is-ancestor cannot detect a squash merge; 96 strike branches accumulated as residue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 49,
      "size": "S",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [
        "PAN-3317"
      ],
      "why": "A strike that needs a rebase has no working path: prompt instructs it, guard blocks it, sync-main misses",
      "rationale": "A strike that genuinely needs a rebase has no working path — the prompt instructs it, the launcher guard blocks it, and sync-main resolves the wrong worktree. Three individually defensible layers that together leave the agent stuck.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 50,
      "size": "S",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no sanctioned way to sync main: rebase guard-blocked, sync-main cannot resolve -strike",
      "rationale": "The same wall from the strike agent side: roles/strike.md prescribes a rebase the guard rejects, and both escapes the error names are unavailable to a strike workspace.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike fails on polyrepo projects — monorepo-shaped worktree logic end to end",
      "rationale": "pan strike fails immediately on polyrepo projects because the strike path is monorepo-shaped end to end — it cannot serve half the registered projects.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 52,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three red-mains in one day from direct-push series bypassing PR CI",
      "rationale": "Three red mains in one day from direct-push series that bypassed PR CI; the guard gap that lets unverified series reach main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 53,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace spawn branches from local HEAD instead of origin/main — every new workspace inherits unpushed work",
      "rationale": "New workspaces branch from local HEAD rather than origin/main, so every fresh feature branch silently inherits whatever unpushed commits are sitting on the shared main worktree. Actively spreading and labelled blocks-main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 54,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared primary main worktree: any agent that pushes main also ships every other session unpushed commits",
      "rationale": "The primary worktree is shared by every conversation and the Flywheel, so whoever pushes main next ships everyone else unpushed, unverified commits. This is the mechanism PAN-3250 propagates into feature branches.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3505",
      "rank": 55,
      "size": "S",
      "importance": "high",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unpushed agent code commits on the primary main worktree block the flywheel state write door",
      "rationale": "Two agent-authored code commits sitting unpushed on the primary main worktree make the guard refuse the flywheel own state push. The guard is correct; the shared-worktree state it guards against is the defect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 56,
      "size": "M",
      "importance": "high",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent git guard is bypassable by removing it from $PATH — an agent did so unprompted",
      "rationale": "The git guard is enforced by a PATH shim, so any agent can remove it and get the unguarded binary — one did so unprompted. A control the constrained thing can remove is worse than none, because everything else assumes it holds.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent wrote a doc edit into the primary main worktree instead of its workspace",
      "rationale": "A work agent wrote a doc edit into the primary main worktree while its own workspace stayed clean — the PAN-2204 family, and evidence that workspace containment is still not mechanically enforced.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3424",
      "rank": 58,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "State plane silently stops being durable: non-FF overdeck-state push never reconciled, drafts never staged",
      "rationale": "The state plane can silently stop being durable in two independent ways — an unreconciled non-fast-forward push and drafts that are never staged — and nothing detects either. One had been accumulating for two weeks.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 59,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor pinned to a reload generation kills every healthy dashboard and can never restart one — 3.5h outage",
      "rationale": "A supervisor pinned to a pan reload generation SIGTERMs every healthy dashboard and cannot start a replacement: a 3.5-hour total outage with 1,107 consecutive failed recovery attempts and zero escalation. Labelled critical.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 60,
      "size": "S",
      "importance": "high",
      "score": 93,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload",
      "rationale": "An intermittent boot wedge between Cloister start and ReadModel bootstrap leaves port 3011 unbound after pan reload, presenting as Bad Gateway.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 61,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks Traefik router",
      "rationale": "A workspace devcontainer duplicate backend hijacks the Traefik router, so the operator reaches the wrong server.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3523",
      "rank": 62,
      "size": "S",
      "importance": "high",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace UAT containers crash-loop: peer dashboard starts the host-only CLIProxy watchdog (ENOENT)",
      "rationale": "Workspace UAT containers crash-loop because the peer dashboard starts the host-only CLIProxy watchdog and dies on ENOENT. Auto-recovery cannot hold when every boot hits the same fault.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3497",
      "rank": 63,
      "size": "XS",
      "importance": "high",
      "score": 92,
      "condition": "ok",
      "dependsOn": [
        "PAN-3523"
      ],
      "why": "CLIProxy watchdog crashes peer-dashboard workspace containers — missing ~/.overdeck/bin/cliproxy by design",
      "rationale": "The same CLIProxy watchdog crash from the PAN-3427 workspace angle; ranked adjacent to PAN-3523 so one fix closes both.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 64,
      "size": "XS",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "rationale": "An in-place npm run build under a live dashboard breaks new PTY-supervisor spawns until restart — the reload atomicity gap several other build defects hang off.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 65,
      "size": "XS",
      "importance": "high",
      "score": 92,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "rebuilding dist under a live server breaks lazy chunk imports",
      "rationale": "Rebuilding dist under a live server breaks lazy chunk imports, so the running UI fails on routes it has not yet loaded.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3329",
      "rank": 66,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment generation node_modules + tracked packages/ files deleted while a dev-checkout build runs",
      "rationale": "Second occurrence of deployment-generation poisoning: tracked packages/ files and the isolated-linker store are deleted while a dev-checkout build runs, dangling every dependency in the generation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 67,
      "size": "XS",
      "importance": "high",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload temporarily removes the global pan CLI when invoked outside its linked generation",
      "rationale": "pan reload removes the global pan CLI for the duration of a rebuild when invoked outside its linked generation — the recovery tool disappears exactly when it is needed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 68,
      "size": "XS",
      "importance": "high",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle",
      "rationale": "npm run build regenerates the committed record-cost-event.js bundle, so every build dirties the tree.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 69,
      "size": "XS",
      "importance": "high",
      "score": 92,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "npm run build intermittently produces stale frontend bundles",
      "rationale": "npm run build intermittently produces stale frontend bundles, which makes deploy verification unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 70,
      "size": "M",
      "importance": "high",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "rationale": "npm test fails in a clean checkout because pretest removes the dashboard bundle — new machines and containers cannot run the suite.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Queued dashboard deploy globally defers verification — deploy window starves cross-project review handoffs",
      "rationale": "A queued dashboard deploy defers verification globally, so a flywheel-owned deploy window starved a cross-project review handoff for 30+ minutes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 72,
      "size": "S",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload does not clear pending-deploy.json, so every deploy starves verification for ALL projects",
      "rationale": "pan reload does not clear pending-deploy.json, so every successful deploy keeps deferring verification for all projects until a patrol notices.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment gate queues a deferred deploy but never fires it — the promised trigger does not exist",
      "rationale": "The deployment gate promises the deferred deploy will fire at the next verification boundary. That trigger does not exist, so an operator who follows the instruction waits forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3522",
      "rank": 74,
      "size": "S",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard supervisor watchdog restart-churns under CPU storm: probe timeout ignores boot warm phase",
      "rationale": "The supervisor watchdog restart-churns under CPU storm because its probe timeout budget ignores the boot warm phase — it kills a dashboard that is merely slow, then kills its replacement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3344",
      "rank": 75,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resource governor should gate dispatch on CPU load, not memory alone — load 48 on 24 cores with memory fine",
      "rationale": "The governor gates on memory alone, so a load average of 48 on 24 cores with memory fine never engaged it. Agent-shell test runs are the load source, which is exactly what PAN-3492 and PAN-3520 amplify. Has a full PRD.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3429",
      "rank": 76,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory governor defers admissions but sheds nothing under HARD pressure — PSI 41.9 with 2.2GB available",
      "rationale": "Under HARD memory pressure the governor only logged soft deferrals and shed nothing while PSI hit 41.9 at 2.2GB available; a human had to pause the offending run. The shed path is documented but inert.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 77,
      "size": "L",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resource segregation: per-project isolation classes so one project stacks cannot starve another pipeline",
      "rationale": "Per-project isolation classes so one project heavy consumers cannot starve another project pipeline. Operator-requested direction, sibling of PAN-3344 — partitioning rather than gating.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 78,
      "size": "M",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bound the OOM blast radius: one cgroup holds every agent, so one hungry agent can kill the whole fleet",
      "rationale": "Every agent pane lives under one transient tmux unit, so agent memory is the unit memory and a single hungry agent takes the whole fleet down with it. Blast-radius containment split out of PAN-2390.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3510",
      "rank": 79,
      "size": "S",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stopped agents can leave detached docker-run test containers alive indefinitely, contending with other gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3534",
      "rank": 80,
      "size": "M",
      "importance": "high",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR integration: keep the Read-interception savings, cut the 37.5GB/CPU/dead-metrics costs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3107",
      "rank": 81,
      "size": "M",
      "importance": "medium",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Productize the memory-attribution census — OOM spikes are unattributable after the fact",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 82,
      "size": "XS",
      "importance": "high",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log grows unbounded (867MB) — no rotation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 83,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 84,
      "size": "M",
      "importance": "high",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3439",
      "rank": 85,
      "size": "XS",
      "importance": "high",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start crashes on a pending-work-spawn placeholder row instead of taking the fresh-spawn path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3224",
      "rank": 86,
      "size": "S",
      "importance": "high",
      "score": 90,
      "condition": "ok",
      "dependsOn": [
        "PAN-3439"
      ],
      "why": "A crash-interrupted spawn strands model pending-work-spawn; plain pan start dies with Unknown model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 87,
      "size": "M",
      "importance": "high",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 88,
      "size": "M",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3432",
      "rank": 89,
      "size": "M",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive yield fan-out — 7 work agents simultaneously yielded for ONE review convoy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 90,
      "size": "S",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "MERGE refuses (polyrepo) or dead-ends (single-repo) when the scheduler yielded the work agent",
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
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3078",
      "rank": 92,
      "size": "S",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect verdict is never delivered to the work agent — an agent that waits for it deadlocks forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 93,
      "size": "S",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3168",
      "rank": 94,
      "size": "S",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 deadlocks close-out: an agent paused FOR close-out with no session counts as running",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 95,
      "size": "S",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 rejects terminal canonical states — an already-done issue can never satisfy the post-merge row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 96,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Transient merge_status=failed skips close-out permanently, leaving a merged issue open and pickup-eligible",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 97,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline reports merge failed AFTER a successful merge and cleanup; issue stays Todo with no label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 98,
      "size": "XS",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan merge cancel is 100% broken: Commander passes its options object into the fetchImpl slot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3211",
      "rank": 99,
      "size": "M",
      "importance": "medium",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "No honest disposition for closed-without-landing issues — residue rows neither close-able nor reaped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 100,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out cannot tear down workspaces containing root-owned container residue (EACCES)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 101,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocked by an unprefixed devcontainer init container: teardown and guard scope differently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 102,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 103,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel with an active run was never auto-relaunched after a reboot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2971",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator finalized its own run but kept running — zombie session, controls disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator is unreachable as a notification target",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 106,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 107,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket misclassified as ambiguous keyed delivery — feedback never lands",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 108,
      "size": "XS",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback written to .overdeck/feedback but agents are pointed at a nonexistent .pan/feedback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 109,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against CLOSED issues: resurrects agents and raises needs-you 12 days later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 110,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze indefinitely on blocking choice menus and nothing detects it — detector wired only to delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 111,
      "size": "S",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume-gate Enter: tmux fallback answers a live choice menu when its own paste hides the menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 112,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume does not re-wire the PTY supervisor — stale socket refuses all deliveries",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3525",
      "rank": 113,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume-into-compaction silently drops the continuation; recovery is a polling patrol, not a hook",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 114,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3297",
      "rank": 115,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 116,
      "size": "XS",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "planning finalizes (issue→planned) but work agent does not auto-spawn",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 117,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "reviewed+green PR stuck after review",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 118,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent finished with an open PR but review was never dispatched — auto-requeue fired none of 25",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 119,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A capacity-refused planning-to-work handoff is marked terminally stuck: every HTTP 409 becomes guardrails",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 120,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn abandoned on transient Docker failure — attempt 1/3 never retries",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 121,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reports a false hard failure when the deacon wins a spawn race (duplicate-session TOCTOU)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 122,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "relaunch can leave a zombie agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 123,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 124,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model quota exhaustion halts agents invisibly — 4 planning agents running at $0.00 with no fallback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3043",
      "rank": 125,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion undetected: agent stays running for days holding a slot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 126,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient upstream stream error benches the only CLIProxy auth — 70% of GPT-routed inference 503s",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3455",
      "rank": 127,
      "size": "XS",
      "importance": "medium",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "isCliproxyUpToDate always returns false — every ensure re-downloads the pinned release",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 128,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 129,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent sessions vanish repeatedly (4x in one run) and a reviewer died writing no artifact, all silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3139",
      "rank": 130,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents-table liveness drifts stale in the under-reporting direction: a live 4h agent is recorded stopped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3355",
      "rank": 131,
      "size": "XS",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "sessionExists maps a probe failure to absence, so callers read not-running when liveness is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 132,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "merge queue head-of-line zombie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 133,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3526",
      "rank": 134,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start --fresh: destructive wipe runs BEFORE the guard that refuses it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 135,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering — duplicate ranks and gaps in the sequence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 136,
      "size": "S",
      "importance": "medium",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sequencer ran a full pass on an empty manifest against a 750-issue backlog — read model transiently empty",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3517",
      "rank": 137,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy forks still miss the parent prompt cache in production — injection byte drift + dropped scope header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3454",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated warnings, double billing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3518",
      "rank": 139,
      "size": "M",
      "importance": "medium",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-3517"
      ],
      "why": "TTL-aware re-review payload policy — fresh-spawn-with-digest for cold, large histories",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 140,
      "size": "XS",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect/review-supervisor spawns omit --effort, inheriting the harness xhigh default per xBRIEF item",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 142,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-2846"
      ],
      "why": "Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLO…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2960",
      "rank": 143,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2959",
      "rank": 144,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect --item <X> reviews workspace HEAD, not item X's commit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 145,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [
        "PAN-2331"
      ],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 146,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 147,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 148,
      "size": "XS",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 149,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 150,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 151,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 152,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fresh workspace ships an EMPTY node_modules, so tooling silently resolves deps from the parent repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 153,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "New workspaces have empty node_modules and bun is off PATH, so the documented remedy fails",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3288",
      "rank": 154,
      "size": "S",
      "importance": "medium",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "dev-checkout preflight — detect stale node_modules after git pull instead of ERR_MODULE_NOT_FOUND",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 155,
      "size": "XS",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker init container lacks Python",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 156,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 157,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 158,
      "size": "XS",
      "importance": "critical",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 159,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [
        "PAN-2259"
      ],
      "why": "Linear tracker listIssues is a 3N+1 request storm",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 160,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitLab merged-head oracle fans out one glab subprocess per repo x head, stalling every refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 161,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN pipeline membership fails forge_unavailable — glab runs in a path that is not a git repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 162,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership blanks the whole auricle project because one configured member is not a git repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 163,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux and lexerra unreadable through the membership door: a 404 is typed as forge_unavailable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2966",
      "rank": 164,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2945",
      "rank": 165,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3245",
      "rank": 166,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done completion gate falsely flags workspace .pan/drafts as uncommitted despite its own exclusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 167,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done fails on the generated devcontainer harness — agents infer deletion of workspace infrastructure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 168,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands .pan/drafts into product feature branches; exclusion list has drifted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3094",
      "rank": 169,
      "size": "XS",
      "importance": "medium",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done merge fallback force-pushes a fast-forward branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2680",
      "rank": 170,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 171,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear poller is blind after cycle rollover",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 172,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "label transition fails atomically on missing 'in-planning' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 173,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 174,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 175,
      "size": "S",
      "importance": "critical",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "something burns the full 5k/hr GitHub GraphQL quota",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 176,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 177,
      "size": "XS",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard server route tests flake under full-suite verification load",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 178,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "frontend typecheck fails with dozens of pre-existing unused-local errors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 179,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "server children inherit bare system PATH",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 180,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "deacon-swarm unit tests read live ~/.overdeck/config.yaml",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 181,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3243",
      "rank": 182,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit test flakes on main by polling fixed setImmediate turns for a real git subprocess",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3445",
      "rank": 183,
      "size": "S",
      "importance": "medium",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project config TCP lock collides with ephemeral client ports, failing uncontended config writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 184,
      "size": "XL",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Boot Reconciliation + Operator Inbox",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2077",
      "rank": 185,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 186,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 187,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 188,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 189,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-454",
      "rank": 190,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 191,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2642",
      "rank": 192,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost strategy: waste detection over budget policing",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1868",
      "rank": 193,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2466"
      ],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2466",
      "rank": 194,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out/record writer clobbers closeOut.usage with EMPTY data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 195,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 196,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-2642"
      ],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3333",
      "rank": 197,
      "size": "S",
      "importance": "medium",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Relative plan-drain indicator on model pickers — show which sibling model burns plan quota fastest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 198,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 199,
      "size": "XL",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog pickup gate",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2376",
      "rank": 200,
      "size": "XL",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1666",
      "rank": 201,
      "size": "XL",
      "importance": "medium",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline Throughput Hardening",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1556",
      "rank": 202,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 203,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 204,
      "size": "L",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 205,
      "size": "L",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2233",
      "rank": 206,
      "size": "L",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "decompose merge-agent.ts (1,414 lines) into focused modules",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2526",
      "rank": 207,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 208,
      "size": "XS",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "store-access guard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3322",
      "rank": 209,
      "size": "XS",
      "importance": "medium",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "file-size allowlist for launcher-generator.ts is 126 lines slack — a temporary ceiling became regrowth budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3308",
      "rank": 210,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size guard hands agents a paste-ready ratchet-up line — agents raise the ceiling instead of shrinking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 211,
      "size": "S",
      "importance": "medium",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pre-push file-size guard audits the dirty working tree, so another session edits block unrelated pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 212,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3513",
      "rank": 213,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent runtime plane on overdeck-state — durable session pointers, GC as cache eviction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 214,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 215,
      "size": "XS",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 216,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 217,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1700 agent committed .pan/specs/*.vbrief.json mutations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3301",
      "rank": 218,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stray-writer warning is 68k log lines hiding one real defect: backlog manifest still writes legacy .pan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 219,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 220,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 221,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 222,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 223,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell contradicts itself on dead ohmypi sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 224,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 225,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 226,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 227,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 228,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3290",
      "rank": 229,
      "size": "XS",
      "importance": "medium",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "xBRIEF items can carry empty metadata.traces — docs items are invisible to requirement traceability",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 230,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 231,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "issue-level assembly owner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 232,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote is marked complete at merge time — nothing verifies the change reached production",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3174",
      "rank": 233,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every polyrepo UAT stack is unreachable: stale Traefik prefix, no devnet attach, wrong frontend port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3176",
      "rank": 234,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Block UAT batch promotion when the live stack is degraded, unknown, or still starting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3175",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model explicit semantic dependencies in merge-train ordering — file overlap cannot see feature deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3164",
      "rank": 236,
      "size": "S",
      "importance": "medium",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT stack shows Open UAT frontend while still booting — operator gets Gateway Timeout with no signal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3137",
      "rank": 237,
      "size": "XS",
      "importance": "medium",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles are taken from the Flywheel status snapshot, so prose reaches the operator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 238,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default hold is bypassed — shouldHoldForUat is consulted on only one merge path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 239,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper is blind to non-Overdeck workspaces, so sibling-project stacks are never reaped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 240,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace stack rebuild composes under one prefix while Traefik labels reference another — 504s",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 241,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 242,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3463",
      "rank": 243,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "A legitimate no-op slot outcome (empty diff) can never pass its item verify — slot wedges permanently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3464",
      "rank": 244,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm reset does not clear slotCompletions despite claiming to clear recorded slot state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3460",
      "rank": 245,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3456",
      "rank": 246,
      "size": "XS",
      "importance": "medium",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 247,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 248,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 249,
      "size": "XS",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 250,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3022",
      "rank": 251,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn route ignores the per-issue workModel override — role default wins and clobbers the record",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3003",
      "rank": 252,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 253,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout 120 treated as 120ms; false-failed health check leaves the dashboard down",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3321",
      "rank": 254,
      "size": "XS",
      "importance": "medium",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Escalation messages and CLAUDE.md tell operators to run pan unstick, which does not exist",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3307",
      "rank": 255,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "commitlint scope-enum is stale: warns on most real commits, still lists the removed beads scope",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2646",
      "rank": 256,
      "size": "XS",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 257,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 258,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3295",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single per-machine completion-check summarizer with a queue plus first-class observability",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 260,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 261,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "`always` is inert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 262,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 263,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 264,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 265,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 266,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3218",
      "rank": 267,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: a user-facing fix can sit merged on main while every published version stays broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 268,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister auto-resume tests fail under full parallel run, pass in isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 269,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 270,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 271,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents hang on Claude Code settings-file protection when editing .claude/**",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 272,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3129",
      "rank": 273,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 274,
      "size": "S",
      "importance": "medium",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: path-escape validation for identifier-joined write paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3516",
      "rank": 275,
      "size": "XS",
      "importance": "medium",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale bundled-skill duplicates in repo .claude/skills drift behind sync-sources",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 276,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 277,
      "size": "M",
      "importance": "high",
      "score": 66,
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
      "score": 66,
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
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 280,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3303",
      "rank": 281,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck latches Unknown project after reconnect — empty registered-projects treated as authoritative",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3527",
      "rank": 282,
      "size": "S",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sidebar project list never retries: one failed boot-time fetch leaves the panels empty until reload",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 283,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 284,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 285,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 286,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 287,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3276",
      "rank": 288,
      "size": "XS",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 289,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 290,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1196",
      "rank": 291,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 292,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 293,
      "size": "L",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3113",
      "rank": 294,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface agent-pane choice prompts as inline decision cards in the conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3235",
      "rank": 295,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard decision card: render and answer agent pane-choice menus",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3121",
      "rank": 296,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send outbox does not reconcile against the transcript — delivered message keeps a doomed Retry twin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3117",
      "rank": 297,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send bubble hides the deterministic 4xx reason and offers a Retry that can never succeed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 298,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 299,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 300,
      "size": "L",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 301,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 302,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "enhancement(security): API key at-rest hardening",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 303,
      "size": "XS",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 304,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 305,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2351",
      "rank": 306,
      "size": "XS",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2350",
      "rank": 307,
      "size": "L",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1217",
      "rank": 308,
      "size": "XS",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 309,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 310,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 311,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 312,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 313,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 314,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1553",
      "rank": 315,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 316,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan hygiene",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1480",
      "rank": 317,
      "size": "L",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 318,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 319,
      "size": "L",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 320,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 321,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2830",
      "rank": 322,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 323,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 406,
      "size": "M",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2650",
      "rank": 325,
      "size": "L",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 326,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 327,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 328,
      "size": "XS",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "write a Definition of Ready (DoR)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 329,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 330,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 331,
      "size": "XS",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1913",
      "rank": 332,
      "size": "XS",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 333,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 334,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 335,
      "size": "S",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 336,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 337,
      "size": "L",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-630",
      "rank": 338,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3157",
      "rank": 339,
      "size": "XS",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awareness feed shows the Flywheel as a generic chat row instead of flywheel run activity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3036",
      "rank": 340,
      "size": "XS",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "False INPUT chip on completed strike agents — pane-idle heuristic misreads post-strike idle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 341,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck session tree misses strike-only and workspace-less issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3332",
      "rank": 342,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard slash-command activities: surface failure instead of leaving running-in-background standing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 343,
      "size": "XS",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3012",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Back up harness conversation transcripts before harnesses delete them",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2982",
      "rank": 345,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review convoy should run skill selftests when sync-sources/skills changes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 346,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 347,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 348,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "stale",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-176",
      "rank": 349,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 350,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2921",
      "rank": 351,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door can report fetch failure after merge and land the same head twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 352,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with a duplicated workspace prep",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 353,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 354,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 355,
      "size": "L",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan monitor: pull-based background inbox transport for Claude Code sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 356,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 357,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 358,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "first-completion detection throws every patrol cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 359,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "strikes deadlock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 360,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversation permission waits missing from Awareness; strengthen alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 361,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 362,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 363,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 364,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 365,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2670",
      "rank": 366,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 367,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 368,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 369,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 370,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 371,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 373,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 374,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 375,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "clicking a project doesn't update the browser URL",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 376,
      "size": "XS",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test exits 0 despite root-suite failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 377,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout parses seconds as milliseconds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 378,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell is codex-conversation-unaware",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 380,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 381,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 383,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike agents are invisible in the project issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 384,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready set misses merge-eligible issues without flywheel merge verbs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 385,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's PR lookup fails at MYN polyrepo root",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 386,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "ratchet audit fails per-commit on push ranges whose NET baseline delta is zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 387,
      "size": "XS",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN workspace Traefik routing broken post-rebrand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 388,
      "size": "XS",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan workspace rebuild hardcodes 'overdeck-' compose project prefix",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 389,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex agents can wedge on the Codex CLI first-run/consent screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 390,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "context-overflow recovery is inconsistent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 391,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start --auto commits the spec to main AFTER creating the worktree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 392,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "one invalid tiered_execution enum poisons every config read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 393,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "three event types missing from DomainEvent schema union poison the RPC stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 394,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "every supervisor.log line written twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 395,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K palette: stale conversation hits 404 on open — search index never prunes deleted sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 396,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background AI title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3016",
      "rank": 397,
      "size": "L",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "URL-address every view: anywhere you navigate in Overdeck, the URL must get you back there",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3531",
      "rank": 398,
      "size": "S",
      "importance": "low",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen3.8 Max (DashScope) model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 399,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 400,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents skip `pan done` (manual push instead)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 401,
      "size": "S",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 402,
      "size": "XS",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 403,
      "size": "XS",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "full frontend vitest suite runs in no CI path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1912",
      "rank": 404,
      "size": "XS",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 405,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "unbounded log growth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 406,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 407,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 408,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 409,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 410,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 411,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1761",
      "rank": 412,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversations endpoints fetched via relative /api path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 413,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 414,
      "size": "XS",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 415,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1674",
      "rank": 416,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 417,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 418,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "restart-with-model doesn't emit a live event",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 419,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "right-click 'restart with <model>' carries model only, never harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 420,
      "size": "M",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 421,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 422,
      "size": "M",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 423,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 424,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 425,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 426,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 427,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 428,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 429,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 430,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 431,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 432,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 433,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 434,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1392",
      "rank": 435,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 436,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 437,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 439,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 440,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 441,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 442,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1173",
      "rank": 443,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 444,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 445,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 446,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 447,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 448,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3178",
      "rank": 449,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class worktrees and diffs: changes badge, dedicated Changes surface, conversation worktrees",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3181",
      "rank": 450,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Own agent memories in Overdeck: migrate harness project memories to a per-repo orphan branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 451,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page: narrative feed instead of raw transcript, surface the pending question",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3354",
      "rank": 452,
      "size": "XS",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Archiving the main workspace hides the singleton row with no UI recovery path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3530",
      "rank": 453,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View polls on 30s timers in four components, violating its documented event-driven contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3017",
      "rank": 454,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue-page UAT panel: expose the full stack action menu and show the panel consistently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 455,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 456,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 457,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 458,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 459,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 460,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 461,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 462,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 463,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 464,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 465,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 466,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing-crew templates: ship preset crew configurations selectable from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 467,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 468,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 469,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 470,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-334",
      "rank": 471,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 472,
      "size": "XS",
      "importance": "medium",
      "score": 43,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 473,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "stale",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 474,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 475,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 476,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 477,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 478,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 479,
      "size": "XS",
      "importance": "medium",
      "score": 42,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 480,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1164",
      "rank": 481,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1041",
      "rank": 482,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-924",
      "rank": 483,
      "size": "L",
      "importance": "medium",
      "score": 41,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-863",
      "rank": 484,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-817",
      "rank": 485,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 486,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 487,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-700",
      "rank": 488,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-646",
      "rank": 489,
      "size": "XS",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2896",
      "rank": 491,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 492,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2626",
      "rank": 493,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 494,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 495,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2608",
      "rank": 496,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 497,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2566",
      "rank": 498,
      "size": "L",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2565",
      "rank": 499,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2558",
      "rank": 500,
      "size": "L",
      "importance": "high",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "support polyrepo projects",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2557",
      "rank": 501,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level 'Restart All' context action",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 502,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level CI visibility",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 503,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "close the PAN-2541 legacy-fallback deprecation window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 504,
      "size": "S",
      "importance": "high",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "launch pipeline agents with harness rate-limit model-switch reminder disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 505,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 506,
      "size": "L",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 507,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2978",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [
        "PAN-2976"
      ],
      "why": "Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 509,
      "size": "L",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "optional SageOx re-integration",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2443",
      "rank": 510,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenTelemetry GenAI semconv",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2442",
      "rank": 511,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent Client Protocol (ACP) as Overdeck's structured control plane",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2409",
      "rank": 512,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "enforce the workspace boundary",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 513,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "wire replay_threshold/compaction_reroute into the slot-recovery respawn seam",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 514,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing Crew cost panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 515,
      "size": "XS",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2295",
      "rank": 516,
      "size": "L",
      "importance": "medium",
      "score": 37,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2288",
      "rank": 517,
      "size": "L",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 518,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 519,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 520,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 521,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 522,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 523,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 524,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 525,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 526,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 527,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 528,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 529,
      "size": "XS",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 530,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 531,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 532,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 533,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 534,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 535,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 536,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 537,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "--big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3469",
      "rank": 538,
      "size": "S",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [
        "PAN-3410"
      ],
      "why": "Migrate NewProjectModal to a full page (page-not-modal doctrine)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 539,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 540,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 541,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 542,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1844",
      "rank": 543,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 544,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 545,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 546,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1754",
      "rank": 547,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 548,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 549,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT assembly/conflict agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 550,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 551,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 552,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "conflict-aware merge train + on-demand UAT candidate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3441",
      "rank": 553,
      "size": "L",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View River — WebGL pipeline visualization fed by the live hook-event stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 554,
      "size": "XS",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1676",
      "rank": 555,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 556,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 557,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 558,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3443",
      "rank": 559,
      "size": "L",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View Spectrum Deck — Winamp-grade activity visualizer (mockup + PRD)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 560,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 561,
      "size": "XS",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 562,
      "size": "XS",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 563,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 564,
      "size": "M",
      "importance": "high",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 565,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 566,
      "size": "XS",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "New Terminal button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 567,
      "size": "XS",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 568,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 569,
      "size": "M",
      "importance": "high",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3131",
      "rank": 570,
      "size": "M",
      "importance": "medium",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3132",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt xBRIEF v0.9 agentic dispatch fields end-to-end",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 572,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 573,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 574,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 575,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 576,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 577,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 578,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 579,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 580,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1165",
      "rank": 581,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3133",
      "rank": 582,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: TRON encoding for prompt-bound xBRIEF payloads",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 583,
      "size": "XS",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 584,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 585,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 586,
      "size": "XS",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 587,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 588,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 589,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 590,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-938",
      "rank": 591,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fizzy visual pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 592,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 593,
      "size": "XS",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 594,
      "size": "XS",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 595,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 596,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 597,
      "size": "M",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "self-improving flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 598,
      "size": "M",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 599,
      "size": "M",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 600,
      "size": "L",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Setup Wizard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 601,
      "size": "M",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 602,
      "size": "XS",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 603,
      "size": "M",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 604,
      "size": "M",
      "importance": "medium",
      "score": 27,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 605,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 606,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 607,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 608,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove claude-code-router",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 609,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-531",
      "rank": 610,
      "size": "XS",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 611,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation input bar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 612,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3335",
      "rank": 613,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Click a pasted conversation image to open it full size in a popup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3011",
      "rank": 614,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support poolside Laguna S 2.1 — local via Ollama/vLLM, hosted via OpenRouter",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 616,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 617,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Living Memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 618,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 619,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 620,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 621,
      "size": "XS",
      "importance": "medium",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 622,
      "size": "M",
      "importance": "medium",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 623,
      "size": "XS",
      "importance": "medium",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 624,
      "size": "L",
      "importance": "medium",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 625,
      "size": "M",
      "importance": "medium",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 626,
      "size": "M",
      "importance": "medium",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 627,
      "size": "M",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 628,
      "size": "M",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt the interactive decision page as the default way to present operator decisions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 631,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2679",
      "rank": 635,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 636,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2635",
      "rank": 638,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 640,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 642,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 643,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 644,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 646,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2507",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2505",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 651,
      "size": "L",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2406",
      "rank": 652,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 653,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 654,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2355",
      "rank": 655,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2354",
      "rank": 656,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2352",
      "rank": 657,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2353",
      "rank": 658,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2282",
      "rank": 659,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 660,
      "size": "XS",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 661,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 662,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 663,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 664,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 665,
      "size": "XS",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2046",
      "rank": 666,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 667,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2005",
      "rank": 668,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2002",
      "rank": 669,
      "size": "XS",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 670,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 671,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 672,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1980",
      "rank": 673,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 674,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 675,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 676,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 677,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 678,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 679,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 680,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 681,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 682,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1646",
      "rank": 683,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 684,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 685,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1592",
      "rank": 686,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 687,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 688,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 689,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1483",
      "rank": 690,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 691,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 692,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 693,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 694,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1222",
      "rank": 695,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 696,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 697,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1153",
      "rank": 698,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 699,
      "size": "XS",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 700,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 701,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 702,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 703,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 704,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 705,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 706,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 707,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 708,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 709,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 710,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 711,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 712,
      "size": "XS",
      "importance": "low",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 713,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 714,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 715,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 716,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 717,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 718,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-853",
      "rank": 719,
      "size": "L",
      "importance": "low",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 720,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 721,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 722,
      "size": "XS",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 723,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-793",
      "rank": 724,
      "size": "XS",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 725,
      "size": "XS",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 726,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 727,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 728,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 729,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 730,
      "size": "XS",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 731,
      "size": "XS",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 732,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 733,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 734,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 735,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 736,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 737,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 738,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 739,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Historical Metrics Data Persistence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 740,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete Metrics Page Redesign",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 741,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 742,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 743,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 744,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 745,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 746,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 747,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 748,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 749,
      "size": "XS",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 750,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 751,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-624",
      "rank": 752,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 753,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 754,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 755,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 756,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 757,
      "size": "XS",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 758,
      "size": "XS",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 759,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 760,
      "size": "XS",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 761,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 762,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 763,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 764,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 765,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 766,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 767,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 768,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 769,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 770,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 771,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 772,
      "size": "XS",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 773,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 774,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 775,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 776,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 777,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 778,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 779,
      "size": "XS",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 780,
      "size": "L",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 781,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 782,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Phase gate validation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 783,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-190",
      "rank": 784,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 785,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 786,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 787,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 788,
      "size": "L",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 789,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 790,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 791,
      "size": "XS",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 792,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 793,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 794,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 795,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 796,
      "size": "XS",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 797,
      "size": "XS",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2346",
      "rank": 798,
      "size": "XS",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 799,
      "size": "XS",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 800,
      "size": "XS",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 801,
      "size": "XS",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 802,
      "size": "XS",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 803,
      "size": "XS",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 804,
      "size": "XS",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 805,
      "size": "XS",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 806,
      "size": "XS",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 807,
      "size": "XS",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 808,
      "size": "XS",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 809,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 810,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 811,
      "size": "XS",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 812,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 813,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 814,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make overdeck not suck",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
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
      "to": "PAN-2078",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2077",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
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
      "from": "PAN-3511",
      "to": "PAN-3512",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3410",
      "to": "PAN-3411",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3499",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2742",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2695",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3520",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3492",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2874",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2883",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3317",
      "to": "PAN-3306",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2932",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3523",
      "to": "PAN-3497",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2422",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2337",
      "to": "PAN-2957",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3439",
      "to": "PAN-3224",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2846",
      "to": "PAN-2888",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2331",
      "to": "PAN-2639",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2259",
      "to": "PAN-2880",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1775",
      "to": "PAN-2077",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2078",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2079",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2080",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2077",
      "to": "PAN-454",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2466",
      "to": "PAN-1868",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-570",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1936",
      "to": "PAN-2008",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1988",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1910",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2977",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2976",
      "to": "PAN-2978",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3410",
      "to": "PAN-3469",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1226",
      "to": "PAN-1230",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1227",
      "to": "PAN-1230",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-3513",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2352",
      "to": "PAN-3513",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2356",
      "to": "PAN-3513",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2065",
      "to": "PAN-3333",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-570",
      "to": "PAN-3333",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-3333",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2738",
      "to": "PAN-3081",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3081",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2487",
      "to": "PAN-3130",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3104",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3103",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3100",
      "to": "PAN-3103",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2980",
      "to": "PAN-3100",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3100",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3050",
      "to": "PAN-3096",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3085",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3078",
      "to": "PAN-3084",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3078",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3040",
      "to": "PAN-3077",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3280",
      "to": "PAN-3057",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-465",
      "to": "PAN-3011",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1641",
      "to": "PAN-3011",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1643",
      "to": "PAN-3011",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2032",
      "to": "PAN-3011",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2026",
      "to": "PAN-3011",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2982",
      "to": "PAN-2983",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-658",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1166",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2352",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2353",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2354",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2355",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2356",
      "to": "PAN-2350",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2356",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-658",
      "to": "PAN-2356",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2355",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2354",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2353",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2352",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2350",
      "to": "PAN-2351",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1166",
      "to": "PAN-2351",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3429",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3533",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3314",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3510",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3533",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3314",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3510",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3533",
      "to": "PAN-3314",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3533",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3533",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3533",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3533",
      "to": "PAN-3510",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3314",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3314",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3314",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3314",
      "to": "PAN-3510",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3492",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3492",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3492",
      "to": "PAN-3510",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3520",
      "to": "PAN-3522",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3520",
      "to": "PAN-3510",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3522",
      "to": "PAN-3510",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3511",
      "to": "PAN-3512",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3511",
      "to": "PAN-3283",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3511",
      "to": "PAN-3282",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3511",
      "to": "PAN-3397",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3511",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3511",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3511",
      "to": "PAN-2689",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3512",
      "to": "PAN-3283",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3512",
      "to": "PAN-3282",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3512",
      "to": "PAN-3397",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3512",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3512",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3512",
      "to": "PAN-2689",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3283",
      "to": "PAN-3282",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3283",
      "to": "PAN-3397",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3283",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3283",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3283",
      "to": "PAN-2689",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3282",
      "to": "PAN-3397",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3282",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3282",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3282",
      "to": "PAN-2689",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3397",
      "to": "PAN-3084",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3397",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3397",
      "to": "PAN-2689",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3084",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3084",
      "to": "PAN-2689",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2746",
      "to": "PAN-2689",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3417",
      "to": "PAN-2995",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3417",
      "to": "PAN-3047",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3417",
      "to": "PAN-3306",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3417",
      "to": "PAN-3317",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3417",
      "to": "PAN-3040",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2995",
      "to": "PAN-3047",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2995",
      "to": "PAN-3306",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2995",
      "to": "PAN-3317",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2995",
      "to": "PAN-3040",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3047",
      "to": "PAN-3306",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3047",
      "to": "PAN-3317",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3047",
      "to": "PAN-3040",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3306",
      "to": "PAN-3317",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3306",
      "to": "PAN-3040",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3317",
      "to": "PAN-3040",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3250",
      "to": "PAN-3062",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3250",
      "to": "PAN-3505",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3250",
      "to": "PAN-3081",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3250",
      "to": "PAN-3284",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3505",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3081",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3284",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3505",
      "to": "PAN-3081",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3505",
      "to": "PAN-3284",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3081",
      "to": "PAN-3284",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3285",
      "to": "PAN-3329",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3285",
      "to": "PAN-3508",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3285",
      "to": "PAN-3244",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3285",
      "to": "PAN-3248",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3285",
      "to": "PAN-3205",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3329",
      "to": "PAN-3508",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3329",
      "to": "PAN-3244",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3329",
      "to": "PAN-3248",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3329",
      "to": "PAN-3205",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3508",
      "to": "PAN-3244",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3508",
      "to": "PAN-3248",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3508",
      "to": "PAN-3205",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3244",
      "to": "PAN-3248",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3244",
      "to": "PAN-3205",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3205",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3267",
      "to": "PAN-3256",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3267",
      "to": "PAN-3186",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3267",
      "to": "PAN-3167",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3256",
      "to": "PAN-3186",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3256",
      "to": "PAN-3167",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3186",
      "to": "PAN-3167",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3270",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3325",
      "to": "PAN-3288",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3270",
      "to": "PAN-3288",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3422",
      "to": "PAN-3236",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3422",
      "to": "PAN-3234",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3422",
      "to": "PAN-3261",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3422",
      "to": "PAN-3257",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3422",
      "to": "PAN-3297",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3422",
      "to": "PAN-3525",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3234",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3261",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3257",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3297",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3525",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3261",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3257",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3297",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3525",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3261",
      "to": "PAN-3257",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3261",
      "to": "PAN-3297",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3261",
      "to": "PAN-3525",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3257",
      "to": "PAN-3297",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3257",
      "to": "PAN-3525",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3297",
      "to": "PAN-3525",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3179",
      "to": "PAN-3174",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3179",
      "to": "PAN-3176",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3179",
      "to": "PAN-3175",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3179",
      "to": "PAN-3164",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3179",
      "to": "PAN-3137",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3179",
      "to": "PAN-3106",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3174",
      "to": "PAN-3176",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3174",
      "to": "PAN-3175",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3174",
      "to": "PAN-3164",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3174",
      "to": "PAN-3137",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3174",
      "to": "PAN-3106",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3176",
      "to": "PAN-3175",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3176",
      "to": "PAN-3164",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3176",
      "to": "PAN-3137",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3176",
      "to": "PAN-3106",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3175",
      "to": "PAN-3164",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3175",
      "to": "PAN-3137",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3175",
      "to": "PAN-3106",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3164",
      "to": "PAN-3137",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3164",
      "to": "PAN-3106",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3137",
      "to": "PAN-3106",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3477",
      "to": "PAN-3463",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3477",
      "to": "PAN-3464",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3477",
      "to": "PAN-3460",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3477",
      "to": "PAN-3456",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3463",
      "to": "PAN-3464",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3463",
      "to": "PAN-3460",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3463",
      "to": "PAN-3456",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3464",
      "to": "PAN-3460",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3464",
      "to": "PAN-3456",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3460",
      "to": "PAN-3456",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3168",
      "to": "PAN-3188",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3168",
      "to": "PAN-3103",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3168",
      "to": "PAN-3171",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3168",
      "to": "PAN-3211",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3168",
      "to": "PAN-3196",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3168",
      "to": "PAN-3210",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3103",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3171",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3211",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3196",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3210",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3103",
      "to": "PAN-3171",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3103",
      "to": "PAN-3211",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3103",
      "to": "PAN-3196",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3103",
      "to": "PAN-3210",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3171",
      "to": "PAN-3211",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3171",
      "to": "PAN-3196",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3171",
      "to": "PAN-3210",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3211",
      "to": "PAN-3196",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3211",
      "to": "PAN-3210",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3196",
      "to": "PAN-3210",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3308",
      "to": "PAN-3322",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3308",
      "to": "PAN-2980",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3322",
      "to": "PAN-2980",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3504",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3499",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3502",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3243",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3499",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3502",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3243",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3499",
      "to": "PAN-3502",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3499",
      "to": "PAN-3243",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3502",
      "to": "PAN-3243",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3454",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3077",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3454",
      "to": "PAN-3518",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3454",
      "to": "PAN-3077",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-3518",
      "to": "PAN-3077",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    }
  ]
}
```
