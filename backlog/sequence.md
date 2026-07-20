# Backlog Sequence

_Last sequenced: 2026-07-20T14:56:46Z · model: glm-5.2 · open: 658_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2963 | S | critical | ok |  |  | Red main: source-introspection guard rejects new conformance-gates.test.ts — merge gate blocked. |
| 1 | PAN-2858 | L | high | ok |  |  | ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight |
| 2 | PAN-2961 | S | critical | ok |  |  | pan done force-pushes (--force-with-lease) on already-up-to-date branches — breaks MYN/GitLab/no-history-rewrite completion. |
| 6 | PAN-806 | L | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 7 | PAN-2876 | M | medium | ok |  |  | Conversation subagent rail: list spawned subagents and open their transcripts. |
| 7 | PAN-2838 | S | medium | ok |  |  | Project settings disclosure badge for projects with no settings |
| 12 | PAN-2940 | M | critical | needs-refinement |  | PAN-2963 | Three red-mains in one day from direct-push series bypassing PR CI — need a pre-merge CI surface. |
| 13 | PAN-2706 | M | critical | ok |  |  | Ghost test sessions absorb every test dispatch — never-kicked-off session reads as "running". |
| 14 | PAN-2599 | L | medium | ok |  |  | Integrate PostHog product analytics + telemetry |
| 14 | PAN-2709 | M | critical | ok |  |  | Flywheel orchestrator unreachable as a notification target — resume always fails when stopped. |
| 15 | PAN-2650 | M | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it. |
| 16 | PAN-2639 | M | high | ok |  |  | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401. |
| 17 | PAN-2569 | M | high | ok |  |  | bug(cloister): planning finalizes (issue→planned) but work agent does not auto-spawn — silent handoff failure requiring manual pan start. |
| 18 | PAN-2593 | S | high | ok |  |  | bug(dashboard): server children inherit bare system PATH — verification gates run npm/node under system Node 18, not the server's Node 22. |
| 19 | PAN-2511 | S | high | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate. |
| 20 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits). |
| 21 | PAN-2337 | M | critical | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart. |
| 22 | PAN-2334 | M | high | ok |  |  | Write a Definition of Ready — bar an issue must clear before planning/pickup (catches junk). |
| 23 | PAN-2333 | M | high | ok |  | PAN-2331 | Handle codex weekly-quota exhaustion — resource alert + downshift, no unanswerable modals. |
| 24 | PAN-2331 | S | medium | ok |  |  | bug(agents): codex rate-limit "Switch to gpt-5.4-mini?" modal stalls autonomous agents (no auto-dismiss). |
| 25 | PAN-2259 | M | high | ok |  |  | bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration. |
| 26 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal. |
| 27 | PAN-2186 | M | high | ok |  |  | bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck. |
| 28 | PAN-2179 | M | high | ok |  |  | bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled). |
| 29 | PAN-2170 | S | high | ok |  |  | Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails (forces --host). |
| 30 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown error) — needs ctx-saturation heuristic. |
| 31 | PAN-2165 | S | high | ok |  |  | pan close reports success but leaves issue OPEN / wrong labels (remove-label aborts). |
| 32 | PAN-2106 | M | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false "spawned" success (git-lock race). |
| 33 | PAN-2466 | S | high | ok |  |  | bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring). |
| 34 | PAN-2516 | M | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push. |
| 35 | PAN-2521 | S | medium | ok |  |  | feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled. |
| 36 | PAN-1560 | S | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED. |
| 37 | PAN-1650 | L | high | needs-refinement |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green. |
| 38 | PAN-1454 | M | high | needs-refinement |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent recurrence. |
| 39 | PAN-1889 | S | medium | ok |  |  | feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded. |
| 40 | PAN-2895 | M | critical | ok |  |  | Resume path retries a session whose JSONL is missing instead of falling back to fresh — dead-ends recovery. |
| 40 | PAN-2075 | XL | critical | needs-refinement | ✓ | PAN-1775 | [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline. |
| 41 | PAN-2077 | L | high | needs-refinement |  | PAN-2075, PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver. |
| 42 | PAN-2079 | L | high | needs-refinement |  | PAN-2075 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine). |
| 43 | PAN-2078 | M | medium | ok |  | PAN-2075, PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote. |
| 44 | PAN-2080 | M | medium | ok |  | PAN-2075, PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43). |
| 45 | PAN-2059 | XL | critical | needs-refinement | ✓ |  | [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting. |
| 46 | PAN-2642 | XL | high | needs-refinement | ✓ | PAN-1868, PAN-2466 | [EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land progress-aware breaker, make dollars honest. |
| 47 | PAN-1868 | L | high | needs-refinement |  | PAN-2642 | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend. |
| 48 | PAN-1666 | XL | high | needs-refinement | ✓ | PAN-1665 | [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out. |
| 49 | PAN-2377 | L | high | ok |  |  | first-class 'special orders' runs — operator-supplied order book executed with lane semantics |
| 49 | PAN-262 | L | high | needs-refinement |  |  | Refactor post-merge lifecycle into composable, idempotent operations. |
| 50 | PAN-2376 | XL | high | needs-refinement |  |  | Epic: CI/CD reliability — flake policy, verification-to-merge convergence, deploy hygiene. |
| 51 | PAN-807 | L | critical | needs-refinement |  |  | Epic C: Workspace state sanity on spawn. |
| 52 | PAN-1313 | L | high | needs-refinement |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces. |
| 53 | PAN-1561 | M | high | needs-refinement |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column). |
| 54 | PAN-1217 | S | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items. |
| 55 | PAN-1218 | S | medium | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode. |
| 56 | PAN-1219 | M | medium | needs-refinement |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) so reviewers don't re-litigate. |
| 57 | PAN-1504 | M | medium | ok |  |  | feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a CLI command. |
| 58 | PAN-1452 | M | medium | needs-refinement |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048). |
| 59 | PAN-1451 | M | medium | needs-refinement |  | PAN-1124, PAN-2516 | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift). |
| 60 | PAN-1544 | S | low | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references. |
| 61 | PAN-2720 | S | medium | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve. |
| 62 | PAN-2379 | S | high | ok |  |  | bug(verify-gate): dependency install is warn-only + 60s timeout → false verify failures on cold caches. |
| 63 | PAN-2430 | S | medium | ok |  |  | bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors. |
| 64 | PAN-2421 | S | medium | ok |  |  | bug(test): dashboard server route tests flake under full-suite verification load. |
| 65 | PAN-2189 | L | medium | needs-refinement |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff. |
| 66 | PAN-2190 | L | medium | needs-refinement |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split. |
| 67 | PAN-2233 | L | medium | needs-refinement |  |  | refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules. |
| 68 | PAN-2188 | M | medium | needs-refinement |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate. |
| 69 | PAN-578 | L | critical | needs-refinement |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments. |
| 70 | PAN-1915 | L | high | needs-refinement |  | PAN-1435 | enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext. |
| 71 | PAN-1435 | M | medium | needs-refinement |  | PAN-1915 | API keys in ~/.panopticon/config.yaml stored as plaintext. |
| 72 | PAN-1824 | M | high | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family. |
| 73 | PAN-538 | S | medium | ok |  | PAN-2337 | pan reload freshness guard must also verify the frontend bundle. |
| 74 | PAN-1416 | S | critical | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port. |
| 75 | PAN-1951 | M | medium | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item. |
| 76 | PAN-1164 | M | medium | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling). |
| 77 | PAN-1577 | M | medium | ok |  |  | Move a conversation to a different project (CLI + drag/drop + menu action). |
| 78 | PAN-947 | L | medium | ok |  |  | feat: project management actions in unified sidebar. |
| 79 | PAN-1767 | S | medium | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline. |
| 80 | PAN-2837 | M | medium | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 81 | PAN-2830 | M | medium | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialogs |
| 82 | PAN-2567 | S | medium | ok |  |  | bug(cloister): reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never fires (churning-main convergence ... |
| 83 | PAN-2558 | L | medium | ok |  |  | feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo) |
| 84 | PAN-2358 | M | medium | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 85 | PAN-2323 | S | medium | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 86 | PAN-2324 | S | medium | ok |  |  | bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels |
| 87 | PAN-2966 | S | medium | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding (MIN-882) |
| 88 | PAN-2960 | S | medium | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict — shows running 38m, needs manual recovery |
| 89 | PAN-2959 | S | medium | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit — spurious verdict when HEAD moved past the item (MIN-882 metering-cos... |
| 90 | PAN-2954 | S | medium | ok |  |  | postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run |
| 91 | PAN-2952 | S | medium | ok |  |  | Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB state |
| 92 | PAN-2935 | S | medium | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504 |
| 93 | PAN-2932 | S | medium | ok |  |  | bug(boot): intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan ... |
| 94 | PAN-2921 | S | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 95 | PAN-2905 | S | medium | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s — profile and fix the residual burner |
| 96 | PAN-2848 | S | medium | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm agent |
| 97 | PAN-2846 | S | medium | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 98 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825) |
| 99 | PAN-2828 | S | medium | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 100 | PAN-2824 | S | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 101 | PAN-2820 | S | medium | ok |  |  | CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback) |
| 102 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere |
| 103 | PAN-2802 | S | medium | ok |  |  | bug(cloister): same-head strike-ready cannot re-arm a needs-you landing |
| 104 | PAN-2792 | S | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 105 | PAN-2775 | S | medium | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04:34Z |
| 106 | PAN-2769 | S | medium | ok |  |  | review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operator... |
| 107 | PAN-2763 | S | medium | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids |
| 108 | PAN-2761 | S | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks like ... |
| 109 | PAN-2759 | S | medium | ok |  |  | Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled |
| 110 | PAN-2758 | S | medium | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 111 | PAN-2749 | S | medium | ok |  |  | Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed |
| 112 | PAN-2747 | S | medium | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 113 | PAN-2746 | S | medium | ok |  |  | bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearly merged PAN-2710 unreviewed |
| 114 | PAN-2742 | S | medium | ok |  |  | bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQUE... |
| 115 | PAN-2739 | S | medium | ok |  |  | bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done n... |
| 116 | PAN-2738 | S | medium | ok |  |  | bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push |
| 117 | PAN-2734 | S | medium | ok |  |  | bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers |
| 118 | PAN-2733 | S | medium | ok |  |  | bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls) |
| 119 | PAN-2717 | S | medium | ok |  |  | bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse |
| 120 | PAN-2700 | S | medium | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict |
| 121 | PAN-2699 | S | medium | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace g... |
| 122 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches |
| 123 | PAN-2696 | S | medium | ok |  |  | Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label |
| 124 | PAN-2695 | S | medium | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickoff |
| 125 | PAN-2691 | S | medium | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you |
| 126 | PAN-2689 | S | medium | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process |
| 127 | PAN-2686 | S | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 128 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 129 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors) |
| 130 | PAN-1525 | XL | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-2664 | S | medium | ok |  |  | bug(sync-main): auto-commit completes unresolved merge with conflict markers |
| 131 | PAN-2663 | S | medium | ok |  |  | bug(restart): health probe can accept old dashboard after replacement EADDRINUSE |
| 132 | PAN-2659 | S | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 133 | PAN-2656 | S | medium | ok |  |  | bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 134 | PAN-2649 | S | medium | ok |  |  | bug(palette): Ctrl+K conversation search indexes Claude transcripts only |
| 135 | PAN-2627 | S | medium | ok |  |  | bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue... |
| 136 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie |
| 137 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 138 | PAN-2554 | S | medium | ok |  |  | bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable |
| 139 | PAN-2550 | S | medium | ok |  |  | bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level |
| 140 | PAN-2547 | S | medium | ok |  |  | bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure |
| 141 | PAN-2546 | S | medium | ok |  |  | bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery |
| 142 | PAN-2495 | S | medium | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change |
| 143 | PAN-2478 | S | medium | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 144 | PAN-2467 | S | medium | ok |  |  | Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged) |
| 145 | PAN-2244 | S | medium | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land) |
| 146 | PAN-2243 | S | medium | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 147 | PAN-2242 | S | medium | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 148 | PAN-2241 | S | medium | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 149 | PAN-2240 | S | medium | ok |  |  | bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 150 | PAN-2237 | S | medium | ok |  |  | bug(cli): pan plan done swallows vbrief quality lint details |
| 151 | PAN-1913 | M | medium | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 152 | PAN-1770 | S | medium | ok |  |  | bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle |
| 153 | PAN-1766 | S | medium | ok |  |  | bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-16... |
| 154 | PAN-2202 | S | medium | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success |
| 155 | PAN-2069 | S | medium | ok |  |  | caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 156 | PAN-1618 | S | medium | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down |
| 157 | PAN-1912 | S | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 158 | PAN-1578 | M | medium | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 159 | PAN-1558 | M | medium | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 160 | PAN-1538 | M | medium | ok |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 161 | PAN-1497 | M | medium | ok |  |  | feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 162 | PAN-1311 | M | medium | needs-refinement |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 163 | PAN-1253 | M | medium | stale |  |  | Flywheel: respect issue dependencies before autopicking work |
| 164 | PAN-2027 | M | medium | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 165 | PAN-1830 | S | medium | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 166 | PAN-1828 | S | medium | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 167 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-... |
| 168 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 169 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still ... |
| 170 | PAN-1711 | S | medium | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 171 | PAN-1424 | M | medium | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 172 | PAN-1357 | M | medium | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 173 | PAN-1209 | S | medium | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 174 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 175 | PAN-1673 | S | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 176 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 177 | PAN-1254 | M | medium | stale |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 178 | PAN-1246 | M | medium | stale |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 179 | PAN-1198 | S | medium | stale |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 180 | PAN-1196 | M | medium | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 181 | PAN-1142 | M | medium | stale |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 182 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N lines... |
| 183 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 184 | PAN-1556 | S | medium | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 185 | PAN-955 | S | medium | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 186 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 187 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 188 | PAN-1449 | S | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 189 | PAN-1446 | M | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 190 | PAN-1445 | M | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 191 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 192 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 193 | PAN-1438 | S | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 194 | PAN-1436 | S | medium | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 195 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 196 | PAN-1392 | S | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 197 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 198 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 199 | PAN-1240 | S | medium | stale |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 200 | PAN-1227 | S | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 201 | PAN-1226 | S | medium | stale |  |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 202 | PAN-1173 | S | medium | stale |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 203 | PAN-1150 | S | medium | stale |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 204 | PAN-1149 | S | medium | stale |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 205 | PAN-813 | M | medium | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 206 | PAN-1130 | S | medium | stale |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 207 | PAN-1129 | S | medium | stale |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 208 | PAN-1128 | S | medium | stale |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 209 | PAN-1113 | S | medium | stale |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 210 | PAN-1068 | S | medium | stale |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 211 | PAN-630 | M | medium | stale |  |  | Multi-tenant workspace isolation with ACLs |
| 212 | PAN-1027 | S | medium | stale |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 213 | PAN-933 | S | medium | stale |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 214 | PAN-932 | S | medium | stale |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 215 | PAN-900 | S | medium | stale |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 216 | PAN-886 | S | medium | stale |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 217 | PAN-681 | S | medium | stale |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 218 | PAN-334 | S | medium | stale |  |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 219 | PAN-324 | S | medium | stale |  |  | Agent detail pane missing Merge/Approve button |
| 220 | PAN-304 | S | medium | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 221 | PAN-247 | S | medium | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 222 | PAN-245 | S | medium | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 223 | PAN-244 | S | medium | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 224 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 225 | PAN-49 | S | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 226 | PAN-1042 | S | medium | stale |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 227 | PAN-2962 | L | low | ok |  |  | C-DETAIL remainder: rail-density adoption, page-density cockpit migration, useIssueView-only data path |
| 228 | PAN-2957 | M | low | ok |  |  | npm run build intermittently produces stale frontend bundles |
| 229 | PAN-2950 | XL | low | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 230 | PAN-2949 | M | low | ok |  |  | Test issue — discuss-then-file flow smoke test |
| 231 | PAN-2947 | M | low | ok |  |  | testing 1 2 3 |
| 232 | PAN-2946 | M | low | ok |  |  | Deacon crashes on null lastActivity in checkFirstCompletionAgents every patrol |
| 233 | PAN-2945 | M | low | ok |  |  | fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 234 | PAN-2941 | M | low | ok |  |  | OKF v3 — lease-based writes and advisory semantic auditor |
| 235 | PAN-2937 | M | low | ok |  |  | Board right-click context menu can close when live data ticks re-render the card |
| 236 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 237 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 238 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |
| 239 | PAN-2896 | M | low | ok |  |  | Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute |
| 240 | PAN-2888 | M | low | ok |  |  | Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLOSE... |
| 241 | PAN-2886 | M | low | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 242 | PAN-2883 | M | low | ok |  |  | Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs |
| 243 | PAN-2882 | M | low | ok |  |  | Pipeline membership has no GitLab merged-MR oracle — squash-merged GitLab branches show as unmerged (false planned_backlog rows, mislabel... |
| 244 | PAN-2880 | M | low | ok |  |  | Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget |
| 245 | PAN-2874 | M | low | ok |  |  | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback delive... |
| 246 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized |
| 247 | PAN-2850 | M | low | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 248 | PAN-2836 | L | low | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 249 | PAN-2817 | M | low | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 250 | PAN-2813 | M | low | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 251 | PAN-2810 | M | low | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 252 | PAN-2809 | M | low | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 253 | PAN-2806 | M | low | ok |  |  | bug(cloister): strike merge trigger registry splits across dashboard chunks |
| 254 | PAN-2796 | M | low | ok |  |  | fix(cloister): idle nudge must not advance after failed mandatory inspection |
| 255 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 256 | PAN-2755 | M | low | ok |  |  | bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 257 | PAN-2754 | M | low | ok |  |  | bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 258 | PAN-2718 | M | low | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator |
| 259 | PAN-2685 | M | low | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 260 | PAN-2680 | M | low | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 261 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 262 | PAN-2678 | M | low | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 263 | PAN-2668 | M | low | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery |
| 264 | PAN-2667 | M | low | ok |  |  | Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 265 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 266 | PAN-2660 | M | low | ok |  |  | Add safe Reset to planned action to the issue actions menu |
| 267 | PAN-2652 | M | low | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id resolu... |
| 268 | PAN-2651 | M | low | ok |  |  | fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset |
| 269 | PAN-2646 | M | low | ok |  |  | feat(swarm): configurable global/project/issue policy UI with default OFF |
| 270 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 271 | PAN-2635 | M | low | ok |  |  | chore(server): pay down the 152-error src/dashboard/server typecheck debt |
| 272 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 273 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 274 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 275 | PAN-2626 | M | low | ok |  |  | feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 276 | PAN-2625 | M | low | ok |  |  | feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 277 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 278 | PAN-2609 | M | low | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 279 | PAN-2608 | M | low | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 280 | PAN-2600 | M | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 281 | PAN-2582 | M | low | ok |  |  | feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 282 | PAN-2572 | M | low | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 283 | PAN-2566 | XL | low | ok |  |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 284 | PAN-2565 | M | low | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 285 | PAN-2560 | L | low | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall bac... |
| 286 | PAN-2557 | M | low | ok |  |  | feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor |
| 287 | PAN-2556 | M | low | ok |  |  | feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into the ... |
| 288 | PAN-2553 | M | low | ok |  |  | feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 289 | PAN-2549 | L | low | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 290 | PAN-2548 | M | low | ok |  |  | chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker |
| 291 | PAN-2533 | M | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 292 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 293 | PAN-2526 | L | low | ok |  |  | Refactor deacon.ts below file-size baseline |
| 294 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 295 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 296 | PAN-2506 | M | low | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 297 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 298 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 299 | PAN-2501 | M | low | ok |  |  | bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/... |
| 300 | PAN-2493 | M | low | ok |  |  | feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 301 | PAN-2492 | M | low | ok |  |  | bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only t... |
| 302 | PAN-2491 | L | low | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 303 | PAN-2489 | M | low | ok |  |  | bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 304 | PAN-2487 | M | low | ok |  |  | feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 305 | PAN-2484 | M | low | ok |  |  | fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule ... |
| 306 | PAN-2469 | M | low | ok |  |  | feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN-2... |
| 307 | PAN-2465 | M | low | ok |  |  | bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero |
| 308 | PAN-2454 | M | low | ok |  |  | bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches |
| 309 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 310 | PAN-2444 | M | low | ok |  |  | feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 311 | PAN-2443 | M | low | ok |  |  | feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption |
| 312 | PAN-2442 | M | low | ok |  |  | feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and promp... |
| 313 | PAN-2428 | M | low | ok |  |  | bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label ma... |
| 314 | PAN-2424 | XL | low | ok |  |  | Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remote... |
| 315 | PAN-2423 | M | low | ok |  |  | bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification contai... |
| 316 | PAN-2422 | M | low | ok |  |  | bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 317 | PAN-2416 | M | low | ok |  |  | bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively |
| 318 | PAN-2414 | M | low | ok |  |  | bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation... |
| 319 | PAN-2409 | M | low | ok |  |  | feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07... |
| 320 | PAN-2408 | M | low | ok |  |  | bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-wor... |
| 321 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree re... |
| 322 | PAN-2399 | M | low | ok |  |  | feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 323 | PAN-2395 | M | low | ok |  |  | bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversati... |
| 324 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 325 | PAN-2392 | M | low | ok |  |  | feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 326 | PAN-2390 | M | low | ok |  |  | systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on ... |
| 327 | PAN-2381 | M | low | ok |  |  | bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 328 | PAN-2356 | M | low | ok |  |  | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 329 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 330 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 331 | PAN-2352 | M | low | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 332 | PAN-2353 | M | low | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 333 | PAN-2351 | M | low | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 334 | PAN-2350 | XL | low | ok |  |  | Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone |
| 335 | PAN-2348 | L | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 336 | PAN-2347 | M | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 337 | PAN-2346 | M | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 338 | PAN-2345 | M | low | ok |  |  | docs: refresh pan-done.md — update, harden, make useful |
| 339 | PAN-2344 | M | low | ok |  |  | docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 340 | PAN-2343 | M | low | ok |  |  | docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 341 | PAN-2335 | M | low | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do... |
| 342 | PAN-2308 | L | low | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals ... |
| 343 | PAN-2295 | M | low | needs-refinement |  |  | feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 344 | PAN-2288 | L | low | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up) |
| 345 | PAN-2287 | M | low | ok |  |  | bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file |
| 346 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 347 | PAN-2280 | M | low | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.) |
| 348 | PAN-2266 | M | low | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 349 | PAN-2213 | M | low | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 350 | PAN-2212 | M | low | ok |  |  | Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 351 | PAN-2211 | M | low | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 352 | PAN-2210 | M | low | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 353 | PAN-2201 | M | low | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels |
| 354 | PAN-2197 | M | low | ok |  |  | bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 355 | PAN-2195 | M | low | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 356 | PAN-2091 | M | low | ok |  |  | chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 357 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 358 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 359 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 360 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 361 | PAN-2074 | M | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 362 | PAN-2073 | M | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 363 | PAN-2071 | M | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 364 | PAN-2070 | M | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 365 | PAN-2068 | M | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 366 | PAN-2067 | M | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 367 | PAN-2065 | M | low | ok |  |  | feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 368 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 369 | PAN-2008 | M | low | ok |  |  | feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 370 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 371 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 372 | PAN-2004 | M | low | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 373 | PAN-2002 | M | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 374 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 375 | PAN-1995 | M | low | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 376 | PAN-1991 | M | low | ok |  |  | Issue cockpit redesign — incremental rollout (tracking) |
| 377 | PAN-1990 | M | low | ok |  |  | First-class workspaces and projects with per-workspace memory |
| 378 | PAN-1988 | M | low | ok |  |  | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 379 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 380 | PAN-1984 | L | low | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 381 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 382 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 383 | PAN-1968 | M | low | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 384 | PAN-1967 | M | low | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 385 | PAN-1965 | M | low | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 386 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 387 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 388 | PAN-1937 | M | low | ok |  |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 389 | PAN-1936 | M | low | ok |  |  | Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 390 | PAN-1926 | M | low | ok |  |  | feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 391 | PAN-1918 | M | low | ok |  |  | bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stall... |
| 392 | PAN-1916 | M | low | ok |  |  | feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 393 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 394 | PAN-1910 | M | low | ok |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 395 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywh... |
| 396 | PAN-1906 | M | low | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 397 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 398 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 399 | PAN-1854 | M | low | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 400 | PAN-1853 | M | low | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 401 | PAN-1852 | M | low | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 402 | PAN-1846 | M | low | ok |  |  | bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 403 | PAN-1844 | M | low | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 404 | PAN-1840 | M | low | ok |  |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 405 | PAN-1839 | M | low | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 406 | PAN-1837 | M | low | ok |  |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 407 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 408 | PAN-1776 | M | low | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 409 | PAN-1775 | M | low | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 410 | PAN-1774 | M | low | ok |  |  | bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 411 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 412 | PAN-1761 | M | low | ok |  |  | bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ap... |
| 413 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 414 | PAN-1755 | M | low | ok |  |  | bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 415 | PAN-1754 | M | low | ok |  |  | feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 416 | PAN-1751 | M | low | ok |  |  | feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 417 | PAN-1750 | M | low | ok |  |  | feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 418 | PAN-1748 | M | low | ok |  |  | feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 419 | PAN-1740 | M | low | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 420 | PAN-1735 | M | low | ok |  |  | feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 421 | PAN-1728 | M | low | ok |  |  | bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 422 | PAN-1720 | M | low | ok |  |  | bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 423 | PAN-1710 | M | low | ok |  |  | bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server... |
| 424 | PAN-1696 | M | low | ok |  |  | Merge train becomes per-project — works without a Flywheel run, multi-project view |
| 425 | PAN-1691 | M | low | ok |  |  | feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 426 | PAN-1685 | M | low | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 427 | PAN-1684 | M | low | ok |  |  | docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 428 | PAN-1683 | M | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out... |
| 429 | PAN-1676 | M | low | ok |  |  | feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 430 | PAN-1672 | M | low | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 431 | PAN-1669 | M | low | ok |  |  | bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 432 | PAN-1668 | M | low | ok |  |  | bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 433 | PAN-1667 | M | low | ok |  |  | feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 434 | PAN-1657 | M | low | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 435 | PAN-1656 | M | low | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 436 | PAN-1655 | M | low | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 437 | PAN-1654 | M | low | ok |  |  | perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 438 | PAN-1653 | M | low | ok |  |  | perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 439 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 440 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 441 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 442 | PAN-1640 | M | low | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 443 | PAN-1627 | M | low | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approv... |
| 444 | PAN-1623 | M | low | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 445 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 446 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 447 | PAN-1572 | M | low | ok |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 448 | PAN-1553 | M | low | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 449 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 450 | PAN-1550 | M | low | ok |  |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 451 | PAN-1545 | M | low | ok |  |  | feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 452 | PAN-1542 | M | low | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 453 | PAN-2035 | M | low | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 454 | PAN-2034 | M | low | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 455 | PAN-2033 | M | low | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 456 | PAN-2032 | M | low | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 457 | PAN-2031 | M | low | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 458 | PAN-2030 | M | low | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 459 | PAN-2029 | M | low | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 460 | PAN-2028 | M | low | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 461 | PAN-2026 | M | low | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 462 | PAN-2025 | M | low | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 463 | PAN-2024 | M | low | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 464 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 465 | PAN-1524 | M | low | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 466 | PAN-1490 | M | low | ok |  |  | feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 467 | PAN-1489 | XL | low | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 468 | PAN-1485 | M | low | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 469 | PAN-1483 | M | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 470 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 471 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 472 | PAN-1480 | M | low | ok |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 473 | PAN-1479 | M | low | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 474 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 475 | PAN-1473 | L | low | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 476 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 477 | PAN-1443 | L | low | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 478 | PAN-1442 | M | low | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 479 | PAN-1437 | M | low | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 480 | PAN-1432 | M | low | ok |  |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 481 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 482 | PAN-1325 | M | low | ok |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 483 | PAN-1985 | M | low | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 484 | PAN-1245 | M | low | stale |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 485 | PAN-1244 | M | low | stale |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 486 | PAN-1242 | M | low | stale |  |  | Create a new issue directly from a kanban column |
| 487 | PAN-1223 | M | low | stale |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 488 | PAN-1222 | M | low | stale |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 489 | PAN-1208 | M | low | stale |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 490 | PAN-1166 | M | low | stale |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 491 | PAN-1165 | M | low | stale |  |  | Lightweight review path for small/trivial PRs |
| 492 | PAN-1154 | M | low | stale |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 493 | PAN-1153 | M | low | stale |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 494 | PAN-1152 | M | low | stale |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 495 | PAN-1151 | M | low | stale |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 496 | PAN-1136 | M | low | stale |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 497 | PAN-1135 | M | low | stale |  |  | Document the hook system in docs/HOOKS.md |
| 498 | PAN-1133 | M | low | stale |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 499 | PAN-1126 | M | low | stale |  |  | Integrate TLDR summaries into review context manifest |
| 500 | PAN-1124 | M | low | stale |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 501 | PAN-1123 | M | low | stale |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 502 | PAN-1121 | M | low | stale |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 503 | PAN-1117 | M | low | stale |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 504 | PAN-1116 | M | low | stale |  |  | Memory: cross-project search mode |
| 505 | PAN-1066 | M | low | stale |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 506 | PAN-1065 | M | low | stale |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 507 | PAN-1064 | M | low | stale |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 508 | PAN-1063 | M | low | stale |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 509 | PAN-1060 | M | low | stale |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 510 | PAN-1051 | M | low | stale |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 511 | PAN-1049 | M | low | stale |  |  | Spike: evaluate Tauri v2 desktop shell |
| 512 | PAN-1041 | M | low | stale |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 513 | PAN-1040 | M | low | stale |  |  | feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 514 | PAN-1037 | M | low | stale |  |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 515 | PAN-984 | M | low | stale |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 516 | PAN-962 | M | low | stale |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 517 | PAN-961 | M | low | stale |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 518 | PAN-958 | L | low | stale |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 519 | PAN-949 | M | low | stale |  |  | feat: add conversation for project from sidebar |
| 520 | PAN-944 | M | low | stale |  |  | Make vBRIEF the durable task graph source of truth |
| 521 | PAN-943 | M | low | stale |  |  | Add memory file review and management command |
| 522 | PAN-938 | M | low | stale |  |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 523 | PAN-927 | M | low | stale |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 524 | PAN-924 | M | low | stale |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 525 | PAN-908 | M | low | stale |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 526 | PAN-903 | M | low | stale |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 527 | PAN-902 | M | low | stale |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 528 | PAN-901 | M | low | stale |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 529 | PAN-898 | M | low | stale |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 530 | PAN-863 | M | low | stale |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 531 | PAN-853 | M | low | stale |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 532 | PAN-833 | M | low | stale |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 533 | PAN-832 | M | low | stale |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 534 | PAN-818 | M | low | stale |  |  | Make summary optional when forking conversations |
| 535 | PAN-817 | M | low | stale |  |  | Improve planning dialog layout and content fit |
| 536 | PAN-810 | M | low | stale |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 537 | PAN-802 | M | low | stale |  |  | Resume on conversation session forks instead of resuming |
| 538 | PAN-797 | M | low | stale |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 539 | PAN-793 | M | low | stale |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 540 | PAN-791 | M | low | stale |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 541 | PAN-790 | L | low | stale |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 542 | PAN-786 | M | low | stale |  |  | Post planning Q\&A answers as issue comment |
| 543 | PAN-778 | M | low | stale |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 544 | PAN-777 | M | low | stale |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 545 | PAN-775 | M | low | stale |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 546 | PAN-774 | M | low | stale |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 547 | PAN-773 | M | low | stale |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 548 | PAN-772 | M | low | stale |  |  | Unify terminal stack behavior across tmux sessions |
| 549 | PAN-771 | M | low | stale |  |  | Investigate Vercel Sandbox execution backend support |
| 550 | PAN-769 | M | low | stale |  |  | Track verification/review/test phase churn over time |
| 551 | PAN-765 | M | low | stale |  |  | Preserve trailing zeros in cost displays |
| 552 | PAN-764 | M | low | stale |  |  | Add quota/usage inspector for routed model providers |
| 553 | PAN-762 | M | low | stale |  |  | Settings: warn when model overrides target disabled providers |
| 554 | PAN-752 | M | low | stale |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 555 | PAN-751 | M | low | stale |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 556 | PAN-750 | M | low | stale |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 557 | PAN-749 | M | low | stale |  |  | Research and borrow best features from gstack |
| 558 | PAN-747 | M | low | stale |  |  | Conversation list items lack accessible labels in accessibility tree |
| 559 | PAN-743 | M | low | stale |  |  | Add consistent new conversation icon actions in Command Deck |
| 560 | PAN-738 | M | low | stale |  |  | Add right-click fork option to conversation list |
| 561 | PAN-736 | M | low | stale |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 562 | PAN-735 | M | low | stale |  |  | Settings page: review and configure overridden subagent model files |
| 563 | PAN-730 | M | low | stale |  |  | Add provider account telemetry for credits, balances, and usage |
| 564 | PAN-727 | M | low | stale |  |  | Fix orphaned work-agent start handoff after planning |
| 565 | PAN-713 | M | low | stale |  |  | test: add unit tests for doneCommand and approveCommand |
| 566 | PAN-709 | M | low | stale |  |  | feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 567 | PAN-702 | M | low | stale |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 568 | PAN-701 | M | low | stale |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 569 | PAN-700 | M | low | stale |  |  | Detachable terminal for conversation view — popout into OS window |
| 570 | PAN-687 | M | low | stale |  |  | Support OpenCode as alternative coding agent |
| 571 | PAN-678 | M | low | stale |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 572 | PAN-675 | M | low | stale |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 573 | PAN-674 | M | low | stale |  |  | docs: add glossary of Panopticon domain terms |
| 574 | PAN-663 | M | low | stale |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 575 | PAN-660 | M | low | stale |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 576 | PAN-658 | M | low | stale |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 577 | PAN-654 | M | low | stale |  |  | Project Setup Wizard — Dashboard UI |
| 578 | PAN-649 | M | low | stale |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 579 | PAN-646 | M | low | stale |  |  | Canceled issues: add guided Recover workflow |
| 580 | PAN-637 | M | low | stale |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 581 | PAN-634 | M | low | stale |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 582 | PAN-633 | M | low | stale |  |  | Update Cloister PRD and docs index — stale relative to implementation |
| 583 | PAN-629 | M | low | stale |  |  | Workspace quotas and resource governance |
| 584 | PAN-624 | M | low | stale |  |  | Loop nodes: iterative agent execution with conditional termination |
| 585 | PAN-623 | M | low | stale |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 586 | PAN-622 | M | low | stale |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 587 | PAN-613 | M | low | stale |  |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 588 | PAN-607 | M | low | stale |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 589 | PAN-606 | M | low | stale |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 590 | PAN-604 | M | low | stale |  |  | Hide planning agent from workspace detail pane |
| 591 | PAN-603 | M | low | stale |  |  | Plan review loop with configurable reviewer model |
| 592 | PAN-591 | M | low | stale |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 593 | PAN-589 | M | low | stale |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 594 | PAN-576 | M | low | stale |  |  | Global / search should include conversations in addition to workspace features |
| 595 | PAN-571 | M | low | stale |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 596 | PAN-570 | M | low | stale |  |  | Show PLAN badge on costs when under a subscription/plan |
| 597 | PAN-2066 | L | high | ok |  |  | OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page |
| 597 | PAN-568 | M | low | stale |  |  | Kanban: Show workspace and tmux session counts in stats |
| 598 | PAN-565 | M | low | stale |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 599 | PAN-564 | M | low | stale |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 600 | PAN-554 | M | low | stale |  |  | Add kanban board deeplinks for issue URLs |
| 601 | PAN-548 | M | low | stale |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 602 | PAN-546 | M | low | stale |  |  | Remove claude-code-router — all providers use direct env var injection |
| 603 | PAN-543 | M | low | stale |  |  | Add confirmation dialog before applying Optimal Defaults |
| 604 | PAN-537 | M | low | stale |  |  | feat: show changed files diff summary after each agent response in activity view |
| 605 | PAN-532 | M | low | stale |  |  | Per-project and per-issue model overrides for pipeline roles |
| 606 | PAN-531 | M | low | stale |  |  | PAN: Windows Electron support (WSL2 required) |
| 607 | PAN-483 | M | low | stale |  |  | Unify Resume Agent UX — all entry points should show message input |
| 608 | PAN-480 | M | low | stale |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 609 | PAN-476 | M | low | stale |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 610 | PAN-471 | M | low | stale |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 611 | PAN-468 | M | low | stale |  |  | Agent test conversations pollute production database — need test isolation |
| 612 | PAN-466 | M | low | stale |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 613 | PAN-465 | M | low | stale |  |  | Add OpenRouter as a model provider |
| 614 | PAN-463 | M | low | stale |  |  | Add Qwen 3.6+ model support |
| 615 | PAN-461 | M | low | stale |  |  | Deep-wipe multi-step progress dialog |
| 616 | PAN-459 | M | low | stale |  |  | Planning setup screen with SSE progress streaming |
| 617 | PAN-454 | M | low | stale |  |  | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 618 | PAN-452 | M | low | stale |  |  | Conversation input bar — mode/permissions/workspace selectors |
| 619 | PAN-450 | M | low | stale |  |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 620 | PAN-438 | L | low | stale |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 621 | PAN-407 | M | low | stale |  |  | Run Panopticon from a main workspace for development isolation |
| 622 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 623 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 624 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 625 | PAN-294 | M | low | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 626 | PAN-293 | M | low | stale |  |  | Project Living Memory — per-project semantic memory for agents |
| 627 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 628 | PAN-277 | M | low | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 629 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 630 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 631 | PAN-258 | M | low | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 632 | PAN-255 | M | low | stale |  |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 633 | PAN-252 | M | low | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 634 | PAN-249 | M | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 635 | PAN-243 | M | low | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 636 | PAN-241 | XL | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 637 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 638 | PAN-227 | M | low | stale |  |  | Phase gate validation — mid-implementation acceptance checks |
| 639 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 640 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 641 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 642 | PAN-178 | M | low | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 643 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 644 | PAN-176 | M | low | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 645 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 646 | PAN-155 | M | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 647 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 648 | PAN-106 | M | low | stale |  |  | Cost prediction/estimation for in-progress work |
| 649 | PAN-77 | M | low | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 650 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 651 | PAN-54 | M | low | stale |  |  | feat: Add pan test:e2e command for full workflow integration test |
| 652 | PAN-52 | M | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 653 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 654 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 655 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 656 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 657 | PAN-38 | M | low | stale |  |  | Support multiple merge agents per repository |
| 658 | PAN-37 | M | low | stale |  |  | Support external PR selection for merge-agent |

## Rationale detail

### PAN-2963 (rank 1)

Live red-main blocking every feature PR; lint:source-introspection fails because the new test from the #2908 series was never baselined. 6th same-day recurrence of the direct-push-bypasses-PR-CI pattern (PAN-2940). Strike-class unblock: regen baseline in an issue-referenced commit or rewrite the test.

### PAN-2858 (rank 1)

Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.

### PAN-2961 (rank 2)

Completion path unconditionally force-pushes even when HEAD===origin and there is nothing to push, which trips MYN's GitLab pre-push hook and the no-history-rewrite rule. Directly blocks MIN-882 and any MYN completion. Fix: skip the push when HEAD===origin, use fast-forward when there is a cleanup commit, gate --force-with-lease behind a capability.

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2876 (rank 7)

When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.

### PAN-2838 (rank 7)

In-progress UI polish; pinned.

### PAN-2940 (rank 12)

Filed 1 day ago, the pattern behind PAN-2963. Three separate red-main incidents in ~7 hours, all direct pushes by supervised conversations, all failures PR CI would have caught. Operator decision call (not a bug): doctrine rule, branch+auto-merge-on-green, or a pre-push hook leg running ratchet guards locally. Whichever is chosen, this is the wedge that keeps producing red-mains and must be closed alongside the immediate fix.

### PAN-2706 (rank 13)

Verified at code level. A test session that booted but never received its kickoff is indistinguishable from an actively-running test run; it permanently absorbs every subsequent test dispatch and silently marks `testStatus: 'testing'` without delivering any prompt. Two compounding defects in spawn.ts and test-agent-queue.ts. Blocks the drain: PAN-2683 review-passed and cannot reach a test verdict. Self-healing impossible — deacon sees a live session + testing and leaves it alone.

### PAN-2599 (rank 14)

Planned/in-progress analytics integration; pinned.

### PAN-2709 (rank 14)

Filed per the "backstop interventions are symptoms" doctrine. The flywheel owns strike merges but the only channel to it is a resume that structurally cannot succeed while the run is stopped. Two strikes (PAN-2701, PAN-2690) finished green-and-blocked in a single day because of this; recovery was a manual pane sweep. The orchestrator's mailbox is effectively write-only. Fix: durable queue consumer or skip-resume routing, plus drain-on-next-tick.

### PAN-2650 (rank 15)

Two interacting defects. The memory-governor stops the integration workspace stack as idle/mergeable, but the swarm's final-slot verify still depends on it, so verification stays pending forever and the merge never fires. And `pan swarm recover` only handles failed-merge, not stuck-ready-to-merge, so there is no recovery lever short of a forbidden hand self-merge. Observed stuck ~18h on PAN-2607 slot-3.

### PAN-2639 (rank 16)

Resume path replays the dead token baked into a pre-refresh session, every codex reviewer 401s at startup, never executes its kickoff — review convoy silently wedges with no verdict. Host auth is healthy the whole time. Hit PAN-2596, PAN-2602 and likely every codex review across a token rotation. Fix: detect auth change since session creation and start fresh, or re-inject the current token before first request.

### PAN-2569 (rank 17)

Observed 2/2 order-book dispatches in RUN-62. The complete-planning → start-agent handoff silently no-ops: planning finalized, planning session exited, no agent state dir, no tmux session. A second manual `pan start` finds the existing plan and spawns fine — so the plan is fine, the handoff itself is broken. In an unattended flywheel this strands the issue indefinitely with no error surfaced.

### PAN-2593 (rank 18)

Verification-gate typecheck fails 3/3 with `util.styleText` not exported (rolldown needs Node ≥20.12). Server launches with the nvm Node 22 binary explicitly, but its PATH is bare system dirs, so every child the server spawns resolves /usr/bin/node = v18.19.1. Which workspaces break depends on their dep versions, so it looks flaky. Fix is one line at server boot: prepend dirname(process.execPath) to PATH.

### PAN-2511 (rank 19)

Direct in-pipeline velocity regression. Work-agent sandbox denies git subprocess execution; any test that shells out to git fails with spawnSync EPERM. Agents can't tell that's a sandbox artifact, so they retry with escalation and burn cycle time. PAN-2167 burned 21+ min live. The same code passes the verification gate (PAN-174) and CI. Fix is mostly prompt guidance in roles/work.md: the verification gate owns full-suite execution; the work agent closes beads + self-reads the diff and proceeds to pan done.

### PAN-2451 (rank 20)

Pipeline-generated commits (auto-commit-before-sync, overflow checkpoint, merge-main) produce messages that fail the commit-msg gate. A legitimately-working agent that hit an overflow restart + sync ends up with a non-pushable branch (108 commits ahead). And the deacon has no recovery for a work agent frozen pre-submit. Two fixes needed: make pipeline commits issue-referenced/exempt, and add a deacon patrol that detects idle+non-advancing pre-submit work agents.

### PAN-2337 (rank 21)

Substrate-critical. The live server spawns `node <packageRoot>/dist/pty-supervisor.js` and reads it fresh from disk on every spawn, so an under-foot rewrite breaks new spawns until a restart onto a fresh process clears it. Observed 2026-07-03: every new conversation/agent spawn timed out. Fix: pin the supervisor artifact at boot (per-boot immutable path) and make `pan reload` build to staging + atomic swap.

### PAN-2334 (rank 22)

Process substrate. The retired PAN-1456/1453/1498/1499 junk sat in the pipeline consuming an agent and slamming the quota wall because nothing flagged them as not-ready. DoR + a vetting hook at the pickup gate catches them: concrete deliverable, mechanically checkable ACs, no ephemeral-tooling deps, de-dupe, bounded scope, freshness re-vet, aligned-to-epic, clear owner. Directly reduces future wasted agent cycles.

### PAN-2333 (rank 23)

Pairs with PAN-2331 (the narrow auto-dismiss fix). As codex quota nears exhaustion, agents freeze at an unanswerable TUI modal; the dashboard needs-you surface then shows N un-actionable cards. Fix is one resource alert + a policy (auto-downshift or pause-new-spawns, never freeze at a modal) + clean recovery on quota reset. Needed for any unattended flywheel run during quota pressure.

### PAN-2331 (rank 24)

Narrow fix for the modal stall: suppress the reminder at the codex config level or auto-select "never show again" in the launcher. Pairs with PAN-2333 (the broader quota policy) and PAN-2521 (suppress for all pipeline agents at spawn).

### PAN-2259 (rank 25)

GraphQL quota hit zero three times in one evening, each time breaking pan close (which shells out to gh issue view via GraphQL), label ops, PR merge, issue filing. REST quota stayed nearly untouched — the burn is GraphQL-specific. Suspects: deacon/dashboard reconciliation polling PR+issue state per in-pipeline issue per tick (~90 review_status rows × 1-min patrols → thousands/hr). Fix: identify the consumer, move high-frequency polls to REST/ETags, cache per-tick, make pan close degrade to REST when GraphQL is exhausted.

### PAN-2193 (rank 26)

resolvePipelineMembership decides membership purely from PR/branch lenses, so a held-but-never-started issue is bucketed clean_terminal and dropped from the tree — directly contradicting the resolver's own stated definition. PAN-1864 (objection+parked), PAN-806 (objection), PAN-2189/PAN-2190 (needs-handoff) were all open waiting on operator decisions and none appeared in the tree. Fix: add a `held` (needs-decision) bucket.

### PAN-2186 (rank 27)

Two RUN-43 auto-merges left drift: PAN-2173 still labeled in-review/ready/released with no merged/verifying-on-main; PAN-2174 still status=merging in the pending queue after it had already merged. The operator-facing consequence is the Flywheel cannot safely `pan close` because the issue hasn't reached the allowed close-out state, and the queue shows stale in-flight work.

### PAN-2179 (rank 28)

Any stop→relaunch can yield a zombie: session present, agent never kicked off. Liveness checks based on tmux has-session are fooled — the session exists, so nothing recovers it, while the agent does no work. PAN-2160's self-heal relaunch is undermined: it "succeeds" (session up) but produces a non-functional agent. Fix: relaunch must verify the kickoff landed, and liveness ≠ session-exists.

### PAN-2170 (rank 29)

The workspace init image has no Python, so any native addon requiring node-gyp (better-sqlite3@11.10.0) fails to compile during workspace setup. The Docker stack never comes up and `pan start` aborts unless the operator passes --host. Affects every new Docker-backed workspace. Cheapest fix: add Python to the image; better: prune the stale better-sqlite3 dep entirely since the DB layer now uses runtime-bundled node:sqlite.

### PAN-2169 (rank 30)

PAN-1865 added 'exceeded model token limit' to CONTEXT_OVERFLOW_PATTERNS, but kimi never throws — it silently saturates to 100% ctx and freezes. The pattern-scan never matches and overflow-recovery never triggers. A kimi-k2.7-code agent was frozen at ctx 100% for 10h with $0.0000 cost and no work history. Fix: a context-saturation heuristic independent of thrown-error patterns (ctx≥99% AND no activity for N minutes → respawn).

### PAN-2165 (rank 31)

Two distinct failures. Bug A: `gh issue edit` with --remove-label aborts the entire command when ANY of the labels to remove is absent, so stale lifecycle labels persist. Bug B: `close-issue:transition` prints ✓ and marks the journal closed-out, yet the GitHub issue stays OPEN. PAN-2157 ended up merged + OPEN with no closed-out label. The orchestrator cannot trust close-out's own success report — pollutes the Flywheel inventory.

### PAN-2106 (rank 32)

pan strike reported `✔ Strike agent spawned` but the workspace was a half-built git-lock race artifact: .git as a directory not a file, no checkout, no worktree entry. The strike agent self-aborted on worktree-discipline grounds. Two gaps: pan strike reports success without verifying the worktree was created, and no recovery path for a strike that lands in a broken workspace. Race window is concurrent git push / pan done on the shared primary repo.

### PAN-2466 (rank 33)

Recurring twice in one day: the LOCAL per-issue records for just-closed issues were rewritten with closeOut.usage.byStage = {} / totals = {} while REMOTE carried the real data. Every merge conflict had to be resolved by taking the older remote side. Silently destroys exactly the data the cost-visibility program is building. Fix: read-modify-write closeOut (merge byStage maps, never replace with empties) + regression test.

### PAN-2516 (rank 34)

After PAN-2167 merged and was closed-out, the spec mirror on main stayed `plan.status: "proposed"` while the working tree had `completed` uncommitted. Every status flip writes the working tree but never commits. Two harms: spec-vs-record drift per PAN-1124, and the uncommitted tree blocks the flywheel's own push loop (it can't stash/reset per the rules, so it wedges and the divergence grows each tick). Fix: every status flip must atomically commit+push the spec change; belt: a boot reconciler.

### PAN-2521 (rank 35)

Codex/Claude harness surfaces an interactive "Switch to gpt-5.4-mini?" dialog inside the agent's TUI; it blocks the pane and the session wedges. Launch all pipeline agents with the reminder disabled at the launcher layer so every spawned agent inherits it. Pairs with PAN-2331 (codex-specific) and PAN-2333 (broader policy) as defense-in-depth.

### PAN-1560 (rank 36)

When a PR's head SHA changes after review already passed (e.g. pan sync-main to fix CI), re-running review does not re-post the required panopticon/review status to the new head. Status stays on the stale commit, so GitHub branch protection keeps the PR BLOCKED forever even though the pipeline considers it review-passed/READY TO MERGE. The status post is gated on the readyForMerge false→true transition; if it's already true, re-review is a no-op for status. Same failure family as #1215.

### PAN-1650 (rank 37)

readyForMerge is one boolean wearing two hats, and the overload causes real operational pain: a fully-green PR sits unmergeable because readyForMerge=0 and only a poller reconciles it. PAN-1048 deliberately made readyForMerge mean "ship has rebased+verified+pushed" (good safety property), but there's no event-driven signal for the genuinely-derivable "all quality gates are green." Splitting it: gatesPassed is derived on every setReviewStatusSync write; shipComplete is ship-set. Ship dispatches event-driven when gatesPassed goes true. Removes the poll dependency.

### PAN-1454 (rank 38)

Meta substrate. An 80-issue audit distilled 9 recurring systemic patterns (zombie agents, label drift, false positive verification, dead-pointer resumes, idle-wedge detection, etc). Each pattern is a substrate gap that the individual bug-fix issues above address one instance of; this is the meta-tracker that keeps the set coherent and prevents recurrence class-by-class. Lifts the children's priority together.

### PAN-1889 (rank 39)

FLYWHEEL-STATE.md is append-only and grows without bound; the flywheel rewrites it each tick. A retention/compaction policy is needed so the file stays readable and the rewrite stays cheap. Small but addresses a slow bleed.

### PAN-2895 (rank 40)

In-pipeline. Resume retries a missing JSONL instead of falling back to a fresh session, dead-ending every crash/reboot recovery path.

### PAN-2075 (rank 40)

Epic container. Replaces the silent, all-or-nothing, dashboard-only, local-only boot-resume with one informed operator decision surface fed into a durable Operator Inbox. Today's default-off gate solved the runaway-storm worry but introduced a symmetric problem: the freeze is silent, the operator has no visibility or control over remote Fly agents that keep spending money independently of the dashboard, and headless/offline operators learn nothing. This is the architectural spine for every "operator must know" surface (boot, alerts, awaiting-input, red-main). Children: PAN-2077 (inventory) → PAN-2076 (surface, supersedes PAN-454) ∥ PAN-2078 (CLI) → PAN-2079 (inbox spine) → PAN-2080 (external transports).

### PAN-2077 (rank 41)

Keystone child of PAN-2075. A single resolver returning every agent that exists in state but isn't verified running, across local tmux AND remote Fly.io, in a single typed result. Local orphan detection and remote visibility are separate blind spots today. Depends on PAN-1775 (remote Fly agents need real session rows before they can be reconciled). This is the backend that both the dashboard surface (PAN-2076) and the CLI (PAN-2078) consume.

### PAN-2079 (rank 42)

Architectural spine of PAN-2075 — build once, boot reconciliation is producer #1. A durable server-side queue of operator-actionable items with severity, deep links, lifecycle. Today the need is scattered across transient producer-specific surfaces (pending agent/conversation input, pane-only harness waits, cost alerts, boot). The inbox absorbs them; producers post via one idempotent API so reposting an unresolved condition updates instead of duplicating. Builds on PAN-1844 (deep links), absorbs the spine half of PAN-43/1102/1520/104.

### PAN-2078 (rank 43)

Child of PAN-2075. `pan up` is frequently headless with no browser; the same boot-reconciliation decision must be actionable from the CLI. pan boot status prints the inventory (machine-readable --json); pan resume takes --all / --select / --freeze / --kill-remote (Stop vs Destroy with typed confirmation).

### PAN-2080 (rank 44)

Fast-follow of PAN-2075, depends on PAN-2079. Once the inbox exists, reach the operator out-of-band when they aren't looking at the dashboard. Pluggable transports, per-item-type routing + severity thresholds, deep links. Absorbs PAN-43 as the concrete first transports.

### PAN-2059 (rank 45)

Epic container. Today an issue is auto-pickable the instant it is ready AND planned; no operator review beat between "a plan exists" and "go work it," no way for the AI to push back on bad work before an agent burns time. Inserts two new states: Released (operator's explicit go after reviewing the plan) and Held-for-Review/AI-Objection (planning AI may refuse with a written objection). Mockups committed; implemented directly on main under operator direction. Critical for making the flywheel safe to run unattended.

### PAN-2642 (rank 46)

Epic container. The cost-limits feature shipped with invented defaults ($10/agent, $25/issue, $100/day) the operator never chose; the alarm sat permanently exceeded and its cost_alert events had no consumer anywhere (480k+ log lines of spam). Operator decision: Overdeck's cost problem is waste detection, not budget enforcement. The one real guard is the progress-aware circuit breaker (PAN-1868); the rest is making dollars honest (subscription vs API billing modes), ledger integrity (PAN-2466, PAN-1042), and ROI telemetry. Children: PAN-1868, PAN-2466, PAN-570, PAN-1042, PAN-2079 (alert surface).

### PAN-1868 (rank 47)

Keystone of PAN-2642 — the one real cost guard. A flat dollar cap kills legitimately expensive deep work; the bleed signature is high burn-rate + flat progress. Detection: burn-rate × zero-progress proxies (commits, lastActivity, transcript growth) + instant-trip deadlock signatures (repeated token-limit / ctx 100%). Graduated response: warn → auto-pause with diagnosis → auto-remediate known signatures (harness-deadlock → restart on the resolved provider-default harness). One kimi agent burned $22.33 before a human noticed; this would have caught it in ~60s.

### PAN-1666 (rank 48)

Epic container. Goal: keep many work agents busy continuously across local + remote capacity, with review/test/ship spawned on demand and rate-limited so the host never stampedes. The 2026-06-07 incident: unfreezing the deacon thundering-herded ~37 stopped work agents at once, load 5→52 in 3.5 min. Workstreams: throttle deacon resume (PAN-1665 keystone), on-demand/ephemeral specialists, resource-slot manager with reserved minimums to avoid deadlock. Turning the deacon on (or running the flywheel unattended) should be a non-event.

### PAN-2377 (rank 49)

substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.

### PAN-262 (rank 49)

Planned/architecture, 146d old — the oldest substrate item still open. Post-merge cleanup is fragmented across 3+ code paths with duplicated, missing, and inconsistent operations: polyrepo MYN never moves PRDs, workspace+agent orphaned after merge, closeIssueAfterMerge called from 3+ locations (race risk), .planning/ artifacts permanently lost on teardown, PRD paths hardcoded to docs/prds/ (broken for polyrepo). Adds prds_path to project config, extracts teardown-workspace, replaces postMergeCleanup() with workflows.approve().

### PAN-2376 (rank 50)

The CI/CD epic (treated as an issue, not labeled EPIC). The RUN-55 stability drain proved the codebase is healthy but the delivery machinery is the bottleneck. Phases: flakes stop gating (Phase 0) → verification-to-merge convergence (Phase 1, absorbs PAN-2198) → strike+swarm merge-path hardening (Phase 2) → deploy+state hygiene (Phase 3) → review automation + guardrails (Phase 4). Exit: 14 consecutive days without an operator unstick of an APPROVED-but-unmerged issue.

### PAN-807 (rank 51)

Critical/architecture, 119d old. Stop the "hard-reset local branch then commit planning artifacts" pattern that silently drops visibility of unpushed work. PAN-698's spawn flow hard-reset the local branch to a 2-day-old commit then committed fresh planning artifacts — losing local visibility of 16 real work commits on origin. Didn't lose data this time (work was pushed), but the pattern is a loaded gun: if an agent hasn't pushed yet when a spawn happens, work would be orphaned. Pre-flight checks: fetch, compare local vs remote, abort if ahead-of-remote or untracked files outside ignore set.

### PAN-1313 (rank 52)

Planning/architecture, 60d. The original Effect migration has lingering Promise/sync surfaces that violate the effect-time uniformity. Critical for deacon/patrol correctness (the "no execSync in dashboard server" rule and async tmux primitives rule both depend on Effect being uniformly adopted).

### PAN-1561 (rank 53)

Architecture, 52d old. Project-scoped dashboard nav so multi-project operators (overdeck + MYN + auricle + krux) get a deck-of-tabs instead of a single flattened view. Multi-tenant UX substrate that everything else assumes.

### PAN-1217 (rank 54)

Substrate/convoy-revival, 62d. The requirements reviewer treats the entire vBRIEF AC list as in-scope for every PR — on PAN-1148 that produced 180 ACs and 19 partial !-blockers for a single PR. Synthesis can demote (issue #1216 shipped scope gates) but the cost is paid downstream. Fix: per-AC scope classification against the PR diff; severity ! only valid when scope is in_pr_scope; whole_feature_scope always advisory.

### PAN-1218 (rank 55)

Substrate, 62d. Bead inspection adds 3-5 min per bead when it fires. Compile/lint passed in 100% of blocked cases — Check 3 is pure duplication of the verification gate. Tightenings: drop Check 3, restrict to foundation beads, end-of-batch mode. Of 6 recent blocks, 2 were gitignore-policy violations not real defects.

### PAN-1219 (rank 56)

Substrate/convoy-revival, 62d. Today's reviewer treats every cycle as fresh; across-cycle review state isn't first-class data, so reviewers re-litigate settled findings or miss regressions against a prior cycle. Promote cycle SHA + prior findings to first-class.

### PAN-1504 (rank 57)

Planned/substrate, 56d. The hygiene audit (merge/commit/push state) is currently done by hand; codify it as `pan hygiene` so it can be run mechanically. Directly supports the DoD rule that merged≠done until the dashboard ships the merge.

### PAN-1452 (rank 58)

Architecture/substrate, 58d. PAN-1381 shipped a Restart context-menu action but per-reviewer restart with a different model is architecturally impossible post-PAN-1048 (which retired the per-reviewer tmux session). The shipped UI is misleading. Recommend Option C: add per-axis model overrides on the same convoy run — gives the cost-control benefit the original need cited without undoing session consolidation.

### PAN-1451 (rank 59)

Substrate, 58d. PAN-1124 landed partial planning-on-main pivot; this completes the dropped ACs that have caused spec-vs-record scope drift. Pairs with PAN-2516.

### PAN-1544 (rank 60)

Architecture, 54d. Mechanical type cleanup. The ship role was collapsed but the union still carries the member; strip it and update downstream references. Low impact, pure correctness.

### PAN-2720 (rank 61)

Substrate, 5d. Two strikes bent their diffs around the ratchet in a single day. PAN-2704 chained four .option() calls onto one line to satisfy the guard; PAN-2692 was forced into a workaround commit. The metric (lines) diverges from the goal (readability/decomposition) precisely where it binds hardest. Suggested fixes: count statements/AST nodes, exempt pure wiring, or flag suspicious line density.

### PAN-2379 (rank 62)

Substrate, 16d. Verification gate's dependency install is warn-only with a 60s timeout, so a cold cache produces a false verify failure that blocks the merge. Direct pipeline-throughput hit — every cold-cache issue hits this. Fix: make the install required and raise the timeout, or make it deterministic via a warm cache.

### PAN-2430 (rank 63)

Substrate, 14d. Pre-existing unused-local errors in src/ files that the frontend typecheck gate imports, blocking verification for any issue whose scope pulls the frontend gate. Short-term: relax in config; long-term: clean up the unused imports and re-enable.

### PAN-2421 (rank 64)

Substrate, 14d. Several dashboard server route tests time out under full-suite verification load. Look like resource/contention flakes on loaded runners rather than deterministic regressions. Pairs with the fake-timers rule for delay-based tests.

### PAN-2189 (rank 65)

Substrate/needs-handoff, 20d. The deacon is still 3,394 lines after Epic B wave-2 shrank it from 7,180; the shrink-only guard passes CI while it remains a god file. Supervised pan handoff only — NOT autonomous flywheel pickup (TENET-10): pipeline-machinery refactors redden main and stall every merge. Behavior-preserving extraction into focused modules under cloister/, full npm test green.

### PAN-2190 (rank 66)

Substrate/needs-handoff, 20d. NEW >1000-line file created by the workspaces.ts decomposition (#2126); the shrink-only guard permitted it. Supervised pan handoff only (TENET-10): merge-route logic is pipeline-runtime; an autonomous refactor that breaks it stalls the merge gate.

### PAN-2233 (rank 67)

Substrate/needs-handoff, 18d. Behavior-preserving decomposition into <1000-line modules with a re-export barrel. CRITICAL: postMergeLifecycle idempotency is locked by in-flight-guard.test.ts; the Docker network cleanup step must NEVER be removed. Supervised pan handoff (TENET-10).

### PAN-2188 (rank 68)

Substrate, 20d. Two inputs landed (substrate-first prioritization in the sequencer; spirit gate checking candidates against the 14 resolved tenets in docs/DECISIONS.md). Operator-decision items remain: unblock the PAN-1864 wedge first, file the doc-only substrate gaps, confirm flood-scope policy. Coordinates the flood that the decomp issues above feed.

### PAN-578 (rank 69)

Critical/security, 95d. Agents have full shell access; untrusted comment text is injected directly into the agent prompt via work-agent.md. A malicious GitHub comment could exfiltrate SSH keys, env vars, git credentials. Already exploitable today. Fix: a mediation layer — external content is DATA never INSTRUCTIONS, defense in depth, fail closed, zero-trust for non-collaborators. Becomes more urgent the more we open the tracker to public/external input.

### PAN-1915 (rank 70)

Security, 34d. The chmod fix (6bf6176c78) closed the immediate hole but doesn't help users with pre-existing loose files until they trigger a rewrite. Three sequenced work items: startup perm check + auto-repair (short-term), OS keychain integration via keytar (medium-term), eventual deprecation of plaintext. Folds in PAN-1435.

### PAN-1435 (rank 71)

Security, 48d. Original tracker for the plaintext-keys issue; folds under PAN-1915's keychain integration. Suggested approaches: OS keychain (right long-term path), at-rest encryption with a master key, or minimum-viable chmod 600 (immediate hygiene, already shipped).

### PAN-1824 (rank 72)

Planned/bug. Directly cites the fake-timers-for-delay-based-tests rule. A family of real-timer tests cause OOM under parallelization because retry/backoff delays keep test contexts alive; the "fix" of dropping maxForks to 1 masks the bug. Fix: vi.useFakeTimers + vi.advanceTimersByTime; put genuine wall-clock tests in a separate @slow-tagged file excluded from default run.

### PAN-538 (rank 73)

Planned/bug. The reload freshness guard verifies the backend bundle but not the frontend, so a stale frontend can ship under a fresh backend. Pairs with PAN-2337 (reload/build atomicity) and the DoD rule that the live dashboard must contain the merge.

### PAN-1416 (rank 74)

Planned/bug. Workspace dev stacks can race the canonical :3011 server for the port; whichever wins, the operator gets the wrong dashboard. Critical because it can cause operator to read stale state or a workspace-only view as if it were the orchestrator. Pairs with the single-deacon-invariant rule.

### PAN-1951 (rank 75)

Planned. The inspector cold-spawns a session per item, which is slow and wasteful when the operator inspects several items in a row. Resume a warm per-issue session instead. Cycle-time improvement for operator-driven inspection.

### PAN-1164 (rank 76)

Planned/enhancement. Diff summaries currently poll every 5s; move to live WebSocket updates. Aligns the conversation view with the rest of the live-update model.

### PAN-1577 (rank 77)

Planned/enhancement. Conversations are project-scoped today with no move operation; mis-filed conversations are stuck. CLI + dashboard drag/drop + menu action to re-assign.

### PAN-947 (rank 78)

Planned/enhancement. Project management actions (rename, archive, configure) are scattered across CLI and dashboard surfaces; consolidate into the unified sidebar.

### PAN-1767 (rank 79)

Planned/substrate. The merged-but-not-closed-out queue reached 21 deep with no first-class surface. Misfire dispatch surface (boot reconciliation dispatches onto merged issues), held resources (workspace disk, paused sessions), and measurement gap (close-out is the terminal lifecycle event). The classification half landed; the surfacing half is one selector away.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-20T14:56:46Z",
  "model": "glm-5.2",
  "pass": "incremental",
  "openCount": 658,
  "nodes": [
    {
      "issue": "PAN-2963",
      "rank": 1,
      "size": "S",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main: source-introspection guard rejects new conformance-gates.test.ts — merge gate blocked.",
      "rationale": "Live red-main blocking every feature PR; lint:source-introspection fails because the new test from the #2908 series was never baselined. 6th same-day recurrence of the direct-push-bypasses-PR-CI pattern (PAN-2940). Strike-class unblock: regen baseline in an issue-referenced commit or rewrite the test.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2961",
      "rank": 2,
      "size": "S",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done force-pushes (--force-with-lease) on already-up-to-date branches — breaks MYN/GitLab/no-history-rewrite completion.",
      "rationale": "Completion path unconditionally force-pushes even when HEAD===origin and there is nothing to push, which trips MYN's GitLab pre-push hook and the no-history-rewrite rule. Directly blocks MIN-882 and any MYN completion. Fix: skip the push when HEAD===origin, use fast-forward when there is a cleanup commit, gate --force-with-lease behind a capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "L",
      "importance": "critical",
      "score": 95,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2377",
      "rank": 49,
      "size": "L",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "first-class 'special orders' runs — operator-supplied order book executed with lane semantics",
      "rationale": "substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2858",
      "rank": 1,
      "size": "L",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight",
      "rationale": "Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2066",
      "rank": 597,
      "size": "L",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2895",
      "rank": 40,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume path retries a session whose JSONL is missing instead of falling back to fresh — dead-ends recovery.",
      "rationale": "In-pipeline. Resume retries a missing JSONL instead of falling back to a fresh session, dead-ending every crash/reboot recovery path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2599",
      "rank": 14,
      "size": "L",
      "importance": "medium",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate PostHog product analytics + telemetry",
      "rationale": "Planned/in-progress analytics integration; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "XL",
      "importance": "high",
      "score": 82,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2876",
      "rank": 7,
      "size": "M",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation subagent rail: list spawned subagents and open their transcripts.",
      "rationale": "When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2838",
      "rank": 7,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project settings disclosure badge for projects with no settings",
      "rationale": "In-progress UI polish; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2963"
      ],
      "why": "Three red-mains in one day from direct-push series bypassing PR CI — need a pre-merge CI surface.",
      "rationale": "Filed 1 day ago, the pattern behind PAN-2963. Three separate red-main incidents in ~7 hours, all direct pushes by supervised conversations, all failures PR CI would have caught. Operator decision call (not a bug): doctrine rule, branch+auto-merge-on-green, or a pre-push hook leg running ratchet guards locally. Whichever is chosen, this is the wedge that keeps producing red-mains and must be closed alongside the immediate fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch — never-kicked-off session reads as \"running\".",
      "rationale": "Verified at code level. A test session that booted but never received its kickoff is indistinguishable from an actively-running test run; it permanently absorbs every subsequent test dispatch and silently marks `testStatus: 'testing'` without delivering any prompt. Two compounding defects in spawn.ts and test-agent-queue.ts. Blocks the drain: PAN-2683 review-passed and cannot reach a test verdict. Self-healing impossible — deacon sees a live session + testing and leaves it alone.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 14,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator unreachable as a notification target — resume always fails when stopped.",
      "rationale": "Filed per the \"backstop interventions are symptoms\" doctrine. The flywheel owns strike merges but the only channel to it is a resume that structurally cannot succeed while the run is stopped. Two strikes (PAN-2701, PAN-2690) finished green-and-blocked in a single day because of this; recovery was a manual pane sweep. The orchestrator's mailbox is effectively write-only. Fix: durable queue consumer or skip-resume routing, plus drain-on-next-tick.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 15,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover can't recover it.",
      "rationale": "Two interacting defects. The memory-governor stops the integration workspace stack as idle/mergeable, but the swarm's final-slot verify still depends on it, so verification stays pending forever and the merge never fires. And `pan swarm recover` only handles failed-merge, not stuck-ready-to-merge, so there is no recovery lever short of a forbidden hand self-merge. Observed stuck ~18h on PAN-2607 slot-3.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 16,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401.",
      "rationale": "Resume path replays the dead token baked into a pre-refresh session, every codex reviewer 401s at startup, never executes its kickoff — review convoy silently wedges with no verdict. Host auth is healthy the whole time. Hit PAN-2596, PAN-2602 and likely every codex review across a token rotation. Fix: detect auth change since session creation and start fresh, or re-inject the current token before first request.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 17,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): planning finalizes (issue→planned) but work agent does not auto-spawn — silent handoff failure requiring manual pan start.",
      "rationale": "Observed 2/2 order-book dispatches in RUN-62. The complete-planning → start-agent handoff silently no-ops: planning finalized, planning session exited, no agent state dir, no tmux session. A second manual `pan start` finds the existing plan and spawns fine — so the plan is fine, the handoff itself is broken. In an unattended flywheel this strands the issue indefinitely with no error surfaced.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 18,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): server children inherit bare system PATH — verification gates run npm/node under system Node 18, not the server's Node 22.",
      "rationale": "Verification-gate typecheck fails 3/3 with `util.styleText` not exported (rolldown needs Node ≥20.12). Server launches with the nvm Node 22 binary explicitly, but its PATH is bare system dirs, so every child the server spawns resolves /usr/bin/node = v18.19.1. Which workspaces break depends on their dep versions, so it looks flaky. Fix is one line at server boot: prepend dirname(process.execPath) to PATH.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 19,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate.",
      "rationale": "Direct in-pipeline velocity regression. Work-agent sandbox denies git subprocess execution; any test that shells out to git fails with spawnSync EPERM. Agents can't tell that's a sandbox artifact, so they retry with escalation and burn cycle time. PAN-2167 burned 21+ min live. The same code passes the verification gate (PAN-174) and CI. Fix is mostly prompt guidance in roles/work.md: the verification gate owns full-suite execution; the work agent closes beads + self-reads the diff and proceeds to pan done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 20,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits).",
      "rationale": "Pipeline-generated commits (auto-commit-before-sync, overflow checkpoint, merge-main) produce messages that fail the commit-msg gate. A legitimately-working agent that hit an overflow restart + sync ends up with a non-pushable branch (108 commits ahead). And the deacon has no recovery for a work agent frozen pre-submit. Two fixes needed: make pipeline commits issue-referenced/exempt, and add a deacon patrol that detects idle+non-advancing pre-submit work agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 21,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart.",
      "rationale": "Substrate-critical. The live server spawns `node <packageRoot>/dist/pty-supervisor.js` and reads it fresh from disk on every spawn, so an under-foot rewrite breaks new spawns until a restart onto a fresh process clears it. Observed 2026-07-03: every new conversation/agent spawn timed out. Fix: pin the supervisor artifact at boot (per-boot immutable path) and make `pan reload` build to staging + atomic swap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 22,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write a Definition of Ready — bar an issue must clear before planning/pickup (catches junk).",
      "rationale": "Process substrate. The retired PAN-1456/1453/1498/1499 junk sat in the pipeline consuming an agent and slamming the quota wall because nothing flagged them as not-ready. DoR + a vetting hook at the pickup gate catches them: concrete deliverable, mechanically checkable ACs, no ephemeral-tooling deps, de-dupe, bounded scope, freshness re-vet, aligned-to-epic, clear owner. Directly reduces future wasted agent cycles.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 23,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [
        "PAN-2331"
      ],
      "why": "Handle codex weekly-quota exhaustion — resource alert + downshift, no unanswerable modals.",
      "rationale": "Pairs with PAN-2331 (the narrow auto-dismiss fix). As codex quota nears exhaustion, agents freeze at an unanswerable TUI modal; the dashboard needs-you surface then shows N un-actionable cards. Fix is one resource alert + a policy (auto-downshift or pause-new-spawns, never freeze at a modal) + clean recovery on quota reset. Needed for any unattended flywheel run during quota pressure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 24,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): codex rate-limit \"Switch to gpt-5.4-mini?\" modal stalls autonomous agents (no auto-dismiss).",
      "rationale": "Narrow fix for the modal stall: suppress the reminder at the codex config level or auto-select \"never show again\" in the launcher. Pairs with PAN-2333 (the broader quota policy) and PAN-2521 (suppress for all pipeline agents at spawn).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration.",
      "rationale": "GraphQL quota hit zero three times in one evening, each time breaking pan close (which shells out to gh issue view via GraphQL), label ops, PR merge, issue filing. REST quota stayed nearly untouched — the burn is GraphQL-specific. Suspects: deacon/dashboard reconciliation polling PR+issue state per in-pipeline issue per tick (~90 review_status rows × 1-min patrols → thousands/hr). Fix: identify the consumer, move high-frequency polls to REST/ETags, cache per-tick, make pan close degrade to REST when GraphQL is exhausted.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 26,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal.",
      "rationale": "resolvePipelineMembership decides membership purely from PR/branch lenses, so a held-but-never-started issue is bucketed clean_terminal and dropped from the tree — directly contradicting the resolver's own stated definition. PAN-1864 (objection+parked), PAN-806 (objection), PAN-2189/PAN-2190 (needs-handoff) were all open waiting on operator decisions and none appeared in the tree. Fix: add a `held` (needs-decision) bucket.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 27,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck.",
      "rationale": "Two RUN-43 auto-merges left drift: PAN-2173 still labeled in-review/ready/released with no merged/verifying-on-main; PAN-2174 still status=merging in the pending queue after it had already merged. The operator-facing consequence is the Flywheel cannot safely `pan close` because the issue hasn't reached the allowed close-out state, and the queue shows stale in-flight work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled).",
      "rationale": "Any stop→relaunch can yield a zombie: session present, agent never kicked off. Liveness checks based on tmux has-session are fooled — the session exists, so nothing recovers it, while the agent does no work. PAN-2160's self-heal relaunch is undermined: it \"succeeds\" (session up) but produces a non-functional agent. Fix: relaunch must verify the kickoff landed, and liveness ≠ session-exists.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 29,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails (forces --host).",
      "rationale": "The workspace init image has no Python, so any native addon requiring node-gyp (better-sqlite3@11.10.0) fails to compile during workspace setup. The Docker stack never comes up and `pan start` aborts unless the operator passes --host. Affects every new Docker-backed workspace. Cheapest fix: add Python to the image; better: prune the stale better-sqlite3 dep entirely since the DB layer now uses runtime-bundled node:sqlite.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 30,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx (no thrown error) — needs ctx-saturation heuristic.",
      "rationale": "PAN-1865 added 'exceeded model token limit' to CONTEXT_OVERFLOW_PATTERNS, but kimi never throws — it silently saturates to 100% ctx and freezes. The pattern-scan never matches and overflow-recovery never triggers. A kimi-k2.7-code agent was frozen at ctx 100% for 10h with $0.0000 cost and no work history. Fix: a context-saturation heuristic independent of thrown-error patterns (ctx≥99% AND no activity for N minutes → respawn).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 31,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close reports success but leaves issue OPEN / wrong labels (remove-label aborts).",
      "rationale": "Two distinct failures. Bug A: `gh issue edit` with --remove-label aborts the entire command when ANY of the labels to remove is absent, so stale lifecycle labels persist. Bug B: `close-issue:transition` prints ✓ and marks the journal closed-out, yet the GitHub issue stays OPEN. PAN-2157 ended up merged + OPEN with no closed-out label. The orchestrator cannot trust close-out's own success report — pollutes the Flywheel inventory.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false \"spawned\" success (git-lock race).",
      "rationale": "pan strike reported `✔ Strike agent spawned` but the workspace was a half-built git-lock race artifact: .git as a directory not a file, no checkout, no worktree entry. The strike agent self-aborted on worktree-discipline grounds. Two gaps: pan strike reports success without verifying the worktree was created, and no recovery path for a strike that lands in a broken workspace. Race window is concurrent git push / pan done on the shared primary repo.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring).",
      "rationale": "Recurring twice in one day: the LOCAL per-issue records for just-closed issues were rewritten with closeOut.usage.byStage = {} / totals = {} while REMOTE carried the real data. Every merge conflict had to be resolved by taking the older remote side. Silently destroys exactly the data the cost-visibility program is building. Fix: read-modify-write closeOut (merge byStage maps, never replace with empties) + regression test.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push.",
      "rationale": "After PAN-2167 merged and was closed-out, the spec mirror on main stayed `plan.status: \"proposed\"` while the working tree had `completed` uncommitted. Every status flip writes the working tree but never commits. Two harms: spec-vs-record drift per PAN-1124, and the uncommitted tree blocks the flywheel's own push loop (it can't stash/reset per the rules, so it wedges and the divergence grows each tick). Fix: every status flip must atomically commit+push the spec change; belt: a boot reconciler.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 35,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled.",
      "rationale": "Codex/Claude harness surfaces an interactive \"Switch to gpt-5.4-mini?\" dialog inside the agent's TUI; it blocks the pane and the session wedges. Launch all pipeline agents with the reminder disabled at the launcher layer so every spawned agent inherits it. Pairs with PAN-2331 (codex-specific) and PAN-2333 (broader policy) as defense-in-depth.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 36,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED.",
      "rationale": "When a PR's head SHA changes after review already passed (e.g. pan sync-main to fix CI), re-running review does not re-post the required panopticon/review status to the new head. Status stays on the stale commit, so GitHub branch protection keeps the PR BLOCKED forever even though the pipeline considers it review-passed/READY TO MERGE. The status post is gated on the readyForMerge false→true transition; if it's already true, re-review is a no-op for status. Same failure family as #1215.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 37,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green.",
      "rationale": "readyForMerge is one boolean wearing two hats, and the overload causes real operational pain: a fully-green PR sits unmergeable because readyForMerge=0 and only a poller reconciles it. PAN-1048 deliberately made readyForMerge mean \"ship has rebased+verified+pushed\" (good safety property), but there's no event-driven signal for the genuinely-derivable \"all quality gates are green.\" Splitting it: gatesPassed is derived on every setReviewStatusSync write; shipComplete is ship-set. Ship dispatches event-driven when gatesPassed goes true. Removes the poll dependency.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent recurrence.",
      "rationale": "Meta substrate. An 80-issue audit distilled 9 recurring systemic patterns (zombie agents, label drift, false positive verification, dead-pointer resumes, idle-wedge detection, etc). Each pattern is a substrate gap that the individual bug-fix issues above address one instance of; this is the meta-tracker that keeps the set coherent and prevents recurrence class-by-class. Lifts the children's priority together.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1889",
      "rank": 39,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded.",
      "rationale": "FLYWHEEL-STATE.md is append-only and grows without bound; the flywheel rewrites it each tick. A retention/compaction policy is needed so the file stays readable and the rewrite stays cheap. Small but addresses a slow bleed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 40,
      "size": "XL",
      "importance": "critical",
      "score": 90,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "[EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline.",
      "rationale": "Epic container. Replaces the silent, all-or-nothing, dashboard-only, local-only boot-resume with one informed operator decision surface fed into a durable Operator Inbox. Today's default-off gate solved the runaway-storm worry but introduced a symmetric problem: the freeze is silent, the operator has no visibility or control over remote Fly agents that keep spending money independently of the dashboard, and headless/offline operators learn nothing. This is the architectural spine for every \"operator must know\" surface (boot, alerts, awaiting-input, red-main). Children: PAN-2077 (inventory) → PAN-2076 (surface, supersedes PAN-454) ∥ PAN-2078 (CLI) → PAN-2079 (inbox spine) → PAN-2080 (external transports).",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2077",
      "rank": 41,
      "size": "L",
      "importance": "high",
      "score": 80,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2075",
        "PAN-1775"
      ],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver.",
      "rationale": "Keystone child of PAN-2075. A single resolver returning every agent that exists in state but isn't verified running, across local tmux AND remote Fly.io, in a single typed result. Local orphan detection and remote visibility are separate blind spots today. Depends on PAN-1775 (remote Fly agents need real session rows before they can be reconciled). This is the backend that both the dashboard surface (PAN-2076) and the CLI (PAN-2078) consume.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 42,
      "size": "L",
      "importance": "high",
      "score": 80,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2075"
      ],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine).",
      "rationale": "Architectural spine of PAN-2075 — build once, boot reconciliation is producer #1. A durable server-side queue of operator-actionable items with severity, deep links, lifecycle. Today the need is scattered across transient producer-specific surfaces (pending agent/conversation input, pane-only harness waits, cost alerts, boot). The inbox absorbs them; producers post via one idempotent API so reposting an unresolved condition updates instead of duplicating. Builds on PAN-1844 (deep links), absorbs the spine half of PAN-43/1102/1520/104.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 43,
      "size": "M",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [
        "PAN-2075",
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote.",
      "rationale": "Child of PAN-2075. `pan up` is frequently headless with no browser; the same boot-reconciliation decision must be actionable from the CLI. pan boot status prints the inventory (machine-readable --json); pan resume takes --all / --select / --freeze / --kill-remote (Stop vs Destroy with typed confirmation).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 44,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-2075",
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43).",
      "rationale": "Fast-follow of PAN-2075, depends on PAN-2079. Once the inbox exists, reach the operator out-of-band when they aren't looking at the dashboard. Pluggable transports, per-item-type routing + severity thresholds, deep links. Absorbs PAN-43 as the concrete first transports.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 45,
      "size": "XL",
      "importance": "critical",
      "score": 86,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting.",
      "rationale": "Epic container. Today an issue is auto-pickable the instant it is ready AND planned; no operator review beat between \"a plan exists\" and \"go work it,\" no way for the AI to push back on bad work before an agent burns time. Inserts two new states: Released (operator's explicit go after reviewing the plan) and Held-for-Review/AI-Objection (planning AI may refuse with a written objection). Mockups committed; implemented directly on main under operator direction. Critical for making the flywheel safe to run unattended.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2642",
      "rank": 46,
      "size": "XL",
      "importance": "high",
      "score": 76,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1868",
        "PAN-2466"
      ],
      "why": "[EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land progress-aware breaker, make dollars honest.",
      "rationale": "Epic container. The cost-limits feature shipped with invented defaults ($10/agent, $25/issue, $100/day) the operator never chose; the alarm sat permanently exceeded and its cost_alert events had no consumer anywhere (480k+ log lines of spam). Operator decision: Overdeck's cost problem is waste detection, not budget enforcement. The one real guard is the progress-aware circuit breaker (PAN-1868); the rest is making dollars honest (subscription vs API billing modes), ledger integrity (PAN-2466, PAN-1042), and ROI telemetry. Children: PAN-1868, PAN-2466, PAN-570, PAN-1042, PAN-2079 (alert surface).",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1868",
      "rank": 47,
      "size": "L",
      "importance": "high",
      "score": 82,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2642"
      ],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend.",
      "rationale": "Keystone of PAN-2642 — the one real cost guard. A flat dollar cap kills legitimately expensive deep work; the bleed signature is high burn-rate + flat progress. Detection: burn-rate × zero-progress proxies (commits, lastActivity, transcript growth) + instant-trip deadlock signatures (repeated token-limit / ctx 100%). Graduated response: warn → auto-pause with diagnosis → auto-remediate known signatures (harness-deadlock → restart on the resolved provider-default harness). One kimi agent burned $22.33 before a human noticed; this would have caught it in ~60s.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 48,
      "size": "XL",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1665"
      ],
      "why": "[EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out.",
      "rationale": "Epic container. Goal: keep many work agents busy continuously across local + remote capacity, with review/test/ship spawned on demand and rate-limited so the host never stampedes. The 2026-06-07 incident: unfreezing the deacon thundering-herded ~37 stopped work agents at once, load 5→52 in 3.5 min. Workstreams: throttle deacon resume (PAN-1665 keystone), on-demand/ephemeral specialists, resource-slot manager with reserved minimums to avoid deadlock. Turning the deacon on (or running the flywheel unattended) should be a non-event.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-262",
      "rank": 49,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations.",
      "rationale": "Planned/architecture, 146d old — the oldest substrate item still open. Post-merge cleanup is fragmented across 3+ code paths with duplicated, missing, and inconsistent operations: polyrepo MYN never moves PRDs, workspace+agent orphaned after merge, closeIssueAfterMerge called from 3+ locations (race risk), .planning/ artifacts permanently lost on teardown, PRD paths hardcoded to docs/prds/ (broken for polyrepo). Adds prds_path to project config, extracts teardown-workspace, replaces postMergeCleanup() with workflows.approve().",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2376",
      "rank": 50,
      "size": "XL",
      "importance": "high",
      "score": 78,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability — flake policy, verification-to-merge convergence, deploy hygiene.",
      "rationale": "The CI/CD epic (treated as an issue, not labeled EPIC). The RUN-55 stability drain proved the codebase is healthy but the delivery machinery is the bottleneck. Phases: flakes stop gating (Phase 0) → verification-to-merge convergence (Phase 1, absorbs PAN-2198) → strike+swarm merge-path hardening (Phase 2) → deploy+state hygiene (Phase 3) → review automation + guardrails (Phase 4). Exit: 14 consecutive days without an operator unstick of an APPROVED-but-unmerged issue.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-807",
      "rank": 51,
      "size": "L",
      "importance": "critical",
      "score": 82,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn.",
      "rationale": "Critical/architecture, 119d old. Stop the \"hard-reset local branch then commit planning artifacts\" pattern that silently drops visibility of unpushed work. PAN-698's spawn flow hard-reset the local branch to a 2-day-old commit then committed fresh planning artifacts — losing local visibility of 16 real work commits on origin. Didn't lose data this time (work was pushed), but the pattern is a loaded gun: if an agent hasn't pushed yet when a spawn happens, work would be orphaned. Pre-flight checks: fetch, compare local vs remote, abort if ahead-of-remote or untracked files outside ignore set.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 52,
      "size": "L",
      "importance": "high",
      "score": 72,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces.",
      "rationale": "Planning/architecture, 60d. The original Effect migration has lingering Promise/sync surfaces that violate the effect-time uniformity. Critical for deacon/patrol correctness (the \"no execSync in dashboard server\" rule and async tmux primitives rule both depend on Effect being uniformly adopted).",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1561",
      "rank": 53,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column).",
      "rationale": "Architecture, 52d old. Project-scoped dashboard nav so multi-project operators (overdeck + MYN + auricle + krux) get a deck-of-tabs instead of a single flattened view. Multi-tenant UX substrate that everything else assumes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 54,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items.",
      "rationale": "Substrate/convoy-revival, 62d. The requirements reviewer treats the entire vBRIEF AC list as in-scope for every PR — on PAN-1148 that produced 180 ACs and 19 partial !-blockers for a single PR. Synthesis can demote (issue #1216 shipped scope gates) but the cost is paid downstream. Fix: per-AC scope classification against the PR diff; severity ! only valid when scope is in_pr_scope; whole_feature_scope always advisory.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 55,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode.",
      "rationale": "Substrate, 62d. Bead inspection adds 3-5 min per bead when it fires. Compile/lint passed in 100% of blocked cases — Check 3 is pure duplication of the verification gate. Tightenings: drop Check 3, restrict to foundation beads, end-of-batch mode. Of 6 recent blocks, 2 were gitignore-policy violations not real defects.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 56,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) so reviewers don't re-litigate.",
      "rationale": "Substrate/convoy-revival, 62d. Today's reviewer treats every cycle as fresh; across-cycle review state isn't first-class data, so reviewers re-litigate settled findings or miss regressions against a prior cycle. Promote cycle SHA + prior findings to first-class.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 57,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a CLI command.",
      "rationale": "Planned/substrate, 56d. The hygiene audit (merge/commit/push state) is currently done by hand; codify it as `pan hygiene` so it can be run mechanically. Directly supports the DoD rule that merged≠done until the dashboard ships the merge.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1452",
      "rank": 58,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048).",
      "rationale": "Architecture/substrate, 58d. PAN-1381 shipped a Restart context-menu action but per-reviewer restart with a different model is architecturally impossible post-PAN-1048 (which retired the per-reviewer tmux session). The shipped UI is misleading. Recommend Option C: add per-axis model overrides on the same convoy run — gives the cost-control benefit the original need cited without undoing session consolidation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 59,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1124",
        "PAN-2516"
      ],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift).",
      "rationale": "Substrate, 58d. PAN-1124 landed partial planning-on-main pivot; this completes the dropped ACs that have caused spec-vs-record scope drift. Pairs with PAN-2516.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 60,
      "size": "S",
      "importance": "low",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references.",
      "rationale": "Architecture, 54d. Mechanical type cleanup. The ship role was collapsed but the union still carries the member; strip it and update downstream references. Low impact, pure correctness.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 61,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve.",
      "rationale": "Substrate, 5d. Two strikes bent their diffs around the ratchet in a single day. PAN-2704 chained four .option() calls onto one line to satisfy the guard; PAN-2692 was forced into a workaround commit. The metric (lines) diverges from the goal (readability/decomposition) precisely where it binds hardest. Suggested fixes: count statements/AST nodes, exempt pure wiring, or flag suspicious line density.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 62,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(verify-gate): dependency install is warn-only + 60s timeout → false verify failures on cold caches.",
      "rationale": "Substrate, 16d. Verification gate's dependency install is warn-only with a 60s timeout, so a cold cache produces a false verify failure that blocks the merge. Direct pipeline-throughput hit — every cold-cache issue hits this. Fix: make the install required and raise the timeout, or make it deterministic via a warm cache.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 63,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors.",
      "rationale": "Substrate, 14d. Pre-existing unused-local errors in src/ files that the frontend typecheck gate imports, blocking verification for any issue whose scope pulls the frontend gate. Short-term: relax in config; long-term: clean up the unused imports and re-enable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 64,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): dashboard server route tests flake under full-suite verification load.",
      "rationale": "Substrate, 14d. Several dashboard server route tests time out under full-suite verification load. Look like resource/contention flakes on loaded runners rather than deterministic regressions. Pairs with the fake-timers rule for delay-based tests.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 65,
      "size": "L",
      "importance": "medium",
      "score": 62,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff.",
      "rationale": "Substrate/needs-handoff, 20d. The deacon is still 3,394 lines after Epic B wave-2 shrank it from 7,180; the shrink-only guard passes CI while it remains a god file. Supervised pan handoff only — NOT autonomous flywheel pickup (TENET-10): pipeline-machinery refactors redden main and stall every merge. Behavior-preserving extraction into focused modules under cloister/, full npm test green.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 66,
      "size": "L",
      "importance": "medium",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split.",
      "rationale": "Substrate/needs-handoff, 20d. NEW >1000-line file created by the workspaces.ts decomposition (#2126); the shrink-only guard permitted it. Supervised pan handoff only (TENET-10): merge-route logic is pipeline-runtime; an autonomous refactor that breaks it stalls the merge gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 67,
      "size": "L",
      "importance": "medium",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules.",
      "rationale": "Substrate/needs-handoff, 18d. Behavior-preserving decomposition into <1000-line modules with a re-export barrel. CRITICAL: postMergeLifecycle idempotency is locked by in-flight-guard.test.ts; the Docker network cleanup step must NEVER be removed. Supervised pan handoff (TENET-10).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 68,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate.",
      "rationale": "Substrate, 20d. Two inputs landed (substrate-first prioritization in the sequencer; spirit gate checking candidates against the 14 resolved tenets in docs/DECISIONS.md). Operator-decision items remain: unblock the PAN-1864 wedge first, file the doc-only substrate gaps, confirm flood-scope policy. Coordinates the flood that the decomp issues above feed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 69,
      "size": "L",
      "importance": "critical",
      "score": 80,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments.",
      "rationale": "Critical/security, 95d. Agents have full shell access; untrusted comment text is injected directly into the agent prompt via work-agent.md. A malicious GitHub comment could exfiltrate SSH keys, env vars, git credentials. Already exploitable today. Fix: a mediation layer — external content is DATA never INSTRUCTIONS, defense in depth, fail closed, zero-trust for non-collaborators. Becomes more urgent the more we open the tracker to public/external input.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1915",
      "rank": 70,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1435"
      ],
      "why": "enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext.",
      "rationale": "Security, 34d. The chmod fix (6bf6176c78) closed the immediate hole but doesn't help users with pre-existing loose files until they trigger a rewrite. Three sequenced work items: startup perm check + auto-repair (short-term), OS keychain integration via keytar (medium-term), eventual deprecation of plaintext. Folds in PAN-1435.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 71,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1915"
      ],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext.",
      "rationale": "Security, 48d. Original tracker for the plaintext-keys issue; folds under PAN-1915's keychain integration. Suggested approaches: OS keychain (right long-term path), at-rest encryption with a master key, or minimum-viable chmod 600 (immediate hygiene, already shipped).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 72,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family.",
      "rationale": "Planned/bug. Directly cites the fake-timers-for-delay-based-tests rule. A family of real-timer tests cause OOM under parallelization because retry/backoff delays keep test contexts alive; the \"fix\" of dropping maxForks to 1 masks the bug. Fix: vi.useFakeTimers + vi.advanceTimersByTime; put genuine wall-clock tests in a separate @slow-tagged file excluded from default run.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 73,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-2337"
      ],
      "why": "pan reload freshness guard must also verify the frontend bundle.",
      "rationale": "Planned/bug. The reload freshness guard verifies the backend bundle but not the frontend, so a stale frontend can ship under a fresh backend. Pairs with PAN-2337 (reload/build atomicity) and the DoD rule that the live dashboard must contain the merge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 74,
      "size": "S",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port.",
      "rationale": "Planned/bug. Workspace dev stacks can race the canonical :3011 server for the port; whichever wins, the operator gets the wrong dashboard. Critical because it can cause operator to read stale state or a workspace-only view as if it were the orchestrator. Pairs with the single-deacon-invariant rule.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 75,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item.",
      "rationale": "Planned. The inspector cold-spawns a session per item, which is slow and wasteful when the operator inspects several items in a row. Resume a warm per-issue session instead. Cycle-time improvement for operator-driven inspection.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 76,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling).",
      "rationale": "Planned/enhancement. Diff summaries currently poll every 5s; move to live WebSocket updates. Aligns the conversation view with the rest of the live-update model.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 77,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action).",
      "rationale": "Planned/enhancement. Conversations are project-scoped today with no move operation; mis-filed conversations are stuck. CLI + dashboard drag/drop + menu action to re-assign.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 78,
      "size": "L",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar.",
      "rationale": "Planned/enhancement. Project management actions (rename, archive, configure) are scattered across CLI and dashboard surfaces; consolidate into the unified sidebar.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 79,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline.",
      "rationale": "Planned/substrate. The merged-but-not-closed-out queue reached 21 deep with no first-class surface. Misfire dispatch surface (boot reconciliation dispatches onto merged issues), held resources (workspace disk, paused sessions), and measurement gap (close-out is the terminal lifecycle event). The classification half landed; the surfacing half is one selector away.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 80,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2830",
      "rank": 81,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialogs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 82,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never fires (churning-main convergence ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 83,
      "size": "L",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 84,
      "size": "M",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 85,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 86,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2966",
      "rank": 87,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding (MIN-882)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2960",
      "rank": 88,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict — shows running 38m, needs manual recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2959",
      "rank": 89,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect --item <X> reviews workspace HEAD, not item X's commit — spurious verdict when HEAD moved past the item (MIN-882 metering-cos...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 90,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2952",
      "rank": 91,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 92,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 93,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(boot): intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 94,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door can report fetch failure after merge and land the same head twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 95,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s — profile and fix the residual burner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 96,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 97,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 98,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 99,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 100,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2820",
      "rank": 101,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 102,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2802",
      "rank": 103,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): same-head strike-ready cannot re-arm a needs-you landing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 104,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 105,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04:34Z",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 106,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operator...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 107,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 108,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks like ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 109,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 110,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2749",
      "rank": 111,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 112,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 113,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearly merged PAN-2710 unreviewed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 114,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQUE...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 115,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done n...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 116,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 117,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 118,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 119,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 120,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 121,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace g...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 122,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 123,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 124,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickoff",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 125,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 126,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 127,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 128,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2670",
      "rank": 129,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 130,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(sync-main): auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 131,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(restart): health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 132,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 133,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 134,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(palette): Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 135,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 136,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 137,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 138,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 139,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 140,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 141,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 142,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 143,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2467",
      "rank": 144,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 145,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 146,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 147,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 148,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 149,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 150,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 151,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 152,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 153,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-16...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 154,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 155,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 156,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 157,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 158,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 159,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 160,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 161,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1311",
      "rank": 162,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1253",
      "rank": 163,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "stale",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 164,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 165,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 166,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 167,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 168,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 169,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still ...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1711",
      "rank": 170,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 171,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 172,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 173,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 174,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 175,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 177,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 178,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 179,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 180,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1142",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1571",
      "rank": 182,
      "size": "S",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N lines...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 183,
      "size": "S",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 184,
      "size": "S",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 185,
      "size": "S",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 186,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 187,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 188,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 189,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 191,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 192,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 193,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 194,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1433",
      "rank": 195,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 196,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 197,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 198,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 199,
      "size": "S",
      "importance": "medium",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 200,
      "size": "S",
      "importance": "medium",
      "score": 37,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 201,
      "size": "S",
      "importance": "medium",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1173",
      "rank": 202,
      "size": "S",
      "importance": "medium",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 203,
      "size": "S",
      "importance": "medium",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 204,
      "size": "S",
      "importance": "medium",
      "score": 37,
      "condition": "stale",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 205,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 206,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 207,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 208,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 209,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 210,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 211,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 212,
      "size": "S",
      "importance": "medium",
      "score": 35,
      "condition": "stale",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 213,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 214,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 215,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 216,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 217,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 218,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 219,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 220,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 221,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 222,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 223,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 224,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 225,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 226,
      "size": "S",
      "importance": "medium",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2962",
      "rank": 227,
      "size": "L",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "C-DETAIL remainder: rail-density adoption, page-density cockpit migration, useIssueView-only data path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 228,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build intermittently produces stale frontend bundles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 229,
      "size": "XL",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2949",
      "rank": 230,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test issue — discuss-then-file flow smoke test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2947",
      "rank": 231,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "testing 1 2 3",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2946",
      "rank": 232,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon crashes on null lastActivity in checkFirstCompletionAgents every patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2945",
      "rank": 233,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 234,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 — lease-based writes and advisory semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2937",
      "rank": 235,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board right-click context menu can close when live data ticks re-render the card",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 236,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 237,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 238,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make overdeck not suck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2896",
      "rank": 239,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 240,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out leaves stale residue that inflates troubled/failed metrics: orphaned inspect sub-agents + uncleared review_status rows on CLOSE...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 241,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 242,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2882",
      "rank": 243,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership has no GitLab merged-MR oracle — squash-merged GitLab branches show as unmerged (false planned_backlog rows, mislabel...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 244,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 245,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback delive...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 246,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 247,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 248,
      "size": "L",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 249,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 250,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 251,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 252,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 253,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): strike merge trigger registry splits across dashboard chunks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 254,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(cloister): idle nudge must not advance after failed mandatory inspection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 255,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 256,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 257,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 258,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 259,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2680",
      "rank": 260,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 261,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 262,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 263,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 264,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 265,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2660",
      "rank": 266,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add safe Reset to planned action to the issue actions menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 267,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id resolu...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 268,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 269,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 270,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 271,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(server): pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 272,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 273,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 274,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 275,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 276,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 277,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 278,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 279,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 280,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 281,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 282,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2566",
      "rank": 283,
      "size": "XL",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2565",
      "rank": 284,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 285,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall bac...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 286,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2556",
      "rank": 287,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into the ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 288,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 289,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 290,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 291,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 292,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 293,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 294,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 295,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 296,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 297,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 298,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 299,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 300,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 301,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only t...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 302,
      "size": "L",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 303,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 304,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 305,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 306,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN-2...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 307,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 308,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 309,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 310,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 311,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2442",
      "rank": 312,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and promp...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 313,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label ma...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 314,
      "size": "XL",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remote...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 315,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification contai...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 316,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 317,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 318,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 319,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 320,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-wor...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 321,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree re...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 322,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 323,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversati...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 324,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 325,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2390",
      "rank": 326,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 327,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 328,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2355",
      "rank": 329,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 330,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2352",
      "rank": 331,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2353",
      "rank": 332,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2351",
      "rank": 333,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 334,
      "size": "XL",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2348",
      "rank": 335,
      "size": "L",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 336,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2346",
      "rank": 337,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 338,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 339,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 340,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 341,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do...",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2308",
      "rank": 342,
      "size": "L",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2295",
      "rank": 343,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2288",
      "rank": 344,
      "size": "L",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 345,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 346,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 347,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 348,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 349,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 350,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 351,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 352,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 353,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 354,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 355,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 356,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 357,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 358,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 359,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 360,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 361,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2073",
      "rank": 362,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 363,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 364,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 365,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 366,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 367,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 368,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 369,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 370,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 371,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 372,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 373,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 374,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 375,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 376,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 377,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 378,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 379,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 380,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 381,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 382,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 383,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 384,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 385,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 386,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 387,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 388,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 389,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 390,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 391,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stall...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 392,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 393,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 394,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 395,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywh...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 396,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 397,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 398,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 399,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 400,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 401,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 402,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 403,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 404,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 405,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 406,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 407,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 408,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 409,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 410,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 411,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 412,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ap...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 414,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 416,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 417,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 418,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 419,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 420,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 421,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 422,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 423,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 424,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge train becomes per-project — works without a Flywheel run, multi-project view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 425,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 426,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1684",
      "rank": 427,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 428,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 430,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 432,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 433,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 434,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 435,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 437,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 438,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 439,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 441,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 442,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 443,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approv...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 444,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 445,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 446,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 447,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 450,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 452,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 453,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 456,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 458,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 460,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 462,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 465,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 466,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 467,
      "size": "XL",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 469,
      "size": "M",
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
      "rank": 470,
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
      "rank": 471,
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
      "issue": "PAN-1480",
      "rank": 472,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 475,
      "size": "L",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 477,
      "size": "L",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 482,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 483,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1222",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 494,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 495,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "stale",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 498,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 507,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1040",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 518,
      "size": "L",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-908",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-863",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-853",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 532,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-810",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-797",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-793",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 541,
      "size": "L",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 554,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-713",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-709",
      "rank": 566,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-687",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-637",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 593,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 595,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 596,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 597,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 598,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 599,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 600,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 601,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 602,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 603,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 604,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 605,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-531",
      "rank": 606,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 607,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 608,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 609,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 610,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 611,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 612,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 613,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 614,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 616,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 617,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 618,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 619,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 620,
      "size": "L",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 621,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 622,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 623,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 624,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 625,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 626,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 627,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 628,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 631,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 635,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 636,
      "size": "XL",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 638,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-190",
      "rank": 640,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 642,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 643,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 644,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 646,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 652,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 653,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 654,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 655,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 656,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 657,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 658,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
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
      "to": "PAN-2466",
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
      "to": "PAN-1042",
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
      "from": "PAN-2077",
      "to": "PAN-2078",
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
      "from": "PAN-2466",
      "to": "PAN-1868",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2079",
      "to": "PAN-1868",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2331",
      "to": "PAN-2333",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2521",
      "to": "PAN-2331",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2521",
      "to": "PAN-2333",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2963",
      "to": "PAN-2940",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-806",
      "to": "PAN-2961",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2188",
      "to": "PAN-2189",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2188",
      "to": "PAN-2190",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2188",
      "to": "PAN-2233",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1217",
      "to": "PAN-1219",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2379",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2421",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2430",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2337",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2186",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2179",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2165",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2106",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-1560",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-1650",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2259",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2706",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2709",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2650",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2639",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2569",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2179",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2169",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-2165",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1454",
      "to": "PAN-1560",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-806",
      "to": "PAN-807",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2337",
      "to": "PAN-538",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1824",
      "to": "PAN-2421",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1824",
      "to": "PAN-2430",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1435",
      "to": "PAN-1915",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2079",
      "to": "PAN-43",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2079",
      "to": "PAN-1844",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1451",
      "to": "PAN-2516",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2511",
      "to": "PAN-2451",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1416",
      "to": "PAN-2337",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2377",
      "to": "PAN-2376",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2377",
      "to": "PAN-2188",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1525",
      "to": "PAN-2858",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    }
  ]
}
```
