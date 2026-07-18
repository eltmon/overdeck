# Backlog Sequence

_Last sequenced: 2026-07-18T01:50:10Z · model: zai/glm-5.2 · open: 646_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2858 | XL | critical | ok |  |  | ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight |
| 2 | PAN-2857 | S | critical | ok |  |  | Strike branches invisible to pipeline membership — hides active strike work |
| 3 | PAN-2842 | L | high | ok |  |  | Issue cockpit full-width conversations — UX refactor in review |
| 4 | PAN-2840 | M | high | ok |  |  | Task mutation stays terminal after state push race — correctness fix |
| 5 | PAN-2844 | S | high | ok |  |  | Conversation diff panel empty for cross-repo edits (e.g. overdeck-state drafts) |
| 6 | PAN-2829 | M | high | ok |  |  | Finish vBRIEF → xBRIEF rename across code/docs/skills/UI |
| 6 | PAN-806 | M | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 7 | PAN-2838 | S | medium | ok |  |  | Project settings disclosure badge for projects with no settings |
| 8 | PAN-2856 | S | medium | ok |  |  | PostHog telemetry for recovery-reload trigger + failing asset URL |
| 9 | PAN-2855 | XS | medium | ok |  |  | jq prerequisite installer apt-only — fails on Arch/non-Debian |
| 10 | PAN-2853 | S | high | ok |  |  | Desktop AppImage: every dashboard-spawned CLI invocation fails |
| 14 | PAN-2599 | L | high | ok |  |  | Integrate PostHog product analytics + telemetry |
| 15 | PAN-2807 | M | critical | ok |  |  | SQLite schema migrations silently fail — live DB at user_version=0 (needs-close-out) |
| 21 | PAN-2860 | L | critical | ok |  | PAN-2558 | Planning→work auto-handoff dies on migrated projects — strands ALL migrated-project work |
| 22 | PAN-2731 | M | critical | ok |  |  | state.json ghost signal (costSoFar=0, frozen lastActivity) routes pan kill to healthy codex agents (blocks-main) |
| 23 | PAN-2850 | S | critical | ok |  |  | npm test fails in clean checkout — pretest removes dashboard bundle, verification breaks |
| 24 | PAN-2854 | M | critical | ok |  |  | npx @overdeck/core reloads every ~3s — public published-package regression |
| 25 | PAN-2864 | S | critical | ok |  |  | pan review pending crashes entirely when one project lens gather fails |
| 26 | PAN-2846 | S | critical | ok |  |  | Close-out blocks on dead agent: postMergeLifecycle leaves status=running on a dead session |
| 27 | PAN-2848 | M | critical | ok |  |  | Work agent stalls forever on dead inspection: no re-dispatch, verdict never delivered |
| 28 | PAN-2865 | S | high | ok |  |  | JSONL transcript resolution ignores recorded workspace for strike agents — jsonl-missing |
| 29 | PAN-2642 | L | high | ok | ✓ |  | [EPIC] Cost strategy — retire invented limits, land progress-aware breaker, honest dollars |
| 30 | PAN-2569 | M | critical | ok |  |  | Planning finalizes (issue→planned) but work agent never auto-starts |
| 31 | PAN-2650 | M | critical | ok |  |  | Swarm final ready-to-merge slot wedges when memory-governor sheds integration agent |
| 32 | PAN-2706 | M | critical | ok |  |  | Ghost test sessions absorb every test dispatch — never-kicked-off sessions drain the queue |
| 33 | PAN-2567 | S | critical | ok |  |  | Reviewed+green PR stuck after review — advancing verdict reconciliation fails |
| 34 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator unreachable as a notification target — agents auto-resume instead of route |
| 35 | PAN-2639 | M | high | ok |  |  | codex-resume replays a rotated-out (revoked) refresh token → codex review convoy fails |
| 36 | PAN-2379 | S | critical | ok |  |  | verify-gate dependency install is warn-only + 60s timeout → false verify failures |
| 37 | PAN-2593 | S | high | ok |  |  | Dashboard server children inherit bare system PATH — verification gates run wrong binaries |
| 38 | PAN-2511 | M | high | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git |
| 39 | PAN-2516 | S | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift |
| 40 | PAN-2521 | S | high | ok |  |  | Launch pipeline agents with harness rate-limit model-switch reminder instead of stalling |
| 41 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit |
| 42 | PAN-2430 | M | high | ok |  |  | Frontend typecheck fails with dozens of pre-existing unused-local errors — verification noisy |
| 43 | PAN-2421 | M | high | ok |  |  | Dashboard server route tests flake under full-suite verification load |
| 44 | PAN-2337 | M | high | ok |  |  | Reload/build atomicity: in-place npm run build under live dashboard breaks the server |
| 45 | PAN-2324 | S | high | ok |  |  | Close-out label transition fails atomically on missing in-planning label |
| 46 | PAN-2323 | M | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming |
| 47 | PAN-2331 | M | high | ok |  |  | codex rate-limit "Switch to gpt-5.4-mini?" modal stalls autonomous agents |
| 48 | PAN-2333 | M | high | ok |  |  | Handle codex weekly-quota exhaustion gracefully — resource alert + downshift |
| 49 | PAN-2377 | XL | critical | ok |  |  | first-class 'special orders' runs — operator-supplied order book executed with lane semantics |
| 49 | PAN-2259 | M | high | ok |  |  | GraphQL quota burn — something exhausts the 5k/hr GitHub GraphQL budget repeatedly |
| 50 | PAN-2232 | L | high | ok |  |  | Decompose specialists.ts (1749 lines) into focused modules |
| 50 | PAN-2193 | S | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) invisible in the Command Deck |
| 51 | PAN-2186 | M | high | ok |  |  | Post-merge lifecycle can leave merged issues in-review and auto-merge them again |
| 52 | PAN-2179 | S | high | ok |  |  | Relaunch can leave a zombie agent — session alive but kickoff never starts |
| 53 | PAN-2170 | S | high | ok |  |  | Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails |
| 54 | PAN-2169 | M | high | ok |  |  | kimi agent silently frozen at 100% ctx — no thrown overflow error, no recovery |
| 55 | PAN-2165 | S | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong label |
| 56 | PAN-2106 | M | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false spawned success |
| 57 | PAN-1770 | S | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues writes — read ECONNRESET |
| 58 | PAN-1767 | S | high | ok |  |  | Show merged-but-not-closed-out count in pan status + dashboard headline |
| 59 | PAN-1766 | S | high | ok |  |  | Work agents hang on Claude Code settings-file protection when editing settings |
| 60 | PAN-1618 | M | high | ok |  |  | Work-spawn docker-health gate has no autonomous recovery |
| 61 | PAN-1560 | M | high | ok |  |  | Re-review after a PR head moves doesn't re-post review status → PR stuck |
| 62 | PAN-1209 | S | high | ok |  |  | PAN-1052 bead projection disagrees with bd state |
| 63 | PAN-1666 | L | medium | ok | ✓ |  | [EPIC] Pipeline Throughput Hardening — most children already shipped; remaining: PAN-1556 |
| 64 | PAN-1556 | M | medium | ok |  |  | On-demand specialists: coalesce re-reviews, spawn review/test/ship only with queued work |
| 65 | PAN-1868 | L | critical | ok |  |  | Progress-aware cost-bleed circuit breaker — the one real cost guard (cost-epic keystone) |
| 66 | PAN-2466 | S | high | ok |  |  | closeOut.usage clobbering — per-issue cost history lost (ledger integrity bug) |
| 67 | PAN-2075 | L | high | ok | ✓ |  | [EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete, reachable online/CLI/offline |
| 68 | PAN-2077 | L | high | ok |  |  | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) |
| 69 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select |
| 70 | PAN-2079 | L | critical | ok |  |  | Operator Inbox: durable server-side queue + in-dashboard surface |
| 71 | PAN-2080 | M | medium | needs-refinement |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) — offline reach |
| 72 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines — rewards line-packing on the god files it measures |
| 73 | PAN-2189 | XL | high | needs-refinement |  | PAN-2720 | Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervisor |
| 74 | PAN-2190 | XL | high | needs-refinement |  | PAN-2720 | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces merge |
| 75 | PAN-2233 | L | high | needs-refinement |  | PAN-2720 | Decompose merge-agent.ts (1,414 lines) into focused modules |
| 76 | PAN-2255 | M | medium | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 76 | PAN-1650 | L | high | needs-refinement |  |  | Split readyForMerge → gatesPassed (derived) + shipComplete; auto-diagnose stalls |
| 77 | PAN-807 | L | high | needs-refinement |  |  | Epic C: Workspace state sanity on spawn — stop destroying local state |
| 78 | PAN-1313 | L | high | ok |  |  | Finish src/lib Effect migration — remove or justify legacy Promise/sync surfaces |
| 79 | PAN-262 | L | high | ok |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 80 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns from 80-issue audit — substrate work to fix them |
| 81 | PAN-2059 | L | medium | needs-refinement | ✓ |  | [EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection 5th state |
| 82 | PAN-2334 | M | high | needs-refinement |  |  | Write a Definition of Ready (DoR) — the bar an issue must clear before planning |
| 83 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 84 | PAN-1196 | L | medium | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 85 | PAN-1424 | L | medium | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 86 | PAN-1246 | L | medium | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads |
| 87 | PAN-1142 | S | medium | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 88 | PAN-1198 | M | medium | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules |
| 89 | PAN-2830 | L | medium | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in — OFF by default |
| 90 | PAN-2837 | L | medium | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents |
| 91 | PAN-1538 | M | medium | ok |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 92 | PAN-1558 | L | medium | ok |  |  | Review/specialist agents should run in the workspace Docker container |
| 93 | PAN-1561 | L | medium | ok |  |  | Project-scoped dashboard nav: deck of tabs per project + conversations/tree tabs |
| 94 | PAN-2027 | M | medium | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy |
| 95 | PAN-1578 | XL | medium | needs-refinement |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer) |
| 96 | PAN-1219 | M | medium | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) |
| 97 | PAN-1217 | M | medium | ok |  |  | Requirements reviewer: classify each AC in_pr_scope vs whole_feature_scope |
| 98 | PAN-1504 | M | medium | ok |  |  | pan hygiene: codify orchestration merge/commit/push state audit as a CLI |
| 99 | PAN-2558 | L | medium | ok |  |  | state-migration: support polyrepo projects — resolve state-host repo via projectRoot |
| 100 | PAN-1311 | M | medium | needs-refinement |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 101 | PAN-1357 | M | low | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 102 | PAN-1913 | M | low | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer |
| 103 | PAN-1254 | L | low | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet |
| 104 | PAN-1497 | M | low | ok |  |  | Flywheel TTS announcements on lifecycle events |
| 105 | PAN-1889 | S | low | ok |  |  | Flywheel retention/compaction policy for docs/FLYWHEEL-STATE.md |
| 106 | PAN-1544 | S | low | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 107 | PAN-630 | XL | low | needs-refinement |  |  | Multi-tenant workspace isolation with ACLs |
| 108 | PAN-955 | M | medium | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 109 | PAN-813 | S | medium | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 110 | PAN-2358 | S | medium | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness |
| 111 | PAN-2188 | M | medium | ok |  |  | Flywheel resilience for the codebase-health flood — substrate-first prioritization |
| 112 | PAN-1218 | S | medium | ok |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-state check |
| 113 | PAN-1451 | M | medium | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 114 | PAN-1452 | M | medium | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch) |
| 115 | PAN-2859 | S | medium | ok |  |  | Add Kimi K3 (k3 / k3[1m]) to the claude-code Kimi provider — parity with kimi-k2.7 |
| 116 | PAN-2868 | S | low | ok |  |  | Desktop window opens at fixed 1400×900 — persist window state, default first run maximized |
| 117 | PAN-49 | S | medium | stale |  |  | [bug] Fix CloisterService tests that require real runtime |
| 118 | PAN-113 | M | medium | stale |  |  | [bug] Dashboard 'Start Agent' returns success before verifying agent actually started |
| 119 | PAN-244 | M | medium | ok |  |  | [bug] Deep-wipe leaves local branch and worktree metadata behind |
| 120 | PAN-245 | M | medium | ok |  |  | [bug] Ctrl+C aborts planning dialog instead of copying text |
| 121 | PAN-247 | M | medium | ok |  |  | [bug] Deacon has no backoff or escalation for repeated specialist startup failures |
| 122 | PAN-304 | S | medium | ok |  |  | [bug] closeLinearDirect returns stepOk even when state update never happens |
| 123 | PAN-324 | M | medium | ok |  |  | [bug] Agent detail pane missing Merge/Approve button |
| 124 | PAN-334 | M | medium | ok |  |  | [bug] Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 125 | PAN-538 | M | medium | ok |  |  | [bug] pan reload freshness guard must also verify the frontend bundle |
| 126 | PAN-681 | M | medium | ok |  |  | [bug] Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 127 | PAN-727 | S | medium | ok |  |  | [bug] Fix orphaned work-agent start handoff after planning |
| 128 | PAN-775 | XL | medium | ok |  |  | [bug] Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 129 | PAN-778 | S | medium | ok |  |  | [bug] Write conflict race: review-agent fails when test-agent write scope not yet released |
| 130 | PAN-1525 | XL | critical | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-886 | S | medium | ok |  |  | [bug] pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 131 | PAN-900 | S | medium | ok |  |  | [bug] Trust devroot for conversations + atomic .claude.json writes |
| 132 | PAN-927 | L | medium | ok |  |  | [bug] Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 133 | PAN-932 | S | medium | ok |  |  | [bug] pan done: polyrepo uncommitted changes check + existing MR handling |
| 134 | PAN-933 | M | medium | ok |  |  | [bug] Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 135 | PAN-1027 | S | medium | ok |  |  | [bug] Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on |
| 136 | PAN-1042 | S | medium | ok |  |  | [bug] cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 137 | PAN-1068 | S | medium | ok |  |  | [bug] PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 138 | PAN-1113 | S | medium | ok |  |  | [bug] Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 139 | PAN-1128 | S | medium | ok |  |  | [bug] Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 140 | PAN-1129 | S | medium | ok |  |  | [bug] Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 141 | PAN-1130 | S | medium | ok |  |  | [bug] Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 142 | PAN-1149 | S | medium | ok |  |  | [bug] v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 143 | PAN-1150 | S | medium | ok |  |  | [bug] Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab di |
| 144 | PAN-1154 | S | medium | ok |  |  | [bug] pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 145 | PAN-1173 | S | medium | ok |  |  | [bug] pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 146 | PAN-1226 | XL | medium | ok |  |  | [bug] PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 147 | PAN-1227 | M | medium | needs-refinement |  |  | [bug] Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 148 | PAN-1240 | S | medium | ok |  |  | [bug] Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 149 | PAN-1244 | S | medium | ok |  |  | [bug] pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 150 | PAN-1245 | L | medium | ok |  |  | [bug] Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 151 | PAN-1330 | S | medium | ok |  |  | [bug] CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan pla |
| 152 | PAN-1386 | L | medium | ok |  |  | [bug] Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active ru |
| 153 | PAN-1392 | S | medium | ok |  |  | [bug] pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 154 | PAN-1416 | S | medium | ok |  |  | [bug] Workspace-spawned dashboards must never claim the canonical dashboard port |
| 155 | PAN-1433 | S | medium | ok |  |  | [bug] Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 156 | PAN-1436 | S | medium | ok |  |  | [bug] PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 157 | PAN-1438 | L | medium | ok |  |  | [bug] pan flywheel start launcher process orphans when orchestrator dies externally |
| 158 | PAN-1440 | S | medium | ok |  |  | [bug] Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 159 | PAN-1444 | S | medium | ok |  |  | [bug] Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 160 | PAN-1445 | M | medium | ok |  |  | [bug] PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 161 | PAN-1446 | M | medium | ok |  |  | [bug] PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 162 | PAN-1449 | S | medium | ok |  |  | [bug] PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 163 | PAN-1461 | S | medium | ok |  |  | [bug] Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 164 | PAN-1480 | XL | medium | ok |  |  | [bug] TLDR: 93% bypass rate — daemon/hook integration broken |
| 165 | PAN-1530 | S | medium | ok |  |  | [bug] Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 166 | PAN-1565 | S | medium | ok |  |  | [bug] Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream # |
| 167 | PAN-1571 | S | medium | ok |  |  | [bug] Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's colla |
| 168 | PAN-1572 | S | medium | ok |  |  | [bug] Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions  |
| 169 | PAN-1624 | S | medium | ok |  |  | [bug] pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty  |
| 170 | PAN-1627 | S | medium | ok |  |  | [bug] Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridabl |
| 171 | PAN-1668 | S | medium | ok |  |  | [bug] bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off |
| 172 | PAN-1669 | S | medium | ok |  |  | [bug] bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refre |
| 173 | PAN-1672 | S | medium | ok |  |  | [bug] GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 174 | PAN-1673 | S | medium | ok |  |  | [bug] Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 175 | PAN-1674 | S | medium | ok |  |  | [bug] TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 176 | PAN-1710 | S | medium | ok |  |  | [bug] bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 an |
| 177 | PAN-1711 | S | medium | ok |  |  | [bug] Root-cause and fix dashboard event-loop stalls under load |
| 178 | PAN-1720 | S | medium | ok |  |  | [bug] bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddeni |
| 179 | PAN-1728 | S | medium | ok |  |  | [bug] bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on fea |
| 180 | PAN-1740 | S | medium | ok |  |  | [bug] Deacon mislabels SIGTERM workspace container restarts as crashes |
| 181 | PAN-1755 | S | medium | ok |  |  | [bug] bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agent |
| 182 | PAN-1761 | S | medium | ok |  |  | [bug] bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers ( |
| 183 | PAN-1769 | L | medium | ok |  |  | [bug] Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback);  |
| 184 | PAN-1774 | S | medium | ok |  |  | [bug] bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 185 | PAN-1782 | S | medium | ok |  |  | [bug] Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the  |
| 186 | PAN-1795 | S | medium | ok |  |  | [bug] Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 187 | PAN-1816 | S | medium | ok |  |  | [bug] Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — nee |
| 188 | PAN-1824 | S | medium | ok |  |  | [bug] Fix flaky main CI: fake timers + @slow exclusion for real-timer test family |
| 189 | PAN-1828 | S | medium | ok |  |  | [bug] Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 190 | PAN-1830 | S | medium | ok |  |  | [bug] Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report writ |
| 191 | PAN-1846 | S | medium | ok |  |  | [bug] bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line  |
| 192 | PAN-1907 | S | medium | ok |  |  | [bug] Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-se |
| 193 | PAN-1912 | S | medium | ok |  |  | [bug] Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 194 | PAN-1918 | S | medium | ok |  |  | [bug] bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test |
| 195 | PAN-2006 | S | medium | ok |  |  | [bug] Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, |
| 196 | PAN-2069 | S | medium | ok |  |  | [bug] caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 197 | PAN-2197 | S | medium | ok |  |  | [bug] bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents s |
| 198 | PAN-2201 | S | medium | ok |  |  | [bug] Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — cl |
| 199 | PAN-2202 | S | medium | ok |  |  | [bug] complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize  |
| 200 | PAN-2213 | S | medium | ok |  |  | [bug] Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 201 | PAN-2237 | S | medium | ok |  |  | [bug] bug(cli): pan plan done swallows vbrief quality lint details |
| 202 | PAN-2240 | S | medium | ok |  |  | [bug] bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appe |
| 203 | PAN-2241 | S | medium | ok |  |  | [bug] complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash |
| 204 | PAN-2242 | S | medium | ok |  |  | [bug] Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session  |
| 205 | PAN-2243 | S | medium | ok |  |  | [bug] pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (f |
| 206 | PAN-2244 | S | medium | ok |  |  | [bug] Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continu |
| 207 | PAN-2280 | S | medium | ok |  |  | [bug] Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from ter |
| 208 | PAN-2282 | S | medium | ok |  |  | [bug] Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 209 | PAN-2287 | S | medium | ok |  |  | [bug] bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target  |
| 210 | PAN-2381 | S | medium | ok |  |  | [bug] bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent "Rec |
| 211 | PAN-2395 | S | medium | ok |  |  | [bug] bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked e |
| 212 | PAN-2408 | S | medium | ok |  |  | [bug] bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks  |
| 213 | PAN-2414 | S | medium | ok |  |  | [bug] bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, other |
| 214 | PAN-2416 | S | medium | ok |  |  | [bug] bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-in |
| 215 | PAN-2422 | M | medium | ok |  |  | [bug] bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard |
| 216 | PAN-2423 | M | medium | ok |  |  | [bug] bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templa |
| 217 | PAN-2428 | S | medium | ok |  |  | [bug] bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing trae |
| 218 | PAN-2449 | S | medium | ok |  |  | [bug] start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and pla |
| 219 | PAN-2454 | S | medium | ok |  |  | [bug] bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished  |
| 220 | PAN-2465 | S | medium | ok |  |  | [bug] bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonz |
| 221 | PAN-2467 | S | medium | ok |  |  | [bug] Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged) |
| 222 | PAN-2469 | S | medium | ok |  |  | [bug] feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify →  |
| 223 | PAN-2478 | S | medium | ok |  |  | [bug] CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 224 | PAN-2484 | S | medium | ok |  |  | [bug] fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; |
| 225 | PAN-2489 | S | medium | ok |  |  | [bug] bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 226 | PAN-2492 | S | medium | ok |  |  | [bug] bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered  |
| 227 | PAN-2495 | S | medium | ok |  |  | [bug] PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change |
| 228 | PAN-2501 | S | medium | ok |  |  | [bug] bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfi |
| 229 | PAN-2506 | S | medium | ok |  |  | [bug] flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 230 | PAN-2533 | S | medium | ok |  |  | [bug] UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 231 | PAN-2546 | S | medium | ok |  |  | [bug] bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery |
| 232 | PAN-2547 | S | medium | ok |  |  | [bug] bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms the |
| 233 | PAN-2550 | S | medium | ok |  |  | [bug] bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level |
| 234 | PAN-2554 | S | medium | ok |  |  | [bug] bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/book |
| 235 | PAN-2560 | XL | medium | ok |  |  | [bug] resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated |
| 236 | PAN-2563 | S | medium | ok |  |  | [bug] npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 237 | PAN-2572 | S | medium | ok |  |  | [bug] Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 238 | PAN-2580 | S | medium | ok |  |  | [bug] pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live se |
| 239 | PAN-2627 | S | medium | ok |  |  | [bug] bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the w |
| 240 | PAN-2649 | S | medium | ok |  |  | [bug] bug(palette): Ctrl+K conversation search indexes Claude transcripts only |
| 241 | PAN-2651 | M | medium | ok |  |  | [bug] fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset |
| 242 | PAN-2652 | S | medium | ok |  |  | [bug] Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisib |
| 243 | PAN-2656 | S | medium | ok |  |  | [bug] bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 244 | PAN-2659 | S | medium | ok |  |  | [bug] fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #262 |
| 245 | PAN-2663 | S | medium | ok |  |  | [bug] bug(restart): health probe can accept old dashboard after replacement EADDRINUSE |
| 246 | PAN-2664 | S | medium | ok |  |  | [bug] bug(sync-main): auto-commit completes unresolved merge with conflict markers |
| 247 | PAN-2668 | S | medium | ok |  |  | [bug] Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery |
| 248 | PAN-2670 | S | medium | ok |  |  | [bug] Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-ex |
| 249 | PAN-2672 | S | medium | ok |  |  | [bug] Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null cla |
| 250 | PAN-2680 | S | medium | ok |  |  | [bug] pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 251 | PAN-2686 | S | medium | ok |  |  | [bug] Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky |
| 252 | PAN-2689 | S | medium | ok |  |  | [bug] Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with |
| 253 | PAN-2691 | S | medium | ok |  |  | [bug] Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, |
| 254 | PAN-2695 | S | medium | ok |  |  | [bug] Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and k |
| 255 | PAN-2696 | S | medium | ok |  |  | [bug] Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced |
| 256 | PAN-2697 | S | medium | ok |  |  | [bug] First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal |
| 257 | PAN-2699 | M | medium | ok |  |  | [bug] npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree a |
| 258 | PAN-1966 | M | critical | ok |  |  | Single authoritative pipeline-membership resolver — one function for "what's in the pipeline" (collapse the 5 divergent views) |
| 258 | PAN-2700 | S | medium | ok |  |  | [bug] Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the prev |
| 259 | PAN-2717 | S | medium | ok |  |  | [bug] bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse |
| 260 | PAN-2733 | S | medium | ok |  |  | [bug] bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,9 |
| 261 | PAN-2734 | S | medium | ok |  |  | [bug] bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge ha |
| 262 | PAN-2738 | S | medium | ok |  |  | [bug] bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate,  |
| 263 | PAN-2739 | S | medium | ok |  |  | [bug] bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeSta |
| 264 | PAN-2742 | S | medium | ok |  |  | [bug] bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure fai |
| 265 | PAN-2746 | S | medium | ok |  |  | [bug] bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearl |
| 266 | PAN-2747 | S | medium | ok |  |  | [bug] Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run |
| 267 | PAN-2749 | S | medium | ok |  |  | [bug] Resume restores the conversation but not the machinery: timers, monitors and background processes die and are  |
| 268 | PAN-2754 | S | medium | ok |  |  | [bug] bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 269 | PAN-2755 | S | medium | ok |  |  | [bug] bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 270 | PAN-2758 | S | medium | ok |  |  | [bug] Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stay |
| 271 | PAN-2759 | S | medium | ok |  |  | [bug] Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired an |
| 272 | PAN-2761 | S | medium | ok |  |  | [bug] done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBO |
| 273 | PAN-1896 | S | high | ok |  |  | Reduce approval friction for GitHub CLI operations in managed sessions |
| 273 | PAN-2763 | S | medium | ok |  |  | [bug] Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md expl |
| 274 | PAN-2769 | S | medium | ok |  |  | [bug] review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/faile |
| 275 | PAN-2775 | S | medium | ok |  |  | [bug] Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simul |
| 276 | PAN-2792 | S | medium | ok |  |  | [bug] Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 277 | PAN-2796 | S | medium | ok |  |  | [bug] fix(cloister): idle nudge must not advance after failed mandatory inspection |
| 278 | PAN-2802 | S | medium | ok |  |  | [bug] bug(cloister): same-head strike-ready cannot re-arm a needs-you landing |
| 279 | PAN-2805 | S | medium | ok |  |  | [bug] FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal land |
| 280 | PAN-2806 | S | medium | ok |  |  | [bug] bug(cloister): strike merge trigger registry splits across dashboard chunks |
| 281 | PAN-2810 | S | medium | ok |  |  | [bug] Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSu |
| 282 | PAN-2813 | S | medium | ok |  |  | [bug] Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 283 | PAN-2820 | M | medium | ok |  |  | [bug] CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback) |
| 284 | PAN-2824 | S | medium | ok |  |  | [bug] pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 285 | PAN-2828 | S | medium | ok |  |  | [bug] pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 286 | PAN-2839 | S | medium | ok |  |  | [bug] plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825) |
| 287 | PAN-2869 | S | medium | ok |  |  | [bug] Conversation launch dies with raw 'execvp(3) failed' when the harness binary (claude) is missing or not on the |
| 288 | PAN-2376 | XL | medium | ok |  |  | [substrate] Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening,  |
| 289 | PAN-578 | M | high | ok |  |  | [security] Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 290 | PAN-1435 | S | high | ok |  |  | [security] API keys in ~/.panopticon/config.yaml stored as plaintext |
| 291 | PAN-1915 | S | high | ok |  |  | [security] enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext |
| 292 | PAN-532 | M | medium | ok |  |  | [feat] Per-project and per-issue model overrides for pipeline roles |
| 293 | PAN-817 | S | medium | ok |  |  | [feat] Improve planning dialog layout and content fit |
| 294 | PAN-924 | XL | medium | ok |  |  | [feat] Spike: evaluate GitNexus for Panopticon integration |
| 295 | PAN-1040 | S | medium | ok |  |  | [feat] feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 296 | PAN-1041 | S | medium | ok |  |  | [feat] Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 297 | PAN-537 | S | medium | ok |  |  | [item] feat: show changed files diff summary after each agent response in activity view |
| 298 | PAN-646 | L | medium | ok |  |  | [item] Canceled issues: add guided Recover workflow |
| 299 | PAN-700 | M | medium | ok |  |  | [item] Detachable terminal for conversation view — popout into OS window |
| 300 | PAN-713 | M | medium | ok |  |  | [item] test: add unit tests for doneCommand and approveCommand |
| 301 | PAN-802 | S | medium | ok |  |  | [item] Resume on conversation session forks instead of resuming |
| 302 | PAN-863 | S | medium | ok |  |  | [item] One-shot sweep of stale feature branches and worktrees predating the reaper |
| 303 | PAN-947 | S | medium | ok |  |  | [feat] feat: project management actions in unified sidebar |
| 304 | PAN-1164 | S | medium | ok |  |  | [feat] Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 305 | PAN-1577 | S | medium | ok |  |  | [feat] Move a conversation to a different project (CLI + drag/drop + menu action) |
| 306 | PAN-1951 | S | medium | ok |  |  | [item] Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 307 | PAN-37 | M | medium | stale |  |  | [feat] Support external PR selection for merge-agent |
| 308 | PAN-38 | M | medium | stale |  |  | [feat] Support multiple merge agents per repository |
| 309 | PAN-77 | S | medium | stale |  |  | [feat] Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 310 | PAN-243 | M | medium | ok |  |  | [feat] Audit dashboard actions: ensure all are available via CLI |
| 311 | PAN-252 | M | medium | ok |  |  | [feat] Disable Sync with Main button when workspace is up to date |
| 312 | PAN-255 | M | medium | ok |  |  | [feat] Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 313 | PAN-258 | M | medium | ok |  |  | [feat] Kanban board: fit all columns without horizontal scrolling |
| 314 | PAN-277 | M | medium | ok |  |  | [feat] Session reasoning capture & collaborative PRD refinement |
| 315 | PAN-293 | M | medium | ok |  |  | [feat] Project Living Memory — per-project semantic memory for agents |
| 316 | PAN-294 | L | medium | ok |  |  | [feat] Surface module initialization errors as system-level, not per-issue |
| 317 | PAN-450 | M | medium | ok |  |  | [feat] Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 318 | PAN-452 | M | medium | ok |  |  | [feat] Conversation input bar — mode/permissions/workspace selectors |
| 319 | PAN-454 | M | medium | ok |  |  | [feat] Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 320 | PAN-463 | M | medium | ok |  |  | [feat] Add Qwen 3.6+ model support |
| 321 | PAN-465 | M | medium | ok |  |  | [feat] Add OpenRouter as a model provider |
| 322 | PAN-466 | M | medium | ok |  |  | [feat] Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 323 | PAN-531 | M | medium | ok |  |  | [feat] PAN: Windows Electron support (WSL2 required) |
| 324 | PAN-546 | M | medium | ok |  |  | [feat] Remove claude-code-router — all providers use direct env var injection |
| 325 | PAN-548 | M | medium | ok |  |  | [feat] Command Deck: preserve state across navigation including URL routing for tabs |
| 326 | PAN-606 | M | medium | ok |  |  | [feat] Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 327 | PAN-607 | M | medium | ok |  |  | [feat] Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 328 | PAN-613 | M | medium | ok |  |  | [feat] Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 329 | PAN-629 | M | medium | ok |  |  | [feat] Workspace quotas and resource governance |
| 330 | PAN-637 | M | medium | ok |  |  | [feat] Direct issue kickoff (skip planning) from dashboard UI |
| 331 | PAN-649 | M | medium | ok |  |  | [feat] Render Excalidraw drawings inline in Claude Code conversations |
| 332 | PAN-654 | M | medium | ok |  |  | [feat] Project Setup Wizard — Dashboard UI |
| 333 | PAN-675 | M | medium | ok |  |  | [feat] Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 334 | PAN-678 | M | medium | ok |  |  | [feat] pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 335 | PAN-687 | M | medium | ok |  |  | [feat] Support OpenCode as alternative coding agent |
| 336 | PAN-818 | S | medium | ok |  |  | [feat] Make summary optional when forking conversations |
| 337 | PAN-901 | M | medium | ok |  |  | [feat] Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 338 | PAN-902 | M | medium | ok |  |  | [feat] Settings: add 'Run pan sync' button to configuration menu |
| 339 | PAN-903 | S | medium | ok |  |  | [feat] Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 340 | PAN-938 | S | medium | ok |  |  | [feat] Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 341 | PAN-949 | M | medium | ok |  |  | [feat] feat: add conversation for project from sidebar |
| 342 | PAN-958 | XL | medium | ok |  |  | [feat] Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 343 | PAN-1037 | S | medium | ok |  |  | [feat] Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 344 | PAN-1060 | S | medium | ok |  |  | [feat] Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 345 | PAN-1151 | S | medium | ok |  |  | [feat] Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 346 | PAN-1165 | S | medium | ok |  |  | [feat] Lightweight review path for small/trivial PRs |
| 347 | PAN-1223 | S | medium | ok |  |  | [feat] Auto-update for users in the field (npm + desktop binaries) |
| 348 | PAN-1432 | S | medium | ok |  |  | [feat] Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 349 | PAN-1437 | S | medium | ok |  |  | [feat] pan flywheel report semantics: split read-only snapshot from run finalization |
| 350 | PAN-1442 | S | medium | ok |  |  | [feat] Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 351 | PAN-1443 | XL | medium | ok |  |  | [feat] Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 352 | PAN-1469 | S | medium | ok |  |  | [docs] End-to-end review and consolidation of all project documentation |
| 353 | PAN-1473 | XL | medium | ok |  |  | [feat] Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separatel |
| 354 | PAN-1485 | S | medium | ok |  |  | [feat] Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 355 | PAN-1489 | S | medium | needs-refinement |  |  | [feat] task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 356 | PAN-1490 | S | medium | ok |  |  | [feat] feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 357 | PAN-1524 | S | medium | ok |  |  | [feat] Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 358 | PAN-1542 | L | medium | ok |  |  | [feat] Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 359 | PAN-1545 | S | medium | ok |  |  | [feat] feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palet |
| 360 | PAN-1623 | S | medium | ok |  |  | [feat] Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 361 | PAN-1653 | M | medium | ok |  |  | [feat] perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 362 | PAN-1654 | M | medium | ok |  |  | [feat] perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 363 | PAN-1655 | S | medium | ok |  |  | [feat] Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 364 | PAN-1656 | S | medium | ok |  |  | [feat] Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 365 | PAN-1657 | S | medium | ok |  |  | [feat] feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 366 | PAN-1676 | S | medium | ok |  |  | [feat] feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 367 | PAN-1684 | M | medium | ok |  |  | [docs] docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 368 | PAN-1685 | M | medium | ok |  |  | [feat] Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 369 | PAN-1776 | S | medium | ok |  |  | [feat] Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 370 | PAN-1837 | M | medium | ok |  |  | [feat] Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 371 | PAN-1839 | S | medium | ok |  |  | [feat] Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 372 | PAN-1840 | M | medium | ok |  |  | [feat] Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard |
| 373 | PAN-1844 | S | medium | ok |  |  | [feat] Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link |
| 374 | PAN-1852 | S | medium | ok |  |  | [feat] Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval |
| 375 | PAN-1853 | S | medium | ok |  |  | [feat] Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 376 | PAN-1854 | S | medium | ok |  |  | [feat] Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 377 | PAN-1916 | S | medium | ok |  |  | [feat] feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 378 | PAN-1965 | S | medium | ok |  |  | [feat] Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 379 | PAN-1967 | M | medium | ok |  |  | [feat] Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 380 | PAN-1968 | S | medium | ok |  |  | [feat] Finish local-domain rename: pan.localhost → overdeck.localhost |
| 381 | PAN-1985 | S | medium | ok |  |  | [feat] Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 382 | PAN-1991 | XL | medium | ok |  |  | [feat] Issue cockpit redesign — incremental rollout (tracking) |
| 383 | PAN-1995 | S | medium | ok |  |  | [feat] infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 384 | PAN-2004 | S | medium | ok |  |  | [feat] Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 385 | PAN-2024 | S | medium | ok |  |  | [feat] ohmypi: frontend Tools-toggle for conversation view |
| 386 | PAN-2025 | S | medium | ok |  |  | [feat] ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 387 | PAN-2026 | S | medium | ok |  |  | [feat] ohmypi: surface 35+ provider matrix in dashboard model picker |
| 388 | PAN-2028 | S | medium | ok |  |  | [feat] ohmypi: per-provider cost grouping in cost dashboard |
| 389 | PAN-2029 | S | medium | ok |  |  | [feat] ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 390 | PAN-2030 | S | medium | ok |  |  | [feat] ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 391 | PAN-2031 | M | medium | ok |  |  | [feat] ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 392 | PAN-2032 | S | medium | ok |  |  | [feat] ohmypi: local Ollama model as zero-cost preliminary review role |
| 393 | PAN-2033 | S | medium | ok |  |  | [feat] ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 394 | PAN-2034 | S | medium | ok |  |  | [feat] ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 395 | PAN-2035 | S | medium | ok |  |  | [feat] ohmypi: GitHub Copilot subscription provider routing via omp |
| 396 | PAN-2065 | S | medium | ok |  |  | [feat] feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 397 | PAN-2266 | M | medium | ok |  |  | [feat] feat: add zcode harness and make it the default for glm-5.2 |
| 398 | PAN-2288 | S | medium | ok |  |  | [feat] tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow |
| 399 | PAN-2295 | XL | medium | needs-refinement |  |  | [feat] feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation in |
| 400 | PAN-2335 | S | medium | ok |  |  | [feat] chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for ope |
| 401 | PAN-2548 | S | medium | ok |  |  | [feat] chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every p |
| 402 | PAN-2553 | L | medium | ok |  |  | [feat] feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with |
| 403 | PAN-2557 | S | medium | ok |  |  | [feat] feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by t |
| 404 | PAN-2556 | M | medium | ok |  |  | [feat] feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exist |
| 405 | PAN-2565 | S | medium | ok |  |  | [feat] Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 406 | PAN-2566 | XL | medium | ok |  |  | [feat] Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 407 | PAN-2582 | S | medium | ok |  |  | [feat] feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lane |
| 408 | PAN-2608 | S | medium | ok |  |  | [feat] Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance mile |
| 409 | PAN-2609 | S | medium | ok |  |  | [feat] Cross-device sync of conversations and tasks via user-owned git remote |
| 410 | PAN-2646 | S | medium | ok |  |  | [feat] feat(swarm): configurable global/project/issue policy UI with default OFF |
| 411 | PAN-2685 | S | medium | ok |  |  | [feat] Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 412 | PAN-2718 | S | medium | ok |  |  | [feat] pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on  |
| 413 | PAN-633 | M | low | ok |  |  | [docs] Update Cloister PRD and docs index — stale relative to implementation |
| 414 | PAN-634 | S | low | ok |  |  | [docs] Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 415 | PAN-674 | M | low | ok |  |  | [docs] docs: add glossary of Panopticon domain terms |
| 416 | PAN-1474 | M | low | ok |  |  | [docs] Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 417 | PAN-1683 | S | low | ok |  |  | [docs] docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) |
| 418 | PAN-2067 | M | low | ok |  |  | [docs] docs: add user-facing page for RTK (Bash output compression) |
| 419 | PAN-2068 | M | low | ok |  |  | [docs] docs: add user-facing page for Caveman (agent output compression) |
| 420 | PAN-2070 | L | low | ok |  |  | [docs] docs: add user-facing page for the Flywheel orchestrator |
| 421 | PAN-2071 | L | low | ok |  |  | [docs] docs: add user-facing page for the Hooks system |
| 422 | PAN-2073 | M | low | ok |  |  | [docs] docs: add user-facing page for the Desktop App |
| 423 | PAN-1066 | S | low | ok |  |  | [item] Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 424 | PAN-1126 | S | low | ok |  |  | [item] Integrate TLDR summaries into review context manifest |
| 425 | PAN-43 | M | low | stale |  |  | [item] Add Slack and email notifications for agent events |
| 426 | PAN-44 | M | low | stale |  |  | [item] Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 427 | PAN-47 | M | low | stale |  |  | [item] PRD files should be committed to feature branch, moved to completed/ on merge |
| 428 | PAN-51 | M | low | needs-refinement |  |  | [item] Documentation: Clarify issue tracker options beyond Linear |
| 429 | PAN-52 | M | low | needs-refinement |  |  | [item] Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 430 | PAN-54 | XL | low | stale |  |  | [item] feat: Add pan test:e2e command for full workflow integration test |
| 431 | PAN-55 | M | low | stale |  |  | [item] Track specialist costs with time period filtering |
| 432 | PAN-106 | M | low | stale |  |  | [item] Cost prediction/estimation for in-progress work |
| 433 | PAN-146 | M | low | stale |  |  | [item] PAN-146: Refine light mode theming across all dashboard pages |
| 434 | PAN-155 | XL | low | stale |  |  | [item] PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 435 | PAN-175 | M | low | stale |  |  | [item] PAN-175: Pre-compact auto-save hook for agent sessions |
| 436 | PAN-176 | M | low | stale |  |  | [item] PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 437 | PAN-177 | M | low | stale |  |  | [item] PAN-177: Iteration limits with escalation for autonomous agents |
| 438 | PAN-178 | M | low | stale |  |  | [item] PAN-178: Crash recovery with granular task checkpointing |
| 439 | PAN-180 | M | low | stale |  |  | [item] PAN-180: Cross-terminal file locking for concurrent agents |
| 440 | PAN-190 | M | low | stale |  |  | [item] PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 441 | PAN-198 | M | low | stale |  |  | [item] Structured audit trail for agent actions |
| 442 | PAN-227 | M | low | ok |  |  | [item] Phase gate validation — mid-implementation acceptance checks |
| 443 | PAN-228 | M | low | ok |  |  | [item] Shift-left post-edit diagnostics — type check after every edit |
| 444 | PAN-241 | XL | low | ok |  |  | [item] Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 445 | PAN-249 | M | low | ok |  |  | [item] Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 446 | PAN-265 | M | low | ok |  |  | [item] Review skill categorization: all skills available everywhere via personal + workspace |
| 447 | PAN-271 | M | low | ok |  |  | [item] Auto-assign Linear project from project config when creating issues |
| 448 | PAN-283 | M | low | ok |  |  | [item] Reset should sync workspace feature branch with latest main |
| 449 | PAN-297 | M | low | ok |  |  | [item] Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 450 | PAN-298 | M | low | ok |  |  | [item] Auto-detect package manager and runtime in workspace setup |
| 451 | PAN-299 | M | low | ok |  |  | [item] Granular session state persistence across context compaction |
| 452 | PAN-407 | M | low | ok |  |  | [item] Run Panopticon from a main workspace for development isolation |
| 453 | PAN-438 | XL | low | ok |  |  | [item] Migrate remaining REST polling endpoints to Effect RPC |
| 454 | PAN-459 | M | low | ok |  |  | [item] Planning setup screen with SSE progress streaming |
| 455 | PAN-461 | M | low | ok |  |  | [item] Deep-wipe multi-step progress dialog |
| 456 | PAN-468 | M | low | ok |  |  | [item] Agent test conversations pollute production database — need test isolation |
| 457 | PAN-471 | M | low | ok |  |  | [item] Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 458 | PAN-476 | M | low | ok |  |  | [item] Agent resume with Haiku session summary instead of claude --resume |
| 459 | PAN-480 | M | low | ok |  |  | [item] Pass --effort flag when spawning planning agents via Cloister |
| 460 | PAN-483 | S | low | ok |  |  | [item] Unify Resume Agent UX — all entry points should show message input |
| 461 | PAN-543 | M | low | ok |  |  | [item] Add confirmation dialog before applying Optimal Defaults |
| 462 | PAN-554 | M | low | ok |  |  | [item] Add kanban board deeplinks for issue URLs |
| 463 | PAN-564 | M | low | ok |  |  | [item] Slash menu positioned incorrectly — cut off / off-screen |
| 464 | PAN-565 | M | low | ok |  |  | [item] Handle CTRL-Z to undo accidental conversation archival |
| 465 | PAN-568 | S | low | ok |  |  | [item] Kanban: Show workspace and tmux session counts in stats |
| 466 | PAN-570 | S | low | ok |  |  | [item] Show PLAN badge on costs when under a subscription/plan |
| 467 | PAN-571 | M | low | ok |  |  | [item] Add OpenRouter credits/plan status endpoint and UI |
| 468 | PAN-576 | M | low | ok |  |  | [item] Global / search should include conversations in addition to workspace features |
| 469 | PAN-589 | S | low | ok |  |  | [item] Review and update commands-skills.md with all available Panopticon skills |
| 470 | PAN-591 | M | low | ok |  |  | [item] Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 471 | PAN-603 | M | low | ok |  |  | [item] Plan review loop with configurable reviewer model |
| 472 | PAN-604 | M | low | ok |  |  | [item] Hide planning agent from workspace detail pane |
| 473 | PAN-622 | L | low | ok |  |  | [item] YAML workflow DAGs: custom per-project pipeline definitions |
| 474 | PAN-623 | L | low | ok |  |  | [item] Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 475 | PAN-624 | M | low | ok |  |  | [item] Loop nodes: iterative agent execution with conditional termination |
| 476 | PAN-658 | M | low | ok |  |  | [item] Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 477 | PAN-660 | M | low | ok |  |  | [item] Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 478 | PAN-663 | M | low | ok |  |  | [item] Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 479 | PAN-701 | M | low | ok |  |  | [item] Quick-Create conversation via keystroke using Conversations-page default model |
| 480 | PAN-702 | M | low | ok |  |  | [item] OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 481 | PAN-709 | M | low | ok |  |  | [item] feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A dete |
| 482 | PAN-730 | M | low | ok |  |  | [item] Add provider account telemetry for credits, balances, and usage |
| 483 | PAN-735 | M | low | ok |  |  | [item] Settings page: review and configure overridden subagent model files |
| 484 | PAN-736 | M | low | ok |  |  | [item] feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 485 | PAN-738 | M | low | ok |  |  | [item] Add right-click fork option to conversation list |
| 486 | PAN-743 | M | low | ok |  |  | [item] Add consistent new conversation icon actions in Command Deck |
| 487 | PAN-747 | M | low | ok |  |  | [item] Conversation list items lack accessible labels in accessibility tree |
| 488 | PAN-749 | M | low | ok |  |  | [item] Research and borrow best features from gstack |
| 489 | PAN-750 | XL | low | ok |  |  | [item] PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 490 | PAN-751 | M | low | ok |  |  | [item] PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 491 | PAN-752 | M | low | ok |  |  | [item] Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 492 | PAN-762 | M | low | ok |  |  | [item] Settings: warn when model overrides target disabled providers |
| 493 | PAN-764 | M | low | ok |  |  | [item] Add quota/usage inspector for routed model providers |
| 494 | PAN-765 | S | low | ok |  |  | [item] Preserve trailing zeros in cost displays |
| 495 | PAN-769 | M | low | ok |  |  | [item] Track verification/review/test phase churn over time |
| 496 | PAN-771 | M | low | ok |  |  | [item] Investigate Vercel Sandbox execution backend support |
| 497 | PAN-772 | S | low | ok |  |  | [item] Unify terminal stack behavior across tmux sessions |
| 498 | PAN-773 | S | low | ok |  |  | [item] Design prompt-style overlays with model hierarchy and scoped toggles |
| 499 | PAN-774 | M | low | ok |  |  | [item] Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 500 | PAN-777 | S | low | ok |  |  | [item] Inter-agent communication skill: send messages to conversation-mode agents |
| 501 | PAN-786 | S | low | ok |  |  | [item] Post planning Q\&A answers as issue comment |
| 502 | PAN-790 | S | low | ok |  |  | [item] PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 503 | PAN-791 | S | low | ok |  |  | [item] Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 504 | PAN-793 | S | low | ok |  |  | [item] Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 505 | PAN-797 | S | low | ok |  |  | [item] Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 506 | PAN-810 | S | low | ok |  |  | [item] Inspector: diagnostic UI when pipeline phase is unknown |
| 507 | PAN-832 | S | low | ok |  |  | [item] state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActiv |
| 508 | PAN-833 | S | low | ok |  |  | [item] Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 509 | PAN-853 | XL | low | ok |  |  | [item] Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 510 | PAN-898 | S | low | ok |  |  | [item] Dashboard polling and WebSocket efficiency: remaining audit findings |
| 511 | PAN-908 | S | low | ok |  |  | [item] PAN-908: Make work-agent spawn limits configurable and overridable |
| 512 | PAN-943 | M | low | ok |  |  | [item] Add memory file review and management command |
| 513 | PAN-944 | S | low | ok |  |  | [item] Make vBRIEF the durable task graph source of truth |
| 514 | PAN-961 | S | low | ok |  |  | [item] Update documentation for vBRIEF v0.6 lifecycle model |
| 515 | PAN-962 | S | low | ok |  |  | [item] Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 516 | PAN-984 | S | low | ok |  |  | [item] Evaluate context-mode MCP server as session continuity + search layer |
| 517 | PAN-1049 | S | low | ok |  |  | [item] Spike: evaluate Tauri v2 desktop shell |
| 518 | PAN-1051 | S | low | ok |  |  | [item] feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 519 | PAN-1063 | S | low | ok |  |  | [item] Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 520 | PAN-1064 | S | low | ok |  |  | [item] Harden launcher generation against shell-quote injection (model and arg quoting) |
| 521 | PAN-1065 | S | low | ok |  |  | [item] Validate issueId at every shell-string interpolation site (defense in depth) |
| 522 | PAN-2252 | S | high | ok |  |  | Dashboard port has no identity check — workspace peer server squatted :3011 for 6 minutes and passed all health checks |
| 522 | PAN-1116 | S | low | ok |  |  | [item] Memory: cross-project search mode |
| 523 | PAN-1117 | S | low | ok |  |  | [item] Memory: pinned docs (long-form doc chunking + retrieval) |
| 524 | PAN-1121 | S | low | ok |  |  | [item] Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 525 | PAN-1123 | M | low | ok |  |  | [item] Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 526 | PAN-1124 | S | low | ok |  |  | [item] Decouple specs and PRDs from workspaces — write directly to main |
| 527 | PAN-1133 | S | low | ok |  |  | [item] TLDR: deacon supervision + pan doctor check + GC |
| 528 | PAN-1135 | L | low | ok |  |  | [item] Document the hook system in docs/HOOKS.md |
| 529 | PAN-1136 | L | low | ok |  |  | [item] Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 530 | PAN-1152 | S | low | ok |  |  | [item] Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 531 | PAN-1153 | S | low | ok |  |  | [item] Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 532 | PAN-1166 | S | low | ok |  |  | [item] Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 533 | PAN-1208 | M | low | ok |  |  | [item] Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 534 | PAN-1222 | S | low | ok |  |  | [item] Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 535 | PAN-1242 | S | low | ok |  |  | [item] Create a new issue directly from a kanban column |
| 536 | PAN-1325 | L | low | ok |  |  | [item] Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 537 | PAN-1356 | S | low | ok |  |  | [item] Extend the memory Observation pipeline to ad-hoc conversations |
| 538 | PAN-1479 | M | low | ok |  |  | [item] RTK: Add telemetry to measure token savings from bash output compression |
| 539 | PAN-1481 | M | low | ok |  |  | [item] Add cost-event telemetry for Caveman token savings |
| 540 | PAN-1482 | S | low | ok |  |  | [item] Token spend report should aggregate data from repo, not just local machine |
| 541 | PAN-1483 | S | low | ok |  |  | [item] Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 542 | PAN-1533 | S | low | ok |  |  | [item] Fork-into-worktree from conversation branch chip |
| 543 | PAN-1550 | M | low | ok |  |  | [item] feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 544 | PAN-1552 | S | low | ok |  |  | [item] Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 545 | PAN-1553 | M | low | ok |  |  | [item] Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 546 | PAN-1581 | S | low | ok |  |  | [item] Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled  |
| 547 | PAN-1592 | S | low | ok |  |  | [item] Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 548 | PAN-1640 | S | low | ok |  |  | [item] Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 549 | PAN-1641 | S | low | ok |  |  | [item] Run agents on local GPU models via a managed Ollama sidecar |
| 550 | PAN-1643 | M | low | ok |  |  | [item] Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 551 | PAN-1646 | S | low | ok |  |  | [item] Rabbit-hole drift detection and lift-to-new-conversation |
| 552 | PAN-1667 | S | low | ok |  |  | [item] feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 553 | PAN-1691 | S | low | ok |  |  | [item] feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands re |
| 554 | PAN-1696 | S | low | ok |  |  | [item] Merge train becomes per-project — works without a Flywheel run, multi-project view |
| 555 | PAN-1735 | S | low | ok |  |  | [item] feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 556 | PAN-1748 | S | low | ok |  |  | [item] feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 557 | PAN-1750 | S | low | ok |  |  | [item] feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt |
| 558 | PAN-1751 | S | low | ok |  |  | [item] feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Fly |
| 559 | PAN-1754 | S | low | ok |  |  | [item] feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings p |
| 560 | PAN-1758 | S | low | ok |  |  | [item] Watch: ready-for-merge work must converge despite a continuously moving main |
| 561 | PAN-1773 | S | low | ok |  |  | [item] Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 562 | PAN-1775 | S | low | ok |  |  | [item] Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 563 | PAN-1878 | S | low | ok |  |  | [item] process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 564 | PAN-1895 | S | low | ok |  |  | [item] Spawn work agents from issue workspace slide-out |
| 565 | PAN-1906 | S | low | ok |  |  | [item] Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 566 | PAN-1910 | S | low | ok |  |  | [item] fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not  |
| 567 | PAN-1914 | S | low | ok |  |  | [item] Follow-up: move /api/health/agents off agent-directory scans |
| 568 | PAN-1926 | S | low | ok |  |  | [item] feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 569 | PAN-1936 | S | low | ok |  |  | [item] Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoint |
| 570 | PAN-1937 | S | low | ok |  |  | [item] feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-fa |
| 571 | PAN-1949 | S | low | ok |  |  | [item] Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 572 | PAN-1958 | S | low | ok |  |  | [item] Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 573 | PAN-1980 | S | low | ok |  |  | [item] Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 574 | PAN-1983 | M | low | ok |  |  | [item] Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 575 | PAN-1984 | XL | low | ok |  |  | [item] Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 576 | PAN-1986 | S | low | ok |  |  | [item] restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 577 | PAN-1988 | S | low | ok |  |  | [item] Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 578 | PAN-1990 | S | low | ok |  |  | [item] First-class workspaces and projects with per-workspace memory |
| 579 | PAN-1999 | S | low | ok |  |  | [item] Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 580 | PAN-2002 | M | low | ok |  |  | [item] [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 581 | PAN-2005 | S | low | ok |  |  | [item] Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 582 | PAN-2008 | M | low | ok |  |  | [item] feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 583 | PAN-2046 | S | low | ok |  |  | [item] Conversation view does not surface terminal command responses |
| 584 | PAN-2066 | S | low | ok |  |  | [item] OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page |
| 585 | PAN-2074 | M | low | ok |  |  | [item] research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 586 | PAN-2082 | S | low | ok |  |  | [item] Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 587 | PAN-2083 | S | low | ok |  |  | [item] Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 588 | PAN-2084 | S | low | ok |  |  | [item] Auto-create lightweight conversation worktrees on project chats |
| 589 | PAN-2085 | S | low | ok |  |  | [item] Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 590 | PAN-2091 | S | low | ok |  |  | [item] chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 591 | PAN-2195 | S | low | ok |  |  | [item] pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 592 | PAN-2210 | S | low | ok |  |  | [item] PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 593 | PAN-2211 | S | low | ok |  |  | [item] PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 594 | PAN-2212 | S | low | ok |  |  | [item] Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 595 | PAN-2308 | XL | low | ok |  |  | [item] hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for determinist |
| 596 | PAN-2343 | S | low | ok |  |  | [item] docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 597 | PAN-2344 | S | low | ok |  |  | [item] docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 598 | PAN-2345 | S | low | ok |  |  | [item] docs: refresh pan-done.md — update, harden, make useful |
| 599 | PAN-2346 | S | low | ok |  |  | [item] docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 600 | PAN-2347 | S | low | ok |  |  | [item] docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 601 | PAN-2348 | XL | low | ok |  |  | [item] docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 602 | PAN-2350 | XL | low | ok |  |  | [item] Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone |
| 603 | PAN-2351 | S | low | ok |  |  | [item] Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites) |
| 604 | PAN-2352 | S | low | ok |  |  | [item] Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 605 | PAN-2353 | S | low | ok |  |  | [item] Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 606 | PAN-2354 | S | low | ok |  |  | [item] Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 607 | PAN-2356 | S | low | ok |  |  | [item] Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 608 | PAN-2355 | S | low | ok |  |  | [item] Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 609 | PAN-2390 | L | low | ok |  |  | [item] systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set Man |
| 610 | PAN-2392 | S | low | ok |  |  | [item] feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup |
| 611 | PAN-2394 | S | low | ok |  |  | [item] Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 612 | PAN-2399 | S | low | ok |  |  | [item] feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 613 | PAN-2406 | S | low | ok |  |  | [item] close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown ab |
| 614 | PAN-2409 | S | low | ok |  |  | [item] feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 clas |
| 615 | PAN-2424 | XL | low | ok |  |  | [item] Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed,  |
| 616 | PAN-2442 | S | low | ok |  |  | [item] feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, tr |
| 617 | PAN-2443 | S | low | ok |  |  | [item] feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/to |
| 618 | PAN-2444 | XL | low | ok |  |  | [item] feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, |
| 619 | PAN-2487 | S | low | ok |  |  | [item] feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 620 | PAN-2491 | XL | low | ok |  |  | [item] Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp  |
| 621 | PAN-2493 | S | low | ok |  |  | [item] feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 622 | PAN-2504 | S | low | ok |  |  | [item] Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 623 | PAN-2505 | S | low | ok |  |  | [item] lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 624 | PAN-2507 | S | low | ok |  |  | [item] Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 625 | PAN-2514 | S | low | ok |  |  | [item] Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 626 | PAN-2526 | XL | low | ok |  |  | [item] Refactor deacon.ts below file-size baseline |
| 627 | PAN-2527 | S | low | ok |  |  | [item] Harness selector should restrict OpenAI models to Claude Code only |
| 628 | PAN-2549 | XL | low | ok |  |  | [item] Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 629 | PAN-2600 | S | low | ok |  |  | [item] Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 630 | PAN-2622 | S | low | ok |  |  | [item] cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing inst |
| 631 | PAN-2625 | S | low | ok |  |  | [item] feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty stat |
| 632 | PAN-2626 | S | low | ok |  |  | [item] feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 633 | PAN-2629 | S | low | ok |  |  | [item] pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent s |
| 634 | PAN-2628 | S | low | ok |  |  | [item] pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub- |
| 635 | PAN-2630 | S | low | ok |  |  | [item] pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 636 | PAN-2635 | S | low | ok |  |  | [item] chore(server): pay down the 152-error src/dashboard/server typecheck debt |
| 637 | PAN-2645 | M | low | ok |  |  | [item] Add opt-in Observation-first conversation view |
| 638 | PAN-2660 | M | low | ok |  |  | [item] Add safe Reset to planned action to the issue actions menu |
| 639 | PAN-2662 | M | low | ok |  |  | [item] Add project context-menu actions scoped to issues currently in the pipeline |
| 640 | PAN-2667 | M | low | ok |  |  | [item] Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 641 | PAN-2678 | S | low | ok |  |  | [item] Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outa |
| 642 | PAN-2679 | S | low | ok |  |  | [item] conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 643 | PAN-2767 | S | low | ok |  |  | [item] Expose Codex app-server conversation controls in the dashboard |
| 644 | PAN-2809 | S | low | ok |  |  | [item] Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik  |
| 645 | PAN-2817 | S | low | ok |  |  | [item] Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and s |
| 646 | PAN-2836 | XL | low | ok |  |  | [item] okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |

## Rationale detail

### PAN-2858 (rank 1)

Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.

### PAN-2857 (rank 2)

In-review fix for pipeline membership ignoring strike/ refs, which makes active strike work disappear from the rail; pinning as in-pipeline.

### PAN-2842 (rank 3)

In-review cockpit redesign that returns pane width to the conversation; pinned as in-pipeline.

### PAN-2840 (rank 4)

In-flight state-branch fix; pinning.

### PAN-2844 (rank 5)

In-review bug; pinning.

### PAN-2829 (rank 6)

In-progress rename pass; pinned.

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2838 (rank 7)

In-progress UI polish; pinned.

### PAN-2856 (rank 8)

In-flight telemetry; pinned.

### PAN-2855 (rank 9)

In-flight packaging fix; pinned.

### PAN-2853 (rank 10)

In-flight desktop blocker; pinned.

### PAN-2599 (rank 14)

Planned/in-progress analytics integration; pinned.

### PAN-2807 (rank 15)

Merged bug with needs-close-out label; pinned while close-out completes.

### PAN-2860 (rank 21)

Every pan start on mind-your-now (and any migrated project) silently dies at planning→work handoff because planning still writes legacy untracked .pan/ files that trip the dirty-workspace guard. This is the highest-impact open issue: it has stranded at least 4 issues (MIN-875/876/878/852) and is silently blocking all work on migrated projects. Two interacting root causes documented. Pure correctness restoration — no design needed.

### PAN-2731 (rank 22)

Codex work agents actively committing show costSoFar=0 and a frozen lastActivity in state.json. The flywheel doctrine tells agents to trust that signal, so a healthy productive agent came within one command of pan kill. Tagged blocks-main; undermine it and the flywheel kills productive work.

### PAN-2850 (rank 23)

Clean-checkout `npm test` deterministically fails at dashboard-cwd-guard.test.ts because pretest runs build:cli (which cleans dist/) without rebuilding dist/dashboard/server.js. Every fresh verification run hits this. Small surgical fix in build orchestration; restoring clean-checkout test is foundational to all other verification.

### PAN-2854 (rank 24)

Published package 0.45.21 hits a persistent asset/module load failure and the frontend recovery loop reloads the page every ~3s, making the dashboard unusable for any new user installing via npx. This is a public regression — every fresh install is broken until the recovery loop is quieted or the underlying asset failure fixed.

### PAN-2864 (rank 25)

A single misconfigured/inaccessible project (404 on lexerra) takes down the whole multi-project `pan review pending` command because pending.ts re-throws the first per-project error instead of isolating it like other commands do. Blocks review pipeline visibility for the operator; one-line-shape fix to match the existing isolation pattern.

### PAN-2846 (rank 26)

After a merge, postMergeLifecycle pauses the work agent and kills its tmux session, but the state record stays status=running. The DoD post-merge row reads that field, so close-out is blocked on an agent that is already dead until a deacon patrol corrects it. Wedges the close-out row of the DoD for every merge.

### PAN-2848 (rank 27)

A work agent gated on a work-phase inspection stalls permanently when the inspection session dies — no recovery re-dispatches it and no verdict is ever delivered. Observed stranding PAN-2377 ~100 minutes. Swarm-off suppresses recovery of a non-swarm agent. This is a pipeline deadlock class.

### PAN-2865 (rank 28)

Strike agents (e.g. strike-pan-2857) fail transcript resolution: the resolver falls back to the feature-<issue> convention path even though state.json and the DB both correctly record the -strike workspace. Breaks transcript-driven features (cost, context, lens) for every strike agent. The recorded state is correct; the fallback is at fault.

### PAN-2642 (rank 29)

Epic container. Aggregate impact is high: retires a feature whose only output was 480k+ log lines, lands the one real cost guard (child PAN-1868), and makes headline spend honest via provider billing-mode. Children: PAN-1868 (keystone), 2466 (integrity), 570, 1042, 2079 (alert surface), plus display/telemetry backlog.

### PAN-2569 (rank 30)

Same family as PAN-2860: planning marks an issue planned but the work auto-start never fires. Direct pipeline deadlock — planned work sits forever. The twin of the top-ranked migrated-project handoff bug.

### PAN-2650 (rank 31)

A swarm's last slot wedges in ready-to-merge when the memory-governor sheds the integration agent mid-cycle. Swarms fail to converge; high-impact given how much work now runs as swarms.

### PAN-2706 (rank 32)

Test dispatches land on sessions that were never kicked off, absorbing every dispatch and never producing a verdict. Test pipeline goes silent. High blast radius across all in-review work.

### PAN-2567 (rank 33)

A PR that is reviewed and CI-green stays stuck because the advancing-verdict reconciliation fails. Work that has cleared review never reaches merge; directly shrinks shipped throughput.

### PAN-2709 (rank 34)

Agents cannot notify the flywheel orchestrator as a target, so they fall back to auto-resume paths that bypass the orchestrator. Breaks the orchestration spine's feedback loop.

### PAN-2639 (rank 35)

codex-resume replays a refresh token that has been rotated out, so the entire codex review convoy fails on auth. Recurring; disables codex review until manual recovery.

### PAN-2379 (rank 36)

The verify-gate runs dependency install as warn-only with a 60s timeout, so a slow install produces a false verify failure. Verification noise that discredits the whole gate.

### PAN-2593 (rank 37)

Server-spawned children inherit a bare system PATH, so verification gates and other spawned commands resolve the wrong binaries. Corrupts verification results machine-wide.

### PAN-2511 (rank 38)

Work agents spend 20+ minutes chasing false test failures caused by the sandbox denying spawnSync git. Productivity leak on every work agent that runs tests.

### PAN-2516 (rank 39)

plan.status mutations are left uncommitted in the shared primary worktree, so the spec and the record disagree. Plan/record drift is exactly the class of corruption the state-model epic exists to kill.

### PAN-2521 (rank 40)

When a harness hits a rate limit, agents stall; this changes the launch path to surface a model-switch reminder. Stops autonomous stalls at launch time.

### PAN-2451 (rank 41)

Work agents get stranded behind the commit-msg gate after an overflow-restart and auto-commit. Recovery flow turns into a dead-end for the agent.

### PAN-2430 (rank 42)

Frontend typecheck emits dozens of pre-existing unused-local errors, drowning real failures in noise. Discredits the typecheck gate.

### PAN-2421 (rank 43)

Dashboard server route tests flake under full-suite load, producing intermittent verify failures. Same verification-credibility class as PAN-2430.

### PAN-2337 (rank 44)

An in-place `npm run build` under a live dashboard serves half-written files, breaking the running server. Build/reload must be atomic (build to staging, swap).

### PAN-2324 (rank 45)

Close-out's label transition fails atomically when in-planning is missing, leaving the issue half-closed. Another close-out wedge in the DoD close-out row.

### PAN-2323 (rank 46)

When the flywheel is displaced or crashes, its respawn starts a blank session instead of resuming state. Lose all run context on every crash; core to flywheel resilience.

### PAN-2331 (rank 47)

A rate-limit modal in codex stalls autonomous agents indefinitely. Disables unattended runs.

### PAN-2333 (rank 48)

Codex weekly-quota exhaustion is not handled gracefully; needs a resource alert and model downshift instead of silent failure.

### PAN-2377 (rank 49)

substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.

### PAN-2259 (rank 49)

Something is burning the full 5k/hr GitHub GraphQL quota, breaching limits repeatedly. Quota exhaustion takes down all GitHub-driven features until it resets. Root cause not yet isolated.

### PAN-2232 (rank 50)

specialists.ts is 1749 lines and part of the regrowing cloister subtree (service.ts just reddened main). Behavior-preserving decomposition into <1000-line modules with a re-export barrel, depth over line count, repointing tests in the same PR. Pipeline-machinery: supervised dispatch (TENET-10), needs-handoff.

### PAN-2193 (rank 50)

Held issues are invisible in the Command Deck, so the operator loses track of objected/parked/vetoed work. Visibility gap on the operator's primary surface.

### PAN-2186 (rank 51)

Post-merge lifecycle can leave a merged issue in-review and then auto-merge it again. Re-merge of already-merged work; pipeline-correctness.

### PAN-2179 (rank 52)

Relaunch leaves a zombie: tmux session alive but the kickoff never starts. Agents that look alive but do nothing.

### PAN-2170 (rank 53)

Docker init container has no Python, so the node-gyp rebuild of better-sqlite3 fails. Workspace containers cannot bootstrap.

### PAN-2169 (rank 54)

A kimi agent hits 100% context silently — no overflow error thrown, no recovery triggered. Silent stall that the deacon cannot detect.

### PAN-2165 (rank 55)

pan close reports success but leaves the issue OPEN with the wrong label. The DoD mechanical gate reports green while the tracker is red.

### PAN-2106 (rank 56)

pan strike workspace setup leaves a broken partial workspace but reports a false spawned success. Strike work starts on a broken foundation.

### PAN-1770 (rank 57)

The pan-dir auto-commit rebase races live writes to .pan/continues, producing read ECONNRESET. State-write race under the write door.

### PAN-1767 (rank 58)

Surfaces the count of merged-but-not-closed-out issues in pan status and the dashboard headline. The DoD lesson from 2026-07-15 (three merges fully closed while the dashboard ran a stale build).

### PAN-1766 (rank 59)

Work agents hang when Claude Code settings-file protection fires during an edit. Productivity stall on every settings edit.

### PAN-1618 (rank 60)

The work-spawn docker-health gate has no autonomous recovery path, so an unhealthy Docker wedges work spawns until manual intervention.

### PAN-1560 (rank 61)

After a PR head moves, re-review does not re-post the panopticon/review status, so the PR stays stuck. Review pipeline visibility gap.

### PAN-1209 (rank 62)

Bead projection disagrees with the canonical bd state — two reads of the same fact. The single-source-of-truth tenet says fix at the read door.

### PAN-1666 (rank 63)

Epic container. Aggregate impact is now medium: most children listed in the body (PAN-1665 throttle, PAN-1613 zombie stop, PAN-1645 docker init, PAN-1629 slot manager) have shipped or closed. The one open child is PAN-1556 (coalesce review-spawn spam / re-reviews). Ranked here on that remaining child's impact.

### PAN-1556 (rank 64)

Child of PAN-1666. Specialists spawn on demand and coalesce re-reviews, reducing stampede.

### PAN-1868 (rank 65)

Keystone of cost-epic PAN-2642. Burn-rate × zero-progress detection with graduated warn→auto-pause. Replaces the invented-limits policy the operator rejected with the one real guard.

### PAN-2466 (rank 66)

Bug in the close-out writer that clobbers closeOut.usage, losing per-issue cost history. Cost-epic child; ledger integrity — fix early.

### PAN-2075 (rank 67)

Epic container. Aggregate impact is high: replaces the silent all-or-nothing boot resume with an informed decision surface, and creates the Operator Inbox that every future durable alert (cost, quota) needs. Children: 2077, 2078, 2079, 2080, plus 454, 1775, 1963.

### PAN-2077 (rank 68)

Child of boot-reconciliation epic PAN-2075. Inventory of all agents across local + remote that exist in state but are not verified-running. The data layer the rest of the epic builds on.

### PAN-2078 (rank 69)

Child of PAN-2075. CLI surface for boot reconciliation so headless/offline operators can drive the same decisions.

### PAN-2079 (rank 70)

Child of PAN-2075 AND prerequisite for cost-epic PAN-2642 alerts (which need a real surface, not log spam). High-leverage: every future durable operator alert lands here.

### PAN-2080 (rank 71)

Child of PAN-2075. External transports so the inbox reaches an offline operator. Needs design once PAN-2079 spine exists.

### PAN-2720 (rank 72)

The file-size ratchet counts lines, so it rewards line-packing and is gamed by the very god files it is meant to shrink. Must land before the decomposition refactor issues (2189/2190/2233) so they are measured correctly.

### PAN-2189 (rank 73)

deacon.ts is the pipeline supervisor at 3,394 lines — the largest god file in the codebase and the root of the pipeline thrash incidents. Decomposing it is substrate-improvement with the highest leverage, but needs design to preserve behavior. dependsOn PAN-2720.

### PAN-2190 (rank 74)

New god file produced by the workspaces-merge work. Better to decompose before more callers accrete. dependsOn PAN-2720.

### PAN-2233 (rank 75)

Sibling of the in-pipeline specialists.ts decomposition. Same pattern; lands cleanly once 2720 fixes the ratchet. dependsOn PAN-2720.

### PAN-2255 (rank 76)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-1650 (rank 76)

Splits the overloaded readyForMerge flag into a derived gatesPassed and a shipComplete, so stalls can be auto-diagnosed. Architecture; central to pipeline-correctness and the source of many merge-state bugs.

### PAN-807 (rank 77)

Critical/architecture. Spawn flow hard-resets the local branch and commits planning artifacts, losing unpushed work visibility. Loaded gun for any agent that has not pushed. Depends on Epic D first.

### PAN-1313 (rank 78)

Architecture. The Effect migration is partially done; finishing it removes the dual-world fragility in src/lib.

### PAN-262 (rank 79)

Architecture. Post-merge lifecycle is a source of repeated bugs (2186, 2846, 2324, 2165); composing it from idempotent operations is the structural fix.

### PAN-1454 (rank 80)

Architecture + substrate. Meta-issue cataloguing 9 systemic patterns; coordinates a wave of substrate work.

### PAN-2059 (rank 81)

Epic container. Adds an explicit pickup gate and an AI-objection state between "planned" and "picked up." Single confirmed child PAN-806 (in pipeline). Medium aggregate impact; mostly operator-flow polish.

### PAN-2334 (rank 82)

Process substrate: codifies what "ready" means. Unblocks the backlog pickup gate epic and the pickup.ts model that already references it. Needs author input on the bar.

### PAN-1253 (rank 83)

Architecture + flywheel-change. The flywheel does not respect issue dependencies before autopicking, so it can start blocked work. Direct flywheel correctness.

### PAN-1196 (rank 84)

Architecture. Routes work to the right workhorse by bead difficulty and subject-matter. Material throughput lever once designed.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-18T01:50:10Z",
  "model": "zai/glm-5.2",
  "pass": "incremental",
  "openCount": 646,
  "nodes": [
    {
      "issue": "PAN-2858",
      "rank": 1,
      "size": "XL",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "ACP harness port (Kimi Code CLI first agent) — new harness substrate, in flight",
      "rationale": "Active in-progress work — the ACP harness is the next substrate addition and is being built now; pinned at the top as in-pipeline work.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2857",
      "rank": 2,
      "size": "S",
      "importance": "critical",
      "score": 95.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike branches invisible to pipeline membership — hides active strike work",
      "rationale": "In-review fix for pipeline membership ignoring strike/ refs, which makes active strike work disappear from the rail; pinning as in-pipeline.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2842",
      "rank": 3,
      "size": "L",
      "importance": "high",
      "score": 95.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue cockpit full-width conversations — UX refactor in review",
      "rationale": "In-review cockpit redesign that returns pane width to the conversation; pinned as in-pipeline.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2840",
      "rank": 4,
      "size": "M",
      "importance": "high",
      "score": 95.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task mutation stays terminal after state push race — correctness fix",
      "rationale": "In-flight state-branch fix; pinning.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2844",
      "rank": 5,
      "size": "S",
      "importance": "high",
      "score": 94.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff panel empty for cross-repo edits (e.g. overdeck-state drafts)",
      "rationale": "In-review bug; pinning.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2829",
      "rank": 6,
      "size": "M",
      "importance": "high",
      "score": 94.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish vBRIEF → xBRIEF rename across code/docs/skills/UI",
      "rationale": "In-progress rename pass; pinned.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2838",
      "rank": 7,
      "size": "S",
      "importance": "medium",
      "score": 94.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project settings disclosure badge for projects with no settings",
      "rationale": "In-progress UI polish; pinned.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2856",
      "rank": 8,
      "size": "S",
      "importance": "medium",
      "score": 93.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "PostHog telemetry for recovery-reload trigger + failing asset URL",
      "rationale": "In-flight telemetry; pinned.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2855",
      "rank": 9,
      "size": "XS",
      "importance": "medium",
      "score": 93.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "jq prerequisite installer apt-only — fails on Arch/non-Debian",
      "rationale": "In-flight packaging fix; pinned.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2853",
      "rank": 10,
      "size": "S",
      "importance": "high",
      "score": 93.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop AppImage: every dashboard-spawned CLI invocation fails",
      "rationale": "In-flight desktop blocker; pinned.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2377",
      "rank": 49,
      "size": "XL",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "first-class 'special orders' runs — operator-supplied order book executed with lane semantics",
      "rationale": "substrate: first-class 'special orders' runs — operator-supplied order book executed with lane semantics.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "M",
      "importance": "critical",
      "score": 92.7,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": false
    },
    {
      "issue": "PAN-1896",
      "rank": 273,
      "size": "S",
      "importance": "high",
      "score": 92.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce approval friction for GitHub CLI operations in managed sessions",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2599",
      "rank": 14,
      "size": "L",
      "importance": "high",
      "score": 92.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate PostHog product analytics + telemetry",
      "rationale": "Planned/in-progress analytics integration; pinned.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2807",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 91.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "SQLite schema migrations silently fail — live DB at user_version=0 (needs-close-out)",
      "rationale": "Merged bug with needs-close-out label; pinned while close-out completes.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2232",
      "rank": 50,
      "size": "L",
      "importance": "high",
      "score": 91.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose specialists.ts (1749 lines) into focused modules",
      "rationale": "specialists.ts is 1749 lines and part of the regrowing cloister subtree (service.ts just reddened main). Behavior-preserving decomposition into <1000-line modules with a re-export barrel, depth over line count, repointing tests in the same PR. Pipeline-machinery: supervised dispatch (TENET-10), needs-handoff.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": false
    },
    {
      "issue": "PAN-1966",
      "rank": 258,
      "size": "M",
      "importance": "critical",
      "score": 91.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single authoritative pipeline-membership resolver — one function for \"what's in the pipeline\" (collapse the 5 divergent views)",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2252",
      "rank": 522,
      "size": "S",
      "importance": "high",
      "score": 90.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard port has no identity check — workspace peer server squatted :3011 for 6 minutes and passed all health checks",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2255",
      "rank": 76,
      "size": "M",
      "importance": "medium",
      "score": 90.6,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": false
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "XL",
      "importance": "critical",
      "score": 90.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": false
    },
    {
      "issue": "PAN-2860",
      "rank": 21,
      "size": "L",
      "importance": "critical",
      "score": 89.8,
      "condition": "ok",
      "dependsOn": [
        "PAN-2558"
      ],
      "why": "Planning→work auto-handoff dies on migrated projects — strands ALL migrated-project work",
      "rationale": "Every pan start on mind-your-now (and any migrated project) silently dies at planning→work handoff because planning still writes legacy untracked .pan/ files that trip the dirty-workspace guard. This is the highest-impact open issue: it has stranded at least 4 issues (MIN-875/876/878/852) and is silently blocking all work on migrated projects. Two interacting root causes documented. Pure correctness restoration — no design needed.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2731",
      "rank": 22,
      "size": "M",
      "importance": "critical",
      "score": 89.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json ghost signal (costSoFar=0, frozen lastActivity) routes pan kill to healthy codex agents (blocks-main)",
      "rationale": "Codex work agents actively committing show costSoFar=0 and a frozen lastActivity in state.json. The flywheel doctrine tells agents to trust that signal, so a healthy productive agent came within one command of pan kill. Tagged blocks-main; undermine it and the flywheel kills productive work.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2850",
      "rank": 23,
      "size": "S",
      "importance": "critical",
      "score": 89.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout — pretest removes dashboard bundle, verification breaks",
      "rationale": "Clean-checkout `npm test` deterministically fails at dashboard-cwd-guard.test.ts because pretest runs build:cli (which cleans dist/) without rebuilding dist/dashboard/server.js. Every fresh verification run hits this. Small surgical fix in build orchestration; restoring clean-checkout test is foundational to all other verification.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2854",
      "rank": 24,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "npx @overdeck/core reloads every ~3s — public published-package regression",
      "rationale": "Published package 0.45.21 hits a persistent asset/module load failure and the frontend recovery loop reloads the page every ~3s, making the dashboard unusable for any new user installing via npx. This is a public regression — every fresh install is broken until the recovery loop is quieted or the underlying asset failure fixed.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2864",
      "rank": 25,
      "size": "S",
      "importance": "critical",
      "score": 88.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending crashes entirely when one project lens gather fails",
      "rationale": "A single misconfigured/inaccessible project (404 on lexerra) takes down the whole multi-project `pan review pending` command because pending.ts re-throws the first per-project error instead of isolating it like other commands do. Blocks review pipeline visibility for the operator; one-line-shape fix to match the existing isolation pattern.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2846",
      "rank": 26,
      "size": "S",
      "importance": "critical",
      "score": 88.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on dead agent: postMergeLifecycle leaves status=running on a dead session",
      "rationale": "After a merge, postMergeLifecycle pauses the work agent and kills its tmux session, but the state record stays status=running. The DoD post-merge row reads that field, so close-out is blocked on an agent that is already dead until a deacon patrol corrects it. Wedges the close-out row of the DoD for every merge.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2848",
      "rank": 27,
      "size": "M",
      "importance": "critical",
      "score": 88.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on dead inspection: no re-dispatch, verdict never delivered",
      "rationale": "A work agent gated on a work-phase inspection stalls permanently when the inspection session dies — no recovery re-dispatches it and no verdict is ever delivered. Observed stranding PAN-2377 ~100 minutes. Swarm-off suppresses recovery of a non-swarm agent. This is a pipeline deadlock class.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2865",
      "rank": 28,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "JSONL transcript resolution ignores recorded workspace for strike agents — jsonl-missing",
      "rationale": "Strike agents (e.g. strike-pan-2857) fail transcript resolution: the resolver falls back to the feature-<issue> convention path even though state.json and the DB both correctly record the -strike workspace. Breaks transcript-driven features (cost, context, lens) for every strike agent. The recorded state is correct; the fallback is at fault.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2642",
      "rank": 29,
      "size": "L",
      "importance": "high",
      "score": 87.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Cost strategy — retire invented limits, land progress-aware breaker, honest dollars",
      "rationale": "Epic container. Aggregate impact is high: retires a feature whose only output was 480k+ log lines, lands the one real cost guard (child PAN-1868), and makes headline spend honest via provider billing-mode. Children: PAN-1868 (keystone), 2466 (integrity), 570, 1042, 2079 (alert surface), plus display/telemetry backlog.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2569",
      "rank": 30,
      "size": "M",
      "importance": "critical",
      "score": 87.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning finalizes (issue→planned) but work agent never auto-starts",
      "rationale": "Same family as PAN-2860: planning marks an issue planned but the work auto-start never fires. Direct pipeline deadlock — planned work sits forever. The twin of the top-ranked migrated-project handoff bug.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2650",
      "rank": 31,
      "size": "M",
      "importance": "critical",
      "score": 87.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when memory-governor sheds integration agent",
      "rationale": "A swarm's last slot wedges in ready-to-merge when the memory-governor sheds the integration agent mid-cycle. Swarms fail to converge; high-impact given how much work now runs as swarms.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2706",
      "rank": 32,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch — never-kicked-off sessions drain the queue",
      "rationale": "Test dispatches land on sessions that were never kicked off, absorbing every dispatch and never producing a verdict. Test pipeline goes silent. High blast radius across all in-review work.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2567",
      "rank": 33,
      "size": "S",
      "importance": "critical",
      "score": 86.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewed+green PR stuck after review — advancing verdict reconciliation fails",
      "rationale": "A PR that is reviewed and CI-green stays stuck because the advancing-verdict reconciliation fails. Work that has cleared review never reaches merge; directly shrinks shipped throughput.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2709",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 86.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator unreachable as a notification target — agents auto-resume instead of route",
      "rationale": "Agents cannot notify the flywheel orchestrator as a target, so they fall back to auto-resume paths that bypass the orchestrator. Breaks the orchestration spine's feedback loop.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2639",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 86.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoy fails",
      "rationale": "codex-resume replays a refresh token that has been rotated out, so the entire codex review convoy fails on auth. Recurring; disables codex review until manual recovery.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2379",
      "rank": 36,
      "size": "S",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "verify-gate dependency install is warn-only + 60s timeout → false verify failures",
      "rationale": "The verify-gate runs dependency install as warn-only with a 60s timeout, so a slow install produces a false verify failure. Verification noise that discredits the whole gate.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2593",
      "rank": 37,
      "size": "S",
      "importance": "high",
      "score": 85.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server children inherit bare system PATH — verification gates run wrong binaries",
      "rationale": "Server-spawned children inherit a bare system PATH, so verification gates and other spawned commands resolve the wrong binaries. Corrupts verification results machine-wide.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2511",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 85.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git",
      "rationale": "Work agents spend 20+ minutes chasing false test failures caused by the sandbox denying spawnSync git. Productivity leak on every work agent that runs tests.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2516",
      "rank": 39,
      "size": "S",
      "importance": "high",
      "score": 85.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift",
      "rationale": "plan.status mutations are left uncommitted in the shared primary worktree, so the spec and the record disagree. Plan/record drift is exactly the class of corruption the state-model epic exists to kill.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2521",
      "rank": 40,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Launch pipeline agents with harness rate-limit model-switch reminder instead of stalling",
      "rationale": "When a harness hits a rate limit, agents stall; this changes the launch path to surface a model-switch reminder. Stops autonomous stalls at launch time.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2451",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 84.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit",
      "rationale": "Work agents get stranded behind the commit-msg gate after an overflow-restart and auto-commit. Recovery flow turns into a dead-end for the agent.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2430",
      "rank": 42,
      "size": "M",
      "importance": "high",
      "score": 84.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Frontend typecheck fails with dozens of pre-existing unused-local errors — verification noisy",
      "rationale": "Frontend typecheck emits dozens of pre-existing unused-local errors, drowning real failures in noise. Discredits the typecheck gate.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2421",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 84.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server route tests flake under full-suite verification load",
      "rationale": "Dashboard server route tests flake under full-suite load, producing intermittent verify failures. Same verification-credibility class as PAN-2430.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2337",
      "rank": 44,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: in-place npm run build under live dashboard breaks the server",
      "rationale": "An in-place `npm run build` under a live dashboard serves half-written files, breaking the running server. Build/reload must be atomic (build to staging, swap).",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2324",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 83.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label transition fails atomically on missing in-planning label",
      "rationale": "Close-out's label transition fails atomically when in-planning is missing, leaving the issue half-closed. Another close-out wedge in the DoD close-out row.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2323",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 83.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming",
      "rationale": "When the flywheel is displaced or crashes, its respawn starts a blank session instead of resuming state. Lose all run context on every crash; core to flywheel resilience.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2331",
      "rank": 47,
      "size": "M",
      "importance": "high",
      "score": 83.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex rate-limit \"Switch to gpt-5.4-mini?\" modal stalls autonomous agents",
      "rationale": "A rate-limit modal in codex stalls autonomous agents indefinitely. Disables unattended runs.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2333",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle codex weekly-quota exhaustion gracefully — resource alert + downshift",
      "rationale": "Codex weekly-quota exhaustion is not handled gracefully; needs a resource alert and model downshift instead of silent failure.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2259",
      "rank": 49,
      "size": "M",
      "importance": "high",
      "score": 82.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "GraphQL quota burn — something exhausts the 5k/hr GitHub GraphQL budget repeatedly",
      "rationale": "Something is burning the full 5k/hr GitHub GraphQL quota, breaching limits repeatedly. Quota exhaustion takes down all GitHub-driven features until it resets. Root cause not yet isolated.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2193",
      "rank": 50,
      "size": "S",
      "importance": "high",
      "score": 82.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) invisible in the Command Deck",
      "rationale": "Held issues are invisible in the Command Deck, so the operator loses track of objected/parked/vetoed work. Visibility gap on the operator's primary surface.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2186",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 82.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-merge lifecycle can leave merged issues in-review and auto-merge them again",
      "rationale": "Post-merge lifecycle can leave a merged issue in-review and then auto-merge it again. Re-merge of already-merged work; pipeline-correctness.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2179",
      "rank": 52,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Relaunch can leave a zombie agent — session alive but kickoff never starts",
      "rationale": "Relaunch leaves a zombie: tmux session alive but the kickoff never starts. Agents that look alive but do nothing.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2170",
      "rank": 53,
      "size": "S",
      "importance": "high",
      "score": 81.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails",
      "rationale": "Docker init container has no Python, so the node-gyp rebuild of better-sqlite3 fails. Workspace containers cannot bootstrap.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2169",
      "rank": 54,
      "size": "M",
      "importance": "high",
      "score": 81.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "kimi agent silently frozen at 100% ctx — no thrown overflow error, no recovery",
      "rationale": "A kimi agent hits 100% context silently — no overflow error thrown, no recovery triggered. Silent stall that the deacon cannot detect.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2165",
      "rank": 55,
      "size": "S",
      "importance": "high",
      "score": 81.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong label",
      "rationale": "pan close reports success but leaves the issue OPEN with the wrong label. The DoD mechanical gate reports green while the tracker is red.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2106",
      "rank": 56,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false spawned success",
      "rationale": "pan strike workspace setup leaves a broken partial workspace but reports a false spawned success. Strike work starts on a broken foundation.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1770",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 80.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes — read ECONNRESET",
      "rationale": "The pan-dir auto-commit rebase races live writes to .pan/continues, producing read ECONNRESET. State-write race under the write door.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1767",
      "rank": 58,
      "size": "S",
      "importance": "high",
      "score": 80.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status + dashboard headline",
      "rationale": "Surfaces the count of merged-but-not-closed-out issues in pan status and the dashboard headline. The DoD lesson from 2026-07-15 (three merges fully closed while the dashboard ran a stale build).",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1766",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 80.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents hang on Claude Code settings-file protection when editing settings",
      "rationale": "Work agents hang when Claude Code settings-file protection fires during an edit. Productivity stall on every settings edit.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1618",
      "rank": 60,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn docker-health gate has no autonomous recovery",
      "rationale": "The work-spawn docker-health gate has no autonomous recovery path, so an unhealthy Docker wedges work spawns until manual intervention.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1560",
      "rank": 61,
      "size": "M",
      "importance": "high",
      "score": 79.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post review status → PR stuck",
      "rationale": "After a PR head moves, re-review does not re-post the panopticon/review status, so the PR stays stuck. Review pipeline visibility gap.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1209",
      "rank": 62,
      "size": "S",
      "importance": "high",
      "score": 79.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "rationale": "Bead projection disagrees with the canonical bd state — two reads of the same fact. The single-source-of-truth tenet says fix at the read door.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1666",
      "rank": 63,
      "size": "L",
      "importance": "medium",
      "score": 79.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Pipeline Throughput Hardening — most children already shipped; remaining: PAN-1556",
      "rationale": "Epic container. Aggregate impact is now medium: most children listed in the body (PAN-1665 throttle, PAN-1613 zombie stop, PAN-1645 docker init, PAN-1629 slot manager) have shipped or closed. The one open child is PAN-1556 (coalesce review-spawn spam / re-reviews). Ranked here on that remaining child's impact.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1556",
      "rank": 64,
      "size": "M",
      "importance": "medium",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "On-demand specialists: coalesce re-reviews, spawn review/test/ship only with queued work",
      "rationale": "Child of PAN-1666. Specialists spawn on demand and coalesce re-reviews, reducing stampede.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1868",
      "rank": 65,
      "size": "L",
      "importance": "critical",
      "score": 78.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Progress-aware cost-bleed circuit breaker — the one real cost guard (cost-epic keystone)",
      "rationale": "Keystone of cost-epic PAN-2642. Burn-rate × zero-progress detection with graduated warn→auto-pause. Replaces the invented-limits policy the operator rejected with the one real guard.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2466",
      "rank": 66,
      "size": "S",
      "importance": "high",
      "score": 78.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "closeOut.usage clobbering — per-issue cost history lost (ledger integrity bug)",
      "rationale": "Bug in the close-out writer that clobbers closeOut.usage, losing per-issue cost history. Cost-epic child; ledger integrity — fix early.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2075",
      "rank": 67,
      "size": "L",
      "importance": "high",
      "score": 78.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Boot Reconciliation + Operator Inbox — informed, substrate-complete, reachable online/CLI/offline",
      "rationale": "Epic container. Aggregate impact is high: replaces the silent all-or-nothing boot resume with an informed decision surface, and creates the Operator Inbox that every future durable alert (cost, quota) needs. Children: 2077, 2078, 2079, 2080, plus 454, 1775, 1963.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2077",
      "rank": 68,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines)",
      "rationale": "Child of boot-reconciliation epic PAN-2075. Inventory of all agents across local + remote that exist in state but are not verified-running. The data layer the rest of the epic builds on.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2078",
      "rank": 69,
      "size": "M",
      "importance": "high",
      "score": 77.8,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select",
      "rationale": "Child of PAN-2075. CLI surface for boot reconciliation so headless/offline operators can drive the same decisions.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2079",
      "rank": 70,
      "size": "L",
      "importance": "critical",
      "score": 77.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface",
      "rationale": "Child of PAN-2075 AND prerequisite for cost-epic PAN-2642 alerts (which need a real surface, not log spam). High-leverage: every future durable operator alert lands here.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2080",
      "rank": 71,
      "size": "M",
      "importance": "medium",
      "score": 77.2,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach",
      "rationale": "Child of PAN-2075. External transports so the inbox reaches an offline operator. Needs design once PAN-2079 spine exists.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2720",
      "rank": 72,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines — rewards line-packing on the god files it measures",
      "rationale": "The file-size ratchet counts lines, so it rewards line-packing and is gamed by the very god files it is meant to shrink. Must land before the decomposition refactor issues (2189/2190/2233) so they are measured correctly.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2189",
      "rank": 73,
      "size": "XL",
      "importance": "high",
      "score": 76.8,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2720"
      ],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervisor",
      "rationale": "deacon.ts is the pipeline supervisor at 3,394 lines — the largest god file in the codebase and the root of the pipeline thrash incidents. Decomposing it is substrate-improvement with the highest leverage, but needs design to preserve behavior. dependsOn PAN-2720.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2190",
      "rank": 74,
      "size": "XL",
      "importance": "high",
      "score": 76.5,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2720"
      ],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces merge",
      "rationale": "New god file produced by the workspaces-merge work. Better to decompose before more callers accrete. dependsOn PAN-2720.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2233",
      "rank": 75,
      "size": "L",
      "importance": "high",
      "score": 76.2,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2720"
      ],
      "why": "Decompose merge-agent.ts (1,414 lines) into focused modules",
      "rationale": "Sibling of the in-pipeline specialists.ts decomposition. Same pattern; lands cleanly once 2720 fixes the ratchet. dependsOn PAN-2720.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1650",
      "rank": 76,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived) + shipComplete; auto-diagnose stalls",
      "rationale": "Splits the overloaded readyForMerge flag into a derived gatesPassed and a shipComplete, so stalls can be auto-diagnosed. Architecture; central to pipeline-correctness and the source of many merge-state bugs.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-807",
      "rank": 77,
      "size": "L",
      "importance": "high",
      "score": 75.8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn — stop destroying local state",
      "rationale": "Critical/architecture. Spawn flow hard-resets the local branch and commits planning artifacts, losing unpushed work visibility. Loaded gun for any agent that has not pushed. Depends on Epic D first.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1313",
      "rank": 78,
      "size": "L",
      "importance": "high",
      "score": 75.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration — remove or justify legacy Promise/sync surfaces",
      "rationale": "Architecture. The Effect migration is partially done; finishing it removes the dual-world fragility in src/lib.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-262",
      "rank": 79,
      "size": "L",
      "importance": "high",
      "score": 75.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "rationale": "Architecture. Post-merge lifecycle is a source of repeated bugs (2186, 2846, 2324, 2165); composing it from idempotent operations is the structural fix.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1454",
      "rank": 80,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns from 80-issue audit — substrate work to fix them",
      "rationale": "Architecture + substrate. Meta-issue cataloguing 9 systemic patterns; coordinates a wave of substrate work.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-2059",
      "rank": 81,
      "size": "L",
      "importance": "medium",
      "score": 74.8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection 5th state",
      "rationale": "Epic container. Adds an explicit pickup gate and an AI-objection state between \"planned\" and \"picked up.\" Single confirmed child PAN-806 (in pipeline). Medium aggregate impact; mostly operator-flow polish.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2334",
      "rank": 82,
      "size": "M",
      "importance": "high",
      "score": 74.5,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Write a Definition of Ready (DoR) — the bar an issue must clear before planning",
      "rationale": "Process substrate: codifies what \"ready\" means. Unblocks the backlog pickup gate epic and the pickup.ts model that already references it. Needs author input on the bar.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1253",
      "rank": 83,
      "size": "M",
      "importance": "high",
      "score": 74.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "rationale": "Architecture + flywheel-change. The flywheel does not respect issue dependencies before autopicking, so it can start blocked work. Direct flywheel correctness.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1196",
      "rank": 84,
      "size": "L",
      "importance": "medium",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "rationale": "Architecture. Routes work to the right workhorse by bead difficulty and subject-matter. Material throughput lever once designed.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1424",
      "rank": 85,
      "size": "L",
      "importance": "medium",
      "score": 73.8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "rationale": "Architecture. Model pool dispatch and a work.* subtype taxonomy. Follow-up to PAN-1122; needs design.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1246",
      "rank": 86,
      "size": "L",
      "importance": "medium",
      "score": 73.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads",
      "rationale": "Architecture. Projection-cached VCS driver; perf substrate that every diff/checkpoint read benefits from.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1142",
      "rank": 87,
      "size": "S",
      "importance": "medium",
      "score": 73.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "rationale": "Architecture. Per-role/conversation reasoning-effort config. Aligns with the \"high default, never xhigh/max\" rule; small surface.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1198",
      "rank": 88,
      "size": "M",
      "importance": "medium",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules",
      "rationale": "Architecture/bug. The init container's bun install does not populate container-node-modules, so workspaces start half-built.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2830",
      "rank": 89,
      "size": "L",
      "importance": "medium",
      "score": 72.8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in — OFF by default",
      "rationale": "Architecture. The shared state branch should be opt-in (off by default, local-on) for projects that do not want a remote state plane. Needs design.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2837",
      "rank": 90,
      "size": "L",
      "importance": "medium",
      "score": 72.5,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents",
      "rationale": "Architecture. Records per-machine agent presence on the state branch. Substrate for multi-machine orchestration. Needs design.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1538",
      "rank": 91,
      "size": "M",
      "importance": "medium",
      "score": 72.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "rationale": "Architecture. Removes the API guard blocking Pi source forks and verifies the transcript parsers. Restores a harness.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1558",
      "rank": 92,
      "size": "L",
      "importance": "medium",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container",
      "rationale": "Architecture. Specialists currently inherit the host; running them in the workspace container is reproducibility substrate.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1561",
      "rank": 93,
      "size": "L",
      "importance": "medium",
      "score": 71.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-scoped dashboard nav: deck of tabs per project + conversations/tree tabs",
      "rationale": "Architecture. Project-scoped dashboard nav. Significant UX work for multi-project operators.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2027",
      "rank": 94,
      "size": "M",
      "importance": "medium",
      "score": 71.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy",
      "rationale": "Architecture. Routes kimi-k2 through ohmypi instead of CLIProxy, eliminating the 200k-window illusion class of deadlock.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1578",
      "rank": 95,
      "size": "XL",
      "importance": "medium",
      "score": 71.2,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer)",
      "rationale": "Architecture. Adds Copilot CLI as a pipeline peer harness. Large; needs design.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1219",
      "rank": 96,
      "size": "M",
      "importance": "medium",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings)",
      "rationale": "Substrate. Across-cycle review findings are lost between cycles; promoting them to first-class data stops re-reviewing the same things.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1217",
      "rank": 97,
      "size": "M",
      "importance": "medium",
      "score": 70.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC in_pr_scope vs whole_feature_scope",
      "rationale": "Substrate. Tightens the requirements-reviewer signal so scope drift is caught at planning.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1504",
      "rank": 98,
      "size": "M",
      "importance": "medium",
      "score": 70.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan hygiene: codify orchestration merge/commit/push state audit as a CLI",
      "rationale": "Substrate. Promotes the hygiene audit (is orchestration work committed/pushed/mergeable) to a first-class CLI.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-2558",
      "rank": 99,
      "size": "L",
      "importance": "medium",
      "score": 70.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "state-migration: support polyrepo projects — resolve state-host repo via projectRoot",
      "rationale": "Substrate. State-migration currently assumes one state host; polyrepo support is what lets the migrated-state plane (PAN-2860 lives here) work for every project.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1311",
      "rank": 100,
      "size": "M",
      "importance": "medium",
      "score": 70,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "rationale": "Architecture + flywheel-change. Skips slot dispatch for trivial mechanical items, freeing swarm slots for real work.",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1357",
      "rank": 101,
      "size": "M",
      "importance": "low",
      "score": 69.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "rationale": "Architecture. Template conversations that load curated skill bundles. Useful but not a pipeline blocker.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1913",
      "rank": 102,
      "size": "M",
      "importance": "low",
      "score": 69.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer",
      "rationale": "Architecture. Project description CRUD + mirror into the project context layer.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1254",
      "rank": 103,
      "size": "L",
      "importance": "low",
      "score": 69.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet",
      "rationale": "Architecture. Tailscale integration for remote access. Valuable for remote operators but not on the critical path.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1497",
      "rank": 104,
      "size": "M",
      "importance": "low",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel TTS announcements on lifecycle events",
      "rationale": "Substrate. TTS announcements for flywheel lifecycle events. Operator convenience.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1889",
      "rank": 105,
      "size": "S",
      "importance": "low",
      "score": 68.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel retention/compaction policy for docs/FLYWHEEL-STATE.md",
      "rationale": "Substrate. The FLYWHEEL-STATE.md grows unbounded; needs a retention/compaction policy.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1544",
      "rank": 106,
      "size": "S",
      "importance": "low",
      "score": 68.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "rationale": "Architecture. Small type cleanup; the ship role is no longer used but the union still carries it.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-630",
      "rank": 107,
      "size": "XL",
      "importance": "low",
      "score": 68.2,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "rationale": "Architecture. Multi-tenant workspace isolation. Large, long-horizon; not on the current critical path.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-955",
      "rank": 108,
      "size": "M",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "rationale": "Devcontainer template has no versioning or re-render, so workspaces drift from the canonical template. Reproducibility substrate.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-813",
      "rank": 109,
      "size": "S",
      "importance": "medium",
      "score": 67.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "rationale": "Regression test coverage for the review reset path that must preserve work-agent resolution. Defense for a known-fragile path.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2358",
      "rank": 110,
      "size": "S",
      "importance": "medium",
      "score": 67.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness",
      "rationale": "Follow-up restoring hardening that was lost in PAN-2145. Small substrate repair.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2188",
      "rank": 111,
      "size": "M",
      "importance": "medium",
      "score": 67.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood — substrate-first prioritization",
      "rationale": "Flywheel resilience to the codebase-health flood: substrate-first prioritization so the flywheel does not drown in routine items.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1218",
      "rank": 112,
      "size": "S",
      "importance": "medium",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-state check",
      "rationale": "Tightens bead inspect to high-signal checks. Substrate improvement to the inspect gate.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1451",
      "rank": 113,
      "size": "M",
      "importance": "medium",
      "score": 66.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "rationale": "Follow-up to complete the planning-on-main pivot whose ACs were dropped to scope drift. Restores intended planning behavior.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1452",
      "rank": 114,
      "size": "M",
      "importance": "medium",
      "score": 66.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch)",
      "rationale": "Per-reviewer restart with model override for architectural mismatches. Follow-up to a substrate review fix.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2859",
      "rank": 115,
      "size": "S",
      "importance": "medium",
      "score": 66.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Kimi K3 (k3 / k3[1m]) to the claude-code Kimi provider — parity with kimi-k2.7",
      "rationale": "K3 shipped 2026-07-16 (2.8T MoE, 1M context), in high demand. Mechanical provider-add parity with the existing kimi-k2.7-code wiring; small, high-demand.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2868",
      "rank": 116,
      "size": "S",
      "importance": "low",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900 — persist window state, default first run maximized",
      "rationale": "Desktop polish: persist window bounds and isMaximized; default first run to maximized. Small UX win.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-49",
      "rank": 117,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "stale",
      "dependsOn": [],
      "why": "[bug] Fix CloisterService tests that require real runtime",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-113",
      "rank": 118,
      "size": "M",
      "importance": "medium",
      "score": 59.9,
      "condition": "stale",
      "dependsOn": [],
      "why": "[bug] Dashboard 'Start Agent' returns success before verifying agent actually started",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-244",
      "rank": 119,
      "size": "M",
      "importance": "medium",
      "score": 59.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Deep-wipe leaves local branch and worktree metadata behind",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-245",
      "rank": 120,
      "size": "M",
      "importance": "medium",
      "score": 59.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Ctrl+C aborts planning dialog instead of copying text",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-247",
      "rank": 121,
      "size": "M",
      "importance": "medium",
      "score": 59.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Deacon has no backoff or escalation for repeated specialist startup failures",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-304",
      "rank": 122,
      "size": "S",
      "importance": "medium",
      "score": 59.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] closeLinearDirect returns stepOk even when state update never happens",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-324",
      "rank": 123,
      "size": "M",
      "importance": "medium",
      "score": 59.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Agent detail pane missing Merge/Approve button",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-334",
      "rank": 124,
      "size": "M",
      "importance": "medium",
      "score": 59.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-538",
      "rank": 125,
      "size": "M",
      "importance": "medium",
      "score": 59.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan reload freshness guard must also verify the frontend bundle",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-681",
      "rank": 126,
      "size": "M",
      "importance": "medium",
      "score": 59.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-727",
      "rank": 127,
      "size": "S",
      "importance": "medium",
      "score": 59.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Fix orphaned work-agent start handoff after planning",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-775",
      "rank": 128,
      "size": "XL",
      "importance": "medium",
      "score": 59.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-778",
      "rank": 129,
      "size": "S",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Write conflict race: review-agent fails when test-agent write scope not yet released",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-886",
      "rank": 130,
      "size": "S",
      "importance": "medium",
      "score": 58.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-900",
      "rank": 131,
      "size": "S",
      "importance": "medium",
      "score": 58.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Trust devroot for conversations + atomic .claude.json writes",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-927",
      "rank": 132,
      "size": "L",
      "importance": "medium",
      "score": 58.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-932",
      "rank": 133,
      "size": "S",
      "importance": "medium",
      "score": 58.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan done: polyrepo uncommitted changes check + existing MR handling",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-933",
      "rank": 134,
      "size": "M",
      "importance": "medium",
      "score": 58.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1027",
      "rank": 135,
      "size": "S",
      "importance": "medium",
      "score": 58.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1042",
      "rank": 136,
      "size": "S",
      "importance": "medium",
      "score": 58.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1068",
      "rank": 137,
      "size": "S",
      "importance": "medium",
      "score": 58.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1113",
      "rank": 138,
      "size": "S",
      "importance": "medium",
      "score": 58.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1128",
      "rank": 139,
      "size": "S",
      "importance": "medium",
      "score": 58.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1129",
      "rank": 140,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1130",
      "rank": 141,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1149",
      "rank": 142,
      "size": "S",
      "importance": "medium",
      "score": 57.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1150",
      "rank": 143,
      "size": "S",
      "importance": "medium",
      "score": 57.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab di",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1154",
      "rank": 144,
      "size": "S",
      "importance": "medium",
      "score": 57.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1173",
      "rank": 145,
      "size": "S",
      "importance": "medium",
      "score": 57.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1226",
      "rank": 146,
      "size": "XL",
      "importance": "medium",
      "score": 57.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1227",
      "rank": 147,
      "size": "M",
      "importance": "medium",
      "score": 57.5,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[bug] Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1240",
      "rank": 148,
      "size": "S",
      "importance": "medium",
      "score": 57.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1244",
      "rank": 149,
      "size": "S",
      "importance": "medium",
      "score": 57.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1245",
      "rank": 150,
      "size": "L",
      "importance": "medium",
      "score": 57.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1330",
      "rank": 151,
      "size": "S",
      "importance": "medium",
      "score": 57.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan pla",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1386",
      "rank": 152,
      "size": "L",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active ru",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1392",
      "rank": 153,
      "size": "S",
      "importance": "medium",
      "score": 56.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1416",
      "rank": 154,
      "size": "S",
      "importance": "medium",
      "score": 56.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Workspace-spawned dashboards must never claim the canonical dashboard port",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1433",
      "rank": 155,
      "size": "S",
      "importance": "medium",
      "score": 56.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1436",
      "rank": 156,
      "size": "S",
      "importance": "medium",
      "score": 56.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1438",
      "rank": 157,
      "size": "L",
      "importance": "medium",
      "score": 56.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan flywheel start launcher process orphans when orchestrator dies externally",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1440",
      "rank": 158,
      "size": "S",
      "importance": "medium",
      "score": 56.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1444",
      "rank": 159,
      "size": "S",
      "importance": "medium",
      "score": 56.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1445",
      "rank": 160,
      "size": "M",
      "importance": "medium",
      "score": 56.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1446",
      "rank": 161,
      "size": "M",
      "importance": "medium",
      "score": 56.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1449",
      "rank": 162,
      "size": "S",
      "importance": "medium",
      "score": 56.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1461",
      "rank": 163,
      "size": "S",
      "importance": "medium",
      "score": 56.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1480",
      "rank": 164,
      "size": "XL",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] TLDR: 93% bypass rate — daemon/hook integration broken",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1530",
      "rank": 165,
      "size": "S",
      "importance": "medium",
      "score": 55.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1565",
      "rank": 166,
      "size": "S",
      "importance": "medium",
      "score": 55.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1571",
      "rank": 167,
      "size": "S",
      "importance": "medium",
      "score": 55.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's colla",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1572",
      "rank": 168,
      "size": "S",
      "importance": "medium",
      "score": 55.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1624",
      "rank": 169,
      "size": "S",
      "importance": "medium",
      "score": 55.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1627",
      "rank": 170,
      "size": "S",
      "importance": "medium",
      "score": 55.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridabl",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1668",
      "rank": 171,
      "size": "S",
      "importance": "medium",
      "score": 55.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1669",
      "rank": 172,
      "size": "S",
      "importance": "medium",
      "score": 55.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refre",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1672",
      "rank": 173,
      "size": "S",
      "importance": "medium",
      "score": 55.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1673",
      "rank": 174,
      "size": "S",
      "importance": "medium",
      "score": 55.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1674",
      "rank": 175,
      "size": "S",
      "importance": "medium",
      "score": 55.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1710",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 an",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1711",
      "rank": 177,
      "size": "S",
      "importance": "medium",
      "score": 54.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Root-cause and fix dashboard event-loop stalls under load",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1720",
      "rank": 178,
      "size": "S",
      "importance": "medium",
      "score": 54.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddeni",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1728",
      "rank": 179,
      "size": "S",
      "importance": "medium",
      "score": 54.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on fea",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1740",
      "rank": 180,
      "size": "S",
      "importance": "medium",
      "score": 54.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Deacon mislabels SIGTERM workspace container restarts as crashes",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1755",
      "rank": 181,
      "size": "S",
      "importance": "medium",
      "score": 54.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agent",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1761",
      "rank": 182,
      "size": "S",
      "importance": "medium",
      "score": 54.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1769",
      "rank": 183,
      "size": "L",
      "importance": "medium",
      "score": 54.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); ",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1774",
      "rank": 184,
      "size": "S",
      "importance": "medium",
      "score": 54.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1782",
      "rank": 185,
      "size": "S",
      "importance": "medium",
      "score": 54.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1795",
      "rank": 186,
      "size": "S",
      "importance": "medium",
      "score": 54.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1816",
      "rank": 187,
      "size": "S",
      "importance": "medium",
      "score": 54.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — nee",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1824",
      "rank": 188,
      "size": "S",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Fix flaky main CI: fake timers + @slow exclusion for real-timer test family",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1828",
      "rank": 189,
      "size": "S",
      "importance": "medium",
      "score": 53.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1830",
      "rank": 190,
      "size": "S",
      "importance": "medium",
      "score": 53.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report writ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1846",
      "rank": 191,
      "size": "S",
      "importance": "medium",
      "score": 53.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1907",
      "rank": 192,
      "size": "S",
      "importance": "medium",
      "score": 53.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-se",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1912",
      "rank": 193,
      "size": "S",
      "importance": "medium",
      "score": 53.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1918",
      "rank": 194,
      "size": "S",
      "importance": "medium",
      "score": 53.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2006",
      "rank": 195,
      "size": "S",
      "importance": "medium",
      "score": 53.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override,",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2069",
      "rank": 196,
      "size": "S",
      "importance": "medium",
      "score": 53.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2197",
      "rank": 197,
      "size": "S",
      "importance": "medium",
      "score": 53.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents s",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2201",
      "rank": 198,
      "size": "S",
      "importance": "medium",
      "score": 53.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — cl",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2202",
      "rank": 199,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2213",
      "rank": 200,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2237",
      "rank": 201,
      "size": "S",
      "importance": "medium",
      "score": 52.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cli): pan plan done swallows vbrief quality lint details",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2240",
      "rank": 202,
      "size": "S",
      "importance": "medium",
      "score": 52.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appe",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2241",
      "rank": 203,
      "size": "S",
      "importance": "medium",
      "score": 52.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2242",
      "rank": 204,
      "size": "S",
      "importance": "medium",
      "score": 52.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2243",
      "rank": 205,
      "size": "S",
      "importance": "medium",
      "score": 52.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (f",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2244",
      "rank": 206,
      "size": "S",
      "importance": "medium",
      "score": 52.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continu",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2280",
      "rank": 207,
      "size": "S",
      "importance": "medium",
      "score": 52.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from ter",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2282",
      "rank": 208,
      "size": "S",
      "importance": "medium",
      "score": 52.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2287",
      "rank": 209,
      "size": "S",
      "importance": "medium",
      "score": 52.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2381",
      "rank": 210,
      "size": "S",
      "importance": "medium",
      "score": 52.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Rec",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2395",
      "rank": 211,
      "size": "S",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked e",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2408",
      "rank": 212,
      "size": "S",
      "importance": "medium",
      "score": 51.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2414",
      "rank": 213,
      "size": "S",
      "importance": "medium",
      "score": 51.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, other",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2416",
      "rank": 214,
      "size": "S",
      "importance": "medium",
      "score": 51.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-in",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2422",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 51.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2423",
      "rank": 216,
      "size": "M",
      "importance": "medium",
      "score": 51.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templa",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2428",
      "rank": 217,
      "size": "S",
      "importance": "medium",
      "score": 51.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing trae",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2449",
      "rank": 218,
      "size": "S",
      "importance": "medium",
      "score": 51.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and pla",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2454",
      "rank": 219,
      "size": "S",
      "importance": "medium",
      "score": 51.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2465",
      "rank": 220,
      "size": "S",
      "importance": "medium",
      "score": 51.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonz",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2467",
      "rank": 221,
      "size": "S",
      "importance": "medium",
      "score": 51.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Multi-repo merge train merges only one repo, strands sibling repos' branches (MIN-857 api half never merged)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2469",
      "rank": 222,
      "size": "S",
      "importance": "medium",
      "score": 51.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2478",
      "rank": 223,
      "size": "S",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2484",
      "rank": 224,
      "size": "S",
      "importance": "medium",
      "score": 50.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added;",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2489",
      "rank": 225,
      "size": "S",
      "importance": "medium",
      "score": 50.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2492",
      "rank": 226,
      "size": "S",
      "importance": "medium",
      "score": 50.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2495",
      "rank": 227,
      "size": "S",
      "importance": "medium",
      "score": 50.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2501",
      "rank": 228,
      "size": "S",
      "importance": "medium",
      "score": 50.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfi",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2506",
      "rank": 229,
      "size": "S",
      "importance": "medium",
      "score": 50.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2533",
      "rank": 230,
      "size": "S",
      "importance": "medium",
      "score": 50.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2546",
      "rank": 231,
      "size": "S",
      "importance": "medium",
      "score": 50.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2547",
      "rank": 232,
      "size": "S",
      "importance": "medium",
      "score": 50.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms the",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2550",
      "rank": 233,
      "size": "S",
      "importance": "medium",
      "score": 50.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2554",
      "rank": 234,
      "size": "S",
      "importance": "medium",
      "score": 50.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/book",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2560",
      "rank": 235,
      "size": "XL",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2563",
      "rank": 236,
      "size": "S",
      "importance": "medium",
      "score": 49.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2572",
      "rank": 237,
      "size": "S",
      "importance": "medium",
      "score": 49.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2580",
      "rank": 238,
      "size": "S",
      "importance": "medium",
      "score": 49.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live se",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2627",
      "rank": 239,
      "size": "S",
      "importance": "medium",
      "score": 49.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the w",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2649",
      "rank": 240,
      "size": "S",
      "importance": "medium",
      "score": 49.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(palette): Ctrl+K conversation search indexes Claude transcripts only",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2651",
      "rank": 241,
      "size": "M",
      "importance": "medium",
      "score": 49.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2652",
      "rank": 242,
      "size": "S",
      "importance": "medium",
      "score": 49.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisib",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2656",
      "rank": 243,
      "size": "S",
      "importance": "medium",
      "score": 49.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2659",
      "rank": 244,
      "size": "S",
      "importance": "medium",
      "score": 49.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #262",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2663",
      "rank": 245,
      "size": "S",
      "importance": "medium",
      "score": 49.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(restart): health probe can accept old dashboard after replacement EADDRINUSE",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2664",
      "rank": 246,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(sync-main): auto-commit completes unresolved merge with conflict markers",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2668",
      "rank": 247,
      "size": "S",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2670",
      "rank": 248,
      "size": "S",
      "importance": "medium",
      "score": 48.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-ex",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2672",
      "rank": 249,
      "size": "S",
      "importance": "medium",
      "score": 48.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null cla",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2680",
      "rank": 250,
      "size": "S",
      "importance": "medium",
      "score": 48.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2686",
      "rank": 251,
      "size": "S",
      "importance": "medium",
      "score": 48.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2689",
      "rank": 252,
      "size": "S",
      "importance": "medium",
      "score": 48.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Review verdicts from sandboxed codex review agents are silently lost — fire-and-forget journal write dies with",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2691",
      "rank": 253,
      "size": "S",
      "importance": "medium",
      "score": 48.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry,",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2695",
      "rank": 254,
      "size": "S",
      "importance": "medium",
      "score": 48.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and k",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2696",
      "rank": 255,
      "size": "S",
      "importance": "medium",
      "score": 48.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2697",
      "rank": 256,
      "size": "S",
      "importance": "medium",
      "score": 48.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2699",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 48.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree a",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2700",
      "rank": 258,
      "size": "S",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the prev",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2717",
      "rank": 259,
      "size": "S",
      "importance": "medium",
      "score": 47.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2733",
      "rank": 260,
      "size": "S",
      "importance": "medium",
      "score": 47.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,9",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2734",
      "rank": 261,
      "size": "S",
      "importance": "medium",
      "score": 47.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge ha",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2738",
      "rank": 262,
      "size": "S",
      "importance": "medium",
      "score": 47.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2739",
      "rank": 263,
      "size": "S",
      "importance": "medium",
      "score": 47.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeSta",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2742",
      "rank": 264,
      "size": "S",
      "importance": "medium",
      "score": 47.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(review): synthesis fires 42s after spawn and reports reviewers with reports on disk as 'infrastructure fai",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2746",
      "rank": 265,
      "size": "S",
      "importance": "medium",
      "score": 47.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(review): infra-failure bypass writes reviewStatus='passed' — indistinguishable from a real approval; nearl",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2747",
      "rank": 266,
      "size": "S",
      "importance": "medium",
      "score": 47.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Flywheel cannot be resumed after a crash/reboot: Resume is disabled and the only offered action aborts the run",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2749",
      "rank": 267,
      "size": "S",
      "importance": "medium",
      "score": 47.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Resume restores the conversation but not the machinery: timers, monitors and background processes die and are ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2754",
      "rank": 268,
      "size": "S",
      "importance": "medium",
      "score": 47.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2755",
      "rank": 269,
      "size": "S",
      "importance": "medium",
      "score": 47.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2758",
      "rank": 270,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Provider capacity error silently zombies a spawned agent: willRetry=false, turn reported completed, state stay",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2759",
      "rank": 271,
      "size": "S",
      "importance": "medium",
      "score": 46.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Dead flywheel with an active run was never auto-relaunched after a reboot — sat idle 2h with recovery wired an",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2761",
      "rank": 272,
      "size": "S",
      "importance": "medium",
      "score": 46.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBO",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2763",
      "rank": 273,
      "size": "S",
      "importance": "medium",
      "score": 46.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md expl",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2769",
      "rank": 274,
      "size": "S",
      "importance": "medium",
      "score": 46.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] review_status rows are never reconciled when an issue closes — 9 closed issues still advertise reviewing/faile",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2775",
      "rank": 275,
      "size": "S",
      "importance": "medium",
      "score": 46.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simul",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2792",
      "rank": 276,
      "size": "S",
      "importance": "medium",
      "score": 46.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2796",
      "rank": 277,
      "size": "S",
      "importance": "medium",
      "score": 46.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] fix(cloister): idle nudge must not advance after failed mandatory inspection",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2802",
      "rank": 278,
      "size": "S",
      "importance": "medium",
      "score": 46.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): same-head strike-ready cannot re-arm a needs-you landing",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2805",
      "rank": 279,
      "size": "S",
      "importance": "medium",
      "score": 46.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal land",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2806",
      "rank": 280,
      "size": "S",
      "importance": "medium",
      "score": 46.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] bug(cloister): strike merge trigger registry splits across dashboard chunks",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2810",
      "rank": 281,
      "size": "S",
      "importance": "medium",
      "score": 46.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSu",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2813",
      "rank": 282,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2820",
      "rank": 283,
      "size": "M",
      "importance": "medium",
      "score": 45.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] CRITICAL: main HEAD dashboard build stalls in boot before HTTP listen (running a9e301526b rollback)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2824",
      "rank": 284,
      "size": "S",
      "importance": "medium",
      "score": 45.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2828",
      "rank": 285,
      "size": "S",
      "importance": "medium",
      "score": 45.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2839",
      "rank": 286,
      "size": "S",
      "importance": "medium",
      "score": 45.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] plan→work autoSpawn now 500s with a duplicated workspace prep — nondeterministic half-spawns (post-PAN-2825)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2869",
      "rank": 287,
      "size": "S",
      "importance": "medium",
      "score": 45.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[bug] Conversation launch dies with raw 'execvp(3) failed' when the harness binary (claude) is missing or not on the",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2376",
      "rank": 288,
      "size": "XL",
      "importance": "medium",
      "score": 45.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[substrate] Epic: CI/CD reliability — flake policy, verification-to-merge convergence, strike/swarm merge-path hardening, ",
      "rationale": "",
      "gate": "auto",
      "planning": "skip",
      "isEpic": false
    },
    {
      "issue": "PAN-578",
      "rank": 289,
      "size": "M",
      "importance": "high",
      "score": 45.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[security] Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1435",
      "rank": 290,
      "size": "S",
      "importance": "high",
      "score": 45.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[security] API keys in ~/.panopticon/config.yaml stored as plaintext",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1915",
      "rank": 291,
      "size": "S",
      "importance": "high",
      "score": 45.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[security] enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-532",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 45.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Per-project and per-issue model overrides for pipeline roles",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-817",
      "rank": 293,
      "size": "S",
      "importance": "medium",
      "score": 45.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Improve planning dialog layout and content fit",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-924",
      "rank": 294,
      "size": "XL",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Spike: evaluate GitNexus for Panopticon integration",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1040",
      "rank": 295,
      "size": "S",
      "importance": "medium",
      "score": 44.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1041",
      "rank": 296,
      "size": "S",
      "importance": "medium",
      "score": 44.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-537",
      "rank": 297,
      "size": "S",
      "importance": "medium",
      "score": 44.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat: show changed files diff summary after each agent response in activity view",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-646",
      "rank": 298,
      "size": "L",
      "importance": "medium",
      "score": 44.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Canceled issues: add guided Recover workflow",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-700",
      "rank": 299,
      "size": "M",
      "importance": "medium",
      "score": 44.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Detachable terminal for conversation view — popout into OS window",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-713",
      "rank": 300,
      "size": "M",
      "importance": "medium",
      "score": 44.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] test: add unit tests for doneCommand and approveCommand",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-802",
      "rank": 301,
      "size": "S",
      "importance": "medium",
      "score": 44.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Resume on conversation session forks instead of resuming",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-863",
      "rank": 302,
      "size": "S",
      "importance": "medium",
      "score": 44.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] One-shot sweep of stale feature branches and worktrees predating the reaper",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-947",
      "rank": 303,
      "size": "S",
      "importance": "medium",
      "score": 44.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat: project management actions in unified sidebar",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1164",
      "rank": 304,
      "size": "S",
      "importance": "medium",
      "score": 44.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1577",
      "rank": 305,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Move a conversation to a different project (CLI + drag/drop + menu action)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1951",
      "rank": 306,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-37",
      "rank": 307,
      "size": "M",
      "importance": "medium",
      "score": 43.9,
      "condition": "stale",
      "dependsOn": [],
      "why": "[feat] Support external PR selection for merge-agent",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-38",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 43.8,
      "condition": "stale",
      "dependsOn": [],
      "why": "[feat] Support multiple merge agents per repository",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-77",
      "rank": 309,
      "size": "S",
      "importance": "medium",
      "score": 43.7,
      "condition": "stale",
      "dependsOn": [],
      "why": "[feat] Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-243",
      "rank": 310,
      "size": "M",
      "importance": "medium",
      "score": 43.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Audit dashboard actions: ensure all are available via CLI",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-252",
      "rank": 311,
      "size": "M",
      "importance": "medium",
      "score": 43.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Disable Sync with Main button when workspace is up to date",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-255",
      "rank": 312,
      "size": "M",
      "importance": "medium",
      "score": 43.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-258",
      "rank": 313,
      "size": "M",
      "importance": "medium",
      "score": 43.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Kanban board: fit all columns without horizontal scrolling",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-277",
      "rank": 314,
      "size": "M",
      "importance": "medium",
      "score": 43.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Session reasoning capture & collaborative PRD refinement",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-293",
      "rank": 315,
      "size": "M",
      "importance": "medium",
      "score": 43.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Project Living Memory — per-project semantic memory for agents",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-294",
      "rank": 316,
      "size": "L",
      "importance": "medium",
      "score": 43.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Surface module initialization errors as system-level, not per-issue",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-450",
      "rank": 317,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-452",
      "rank": 318,
      "size": "M",
      "importance": "medium",
      "score": 42.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Conversation input bar — mode/permissions/workspace selectors",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-454",
      "rank": 319,
      "size": "M",
      "importance": "medium",
      "score": 42.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-463",
      "rank": 320,
      "size": "M",
      "importance": "medium",
      "score": 42.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Add Qwen 3.6+ model support",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-465",
      "rank": 321,
      "size": "M",
      "importance": "medium",
      "score": 42.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Add OpenRouter as a model provider",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-466",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 42.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-531",
      "rank": 323,
      "size": "M",
      "importance": "medium",
      "score": 42.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] PAN: Windows Electron support (WSL2 required)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-546",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 42.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Remove claude-code-router — all providers use direct env var injection",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-548",
      "rank": 325,
      "size": "M",
      "importance": "medium",
      "score": 42.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Command Deck: preserve state across navigation including URL routing for tabs",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-606",
      "rank": 326,
      "size": "M",
      "importance": "medium",
      "score": 42.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-607",
      "rank": 327,
      "size": "M",
      "importance": "medium",
      "score": 42.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-613",
      "rank": 328,
      "size": "M",
      "importance": "medium",
      "score": 42.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-629",
      "rank": 329,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Workspace quotas and resource governance",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-637",
      "rank": 330,
      "size": "M",
      "importance": "medium",
      "score": 41.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Direct issue kickoff (skip planning) from dashboard UI",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-649",
      "rank": 331,
      "size": "M",
      "importance": "medium",
      "score": 41.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Render Excalidraw drawings inline in Claude Code conversations",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-654",
      "rank": 332,
      "size": "M",
      "importance": "medium",
      "score": 41.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Project Setup Wizard — Dashboard UI",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-675",
      "rank": 333,
      "size": "M",
      "importance": "medium",
      "score": 41.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-678",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 41.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-687",
      "rank": 335,
      "size": "M",
      "importance": "medium",
      "score": 41.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Support OpenCode as alternative coding agent",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-818",
      "rank": 336,
      "size": "S",
      "importance": "medium",
      "score": 41.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Make summary optional when forking conversations",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-901",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 41.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-902",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 41.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Settings: add 'Run pan sync' button to configuration menu",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-903",
      "rank": 339,
      "size": "S",
      "importance": "medium",
      "score": 41.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-938",
      "rank": 340,
      "size": "S",
      "importance": "medium",
      "score": 41.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-949",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat: add conversation for project from sidebar",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-958",
      "rank": 342,
      "size": "XL",
      "importance": "medium",
      "score": 40.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1037",
      "rank": 343,
      "size": "S",
      "importance": "medium",
      "score": 40.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1060",
      "rank": 344,
      "size": "S",
      "importance": "medium",
      "score": 40.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1151",
      "rank": 345,
      "size": "S",
      "importance": "medium",
      "score": 40.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1165",
      "rank": 346,
      "size": "S",
      "importance": "medium",
      "score": 40.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Lightweight review path for small/trivial PRs",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1223",
      "rank": 347,
      "size": "S",
      "importance": "medium",
      "score": 40.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Auto-update for users in the field (npm + desktop binaries)",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1432",
      "rank": 348,
      "size": "S",
      "importance": "medium",
      "score": 40.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1437",
      "rank": 349,
      "size": "S",
      "importance": "medium",
      "score": 40.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] pan flywheel report semantics: split read-only snapshot from run finalization",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1442",
      "rank": 350,
      "size": "S",
      "importance": "medium",
      "score": 40.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1443",
      "rank": 351,
      "size": "XL",
      "importance": "medium",
      "score": 40.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1469",
      "rank": 352,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] End-to-end review and consolidation of all project documentation",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1473",
      "rank": 353,
      "size": "XL",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separatel",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1485",
      "rank": 354,
      "size": "S",
      "importance": "medium",
      "score": 39.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1489",
      "rank": 355,
      "size": "S",
      "importance": "medium",
      "score": 39.8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[feat] task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1490",
      "rank": 356,
      "size": "S",
      "importance": "medium",
      "score": 39.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1524",
      "rank": 357,
      "size": "S",
      "importance": "medium",
      "score": 39.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1542",
      "rank": 358,
      "size": "L",
      "importance": "medium",
      "score": 39.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1545",
      "rank": 359,
      "size": "S",
      "importance": "medium",
      "score": 39.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palet",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1623",
      "rank": 360,
      "size": "S",
      "importance": "medium",
      "score": 39.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1653",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 39.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1654",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 39.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1655",
      "rank": 363,
      "size": "S",
      "importance": "medium",
      "score": 39.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1656",
      "rank": 364,
      "size": "S",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1657",
      "rank": 365,
      "size": "S",
      "importance": "medium",
      "score": 38.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1676",
      "rank": 366,
      "size": "S",
      "importance": "medium",
      "score": 38.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1684",
      "rank": 367,
      "size": "M",
      "importance": "medium",
      "score": 38.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1685",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 38.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-1776",
      "rank": 369,
      "size": "S",
      "importance": "medium",
      "score": 38.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1837",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 38.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1839",
      "rank": 371,
      "size": "S",
      "importance": "medium",
      "score": 38.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1840",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 38.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1844",
      "rank": 373,
      "size": "S",
      "importance": "medium",
      "score": 38.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1852",
      "rank": 374,
      "size": "S",
      "importance": "medium",
      "score": 38.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1853",
      "rank": 375,
      "size": "S",
      "importance": "medium",
      "score": 38.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1854",
      "rank": 376,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1916",
      "rank": 377,
      "size": "S",
      "importance": "medium",
      "score": 37.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1965",
      "rank": 378,
      "size": "S",
      "importance": "medium",
      "score": 37.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1967",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 37.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1968",
      "rank": 380,
      "size": "S",
      "importance": "medium",
      "score": 37.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Finish local-domain rename: pan.localhost → overdeck.localhost",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1985",
      "rank": 381,
      "size": "S",
      "importance": "medium",
      "score": 37.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1991",
      "rank": 382,
      "size": "XL",
      "importance": "medium",
      "score": 37.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Issue cockpit redesign — incremental rollout (tracking)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1995",
      "rank": 383,
      "size": "S",
      "importance": "medium",
      "score": 37.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2004",
      "rank": 384,
      "size": "S",
      "importance": "medium",
      "score": 37.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2024",
      "rank": 385,
      "size": "S",
      "importance": "medium",
      "score": 37.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: frontend Tools-toggle for conversation view",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2025",
      "rank": 386,
      "size": "S",
      "importance": "medium",
      "score": 37.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2026",
      "rank": 387,
      "size": "S",
      "importance": "medium",
      "score": 37.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: surface 35+ provider matrix in dashboard model picker",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2028",
      "rank": 388,
      "size": "S",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: per-provider cost grouping in cost dashboard",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2029",
      "rank": 389,
      "size": "S",
      "importance": "medium",
      "score": 36.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2030",
      "rank": 390,
      "size": "S",
      "importance": "medium",
      "score": 36.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2031",
      "rank": 391,
      "size": "M",
      "importance": "medium",
      "score": 36.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2032",
      "rank": 392,
      "size": "S",
      "importance": "medium",
      "score": 36.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: local Ollama model as zero-cost preliminary review role",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2033",
      "rank": 393,
      "size": "S",
      "importance": "medium",
      "score": 36.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2034",
      "rank": 394,
      "size": "S",
      "importance": "medium",
      "score": 36.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2035",
      "rank": 395,
      "size": "S",
      "importance": "medium",
      "score": 36.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] ohmypi: GitHub Copilot subscription provider routing via omp",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2065",
      "rank": 396,
      "size": "S",
      "importance": "medium",
      "score": 36.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2266",
      "rank": 397,
      "size": "M",
      "importance": "medium",
      "score": 36.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat: add zcode harness and make it the default for glm-5.2",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2288",
      "rank": 398,
      "size": "S",
      "importance": "medium",
      "score": 36.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2295",
      "rank": 399,
      "size": "XL",
      "importance": "medium",
      "score": 36.1,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[feat] feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation in",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-2335",
      "rank": 400,
      "size": "S",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for ope",
      "rationale": "",
      "gate": "blocked",
      "planning": "skip",
      "isEpic": false
    },
    {
      "issue": "PAN-2548",
      "rank": 401,
      "size": "S",
      "importance": "medium",
      "score": 35.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every p",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2553",
      "rank": 402,
      "size": "L",
      "importance": "medium",
      "score": 35.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2557",
      "rank": 403,
      "size": "S",
      "importance": "medium",
      "score": 35.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by t",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2556",
      "rank": 404,
      "size": "M",
      "importance": "medium",
      "score": 35.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(dashboard): add a per-issue 'Restart agent' action (stop+start active role) — the restartAgent type exist",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2565",
      "rank": 405,
      "size": "S",
      "importance": "medium",
      "score": 35.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2566",
      "rank": 406,
      "size": "XL",
      "importance": "medium",
      "score": 35.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2582",
      "rank": 407,
      "size": "S",
      "importance": "medium",
      "score": 35.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lane",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2608",
      "rank": 408,
      "size": "S",
      "importance": "medium",
      "score": 35.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance mile",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2609",
      "rank": 409,
      "size": "S",
      "importance": "medium",
      "score": 35.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Cross-device sync of conversations and tasks via user-owned git remote",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2646",
      "rank": 410,
      "size": "S",
      "importance": "medium",
      "score": 35.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] feat(swarm): configurable global/project/issue policy UI with default OFF",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2685",
      "rank": 411,
      "size": "S",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2718",
      "rank": 412,
      "size": "S",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "[feat] pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-633",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 34.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] Update Cloister PRD and docs index — stale relative to implementation",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-634",
      "rank": 414,
      "size": "S",
      "importance": "low",
      "score": 34.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-674",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 34.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs: add glossary of Panopticon domain terms",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1474",
      "rank": 416,
      "size": "M",
      "importance": "low",
      "score": 34.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1683",
      "rank": 417,
      "size": "S",
      "importance": "low",
      "score": 34.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2067",
      "rank": 418,
      "size": "M",
      "importance": "low",
      "score": 34.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs: add user-facing page for RTK (Bash output compression)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2068",
      "rank": 419,
      "size": "M",
      "importance": "low",
      "score": 34.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs: add user-facing page for Caveman (agent output compression)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2070",
      "rank": 420,
      "size": "L",
      "importance": "low",
      "score": 34.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs: add user-facing page for the Flywheel orchestrator",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2071",
      "rank": 421,
      "size": "L",
      "importance": "low",
      "score": 34.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs: add user-facing page for the Hooks system",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2073",
      "rank": 422,
      "size": "M",
      "importance": "low",
      "score": 34.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[docs] docs: add user-facing page for the Desktop App",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1066",
      "rank": 423,
      "size": "S",
      "importance": "low",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1126",
      "rank": 424,
      "size": "S",
      "importance": "low",
      "score": 33.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Integrate TLDR summaries into review context manifest",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-43",
      "rank": 425,
      "size": "M",
      "importance": "low",
      "score": 33.8,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] Add Slack and email notifications for agent events",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-44",
      "rank": 426,
      "size": "M",
      "importance": "low",
      "score": 33.8,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-47",
      "rank": 427,
      "size": "M",
      "importance": "low",
      "score": 33.7,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PRD files should be committed to feature branch, moved to completed/ on merge",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-51",
      "rank": 428,
      "size": "M",
      "importance": "low",
      "score": 33.6,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[item] Documentation: Clarify issue tracker options beyond Linear",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-52",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 33.5,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[item] Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-54",
      "rank": 430,
      "size": "XL",
      "importance": "low",
      "score": 33.4,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] feat: Add pan test:e2e command for full workflow integration test",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-55",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 33.3,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] Track specialist costs with time period filtering",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-106",
      "rank": 432,
      "size": "M",
      "importance": "low",
      "score": 33.3,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] Cost prediction/estimation for in-progress work",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-146",
      "rank": 433,
      "size": "M",
      "importance": "low",
      "score": 33.2,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-146: Refine light mode theming across all dashboard pages",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-155",
      "rank": 434,
      "size": "XL",
      "importance": "low",
      "score": 33.1,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-175",
      "rank": 435,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-175: Pre-compact auto-save hook for agent sessions",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-176",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 32.9,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-177",
      "rank": 437,
      "size": "M",
      "importance": "low",
      "score": 32.8,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-177: Iteration limits with escalation for autonomous agents",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-178",
      "rank": 438,
      "size": "M",
      "importance": "low",
      "score": 32.7,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-178: Crash recovery with granular task checkpointing",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-180",
      "rank": 439,
      "size": "M",
      "importance": "low",
      "score": 32.7,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-180: Cross-terminal file locking for concurrent agents",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-190",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 32.6,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-198",
      "rank": 441,
      "size": "M",
      "importance": "low",
      "score": 32.5,
      "condition": "stale",
      "dependsOn": [],
      "why": "[item] Structured audit trail for agent actions",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-227",
      "rank": 442,
      "size": "M",
      "importance": "low",
      "score": 32.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Phase gate validation — mid-implementation acceptance checks",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-228",
      "rank": 443,
      "size": "M",
      "importance": "low",
      "score": 32.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Shift-left post-edit diagnostics — type check after every edit",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-241",
      "rank": 444,
      "size": "XL",
      "importance": "low",
      "score": 32.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-249",
      "rank": 445,
      "size": "M",
      "importance": "low",
      "score": 32.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-265",
      "rank": 446,
      "size": "M",
      "importance": "low",
      "score": 32.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Review skill categorization: all skills available everywhere via personal + workspace",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-271",
      "rank": 447,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Auto-assign Linear project from project config when creating issues",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-283",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 31.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Reset should sync workspace feature branch with latest main",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-297",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 31.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-298",
      "rank": 450,
      "size": "M",
      "importance": "low",
      "score": 31.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Auto-detect package manager and runtime in workspace setup",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-299",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 31.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Granular session state persistence across context compaction",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-407",
      "rank": 452,
      "size": "M",
      "importance": "low",
      "score": 31.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Run Panopticon from a main workspace for development isolation",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-438",
      "rank": 453,
      "size": "XL",
      "importance": "low",
      "score": 31.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Migrate remaining REST polling endpoints to Effect RPC",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-459",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 31.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Planning setup screen with SSE progress streaming",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-461",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 31.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Deep-wipe multi-step progress dialog",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-468",
      "rank": 456,
      "size": "M",
      "importance": "low",
      "score": 31.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Agent test conversations pollute production database — need test isolation",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-471",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 31.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-476",
      "rank": 458,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Agent resume with Haiku session summary instead of claude --resume",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-480",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Pass --effort flag when spawning planning agents via Cloister",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-483",
      "rank": 460,
      "size": "S",
      "importance": "low",
      "score": 30.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Unify Resume Agent UX — all entry points should show message input",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-543",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 30.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add confirmation dialog before applying Optimal Defaults",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-554",
      "rank": 462,
      "size": "M",
      "importance": "low",
      "score": 30.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add kanban board deeplinks for issue URLs",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-564",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 30.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Slash menu positioned incorrectly — cut off / off-screen",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-565",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 30.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Handle CTRL-Z to undo accidental conversation archival",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-568",
      "rank": 465,
      "size": "S",
      "importance": "low",
      "score": 30.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Kanban: Show workspace and tmux session counts in stats",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-570",
      "rank": 466,
      "size": "S",
      "importance": "low",
      "score": 30.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Show PLAN badge on costs when under a subscription/plan",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-571",
      "rank": 467,
      "size": "M",
      "importance": "low",
      "score": 30.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add OpenRouter credits/plan status endpoint and UI",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-576",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 30.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Global / search should include conversations in addition to workspace features",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-589",
      "rank": 469,
      "size": "S",
      "importance": "low",
      "score": 30.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Review and update commands-skills.md with all available Panopticon skills",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-591",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-603",
      "rank": 471,
      "size": "M",
      "importance": "low",
      "score": 29.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Plan review loop with configurable reviewer model",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-604",
      "rank": 472,
      "size": "M",
      "importance": "low",
      "score": 29.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Hide planning agent from workspace detail pane",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-622",
      "rank": 473,
      "size": "L",
      "importance": "low",
      "score": 29.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] YAML workflow DAGs: custom per-project pipeline definitions",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-623",
      "rank": 474,
      "size": "L",
      "importance": "low",
      "score": 29.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-624",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 29.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Loop nodes: iterative agent execution with conditional termination",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-658",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 29.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-660",
      "rank": 477,
      "size": "M",
      "importance": "low",
      "score": 29.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-663",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 29.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-701",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 29.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Quick-Create conversation via keystroke using Conversations-page default model",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-702",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 29.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-709",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 29.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A dete",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-730",
      "rank": 482,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add provider account telemetry for credits, balances, and usage",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-735",
      "rank": 483,
      "size": "M",
      "importance": "low",
      "score": 28.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Settings page: review and configure overridden subagent model files",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-736",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 28.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-738",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 28.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add right-click fork option to conversation list",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-743",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 28.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add consistent new conversation icon actions in Command Deck",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-747",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 28.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Conversation list items lack accessible labels in accessibility tree",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-749",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 28.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Research and borrow best features from gstack",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-750",
      "rank": 489,
      "size": "XL",
      "importance": "low",
      "score": 28.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-751",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 28.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-752",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 28.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-762",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 28.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Settings: warn when model overrides target disabled providers",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-764",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 28.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add quota/usage inspector for routed model providers",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-765",
      "rank": 494,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Preserve trailing zeros in cost displays",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-769",
      "rank": 495,
      "size": "M",
      "importance": "low",
      "score": 27.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Track verification/review/test phase churn over time",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-771",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 27.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Investigate Vercel Sandbox execution backend support",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-772",
      "rank": 497,
      "size": "S",
      "importance": "low",
      "score": 27.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Unify terminal stack behavior across tmux sessions",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-773",
      "rank": 498,
      "size": "S",
      "importance": "low",
      "score": 27.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Design prompt-style overlays with model hierarchy and scoped toggles",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-774",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 27.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-777",
      "rank": 500,
      "size": "S",
      "importance": "low",
      "score": 27.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Inter-agent communication skill: send messages to conversation-mode agents",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-786",
      "rank": 501,
      "size": "S",
      "importance": "low",
      "score": 27.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Post planning Q\\&A answers as issue comment",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-790",
      "rank": 502,
      "size": "S",
      "importance": "low",
      "score": 27.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-791",
      "rank": 503,
      "size": "S",
      "importance": "low",
      "score": 27.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-793",
      "rank": 504,
      "size": "S",
      "importance": "low",
      "score": 27.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-797",
      "rank": 505,
      "size": "S",
      "importance": "low",
      "score": 27.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-810",
      "rank": 506,
      "size": "S",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Inspector: diagnostic UI when pipeline phase is unknown",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-832",
      "rank": 507,
      "size": "S",
      "importance": "low",
      "score": 26.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActiv",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-833",
      "rank": 508,
      "size": "S",
      "importance": "low",
      "score": 26.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-853",
      "rank": 509,
      "size": "XL",
      "importance": "low",
      "score": 26.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-898",
      "rank": 510,
      "size": "S",
      "importance": "low",
      "score": 26.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Dashboard polling and WebSocket efficiency: remaining audit findings",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-908",
      "rank": 511,
      "size": "S",
      "importance": "low",
      "score": 26.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] PAN-908: Make work-agent spawn limits configurable and overridable",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-943",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 26.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add memory file review and management command",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-944",
      "rank": 513,
      "size": "S",
      "importance": "low",
      "score": 26.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Make vBRIEF the durable task graph source of truth",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-961",
      "rank": 514,
      "size": "S",
      "importance": "low",
      "score": 26.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Update documentation for vBRIEF v0.6 lifecycle model",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-962",
      "rank": 515,
      "size": "S",
      "importance": "low",
      "score": 26.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-984",
      "rank": 516,
      "size": "S",
      "importance": "low",
      "score": 26.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Evaluate context-mode MCP server as session continuity + search layer",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1049",
      "rank": 517,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Spike: evaluate Tauri v2 desktop shell",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1051",
      "rank": 518,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1063",
      "rank": 519,
      "size": "S",
      "importance": "low",
      "score": 25.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1064",
      "rank": 520,
      "size": "S",
      "importance": "low",
      "score": 25.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Harden launcher generation against shell-quote injection (model and arg quoting)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1065",
      "rank": 521,
      "size": "S",
      "importance": "low",
      "score": 25.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Validate issueId at every shell-string interpolation site (defense in depth)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1116",
      "rank": 522,
      "size": "S",
      "importance": "low",
      "score": 25.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Memory: cross-project search mode",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1117",
      "rank": 523,
      "size": "S",
      "importance": "low",
      "score": 25.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Memory: pinned docs (long-form doc chunking + retrieval)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1121",
      "rank": 524,
      "size": "S",
      "importance": "low",
      "score": 25.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1123",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 25.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1124",
      "rank": 526,
      "size": "S",
      "importance": "low",
      "score": 25.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Decouple specs and PRDs from workspaces — write directly to main",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1133",
      "rank": 527,
      "size": "S",
      "importance": "low",
      "score": 25.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] TLDR: deacon supervision + pan doctor check + GC",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1135",
      "rank": 528,
      "size": "L",
      "importance": "low",
      "score": 25.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Document the hook system in docs/HOOKS.md",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1136",
      "rank": 529,
      "size": "L",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1152",
      "rank": 530,
      "size": "S",
      "importance": "low",
      "score": 24.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1153",
      "rank": 531,
      "size": "S",
      "importance": "low",
      "score": 24.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1166",
      "rank": 532,
      "size": "S",
      "importance": "low",
      "score": 24.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1208",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 24.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1222",
      "rank": 534,
      "size": "S",
      "importance": "low",
      "score": 24.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1242",
      "rank": 535,
      "size": "S",
      "importance": "low",
      "score": 24.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Create a new issue directly from a kanban column",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1325",
      "rank": 536,
      "size": "L",
      "importance": "low",
      "score": 24.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1356",
      "rank": 537,
      "size": "S",
      "importance": "low",
      "score": 24.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Extend the memory Observation pipeline to ad-hoc conversations",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1479",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 24.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] RTK: Add telemetry to measure token savings from bash output compression",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1481",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 24.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add cost-event telemetry for Caveman token savings",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1482",
      "rank": 540,
      "size": "S",
      "importance": "low",
      "score": 24.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Token spend report should aggregate data from repo, not just local machine",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1483",
      "rank": 541,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1533",
      "rank": 542,
      "size": "S",
      "importance": "low",
      "score": 23.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Fork-into-worktree from conversation branch chip",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1550",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 23.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1552",
      "rank": 544,
      "size": "S",
      "importance": "low",
      "score": 23.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1553",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 23.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1581",
      "rank": 546,
      "size": "S",
      "importance": "low",
      "score": 23.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1592",
      "rank": 547,
      "size": "S",
      "importance": "low",
      "score": 23.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1640",
      "rank": 548,
      "size": "S",
      "importance": "low",
      "score": 23.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1641",
      "rank": 549,
      "size": "S",
      "importance": "low",
      "score": 23.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Run agents on local GPU models via a managed Ollama sidecar",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1643",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 23.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1646",
      "rank": 551,
      "size": "S",
      "importance": "low",
      "score": 23.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Rabbit-hole drift detection and lift-to-new-conversation",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1667",
      "rank": 552,
      "size": "S",
      "importance": "low",
      "score": 23.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1691",
      "rank": 553,
      "size": "S",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands re",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1696",
      "rank": 554,
      "size": "S",
      "importance": "low",
      "score": 22.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Merge train becomes per-project — works without a Flywheel run, multi-project view",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1735",
      "rank": 555,
      "size": "S",
      "importance": "low",
      "score": 22.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1748",
      "rank": 556,
      "size": "S",
      "importance": "low",
      "score": 22.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1750",
      "rank": 557,
      "size": "S",
      "importance": "low",
      "score": 22.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1751",
      "rank": 558,
      "size": "S",
      "importance": "low",
      "score": 22.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Fly",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1754",
      "rank": 559,
      "size": "S",
      "importance": "low",
      "score": 22.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings p",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1758",
      "rank": 560,
      "size": "S",
      "importance": "low",
      "score": 22.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Watch: ready-for-merge work must converge despite a continuously moving main",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1773",
      "rank": 561,
      "size": "S",
      "importance": "low",
      "score": 22.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1775",
      "rank": 562,
      "size": "S",
      "importance": "low",
      "score": 22.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1878",
      "rank": 563,
      "size": "S",
      "importance": "low",
      "score": 22.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1895",
      "rank": 564,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Spawn work agents from issue workspace slide-out",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1906",
      "rank": 565,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1910",
      "rank": 566,
      "size": "S",
      "importance": "low",
      "score": 21.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1914",
      "rank": 567,
      "size": "S",
      "importance": "low",
      "score": 21.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Follow-up: move /api/health/agents off agent-directory scans",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1926",
      "rank": 568,
      "size": "S",
      "importance": "low",
      "score": 21.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1936",
      "rank": 569,
      "size": "S",
      "importance": "low",
      "score": 21.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoint",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1937",
      "rank": 570,
      "size": "S",
      "importance": "low",
      "score": 21.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-fa",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1949",
      "rank": 571,
      "size": "S",
      "importance": "low",
      "score": 21.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1958",
      "rank": 572,
      "size": "S",
      "importance": "low",
      "score": 21.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1980",
      "rank": 573,
      "size": "S",
      "importance": "low",
      "score": 21.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1983",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 21.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1984",
      "rank": 575,
      "size": "XL",
      "importance": "low",
      "score": 21.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1986",
      "rank": 576,
      "size": "S",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1988",
      "rank": 577,
      "size": "S",
      "importance": "low",
      "score": 20.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1990",
      "rank": 578,
      "size": "S",
      "importance": "low",
      "score": 20.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] First-class workspaces and projects with per-workspace memory",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1999",
      "rank": 579,
      "size": "S",
      "importance": "low",
      "score": 20.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2002",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 20.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2005",
      "rank": 581,
      "size": "S",
      "importance": "low",
      "score": 20.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2008",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 20.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2046",
      "rank": 583,
      "size": "S",
      "importance": "low",
      "score": 20.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Conversation view does not surface terminal command responses",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2066",
      "rank": 584,
      "size": "S",
      "importance": "low",
      "score": 20.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] OKF v2 — knowledge viewer: inkeep open-knowledge coinstall (progressive), /okf open, dashboard Knowledge page",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-2074",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 20.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "rationale": "",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": false
    },
    {
      "issue": "PAN-2082",
      "rank": 586,
      "size": "S",
      "importance": "low",
      "score": 20.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2083",
      "rank": 587,
      "size": "S",
      "importance": "low",
      "score": 20.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2084",
      "rank": 588,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Auto-create lightweight conversation worktrees on project chats",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2085",
      "rank": 589,
      "size": "S",
      "importance": "low",
      "score": 19.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2091",
      "rank": 590,
      "size": "S",
      "importance": "low",
      "score": 19.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2195",
      "rank": 591,
      "size": "S",
      "importance": "low",
      "score": 19.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2210",
      "rank": 592,
      "size": "S",
      "importance": "low",
      "score": 19.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2211",
      "rank": 593,
      "size": "S",
      "importance": "low",
      "score": 19.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2212",
      "rank": 594,
      "size": "S",
      "importance": "low",
      "score": 19.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2308",
      "rank": 595,
      "size": "XL",
      "importance": "low",
      "score": 19.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for determinist",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2343",
      "rank": 596,
      "size": "S",
      "importance": "low",
      "score": 19.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2344",
      "rank": 597,
      "size": "S",
      "importance": "low",
      "score": 19.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] docs: refresh KANBAN-MODEL.md — update, harden, make useful",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2345",
      "rank": 598,
      "size": "S",
      "importance": "low",
      "score": 19.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] docs: refresh pan-done.md — update, harden, make useful",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2346",
      "rank": 599,
      "size": "S",
      "importance": "low",
      "score": 19.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2347",
      "rank": 600,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2348",
      "rank": 601,
      "size": "XL",
      "importance": "low",
      "score": 18.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2350",
      "rank": 602,
      "size": "XL",
      "importance": "low",
      "score": 18.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone",
      "rationale": "",
      "gate": "auto",
      "planning": "skip",
      "isEpic": false
    },
    {
      "issue": "PAN-2351",
      "rank": 603,
      "size": "S",
      "importance": "low",
      "score": 18.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats (security prerequisites)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2352",
      "rank": 604,
      "size": "S",
      "importance": "low",
      "score": 18.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2353",
      "rank": 605,
      "size": "S",
      "importance": "low",
      "score": 18.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2354",
      "rank": 606,
      "size": "S",
      "importance": "low",
      "score": 18.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2356",
      "rank": 607,
      "size": "S",
      "importance": "low",
      "score": 18.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2355",
      "rank": 608,
      "size": "S",
      "importance": "low",
      "score": 18.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2390",
      "rank": 609,
      "size": "L",
      "importance": "low",
      "score": 18.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set Man",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2392",
      "rank": 610,
      "size": "S",
      "importance": "low",
      "score": 18.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2394",
      "rank": 611,
      "size": "S",
      "importance": "low",
      "score": 18.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2399",
      "rank": 612,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2406",
      "rank": 613,
      "size": "S",
      "importance": "low",
      "score": 17.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown ab",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2409",
      "rank": 614,
      "size": "S",
      "importance": "low",
      "score": 17.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 clas",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2424",
      "rank": 615,
      "size": "XL",
      "importance": "low",
      "score": 17.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2442",
      "rank": 616,
      "size": "S",
      "importance": "low",
      "score": 17.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, tr",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2443",
      "rank": 617,
      "size": "S",
      "importance": "low",
      "score": 17.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/to",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2444",
      "rank": 618,
      "size": "XL",
      "importance": "low",
      "score": 17.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in,",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2487",
      "rank": 619,
      "size": "S",
      "importance": "low",
      "score": 17.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2491",
      "rank": 620,
      "size": "XL",
      "importance": "low",
      "score": 17.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2493",
      "rank": 621,
      "size": "S",
      "importance": "low",
      "score": 17.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2504",
      "rank": 622,
      "size": "S",
      "importance": "low",
      "score": 17.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2505",
      "rank": 623,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2507",
      "rank": 624,
      "size": "S",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2514",
      "rank": 625,
      "size": "S",
      "importance": "low",
      "score": 16.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2526",
      "rank": 626,
      "size": "XL",
      "importance": "low",
      "score": 16.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Refactor deacon.ts below file-size baseline",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2527",
      "rank": 627,
      "size": "S",
      "importance": "low",
      "score": 16.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Harness selector should restrict OpenAI models to Claude Code only",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2549",
      "rank": 628,
      "size": "XL",
      "importance": "low",
      "score": 16.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2600",
      "rank": 629,
      "size": "S",
      "importance": "low",
      "score": 16.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2622",
      "rank": 630,
      "size": "S",
      "importance": "low",
      "score": 16.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing inst",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2625",
      "rank": 631,
      "size": "S",
      "importance": "low",
      "score": 16.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty stat",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2626",
      "rank": 632,
      "size": "S",
      "importance": "low",
      "score": 16.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2629",
      "rank": 633,
      "size": "S",
      "importance": "low",
      "score": 16.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent s",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2628",
      "rank": 634,
      "size": "S",
      "importance": "low",
      "score": 16.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2630",
      "rank": 635,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2635",
      "rank": 636,
      "size": "S",
      "importance": "low",
      "score": 15.9,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] chore(server): pay down the 152-error src/dashboard/server typecheck debt",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2645",
      "rank": 637,
      "size": "M",
      "importance": "low",
      "score": 15.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add opt-in Observation-first conversation view",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2660",
      "rank": 638,
      "size": "M",
      "importance": "low",
      "score": 15.8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add safe Reset to planned action to the issue actions menu",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2662",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 15.7,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Add project context-menu actions scoped to issues currently in the pipeline",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2667",
      "rank": 640,
      "size": "M",
      "importance": "low",
      "score": 15.6,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2678",
      "rank": 641,
      "size": "S",
      "importance": "low",
      "score": 15.5,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outa",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2679",
      "rank": 642,
      "size": "S",
      "importance": "low",
      "score": 15.4,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2767",
      "rank": 643,
      "size": "S",
      "importance": "low",
      "score": 15.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Expose Codex app-server conversation controls in the dashboard",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2809",
      "rank": 644,
      "size": "S",
      "importance": "low",
      "score": 15.3,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik ",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2817",
      "rank": 645,
      "size": "S",
      "importance": "low",
      "score": 15.2,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] Idle-at-prompt work/review agents are never redriven: gpt-5.6-sol sessions stop at the composer mid-task and s",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2836",
      "rank": 646,
      "size": "XL",
      "importance": "low",
      "score": 15.1,
      "condition": "ok",
      "dependsOn": [],
      "why": "[item] okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "rationale": "",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    }
  ],
  "edges": [
    {
      "from": "PAN-2558",
      "to": "PAN-2860",
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
      "to": "PAN-2080",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2720",
      "to": "PAN-2189",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2720",
      "to": "PAN-2190",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2720",
      "to": "PAN-2233",
      "type": "unblocks",
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
      "to": "PAN-1775",
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
      "to": "PAN-570",
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
      "to": "PAN-1868",
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
      "to": "PAN-2079",
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
      "from": "PAN-2059",
      "to": "PAN-806",
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
      "from": "PAN-2079",
      "to": "PAN-2642",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-2079",
      "to": "PAN-1868",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-1650",
      "to": "PAN-2186",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-1650",
      "to": "PAN-2846",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-262",
      "to": "PAN-2186",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-262",
      "to": "PAN-2846",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-262",
      "to": "PAN-2324",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-2860",
      "to": "PAN-2558",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1966",
      "to": "PAN-2857",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1253",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2720",
      "to": "PAN-2189",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-2720",
      "to": "PAN-2190",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-2720",
      "to": "PAN-2233",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-806",
      "to": "PAN-807",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-2379",
      "to": "PAN-2421",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2379",
      "to": "PAN-2430",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    }
  ]
}
```
