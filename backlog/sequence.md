# Backlog Sequence

_Last sequenced: 2026-07-20T06:50:14Z · model: glm-5.2 · open: 653_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2951 | S | critical | ok |  |  | Red main: review-reset.test.ts fails at fb1dc3f36f; blocks every feature PR's `test` check. |
| 1 | PAN-2858 | L | high | needs-refinement |  |  | ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight |
| 2 | PAN-2940 | M | critical | needs-refinement |  |  | Three red-mains in one day from direct main pushes; needs a pre-merge CI surface for conversation series. |
| 3 | PAN-2746 | M | critical | ok |  |  | Infra-failure bypass writes reviewStatus='passed' — indistinguishable from real approval; nearly merged a pipeline change unreviewed. |
| 5 | PAN-2495 | M | critical | ok |  |  | ci-green merge skip let a red required `test` check land on main — gate bypassing its own precondition. |
| 6 | PAN-806 | M | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 6 | PAN-2820 | L | critical | needs-refinement |  |  | CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen; live server ran a rollback. |
| 7 | PAN-2952 | M | critical | ok |  | PAN-2948 | Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB. |
| 7 | PAN-2876 | M | high | needs-refinement |  |  | Conversation subagent rail: list spawned subagents and open their transcripts. |
| 7 | PAN-2838 | M | high | needs-refinement |  |  | Project settings disclosure badge for projects with no settings |
| 8 | PAN-2948 | L | critical | ok |  |  | Review pipeline is polyrepo-blind: empty context manifest, wrapper-repo push failures, stale verdicts (MYN). |
| 9 | PAN-2689 | M | critical | ok |  |  | Review verdicts from sandboxed codex agents silently lost — fire-and-forget journal write dies with the CLI. |
| 10 | PAN-2932 | M | critical | needs-refinement |  |  | Intermittent boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload. |
| 11 | PAN-2935 | M | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of workspace API calls 504. |
| 12 | PAN-2905 | M | critical | needs-refinement |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s; profile and fix the residual burner. |
| 13 | PAN-807 | L | critical | needs-refinement |  |  | Epic C: workspace state sanity on spawn — stop hard-reset-then-commit that can orphan unpushed work. |
| 14 | PAN-2954 | M | high | ok |  | PAN-2948 | postMergeLifecycle refuses GitLab projects — merge state can't be auto-verified, teardown/labels never run. |
| 14 | PAN-2599 | M | high | needs-refinement |  |  | Integrate PostHog product analytics + telemetry |
| 15 | PAN-2695 | M | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume — second resumes a booting parent, killing the kickoff. |
| 16 | PAN-1711 | M | high | needs-refinement |  |  | Dashboard event-loop stalls under load cause 15-25s request blocks and watchdog force-restarts. |
| 17 | PAN-2639 | M | high | ok |  |  | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401, no verdict. |
| 18 | PAN-2792 | L | high | ok |  |  | Orphan-process sweeps killed the dashboard + live conversations via lsof +D over hardlinked node_modules (main fix landed). |
| 19 | PAN-2775 | L | high | needs-refinement |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x). |
| 20 | PAN-2742 | M | high | ok |  |  | Review synthesis fires 42s after spawn, reports reviewers with reports on disk as 'infra failure' — false CHANGES REQUESTED. |
| 21 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch — never-kicked-off session reads as 'running', no prompt delivered. |
| 22 | PAN-2734 | M | high | ok |  |  | Merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers. |
| 23 | PAN-2921 | M | high | ok |  |  | Strike merge door reports fetch failure after merge and lands the same head twice (empty second PR). |
| 24 | PAN-2664 | M | high | ok |  |  | sync-main auto-commit completes an unresolved merge with conflict markers — clean tree built from marker files. |
| 25 | PAN-2946 | S | high | ok |  |  | Deacon crashes on null lastActivity in checkFirstCompletionAgents every patrol — first-completion detection skips that cycle. |
| 26 | PAN-2769 | M | high | ok |  |  | review_status rows never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed. |
| 27 | PAN-2888 | M | high | ok |  |  | Close-out leaves stale residue (orphaned inspect sub-agents + uncleared review_status) inflating troubled/failed metrics. |
| 28 | PAN-2846 | M | high | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running. |
| 29 | PAN-2839 | M | high | needs-refinement |  |  | plan→work autoSpawn now 500s with duplicated workspace prep — nondeterministic half-spawns. |
| 30 | PAN-2569 | M | high | ok |  |  | Planning finalizes (issue→planned) but the work agent does not auto-spawn — silent handoff failure. |
| 31 | PAN-2691 | M | high | ok |  |  | Auto-planned issues park silently when post-finalize spawn is gated (stack-unhealthy 422) — no retry, no needs-you. |
| 32 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits). |
| 33 | PAN-2516 | M | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push loop. |
| 34 | PAN-2824 | M | high | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller). |
| 35 | PAN-2550 | M | high | ok |  |  | bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green. |
| 36 | PAN-2558 | M | high | ok |  |  | Polyrepo state-migration: MyN pipeline state tracked in NO git repo — standing data-loss risk. |
| 37 | PAN-2733 | M | high | ok |  |  | substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls). |
| 39 | PAN-2650 | M | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; recover can't recover it. |
| 40 | PAN-2895 | M | high | ok |  |  | Resume path retries a session whose JSONL is missing instead of falling back to fresh — dead-ends recovery. |
| 42 | PAN-2075 | XL | high | needs-refinement | ✓ |  | [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete, reachable online/CLI/offline. |
| 43 | PAN-1915 | M | high | needs-refinement |  |  | Security: API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext. |
| 44 | PAN-2828 | S | high | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash). |
| 45 | PAN-2079 | L | high | needs-refinement |  |  | Operator Inbox: durable server-side queue + in-dashboard surface — the notification spine. |
| 46 | PAN-2738 | M | high | ok |  |  | Strikes deadlock — 'git rebase origin/main' denied as history rewriting, cannot sync/gate/push. |
| 48 | PAN-2908 | XL | high | needs-refinement |  |  | Make overdeck not suck — simple-by-default, conversation-first UX overhaul with CI conformance gates. |
| 49 | PAN-2377 | L | high | needs-refinement |  |  | first-class 'special orders' runs — operator-supplied order book executed with lane semantics |
| 49 | PAN-1868 | M | high | needs-refinement |  |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend. |
| 50 | PAN-2749 | M | high | needs-refinement |  |  | Resume restores the conversation but not the machinery: timers, monitors, background workers never restart. |
| 51 | PAN-2922 | L | high | needs-refinement |  | PAN-2905 | Reduce accidental orchestration complexity — one owner per runtime concern. |
| 52 | PAN-2430 | M | high | ok |  |  | bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors. |
| 53 | PAN-2758 | M | high | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, status=running forever. |
| 54 | PAN-2830 | L | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only. |
| 55 | PAN-2642 | L | high | needs-refinement | ✓ |  | [EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land progress-aware breaker. |
| 56 | PAN-2421 | M | high | needs-refinement |  |  | bug(test): dashboard server route tests flake under full-suite verification load. |
| 57 | PAN-2747 | M | high | needs-refinement |  |  | Flywheel cannot be resumed after a crash/reboot: Resume disabled, only action aborts the run. |
| 58 | PAN-2077 | M | high | needs-refinement |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly) — one resolver. |
| 59 | PAN-2593 | M | high | ok |  |  | bug(dashboard): server children inherit bare system PATH — verification gates run npm on broken PATH. |
| 60 | PAN-2467 | L | high | ok |  |  | Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857). |
| 61 | PAN-2759 | M | high | needs-refinement |  | PAN-2747 | Dead flywheel with an active run never auto-relaunched after a reboot — sat idle for hours. |
| 62 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state. |
| 63 | PAN-1666 | L | high | needs-refinement | ✓ |  | [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager. |
| 64 | PAN-2763 | M | high | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution. |
| 65 | PAN-1435 | M | high | needs-refinement |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext. |
| 66 | PAN-2511 | M | high | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM). |
| 67 | PAN-2466 | M | high | ok |  |  | bug(records): close-out writer clobbers closeOut.usage with EMPTY data — cost history lost (recurring). |
| 68 | PAN-2699 | S | high | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle — every workspace shows a dirty tree. |
| 69 | PAN-2059 | L | high | needs-refinement | ✓ |  | [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state). |
| 71 | PAN-2717 | M | high | needs-refinement |  |  | Conversation permission waits missing from Awareness; strengthen alerting. |
| 72 | PAN-578 | M | high | needs-refinement |  |  | Comment mediation layer to prevent prompt injection via tracker comments. |
| 73 | PAN-2580 | M | high | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery drops. |
| 74 | PAN-2078 | M | medium | needs-refinement |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume flags. |
| 76 | PAN-2546 | M | high | ok |  |  | bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombies. |
| 78 | PAN-2805 | M | high | needs-refinement |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — operator sees no activity. |
| 79 | PAN-2080 | M | medium | needs-refinement |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) — offline reach. |
| 80 | PAN-2802 | S | high | ok |  |  | bug(cloister): same-head strike-ready cannot re-arm a needs-you landing. |
| 81 | PAN-1556 | M | medium | needs-refinement |  |  | Coalesce re-reviews so a fresh dispatch doesn't re-spawn an in-flight review convoy. |
| 83 | PAN-2478 | M | medium | needs-refinement |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT). |
| 84 | PAN-1824 | M | medium | needs-refinement |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family. |
| 85 | PAN-1196 | L | medium | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm). |
| 86 | PAN-1424 | M | medium | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122). |
| 87 | PAN-1311 | M | medium | needs-refinement |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items. |
| 88 | PAN-1253 | M | medium | needs-refinement |  |  | Flywheel: respect issue dependencies before autopicking work. |
| 89 | PAN-262 | M | high | needs-refinement |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 90 | PAN-1217 | M | high | needs-refinement |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 91 | PAN-1219 | M | high | needs-refinement |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 92 | PAN-1767 | M | high | needs-refinement |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 93 | PAN-1913 | M | high | needs-refinement |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 94 | PAN-2027 | M | high | needs-refinement |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 95 | PAN-2106 | M | high | needs-refinement |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 96 | PAN-2165 | M | high | needs-refinement |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans... |
| 97 | PAN-2169 | M | high | needs-refinement |  |  | bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-satu... |
| 98 | PAN-2170 | M | high | needs-refinement |  |  | bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (force... |
| 99 | PAN-2179 | M | high | needs-refinement |  |  | bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled) |
| 100 | PAN-2186 | M | high | needs-refinement |  |  | bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 101 | PAN-2188 | M | high | needs-refinement |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 102 | PAN-2189 | M | high | needs-refinement |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff |
| 103 | PAN-2190 | M | high | needs-refinement |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split |
| 104 | PAN-2193 | M | high | needs-refinement |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal |
| 105 | PAN-2233 | M | high | needs-refinement |  |  | refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules |
| 106 | PAN-2259 | M | high | needs-refinement |  |  | bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration |
| 107 | PAN-2323 | M | high | needs-refinement |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 108 | PAN-2324 | M | high | needs-refinement |  |  | bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels |
| 109 | PAN-2331 | M | high | needs-refinement |  |  | bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for en... |
| 110 | PAN-2333 | M | high | needs-refinement |  |  | feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unan... |
| 111 | PAN-2334 | M | high | needs-refinement |  |  | chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the re... |
| 112 | PAN-2337 | M | high | needs-refinement |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 113 | PAN-2358 | M | high | needs-refinement |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 114 | PAN-2376 | M | high | needs-refinement |  |  | Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene, review au... |
| 115 | PAN-2379 | M | high | needs-refinement |  |  | bug(verify-gate): dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm conver... |
| 116 | PAN-2521 | M | high | needs-refinement |  |  | feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 117 | PAN-2567 | M | high | needs-refinement |  |  | bug(cloister): reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never fires (churning-main convergenc... |
| 118 | PAN-2709 | M | high | needs-refinement |  |  | Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the run is stopped, fee... |
| 119 | PAN-2720 | M | high | needs-refinement |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve — two strikes bent their diffs around i... |
| 120 | PAN-538 | M | medium | needs-refinement |  |  | pan reload freshness guard must also verify the frontend bundle |
| 121 | PAN-1042 | M | medium | needs-refinement |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 122 | PAN-1130 | M | medium | needs-refinement |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 123 | PAN-1386 | M | medium | needs-refinement |  |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 124 | PAN-1416 | M | medium | needs-refinement |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 125 | PAN-1530 | M | medium | needs-refinement |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 126 | PAN-1830 | M | medium | needs-refinement |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 127 | PAN-2069 | M | medium | needs-refinement |  |  | caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 128 | PAN-2202 | M | medium | needs-refinement |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success |
| 129 | PAN-2237 | M | medium | needs-refinement |  |  | bug(cli): pan plan done swallows vbrief quality lint details |
| 130 | PAN-1525 | L | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-2240 | M | medium | needs-refinement |  |  | bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 131 | PAN-2241 | M | medium | needs-refinement |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 132 | PAN-2242 | M | medium | needs-refinement |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 133 | PAN-2243 | M | medium | needs-refinement |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 134 | PAN-2244 | M | medium | needs-refinement |  |  | Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land) |
| 135 | PAN-2547 | M | medium | needs-refinement |  |  | bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure |
| 136 | PAN-2554 | M | medium | needs-refinement |  |  | bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable |
| 137 | PAN-2563 | M | medium | needs-refinement |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 138 | PAN-2627 | M | medium | needs-refinement |  |  | bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the iss... |
| 139 | PAN-2649 | M | medium | needs-refinement |  |  | bug(palette): Ctrl+K conversation search indexes Claude transcripts only |
| 140 | PAN-2656 | M | medium | needs-refinement |  |  | bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 141 | PAN-2659 | M | medium | needs-refinement |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 142 | PAN-2663 | M | medium | needs-refinement |  |  | bug(restart): health probe can accept old dashboard after replacement EADDRINUSE |
| 143 | PAN-2670 | M | medium | needs-refinement |  |  | Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors) |
| 144 | PAN-2672 | M | medium | needs-refinement |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 145 | PAN-2686 | M | medium | needs-refinement |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 146 | PAN-2696 | M | medium | needs-refinement |  |  | Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label |
| 147 | PAN-2697 | M | medium | needs-refinement |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches |
| 148 | PAN-2700 | M | medium | needs-refinement |  |  | Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict |
| 149 | PAN-2739 | M | medium | needs-refinement |  |  | bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done... |
| 150 | PAN-2761 | M | medium | needs-refinement |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik... |
| 151 | PAN-2848 | M | medium | needs-refinement |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a... |
| 152 | PAN-1489 | M | medium | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 153 | PAN-2295 | M | medium | needs-refinement |  |  | feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 154 | PAN-532 | M | medium | needs-refinement |  |  | Per-project and per-issue model overrides for pipeline roles |
| 155 | PAN-802 | M | medium | stale |  |  | Resume on conversation session forks instead of resuming |
| 156 | PAN-817 | M | medium | stale |  |  | Improve planning dialog layout and content fit |
| 157 | PAN-863 | M | medium | needs-refinement |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 158 | PAN-924 | M | medium | stale |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 159 | PAN-947 | M | medium | stale |  |  | feat: project management actions in unified sidebar |
| 160 | PAN-1040 | M | medium | stale |  |  | feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 161 | PAN-1041 | M | medium | stale |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 162 | PAN-1164 | M | medium | needs-refinement |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 163 | PAN-1577 | M | medium | needs-refinement |  |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 164 | PAN-1951 | M | medium | needs-refinement |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 165 | PAN-454 | M | medium | needs-refinement |  |  | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 166 | PAN-813 | M | medium | stale |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 167 | PAN-955 | M | medium | stale |  |  | Workspace devcontainer template versioning + re-render on demand |
| 168 | PAN-1142 | M | medium | stale |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 169 | PAN-1165 | M | medium | needs-refinement |  |  | Lightweight review path for small/trivial PRs |
| 170 | PAN-1198 | M | medium | stale |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 171 | PAN-1209 | M | medium | stale |  |  | PAN-1052 bead projection disagrees with bd state |
| 172 | PAN-1218 | M | medium | stale |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 173 | PAN-1223 | M | medium | needs-refinement |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 174 | PAN-1246 | M | medium | needs-refinement |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 175 | PAN-1254 | M | medium | needs-refinement |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 176 | PAN-1313 | M | medium | needs-refinement |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 177 | PAN-1357 | M | medium | needs-refinement |  |  | Template conversations: load curated skill bundles into a single conversation |
| 178 | PAN-1451 | M | medium | needs-refinement |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 179 | PAN-1452 | M | medium | needs-refinement |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 180 | PAN-1454 | M | medium | needs-refinement |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues |
| 181 | PAN-1497 | M | medium | needs-refinement |  |  | feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 182 | PAN-1504 | M | medium | needs-refinement |  |  | feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs |
| 183 | PAN-1538 | M | medium | needs-refinement |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 184 | PAN-1544 | M | medium | needs-refinement |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 185 | PAN-1558 | M | medium | needs-refinement |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 186 | PAN-1560 | M | medium | needs-refinement |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 187 | PAN-1561 | M | medium | needs-refinement |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 188 | PAN-1578 | M | medium | needs-refinement |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 189 | PAN-1618 | M | medium | needs-refinement |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down |
| 190 | PAN-1650 | M | medium | needs-refinement |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 191 | PAN-1766 | M | medium | needs-refinement |  |  | bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-... |
| 192 | PAN-1770 | M | medium | needs-refinement |  |  | bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle |
| 193 | PAN-1776 | M | medium | needs-refinement |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 194 | PAN-1889 | M | medium | needs-refinement |  |  | feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run |
| 195 | PAN-1985 | M | medium | needs-refinement |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 196 | PAN-1991 | M | medium | needs-refinement |  |  | Issue cockpit redesign — incremental rollout (tracking) |
| 197 | PAN-1995 | M | medium | needs-refinement |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 198 | PAN-2004 | M | medium | needs-refinement |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 199 | PAN-2024 | M | medium | needs-refinement |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 200 | PAN-2025 | M | medium | needs-refinement |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 201 | PAN-2026 | M | medium | needs-refinement |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 202 | PAN-2028 | M | medium | needs-refinement |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 203 | PAN-2029 | M | medium | needs-refinement |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 204 | PAN-2030 | M | medium | needs-refinement |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 205 | PAN-2031 | M | medium | needs-refinement |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 206 | PAN-2032 | M | medium | needs-refinement |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 207 | PAN-2033 | M | medium | needs-refinement |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 208 | PAN-2034 | M | medium | needs-refinement |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 209 | PAN-2035 | M | medium | needs-refinement |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 210 | PAN-2065 | M | medium | needs-refinement |  |  | feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 211 | PAN-2266 | M | medium | needs-refinement |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 212 | PAN-2288 | M | medium | needs-refinement |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up) |
| 213 | PAN-2335 | M | medium | needs-refinement |  |  | chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, ... |
| 214 | PAN-2548 | M | medium | needs-refinement |  |  | chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 ma... |
| 215 | PAN-2553 | M | medium | needs-refinement |  |  | feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 216 | PAN-2557 | M | medium | needs-refinement |  |  | feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor |
| 217 | PAN-2556 | M | medium | needs-refinement |  |  | feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into th... |
| 218 | PAN-2565 | M | medium | needs-refinement |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 219 | PAN-2566 | M | medium | needs-refinement |  |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 220 | PAN-2582 | M | medium | needs-refinement |  |  | feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 221 | PAN-2608 | M | medium | needs-refinement |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 222 | PAN-2609 | M | medium | needs-refinement |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 223 | PAN-2646 | M | medium | needs-refinement |  |  | feat(swarm): configurable global/project/issue policy UI with default OFF |
| 224 | PAN-2685 | M | medium | needs-refinement |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 225 | PAN-2718 | M | medium | needs-refinement |  |  | pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator |
| 226 | PAN-2896 | M | medium | needs-refinement |  |  | Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute |
| 227 | PAN-797 | M | medium | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 228 | PAN-810 | M | medium | stale |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 229 | PAN-832 | M | medium | needs-refinement |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 230 | PAN-833 | M | medium | stale |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 231 | PAN-853 | M | medium | stale |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 232 | PAN-886 | M | medium | stale |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 233 | PAN-898 | M | medium | stale |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 234 | PAN-900 | M | medium | stale |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 235 | PAN-908 | M | medium | stale |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 236 | PAN-927 | M | medium | needs-refinement |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 237 | PAN-932 | M | medium | stale |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 238 | PAN-933 | M | medium | stale |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 239 | PAN-943 | M | medium | stale |  |  | Add memory file review and management command |
| 240 | PAN-944 | M | medium | stale |  |  | Make vBRIEF the durable task graph source of truth |
| 241 | PAN-961 | M | medium | stale |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 242 | PAN-962 | M | medium | stale |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 243 | PAN-984 | M | medium | stale |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 244 | PAN-1027 | M | medium | stale |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 245 | PAN-1049 | M | medium | stale |  |  | Spike: evaluate Tauri v2 desktop shell |
| 246 | PAN-1051 | M | medium | stale |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 247 | PAN-1063 | M | medium | stale |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 248 | PAN-1064 | M | medium | stale |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 249 | PAN-1065 | M | medium | stale |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 250 | PAN-1066 | M | medium | needs-refinement |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 251 | PAN-1068 | M | medium | stale |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 252 | PAN-1113 | M | medium | stale |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 253 | PAN-1116 | M | medium | stale |  |  | Memory: cross-project search mode |
| 254 | PAN-1117 | M | medium | stale |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 255 | PAN-1121 | M | medium | stale |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 256 | PAN-1123 | M | medium | stale |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 257 | PAN-1124 | M | medium | needs-refinement |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 258 | PAN-1126 | M | medium | needs-refinement |  |  | Integrate TLDR summaries into review context manifest |
| 259 | PAN-1128 | M | medium | stale |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 260 | PAN-1129 | M | medium | stale |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 261 | PAN-1133 | M | medium | stale |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 262 | PAN-1135 | M | medium | stale |  |  | Document the hook system in docs/HOOKS.md |
| 263 | PAN-1136 | M | medium | stale |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 264 | PAN-1149 | M | medium | stale |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 265 | PAN-1150 | M | medium | stale |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 266 | PAN-1152 | M | medium | stale |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 267 | PAN-1153 | M | medium | stale |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 268 | PAN-1154 | M | medium | stale |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 269 | PAN-1166 | M | medium | needs-refinement |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 270 | PAN-1173 | M | medium | needs-refinement |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 271 | PAN-1208 | M | medium | stale |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 272 | PAN-1222 | M | medium | stale |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 273 | PAN-1226 | M | medium | needs-refinement |  |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 274 | PAN-1227 | M | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 275 | PAN-1240 | M | medium | needs-refinement |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 276 | PAN-1242 | M | medium | needs-refinement |  |  | Create a new issue directly from a kanban column |
| 277 | PAN-1244 | M | medium | needs-refinement |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 278 | PAN-1245 | M | medium | needs-refinement |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 279 | PAN-1325 | M | medium | needs-refinement |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 280 | PAN-1330 | M | medium | needs-refinement |  |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 281 | PAN-1356 | M | medium | needs-refinement |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 282 | PAN-1392 | M | medium | needs-refinement |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 283 | PAN-1433 | M | medium | needs-refinement |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 284 | PAN-1436 | M | medium | needs-refinement |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 285 | PAN-1438 | M | medium | needs-refinement |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 286 | PAN-1440 | M | medium | needs-refinement |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 287 | PAN-1444 | M | medium | needs-refinement |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 288 | PAN-1445 | M | medium | needs-refinement |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 289 | PAN-1446 | M | medium | needs-refinement |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 290 | PAN-1449 | M | medium | needs-refinement |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 291 | PAN-1461 | M | medium | needs-refinement |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 292 | PAN-1474 | M | medium | needs-refinement |  |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 293 | PAN-1479 | M | medium | needs-refinement |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 294 | PAN-1480 | M | medium | needs-refinement |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 295 | PAN-1481 | M | medium | needs-refinement |  |  | Add cost-event telemetry for Caveman token savings |
| 296 | PAN-1482 | M | medium | needs-refinement |  |  | Token spend report should aggregate data from repo, not just local machine |
| 297 | PAN-1483 | M | medium | needs-refinement |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 298 | PAN-1533 | M | medium | needs-refinement |  |  | Fork-into-worktree from conversation branch chip |
| 299 | PAN-1550 | M | medium | needs-refinement |  |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 300 | PAN-1552 | M | medium | needs-refinement |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 301 | PAN-1553 | M | medium | needs-refinement |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 302 | PAN-1565 | M | medium | needs-refinement |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 303 | PAN-1571 | M | medium | needs-refinement |  |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N lin... |
| 304 | PAN-1572 | M | medium | needs-refinement |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 305 | PAN-1581 | M | medium | needs-refinement |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 306 | PAN-1592 | M | medium | needs-refinement |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 307 | PAN-1624 | M | medium | needs-refinement |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 308 | PAN-1627 | M | medium | needs-refinement |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr... |
| 309 | PAN-1640 | M | medium | needs-refinement |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 310 | PAN-1641 | M | medium | needs-refinement |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 311 | PAN-1643 | M | medium | needs-refinement |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 312 | PAN-1646 | M | medium | needs-refinement |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 313 | PAN-1667 | M | medium | needs-refinement |  |  | feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 314 | PAN-1668 | M | medium | needs-refinement |  |  | bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 315 | PAN-1669 | M | medium | needs-refinement |  |  | bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 316 | PAN-1673 | M | medium | needs-refinement |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 317 | PAN-1674 | M | medium | needs-refinement |  |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 318 | PAN-1683 | M | medium | needs-refinement |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling o... |
| 319 | PAN-1691 | M | medium | needs-refinement |  |  | feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 320 | PAN-1696 | M | medium | needs-refinement |  |  | Merge train becomes per-project — works without a Flywheel run, multi-project view |
| 321 | PAN-1710 | M | medium | needs-refinement |  |  | bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — serv... |
| 322 | PAN-1720 | M | medium | needs-refinement |  |  | bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 323 | PAN-1728 | M | medium | needs-refinement |  |  | bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 324 | PAN-1735 | M | medium | needs-refinement |  |  | feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 325 | PAN-1740 | M | medium | needs-refinement |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 326 | PAN-1748 | M | medium | needs-refinement |  |  | feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 327 | PAN-1750 | M | medium | needs-refinement |  |  | feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 328 | PAN-1751 | M | medium | needs-refinement |  |  | feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 329 | PAN-1754 | M | medium | needs-refinement |  |  | feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 330 | PAN-1755 | M | medium | needs-refinement |  |  | bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 331 | PAN-1758 | M | medium | needs-refinement |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 332 | PAN-1761 | M | medium | needs-refinement |  |  | bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ... |
| 333 | PAN-1769 | M | medium | needs-refinement |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil... |
| 334 | PAN-1773 | M | medium | needs-refinement |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 335 | PAN-1774 | M | medium | needs-refinement |  |  | bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 336 | PAN-1775 | M | medium | needs-refinement |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 337 | PAN-1782 | M | medium | needs-refinement |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 338 | PAN-1795 | M | medium | needs-refinement |  |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 339 | PAN-1816 | M | medium | needs-refinement |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + aut... |
| 340 | PAN-1828 | M | medium | needs-refinement |  |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 341 | PAN-1846 | M | medium | needs-refinement |  |  | bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 342 | PAN-1878 | M | medium | needs-refinement |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 343 | PAN-1895 | M | medium | needs-refinement |  |  | Spawn work agents from issue workspace slide-out |
| 344 | PAN-1906 | M | medium | needs-refinement |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 345 | PAN-1907 | M | medium | needs-refinement |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every... |
| 346 | PAN-1910 | M | medium | needs-refinement |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 347 | PAN-1912 | M | medium | needs-refinement |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 348 | PAN-1914 | M | medium | needs-refinement |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 349 | PAN-1918 | M | medium | needs-refinement |  |  | bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang sta... |
| 350 | PAN-1926 | M | medium | needs-refinement |  |  | feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 351 | PAN-1936 | M | medium | needs-refinement |  |  | Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 352 | PAN-1937 | M | medium | needs-refinement |  |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 353 | PAN-1949 | M | medium | needs-refinement |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 354 | PAN-1958 | M | medium | needs-refinement |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 355 | PAN-1980 | M | medium | needs-refinement |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 356 | PAN-1983 | M | medium | needs-refinement |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 357 | PAN-1984 | M | medium | needs-refinement |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 358 | PAN-1986 | M | medium | needs-refinement |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 359 | PAN-1988 | M | medium | needs-refinement |  |  | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 360 | PAN-1990 | M | medium | needs-refinement |  |  | First-class workspaces and projects with per-workspace memory |
| 361 | PAN-1999 | M | medium | needs-refinement |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 362 | PAN-2002 | M | medium | needs-refinement |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 363 | PAN-2005 | M | medium | needs-refinement |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 364 | PAN-2006 | M | medium | needs-refinement |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 365 | PAN-2008 | M | medium | needs-refinement |  |  | feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 366 | PAN-2046 | M | medium | needs-refinement |  |  | Conversation view does not surface terminal command responses |
| 367 | PAN-2067 | M | medium | needs-refinement |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 368 | PAN-2068 | M | medium | needs-refinement |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 369 | PAN-2070 | M | medium | needs-refinement |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 370 | PAN-2071 | M | medium | needs-refinement |  |  | docs: add user-facing page for the Hooks system |
| 371 | PAN-2073 | M | medium | needs-refinement |  |  | docs: add user-facing page for the Desktop App |
| 372 | PAN-2074 | M | medium | needs-refinement |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 373 | PAN-2082 | M | medium | needs-refinement |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 374 | PAN-2083 | M | medium | needs-refinement |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 375 | PAN-2084 | M | medium | needs-refinement |  |  | Auto-create lightweight conversation worktrees on project chats |
| 376 | PAN-2085 | M | medium | needs-refinement |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 377 | PAN-2091 | M | medium | needs-refinement |  |  | chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 378 | PAN-2195 | M | medium | needs-refinement |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 379 | PAN-2197 | M | medium | needs-refinement |  |  | bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 380 | PAN-2201 | M | medium | needs-refinement |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale la... |
| 381 | PAN-2210 | M | medium | needs-refinement |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 382 | PAN-2211 | M | medium | needs-refinement |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 383 | PAN-2212 | M | medium | needs-refinement |  |  | Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 384 | PAN-2213 | M | medium | needs-refinement |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 385 | PAN-2280 | M | medium | needs-refinement |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.) |
| 386 | PAN-2282 | M | medium | needs-refinement |  |  | Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 387 | PAN-2287 | M | medium | needs-refinement |  |  | bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file |
| 388 | PAN-2308 | M | medium | needs-refinement |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal... |
| 389 | PAN-2343 | M | medium | needs-refinement |  |  | docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 390 | PAN-2344 | M | medium | needs-refinement |  |  | docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 391 | PAN-2345 | M | medium | needs-refinement |  |  | docs: refresh pan-done.md — update, harden, make useful |
| 392 | PAN-2346 | M | medium | needs-refinement |  |  | docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 393 | PAN-2347 | M | medium | needs-refinement |  |  | docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 394 | PAN-2348 | M | medium | needs-refinement |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 395 | PAN-2350 | M | medium | needs-refinement |  |  | Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone |
| 396 | PAN-2351 | M | medium | needs-refinement |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 397 | PAN-2352 | M | medium | needs-refinement |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 398 | PAN-2353 | M | medium | needs-refinement |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 399 | PAN-2354 | M | medium | needs-refinement |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 400 | PAN-2356 | M | medium | needs-refinement |  |  | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 401 | PAN-2355 | M | medium | needs-refinement |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 402 | PAN-2381 | M | medium | needs-refinement |  |  | bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 403 | PAN-2390 | M | medium | needs-refinement |  |  | systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid o... |
| 404 | PAN-2392 | M | medium | needs-refinement |  |  | feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 405 | PAN-2394 | M | medium | needs-refinement |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 406 | PAN-2395 | M | medium | needs-refinement |  |  | bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversa... |
| 407 | PAN-2399 | M | medium | needs-refinement |  |  | feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 408 | PAN-2406 | M | medium | needs-refinement |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree ... |
| 409 | PAN-2408 | M | medium | needs-refinement |  |  | bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-w... |
| 410 | PAN-2409 | M | medium | needs-refinement |  |  | feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-... |
| 411 | PAN-2414 | M | medium | needs-refinement |  |  | bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotati... |
| 412 | PAN-2416 | M | medium | needs-refinement |  |  | bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively |
| 413 | PAN-2422 | M | medium | needs-refinement |  |  | bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 414 | PAN-2423 | M | medium | needs-refinement |  |  | bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification cont... |
| 415 | PAN-2424 | M | medium | needs-refinement |  |  | Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remo... |
| 416 | PAN-2428 | M | medium | needs-refinement |  |  | bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label ... |
| 417 | PAN-2442 | M | medium | needs-refinement |  |  | feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and pro... |
| 418 | PAN-2443 | M | medium | needs-refinement |  |  | feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot ado... |
| 419 | PAN-2444 | M | medium | needs-refinement |  |  | feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 420 | PAN-2449 | M | medium | needs-refinement |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 421 | PAN-2454 | M | medium | needs-refinement |  |  | bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches |
| 422 | PAN-2465 | M | medium | needs-refinement |  |  | bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero |
| 423 | PAN-2469 | M | medium | needs-refinement |  |  | feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN... |
| 424 | PAN-2484 | M | medium | needs-refinement |  |  | fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rul... |
| 425 | PAN-2487 | M | medium | needs-refinement |  |  | feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 426 | PAN-2489 | M | medium | needs-refinement |  |  | bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 427 | PAN-2491 | M | medium | needs-refinement |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 428 | PAN-2492 | M | medium | needs-refinement |  |  | bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only... |
| 429 | PAN-2493 | M | medium | needs-refinement |  |  | feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 430 | PAN-2501 | M | medium | needs-refinement |  |  | bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboar... |
| 431 | PAN-2504 | M | medium | needs-refinement |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 432 | PAN-2505 | M | medium | needs-refinement |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 433 | PAN-2506 | M | medium | needs-refinement |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 434 | PAN-2507 | M | medium | needs-refinement |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 435 | PAN-2514 | M | medium | needs-refinement |  |  | Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 436 | PAN-2526 | M | medium | needs-refinement |  |  | Refactor deacon.ts below file-size baseline |
| 437 | PAN-2527 | M | medium | needs-refinement |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 438 | PAN-2533 | M | medium | needs-refinement |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 439 | PAN-2549 | M | medium | needs-refinement |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 440 | PAN-2560 | M | medium | needs-refinement |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall b... |
| 441 | PAN-2572 | M | medium | needs-refinement |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 442 | PAN-2600 | M | medium | needs-refinement |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 443 | PAN-2622 | M | medium | needs-refinement |  |  | cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 444 | PAN-2625 | M | medium | needs-refinement |  |  | feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 445 | PAN-2626 | M | medium | needs-refinement |  |  | feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 446 | PAN-2629 | M | medium | needs-refinement |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 447 | PAN-2628 | M | medium | needs-refinement |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 448 | PAN-2630 | M | medium | needs-refinement |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 449 | PAN-2635 | M | medium | needs-refinement |  |  | chore(server): pay down the 152-error src/dashboard/server typecheck debt |
| 450 | PAN-2645 | M | medium | needs-refinement |  |  | Add opt-in Observation-first conversation view |
| 451 | PAN-2651 | M | medium | needs-refinement |  |  | fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset |
| 452 | PAN-2652 | M | medium | needs-refinement |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso... |
| 453 | PAN-2660 | M | medium | needs-refinement |  |  | Add safe Reset to planned action to the issue actions menu |
| 454 | PAN-2662 | M | medium | needs-refinement |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 455 | PAN-2667 | M | medium | needs-refinement |  |  | Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 456 | PAN-2668 | M | medium | needs-refinement |  |  | Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery |
| 457 | PAN-2678 | M | medium | needs-refinement |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 458 | PAN-2679 | M | medium | needs-refinement |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 459 | PAN-2680 | M | medium | needs-refinement |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 460 | PAN-2754 | M | medium | needs-refinement |  |  | bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 461 | PAN-2755 | M | medium | needs-refinement |  |  | bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 462 | PAN-2767 | M | medium | needs-refinement |  |  | Expose Codex app-server conversation controls in the dashboard |
| 463 | PAN-2796 | M | medium | needs-refinement |  |  | fix(cloister): idle nudge must not advance after failed mandatory inspection |
| 464 | PAN-2806 | M | medium | needs-refinement |  |  | bug(cloister): strike merge trigger registry splits across dashboard chunks |
| 465 | PAN-2809 | M | medium | needs-refinement |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 466 | PAN-2810 | M | medium | needs-refinement |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 467 | PAN-2813 | M | medium | needs-refinement |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 468 | PAN-2817 | M | medium | needs-refinement |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 469 | PAN-2836 | M | medium | needs-refinement |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 470 | PAN-2850 | M | medium | needs-refinement |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 471 | PAN-2868 | M | medium | needs-refinement |  |  | Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized |
| 472 | PAN-2874 | M | medium | needs-refinement |  |  | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli... |
| 473 | PAN-2880 | M | medium | needs-refinement |  |  | Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget |
| 474 | PAN-2882 | M | medium | needs-refinement |  |  | Pipeline membership has no GitLab merged-MR oracle — squash-merged GitLab branches show as unmerged (false planned_backlog rows, mislab... |
| 475 | PAN-2883 | M | medium | needs-refinement |  |  | Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs |
| 476 | PAN-2886 | M | medium | needs-refinement |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 477 | PAN-2936 | M | medium | needs-refinement |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 478 | PAN-2937 | M | medium | needs-refinement |  |  | Board right-click context menu can close when live data ticks re-render the card |
| 479 | PAN-2941 | M | medium | needs-refinement |  |  | OKF v3 — lease-based writes and advisory semantic auditor |
| 480 | PAN-2945 | M | medium | needs-refinement |  |  | fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 481 | PAN-2947 | M | medium | needs-refinement |  |  | testing 1 2 3 |
| 482 | PAN-2949 | M | medium | needs-refinement |  |  | Test issue — discuss-then-file flow smoke test |
| 483 | PAN-2950 | M | medium | needs-refinement |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 484 | PAN-52 | M | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 485 | PAN-190 | M | low | needs-refinement |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 486 | PAN-471 | M | low | needs-refinement |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 487 | PAN-591 | M | low | stale |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 488 | PAN-603 | M | low | needs-refinement |  |  | Plan review loop with configurable reviewer model |
| 489 | PAN-658 | M | low | needs-refinement |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 490 | PAN-709 | M | low | stale |  |  | feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 491 | PAN-749 | M | low | stale |  |  | Research and borrow best features from gstack |
| 492 | PAN-771 | M | low | stale |  |  | Investigate Vercel Sandbox execution backend support |
| 493 | PAN-774 | M | low | needs-refinement |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 494 | PAN-777 | M | low | stale |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 495 | PAN-778 | M | low | stale |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 496 | PAN-786 | M | low | stale |  |  | Post planning Q\&A answers as issue comment |
| 497 | PAN-790 | M | low | stale |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 498 | PAN-791 | M | low | stale |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 499 | PAN-793 | M | low | stale |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 500 | PAN-243 | M | low | needs-refinement |  |  | Audit dashboard actions: ensure all are available via CLI |
| 501 | PAN-607 | M | low | stale |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 502 | PAN-654 | M | low | needs-refinement |  |  | Project Setup Wizard — Dashboard UI |
| 503 | PAN-818 | M | low | stale |  |  | Make summary optional when forking conversations |
| 504 | PAN-901 | M | low | stale |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 505 | PAN-902 | M | low | stale |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 506 | PAN-903 | M | low | stale |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 507 | PAN-938 | M | low | stale |  |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 508 | PAN-949 | M | low | stale |  |  | feat: add conversation for project from sidebar |
| 509 | PAN-958 | M | low | stale |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 510 | PAN-1037 | M | low | stale |  |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 511 | PAN-1060 | M | low | stale |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 512 | PAN-1151 | M | low | stale |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 513 | PAN-1432 | M | low | needs-refinement |  |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 514 | PAN-1437 | M | low | needs-refinement |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 515 | PAN-1442 | M | low | needs-refinement |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 516 | PAN-1443 | M | low | needs-refinement |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 517 | PAN-1469 | M | low | needs-refinement |  |  | End-to-end review and consolidation of all project documentation |
| 518 | PAN-1473 | M | low | needs-refinement |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 519 | PAN-1485 | M | low | needs-refinement |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 520 | PAN-1490 | M | low | needs-refinement |  |  | feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 521 | PAN-1524 | M | low | needs-refinement |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 522 | PAN-1542 | M | low | needs-refinement |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 523 | PAN-1545 | M | low | needs-refinement |  |  | feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 524 | PAN-1623 | M | low | needs-refinement |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 525 | PAN-1653 | M | low | needs-refinement |  |  | perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 526 | PAN-1654 | M | low | needs-refinement |  |  | perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 527 | PAN-1655 | M | low | needs-refinement |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 528 | PAN-1656 | M | low | needs-refinement |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 529 | PAN-1657 | M | low | needs-refinement |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 530 | PAN-1672 | M | low | needs-refinement |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 531 | PAN-1676 | M | low | needs-refinement |  |  | feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 532 | PAN-1684 | M | low | needs-refinement |  |  | docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 533 | PAN-1685 | M | low | needs-refinement |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 534 | PAN-1837 | M | low | needs-refinement |  |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 535 | PAN-1839 | M | low | needs-refinement |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 536 | PAN-1840 | M | low | needs-refinement |  |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 537 | PAN-1844 | M | low | needs-refinement |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 538 | PAN-1852 | M | low | needs-refinement |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 539 | PAN-1853 | M | low | needs-refinement |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 540 | PAN-1854 | M | low | needs-refinement |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 541 | PAN-1916 | M | low | needs-refinement |  |  | feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 542 | PAN-1965 | M | low | needs-refinement |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 543 | PAN-1967 | M | low | needs-refinement |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 544 | PAN-1968 | M | low | needs-refinement |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 545 | PAN-537 | M | low | stale |  |  | feat: show changed files diff summary after each agent response in activity view |
| 546 | PAN-646 | M | low | stale |  |  | Canceled issues: add guided Recover workflow |
| 547 | PAN-700 | M | low | stale |  |  | Detachable terminal for conversation view — popout into OS window |
| 548 | PAN-713 | M | low | stale |  |  | test: add unit tests for doneCommand and approveCommand |
| 549 | PAN-630 | M | low | stale |  |  | Multi-tenant workspace isolation with ACLs |
| 550 | PAN-244 | M | low | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 551 | PAN-245 | M | low | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 552 | PAN-247 | M | low | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 553 | PAN-304 | M | low | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 554 | PAN-324 | M | low | stale |  |  | Agent detail pane missing Merge/Approve button |
| 555 | PAN-334 | M | low | stale |  |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 556 | PAN-681 | M | low | stale |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 557 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 558 | PAN-227 | M | low | stale |  |  | Phase gate validation — mid-implementation acceptance checks |
| 559 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 560 | PAN-241 | M | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 561 | PAN-249 | M | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 562 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 563 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 564 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 565 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 566 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 567 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 568 | PAN-407 | M | low | stale |  |  | Run Panopticon from a main workspace for development isolation |
| 569 | PAN-438 | M | low | stale |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 570 | PAN-459 | M | low | stale |  |  | Planning setup screen with SSE progress streaming |
| 571 | PAN-461 | M | low | stale |  |  | Deep-wipe multi-step progress dialog |
| 572 | PAN-468 | M | low | stale |  |  | Agent test conversations pollute production database — need test isolation |
| 573 | PAN-476 | M | low | stale |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 574 | PAN-480 | M | low | stale |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 575 | PAN-483 | M | low | stale |  |  | Unify Resume Agent UX — all entry points should show message input |
| 576 | PAN-543 | M | low | stale |  |  | Add confirmation dialog before applying Optimal Defaults |
| 577 | PAN-554 | M | low | stale |  |  | Add kanban board deeplinks for issue URLs |
| 578 | PAN-564 | M | low | stale |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 579 | PAN-565 | M | low | stale |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 580 | PAN-568 | M | low | stale |  |  | Kanban: Show workspace and tmux session counts in stats |
| 581 | PAN-570 | M | low | stale |  |  | Show PLAN badge on costs when under a subscription/plan |
| 582 | PAN-571 | M | low | stale |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 583 | PAN-576 | M | low | stale |  |  | Global / search should include conversations in addition to workspace features |
| 584 | PAN-589 | M | low | stale |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 585 | PAN-604 | M | low | stale |  |  | Hide planning agent from workspace detail pane |
| 586 | PAN-622 | M | low | stale |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 587 | PAN-623 | M | low | stale |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 588 | PAN-624 | M | low | stale |  |  | Loop nodes: iterative agent execution with conditional termination |
| 589 | PAN-633 | M | low | stale |  |  | Update Cloister PRD and docs index — stale relative to implementation |
| 590 | PAN-634 | M | low | stale |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 591 | PAN-660 | M | low | stale |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 592 | PAN-663 | M | low | stale |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 593 | PAN-674 | M | low | stale |  |  | docs: add glossary of Panopticon domain terms |
| 594 | PAN-701 | M | low | stale |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 595 | PAN-702 | M | low | stale |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 596 | PAN-727 | M | low | stale |  |  | Fix orphaned work-agent start handoff after planning |
| 597 | PAN-2066 | M | high | needs-refinement |  |  | OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page |
| 597 | PAN-730 | M | low | stale |  |  | Add provider account telemetry for credits, balances, and usage |
| 598 | PAN-735 | M | low | stale |  |  | Settings page: review and configure overridden subagent model files |
| 599 | PAN-736 | M | low | stale |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 600 | PAN-738 | M | low | stale |  |  | Add right-click fork option to conversation list |
| 601 | PAN-743 | M | low | stale |  |  | Add consistent new conversation icon actions in Command Deck |
| 602 | PAN-747 | M | low | stale |  |  | Conversation list items lack accessible labels in accessibility tree |
| 603 | PAN-750 | M | low | stale |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 604 | PAN-751 | M | low | stale |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 605 | PAN-752 | M | low | stale |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 606 | PAN-762 | M | low | stale |  |  | Settings: warn when model overrides target disabled providers |
| 607 | PAN-764 | M | low | stale |  |  | Add quota/usage inspector for routed model providers |
| 608 | PAN-765 | M | low | stale |  |  | Preserve trailing zeros in cost displays |
| 609 | PAN-769 | M | low | stale |  |  | Track verification/review/test phase churn over time |
| 610 | PAN-772 | M | low | stale |  |  | Unify terminal stack behavior across tmux sessions |
| 611 | PAN-773 | M | low | stale |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 612 | PAN-775 | M | low | stale |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 613 | PAN-77 | M | low | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 614 | PAN-252 | M | low | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 615 | PAN-255 | M | low | stale |  |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 616 | PAN-258 | M | low | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 617 | PAN-277 | M | low | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 618 | PAN-293 | M | low | stale |  |  | Project Living Memory — per-project semantic memory for agents |
| 619 | PAN-294 | M | low | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 620 | PAN-450 | M | low | stale |  |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 621 | PAN-452 | M | low | stale |  |  | Conversation input bar — mode/permissions/workspace selectors |
| 622 | PAN-463 | M | low | stale |  |  | Add Qwen 3.6+ model support |
| 623 | PAN-465 | M | low | stale |  |  | Add OpenRouter as a model provider |
| 624 | PAN-466 | M | low | stale |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 625 | PAN-531 | M | low | stale |  |  | PAN: Windows Electron support (WSL2 required) |
| 626 | PAN-546 | M | low | stale |  |  | Remove claude-code-router — all providers use direct env var injection |
| 627 | PAN-548 | M | low | stale |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 628 | PAN-606 | M | low | stale |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 629 | PAN-613 | M | low | stale |  |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 630 | PAN-629 | M | low | stale |  |  | Workspace quotas and resource governance |
| 631 | PAN-637 | M | low | stale |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 632 | PAN-649 | M | low | stale |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 633 | PAN-675 | M | low | stale |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 634 | PAN-678 | M | low | stale |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 635 | PAN-687 | M | low | stale |  |  | Support OpenCode as alternative coding agent |
| 636 | PAN-49 | M | low | stale |  |  | Fix CloisterService tests that require real runtime |
| 637 | PAN-113 | M | low | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 638 | PAN-37 | M | low | stale |  |  | Support external PR selection for merge-agent |
| 639 | PAN-38 | M | low | stale |  |  | Support multiple merge agents per repository |
| 640 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 641 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 642 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 643 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 644 | PAN-54 | M | low | stale |  |  | feat: Add pan test:e2e command for full workflow integration test |
| 645 | PAN-106 | M | low | stale |  |  | Cost prediction/estimation for in-progress work |
| 646 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 647 | PAN-155 | M | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 648 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 649 | PAN-176 | M | low | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 650 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 651 | PAN-178 | M | low | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 652 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 653 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |

## Rationale detail

### PAN-2951 (rank 1)

In-pipeline, blocks-main. Red `test` check on main inherited by every feature PR, gating all shipping until green.

### PAN-2858 (rank 1)

Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.

### PAN-2940 (rank 2)

Systemic fix for the red-main class: conversations push multi-commit refactors to main bypassing PR CI. A pre-merge gate prevents the recurring outage.

### PAN-2746 (rank 3)

Escape hatch that fires WHEN review infra is broken wrote the same value as four reviewers approving. The bug authorizes its own blocker — highest-severity integrity forge.

### PAN-2495 (rank 5)

Merge path that can skip CI-green admitted a red-main change. Closing the skip so a red REQUIRED check can never be skipped is load-bearing.

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2820 (rank 6)

Main was undeployable — boot hung before binding :3011. Open issue + rollback indicate an unowned boot-path regression that must be verified closed.

### PAN-2952 (rank 7)

Three stores held three answers; the reviewer's 'passed' was silently lost and the issue jammed at 'reviewing'. Re-entrant lock + versioned reconcile fixes the race.

### PAN-2876 (rank 7)

When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.

### PAN-2838 (rank 7)

In-progress UI polish; pinned.

### PAN-2948 (rank 8)

For polyrepo projects review diffs the wrapper repo (changedFiles: []) and re-review pushes fail, so blocked verdicts go permanently stale.

### PAN-2689 (rank 9)

Reviewer printed 'Review passed' but verdict landed nowhere — both DB (readonly) and journal (killed at exit) writes lost. Drain pending writes before exit.

### PAN-2932 (rank 10)

Wedge left a zombie half-booted server for 6 min of 502; same build booted clean after. Stale dist chunks + reload-rebuild race is the suspect.

### PAN-2935 (rank 11)

Two containers with identical Traefik labels round-robined to an unreachable backend, making the MYN workspace half-broken.

### PAN-2905 (rank 12)

Persistent 50% CPU at idle keeps every endpoint slow and drives the watchdog restart churn behind every cold-cache complaint.

### PAN-807 (rank 13)

Spawn hard-reset the branch to a 2-day-old commit then committed planning artifacts — a loaded gun if an agent hadn't pushed. Pre-flight safety checks.

### PAN-2954 (rank 14)

For GitLab projects post-merge steps never execute: no teardown (containers stay up), no labels, and the refusal falsely logs 'completed'.

### PAN-2599 (rank 14)

Planned/in-progress analytics integration; pinned.

### PAN-2695 (rank 15)

Two dispatches 225ms apart: B resumed A's booting session and the synthesis kickoff died — review stalled forever. A promise coalescer fixes it.

### PAN-1711 (rank 16)

15-25s event-loop blocks trigger repeated watchdog restarts (each ~15s of 502). Root-cause the sync-fs/JSON-on-request-path stall.

### PAN-2639 (rank 17)

A codex session created before a token refresh bakes in a now-revoked token; resume replays it and every reviewer 401s silently.

### PAN-2792 (rank 18)

pan close teardown killed the dashboard via mmap'd pty.node inodes. Core fix landed; remaining work is deploy confirmation + audit of other lsof kill lists.

### PAN-2775 (rank 19)

sessionExistsSync returns false on ANY exec failure, so boot-load EAGAIN reads as 'session missing' and mass-kills live agents.

### PAN-2742 (rank 20)

Convoy synthesized a blocking CHANGES REQUESTED 35s after a clean report landed. PAN-2710 hit cycle 9 partly from this.

### PAN-2706 (rank 21)

A booted-but-never-kicked-off test session permanently absorbs every dispatch; the issue hangs in 'testing' forever.

### PAN-2734 (rank 22)

Every boot re-triggers a merge for an issue closed 11 days ago (294 occurrences). The only removal path requires a merge through the queue.

### PAN-2921 (rank 23)

After a transport error the recovery path didn't reconcile that the head was already on main, merging a second empty PR.

### PAN-2664 (rank 24)

syncMainIntoWorkspace staged conflict-marker files and committed an unfinished merge, then reported a clean tree. Must fail closed on MERGE_HEAD.

### PAN-2946 (rank 25)

Every patrol throws on a null-lastActivity record, spamming logs and silently skipping first-completion detection. Guard the read + test.

### PAN-2769 (rank 26)

Closed issues keep in-flight review_status forever; those rows feed operator counts so the dashboard reports finished work as in the pipeline.

### PAN-2888 (rank 27)

'troubled: 14-16' is chronically inflated by residue on CLOSED issues (real count 0), eroding trust and masking genuine stalls.

### PAN-2846 (rank 28)

After merge the agent's tmux session ends but state stays 'running', blocking the DoD post-merge row on an already-dead agent.

### PAN-2839 (rank 29)

Spawn POST now fails HTTP 500 nondeterministically: same call leaves a working agent on 3 issues but a dead half-spawn on 2.

### PAN-2569 (rank 30)

complete-planning → start-agent handoff silently no-ops: plan fine, but no agent state.json/tmux. In an unattended flywheel the issue strands indefinitely.

### PAN-2691 (rank 31)

Fresh workspaces are created without their Docker stack, but the spawn gate requires one; complete-planning treats the 422 as terminal.

### PAN-2451 (rank 32)

Pipeline-generated commits produce messages that fail the commit-msg gate, leaving a working agent with a non-pushable 108-commit branch and no recovery.

### PAN-2516 (rank 33)

pan close/start update the spec mirror but never commit it, so main's spec disagrees with the record AND the dirty tree wedges the flywheel's pull/push.

### PAN-2824 (rank 34)

CLI path re-throws the first per-project error, so one bad project kills `pan review pending` for every project including overdeck.

### PAN-2550 (rank 35)

Runner exits 0 while reporting 31 failures, so a red suite reads as green — the class that lets broken code through into red-mains.

### PAN-2558 (rank 36)

Migration command hardcodes project.path (non-git root for MyN), so pipeline state lives on local disk only. resolveInfraRepo already does the right resolution.

### PAN-2733 (rank 37)

Poller aborts every cycle because it searches for a nonexistent GitHub user derived from the git commit author.

### PAN-2650 (rank 39)

Final slot's verify+merge never fires because the governor shed the still-needed stack; recover only covers failed-merge, not a stuck ready-to-merge.

### PAN-2895 (rank 40)

In-pipeline. Resume retries a missing JSONL instead of falling back to a fresh session, dead-ending every crash/reboot recovery path.

### PAN-2075 (rank 42)

Replaces silent all-or-nothing 'Resume all' with an informed per-agent decision across local + remote. High aggregate impact across 11 open children.

### PAN-1915 (rank 43)

config.yaml carries every provider key + tracker creds; chmod fix closed the world-readable hole but keychain + startup perm-check remain.

### PAN-2828 (rank 44)

Landing verification uses an ancestry check squash-merge structurally cannot satisfy, refusing every correctly-landed strike.

### PAN-2079 (rank 45)

Keystone child of PAN-2075. A durable queue every scattered notification surface should post to instead of inventing another.

### PAN-2738 (rank 46)

Codex's reviewer over-generalizes 'history rewriting forbidden' to deny the standard `git rebase origin/main` sync on an unpushed branch.

### PAN-2908 (rank 48)

Default UI exposes all machinery and answers none of a new user's three questions. Progressive-disclosure overhaul with binding mockups.

### PAN-2377 (rank 49)

substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.

### PAN-1868 (rank 49)

Keystone of the cost epic and the ONE guard permitted to pause agents. An agent burned $22.33 in a 400-retry loop before a human noticed.

### PAN-2749 (rank 50)

After resume, in-process timers/monitors/workers aren't reconstructed, so a resumed agent looks alive but its machinery is dead.

### PAN-2922 (rank 51)

Overlapping timers, fallbacks, caches, pollers independently rediscover the same facts. Each concern needs one owner/policy/transition.

### PAN-2430 (rank 52)

Pre-existing unused-local errors block the typecheck gate for any frontend-touching issue, slowing verification.

### PAN-2758 (rank 53)

A 'model at capacity' error fails the turn with willRetry=false and the agent goes idle while recorded status=running. Silent dead-on-arrival.

### PAN-2830 (rank 54)

Overdeck auto-migrates every project onto overdeck-state and pushes to origin without asking. Opt-in is foundational to multi-machine direction.

### PAN-2642 (rank 55)

Retires invented $10/$25/$100 limits and lands the one real guard (PAN-1868). Makes headline dollars honest.

### PAN-2421 (rank 56)

Route tests flake specifically under full-suite load, producing unreliable verification verdicts.

### PAN-2747 (rank 57)

After reboot the run gate is left active/dead-session; the only reachable control silently aborts instead of resuming.

### PAN-2077 (rank 58)

Backend for dashboard + CLI: every agent in state but not verified-running, across local AND remote. A spending remote machine is the high-priority case.

### PAN-2593 (rank 59)

Spawned children inherit a bare PATH, so verification gates invoking npm can resolve against the wrong environment and fail spuriously.

### PAN-2467 (rank 60)

For polyrepo projects the train completes one sub-repo and strands siblings, leaving the issue half-merged. Affects MYN shipping.

### PAN-2759 (rank 61)

A dead orchestrator with an active run wasn't auto-relaunched post-reboot; combined with PAN-2747 a reboot silently halts the pipeline.

### PAN-2837 (rank 62)

First new data domain that only makes sense once the branch is shared: 'is anything working on this issue, and where?' from any machine.

### PAN-1666 (rank 63)

Unfreezing the deacon thundering-herded 37 agents at once (load 5→52). Throttle + on-demand specialists + deadlock-safe slot manager.

### PAN-2763 (rank 64)

Workspace node_modules symlinked to the primary repo breaks test resolution and couples workspace tests to the host tree.

### PAN-1435 (rank 65)

The plaintext-storage root concern PAN-1915 builds on; keychain migration is the durable fix.

### PAN-2511 (rank 66)

Work agents run the full suite locally (EPERM on git tests) then burn 20+ min on false failures. The verification gate owns full-suite.

### PAN-2466 (rank 67)

Close-out rewrites just-closed records with empty usage maps, destroying the per-issue cost data the cost-visibility program builds.

### PAN-2699 (rank 68)

Build regenerates a committed bundle, so every workspace build dirties the tree and fights commits.

### PAN-2059 (rank 69)

Inserts a review beat between 'a plan exists' and 'go work it'; lets the planning AI refuse bad work as a reviewable objection. Binding mockups committed.

### PAN-2717 (rank 71)

Permission waits don't surface in Awareness, so an agent blocked on operator input sits invisible.

### PAN-578 (rank 72)

Tracker comments are an untrusted input surface feeding agents; a mediation layer is the structural defense.

### PAN-2580 (rank 73)

pan tell can't deliver to codex conversations, so the sanctioned agent-message path silently fails for half the harnesses.

### PAN-2078 (rank 74)

pan up is frequently headless; the same reconciliation decision must be CLI-actionable.

### PAN-2546 (rank 76)

Misclassifies live codex sessions as zombies, compounding PAN-2580's delivery failure with false liveness reports.

### PAN-2805 (rank 78)

UI shows no active run while the API returns a live one, so the operator believes the flywheel is idle while it's working.

### PAN-2080 (rank 79)

Fast-follow after the inbox spine: reach the operator out-of-band so a held fleet or runaway spend pings them.

### PAN-2802 (rank 80)

A needs-you landing can't re-arm when the strike head is unchanged, so a re-dispatched strike with no new commits can't progress.

### PAN-1556 (rank 81)

Child of PAN-1666. Re-reviews should coalesce onto the in-flight convoy rather than re-spawning.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-20T06:50:14Z",
  "model": "glm-5.2",
  "pass": "incremental",
  "openCount": 653,
  "nodes": [
    {
      "issue": "PAN-2951",
      "rank": 1,
      "size": "S",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main: review-reset.test.ts fails at fb1dc3f36f; blocks every feature PR's `test` check.",
      "rationale": "In-pipeline, blocks-main. Red `test` check on main inherited by every feature PR, gating all shipping until green.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Three red-mains in one day from direct main pushes; needs a pre-merge CI surface for conversation series.",
      "rationale": "Systemic fix for the red-main class: conversations push multi-commit refactors to main bypassing PR CI. A pre-merge gate prevents the recurring outage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 3,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Infra-failure bypass writes reviewStatus='passed' — indistinguishable from real approval; nearly merged a pipeline change unreviewed.",
      "rationale": "Escape hatch that fires WHEN review infra is broken wrote the same value as four reviewers approving. The bug authorizes its own blocker — highest-severity integrity forge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2495",
      "rank": 5,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "ci-green merge skip let a red required `test` check land on main — gate bypassing its own precondition.",
      "rationale": "Merge path that can skip CI-green admitted a red-main change. Closing the skip so a red REQUIRED check can never be skipped is load-bearing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2820",
      "rank": 6,
      "size": "L",
      "importance": "critical",
      "score": 90,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen; live server ran a rollback.",
      "rationale": "Main was undeployable — boot hung before binding :3011. Open issue + rollback indicate an unowned boot-path regression that must be verified closed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2952",
      "rank": 7,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [
        "PAN-2948"
      ],
      "why": "Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB.",
      "rationale": "Three stores held three answers; the reviewer's 'passed' was silently lost and the issue jammed at 'reviewing'. Re-entrant lock + versioned reconcile fixes the race.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2948",
      "rank": 8,
      "size": "L",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review pipeline is polyrepo-blind: empty context manifest, wrapper-repo push failures, stale verdicts (MYN).",
      "rationale": "For polyrepo projects review diffs the wrapper repo (changedFiles: []) and re-review pushes fail, so blocked verdicts go permanently stale.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 9,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex agents silently lost — fire-and-forget journal write dies with the CLI.",
      "rationale": "Reviewer printed 'Review passed' but verdict landed nowhere — both DB (readonly) and journal (killed at exit) writes lost. Drain pending writes before exit.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Intermittent boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload.",
      "rationale": "Wedge left a zombie half-booted server for 6 min of 502; same build booted clean after. Stale dist chunks + reload-rebuild race is the suspect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 11,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of workspace API calls 504.",
      "rationale": "Two containers with identical Traefik labels round-robined to an unreachable backend, making the MYN workspace half-broken.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s; profile and fix the residual burner.",
      "rationale": "Persistent 50% CPU at idle keeps every endpoint slow and drives the watchdog restart churn behind every cold-cache complaint.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 13,
      "size": "L",
      "importance": "critical",
      "score": 83,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic C: workspace state sanity on spawn — stop hard-reset-then-commit that can orphan unpushed work.",
      "rationale": "Spawn hard-reset the branch to a 2-day-old commit then committed planning artifacts — a loaded gun if an agent hadn't pushed. Pre-flight safety checks.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2954",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [
        "PAN-2948"
      ],
      "why": "postMergeLifecycle refuses GitLab projects — merge state can't be auto-verified, teardown/labels never run.",
      "rationale": "For GitLab projects post-merge steps never execute: no teardown (containers stay up), no labels, and the refusal falsely logs 'completed'.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 15,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume — second resumes a booting parent, killing the kickoff.",
      "rationale": "Two dispatches 225ms apart: B resumed A's booting session and the synthesis kickoff died — review stalled forever. A promise coalescer fixes it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 16,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard event-loop stalls under load cause 15-25s request blocks and watchdog force-restarts.",
      "rationale": "15-25s event-loop blocks trigger repeated watchdog restarts (each ~15s of 502). Root-cause the sync-fs/JSON-on-request-path stall.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2639",
      "rank": 17,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401, no verdict.",
      "rationale": "A codex session created before a token refresh bakes in a now-revoked token; resume replays it and every reviewer 401s silently.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 18,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard + live conversations via lsof +D over hardlinked node_modules (main fix landed).",
      "rationale": "pan close teardown killed the dashboard via mmap'd pty.node inodes. Core fix landed; remaining work is deploy confirmation + audit of other lsof kill lists.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 19,
      "size": "L",
      "importance": "high",
      "score": 77,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x).",
      "rationale": "sessionExistsSync returns false on ANY exec failure, so boot-load EAGAIN reads as 'session missing' and mass-kills live agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 20,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review synthesis fires 42s after spawn, reports reviewers with reports on disk as 'infra failure' — false CHANGES REQUESTED.",
      "rationale": "Convoy synthesized a blocking CHANGES REQUESTED 35s after a clean report landed. PAN-2710 hit cycle 9 partly from this.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 21,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch — never-kicked-off session reads as 'running', no prompt delivered.",
      "rationale": "A booted-but-never-kicked-off test session permanently absorbs every dispatch; the issue hangs in 'testing' forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 22,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers.",
      "rationale": "Every boot re-triggers a merge for an issue closed 11 days ago (294 occurrences). The only removal path requires a merge through the queue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 23,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door reports fetch failure after merge and lands the same head twice (empty second PR).",
      "rationale": "After a transport error the recovery path didn't reconcile that the head was already on main, merging a second empty PR.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "sync-main auto-commit completes an unresolved merge with conflict markers — clean tree built from marker files.",
      "rationale": "syncMainIntoWorkspace staged conflict-marker files and committed an unfinished merge, then reported a clean tree. Must fail closed on MERGE_HEAD.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2946",
      "rank": 25,
      "size": "S",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon crashes on null lastActivity in checkFirstCompletionAgents every patrol — first-completion detection skips that cycle.",
      "rationale": "Every patrol throws on a null-lastActivity record, spamming logs and silently skipping first-completion detection. Guard the read + test.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 26,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed.",
      "rationale": "Closed issues keep in-flight review_status forever; those rows feed operator counts so the dashboard reports finished work as in the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 27,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out leaves stale residue (orphaned inspect sub-agents + uncleared review_status) inflating troubled/failed metrics.",
      "rationale": "'troubled: 14-16' is chronically inflated by residue on CLOSED issues (real count 0), eroding trust and masking genuine stalls.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running.",
      "rationale": "After merge the agent's tmux session ends but state stays 'running', blocking the DoD post-merge row on an already-dead agent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 29,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with duplicated workspace prep — nondeterministic half-spawns.",
      "rationale": "Spawn POST now fails HTTP 500 nondeterministically: same call leaves a working agent on 3 issues but a dead half-spawn on 2.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning finalizes (issue→planned) but the work agent does not auto-spawn — silent handoff failure.",
      "rationale": "complete-planning → start-agent handoff silently no-ops: plan fine, but no agent state.json/tmux. In an unattended flywheel the issue strands indefinitely.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 31,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when post-finalize spawn is gated (stack-unhealthy 422) — no retry, no needs-you.",
      "rationale": "Fresh workspaces are created without their Docker stack, but the spawn gate requires one; complete-planning treats the 422 as terminal.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits).",
      "rationale": "Pipeline-generated commits produce messages that fail the commit-msg gate, leaving a working agent with a non-pushable 108-commit branch and no recovery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 33,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push loop.",
      "rationale": "pan close/start update the spec mirror but never commit it, so main's spec disagrees with the record AND the dirty tree wedges the flywheel's pull/push.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails (non-degrading caller).",
      "rationale": "CLI path re-throws the first per-project error, so one bad project kills `pan review pending` for every project including overdeck.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green.",
      "rationale": "Runner exits 0 while reporting 31 failures, so a red suite reads as green — the class that lets broken code through into red-mains.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 36,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo state-migration: MyN pipeline state tracked in NO git repo — standing data-loss risk.",
      "rationale": "Migration command hardcodes project.path (non-git root for MyN), so pipeline state lives on local disk only. resolveInfraRepo already does the right resolution.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 37,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls).",
      "rationale": "Poller aborts every cycle because it searches for a nonexistent GitHub user derived from the git commit author.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2650",
      "rank": 39,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; recover can't recover it.",
      "rationale": "Final slot's verify+merge never fires because the governor shed the still-needed stack; recover only covers failed-merge, not a stuck ready-to-merge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2895",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume path retries a session whose JSONL is missing instead of falling back to fresh — dead-ends recovery.",
      "rationale": "In-pipeline. Resume retries a missing JSONL instead of falling back to a fresh session, dead-ending every crash/reboot recovery path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2858",
      "rank": 1,
      "size": "L",
      "importance": "high",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight",
      "rationale": "Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 42,
      "size": "XL",
      "importance": "high",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete, reachable online/CLI/offline.",
      "rationale": "Replaces silent all-or-nothing 'Resume all' with an informed per-agent decision across local + remote. High aggregate impact across 11 open children.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1915",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Security: API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext.",
      "rationale": "config.yaml carries every provider key + tracker creds; chmod fix closed the world-readable hole but keychain + startup perm-check remain.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 44,
      "size": "S",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash).",
      "rationale": "Landing verification uses an ancestry check squash-merge structurally cannot satisfy, refusing every correctly-landed strike.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 45,
      "size": "L",
      "importance": "high",
      "score": 57,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface — the notification spine.",
      "rationale": "Keystone child of PAN-2075. A durable queue every scattered notification surface should post to instead of inventing another.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strikes deadlock — 'git rebase origin/main' denied as history rewriting, cannot sync/gate/push.",
      "rationale": "Codex's reviewer over-generalizes 'history rewriting forbidden' to deny the standard `git rebase origin/main` sync on an unpushed branch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2377",
      "rank": 49,
      "size": "L",
      "importance": "high",
      "score": 56,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "first-class 'special orders' runs — operator-supplied order book executed with lane semantics",
      "rationale": "substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 48,
      "size": "XL",
      "importance": "high",
      "score": 56,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Make overdeck not suck — simple-by-default, conversation-first UX overhaul with CI conformance gates.",
      "rationale": "Default UI exposes all machinery and answers none of a new user's three questions. Progressive-disclosure overhaul with binding mockups.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 49,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend.",
      "rationale": "Keystone of the cost epic and the ONE guard permitted to pause agents. An agent burned $22.33 in a 400-retry loop before a human noticed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2749",
      "rank": 50,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Resume restores the conversation but not the machinery: timers, monitors, background workers never restart.",
      "rationale": "After resume, in-process timers/monitors/workers aren't reconstructed, so a resumed agent looks alive but its machinery is dead.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 51,
      "size": "L",
      "importance": "high",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2905"
      ],
      "why": "Reduce accidental orchestration complexity — one owner per runtime concern.",
      "rationale": "Overlapping timers, fallbacks, caches, pollers independently rediscover the same facts. Each concern needs one owner/policy/transition.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 52,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors.",
      "rationale": "Pre-existing unused-local errors block the typecheck gate for any frontend-touching issue, slowing verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 53,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, status=running forever.",
      "rationale": "A 'model at capacity' error fails the turn with willRetry=false and the agent goes idle while recorded status=running. Silent dead-on-arrival.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2830",
      "rank": 54,
      "size": "L",
      "importance": "high",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only.",
      "rationale": "Overdeck auto-migrates every project onto overdeck-state and pushes to origin without asking. Opt-in is foundational to multi-machine direction.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 55,
      "size": "L",
      "importance": "high",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land progress-aware breaker.",
      "rationale": "Retires invented $10/$25/$100 limits and lands the one real guard (PAN-1868). Makes headline dollars honest.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2421",
      "rank": 56,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(test): dashboard server route tests flake under full-suite verification load.",
      "rationale": "Route tests flake specifically under full-suite load, producing unreliable verification verdicts.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 57,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume disabled, only action aborts the run.",
      "rationale": "After reboot the run gate is left active/dead-session; the only reachable control silently aborts instead of resuming.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 58,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly) — one resolver.",
      "rationale": "Backend for dashboard + CLI: every agent in state but not verified-running, across local AND remote. A spending remote machine is the high-priority case.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 59,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): server children inherit bare system PATH — verification gates run npm on broken PATH.",
      "rationale": "Spawned children inherit a bare PATH, so verification gates invoking npm can resolve against the wrong environment and fail spuriously.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2467",
      "rank": 60,
      "size": "L",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857).",
      "rationale": "For polyrepo projects the train completes one sub-repo and strands siblings, leaving the issue half-merged. Affects MYN shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 61,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2747"
      ],
      "why": "Dead flywheel with an active run never auto-relaunched after a reboot — sat idle for hours.",
      "rationale": "A dead orchestrator with an active run wasn't auto-relaunched post-reboot; combined with PAN-2747 a reboot silently halts the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state.",
      "rationale": "First new data domain that only makes sense once the branch is shared: 'is anything working on this issue, and where?' from any machine.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 63,
      "size": "L",
      "importance": "high",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager.",
      "rationale": "Unfreezing the deacon thundering-herded 37 agents at once (load 5→52). Throttle + on-demand specialists + deadlock-safe slot manager.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2763",
      "rank": 64,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution.",
      "rationale": "Workspace node_modules symlinked to the primary repo breaks test resolution and couples workspace tests to the host tree.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 65,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext.",
      "rationale": "The plaintext-storage root concern PAN-1915 builds on; keychain migration is the durable fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 66,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM).",
      "rationale": "Work agents run the full suite locally (EPERM on git tests) then burn 20+ min on false failures. The verification gate owns full-suite.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 67,
      "size": "M",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(records): close-out writer clobbers closeOut.usage with EMPTY data — cost history lost (recurring).",
      "rationale": "Close-out rewrites just-closed records with empty usage maps, destroying the per-issue cost data the cost-visibility program builds.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 68,
      "size": "S",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle — every workspace shows a dirty tree.",
      "rationale": "Build regenerates a committed bundle, so every workspace build dirties the tree and fights commits.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 69,
      "size": "L",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state).",
      "rationale": "Inserts a review beat between 'a plan exists' and 'go work it'; lets the planning AI refuse bad work as a reviewable objection. Binding mockups committed.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2876",
      "rank": 7,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation subagent rail: list spawned subagents and open their transcripts.",
      "rationale": "When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 71,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation permission waits missing from Awareness; strengthen alerting.",
      "rationale": "Permission waits don't surface in Awareness, so an agent blocked on operator input sits invisible.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 72,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Comment mediation layer to prevent prompt injection via tracker comments.",
      "rationale": "Tracker comments are an untrusted input surface feeding agents; a mediation layer is the structural defense.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2580",
      "rank": 73,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery drops.",
      "rationale": "pan tell can't deliver to codex conversations, so the sanctioned agent-message path silently fails for half the harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 74,
      "size": "M",
      "importance": "medium",
      "score": 49,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume flags.",
      "rationale": "pan up is frequently headless; the same reconciliation decision must be CLI-actionable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2838",
      "rank": 7,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Project settings disclosure badge for projects with no settings",
      "rationale": "In-progress UI polish; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombies.",
      "rationale": "Misclassifies live codex sessions as zombies, compounding PAN-2580's delivery failure with false liveness reports.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2599",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Integrate PostHog product analytics + telemetry",
      "rationale": "Planned/in-progress analytics integration; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 78,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — operator sees no activity.",
      "rationale": "UI shows no active run while the API returns a live one, so the operator believes the flywheel is idle while it's working.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 79,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach.",
      "rationale": "Fast-follow after the inbox spine: reach the operator out-of-band so a held fleet or runaway spend pings them.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2802",
      "rank": 80,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): same-head strike-ready cannot re-arm a needs-you landing.",
      "rationale": "A needs-you landing can't re-arm when the strike head is unchanged, so a re-dispatched strike with no new commits can't progress.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 81,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Coalesce re-reviews so a fresh dispatch doesn't re-spawn an in-flight review convoy.",
      "rationale": "Child of PAN-1666. Re-reviews should coalesce onto the in-flight convoy rather than re-spawning.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2066",
      "rank": 597,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2478",
      "rank": 83,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT).",
      "rationale": "Playwright browser install flakes on the apt mirror, producing unreliable CI.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 84,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family.",
      "rationale": "Real-timer tests cause CI flake; the fake-timers + @slow pattern from the global rule stabilizes main CI.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 85,
      "size": "L",
      "importance": "medium",
      "score": 42,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm).",
      "rationale": "Every bead runs on the same model regardless of complexity; difficulty is captured and ignored. Cost + quality win once routed.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 86,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122).",
      "rationale": "Per-role model pools spread rate-limit risk and enable A/B; needs its own planning cycle. Architecture-labeled.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 87,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items.",
      "rationale": "Trivial mechanical items shouldn't consume a full slot dispatch round. flywheel-change + needs-design.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1253",
      "rank": 88,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work.",
      "rationale": "Flywheel can auto-pick an issue whose deps aren't done, wasting a slot. flywheel-change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 89,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 90,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 91,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 92,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 93,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 94,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 96,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 97,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-satu...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 98,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (force...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 99,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 102,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 103,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 106,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 107,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 109,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for en...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 110,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unan...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 111,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the re...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 112,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 113,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2376",
      "rank": 114,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene, review au...",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2379",
      "rank": 115,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(verify-gate): dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm conver...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 116,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 117,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never fires (churning-main convergenc...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 118,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the run is stopped, fee...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 119,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve — two strikes bent their diffs around i...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 120,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 121,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 122,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 123,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 124,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 125,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 126,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 127,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 128,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 129,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cli): pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 130,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 131,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 132,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 133,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 134,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 135,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 136,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 137,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 138,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the iss...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 139,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(palette): Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 140,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 141,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 142,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(restart): health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2670",
      "rank": 143,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 144,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 145,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 146,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 147,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 148,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 149,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 150,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 151,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered, swarm-off suppresses recovery of a non-swarm a...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 152,
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
      "issue": "PAN-2295",
      "rank": 153,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 154,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 155,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-817",
      "rank": 156,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-863",
      "rank": 157,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-924",
      "rank": 158,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-947",
      "rank": 159,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 160,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1041",
      "rank": 161,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1164",
      "rank": 162,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 163,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 164,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 165,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 166,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 167,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 168,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1165",
      "rank": 169,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 170,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 171,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 172,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 173,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1246",
      "rank": 174,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 175,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1313",
      "rank": 176,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 177,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 178,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 179,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 180,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 182,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1538",
      "rank": 183,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 184,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 185,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 186,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 187,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 188,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 189,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 191,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 192,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 193,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 194,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 195,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 196,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 197,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 198,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 199,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 200,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 201,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 202,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 203,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 204,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 205,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 206,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 207,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 211,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 212,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 213,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, ...",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2548",
      "rank": 214,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 ma...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 216,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2556",
      "rank": 217,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into th...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2565",
      "rank": 218,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2566",
      "rank": 219,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 220,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 221,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 222,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 223,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(swarm): configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 224,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 225,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2896",
      "rank": 226,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 227,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-810",
      "rank": 228,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 229,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 230,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 231,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 232,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 233,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-900",
      "rank": 234,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 236,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 237,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 238,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 239,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 240,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 241,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 242,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 243,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 244,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 245,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 246,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 247,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 248,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 249,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 250,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 251,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 252,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 253,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 254,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 255,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 256,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 258,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 260,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 261,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 262,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 263,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 264,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 265,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 267,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 268,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 269,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 272,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 273,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1227",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1240",
      "rank": 275,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 277,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 278,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 279,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 281,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 282,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 283,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 284,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1438",
      "rank": 285,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 286,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 287,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 289,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 290,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 291,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 293,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 294,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 295,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 296,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 297,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 298,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 299,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 300,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 301,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 302,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 303,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N lin...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 304,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 305,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 306,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 307,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 309,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 310,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 311,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 312,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 313,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 314,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 315,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 316,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 317,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 318,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling o...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 319,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 320,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Merge train becomes per-project — works without a Flywheel run, multi-project view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 321,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — serv...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 323,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 325,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 326,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 327,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 328,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 329,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 330,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 331,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 332,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 333,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1773",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 335,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 336,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 339,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + aut...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 340,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 342,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 343,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 347,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 348,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 349,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang sta...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 350,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 351,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 352,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 353,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 354,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 355,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 356,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 357,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 358,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 359,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 360,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 363,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 364,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 365,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 366,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 367,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 369,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 371,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2082",
      "rank": 373,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 374,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 375,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 376,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 377,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 378,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 380,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale la...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 381,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 383,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 384,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 385,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 386,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 387,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 388,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 389,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 390,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 391,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2346",
      "rank": 392,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 393,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 394,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 395,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2351",
      "rank": 396,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2352",
      "rank": 397,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2353",
      "rank": 398,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 399,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 400,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2355",
      "rank": 401,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 402,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2390",
      "rank": 403,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid o...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 404,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 405,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 406,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversa...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 407,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 408,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 409,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-w...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 410,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 411,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotati...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 412,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 413,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 414,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification cont...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 415,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remo...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 416,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2442",
      "rank": 417,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and pro...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 418,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot ado...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 419,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 420,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 421,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 422,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 423,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 424,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rul...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 425,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 426,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 427,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 428,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 429,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 430,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboar...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 431,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 432,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 433,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 434,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 435,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 436,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 437,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 439,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 440,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall b...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 441,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 442,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 443,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 444,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 445,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 448,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 449,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "chore(server): pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 450,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 451,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 452,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2660",
      "rank": 453,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add safe Reset to planned action to the issue actions menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 454,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 455,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 456,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 457,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 458,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2680",
      "rank": 459,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 460,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 461,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 462,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 463,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "fix(cloister): idle nudge must not advance after failed mandatory inspection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 464,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "bug(cloister): strike merge trigger registry splits across dashboard chunks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 465,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 466,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 467,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 468,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 469,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 470,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 471,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 472,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback deli...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 473,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2882",
      "rank": 474,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pipeline membership has no GitLab merged-MR oracle — squash-merged GitLab branches show as unmerged (false planned_backlog rows, mislab...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 475,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 476,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 477,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2937",
      "rank": 478,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Board right-click context menu can close when live data ticks re-render the card",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 479,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "OKF v3 — lease-based writes and advisory semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2945",
      "rank": 480,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2947",
      "rank": 481,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "testing 1 2 3",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2949",
      "rank": 482,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Test issue — discuss-then-file flow smoke test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 483,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 494,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 495,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 498,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 507,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 511,
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
      "issue": "PAN-1151",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "stale",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 532,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1837",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-646",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-700",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "stale",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-630",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 554,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 562,
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
      "issue": "PAN-271",
      "rank": 563,
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
      "issue": "PAN-283",
      "rank": 564,
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
      "issue": "PAN-297",
      "rank": 565,
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
      "issue": "PAN-298",
      "rank": 566,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 593,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 595,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 596,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 597,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 598,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 599,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 600,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 601,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 602,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 603,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 604,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 605,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 606,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 607,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 608,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 609,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 610,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 611,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 612,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 613,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 614,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 616,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 617,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 618,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 619,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 620,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 621,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 622,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 623,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 624,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 625,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 626,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 627,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 628,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 631,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 635,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 636,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 638,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 640,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 642,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 643,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 644,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 646,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 652,
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
      "issue": "PAN-198",
      "rank": 653,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
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
      "from": "PAN-2075",
      "to": "PAN-454",
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
      "to": "PAN-43",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-1844",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2354",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2717",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2492",
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
      "from": "PAN-2642",
      "to": "PAN-106",
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
      "to": "PAN-797",
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
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2059",
      "to": "PAN-806",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2689",
      "to": "PAN-2952",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2792",
      "to": "PAN-2775",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-2839",
      "to": "PAN-2569",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2691",
      "to": "PAN-2569",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2550",
      "to": "PAN-2430",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2550",
      "to": "PAN-2421",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2580",
      "to": "PAN-2546",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-2932",
      "to": "PAN-1711",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2905",
      "to": "PAN-1711",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2746",
      "to": "PAN-2742",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2888",
      "to": "PAN-2769",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2846",
      "to": "PAN-2888",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    }
  ]
}
```
