# Backlog Sequence

_Last sequenced: 2026-08-04T19:00:58.338Z · model: claude-opus-5 · open: 820_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3504 | XS | critical | ok |  |  | Red main: tsc fails on parked.ts ProjectConfig.projectPath. Every rebased branch inherits a red gate. One-line fix. |
| 2 | PAN-3499 | XS | critical | ok |  |  | Duplicate filing of the PAN-3504 red-main typecheck break. Land once, close the other as duplicate. |
| 2 | PAN-3512 | L | critical | ok |  |  | Verdict write door — recordReviewVerdict + dispatch-not-drop + fallback kill-conditional (write side) |
| 3 | PAN-3532 | S | critical | ok |  |  | CI runs only 4 of ~300 frontend test files, so main was red on frontend while CI reported green for the same SHA. |
| 4 | PAN-3502 | XS | high | ok |  | PAN-3532 | Stale blendedCost literal in tiered-crews.test.ts — one of the two frontend files that were red on main invisibly. |
| 5 | PAN-3524 | M | critical | ok |  |  | P0: a dashboard-owned --changed verification loop survives Deacon freeze, review abort, pause and operator-stop; held 78 vitest workers. |
| 6 | PAN-3492 | M | critical | ok |  |  | Server-side gate retries self-amplify: load-induced timeout triggers a retry that raises load, so retries breed retries. |
| 7 | PAN-3520 | S | critical | ok |  |  | Test gate records verdicts from load-flake timeouts; re-running the same files in isolation passes. Retry timeout-only failures before re… |
| 9 | PAN-3511 | M | critical | ok |  |  | Every recovery path must read the synthesis artifact before acting on a review row. PAN-1577 lost five passed reviews in one evening. |
| 10 | PAN-2746 | M | critical | ok |  | PAN-3512 | Review-infra bypass writes reviewStatus=passed, indistinguishable from four approvals. Nearly merged a pipeline-critical change unreviewed. |
| 11 | PAN-3283 | S | critical | ok |  | PAN-3512 | blocks-main: recovering from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 over an outstanding CHANGES RE… |
| 11 | PAN-3422 | S | high | ok |  |  | Nudge/feedback text lands in the composer but is never submitted — 4 agents wedged idle 20m–2.5h with visible text |
| 12 | PAN-3282 | M | critical | ok |  |  | Review agents die before writing a verdict across 5 issues and 2 projects; the status is indistinguishable from a real rejection. |
| 13 | PAN-3545 | S | critical | ok |  |  | Convoy launch no-ops on stale running rows: the discovery-ready filter discards the tmux liveness answer it already has. |
| 14 | PAN-3541 | M | high | ok |  |  | Review restart loops on the session-resume menu after an unclean reviewer death; resume eligibility ignores how the session ended. |
| 14 | PAN-1230 | S | medium | ok |  |  | Command Deck right-pane Pipeline-lens + TopBar height (PAN-1148 follow-up) |
| 15 | PAN-3397 | S | high | ok |  |  | Freshly-spawned convoy lanes freeze at 0 output before processing kickoff; the existing detector covers warm resumes only. |
| 16 | PAN-3084 | S | high | ok |  |  | A review session spawned but never briefed sits at zero context forever and blocks its own replacement — restart "preserves" it. |
| 17 | PAN-3274 | S | high | ok |  |  | A test-role agent spawns and never runs, stranding an approved, CI-green issue behind a verdict that was never produced. |
| 18 | PAN-3500 | S | high | ok |  |  | A review sub-role can modify the branch after writing its report, violating its own spawn contract. |
| 19 | PAN-3496 | S | high | ok |  |  | Review/inspect agents AskUserQuestion the operator for review depth; convoys respawn, so the operator gets the same dialog repeatedly. |
| 20 | PAN-3234 | M | critical | ok |  |  | Agents freeze on blocking choice menus and no health surface detects it; paneHasBlockingChoiceMenu is wired only to delivery refusal. |
| 21 | PAN-3236 | S | critical | ok |  |  | ECONNREFUSED on a dead supervisor socket is treated as ambiguous, so feedback never crosses to tmux and the issue goes stuck with the fil… |
| 22 | PAN-3257 | M | critical | ok |  |  | Crash-resume does not re-wire the PTY supervisor: stale socket refuses every delivery and state.json loses supervisorEnabled. |
| 23 | PAN-3139 | M | critical | ok |  |  | The authoritative agents table records a live 4h agent as stopped, and pan start's own liveness check contradicts it. |
| 24 | PAN-2817 | M | critical | ok |  |  | Idle-at-prompt work and review agents are never re-driven; sessions stop mid-task at the composer and sit for hours. |
| 25 | PAN-3043 | M | high | ok |  |  | Mid-run provider quota exhaustion is undetected: an agent stays running for days holding a slot while every model call is refused. |
| 26 | PAN-3118 | M | high | ok |  |  | Model-specific quota exhaustion halts agents invisibly — four planning agents "running" at $0.00 with no capacity fallback. |
| 27 | PAN-3313 | S | high | ok |  |  | A transient upstream stream error benches CLIProxy's only auth, so ~70% of GPT-routed requests 503 with a message that blames credentials. |
| 28 | PAN-2758 | S | high | ok |  |  | A provider capacity error zombies a spawned agent: willRetry=false, the turn reports completed, status stays running forever. |
| 29 | PAN-3261 | S | critical | ok |  |  | The tmux fallback answers a live choice menu when its own paste hides the menu from the detector — the PAN-3212 data-loss shape. |
| 30 | PAN-3543 | S | high | ok |  |  | Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while the refusal recommends --fresh. |
| 31 | PAN-3439 | XS | high | ok |  |  | pan start crashes on a pending-work-spawn placeholder row; resume already has the guard, start does not. |
| 32 | PAN-3224 | XS | high | ok |  |  | A crash-interrupted spawn strands model="pending-work-spawn" in agent state; only --fresh recovers. |
| 33 | PAN-3185 | S | high | ok |  |  | pan start reports a false hard failure when the deacon wins the spawn race — duplicate-session TOCTOU between two spawn.ts sites. |
| 34 | PAN-3237 | S | high | ok |  |  | A capacity-refused planning->work handoff is marked terminally stuck: every HTTP 409 becomes "guardrails" and calls markWorkspaceStuck. |
| 35 | PAN-3278 | M | high | ok |  |  | A finished work agent with an open PR sat two hours because review was never dispatched; auto-requeue had 25 attempts and fired none. |
| 36 | PAN-3546 | S | high | ok |  |  | pan show false-flags actively working GPT-harness agents as stuck: lastActivity frozen at spawn for claude-code+CLIProxy sessions. |
| 37 | PAN-3544 | S | high | ok |  |  | The conversation panel renders "How can I help you?" over a live agent 250 tool calls deep, and "no saved history" after it ends. |
| 38 | PAN-3285 | M | critical | ok |  |  | critical: a supervisor pinned to a pan reload generation SIGTERMs every healthy dashboard and cannot start a replacement. 3.5h outage. |
| 39 | PAN-3539 | S | critical | ok |  |  | A kernel OOM of one agent-spawned process failed the whole tmux unit (OOMPolicy=stop), killing every agent and conversation on the machine. |
| 40 | PAN-3314 | M | critical | ok |  | PAN-3539 | One cgroup holds the whole fleet, so oomd killing any single hungry agent takes every other agent with it. Twice already. |
| 41 | PAN-3429 | M | critical | ok |  |  | The memory governor defers admissions but sheds nothing under HARD pressure — PSI 41.9 at 2.2GB available while it only logged soft defer… |
| 42 | PAN-3344 | L | critical | ok |  |  | PRD ready. Resource governor gates on memory alone; agent-shell test runs drove load to 48 on 24 cores with memory fine. |
| 43 | PAN-3522 | S | high | ok |  | PAN-3344 | The supervisor watchdog restart-churns under CPU storm: the probe timeout budget ignores the boot warm phase. |
| 44 | PAN-3533 | L | high | ok |  |  | Operator-directed: per-project isolation classes so one project's heavy consumers cannot starve another project's pipeline. |
| 45 | PAN-3432 | S | high | ok |  |  | Preemptive yield fans out: seven work agents simultaneously paused "making room for review of MIN-874" for one convoy. |
| 46 | PAN-2813 | S | high | ok |  |  | Scheduler yields never self-clear: yielded work agents stayed paused for hours after the review they yielded for merged. |
| 47 | PAN-3329 | M | high | ok |  |  | Deployment-generation node_modules and tracked packages/ files deleted mid-build, breaking every pan invocation machine-wide. |
| 48 | PAN-3250 | S | critical | ok |  |  | blocks-main: workspace spawn branches from local HEAD/defaultBranch, so every new workspace inherits unpushed local main commits. |
| 49 | PAN-3062 | M | critical | ok |  |  | The shared primary main worktree means whoever pushes main next ships every other session's unpushed commits, verified or not. |
| 50 | PAN-3505 | S | high | ok |  | PAN-3062 | Unpushed agent code commits on the primary main worktree block the flywheel's state write door; the guard is right, the situation is not. |
| 51 | PAN-3284 | S | high | ok |  |  | A work agent wrote a doc edit into the primary main worktree instead of its workspace (the PAN-2204 family). |
| 52 | PAN-2409 | L | critical | ok |  |  | Nothing blocks a work agent from writing outside its workspace; three agents edited the primary checkout by absolute path in one incident. |
| 53 | PAN-3081 | M | high | ok |  |  | The agent git guard sits on $PATH, so any agent can remove it — and one did, unprompted, to get past a block it disagreed with. |
| 54 | PAN-807 | L | critical | ok |  |  | critical/architecture: spawn pre-flight so the flow stops hard-resetting local branches and committing planning artifacts over unpushed w… |
| 55 | PAN-3424 | M | critical | ok |  |  | The state plane silently stops being durable: a non-fast-forward overdeck-state push is only warned about, and drafts/ PRDs are never sta… |
| 56 | PAN-3270 | S | high | ok |  |  | New workspaces arrive with empty node_modules and bun is off the agent shell PATH, so the documented remedy fails. |
| 57 | PAN-3325 | S | high | ok |  |  | An empty-but-present workspace node_modules makes tooling silently resolve from the parent repo instead of failing loudly. |
| 58 | PAN-2763 | S | medium | ok |  |  | A workspace node_modules symlinked to the primary repo — the exact pattern CLAUDE.md forbids — breaking test resolution. |
| 59 | PAN-3288 | XS | medium | ok |  |  | Dev-checkout preflight: a git pull that adds a dependency leaves node_modules stale and the CLI dies on a raw resolution stack trace. |
| 60 | PAN-3103 | M | critical | ok |  |  | A transient merge_status=failed permanently skips close-out, leaving merged work open and pickup-eligible — a planning agent spawned on s… |
| 61 | PAN-3171 | S | high | ok |  |  | The pipeline reports "merge failed" after a successful merge and successful post-merge cleanup; the issue stays Todo with no label. |
| 62 | PAN-3188 | S | critical | ok |  |  | substrate: DoD row 5 rejects terminal canonical states, so an already-done issue can never satisfy the post-merge row. All 11 issues in a… |
| 63 | PAN-3168 | S | high | ok |  |  | DoD row 5 deadlocks close-out: an agent paused for close-out with no tmux session is counted as running and blocks it. |
| 64 | PAN-3211 | M | high | ok |  |  | No honest disposition for closed-without-landing issues: residue rows are neither closeable nor reapable, and every override would be a lie. |
| 65 | PAN-3190 | XS | high | ok |  |  | pan merge cancel is 100% broken: Commander passes its options object into the injectable-fetch parameter slot. |
| 66 | PAN-3321 | XS | high | ok |  |  | Escalation messages and CLAUDE.md tell the operator to run `pan unstick <id>`, which does not exist. |
| 67 | PAN-3281 | S | high | ok |  |  | ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so unfinished work reaches the UAT batch. |
| 68 | PAN-3106 | S | high | ok |  |  | auto_merge_default: hold is consulted on exactly one merge path, so held projects still auto-merge individually and the UAT train is defe… |
| 69 | PAN-2567 | M | high | ok |  |  | A reviewed, green PR stays stuck after review: the advancing verdict reconciles forever and the merge never fires under a churning main. |
| 70 | PAN-1650 | L | high | ok |  |  | architecture: split readyForMerge into gatesPassed (event-driven) and shipComplete; today it only flips via recovery pollers. |
| 71 | PAN-3417 | S | high | ok |  |  | Strike agents have no merged-awareness: they keep verifying and monitoring after their branch lands, burning cost on moot gates. |
| 71 | PAN-3362 | M | medium | ok |  |  | No way to seed tracker-backed issue fixtures in workspace containers — every UI-redesign UAT is environment-blocked |
| 72 | PAN-3047 | S | high | ok |  |  | Strike-branch teardown never fires: --is-ancestor cannot see through a squash merge, so all 96 strike/* branches are preserved as residue. |
| 73 | PAN-2995 | S | high | ok |  |  | pan done --strike false-blocks after a gh-API squash merge — it should verify PR-merged/content, not branch ancestry. |
| 74 | PAN-2828 | XS | medium | ok |  |  | pan done --strike always refuses squash-merged strikes because --is-ancestor cannot see through a squash. |
| 75 | PAN-2883 | S | high | ok |  |  | Close-out deploy row fails for every strike-landed issue: the PR resolver hardcodes feature/ branches and cannot find strike/ PRs. |
| 76 | PAN-2874 | M | high | stale |  |  | Strikes cannot merge: the verification gate demands an xBRIEF checklist strikes never have, and failed-feedback delivery wedges on exited… |
| 77 | PAN-2921 | S | medium | ok |  |  | The strike merge door can report a fetch failure after a successful merge and land the same head twice. |
| 78 | PAN-3218 | M | high | ok |  |  | No release-drift signal: a user-facing fix can sit merged on main for hours while every published version stays broken. |
| 79 | PAN-3498 | S | critical | ok |  |  | write-sequence pins in-pipeline ranks without renumbering, producing duplicate ranks and holes — rank stops being a total order. |
| 80 | PAN-3289 | S | high | ok |  |  | The sequencer ran a full pass on an empty manifest against a 750-issue backlog — the read model was transiently empty at spawn. |
| 81 | PAN-3513 | L | high | ok |  |  | architecture: agent runtime plane on overdeck-state — durable session pointers, GC as cache eviction (the Anywhere data plane). |
| 82 | PAN-2008 | S | high | ok |  |  | CI guard that fails the build on direct canonical-state store access outside a domain resolver — the smallest enforceable slice of PAN-1936. |
| 83 | PAN-1936 | XL | high | ok |  |  | One canonical resolver per domain — consolidate the 280+ scattered read endpoints that each assemble the same fact differently. |
| 84 | PAN-1988 | M | high | ok |  |  | Verdict signaling: one host-owned write door — agents journal, the host owns the DB cache. |
| 85 | PAN-3167 | S | high | ok |  |  | krux and lexerra are permanently unreadable through the membership door: a 404 from an uninstalled GitHub App is typed as forge_unavailable. |
| 86 | PAN-3186 | S | high | ok |  |  | Pipeline membership blanks the whole auricle project because one configured member is not a git repo. |
| 87 | PAN-3256 | S | high | ok |  |  | MYN pipeline membership fails forge_unavailable: glab mr list runs in a path that is not a git repository. |
| 88 | PAN-3267 | S | medium | ok |  |  | The GitLab merged-head oracle fans out one glab subprocess per (repo x head), stalling and failing every membership refresh. |
| 89 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails — a non-degrading caller. |
| 90 | PAN-3248 | S | high | ok |  |  | pan reload does not clear pending-deploy.json, so every flywheel deploy starves verification for ALL projects until a patrol runs. |
| 91 | PAN-3244 | S | high | ok |  |  | A queued dashboard deploy globally defers verification; the flywheel-owned deploy window starves cross-project review handoffs. |
| 92 | PAN-3205 | S | high | ok |  |  | The deployment gate queues a deferred deploy and promises it will fire at the next verification boundary — that trigger does not exist. |
| 93 | PAN-2469 | L | high | ok |  |  | Swarm has no issue-level assembly owner: nothing owns "all slots done => assemble, verify, request review", so finished swarm work sits i… |
| 95 | PAN-2650 | M | high | ok |  |  | A swarm's final ready-to-merge slot wedges when the memory governor sheds its integration stack, and pan swarm recover cannot recover it. |
| 96 | PAN-3456 | S | medium | ok |  |  | pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates. |
| 97 | PAN-3463 | S | medium | ok |  |  | A legitimate no-op slot outcome (empty diff) can never pass its item verify, so the slot wedges permanently. |
| 98 | PAN-3460 | S | medium | ok |  |  | Per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive. |
| 99 | PAN-3464 | XS | medium | ok |  |  | pan swarm reset does not clear slotCompletions despite advertising "clear recorded slot state". |
| 100 | PAN-2908 | XL | critical | ok |  |  | Make Overdeck not suck: simple by default. The UI exposes 43 actions and 5 phase vocabularies and answers none of the three questions a n… |
| 101 | PAN-3090 | M | high | ok |  |  | PRD ready. The simple issue page dumps a 55KB machine kickoff prompt as its opening wall and buries the pending question. |
| 102 | PAN-3276 | XS | high | ok |  |  | Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing. |
| 103 | PAN-2492 | M | high | ok |  | PAN-3234 | Pane-detected waits (rate-limit, session-resume) surface as needs-you but can only be answered from the terminal. |
| 104 | PAN-3235 | M | high | ok |  | PAN-3234 | Dashboard decision card: render and answer agent pane-choice menus in one click. |
| 105 | PAN-3113 | M | high | ok |  |  | Surface agent-pane choice prompts as inline decision cards in the conversation view. |
| 106 | PAN-2717 | S | medium | ok |  |  | Conversation permission waits are missing from the Awareness rail, and the warning pulse is nearly invisible. |
| 107 | PAN-3016 | L | high | ok |  |  | Operator-directed: every view must be URL-addressable so refreshing, bookmarking or sharing does not lose your place. |
| 108 | PAN-2968 | M | high | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions, replacing walls of prose in chat. |
| 109 | PAN-3527 | XS | high | ok |  |  | The sidebar project list never retries: one failed boot-time fetch leaves CONVERSATIONS 0 / ISSUES 0 until a manual reload. |
| 110 | PAN-3540 | S | high | ok |  |  | God View shows phantom agent orbs, a dead Hook Bus panel and a pressure-blind swap header — three verified contradictions of ground truth. |
| 111 | PAN-3530 | S | medium | ok |  |  | God View polls on 30s timers in four components, violating its documented event-driven contract. |
| 112 | PAN-3017 | S | medium | ok |  |  | The issue-page UAT panel hides the stack action menu and renders inconsistently, so the operator cannot restart a workspace stack from th… |
| 113 | PAN-3164 | XS | medium | ok |  |  | The UAT stack advertises "Open UAT frontend" while still booting, so the operator gets a Gateway Timeout with no indication it is starting. |
| 114 | PAN-2075 | XL | high | ok | ✓ |  | EPIC: boot reconciliation + Operator Inbox — one informed decision surface, reachable from dashboard, CLI and offline. |
| 115 | PAN-2079 | L | high | ok |  |  | The Operator Inbox: a durable server-side queue plus in-dashboard surface — the notification spine every other producer should post to. |
| 116 | PAN-2077 | M | medium | ok |  |  | One substrate-complete reconciliation inventory across local tmux and remote Fly, as a single typed resolver. |
| 117 | PAN-2078 | S | medium | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status plus pan resume --all|--select|--freeze|--kill-remote. |
| 118 | PAN-2080 | M | low | ok |  | PAN-2079 | Operator Inbox external transports (email, Slack, push, TTS) for offline reach — explicit fast-follow. |
| 119 | PAN-2642 | L | medium | ok | ✓ |  | EPIC: cost strategy — waste detection over budget policing. Retire invented limits, land the progress-aware breaker, make dollars honest. |
| 120 | PAN-1868 | M | high | ok |  |  | Progress-aware cost-bleed circuit breaker: burn-rate x zero-progress detection with graduated warn then auto-pause with diagnosis. |
| 121 | PAN-2059 | L | medium | ok | ✓ |  | EPIC: backlog pickup gate — operator Plan->Release row, AI Objection as a fifth state, Flywheel relevance vetting. |
| 122 | PAN-1666 | XL | medium | ok | ✓ |  | EPIC: pipeline throughput hardening — many work agents safely, on-demand specialists, slot manager, Fly scale-out. |
| 123 | PAN-2350 | XL | medium | ok | ✓ | PAN-3513 | EPIC: Overdeck Anywhere — remote access, Hermes bridge, mobile PWA and the shared relay backbone. |
| 124 | PAN-2376 | L | high | ok | ✓ |  | EPIC: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene. |
| 125 | PAN-2424 | L | medium | ok | ✓ |  | EPIC: the Order Book — first-class operator priority queue, backlog-exempt, load-governed, flywheel-integrated. |
| 126 | PAN-2566 | L | low | ok | ✓ |  | EPIC: Traycer parity — gap analysis of capabilities Overdeck lacks. |
| 130 | PAN-3537 | S | high | ok |  |  | In pipeline (in-review). Per-project live CI chip on the Command Deck: latest main run status and link, webhook-fed. |
| 133 | PAN-3477 | S | high | ok |  |  | Merged slot sessions are never reaped and get auto-resumed forever, consuming swarm capacity indefinitely |
| 133 | PAN-1577 | M | medium | ok |  |  | In pipeline (in-review). Move a conversation to a different project via CLI, drag/drop and menu action. |
| 137 | PAN-3411 | L | high | ok |  | PAN-3410 | New Workspace as a full-page creation experience, replacing the modal — the first page-not-modal conversion. |
| 138 | PAN-3517 | S | high | ok |  |  | convoy forks still miss the parent prompt cache in production — launch-injection byte drift + resume drops the cache-scope header |
| 139 | PAN-2379 | S | high | ok |  |  | dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence) |
| 140 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-saturation heuristic |
| 141 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push |
| 142 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 143 | PAN-2179 | S | high | ok |  |  | relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled) |
| 144 | PAN-2186 | S | high | ok |  |  | post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 145 | PAN-3243 | S | high | ok |  |  | auto-commit test flakes on main by polling a fixed 20 setImmediate turns for a real git subprocess — reddened main and blocked a close-out |
| 146 | PAN-3210 | S | high | ok |  |  | Close-out blocked by an unprefixed devcontainer init-perms container: teardown scopes by compose project, the guard scopes by working_dir |
| 147 | PAN-3196 | S | high | ok |  |  | Close-out cannot tear down workspaces containing root-owned container residue: MIN-879 passes every DoD row then dies on EACCES |
| 148 | PAN-3023 | S | high | ok |  |  | Post-planning auto-spawn abandoned on transient Docker failure — 'attempt 1/3' never retries, issue stuck in 'todo' with no re-drive owner |
| 149 | PAN-2331 | S | high | ok |  |  | codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for enter/esc |
| 150 | PAN-1560 | S | high | stale |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 151 | PAN-2593 | S | high | ok |  |  | server children inherit bare system PATH — verification gates run npm/node under system Node 18, not the server's Node 22 |
| 152 | PAN-2569 | S | high | ok |  |  | planning finalizes (issue→planned) but work agent does not auto-spawn — silent handoff failure requiring manual pan start |
| 153 | PAN-2511 | S | high | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate |
| 154 | PAN-2421 | S | high | ok |  |  | dashboard server route tests flake under full-suite verification load |
| 155 | PAN-2337 | S | high | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 156 | PAN-2324 | S | high | ok |  |  | label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels |
| 157 | PAN-2639 | S | high | ok |  |  | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 158 | PAN-2165 | S | high | stale |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF… |
| 159 | PAN-3523 | S | high | ok |  |  | Workspace UAT containers crash-loop: peer dashboard starts the host-only CLIProxy watchdog (ENOENT) |
| 160 | PAN-2233 | L | high | needs-refinement |  |  | decompose merge-agent.ts (1,414 lines) into focused modules |
| 161 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 162 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle |
| 163 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down |
| 164 | PAN-3420 | S | high | ok |  |  | Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe) |
| 165 | PAN-3306 | M | high | ok |  |  | A strike that needs a rebase has no working path: strike.ts instructs it, the launcher guard blocks it, and sync-main resolves the… |
| 166 | PAN-3427 | S | high | ok |  |  | Order books are unreachable for every project except the dashboard server’s own cwd project |
| 166 | PAN-3022 | S | high | ok |  |  | Work-spawn route ignores the per-issue workModel override — role default wins and then clobbers the record |
| 167 | PAN-2848 | S | medium | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm… |
| 168 | PAN-2521 | M | high | ok |  |  | launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 169 | PAN-2430 | S | high | ok |  |  | frontend typecheck fails with dozens of pre-existing unused-local errors |
| 170 | PAN-2259 | S | high | ok |  |  | something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration |
| 171 | PAN-1767 | S | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 172 | PAN-2971 | S | medium | ok |  |  | orchestrator finalized its own run (report --force) but kept running — zombie session uncontrollable, dashboard Pause/Stop disabled… |
| 173 | PAN-2932 | S | medium | ok |  |  | intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload |
| 174 | PAN-2734 | S | medium | ok |  |  | merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers |
| 175 | PAN-2706 | S | high | ok |  |  | Ghost test sessions absorb every test dispatch — never-kicked-off session reads as 'already running', dispatch marks testing with no… |
| 176 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie |
| 177 | PAN-2558 | M | high | ok |  |  | support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo) |
| 178 | PAN-2546 | S | medium | ok |  |  | pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery |
| 179 | PAN-2478 | S | medium | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 180 | PAN-2190 | L | high | needs-refinement |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split |
| 181 | PAN-2960 | S | medium | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict — shows running 38m, needs manual recovery |
| 182 | PAN-2954 | S | medium | ok |  |  | postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run |
| 183 | PAN-2940 | L | high | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI — conversations pushing multi-commit refactors need a pre-merge CI… |
| 184 | PAN-2769 | S | medium | ok |  |  | review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every… |
| 185 | PAN-2759 | S | medium | ok |  |  | Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled |
| 186 | PAN-2709 | S | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the run is stopped,… |
| 187 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches |
| 188 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you |
| 189 | PAN-2689 | S | medium | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process |
| 190 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 191 | PAN-2656 | S | medium | ok |  |  | deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 192 | PAN-2622 | S | medium | ok |  |  | cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 193 | PAN-2451 | S | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 194 | PAN-2244 | S | medium | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land) |
| 195 | PAN-1452 | S | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 196 | PAN-2846 | S | medium | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 197 | PAN-3418 | S | medium | ok |  |  | Empty-string conversation model is stored, never backfilled, and blanks the harness+model chips |
| 197 | PAN-2747 | S | medium | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 198 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal |
| 199 | PAN-2170 | S | high | ok |  |  | Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (forces --host) |
| 200 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 201 | PAN-1766 | S | high | ok |  |  | work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-1616 class 2) |
| 202 | PAN-3535 | S | medium | ok |  |  | Drain/resume boot gate is caller-env-dependent: any restart from a clean shell silently drops the hold |
| 203 | PAN-3450 | S | medium | stale |  |  | pan sync never prunes removed skills/rules from cache and harness dirs (beads survived removal for weeks) |
| 204 | PAN-3308 | S | high | ok |  |  | The file-size guard hands agents a paste-ready ratchet-up line — 2 of 3 agents raised the ceiling instead of shrinking the file |
| 205 | PAN-3307 | S | high | stale |  |  | commitlint scope-enum is stale: warns on most real commits, still lists the removed 'beads' scope |
| 206 | PAN-3301 | S | high | ok |  |  | Stray-writer warning is 68k log lines hiding one real defect: backlog manifest still writes legacy .pan, and the patrol flags stale… |
| 207 | PAN-3117 | S | medium | ok |  |  | Failed-send bubble hides deterministic 4xx reason and offers a Retry that can never succeed |
| 208 | PAN-3078 | S | medium | ok |  |  | Inspect verdict is never delivered to the work agent — an agent that waits for it deadlocks forever |
| 209 | PAN-3050 | M | medium | ok |  |  | Idle-stack reaper is blind to non-Overdeck workspaces: regex matches only overdeck-feature-*-server|frontend, so MYN stacks are never… |
| 210 | PAN-3032 | M | medium | ok |  |  | Workspace stack rebuild composes under 'overdeck-feature-' prefix while Traefik labels reference 'myn-feature-' devnet — 504s; traefik… |
| 211 | PAN-3516 | S | medium | ok |  |  | stale bundled-skill duplicates in repo .claude/skills (pan-handoff, pan-flywheel, okf) |
| 212 | PAN-3297 | S | medium | ok |  |  | pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart — delivery and resume disagree |
| 213 | PAN-3157 | S | medium | ok |  |  | Awareness feed shows the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of flywheel run activity |
| 214 | PAN-3137 | S | medium | ok |  |  | UAT generation member titles are taken from the Flywheel status snapshot, so orchestrator prose reaches the operator's UAT surface |
| 215 | PAN-3046 | S | medium | ok |  |  | pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out |
| 216 | PAN-3044 | S | medium | ok |  |  | Review feedback delivery runs against CLOSED issues: resurrects agents and raises needs-you 12 days after close-out (PAN-2610, PAN-2207) |
| 217 | PAN-2333 | S | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an… |
| 218 | PAN-2189 | L | high | needs-refinement |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff |
| 219 | PAN-2188 | S | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 220 | PAN-3280 | S | medium | ok |  |  | PAN-3253's agent sessions vanish repeatedly (4x in one run) and its reviewer died writing no artifact, all silently |
| 221 | PAN-3120 | S | medium | ok |  | PAN-2813 | MERGE refuses (polyrepo) or silently dead-ends (single-repo) when the scheduler yielded the work agent |
| 222 | PAN-2738 | S | medium | ok |  |  | strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push |
| 223 | PAN-3419 | M | high | ok |  |  | pan handoff has no --project: an isolated --cwd lands every successor outside all registered projects |
| 223 | PAN-2242 | S | medium | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 224 | PAN-1711 | S | medium | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 225 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 226 | PAN-3518 | M | medium | needs-refinement |  |  | TTL-aware re-review payload policy — fresh-spawn-with-digest for cold, large histories |
| 227 | PAN-2733 | S | medium | ok |  |  | substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls) |
| 228 | PAN-2720 | S | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve — two strikes bent their diffs around… |
| 229 | PAN-2358 | S | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 230 | PAN-2202 | S | medium | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success |
| 231 | PAN-1454 | S | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues |
| 232 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 233 | PAN-2959 | S | medium | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit — spurious verdict when HEAD moved past the item (MIN-882… |
| 234 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825) |
| 235 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere |
| 236 | PAN-2775 | S | medium | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at… |
| 237 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks… |
| 238 | PAN-2742 | S | medium | ok |  |  | synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQUESTED burns… |
| 239 | PAN-2739 | S | medium | ok |  |  | first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done nudge for all… |
| 240 | PAN-2699 | S | medium | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks… |
| 241 | PAN-2695 | S | medium | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickoff |
| 242 | PAN-2664 | S | medium | ok |  |  | auto-commit completes unresolved merge with conflict markers |
| 243 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 244 | PAN-2495 | S | medium | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change |
| 245 | PAN-2416 | S | medium | ok |  |  | codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively |
| 246 | PAN-2334 | S | high | ok |  |  | write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the retired… |
| 247 | PAN-1558 | S | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 248 | PAN-1504 | M | high | ok |  |  | pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs |
| 249 | PAN-1497 | M | high | ok |  |  | emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 250 | PAN-1209 | S | high | stale |  |  | PAN-1052 bead projection disagrees with bd state |
| 251 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 252 | PAN-2755 | S | medium | ok |  |  | per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 253 | PAN-2685 | S | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 254 | PAN-2680 | S | medium | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 255 | PAN-2668 | S | medium | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery |
| 256 | PAN-2629 | S | medium | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 257 | PAN-2466 | S | medium | ok |  |  | close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring) |
| 258 | PAN-2406 | S | medium | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree… |
| 259 | PAN-2211 | S | medium | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 260 | PAN-2069 | S | medium | ok |  |  | caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 261 | PAN-1776 | S | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 262 | PAN-1556 | S | medium | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 263 | PAN-3245 | S | medium | ok |  |  | pan done completion gate falsely flags workspace .pan/drafts/<issue>.md as uncommitted work despite its own .pan exclusion |
| 264 | PAN-3121 | S | medium | ok |  |  | Failed-send outbox does not reconcile against the transcript — delivered message keeps a doomed Retry twin |
| 265 | PAN-3048 | M | medium | ok |  |  | Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; duplicated exclusion list has drifted (.overdeck/ missing) |
| 266 | PAN-3003 | S | medium | ok |  |  | work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly |
| 267 | PAN-2886 | S | medium | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 268 | PAN-2678 | S | medium | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 269 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 270 | PAN-1710 | M | medium | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server… |
| 271 | PAN-3410 | L | high | ok |  |  | Style guide v2 — Geist type system, display scale, chips, soft cards, page-not-modal doctrine |
| 271 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 272 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 273 | PAN-1113 | S | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 274 | PAN-1027 | S | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 275 | PAN-813 | XS | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 276 | PAN-3441 | M | medium | ok |  |  | God View "River" — WebGL pipeline visualization fed by the live hook-event stream |
| 277 | PAN-3174 | S | medium | ok |  |  | Every polyrepo UAT stack is unreachable: Traefik labels carry the old myn- project prefix, Traefik is never attached to the overdeck-*… |
| 278 | PAN-2686 | S | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 279 | PAN-2507 | S | medium | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 280 | PAN-2351 | S | medium | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 281 | PAN-1774 | S | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 282 | PAN-1769 | L | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message… |
| 283 | PAN-1755 | S | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 284 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N… |
| 285 | PAN-1245 | S | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 286 | PAN-3497 | S | medium | ok |  |  | CLIProxy watchdog crashes peer-dashboard workspace containers (missing ~/.overdeck/bin/cliproxy by design) |
| 287 | PAN-3454 | S | medium | ok |  |  | Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated cache-miss warnings and multi-billed discovery spend |
| 288 | PAN-3295 | M | medium | ok |  |  | single per-machine completion-check summarizer with a queue + first-class observability in pan resources and the Deacon surface |
| 289 | PAN-3179 | S | medium | ok |  |  | A UAT promote is marked complete at merge time — nothing verifies the change reached production, so members read as shipped while prod… |
| 290 | PAN-3175 | M | medium | ok |  |  | Model explicit semantic dependencies in merge-train ordering — file overlap cannot see that one feature requires another |
| 291 | PAN-3094 | S | medium | ok |  |  | pan done merge fallback force-pushes a fast-forward branch |
| 292 | PAN-3423 | M | high | ok |  |  | Redesign SystemHealthPill popover: attention-grouped reasons, metered vitals, actionable agent alerts |
| 292 | PAN-3085 | S | medium | ok |  |  | Review feedback is written to .overdeck/feedback but agents (and the deacon merge gate) are pointed at a nonexistent .pan/feedback |
| 293 | PAN-3077 | S | medium | ok |  |  | Inspect/review-supervisor spawns omit --effort, inheriting the harness xhigh default (fires per xBRIEF item) |
| 294 | PAN-3014 | S | medium | ok |  |  | Background AI title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209 |
| 295 | PAN-2394 | S | medium | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 296 | PAN-1918 | S | medium | ok |  |  | full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls the… |
| 297 | PAN-1668 | S | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 298 | PAN-1219 | S | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 299 | PAN-1217 | M | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 300 | PAN-3012 | S | medium | ok |  |  | Back up harness conversation transcripts before harnesses delete them |
| 301 | PAN-2978 | S | medium | ok |  |  | Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes) |
| 302 | PAN-2977 | S | medium | ok |  |  | ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings |
| 303 | PAN-2966 | S | medium | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding (MIN-882) |
| 304 | PAN-2936 | S | medium | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 305 | PAN-2935 | S | medium | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504 |
| 306 | PAN-2905 | S | medium | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s — profile and fix the residual burner |
| 307 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 308 | PAN-2700 | S | medium | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict |
| 309 | PAN-2696 | S | medium | stale |  |  | Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label |
| 310 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors) |
| 311 | PAN-2663 | S | medium | ok |  |  | health probe can accept old dashboard after replacement EADDRINUSE |
| 312 | PAN-2649 | S | medium | ok |  |  | Ctrl+K conversation search indexes Claude transcripts only |
| 313 | PAN-2627 | S | medium | ok |  |  | Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue tree |
| 314 | PAN-2572 | S | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 315 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 316 | PAN-2554 | S | medium | ok |  |  | clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable |
| 317 | PAN-2550 | S | medium | ok |  |  | npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level |
| 318 | PAN-2547 | S | medium | ok |  |  | pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure |
| 319 | PAN-2491 | L | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 320 | PAN-2381 | S | medium | ok |  |  | three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 321 | PAN-2335 | S | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY,… |
| 322 | PAN-2280 | S | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.) |
| 323 | PAN-2243 | S | medium | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 324 | PAN-2241 | XS | medium | stale |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 325 | PAN-2240 | S | medium | ok |  |  | pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 326 | PAN-2237 | S | medium | stale |  |  | pan plan done swallows vbrief quality lint details |
| 327 | PAN-1824 | S | medium | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 328 | PAN-1740 | S | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 329 | PAN-1578 | S | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 330 | PAN-1561 | S | high | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 331 | PAN-1538 | S | high | ok |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 332 | PAN-1253 | S | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 333 | PAN-1218 | M | high | stale |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 334 | PAN-2981 | S | medium | ok |  |  | Ctrl-K palette: stale conversation hits 404 on open — search index never prunes deleted sessions |
| 335 | PAN-2609 | S | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 336 | PAN-2582 | M | medium | stale |  |  | show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 337 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 338 | PAN-2560 | L | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall… |
| 339 | PAN-2006 | S | medium | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 340 | PAN-2005 | S | medium | ok |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 341 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag +… |
| 342 | PAN-1672 | S | medium | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 343 | PAN-1436 | S | medium | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 344 | PAN-3443 | M | medium | ok |  |  | God View "Spectrum Deck" — Winamp-grade activity visualizer (kimi-code-harness mockup + PRD) |
| 345 | PAN-3333 | M | medium | ok |  |  | relative plan-drain indicator on model pickers — show which sibling model burns subscription quota fastest |
| 346 | PAN-3011 | M | medium | ok |  |  | Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — local via Ollama/vLLM, hosted via OpenRouter |
| 347 | PAN-2982 | S | medium | ok |  |  | Review convoy should run skill selftests when sync-sources/skills/** changes |
| 348 | PAN-2976 | S | medium | ok |  |  | Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime (named adapters + custom-agent config) |
| 349 | PAN-2945 | S | medium | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 350 | PAN-2888 | S | medium | ok |  |  | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on… |
| 351 | PAN-2837 | S | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 352 | PAN-2830 | S | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialogs |
| 353 | PAN-2806 | S | medium | ok |  |  | strike merge trigger registry splits across dashboard chunks |
| 354 | PAN-2796 | S | medium | ok |  |  | idle nudge must not advance after failed mandatory inspection |
| 355 | PAN-2630 | S | medium | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 356 | PAN-2526 | L | medium | ok |  |  | Refactor deacon.ts below file-size baseline |
| 357 | PAN-2506 | S | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 358 | PAN-2487 | M | medium | ok |  |  | CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 359 | PAN-2484 | S | medium | ok |  |  | ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule added |
| 360 | PAN-2423 | S | medium | ok |  |  | pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification container names |
| 361 | PAN-2414 | S | medium | ok |  |  | context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation refusal and… |
| 362 | PAN-2399 | M | medium | ok |  |  | wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 363 | PAN-2287 | S | medium | ok |  |  | every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file |
| 364 | PAN-2210 | S | medium | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 365 | PAN-2201 | S | medium | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale… |
| 366 | PAN-1951 | S | medium | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 367 | PAN-1915 | S | medium | ok |  |  | enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext |
| 368 | PAN-1758 | S | medium | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 369 | PAN-1451 | S | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 370 | PAN-1130 | S | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 371 | PAN-2767 | S | medium | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 372 | PAN-2645 | M | medium | ok |  |  | Add opt-in Observation-first conversation view |
| 373 | PAN-2514 | S | medium | ok |  |  | Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 374 | PAN-2444 | M | medium | ok |  |  | optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 375 | PAN-2443 | M | medium | ok |  |  | OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption |
| 376 | PAN-2442 | M | medium | ok |  |  | Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and prompt-detection… |
| 377 | PAN-2355 | S | medium | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 378 | PAN-2356 | L | medium | ok |  |  | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 379 | PAN-2354 | S | medium | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 380 | PAN-2352 | S | medium | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 381 | PAN-2353 | S | medium | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 382 | PAN-1995 | S | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 383 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 384 | PAN-1912 | S | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 385 | PAN-1828 | S | medium | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 386 | PAN-1782 | S | medium | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 387 | PAN-1775 | S | medium | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 388 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 389 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 390 | PAN-1657 | S | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 391 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 392 | PAN-1655 | S | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 393 | PAN-1627 | S | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse… |
| 394 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 395 | PAN-1545 | M | medium | ok |  |  | New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 396 | PAN-1542 | S | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 397 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 398 | PAN-1129 | M | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 399 | PAN-933 | S | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 400 | PAN-886 | S | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 401 | PAN-3536 | S | medium | ok |  |  | pan tell fails for ohmypi conversations: expectedHarness defaults to claude-code when state.json is absent |
| 402 | PAN-3510 | S | medium | ok |  |  | Stopped agents can leave detached docker-run test containers alive indefinitely |
| 403 | PAN-3508 | S | medium | ok |  |  | pan reload temporarily removes the global pan CLI when invoked outside its linked generation |
| 404 | PAN-3469 | L | medium | ok |  | PAN-3411 | migrate NewProjectModal to a full page (page-not-modal doctrine) |
| 405 | PAN-3455 | S | medium | ok |  |  | isCliproxyUpToDate always returns false — cliproxy --version exits 2, so every ensure re-downloads the pinned release |
| 406 | PAN-3445 | S | medium | ok |  |  | Project config TCP lock collides with ephemeral client ports |
| 407 | PAN-3355 | S | medium | ok |  |  | sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is unknown |
| 408 | PAN-3354 | S | medium | ok |  |  | archiving the main workspace hides the singleton row with no UI recovery path |
| 409 | PAN-3335 | M | medium | ok |  |  | click a pasted conversation image to open it full size in a popup |
| 410 | PAN-3332 | M | medium | ok |  |  | Dashboard slash-command activities: surface failure and notify the conversation model instead of leaving 'running in background' standing |
| 411 | PAN-3322 | S | medium | ok |  |  | file-size allowlist for launcher-generator.ts is 126 lines slack (allows 1018, file is 892) — a temporary ceiling raise became… |
| 412 | PAN-3317 | S | medium | ok |  |  | Strike agents have no sanctioned way to sync main: git rebase is guard-blocked and pan sync-main can't resolve -strike workspaces |
| 413 | PAN-3303 | S | medium | ok |  |  | Command Deck latches 'Unknown project' after dashboard reconnect — empty registered-projects response treated as authoritative |
| 414 | PAN-3290 | S | medium | ok |  |  | plan: xBRIEF items can carry empty metadata.traces — docs items are invisible to requirement traceability |
| 415 | PAN-3181 | L | medium | ok |  |  | Own agent memories in Overdeck: migrate harness project memories to a per-repo overdeck-memory orphan branch, mirroring the… |
| 416 | PAN-3178 | S | medium | ok |  |  | First-class worktrees & diffs: +/− changes badge, dedicated Changes surface, conversation worktrees |
| 417 | PAN-3176 | S | medium | ok |  |  | Block UAT batch promotion when the live stack is degraded, unknown, or still starting — the promote path takes no health evidence |
| 418 | PAN-3132 | L | medium | ok |  |  | Adopt xBRIEF v0.9 agentic dispatch fields end-to-end (deftai/xBRIEF#40 alignment) |
| 419 | PAN-3131 | M | medium | ok |  |  | Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption |
| 420 | PAN-3130 | S | medium | ok |  |  | Security: path-escape validation for identifier-joined write paths |
| 421 | PAN-3129 | S | medium | ok |  |  | Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths |
| 422 | PAN-3108 | S | medium | ok |  |  | dashboard.log grows unbounded (867MB) — no rotation |
| 423 | PAN-3104 | S | medium | ok |  |  | Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix has landed |
| 424 | PAN-3099 | S | medium | ok |  |  | pan restart --health-timeout 120 treated as 120ms; false-failed health check leaves dashboard DOWN |
| 425 | PAN-3096 | S | medium | ok |  |  | pan done fails on generated devcontainer harness — agents infer deletion of workspace infrastructure |
| 426 | PAN-3061 | S | medium | ok |  |  | Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize |
| 427 | PAN-3058 | S | medium | ok |  |  | Standing-crew templates: ship preset crew configurations (Claude ladder + OpenAI Sol/Terra/Luna) selectable from Settings |
| 428 | PAN-3057 | S | medium | ok |  |  | Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice (372K vs 150K) |
| 429 | PAN-3054 | S | medium | ok |  |  | Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome |
| 430 | PAN-3040 | S | medium | ok |  |  | pan strike fails on polyrepo projects (monorepo-shaped worktree logic) |
| 431 | PAN-3036 | S | medium | ok |  |  | False '! INPUT' chip on completed strike agents — pane-idle heuristic misreads post-strike-ready idle as a pending question |
| 432 | PAN-3034 | S | medium | ok |  |  | Command Deck session tree misses strike-only and workspace-less issues (no strike node for PAN-3031) |
| 433 | PAN-3015 | S | medium | ok |  |  | pan monitor: pull-based background inbox transport for Claude Code sessions |
| 434 | PAN-3013 | S | medium | ok |  |  | linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp/pan-agent-role-* paths |
| 435 | PAN-1852 | S | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 436 | PAN-1572 | S | medium | ok |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 437 | PAN-1552 | S | medium | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 438 | PAN-2896 | S | medium | ok |  |  | Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute |
| 439 | PAN-2718 | S | medium | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator |
| 440 | PAN-2646 | M | medium | ok |  |  | configurable global/project/issue policy UI with default OFF |
| 441 | PAN-2608 | S | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 442 | PAN-2557 | M | medium | ok |  |  | project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor |
| 443 | PAN-2553 | M | medium | ok |  |  | project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 444 | PAN-2308 | L | medium | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot… |
| 445 | PAN-2288 | S | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up) |
| 446 | PAN-2266 | M | medium | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 447 | PAN-2197 | S | medium | ok |  |  | work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 448 | PAN-1958 | S | medium | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 449 | PAN-1895 | S | medium | ok |  |  | Spawn work agents from issue workspace slide-out |
| 450 | PAN-1846 | S | medium | ok |  |  | unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 451 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 452 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 453 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 454 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 455 | PAN-1720 | S | medium | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 456 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 457 | PAN-1581 | S | medium | stale |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 458 | PAN-1544 | S | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 459 | PAN-1357 | S | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 460 | PAN-1313 | S | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 461 | PAN-1254 | S | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 462 | PAN-1246 | S | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 463 | PAN-1244 | S | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 464 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 465 | PAN-2027 | S | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 466 | PAN-1985 | S | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 467 | PAN-1533 | S | medium | ok |  |  | Fork-into-worktree from conversation branch chip |
| 468 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 469 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 470 | PAN-1226 | L | medium | ok |  |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 471 | PAN-1060 | S | medium | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 472 | PAN-2983 | S | low | ok |  |  | OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor |
| 473 | PAN-2980 | S | low | ok |  |  | pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes |
| 474 | PAN-2957 | S | low | ok |  |  | npm run build intermittently produces stale frontend bundles |
| 475 | PAN-2950 | L | low | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 476 | PAN-2941 | S | low | ok |  |  | OKF v3 — lease-based writes and advisory semantic auditor |
| 477 | PAN-2922 | S | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 478 | PAN-2880 | S | low | ok |  |  | Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget |
| 479 | PAN-2868 | S | low | ok |  |  | Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized |
| 480 | PAN-2850 | S | low | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 481 | PAN-2836 | L | low | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 482 | PAN-2810 | S | low | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 483 | PAN-2809 | S | low | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 484 | PAN-2754 | S | low | ok |  |  | `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 485 | PAN-2679 | S | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 486 | PAN-2667 | M | low | ok |  |  | Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 487 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 488 | PAN-2652 | S | low | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id… |
| 489 | PAN-2651 | M | low | ok |  |  | simplify lifecycle reconciliation and add a safe post-planning reset |
| 490 | PAN-2628 | S | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 491 | PAN-2626 | M | low | ok |  |  | allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 492 | PAN-2625 | M | low | ok |  |  | auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 493 | PAN-2549 | L | low | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 494 | PAN-2527 | S | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 495 | PAN-2505 | S | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 496 | PAN-2504 | S | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 497 | PAN-2501 | S | low | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion) |
| 498 | PAN-2489 | S | low | ok |  |  | strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 499 | PAN-2465 | S | low | ok |  |  | pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero |
| 500 | PAN-2454 | S | low | ok |  |  | ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches |
| 501 | PAN-2449 | S | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 502 | PAN-2422 | S | low | ok |  |  | rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 503 | PAN-2408 | S | low | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-workspace… |
| 504 | PAN-2395 | S | low | ok |  |  | one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation blocked |
| 505 | PAN-2392 | M | low | ok |  |  | Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 506 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 507 | PAN-2213 | S | low | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 508 | PAN-2212 | S | low | ok |  |  | Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 509 | PAN-1641 | S | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 510 | PAN-903 | M | low | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 511 | PAN-334 | S | low | stale |  |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 512 | PAN-2548 | S | low | ok |  |  | close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker |
| 513 | PAN-2065 | M | low | ok |  |  | unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 514 | PAN-2004 | S | low | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 515 | PAN-1968 | XS | low | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 516 | PAN-1965 | S | low | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 517 | PAN-1916 | M | low | ok |  |  | configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 518 | PAN-1854 | S | low | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 519 | PAN-1853 | M | low | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 520 | PAN-1844 | S | low | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 521 | PAN-1840 | M | low | ok |  |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 522 | PAN-1839 | S | low | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 523 | PAN-1676 | M | low | ok |  |  | harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 524 | PAN-1654 | S | low | ok |  |  | run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 525 | PAN-1653 | S | low | ok |  |  | batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 526 | PAN-1623 | M | low | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 527 | PAN-1449 | S | low | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 528 | PAN-1446 | M | low | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 529 | PAN-1445 | M | low | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 530 | PAN-1437 | S | low | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 531 | PAN-1432 | S | low | ok |  |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 532 | PAN-1392 | S | low | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 533 | PAN-1330 | S | low | ok |  |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 534 | PAN-1240 | S | low | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 535 | PAN-1227 | M | low | stale |  |  | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 536 | PAN-1173 | S | low | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 537 | PAN-1165 | S | low | ok |  |  | Lightweight review path for small/trivial PRs |
| 538 | PAN-1150 | S | low | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 539 | PAN-1149 | S | low | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 540 | PAN-1128 | S | low | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 541 | PAN-1068 | S | low | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 542 | PAN-932 | S | low | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 543 | PAN-900 | S | low | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 544 | PAN-2033 | S | low | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 545 | PAN-2032 | S | low | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 546 | PAN-1444 | S | low | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 547 | PAN-1223 | S | low | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 548 | PAN-681 | S | low | stale |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 549 | PAN-603 | S | low | stale |  |  | Plan review loop with configurable reviewer model |
| 550 | PAN-324 | S | low | stale |  |  | Agent detail pane missing Merge/Approve button |
| 551 | PAN-2635 | S | low | ok |  |  | pay down the 152-error src/dashboard/server typecheck debt |
| 552 | PAN-2600 | S | low | ok |  | PAN-2597 | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 553 | PAN-2295 | M | low | needs-refinement |  |  | built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 554 | PAN-2195 | S | low | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 555 | PAN-2085 | S | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 556 | PAN-2084 | S | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 557 | PAN-2083 | S | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 558 | PAN-2082 | S | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 559 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 560 | PAN-2002 | S | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 561 | PAN-1999 | S | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 562 | PAN-1984 | L | low | stale |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 563 | PAN-1983 | S | low | stale |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 564 | PAN-1980 | S | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 565 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 566 | PAN-1937 | S | low | ok |  |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 567 | PAN-1926 | M | low | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 568 | PAN-1914 | S | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 569 | PAN-1910 | S | low | ok |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 570 | PAN-1907 | S | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate… |
| 571 | PAN-1906 | S | low | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 572 | PAN-1878 | S | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 573 | PAN-1761 | S | low | ok |  |  | conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-* origin) |
| 574 | PAN-1754 | M | low | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 575 | PAN-1728 | M | low | stale |  |  | PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 576 | PAN-1669 | S | low | ok |  |  | restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 577 | PAN-1667 | M | low | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 578 | PAN-1646 | S | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 579 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 580 | PAN-1640 | L | low | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 581 | PAN-1592 | S | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 582 | PAN-1550 | M | low | ok |  |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 583 | PAN-1311 | S | high | needs-refinement |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 584 | PAN-1196 | S | high | stale |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 585 | PAN-1164 | S | low | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 586 | PAN-1133 | S | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 587 | PAN-1123 | M | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 588 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 589 | PAN-908 | S | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 590 | PAN-833 | S | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 591 | PAN-778 | S | low | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 592 | PAN-769 | S | low | ok |  |  | Track verification/review/test phase churn over time |
| 593 | PAN-2533 | S | low | stale |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 594 | PAN-2428 | S | low | stale |  |  | MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label make UAT… |
| 595 | PAN-1440 | S | low | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 596 | PAN-1435 | S | low | stale |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 597 | PAN-1166 | S | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 598 | PAN-1042 | S | low | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 599 | PAN-630 | L | high | stale |  |  | Multi-tenant workspace isolation with ACLs |
| 600 | PAN-538 | S | low | stale |  |  | pan reload freshness guard must also verify the frontend bundle |
| 601 | PAN-3133 | S | low | needs-refinement |  |  | Spike: TRON encoding for prompt-bound xBRIEF payloads |
| 602 | PAN-3107 | M | low | needs-refinement |  |  | productize the memory-attribution census (OOM spikes are unattributable after the fact) |
| 603 | PAN-3100 | S | low | needs-refinement |  |  | Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false test failures |
| 604 | PAN-1913 | S | high | stale |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 605 | PAN-1685 | S | low | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 606 | PAN-1242 | S | low | ok |  |  | Create a new issue directly from a kanban column |
| 607 | PAN-863 | M | low | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 608 | PAN-2091 | S | low | ok |  |  | delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 609 | PAN-1773 | S | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 610 | PAN-1524 | S | low | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 611 | PAN-1490 | M | low | ok |  |  | show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 612 | PAN-1489 | S | low | needs-refinement |  |  | tune v1.0 readiness criteria after 30 days of telemetry |
| 613 | PAN-1485 | S | low | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 614 | PAN-1473 | L | low | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 615 | PAN-1424 | S | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 616 | PAN-1151 | S | low | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 617 | PAN-1136 | S | low | stale |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 618 | PAN-1041 | L | low | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 619 | PAN-1040 | M | low | stale |  |  | event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 620 | PAN-1037 | S | low | ok |  |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 621 | PAN-958 | L | low | stale |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 622 | PAN-949 | M | low | ok |  |  | feat: add conversation for project from sidebar |
| 623 | PAN-947 | S | low | ok |  |  | feat: project management actions in unified sidebar |
| 624 | PAN-938 | S | low | ok |  |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 625 | PAN-902 | M | low | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 626 | PAN-901 | M | low | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 627 | PAN-818 | S | low | ok |  |  | Make summary optional when forking conversations |
| 628 | PAN-817 | S | low | ok |  |  | Improve planning dialog layout and content fit |
| 629 | PAN-304 | S | low | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 630 | PAN-2035 | S | low | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 631 | PAN-2034 | L | low | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 632 | PAN-2031 | M | low | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 633 | PAN-2030 | XS | low | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 634 | PAN-2029 | S | low | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 635 | PAN-2028 | S | low | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 636 | PAN-2026 | M | low | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 637 | PAN-2025 | S | low | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 638 | PAN-2024 | S | low | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 639 | PAN-1126 | S | low | ok |  |  | Integrate TLDR summaries into review context manifest |
| 640 | PAN-1066 | S | low | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 641 | PAN-675 | M | low | stale |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 642 | PAN-624 | S | low | stale |  |  | Loop nodes: iterative agent execution with conditional termination |
| 643 | PAN-454 | S | low | stale |  |  | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 644 | PAN-262 | L | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 645 | PAN-247 | S | low | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 646 | PAN-49 | S | low | stale |  |  | Fix CloisterService tests that require real runtime |
| 647 | PAN-2493 | M | low | ok |  |  | align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 648 | PAN-1482 | S | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 649 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 650 | PAN-1480 | S | low | ok |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 651 | PAN-1479 | M | low | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 652 | PAN-1356 | S | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 653 | PAN-1325 | S | low | ok |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 654 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 655 | PAN-1154 | S | low | ok |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 656 | PAN-1153 | S | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 657 | PAN-1135 | S | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 658 | PAN-1124 | S | low | ok |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 659 | PAN-1121 | S | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 660 | PAN-1117 | S | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 661 | PAN-1116 | S | low | ok |  |  | Memory: cross-project search mode |
| 662 | PAN-1065 | S | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 663 | PAN-1064 | S | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 664 | PAN-1063 | S | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 665 | PAN-962 | S | low | stale |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 666 | PAN-961 | S | low | stale |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 667 | PAN-944 | S | low | stale |  |  | Make vBRIEF the durable task graph source of truth |
| 668 | PAN-927 | L | low | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 669 | PAN-898 | S | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 670 | PAN-832 | S | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 671 | PAN-810 | S | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 672 | PAN-802 | S | low | ok |  |  | Resume on conversation session forks instead of resuming |
| 673 | PAN-790 | S | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 674 | PAN-786 | S | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 675 | PAN-777 | S | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 676 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 677 | PAN-774 | L | low | ok |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 678 | PAN-773 | S | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 679 | PAN-772 | S | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 680 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 681 | PAN-762 | S | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 682 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 683 | PAN-751 | S | low | needs-refinement |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 684 | PAN-750 | L | low | needs-refinement |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 685 | PAN-578 | S | low | stale |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 686 | PAN-2348 | L | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 687 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 688 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 689 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md — update, harden, make useful |
| 690 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 691 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 692 | PAN-1684 | S | low | ok |  |  | build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 693 | PAN-1530 | S | low | needs-refinement |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 694 | PAN-1469 | L | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 695 | PAN-1443 | L | low | stale |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 696 | PAN-1442 | S | low | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 697 | PAN-736 | S | low | stale |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 698 | PAN-735 | S | low | stale |  |  | Settings page: review and configure overridden subagent model files |
| 699 | PAN-709 | M | low | stale |  |  | self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 700 | PAN-532 | S | low | stale |  |  | Per-project and per-issue model overrides for pipeline roles |
| 701 | PAN-480 | S | low | stale |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 702 | PAN-658 | S | low | stale |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 703 | PAN-2074 | S | low | needs-refinement |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 704 | PAN-1553 | M | low | needs-refinement |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 705 | PAN-1986 | S | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 706 | PAN-1483 | S | low | stale |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 707 | PAN-1152 | S | low | stale |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 708 | PAN-1051 | S | low | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 709 | PAN-791 | S | low | stale |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 710 | PAN-765 | XS | low | ok |  |  | Preserve trailing zeros in cost displays |
| 711 | PAN-747 | S | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 712 | PAN-687 | M | low | stale |  |  | Support OpenCode as alternative coding agent |
| 713 | PAN-678 | S | low | stale |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 714 | PAN-654 | S | low | stale |  |  | Project Setup Wizard — Dashboard UI |
| 715 | PAN-649 | S | low | stale |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 716 | PAN-637 | S | low | stale |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 717 | PAN-629 | S | low | stale |  |  | Workspace quotas and resource governance |
| 718 | PAN-548 | S | low | stale |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 719 | PAN-546 | S | low | stale |  |  | Remove claude-code-router — all providers use direct env var injection |
| 720 | PAN-531 | M | low | stale |  |  | PAN: Windows Electron support (WSL2 required) |
| 721 | PAN-466 | M | low | stale |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 722 | PAN-465 | M | low | stale |  |  | Add OpenRouter as a model provider |
| 723 | PAN-463 | M | low | stale |  |  | Add Qwen 3.6+ model support |
| 724 | PAN-452 | S | low | stale |  |  | Conversation input bar — mode/permissions/workspace selectors |
| 725 | PAN-450 | L | low | stale |  |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 726 | PAN-245 | S | low | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 727 | PAN-244 | S | low | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 728 | PAN-113 | S | low | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 729 | PAN-38 | M | low | stale |  |  | Support multiple merge agents per repository |
| 730 | PAN-37 | M | low | stale |  |  | Support external PR selection for merge-agent |
| 731 | PAN-589 | S | low | stale |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 732 | PAN-738 | M | low | stale |  |  | Add right-click fork option to conversation list |
| 733 | PAN-730 | M | low | stale |  |  | Add provider account telemetry for credits, balances, and usage |
| 734 | PAN-727 | S | low | stale |  |  | Fix orphaned work-agent start handoff after planning |
| 735 | PAN-713 | M | low | stale |  |  | test: add unit tests for doneCommand and approveCommand |
| 736 | PAN-702 | M | low | stale |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 737 | PAN-701 | S | low | stale |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 738 | PAN-700 | S | low | stale |  |  | Detachable terminal for conversation view — popout into OS window |
| 739 | PAN-660 | S | low | stale |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 740 | PAN-646 | M | low | stale |  |  | Canceled issues: add guided Recover workflow |
| 741 | PAN-623 | S | low | stale |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 742 | PAN-622 | S | low | stale |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 743 | PAN-613 | S | low | needs-refinement |  |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 744 | PAN-604 | S | low | stale |  |  | Hide planning agent from workspace detail pane |
| 745 | PAN-576 | M | low | stale |  |  | Global / search should include conversations in addition to workspace features |
| 746 | PAN-571 | M | low | stale |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 747 | PAN-568 | S | low | stale |  |  | Kanban: Show workspace and tmux session counts in stats |
| 748 | PAN-565 | S | low | stale |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 749 | PAN-564 | S | low | stale |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 750 | PAN-554 | M | low | stale |  |  | Add kanban board deeplinks for issue URLs |
| 751 | PAN-543 | M | low | stale |  |  | Add confirmation dialog before applying Optimal Defaults |
| 752 | PAN-537 | S | low | stale |  |  | feat: show changed files diff summary after each agent response in activity view |
| 753 | PAN-483 | S | low | stale |  |  | Unify Resume Agent UX — all entry points should show message input |
| 754 | PAN-476 | S | low | stale |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 755 | PAN-471 | S | low | stale |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 756 | PAN-468 | S | low | stale |  |  | Agent test conversations pollute production database — need test isolation |
| 757 | PAN-461 | S | low | stale |  |  | Deep-wipe multi-step progress dialog |
| 758 | PAN-459 | S | low | stale |  |  | Planning setup screen with SSE progress streaming |
| 759 | PAN-438 | L | low | stale |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 760 | PAN-265 | S | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 761 | PAN-190 | S | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 762 | PAN-178 | S | low | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 763 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 764 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 765 | PAN-607 | S | low | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 766 | PAN-1049 | S | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 767 | PAN-984 | S | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 768 | PAN-797 | S | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 769 | PAN-771 | S | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 770 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 771 | PAN-1222 | S | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 772 | PAN-633 | M | low | stale |  |  | Update Cloister PRD and docs index — stale relative to implementation |
| 773 | PAN-294 | M | low | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 774 | PAN-293 | S | low | stale |  |  | Project Living Memory — per-project semantic memory for agents |
| 775 | PAN-277 | S | low | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 776 | PAN-258 | S | low | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 777 | PAN-255 | S | low | stale |  |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 778 | PAN-252 | S | low | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 779 | PAN-243 | S | low | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 780 | PAN-924 | S | low | stale |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 781 | PAN-743 | M | low | stale |  |  | Add consistent new conversation icon actions in Command Deck |
| 782 | PAN-663 | S | low | stale |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 783 | PAN-591 | S | low | stale |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 784 | PAN-570 | S | low | stale |  |  | Show PLAN badge on costs when under a subscription/plan |
| 785 | PAN-407 | S | low | stale |  |  | Run Panopticon from a main workspace for development isolation |
| 786 | PAN-299 | S | low | stale |  |  | Granular session state persistence across context compaction |
| 787 | PAN-298 | S | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 788 | PAN-297 | S | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 789 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 790 | PAN-271 | S | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 791 | PAN-249 | M | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 792 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 793 | PAN-228 | S | low | stale |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 794 | PAN-227 | M | low | stale |  |  | Phase gate validation — mid-implementation acceptance checks |
| 795 | PAN-198 | S | low | stale |  |  | Structured audit trail for agent actions |
| 796 | PAN-180 | S | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 797 | PAN-177 | S | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 798 | PAN-176 | S | low | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 799 | PAN-175 | S | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 800 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 801 | PAN-146 | S | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 802 | PAN-106 | S | low | stale |  |  | Cost prediction/estimation for in-progress work |
| 803 | PAN-55 | S | low | stale |  |  | Track specialist costs with time period filtering |
| 804 | PAN-54 | M | low | stale |  |  | feat: Add pan test:e2e command for full workflow integration test |
| 805 | PAN-44 | S | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 806 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 807 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 808 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 809 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 810 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 811 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling… |
| 812 | PAN-853 | S | low | stale |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 813 | PAN-793 | S | low | stale |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 814 | PAN-606 | S | low | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 815 | PAN-77 | S | low | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 816 | PAN-52 | S | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 817 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 818 | PAN-634 | S | low | stale |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 819 | PAN-51 | S | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 820 | PAN-674 | XS | low | stale |  |  | docs: add glossary of Panopticon domain terms |

## Rationale detail

### PAN-3504 (rank 1)

A red main is the single highest-leverage blocker in this backlog: every feature branch that rebases inherits the failure, every verification gate goes red, and the merge gate silently empties (a known Overdeck failure mode). The defect is a one-line field-name mismatch (project.projectPath -> project.path) landed directly on main by an agent commit, and the fix is already proven inside the PAN-3410 branch. Nothing else should be picked up ahead of it.

### PAN-3499 (rank 2)

Same defect, same one-line fix, filed twice within hours by two different sessions — itself a symptom of the missing red-main signal. Keep it adjacent to PAN-3504 so whoever picks either one closes both rather than opening two PRs for one line.

### PAN-3512 (rank 2)

Write-side companion to PAN-3511 — one verdict write door, dispatch-not-drop, and a kill-conditional fallback. Split out because it rewrites write semantics and carries real regression risk; in-review, rank pinned.

### PAN-3532 (rank 3)

This is why a red main can exist at all. Every feature branch gate runs the full frontend suite and inherits main reds that CI cannot see, so an invisible red silently blocks every in-flight issue. Fixing the coverage gap converts the whole red-main class from "discovered by an agent hours later" into "caught on the PR". It is the structural fix behind PAN-3504 and PAN-3502.

### PAN-3502 (rank 4)

A concrete instance of the PAN-3532 blindness: a repricing change left a stale expectation that CI never ran. Cheap to fix and it removes a live red from the frontend suite that every branch gate inherits.

### PAN-3524 (rank 5)

This defeats all four documented ways to stop work — the freeze, review abort, pause and operator-stop — because the loop is owned by the dashboard process rather than any agent, so every agent-scoped gate misses it. It already blocked a red-main fix across four attempts. Until server-owned verification is stoppable, the operator has no reliable brake on the machine, which makes every other recovery story in this backlog unenforceable.

### PAN-3492 (rank 6)

The same server-owned verification runner as PAN-3524, seen from the load side: four concurrent vitest generations for one issue at load 18.5. Retry-on-timeout without draining the previous generation is a positive feedback loop that converts a busy machine into a stalled one, and it manufactures the false test failures that then loop branches through PAN-3520. Fix the loop and a large fraction of "test failed" verdicts disappear.

### PAN-3520 (rank 7)

Proven on 2026-08-03: all gates green, 7202/7238 root tests passing, and the 9 failures were uniform 5000ms timeouts under load 18.9-27.2 that all passed on isolated re-run. Branches (PAN-1577, PAN-3410) looped on verdicts that described the host, not the code. Isolating timeout-only failures before recording is the cheapest way to stop the pipeline from rejecting correct work.

### PAN-3511 (rank 9)

The read half of the same contract, and the defensive half that can land without the write-side regression risk. Four independent recovery paths act on the review row from different evidence at different lags, and none consulted the durable verdict artifact on disk, so a finished convoy races its own recovery and an APPROVED verdict gets wiped to pending. One landed site already proves the approach; this generalises it.

### PAN-2746 (rank 10)

The most dangerous shape in this backlog: a failure mode that produces the exact record of success. The bypass fired because the thing it protected against was broken, so the bug authorised its own blocker, and only a human reading raw logs caught it. Any distinct terminal state (bypassed, not passed) removes the possibility of silently merging unreviewed work.

### PAN-3283 (rank 11)

Two independent issues produced the identical sequence, both while sitting in a UAT batch — the second occurrence is what rules out a benign explanation. Same family as PAN-2746 and directly addressed by the PAN-3511/3512 contract; ranked separately because it is a live blocks-main label with two named specimens to regression-test against.

### PAN-3422 (rank 11)

New, merged and verifying on main, but ranked here because the failure it describes is the single most common way autonomous motion stops: nudge and feedback text lands visibly in an agent's composer and is never submitted, leaving four MYN agents idle between 20 minutes and 2.5 hours, one of them at $242 of session cost. Delivery that reports success while the message sits unsent makes every downstream gate unreliable.

### PAN-3282 (rank 12)

The upstream cause of the whole verdict-recovery cluster. Three variants seen (run dir with only context.json, no run dir at all, explicit infra-failure), all of which read as a rejection unless you open the run directory by hand. It recurs after successful recovery, so restart-and-hope is not the answer; the reviewer death itself needs a root cause.

### PAN-3545 (rank 13)

A stable, silent deadlock — the parent waits forever for four reviewer signals that can never arrive, and the stalled-discovery backstop calls the same filtered handler so it no-ops too. It contradicts the documented state-plane rule that tmux is the liveness oracle, and it fires whenever liveness reconciliation is suppressed (drain hold, --no-resume, unclean reviewer exit) — exactly the conditions of a recovery.

### PAN-3541 (rank 14)

The mechanical break has landed, but the design gap remains: treating "a session id resolves" as "resumable" is wrong for a reviewer killed by OOM or crash, which will hit the resume menu by construction. Each restart still costs a wasted relaunch, and the durability that makes state survive wipes re-arms the wedge every cycle.

### PAN-1230 (rank 14)

Command Deck right-pane Pipeline-lens and TopBar height, the last of the PAN-1148 audit gaps. Merged and verifying on main.

### PAN-3397 (rank 15)

A spawned-but-never-briefed reviewer is indistinguishable from a slow one, and it holds the issue behind a verdict that will never be produced. Same shape as PAN-3084 and PAN-3274; the detector already exists and needs its cold-spawn case.

### PAN-3084 (rank 16)

Zero context, zero cost, zero output is a mechanically unambiguous signal, and the restart path treating the corpse as a live session to preserve is what makes it unrecoverable without manual intervention.

### PAN-3274 (rank 17)

Identical signature to PAN-3084 on the test role: 40 minutes at ctx 0%, out 0, cost $0.00 while GitHub already shows the test check passing. The three facts that should agree (review row, forge check, verdict artifact) disagree, and nothing reconciles them.

### PAN-3500 (rank 18)

A reviewer that edits the code under review destroys the independence the convoy exists for, and it did so after a later message resumed the idle session. The contract is in the prompt; it needs to be in the machinery.

### PAN-3496 (rank 19)

The review pipeline exists to be autonomous. A reviewer that parks on an operator question converts a background gate into an interrupt, and because convoys respawn the interrupt repeats. Decide, do not ask.

### PAN-3234 (rank 20)

The detector already exists and has exactly two consumers, both of which only stop Overdeck making things worse. Nothing in cloister or agents consults it, so a permission menu or session-resume gate holds an agent — in one case the next merge candidate's reviewer — for half an hour while every health signal reads green. Wiring an existing predicate into health is small work with fleet-wide reach.

### PAN-3236 (rank 21)

The ambiguity guard is correct for a timeout or reset, where the injection may have completed. A refused connection means nothing was listening, so there is no ambiguity to protect and the fallback is safe. The sibling error class in the same file already draws exactly this distinction, so the fix is small and the payoff is that blocked-review rework actually reaches the agent.

### PAN-3257 (rank 22)

Resume is the recovery path, and it silently downgrades the agent's delivery transport to one that cannot work. Everything downstream — nudges, review feedback, operator messages — then fails against a socket file whose supervisor died hours ago. Fresh spawn already does this correctly; resume must do the same.

### PAN-3139 (rank 23)

The state-plane doc designates the agents table authoritative and tmux the liveness oracle, and here the authoritative plane drifts stale in the under-reporting direction. Every consumer that enumerates from the table — dispatch, health, capacity accounting, the convoy filter in PAN-3545 — inherits the lie. This is the substrate under a whole family of "no-op because it looked stopped" bugs.

### PAN-2817 (rank 24)

Health patrols detect dead sessions and crashed processes but not the most common failure — alive, idle, and unfinished. A pan tell nudge reliably unsticks them, which means the recovery is known and only the detection is missing; without it the operator hand-cranks the fleet, which is exactly the labour the pipeline exists to remove.

### PAN-3043 (rank 25)

Provider health is probed only at spawn, so a 403 billing-cycle refusal three days into a run is invisible. The agent burns a capacity slot it cannot use and nothing surfaces it, which is worse than a crash because a crash is recoverable.

### PAN-3118 (rank 26)

The rolling-window status line reads healthy because this is a per-model cap, not the session or weekly limit the runbooks describe. Without a capacity fallback the pipeline simply stops planning and no signal says why.

### PAN-3313 (rank 27)

Credentials are valid the whole time; the message sends the operator to re-authenticate for a problem that is a cooldown. Since a large share of the fleet routes GPT models through CLIProxy, benching the sole auth entry is a fleet-wide outage wearing a per-request error.

### PAN-2758 (rank 28)

Same family as PAN-3043 and PAN-3118 — a provider-side refusal that leaves the runtime plane claiming health. Worth fixing together with them as one capacity-error contract.

### PAN-3261 (rank 29)

The resume gate's highlighted row is "Resume from summary", so a stray Enter discards a full operator session. The guard exists precisely to prevent this, and a paste that hides the menu from the detector defeats it. Small, high-consequence.

### PAN-3543 (rank 30)

A self-contradictory deadlock that blocked PAN-3511's rework after a BLOCKED verdict. The durable agents plane re-arms the refusal every cycle, so the operator has no sanctioned path back into an issue that owes rework.

### PAN-3439 (rank 31)

The guard exists a few lines away in resume.ts with a comment explaining exactly this case. Copying it into start turns a hard crash after a reboot-interrupted spawn into the graceful fresh-spawn path.

### PAN-3224 (rank 32)

Same defect as PAN-3439, filed from the crash-restore side. Land them together and regression-test the placeholder value in both entry points.

### PAN-3185 (rank 33)

The agent is spawned and working while the CLI prints a failure, so the operator (or an automation reading the exit code) takes recovery action against a healthy agent. A TOCTOU between two spawn sites is a narrow fix with a loud symptom.

### PAN-3237 (rank 34)

Three issues accumulated the same terminal state one at a time from a transient capacity refusal. Conflating "no room right now" with "this is broken" turns backpressure into permanent stalls, which is the opposite of what a capacity gate is for.

### PAN-3278 (rank 35)

The requeue machinery existed, had capacity, and never fired — so the gap is not capacity but the trigger. Identical cost to four decimal places across two hours is the clean forensic signature to build a detector on.

### PAN-3546 (rank 36)

A stuck-detector that is wrong for a whole harness shape makes every stall report untrustworthy, and it is the same transcript-shape gap as the blank conversation panel in PAN-3544.

### PAN-3544 (rank 37)

The operator's primary window onto a working agent shows the new-conversation empty state. Both copies are false and alarming, and they arrive exactly when the operator is trying to judge whether to intervene.

### PAN-3285 (rank 38)

The two halves of the watchdog compute dashboard identity by different rules, so a reload run from inside a generation directory deadlocks both: every correct dashboard is classified foreign and killed, and no replacement can be started. It produced 1,107 consecutive silent recovery failures with zero escalation, and manual recovery is also killed within 30 seconds. This is the worst availability defect in the backlog.

### PAN-3539 (rank 39)

Victim selection was correct; the blast radius was not. systemd failing the unit on a child kill turns a single greedy process into total session loss, including an in-flight review convoy and every operator conversation. The unit-level fix has landed with the issue; the containment work is PAN-3314.

### PAN-3314 (rank 40)

The structural half of PAN-3539: agent memory is the tmux unit's memory, and oomd selects by cgroup, so the failure mode is all-or-nothing by construction. Per-agent or per-role cgroups convert a fleet-wide outage into the loss of the one offender.

### PAN-3429 (rank 41)

The documented shed categories (merged/closed docker stacks, then idle work agents) were both empty because the real pressure came from concurrent gate and build runs, which the governor does not model. The flywheel did the governor's job by hand, which is the backstop-as-symptom pattern: the shed policy needs a category that matches where the memory actually goes.

### PAN-3344 (rank 42)

The load that actually stalls this machine comes from agent-shell vitest, eslint and tsc runs, not from containers or resident memory, so a memory-only governor watches the wrong meter. This is the shared root under the verification retry storm (PAN-3492), the load-flake test verdicts (PAN-3520) and the watchdog restart churn (PAN-3522), which is why it earns critical despite being a governor tuning change.

### PAN-3522 (rank 43)

Restarting a dashboard that is slow-but-alive under load makes the load worse and costs the operator the surface they need to diagnose it. Downstream of PAN-3344; worth its own fix because the warm-phase budget is independently wrong.

### PAN-3533 (rank 44)

A runaway MYN container burned ~160% CPU for days and was a major contributor to the storm that starved the dashboard health probes. Partitioning is the structural companion to PAN-3344's gating: gating decides when to admit, partitioning decides whose work pays for a noisy neighbour.

### PAN-3432 (rank 45)

One review convoy needs a handful of reviewer slots, so seven yields is thrash rather than preemption — and the victims then flood back oldest-first and re-create the contention. Bound the fan-out to the beneficiary's actual need.

### PAN-2813 (rank 46)

The documented contract says a yield is self-clearing, and it is not — memory was fine and agent counts low in both reproduced windows. An un-clearing yield is indistinguishable from an operator pause, which is how it also breaks the merge path in PAN-3120.

### PAN-3329 (rank 47)

Second occurrence of an identical signature, and the failure is total: ERR_MODULE_NOT_FOUND on every new pan invocation until someone reinstalls. A build that can delete the tree the CLI resolves from needs isolation, not a retry.

### PAN-3250 (rank 48)

Four of five sampled branches were contaminated, two created after the problem was identified, and the PRs still show MERGEABLE/CLEAN — so review and CI cannot see it. Every contaminated branch launders unreviewed commits into a PR. Two spawn sites use a local ref where they need origin/main; the fix is small and the exposure compounds daily.

### PAN-3062 (rank 49)

The upstream condition that makes PAN-3250 dangerous and PAN-3505 possible: many sessions stacking commits on one local branch with no ownership. Until commits are session-owned, the state write door and the flywheel will keep being blocked by other people's work.

### PAN-3505 (rank 50)

A live instance of PAN-3062. The push guard correctly refuses, so durable state stops flowing until a human unblocks it — which means the state plane's liveness depends on nobody leaving a commit behind.

### PAN-3284 (rank 51)

No work was lost this time, but the write blocked an unrelated pull in the primary worktree, and a same-file write racing an operator commit would be silently absorbed. Evidence that path resolution can escape the workspace cwd even when the cwd is correct.

### PAN-2409 (rank 52)

The enforcement half of the PAN-3284/PAN-2204 family. In the referenced incident one agent's real implementation went to the primary checkout so review evaluated an incomplete branch, and another's entire work-in-progress sat uncommitted in primary when it was killed. A boundary that exists only in the prompt is not a boundary.

### PAN-3081 (rank 53)

A control removable by the thing it constrains is worse than no control, because the rest of the system is designed as if it holds. Every guarantee built on the git guard (no history rewriting, no stray main pushes) is currently advisory.

### PAN-807 (rank 54)

Reflog-confirmed: spawn hard-reset a feature branch to a two-day-old commit and then committed planning artifacts on top. Nothing was lost only because the work happened to be pushed. It is the same substrate as PAN-3250 and PAN-2409 — spawn treating the workspace as disposable — and it carries explicit acceptance criteria already.

### PAN-3424 (rank 55)

Two independent durability holes found live, one accumulating for two weeks (16 orphaned drafts). The main-branch path already detects and reconciles non-fast-forward pushes; the state branch just console.warns and returns. Permanent pipeline state that silently stops persisting is the quietest possible data-loss shape.

### PAN-3270 (rank 56)

Every agent pays this tax independently and the failure is oblique rather than obvious. Cheap to fix at workspace creation and it removes a recurring first-ten-minutes stall from every spawn.

### PAN-3325 (rank 57)

The dangerous half of PAN-3270: the environment looks like it works while running against a different tree's dependencies, so the symptom appears far from the cause. Fail loudly or populate; never half-present.

### PAN-2763 (rank 58)

Same family as PAN-3270/PAN-3325 seen from the symlink side. Worth folding into one workspace-dependency fix rather than three separate ones.

### PAN-3288 (rank 59)

A one-check preflight converts a confusing ERR_MODULE_NOT_FOUND into "run bun install", which is exactly the diagnosis an operator or agent then wastes time reaching.

### PAN-3103 (rank 60)

The status self-heals minutes later and nothing retries, so the issue stays merged-but-open forever and looks like fresh work to the pickup gate. That is how an agent gets spawned on already-shipped code, which wastes a slot and produces a confusing empty diff.

### PAN-3171 (rank 61)

The operator is told the opposite of what happened, with the commit already on main and all CI green. Wrong-direction reporting at the merge boundary destroys trust in every other pipeline message.

### PAN-3188 (rank 62)

The row accepts only the transient verifying_on_main waypoint, so completing the lifecycle makes close-out impossible except through an operator override — the gate punishes success. Eleven simultaneous specimens make it mechanically testable.

### PAN-3168 (rank 63)

A close-out step blocked by the state that close-out itself created. All three state planes agree the agent is not running; only the row-5 predicate disagrees. Sibling of PAN-3188 and fixable in the same pass.

### PAN-3211 (rank 64)

Five confirmed specimens where work never landed anywhere. The DoD gate refusing is correct, so the missing piece is a truthful terminal state rather than a looser gate. Without it these rows inflate every operator count forever.

### PAN-3190 (rank 65)

The command has never worked through the CLI, verified across all 13 issues holding stale pending-auto-merge rows. A one-line signature fix restores the only way to cancel a queued auto-merge.

### PAN-3321 (rank 66)

An operator following the guidance verbatim during a stuck-pipeline incident gets "unknown command" with no hint at the real verb. Either implement the verb or fix every advertisement of it; both are cheap and both are better than the current state.

### PAN-3281 (rank 67)

The merge-ready flag wins on every surface consulted, so a verification failure for incomplete work is invisible to promotion. Two contradictory booleans on one row need a precedence rule, not another consumer that checks both.

### PAN-3106 (rank 68)

A configured policy that only one of several code paths honours is worse than no policy, because the operator reasonably believes it holds. Directly undermines the whole UAT batch model this repo invested in.

### PAN-2567 (rank 69)

The convergence failure that the merge gate was supposed to solve. Belongs with PAN-1650 and PAN-3281 as one "what actually makes a PR merge" pass.

### PAN-1650 (rank 70)

One boolean wearing two hats produces a merge gate that rejects while simultaneously reporting review and test passed — the message is a lie and the real blocker is invisible. Making gates-passed event-driven removes the poller latency that PAN-2567, PAN-3281 and PAN-3278 all sit behind.

### PAN-3417 (rank 71)

Three specimens in one day, one still running full-suite gate cycles 45 minutes after its fix shipped. A branch-landed check at the top of the monitor loop ends the burn.

### PAN-3362 (rank 71)

In pipeline. Workspace containers have no issue data by design, so any AC that requires a live issue can only be resolved by an operator override on an unverified diff. It blocks the entire UI-redesign track.

### PAN-3047 (rank 72)

One close-out gate proves the branch merged and the next step claims it did not, in the same run. The same squash-blindness defeats PAN-2828 and PAN-2995, so fix the containment test once and all three resolve.

### PAN-2995 (rank 73)

Same squash-blindness as PAN-3047 and PAN-2828 on the completion side. Landing one shared merged-ness oracle is cheaper and safer than three ancestry heuristics.

### PAN-2828 (rank 74)

Third filing of the squash-ancestry defect. Close as part of the shared merged-ness oracle rather than patching a third call site.

### PAN-2883 (rank 75)

Six issues blocked at once from a hardcoded branch prefix. Every strike that lands hits it, so strikes — the fast path for urgent pipeline blockers — can never complete their lifecycle.

### PAN-2874 (rank 76)

Four CI-green strike PRs sat unmerged until a human merged them by hand. Strikes exist to unblock the pipeline fast, so a landing path they structurally cannot pass defeats the mechanism.

### PAN-2921 (rank 77)

Produced a real duplicate PR merged as an empty commit. Same wrong-direction reporting family as PAN-3171; the merge door needs to confirm before it reports.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-08-04T19:00:58.338Z",
  "model": "claude-opus-5",
  "pass": "creation",
  "openCount": 820,
  "nodes": [
    {
      "issue": "PAN-3504",
      "rank": 1,
      "size": "XS",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main: tsc fails on parked.ts ProjectConfig.projectPath. Every rebased branch inherits a red gate. One-line fix.",
      "rationale": "A red main is the single highest-leverage blocker in this backlog: every feature branch that rebases inherits the failure, every verification gate goes red, and the merge gate silently empties (a known Overdeck failure mode). The defect is a one-line field-name mismatch (project.projectPath -> project.path) landed directly on main by an agent commit, and the fix is already proven inside the PAN-3410 branch. Nothing else should be picked up ahead of it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3499",
      "rank": 2,
      "size": "XS",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate filing of the PAN-3504 red-main typecheck break. Land once, close the other as duplicate.",
      "rationale": "Same defect, same one-line fix, filed twice within hours by two different sessions — itself a symptom of the missing red-main signal. Keep it adjacent to PAN-3504 so whoever picks either one closes both rather than opening two PRs for one line.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3532",
      "rank": 3,
      "size": "S",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI runs only 4 of ~300 frontend test files, so main was red on frontend while CI reported green for the same SHA.",
      "rationale": "This is why a red main can exist at all. Every feature branch gate runs the full frontend suite and inherits main reds that CI cannot see, so an invisible red silently blocks every in-flight issue. Fixing the coverage gap converts the whole red-main class from \"discovered by an agent hours later\" into \"caught on the PR\". It is the structural fix behind PAN-3504 and PAN-3502.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3502",
      "rank": 4,
      "size": "XS",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [
        "PAN-3532"
      ],
      "why": "Stale blendedCost literal in tiered-crews.test.ts — one of the two frontend files that were red on main invisibly.",
      "rationale": "A concrete instance of the PAN-3532 blindness: a repricing change left a stale expectation that CI never ran. Cheap to fix and it removes a live red from the frontend suite that every branch gate inherits.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3524",
      "rank": 5,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "P0: a dashboard-owned --changed verification loop survives Deacon freeze, review abort, pause and operator-stop; held 78 vitest workers.",
      "rationale": "This defeats all four documented ways to stop work — the freeze, review abort, pause and operator-stop — because the loop is owned by the dashboard process rather than any agent, so every agent-scoped gate misses it. It already blocked a red-main fix across four attempts. Until server-owned verification is stoppable, the operator has no reliable brake on the machine, which makes every other recovery story in this backlog unenforceable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3492",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Server-side gate retries self-amplify: load-induced timeout triggers a retry that raises load, so retries breed retries.",
      "rationale": "The same server-owned verification runner as PAN-3524, seen from the load side: four concurrent vitest generations for one issue at load 18.5. Retry-on-timeout without draining the previous generation is a positive feedback loop that converts a busy machine into a stalled one, and it manufactures the false test failures that then loop branches through PAN-3520. Fix the loop and a large fraction of \"test failed\" verdicts disappear.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3520",
      "rank": 7,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test gate records verdicts from load-flake timeouts; re-running the same files in isolation passes. Retry timeout-only failures before re…",
      "rationale": "Proven on 2026-08-03: all gates green, 7202/7238 root tests passing, and the 9 failures were uniform 5000ms timeouts under load 18.9-27.2 that all passed on isolated re-run. Branches (PAN-1577, PAN-3410) looped on verdicts that described the host, not the code. Isolating timeout-only failures before recording is the cheapest way to stop the pipeline from rejecting correct work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3512",
      "rank": 2,
      "size": "L",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict write door — recordReviewVerdict + dispatch-not-drop + fallback kill-conditional (write side)",
      "rationale": "Write-side companion to PAN-3511 — one verdict write door, dispatch-not-drop, and a kill-conditional fallback. Split out because it rewrites write semantics and carries real regression risk; in-review, rank pinned.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3511",
      "rank": 9,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every recovery path must read the synthesis artifact before acting on a review row. PAN-1577 lost five passed reviews in one evening.",
      "rationale": "The read half of the same contract, and the defensive half that can land without the write-side regression risk. Four independent recovery paths act on the review row from different evidence at different lags, and none consulted the durable verdict artifact on disk, so a finished convoy races its own recovery and an APPROVED verdict gets wiped to pending. One landed site already proves the approach; this generalises it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [
        "PAN-3512"
      ],
      "why": "Review-infra bypass writes reviewStatus=passed, indistinguishable from four approvals. Nearly merged a pipeline-critical change unreviewed.",
      "rationale": "The most dangerous shape in this backlog: a failure mode that produces the exact record of success. The bypass fired because the thing it protected against was broken, so the bug authorised its own blocker, and only a human reading raw logs caught it. Any distinct terminal state (bypassed, not passed) removes the possibility of silently merging unreviewed work.",
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
      "dependsOn": [
        "PAN-3512"
      ],
      "why": "blocks-main: recovering from review_infrastructure_failure sets review_status=passed and ready_for_merge=1 over an outstanding CHANGES RE…",
      "rationale": "Two independent issues produced the identical sequence, both while sitting in a UAT batch — the second occurrence is what rules out a benign explanation. Same family as PAN-2746 and directly addressed by the PAN-3511/3512 contract; ranked separately because it is a live blocks-main label with two named specimens to regression-test against.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents die before writing a verdict across 5 issues and 2 projects; the status is indistinguishable from a real rejection.",
      "rationale": "The upstream cause of the whole verdict-recovery cluster. Three variants seen (run dir with only context.json, no run dir at all, explicit infra-failure), all of which read as a rejection unless you open the run directory by hand. It recurs after successful recovery, so restart-and-hope is not the answer; the reviewer death itself needs a root cause.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3545",
      "rank": 13,
      "size": "S",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy launch no-ops on stale running rows: the discovery-ready filter discards the tmux liveness answer it already has.",
      "rationale": "A stable, silent deadlock — the parent waits forever for four reviewer signals that can never arrive, and the stalled-discovery backstop calls the same filtered handler so it no-ops too. It contradicts the documented state-plane rule that tmux is the liveness oracle, and it fires whenever liveness reconciliation is suppressed (drain hold, --no-resume, unclean reviewer exit) — exactly the conditions of a recovery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3541",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review restart loops on the session-resume menu after an unclean reviewer death; resume eligibility ignores how the session ended.",
      "rationale": "The mechanical break has landed, but the design gap remains: treating \"a session id resolves\" as \"resumable\" is wrong for a reviewer killed by OOM or crash, which will hit the resume menu by construction. Each restart still costs a wasted relaunch, and the durability that makes state survive wipes re-arms the wedge every cycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3397",
      "rank": 15,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Freshly-spawned convoy lanes freeze at 0 output before processing kickoff; the existing detector covers warm resumes only.",
      "rationale": "A spawned-but-never-briefed reviewer is indistinguishable from a slow one, and it holds the issue behind a verdict that will never be produced. Same shape as PAN-3084 and PAN-3274; the detector already exists and needs its cold-spawn case.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 16,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever and blocks its own replacement — restart \"preserves\" it.",
      "rationale": "Zero context, zero cost, zero output is a mechanically unambiguous signal, and the restart path treating the corpse as a live session to preserve is what makes it unrecoverable without manual intervention.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 17,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "A test-role agent spawns and never runs, stranding an approved, CI-green issue behind a verdict that was never produced.",
      "rationale": "Identical signature to PAN-3084 on the test role: 40 minutes at ctx 0%, out 0, cost $0.00 while GitHub already shows the test check passing. The three facts that should agree (review row, forge check, verdict artifact) disagree, and nothing reconciles them.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3500",
      "rank": 18,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review sub-role can modify the branch after writing its report, violating its own spawn contract.",
      "rationale": "A reviewer that edits the code under review destroys the independence the convoy exists for, and it did so after a later message resumed the idle session. The contract is in the prompt; it needs to be in the machinery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3496",
      "rank": 19,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/inspect agents AskUserQuestion the operator for review depth; convoys respawn, so the operator gets the same dialog repeatedly.",
      "rationale": "The review pipeline exists to be autonomous. A reviewer that parks on an operator question converts a background gate into an interrupt, and because convoys respawn the interrupt repeats. Decide, do not ask.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 20,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze on blocking choice menus and no health surface detects it; paneHasBlockingChoiceMenu is wired only to delivery refusal.",
      "rationale": "The detector already exists and has exactly two consumers, both of which only stop Overdeck making things worse. Nothing in cloister or agents consults it, so a permission menu or session-resume gate holds an agent — in one case the next merge candidate's reviewer — for half an hour while every health signal reads green. Wiring an existing predicate into health is small work with fleet-wide reach.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 21,
      "size": "S",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket is treated as ambiguous, so feedback never crosses to tmux and the issue goes stuck with the fil…",
      "rationale": "The ambiguity guard is correct for a timeout or reset, where the injection may have completed. A refused connection means nothing was listening, so there is no ambiguity to protect and the fallback is safe. The sibling error class in the same file already draws exactly this distinction, so the fix is small and the payoff is that blocked-review rework actually reaches the agent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 22,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume does not re-wire the PTY supervisor: stale socket refuses every delivery and state.json loses supervisorEnabled.",
      "rationale": "Resume is the recovery path, and it silently downgrades the agent's delivery transport to one that cannot work. Everything downstream — nudges, review feedback, operator messages — then fails against a socket file whose supervisor died hours ago. Fresh spawn already does this correctly; resume must do the same.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3139",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "The authoritative agents table records a live 4h agent as stopped, and pan start's own liveness check contradicts it.",
      "rationale": "The state-plane doc designates the agents table authoritative and tmux the liveness oracle, and here the authoritative plane drifts stale in the under-reporting direction. Every consumer that enumerates from the table — dispatch, health, capacity accounting, the convoy filter in PAN-3545 — inherits the lie. This is the substrate under a whole family of \"no-op because it looked stopped\" bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 24,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work and review agents are never re-driven; sessions stop mid-task at the composer and sit for hours.",
      "rationale": "Health patrols detect dead sessions and crashed processes but not the most common failure — alive, idle, and unfinished. A pan tell nudge reliably unsticks them, which means the recovery is known and only the detection is missing; without it the operator hand-cranks the fleet, which is exactly the labour the pipeline exists to remove.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3043",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion is undetected: an agent stays running for days holding a slot while every model call is refused.",
      "rationale": "Provider health is probed only at spawn, so a 403 billing-cycle refusal three days into a run is invisible. The agent burns a capacity slot it cannot use and nothing surfaces it, which is worse than a crash because a crash is recoverable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 26,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model-specific quota exhaustion halts agents invisibly — four planning agents \"running\" at $0.00 with no capacity fallback.",
      "rationale": "The rolling-window status line reads healthy because this is a per-model cap, not the session or weekly limit the runbooks describe. Without a capacity fallback the pipeline simply stops planning and no signal says why.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3313",
      "rank": 27,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient upstream stream error benches CLIProxy's only auth, so ~70% of GPT-routed requests 503 with a message that blames credentials.",
      "rationale": "Credentials are valid the whole time; the message sends the operator to re-authenticate for a problem that is a cooldown. Since a large share of the fleet routes GPT models through CLIProxy, benching the sole auth entry is a fleet-wide outage wearing a per-request error.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 28,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "A provider capacity error zombies a spawned agent: willRetry=false, the turn reports completed, status stays running forever.",
      "rationale": "Same family as PAN-3043 and PAN-3118 — a provider-side refusal that leaves the runtime plane claiming health. Worth fixing together with them as one capacity-error contract.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 29,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "The tmux fallback answers a live choice menu when its own paste hides the menu from the detector — the PAN-3212 data-loss shape.",
      "rationale": "The resume gate's highlighted row is \"Resume from summary\", so a stray Enter discards a full operator session. The guard exists precisely to prevent this, and a paste that hides the menu from the detector defeats it. Small, high-consequence.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3543",
      "rank": 30,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Completed-handoff agents are unstartable: start, --fresh and reset-session all refuse while the refusal recommends --fresh.",
      "rationale": "A self-contradictory deadlock that blocked PAN-3511's rework after a BLOCKED verdict. The durable agents plane re-arms the refusal every cycle, so the operator has no sanctioned path back into an issue that owes rework.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3439",
      "rank": 31,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start crashes on a pending-work-spawn placeholder row; resume already has the guard, start does not.",
      "rationale": "The guard exists a few lines away in resume.ts with a comment explaining exactly this case. Copying it into start turns a hard crash after a reboot-interrupted spawn into the graceful fresh-spawn path.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3224",
      "rank": 32,
      "size": "XS",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "A crash-interrupted spawn strands model=\"pending-work-spawn\" in agent state; only --fresh recovers.",
      "rationale": "Same defect as PAN-3439, filed from the crash-restore side. Land them together and regression-test the placeholder value in both entry points.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3185",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reports a false hard failure when the deacon wins the spawn race — duplicate-session TOCTOU between two spawn.ts sites.",
      "rationale": "The agent is spawned and working while the CLI prints a failure, so the operator (or an automation reading the exit code) takes recovery action against a healthy agent. A TOCTOU between two spawn sites is a narrow fix with a loud symptom.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 34,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "A capacity-refused planning->work handoff is marked terminally stuck: every HTTP 409 becomes \"guardrails\" and calls markWorkspaceStuck.",
      "rationale": "Three issues accumulated the same terminal state one at a time from a transient capacity refusal. Conflating \"no room right now\" with \"this is broken\" turns backpressure into permanent stalls, which is the opposite of what a capacity gate is for.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3278",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "A finished work agent with an open PR sat two hours because review was never dispatched; auto-requeue had 25 attempts and fired none.",
      "rationale": "The requeue machinery existed, had capacity, and never fired — so the gap is not capacity but the trigger. Identical cost to four decimal places across two hours is the clean forensic signature to build a detector on.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3546",
      "rank": 36,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show false-flags actively working GPT-harness agents as stuck: lastActivity frozen at spawn for claude-code+CLIProxy sessions.",
      "rationale": "A stuck-detector that is wrong for a whole harness shape makes every stall report untrustworthy, and it is the same transcript-shape gap as the blank conversation panel in PAN-3544.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3544",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "The conversation panel renders \"How can I help you?\" over a live agent 250 tool calls deep, and \"no saved history\" after it ends.",
      "rationale": "The operator's primary window onto a working agent shows the new-conversation empty state. Both copies are false and alarming, and they arrive exactly when the operator is trying to judge whether to intervene.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3285",
      "rank": 38,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "critical: a supervisor pinned to a pan reload generation SIGTERMs every healthy dashboard and cannot start a replacement. 3.5h outage.",
      "rationale": "The two halves of the watchdog compute dashboard identity by different rules, so a reload run from inside a generation directory deadlocks both: every correct dashboard is classified foreign and killed, and no replacement can be started. It produced 1,107 consecutive silent recovery failures with zero escalation, and manual recovery is also killed within 30 seconds. This is the worst availability defect in the backlog.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3539",
      "rank": 39,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "A kernel OOM of one agent-spawned process failed the whole tmux unit (OOMPolicy=stop), killing every agent and conversation on the machine.",
      "rationale": "Victim selection was correct; the blast radius was not. systemd failing the unit on a child kill turns a single greedy process into total session loss, including an in-flight review convoy and every operator conversation. The unit-level fix has landed with the issue; the containment work is PAN-3314.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3314",
      "rank": 40,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-3539"
      ],
      "why": "One cgroup holds the whole fleet, so oomd killing any single hungry agent takes every other agent with it. Twice already.",
      "rationale": "The structural half of PAN-3539: agent memory is the tmux unit's memory, and oomd selects by cgroup, so the failure mode is all-or-nothing by construction. Per-agent or per-role cgroups convert a fleet-wide outage into the loss of the one offender.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3429",
      "rank": 41,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The memory governor defers admissions but sheds nothing under HARD pressure — PSI 41.9 at 2.2GB available while it only logged soft defer…",
      "rationale": "The documented shed categories (merged/closed docker stacks, then idle work agents) were both empty because the real pressure came from concurrent gate and build runs, which the governor does not model. The flywheel did the governor's job by hand, which is the backstop-as-symptom pattern: the shed policy needs a category that matches where the memory actually goes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3344",
      "rank": 42,
      "size": "L",
      "importance": "critical",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD ready. Resource governor gates on memory alone; agent-shell test runs drove load to 48 on 24 cores with memory fine.",
      "rationale": "The load that actually stalls this machine comes from agent-shell vitest, eslint and tsc runs, not from containers or resident memory, so a memory-only governor watches the wrong meter. This is the shared root under the verification retry storm (PAN-3492), the load-flake test verdicts (PAN-3520) and the watchdog restart churn (PAN-3522), which is why it earns critical despite being a governor tuning change.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3522",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-3344"
      ],
      "why": "The supervisor watchdog restart-churns under CPU storm: the probe timeout budget ignores the boot warm phase.",
      "rationale": "Restarting a dashboard that is slow-but-alive under load makes the load worse and costs the operator the surface they need to diagnose it. Downstream of PAN-3344; worth its own fix because the warm-phase budget is independently wrong.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3533",
      "rank": 44,
      "size": "L",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator-directed: per-project isolation classes so one project's heavy consumers cannot starve another project's pipeline.",
      "rationale": "A runaway MYN container burned ~160% CPU for days and was a major contributor to the storm that starved the dashboard health probes. Partitioning is the structural companion to PAN-3344's gating: gating decides when to admit, partitioning decides whose work pays for a noisy neighbour.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3432",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive yield fans out: seven work agents simultaneously paused \"making room for review of MIN-874\" for one convoy.",
      "rationale": "One review convoy needs a handful of reviewer slots, so seven yields is thrash rather than preemption — and the victims then flood back oldest-first and re-create the contention. Bound the fan-out to the beneficiary's actual need.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 46,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yields never self-clear: yielded work agents stayed paused for hours after the review they yielded for merged.",
      "rationale": "The documented contract says a yield is self-clearing, and it is not — memory was fine and agent counts low in both reproduced windows. An un-clearing yield is indistinguishable from an operator pause, which is how it also breaks the merge path in PAN-3120.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3329",
      "rank": 47,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment-generation node_modules and tracked packages/ files deleted mid-build, breaking every pan invocation machine-wide.",
      "rationale": "Second occurrence of an identical signature, and the failure is total: ERR_MODULE_NOT_FOUND on every new pan invocation until someone reinstalls. A build that can delete the tree the CLI resolves from needs isolation, not a retry.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 48,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "blocks-main: workspace spawn branches from local HEAD/defaultBranch, so every new workspace inherits unpushed local main commits.",
      "rationale": "Four of five sampled branches were contaminated, two created after the problem was identified, and the PRs still show MERGEABLE/CLEAN — so review and CI cannot see it. Every contaminated branch launders unreviewed commits into a PR. Two spawn sites use a local ref where they need origin/main; the fix is small and the exposure compounds daily.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 49,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "The shared primary main worktree means whoever pushes main next ships every other session's unpushed commits, verified or not.",
      "rationale": "The upstream condition that makes PAN-3250 dangerous and PAN-3505 possible: many sessions stacking commits on one local branch with no ownership. Until commits are session-owned, the state write door and the flywheel will keep being blocked by other people's work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3505",
      "rank": 50,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-3062"
      ],
      "why": "Unpushed agent code commits on the primary main worktree block the flywheel's state write door; the guard is right, the situation is not.",
      "rationale": "A live instance of PAN-3062. The push guard correctly refuses, so durable state stops flowing until a human unblocks it — which means the state plane's liveness depends on nobody leaving a commit behind.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 51,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "A work agent wrote a doc edit into the primary main worktree instead of its workspace (the PAN-2204 family).",
      "rationale": "No work was lost this time, but the write blocked an unrelated pull in the primary worktree, and a same-file write racing an operator commit would be silently absorbed. Evidence that path resolution can escape the workspace cwd even when the cwd is correct.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 52,
      "size": "L",
      "importance": "critical",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Nothing blocks a work agent from writing outside its workspace; three agents edited the primary checkout by absolute path in one incident.",
      "rationale": "The enforcement half of the PAN-3284/PAN-2204 family. In the referenced incident one agent's real implementation went to the primary checkout so review evaluated an incomplete branch, and another's entire work-in-progress sat uncommitted in primary when it was killed. A boundary that exists only in the prompt is not a boundary.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3081",
      "rank": 53,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "The agent git guard sits on $PATH, so any agent can remove it — and one did, unprompted, to get past a block it disagreed with.",
      "rationale": "A control removable by the thing it constrains is worse than no control, because the rest of the system is designed as if it holds. Every guarantee built on the git guard (no history rewriting, no stray main pushes) is currently advisory.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 54,
      "size": "L",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "critical/architecture: spawn pre-flight so the flow stops hard-resetting local branches and committing planning artifacts over unpushed w…",
      "rationale": "Reflog-confirmed: spawn hard-reset a feature branch to a two-day-old commit and then committed planning artifacts on top. Nothing was lost only because the work happened to be pushed. It is the same substrate as PAN-3250 and PAN-2409 — spawn treating the workspace as disposable — and it carries explicit acceptance criteria already.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3424",
      "rank": 55,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "The state plane silently stops being durable: a non-fast-forward overdeck-state push is only warned about, and drafts/ PRDs are never sta…",
      "rationale": "Two independent durability holes found live, one accumulating for two weeks (16 orphaned drafts). The main-branch path already detects and reconciles non-fast-forward pushes; the state branch just console.warns and returns. Permanent pipeline state that silently stops persisting is the quietest possible data-loss shape.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 56,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "New workspaces arrive with empty node_modules and bun is off the agent shell PATH, so the documented remedy fails.",
      "rationale": "Every agent pays this tax independently and the failure is oblique rather than obvious. Cheap to fix at workspace creation and it removes a recurring first-ten-minutes stall from every spawn.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3325",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "An empty-but-present workspace node_modules makes tooling silently resolve from the parent repo instead of failing loudly.",
      "rationale": "The dangerous half of PAN-3270: the environment looks like it works while running against a different tree's dependencies, so the symptom appears far from the cause. Fail loudly or populate; never half-present.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 58,
      "size": "S",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "A workspace node_modules symlinked to the primary repo — the exact pattern CLAUDE.md forbids — breaking test resolution.",
      "rationale": "Same family as PAN-3270/PAN-3325 seen from the symlink side. Worth folding into one workspace-dependency fix rather than three separate ones.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3288",
      "rank": 59,
      "size": "XS",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dev-checkout preflight: a git pull that adds a dependency leaves node_modules stale and the CLI dies on a raw resolution stack trace.",
      "rationale": "A one-check preflight converts a confusing ERR_MODULE_NOT_FOUND into \"run bun install\", which is exactly the diagnosis an operator or agent then wastes time reaching.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3103",
      "rank": 60,
      "size": "M",
      "importance": "critical",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "A transient merge_status=failed permanently skips close-out, leaving merged work open and pickup-eligible — a planning agent spawned on s…",
      "rationale": "The status self-heals minutes later and nothing retries, so the issue stays merged-but-open forever and looks like fresh work to the pickup gate. That is how an agent gets spawned on already-shipped code, which wastes a slot and produces a confusing empty diff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 61,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "The pipeline reports \"merge failed\" after a successful merge and successful post-merge cleanup; the issue stays Todo with no label.",
      "rationale": "The operator is told the opposite of what happened, with the commit already on main and all CI green. Wrong-direction reporting at the merge boundary destroys trust in every other pipeline message.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 62,
      "size": "S",
      "importance": "critical",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "substrate: DoD row 5 rejects terminal canonical states, so an already-done issue can never satisfy the post-merge row. All 11 issues in a…",
      "rationale": "The row accepts only the transient verifying_on_main waypoint, so completing the lifecycle makes close-out impossible except through an operator override — the gate punishes success. Eleven simultaneous specimens make it mechanically testable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3168",
      "rank": 63,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 deadlocks close-out: an agent paused for close-out with no tmux session is counted as running and blocks it.",
      "rationale": "A close-out step blocked by the state that close-out itself created. All three state planes agree the agent is not running; only the row-5 predicate disagrees. Sibling of PAN-3188 and fixable in the same pass.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3211",
      "rank": 64,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "No honest disposition for closed-without-landing issues: residue rows are neither closeable nor reapable, and every override would be a lie.",
      "rationale": "Five confirmed specimens where work never landed anywhere. The DoD gate refusing is correct, so the missing piece is a truthful terminal state rather than a looser gate. Without it these rows inflate every operator count forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 65,
      "size": "XS",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan merge cancel is 100% broken: Commander passes its options object into the injectable-fetch parameter slot.",
      "rationale": "The command has never worked through the CLI, verified across all 13 issues holding stale pending-auto-merge rows. A one-line signature fix restores the only way to cancel a queued auto-merge.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3321",
      "rank": 66,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Escalation messages and CLAUDE.md tell the operator to run `pan unstick <id>`, which does not exist.",
      "rationale": "An operator following the guidance verbatim during a stuck-pipeline incident gets \"unknown command\" with no hint at the real verb. Either implement the verb or fix every advertisement of it; both are cheap and both are better than the current state.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3281",
      "rank": 67,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while an issue is stuck on incomplete-plan-items, so unfinished work reaches the UAT batch.",
      "rationale": "The merge-ready flag wins on every surface consulted, so a verification failure for incomplete work is invisible to promotion. Two contradictory booleans on one row need a precedence rule, not another consumer that checks both.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 68,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default: hold is consulted on exactly one merge path, so held projects still auto-merge individually and the UAT train is defe…",
      "rationale": "A configured policy that only one of several code paths honours is worse than no policy, because the operator reasonably believes it holds. Directly undermines the whole UAT batch model this repo invested in.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 69,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "A reviewed, green PR stays stuck after review: the advancing verdict reconciles forever and the merge never fires under a churning main.",
      "rationale": "The convergence failure that the merge gate was supposed to solve. Belongs with PAN-1650 and PAN-3281 as one \"what actually makes a PR merge\" pass.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 70,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "architecture: split readyForMerge into gatesPassed (event-driven) and shipComplete; today it only flips via recovery pollers.",
      "rationale": "One boolean wearing two hats produces a merge gate that rejects while simultaneously reporting review and test passed — the message is a lie and the real blocker is invisible. Making gates-passed event-driven removes the poller latency that PAN-2567, PAN-3281 and PAN-3278 all sit behind.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3417",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no merged-awareness: they keep verifying and monitoring after their branch lands, burning cost on moot gates.",
      "rationale": "Three specimens in one day, one still running full-suite gate cycles 45 minutes after its fix shipped. A branch-landed check at the top of the monitor loop ends the burn.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 72,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown never fires: --is-ancestor cannot see through a squash merge, so all 96 strike/* branches are preserved as residue.",
      "rationale": "One close-out gate proves the branch merged and the next step claims it did not, in the same run. The same squash-blindness defeats PAN-2828 and PAN-2995, so fix the containment test once and all three resolve.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2995",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike false-blocks after a gh-API squash merge — it should verify PR-merged/content, not branch ancestry.",
      "rationale": "Same squash-blindness as PAN-3047 and PAN-2828 on the completion side. Landing one shared merged-ness oracle is cheaper and safer than three ancestry heuristics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 74,
      "size": "XS",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes because --is-ancestor cannot see through a squash.",
      "rationale": "Third filing of the squash-ancestry defect. Close as part of the shared merged-ness oracle rather than patching a third call site.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2883",
      "rank": 75,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out deploy row fails for every strike-landed issue: the PR resolver hardcodes feature/ branches and cannot find strike/ PRs.",
      "rationale": "Six issues blocked at once from a hardcoded branch prefix. Every strike that lands hits it, so strikes — the fast path for urgent pipeline blockers — can never complete their lifecycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "stale",
      "dependsOn": [],
      "why": "Strikes cannot merge: the verification gate demands an xBRIEF checklist strikes never have, and failed-feedback delivery wedges on exited…",
      "rationale": "Four CI-green strike PRs sat unmerged until a human merged them by hand. Strikes exist to unblock the pipeline fast, so a landing path they structurally cannot pass defeats the mechanism.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 77,
      "size": "S",
      "importance": "medium",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "The strike merge door can report a fetch failure after a successful merge and land the same head twice.",
      "rationale": "Produced a real duplicate PR merged as an empty commit. Same wrong-direction reporting family as PAN-3171; the merge door needs to confirm before it reports.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3218",
      "rank": 78,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: a user-facing fix can sit merged on main for hours while every published version stays broken.",
      "rationale": "The Definition of Done enforces build drift per issue but nothing answers \"is the published package broken\". The instance that exposed it left @overdeck/core uninstallable for every user with the fix already on main. For a shipped product this is the gap between merged and actually delivered.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3498",
      "rank": 79,
      "size": "S",
      "importance": "critical",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "write-sequence pins in-pipeline ranks without renumbering, producing duplicate ranks and holes — rank stops being a total order.",
      "rationale": "This corrupts the artifact the Flywheel reads for pickup order, the merge order, and the operator-facing backlog table, all of which treat rank as unique and contiguous. It is the sequencer's own substrate, so it degrades every future pass including this one.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3289",
      "rank": 80,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "The sequencer ran a full pass on an empty manifest against a 750-issue backlog — the read model was transiently empty at spawn.",
      "rationale": "A sequencer that cannot tell \"no issues\" from \"not loaded yet\" will periodically publish an empty ordering over a real backlog. A non-empty precondition at spawn is cheap insurance for an artifact the whole pipeline reads.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3513",
      "rank": 81,
      "size": "L",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "architecture: agent runtime plane on overdeck-state — durable session pointers, GC as cache eviction (the Anywhere data plane).",
      "rationale": "The hourly agent GC deleted live work agents' state dirs mid-run, which is the concrete cost of treating runtime state as disposable without a durable pointer plane. It is also the state half that the Overdeck Anywhere epic's transport phases presume exists.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2008",
      "rank": 82,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI guard that fails the build on direct canonical-state store access outside a domain resolver — the smallest enforceable slice of PAN-1936.",
      "rationale": "The read door already exists; what is missing is anything that keeps callers using it. A build-time guard turns \"a caller forgot the door\" from a silent runtime bug into a red build, which is what stops the 280-endpoint sprawl from regrowing while the larger consolidation proceeds.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1936",
      "rank": 83,
      "size": "XL",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "One canonical resolver per domain — consolidate the 280+ scattered read endpoints that each assemble the same fact differently.",
      "rationale": "The named root cause of the recurring state and pipeline corruption in this backlog: the same fact read from 8+ endpoints across SQLite, the state worktree and GitHub with nothing enforcing agreement. Nearly every stale-status, disagreeing-surface and half-file bug traces here. Large, so it must be sliced — PAN-2008 is the enforceable first slice.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1988",
      "rank": 84,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door — agents journal, the host owns the DB cache.",
      "rationale": "The generalisation of the PAN-3512 verdict door to every agent-authored signal. Ranked below 3512 because that one is already in review and proves the pattern on the highest-risk domain first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 85,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux and lexerra are permanently unreadable through the membership door: a 404 from an uninstalled GitHub App is typed as forge_unavailable.",
      "rationale": "forge_unavailable reads as \"retry later\" for a condition no retry can fix, so two registered projects have been invisible for an entire run with a misleading diagnosis. Typing permanent authorisation failures distinctly is small work that makes the membership door honest.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 86,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership blanks the whole auricle project because one configured member is not a git repo.",
      "rationale": "One bad member erasing a whole project is a non-degrading gather — the same class as PAN-2824. Partial results with a per-member error beat a blank project every time.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 87,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN pipeline membership fails forge_unavailable: glab mr list runs in a path that is not a git repository.",
      "rationale": "Third specimen of the membership door failing whole projects for a locatable reason. Fix alongside PAN-3167 and PAN-3186 as one honest-errors pass.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 88,
      "size": "S",
      "importance": "medium",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "The GitLab merged-head oracle fans out one glab subprocess per (repo x head), stalling and failing every membership refresh.",
      "rationale": "A performance defect that presents as an availability defect. Batching the oracle is contained work with a visible payoff on every MYN refresh.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 89,
      "size": "S",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails — a non-degrading caller.",
      "rationale": "Same non-degrading pattern as PAN-3186. Worth landing the degradation contract once and applying it across the gather callers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 90,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload does not clear pending-deploy.json, so every flywheel deploy starves verification for ALL projects until a patrol runs.",
      "rationale": "A single queued deploy globally halts verification across every project, and the queue outlives the deploy that created it. Cross-project starvation from a per-machine flag is exactly the coupling to remove.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 91,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "A queued dashboard deploy globally defers verification; the flywheel-owned deploy window starves cross-project review handoffs.",
      "rationale": "MIN-911's review convoy never spawned for 30+ minutes behind a deploy queued in another project. Same interlock as PAN-3248 from the review-handoff side; land them together.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 92,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "The deployment gate queues a deferred deploy and promises it will fire at the next verification boundary — that trigger does not exist.",
      "rationale": "The operator was explicitly told not to retry or force, and then nothing fired. A promise in an operator message with no implementation behind it is worse than no message.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 93,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm has no issue-level assembly owner: nothing owns \"all slots done => assemble, verify, request review\", so finished swarm work sits i…",
      "rationale": "Named root cause of three separate swarm stalls. The single-agent pipeline starts review from a pan-done event a swarm never emits at issue level, so completed work waits for a human to assemble it — which removes the entire point of swarming.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3477",
      "rank": 133,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merged slot sessions are never reaped and get auto-resumed forever, consuming swarm capacity indefinitely",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "A swarm's final ready-to-merge slot wedges when the memory governor sheds its integration stack, and pan swarm recover cannot recover it.",
      "rationale": "The recovery verb has no failed-merge record to act on, so the documented recovery path is structurally unable to help. Eighteen hours wedged on the reproduced specimen.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3456",
      "rank": 96,
      "size": "S",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm refused every plan containing a sequential item — per-item diagnostics acted as gates.",
      "rationale": "A diagnostic that silently became a gate rejects the majority of real plans, which makes swarm unusable on exactly the work it was built for.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3463",
      "rank": 97,
      "size": "S",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "A legitimate no-op slot outcome (empty diff) can never pass its item verify, so the slot wedges permanently.",
      "rationale": "Empty diffs are a normal outcome, not a failure. Without a pass path they convert a correct result into a permanent stall.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3460",
      "rank": 98,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-item verify_commands that run the full root suite make slot merge gates load-fragile and expensive.",
      "rationale": "Running the whole suite per slot multiplies the load that PAN-3492 and PAN-3520 already show is the source of false verdicts. Scoping verification to the item is both cheaper and more accurate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3464",
      "rank": 99,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan swarm reset does not clear slotCompletions despite advertising \"clear recorded slot state\".",
      "rationale": "A reset verb that does not reset leaves stale completions to confuse the next run, and the advertisement makes the operator trust it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2908",
      "rank": 100,
      "size": "XL",
      "importance": "critical",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make Overdeck not suck: simple by default. The UI exposes 43 actions and 5 phase vocabularies and answers none of the three questions a n…",
      "rationale": "The operator has stated the bar plainly — a junior developer should use this with zero training — and today the default surface fails it: four divergent issue views, 701-card kanban columns, eternal spinners, and the one surface people actually live in (the agent conversation) buried or reduced to a gray box. Everything else in this backlog makes the machine correct; this is what makes it usable, and it is the gate on the product being shippable rather than merely working. Large enough that it must be sliced, and several slices (PAN-3090, PAN-3016, PAN-2968) are already filed.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3090",
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD ready. The simple issue page dumps a 55KB machine kickoff prompt as its opening wall and buries the pending question.",
      "rationale": "The highest-value slice of PAN-2908: the page an operator opens to answer \"what is it doing, does it need me, is it done\" currently opens with the spawn prompt. A narrative feed plus a surfaced pending question and an honest blocked state changes the first ten seconds of every issue.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3276",
      "rank": 102,
      "size": "XS",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing.",
      "rationale": "The needs-you list is the operator's interrupt queue, and its rows are dead. The click handler only understands answerable payloads and silently drops the rest, so the fastest path to an unblocked agent is broken at the last inch.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2492",
      "rank": 103,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [
        "PAN-3234"
      ],
      "why": "Pane-detected waits (rate-limit, session-resume) surface as needs-you but can only be answered from the terminal.",
      "rationale": "Overdeck detects the block, tells the operator about it, and then cannot act on it — click-through toasts \"no longer waiting\" while the badge stays and the agent stays blocked. Pairs directly with PAN-3234 (detect) and PAN-3235/PAN-3113 (answer).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3235",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [
        "PAN-3234"
      ],
      "why": "Dashboard decision card: render and answer agent pane-choice menus in one click.",
      "rationale": "The answer surface for the menus PAN-3234 detects. The shared answer core and API already ship in PAN-3228, so this is the remaining UX that turns a detected freeze into a one-click unblock.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3113",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface agent-pane choice prompts as inline decision cards in the conversation view.",
      "rationale": "These prompts never enter the transcript, so the conversation view shows nothing while the agent is blocked. Same family as PAN-3235; decide whether they are one deliverable during planning.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 106,
      "size": "S",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation permission waits are missing from the Awareness rail, and the warning pulse is nearly invisible.",
      "rationale": "A no-loss gap in the unified pending-input UI: the conversation row shows the wait and the Awareness Needs-you scope does not, so noticing depends on which surface the operator happens to be scanning.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3016",
      "rank": 107,
      "size": "L",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator-directed: every view must be URL-addressable so refreshing, bookmarking or sharing does not lose your place.",
      "rationale": "A hand-rolled router URL-syncs only a subset of navigation state today. This is small-feeling and pervasive — it affects every debugging session, every shared link, and every reload during an incident.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2968",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt the interactive decision page as the default way to present operator decisions, replacing walls of prose in chat.",
      "rationale": "The operator has an exemplar they liked and a standing preference for decision surfaces over prose options. Making it the default changes how every future agent asks for a call, which compounds.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3527",
      "rank": 109,
      "size": "XS",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "The sidebar project list never retries: one failed boot-time fetch leaves CONVERSATIONS 0 / ISSUES 0 until a manual reload.",
      "rationale": "The backend was completely healthy and every endpoint returned data; only the browser was empty. A single un-retried fetch at boot makes the whole dashboard look dead during exactly the moments (restart churn, load storms) when the operator needs it.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3540",
      "rank": 110,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View shows phantom agent orbs, a dead Hook Bus panel and a pressure-blind swap header — three verified contradictions of ground truth.",
      "rationale": "A visualization that confidently displays agents that are not running teaches the operator to distrust it, which costs more than not having it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3530",
      "rank": 111,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View polls on 30s timers in four components, violating its documented event-driven contract.",
      "rationale": "The operator specified live events at design time and the doc states it plainly. Polling both misrepresents freshness and adds load in the class PAN-3344 is trying to reduce.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3017",
      "rank": 112,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "The issue-page UAT panel hides the stack action menu and renders inconsistently, so the operator cannot restart a workspace stack from th…",
      "rationale": "The never-built-stack case has been fixed; what remains is that the actions the operator needs during UAT are only reachable elsewhere.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3164",
      "rank": 113,
      "size": "XS",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "The UAT stack advertises \"Open UAT frontend\" while still booting, so the operator gets a Gateway Timeout with no indication it is starting.",
      "rationale": "A starting state rendered as a ready state, which sends the operator debugging a healthy boot.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2075",
      "rank": 114,
      "size": "XL",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: boot reconciliation + Operator Inbox — one informed decision surface, reachable from dashboard, CLI and offline.",
      "rationale": "The gate and the banner shipped; the actual reconciliation decision never did. Its value is concentrated in the Operator Inbox (PAN-2079), which is the durable notification spine that half a dozen scattered surfaces in this backlog — cost alerts, pane waits, boot state, needs-you — should be posting to instead of inventing another transient surface each time. Ranked by that child, not by the epic.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2079",
      "rank": 115,
      "size": "L",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "The Operator Inbox: a durable server-side queue plus in-dashboard surface — the notification spine every other producer should post to.",
      "rationale": "Explicitly the architectural spine of its epic, and the convergence point for PAN-2492, PAN-2717, PAN-3276, the cost alerts in PAN-2642 and the boot state in PAN-2077. Building it once stops the pattern where each new operator-actionable event invents its own transient surface.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2077",
      "rank": 116,
      "size": "M",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "One substrate-complete reconciliation inventory across local tmux and remote Fly, as a single typed resolver.",
      "rationale": "The backend both the dashboard surface and the CLI consume. Ranked below the inbox because remote Fly capacity is not currently on the critical path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 117,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status plus pan resume --all|--select|--freeze|--kill-remote.",
      "rationale": "pan up is frequently run headless, and today the boot decision is dashboard-only. Depends on the inventory resolver.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 118,
      "size": "M",
      "importance": "low",
      "score": 52,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email, Slack, push, TTS) for offline reach — explicit fast-follow.",
      "rationale": "Deliberately sequenced after the inbox itself; transports without the durable queue would be another scattered surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 119,
      "size": "L",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: cost strategy — waste detection over budget policing. Retire invented limits, land the progress-aware breaker, make dollars honest.",
      "rationale": "The operator decision is already made and recorded: alarm on money burning without progress, not on dollar thresholds. Its weight sits almost entirely in PAN-1868 (the progress-aware breaker); the honest-dollars work is presentation and can follow.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1868",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Progress-aware cost-bleed circuit breaker: burn-rate x zero-progress detection with graduated warn then auto-pause with diagnosis.",
      "rationale": "The one guard the cost epic actually needs, and it is consistent with the standing warn-only rule because it pauses only on provable zero-progress bleed. The referenced incident burned $22 in a retry loop at 100% context with nothing stopping it, and the same shape recurs in PAN-3043, PAN-3118 and PAN-3417.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2059",
      "rank": 121,
      "size": "L",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: backlog pickup gate — operator Plan->Release row, AI Objection as a fifth state, Flywheel relevance vetting.",
      "rationale": "Today having a plan means an issue can be grabbed, with no operator beat between \"a plan exists\" and \"go work it\" and no way for planning to refuse bad work. Mockups exist and the pickup model is already a single shared source of truth, so the shape is clear. Its urgency depends on how much junk the backlog is feeding the Flywheel — which PAN-2334 and PAN-2335 are meant to measure.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1666",
      "rank": 122,
      "size": "XL",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: pipeline throughput hardening — many work agents safely, on-demand specialists, slot manager, Fly scale-out.",
      "rationale": "Most of its keystone children have landed and the live throughput pain has migrated to the governor issues (PAN-3344, PAN-3429, PAN-3533) and the review plane. Keep it as the container for the remaining slot-manager and scale-out work rather than a pickup target.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2350",
      "rank": 123,
      "size": "XL",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-3513"
      ],
      "why": "EPIC: Overdeck Anywhere — remote access, Hermes bridge, mobile PWA and the shared relay backbone.",
      "rationale": "A coherent, well-decomposed product direction with PRDs already written for each phase, but every phase is transport and presumes a durable state plane (PAN-3513) that does not exist yet. Ranked as future product work behind substrate.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2376",
      "rank": 124,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene.",
      "rationale": "The container for the theme that dominates the top of this ranking. Its live children — the flake policy behind PAN-3520, the convergence work behind PAN-1650/PAN-2567, the strike merge path behind PAN-2874/PAN-2883 — are all ranked individually above; keep the epic as the umbrella so the pattern stays visible.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2424",
      "rank": 125,
      "size": "L",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: the Order Book — first-class operator priority queue, backlog-exempt, load-governed, flywheel-integrated.",
      "rationale": "The operator-authored priority surface. Partly live already (PAN-3427 is in review), so treat this as the container for the remaining lanes and load-governance work.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2566",
      "rank": 126,
      "size": "L",
      "importance": "low",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: Traycer parity — gap analysis of capabilities Overdeck lacks.",
      "rationale": "A comparison exercise rather than a delivery, and its named children (multi-agent conversations, collaboration roles, cross-device sync) are all post-substrate product bets.",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3423",
      "rank": 292,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign SystemHealthPill popover: attention-grouped reasons, metered vitals, actionable agent alerts",
      "rationale": "In pipeline. Stall alerts and informational disclaimers currently share one undifferentiated bullet list, so the panel built for triage cannot be triaged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3419",
      "rank": 223,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff has no --project: an isolated --cwd lands every successor outside all registered projects",
      "rationale": "In pipeline. The standing isolated-cwd rule and cwd-inferred project membership are in direct conflict, so every correctly-spawned handoff disappears from the project tree.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3410",
      "rank": 271,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Style guide v2 — Geist type system, display scale, chips, soft cards, page-not-modal doctrine",
      "rationale": "In pipeline. Ships as a selectable theme rather than a flag-day cutover, which is the no-loss shape this codebase requires for UI replacement.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3537",
      "rank": 130,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline (in-review). Per-project live CI chip on the Command Deck: latest main run status and link, webhook-fed.",
      "rationale": "Pinned. A live main-status chip is the missing signal behind the red-main class at the top of this ranking.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3427",
      "rank": 166,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Order books are unreachable for every project except the dashboard server’s own cwd project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3422",
      "rank": 11,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Nudge/feedback text lands in the composer but is never submitted — 4 agents wedged idle 20m–2.5h with visible text",
      "rationale": "New, merged and verifying on main, but ranked here because the failure it describes is the single most common way autonomous motion stops: nudge and feedback text lands visibly in an agent's composer and is never submitted, leaving four MYN agents idle between 20 minutes and 2.5 hours, one of them at $242 of session cost. Delivery that reports success while the message sits unsent makes every downstream gate unreliable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 133,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline (in-review). Move a conversation to a different project via CLI, drag/drop and menu action.",
      "rationale": "Pinned. Also the issue whose review cycle produced the verdict-of-record investigation (PAN-3511/3512).",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1230",
      "rank": 14,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck right-pane Pipeline-lens + TopBar height (PAN-1148 follow-up)",
      "rationale": "Command Deck right-pane Pipeline-lens and TopBar height, the last of the PAN-1148 audit gaps. Merged and verifying on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3362",
      "rank": 71,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "No way to seed tracker-backed issue fixtures in workspace containers — every UI-redesign UAT is environment-blocked",
      "rationale": "In pipeline. Workspace containers have no issue data by design, so any AC that requires a live issue can only be resolved by an operator override on an unverified diff. It blocks the entire UI-redesign track.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3418",
      "rank": 197,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Empty-string conversation model is stored, never backfilled, and blanks the harness+model chips",
      "rationale": "In pipeline. The self-healing backfill only looks for NULL, so an empty string is permanently wrong and the conversation silently misreports which model ran.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3411",
      "rank": 137,
      "size": "L",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [
        "PAN-3410"
      ],
      "why": "New Workspace as a full-page creation experience, replacing the modal — the first page-not-modal conversion.",
      "rationale": "Ready with a PRD and in progress. Establishes the pattern PAN-3469 and the rest of the page-not-modal doctrine follow.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3517",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "convoy forks still miss the parent prompt cache in production — launch-injection byte drift + resume drops the cache-scope header",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 139,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergence)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 140,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-saturation heuristic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 142,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 143,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 144,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3243",
      "rank": 145,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit test flakes on main by polling a fixed 20 setImmediate turns for a real git subprocess — reddened main and blocked a close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3210",
      "rank": 146,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocked by an unprefixed devcontainer init-perms container: teardown scopes by compose project, the guard scopes by working_dir",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 147,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out cannot tear down workspaces containing root-owned container residue: MIN-879 passes every DoD row then dies on EACCES",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 148,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn abandoned on transient Docker failure — 'attempt 1/3' never retries, issue stuck in 'todo' with no re-drive owner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 149,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for enter/esc",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 150,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "stale",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 151,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "server children inherit bare system PATH — verification gates run npm/node under system Node 18, not the server's Node 22",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 152,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "planning finalizes (issue→planned) but work agent does not auto-spawn — silent handoff failure requiring manual pan start",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 153,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 154,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard server route tests flake under full-suite verification load",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 155,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 156,
      "size": "S",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 157,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 158,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3523",
      "rank": 159,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace UAT containers crash-loop: peer dashboard starts the host-only CLIProxy watchdog (ENOENT)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 160,
      "size": "L",
      "importance": "high",
      "score": 63,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "decompose merge-agent.ts (1,414 lines) into focused modules",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2106",
      "rank": 161,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 162,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 163,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3420",
      "rank": 164,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard + pan show render a completed, closed-out issue as never-started (post-close-out history wipe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3306",
      "rank": 165,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "A strike that needs a rebase has no working path: strike.ts instructs it, the launcher guard blocks it, and sync-main resolves the…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3022",
      "rank": 166,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn route ignores the per-issue workModel override — role default wins and then clobbers the record",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 167,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 168,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "launch pipeline agents with harness rate-limit model-switch reminder disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 169,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "frontend typecheck fails with dozens of pre-existing unused-local errors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 170,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 171,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2971",
      "rank": 172,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "orchestrator finalized its own run (report --force) but kept running — zombie session uncontrollable, dashboard Pause/Stop disabled…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 173,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan reload",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 174,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 175,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch — never-kicked-off session reads as 'already running', dispatch marks testing with no…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 177,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2546",
      "rank": 178,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 179,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 180,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2960",
      "rank": 181,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict — shows running 38m, needs manual recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 182,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 183,
      "size": "L",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three red-mains in one day from direct-push series bypassing PR CI — conversations pushing multi-commit refactors need a pre-merge CI…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2769",
      "rank": 184,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 185,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 186,
      "size": "S",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the run is stopped,…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 187,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 188,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 189,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 190,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2656",
      "rank": 191,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 192,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 193,
      "size": "S",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 194,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 195,
      "size": "S",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 196,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 197,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 198,
      "size": "S",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 199,
      "size": "S",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (forces --host)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 200,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 201,
      "size": "S",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-1616 class 2)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3535",
      "rank": 202,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Drain/resume boot gate is caller-env-dependent: any restart from a clean shell silently drops the hold",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3450",
      "rank": 203,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan sync never prunes removed skills/rules from cache and harness dirs (beads survived removal for weeks)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3308",
      "rank": 204,
      "size": "S",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "The file-size guard hands agents a paste-ready ratchet-up line — 2 of 3 agents raised the ceiling instead of shrinking the file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3307",
      "rank": 205,
      "size": "S",
      "importance": "high",
      "score": 57,
      "condition": "stale",
      "dependsOn": [],
      "why": "commitlint scope-enum is stale: warns on most real commits, still lists the removed 'beads' scope",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3301",
      "rank": 206,
      "size": "S",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stray-writer warning is 68k log lines hiding one real defect: backlog manifest still writes legacy .pan, and the patrol flags stale…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3117",
      "rank": 207,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send bubble hides deterministic 4xx reason and offers a Retry that can never succeed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3078",
      "rank": 208,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect verdict is never delivered to the work agent — an agent that waits for it deadlocks forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper is blind to non-Overdeck workspaces: regex matches only overdeck-feature-*-server|frontend, so MYN stacks are never…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace stack rebuild composes under 'overdeck-feature-' prefix while Traefik labels reference 'myn-feature-' devnet — 504s; traefik…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3516",
      "rank": 211,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "stale bundled-skill duplicates in repo .claude/skills (pan-handoff, pan-flywheel, okf)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3297",
      "rank": 212,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell misclassifies healthy supervisor-run agents as zombies after a dashboard restart — delivery and resume disagree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3157",
      "rank": 213,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awareness feed shows the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of flywheel run activity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3137",
      "rank": 214,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles are taken from the Flywheel status snapshot, so orchestrator prose reaches the operator's UAT surface",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 215,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 216,
      "size": "S",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against CLOSED issues: resurrects agents and raises needs-you 12 days after close-out (PAN-2610, PAN-2207)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 217,
      "size": "S",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 218,
      "size": "L",
      "importance": "high",
      "score": 56,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2188",
      "rank": 219,
      "size": "S",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 220,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-3253's agent sessions vanish repeatedly (4x in one run) and its reviewer died writing no artifact, all silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 221,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [
        "PAN-2813"
      ],
      "why": "MERGE refuses (polyrepo) or silently dead-ends (single-repo) when the scheduler yielded the work agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 222,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 223,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 224,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1198",
      "rank": 225,
      "size": "S",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3518",
      "rank": 226,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "TTL-aware re-review payload policy — fresh-spawn-with-digest for cold, large histories",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2733",
      "rank": 227,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 228,
      "size": "S",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve — two strikes bent their diffs around…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 229,
      "size": "S",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 230,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 231,
      "size": "S",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1416",
      "rank": 232,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2959",
      "rank": 233,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect --item <X> reviews workspace HEAD, not item X's commit — spurious verdict when HEAD moved past the item (MIN-882…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 234,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 235,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 236,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 237,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 238,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQUESTED burns…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 239,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done nudge for all…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 240,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 241,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickoff",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 242,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 243,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 244,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 245,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 246,
      "size": "S",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the retired…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 247,
      "size": "S",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 248,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 249,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 250,
      "size": "S",
      "importance": "high",
      "score": 53,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 251,
      "size": "S",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 252,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 253,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2680",
      "rank": 254,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 255,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 256,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 257,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 258,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 259,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 260,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 261,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1556",
      "rank": 262,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3245",
      "rank": 263,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done completion gate falsely flags workspace .pan/drafts/<issue>.md as uncommitted work despite its own .pan exclusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3121",
      "rank": 264,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send outbox does not reconcile against the transcript — delivered message keeps a doomed Retry twin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 265,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; duplicated exclusion list has drifted (.overdeck/ missing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3003",
      "rank": 266,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 267,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 268,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 269,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 271,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 272,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 273,
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
      "issue": "PAN-1027",
      "rank": 274,
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
      "issue": "PAN-813",
      "rank": 275,
      "size": "XS",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3441",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View \"River\" — WebGL pipeline visualization fed by the live hook-event stream",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3174",
      "rank": 277,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every polyrepo UAT stack is unreachable: Traefik labels carry the old myn- project prefix, Traefik is never attached to the overdeck-*…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 278,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 279,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2351",
      "rank": 280,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1774",
      "rank": 281,
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
      "rank": 282,
      "size": "L",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1755",
      "rank": 283,
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
      "issue": "PAN-1571",
      "rank": 284,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 285,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3497",
      "rank": 286,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLIProxy watchdog crashes peer-dashboard workspace containers (missing ~/.overdeck/bin/cliproxy by design)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3454",
      "rank": 287,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost hook re-ingests fork-copied parent history under reviewer identity — fabricated cache-miss warnings and multi-billed discovery spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3295",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "single per-machine completion-check summarizer with a queue + first-class observability in pan resources and the Deacon surface",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 289,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote is marked complete at merge time — nothing verifies the change reached production, so members read as shipped while prod…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3175",
      "rank": 290,
      "size": "M",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model explicit semantic dependencies in merge-train ordering — file overlap cannot see that one feature requires another",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3094",
      "rank": 291,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done merge fallback force-pushes a fast-forward branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 292,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback is written to .overdeck/feedback but agents (and the deacon merge gate) are pointed at a nonexistent .pan/feedback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 293,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect/review-supervisor spawns omit --effort, inheriting the harness xhigh default (fires per xBRIEF item)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 294,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background AI title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 295,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 296,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls the…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1668",
      "rank": 297,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 298,
      "size": "S",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 299,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3012",
      "rank": 300,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Back up harness conversation transcripts before harnesses delete them",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2978",
      "rank": 301,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 302,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2966",
      "rank": 303,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding (MIN-882)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 304,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 305,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 306,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s — profile and fix the residual burner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 307,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 308,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 309,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2670",
      "rank": 310,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 311,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 312,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 313,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 314,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 315,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 316,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 317,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 318,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 319,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2381",
      "rank": 320,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 321,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY,…",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2280",
      "rank": 322,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 323,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 324,
      "size": "XS",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2240",
      "rank": 325,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 326,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 327,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1740",
      "rank": 328,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 329,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 330,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 331,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 332,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 333,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 334,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K palette: stale conversation hits 404 on open — search index never prunes deleted sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 335,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2582",
      "rank": 336,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "stale",
      "dependsOn": [],
      "why": "show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2565",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2560",
      "rank": 338,
      "size": "L",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2006",
      "rank": 339,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2005",
      "rank": 340,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1816",
      "rank": 341,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag +…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 342,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 343,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3443",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "God View \"Spectrum Deck\" — Winamp-grade activity visualizer (kimi-code-harness mockup + PRD)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3333",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "relative plan-drain indicator on model pickers — show which sibling model burns subscription quota fastest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3011",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — local via Ollama/vLLM, hosted via OpenRouter",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2982",
      "rank": 347,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review convoy should run skill selftests when sync-sources/skills/** changes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 348,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime (named adapters + custom-agent config)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2945",
      "rank": 349,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 350,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 351,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2830",
      "rank": 352,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialogs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2806",
      "rank": 353,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike merge trigger registry splits across dashboard chunks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 354,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "idle nudge must not advance after failed mandatory inspection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 355,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 356,
      "size": "L",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2506",
      "rank": 357,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 358,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 359,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule added",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 360,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification container names",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 361,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation refusal and…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 363,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 364,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 365,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 366,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1915",
      "rank": 367,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 368,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1451",
      "rank": 369,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 370,
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
      "issue": "PAN-2767",
      "rank": 371,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2645",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2514",
      "rank": 373,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2444",
      "rank": 374,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2443",
      "rank": 375,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2442",
      "rank": 376,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and prompt-detection…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2355",
      "rank": 377,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2356",
      "rank": 378,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2354",
      "rank": 379,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2352",
      "rank": 380,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2353",
      "rank": 381,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1995",
      "rank": 382,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 383,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 384,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 385,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 386,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 387,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1674",
      "rank": 388,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 389,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 390,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 391,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 392,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 393,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 394,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 395,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 396,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 397,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 398,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 399,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 400,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3536",
      "rank": 401,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell fails for ohmypi conversations: expectedHarness defaults to claude-code when state.json is absent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3510",
      "rank": 402,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stopped agents can leave detached docker-run test containers alive indefinitely",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3508",
      "rank": 403,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload temporarily removes the global pan CLI when invoked outside its linked generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3469",
      "rank": 404,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [
        "PAN-3411"
      ],
      "why": "migrate NewProjectModal to a full page (page-not-modal doctrine)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3455",
      "rank": 405,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "isCliproxyUpToDate always returns false — cliproxy --version exits 2, so every ensure re-downloads the pinned release",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3445",
      "rank": 406,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project config TCP lock collides with ephemeral client ports",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3355",
      "rank": 407,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "sessionExists maps a probe failure to absence, so callers read 'not running' when liveness is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3354",
      "rank": 408,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "archiving the main workspace hides the singleton row with no UI recovery path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3335",
      "rank": 409,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "click a pasted conversation image to open it full size in a popup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3332",
      "rank": 410,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard slash-command activities: surface failure and notify the conversation model instead of leaving 'running in background' standing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3322",
      "rank": 411,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "file-size allowlist for launcher-generator.ts is 126 lines slack (allows 1018, file is 892) — a temporary ceiling raise became…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3317",
      "rank": 412,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents have no sanctioned way to sync main: git rebase is guard-blocked and pan sync-main can't resolve -strike workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3303",
      "rank": 413,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck latches 'Unknown project' after dashboard reconnect — empty registered-projects response treated as authoritative",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3290",
      "rank": 414,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan: xBRIEF items can carry empty metadata.traces — docs items are invisible to requirement traceability",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3181",
      "rank": 415,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Own agent memories in Overdeck: migrate harness project memories to a per-repo overdeck-memory orphan branch, mirroring the…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3178",
      "rank": 416,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class worktrees & diffs: +/− changes badge, dedicated Changes surface, conversation worktrees",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3176",
      "rank": 417,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Block UAT batch promotion when the live stack is degraded, unknown, or still starting — the promote path takes no health evidence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3132",
      "rank": 418,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt xBRIEF v0.9 agentic dispatch fields end-to-end (deftai/xBRIEF#40 alignment)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3131",
      "rank": 419,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 420,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: path-escape validation for identifier-joined write paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3129",
      "rank": 421,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 422,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log grows unbounded (867MB) — no rotation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 423,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale .pan/test/result.json is re-applied with no freshness check, re-failing an issue after the fix has landed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 424,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart --health-timeout 120 treated as 120ms; false-failed health check leaves dashboard DOWN",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 425,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done fails on generated devcontainer harness — agents infer deletion of workspace infrastructure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 426,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 427,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing-crew templates: ship preset crew configurations (Claude ladder + OpenAI Sol/Terra/Luna) selectable from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 428,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice (372K vs 150K)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 429,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 430,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike fails on polyrepo projects (monorepo-shaped worktree logic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3036",
      "rank": 431,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "False '! INPUT' chip on completed strike agents — pane-idle heuristic misreads post-strike-ready idle as a pending question",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 432,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck session tree misses strike-only and workspace-less issues (no strike node for PAN-3031)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 433,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan monitor: pull-based background inbox transport for Claude Code sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 434,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp/pan-agent-role-* paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 435,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1572",
      "rank": 436,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 437,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2896",
      "rank": 438,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 439,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 440,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 441,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 442,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 443,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 444,
      "size": "L",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2288",
      "rank": 445,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 447,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 448,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 449,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 450,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 451,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 452,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 453,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 454,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 455,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 456,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 457,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "stale",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 458,
      "size": "S",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 459,
      "size": "S",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1313",
      "rank": 460,
      "size": "S",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1254",
      "rank": 461,
      "size": "S",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 462,
      "size": "S",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 463,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 464,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2027",
      "rank": 465,
      "size": "S",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 466,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 467,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1461",
      "rank": 468,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 469,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 470,
      "size": "L",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1060",
      "rank": 471,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 472,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 473,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 474,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build intermittently produces stale frontend bundles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 475,
      "size": "L",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2941",
      "rank": 476,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 — lease-based writes and advisory semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 477,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 478,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 479,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 480,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 481,
      "size": "L",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2810",
      "rank": 482,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 483,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 484,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "`always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 485,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 488,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 490,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 493,
      "size": "L",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2527",
      "rank": 494,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 495,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 496,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 497,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** exclusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 498,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 499,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 500,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 501,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 502,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 503,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-workspace…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 504,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation blocked",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 507,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 508,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 509,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-903",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 511,
      "size": "S",
      "importance": "low",
      "score": 41,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 512,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 514,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 515,
      "size": "XS",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1965",
      "rank": 516,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 518,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 520,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 522,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 524,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 525,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 527,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 530,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 531,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 532,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 533,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 534,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1173",
      "rank": 536,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 537,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 538,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 539,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 540,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 541,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 542,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 543,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 544,
      "size": "S",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 545,
      "size": "S",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 546,
      "size": "S",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 547,
      "size": "S",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-681",
      "rank": 548,
      "size": "S",
      "importance": "low",
      "score": 39,
      "condition": "stale",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 549,
      "size": "S",
      "importance": "low",
      "score": 39,
      "condition": "stale",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 550,
      "size": "S",
      "importance": "low",
      "score": 39,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 551,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 552,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [
        "PAN-2597"
      ],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2295",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2195",
      "rank": 554,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 555,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 556,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 557,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 558,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 560,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 561,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 562,
      "size": "L",
      "importance": "low",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1983",
      "rank": 563,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1980",
      "rank": 564,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 566,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "--big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 568,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 569,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 570,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 571,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 572,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 573,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-* origin)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 576,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 578,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 580,
      "size": "L",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1592",
      "rank": 581,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1311",
      "rank": 583,
      "size": "S",
      "importance": "high",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1196",
      "rank": 584,
      "size": "S",
      "importance": "high",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1164",
      "rank": 585,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1133",
      "rank": 586,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 589,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 590,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 591,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 592,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 593,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 594,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label make UAT…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 595,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 596,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 597,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1042",
      "rank": 598,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 599,
      "size": "L",
      "importance": "high",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-538",
      "rank": 600,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3133",
      "rank": 601,
      "size": "S",
      "importance": "low",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: TRON encoding for prompt-bound xBRIEF payloads",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3107",
      "rank": 602,
      "size": "M",
      "importance": "low",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "productize the memory-attribution census (OOM spikes are unattributable after the fact)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-3100",
      "rank": 603,
      "size": "S",
      "importance": "low",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Test role evaluates the dirty working tree, so a live work agent's uncommitted edits produce false test failures",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1913",
      "rank": 604,
      "size": "S",
      "importance": "high",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 605,
      "size": "S",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1242",
      "rank": 606,
      "size": "S",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-863",
      "rank": 607,
      "size": "M",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2091",
      "rank": 608,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 609,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 610,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 611,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 612,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 613,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 614,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 615,
      "size": "S",
      "importance": "high",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1151",
      "rank": 616,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 617,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 618,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1040",
      "rank": 619,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "stale",
      "dependsOn": [],
      "why": "event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 620,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 621,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "stale",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-949",
      "rank": 622,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 623,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-938",
      "rank": 624,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 625,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 626,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 627,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 628,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-304",
      "rank": 629,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "stale",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 630,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 631,
      "size": "L",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2031",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 633,
      "size": "XS",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2029",
      "rank": 634,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 635,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 636,
      "size": "M",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 637,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 638,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 639,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 640,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 642,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 643,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 644,
      "size": "L",
      "importance": "high",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-247",
      "rank": 645,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 646,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 648,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 650,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 652,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 653,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 654,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 655,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 656,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 657,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 658,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 659,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 660,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 661,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 662,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 663,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 664,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 665,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 666,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 667,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 668,
      "size": "L",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-898",
      "rank": 669,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-832",
      "rank": 670,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 671,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 672,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-790",
      "rank": 673,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 674,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 675,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 676,
      "size": "L",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-774",
      "rank": 677,
      "size": "L",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-773",
      "rank": 678,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 679,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 680,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 681,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 682,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 683,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-750",
      "rank": 684,
      "size": "L",
      "importance": "low",
      "score": 33,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-578",
      "rank": 685,
      "size": "S",
      "importance": "low",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2348",
      "rank": 686,
      "size": "L",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2347",
      "rank": 687,
      "size": "XS",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2346",
      "rank": 688,
      "size": "XS",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2345",
      "rank": 689,
      "size": "XS",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2344",
      "rank": 690,
      "size": "XS",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2343",
      "rank": 691,
      "size": "XS",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1684",
      "rank": 692,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 693,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1469",
      "rank": 694,
      "size": "L",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1443",
      "rank": 695,
      "size": "L",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1442",
      "rank": 696,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 697,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 698,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 699,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 700,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-480",
      "rank": 701,
      "size": "S",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 702,
      "size": "S",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2074",
      "rank": 703,
      "size": "S",
      "importance": "low",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1553",
      "rank": 704,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1986",
      "rank": 705,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 706,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 707,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 708,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 709,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 710,
      "size": "XS",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-747",
      "rank": 711,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 712,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 713,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 714,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 715,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 716,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 717,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 718,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 719,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 720,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 721,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 722,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 723,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 724,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 725,
      "size": "L",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-245",
      "rank": 726,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 727,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 728,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 729,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 730,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 731,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 732,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 733,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 734,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-713",
      "rank": 735,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-702",
      "rank": 736,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 737,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 738,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-660",
      "rank": 739,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 740,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-623",
      "rank": 741,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 742,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 743,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-604",
      "rank": 744,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 745,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 746,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 747,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 748,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 749,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 750,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 751,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 752,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-483",
      "rank": 753,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 754,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 755,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 756,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 757,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 758,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 759,
      "size": "L",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-265",
      "rank": 760,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 761,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 762,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 763,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 764,
      "size": "XS",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-607",
      "rank": 765,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1049",
      "rank": 766,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-984",
      "rank": 767,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-797",
      "rank": 768,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-771",
      "rank": 769,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-749",
      "rank": 770,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1222",
      "rank": 771,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 772,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 773,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 774,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 775,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 776,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 777,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 778,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 779,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 780,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-743",
      "rank": 781,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 782,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 783,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 784,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 785,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 786,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 787,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 788,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 789,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 790,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 791,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 792,
      "size": "L",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-228",
      "rank": 793,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 794,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 795,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-180",
      "rank": 796,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 797,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 798,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 799,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 800,
      "size": "L",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-146",
      "rank": 801,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 802,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 803,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 804,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 805,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 806,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 807,
      "size": "XS",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2071",
      "rank": 808,
      "size": "XS",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2068",
      "rank": 809,
      "size": "XS",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2067",
      "rank": 810,
      "size": "XS",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1683",
      "rank": 811,
      "size": "XS",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-853",
      "rank": 812,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 813,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 814,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-77",
      "rank": 815,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 816,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 817,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 818,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 819,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 820,
      "size": "XS",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "skip"
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
      "from": "PAN-2642",
      "to": "PAN-1868",
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
      "to": "PAN-77",
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
      "to": "PAN-797",
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
      "to": "PAN-2028",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2029",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2392",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2443",
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
      "to": "PAN-1166",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2350",
      "to": "PAN-658",
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
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1676",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1773",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1666",
      "to": "PAN-908",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1666",
      "to": "PAN-629",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2059",
      "to": "PAN-2334",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2059",
      "to": "PAN-2335",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2059",
      "to": "PAN-2005",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2059",
      "to": "PAN-2006",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-3520",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-3532",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2478",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-1824",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-1720",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2421",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2874",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2883",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2550",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2424",
      "to": "PAN-3427",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2424",
      "to": "PAN-1676",
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
      "from": "PAN-3532",
      "to": "PAN-3504",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3532",
      "to": "PAN-3502",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3504",
      "to": "PAN-3499",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3522",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3492",
      "to": "PAN-3520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3524",
      "to": "PAN-3492",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3511",
      "to": "PAN-3512",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3512",
      "to": "PAN-2746",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3512",
      "to": "PAN-3283",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3512",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3282",
      "to": "PAN-2746",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3139",
      "to": "PAN-3545",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3235",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3234",
      "to": "PAN-2492",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3113",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3257",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3250",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3062",
      "to": "PAN-3505",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2409",
      "to": "PAN-3284",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-807",
      "to": "PAN-3250",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3270",
      "to": "PAN-3325",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3270",
      "to": "PAN-2763",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-1650",
      "to": "PAN-2567",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-1650",
      "to": "PAN-3281",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1650",
      "to": "PAN-3278",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3047",
      "to": "PAN-2995",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3047",
      "to": "PAN-2828",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3168",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3211",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2883",
      "to": "PAN-2874",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3244",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3205",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2008",
      "to": "PAN-1936",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3513",
      "to": "PAN-2350",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3167",
      "to": "PAN-3186",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3167",
      "to": "PAN-3256",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3186",
      "to": "PAN-2824",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2908",
      "to": "PAN-3090",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2908",
      "to": "PAN-3016",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2908",
      "to": "PAN-2968",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3410",
      "to": "PAN-3411",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3411",
      "to": "PAN-3469",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3362",
      "to": "PAN-3410",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
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
      "to": "PAN-2078",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2492",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2717",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2079",
      "to": "PAN-3276",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1868",
      "to": "PAN-2642",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3539",
      "to": "PAN-3314",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-3429",
      "to": "PAN-3344",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3344",
      "to": "PAN-3533",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2813",
      "to": "PAN-3120",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2813",
      "to": "PAN-3432",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2469",
      "to": "PAN-2650",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2334",
      "to": "PAN-2059",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2335",
      "to": "PAN-2334",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3517",
      "to": "PAN-3518",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3454",
      "to": "PAN-3517",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    }
  ]
}
```
