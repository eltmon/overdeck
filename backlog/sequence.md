# Backlog Sequence

_Last sequenced: 2026-07-20T07:02:32Z · model: glm-5.2 · open: 652_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2858 | L | high | needs-refinement |  |  | ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight |
| 2 | PAN-2940 | M | critical | needs-refinement |  |  | Three red-mains in one day from direct main pushes; needs a pre-merge CI surface for conversation series. |
| 3 | PAN-2817 | M | critical | ok |  |  | Redrive idle-at-prompt work/review agents — gpt-5.6-sol stops at composer mid-task for hours. |
| 4 | PAN-2886 | M | critical | ok |  |  | Placeholder 'pending-work-spawn' model crashes auto-resume → agents stranded troubled forever. |
| 5 | PAN-2880 | L | critical | ok |  |  | Linear listIssues is a 3N+1 request storm — one MYN gather burns the entire 2500/hr budget. |
| 6 | PAN-806 | M | critical | ok |  | PAN-807 | Substrate work; improves the foundation required for reliable shipping. |
| 7 | PAN-2876 | M | high | ok |  |  | Conversation subagent rail: list spawned subagents and open their transcripts. |
| 7 | PAN-2838 | S | medium | ok |  |  | Project settings disclosure badge for projects with no settings |
| 8 | PAN-2874 | L | critical | ok |  |  | Strike landing can't merge: verify gate demands a vBRIEF checklist strikes never have + feedback wedges on exited strike agents. |
| 9 | PAN-2882 | L | critical | ok |  |  | Pipeline membership has no GitLab merged-MR oracle — squash-merged branches read as unmerged. |
| 10 | PAN-1560 | M | critical | ok |  |  | Re-review after PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED forever. |
| 11 | PAN-2952 | M | critical | ok |  | PAN-2948 | Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB. |
| 12 | PAN-1650 | L | critical | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship when gates pass. |
| 13 | PAN-2948 | L | critical | ok |  |  | Review pipeline is polyrepo-blind: empty context manifest, wrapper-repo push failures, stale verdicts (MYN). |
| 14 | PAN-2599 | L | high | ok |  |  | Integrate PostHog product analytics + telemetry |
| 15 | PAN-2567 | M | critical | ok |  |  | Reviewed+green PR stuck — deacon reconciles 'advancing verdict' every patrol, never dispatches test/merge. |
| 16 | PAN-2569 | M | critical | ok |  |  | Planning finalizes (issue→planned) but work agent never auto-spawns — silent stall. |
| 17 | PAN-2650 | L | critical | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; no recovery path. |
| 18 | PAN-1454 | L | critical | ok |  |  | [META] 9 systemic failure patterns from 80-issue audit — substrate work to prevent each. |
| 19 | PAN-2932 | M | critical | needs-refinement |  |  | Intermittent boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (502) after pan reload. |
| 20 | PAN-2324 | S | critical | ok |  |  | Close-out label transition fails atomically on missing 'in-planning' label — closed-out label never applies. |
| 21 | PAN-807 | L | critical | ok |  | PAN-806 | Epic C: Workspace state sanity on spawn — stop hard-reset + pre-flight checks. |
| 22 | PAN-2935 | M | critical | ok |  |  | Workspace devcontainer duplicate backend hijacks the Traefik router — 50% of workspace API calls 504. |
| 23 | PAN-2165 | M | critical | ok |  |  | pan close reports success but leaves issue OPEN / wrong labels (two distinct failures). |
| 24 | PAN-1666 | XL | critical | ok | ✓ |  | [EPIC] Pipeline Throughput Hardening — throttle deacon, on-demand specialists, slot manager, fly.io scale-out. |
| 25 | PAN-2905 | M | critical | needs-refinement |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s; profile and fix the residual burner. |
| 26 | PAN-2075 | XL | critical | ok | ✓ |  | [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline. |
| 27 | PAN-2376 | XL | critical | ok |  |  | Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge paths. |
| 28 | PAN-2186 | M | high | ok |  |  | Post-merge lifecycle can leave merged issues in-review and auto-merge rows 'merging' forever. |
| 29 | PAN-2516 | M | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks push loop. |
| 30 | PAN-2954 | M | high | ok |  | PAN-2948 | postMergeLifecycle refuses GitLab projects — merge state can't be auto-verified, teardown/labels never run. |
| 31 | PAN-2323 | M | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one. |
| 32 | PAN-2337 | M | high | ok |  |  | Reload/build atomicity: in-place `npm run build` under a live dashboard breaks every new PTY-supervisor spawn. |
| 33 | PAN-2883 | S | high | ok |  |  | Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/, misses strike/. |
| 34 | PAN-2379 | M | high | ok |  |  | Verify gate dependency install is warn-only + 60s timeout → false verify failures against partial node_modules. |
| 35 | PAN-2642 | L | high | ok | ✓ |  | [EPIC] Cost strategy: waste detection over budget policing — retire invented limits, progress-aware breaker, honest dollars. |
| 36 | PAN-2593 | S | high | ok |  |  | Dashboard server children inherit bare system PATH → verification gates run Node 18, not 22. |
| 37 | PAN-2170 | M | high | ok |  |  | Workspace Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails for every new workspace. |
| 38 | PAN-2511 | M | high | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); looks like a code regression. |
| 39 | PAN-2059 | L | high | ok | ✓ |  | [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting. |
| 40 | PAN-2179 | M | high | ok |  |  | Relaunch can leave a zombie agent — session alive but kickoff never delivered; liveness checks fooled. |
| 40 | PAN-2895 | M | high | ok |  |  | Resume path retries a session whose JSONL is missing instead of falling back to fresh — dead-ends recovery. |
| 41 | PAN-2169 | M | high | ok |  |  | kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught — deacon never respawns. |
| 42 | PAN-2079 | L | high | ok |  | PAN-2075, PAN-2717, PAN-2492, PAN-1844 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine). |
| 43 | PAN-2331 | S | high | ok |  |  | Codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no dismiss path). |
| 44 | PAN-2521 | S | high | ok |  |  | Launch pipeline agents with the harness rate-limit model-switch reminder disabled. |
| 45 | PAN-2639 | M | high | ok |  |  | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with no verdict. |
| 46 | PAN-2077 | M | high | ok |  | PAN-1775 | Substrate-complete reconciliation inventory (local tmux + remote Fly) — one resolver both surfaces consume. |
| 47 | PAN-1770 | M | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed' recurs, main carries unpushed state. |
| 48 | PAN-1504 | M | high | ok |  |  | feat(cli): pan hygiene — codify the merge/commit/push state audit as a first-class verb. |
| 49 | PAN-2377 | L | high | needs-refinement |  |  | first-class 'special orders' runs — operator-supplied order book executed with lane semantics |
| 50 | PAN-1618 | M | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start. |
| 51 | PAN-2451 | M | high | ok |  |  | Overflow-restart + auto-commit + merge-main strands work agent behind commit-msg gate. |
| 52 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote. |
| 53 | PAN-2921 | M | high | ok |  |  | Strike merge door reports fetch failure after merge and lands the same head twice (empty second PR). |
| 54 | PAN-2193 | M | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) invisible in Command Deck tree. |
| 55 | PAN-2850 | S | high | ok |  |  | npm test fails in clean checkout — pretest removes dashboard bundle that dashboard-cwd-guard test needs. |
| 56 | PAN-262 | L | high | ok |  |  | Refactor post-merge lifecycle into composable, idempotent operations. |
| 57 | PAN-2558 | L | high | ok |  |  | feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records. |
| 58 | PAN-1889 | M | high | ok |  |  | feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded. |
| 59 | PAN-2946 | S | high | ok |  |  | Deacon crashes on null lastActivity in checkFirstCompletionAgents every patrol — first-completion detection skips that cycle. |
| 60 | PAN-2189 | L | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) — supervised handoff only (TENET-10). |
| 61 | PAN-1766 | S | high | ok |  |  | Work agents hang on Claude Code .claude/** settings-file protection prompt. |
| 62 | PAN-2888 | M | high | ok |  |  | Close-out leaves stale residue (orphaned inspect sub-agents + uncleared review_status) inflating troubled/failed metrics. |
| 63 | PAN-2190 | L | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces.ts split. |
| 64 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator unreachable as a notification target — feedback dead-ends. |
| 65 | PAN-2233 | L | high | ok |  |  | refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules. |
| 66 | PAN-1313 | L | high | ok |  |  | Finish the src/lib Effect migration — remove/justify the Promise/sync compatibility bridge. |
| 67 | PAN-2430 | S | high | ok |  |  | Frontend typecheck fails with dozens of pre-existing unused-local errors — blocks verification gate. |
| 68 | PAN-2334 | M | high | ok |  |  | chore(process): write a Definition of Ready (DoR) — the bar before planning/pickup. |
| 69 | PAN-1246 | L | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586). |
| 70 | PAN-1311 | M | high | ok |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items. |
| 71 | PAN-1767 | S | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline. |
| 72 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss. |
| 73 | PAN-2830 | L | high | ok |  |  | Shared Logbook: make overdeck-state opt-in — OFF by default, local-only state, clean enable/disable. |
| 74 | PAN-2837 | L | high | ok |  | PAN-2830 | Distributed agent presence: record which machine runs each issue's agents on overdeck-state. |
| 75 | PAN-1217 | M | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-scope. |
| 76 | PAN-1218 | S | high | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch inspect. |
| 77 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of SHA guessing. |
| 78 | PAN-1196 | M | high | ok |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm). |
| 79 | PAN-2259 | M | high | ok |  |  | bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close. |
| 80 | PAN-1253 | S | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work. |
| 81 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window deadlock). |
| 82 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch — never-kicked-off session reads as 'already running'. |
| 83 | PAN-2848 | M | high | ok |  |  | Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered. |
| 84 | PAN-1578 | L | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex). |
| 85 | PAN-2358 | S | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten, not moved). |
| 87 | PAN-2106 | M | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 88 | PAN-2896 | M | high | needs-refinement |  |  | Warm resource-discovery and membership caches at boot — first click after any restart is slow. |
| 89 | PAN-1209 | M | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 90 | PAN-2908 | XL | high | needs-refinement |  |  | Make overdeck not suck — simple-by-default, conversation-first UX overhaul with CI conformance gates. |
| 91 | PAN-2421 | M | high | ok |  |  | bug(test): dashboard server route tests flake under full-suite verification load |
| 92 | PAN-2922 | L | high | needs-refinement |  | PAN-2905 | Reduce accidental orchestration complexity — one owner per runtime concern. |
| 93 | PAN-955 | M | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 94 | PAN-1198 | M | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 95 | PAN-1497 | M | high | ok |  |  | feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 96 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 97 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 98 | PAN-2080 | M | medium | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) — offline reach, fast-follow. |
| 99 | PAN-2868 | S | medium | ok |  |  | Desktop window opens at fixed 1400×900 — persist window state, default first run to maximized. |
| 100 | PAN-1452 | M | medium | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architecturally impossible post PAN-1048). |
| 101 | PAN-1451 | M | medium | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift). |
| 102 | PAN-2720 | S | medium | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to shrink. |
| 103 | PAN-1142 | M | medium | ok |  |  | Add reasoning effort level to per-role / per-conversation model config. |
| 104 | PAN-2945 | S | medium | ok |  |  | fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repo. |
| 105 | PAN-2936 | M | medium | needs-refinement |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stopping. |
| 106 | PAN-2950 | L | medium | needs-refinement |  |  | Refactor god files back under file-size ceilings after the UX overhaul. |
| 107 | PAN-2941 | M | medium | needs-refinement |  |  | OKF v3 — lease-based writes and advisory semantic auditor. |
| 108 | PAN-1538 | M | medium | ok |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 109 | PAN-1558 | M | medium | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 110 | PAN-630 | M | medium | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 111 | PAN-1254 | M | medium | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 112 | PAN-1357 | M | medium | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 113 | PAN-1424 | M | medium | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 114 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 115 | PAN-1913 | M | medium | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 116 | PAN-2937 | S | medium | ok |  |  | Board right-click context menu can close when live data ticks re-render the card. |
| 117 | PAN-1544 | M | medium | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 118 | PAN-578 | M | medium | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 119 | PAN-1416 | S | medium | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 120 | PAN-1435 | M | medium | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 121 | PAN-1915 | M | medium | ok |  |  | enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext |
| 122 | PAN-538 | S | low | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 123 | PAN-1556 | S | low | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 124 | PAN-933 | M | low | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 125 | PAN-1027 | S | low | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 126 | PAN-1436 | S | low | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 127 | PAN-2069 | S | low | ok |  |  | caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 128 | PAN-304 | S | low | ok |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 129 | PAN-1769 | L | low | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still eat |
| 130 | PAN-1525 | L | critical | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 131 | PAN-2695 | S | low | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickoff |
| 132 | PAN-2742 | S | low | ok |  |  | bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQUESTE |
| 133 | PAN-1226 | L | low | ok |  |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 134 | PAN-1433 | S | low | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 135 | PAN-1130 | S | low | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 136 | PAN-1392 | S | low | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 137 | PAN-1438 | S | low | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 138 | PAN-1440 | S | low | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 139 | PAN-247 | S | low | ok |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 140 | PAN-245 | S | low | ok |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 141 | PAN-244 | S | low | ok |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 142 | PAN-1711 | S | low | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 143 | PAN-1795 | S | low | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 144 | PAN-1824 | S | low | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 145 | PAN-1816 | S | low | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-cle |
| 146 | PAN-324 | S | low | ok |  |  | Agent detail pane missing Merge/Approve button |
| 147 | PAN-2237 | S | low | ok |  |  | bug(cli): pan plan done swallows vbrief quality lint details |
| 148 | PAN-2495 | S | low | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change |
| 149 | PAN-681 | S | low | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 150 | PAN-2656 | S | low | ok |  |  | bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 151 | PAN-2700 | S | low | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict |
| 152 | PAN-2691 | S | low | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you |
| 153 | PAN-2746 | S | low | ok |  |  | bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearly merged PAN-2710 unreviewed |
| 154 | PAN-2733 | S | low | ok |  |  | bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls) |
| 155 | PAN-2759 | S | low | ok |  | PAN-2747 | Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled |
| 156 | PAN-2758 | S | low | ok |  |  | Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever |
| 157 | PAN-2747 | S | low | ok |  |  | Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 158 | PAN-2846 | S | low | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running |
| 159 | PAN-2839 | S | low | ok |  |  | plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825) |
| 160 | PAN-49 | S | low | ok |  |  | Fix CloisterService tests that require real runtime |
| 161 | PAN-1444 | S | low | ok |  |  | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 162 | PAN-1461 | S | low | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 163 | PAN-113 | S | low | ok |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 164 | PAN-886 | S | low | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 165 | PAN-932 | S | low | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 166 | PAN-1113 | S | low | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 167 | PAN-1129 | M | low | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 168 | PAN-1149 | S | low | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 169 | PAN-1227 | M | low | needs-refinement |  |  | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 170 | PAN-1240 | S | low | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 171 | PAN-1330 | S | low | ok |  |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 172 | PAN-1386 | S | low | ok |  |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 173 | PAN-1530 | S | low | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 174 | PAN-1565 | S | low | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 175 | PAN-1571 | S | low | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N lines]"  |
| 176 | PAN-454 | M | low | ok |  |  | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 177 | PAN-1624 | S | low | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 178 | PAN-532 | M | low | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 179 | PAN-1674 | S | low | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 180 | PAN-1830 | S | low | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 181 | PAN-1828 | S | low | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 182 | PAN-334 | S | low | ok |  |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 183 | PAN-1951 | M | low | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 184 | PAN-817 | M | low | ok |  |  | Improve planning dialog layout and content fit |
| 185 | PAN-2202 | S | low | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success |
| 186 | PAN-2241 | S | low | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 187 | PAN-2243 | S | low | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 188 | PAN-2242 | S | low | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 189 | PAN-2467 | S | low | ok |  |  | Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged) |
| 190 | PAN-1040 | M | low | ok |  |  | feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 191 | PAN-2478 | S | low | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 192 | PAN-2627 | S | low | ok |  |  | bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue tr |
| 193 | PAN-2659 | S | low | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 194 | PAN-2664 | S | low | ok |  |  | bug(sync-main): auto-commit completes unresolved merge with conflict markers |
| 195 | PAN-2689 | S | low | ok |  |  | Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process |
| 196 | PAN-2672 | S | low | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 197 | PAN-2697 | S | low | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches |
| 198 | PAN-2696 | S | low | ok |  |  | Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label |
| 199 | PAN-2739 | S | low | ok |  |  | bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done nudg |
| 200 | PAN-2738 | S | low | ok |  |  | bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push |
| 201 | PAN-2734 | S | low | ok |  |  | bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers |
| 202 | PAN-2775 | S | low | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04:34Z |
| 203 | PAN-2769 | S | low | ok |  |  | review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operator co |
| 204 | PAN-2792 | S | low | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 205 | PAN-2805 | S | low | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere |
| 206 | PAN-2828 | S | low | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 207 | PAN-2824 | S | low | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 208 | PAN-1443 | M | low | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 209 | PAN-863 | M | low | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 210 | PAN-900 | S | low | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 211 | PAN-1042 | S | low | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 212 | PAN-1068 | S | low | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 213 | PAN-1128 | S | low | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 214 | PAN-1150 | S | low | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 215 | PAN-1173 | S | low | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 216 | PAN-1985 | M | low | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 217 | PAN-1995 | M | low | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 218 | PAN-1449 | S | low | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 219 | PAN-1446 | M | low | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 220 | PAN-1445 | M | low | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 221 | PAN-2335 | M | low | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do NO |
| 222 | PAN-1673 | S | low | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 223 | PAN-1751 | M | low | ok |  |  | feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 224 | PAN-2582 | M | low | ok |  |  | feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 225 | PAN-1912 | S | low | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 226 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 227 | PAN-38 | M | low | ok |  |  | Support multiple merge agents per repository |
| 228 | PAN-37 | M | low | ok |  |  | Support external PR selection for merge-agent |
| 229 | PAN-924 | M | low | ok |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 230 | PAN-2210 | M | low | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 231 | PAN-2212 | M | low | ok |  |  | Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 232 | PAN-947 | M | low | ok |  |  | feat: project management actions in unified sidebar |
| 233 | PAN-2244 | S | low | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land) |
| 234 | PAN-2240 | S | low | ok |  |  | bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 235 | PAN-958 | M | low | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 236 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree remov |
| 237 | PAN-537 | M | low | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 238 | PAN-1037 | M | low | ok |  |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 239 | PAN-1041 | M | low | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 240 | PAN-2550 | S | low | ok |  |  | bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level |
| 241 | PAN-2547 | S | low | ok |  |  | bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure |
| 242 | PAN-2546 | S | low | ok |  |  | bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery |
| 243 | PAN-2554 | S | low | ok |  |  | bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable |
| 244 | PAN-2563 | S | low | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 245 | PAN-646 | M | low | ok |  |  | Canceled issues: add guided Recover workflow |
| 246 | PAN-2580 | S | low | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie |
| 247 | PAN-709 | M | low | ok |  |  | feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 248 | PAN-2649 | S | low | ok |  |  | bug(palette): Ctrl+K conversation search indexes Claude transcripts only |
| 249 | PAN-2670 | S | low | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors) |
| 250 | PAN-2663 | S | low | ok |  |  | bug(restart): health probe can accept old dashboard after replacement EADDRINUSE |
| 251 | PAN-2686 | S | low | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 252 | PAN-2678 | M | low | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 253 | PAN-2699 | S | low | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace gate |
| 254 | PAN-2717 | S | low | ok |  |  | bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse |
| 255 | PAN-2763 | S | low | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids |
| 256 | PAN-2749 | S | low | ok |  |  | Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed |
| 257 | PAN-2761 | S | low | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks like a r |
| 258 | PAN-1164 | M | low | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 259 | PAN-2802 | S | low | ok |  |  | bug(cloister): same-head strike-ready cannot re-arm a needs-you landing |
| 260 | PAN-2820 | S | low | ok |  |  | CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback) |
| 261 | PAN-47 | M | low | ok |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 262 | PAN-810 | M | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 263 | PAN-1432 | M | low | ok |  |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 264 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 265 | PAN-277 | M | low | ok |  |  | Session reasoning capture & collaborative PRD refinement |
| 266 | PAN-1577 | M | low | ok |  |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 267 | PAN-1657 | M | low | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 268 | PAN-1655 | M | low | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 269 | PAN-1672 | M | low | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 270 | PAN-178 | M | low | ok |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 271 | PAN-176 | S | low | ok |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 272 | PAN-1840 | M | low | ok |  |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 273 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 274 | PAN-1967 | M | low | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 275 | PAN-1965 | M | low | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 276 | PAN-2065 | M | low | ok |  |  | feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 277 | PAN-1627 | M | low | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approve h |
| 278 | PAN-548 | M | low | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 279 | PAN-607 | M | low | ok |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 280 | PAN-613 | M | low | ok |  |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 281 | PAN-1735 | M | low | ok |  |  | feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 282 | PAN-637 | M | low | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 283 | PAN-678 | M | low | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 284 | PAN-675 | M | low | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 285 | PAN-1868 | S | low | ok |  |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 286 | PAN-2949 | S | low | needs-refinement |  |  | Test issue — discuss-then-file flow smoke test. |
| 287 | PAN-2947 | S | low | needs-refinement |  |  | testing 1 2 3. |
| 288 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 289 | PAN-77 | M | low | ok |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 290 | PAN-903 | M | low | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 291 | PAN-938 | M | low | ok |  |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 292 | PAN-2201 | S | low | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels |
| 293 | PAN-2211 | M | low | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 294 | PAN-2213 | M | low | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 295 | PAN-480 | S | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 296 | PAN-2399 | M | low | ok |  |  | feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 297 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 298 | PAN-2469 | M | low | ok |  |  | feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN-2388 |
| 299 | PAN-2466 | M | low | ok |  |  | bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring) |
| 300 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 301 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 302 | PAN-1060 | S | low | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 303 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 304 | PAN-634 | M | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 305 | PAN-633 | M | low | ok |  |  | Update Cloister PRD and docs index — stale relative to implementation |
| 306 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 307 | PAN-700 | M | low | ok |  |  | Detachable terminal for conversation view — popout into OS window |
| 308 | PAN-713 | M | low | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 309 | PAN-727 | M | low | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 310 | PAN-1151 | M | low | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 311 | PAN-1165 | M | low | ok |  |  | Lightweight review path for small/trivial PRs |
| 312 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 313 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 314 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 315 | PAN-778 | M | low | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 316 | PAN-802 | M | low | ok |  |  | Resume on conversation session forks instead of resuming |
| 317 | PAN-44 | M | low | ok |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 318 | PAN-52 | M | low | ok |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 319 | PAN-51 | M | low | ok |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 320 | PAN-1437 | M | low | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 321 | PAN-243 | M | low | ok |  |  | Audit dashboard actions: ensure all are available via CLI |
| 322 | PAN-255 | M | low | ok |  |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 323 | PAN-252 | M | low | ok |  |  | Disable Sync with Main button when workspace is up to date |
| 324 | PAN-1489 | M | low | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 325 | PAN-1485 | M | low | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 326 | PAN-1473 | L | low | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 327 | PAN-1469 | M | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 328 | PAN-258 | M | low | ok |  |  | Kanban board: fit all columns without horizontal scrolling |
| 329 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 330 | PAN-1542 | M | low | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 331 | PAN-1545 | M | low | ok |  |  | feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 332 | PAN-293 | M | low | ok |  |  | Project Living Memory — per-project semantic memory for agents |
| 333 | PAN-294 | M | low | ok |  |  | Surface module initialization errors as system-level, not per-issue |
| 334 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 335 | PAN-1656 | M | low | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 336 | PAN-1676 | M | low | ok |  |  | feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 337 | PAN-1684 | M | low | ok |  |  | docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 338 | PAN-190 | M | low | ok |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 339 | PAN-175 | M | low | ok |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 340 | PAN-1126 | M | low | ok |  |  | Integrate TLDR summaries into review context manifest |
| 341 | PAN-1839 | M | low | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 342 | PAN-1837 | M | low | ok |  |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 343 | PAN-1154 | M | low | ok |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 344 | PAN-1245 | M | low | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 345 | PAN-2004 | M | low | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 346 | PAN-241 | L | low | ok |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 347 | PAN-2035 | M | low | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 348 | PAN-2032 | M | low | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 349 | PAN-265 | M | low | ok |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 350 | PAN-271 | M | low | ok |  |  | Auto-assign Linear project from project config when creating issues |
| 351 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 352 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 353 | PAN-2266 | M | low | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 354 | PAN-299 | M | low | ok |  |  | Granular session state persistence across context compaction |
| 355 | PAN-297 | M | low | ok |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 356 | PAN-2288 | L | low | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up) |
| 357 | PAN-450 | M | low | ok |  |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 358 | PAN-452 | M | low | ok |  |  | Conversation input bar — mode/permissions/workspace selectors |
| 359 | PAN-466 | M | low | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 360 | PAN-465 | M | low | ok |  |  | Add OpenRouter as a model provider |
| 361 | PAN-463 | M | low | ok |  |  | Add Qwen 3.6+ model support |
| 362 | PAN-531 | M | low | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 363 | PAN-546 | M | low | ok |  |  | Remove claude-code-router — all providers use direct env var injection |
| 364 | PAN-1668 | M | low | ok |  |  | bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 365 | PAN-606 | M | low | ok |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 366 | PAN-1691 | M | low | ok |  |  | feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 367 | PAN-1696 | M | low | ok |  |  | Merge train becomes per-project — works without a Flywheel run, multi-project view |
| 368 | PAN-2548 | M | low | ok |  |  | chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker |
| 369 | PAN-629 | M | low | ok |  |  | Workspace quotas and resource governance |
| 370 | PAN-1740 | S | low | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 371 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 372 | PAN-1750 | M | low | ok |  |  | feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 373 | PAN-654 | M | low | ok |  |  | Project Setup Wizard — Dashboard UI |
| 374 | PAN-649 | M | low | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 375 | PAN-687 | M | low | ok |  |  | Support OpenCode as alternative coding agent |
| 376 | PAN-2646 | M | low | ok |  |  | feat(swarm): configurable global/project/issue policy UI with default OFF |
| 377 | PAN-2685 | M | low | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 378 | PAN-1936 | M | low | ok |  |  | Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 379 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 380 | PAN-2008 | M | low | ok |  |  | feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 381 | PAN-818 | M | low | ok |  |  | Make summary optional when forking conversations |
| 382 | PAN-902 | M | low | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 383 | PAN-901 | M | low | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 384 | PAN-2197 | M | low | ok |  |  | bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 385 | PAN-2195 | M | low | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 386 | PAN-949 | M | low | ok |  |  | feat: add conversation for project from sidebar |
| 387 | PAN-2308 | M | low | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals (fo |
| 388 | PAN-2347 | M | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 389 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 390 | PAN-2390 | M | low | ok |  |  | systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on the |
| 391 | PAN-2414 | M | low | ok |  |  | bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation re |
| 392 | PAN-2416 | M | low | ok |  |  | bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively |
| 393 | PAN-2424 | L | low | ok |  |  | Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remote ov |
| 394 | PAN-2442 | M | low | ok |  |  | feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and prompt-d |
| 395 | PAN-571 | M | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 396 | PAN-570 | M | low | ok |  |  | Show PLAN badge on costs when under a subscription/plan |
| 397 | PAN-568 | S | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 398 | PAN-2484 | M | low | ok |  |  | fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule add |
| 399 | PAN-589 | M | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 400 | PAN-2506 | M | low | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 401 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 402 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 403 | PAN-2549 | M | low | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 404 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 405 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 406 | PAN-2625 | M | low | ok |  |  | feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 407 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 408 | PAN-2651 | M | low | ok |  |  | fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset |
| 409 | PAN-2668 | M | low | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery |
| 410 | PAN-736 | M | low | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 411 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 412 | PAN-2813 | M | low | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 413 | PAN-774 | M | low | ok |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 414 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 415 | PAN-1223 | M | low | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 416 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 417 | PAN-793 | M | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 418 | PAN-43 | M | low | ok |  |  | Add Slack and email notifications for agent events |
| 419 | PAN-55 | M | low | ok |  |  | Track specialist costs with time period filtering |
| 420 | PAN-54 | M | low | ok |  |  | feat: Add pan test:e2e command for full workflow integration test |
| 421 | PAN-1442 | M | low | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 422 | PAN-1490 | M | low | ok |  |  | feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 423 | PAN-106 | M | low | ok |  |  | Cost prediction/estimation for in-progress work |
| 424 | PAN-1524 | M | low | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 425 | PAN-853 | M | low | ok |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 426 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 427 | PAN-927 | L | low | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 428 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 429 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 430 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 431 | PAN-1623 | M | low | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 432 | PAN-1654 | M | low | ok |  |  | perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 433 | PAN-1653 | M | low | ok |  |  | perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 434 | PAN-146 | M | low | ok |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 435 | PAN-155 | L | low | ok |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 436 | PAN-1685 | M | low | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 437 | PAN-1066 | M | low | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 438 | PAN-180 | M | low | ok |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 439 | PAN-177 | M | low | ok |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 440 | PAN-198 | M | low | ok |  |  | Structured audit trail for agent actions |
| 441 | PAN-1776 | M | low | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 442 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 443 | PAN-1844 | M | low | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 444 | PAN-1854 | M | low | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 445 | PAN-1852 | M | low | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 446 | PAN-1853 | M | low | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 447 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 448 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 449 | PAN-1916 | M | low | ok |  |  | feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 450 | PAN-1968 | S | low | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 451 | PAN-1244 | M | low | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 452 | PAN-1991 | L | low | ok |  |  | Issue cockpit redesign — incremental rollout (tracking) |
| 453 | PAN-1325 | M | low | ok |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 454 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 455 | PAN-227 | M | low | ok |  |  | Phase gate validation — mid-implementation acceptance checks |
| 456 | PAN-228 | M | low | ok |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 457 | PAN-249 | M | low | ok |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 458 | PAN-2034 | M | low | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 459 | PAN-2033 | M | low | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 460 | PAN-2031 | M | low | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 461 | PAN-2030 | M | low | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 462 | PAN-2029 | S | low | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 463 | PAN-2028 | M | low | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 464 | PAN-2026 | M | low | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 465 | PAN-2025 | M | low | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 466 | PAN-2024 | M | low | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 467 | PAN-1480 | M | low | ok |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 468 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 469 | PAN-283 | M | low | ok |  |  | Reset should sync workspace feature branch with latest main |
| 470 | PAN-298 | M | low | ok |  |  | Auto-detect package manager and runtime in workspace setup |
| 471 | PAN-2295 | M | low | needs-refinement |  |  | feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 472 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 473 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 474 | PAN-1640 | M | low | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 475 | PAN-1669 | M | low | ok |  |  | bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 476 | PAN-1683 | M | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out of |
| 477 | PAN-1710 | M | low | ok |  |  | bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server bo |
| 478 | PAN-1728 | M | low | ok |  |  | bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 479 | PAN-2557 | M | low | ok |  |  | feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor |
| 480 | PAN-2556 | M | low | ok |  |  | feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into the iss |
| 481 | PAN-2553 | M | low | ok |  |  | feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 482 | PAN-2566 | L | low | ok |  |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 483 | PAN-2565 | M | low | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 484 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 485 | PAN-1774 | M | low | ok |  |  | bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 486 | PAN-1755 | M | low | ok |  |  | bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 487 | PAN-2609 | M | low | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 488 | PAN-2608 | M | low | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 489 | PAN-1846 | M | low | ok |  |  | bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 490 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 491 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 492 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywhere |
| 493 | PAN-1906 | M | low | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 494 | PAN-1910 | S | low | ok |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 495 | PAN-2718 | S | low | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator |
| 496 | PAN-1918 | M | low | ok |  |  | bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls t |
| 497 | PAN-1926 | M | low | ok |  |  | feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 498 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 499 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 500 | PAN-1988 | M | low | ok |  |  | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 501 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 502 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 503 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 504 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 505 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 506 | PAN-2071 | M | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 507 | PAN-2070 | M | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 508 | PAN-407 | M | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 509 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 510 | PAN-2280 | M | low | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.) |
| 511 | PAN-438 | M | low | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 512 | PAN-2356 | M | low | ok |  |  | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 513 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 514 | PAN-2348 | M | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 515 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 516 | PAN-471 | M | low | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 517 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 518 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database — need test isolation |
| 519 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX — all entry points should show message input |
| 520 | PAN-2423 | M | low | ok |  |  | bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification container |
| 521 | PAN-2408 | M | low | ok |  |  | bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-worksp |
| 522 | PAN-2443 | M | low | ok |  |  | feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption |
| 523 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 524 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 525 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 526 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 527 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 528 | PAN-2487 | M | low | ok |  |  | feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 529 | PAN-591 | M | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 530 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 531 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 532 | PAN-2526 | L | low | ok |  |  | Refactor deacon.ts below file-size baseline |
| 533 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 534 | PAN-2560 | M | low | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall back t |
| 535 | PAN-674 | M | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 536 | PAN-663 | M | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 537 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 538 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 539 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 540 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 541 | PAN-2626 | M | low | ok |  |  | feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 542 | PAN-701 | M | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 543 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 544 | PAN-2660 | M | low | ok |  |  | Add safe Reset to planned action to the issue actions menu |
| 545 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 546 | PAN-2680 | M | low | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 547 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 548 | PAN-743 | M | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 549 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 550 | PAN-2754 | M | low | ok |  |  | bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 551 | PAN-2755 | M | low | ok |  |  | bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 552 | PAN-747 | S | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 553 | PAN-749 | M | low | ok |  |  | Research and borrow best features from gstack |
| 554 | PAN-750 | L | low | ok |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 555 | PAN-751 | M | low | ok |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 556 | PAN-2810 | M | low | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 557 | PAN-2809 | M | low | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 558 | PAN-2806 | M | low | ok |  |  | bug(cloister): strike merge trigger registry splits across dashboard chunks |
| 559 | PAN-2796 | M | low | ok |  |  | fix(cloister): idle nudge must not advance after failed mandatory inspection |
| 560 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 561 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 562 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 563 | PAN-771 | M | low | ok |  |  | Investigate Vercel Sandbox execution backend support |
| 564 | PAN-773 | M | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 565 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 566 | PAN-790 | L | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 567 | PAN-791 | M | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 568 | PAN-797 | M | low | ok |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 569 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 570 | PAN-984 | M | low | ok |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 571 | PAN-1051 | M | low | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 572 | PAN-1049 | M | low | ok |  |  | Spike: evaluate Tauri v2 desktop shell |
| 573 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 574 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 575 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 576 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 577 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 578 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 579 | PAN-1123 | M | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 580 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 581 | PAN-1152 | M | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 582 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 583 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 584 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 585 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 586 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 587 | PAN-1483 | M | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 588 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 589 | PAN-1479 | M | low | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 590 | PAN-1474 | M | low | ok |  |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 591 | PAN-1553 | M | low | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 592 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 593 | PAN-1550 | M | low | ok |  |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 594 | PAN-1572 | M | low | ok |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 595 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 596 | PAN-1667 | M | low | ok |  |  | feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 597 | PAN-2066 | M | high | needs-refinement |  |  | OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page |
| 598 | PAN-1720 | M | low | ok |  |  | bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 599 | PAN-1761 | M | low | ok |  |  | bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-* |
| 600 | PAN-1754 | M | low | ok |  |  | feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 601 | PAN-1748 | M | low | ok |  |  | feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 602 | PAN-1775 | M | low | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 603 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 604 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 605 | PAN-1937 | M | low | ok |  |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 606 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 607 | PAN-1983 | L | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 608 | PAN-1990 | M | low | ok |  |  | First-class workspaces and projects with per-workspace memory |
| 609 | PAN-1984 | M | low | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 610 | PAN-2002 | M | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 611 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 612 | PAN-2091 | M | low | ok |  |  | chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 613 | PAN-2074 | M | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 614 | PAN-2073 | M | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 615 | PAN-2068 | M | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 616 | PAN-2067 | M | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 617 | PAN-2287 | M | low | ok |  |  | bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file |
| 618 | PAN-2352 | M | low | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 619 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 620 | PAN-2353 | M | low | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 621 | PAN-2351 | M | low | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 622 | PAN-2350 | L | low | ok |  |  | Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone |
| 623 | PAN-2346 | M | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 624 | PAN-2345 | M | low | ok |  |  | docs: refresh pan-done.md — update, harden, make useful |
| 625 | PAN-2344 | M | low | ok |  |  | docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 626 | PAN-2343 | M | low | ok |  |  | docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 627 | PAN-2381 | M | low | ok |  |  | bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 628 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 629 | PAN-2392 | M | low | ok |  |  | feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 630 | PAN-2395 | M | low | ok |  |  | bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation  |
| 631 | PAN-2428 | S | low | ok |  |  | bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label make  |
| 632 | PAN-2422 | M | low | ok |  |  | bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 633 | PAN-2409 | M | low | ok |  |  | feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07-06 |
| 634 | PAN-2444 | M | low | ok |  |  | feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 635 | PAN-2454 | M | low | ok |  |  | bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches |
| 636 | PAN-2465 | M | low | ok |  |  | bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero |
| 637 | PAN-2492 | M | low | ok |  |  | bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only the  |
| 638 | PAN-2493 | M | low | ok |  |  | feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 639 | PAN-2491 | M | low | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 640 | PAN-2489 | M | low | ok |  |  | bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 641 | PAN-2501 | M | low | ok |  |  | bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/**  |
| 642 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 643 | PAN-2533 | M | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 644 | PAN-2572 | M | low | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 645 | PAN-2600 | M | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 646 | PAN-2635 | M | low | ok |  |  | chore(server): pay down the 152-error src/dashboard/server typecheck debt |
| 647 | PAN-2652 | M | low | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id resolutio |
| 648 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 649 | PAN-2667 | M | low | ok |  |  | Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 650 | PAN-2767 | M | low | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 651 | PAN-2836 | M | low | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |

## Rationale detail

### PAN-2858 (rank 1)

Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.

### PAN-2940 (rank 2)

Systemic fix for the red-main class: conversations push multi-commit refactors to main bypassing PR CI. A pre-merge gate prevents the recurring outage.

### PAN-2817 (rank 3)

Systemic across RUN-63: gpt-5.6-sol agents (work AND review-coordinator) stop at the composer prompt with incomplete work and nothing redrives them — one agent idled 6h burning $82, several review-coordinators idled 4h+. A `pan tell` nudge reliably unsticks them, so the fix is a patrol that joins `lastActivity` staleness + incomplete-work signals into a redrive. This is the dominant cost-and-throughput sink in the fleet right now.

### PAN-2886 (rank 4)

Spawn routes write `model: 'pending-work-spawn'` as a mid-spawn placeholder; if the spawn dies before real model resolution, the agent row keeps the sentinel, transitions to stopped, and `resumeAgent` throws `Unknown model "pending-work-spawn"`. After 3 failures the troubled gate trips and the deacon correctly refuses to retry — so the agent is permanently stranded. PAN-2377 and PAN-2829 both hit this on 2026-07-18. Two-line guard: treat the sentinel as 'starting' regardless of status.

### PAN-2880 (rank 5)

`normalizeIssue` awaits three lazy Linear-SDK relations per issue (state, assignee, labels) and the membership gather paginates the ENTIRE team history with no limit — one gather for ~880 MIN issues costs ~2,700 requests, the full hourly budget in a single call. This breaks `pan close`, label ops, and every other GraphQL/Linear path for an hour after each gather. Fix is one raw GraphQL query per page inlining the relations.

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2876 (rank 7)

When a conversation spawns Claude Code subagents (Agent tool — Explore, general-purpose), their work is invisible today: only a collapsed `Agent <desc>` row shows. The rail makes each subagent inspectable, which is the difference between trusting a delegated investigation and being able to verify it. In-progress; pin.

### PAN-2838 (rank 7)

In-progress UI polish; pinned.

### PAN-2874 (rank 8)

Three defects in the strike path, all hit on the 2026-07-17 release run: the verification gate fails strikes with 'incomplete-plan-items' (strikes skip planning by design), the failure feedback tries to deliver to a strike agent that already exited after opening its PR, and CI-green strike PRs sit unmergeable. Strikes are the operator's emergency-unblock tool; when strikes themselves can't land, the pipeline has no fast path.

### PAN-2882 (rank 9)

GitLab squash-merge creates a new commit so the stale branch tip is never an ancestor of main; the GitHub-GraphQL-only `listMergedPullRequestHeadsBatched` can't see GitLab MRs at all. Result: genuinely-landed MIN issues bucket as `planned_backlog` ('unmerged branch, no PR') or `post_merge_limbo` ('landed via non-PR path') — both wrong. Blocks clean MyN pipeline hygiene; fix is a GitLab merged-MR head lookup.

### PAN-1560 (rank 10)

When `pan sync-main`/rebase moves a PR's head SHA after review already passed, re-review re-passes but the GitHub status post is gated on a `readyForMerge` false→true transition that never fires (it's already true) — so branch protection never sees `panopticon/review` on the new head and the PR is permanently BLOCKED without admin override. This strands reviewed-and-green work at the merge gate.

### PAN-2952 (rank 11)

Three stores held three answers; the reviewer's 'passed' was silently lost and the issue jammed at 'reviewing'. Re-entrant lock + versioned reconcile fixes the race.

### PAN-1650 (rank 12)

`readyForMerge` is one boolean wearing two hats and the overload causes real pain: the merge gate rejects with 'review and tests have not passed' while simultaneously reporting both as passed (the real blocker is readyForMerge=0, only ever flipped by pollers). If the deacon is paused, nothing can merge — not the API, not the dashboard MERGE button. Splitting the derived 'all gates green' signal out, event-driven, unblocks the whole merge path.

### PAN-2948 (rank 13)

For polyrepo projects review diffs the wrapper repo (changedFiles: []) and re-review pushes fail, so blocked verdicts go permanently stale.

### PAN-2599 (rank 14)

Planned/in-progress analytics integration; pinned.

### PAN-2567 (rank 15)

A work item that PASSED review with FULL CI green never merges: the deacon logs 'Reconciled journaled advancing verdict' every patrol (~55 min, 33+ cycles) with no merge and no test-role dispatch. Triggered by heavy main churn (the feature branch falls behind, each rebase re-triggers CI, never converges). Blocks the serial drain lane — the next item can't dispatch.

### PAN-2569 (rank 16)

2/2 order-book dispatches on RUN-62: planning finalized (issue→planned) but the work-agent spawn left an empty state dir and no tmux session. Manual `pan start` then worked, so the plan is fine — the complete-planning→start-agent handoff silently no-ops. In an unattended flywheel this strands the issue indefinitely with no error surfaced.

### PAN-2650 (rank 17)

A swarm's final ready-to-merge slot wedges indefinitely when the memory-governor sheds the issue's integration workspace stack — verify+merge never fires and `pan swarm recover` can't recover it (no failed-merge record). Observed PAN-2607 slot-3 stuck ~18h. The recover tool only covers failed-merge, not long-stuck ready-to-merge — a whole failure class with no mechanical owner.

### PAN-1454 (rank 18)

An 80-issue deep audit found 39% needed action and cataloged 9 distinct failure patterns (silent miss, transparent deferral, scope-creep stubs, test-plan skip, mock theater, false supersession, …). Four are already in flight (PAN-1498/1499/1500/1501); the META tracks the substrate program that prevents each mechanically. High leverage: every pattern prevented saves a class of future audit findings.

### PAN-2932 (rank 19)

Wedge left a zombie half-booted server for 6 min of 502; same build booted clean after. Stale dist chunks + reload-rebuild race is the suspect.

### PAN-2324 (rank 20)

Every `pan close` logs a non-fatal failure at the label step: the combined `gh issue edit --add-label closed-out --remove-label <many>` includes `--remove-label in-planning` (not a repo label) so gh rejects the ENTIRE edit. Result: `closed-out` never applies AND stale `in-review`/`merged`/`ready` labels persist — closed issues keep showing live lifecycle labels on the board. Undermines every clean-board effort.

### PAN-807 (rank 21)

Sister to PAN-806. The spawn flow used to hard-reset the local branch to a 2-day-old commit then commit fresh planning artifacts — losing visibility of 16 real work commits on origin (didn't lose data only because work was pushed). Pre-flight checks (fetch, compare local vs remote, abort on ahead-of-remote, abort on stray untracked) make spawn safe. Depends on Epic D; implements after A/B.

### PAN-2935 (rank 22)

Two containers with identical Traefik labels round-robined to an unreachable backend, making the MYN workspace half-broken.

### PAN-2165 (rank 23)

`pan close --force` prints every step ✓ + 'Close-out complete' but leaves the GitHub issue inconsistent: (A) the label step aborts on the first absent remove-label (same atomicity bug as PAN-2324 but in the combined path), and (B) `close-issue:transition` prints 'Closed' while the issue stays OPEN. Close-out is the terminal lifecycle event; silent failure here means the board and reality diverge with a green checkmark.

### PAN-1666 (rank 24)

Epic container. The 2026-06-07 incident: unfreezing the deacon thundering-herded ~37 stopped work agents at once (load 5→52 in 3.5 min). The epic is the keystone throughput program: throttle resume (PAN-1665), on-demand specialists, resource-slot manager with deadlock-safe advancing-role reservation, fly.io scale-out, zombie re-spawn fix. Ranked high; its children (PAN-1665/1645/1613/1556/1629/1336) are what get picked.

### PAN-2905 (rank 25)

Persistent 50% CPU at idle keeps every endpoint slow and drives the watchdog restart churn behind every cold-cache complaint.

### PAN-2075 (rank 26)

Epic container. The default-off boot gate solved the runaway-storm worry but introduced a symmetric problem: the freeze is silent, dashboard-only, tells the operator nothing about remote Fly agents spending money, and is invisible to a headless/offline operator. The epic builds one informed decision surface across local+Fly, reachable from dashboard/CLI/offline, with the Operator Inbox as the architectural spine. Children: PAN-2077/2076/2078/2079/2080.

### PAN-2376 (rank 27)

Epic-shaped (not flagged isEpic in manifest but body says 'this epic'). RUN-55 proved the codebase is healthy but the delivery machinery is the bottleneck: a single flaky test stalled a release; strike and swarm merge paths stranded finished work; `pan reload` can deploy stale code; approved PRs stall before merge with no convergence guarantee. The epic makes the CI/CD spine boring: flakes never gate, done work converges, deploys ship origin/main.

### PAN-2186 (rank 28)

Two RUN-43 auto-merges left PAN-2173 with `in-review`/`ready`/`released` and no `merged` label (PR was merged), and PAN-2174's pending auto-merge row stuck at `status: merging` after the PR merged. The Flywheel can't safely `pan close` either because the issue never reaches the allowed close-out state. Post-merge lifecycle must apply `merged`+`verifying-on-main` and remove `in-review` atomically per merge.

### PAN-2516 (rank 29)

`pan close`/`pan start`/merge-reconcile update the spec `plan.status` mirror in the working tree of the shared primary worktree but never commit/push it — so spec mirrors on main stay permanently stale for terminal issues (origin/main shows `proposed` for an issue that's been CLOSED for a week). The durable record is authoritative so the system 'knows', but the visible spec file is a lie, and the uncommitted churn blocks other agents' push loops.

### PAN-2954 (rank 30)

For GitLab projects post-merge steps never execute: no teardown (containers stay up), no labels, and the refusal falsely logs 'completed'.

### PAN-2323 (rank 31)

When the deacon respawns the flywheel after a crash/displacement (not a graceful pause), it starts a brand-new blank session — silently orphaning the operator's in-flight 4.1MB/2,735-turn conversation. Happened 2026-07-03: the operator got a 'scary blank flywheel' and recovery required manual pointer surgery. `loadResumeSessionId` only reads a file that graceful-pause writes; the crash path has no resume hook.

### PAN-2337 (rank 32)

An in-place `npm run build` (or `pan reload`'s build step) that rewrites `dist/` while the server is live silently breaks every new PTY-supervisor spawn until restart — every conversation/agent spawn times out ('Timed out waiting for PTY supervisor socket'). The live server reads `dist/pty-supervisor.js` fresh from disk on every spawn, so an under-foot rewrite wounds it. A build must not be able to wound the running server.

### PAN-2883 (rank 33)

Sister to PAN-2874: `resolveIssuePullRequestRef` hardcodes `feature/<id>` so strike-landed issues (branch `strike/<id>`) never resolve a PR → deploy row throws 'cannot resolve merge time' → close-out hard-blocked. Body marks the fix as landed, so this ranks just below the still-open strike blockers as a verification/land-it item.

### PAN-2379 (rank 34)

The verification gate installs deps with a 60s timeout and warn-only catch, then runs quality gates UNCONDITIONALLY — so a timed-out/failed install (common when several swarm slots run `bun install` concurrently) runs typecheck/tests against an empty/partial node_modules and reports a false verify failure. In a swarm this permanently blocks slot convergence: the deacon re-verifies and re-fails every patrol.

### PAN-2642 (rank 35)

Epic container. The cost-limits feature shipped with invented defaults ($10/agent, $25/issue, $100/day) the operator never chose, so the alarm sat permanently exceeded with no consumer. Operator decision: the problem is waste detection, not budget enforcement. Children are the progress-aware breaker (PAN-1868), ledger integrity (PAN-2466), retention (PAN-1042), and the Operator Inbox alert surface (PAN-2079).

### PAN-2593 (rank 36)

`pan up` launches the server with the Node 22 binary explicitly, but the process's PATH is bare system dirs (`/usr/local/sbin:...`), so every child (`execAsync('npm run typecheck')`) resolves `/usr/bin/node` = v18.19.1. Anything needing modern Node (rolldown `util.styleText`, ≥20.12) breaks — and which workspaces break depends on their dep versions, so it looks flaky. One-line boot fix: prepend `dirname(process.execPath)` to PATH.

### PAN-2170 (rank 37)

The workspace init image has no Python, so any native addon requiring node-gyp (better-sqlite3) fails to compile during setup. The Docker stack never comes up and `pan start` aborts unless the operator passes `--host`. Affects every new Docker-backed workspace, not just the one it was found on. Container isolation is the desired default; this forces everyone onto `--host`.

### PAN-2511 (rank 38)

The work-agent sandbox denies `git` subprocess execution, so any test that shells out to git (temp-repo integration tests, worktree tests) fails with `spawnSync git EPERM`. The agent doesn't recognize this as an environment artifact and spends 21+ min trying to 'fix' a verification step that can never come back clean — observed live on PAN-2167. Per-issue cycle-time sink that the flywheel had to manually interrupt.

### PAN-2059 (rank 39)

Epic container. Today an issue is auto-pickable the instant it's `ready && planned` — no operator review beat between 'a plan exists' and 'go work it', and no way for the AI to push back on bad work. The epic inserts Released (explicit operator 'go') and Objection (AI refuses with a write-up the operator overrides or parks). Self-contained work items in the body; the relevance-vet hardens the flywheel against junk-work pickup.

### PAN-2179 (rank 40)

Any stop→relaunch can yield a zombie: the claude-code session spawns but never receives the role/brief, sitting at an empty prompt. `tmux has-session`-based liveness checks are fooled (the session exists), so nothing recovers it while the agent does nothing. Broader than the flywheel — the flywheel itself diagnosed the same class on a work agent's spurious troubled gate.

### PAN-2895 (rank 40)

In-pipeline. Resume retries a missing JSONL instead of falling back to a fresh session, dead-ending every crash/reboot recovery path.

### PAN-2169 (rank 41)

PAN-1865 added overflow detection for when kimi THROWS an overflow error, but a kimi-k2.7-code agent that silently saturates to 100% ctx and freezes (no thrown string) never matches the pattern-scan, so `recoverOrphanedAgents`/overflow-recovery never triggers a respawn. Observed: frozen 10h, $0.0000 cost, no work history. Needs a context-saturation heuristic, not just an error-string match.

### PAN-2079 (rank 42)

Part of PAN-2075 — this is the architectural spine. The operator's 'things that need me' need is scattered across transient producer-specific surfaces (pending input, cost alerts, boot notification). Build one durable inbox queue; boot reconciliation is producer #1. The inbox then absorbs every other producer instead of each inventing its own notification surface.

### PAN-2331 (rank 43)

Codex/ChatGPT shows an interactive rate-limit model-switch modal in the agent's TUI; autonomous agents can't press enter/esc, so all work stops. Multiple agents stalled simultaneously. Defense-in-depth with PAN-2521: this removes the cause (suppress the reminder at config/spawn), PAN-2521 generalizes the launcher flag.

### PAN-2521 (rank 44)

Pairs with PAN-2331: apply the 'never show again' equivalent at the launcher/spawn layer so every spawned agent inherits the suppression regardless of harness. Must not change the agent's actual model — only suppress the interactive switch prompt.

### PAN-2639 (rank 45)

`pan review restart` resumes the pre-existing codex TUI session, which baked in a refresh token that a later host refresh revoked. Resuming replays the dead token, every codex reviewer 401s at startup, and the review convoy silently wedges with no verdict. Host codex auth is healthy the whole time. Fix: detect/refresh the session token or force a fresh session on resume.

### PAN-2077 (rank 46)

Part of PAN-2075. The boot reconciliation surface and CLI both need one substrate-complete inventory: every agent that exists in state but isn't verified-running, across local tmux AND remote Fly, in a single typed result. Today local orphan detection and remote visibility are separate blind spots; a running remote machine with no operator action is the high-priority (money-spending) case.

### PAN-1770 (rank 47)

During convoy bursts the auto-committer commits `.pan/` dirt, but running agents re-dirty `.pan/continues/*.vbrief.json` between commit and `git pull --rebase`, and rebase refuses with unstaged changes. Self-heals eventually but recurs noisily, leaves main with unpushed state commits, and bites any human/agent on the primary worktree with 'cannot pull with rebase'. Fix: commit-until-clean before rebasing; never autostash.

### PAN-1504 (rank 48)

The merge/commit/push hygiene check (unpushed commits, orphan branches, agent-PR-state lies, dangling work-tree) exists only as a one-off bash recipe each operator/agent writes from scratch. Codifying it as `pan hygiene` (+ `/pan-hygiene` skill) makes the audit repeatable by anyone without remembering the git+gh+tmux incantation. Directly serves the DoD 'merged is not done if the server is stale' tenet.

### PAN-2377 (rank 49)

substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.

### PAN-1618 (rank 50)

`pan start` gates on `assertWorkspaceStackHealthyForSpawn`; when the stack is down it fails hard with two MANUAL recoveries (`pan workspace rebuild` or `--host`). Under autonomous operation nobody runs either, so a fully-planned item whose stack is down sits at the gate forever. Same 'gate without recovery = infinite stall' lesson as PAN-1247's test-stack fix, one role earlier.

### PAN-2451 (rank 51)

PAN-2207's work agent froze ~35min pre-submit: the branch was 108 commits ahead with non-issue-referenced messages (merge commit, pre-sync auto-commit, overflow checkpoint) that fail the commit-msg gate. The agent explains the fix but stalls pre-submit. The auto-commit + overflow-checkpoint messages need either issue-reference trailers or a commit-msg carve-out.

### PAN-2078 (rank 52)

Part of PAN-2075. `pan up` is frequently headless with no browser; the same boot-reconciliation decision must be fully actionable from the CLI so an operator or automated boot can resolve the held fleet without the UI. The headless leg of the epic.

### PAN-2921 (rank 53)

After a transport error the recovery path didn't reconcile that the head was already on main, merging a second empty PR.

### PAN-2193 (rank 54)

`resolvePipelineMembership` decides membership purely from PR/branch lenses — an open issue with no branch and no PR (exactly the held-but-never-started case) returns `clean_terminal` and is dropped from the tree, never inspecting `objection`/`parked`/`vetoed`/`needs-handoff` labels. Contradicts the resolver's own stated definition. Operator watching the pipeline tree never sees held items that need their decision.

### PAN-2850 (rank 55)

`npm test` deterministically fails in a clean workspace at `dashboard-cwd-guard.test.ts` because `pretest` runs `build:cli` (which cleans `dist/`) without rebuilding `dist/dashboard/server.js` before the test calls `spawnDashboardDetached()`. Clean-checkout test failure is a contributor-onboarding and CI-reliability substrate bug.

### PAN-262 (rank 56)

Post-merge cleanup is fragmented across 3+ code paths with duplicated, missing, and inconsistent operations — polyrepo merge never moves PRDs, neither merge path cleans up the worktree or stops the agent, `closeIssueAfterMerge` is called from 3+ locations (race risk), and `.planning/` artifacts are permanently lost on teardown with no archive step. The god-fragmentation is the root of PAN-2186/2165/2324-class close-out bugs.

### PAN-2558 (rank 57)

Polyrepo projects break the overdeck-state migration's git-repo assumption: MyN's project root isn't a git repo, so `.pan`/`.beads` live at a non-git root and MyN's pipeline state is committed to no git repo at all — a standing data-loss risk. The `infra` sub-repo is the natural state-host; `resolveInfraRepo()` needs a `pan_records` config to find it.

### PAN-1889 (rank 58)

FLYWHEEL-STATE.md is read whole at the start of every run; by RUN-35 it was 2,826 lines / 212KB / ~53K tokens, mostly stale RUN-1…33 play-by-play that no longer informs decisions. Contradicts the documented intent (per-run reports were deliberately split out so this file could be curated durable memory). Every run pays a context tax proportional to history.

### PAN-2946 (rank 59)

Every patrol throws on a null-lastActivity record, spamming logs and silently skipping first-completion detection. Guard the read + test.

### PAN-2189 (rank 60)

The deacon is pipeline-runtime code that drives the whole agent lifecycle; an autonomous refactor that reddens main stalls every merge (the codebase-health red-main incident is the proof case). Behavior-preserving extraction into focused modules under 1000 lines, full `npm test` green, source-introspection tests repointed in the same PR. needs-handoff (supervised), not autonomous pickup.

### PAN-1766 (rank 61)

Claude Code's settings-file protection for `.claude/**` is a gate distinct from normal tool permissions and can't be auto-approved — any agent editing `.claude/rules/*.md` hangs indefinitely on the 'allow Claude to edit its own settings' prompt. Observed ~90 min frozen on PAN-1579. Real fix likely option 2: steer agents to edit `sync-sources/rules/` (source of truth) since rendered `.claude/rules/` copies are clobbered by `pan sync` anyway.

### PAN-2888 (rank 62)

'troubled: 14-16' is chronically inflated by residue on CLOSED issues (real count 0), eroding trust and masking genuine stalls.

### PAN-2190 (rank 63)

merge-ops.ts is a NEW >1000-line file created BY the workspaces.ts decomposition — the shrink-only file-size guard permitted it (green ≠ small). It owns merge-route logic (pipeline-runtime), so supervised dispatch (TENET-10). Same extraction pattern as PAN-2189.

### PAN-2709 (rank 64)

Agents that need to notify the flywheel resolve it as a resumable agent and try to auto-resume to deliver feedback; the resume always fails when the run is stopped (no resumable session artifact). The feedback path dead-ends. Both 2026-07-15 strikes hit this independently — finished fixes with green gates, neither could tell the flywheel.

### PAN-2233 (rank 65)

postMergeLifecycle and merge-handoff machinery in one 1,414-line file. Idempotency is locked by `tests/unit/lib/cloister/in-flight-guard.test.ts` (must stay green) and the Docker network cleanup step must NEVER be removed (per CLAUDE.md). Supervised dispatch (TENET-10) — pipeline-machinery.

### PAN-1313 (rank 66)

PAN-1249 shipped the Effect migration as an additive bridge (Promise APIs preserved alongside Effect siblings) to avoid a caller-breakage cascade. The migration is incomplete until the bridge is removed or explicitly justified — live code still carries Promise-era surfaces and Effect boundary bridges in the original migration's scope. Canonical tracking issue.

### PAN-2430 (rank 67)

The quality gate fails on main with dozens of unused-local errors in frontend files the gate imports — pre-existing, unrelated to any single feature, but they block verification for issues whose changed-file scope pulls the frontend typecheck. Short-term relax `noUnusedLocals`; long-term clean up the unused imports/variables and re-enable.

### PAN-2334 (rank 68)

We just closed PAN-1456/1453/1498/1499 as junk — a stuck month-old audit loop dependent on a down CLIProxy + exhausted quota. Nothing flagged them as not-ready, so they sat consuming an agent and slamming the quota wall. A DoR (concrete deliverable, self-contained mechanically-checkable ACs, dependencies met) + a vetting hook at the pickup gate would have caught each.

### PAN-1246 (rank 69)

Port t3code's VCS optimization: consolidate git shellouts behind a typed Effect-native driver fed from a SQLite projection of the read model, capping output (~98% faster diff loading in their case). Directly fits the checkpoint/review-context/merge-agent/inspect-check files that PAN-1313 will classify. Separate perf/arch change from the migration completion.

### PAN-1311 (rank 70)

Surfaced during the src/lib Effect migration: 254-file mechanical migration ran ~9 files/hour through swarm vs ~110 files/hour via direct parallel Agent calls — a ~12x speedup. Six overheads identified (amortized setup, per-file PR roundtrip, slot-merge detection cycle, sibling conflicts). A fast-track tier for trivial items bypasses slot dispatch for the same speedup within swarm.

### PAN-1767 (rank 71)

The merged-unclosed queue reached 21 deep with no first-class surface. Beyond visibility: merged-unclosed issues aren't free — misfire dispatch paths have repeatedly dispatched roles onto merged issues (burning slots against the concurrency governor), each holds workspace/branch/state dir/tmux resources, and close-out is the terminal event v1.0 telemetry can't collect without. Add `awaitingCloseOut: N` to the headline.

### PAN-2333 (rank 72)

As codex weekly quota nears exhaustion, agents freeze at the rate-limit modal AND the dashboard needs-you surface is a dead-end (it lists frozen agents but clicking shows 'agent already answered'). No proactive 'remaining quota' visibility — the first signal is a wall of frozen agents. Detect quota pressure proactively and surface remaining quota.

### PAN-2830 (rank 73)

Overdeck auto-migrates every git project onto the `overdeck-state` orphan branch and pushes to origin without asking. Make it an explicit opt-in feature ('Shared Logbook'): OFF by default (local-only under `${OVERDECK_HOME}/state/<project>/`), a settings section explaining the branch, and a clean disable path. Respects the user's repo footprint.

### PAN-2837 (rank 74)

Make the state branch answer 'is anything working on this issue, and where?' from any machine. Today no surface can — agent runtime is strictly machine-local. Add a coarse low-churn presence block (claim/release, no heartbeats) to the per-issue record. Building block for multi-machine/multi-developer; depends on PAN-2830 making the branch opt-in first.

### PAN-1217 (rank 75)

The requirements reviewer treats the ENTIRE vBRIEF AC list as in-scope for every PR — PAN-1148 produced a coverage matrix with 180 ACs and 19 partial !-blockers for a single PR, asking the current PR to fix whole-feature items. Synthesis can demote (PAN-1216) but downstream — we still pay the cost of generating noise synthesis scrubs. Classify each AC against the PR diff upstream.

### PAN-1218 (rank 76)

Bead inspection adds ~3-5 min per bead when it fires; compile/lint passed in 100% of blocked cases (Check 3 never produces the verdict), and 2 of 6 recent blocks were tracked-file policy violations not real defects. The verification gate already runs typecheck+lint+test after done. Drop Check 3, restrict to foundation beads, move to end-of-batch.

### PAN-1219 (rank 77)

Synthesis derives 'prior cycle SHA' by reading the second-newest review dir and pulling the SHA from synthesis.md — fragile (relies on prior synthesis having recorded HEAD; deacon interleaves dirs). Persist cycle state as structured `cycle.json` so we can enforce 'don't re-promote a finding the prior cycle already saw as non-blocking' directly.

### PAN-1196 (rank 78)

Every bead executes on the same model regardless of complexity; per-bead difficulty is captured and ignored by the model picker. Add a subject-matter taxonomy (docs/api/backend/frontend/infra/test/refactor) and route by difficulty — cheap models for trivial beads, expensive for expert. Direct cost optimization without changing outcomes.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-20T07:02:32Z",
  "model": "glm-5.2",
  "pass": "incremental",
  "openCount": 652,
  "nodes": [
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
      "issue": "PAN-2817",
      "rank": 3,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redrive idle-at-prompt work/review agents — gpt-5.6-sol stops at composer mid-task for hours.",
      "rationale": "Systemic across RUN-63: gpt-5.6-sol agents (work AND review-coordinator) stop at the composer prompt with incomplete work and nothing redrives them — one agent idled 6h burning $82, several review-coordinators idled 4h+. A `pan tell` nudge reliably unsticks them, so the fix is a patrol that joins `lastActivity` staleness + incomplete-work signals into a redrive. This is the dominant cost-and-throughput sink in the fleet right now.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 4,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder 'pending-work-spawn' model crashes auto-resume → agents stranded troubled forever.",
      "rationale": "Spawn routes write `model: 'pending-work-spawn'` as a mid-spawn placeholder; if the spawn dies before real model resolution, the agent row keeps the sentinel, transitions to stopped, and `resumeAgent` throws `Unknown model \"pending-work-spawn\"`. After 3 failures the troubled gate trips and the deacon correctly refuses to retry — so the agent is permanently stranded. PAN-2377 and PAN-2829 both hit this on 2026-07-18. Two-line guard: treat the sentinel as 'starting' regardless of status.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 5,
      "size": "L",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear listIssues is a 3N+1 request storm — one MYN gather burns the entire 2500/hr budget.",
      "rationale": "`normalizeIssue` awaits three lazy Linear-SDK relations per issue (state, assignee, labels) and the membership gather paginates the ENTIRE team history with no limit — one gather for ~880 MIN issues costs ~2,700 requests, the full hourly budget in a single call. This breaks `pan close`, label ops, and every other GraphQL/Linear path for an hour after each gather. Fix is one raw GraphQL query per page inlining the relations.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [
        "PAN-807"
      ],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2876",
      "rank": 7,
      "size": "M",
      "importance": "high",
      "score": 82,
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
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project settings disclosure badge for projects with no settings",
      "rationale": "In-progress UI polish; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 8,
      "size": "L",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike landing can't merge: verify gate demands a vBRIEF checklist strikes never have + feedback wedges on exited strike agents.",
      "rationale": "Three defects in the strike path, all hit on the 2026-07-17 release run: the verification gate fails strikes with 'incomplete-plan-items' (strikes skip planning by design), the failure feedback tries to deliver to a strike agent that already exited after opening its PR, and CI-green strike PRs sit unmergeable. Strikes are the operator's emergency-unblock tool; when strikes themselves can't land, the pipeline has no fast path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2882",
      "rank": 9,
      "size": "L",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership has no GitLab merged-MR oracle — squash-merged branches read as unmerged.",
      "rationale": "GitLab squash-merge creates a new commit so the stale branch tip is never an ancestor of main; the GitHub-GraphQL-only `listMergedPullRequestHeadsBatched` can't see GitLab MRs at all. Result: genuinely-landed MIN issues bucket as `planned_backlog` ('unmerged branch, no PR') or `post_merge_limbo` ('landed via non-PR path') — both wrong. Blocks clean MyN pipeline hygiene; fix is a GitLab merged-MR head lookup.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED forever.",
      "rationale": "When `pan sync-main`/rebase moves a PR's head SHA after review already passed, re-review re-passes but the GitHub status post is gated on a `readyForMerge` false→true transition that never fires (it's already true) — so branch protection never sees `panopticon/review` on the new head and the PR is permanently BLOCKED without admin override. This strands reviewed-and-green work at the merge gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2952",
      "rank": 11,
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
      "issue": "PAN-1650",
      "rank": 12,
      "size": "L",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship when gates pass.",
      "rationale": "`readyForMerge` is one boolean wearing two hats and the overload causes real pain: the merge gate rejects with 'review and tests have not passed' while simultaneously reporting both as passed (the real blocker is readyForMerge=0, only ever flipped by pollers). If the deacon is paused, nothing can merge — not the API, not the dashboard MERGE button. Splitting the derived 'all gates green' signal out, event-driven, unblocks the whole merge path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2948",
      "rank": 13,
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
      "issue": "PAN-2599",
      "rank": 14,
      "size": "L",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate PostHog product analytics + telemetry",
      "rationale": "Planned/in-progress analytics integration; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewed+green PR stuck — deacon reconciles 'advancing verdict' every patrol, never dispatches test/merge.",
      "rationale": "A work item that PASSED review with FULL CI green never merges: the deacon logs 'Reconciled journaled advancing verdict' every patrol (~55 min, 33+ cycles) with no merge and no test-role dispatch. Triggered by heavy main churn (the feature branch falls behind, each rebase re-triggers CI, never converges). Blocks the serial drain lane — the next item can't dispatch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning finalizes (issue→planned) but work agent never auto-spawns — silent stall.",
      "rationale": "2/2 order-book dispatches on RUN-62: planning finalized (issue→planned) but the work-agent spawn left an empty state dir and no tmux session. Manual `pan start` then worked, so the plan is fine — the complete-planning→start-agent handoff silently no-ops. In an unattended flywheel this strands the issue indefinitely with no error surfaced.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 17,
      "size": "L",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; no recovery path.",
      "rationale": "A swarm's final ready-to-merge slot wedges indefinitely when the memory-governor sheds the issue's integration workspace stack — verify+merge never fires and `pan swarm recover` can't recover it (no failed-merge record). Observed PAN-2607 slot-3 stuck ~18h. The recover tool only covers failed-merge, not long-stuck ready-to-merge — a whole failure class with no mechanical owner.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 18,
      "size": "L",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns from 80-issue audit — substrate work to prevent each.",
      "rationale": "An 80-issue deep audit found 39% needed action and cataloged 9 distinct failure patterns (silent miss, transparent deferral, scope-creep stubs, test-plan skip, mock theater, false supersession, …). Four are already in flight (PAN-1498/1499/1500/1501); the META tracks the substrate program that prevents each mechanically. High leverage: every pattern prevented saves a class of future audit findings.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2932",
      "rank": 19,
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
      "issue": "PAN-2324",
      "rank": 20,
      "size": "S",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label transition fails atomically on missing 'in-planning' label — closed-out label never applies.",
      "rationale": "Every `pan close` logs a non-fatal failure at the label step: the combined `gh issue edit --add-label closed-out --remove-label <many>` includes `--remove-label in-planning` (not a repo label) so gh rejects the ENTIRE edit. Result: `closed-out` never applies AND stale `in-review`/`merged`/`ready` labels persist — closed issues keep showing live lifecycle labels on the board. Undermines every clean-board effort.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 21,
      "size": "L",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [
        "PAN-806"
      ],
      "why": "Epic C: Workspace state sanity on spawn — stop hard-reset + pre-flight checks.",
      "rationale": "Sister to PAN-806. The spawn flow used to hard-reset the local branch to a 2-day-old commit then commit fresh planning artifacts — losing visibility of 16 real work commits on origin (didn't lose data only because work was pushed). Pre-flight checks (fetch, compare local vs remote, abort on ahead-of-remote, abort on stray untracked) make spawn safe. Depends on Epic D; implements after A/B.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2935",
      "rank": 22,
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
      "issue": "PAN-2165",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close reports success but leaves issue OPEN / wrong labels (two distinct failures).",
      "rationale": "`pan close --force` prints every step ✓ + 'Close-out complete' but leaves the GitHub issue inconsistent: (A) the label step aborts on the first absent remove-label (same atomicity bug as PAN-2324 but in the combined path), and (B) `close-issue:transition` prints 'Closed' while the issue stays OPEN. Close-out is the terminal lifecycle event; silent failure here means the board and reality diverge with a green checkmark.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 24,
      "size": "XL",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Pipeline Throughput Hardening — throttle deacon, on-demand specialists, slot manager, fly.io scale-out.",
      "rationale": "Epic container. The 2026-06-07 incident: unfreezing the deacon thundering-herded ~37 stopped work agents at once (load 5→52 in 3.5 min). The epic is the keystone throughput program: throttle resume (PAN-1665), on-demand specialists, resource-slot manager with deadlock-safe advancing-role reservation, fly.io scale-out, zombie re-spawn fix. Ranked high; its children (PAN-1665/1645/1613/1556/1629/1336) are what get picked.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2905",
      "rank": 25,
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
      "issue": "PAN-2075",
      "rank": 26,
      "size": "XL",
      "importance": "critical",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline.",
      "rationale": "Epic container. The default-off boot gate solved the runaway-storm worry but introduced a symmetric problem: the freeze is silent, dashboard-only, tells the operator nothing about remote Fly agents spending money, and is invisible to a headless/offline operator. The epic builds one informed decision surface across local+Fly, reachable from dashboard/CLI/offline, with the Operator Inbox as the architectural spine. Children: PAN-2077/2076/2078/2079/2080.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2376",
      "rank": 27,
      "size": "XL",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge paths.",
      "rationale": "Epic-shaped (not flagged isEpic in manifest but body says 'this epic'). RUN-55 proved the codebase is healthy but the delivery machinery is the bottleneck: a single flaky test stalled a release; strike and swarm merge paths stranded finished work; `pan reload` can deploy stale code; approved PRs stall before merge with no convergence guarantee. The epic makes the CI/CD spine boring: flakes never gate, done work converges, deploys ship origin/main.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2186",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge lifecycle can leave merged issues in-review and auto-merge rows 'merging' forever.",
      "rationale": "Two RUN-43 auto-merges left PAN-2173 with `in-review`/`ready`/`released` and no `merged` label (PR was merged), and PAN-2174's pending auto-merge row stuck at `status: merging` after the PR merged. The Flywheel can't safely `pan close` either because the issue never reaches the allowed close-out state. Post-merge lifecycle must apply `merged`+`verifying-on-main` and remove `in-review` atomically per merge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 29,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks push loop.",
      "rationale": "`pan close`/`pan start`/merge-reconcile update the spec `plan.status` mirror in the working tree of the shared primary worktree but never commit/push it — so spec mirrors on main stay permanently stale for terminal issues (origin/main shows `proposed` for an issue that's been CLOSED for a week). The durable record is authoritative so the system 'knows', but the visible spec file is a lie, and the uncommitted churn blocks other agents' push loops.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 30,
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
      "issue": "PAN-2323",
      "rank": 31,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one.",
      "rationale": "When the deacon respawns the flywheel after a crash/displacement (not a graceful pause), it starts a brand-new blank session — silently orphaning the operator's in-flight 4.1MB/2,735-turn conversation. Happened 2026-07-03: the operator got a 'scary blank flywheel' and recovery required manual pointer surgery. `loadResumeSessionId` only reads a file that graceful-pause writes; the crash path has no resume hook.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: in-place `npm run build` under a live dashboard breaks every new PTY-supervisor spawn.",
      "rationale": "An in-place `npm run build` (or `pan reload`'s build step) that rewrites `dist/` while the server is live silently breaks every new PTY-supervisor spawn until restart — every conversation/agent spawn times out ('Timed out waiting for PTY supervisor socket'). The live server reads `dist/pty-supervisor.js` fresh from disk on every spawn, so an under-foot rewrite wounds it. A build must not be able to wound the running server.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 33,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/, misses strike/.",
      "rationale": "Sister to PAN-2874: `resolveIssuePullRequestRef` hardcodes `feature/<id>` so strike-landed issues (branch `strike/<id>`) never resolve a PR → deploy row throws 'cannot resolve merge time' → close-out hard-blocked. Body marks the fix as landed, so this ranks just below the still-open strike blockers as a verification/land-it item.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verify gate dependency install is warn-only + 60s timeout → false verify failures against partial node_modules.",
      "rationale": "The verification gate installs deps with a 60s timeout and warn-only catch, then runs quality gates UNCONDITIONALLY — so a timed-out/failed install (common when several swarm slots run `bun install` concurrently) runs typecheck/tests against an empty/partial node_modules and reports a false verify failure. In a swarm this permanently blocks slot convergence: the deacon re-verifies and re-fails every patrol.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 35,
      "size": "L",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Cost strategy: waste detection over budget policing — retire invented limits, progress-aware breaker, honest dollars.",
      "rationale": "Epic container. The cost-limits feature shipped with invented defaults ($10/agent, $25/issue, $100/day) the operator never chose, so the alarm sat permanently exceeded with no consumer. Operator decision: the problem is waste detection, not budget enforcement. Children are the progress-aware breaker (PAN-1868), ledger integrity (PAN-2466), retention (PAN-1042), and the Operator Inbox alert surface (PAN-2079).",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2593",
      "rank": 36,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server children inherit bare system PATH → verification gates run Node 18, not 22.",
      "rationale": "`pan up` launches the server with the Node 22 binary explicitly, but the process's PATH is bare system dirs (`/usr/local/sbin:...`), so every child (`execAsync('npm run typecheck')`) resolves `/usr/bin/node` = v18.19.1. Anything needing modern Node (rolldown `util.styleText`, ≥20.12) breaks — and which workspaces break depends on their dep versions, so it looks flaky. One-line boot fix: prepend `dirname(process.execPath)` to PATH.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 37,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails for every new workspace.",
      "rationale": "The workspace init image has no Python, so any native addon requiring node-gyp (better-sqlite3) fails to compile during setup. The Docker stack never comes up and `pan start` aborts unless the operator passes `--host`. Affects every new Docker-backed workspace, not just the one it was found on. Container isolation is the desired default; this forces everyone onto `--host`.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); looks like a code regression.",
      "rationale": "The work-agent sandbox denies `git` subprocess execution, so any test that shells out to git (temp-repo integration tests, worktree tests) fails with `spawnSync git EPERM`. The agent doesn't recognize this as an environment artifact and spends 21+ min trying to 'fix' a verification step that can never come back clean — observed live on PAN-2167. Per-issue cycle-time sink that the flywheel had to manually interrupt.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 39,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting.",
      "rationale": "Epic container. Today an issue is auto-pickable the instant it's `ready && planned` — no operator review beat between 'a plan exists' and 'go work it', and no way for the AI to push back on bad work. The epic inserts Released (explicit operator 'go') and Objection (AI refuses with a write-up the operator overrides or parks). Self-contained work items in the body; the relevance-vet hardens the flywheel against junk-work pickup.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2179",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Relaunch can leave a zombie agent — session alive but kickoff never delivered; liveness checks fooled.",
      "rationale": "Any stop→relaunch can yield a zombie: the claude-code session spawns but never receives the role/brief, sitting at an empty prompt. `tmux has-session`-based liveness checks are fooled (the session exists), so nothing recovers it while the agent does nothing. Broader than the flywheel — the flywheel itself diagnosed the same class on a work agent's spurious troubled gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught — deacon never respawns.",
      "rationale": "PAN-1865 added overflow detection for when kimi THROWS an overflow error, but a kimi-k2.7-code agent that silently saturates to 100% ctx and freezes (no thrown string) never matches the pattern-scan, so `recoverOrphanedAgents`/overflow-recovery never triggers a respawn. Observed: frozen 10h, $0.0000 cost, no work history. Needs a context-saturation heuristic, not just an error-string match.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 42,
      "size": "L",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-2075",
        "PAN-2717",
        "PAN-2492",
        "PAN-1844"
      ],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine).",
      "rationale": "Part of PAN-2075 — this is the architectural spine. The operator's 'things that need me' need is scattered across transient producer-specific surfaces (pending input, cost alerts, boot notification). Build one durable inbox queue; boot reconciliation is producer #1. The inbox then absorbs every other producer instead of each inventing its own notification surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no dismiss path).",
      "rationale": "Codex/ChatGPT shows an interactive rate-limit model-switch modal in the agent's TUI; autonomous agents can't press enter/esc, so all work stops. Multiple agents stalled simultaneously. Defense-in-depth with PAN-2521: this removes the cause (suppress the reminder at config/spawn), PAN-2521 generalizes the launcher flag.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 44,
      "size": "S",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Launch pipeline agents with the harness rate-limit model-switch reminder disabled.",
      "rationale": "Pairs with PAN-2331: apply the 'never show again' equivalent at the launcher/spawn layer so every spawned agent inherits the suppression regardless of harness. Must not change the agent's actual model — only suppress the interactive switch prompt.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 45,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with no verdict.",
      "rationale": "`pan review restart` resumes the pre-existing codex TUI session, which baked in a refresh token that a later host refresh revoked. Resuming replays the dead token, every codex reviewer 401s at startup, and the review convoy silently wedges with no verdict. Host codex auth is healthy the whole time. Fix: detect/refresh the session token or force a fresh session on resume.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly) — one resolver both surfaces consume.",
      "rationale": "Part of PAN-2075. The boot reconciliation surface and CLI both need one substrate-complete inventory: every agent that exists in state but isn't verified-running, across local tmux AND remote Fly, in a single typed result. Today local orphan detection and remote visibility are separate blind spots; a running remote machine with no operator action is the high-priority (money-spending) case.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 47,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed' recurs, main carries unpushed state.",
      "rationale": "During convoy bursts the auto-committer commits `.pan/` dirt, but running agents re-dirty `.pan/continues/*.vbrief.json` between commit and `git pull --rebase`, and rebase refuses with unstaged changes. Self-heals eventually but recurs noisily, leaves main with unpushed state commits, and bites any human/agent on the primary worktree with 'cannot pull with rebase'. Fix: commit-until-clean before rebasing; never autostash.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cli): pan hygiene — codify the merge/commit/push state audit as a first-class verb.",
      "rationale": "The merge/commit/push hygiene check (unpushed commits, orphan branches, agent-PR-state lies, dangling work-tree) exists only as a one-off bash recipe each operator/agent writes from scratch. Codifying it as `pan hygiene` (+ `/pan-hygiene` skill) makes the audit repeatable by anyone without remembering the git+gh+tmux incantation. Directly serves the DoD 'merged is not done if the server is stale' tenet.",
      "gate": "auto",
      "planning": "interactive"
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
      "issue": "PAN-1618",
      "rank": 50,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start.",
      "rationale": "`pan start` gates on `assertWorkspaceStackHealthyForSpawn`; when the stack is down it fails hard with two MANUAL recoveries (`pan workspace rebuild` or `--host`). Under autonomous operation nobody runs either, so a fully-planned item whose stack is down sits at the gate forever. Same 'gate without recovery = infinite stall' lesson as PAN-1247's test-stack fix, one role earlier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overflow-restart + auto-commit + merge-main strands work agent behind commit-msg gate.",
      "rationale": "PAN-2207's work agent froze ~35min pre-submit: the branch was 108 commits ahead with non-issue-referenced messages (merge commit, pre-sync auto-commit, overflow checkpoint) that fail the commit-msg gate. The agent explains the fix but stalls pre-submit. The auto-commit + overflow-checkpoint messages need either issue-reference trailers or a commit-msg carve-out.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 52,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote.",
      "rationale": "Part of PAN-2075. `pan up` is frequently headless with no browser; the same boot-reconciliation decision must be fully actionable from the CLI so an operator or automated boot can resolve the held fleet without the UI. The headless leg of the epic.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 53,
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
      "issue": "PAN-2193",
      "rank": 54,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) invisible in Command Deck tree.",
      "rationale": "`resolvePipelineMembership` decides membership purely from PR/branch lenses — an open issue with no branch and no PR (exactly the held-but-never-started case) returns `clean_terminal` and is dropped from the tree, never inspecting `objection`/`parked`/`vetoed`/`needs-handoff` labels. Contradicts the resolver's own stated definition. Operator watching the pipeline tree never sees held items that need their decision.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 55,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout — pretest removes dashboard bundle that dashboard-cwd-guard test needs.",
      "rationale": "`npm test` deterministically fails in a clean workspace at `dashboard-cwd-guard.test.ts` because `pretest` runs `build:cli` (which cleans `dist/`) without rebuilding `dist/dashboard/server.js` before the test calls `spawnDashboardDetached()`. Clean-checkout test failure is a contributor-onboarding and CI-reliability substrate bug.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 56,
      "size": "L",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations.",
      "rationale": "Post-merge cleanup is fragmented across 3+ code paths with duplicated, missing, and inconsistent operations — polyrepo merge never moves PRDs, neither merge path cleans up the worktree or stops the agent, `closeIssueAfterMerge` is called from 3+ locations (race risk), and `.planning/` artifacts are permanently lost on teardown with no archive step. The god-fragmentation is the root of PAN-2186/2165/2324-class close-out bugs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 57,
      "size": "L",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records.",
      "rationale": "Polyrepo projects break the overdeck-state migration's git-repo assumption: MyN's project root isn't a git repo, so `.pan`/`.beads` live at a non-git root and MyN's pipeline state is committed to no git repo at all — a standing data-loss risk. The `infra` sub-repo is the natural state-host; `resolveInfraRepo()` needs a `pan_records` config to find it.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 58,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded.",
      "rationale": "FLYWHEEL-STATE.md is read whole at the start of every run; by RUN-35 it was 2,826 lines / 212KB / ~53K tokens, mostly stale RUN-1…33 play-by-play that no longer informs decisions. Contradicts the documented intent (per-run reports were deliberately split out so this file could be curated durable memory). Every run pays a context tax proportional to history.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2946",
      "rank": 59,
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
      "issue": "PAN-2189",
      "rank": 60,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — supervised handoff only (TENET-10).",
      "rationale": "The deacon is pipeline-runtime code that drives the whole agent lifecycle; an autonomous refactor that reddens main stalls every merge (the codebase-health red-main incident is the proof case). Behavior-preserving extraction into focused modules under 1000 lines, full `npm test` green, source-introspection tests repointed in the same PR. needs-handoff (supervised), not autonomous pickup.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 61,
      "size": "S",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents hang on Claude Code .claude/** settings-file protection prompt.",
      "rationale": "Claude Code's settings-file protection for `.claude/**` is a gate distinct from normal tool permissions and can't be auto-approved — any agent editing `.claude/rules/*.md` hangs indefinitely on the 'allow Claude to edit its own settings' prompt. Observed ~90 min frozen on PAN-1579. Real fix likely option 2: steer agents to edit `sync-sources/rules/` (source of truth) since rendered `.claude/rules/` copies are clobbered by `pan sync` anyway.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 62,
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
      "issue": "PAN-2190",
      "rank": 63,
      "size": "L",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces.ts split.",
      "rationale": "merge-ops.ts is a NEW >1000-line file created BY the workspaces.ts decomposition — the shrink-only file-size guard permitted it (green ≠ small). It owns merge-route logic (pipeline-runtime), so supervised dispatch (TENET-10). Same extraction pattern as PAN-2189.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 64,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator unreachable as a notification target — feedback dead-ends.",
      "rationale": "Agents that need to notify the flywheel resolve it as a resumable agent and try to auto-resume to deliver feedback; the resume always fails when the run is stopped (no resumable session artifact). The feedback path dead-ends. Both 2026-07-15 strikes hit this independently — finished fixes with green gates, neither could tell the flywheel.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 65,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules.",
      "rationale": "postMergeLifecycle and merge-handoff machinery in one 1,414-line file. Idempotency is locked by `tests/unit/lib/cloister/in-flight-guard.test.ts` (must stay green) and the Docker network cleanup step must NEVER be removed (per CLAUDE.md). Supervised dispatch (TENET-10) — pipeline-machinery.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1313",
      "rank": 66,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish the src/lib Effect migration — remove/justify the Promise/sync compatibility bridge.",
      "rationale": "PAN-1249 shipped the Effect migration as an additive bridge (Promise APIs preserved alongside Effect siblings) to avoid a caller-breakage cascade. The migration is incomplete until the bridge is removed or explicitly justified — live code still carries Promise-era surfaces and Effect boundary bridges in the original migration's scope. Canonical tracking issue.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2430",
      "rank": 67,
      "size": "S",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Frontend typecheck fails with dozens of pre-existing unused-local errors — blocks verification gate.",
      "rationale": "The quality gate fails on main with dozens of unused-local errors in frontend files the gate imports — pre-existing, unrelated to any single feature, but they block verification for issues whose changed-file scope pulls the frontend typecheck. Short-term relax `noUnusedLocals`; long-term clean up the unused imports/variables and re-enable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 68,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(process): write a Definition of Ready (DoR) — the bar before planning/pickup.",
      "rationale": "We just closed PAN-1456/1453/1498/1499 as junk — a stuck month-old audit loop dependent on a down CLIProxy + exhausted quota. Nothing flagged them as not-ready, so they sat consuming an agent and slamming the quota wall. A DoR (concrete deliverable, self-contained mechanically-checkable ACs, dependencies met) + a vetting hook at the pickup gate would have caught each.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 69,
      "size": "L",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586).",
      "rationale": "Port t3code's VCS optimization: consolidate git shellouts behind a typed Effect-native driver fed from a SQLite projection of the read model, capping output (~98% faster diff loading in their case). Directly fits the checkpoint/review-context/merge-agent/inspect-check files that PAN-1313 will classify. Separate perf/arch change from the migration completion.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1311",
      "rank": 70,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items.",
      "rationale": "Surfaced during the src/lib Effect migration: 254-file mechanical migration ran ~9 files/hour through swarm vs ~110 files/hour via direct parallel Agent calls — a ~12x speedup. Six overheads identified (amortized setup, per-file PR roundtrip, slot-merge detection cycle, sibling conflicts). A fast-track tier for trivial items bypasses slot dispatch for the same speedup within swarm.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1767",
      "rank": 71,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline.",
      "rationale": "The merged-unclosed queue reached 21 deep with no first-class surface. Beyond visibility: merged-unclosed issues aren't free — misfire dispatch paths have repeatedly dispatched roles onto merged issues (burning slots against the concurrency governor), each holds workspace/branch/state dir/tmux resources, and close-out is the terminal event v1.0 telemetry can't collect without. Add `awaitingCloseOut: N` to the headline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 72,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss.",
      "rationale": "As codex weekly quota nears exhaustion, agents freeze at the rate-limit modal AND the dashboard needs-you surface is a dead-end (it lists frozen agents but clicking shows 'agent already answered'). No proactive 'remaining quota' visibility — the first signal is a wall of frozen agents. Detect quota pressure proactively and surface remaining quota.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2830",
      "rank": 73,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Logbook: make overdeck-state opt-in — OFF by default, local-only state, clean enable/disable.",
      "rationale": "Overdeck auto-migrates every git project onto the `overdeck-state` orphan branch and pushes to origin without asking. Make it an explicit opt-in feature ('Shared Logbook'): OFF by default (local-only under `${OVERDECK_HOME}/state/<project>/`), a settings section explaining the branch, and a clean disable path. Respects the user's repo footprint.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 74,
      "size": "L",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [
        "PAN-2830"
      ],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state.",
      "rationale": "Make the state branch answer 'is anything working on this issue, and where?' from any machine. Today no surface can — agent runtime is strictly machine-local. Add a coarse low-churn presence block (claim/release, no heartbeats) to the per-issue record. Building block for multi-machine/multi-developer; depends on PAN-2830 making the branch opt-in first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 75,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-scope.",
      "rationale": "The requirements reviewer treats the ENTIRE vBRIEF AC list as in-scope for every PR — PAN-1148 produced a coverage matrix with 180 ACs and 19 partial !-blockers for a single PR, asking the current PR to fix whole-feature items. Synthesis can demote (PAN-1216) but downstream — we still pay the cost of generating noise synthesis scrubs. Classify each AC against the PR diff upstream.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 76,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch inspect.",
      "rationale": "Bead inspection adds ~3-5 min per bead when it fires; compile/lint passed in 100% of blocked cases (Check 3 never produces the verdict), and 2 of 6 recent blocks were tracked-file policy violations not real defects. The verification gate already runs typecheck+lint+test after done. Drop Check 3, restrict to foundation beads, move to end-of-batch.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 77,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of SHA guessing.",
      "rationale": "Synthesis derives 'prior cycle SHA' by reading the second-newest review dir and pulling the SHA from synthesis.md — fragile (relies on prior synthesis having recorded HEAD; deacon interleaves dirs). Persist cycle state as structured `cycle.json` so we can enforce 'don't re-promote a finding the prior cycle already saw as non-blocking' directly.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 78,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm).",
      "rationale": "Every bead executes on the same model regardless of complexity; per-bead difficulty is captured and ignored by the model picker. Add a subject-matter taxonomy (docs/api/backend/frontend/infra/test/refactor) and route by difficulty — cheap models for trivial beads, expensive for expert. Direct cost optimization without changing outcomes.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2259",
      "rank": 79,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close.",
      "rationale": "GraphQL quota hit zero 3× in one sprint, each time breaking gh issue edit (label ops), `pan close` (shells out via GraphQL), gh pr view/merge, and issue filing. REST quota untouched. Suspects: deacon/dashboard reconciliation polling PR+issue per in-pipeline issue per tick, flywheel inventory sweeps. Identify the consumer, move high-frequency polls to REST/ETags, cache per-tick, degrade gracefully when GraphQL is exhausted.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 80,
      "size": "S",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work.",
      "rationale": "The flywheel picks by P0/P1/P2 and filters by author/labels but never checks whether an issue is blocked by another open issue — 'Depends-on' declarations are decorative. Without dependency awareness it starts downstream work too early (agents write promise-based code that immediately needs re-migration) and picks blocked work over ready work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 81,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window deadlock).",
      "rationale": "kimi-k2 via CLIProxy advertises a false ~200k context window; long sessions deadlock silently (PAN-1865). omp has native DashScope auth, so kimi-k2 can run natively via ohmypi — eliminating the deadlock class. Update `resolveHarness` defaults so kimi models default to ohmypi instead of pi/CLIProxy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 82,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch — never-kicked-off session reads as 'already running'.",
      "rationale": "A test-role tmux session that spawned but never received its kickoff reads as 'already running', so every subsequent test dispatch for that issue is silently absorbed — the test never runs and no verdict is produced. Liveness checks based on session existence are fooled (PAN-2179 class). Test dispatch needs to verify the session actually received its kickoff, not just that it exists.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 83,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on a dead inspection: no re-dispatch, verdict never delivered.",
      "rationale": "When the inspection sub-agent dies, the work agent stalls forever — no re-dispatch, no verdict delivery, no escalation. The inspection lifecycle has no dead-handler. Pairs with PAN-2706 (ghost sessions) and the inspect-sub-agent orphan issue (PAN-2888) — the inspection subsystem has multiple dead-end failure modes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 84,
      "size": "L",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex).",
      "rationale": "Copilot CLI defaults to Claude Sonnet 4.5 — a Copilot-subscription user could run a first-party GitHub agent loop on Claude without an Anthropic subscription or CLIProxy. Native AGENTS.md + SKILL.md support (reads `~/.copilot/skills/` and the open `~/.agents/skills/` tree Overdeck already writes). Harness expansion; pending gating-risk evaluation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 85,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten, not moved).",
      "rationale": "PR #2332 (PAN-2145) was specced behavior-preserving but rewrote `transformMessageForHarness`: the old PAN-1535 hardening (regex-metacharacter escaping, `(?<!\\S)` lookbehind, blank-line collapse) became a plain `split().join()` — re-introducing the prompt-injection-via-@path risk PAN-1535 fixed. Restore/bless explicitly.",
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
      "issue": "PAN-2106",
      "rank": 87,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2896",
      "rank": 88,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot — first click after any restart is slow.",
      "rationale": "New enhancement: warm caches at boot so the first post-restart interaction isn't a cold-cache stall. Direct UX/velocity win.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 89,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 90,
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
      "issue": "PAN-2421",
      "rank": 91,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): dashboard server route tests flake under full-suite verification load",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 92,
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
      "issue": "PAN-955",
      "rank": 93,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 94,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 96,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 97,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 98,
      "size": "M",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach, fast-follow.",
      "rationale": "Part of PAN-2075, fast-follow after the inbox spine. Once the inbox exists, reach the operator out-of-band when they aren't looking at the dashboard — a held fleet or runaway remote agent must be able to ping via email/Slack/push/TTS. Absorbs PAN-43.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 99,
      "size": "S",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900 — persist window state, default first run to maximized.",
      "rationale": "Operator-reported (Drew): the AppImage always starts 'kind of small' and he maximizes every launch. `createWindow()` hardcodes 1400×900 with no persistence and no maximize. Standard practice: persist bounds+isMaximized, validate against connected displays, default first run to maximized. Small but operator-reported UX.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 100,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architecturally impossible post PAN-1048).",
      "rationale": "PAN-1048 retired the per-reviewer tmux session and replaced it with a single `review` run that fans out all 4 reviewers via the Agent tool — so the operator's 'restart THAT one specialist on a cheaper model' need (flip correctness Opus→Sonnet to save cost) is unachievable through the shipped UI. Options documented (accept the shape, or restore single-reviewer restart). Needs a design decision.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 101,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift).",
      "rationale": "PAN-1124 pivoted mid-implementation from 'no workspace specs' to 'workspace draft + statusOverrides overlay'. The new design is reasonable but ~half the original ACs were silently dropped (PRDs canonical at docs/prds/ on main written during planning; planning prompt still instructs workspace writes). Audit follow-up to land the dropped ACs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 102,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to shrink.",
      "rationale": "The shrink-only file-size guard passes CI while deacon.ts (3,394 lines) and merge-ops.ts (1,925 lines) remain god files — and counting lines rewards line-packing (cramming onto fewer lines) rather than actual size reduction. Switch to a byte/AST-node count or a per-file cap that the guard actively enforces downward.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 103,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config.",
      "rationale": "Defaults differ across harnesses (Claude Code defaults xhigh on Opus 4.7; Codex defaults xhigh). When we route the same `work` role across providers, effort is silently inconsistent — and per the global rule, xhigh/max multiply token cost with almost no ROI, so this must never be a default. Extend per-role/per-conversation config to accept effort; launcher translation matrix; dashboard pickers.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2945",
      "rank": 104,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repo.",
      "rationale": "New bug: pan done rejects Overdeck-generated runtime files in a polyrepo wrapper repo, blocking close-out for polyrepo projects.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 105,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stopping.",
      "rationale": "New: detect the max-steps-exceeded signal and nudge agents to continue rather than silently stopping mid-task.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 106,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul.",
      "rationale": "New: re-impose file-size ceilings on god files regressed by the UX overhaul. Substrate hygiene; lands with/after PAN-2908.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 107,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "OKF v3 — lease-based writes and advisory semantic auditor.",
      "rationale": "New enhancement: lease-based writes + semantic auditor for the knowledge format. Builds on OKF v2 (PAN-2066, in flight).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 108,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 109,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 110,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 111,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 112,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1424",
      "rank": 113,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1561",
      "rank": 114,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 115,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2937",
      "rank": 116,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board right-click context menu can close when live data ticks re-render the card.",
      "rationale": "New bug: live re-render closes an open context menu. Minor UX reliability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 117,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 118,
      "size": "M",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1416",
      "rank": 119,
      "size": "S",
      "importance": "medium",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 120,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 121,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 122,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 123,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 124,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 125,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 126,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2069",
      "rank": 127,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 128,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 129,
      "size": "L",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still eat",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "L",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2695",
      "rank": 131,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills the synthesis kickoff",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2742",
      "rank": 132,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure failure' — false CHANGES REQUESTE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 133,
      "size": "L",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1433",
      "rank": 134,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 135,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 136,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 137,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 138,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 139,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 140,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 141,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 142,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1795",
      "rank": 143,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 144,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 145,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-cle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 146,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 147,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 148,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 149,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 150,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 151,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 152,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 153,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearly merged PAN-2710 unreviewed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 154,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2759",
      "rank": 155,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [
        "PAN-2747"
      ],
      "why": "Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired and enabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 156,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stays status=running forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 157,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 158,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 159,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 160,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 161,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 162,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 163,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 164,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 165,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 166,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 167,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 168,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 169,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1240",
      "rank": 170,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 171,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 172,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 173,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 174,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 175,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N lines]\" ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 176,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 177,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 178,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1674",
      "rank": 179,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 180,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 181,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 182,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 183,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 184,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2202",
      "rank": 185,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 186,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 187,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 188,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2467",
      "rank": 189,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 190,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2478",
      "rank": 191,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 192,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue tr",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 193,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 194,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(sync-main): auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 195,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with the CLI process",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 196,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 197,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 198,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 199,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done nudg",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 200,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 201,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 202,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04:34Z",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 203,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/failed, inflating every operator co",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 204,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 205,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 206,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 207,
      "size": "S",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 208,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 209,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-900",
      "rank": 210,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 211,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 212,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 213,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 214,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 215,
      "size": "S",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 216,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 217,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 218,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 219,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 220,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 221,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do NO",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-1673",
      "rank": 222,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 223,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 224,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 225,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 226,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 227,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 228,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 229,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2210",
      "rank": 230,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 231,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 232,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 233,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 234,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 235,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 236,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree remov",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 237,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 238,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 239,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2550",
      "rank": 240,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 241,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 242,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 243,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 244,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 245,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2580",
      "rank": 246,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 247,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 248,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(palette): Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2670",
      "rank": 249,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 250,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(restart): health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 251,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 252,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 253,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 254,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 255,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2749",
      "rank": 256,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume restores the conversation but not the machinery: timers, monitors and background processes die and are never re-armed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 257,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks like a r",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 258,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2802",
      "rank": 259,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): same-head strike-ready cannot re-arm a needs-you landing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2820",
      "rank": 260,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 261,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 262,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 263,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 264,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 265,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 266,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 267,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 268,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 269,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 270,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 271,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 272,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 273,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 274,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 275,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 276,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 277,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approve h",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 278,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 279,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 280,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 281,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 282,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 283,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 284,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 285,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2949",
      "rank": 286,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Test issue — discuss-then-file flow smoke test.",
      "rationale": "Test issue from a flow smoke test — not real backlog work. Rank to the bottom.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2947",
      "rank": 287,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "testing 1 2 3.",
      "rationale": "Test/junk issue — no real work. Rank to the bottom; needs-refinement (likely close).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 288,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 289,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 290,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 291,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 292,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 293,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 294,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 295,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 296,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 297,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 298,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN-2388",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 299,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 300,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 301,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 302,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 303,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 304,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 305,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 306,
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
      "issue": "PAN-700",
      "rank": 307,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 308,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-727",
      "rank": 309,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 310,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 311,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 312,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 313,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 314,
      "size": "L",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 315,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 316,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-44",
      "rank": 317,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 318,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 319,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 320,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 321,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 322,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 323,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 324,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 325,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 326,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 327,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 328,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 329,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 330,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 331,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 332,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 333,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 334,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 335,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 336,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 337,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 338,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 339,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 340,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 341,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 342,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 343,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 344,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 345,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 346,
      "size": "L",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 347,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 348,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 349,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 350,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 351,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 352,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 353,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 354,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 355,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 356,
      "size": "L",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 357,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 358,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 359,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 360,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 361,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 362,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 363,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 364,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 365,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 366,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 367,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge train becomes per-project — works without a Flywheel run, multi-project view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 368,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 369,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 370,
      "size": "S",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 371,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 372,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 373,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 374,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 375,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 376,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2685",
      "rank": 377,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 378,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 379,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 380,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 381,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 382,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 383,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 384,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 385,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 386,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 387,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals (fo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 388,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 389,
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
      "issue": "PAN-2390",
      "rank": 390,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on the",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 391,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation re",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 392,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 393,
      "size": "L",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remote ov",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2442",
      "rank": 394,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and prompt-d",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 395,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 396,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 397,
      "size": "S",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 398,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule add",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 399,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 400,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 401,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 402,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 403,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 404,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 405,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 406,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 407,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 408,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 409,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 410,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 411,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 412,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 414,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-786",
      "rank": 416,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 417,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 418,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 419,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 420,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 421,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 422,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 423,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 424,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 425,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 426,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 427,
      "size": "L",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 428,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 430,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 432,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 433,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 434,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 435,
      "size": "L",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1066",
      "rank": 437,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 438,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 439,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1776",
      "rank": 441,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 442,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 443,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 444,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 445,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 446,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 447,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 450,
      "size": "S",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 452,
      "size": "L",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 453,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 456,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 458,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 460,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 462,
      "size": "S",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 465,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 466,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 467,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 469,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2295",
      "rank": 471,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1643",
      "rank": 472,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out of",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 477,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server bo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2556",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into the iss",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2566",
      "rank": 482,
      "size": "L",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2565",
      "rank": 483,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 494,
      "size": "S",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 495,
      "size": "S",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls t",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 498,
      "size": "M",
      "importance": "low",
      "score": 4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 507,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2355",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification container",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-worksp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 532,
      "size": "L",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall back t",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2660",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add safe Reset to planned action to the issue actions menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2680",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 552,
      "size": "S",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 554,
      "size": "L",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): strike merge trigger registry splits across dashboard chunks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(cloister): idle nudge must not advance after failed mandatory inspection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 566,
      "size": "L",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-898",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-984",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 593,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 595,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 596,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
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
      "issue": "PAN-1720",
      "rank": 598,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 599,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 600,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 601,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 602,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 603,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 604,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 605,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 606,
      "size": "M",
      "importance": "low",
      "score": 1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 607,
      "size": "L",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 608,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 609,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 610,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 611,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 612,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 613,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2073",
      "rank": 614,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 616,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 617,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2352",
      "rank": 618,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 619,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2353",
      "rank": 620,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2351",
      "rank": 621,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 622,
      "size": "L",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2346",
      "rank": 623,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 624,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 625,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 626,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 627,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 628,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 631,
      "size": "S",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label make ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07-06",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 635,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 636,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only the ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 638,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 640,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/** ",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 642,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 643,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 644,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 646,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(server): pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id resolutio",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
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
    },
    {
      "from": "PAN-2950",
      "to": "PAN-2908",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2077",
      "to": "PAN-1775",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2717",
      "to": "PAN-2079",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2492",
      "to": "PAN-2079",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1844",
      "to": "PAN-2079",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-43",
      "to": "PAN-2080",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1868",
      "to": "PAN-2642",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2466",
      "to": "PAN-2642",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-570",
      "to": "PAN-2642",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1042",
      "to": "PAN-2642",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-806",
      "to": "PAN-807",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1451",
      "to": "PAN-1124",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2837",
      "to": "PAN-2830",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1313",
      "to": "PAN-1246",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1560",
      "to": "PAN-1650",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2567",
      "to": "PAN-1650",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2521",
      "to": "PAN-2331",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    }
  ]
}
```
