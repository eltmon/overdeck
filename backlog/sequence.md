# Backlog Sequence

_Last sequenced: 2026-07-20T10:06:12Z · model: glm-5.2 · open: 652_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2858 | XL | high | ok |  |  | ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight |
| 2 | PAN-2952 | M | critical | needs-refinement |  |  | Review verdict writes lost to per-issue record-lock collisions — 3 stores disagree |
| 3 | PAN-2940 | M | critical | needs-refinement |  |  | Three red-mains in one day: direct-push series bypasses PR CI |
| 5 | PAN-2935 | M | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik — 50% API 504s |
| 6 | PAN-806 | M | critical | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 6 | PAN-2954 | M | critical | ok |  |  | postMergeLifecycle refuses GitLab projects — teardown/labels never run |
| 7 | PAN-2882 | L | critical | ok |  |  | No GitLab merged-MR oracle — squash-merged GitLab branches show as unmerged |
| 7 | PAN-2876 | M | high | ok |  |  | Conversation subagent rail: list spawned subagents and open their transcripts. |
| 7 | PAN-2838 | S | medium | ok |  |  | Project settings disclosure badge for projects with no settings |
| 8 | PAN-2569 | M | critical | ok |  |  | Planning finalizes but work agent never auto-spawns — silent handoff |
| 9 | PAN-2932 | L | critical | needs-refinement |  |  | Dashboard boot wedge between Cloister start and ReadModel bootstrap |
| 11 | PAN-2516 | S | critical | ok |  |  | Spec plan.status flips uncommitted — spec-vs-record drift + flywheel push block |
| 13 | PAN-2567 | M | high | ok |  |  | reviewed+green PR stuck — advancing verdict reconciles forever, no merge |
| 14 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every dispatch — never-kicked-off reads running |
| 14 | PAN-2599 | L | medium | ok |  |  | Integrate PostHog product analytics + telemetry |
| 15 | PAN-2874 | M | high | ok |  |  | Strike landing: verification gate demands vBRIEF strikes never have |
| 16 | PAN-2946 | XS | high | ok |  |  | Deacon crashes on null lastActivity in checkFirstCompletionAgents every patrol |
| 17 | PAN-2848 | M | high | ok |  |  | Work agent stalls forever on dead inspection — no re-dispatch, no verdict |
| 18 | PAN-2888 | M | high | ok |  |  | Close-out leaves residue inflating troubled/failed metrics on CLOSED issues |
| 20 | PAN-2379 | M | high | ok |  |  | verify-gate dep install warn-only + 60s timeout — false failures vs empty node_modules |
| 21 | PAN-2759 | M | high | ok |  |  | Dead flywheel never auto-relaunched after reboot — sat idle 2h |
| 22 | PAN-2883 | S | high | ok |  |  | Close-out deploy row fails for every strike-landed issue — hardcoded feature/ branch |
| 23 | PAN-2921 | S | high | ok |  |  | Strike merge door can land same head twice after fetch failure |
| 24 | PAN-2905 | M | high | needs-refinement |  |  | Dashboard steady-state CPU ~50% — API responses 0.5-1.5s |
| 25 | PAN-2945 | S | high | ok |  |  | pan done rejects Overdeck-generated runtime in polyrepo wrapper repos |
| 27 | PAN-807 | XL | critical | ok |  |  | Epic C: Workspace state sanity on spawn |
| 28 | PAN-1766 | S | high | ok |  |  | bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN- |
| 29 | PAN-1770 | S | high | ok |  |  | bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle |
| 30 | PAN-2106 | S | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 31 | PAN-2165 | S | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans |
| 32 | PAN-2169 | S | high | ok |  |  | bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-satu |
| 33 | PAN-2170 | S | high | ok |  |  | bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (force |
| 34 | PAN-2186 | S | high | ok |  |  | bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 35 | PAN-2323 | S | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 36 | PAN-2324 | S | high | ok |  |  | bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels |
| 37 | PAN-2593 | S | high | ok |  |  | Server children inherit bare system PATH — gates run Node 18 not 22 |
| 38 | PAN-2650 | M | high | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds stack |
| 39 | PAN-2886 | S | high | ok |  |  | Placeholder pending-work-spawn agents crash auto-resume with Unknown model |
| 40 | PAN-2895 | M | critical | ok |  |  | Resume path retries a session whose JSONL is missing instead of falling back to fresh — dead-ends recovery. |
| 40 | PAN-2957 | M | high | needs-refinement |  |  | npm run build intermittently produces stale frontend bundles |
| 41 | PAN-2896 | M | high | ok |  |  | Warm resource-discovery + membership caches at boot — 20-60s cold click |
| 43 | PAN-2511 | S | high | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git |
| 44 | PAN-2639 | M | high | ok |  |  | codex-resume replays revoked refresh token — codex review convoys 401 |
| 45 | PAN-2709 | S | high | ok |  |  | Flywheel orchestrator unreachable as notification target — feedback dead-ends |
| 46 | PAN-955 | S | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 47 | PAN-1198 | S | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 48 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 49 | PAN-2377 | XL | high | ok |  |  | first-class 'special orders' runs — operator-supplied order book executed with lane semantics |
| 49 | PAN-1560 | S | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 50 | PAN-1618 | S | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down |
| 51 | PAN-2179 | S | high | ok |  |  | bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled) |
| 52 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal |
| 53 | PAN-2259 | S | high | ok |  |  | bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration |
| 54 | PAN-2331 | S | high | ok |  |  | bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for en |
| 55 | PAN-2337 | S | high | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 56 | PAN-2521 | S | high | ok |  |  | Launch pipeline agents with rate-limit model-switch reminder disabled |
| 57 | PAN-2718 | S | high | ok |  |  | pan restart needs no-dialog reconciliation flag for autonomous restarts |
| 58 | PAN-2802 | S | high | ok |  |  | same-head strike-ready cannot re-arm a needs-you landing |
| 59 | PAN-2824 | S | high | ok |  |  | pan review pending dies when one project lens gather fails (PAN-2820 class) |
| 60 | PAN-2850 | S | high | ok |  |  | npm test fails in clean checkout — pretest removes dashboard bundle |
| 61 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 62 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues |
| 63 | PAN-2430 | S | high | ok |  |  | Frontend typecheck fails with dozens of pre-existing unused-local errors |
| 64 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit |
| 65 | PAN-2629 | S | high | ok |  |  | pan start kickoff delivery never lands — Claude Code not ready in 30s |
| 66 | PAN-2720 | S | high | ok |  |  | File-size ratchet counts lines — rewards line-packing on god files |
| 67 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 68 | PAN-2495 | S | high | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change |
| 69 | PAN-2547 | S | high | ok |  |  | bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure |
| 70 | PAN-2550 | S | high | ok |  |  | bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level |
| 71 | PAN-2558 | L | high | ok |  |  | feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git re |
| 72 | PAN-2656 | S | high | ok |  |  | bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 73 | PAN-2659 | S | high | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 74 | PAN-2689 | S | high | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process |
| 75 | PAN-2691 | S | high | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you |
| 76 | PAN-2700 | S | high | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict |
| 77 | PAN-2733 | S | high | ok |  |  | bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls) |
| 78 | PAN-2738 | S | high | ok |  |  | bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push |
| 79 | PAN-2742 | S | high | ok |  |  | bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQ |
| 80 | PAN-2746 | S | high | ok |  |  | bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearly merged PAN-2710 unrevie |
| 81 | PAN-2747 | S | high | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 82 | PAN-2758 | S | high | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 83 | PAN-2761 | S | high | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik |
| 84 | PAN-2769 | S | high | ok |  |  | review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operat |
| 85 | PAN-2792 | S | high | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 86 | PAN-2820 | S | high | ok |  |  | CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback) |
| 87 | PAN-2830 | M | high | ok |  |  | Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialog |
| 88 | PAN-2837 | M | high | ok |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 89 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 90 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 91 | PAN-1504 | L | high | ok |  |  | feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs |
| 92 | PAN-1767 | M | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 93 | PAN-2421 | M | high | ok |  |  | Dashboard server route tests flake under full-suite verification load |
| 94 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 95 | PAN-886 | S | high | needs-refinement |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 96 | PAN-932 | S | high | needs-refinement |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 97 | PAN-1113 | S | high | needs-refinement |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 98 | PAN-1130 | S | high | needs-refinement |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 99 | PAN-1196 | M | high | ok |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 100 | PAN-1217 | M | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 101 | PAN-1218 | M | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 102 | PAN-1219 | L | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 103 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 104 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 105 | PAN-1254 | L | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 106 | PAN-1311 | M | high | ok |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 107 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 108 | PAN-1392 | S | high | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 109 | PAN-1424 | M | high | ok |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 110 | PAN-1438 | S | high | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 111 | PAN-1449 | S | high | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 112 | PAN-1451 | M | high | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 113 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 114 | PAN-1497 | M | high | ok |  |  | feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 115 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 116 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 117 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 118 | PAN-1561 | M | high | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 119 | PAN-1578 | L | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 120 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 121 | PAN-1673 | S | high | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 122 | PAN-1828 | S | high | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 123 | PAN-1830 | S | high | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 124 | PAN-1889 | M | high | ok |  |  | feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run |
| 125 | PAN-1913 | M | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 126 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 127 | PAN-2059 | XL | high | ok | ✓ |  | [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting |
| 128 | PAN-2075 | XL | high | ok | ✓ | PAN-1775 | [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline |
| 129 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver |
| 130 | PAN-1525 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-2078 | M | high | ok |  |  | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 131 | PAN-2079 | M | high | ok |  |  | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 132 | PAN-2080 | M | high | ok |  |  | Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43) |
| 133 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 134 | PAN-2189 | M | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff |
| 135 | PAN-2190 | M | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split |
| 136 | PAN-2202 | S | high | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success |
| 137 | PAN-2233 | M | high | ok |  |  | refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules |
| 138 | PAN-2240 | S | high | ok |  |  | bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 139 | PAN-2243 | S | high | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 140 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unan |
| 141 | PAN-2334 | M | high | ok |  |  | chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the re |
| 142 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 143 | PAN-2376 | XL | high | ok |  |  | Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene, review au |
| 144 | PAN-262 | M | high | ok |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 145 | PAN-2467 | S | medium | ok |  |  | Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged) |
| 146 | PAN-2546 | S | medium | ok |  |  | bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery |
| 147 | PAN-2554 | S | medium | ok |  |  | bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable |
| 148 | PAN-2563 | S | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 149 | PAN-2580 | S | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie |
| 150 | PAN-2627 | S | medium | ok |  |  | bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the iss |
| 151 | PAN-2649 | S | medium | ok |  |  | bug(palette): Ctrl+K conversation search indexes Claude transcripts only |
| 152 | PAN-2663 | S | medium | ok |  |  | bug(restart): health probe can accept old dashboard after replacement EADDRINUSE |
| 153 | PAN-2664 | S | medium | ok |  |  | bug(sync-main): auto-commit completes unresolved merge with conflict markers |
| 154 | PAN-2670 | S | medium | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors) |
| 155 | PAN-2672 | S | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 156 | PAN-2686 | S | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 157 | PAN-2695 | S | medium | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickof |
| 158 | PAN-2696 | S | medium | ok |  |  | Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label |
| 159 | PAN-2697 | S | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches |
| 160 | PAN-2699 | S | medium | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace |
| 161 | PAN-2717 | S | medium | ok |  |  | bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse |
| 162 | PAN-2734 | S | medium | ok |  |  | bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers |
| 163 | PAN-2739 | S | medium | ok |  |  | bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done |
| 164 | PAN-2749 | S | medium | ok |  |  | Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed |
| 165 | PAN-2763 | S | medium | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids |
| 166 | PAN-2775 | S | medium | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04 |
| 167 | PAN-2805 | S | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere |
| 168 | PAN-2828 | S | medium | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 169 | PAN-2839 | S | medium | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825) |
| 170 | PAN-2846 | S | medium | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 171 | PAN-538 | S | medium | needs-refinement |  |  | pan reload freshness guard must also verify the frontend bundle |
| 172 | PAN-1226 | L | medium | needs-refinement |  |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 173 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 174 | PAN-1436 | S | medium | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 175 | PAN-1711 | S | medium | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 176 | PAN-1769 | S | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil |
| 177 | PAN-1824 | S | medium | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 178 | PAN-247 | S | high | needs-refinement |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 180 | PAN-681 | S | medium | needs-refinement |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 181 | PAN-900 | S | medium | needs-refinement |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 182 | PAN-933 | S | medium | needs-refinement |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 183 | PAN-1027 | S | medium | needs-refinement |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 184 | PAN-1042 | S | medium | needs-refinement |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 185 | PAN-1068 | S | medium | needs-refinement |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 186 | PAN-1128 | S | medium | needs-refinement |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 187 | PAN-1129 | S | medium | needs-refinement |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 188 | PAN-1149 | S | medium | needs-refinement |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 189 | PAN-1150 | S | medium | needs-refinement |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 190 | PAN-1173 | S | medium | needs-refinement |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 191 | PAN-1227 | S | medium | needs-refinement |  | PAN-1226 | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 192 | PAN-1240 | S | medium | needs-refinement |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 193 | PAN-1330 | S | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 194 | PAN-1386 | S | medium | ok |  |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 195 | PAN-1433 | S | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 196 | PAN-1440 | S | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 197 | PAN-1444 | S | medium | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 198 | PAN-1445 | S | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 199 | PAN-1446 | S | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 200 | PAN-1461 | S | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 201 | PAN-1530 | S | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 202 | PAN-1556 | S | medium | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 203 | PAN-1565 | S | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 204 | PAN-1571 | S | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N lin |
| 205 | PAN-1624 | S | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 206 | PAN-1674 | S | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 207 | PAN-1795 | S | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 208 | PAN-1816 | S | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + aut |
| 209 | PAN-1912 | S | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 210 | PAN-2069 | S | medium | ok |  |  | caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 211 | PAN-2237 | S | medium | ok |  |  | bug(cli): pan plan done swallows vbrief quality lint details |
| 212 | PAN-2241 | S | medium | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 213 | PAN-2242 | S | medium | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 214 | PAN-2244 | S | medium | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land) |
| 215 | PAN-49 | S | medium | stale |  |  | Fix CloisterService tests that require real runtime |
| 216 | PAN-113 | S | medium | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 217 | PAN-244 | S | medium | needs-refinement |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 218 | PAN-245 | S | medium | needs-refinement |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 219 | PAN-304 | S | medium | needs-refinement |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 220 | PAN-324 | S | medium | needs-refinement |  |  | Agent detail pane missing Merge/Approve button |
| 221 | PAN-334 | S | medium | needs-refinement |  |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 223 | PAN-454 | M | high | needs-refinement |  | PAN-2075 | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 224 | PAN-1672 | M | high | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 225 | PAN-1840 | M | high | ok |  |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 226 | PAN-2031 | M | high | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 227 | PAN-2416 | M | low | ok |  |  | bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively |
| 228 | PAN-2428 | M | low | ok |  |  | bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label  |
| 229 | PAN-2454 | M | low | ok |  |  | bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches |
| 230 | PAN-2465 | M | low | ok |  |  | bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero |
| 231 | PAN-2491 | M | low | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 232 | PAN-2501 | M | low | ok |  |  | bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboar |
| 233 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 234 | PAN-2506 | M | low | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 235 | PAN-2548 | M | medium | ok |  |  | chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 ma |
| 236 | PAN-2553 | M | medium | ok |  |  | feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 237 | PAN-2557 | M | medium | ok |  |  | feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory govern |
| 238 | PAN-2556 | M | medium | ok |  |  | feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into th |
| 239 | PAN-2560 | M | low | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall b |
| 240 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 241 | PAN-2566 | XL | medium | ok |  |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 242 | PAN-2572 | M | low | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 243 | PAN-2582 | M | medium | ok |  |  | feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 244 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 245 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 246 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 247 | PAN-2642 | XL | medium | ok | ✓ |  | [EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land the progress-aware breaker, make dollars hone |
| 248 | PAN-2646 | M | medium | ok |  |  | feat(swarm): configurable global/project/issue policy UI with default OFF |
| 249 | PAN-2668 | M | low | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery |
| 250 | PAN-2678 | M | low | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 251 | PAN-2680 | M | low | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 252 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 253 | PAN-2796 | M | low | ok |  |  | fix(cloister): idle nudge must not advance after failed mandatory inspection |
| 254 | PAN-2810 | M | low | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 255 | PAN-532 | M | medium | needs-refinement |  |  | Per-project and per-issue model overrides for pipeline roles |
| 256 | PAN-537 | M | low | needs-refinement |  |  | feat: show changed files diff summary after each agent response in activity view |
| 257 | PAN-817 | M | medium | needs-refinement |  |  | Improve planning dialog layout and content fit |
| 258 | PAN-924 | L | medium | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 259 | PAN-947 | M | medium | needs-refinement |  |  | feat: project management actions in unified sidebar |
| 260 | PAN-1040 | M | medium | needs-refinement |  |  | feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 261 | PAN-1041 | M | medium | needs-refinement |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 262 | PAN-1164 | M | medium | needs-refinement |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 263 | PAN-1577 | M | medium | ok |  |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 264 | PAN-450 | M | medium | needs-refinement |  |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 265 | PAN-452 | M | medium | needs-refinement |  |  | Conversation input bar — mode/permissions/workspace selectors |
| 266 | PAN-463 | M | medium | needs-refinement |  |  | Add Qwen 3.6+ model support |
| 267 | PAN-465 | M | medium | needs-refinement |  |  | Add OpenRouter as a model provider |
| 268 | PAN-466 | M | medium | needs-refinement |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 269 | PAN-531 | M | medium | needs-refinement |  |  | PAN: Windows Electron support (WSL2 required) |
| 270 | PAN-546 | M | medium | needs-refinement |  |  | Remove claude-code-router — all providers use direct env var injection |
| 271 | PAN-548 | M | medium | needs-refinement |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 272 | PAN-606 | M | medium | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 273 | PAN-607 | M | medium | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 274 | PAN-613 | M | medium | needs-refinement |  |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 275 | PAN-629 | M | medium | needs-refinement |  |  | Workspace quotas and resource governance |
| 276 | PAN-637 | M | medium | needs-refinement |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 277 | PAN-649 | M | medium | needs-refinement |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 278 | PAN-654 | M | medium | needs-refinement |  |  | Project Setup Wizard — Dashboard UI |
| 279 | PAN-675 | M | medium | needs-refinement |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 280 | PAN-678 | M | medium | needs-refinement |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 281 | PAN-687 | M | medium | needs-refinement |  |  | Support OpenCode as alternative coding agent |
| 282 | PAN-709 | M | low | needs-refinement |  |  | feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 283 | PAN-727 | M | low | needs-refinement |  |  | Fix orphaned work-agent start handoff after planning |
| 284 | PAN-778 | M | low | needs-refinement |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 285 | PAN-818 | M | medium | needs-refinement |  |  | Make summary optional when forking conversations |
| 286 | PAN-901 | M | medium | needs-refinement |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 287 | PAN-902 | M | medium | needs-refinement |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 288 | PAN-903 | M | medium | needs-refinement |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 289 | PAN-927 | M | low | needs-refinement |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 290 | PAN-938 | M | medium | needs-refinement |  |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 291 | PAN-949 | M | medium | needs-refinement |  |  | feat: add conversation for project from sidebar |
| 292 | PAN-958 | M | medium | needs-refinement |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 293 | PAN-1037 | M | medium | needs-refinement |  |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 294 | PAN-1060 | M | medium | needs-refinement |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 295 | PAN-1123 | M | low | needs-refinement |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 296 | PAN-1151 | M | medium | needs-refinement |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 297 | PAN-1154 | M | low | needs-refinement |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 298 | PAN-1165 | M | medium | needs-refinement |  |  | Lightweight review path for small/trivial PRs |
| 299 | PAN-1223 | M | medium | needs-refinement |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 300 | PAN-1244 | M | low | needs-refinement |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 301 | PAN-1245 | M | low | needs-refinement |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 302 | PAN-1432 | M | medium | ok |  |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 303 | PAN-1435 | M | medium | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 304 | PAN-1437 | M | medium | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 305 | PAN-1442 | M | medium | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 306 | PAN-1443 | M | medium | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 307 | PAN-1469 | M | medium | ok |  |  | End-to-end review and consolidation of all project documentation |
| 308 | PAN-1473 | M | medium | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 309 | PAN-1480 | L | low | ok |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 310 | PAN-1485 | M | medium | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 311 | PAN-1489 | M | medium | ok |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 312 | PAN-1490 | M | medium | ok |  |  | feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 313 | PAN-1524 | M | medium | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 314 | PAN-1542 | M | medium | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 315 | PAN-1545 | M | medium | ok |  |  | feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 316 | PAN-1572 | M | low | ok |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 317 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 318 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 319 | PAN-1627 | M | low | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr |
| 320 | PAN-1653 | M | medium | ok |  |  | perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 321 | PAN-1654 | M | medium | ok |  |  | perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 322 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 323 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 324 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 325 | PAN-1666 | XL | medium | ok | ✓ |  | [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out |
| 326 | PAN-1676 | M | medium | ok |  |  | feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 327 | PAN-1684 | M | medium | ok |  |  | docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 328 | PAN-1685 | M | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 329 | PAN-1710 | M | low | ok |  |  | bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — serv |
| 330 | PAN-1720 | M | low | ok |  |  | bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 331 | PAN-1740 | M | low | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 332 | PAN-1755 | M | low | ok |  |  | bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generat |
| 333 | PAN-1774 | M | low | ok |  |  | bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 334 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 335 | PAN-1837 | L | medium | ok |  |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 336 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 337 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 338 | PAN-1852 | M | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 339 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 340 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 341 | PAN-1915 | M | medium | ok |  |  | enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext |
| 342 | PAN-1916 | M | medium | ok |  |  | feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 343 | PAN-1918 | M | low | ok |  |  | bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang sta |
| 344 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 345 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 346 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 347 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 348 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 349 | PAN-1991 | L | medium | ok |  |  | Issue cockpit redesign — incremental rollout (tracking) |
| 350 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 351 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 352 | PAN-2008 | M | low | ok |  |  | feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 353 | PAN-2024 | M | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 354 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 355 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 356 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 357 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 358 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 359 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 360 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 361 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 362 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 363 | PAN-2065 | M | medium | ok |  |  | feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 364 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 365 | PAN-2083 | M | low | ok |  | PAN-1592 | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 366 | PAN-2201 | M | low | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale la |
| 367 | PAN-2213 | M | low | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 368 | PAN-2266 | M | medium | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 369 | PAN-2280 | M | low | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.) |
| 370 | PAN-2288 | L | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up) |
| 371 | PAN-2295 | L | medium | ok |  |  | feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 372 | PAN-2335 | M | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY,  |
| 373 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree  |
| 374 | PAN-2408 | M | low | ok |  |  | bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-w |
| 375 | PAN-2409 | M | low | ok |  |  | feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026- |
| 376 | PAN-2414 | M | low | ok |  |  | bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotati |
| 377 | PAN-2422 | M | low | ok |  |  | bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 378 | PAN-2423 | M | low | ok |  |  | bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification cont |
| 379 | PAN-2424 | XL | low | ok |  |  | Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remo |
| 380 | PAN-2442 | L | low | ok |  |  | feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and pro |
| 381 | PAN-2443 | M | low | ok |  |  | feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot ado |
| 382 | PAN-2444 | L | low | ok |  |  | feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 383 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 384 | PAN-2466 | M | low | ok |  |  | bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring) |
| 385 | PAN-2469 | M | low | ok |  |  | feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN |
| 386 | PAN-2484 | M | low | ok |  |  | fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rul |
| 387 | PAN-2487 | M | low | ok |  |  | feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 388 | PAN-2489 | M | low | ok |  |  | bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 389 | PAN-2492 | M | low | ok |  |  | bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only |
| 390 | PAN-2493 | M | low | ok |  |  | feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 391 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 392 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 393 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 394 | PAN-2526 | M | low | ok |  |  | Refactor deacon.ts below file-size baseline |
| 395 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 396 | PAN-2533 | M | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 397 | PAN-2549 | M | low | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 398 | PAN-2600 | M | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 399 | PAN-2625 | M | low | ok |  |  | feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo iss |
| 400 | PAN-2626 | M | low | ok |  |  | feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 401 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 402 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 403 | PAN-2635 | M | low | ok |  |  | chore(server): pay down the 152-error src/dashboard/server typecheck debt |
| 404 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 405 | PAN-2651 | M | low | ok |  |  | fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset |
| 406 | PAN-2652 | M | low | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso |
| 407 | PAN-2660 | M | low | ok |  |  | Add safe Reset to planned action to the issue actions menu |
| 408 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 409 | PAN-2667 | M | low | ok |  |  | Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 410 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 411 | PAN-2754 | M | low | ok |  |  | bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 412 | PAN-2755 | M | low | ok |  |  | bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 413 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 414 | PAN-2806 | M | low | ok |  |  | bug(cloister): strike merge trigger registry splits across dashboard chunks |
| 415 | PAN-2809 | M | low | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 416 | PAN-2813 | M | low | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 417 | PAN-2817 | M | low | ok |  |  | Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours |
| 418 | PAN-2836 | M | low | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 419 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized |
| 420 | PAN-2880 | M | low | ok |  |  | Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget |
| 421 | PAN-2908 | M | low | ok |  |  | Make overdeck not suck |
| 422 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 423 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 424 | PAN-2937 | M | low | ok |  |  | Board right-click context menu can close when live data ticks re-render the card |
| 425 | PAN-2941 | M | low | ok |  |  | OKF v3 — lease-based writes and advisory semantic auditor |
| 426 | PAN-2947 | M | low | ok |  |  | testing 1 2 3 |
| 427 | PAN-2949 | M | low | ok |  |  | Test issue — discuss-then-file flow smoke test |
| 428 | PAN-2950 | L | low | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 429 | PAN-578 | M | low | needs-refinement |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 430 | PAN-646 | M | low | needs-refinement |  |  | Canceled issues: add guided Recover workflow |
| 431 | PAN-700 | M | low | needs-refinement |  |  | Detachable terminal for conversation view — popout into OS window |
| 432 | PAN-713 | M | low | needs-refinement |  |  | test: add unit tests for doneCommand and approveCommand |
| 433 | PAN-802 | M | low | needs-refinement |  |  | Resume on conversation session forks instead of resuming |
| 434 | PAN-863 | M | low | needs-refinement |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 435 | PAN-1868 | M | low | ok |  |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 436 | PAN-1951 | M | low | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 437 | PAN-37 | M | medium | stale |  |  | Support external PR selection for merge-agent |
| 438 | PAN-38 | M | medium | stale |  |  | Support multiple merge agents per repository |
| 439 | PAN-77 | M | medium | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 440 | PAN-178 | M | low | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 441 | PAN-243 | M | medium | needs-refinement |  |  | Audit dashboard actions: ensure all are available via CLI |
| 442 | PAN-252 | M | medium | needs-refinement |  |  | Disable Sync with Main button when workspace is up to date |
| 443 | PAN-255 | M | medium | needs-refinement |  |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 444 | PAN-258 | M | medium | needs-refinement |  |  | Kanban board: fit all columns without horizontal scrolling |
| 445 | PAN-277 | M | medium | needs-refinement |  |  | Session reasoning capture & collaborative PRD refinement |
| 446 | PAN-293 | M | medium | needs-refinement |  |  | Project Living Memory — per-project semantic memory for agents |
| 447 | PAN-294 | M | medium | needs-refinement |  |  | Surface module initialization errors as system-level, not per-issue |
| 448 | PAN-407 | M | low | needs-refinement |  |  | Run Panopticon from a main workspace for development isolation |
| 449 | PAN-438 | M | low | needs-refinement |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 450 | PAN-459 | M | low | needs-refinement |  |  | Planning setup screen with SSE progress streaming |
| 451 | PAN-461 | M | low | needs-refinement |  |  | Deep-wipe multi-step progress dialog |
| 452 | PAN-468 | M | low | needs-refinement |  |  | Agent test conversations pollute production database — need test isolation |
| 453 | PAN-471 | M | low | needs-refinement |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 454 | PAN-476 | M | low | needs-refinement |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 455 | PAN-480 | M | low | needs-refinement |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 456 | PAN-483 | M | low | needs-refinement |  |  | Unify Resume Agent UX — all entry points should show message input |
| 457 | PAN-543 | M | low | needs-refinement |  |  | Add confirmation dialog before applying Optimal Defaults |
| 458 | PAN-554 | M | low | needs-refinement |  |  | Add kanban board deeplinks for issue URLs |
| 459 | PAN-564 | M | low | needs-refinement |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 460 | PAN-565 | M | low | needs-refinement |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 461 | PAN-568 | M | low | needs-refinement |  |  | Kanban: Show workspace and tmux session counts in stats |
| 462 | PAN-570 | M | low | needs-refinement |  |  | Show PLAN badge on costs when under a subscription/plan |
| 463 | PAN-571 | M | low | needs-refinement |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 464 | PAN-576 | M | low | needs-refinement |  |  | Global / search should include conversations in addition to workspace features |
| 465 | PAN-589 | M | low | needs-refinement |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 466 | PAN-591 | M | low | needs-refinement |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 467 | PAN-603 | M | low | needs-refinement |  |  | Plan review loop with configurable reviewer model |
| 468 | PAN-604 | M | low | needs-refinement |  |  | Hide planning agent from workspace detail pane |
| 469 | PAN-622 | M | low | needs-refinement |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 470 | PAN-623 | M | low | needs-refinement |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 471 | PAN-624 | M | low | needs-refinement |  |  | Loop nodes: iterative agent execution with conditional termination |
| 472 | PAN-658 | M | low | needs-refinement |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 473 | PAN-660 | M | low | needs-refinement |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 474 | PAN-663 | M | low | needs-refinement |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 475 | PAN-701 | M | low | needs-refinement |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 476 | PAN-702 | M | low | needs-refinement |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 477 | PAN-730 | M | low | needs-refinement |  |  | Add provider account telemetry for credits, balances, and usage |
| 478 | PAN-735 | M | low | needs-refinement |  |  | Settings page: review and configure overridden subagent model files |
| 479 | PAN-736 | M | low | needs-refinement |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 480 | PAN-738 | M | low | needs-refinement |  |  | Add right-click fork option to conversation list |
| 481 | PAN-743 | M | low | needs-refinement |  |  | Add consistent new conversation icon actions in Command Deck |
| 482 | PAN-747 | M | low | needs-refinement |  |  | Conversation list items lack accessible labels in accessibility tree |
| 483 | PAN-749 | M | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 484 | PAN-750 | L | low | needs-refinement |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 485 | PAN-751 | M | low | needs-refinement |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 486 | PAN-752 | M | low | needs-refinement |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 487 | PAN-762 | M | low | needs-refinement |  |  | Settings: warn when model overrides target disabled providers |
| 488 | PAN-764 | M | low | needs-refinement |  |  | Add quota/usage inspector for routed model providers |
| 489 | PAN-765 | M | low | needs-refinement |  |  | Preserve trailing zeros in cost displays |
| 490 | PAN-769 | M | low | needs-refinement |  | PAN-750 | Track verification/review/test phase churn over time |
| 491 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 492 | PAN-772 | M | low | needs-refinement |  |  | Unify terminal stack behavior across tmux sessions |
| 493 | PAN-773 | M | low | needs-refinement |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 494 | PAN-774 | M | low | needs-refinement |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 495 | PAN-775 | L | low | needs-refinement |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 496 | PAN-777 | M | low | needs-refinement |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 497 | PAN-786 | M | low | needs-refinement |  |  | Post planning Q\&A answers as issue comment |
| 498 | PAN-790 | L | low | needs-refinement |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 499 | PAN-791 | M | low | needs-refinement |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 500 | PAN-793 | M | low | needs-refinement |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 501 | PAN-797 | M | low | needs-refinement |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 502 | PAN-810 | M | low | needs-refinement |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 503 | PAN-832 | M | low | needs-refinement |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 504 | PAN-833 | M | low | needs-refinement |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 505 | PAN-853 | L | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 506 | PAN-898 | M | low | needs-refinement |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 507 | PAN-908 | M | low | needs-refinement |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 508 | PAN-943 | M | low | needs-refinement |  |  | Add memory file review and management command |
| 509 | PAN-944 | M | low | needs-refinement |  |  | Make vBRIEF the durable task graph source of truth |
| 510 | PAN-961 | M | low | needs-refinement |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 511 | PAN-962 | M | low | needs-refinement |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 512 | PAN-984 | M | low | needs-refinement |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 513 | PAN-1049 | M | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 514 | PAN-1051 | M | low | needs-refinement |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 515 | PAN-1063 | M | low | needs-refinement |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 516 | PAN-1064 | M | low | needs-refinement |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 517 | PAN-1065 | M | low | needs-refinement |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 518 | PAN-1066 | M | low | needs-refinement |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 519 | PAN-1116 | M | low | needs-refinement |  |  | Memory: cross-project search mode |
| 520 | PAN-1117 | M | low | needs-refinement |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 521 | PAN-1121 | M | low | needs-refinement |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 522 | PAN-1124 | M | low | needs-refinement |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 523 | PAN-1126 | M | low | needs-refinement |  |  | Integrate TLDR summaries into review context manifest |
| 524 | PAN-1133 | M | low | needs-refinement |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 525 | PAN-1135 | M | low | needs-refinement |  |  | Document the hook system in docs/HOOKS.md |
| 526 | PAN-1136 | M | low | needs-refinement |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 527 | PAN-1152 | M | low | needs-refinement |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 528 | PAN-1153 | M | low | needs-refinement |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 529 | PAN-1166 | M | low | needs-refinement |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 530 | PAN-1208 | M | low | needs-refinement |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 531 | PAN-1222 | M | low | needs-refinement |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 532 | PAN-1242 | M | low | needs-refinement |  |  | Create a new issue directly from a kanban column |
| 533 | PAN-1325 | M | low | ok |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 534 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 535 | PAN-1479 | M | low | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 536 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 537 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 538 | PAN-1483 | M | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 539 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 540 | PAN-1550 | M | low | ok |  |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 541 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 542 | PAN-1553 | M | low | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 543 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 544 | PAN-1640 | M | low | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 545 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 546 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 547 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 548 | PAN-1667 | M | low | ok |  |  | feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 549 | PAN-1668 | M | low | ok |  |  | bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 550 | PAN-1669 | M | low | ok |  |  | bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 551 | PAN-1691 | M | low | ok |  |  | feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 552 | PAN-1696 | M | low | ok |  |  | Merge train becomes per-project — works without a Flywheel run, multi-project view |
| 553 | PAN-1728 | M | low | ok |  |  | bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 554 | PAN-1735 | M | low | ok |  |  | feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 555 | PAN-1748 | M | low | ok |  |  | feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 556 | PAN-1750 | M | low | ok |  |  | feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 557 | PAN-1751 | M | low | ok |  |  | feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 558 | PAN-1754 | M | low | ok |  |  | feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 559 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 560 | PAN-1761 | M | low | ok |  |  | bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the  |
| 561 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 562 | PAN-1775 | M | low | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 563 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 564 | PAN-1846 | M | low | ok |  |  | bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 565 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 566 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 567 | PAN-1906 | M | low | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 568 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every |
| 569 | PAN-1910 | M | low | ok |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 570 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 571 | PAN-1926 | M | low | ok |  |  | feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 572 | PAN-1936 | M | low | ok |  |  | Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 573 | PAN-1937 | M | low | ok |  |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 574 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 575 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 576 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 577 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 578 | PAN-1984 | M | low | ok |  | PAN-1983 | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 579 | PAN-1988 | M | low | ok |  | PAN-1984 | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 580 | PAN-1990 | L | low | ok |  |  | First-class workspaces and projects with per-workspace memory |
| 581 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 582 | PAN-2002 | M | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 583 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 584 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 585 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 586 | PAN-2074 | M | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 587 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 588 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 589 | PAN-2091 | M | low | ok |  |  | chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 590 | PAN-2195 | M | low | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 591 | PAN-2197 | M | low | ok |  |  | bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 592 | PAN-2210 | M | low | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 593 | PAN-2211 | M | low | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 594 | PAN-2212 | M | low | ok |  |  | Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 595 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 596 | PAN-2287 | M | low | ok |  |  | bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file |
| 597 | PAN-2066 | L | high | ok |  |  | OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page |
| 597 | PAN-2308 | M | low | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal |
| 598 | PAN-2343 | M | low | ok |  |  | docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 599 | PAN-2344 | M | low | ok |  |  | docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 600 | PAN-2345 | M | low | ok |  |  | docs: refresh pan-done.md — update, harden, make useful |
| 601 | PAN-2346 | M | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 602 | PAN-2347 | M | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 603 | PAN-2348 | M | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 604 | PAN-2350 | XL | low | ok |  |  | Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone |
| 605 | PAN-2351 | M | low | ok |  | PAN-1166 | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 606 | PAN-2352 | M | low | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 607 | PAN-2353 | M | low | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 608 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 609 | PAN-2356 | M | low | ok |  |  | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 610 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 611 | PAN-2381 | M | low | ok |  |  | bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 612 | PAN-2390 | M | low | ok |  |  | systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid o |
| 613 | PAN-2392 | M | low | ok |  |  | feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 614 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 615 | PAN-2395 | M | low | ok |  |  | bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversa |
| 616 | PAN-2399 | M | low | ok |  |  | feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 617 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 618 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 619 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 620 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 621 | PAN-52 | M | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 622 | PAN-54 | L | low | stale |  |  | feat: Add pan test:e2e command for full workflow integration test |
| 623 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 624 | PAN-106 | M | low | stale |  |  | Cost prediction/estimation for in-progress work |
| 625 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 626 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 627 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 628 | PAN-176 | M | low | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 629 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 630 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 631 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 632 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 633 | PAN-227 | M | low | needs-refinement |  |  | Phase gate validation — mid-implementation acceptance checks |
| 634 | PAN-228 | M | low | needs-refinement |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 635 | PAN-241 | L | low | needs-refinement |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 636 | PAN-249 | M | low | needs-refinement |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 637 | PAN-265 | M | low | needs-refinement |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 638 | PAN-271 | M | low | needs-refinement |  |  | Auto-assign Linear project from project config when creating issues |
| 639 | PAN-283 | M | low | needs-refinement |  |  | Reset should sync workspace feature branch with latest main |
| 640 | PAN-297 | M | low | needs-refinement |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 641 | PAN-298 | M | low | needs-refinement |  |  | Auto-detect package manager and runtime in workspace setup |
| 642 | PAN-299 | M | low | needs-refinement |  |  | Granular session state persistence across context compaction |
| 643 | PAN-633 | M | low | needs-refinement |  |  | Update Cloister PRD and docs index — stale relative to implementation |
| 644 | PAN-634 | M | low | needs-refinement |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 645 | PAN-674 | M | low | needs-refinement |  |  | docs: add glossary of Panopticon domain terms |
| 646 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 647 | PAN-1683 | M | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling o |
| 648 | PAN-2067 | M | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 649 | PAN-2068 | M | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 650 | PAN-2070 | M | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 651 | PAN-2071 | M | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 652 | PAN-2073 | M | low | ok |  |  | docs: add user-facing page for the Desktop App |

## Rationale detail

### PAN-2858 (rank 1)

Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.

### PAN-2952 (rank 2)

Critical substrate bug: review verdict persistence is racy and loses signals; same class as PAN-2583.

### PAN-2940 (rank 3)

Critical substrate: ~2h empty merge gate, 4 strike spawns; needs pre-merge CI for direct pushes.

### PAN-2935 (rank 5)

Critical: MYN workspaces half-broken; duplicate Traefik labels route to unreachable backend.

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2954 (rank 6)

Critical: MIN-880 incident, 9 containers stranded; all GitLab projects (MYN/Auricle) affected.

### PAN-2882 (rank 7)

Critical substrate: false planned_backlog + mislabeled post_merge_limbo for every GitLab project.

### PAN-2876 (rank 7)

When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.

### PAN-2838 (rank 7)

In-progress UI polish; pinned.

### PAN-2569 (rank 8)

Critical substrate: 2/2 order-book dispatches dead silent handoff.

### PAN-2932 (rank 9)

Critical substrate: intermittent 6-min 502 Bad Gateway after pan reload; needs profile.

### PAN-2516 (rank 11)

Critical substrate: primary worktree drift; blocks flywheel push loop.

### PAN-2567 (rank 13)

High substrate: PAN-2372 cycled 55min; merge never fires.

### PAN-2706 (rank 14)

High substrate: PAN-2683 hung in testing forever.

### PAN-2599 (rank 14)

Planned/in-progress analytics integration; pinned.

### PAN-2874 (rank 15)

High: 4 strike PRs sat green-but-unmerged; needs strike-role carve-out.

### PAN-2946 (rank 16)

High substrate: every patrol cycle spams + skips first-completion detection; trivial fix.

### PAN-2848 (rank 17)

High: PAN-2377 stalled 100min; swarm-off suppresses recovery.

### PAN-2888 (rank 18)

High: dashboard metrics chronically inflated; erodes trust; orphaned inspect sub-agents.

### PAN-2379 (rank 20)

High substrate: blocks swarm convergence permanently.

### PAN-2759 (rank 21)

High substrate: 2h unattended pipeline window; reconcile path failed.

### PAN-2883 (rank 22)

High: every strike hits this; deploy row not overridable.

### PAN-2921 (rank 23)

High: PAN-2918 strike landed twice; needs reconcile-before-retry guard.

### PAN-2905 (rank 24)

High: performance regression; every endpoint slow under normal load.

### PAN-2945 (rank 25)

High: polyrepo (MIN-880) blocked on .devcontainer/dev/.pan false positives.

### PAN-2593 (rank 37)

High substrate: verification fails on styleText export under wrong Node.

### PAN-2650 (rank 38)

High substrate: PAN-2607 slot-3 stuck 18h; no failed-merge record.

### PAN-2886 (rank 39)

High: work agents stuck troubled forever; mid-spawn sentinel leak.

### PAN-2895 (rank 40)

In-pipeline. Resume retries a missing JSONL instead of falling back to a fresh session, dead-ending every crash/reboot recovery path.

### PAN-2957 (rank 40)

High substrate: tsc/vite cache race produces wrong bundle; workaround exists but blocks deploys.

### PAN-2896 (rank 41)

High substrate: every dashboard restart costs 20-60s first-click latency.

### PAN-2511 (rank 43)

High substrate: per-issue cycle-time sink; EPERM on git.

### PAN-2639 (rank 44)

High substrate: every codex reviewer 401s at startup.

### PAN-2709 (rank 45)

High substrate: agents auto-resume flywheel; resume always fails when stopped.

### PAN-2377 (rank 49)

substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.

### PAN-2521 (rank 56)

High substrate: codex modal wedges autonomous agents.

### PAN-2718 (rank 57)

High substrate: autonomous restarts park dialog on operator.

### PAN-2802 (rank 58)

High: PAN-2794 blocked forever on transient infra failure.

### PAN-2824 (rank 59)

High: pan review pending hard-dead on lexerra 404.

### PAN-2850 (rank 60)

High substrate: clean-checkout test broken; flaky contributor experience.

### PAN-2430 (rank 63)

High substrate: blocks verification for any frontend-scoped issue.

### PAN-2451 (rank 64)

High substrate: PAN-2207 frozen 35min; 108 commits ahead cannot push.

### PAN-2629 (rank 65)

High substrate: kickoff delivery unreliable; PUZ-1 idle at empty prompt.

### PAN-2720 (rank 66)

High substrate: anti-gaming defect; 2 strikes bent around it in one day.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-20T10:06:12Z",
  "model": "glm-5.2",
  "pass": "incremental",
  "openCount": 652,
  "nodes": [
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2952",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review verdict writes lost to per-issue record-lock collisions — 3 stores disagree",
      "rationale": "Critical substrate bug: review verdict persistence is racy and loses signals; same class as PAN-2583.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 3,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Three red-mains in one day: direct-push series bypasses PR CI",
      "rationale": "Critical substrate: ~2h empty merge gate, 4 strike spawns; needs pre-merge CI for direct pushes.",
      "gate": "auto",
      "planning": "auto"
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
      "issue": "PAN-2935",
      "rank": 5,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks Traefik — 50% API 504s",
      "rationale": "Critical: MYN workspaces half-broken; duplicate Traefik labels route to unreachable backend.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects — teardown/labels never run",
      "rationale": "Critical: MIN-880 incident, 9 containers stranded; all GitLab projects (MYN/Auricle) affected.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2882",
      "rank": 7,
      "size": "L",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "No GitLab merged-MR oracle — squash-merged GitLab branches show as unmerged",
      "rationale": "Critical substrate: false planned_backlog + mislabeled post_merge_limbo for every GitLab project.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 8,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning finalizes but work agent never auto-spawns — silent handoff",
      "rationale": "Critical substrate: 2/2 order-book dispatches dead silent handoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 9,
      "size": "L",
      "importance": "critical",
      "score": 88,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard boot wedge between Cloister start and ReadModel bootstrap",
      "rationale": "Critical substrate: intermittent 6-min 502 Bad Gateway after pan reload; needs profile.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2377",
      "rank": 49,
      "size": "XL",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "first-class 'special orders' runs — operator-supplied order book executed with lane semantics",
      "rationale": "substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 11,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips uncommitted — spec-vs-record drift + flywheel push block",
      "rationale": "Critical substrate: primary worktree drift; blocks flywheel push loop.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2066",
      "rank": 597,
      "size": "L",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2567",
      "rank": 13,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "reviewed+green PR stuck — advancing verdict reconciles forever, no merge",
      "rationale": "High substrate: PAN-2372 cycled 55min; merge never fires.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every dispatch — never-kicked-off reads running",
      "rationale": "High substrate: PAN-2683 hung in testing forever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 15,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike landing: verification gate demands vBRIEF strikes never have",
      "rationale": "High: 4 strike PRs sat green-but-unmerged; needs strike-role carve-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2946",
      "rank": 16,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon crashes on null lastActivity in checkFirstCompletionAgents every patrol",
      "rationale": "High substrate: every patrol cycle spams + skips first-completion detection; trivial fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 17,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on dead inspection — no re-dispatch, no verdict",
      "rationale": "High: PAN-2377 stalled 100min; swarm-off suppresses recovery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 18,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out leaves residue inflating troubled/failed metrics on CLOSED issues",
      "rationale": "High: dashboard metrics chronically inflated; erodes trust; orphaned inspect sub-agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2858",
      "rank": 1,
      "size": "XL",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight",
      "rationale": "Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 20,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "verify-gate dep install warn-only + 60s timeout — false failures vs empty node_modules",
      "rationale": "High substrate: blocks swarm convergence permanently.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 21,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel never auto-relaunched after reboot — sat idle 2h",
      "rationale": "High substrate: 2h unattended pipeline window; reconcile path failed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 22,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out deploy row fails for every strike-landed issue — hardcoded feature/ branch",
      "rationale": "High: every strike hits this; deploy row not overridable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 23,
      "size": "S",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door can land same head twice after fetch failure",
      "rationale": "High: PAN-2918 strike landed twice; needs reconcile-before-retry guard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% — API responses 0.5-1.5s",
      "rationale": "High: performance regression; every endpoint slow under normal load.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2945",
      "rank": 25,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done rejects Overdeck-generated runtime in polyrepo wrapper repos",
      "rationale": "High: polyrepo (MIN-880) blocked on .devcontainer/dev/.pan false positives.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2876",
      "rank": 7,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation subagent rail: list spawned subagents and open their transcripts.",
      "rationale": "When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 27,
      "size": "XL",
      "importance": "critical",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1766",
      "rank": 28,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 29,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 30,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 31,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF trans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 32,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-satu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (force",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 34,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 35,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 36,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Server children inherit bare system PATH — gates run Node 18 not 22",
      "rationale": "High substrate: verification fails on styleText export under wrong Node.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds stack",
      "rationale": "High substrate: PAN-2607 slot-3 stuck 18h; no failed-merge record.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 39,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder pending-work-spawn agents crash auto-resume with Unknown model",
      "rationale": "High: work agents stuck troubled forever; mid-spawn sentinel leak.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "npm run build intermittently produces stale frontend bundles",
      "rationale": "High substrate: tsc/vite cache race produces wrong bundle; workaround exists but blocks deploys.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2896",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery + membership caches at boot — 20-60s cold click",
      "rationale": "High substrate: every dashboard restart costs 20-60s first-click latency.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "L",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2511",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git",
      "rationale": "High substrate: per-issue cycle-time sink; EPERM on git.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 44,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays revoked refresh token — codex review convoys 401",
      "rationale": "High substrate: every codex reviewer 401s at startup.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator unreachable as notification target — feedback dead-ends",
      "rationale": "High substrate: agents auto-resume flywheel; resume always fails when stopped.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 46,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 47,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 48,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 49,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 50,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 51,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 52,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 53,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 54,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for en",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 55,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 56,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Launch pipeline agents with rate-limit model-switch reminder disabled",
      "rationale": "High substrate: codex modal wedges autonomous agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs no-dialog reconciliation flag for autonomous restarts",
      "rationale": "High substrate: autonomous restarts park dialog on operator.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2802",
      "rank": 58,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "same-head strike-ready cannot re-arm a needs-you landing",
      "rationale": "High: PAN-2794 blocked forever on transient infra failure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project lens gather fails (PAN-2820 class)",
      "rationale": "High: pan review pending hard-dead on lexerra 404.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 60,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout — pretest removes dashboard bundle",
      "rationale": "High substrate: clean-checkout test broken; flaky contributor experience.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 61,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2430",
      "rank": 63,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Frontend typecheck fails with dozens of pre-existing unused-local errors",
      "rationale": "High substrate: blocks verification for any frontend-scoped issue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 64,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit",
      "rationale": "High substrate: PAN-2207 frozen 35min; 108 commits ahead cannot push.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 65,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands — Claude Code not ready in 30s",
      "rationale": "High substrate: kickoff delivery unreliable; PUZ-1 idle at empty prompt.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 66,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines — rewards line-packing on god files",
      "rationale": "High substrate: anti-gaming defect; 2 strikes bent around it in one day.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 67,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 68,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 69,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 70,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 71,
      "size": "L",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git re",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 72,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 73,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 74,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 75,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 76,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 77,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 78,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 79,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 80,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearly merged PAN-2710 unrevie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 81,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 82,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 83,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks lik",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 84,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operat",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 85,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2820",
      "rank": 86,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2830",
      "rank": 87,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 88,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 89,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 90,
      "size": "L",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1504",
      "rank": 91,
      "size": "L",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1767",
      "rank": 92,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 93,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server route tests flake under full-suite verification load",
      "rationale": "High substrate: false verify failures.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 94,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 95,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 96,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 97,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 98,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 99,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1217",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 102,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 103,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 105,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1311",
      "rank": 106,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 107,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 108,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1424",
      "rank": 109,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1438",
      "rank": 110,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 111,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 112,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 113,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 114,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 115,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 116,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 117,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 118,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 119,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 121,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 122,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 123,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 124,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 125,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 126,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 127,
      "size": "XL",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2075",
      "rank": 128,
      "size": "XL",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "[EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2077",
      "rank": 129,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 130,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 131,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 132,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 133,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 134,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 135,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 136,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 137,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 139,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 140,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 141,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the re",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 142,
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
      "issue": "PAN-2376",
      "rank": 143,
      "size": "XL",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene, review au",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-262",
      "rank": 144,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2467",
      "rank": 145,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 146,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 147,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 148,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 149,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 150,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the iss",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 151,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(palette): Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 152,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(restart): health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 153,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(sync-main): auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2670",
      "rank": 154,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 155,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 156,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 157,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickof",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 158,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 159,
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
      "issue": "PAN-2699",
      "rank": 160,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 161,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 162,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 163,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2749",
      "rank": 164,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 165,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 166,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 167,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 168,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 169,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 170,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 171,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 172,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1416",
      "rank": 173,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 174,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1711",
      "rank": 175,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1769",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1824",
      "rank": 177,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 178,
      "size": "S",
      "importance": "high",
      "score": 56,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2838",
      "rank": 7,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project settings disclosure badge for projects with no settings",
      "rationale": "In-progress UI polish; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 180,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 181,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 182,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 183,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 184,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 185,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 186,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 187,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 188,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 189,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 190,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 191,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1226"
      ],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1240",
      "rank": 192,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 193,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 194,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 195,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 196,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 197,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 198,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 199,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 200,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 201,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 202,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 203,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 204,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N lin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 205,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 206,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 207,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 208,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + aut",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 209,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 210,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 211,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 212,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 213,
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
      "issue": "PAN-2244",
      "rank": 214,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 215,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 216,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 217,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 218,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 219,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 220,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 221,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2599",
      "rank": 14,
      "size": "L",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate PostHog product analytics + telemetry",
      "rationale": "Planned/in-progress analytics integration; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 223,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2075"
      ],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 224,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 225,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 226,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 227,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 228,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 229,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 230,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 231,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 232,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 233,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 234,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 ma",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 236,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 237,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory govern",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2556",
      "rank": 238,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into th",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 239,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall b",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2565",
      "rank": 240,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2566",
      "rank": 241,
      "size": "XL",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 242,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 243,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 244,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 245,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 246,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 247,
      "size": "XL",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land the progress-aware breaker, make dollars hone",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2646",
      "rank": 248,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 249,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 250,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2680",
      "rank": 251,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 252,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 253,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(cloister): idle nudge must not advance after failed mandatory inspection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 254,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 255,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-537",
      "rank": 256,
      "size": "M",
      "importance": "low",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-817",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-924",
      "rank": 258,
      "size": "L",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-947",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 260,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1041",
      "rank": 261,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1164",
      "rank": 262,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 263,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 264,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 265,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 267,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 268,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 269,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 272,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 273,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 275,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 277,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 278,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 279,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 281,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 282,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 283,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 284,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 285,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 286,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 287,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 289,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 290,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 291,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 293,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 294,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 295,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 296,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 297,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 298,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 299,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1244",
      "rank": 300,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 301,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 302,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 303,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 304,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 305,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 306,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 307,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 309,
      "size": "L",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 310,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 311,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1490",
      "rank": 312,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 313,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 314,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 315,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 316,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 317,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 318,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 319,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 320,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 321,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 323,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 325,
      "size": "XL",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1676",
      "rank": 326,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 327,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 328,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1710",
      "rank": 329,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — serv",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 330,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 331,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 332,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generat",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 333,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 335,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 336,
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
      "issue": "PAN-1844",
      "rank": 337,
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
      "issue": "PAN-1852",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 339,
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
      "issue": "PAN-1854",
      "rank": 340,
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
      "issue": "PAN-1915",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 342,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 343,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang sta",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 347,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 348,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 349,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 350,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 351,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 352,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 353,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 354,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 355,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 356,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 357,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 358,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 359,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 360,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 363,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 364,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 365,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-1592"
      ],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 366,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale la",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 367,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 369,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 370,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2295",
      "rank": 371,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2335",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, ",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2406",
      "rank": 373,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 374,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-w",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 375,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 376,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotati",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 377,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 378,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification cont",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 379,
      "size": "XL",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2442",
      "rank": 380,
      "size": "L",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 381,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot ado",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 382,
      "size": "L",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 383,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 384,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 385,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 386,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rul",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 387,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 388,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 389,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 390,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 391,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 392,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 393,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 394,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 395,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 396,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 397,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 398,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 399,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo iss",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 400,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 401,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 402,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 403,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(server): pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 404,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 405,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 406,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id reso",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2660",
      "rank": 407,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add safe Reset to planned action to the issue actions menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 408,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 409,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 410,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 411,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 412,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 414,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): strike merge trigger registry splits across dashboard chunks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 416,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 417,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and sit for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 418,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 419,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 420,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 421,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make overdeck not suck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 422,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 423,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2937",
      "rank": 424,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board right-click context menu can close when live data ticks re-render the card",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 425,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 — lease-based writes and advisory semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2947",
      "rank": 426,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "testing 1 2 3",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2949",
      "rank": 427,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test issue — discuss-then-file flow smoke test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 428,
      "size": "L",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-646",
      "rank": 430,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-700",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 432,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 433,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-863",
      "rank": 434,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1868",
      "rank": 435,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 437,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 439,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 36,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 441,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 442,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 443,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 444,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 445,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 450,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 452,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 453,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 456,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 458,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 460,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 462,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 465,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 466,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 467,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 469,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 471,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 472,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 477,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 482,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 483,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 484,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-750"
      ],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 494,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 495,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 498,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-810",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 505,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-908",
      "rank": 507,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 532,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge train becomes per-project — works without a Flywheel run, multi-project view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 554,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 566,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 577,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [
        "PAN-1983"
      ],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [
        "PAN-1984"
      ],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 580,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2084",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 593,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 595,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 596,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 597,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 598,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 599,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 600,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2346",
      "rank": 601,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 602,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 603,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 604,
      "size": "XL",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2351",
      "rank": 605,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [
        "PAN-1166"
      ],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2352",
      "rank": 606,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2353",
      "rank": 607,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 608,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 609,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2355",
      "rank": 610,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 611,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2390",
      "rank": 612,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid o",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 613,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 614,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversa",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 616,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 617,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 618,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 619,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 620,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 621,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 622,
      "size": "L",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 623,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 624,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 625,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 626,
      "size": "L",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 627,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 628,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 631,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-227",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 635,
      "size": "L",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 636,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 638,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 640,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 642,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 643,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 644,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 646,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling o",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 652,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
    {
      "from": "PAN-2059",
      "to": "PAN-806",
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
      "to": "PAN-43",
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
      "from": "PAN-2075",
      "to": "PAN-1844",
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
      "to": "PAN-2077",
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
      "to": "PAN-106",
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
      "to": "PAN-2392",
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
      "to": "PAN-2029",
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
      "to": "PAN-2466",
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
      "to": "PAN-2079",
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
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2467",
      "to": "PAN-2954",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-2846",
      "to": "PAN-2848",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1775",
      "to": "PAN-2075",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-2075",
      "to": "PAN-454",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-1775",
      "to": "PAN-2077",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-43",
      "to": "PAN-2080",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-2828",
      "to": "PAN-2846",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1392",
      "to": "PAN-1436",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1068",
      "to": "PAN-1149",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1226",
      "to": "PAN-1227",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-1592",
      "to": "PAN-2083",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1676",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1748",
      "to": "PAN-1755",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1769",
      "to": "PAN-1776",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1761",
      "to": "PAN-2295",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1837",
      "to": "PAN-2442",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1949",
      "to": "PAN-1951",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-622",
      "to": "PAN-623",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-622",
      "to": "PAN-624",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-750",
      "to": "PAN-751",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-750",
      "to": "PAN-769",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-1676",
      "to": "PAN-1735",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1748",
      "to": "PAN-1750",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1750",
      "to": "PAN-1754",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1770",
      "to": "PAN-1846",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1983",
      "to": "PAN-1984",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-1984",
      "to": "PAN-1988",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-1740",
      "to": "PAN-2308",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    },
    {
      "from": "PAN-1166",
      "to": "PAN-2351",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-38",
      "to": "PAN-44",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.6
    }
  ]
}
```
