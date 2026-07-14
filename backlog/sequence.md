# Backlog Sequence

_Last sequenced: 2026-07-14T16:30:00.000Z · model: glm-5.2 · open: 596_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2659 | M | critical | ok |  |  | Unreclaimable record lock after mkdir/owner.json crash — poisons all record writes (successor to #2623). |
| 2 | PAN-2550 | S | critical | ok |  |  | npm test exits 0 while 31 tests fail — every verification gate is built on a false signal. |
| 3 | PAN-2567 | S | critical | ok |  |  | Reviewed+green PR never merges — advancing verdict reconciles forever; shipped work strands. |
| 4 | PAN-2259 | S | critical | ok |  |  | Burns the full 5k/hr GitHub GraphQL quota — breaks pan close, gh, and orchestration globally. |
| 5 | PAN-2569 | S | critical | ok |  |  | Planning finalizes but the work agent never auto-spawns — silent pipeline stall needing manual pan start. |
| 6 | PAN-2664 | S | critical | ok |  |  | sync-main auto-commit completes an unresolved merge leaving conflict markers — state corruption. |
| 6 | PAN-806 | XL | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 7 | PAN-2469 | M | critical | ok |  |  | Swarm "all slots done" never deterministically triggers assemble→verify→review — root of multi-issue stalls. |
| 8 | PAN-2379 | S | critical | ok |  |  | Verify-gate dep install is warn-only with 60s timeout — false failures block swarm convergence. |
| 9 | PAN-2593 | S | critical | ok |  |  | Server children inherit bare PATH — verification gates run npm/node under Node 18, not the server Node 22. |
| 10 | PAN-2511 | M | critical | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); full-suite verify is redundant with the gate. |
| 11 | PAN-2650 | M | critical | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover cannot recover it. |
| 12 | PAN-2244 | M | critical | ok |  |  | Half-staged spec file blocks all pan-dir mirroring — continue mirrors never land, state drifts. |
| 13 | PAN-2495 | M | critical | ok |  | PAN-2487 | ci-green merge skip bypassed the CI-green gate and landed a red-main change — merge-skip integrity hole. |
| 14 | PAN-2639 | M | critical | ok |  |  | codex-resume replays a rotated-out refresh token — codex review convoys wedge with 401. |
| 15 | PAN-2651 | S | high | ok |  |  | Simplify lifecycle reconciliation and add a safe post-planning reset — pipeline-correctness substrate. |
| 16 | PAN-2652 | M | high | ok |  |  | Claude Code backgrounding forks the session file in-process; invisible to session-id resolution, view diverges from terminal. |
| 17 | PAN-1650 | M | high | ok |  |  | Split readyForMerge into gatesPassed (derived) + shipComplete; auto-dispatch ship — architecture unblocking the merge path. |
| 18 | PAN-262 | L | high | ok |  |  | Refactor post-merge lifecycle into composable, idempotent operations — the recurring re-loop substrate. |
| 19 | PAN-2635 | XS | high | ok |  |  | 152-error src/dashboard/server typecheck debt masks real errors in the server build — pay it down. |
| 19 | PAN-1491 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 20 | PAN-2430 | S | high | ok |  |  | Frontend typecheck fails with dozens of pre-existing unused-local errors — gate noise hides real failures. |
| 21 | PAN-578 | M | high | ok |  |  | Comment mediation layer to prevent prompt injection via tracker comments — security substrate. |
| 22 | PAN-1560 | M | high | ok |  |  | Re-review after a PR head moves does not re-post review status — PR stranded BLOCKED. |
| 23 | PAN-2334 | XS | high | ok |  |  | Definition of Ready — the bar an issue must clear before pickup; prevents junk from entering the pipeline. |
| 23 | PAN-2168 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 24 | PAN-1618 | M | high | ok |  |  | Work-spawn docker-health gate has no autonomous recovery — proposed work cannot auto-retry. |
| 25 | PAN-1454 | M | high | ok |  |  | META: 9 systemic failure patterns from the 80-issue audit — substrate work to prevent whole classes of recurrence. |
| 26 | PAN-2351 | M | high | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats — security prerequisites for remote access. |
| 27 | PAN-2233 | XL | high | needs-refinement |  |  | Decompose merge-agent.ts (1,414 lines) into focused modules — pipeline machinery, supervised handoff. |
| 28 | PAN-1915 | M | high | ok |  |  | API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext. |
| 34 | PAN-2189 | XL | high | needs-refinement |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff. |
| 35 | PAN-2169 | S | high | ok |  |  | kimi agent silently frozen at 100% context (no thrown overflow) not caught by CONTEXT_OVERFLOW — agent liveness gap. |
| 36 | PAN-2212 | M | high | ok |  |  | Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero. |
| 37 | PAN-2186 | S | high | ok |  |  | Post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck. |
| 38 | PAN-1435 | M | high | ok |  |  | API keys stored as plaintext in config.yaml — security hardening. |
| 39 | PAN-2170 | S | high | ok |  |  | Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, blocking workspace boot. |
| 40 | PAN-2190 | XL | high | needs-refinement |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split. |
| 41 | PAN-2445 | S | high | ok |  |  | Deacon lifecycle patrol auto-dispatches PLANNING off-book for stale issues — staffed from Fable when no model recorded. |
| 42 | PAN-2165 | M | high | ok |  |  | pan close close-issue phase reports success but leaves the issue OPEN with wrong labels. |
| 43 | PAN-2516 | M | high | ok |  |  | Spec plan.status flips left uncommitted in the shared primary worktree — spec-vs-record drift, blocks flywheel push. |
| 44 | PAN-2633 | S | high | ok |  |  | bug(dashboard): pending-question payload wiped when an idle-alive asking agent flaps to 'stopped' — needs-you entry vanishes while the qu... |
| 46 | PAN-2619 | M | high | ok |  |  | Terminal panel frame overflows its container — rightmost columns and bottom tmux status bar clipped |
| 50 | PAN-2232 | XL | high | ok |  |  | Decompose specialists.ts (1749 lines) into focused modules |
| 55 | PAN-2580 | M | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie |
| 56 | PAN-2582 | M | medium | ok |  |  | feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 57 | PAN-2572 | M | medium | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 58 | PAN-2563 | M | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 59 | PAN-2560 | XL | medium | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall bac... |
| 60 | PAN-2558 | XL | medium | ok |  |  | feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo) |
| 61 | PAN-2549 | XL | medium | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 62 | PAN-2597 | M | high | ok |  |  | Adopt codex app-server (JSON-RPC over stdio) as Codex transport — retire TUI keystroke injection |
| 62 | PAN-2547 | S | medium | ok |  |  | bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure |
| 63 | PAN-2521 | L | medium | ok |  |  | feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 64 | PAN-2507 | M | medium | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 65 | PAN-2506 | M | medium | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 66 | PAN-2505 | M | medium | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 67 | PAN-2504 | M | medium | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 68 | PAN-2501 | S | medium | ok |  |  | bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/... |
| 69 | PAN-2489 | S | medium | ok |  |  | bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 70 | PAN-2484 | S | medium | ok |  |  | fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule ... |
| 71 | PAN-2467 | M | medium | ok |  |  | Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged) |
| 72 | PAN-2466 | S | medium | ok |  |  | bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring) |
| 73 | PAN-2465 | S | medium | ok |  |  | bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero |
| 74 | PAN-2423 | S | medium | ok |  |  | bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification contai... |
| 75 | PAN-2454 | S | medium | ok |  |  | bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches |
| 76 | PAN-2255 | M | high | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 76 | PAN-2428 | S | medium | ok |  |  | bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label ma... |
| 77 | PAN-2451 | M | medium | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 78 | PAN-2449 | M | medium | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 79 | PAN-2414 | S | medium | ok |  | PAN-1980 | bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation... |
| 80 | PAN-2416 | S | medium | ok |  |  | bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively |
| 81 | PAN-2421 | S | medium | ok |  |  | bug(test): dashboard server route tests flake under full-suite verification load |
| 82 | PAN-2422 | S | medium | ok |  |  | bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 83 | PAN-2406 | M | medium | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree re... |
| 84 | PAN-2409 | M | medium | ok |  |  | feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07... |
| 85 | PAN-2408 | S | medium | ok |  |  | bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-wor... |
| 86 | PAN-2399 | M | medium | ok |  |  | feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 87 | PAN-2395 | S | medium | ok |  |  | bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversati... |
| 88 | PAN-2394 | M | medium | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 89 | PAN-2392 | M | medium | ok |  |  | feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 90 | PAN-2390 | M | medium | ok |  |  | systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on ... |
| 91 | PAN-2381 | S | medium | ok |  |  | bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 92 | PAN-2358 | M | medium | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 93 | PAN-2337 | M | medium | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 94 | PAN-2333 | M | medium | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unansw... |
| 95 | PAN-2331 | S | medium | ok |  |  | bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for ente... |
| 96 | PAN-2323 | M | medium | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 97 | PAN-2324 | S | medium | ok |  |  | bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels |
| 98 | PAN-2308 | XL | medium | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals ... |
| 99 | PAN-2295 | L | medium | needs-refinement |  |  | feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 100 | PAN-2568 | M | high | ok |  |  | Summary fork delivery race: large summary lands in codex composer but is never submitted; conversation looks dead |
| 100 | PAN-2288 | XL | medium | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up) |
| 101 | PAN-2287 | S | medium | ok |  |  | bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file |
| 102 | PAN-2285 | S | medium | ok |  |  | bug(agents): per-agent codex-home auth.json rots — seed-once copy forks the OAuth token family, wedging agents in infinite 401 token_revo... |
| 103 | PAN-2282 | M | medium | ok |  |  | Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 104 | PAN-2280 | M | medium | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.) |
| 105 | PAN-2252 | M | medium | ok |  |  | Dashboard port has no identity check — workspace peer server squatted :3011 for 6 minutes and passed all health checks |
| 106 | PAN-2266 | M | medium | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 107 | PAN-2243 | M | medium | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 108 | PAN-2242 | M | medium | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 109 | PAN-2240 | S | medium | ok |  |  | bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 110 | PAN-2213 | M | medium | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 111 | PAN-2201 | M | medium | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels |
| 112 | PAN-2197 | S | medium | ok |  |  | bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 113 | PAN-2598 | M | high | ok |  |  | Issue view misreports an in-flight planning session: false "finished the plan", missing planning agent in tree, wrong phase banner |
| 113 | PAN-2193 | M | medium | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal |
| 114 | PAN-2106 | M | medium | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 115 | PAN-2079 | M | medium | ok |  |  | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 116 | PAN-2080 | M | medium | ok |  | PAN-43 | Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43) |
| 117 | PAN-2078 | M | medium | ok |  |  | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 118 | PAN-2077 | M | medium | ok |  |  | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver |
| 119 | PAN-2027 | M | medium | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 120 | PAN-1913 | XS | medium | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 121 | PAN-1889 | M | medium | ok |  |  | feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run |
| 122 | PAN-2642 | XL | high | ok | ✓ |  | [EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land the progress-aware breaker, make dollars honest |
| 123 | PAN-2075 | XL | high | ok | ✓ |  | [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline |
| 124 | PAN-2059 | XL | high | ok | ✓ |  | [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting |
| 125 | PAN-1773 | M | medium | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 126 | PAN-1770 | S | medium | ok |  |  | bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle |
| 127 | PAN-1767 | L | medium | ok |  |  | feat(stats): surface 'awaiting close-out' (verifying-on-main) count in flywheel stats, pan status, and dashboard headline |
| 128 | PAN-1766 | S | medium | ok |  |  | bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-16... |
| 129 | PAN-1711 | M | medium | ok |  |  | Dashboard event loop stalls 15-25s under load — watchdog force-restarted it 3x in 45 min |
| 130 | PAN-1525 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-1666 | XL | high | ok | ✓ |  | [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out |
| 131 | PAN-1578 | M | medium | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 132 | PAN-1561 | M | medium | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 133 | PAN-1558 | M | medium | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 134 | PAN-1544 | M | medium | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 135 | PAN-1538 | M | medium | ok |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 136 | PAN-1504 | M | medium | ok |  |  | feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs |
| 137 | PAN-1452 | M | medium | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 138 | PAN-1451 | M | medium | ok |  | PAN-1124 | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 139 | PAN-1424 | M | medium | needs-refinement |  | PAN-1122 | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 140 | PAN-1357 | M | medium | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 141 | PAN-1313 | XL | medium | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 142 | PAN-1246 | M | medium | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 143 | PAN-1253 | M | medium | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 144 | PAN-1217 | M | medium | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 145 | PAN-1219 | M | medium | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 146 | PAN-804 | XL | medium | ok |  |  | Epic D: Archaeological audit & pre-1.0 cleanup |
| 147 | PAN-807 | XL | medium | ok |  |  | Epic C: Workspace state sanity on spawn |
| 148 | PAN-1311 | M | medium | needs-refinement |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 149 | PAN-1254 | M | medium | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 150 | PAN-1196 | M | medium | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 151 | PAN-1198 | M | medium | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 152 | PAN-1142 | M | medium | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 153 | PAN-630 | M | medium | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 154 | PAN-2377 | M | medium | ok |  |  | feat(flywheel): first-class 'special orders' runs — operator-supplied order book executed with lane semantics |
| 155 | PAN-2376 | XL | medium | ok |  |  | Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene, review auto... |
| 156 | PAN-2188 | M | medium | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 157 | PAN-2179 | S | medium | ok |  |  | bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled) |
| 158 | PAN-1497 | M | medium | ok |  |  | feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 159 | PAN-1218 | M | medium | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 160 | PAN-1209 | M | medium | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 161 | PAN-955 | M | medium | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 162 | PAN-813 | M | medium | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 163 | PAN-2663 | S | medium | ok |  |  | bug(restart): health probe can accept old dashboard after replacement EADDRINUSE |
| 164 | PAN-2656 | S | medium | ok |  |  | bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 165 | PAN-2649 | S | medium | ok |  |  | bug(palette): Ctrl+K conversation search indexes Claude transcripts only |
| 166 | PAN-2647 | S | medium | ok |  |  | fix(health): replace false-positive system health model and harden Health page contract |
| 167 | PAN-2627 | S | medium | ok |  |  | bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue... |
| 168 | PAN-2554 | S | medium | ok |  |  | bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable |
| 169 | PAN-2546 | S | medium | ok |  |  | bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery |
| 170 | PAN-2478 | M | medium | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 171 | PAN-2241 | M | medium | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 172 | PAN-2237 | S | medium | ok |  |  | bug(cli): pan plan done swallows vbrief quality lint details |
| 173 | PAN-2202 | M | medium | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success |
| 174 | PAN-2069 | M | medium | ok |  |  | caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 175 | PAN-1912 | M | medium | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 176 | PAN-1897 | S | medium | ok |  | PAN-1711 | bug(cli): pan start workspace-prep hangs/times out (>120s) on re-entry — blocks PAN-1711, PAN-1827 (no spawn, no error) |
| 177 | PAN-1830 | M | medium | ok |  | PAN-1696 | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 178 | PAN-1824 | M | medium | ok |  |  | Flaky main CI: real-timer integration tests time out (~5s) on loaded runners — fork recovery, rollout-JSONL, heartbeat, conversation-rout... |
| 179 | PAN-1828 | M | medium | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 180 | PAN-1816 | M | medium | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-... |
| 181 | PAN-1795 | M | medium | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 182 | PAN-1769 | M | medium | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still ... |
| 183 | PAN-1674 | M | medium | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 184 | PAN-1673 | M | medium | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 185 | PAN-1624 | M | medium | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 186 | PAN-1571 | M | medium | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N lines... |
| 187 | PAN-1565 | M | medium | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 188 | PAN-1556 | M | medium | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 189 | PAN-1530 | M | medium | ok |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 190 | PAN-1234 | M | high | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 190 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 191 | PAN-1232 | M | high | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 191 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 192 | PAN-1461 | M | medium | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 193 | PAN-1436 | M | medium | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 194 | PAN-1416 | M | medium | ok |  |  | Workspace-spawned dashboard servers can bind the main pan.localhost port and hijack the canonical dashboard |
| 195 | PAN-1449 | M | medium | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 196 | PAN-1446 | M | medium | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 197 | PAN-1445 | M | medium | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 198 | PAN-1444 | M | medium | ok |  | PAN-1416 | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 199 | PAN-1440 | M | medium | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 200 | PAN-1438 | M | medium | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 201 | PAN-1433 | M | medium | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 202 | PAN-1386 | M | medium | ok |  |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 203 | PAN-1392 | M | medium | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 204 | PAN-1330 | M | medium | ok |  |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 205 | PAN-1240 | M | medium | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 206 | PAN-1226 | M | medium | ok |  |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 207 | PAN-1227 | M | medium | needs-refinement |  |  | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 208 | PAN-1173 | M | medium | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 209 | PAN-1150 | M | medium | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 210 | PAN-1149 | M | medium | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 211 | PAN-1130 | M | medium | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 212 | PAN-1129 | M | medium | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 213 | PAN-1128 | M | medium | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 214 | PAN-1113 | M | medium | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 215 | PAN-1068 | M | medium | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 216 | PAN-1042 | M | medium | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 217 | PAN-1027 | M | medium | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 218 | PAN-932 | M | medium | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 219 | PAN-933 | M | medium | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 220 | PAN-900 | M | medium | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 221 | PAN-886 | M | medium | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 222 | PAN-681 | M | medium | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 223 | PAN-538 | M | medium | ok |  |  | npm run build sometimes skips Vite frontend rebuild |
| 224 | PAN-334 | M | medium | ok |  |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 225 | PAN-324 | M | medium | ok |  |  | Agent detail pane missing Merge/Approve button |
| 226 | PAN-304 | M | medium | ok |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 227 | PAN-247 | M | medium | ok |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 228 | PAN-245 | M | medium | ok |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 229 | PAN-244 | M | medium | ok |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 230 | PAN-2646 | M | medium | ok |  |  | feat(swarm): configurable global/project/issue policy UI with default OFF |
| 231 | PAN-2599 | M | medium | ok |  |  | Integrate PostHog for product analytics and telemetry |
| 232 | PAN-2609 | M | medium | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 233 | PAN-2608 | M | medium | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 234 | PAN-2566 | XL | medium | ok |  |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 235 | PAN-2565 | M | medium | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 236 | PAN-2557 | M | medium | ok |  |  | feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor |
| 237 | PAN-2556 | M | medium | ok |  |  | feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into the ... |
| 238 | PAN-2553 | L | medium | ok |  |  | feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 239 | PAN-2548 | XS | medium | ok |  |  | chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker |
| 240 | PAN-113 | M | medium | ok |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 241 | PAN-2335 | XS | medium | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do... |
| 242 | PAN-2065 | M | medium | ok |  |  | feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 243 | PAN-2035 | M | medium | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 244 | PAN-2034 | M | medium | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 245 | PAN-2033 | M | medium | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 246 | PAN-2032 | M | medium | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 247 | PAN-2031 | M | medium | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 248 | PAN-2030 | M | medium | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 249 | PAN-2029 | M | medium | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 250 | PAN-2028 | M | medium | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 251 | PAN-2026 | M | medium | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 252 | PAN-2025 | M | medium | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 253 | PAN-2024 | M | medium | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 254 | PAN-2004 | M | medium | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 255 | PAN-1991 | M | medium | ok |  |  | Issue cockpit redesign — incremental rollout (tracking) |
| 256 | PAN-1995 | M | medium | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 257 | PAN-1985 | M | medium | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 258 | PAN-1966 | M | medium | ok |  |  | Single authoritative pipeline-membership resolver — one function for "what's in the pipeline" (collapse the 5 divergent views) |
| 259 | PAN-1968 | M | medium | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 260 | PAN-1967 | M | medium | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 261 | PAN-1965 | M | medium | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 262 | PAN-49 | S | medium | ok |  |  | Fix CloisterService tests that require real runtime |
| 263 | PAN-1916 | M | medium | ok |  |  | feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 264 | PAN-1854 | M | medium | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 265 | PAN-1852 | M | medium | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 266 | PAN-1853 | M | medium | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 267 | PAN-1844 | M | medium | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 268 | PAN-1840 | M | medium | ok |  |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 269 | PAN-1839 | M | medium | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 270 | PAN-1837 | M | medium | ok |  |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 271 | PAN-1776 | M | medium | ok |  |  | feat(supervisor): hot-updatable delivery path — version-stamped supervisors, rolling refresh, and dumb-shim primitives with server-side d... |
| 272 | PAN-1684 | XS | medium | ok |  |  | docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 273 | PAN-1685 | M | medium | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 274 | PAN-1676 | M | medium | ok |  |  | feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 275 | PAN-1672 | M | medium | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 276 | PAN-1657 | M | medium | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 277 | PAN-1656 | M | medium | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 278 | PAN-1655 | M | medium | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 279 | PAN-1654 | M | medium | ok |  |  | perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 280 | PAN-1653 | M | medium | ok |  |  | perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 281 | PAN-1623 | M | medium | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 282 | PAN-1610 | M | medium | ok |  |  | Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards, IssueDrawer) |
| 283 | PAN-1577 | M | medium | ok |  |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 284 | PAN-1545 | M | low | ok |  |  | feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 285 | PAN-1542 | M | low | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 286 | PAN-1524 | M | low | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 287 | PAN-1488 | XS | low | ok |  |  | chore(repo): add required_pull_request_reviews to main branch protection |
| 288 | PAN-1490 | M | low | ok |  |  | feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 289 | PAN-1489 | M | low | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 290 | PAN-1485 | M | low | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 291 | PAN-1473 | L | low | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 292 | PAN-1469 | XS | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 293 | PAN-1443 | XL | low | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 294 | PAN-1442 | M | low | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 295 | PAN-1437 | M | low | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 296 | PAN-1432 | M | low | ok |  |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 297 | PAN-1223 | M | low | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 298 | PAN-1165 | M | low | ok |  |  | Lightweight review path for small/trivial PRs |
| 299 | PAN-1164 | M | low | ok |  |  | Push diff summary updates over /ws/rpc instead of 5s polling |
| 300 | PAN-1151 | M | low | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 301 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 302 | PAN-2661 | M | low | ok |  |  | Organize the issue actions context menu into clear sections |
| 303 | PAN-2660 | M | low | ok |  |  | Add safe Reset to planned action to the issue actions menu |
| 304 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 305 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 306 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 307 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 308 | PAN-2626 | M | low | ok |  |  | feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 309 | PAN-2625 | M | low | ok |  |  | feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 310 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 311 | PAN-2600 | M | low | ok |  | PAN-2597 | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 312 | PAN-2533 | M | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 313 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 314 | PAN-2526 | L | low | ok |  |  | Refactor deacon.ts below file-size baseline |
| 315 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 316 | PAN-2493 | M | low | ok |  |  | feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 317 | PAN-2492 | S | low | ok |  |  | bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only t... |
| 318 | PAN-2491 | XL | low | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 319 | PAN-2487 | M | low | ok |  |  | feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 320 | PAN-2443 | M | low | ok |  |  | feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption |
| 321 | PAN-2444 | L | low | ok |  |  | feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 322 | PAN-2442 | L | low | ok |  |  | feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and promp... |
| 323 | PAN-2424 | XL | low | ok |  |  | Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remote... |
| 324 | PAN-1060 | M | low | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 325 | PAN-1041 | M | low | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 326 | PAN-1040 | M | low | ok |  |  | feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 327 | PAN-1037 | M | low | ok |  |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 328 | PAN-958 | XL | low | ok |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 329 | PAN-947 | M | low | ok |  |  | feat: project management actions in unified sidebar |
| 330 | PAN-949 | M | low | ok |  |  | feat: add conversation for project from sidebar |
| 331 | PAN-938 | M | low | ok |  |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 332 | PAN-924 | M | low | ok |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 333 | PAN-903 | M | low | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 334 | PAN-902 | M | low | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 335 | PAN-901 | M | low | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 336 | PAN-2356 | M | low | ok |  |  | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 337 | PAN-2355 | M | low | ok |  |  | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 338 | PAN-2354 | M | low | ok |  |  | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 339 | PAN-2353 | M | low | ok |  |  | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 340 | PAN-2352 | M | low | ok |  |  | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 341 | PAN-2350 | XL | low | ok |  |  | Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone |
| 342 | PAN-2348 | XL | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 343 | PAN-2347 | XS | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 344 | PAN-2346 | XS | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 345 | PAN-2345 | XS | low | ok |  |  | docs: refresh pan-done.md — update, harden, make useful |
| 346 | PAN-2344 | XS | low | ok |  |  | docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 347 | PAN-2343 | XS | low | ok |  |  | docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 348 | PAN-2211 | M | low | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 349 | PAN-2210 | M | low | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 350 | PAN-2195 | M | low | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 351 | PAN-2066 | M | low | ok |  |  | OKF knowledge skill — deferred v2 capabilities (search, viz, lease writes, MCP, semantic auditor) |
| 352 | PAN-2091 | XS | low | ok |  |  | chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 353 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 354 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 355 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 356 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 357 | PAN-2074 | M | low | ok |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 358 | PAN-2045 | M | low | ok |  |  | perf(test): frontend vitest (jsdom) is the test-gate bottleneck — ~5min vs ~72s root; move to happy-dom / tune pool |
| 359 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 360 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 361 | PAN-2008 | M | low | ok |  | PAN-1936 | feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 362 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 363 | PAN-2002 | M | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 364 | PAN-1990 | M | low | ok |  |  | First-class workspaces and projects with per-workspace memory |
| 365 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 366 | PAN-1988 | M | low | ok |  |  | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 367 | PAN-1984 | XL | low | ok |  | PAN-1983 | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 368 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 369 | PAN-1983 | XL | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 370 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 371 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 372 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 373 | PAN-1951 | M | low | ok |  |  | Inspector agent should resume a warm session instead of cold-spawning a new one per item |
| 374 | PAN-1937 | M | low | ok |  |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 375 | PAN-1936 | M | low | ok |  |  | Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 376 | PAN-1926 | M | low | ok |  |  | feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 377 | PAN-1918 | S | low | ok |  |  | bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stall... |
| 378 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 379 | PAN-1910 | M | low | ok |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 380 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywh... |
| 381 | PAN-1906 | M | low | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 382 | PAN-1896 | M | low | ok |  |  | Reduce approval friction for GitHub CLI operations in managed sessions |
| 383 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 384 | PAN-818 | M | low | ok |  |  | Make summary optional when forking conversations |
| 385 | PAN-817 | M | low | ok |  |  | Improve planning dialog layout and content fit |
| 386 | PAN-783 | M | low | ok |  |  | Agents Page Redesign — Unified Multi-View Experience |
| 387 | PAN-654 | M | low | ok |  |  | Project Setup Wizard — Dashboard UI |
| 388 | PAN-687 | M | low | ok |  |  | Support OpenCode as alternative coding agent |
| 389 | PAN-678 | M | low | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 390 | PAN-675 | M | low | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 391 | PAN-649 | M | low | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 392 | PAN-637 | M | low | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 393 | PAN-629 | M | low | ok |  |  | Workspace quotas and resource governance |
| 394 | PAN-608 | M | low | ok |  |  | Integrate Destructive Command Guard (dcg) with configurable settings |
| 395 | PAN-607 | M | low | ok |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 396 | PAN-613 | M | low | ok |  |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 397 | PAN-606 | M | low | ok |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 398 | PAN-532 | M | low | ok |  |  | Per-project and per-issue model overrides for workflow agent model selection |
| 399 | PAN-548 | M | low | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 400 | PAN-546 | M | low | ok |  |  | Remove claude-code-router — all providers use direct env var injection |
| 401 | PAN-531 | M | low | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 402 | PAN-1868 | M | low | ok |  |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 403 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 404 | PAN-1846 | S | low | ok |  |  | bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 405 | PAN-1775 | M | low | ok |  |  | feat(dashboard): remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility reads as 'no agent' |
| 406 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 407 | PAN-1774 | S | low | ok |  |  | bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 408 | PAN-1758 | S | low | ok |  |  | bug(cloister): ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; readyForMerge only ever flips vi... |
| 409 | PAN-1761 | S | low | ok |  |  | bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ap... |
| 410 | PAN-1750 | L | low | ok |  |  | feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 411 | PAN-1755 | S | low | ok |  |  | bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 412 | PAN-1754 | L | low | ok |  |  | feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 413 | PAN-1751 | M | low | ok |  |  | feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 414 | PAN-1748 | M | low | ok |  |  | feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 415 | PAN-1740 | M | low | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 416 | PAN-1735 | L | low | ok |  |  | feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 417 | PAN-1728 | S | low | ok |  | PAN-1124 | bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 418 | PAN-1696 | L | low | ok |  |  | feat: decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view |
| 419 | PAN-1720 | S | low | ok |  |  | bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 420 | PAN-1710 | S | low | ok |  | PAN-1491, PAN-1641 | bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server... |
| 421 | PAN-1691 | M | low | ok |  |  | feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 422 | PAN-1987 | M | high | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 422 | PAN-1668 | S | low | ok |  |  | bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 423 | PAN-1669 | S | low | ok |  |  | bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 424 | PAN-1667 | M | low | ok |  |  | feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 425 | PAN-1641 | M | low | ok |  |  | Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness |
| 426 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 427 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 428 | PAN-1640 | M | low | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 429 | PAN-1627 | M | low | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approv... |
| 430 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 431 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 432 | PAN-1572 | M | low | ok |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 433 | PAN-1553 | M | low | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 434 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 435 | PAN-1550 | M | low | ok |  |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 436 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 437 | PAN-466 | M | low | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 438 | PAN-465 | M | low | ok |  |  | Add OpenRouter as a model provider |
| 439 | PAN-463 | M | low | ok |  |  | Add Qwen 3.6+ model support |
| 440 | PAN-454 | M | low | ok |  |  | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 441 | PAN-452 | M | low | ok |  |  | Conversation input bar — mode/permissions/workspace selectors |
| 442 | PAN-450 | M | low | ok |  |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 443 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 444 | PAN-1483 | M | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 445 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 446 | PAN-1480 | M | low | ok |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 447 | PAN-1479 | M | low | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 448 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 449 | PAN-1325 | M | low | ok |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 450 | PAN-2532 | M | high | ok |  |  | Pipeline rows truncate the title early while horizontal space sits empty — reclaim width for the title without adding height. |
| 450 | PAN-1242 | M | low | ok |  |  | Board view follow-up — + New issue column footer button (deferred from PAN-1229) |
| 451 | PAN-1245 | M | low | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 452 | PAN-1244 | M | low | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 453 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 454 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 455 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 456 | PAN-1154 | M | low | ok |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 457 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 458 | PAN-1152 | M | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 459 | PAN-1136 | M | low | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 460 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 461 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 462 | PAN-1122 | M | low | ok |  |  | Trim OpenAI model catalog to 5 supported models |
| 463 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 464 | PAN-1123 | M | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 465 | PAN-1101 | M | low | ok |  |  | Permission safety hardening: CI guard, single emission chokepoint, property tests, runtime tripwire |
| 466 | PAN-1121 | M | low | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 467 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 468 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 469 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 470 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 471 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 472 | PAN-1051 | M | low | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 473 | PAN-1049 | M | low | ok |  |  | Spike: evaluate Tauri v2 desktop shell |
| 474 | PAN-984 | M | low | ok |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 475 | PAN-294 | M | low | ok |  |  | Surface module initialization errors as system-level, not per-issue |
| 476 | PAN-293 | M | low | ok |  |  | Project Living Memory — per-project semantic memory for agents |
| 477 | PAN-962 | M | low | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 478 | PAN-961 | M | low | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 479 | PAN-944 | M | low | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 480 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 481 | PAN-927 | M | low | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 482 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 483 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 484 | PAN-863 | M | low | ok |  |  | Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees) |
| 485 | PAN-853 | M | low | ok |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 486 | PAN-832 | M | low | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 487 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 488 | PAN-826 | L | low | ok |  |  | Conversation/terminal integration refactor: instant-start + parser correctness + T3Code structural alignment |
| 489 | PAN-810 | M | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 490 | PAN-802 | M | low | ok |  |  | Resume on conversation session forks instead of resuming |
| 491 | PAN-797 | M | low | ok |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 492 | PAN-778 | M | low | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 493 | PAN-791 | M | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 494 | PAN-793 | M | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 495 | PAN-790 | XL | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 496 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 497 | PAN-774 | M | low | ok |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 498 | PAN-771 | M | low | ok |  |  | Investigate Vercel Sandbox execution backend support |
| 499 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 500 | PAN-775 | M | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 501 | PAN-773 | M | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 502 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 503 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 504 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 505 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 506 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 507 | PAN-749 | M | low | ok |  |  | Research and borrow best features from gstack |
| 508 | PAN-750 | M | low | ok |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 509 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 510 | PAN-751 | M | low | ok |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 511 | PAN-747 | M | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 512 | PAN-743 | M | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 513 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 514 | PAN-736 | M | low | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 515 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 516 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 517 | PAN-277 | M | low | ok |  |  | Session reasoning capture & collaborative PRD refinement |
| 518 | PAN-258 | M | low | ok |  |  | Kanban board: fit all columns without horizontal scrolling |
| 519 | PAN-255 | M | low | ok |  |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 520 | PAN-252 | M | low | ok |  |  | Disable Sync with Main button when workspace is up to date |
| 521 | PAN-243 | M | low | ok |  |  | Audit dashboard actions: ensure all are available via CLI |
| 522 | PAN-727 | S | low | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 523 | PAN-709 | L | low | ok |  |  | feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 524 | PAN-700 | M | low | ok |  |  | Detachable terminal for conversation view — popout into OS window |
| 525 | PAN-713 | M | low | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 526 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 527 | PAN-701 | M | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 528 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 529 | PAN-2499 | M | high | ok |  |  | feat(dashboard): unify the three issue views into one progressive-density Issue View (rail · cockpit · console) |
| 529 | PAN-663 | M | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 530 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 531 | PAN-646 | M | low | ok |  |  | Canceled issues: add guided Recover workflow |
| 532 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 533 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 534 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 535 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 536 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 537 | PAN-591 | M | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 538 | PAN-589 | M | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 539 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 540 | PAN-571 | M | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 541 | PAN-570 | M | low | ok |  |  | Show PLAN badge on costs when under a subscription/plan |
| 542 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 543 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 544 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 545 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 546 | PAN-537 | M | low | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 547 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 548 | PAN-471 | M | low | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 549 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX — all entry points should show message input |
| 550 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 551 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 552 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database — need test isolation |
| 553 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 554 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 555 | PAN-438 | XL | low | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 556 | PAN-407 | M | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 557 | PAN-77 | M | low | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 558 | PAN-38 | M | low | stale |  |  | Support multiple merge agents per repository |
| 559 | PAN-37 | M | low | stale |  |  | Support external PR selection for merge-agent |
| 560 | PAN-299 | M | low | ok |  |  | Granular session state persistence across context compaction |
| 561 | PAN-298 | M | low | ok |  |  | Auto-detect package manager and runtime in workspace setup |
| 562 | PAN-297 | M | low | ok |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 563 | PAN-283 | M | low | ok |  |  | Reset should sync workspace feature branch with latest main |
| 564 | PAN-271 | M | low | ok |  |  | Auto-assign Linear project from project config when creating issues |
| 565 | PAN-265 | M | low | ok |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 566 | PAN-249 | M | low | ok |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 567 | PAN-227 | M | low | ok |  |  | Phase gate validation — mid-implementation acceptance checks |
| 568 | PAN-241 | M | low | ok |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 569 | PAN-228 | M | low | ok |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 570 | PAN-198 | M | low | ok |  |  | Structured audit trail for agent actions |
| 571 | PAN-190 | M | low | ok |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 572 | PAN-180 | M | low | ok |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 573 | PAN-178 | M | low | ok |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 574 | PAN-177 | M | low | ok |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 575 | PAN-176 | M | low | ok |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 576 | PAN-175 | M | low | ok |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 577 | PAN-155 | M | low | ok |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 578 | PAN-146 | M | low | ok |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 579 | PAN-106 | M | low | ok |  |  | Cost prediction/estimation for in-progress work |
| 580 | PAN-52 | M | low | ok |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 581 | PAN-55 | M | low | ok |  |  | Track specialist costs with time period filtering |
| 582 | PAN-54 | L | low | ok |  |  | feat: Add pan test:e2e command for full workflow integration test |
| 583 | PAN-51 | M | low | ok |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 584 | PAN-47 | M | low | ok |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 585 | PAN-44 | M | low | ok |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 586 | PAN-43 | M | low | ok |  |  | Add Slack and email notifications for agent events |
| 587 | PAN-2073 | XS | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 588 | PAN-2071 | XS | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 589 | PAN-2070 | XS | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 590 | PAN-2068 | XS | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 591 | PAN-2067 | XS | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 592 | PAN-1683 | XS | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out... |
| 593 | PAN-1474 | XS | low | ok |  |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 594 | PAN-674 | XS | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 595 | PAN-634 | XS | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 596 | PAN-633 | XS | low | ok |  |  | Update Cloister PRD and docs index — stale relative to implementation |

## Rationale detail

### PAN-2659 (rank 1)

Lock poisoning is the single most loss-prone failure mode in the record layer: a crash between mkdir(lock) and the owner.json write leaves a record lock nothing can reclaim, silently blocking every later state write for that issue. It is the direct successor to the PAN-2623 zero-byte-lock incident, so until it is fixed the substrate that all pipeline state rides on is not crash-safe. Fix is structural (atomic lock acquisition / recovery), not a nudge.

### PAN-2550 (rank 2)

The test command is the substrate every verification gate and every agent self-check trusts. If `npm test` returns 0 while dozens of tests actually fail, merges go green on red code and agents believe their work passed when it did not. This makes the whole quality signal unreliable, so it outranks every feature and most bugs — nothing else can be trusted until the exit code reflects reality.

### PAN-2567 (rank 3)

This is the far end of the pipeline breaking: work clears review and is green, then the "advancing verdict" reconciliation never converges and the merge never fires. Finished work sitting unmerged indefinitely is the most expensive stall there is, and it has no operator workaround that scales, so it ranks above all new work.

### PAN-2259 (rank 4)

An unknown caller is exhausting the entire 5k/hour GitHub GraphQL quota, which takes down `pan close`, `gh issue edit`, and orchestration for every project at once. Because it is a shared global resource and the blast radius is the whole tracker integration, it gates close-out and merge across the board until found.

### PAN-2569 (rank 5)

Planning silently succeeds (issue flips to "planned") but the work agent is never spawned, so the pipeline looks healthy while nothing runs and an operator must notice and hand-run `pan start`. A silent stall that masquerades as progress is worse than a loud failure; it belongs in the critical blocker tier.

### PAN-2664 (rank 6)

sync-main auto-committing an unresolved merge and shipping conflict markers is active state corruption on the branch agents rebase onto — it propagates conflicts into every workspace that syncs main. It is recent and being worked, but until the auto-commit refuses dirty/ conflicted trees the sync substrate is unsafe.

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2469 (rank 7)

The swarm assembly owner gap is the named root cause of the PAN-2388/2383/399 stalls: when all slots finish, nothing deterministically triggers assemble→verify→review, so multi-slot issues hang in a "done but never merges" state. Wiring that transition deterministically unblocks the whole swarm convergence path.

### PAN-2379 (rank 8)

The verify gate treats dependency install as warn-only with a 60s timeout, so under load it verifies against an empty node_modules and reports false failures — which directly blocks swarm convergence and re-drives the agents that passed. Making the install required and un-timed removes a whole class of false-red verify loops.

### PAN-2593 (rank 9)

Verification-gate children inherit the bare system PATH, so npm/node run under the host Node 18 instead of the server Node 22 — meaning the gate does not test what actually ships and fails for the wrong reasons. It undermines the meaning of "verified" substrate-wide.

### PAN-2511 (rank 10)

Work agents spend 20+ minutes chasing false test failures because the sandbox denies the spawnSync git call (EPERM), and the redundant local full-suite verify repeats work the gate already covers. That is pure throughput loss on every work agent, every cycle, so it ranks with the blockers.

### PAN-2650 (rank 11)

When the memory governor sheds the integration stack, the swarm final ready-to-merge slot wedges and `pan swarm recover` cannot recover it — a completed slot stranded with no permitted action. It is a deterministic deadlock at the end of the swarm path, so it blocks swarm adoption until fixed.

### PAN-2244 (rank 12)

A half-staged spec file left in the index blocks every pan-dir mirror, so continue-state mirrors never land and the canonical state drifts from the worktree. State drift is the recurring corruption root cause, so anything that silently halts mirroring is substrate-critical.

### PAN-2495 (rank 13)

The ci-green merge-skip path bypassed the CI-green gate and landed a red-main change — the merge machinery has an integrity hole that can put main red. A gate that can be skipped into shipping broken code undermines the merge-train contract, so it ranks with the blockers.

### PAN-2639 (rank 14)

codex-resume replays a refresh token that has already been rotated out, so codex review convoys wedge on 401 token_revoked — the review half of the pipeline stalls for the entire codex/harness population until token freshness is checked before replay.

### PAN-2651 (rank 15)

High-impact: fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset. Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2652 (rank 16)

High-impact: Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to a.... Ranks here because it advances a shipped capability.

### PAN-1650 (rank 17)

Substrate hardening: Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-262 (rank 18)

Substrate hardening: Refactor post-merge lifecycle into composable, idempotent operations. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2635 (rank 19)

High-impact: chore(server): pay down the 152-error src/dashboard/server typecheck debt. Ranks here because it advances a shipped capability.

### PAN-1491 (rank 19)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2430 (rank 20)

Substrate hardening: bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-578 (rank 21)

High-impact: Security: Comment mediation layer to prevent prompt injection via tracker comments. Ranks here because it advances a shipped capability.

### PAN-1560 (rank 22)

Substrate hardening: Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2334 (rank 23)

Substrate hardening: chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catc.... Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2168 (rank 23)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1618 (rank 24)

Substrate hardening: Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack i.... Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-1454 (rank 25)

Substrate hardening: [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2351 (rank 26)

High-impact: Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites). Ranks here because it advances a shipped capability.

### PAN-2233 (rank 27)

Substrate hardening: refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-1915 (rank 28)

High-impact: enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext. Ranks here because it advances a shipped capability.

### PAN-2189 (rank 34)

Substrate hardening: Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2169 (rank 35)

Substrate hardening: bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERN.... Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2212 (rank 36)

High-impact: Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero. Ranks here because it advances a shipped capability.

### PAN-2186 (rank 37)

Substrate hardening: bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-1435 (rank 38)

High-impact: API keys in ~/.panopticon/config.yaml stored as plaintext. Ranks here because it advances a shipped capability.

### PAN-2170 (rank 39)

Substrate hardening: bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace sta.... Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2190 (rank 40)

Substrate hardening: Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2445 (rank 41)

High-impact: bug(cloister): deacon lifecycle patrol auto-dispatches PLANNING for stale 'planning'-state issues — off-book, and sta.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2165 (rank 42)

Substrate hardening: pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent labe.... Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2516 (rank 43)

Substrate hardening: Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2633 (rank 44)

High-impact: bug(dashboard): pending-question payload wiped when an idle-alive asking agent flaps to 'stopped' — needs-you entry v.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2619 (rank 46)

High-impact: Terminal panel frame overflows its container — rightmost columns and bottom tmux status bar clipped. Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2232 (rank 50)

specialists.ts is 1749 lines and part of the regrowing cloister subtree (service.ts just reddened main). Behavior-preserving decomposition into <1000-line modules with a re-export barrel, depth over line count, repointing tests in the same PR. Pipeline-machinery: supervised dispatch (TENET-10), needs-handoff.

### PAN-2580 (rank 55)

Quality bug: pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session a.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2582 (rank 56)

Feature work: feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes). Ranks here because it advances a shipped capability.

### PAN-2572 (rank 57)

Routine: Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken. Ranks here because it advances a shipped capability.

### PAN-2563 (rank 58)

Quality bug: npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps. Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2560 (rank 59)

Routine: resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projec.... Ranks here because it advances a shipped capability.

### PAN-2558 (rank 60)

Feature work: feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tr.... Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2549 (rank 61)

Routine: Fly remote workspaces: sync overdeck-state before re-enabling migrated projects. Ranks here because it advances a shipped capability.

### PAN-2597 (rank 62)

Adopt codex app-server (JSON-RPC over stdio) as the Codex transport, retiring the fragile TUI keystroke-injection delivery path for codex agents. Structured transport gives reliable, resumable delivery instead of screen-scraping. Persistent session (not one-shot exec) per the agent-lifecycle rule. In-pipeline.

### PAN-2547 (rank 62)

Quality bug: bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then decla.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2521 (rank 63)

Quality bug: feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled. Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2507 (rank 64)

Routine: Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch. Ranks here because it advances a shipped capability.

### PAN-2506 (rank 65)

Routine: flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized. Ranks here because it advances a shipped capability.

### PAN-2505 (rank 66)

Routine: lint:circular reports new frontend cycles + stale baseline in chat/conversations components. Ranks here because it advances a shipped capability.

### PAN-2504 (rank 67)

Routine: Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node. Ranks here because it advances a shipped capability.

### PAN-2501 (rank 68)

Quality bug: bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (mask.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2489 (rank 69)

Quality bug: bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click. Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2484 (rank 70)

Quality bug: fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-c.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2467 (rank 71)

Quality bug: Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged). Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2466 (rank 72)

Quality bug: bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2465 (rank 73)

Quality bug: bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero. Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2423 (rank 74)

Quality bug: bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2454 (rank 75)

Quality bug: bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches. Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2255 (rank 76)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-2428 (rank 76)

Quality bug: bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.doc.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2451 (rank 77)

Routine: Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits). Ranks here because a stable substrate is the prerequisite for everything else.

### PAN-2449 (rank 78)

Routine: start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the w.... Ranks here because it advances a shipped capability.

### PAN-2414 (rank 79)

Quality bug: bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit t.... Ranks here because it degrades pipeline reliability or correctness until fixed.

### PAN-2416 (rank 80)

Quality bug: bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interacti.... Ranks here because it degrades pipeline reliability or correctness until fixed.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-14T16:30:00.000Z",
  "model": "glm-5.2",
  "pass": "incremental",
  "openCount": 596,
  "nodes": [
    {
      "issue": "PAN-2659",
      "rank": 1,
      "size": "M",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unreclaimable record lock after mkdir/owner.json crash — poisons all record writes (successor to #2623).",
      "rationale": "Lock poisoning is the single most loss-prone failure mode in the record layer: a crash between mkdir(lock) and the owner.json write leaves a record lock nothing can reclaim, silently blocking every later state write for that issue. It is the direct successor to the PAN-2623 zero-byte-lock incident, so until it is fixed the substrate that all pipeline state rides on is not crash-safe. Fix is structural (atomic lock acquisition / recovery), not a nudge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 2,
      "size": "S",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test exits 0 while 31 tests fail — every verification gate is built on a false signal.",
      "rationale": "The test command is the substrate every verification gate and every agent self-check trusts. If `npm test` returns 0 while dozens of tests actually fail, merges go green on red code and agents believe their work passed when it did not. This makes the whole quality signal unreliable, so it outranks every feature and most bugs — nothing else can be trusted until the exit code reflects reality.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 3,
      "size": "S",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewed+green PR never merges — advancing verdict reconciles forever; shipped work strands.",
      "rationale": "This is the far end of the pipeline breaking: work clears review and is green, then the \"advancing verdict\" reconciliation never converges and the merge never fires. Finished work sitting unmerged indefinitely is the most expensive stall there is, and it has no operator workaround that scales, so it ranks above all new work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 4,
      "size": "S",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Burns the full 5k/hr GitHub GraphQL quota — breaks pan close, gh, and orchestration globally.",
      "rationale": "An unknown caller is exhausting the entire 5k/hour GitHub GraphQL quota, which takes down `pan close`, `gh issue edit`, and orchestration for every project at once. Because it is a shared global resource and the blast radius is the whole tracker integration, it gates close-out and merge across the board until found.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 5,
      "size": "S",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning finalizes but the work agent never auto-spawns — silent pipeline stall needing manual pan start.",
      "rationale": "Planning silently succeeds (issue flips to \"planned\") but the work agent is never spawned, so the pipeline looks healthy while nothing runs and an operator must notice and hand-run `pan start`. A silent stall that masquerades as progress is worse than a loud failure; it belongs in the critical blocker tier.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2664",
      "rank": 6,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "sync-main auto-commit completes an unresolved merge leaving conflict markers — state corruption.",
      "rationale": "sync-main auto-committing an unresolved merge and shipping conflict markers is active state corruption on the branch agents rebase onto — it propagates conflicts into every workspace that syncs main. It is recent and being worked, but until the auto-commit refuses dirty/ conflicted trees the sync substrate is unsafe.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 7,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm \"all slots done\" never deterministically triggers assemble→verify→review — root of multi-issue stalls.",
      "rationale": "The swarm assembly owner gap is the named root cause of the PAN-2388/2383/399 stalls: when all slots finish, nothing deterministically triggers assemble→verify→review, so multi-slot issues hang in a \"done but never merges\" state. Wiring that transition deterministically unblocks the whole swarm convergence path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 8,
      "size": "S",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verify-gate dep install is warn-only with 60s timeout — false failures block swarm convergence.",
      "rationale": "The verify gate treats dependency install as warn-only with a 60s timeout, so under load it verifies against an empty node_modules and reports false failures — which directly blocks swarm convergence and re-drives the agents that passed. Making the install required and un-timed removes a whole class of false-red verify loops.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 9,
      "size": "S",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Server children inherit bare PATH — verification gates run npm/node under Node 18, not the server Node 22.",
      "rationale": "Verification-gate children inherit the bare system PATH, so npm/node run under the host Node 18 instead of the server Node 22 — meaning the gate does not test what actually ships and fails for the wrong reasons. It undermines the meaning of \"verified\" substrate-wide.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); full-suite verify is redundant with the gate.",
      "rationale": "Work agents spend 20+ minutes chasing false test failures because the sandbox denies the spawnSync git call (EPERM), and the redundant local full-suite verify repeats work the gate already covers. That is pure throughput loss on every work agent, every cycle, so it ranks with the blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 11,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds the integration stack; pan swarm recover cannot recover it.",
      "rationale": "When the memory governor sheds the integration stack, the swarm final ready-to-merge slot wedges and `pan swarm recover` cannot recover it — a completed slot stranded with no permitted action. It is a deterministic deadlock at the end of the swarm path, so it blocks swarm adoption until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Half-staged spec file blocks all pan-dir mirroring — continue mirrors never land, state drifts.",
      "rationale": "A half-staged spec file left in the index blocks every pan-dir mirror, so continue-state mirrors never land and the canonical state drifts from the worktree. State drift is the recurring corruption root cause, so anything that silently halts mirroring is substrate-critical.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [
        "PAN-2487"
      ],
      "why": "ci-green merge skip bypassed the CI-green gate and landed a red-main change — merge-skip integrity hole.",
      "rationale": "The ci-green merge-skip path bypassed the CI-green gate and landed a red-main change — the merge machinery has an integrity hole that can put main red. A gate that can be skipped into shipping broken code undermines the merge-train contract, so it ranks with the blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 14,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out refresh token — codex review convoys wedge with 401.",
      "rationale": "codex-resume replays a refresh token that has already been rotated out, so codex review convoys wedge on 401 token_revoked — the review half of the pipeline stalls for the entire codex/harness population until token freshness is checked before replay.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 15,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simplify lifecycle reconciliation and add a safe post-planning reset — pipeline-correctness substrate.",
      "rationale": "High-impact: fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset. Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 16,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code backgrounding forks the session file in-process; invisible to session-id resolution, view diverges from terminal.",
      "rationale": "High-impact: Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to a.... Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 17,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge into gatesPassed (derived) + shipComplete; auto-dispatch ship — architecture unblocking the merge path.",
      "rationale": "Substrate hardening: Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 18,
      "size": "L",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations — the recurring re-loop substrate.",
      "rationale": "Substrate hardening: Refactor post-merge lifecycle into composable, idempotent operations. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 19,
      "size": "XS",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "152-error src/dashboard/server typecheck debt masks real errors in the server build — pay it down.",
      "rationale": "High-impact: chore(server): pay down the 152-error src/dashboard/server typecheck debt. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 20,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Frontend typecheck fails with dozens of pre-existing unused-local errors — gate noise hides real failures.",
      "rationale": "Substrate hardening: bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 21,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Comment mediation layer to prevent prompt injection via tracker comments — security substrate.",
      "rationale": "High-impact: Security: Comment mediation layer to prevent prompt injection via tracker comments. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1560",
      "rank": 22,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves does not re-post review status — PR stranded BLOCKED.",
      "rationale": "Substrate hardening: Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 23,
      "size": "XS",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Definition of Ready — the bar an issue must clear before pickup; prevents junk from entering the pipeline.",
      "rationale": "Substrate hardening: chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catc.... Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn docker-health gate has no autonomous recovery — proposed work cannot auto-retry.",
      "rationale": "Substrate hardening: Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack i.... Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "META: 9 systemic failure patterns from the 80-issue audit — substrate work to prevent whole classes of recurrence.",
      "rationale": "Substrate hardening: [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2351",
      "rank": 26,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats — security prerequisites for remote access.",
      "rationale": "High-impact: Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites). Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 27,
      "size": "XL",
      "importance": "high",
      "score": 72,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose merge-agent.ts (1,414 lines) into focused modules — pipeline machinery, supervised handoff.",
      "rationale": "Substrate hardening: refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext.",
      "rationale": "High-impact: enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2232",
      "rank": 50,
      "size": "XL",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose specialists.ts (1749 lines) into focused modules",
      "rationale": "specialists.ts is 1749 lines and part of the regrowing cloister subtree (service.ts just reddened main). Behavior-preserving decomposition into <1000-line modules with a re-export barrel, depth over line count, repointing tests in the same PR. Pipeline-machinery: supervised dispatch (TENET-10), needs-handoff.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2168",
      "rank": 23,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1491",
      "rank": 19,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "XL",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2189",
      "rank": 34,
      "size": "XL",
      "importance": "high",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff.",
      "rationale": "Substrate hardening: Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 35,
      "size": "S",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% context (no thrown overflow) not caught by CONTEXT_OVERFLOW — agent liveness gap.",
      "rationale": "Substrate hardening: bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERN.... Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 36,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero.",
      "rationale": "High-impact: Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck.",
      "rationale": "Substrate hardening: bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys stored as plaintext in config.yaml — security hardening.",
      "rationale": "High-impact: API keys in ~/.panopticon/config.yaml stored as plaintext. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 39,
      "size": "S",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, blocking workspace boot.",
      "rationale": "Substrate hardening: bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace sta.... Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 40,
      "size": "XL",
      "importance": "high",
      "score": 64,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split.",
      "rationale": "Substrate hardening: Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2445",
      "rank": 41,
      "size": "S",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon lifecycle patrol auto-dispatches PLANNING off-book for stale issues — staffed from Fable when no model recorded.",
      "rationale": "High-impact: bug(cloister): deacon lifecycle patrol auto-dispatches PLANNING for stale 'planning'-state issues — off-book, and sta.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 42,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close close-issue phase reports success but leaves the issue OPEN with wrong labels.",
      "rationale": "Substrate hardening: pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent labe.... Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in the shared primary worktree — spec-vs-record drift, blocks flywheel push.",
      "rationale": "Substrate hardening: Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2633",
      "rank": 44,
      "size": "S",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): pending-question payload wiped when an idle-alive asking agent flaps to 'stopped' — needs-you entry vanishes while the qu...",
      "rationale": "High-impact: bug(dashboard): pending-question payload wiped when an idle-alive asking agent flaps to 'stopped' — needs-you entry v.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2598",
      "rank": 113,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue view misreports an in-flight planning session: false \"finished the plan\", missing planning agent in tree, wrong phase banner",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2619",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Terminal panel frame overflows its container — rightmost columns and bottom tmux status bar clipped",
      "rationale": "High-impact: Terminal panel frame overflows its container — rightmost columns and bottom tmux status bar clipped. Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2597",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt codex app-server (JSON-RPC over stdio) as Codex transport — retire TUI keystroke injection",
      "rationale": "Adopt codex app-server (JSON-RPC over stdio) as the Codex transport, retiring the fragile TUI keystroke-injection delivery path for codex agents. Structured transport gives reliable, resumable delivery instead of screen-scraping. Persistent session (not one-shot exec) per the agent-lifecycle rule. In-pipeline.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2568",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Summary fork delivery race: large summary lands in codex composer but is never submitted; conversation looks dead",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2499",
      "rank": 529,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unify the three issue views into one progressive-density Issue View (rail · cockpit · console)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2532",
      "rank": 450,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline rows truncate the title early while horizontal space sits empty — reclaim width for the title without adding height.",
      "rationale": "Cosmetic dashboard tweak: collapse the fixed 200px status column into a title-first 4-column layout so the issue title gets ~440px instead of ~120px, at no extra height. Low — UI polish, no functional impact.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2255",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1987",
      "rank": 422,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "rationale": "Re-verified on updatedAt tick; body still self-declares low-priority cleanup ('not blocking anything'), so rank/score are unchanged.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1232",
      "rank": 191,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1234",
      "rank": 190,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2580",
      "rank": 55,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie",
      "rationale": "Quality bug: pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session a.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2582",
      "rank": 56,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "rationale": "Feature work: feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes). Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 57,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "rationale": "Routine: Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 58,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "rationale": "Quality bug: npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps. Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 59,
      "size": "XL",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall bac...",
      "rationale": "Routine: resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projec.... Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 60,
      "size": "XL",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo)",
      "rationale": "Feature work: feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tr.... Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 61,
      "size": "XL",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "rationale": "Routine: Fly remote workspaces: sync overdeck-state before re-enabling migrated projects. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 62,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure",
      "rationale": "Quality bug: bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then decla.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 63,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled",
      "rationale": "Quality bug: feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled. Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 64,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "rationale": "Routine: Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 65,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "rationale": "Routine: flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 66,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "rationale": "Routine: lint:circular reports new frontend cycles + stale baseline in chat/conversations components. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 67,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "rationale": "Routine: Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node. Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 68,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/...",
      "rationale": "Quality bug: bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (mask.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 69,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "rationale": "Quality bug: bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click. Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 70,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule ...",
      "rationale": "Quality bug: fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-c.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2467",
      "rank": 71,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged)",
      "rationale": "Quality bug: Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged). Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 72,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring)",
      "rationale": "Quality bug: bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 73,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero",
      "rationale": "Quality bug: bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero. Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 74,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification contai...",
      "rationale": "Quality bug: bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 75,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches",
      "rationale": "Quality bug: bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches. Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 76,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label ma...",
      "rationale": "Quality bug: bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.doc.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 77,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits)",
      "rationale": "Routine: Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits). Ranks here because a stable substrate is the prerequisite for everything else.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 78,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "rationale": "Routine: start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the w.... Ranks here because it advances a shipped capability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 79,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [
        "PAN-1980"
      ],
      "why": "bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation...",
      "rationale": "Quality bug: bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit t.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 80,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively",
      "rationale": "Quality bug: bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interacti.... Ranks here because it degrades pipeline reliability or correctness until fixed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 81,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): dashboard server route tests flake under full-suite verification load",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 82,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 83,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree re...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 84,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 85,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-wor...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 86,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 87,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversati...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 88,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 89,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2390",
      "rank": 90,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 91,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 92,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 93,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 94,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unansw...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 95,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for ente...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 96,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 97,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 98,
      "size": "XL",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2295",
      "rank": 99,
      "size": "L",
      "importance": "medium",
      "score": 57,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2288",
      "rank": 100,
      "size": "XL",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 101,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2285",
      "rank": 102,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): per-agent codex-home auth.json rots — seed-once copy forks the OAuth token family, wedging agents in infinite 401 token_revo...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 103,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 104,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2252",
      "rank": 105,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard port has no identity check — workspace peer server squatted :3011 for 6 minutes and passed all health checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 106,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 107,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 108,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 109,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 110,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 111,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 112,
      "size": "S",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 113,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 114,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 115,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 116,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [
        "PAN-43"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 117,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 118,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 119,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 120,
      "size": "XS",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 121,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 122,
      "size": "XL",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Cost strategy: waste detection over budget policing — retire invented limits, land the progress-aware breaker, make dollars honest",
      "gate": "auto",
      "planning": "auto",
      "isEpic": true
    },
    {
      "issue": "PAN-2075",
      "rank": 123,
      "size": "XL",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete (local + Fly), reachable online/CLI/offline",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2059",
      "rank": 124,
      "size": "XL",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection (5th state) + Flywheel relevance-vetting",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1773",
      "rank": 125,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 126,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 127,
      "size": "L",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(stats): surface 'awaiting close-out' (verifying-on-main) count in flywheel stats, pan status, and dashboard headline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 128,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-16...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 129,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard event loop stalls 15-25s under load — watchdog force-restarted it 3x in 45 min",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1666",
      "rank": 130,
      "size": "XL",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1578",
      "rank": 131,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 132,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 133,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 134,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 135,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 136,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1452",
      "rank": 137,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 138,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [
        "PAN-1124"
      ],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1424",
      "rank": 139,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1122"
      ],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 140,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1313",
      "rank": 141,
      "size": "XL",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1246",
      "rank": 142,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 143,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 144,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 145,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-804",
      "rank": 146,
      "size": "XL",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic D: Archaeological audit & pre-1.0 cleanup",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-807",
      "rank": 147,
      "size": "XL",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 148,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1254",
      "rank": 149,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 150,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1198",
      "rank": 151,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 152,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-630",
      "rank": 153,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2377",
      "rank": 154,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): first-class 'special orders' runs — operator-supplied order book executed with lane semantics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2376",
      "rank": 155,
      "size": "XL",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, deploy hygiene, review auto...",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2188",
      "rank": 156,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 157,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 158,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 159,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 160,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 161,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 162,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 163,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(restart): health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 164,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 165,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(palette): Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2647",
      "rank": 166,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(health): replace false-positive system health model and harden Health page contract",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 167,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 168,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 169,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 170,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 171,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 172,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 173,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 174,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 175,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1897",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [
        "PAN-1711"
      ],
      "why": "bug(cli): pan start workspace-prep hangs/times out (>120s) on re-entry — blocks PAN-1711, PAN-1827 (no spawn, no error)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 177,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-1696"
      ],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 178,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flaky main CI: real-timer integration tests time out (~5s) on loaded runners — fork recovery, rollout-JSONL, heartbeat, conversation-rout...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 179,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 180,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 182,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still ...",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1674",
      "rank": 183,
      "size": "M",
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
      "rank": 184,
      "size": "M",
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
      "rank": 185,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 186,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N lines...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 187,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 188,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 189,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 191,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 192,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 193,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1416",
      "rank": 194,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboard servers can bind the main pan.localhost port and hijack the canonical dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 195,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 196,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 197,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 198,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [
        "PAN-1416"
      ],
      "why": "Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 199,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 200,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 201,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 202,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 203,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 204,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 205,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 206,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1227",
      "rank": 207,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1173",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 211,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 212,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 213,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 214,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 216,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 217,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 218,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 219,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 220,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 221,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 222,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 223,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build sometimes skips Vite frontend rebuild",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 224,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 225,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 226,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 227,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 228,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 229,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 230,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2599",
      "rank": 231,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate PostHog for product analytics and telemetry",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2609",
      "rank": 232,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 233,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2566",
      "rank": 234,
      "size": "XL",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2565",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 236,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2556",
      "rank": 237,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exists but isn't wired into the ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 238,
      "size": "L",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 239,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 240,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 241,
      "size": "XS",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do...",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2065",
      "rank": 242,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 243,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 244,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 245,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 246,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 247,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 248,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 249,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 250,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 251,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 252,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 253,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 254,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 255,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 256,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1966",
      "rank": 258,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single authoritative pipeline-membership resolver — one function for \"what's in the pipeline\" (collapse the 5 divergent views)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 260,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 261,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 262,
      "size": "S",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 263,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 264,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 265,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 267,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 268,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 269,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(supervisor): hot-updatable delivery path — version-stamped supervisors, rolling refresh, and dumb-shim primitives with server-side d...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 272,
      "size": "XS",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 273,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1676",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 275,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 276,
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
      "rank": 277,
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
      "issue": "PAN-1655",
      "rank": 278,
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
      "rank": 279,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 281,
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
      "issue": "PAN-1610",
      "rank": 282,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards, IssueDrawer)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 283,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 284,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 285,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 286,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1488",
      "rank": 287,
      "size": "XS",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(repo): add required_pull_request_reviews to main branch protection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 288,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 289,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 290,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 291,
      "size": "L",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 292,
      "size": "XS",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 293,
      "size": "XL",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 294,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 295,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 296,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 297,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1165",
      "rank": 298,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 299,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Push diff summary updates over /ws/rpc instead of 5s polling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 300,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 301,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2661",
      "rank": 302,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Organize the issue actions context menu into clear sections",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2660",
      "rank": 303,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add safe Reset to planned action to the issue actions menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 304,
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
      "issue": "PAN-2630",
      "rank": 305,
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
      "rank": 306,
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
      "rank": 307,
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
      "rank": 308,
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
      "rank": 309,
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
      "rank": 310,
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
      "issue": "PAN-2600",
      "rank": 311,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-2597"
      ],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 312,
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
      "rank": 313,
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
      "rank": 314,
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
      "rank": 315,
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
      "issue": "PAN-2493",
      "rank": 316,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 317,
      "size": "S",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only t...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 318,
      "size": "XL",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 319,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 320,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 321,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2442",
      "rank": 322,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and promp...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 323,
      "size": "XL",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated, remote...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 324,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 325,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1040",
      "rank": 326,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 327,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 328,
      "size": "XL",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 329,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 330,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 331,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 332,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-903",
      "rank": 333,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 334,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 335,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 336,
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
      "rank": 337,
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
      "rank": 338,
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
      "issue": "PAN-2353",
      "rank": 339,
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
      "issue": "PAN-2352",
      "rank": 340,
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
      "issue": "PAN-2350",
      "rank": 341,
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
      "rank": 342,
      "size": "XL",
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
      "rank": 343,
      "size": "XS",
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
      "rank": 344,
      "size": "XS",
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
      "rank": 345,
      "size": "XS",
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
      "rank": 346,
      "size": "XS",
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
      "rank": 347,
      "size": "XS",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 348,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 349,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 350,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2066",
      "rank": 351,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF knowledge skill — deferred v2 capabilities (search, viz, lease writes, MCP, semantic auditor)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2091",
      "rank": 352,
      "size": "XS",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 353,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 354,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 355,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 356,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 357,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2045",
      "rank": 358,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(test): frontend vitest (jsdom) is the test-gate bottleneck — ~5min vs ~72s root; move to happy-dom / tune pool",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 359,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 360,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 361,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [
        "PAN-1936"
      ],
      "why": "feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 362,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 363,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 364,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 365,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 366,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 367,
      "size": "XL",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [
        "PAN-1983"
      ],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 368,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 369,
      "size": "XL",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 370,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 371,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 372,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 373,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector agent should resume a warm session instead of cold-spawning a new one per item",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 374,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 375,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 376,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 377,
      "size": "S",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stall...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 378,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 379,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 380,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywh...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 381,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1896",
      "rank": 382,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce approval friction for GitHub CLI operations in managed sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 383,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 384,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 385,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-783",
      "rank": 386,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents Page Redesign — Unified Multi-View Experience",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 387,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 388,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 389,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 390,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 391,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 392,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 393,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-608",
      "rank": 394,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Destructive Command Guard (dcg) with configurable settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 395,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 396,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 397,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 398,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for workflow agent model selection",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-548",
      "rank": 399,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 400,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 401,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 402,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 403,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 404,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 405,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility reads as 'no agent'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 406,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 407,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 408,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; readyForMerge only ever flips vi...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 409,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ap...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 410,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 411,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 412,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 414,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 416,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 417,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [
        "PAN-1124"
      ],
      "why": "bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 418,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 419,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 420,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [
        "PAN-1491",
        "PAN-1641"
      ],
      "why": "bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 421,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 422,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 423,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 424,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 425,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 426,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 427,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 428,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approv...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 430,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 432,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 433,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 434,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 435,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 437,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 438,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 439,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 441,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 442,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 443,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 444,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 445,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 446,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 447,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 450,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board view follow-up — + New issue column footer button (deferred from PAN-1229)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 452,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 453,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 456,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 458,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 460,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1122",
      "rank": 462,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trim OpenAI model catalog to 5 supported models",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1101",
      "rank": 465,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Permission safety hardening: CI guard, single emission chokepoint, property tests, runtime tripwire",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 466,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 467,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 469,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 471,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 472,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 477,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 482,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 483,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-863",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-853",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-826",
      "rank": 488,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation/terminal integration refactor: instant-start + parser correctness + T3Code structural alignment",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-810",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-797",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-778",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 494,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 495,
      "size": "XL",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 498,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 507,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 522,
      "size": "S",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 523,
      "size": "L",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-702",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-603",
      "rank": 532,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-543",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 554,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 555,
      "size": "XL",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 566,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-190",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 582,
      "size": "L",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 587,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 588,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 589,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 590,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 591,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 592,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 593,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 594,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 595,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 596,
      "size": "XS",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
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
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2642",
      "to": "PAN-1868",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2059",
      "to": "PAN-806",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2487",
      "to": "PAN-2495",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1980",
      "to": "PAN-2414",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-43",
      "to": "PAN-2080",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1124",
      "to": "PAN-1451",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1122",
      "to": "PAN-1424",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1711",
      "to": "PAN-1897",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1696",
      "to": "PAN-1830",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1416",
      "to": "PAN-1444",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2597",
      "to": "PAN-2600",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1936",
      "to": "PAN-2008",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1983",
      "to": "PAN-1984",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1124",
      "to": "PAN-1728",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1491",
      "to": "PAN-1710",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-1641",
      "to": "PAN-1710",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    }
  ]
}
```
