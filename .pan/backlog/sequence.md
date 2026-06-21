# Backlog Sequence

_Last sequenced: 2026-06-21T20:45:10Z · model: glm-5.2 · open: 549_


| rank | issue | size | importance | condition | depends-on | why |
|------|-------|------|------------|-----------|------------|-----|
| 1 | PAN-1919 | L | critical | ok |  | In-review merge of dual continues→single git record; data-integrity core. Pinned in-pipeline. |
| 2 | PAN-1849 | M | critical | ok |  | Flywheel's first duty = fix red main; UAT/smoke catches UI regressions unit tests miss. Pinned. |
| 4 | PAN-1832 | M | high | ok |  | Role models with weighted multi-model distribution; spreads rate-limit risk across providers. Pinned. |
| 5 | PAN-1982 | M | high | ok |  | Revive convoy review as configurable opt-in (global/project/per-issue); quick stays default. Pinned. |
| 7 | PAN-1224 | M | high | ok |  | ship/close-out must restart the running dashboard so merged code goes live. Pinned bug. |
| 8 | PAN-1992 | M | high | ok |  | Migrate all panopticon.db references to overdeck.db across skills; re-verify. Pinned. |
| 9 | PAN-1903 | M | critical | ok |  | LIVE RED MAIN: create-beads bd-DB-init race (issue-beads-check failing on main right now). |
| 10 | PAN-806 | L | critical | ok | PAN-804 | Epic B: work agents must never touch git (pan work done owns rebase). Critical safety. |
| 11 | PAN-807 | L | critical | ok | PAN-804 | Epic C: pre-flight workspace sanity on spawn; stop hard-resetting local branches (data-loss risk). |
| 12 | PAN-804 | L | high | ok |  | Epic D: archaeological repo audit + pre-1.0 cleanup (dangling commits, branch drift). Execute FIRST. |
| 13 | PAN-1454 | L | high | ok |  | META: 9 systemic failure patterns from the 80-issue audit — substrate fixes to stop closed-but-not-shipped. |
| 14 | PAN-1936 | XL | critical | ok |  | Single source of truth: one canonical resolver per domain (consolidate the 8+ read paths). |
| 15 | PAN-1433 | M | critical | ok |  | Conversation agents leave host main repo in abandoned git rebase for hours (state corruption). |
| 16 | PAN-578 | L | critical | ok |  | Security: comment mediation layer to stop prompt injection via tracker comments (agents have shell). |
| 17 | PAN-1435 | M | high | ok |  | API keys stored plaintext in ~/.panopticon/config.yaml — leak via backups, containers, core dumps. |
| 18 | PAN-1508 | M | critical | ok |  | Immediate cleanup of safe post-merge feature-* workspaces (disk + state held indefinitely). |
| 19 | PAN-1506 | M | critical | ok |  | Strike agents missing from frontend store despite appearing in pan status (store/DB drift). |
| 20 | PAN-1510 | M | critical | ok |  | Newly-filed issues missing from frontend store (parallel to strike-agent invisibility). |
| 21 | PAN-1214 | M | critical | ok |  | Dashboard server crashes on UnhandledPromiseRejection when poking/killing dead agents (502). |
| 22 | PAN-1213 | M | critical | ok |  | Synthesis→review-status bridge broken: deacon resets review/test to pending after rebase, PR stranded. |
| 23 | PAN-1560 | M | high | ok |  | Re-review after PR head moves never re-posts panopticon/review status → PR BLOCKED forever. |
| 24 | PAN-1650 | L | high | ok |  | Split readyForMerge → gatesPassed (derived) + shipComplete; auto-dispatch ship on gates-green. |
| 25 | PAN-1864 | M | critical | ok | PAN-1861 | Review nudge insufficient: deacon must synthesize DETERMINISTICALLY, not wait on flaky nudges. |
| 26 | PAN-1861 | M | critical | ok |  | Convoy synthesis still wedges after PAN-1818 — parent stalls with sub-reviewers done. |
| 27 | PAN-1520 | L | high | ok |  | META: unified 'agent awaiting input' — finish AskUserQuestion (currently fabricates responses). |
| 28 | PAN-1594 | M | high | ok |  | Hook-driven agent readiness: kill 30s prompt-polling + permission-mode coupling (feedback dead-letters). |
| 29 | PAN-1901 | M | high | ok |  | merge.beads.driver never configured — PAN-1841 .gitattributes fix is inert; .beads still conflict-storms. |
| 30 | PAN-1770 | M | high | ok |  | pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed' every busy cycle. |
| 31 | PAN-1766 | M | high | ok |  | Work agents hang on Claude Code .claude/** settings-file protection — un-overridable by PreToolUse. |
| 32 | PAN-1725 | M | high | ok |  | Review role agents marked 'orphaned' after writing APPROVED outputs — operator sees false failures. |
| 33 | PAN-1207 | M | high | ok |  | Review sub-specialist panes exit cleanly but state.json stays 'running' — synthesis never fires. |
| 34 | PAN-1456 | L | high | needs-refinement |  | Pass-3 audit incomplete — fresh-context agent must finish re-auditing 75 of 80 closed issues. |
| 35 | PAN-1557 | L | high | ok |  | Interactive, attachable review convoy with hook-owned completion signalling. |
| 36 | PAN-1915 | M | high | ok | PAN-1435 | API key at-rest hardening: startup perm check + OS keychain + deprecate plaintext. Builds on chmod fix. |
| 37 | PAN-1226 | L | high | ok |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit). |
| 38 | PAN-1488 | S | high | ok |  | Add required_pull_request_reviews to main branch protection (merge-gate integrity). |
| 39 | PAN-1556 | M | medium | ok |  | Coalesce review-spawn spam in session/activity feed; supersede re-reviews; keep conversations recent. |
| 40 | PAN-1865 | L | high | needs-refinement |  | Make Kimi runnable on claude-code harness — root-cause the CLIProxy 200k-context illusion. |
| 41 | PAN-1873 | M | high | ok |  | verifying_on_main tagged at first merge, never cleared on re-active issues — queue never drains. |
| 42 | PAN-1720 | M | medium | ok |  | Cloister auto-resume tests fail under full parallel run, pass in isolation (test pollution family). |
| 43 | PAN-630 | XL | high | ok |  | Multi-tenant workspace isolation with ACLs (foundational for shared/multi-user Panopticon). |
| 44 | PAN-262 | L | high | ok |  | Refactor post-merge lifecycle into composable, idempotent operations. |
| 45 | PAN-1498 | M | high | ok | PAN-1454 | Substrate (pattern 1): require a live-code-path trace per AC in requirements review. |
| 46 | PAN-1499 | M | high | ok | PAN-1454 | Substrate (pattern 2): block pan done if close-out defers work without a follow-up issue. |
| 47 | PAN-1618 | M | high | ok |  | Work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when stack down. |
| 48 | PAN-1193 | M | high | ok |  | Swarm: no slot-to-slot file coordination — slots independently produce overlapping/conflicting work. |
| 49 | PAN-1195 | M | medium | ok |  | Swarm: parent work agent goes silent during swarm dispatch — no progress signal. |
| 50 | PAN-1196 | L | high | ok |  | Workhorse routing by bead difficulty + subject-matter (single-issue slot ensemble). |
| 51 | PAN-1198 | M | high | ok |  | Workspace init container's bun install doesn't populate the container-node-modules named volume. |
| 52 | PAN-1246 | L | high | ok |  | Perf: projection-cached VCS driver for diff/checkpoint reads (Effect migration unblocks this). |
| 53 | PAN-1253 | M | high | ok | PAN-1246 | Flywheel: respect issue dependencies before autopicking work (don't start blocked work). |
| 54 | PAN-1254 | M | medium | ok |  | Tailscale integration: advertise dashboard + workspace endpoints over the tailnet. |
| 55 | PAN-1311 | M | medium | ok |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items (~12x speedup proven). |
| 56 | PAN-1313 | L | high | ok |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync compatibility surfaces. |
| 57 | PAN-1357 | L | medium | ok |  | Template conversations: load curated skill bundles into a single conversation. |
| 58 | PAN-1424 | L | high | ok |  | Model pool dispatch + work.* subtype taxonomy (multi-provider load distribution). |
| 59 | PAN-1452 | M | medium | ok |  | Per-reviewer restart with model override (architectural mismatch with PAN-1048 fan-out). |
| 60 | PAN-1525 | M | medium | ok |  | Composer autocomplete: auto-generate from CLI tree so every pan command + flag is discoverable. |
| 61 | PAN-1538 | M | medium | ok |  | Unblock Pi source forks — remove the claude-code-only API guard, verify Pi transcript parsers. |
| 62 | PAN-1558 | M | medium | ok |  | Review/specialist agents should run in the workspace Docker container, not inherit host override. |
| 63 | PAN-1561 | XL | high | ok |  | Project-scoped dashboard nav: deck of tabs per project + conversations/tree column + activity feed. |
| 64 | PAN-1578 | XL | high | ok |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code/Pi/Codex). |
| 65 | PAN-1588 | M | medium | ok |  | PAN-800 Phase 5: eliminate the last pane-scrape thinking-detection sites (capture-pane stuck detection). |
| 66 | PAN-1767 | M | medium | ok |  | Surface 'awaiting close-out' (verifying-on-main) count in flywheel stats, pan status, dashboard headline. |
| 67 | PAN-1776 | L | high | ok |  | Hot-updatable delivery path: version-stamped PTY supervisors, rolling refresh, dumb-shim primitives. |
| 68 | PAN-1791 | XL | high | needs-refinement |  | Tiered execution: difficulty-routed bead dispatch + event-driven supervisor review. |
| 69 | PAN-1852 | L | high | ok |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from eval data. |
| 70 | PAN-1491 | M | medium | ok |  | Flywheel: metric-aware prioritization — weight substrate-bug suggestions by which v1.0 criterion they hit. |
| 71 | PAN-1142 | M | medium | ok |  | Add reasoning effort level to per-role / per-conversation model config (effort is task-dependent). |
| 72 | PAN-1913 | M | medium | ok |  | Project description field: show on click, edit in dashboard, mirror into the project context layer. |
| 73 | PAN-1544 | S | medium | ok |  | Type cleanup: strip vestigial 'ship' from the Role union and its ~10 downstream references. |
| 74 | PAN-1217 | M | medium | ok |  | Requirements reviewer: classify each AC as in-PR-scope vs whole-feature-scope; only block in-scope. |
| 75 | PAN-1218 | S | medium | ok |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode. |
| 76 | PAN-1219 | M | medium | ok |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) not prompt-derived. |
| 77 | PAN-1497 | S | low | ok |  | Flywheel: emit TTS announcements on lifecycle events (start, pause, resume, report). |
| 78 | PAN-605 | M | medium | ok |  | Reconcile CLAUDE.md prompt assembly across all agent types (dead template system, missing context). |
| 79 | PAN-1263 | M | medium | ok |  | Swarm UX: surface per-slot identity + multi-slot navigation in pipeline rows and IssueDrawer. |
| 80 | PAN-1444 | M | medium | ok |  | Dashboard port lockfile + pan doctor multi-instance check (follow-up to PAN-1416). |
| 81 | PAN-1461 | M | medium | ok |  | Conversation transcript: Ctrl+F only finds text in currently-rendered virtualized rows. |
| 82 | PAN-955 | M | medium | ok |  | Workspace devcontainer template versioning + re-render on demand (stale workspace detection). |
| 83 | PAN-113 | M | medium | ok |  | Dashboard 'Start Agent' returns success before verifying the agent actually started. |
| 84 | PAN-1504 | M | medium | ok |  | pan hygiene — codify the merge/commit/push state audit as a first-class CLI verb + skill + docs. |
| 85 | PAN-813 | S | low | ok |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution. |
| 86 | PAN-49 | M | low | ok |  | Fix CloisterService tests that require a real runtime (refactor to timer/tmux abstractions). |
| 87 | PAN-1209 | S | medium | ok |  | PAN-1052 bead projection disagrees with bd state |
| 88 | PAN-1130 | S | medium | ok |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 89 | PAN-1131 | S | medium | ok |  | Stale idle synthesis session blocks review re-dispatch (idempotency guard can't tell 'reviewing' from 'finished-idle') |
| 90 | PAN-1830 | S | medium | ok |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 91 | PAN-1862 | L | medium | ok |  | feat(review): cache-sharing review convoy — warm-parent fork, model-uniformity guard, and resumable selective re-review |
| 92 | PAN-244 | S | medium | ok |  | Deep-wipe leaves local branch and worktree metadata behind |
| 93 | PAN-245 | S | medium | ok |  | Ctrl+C aborts planning dialog instead of copying text |
| 94 | PAN-247 | S | medium | ok |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 95 | PAN-304 | S | medium | ok |  | closeLinearDirect returns stepOk even when state update never happens |
| 96 | PAN-321 | S | medium | ok |  | Ephemeral merge specialist fails silently for polyrepo MYN projects |
| 97 | PAN-324 | S | medium | ok |  | Agent detail pane missing Merge/Approve button |
| 98 | PAN-334 | S | medium | ok |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 99 | PAN-538 | L | medium | ok |  | npm run build sometimes skips Vite frontend rebuild |
| 100 | PAN-673 | M | medium | ok |  | fix(dashboard): virtualizer inline ref causes blank conversation page on large message lists |
| 101 | PAN-681 | S | medium | ok |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 102 | PAN-886 | S | medium | ok |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 103 | PAN-890 | S | medium | ok |  | Conflict-resolver agent merges stale main snapshot and never pushes |
| 104 | PAN-899 | S | medium | ok |  | Agent CLI commands fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE |
| 105 | PAN-900 | S | medium | ok |  | Trust devroot for conversations + atomic .claude.json writes |
| 106 | PAN-928 | S | medium | ok |  | verification-runner: polyrepo workspaces fail at sync-target-branch |
| 107 | PAN-929 | S | medium | ok |  | review-run: polyrepo workspaces detect overlay repo instead of code repos |
| 108 | PAN-932 | S | medium | ok |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 109 | PAN-933 | S | medium | ok |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 110 | PAN-1027 | S | medium | ok |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 111 | PAN-1038 | S | medium | ok |  | Conversation diff panel always empty: conv.claudeSessionId is null for all conversations |
| 112 | PAN-1042 | S | medium | ok |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 113 | PAN-1068 | S | medium | ok |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 114 | PAN-1113 | S | medium | ok |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 115 | PAN-1128 | S | medium | ok |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 116 | PAN-1129 | S | medium | ok |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 117 | PAN-1149 | S | medium | ok |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 118 | PAN-1150 | S | medium | ok |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 119 | PAN-1173 | S | medium | ok |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 120 | PAN-1227 | L | medium | ok |  | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 121 | PAN-1232 | S | medium | ok |  | PAN-1148 follow-up — IssueDrawer 6 tabs as placeholders + title font + header structure + stream colors |
| 122 | PAN-1234 | S | medium | ok |  | PAN-1148 follow-up — cross-cutting (Space Grotesk / keyboard shortcuts / /issues/:id route / INPUT badge / pulse keyframe / conformance... |
| 123 | PAN-1240 | S | medium | ok |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 124 | PAN-1243 | S | medium | ok |  | pan admin hooks install: resolver fails outside repo CWD (auto-config breaks flywheel resume) |
| 125 | PAN-1247 | S | medium | ok |  | Substrate: deacon orphan-test recovery loops dispatch_failed forever on an unhealthy workspace docker stack |
| 126 | PAN-1258 | S | medium | ok |  | Swarm slot spawn hangs silently before writeLauncherScriptAtomic when model=kimi-k2.6 |
| 127 | PAN-1330 | S | medium | ok |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 128 | PAN-1336 | S | medium | ok |  | Swarm: pan swarm --auto-advance cannot advance — no slot-PR merger, slots never self-terminate |
| 129 | PAN-1386 | S | medium | ok |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 130 | PAN-1392 | S | medium | ok |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 131 | PAN-1416 | S | medium | ok |  | Workspace-spawned dashboard servers can bind the main pan.localhost port and hijack the canonical dashboard |
| 132 | PAN-1434 | S | medium | ok |  | conv-find.py reports session_file: N/A for newer conversation records (wrong column) |
| 133 | PAN-1438 | S | medium | ok |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 134 | PAN-1439 | S | medium | ok |  | Recover conv-2084's in-progress PANOPTICON_PROJECT_ROOT env var work |
| 135 | PAN-1440 | S | medium | ok |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 136 | PAN-1445 | L | medium | ok |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 137 | PAN-1446 | L | medium | ok |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 138 | PAN-1447 | S | medium | ok |  | PAN-1194 follow-up: restore failed-merge slot UI deleted by sibling PAN-1148 merge |
| 139 | PAN-1449 | S | medium | ok |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 140 | PAN-1472 | S | medium | ok |  | Swarm inspect agents emit pan tell to parent agent ID — fails when only slot agents exist |
| 141 | PAN-1530 | S | medium | needs-refinement |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 142 | PAN-1559 | S | medium | ok |  | Orphaned inspect sessions: live tmux panes with no state.json escape all reapers |
| 143 | PAN-1564 | M | medium | ok |  | Pi extension path + dashboard server spawn both depend on launch cwd (fix: resolve against packageRoot + pin spawn cwd) |
| 144 | PAN-1565 | S | medium | ok |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 145 | PAN-1570 | S | medium | ok |  | Cost recorder silently dropped ALL cost events since 2026-05-21 (Effect-migration regression) |
| 146 | PAN-1571 | S | medium | ok |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N lin... |
| 147 | PAN-1582 | S | medium | ok |  | Handoff fork falls back to summary: external authoring session stalls on Write permission |
| 148 | PAN-1624 | S | medium | ok |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 149 | PAN-1637 | S | medium | ok |  | Conversation resume reattaches to a keep-alive corpse (no harness-liveness probe) |
| 150 | PAN-1638 | S | medium | ok |  | Conversation DB status stays 'active' after the harness process dies |
| 151 | PAN-1652 | S | medium | ok |  | Conversation title regeneration 500s on large transcripts — claude title invocation times out at 30s |
| 152 | PAN-1673 | S | medium | ok |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 153 | PAN-1674 | S | medium | ok |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 154 | PAN-1681 | M | medium | ok |  | bug(pipeline): test agents narrate 'tests pass' but never run pan specialists done test → strand at test=pending; no test-completion fa... |
| 155 | PAN-1682 | M | medium | ok |  | bug(dashboard): strike agents missing from Command Deck issue tree — resource-discovery.ts:471 tmux-prefix allowlist omits 'strike-' (9... |
| 156 | PAN-1688 | S | medium | ok |  | System Briefing: 'Cost today' card always $0.00 — reads orphaned cost-monitor.dailyTotal instead of cost_events |
| 157 | PAN-1689 | S | medium | ok |  | System Briefing: 'Paused / troubled' card inflated ~8x (~185 vs real ~24) by stale stopped sub-agent tombstones |
| 158 | PAN-1718 | S | medium | ok |  | Duplicate successful 'pan reload' restart-status writes from two unidentified concurrent processes |
| 159 | PAN-1722 | S | medium | ok |  | Awareness rail activity entries don't survive page load — snapshot doesn't seed recentActivity, only live events accumulate |
| 160 | PAN-1781 | S | medium | ok |  | Context-overflow recovery: claude --resume bypasses panopticon-native compact boundaries (~50% of the time) — compaction is a silent no... |
| 161 | PAN-1789 | S | medium | ok |  | Conversation status shows 'ended' for a live codex-harness handoff session |
| 162 | PAN-1790 | S | medium | ok |  | pan handoff: focus text without conv id mis-parses as conversation; help string missing codex; 500-char focus limit undocumented |
| 163 | PAN-1793 | S | medium | ok |  | pan handoff kickoff message is not delivered to pi-harness conversations |
| 164 | PAN-1795 | S | medium | ok |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 165 | PAN-1816 | S | medium | ok |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + aut... |
| 166 | PAN-1817 | S | medium | ok |  | Linear API quota exhausted by IssueDataService polling (2500/hr ceiling hit, 84+ poll errors) — regression of the pre-safeguard tracker... |
| 167 | PAN-1823 | S | medium | ok |  | Linear polling is not rate-limit-aware — no 429 backoff (secondary to PAN-1817) |
| 168 | PAN-1824 | S | medium | ok |  | Flaky main CI: real-timer integration tests time out (~5s) on loaded runners — fork recovery, rollout-JSONL, heartbeat, conversation-ro... |
| 169 | PAN-1827 | S | medium | ok |  | Conversation view blank for pi-harness sessions — resolver handles claude-code and codex only (flywheel orchestrator affected) |
| 170 | PAN-1828 | S | medium | ok |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 171 | PAN-1833 | S | medium | ok |  | Pi spawn checks pi-extension via process.cwd() — 'Pi extension not built' when pan start/strike is run from any non-repo-root dir |
| 172 | PAN-1850 | S | medium | ok |  | Conversation transcripts >10MB are truncated by the initial-read cap (missing-middle live view) |
| 173 | PAN-1893 | M | medium | ok |  | bug(cli): pan start STILL crashes toUpperCase after sync-main conflict for gpt-5.5/claude-code agent state — PAN-1872 fix incomplete (P... |
| 174 | PAN-1897 | M | medium | ok |  | bug(cli): pan start workspace-prep hangs/times out (>120s) on re-entry — blocks PAN-1711, PAN-1827 (no spawn, no error) |
| 175 | PAN-1900 | M | medium | ok |  | bug(flywheel): UAT candidate branch codename is non-deterministic — proliferates a new uat/* branch per assembly cycle (3 for 0614) |
| 176 | PAN-1912 | S | medium | ok |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 177 | PAN-1956 | S | medium | ok |  | bug: GLM-5.2 and GLM-5.1: contextWindow set to output cap (should be input context); also verify pricing + text-only image handling |
| 178 | PAN-1993 | S | medium | ok |  | Planning a freshly-created issue 404s (start-planning races GitHub issue propagation) |
| 179 | PAN-1994 | M | medium | ok |  | bug(pipeline): fresh plan --auto issue inherits another issue's merged/verifying-on-main/paused state (PAN-1982 got PAN-1866's) |
| 180 | PAN-1998 | S | medium | ok |  | Remodel cleanup: drop orphan observation_index + reset_markers tables from the overdeck.db migration (LOW) |
| 181 | PAN-2001 | M | medium | ok |  | bug(pipeline): re-running `pan plan` on an already-planned issue phantom-merges it (merged/verifying-on-main + review_status=merged, no... |
| 182 | PAN-1889 | L | medium | ok |  | feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run |
| 183 | PAN-1436 | S | medium | ok |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 184 | PAN-1711 | S | medium | ok |  | Dashboard event loop stalls 15-25s under load — watchdog force-restarted it 3x in 45 min |
| 185 | PAN-1769 | S | medium | ok |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil... |
| 186 | PAN-1451 | S | low | ok |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 187 | PAN-1888 | M | low | ok |  | chore(hooks): work-agent-stop-hook still reads legacy review-status.json — finish the PAN-1883 SQLite-truth migration |
| 188 | PAN-838 | S | low | ok |  | synthesis.json contains hallucinated timestamp + sparse structure (only counts, no findings arrays) |
| 189 | PAN-1066 | S | low | ok |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 190 | PAN-1126 | L | low | ok |  | Integrate TLDR summaries into review context manifest |
| 191 | PAN-1533 | S | low | ok |  | Fork-into-worktree from conversation branch chip |
| 192 | PAN-1696 | S | low | ok |  | feat: decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view |
| 193 | PAN-1775 | L | low | ok |  | feat(dashboard): remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility reads as 'no agent' |
| 194 | PAN-2005 | S | low | ok |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 195 | PAN-2006 | S | low | ok |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 196 | PAN-37 | L | medium | ok |  | Support external PR selection for merge-agent |
| 197 | PAN-38 | L | medium | ok |  | Support multiple merge agents per repository |
| 198 | PAN-77 | S | medium | ok |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 199 | PAN-111 | L | medium | ok |  | Support cross-machine planning state sync without cross-contamination |
| 200 | PAN-243 | S | medium | ok |  | Audit dashboard actions: ensure all are available via CLI |
| 201 | PAN-252 | S | medium | ok |  | Disable Sync with Main button when workspace is up to date |
| 202 | PAN-255 | S | medium | ok |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 203 | PAN-258 | S | medium | ok |  | Kanban board: fit all columns without horizontal scrolling |
| 204 | PAN-277 | S | medium | ok |  | Session reasoning capture & collaborative PRD refinement |
| 205 | PAN-293 | S | medium | ok |  | Project Living Memory — per-project semantic memory for agents |
| 206 | PAN-294 | S | medium | ok |  | Surface module initialization errors as system-level, not per-issue |
| 207 | PAN-1469 | S | medium | ok |  | End-to-end review and consolidation of all project documentation |
| 208 | PAN-1494 | M | medium | ok |  | chore(docs): register docs/FLYWHEEL-VISION on panopticon-cli.com (Mintlify) — needed for public sharing |
| 209 | PAN-450 | S | medium | ok |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 210 | PAN-452 | S | medium | ok |  | Conversation input bar — mode/permissions/workspace selectors |
| 211 | PAN-454 | S | medium | ok |  | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 212 | PAN-456 | S | medium | ok |  | Store Claude Code session IDs for agent resume after crash/restart |
| 213 | PAN-463 | L | medium | ok |  | Add Qwen 3.6+ model support |
| 214 | PAN-465 | L | medium | ok |  | Add OpenRouter as a model provider |
| 215 | PAN-466 | L | medium | ok |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 216 | PAN-531 | L | medium | ok |  | PAN: Windows Electron support (WSL2 required) |
| 217 | PAN-546 | S | medium | ok |  | Remove claude-code-router — all providers use direct env var injection |
| 218 | PAN-548 | S | medium | ok |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 219 | PAN-1684 | L | medium | ok |  | docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 220 | PAN-606 | S | medium | ok |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 221 | PAN-607 | S | medium | ok |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 222 | PAN-608 | L | medium | ok |  | Integrate Destructive Command Guard (dcg) with configurable settings |
| 223 | PAN-613 | S | medium | needs-refinement |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 224 | PAN-629 | S | medium | ok |  | Workspace quotas and resource governance |
| 225 | PAN-637 | S | medium | ok |  | Direct issue kickoff (skip planning) from dashboard UI |
| 226 | PAN-649 | S | medium | ok |  | Render Excalidraw drawings inline in Claude Code conversations |
| 227 | PAN-654 | S | medium | ok |  | Project Setup Wizard — Dashboard UI |
| 228 | PAN-675 | S | medium | ok |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 229 | PAN-678 | S | medium | ok |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 230 | PAN-687 | L | medium | ok |  | Support OpenCode as alternative coding agent |
| 231 | PAN-783 | XL | medium | ok |  | Agents Page Redesign — Unified Multi-View Experience |
| 232 | PAN-818 | S | medium | ok |  | Make summary optional when forking conversations |
| 233 | PAN-901 | L | medium | ok |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 234 | PAN-902 | L | medium | ok |  | Settings: add 'Run pan sync' button to configuration menu |
| 235 | PAN-903 | S | medium | ok |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 236 | PAN-938 | S | medium | ok |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 237 | PAN-947 | S | medium | ok |  | feat: project management actions in unified sidebar |
| 238 | PAN-949 | L | medium | ok |  | feat: add conversation for project from sidebar |
| 239 | PAN-958 | L | medium | ok |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 240 | PAN-1037 | S | medium | ok |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 241 | PAN-1060 | S | medium | ok |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 242 | PAN-1102 | L | medium | ok |  | feat(dashboard): real-time notification + interactive prompts when agent awaits user input |
| 243 | PAN-1151 | S | medium | ok |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 244 | PAN-1164 | S | medium | ok |  | Push diff summary updates over /ws/rpc instead of 5s polling |
| 245 | PAN-1165 | S | medium | ok |  | Lightweight review path for small/trivial PRs |
| 246 | PAN-1202 | S | medium | ok |  | Swarm: prune merged/completed slot state directories after wave converges |
| 247 | PAN-1223 | S | medium | ok |  | Auto-update for users in the field (npm + desktop binaries) |
| 248 | PAN-1432 | S | medium | ok |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 249 | PAN-1437 | S | medium | ok |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 250 | PAN-1442 | S | medium | ok |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 251 | PAN-1443 | L | medium | ok |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 252 | PAN-1453 | S | medium | ok |  | Audit: 3 cheap verifications that should ride along with merges (PAN-1170, PAN-1316, PAN-457 CLI parity) |
| 253 | PAN-1473 | L | medium | ok |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 254 | PAN-1485 | S | medium | ok |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 255 | PAN-1489 | XL | medium | ok |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 256 | PAN-1490 | L | medium | ok |  | feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 257 | PAN-1524 | S | medium | ok |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 258 | PAN-1542 | S | medium | ok |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 259 | PAN-1545 | L | medium | ok |  | feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 260 | PAN-399 | S | medium | ok |  | Release specialist — coordinated post-merge rollout and release safety |
| 261 | PAN-1577 | S | medium | ok |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 262 | PAN-1610 | S | medium | ok |  | Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards, IssueDrawer) |
| 263 | PAN-1623 | S | medium | ok |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 264 | PAN-532 | S | medium | ok |  | Per-project and per-issue model overrides for workflow agent model selection |
| 265 | PAN-1653 | L | medium | ok |  | perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 266 | PAN-1654 | L | medium | ok |  | perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 267 | PAN-1655 | S | medium | ok |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 268 | PAN-1656 | S | medium | ok |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 269 | PAN-1657 | S | medium | ok |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 270 | PAN-1666 | S | medium | ok |  | [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out |
| 271 | PAN-1671 | L | medium | ok |  | feat(dashboard): surface pending ExitPlanMode plan as a popup modal (reuse PlanCard + /plan-action) |
| 272 | PAN-1672 | S | medium | ok |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 273 | PAN-1676 | L | medium | ok |  | feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 274 | PAN-1685 | S | medium | ok |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 275 | PAN-1837 | L | medium | ok |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 276 | PAN-1838 | L | medium | ok |  | [research] Grok Build (xAI) coding harness — research and specify support |
| 277 | PAN-1839 | S | medium | ok |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 278 | PAN-1840 | L | medium | ok |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 279 | PAN-1844 | S | medium | ok |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 280 | PAN-1853 | S | medium | ok |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 281 | PAN-1854 | S | medium | ok |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 282 | PAN-1916 | L | medium | ok |  | feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 283 | PAN-1955 | S | medium | ok |  | Issue cockpit: move beads from a tab into a persistent right rail with a 'working now' highlight |
| 284 | PAN-1965 | S | medium | ok |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 285 | PAN-1966 | S | medium | ok |  | Single authoritative pipeline-membership resolver — one function for "what's in the pipeline" (collapse the 5 divergent views) |
| 286 | PAN-1967 | L | medium | ok |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 287 | PAN-1968 | S | medium | ok |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 288 | PAN-1985 | S | medium | ok |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 289 | PAN-1991 | XL | medium | ok |  | Issue cockpit redesign — incremental rollout (tracking) |
| 290 | PAN-1995 | S | medium | ok |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 291 | PAN-2004 | S | medium | ok |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 292 | PAN-43 | L | low | ok |  | Add Slack and email notifications for agent events |
| 293 | PAN-44 | S | low | ok |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 294 | PAN-47 | S | low | ok |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 295 | PAN-51 | S | low | ok |  | Documentation: Clarify issue tracker options beyond Linear |
| 296 | PAN-52 | S | low | ok |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 297 | PAN-54 | L | low | ok |  | feat: Add pan test:e2e command for full workflow integration test |
| 298 | PAN-55 | S | low | ok |  | Track specialist costs with time period filtering |
| 299 | PAN-817 | S | medium | ok |  | Improve planning dialog layout and content fit |
| 300 | PAN-104 | S | low | ok |  | Cost alerts/notifications when spending exceeds thresholds |
| 301 | PAN-106 | S | low | ok |  | Cost prediction/estimation for in-progress work |
| 302 | PAN-924 | S | medium | ok |  | Spike: evaluate GitNexus for Panopticon integration |
| 303 | PAN-1040 | L | medium | ok |  | feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 304 | PAN-1041 | S | medium | ok |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 305 | PAN-146 | S | low | ok |  | PAN-146: Refine light mode theming across all dashboard pages |
| 306 | PAN-155 | XL | low | ok |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 307 | PAN-175 | S | low | ok |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 308 | PAN-176 | S | low | ok |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 309 | PAN-177 | S | low | ok |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 310 | PAN-178 | S | low | ok |  | PAN-178: Crash recovery with granular task checkpointing |
| 311 | PAN-180 | S | low | ok |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 312 | PAN-190 | S | low | ok |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 313 | PAN-633 | L | low | ok |  | Update Cloister PRD and docs index — stale relative to implementation |
| 314 | PAN-634 | S | low | ok |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 315 | PAN-198 | S | low | ok |  | Structured audit trail for agent actions |
| 316 | PAN-1103 | L | medium | ok |  | feat(dashboard): surface AskUserQuestion choice options in conversation view |
| 317 | PAN-674 | L | low | ok |  | docs: add glossary of Panopticon domain terms |
| 318 | PAN-227 | L | low | ok |  | Phase gate validation — mid-implementation acceptance checks |
| 319 | PAN-228 | S | low | ok |  | Shift-left post-edit diagnostics — type check after every edit |
| 320 | PAN-241 | XL | low | ok |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 321 | PAN-249 | L | low | ok |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 322 | PAN-265 | S | low | ok |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 323 | PAN-271 | S | low | ok |  | Auto-assign Linear project from project config when creating issues |
| 324 | PAN-283 | S | low | ok |  | Reset should sync workspace feature branch with latest main |
| 325 | PAN-297 | S | low | ok |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 326 | PAN-298 | S | low | ok |  | Auto-detect package manager and runtime in workspace setup |
| 327 | PAN-299 | S | low | ok |  | Granular session state persistence across context compaction |
| 328 | PAN-306 | M | low | ok |  | fix: merge-agent polyrepo false failures — stale refs, wrong error field, short timeout |
| 329 | PAN-371 | S | low | ok |  | Agents tab only shows global specialists, not per-project ephemeral ones |
| 330 | PAN-1474 | L | low | ok |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 331 | PAN-1555 | S | low | ok |  | Docs: remove/update stale swarm-runtime references after PAN-1517 |
| 332 | PAN-407 | S | low | ok |  | Run Panopticon from a main workspace for development isolation |
| 333 | PAN-438 | L | low | ok |  | Migrate remaining REST polling endpoints to Effect RPC |
| 334 | PAN-459 | S | low | ok |  | Planning setup screen with SSE progress streaming |
| 335 | PAN-461 | S | low | ok |  | Deep-wipe multi-step progress dialog |
| 336 | PAN-468 | S | low | ok |  | Agent test conversations pollute production database — need test isolation |
| 337 | PAN-471 | S | low | ok |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 338 | PAN-472 | S | low | ok |  | GET /api/costs/by-issue takes 10s — N+1 query on 353K rows × 184 issues |
| 339 | PAN-476 | S | low | ok |  | Agent resume with Haiku session summary instead of claude --resume |
| 340 | PAN-480 | S | low | ok |  | Pass --effort flag when spawning planning agents via Cloister |
| 341 | PAN-483 | S | low | ok |  | Unify Resume Agent UX — all entry points should show message input |
| 342 | PAN-487 | S | low | ok |  | VBRIEF not archived to docs/prds/completed/ after merge |
| 343 | PAN-543 | L | low | ok |  | Add confirmation dialog before applying Optimal Defaults |
| 344 | PAN-552 | S | low | ok |  | Claude Code terminals should respect app light/dark mode scheme |
| 345 | PAN-554 | L | low | ok |  | Add kanban board deeplinks for issue URLs |
| 346 | PAN-564 | S | low | ok |  | Slash menu positioned incorrectly — cut off / off-screen |
| 347 | PAN-565 | S | low | ok |  | Handle CTRL-Z to undo accidental conversation archival |
| 348 | PAN-568 | S | low | ok |  | Kanban: Show workspace and tmux session counts in stats |
| 349 | PAN-570 | S | low | ok |  | Show PLAN badge on costs when under a subscription/plan |
| 350 | PAN-571 | L | low | ok |  | Add OpenRouter credits/plan status endpoint and UI |
| 351 | PAN-576 | S | low | ok |  | Global / search should include conversations in addition to workspace features |
| 352 | PAN-589 | S | low | ok |  | Review and update commands-skills.md with all available Panopticon skills |
| 353 | PAN-591 | L | low | ok |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 354 | PAN-1683 | S | low | ok |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling o... |
| 355 | PAN-603 | S | low | ok |  | Plan review loop with configurable reviewer model |
| 356 | PAN-604 | S | low | ok |  | Hide planning agent from workspace detail pane |
| 357 | PAN-622 | S | low | ok |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 358 | PAN-623 | S | low | ok |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 359 | PAN-624 | S | low | ok |  | Loop nodes: iterative agent execution with conditional termination |
| 360 | PAN-656 | S | low | ok |  | Docs site scroll broken: dashboard CSS leaks onto panopticon-cli.com |
| 361 | PAN-658 | S | low | ok |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 362 | PAN-660 | S | low | ok |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 363 | PAN-663 | S | low | ok |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 364 | PAN-683 | M | low | ok |  | fix(tests): shadow-state getPendingSyncCount test is environment-dependent |
| 365 | PAN-701 | S | low | ok |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 366 | PAN-702 | L | low | ok |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 367 | PAN-709 | L | low | ok |  | feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 368 | PAN-727 | S | low | ok |  | Fix orphaned work-agent start handoff after planning |
| 369 | PAN-730 | L | low | ok |  | Add provider account telemetry for credits, balances, and usage |
| 370 | PAN-735 | S | low | ok |  | Settings page: review and configure overridden subagent model files |
| 371 | PAN-736 | S | low | ok |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 372 | PAN-738 | L | low | ok |  | Add right-click fork option to conversation list |
| 373 | PAN-743 | L | low | ok |  | Add consistent new conversation icon actions in Command Deck |
| 374 | PAN-747 | S | low | ok |  | Conversation list items lack accessible labels in accessibility tree |
| 375 | PAN-749 | S | low | ok |  | Research and borrow best features from gstack |
| 376 | PAN-750 | XL | low | ok |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 377 | PAN-751 | S | low | ok |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 378 | PAN-752 | L | low | ok |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 379 | PAN-762 | S | low | ok |  | Settings: warn when model overrides target disabled providers |
| 380 | PAN-764 | L | low | ok |  | Add quota/usage inspector for routed model providers |
| 381 | PAN-765 | S | low | ok |  | Preserve trailing zeros in cost displays |
| 382 | PAN-769 | S | low | ok |  | Track verification/review/test phase churn over time |
| 383 | PAN-771 | S | low | needs-refinement |  | Investigate Vercel Sandbox execution backend support |
| 384 | PAN-772 | S | low | ok |  | Unify terminal stack behavior across tmux sessions |
| 385 | PAN-773 | S | low | ok |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 386 | PAN-774 | XL | low | ok |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 387 | PAN-775 | XL | low | ok |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 388 | PAN-777 | S | low | ok |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 389 | PAN-778 | S | low | ok |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 390 | PAN-780 | S | low | ok |  | Agent stuck in feedback loop when old feedback files exist but review has passed |
| 391 | PAN-786 | S | low | ok |  | Post planning Q\&A answers as issue comment |
| 392 | PAN-790 | S | low | ok |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 393 | PAN-791 | S | low | ok |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 394 | PAN-793 | S | low | ok |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 395 | PAN-797 | S | low | ok |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 396 | PAN-810 | S | low | ok |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 397 | PAN-832 | S | low | ok |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 398 | PAN-833 | S | low | ok |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 399 | PAN-834 | S | low | ok |  | Cleanup: legacy ~/.panopticon/heartbeats/ directory has not been written since 2026-04-22 |
| 400 | PAN-835 | S | low | ok |  | Workspace creation removes stale .planning/ from previous issue but doesn't commit deletion → PR diff includes 982 unrelated lines |
| 401 | PAN-853 | S | low | ok |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 402 | PAN-898 | S | low | ok |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 403 | PAN-904 | S | low | ok |  | Make AI title generation model configurable |
| 404 | PAN-908 | S | low | ok |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 405 | PAN-927 | S | low | ok |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 406 | PAN-943 | L | low | ok |  | Add memory file review and management command |
| 407 | PAN-944 | S | low | ok |  | Make vBRIEF the durable task graph source of truth |
| 408 | PAN-948 | L | low | ok |  | Implement pan scope lifecycle commands |
| 409 | PAN-961 | S | low | ok |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 410 | PAN-962 | S | low | ok |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 411 | PAN-984 | S | low | ok |  | Evaluate context-mode MCP server as session continuity + search layer |
| 412 | PAN-1049 | S | low | ok |  | Spike: evaluate Tauri v2 desktop shell |
| 413 | PAN-1051 | S | low | ok |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 414 | PAN-1063 | S | low | ok |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 415 | PAN-1064 | S | low | ok |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 416 | PAN-1065 | S | low | ok |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 417 | PAN-1101 | S | low | ok |  | Permission safety hardening: CI guard, single emission chokepoint, property tests, runtime tripwire |
| 418 | PAN-1115 | S | low | ok |  | Inject observation context into agent prompts |
| 419 | PAN-1116 | S | low | ok |  | Memory: cross-project search mode |
| 420 | PAN-1117 | S | low | ok |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 421 | PAN-1121 | S | low | ok |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 422 | PAN-1122 | S | low | ok |  | Trim OpenAI model catalog to 5 supported models |
| 423 | PAN-1123 | L | low | ok |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 424 | PAN-1124 | S | low | ok |  | Decouple specs and PRDs from workspaces — write directly to main |
| 425 | PAN-1133 | S | low | ok |  | TLDR: deacon supervision + pan doctor check + GC |
| 426 | PAN-1135 | S | low | ok |  | Document the hook system in docs/HOOKS.md |
| 427 | PAN-1136 | S | low | ok |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 428 | PAN-1147 | S | low | ok |  | Work-agent done flow stalls at 'push and re-request review' after addressing review feedback |
| 429 | PAN-1152 | S | low | ok |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 430 | PAN-1153 | S | low | ok |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 431 | PAN-1154 | S | low | ok |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 432 | PAN-1166 | S | low | ok |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 433 | PAN-1208 | L | low | ok |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 434 | PAN-1222 | S | low | ok |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 435 | PAN-1238 | S | low | ok |  | Board view follow-up — + New issue column footer button (deferred from PAN-1229) |
| 436 | PAN-1242 | S | low | ok |  | Board view follow-up — + New issue column footer button (deferred from PAN-1229) |
| 437 | PAN-1244 | S | low | ok |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 438 | PAN-1245 | S | low | ok |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 439 | PAN-1325 | S | low | ok |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 440 | PAN-1356 | S | low | ok |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 441 | PAN-1479 | L | low | ok |  | RTK: Add telemetry to measure token savings from bash output compression |
| 442 | PAN-1480 | S | low | ok |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 443 | PAN-1481 | L | low | ok |  | Add cost-event telemetry for Caveman token savings |
| 444 | PAN-1482 | S | low | ok |  | Token spend report should aggregate data from repo, not just local machine |
| 445 | PAN-1483 | S | low | ok |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 446 | PAN-1493 | S | low | ok |  | TEST: write hello.txt — probe for PAN-1200 Universal Context System verification |
| 447 | PAN-1547 | M | low | ok |  | fix: @panctl/cli npm install warns on Node <22 (engine mismatch + deprecated deps) |
| 448 | PAN-1548 | M | low | ok |  | fix: npx @panctl/cli shows stale placeholder message referencing v0.8.0 |
| 449 | PAN-1550 | L | low | ok |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 450 | PAN-1552 | S | low | ok |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 451 | PAN-1553 | L | low | needs-refinement |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 452 | PAN-1572 | S | low | ok |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 453 | PAN-1573 | S | low | ok |  | Consideration for reintroducing ability to --dangerously-skip-permissions, DO NOT act on this issue |
| 454 | PAN-1581 | S | low | ok |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 455 | PAN-1592 | S | low | ok |  | Composer: make pasted images reload-durable (persist across page reload, not just conversation switches) |
| 456 | PAN-1619 | S | low | ok |  | Bridge host Codex auth into workspace containers + honest gpt-5.5 lock reason |
| 457 | PAN-1620 | S | low | ok |  | Awaiting-Merge button is clickable on a conflicting/CI-failing PR (stale blockerReasons) |
| 458 | PAN-1621 | S | low | ok |  | pan close human-only gate over-blocks operator conv-* sessions |
| 459 | PAN-1622 | S | low | ok |  | pan dev restart leaves orphan dashboard servers (stale serving + multi-Deacon risk) |
| 460 | PAN-1627 | S | low | ok |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr... |
| 461 | PAN-537 | S | low | ok |  | feat: show changed files diff summary after each agent response in activity view |
| 462 | PAN-1640 | S | low | ok |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 463 | PAN-1641 | L | low | ok |  | Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness |
| 464 | PAN-1643 | L | low | ok |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 465 | PAN-1644 | S | low | ok |  | Hook-driven progressive conversation titling |
| 466 | PAN-1646 | S | low | ok |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 467 | PAN-1667 | L | low | ok |  | feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 468 | PAN-1668 | M | low | ok |  | bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 469 | PAN-1669 | M | low | ok |  | bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 470 | PAN-1670 | M | low | ok |  | bug(dev): pan dev hot-reload wedges tabs on 'Reconnecting to the dashboard…' — PAN-1580 boot watchdog never fires under Vite |
| 471 | PAN-592 | S | low | ok |  | Audit: Planning agent CLAUDE.md and STATE.md contents vs expectations |
| 472 | PAN-1691 | L | low | ok |  | feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 473 | PAN-1705 | M | low | ok |  | bug(dashboard): conversation click stuck on Loading… for minutes during pipeline load — fat-poll request queueing collapse |
| 474 | PAN-1706 | M | low | ok |  | bug(agents): orphaned playwright-mcp headless Chromiums keep full dashboard pages open — each multiplies dashboard poll load |
| 475 | PAN-1708 | M | low | ok |  | bug(lifecycle): pan start CLI never flips spec plan.status proposed→approved — all 8 in-flight specs stuck at proposed, triggering reco... |
| 476 | PAN-1710 | M | low | ok |  | bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — serv... |
| 477 | PAN-1726 | M | low | ok |  | bug(lifecycle): postMergeLifecycle did not pause the merged issue's work agent — idle agent holds a work slot and throttles all pipelin... |
| 478 | PAN-1728 | M | low | ok |  | bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 479 | PAN-1729 | M | low | ok |  | test(beads): beads-scoping work.md "-l {{ISSUE_ID_LOWER}}" label-filter assertion fails on main |
| 480 | PAN-1730 | M | low | ok |  | bug(governor): idle awaiting-test work sessions count against the PAN-1665 ceiling — pipeline livelocks when work pool alone exceeds to... |
| 481 | PAN-1734 | M | low | ok |  | fix(test): request-review-nudge remote workspace HEAD test fails on main |
| 482 | PAN-1735 | L | low | ok |  | feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 483 | PAN-1739 | M | low | ok |  | bug(dashboard): Command Deck issue TREE still hides strike agents — frontend FeatureItem session-type allowlist omits 'strike' (4th all... |
| 484 | PAN-1740 | S | low | ok |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 485 | PAN-646 | L | low | ok |  | Canceled issues: add guided Recover workflow |
| 486 | PAN-1748 | L | low | ok |  | feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 487 | PAN-1750 | L | low | ok |  | feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 488 | PAN-1751 | L | low | ok |  | feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 489 | PAN-1754 | L | low | ok |  | feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 490 | PAN-1755 | M | low | ok |  | bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 491 | PAN-1758 | M | low | ok |  | bug(cloister): ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; readyForMerge only ever flips ... |
| 492 | PAN-1761 | M | low | ok |  | bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ... |
| 493 | PAN-1762 | S | low | ok |  | Swarm v2: tracer-bullet planning contract (Path A) + foreman-driven intra-issue swarms (Path B) |
| 494 | PAN-1773 | S | low | ok |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 495 | PAN-1774 | M | low | ok |  | bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 496 | PAN-1782 | S | low | ok |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 497 | PAN-1846 | M | low | ok |  | bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 498 | PAN-700 | S | low | ok |  | Detachable terminal for conversation view — popout into OS window |
| 499 | PAN-1868 | S | low | ok |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 500 | PAN-713 | L | low | ok |  | test: add unit tests for doneCommand and approveCommand |
| 501 | PAN-1874 | L | low | ok |  | feat(review): per-issue override for review mode / re-review scope (extends PAN-1862 project-scope config) |
| 502 | PAN-1875 | L | low | ok |  | feat(flywheel): add `pan flywheel stop` — graceful shutdown that writes the report |
| 503 | PAN-1879 | M | low | ok |  | bug(restart): pan restart silently re-applies stale boot gates; no way to re-enable deacon/resume (asymmetric flags) |
| 504 | PAN-1878 | S | low | ok |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 505 | PAN-1882 | M | low | ok |  | bug(strike): strike workspaces never cleaned up — worktrees + branches pile up forever (27 / 16GB observed) |
| 506 | PAN-1894 | S | low | ok |  | Show UAT stack startup state in issue tree and issue slide-out |
| 507 | PAN-1895 | S | low | ok |  | Spawn work agents from issue workspace slide-out |
| 508 | PAN-1896 | S | low | ok |  | Reduce approval friction for GitHub CLI operations in managed sessions |
| 509 | PAN-1906 | S | low | ok |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 510 | PAN-1907 | S | low | ok |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every... |
| 511 | PAN-1909 | M | low | ok |  | bug(planning): pan plan done handoff tail hangs (dashboard-notify/transition) — declares 'done' with spec only on local main |
| 512 | PAN-1910 | S | low | ok |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 513 | PAN-1914 | S | low | ok |  | Follow-up: move /api/health/agents off agent-directory scans |
| 514 | PAN-1917 | XL | low | ok |  | /sessions page redesign: unify with conversation view |
| 515 | PAN-1918 | M | low | ok |  | bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang sta... |
| 516 | PAN-1926 | L | low | ok |  | feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 517 | PAN-1927 | M | low | ok |  | fix(config): remove hardcoded model fallbacks — default/role model must come from explicit settings |
| 518 | PAN-1928 | S | low | ok |  | Lock model switching to brand-new conversations only (0 messages) — never for agents or started sessions |
| 519 | PAN-1929 | S | low | ok |  | hazard(auto-commit): background git rebase rewrites history in the SHARED primary worktree — stop mutating the shared tree |
| 520 | PAN-1931 | L | low | ok |  | complete-planning force-adds gitignored .pan/ state via 'git add -f' (regresses PAN-1215, violates PAN-1819) |
| 521 | PAN-1932 | S | low | ok |  | Schema migration downgrades user_version when DB is newer than code (=== SCHEMA_VERSION should be >=) |
| 522 | PAN-1934 | S | low | ok |  | hazard: verification gate drives agents through up to 10 retry cycles on an unfixable check (no operator escalation, invisible burn) |
| 523 | PAN-1935 | S | low | ok |  | pi/kimi work-agent cost not recorded in cost_events → runaway spend is invisible (no cost-based safety possible) |
| 524 | PAN-1937 | S | low | ok |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 525 | PAN-1949 | S | low | ok |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all bead verdicts |
| 526 | PAN-1951 | S | low | ok |  | Inspector agent should resume a warm session instead of cold-spawning a new one per bead |
| 527 | PAN-1953 | S | low | ok |  | Design: beads rail mockup |
| 528 | PAN-1954 | S | low | ok |  | Beads rail: move beads to right sidebar, highlight active work |
| 529 | PAN-1958 | S | low | ok |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 530 | PAN-1963 | L | low | ok |  | Default to no-resume on dashboard boot; add 'Resume all' to the stopped-agents banner |
| 531 | PAN-1980 | S | low | ok |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 532 | PAN-1983 | S | low | ok |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 533 | PAN-1984 | L | low | ok |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 534 | PAN-1986 | S | low | ok |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 535 | PAN-1987 | S | low | ok |  | Allow renaming a registered project (display name is locked at registration) |
| 536 | PAN-1988 | S | low | ok |  | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 537 | PAN-1989 | S | low | ok |  | Replace Pi harness with ohmypi and evaluate advanced features |
| 538 | PAN-1990 | S | low | ok |  | First-class workspaces and projects with per-workspace memory |
| 539 | PAN-1999 | S | low | ok |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 540 | PAN-2002 | L | low | ok |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 541 | PAN-2007 | S | low | ok |  | Temporary: keep specialist (review/test/ship) sessions alive through the pipeline — disable PAN-1716 reaper + done-path kill |
| 542 | PAN-2008 | L | low | ok |  | feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 543 | PAN-2009 | M | low | ok |  | bug(pi): dead pi agent can't be resumed — ready.json 30s timeout + PAN-1980 blocks fresh-launch → review stuck stopped |
| 544 | PAN-802 | S | low | ok |  | Resume on conversation session forks instead of resuming |
| 545 | PAN-826 | L | low | ok |  | Conversation/terminal integration refactor: instant-start + parser correctness + T3Code structural alignment |
| 546 | PAN-863 | S | low | ok |  | Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees) |
| 547 | PAN-1857 | M | high | stale |  | bug(ci): main RED — verification-gate.test.ts asserts stale 'src/dashboard/frontend' in DEFAULT_GATES.test after generic-command change... |
| 548 | PAN-1859 | M | high | stale |  | bug(ci): main RED — agent-spawning.test.ts 'resumeAgent delivers continue prompt through Pi FIFO' fails (writePiCommand not called) |
| 549 | PAN-1880 | M | high | stale |  | bug(ci): main RED — start-sync-main-conflict.test.ts hits process.exit(1) under CI single-fork (maxForks:1) cross-file mock pollution; ... |
| 550 | PAN-1698 | M | medium | stale |  | bug(ci): main is RED — model-count + schema-version + substrate-smoke test expectations stale (blocks every verify/ship/strike gate) |
| 551 | PAN-1783 | M | medium | stale |  | bug(ci): main is RED — Command Deck resource-strip Playwright fixture still expects old workspace title |

## Rationale detail

### PAN-1919 (rank 1)

Pinned in-pipeline (in-review). Consolidating the dual 'continues' + state.json harness/model into one git-tracked record is the highest-leverage data-integrity change in flight — it is the substrate every resume/recovery path depends on. It has a PRD, is ready, and is actively under review, so it sits at the top of the active tier; the sequencer pins it verbatim and only refreshes live state.

### PAN-1849 (rank 2)

Pinned in-pipeline (verifying-on-main). This is the policy that makes a red main the flywheel's #1 priority and adds a browser smoke signal for frontend runtime regressions that backend tests miss — exactly the class that poisoned main recently. Already merged and verifying; pinned so the sequencer never reshuffles it.

### PAN-1832 (rank 4)

Pinned in-pipeline (in-review, ready). Multi-model role pools spread rate-limit/vendor risk and enable A/B model routing per role — directly unlocks cheaper-model dispatch work downstream. Actively in review; pinned.

### PAN-1982 (rank 5)

Pinned in-pipeline (ready). Restores multi-reviewer convoy review behind a config flag so operators get deeper review when they want it while quick-review stays the default. Ready and in the pipeline; pinned.

### PAN-1224 (rank 7)

Pinned in-pipeline (verifying-on-main). Bug: merged code wasn't actually live because ship/close-out never restarted the dashboard — a trust-eroding gap between 'merged' and 'working'. Merged and verifying; pinned.

### PAN-1992 (rank 8)

Pinned in-pipeline (verifying-on-main). Rename fallout: every skill/db reference to the old 'panopticon.db' name must move to 'overdeck.db' so the rename is consistent end-to-end. Merged and verifying; pinned.

### PAN-1903 (rank 9)

Main CI is currently RED — the only failing test is issue-beads-check.test.ts, the same bd-DB-init 'table not found: issues' race family PAN-1903 root-causes. A red main empties the merge gate (every PR inherits the failing check), so this single flake blocks ALL shipping. PAN-1903 has a precise root cause (bd lazy-init races the first bd call) and a scoped fix (deterministic test DB init before the body runs). Highest-leverage unblock on the board.

### PAN-806 (rank 10)

Critical architecture epic. Work agents attempting manual rebases caused a destructive `mv .pan .claude /tmp` incident (PAN-698). The fix — strip git/rebase instructions from work prompts, own all git in `pan work done`, add shell hooks blocking destructive ops in workspaces — removes a loaded gun. Depends on Epic D (PAN-804) cleanup first.

### PAN-807 (rank 11)

Critical architecture epic. The spawn flow hard-reset a feature branch to a 2-day-old commit then committed planning artifacts — a loaded gun that would orphan unpushed work. Pre-flight checks (fetch, compare local vs remote, abort if local ahead) make the pattern unreachable. Depends on Epic D.

### PAN-804 (rank 12)

Critical architecture epic, explicitly the FIRST to execute (unblocks Epics A/B/C). Cleans dangling commits, orphan branches, unpushed work, and main/origin drift so 1.0 ships on known-good state. Pre-flight cleanup with no production code changes; the foundation the other stabilization epics build on.

### PAN-1454 (rank 13)

A behavior-verified audit found 39% of 80 closed issues needed action (7 not delivered, 19 missing AC items). This META catalogues 9 failure patterns (silent miss, transparent deferral, scope-creep stubs, test-plan skip…) and seeds the focused substrate fixes (PAN-1498/1499/1500/1501). High-leverage: prevents the entire class of 'closed but not actually shipped' regressions.

### PAN-1936 (rank 14)

Encodes the 'one read door, one write door' tenet as concrete work. The same fact is read from 8+ endpoints and written from 100+ call sites with nothing enforcing agreement — the root cause of recurring state/pipeline corruption. Consolidating to one canonical resolver per domain makes drift structurally impossible. Foundational; high blast radius.

### PAN-1433 (rank 15)

Critical: a conversation agent left the host's main checkout mid-rebase with conflicts for hours — the running dashboard was built from the broken intermediate state, so 'merged' code wasn't live. Git-state corruption of the shared primary worktree bypasses every pipeline safety. Must bound/halt conversation-agent git operations on the host.

### PAN-578 (rank 16)

Critical security. Agents have full host shell access and ingest raw tracker comments into their prompt context — a malicious comment can inject arbitrary shell commands (exfiltration, deletion). Already exploitable today via getTrackerContext at spawn/resume. A mediation/quarantine layer for untrusted comment text is a pre-1.0 must-have given agents run destructive ops.

### PAN-1435 (rank 17)

Security: every provider key sits plaintext in config.yaml (0644 historically). Leaks via dotfile backups/sync, container mounts, compromised agents, and crash dumps. chmod was just tightened (PAN-1915 builds further), but plaintext-at-rest remains the core risk. OS-keychain integration is the real fix.

### PAN-1508 (rank 18)

Critical substrate bug. Post-merge workspaces linger — each holds disk (node_modules), feature branches, paused agent state dirs, and tmux RAM. Misfire dispatch paths then spawn roles onto already-merged issues, burning slots against the concurrency governor. Immediate safe cleanup of merged workspaces reclaims resources and closes the misfire surface.

### PAN-1506 (rank 19)

Critical substrate bug. Strike agents show in `pan status` but not in the dashboard frontend store — the store/DB has drifted from live state, so the operator can't see or manage strikes that are actually running. Same single-source-of-truth family as PAN-1936/1510.

### PAN-1510 (rank 20)

Critical substrate bug. Newly-filed issues don't appear in the frontend store — the dashboard and live state disagree, so the operator's view is stale the moment they file work. Same read-door drift family; blocks trust in the dashboard as a source of truth.

### PAN-1214 (rank 21)

Critical availability bug. pokeAgent/killAgent wrap async runtime methods in sync try/catch that can't catch the async rejection → UnhandledPromiseRejection crashes the whole dashboard server (502 from Traefik, port 3011 drops). A single dead-agent poke takes down the entire UI. Straightforward fix (await the promise / handle rejection).

### PAN-1213 (rank 22)

Critical pipeline bug. After a ship rebase the deacon patrol resets review+test to 'pending', normalizeReviewStatus clears readyForMerge, and the MERGE button never appears even though everything passed end-to-end. Work that's genuinely done can't merge — directly stalls the pipeline.

### PAN-1560 (rank 23)

High-impact pipeline bug. The GitHub status post is gated on a readyForMerge false→true transition; a re-review that re-passes on a NEW head SHA is a no-op, so branch protection keeps the PR BLOCKED forever (status absent on the new commit). Requires admin override to merge. Status post must key off head SHA, not the transition.

### PAN-1650 (rank 24)

Architectural. readyForMerge is one boolean wearing two hats (quality-gates-green AND ship-rebased-verified), and it only flips via poller/recovery — never event-driven. A PR that genuinely passed sits unmergeable until a poller notices. Splitting into a derived gatesPassed + shipComplete and dispatching ship on gates-green removes a whole class of stuck-at-the-gate stalls.

### PAN-1864 (rank 25)

Critical convoy-revival bug. The review 'nudge' to fire synthesis is unreliable, so a passed review never synthesizes and the PR stalls. The deacon must drive synthesis deterministically from state rather than depending on a nudge succeeding. Builds on PAN-1861 (synthesis wedge); together they fix the convoy-stall class.

### PAN-1861 (rank 26)

Critical convoy-revival bug. Even after PAN-1818, convoy synthesis wedges: all sub-reviewers finish but the parent review session sits idle and no verdict posts, leaving the PR mergeStateStatus BLOCKED with empty reviewDecision. Directly stalls the review pipeline.

### PAN-1520 (rank 27)

META consolidating the 'agent awaiting input' subsystem. The dangerous piece: AskUserQuestion is counted for the badge but its options aren't rendered and the orchestrator fabricates option #1 as the tool_result — the agent silently acts on a made-up answer. Must build the relay (mirror PermissionRequest) and kill the auto-default. Also unifies ExitPlanMode/EnterPlanMode.

### PAN-1594 (rank 28)

waitForReadySignal always times out (30s) for default agents — ready.json is never written and the pane-scrape fallback keys off bypass-permissions strings that never render. Every feedback-delivery resume reports messageDelivered:false and dumps the feedback into a mail/ dead-letter queue the agent never reads. Moving readiness to a hook (Pi already writes ready.json) fixes an entire class of 'agent never got the message' stalls.

### PAN-1901 (rank 29)

PAN-1841 declared `.beads/issues.jsonl merge=beads` in .gitattributes but nobody configures merge.beads.driver, so git ignores the attribute and falls back to conflict merge. The .beads/.pan conflict-storms the fix targeted are STILL happening on sync-main. Configuring the driver (or shipping one) makes the declared merge strategy actually take effect.

### PAN-1770 (rank 30)

During convoy bursts the auto-committer commits .pan dirt, but running agents re-dirty .pan/continues between its commit and `git pull --rebase`, so rebase refuses with unstaged changes — recurring error, main carries unpushed state, and humans on the primary worktree hit 'cannot pull: unstaged changes'. Fix: commit-until-clean before rebasing.

### PAN-1766 (rank 31)

Class-2 split from PAN-1616. Claude Code's settings-file protection for .claude/** is a gate distinct from tool permissions and can't be auto-approved by the PreToolUse hook, so any work agent editing .claude/rules/*.md hangs indefinitely (~90 min frozen, heartbeat still 'active'). Legitimate on-task work deadlocks.

### PAN-1725 (rank 32)

Review agents for PAN-1704 wrote a complete APPROVED synthesis but Cloister classified them stopped/orphaned (tmux session missing) instead of completed — the operator sees failures for work that succeeded. Orphan-detection must honor a successful written artifact before flagging failure.

### PAN-1207 (rank 33)

Convoy sub-specialists run to completion, write reports, exit 0 — but state.json keeps reporting status=running, so the synthesis trigger never fires and no verdict posts (PR BLOCKED forever). The exit→state transition is broken; same convoy-stall family as 1861/1864.

### PAN-1456 (rank 34)

A deep audit found Pass 1/2 (Opus subagents) systematically accepted proxy evidence — 60% miss rate on the small re-audit sample (e.g. archived-conversations UI hardcodes limit=50 so 659 of 709 rows invisible). Pass-3 (GPT-5.5 + Playwright, strict original-AC) methodology works but only 5 of 80 are re-audited; 75 remain. Needs a fresh-context continuation per the HANDOFF doc — flagged needs-refinement because it's a scoped continuation, not a normal feature.

### PAN-1557 (rank 35)

Restores convoy reviewers as interactive, attachable tmux sessions (not headless `claude --print`) so operators can watch/interact, with completion signalling moved to the Stop-hook (hook owns the signal, not the agent). Consolidates a cluster of review-lifecycle bugs stemming from the headless/eager-reap design.

### PAN-1915 (rank 36)

The larger hardening around PAN-1435: startup permission checks, OS keychain (libsecret/Keychain) integration, and deprecating plaintext. The chmod fix already landed; this completes the at-rest security story. Depends on the plaintext-keys issue being addressed.

### PAN-1226 (rank 37)

A two-pass audit of the unified dashboard redesign found 32 gaps across 6 surfaces — data-binding, tab content, keyboard nav, typography, routing. The shell/primitives landed well; the binding/detail layers have the bulk of the gaps. Closing them delivers the dashboard the PRD promised.

### PAN-1488 (rank 38)

Without required_pull_request_reviews on main branch protection, the merge gate can be bypassed. A small, high-integrity settings change that hardens the one-way door of landing on main.

### PAN-1556 (rank 39)

The activity feed is dominated by review-spawn noise — ~11 entries per review cycle (per spawnRun event) with no coalescing/supersede, burying the conversations that matter. Adding coalescing + per-issue supersede makes the feed useful again.

### PAN-1865 (rank 40)

Critical, hard. Kimi on claude-code deadlocks because CLIProxy advertises a false ~200k window; long sessions sail past it (the '200k-window illusion'). A $22 silent burn and a stranded critical red-main strike both came from this trap. Needs root-causing the CLIProxy window advertisement; flagged needs-refinement because the fix path is genuinely open (may require CLIProxy-side changes).

### PAN-1873 (rank 41)

Bug: verifying_on_main is set at first merge but never cleared on re-activation, so re-opened issues keep a stale label and the close-out queue never drains correctly. A label-lifecycle bug that inflates the 'awaiting close-out' surface.

### PAN-1720 (rank 42)

Same cross-file test-pollution family as the red-main CI bugs: cloister auto-resume tests pass in isolation but fail under the full parallel suite. Risks reddening main under load; fix the isolation leak rather than serializing.

### PAN-630 (rank 43)

Foundational architecture for any multi-user/shared Panopticon: per-tenant workspace isolation with ACLs. Large and forward-looking, but it's the precondition for several collaboration features and for safely opening the dashboard beyond a single operator.

### PAN-262 (rank 44)

The post-merge lifecycle (close-out, verify-on-main, workspace cleanup, branch delete) is a tangle of non-idempotent steps that re-running partially can corrupt. Refactoring into composable idempotent operations makes recovery safe and is a substrate for PAN-1508/1873.

### PAN-1498 (rank 45)

PAN-1454 pattern 1 (silent miss): code lands in the wrong file/path so behavior is unchanged. Fix: the requirements reviewer must emit a live code-path trace (file+function+how input reaches it) per AC and BLOCK if it can't. Catches the 'shipped artifact that doesn't actually wire up' class.

### PAN-1499 (rank 46)

PAN-1454 pattern 2 (transparent deferral): close-out says 'will do X later' but no follow-up issue is filed and the original closes. Fix: pan done scans for deferral language and refuses unless a follow-up PAN-NNNN is linked or the AC list is amended. Stops silent scope drops.

### PAN-1618 (rank 47)

Under autonomous operation, pan start fails hard when the workspace docker stack is down and both recoveries (rebuild, --host) are manual — so a fully-planned proposed item sits at the gate forever. The flywheel needs autonomous stack recovery so proposed work can actually start.

### PAN-1193 (rank 48)

Swarm slots branch independently with no file-overlap arbitration: two slots can create the same file, the first merges, the second is permanently conflicted and its work is lost; auto-advance waits on ALL slots so the whole swarm stalls. Needs per-bead files_scope enforcement and/or wave gating by dependency.

### PAN-1195 (rank 49)

During swarm dispatch the parent work agent goes silent with no progress signal, so the operator can't tell dispatch is healthy. A swarm-observability gap.

### PAN-1196 (rank 50)

Route swarm beads to the right model by difficulty/subject so a cheap model does trivial beads and a frontier model handles hard ones — the throughput lever the PAN-1249 migration proved (~12x). Foundational for cost-effective swarms.

### PAN-1198 (rank 51)

The init container reports '1230 packages installed' but the named volume is empty (0 entries), so the server fails at startup with 'Cannot find package effect'. Workspaces can't come up healthy; blocks container-isolated work.

### PAN-1246 (rank 52)

A projection-cached VCS driver replaces repeated git diff/checkpoint shelling with cached reads — a broad perf win across review/verify/merge paths. Depends on the src/lib Effect migration slices landing.

### PAN-1253 (rank 53)

The flywheel picks by P-level and ignores declared dependencies — it would autopick downstream work whose deps aren't done, wasting capacity on code that immediately needs rework. Must consult the dependency graph (bd ready already excludes blocked) before picking.

### PAN-1254 (rank 54)

Publishes the dashboard (and workspace services) over Tailscale so the operator can reach them from any device on the tailnet without router config/DNS/relays. Effect-native port of a proven reference implementation; high operator-convenience.

### PAN-1311 (rank 55)

The PAN-1249 migration proved direct parallel Agent-tool batches run ~12x faster than slot machinery for mechanical work. A fast-track tier that routes trivial mechanical beads to direct batches (amortizing slot setup) is a major throughput win for migration/refactor swarms.

### PAN-1313 (rank 56)

The canonical issue for finishing the src/lib Effect migration: PAN-1249 shipped it as an additive bridge, but legacy Promise/sync surfaces remain, so the migration isn't complete until the bridge is removed or deliberately retained. Unblocks Effect-native follow-ons (perf, routing).

### PAN-1357 (rank 57)

Lets a conversation/agent start with a curated skill bundle (including non-globally-synced third-party skills) loaded for that one session — solves the all-or-nothing pan sync problem where ~60 skills spend every session's context budget. Good UX/lever.

### PAN-1424 (rank 58)

Per-role model pools (round-robin/weighted/rate-limit-aware) for spreading rate-limit risk and A/B'ing models, plus a work.* subtype taxonomy. Follow-up to the catalog trim; needs its own planning cycle. Pairs with PAN-1832.

### PAN-1452 (rank 59)

PAN-1381 shipped Restart but per-reviewer restart is architecturally impossible post PAN-1048 (single review run fans out 4 reviewers) — clicking 'restart correctness on Haiku' restarts all 4 on Haiku. Needs per-sub-reviewer model override that fits the fan-out shape.

### PAN-1525 (rank 60)

The composer's slash-command list is hand-maintained and incomplete (missing pan handoff, fork, conversations subtree; no consistent flags). Auto-generating from the CLI command tree makes every command+flag discoverable and stays correct as the CLI grows.

### PAN-1538 (rank 61)

Pi conversations can't be forked (summary/handoff) due to a harness!=='claude-code' guard. Removing it (after verifying Pi JSONL transcript parsers) unlocks Pi summary/handoff forks. Scoped and well-specified.

### PAN-1558 (rank 62)

Reviewers inherit allowHost from the work agent and the flywheel hardcodes allowHost:true, so flywheel-driven work silently forces every reviewer onto the host instead of the workspace container. Decouple the blanket override so isolation is the default.

### PAN-1561 (rank 63)

Makes the project the unit you work in: selecting a project opens a deck of scoped tabs with a conversations+issue-tree column and activity feed. Large UX restructure with a full PRD; high operator-value for multi-project use.

### PAN-1578 (rank 64)

Adds GitHub Copilot CLI as a full harness peer — native AGENTS.md/SKILL.md/MCP, defaults to Sonnet, no ToS bar. A Copilot-subscription user could run a first-party GitHub agent loop on Claude without an Anthropic subscription/CLIProxy. Large; needs the gating-risk evaluation first.

### PAN-1588 (rank 65)

Removes the last capture-pane stuck-detection sites (parseThinkingDuration, isAgentActiveInTmux) that were missed in the earlier PAN-800 pass — brittle status-line scraping that only matched a few spinner words and couldn't parse hour-scale durations. Replacement is already hook-based; this deletes the dead/brittle code.

### PAN-1767 (rank 66)

The merged-but-not-closed-out queue reached 21 deep with no first-class surface. Beyond visibility, merged-unclosed issues hold resources and are a misfire-dispatch surface. Surfacing the count everywhere closes the measurement gap.

### PAN-1776 (rank 67)

The PTY supervisor is pinned per session — a supervisor bugfix doesn't reach running agents until respawn, and nothing can tell which sessions run stale supervisors. Version-stamping + rolling refresh + server-side delivery makes supervisor fixes take effect live. PRD'd.

### PAN-1791 (rank 68)

Ambitious: a cheap durable foreman runs the bead loop; standing tier agents (cheap→frontier) kept warm by a plan-filtered commit feed step in per bead; a frontier supervisor reviews at commit boundaries. Live evidence (PAN-1788) shows frontier-quality at a fraction of cost. Potentially a differentiator — flagged needs-refinement because the architecture is large and unproven at scale.

### PAN-1852 (rank 69)

Route each work-agent issue to the cheapest capable model using benchmark-anchored eval data instead of one fixed model — a small fix runs on a small model. PRD'd; major cost lever and pairs with the model-pool/tiering cluster.

### PAN-1491 (rank 70)

Once substrate-bug provenance/telemetry (#1487) ships, the flywheel can weight suggestions by which v1.0 criterion is under threat rather than P-level+age alone. Compounding leverage for hitting v1.0 thresholds. Depends on the now-closed telemetry prerequisite being exercised.

### PAN-1142 (rank 71)

Effort plumbing today is gemini_thinking_level + a conversation-only localStorage picker; roles can't select effort and defaults vary silently across harnesses. A proper config surface + launcher matrix makes effort consistent and lets cheap tasks run at low effort. Benchmarks show effort is task-dependent, so this is real leverage.

### PAN-1913 (rank 72)

Adds a human-readable description to ProjectConfig, editable from the dashboard, mirrored into the project layer (.pan/context/project.md) via pan sync. Also lifts the REPO-ARTIFACTS docs to the Mintlify site. Well-scoped; improves multi-project orientation.

### PAN-1544 (rank 73)

PAN-1531 removed ship-role spawn machinery but kept 'ship' in the Role union for backward compat with old state.json. Nothing creates ship-role agents anymore — the type is vestigial noise. Small, mechanical type cleanup.

### PAN-1217 (rank 74)

The requirements reviewer treats the whole vBRIEF AC list as in-scope per PR (180 ACs, 19 partial blockers on one PR). Classifying each AC against the PR diff stops asking the current PR to fix the whole feature; cuts synthesis-scrub noise.

### PAN-1218 (rank 75)

Bead inspection adds 3-5 min/bead; Check 3 (compile+smoke) passed in 100% of blocked cases so it never produces the verdict. Dropping it, restricting to foundation beads, and end-of-batch mode cut the cost while keeping the value.

### PAN-1219 (rank 76)

Synthesis derives 'prior cycle SHA' by reading the second-newest review dir — fragile. Persisting cycle state as structured data (cycle.json) gives reliable SHA access and structured prior-findings, so convergence gating is sound.

### PAN-1497 (rank 77)

Operator monitoring a long flywheel run needs audible lifecycle transitions without staring at the dashboard. TTS is already wired; just emit events on start/pause/resume/finalize. Small, nice-to-have.

### PAN-605 (rank 78)

Audit found two parallel template systems (one active, one dead/zero-references) and missing architectural context causing agent confusion. Reconciling assembly so every agent type gets consistent, correct context removes a class of agent mistakes.

### PAN-1263 (rank 79)

When a swarm dispatches N slots the dashboard shows N identical 'Work (sonnet)' rows — can't tell slots apart, see what each does, or interact with slots 2..N. Surfacing per-slot identity (bead name) makes swarms operable.

### PAN-1444 (rank 80)

PAN-1416 shipped the cwd guard but not the port lockfile or pan doctor check — observed two dashboards coexisting on 3011. A real lockfile + PID heartbeat + doctor check is defense-in-depth against dueling dashboards.

### PAN-1461 (rank 81)

Browser Ctrl+F can't find text in unmounted virtualized transcript rows, so searching for an earlier error/file appears to find nothing. Needs an in-page search that scans the full transcript, not just the viewport.

### PAN-955 (rank 82)

When the devcontainer template changes, existing workspaces are pinned to the old render with no warning/migration (observed: api service bound to no port because cmd was stale). Versioning + stale detection + re-render keeps workspaces current.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-06-21T20:45:10Z",
  "model": "glm-5.2",
  "pass": "incremental",
  "openCount": 549,
  "nodes": [
    {
      "issue": "PAN-1919",
      "rank": 1,
      "size": "L",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "In-review merge of dual continues→single git record; data-integrity core. Pinned in-pipeline.",
      "rationale": "Pinned in-pipeline (in-review). Consolidating the dual 'continues' + state.json harness/model into one git-tracked record is the highest-leverage data-integrity change in flight — it is the substrate every resume/recovery path depends on. It has a PRD, is ready, and is actively under review, so it sits at the top of the active tier; the sequencer pins it verbatim and only refreshes live state.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1849",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel's first duty = fix red main; UAT/smoke catches UI regressions unit tests miss. Pinned.",
      "rationale": "Pinned in-pipeline (verifying-on-main). This is the policy that makes a red main the flywheel's #1 priority and adds a browser smoke signal for frontend runtime regressions that backend tests miss — exactly the class that poisoned main recently. Already merged and verifying; pinned so the sequencer never reshuffles it.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1832",
      "rank": 4,
      "size": "M",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role models with weighted multi-model distribution; spreads rate-limit risk across providers. Pinned.",
      "rationale": "Pinned in-pipeline (in-review, ready). Multi-model role pools spread rate-limit/vendor risk and enable A/B model routing per role — directly unlocks cheaper-model dispatch work downstream. Actively in review; pinned.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1982",
      "rank": 5,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Revive convoy review as configurable opt-in (global/project/per-issue); quick stays default. Pinned.",
      "rationale": "Pinned in-pipeline (ready). Restores multi-reviewer convoy review behind a config flag so operators get deeper review when they want it while quick-review stays the default. Ready and in the pipeline; pinned.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1224",
      "rank": 7,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "ship/close-out must restart the running dashboard so merged code goes live. Pinned bug.",
      "rationale": "Pinned in-pipeline (verifying-on-main). Bug: merged code wasn't actually live because ship/close-out never restarted the dashboard — a trust-eroding gap between 'merged' and 'working'. Merged and verifying; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1992",
      "rank": 8,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate all panopticon.db references to overdeck.db across skills; re-verify. Pinned.",
      "rationale": "Pinned in-pipeline (verifying-on-main). Rename fallout: every skill/db reference to the old 'panopticon.db' name must move to 'overdeck.db' so the rename is consistent end-to-end. Merged and verifying; pinned.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1903",
      "rank": 9,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "LIVE RED MAIN: create-beads bd-DB-init race (issue-beads-check failing on main right now).",
      "rationale": "Main CI is currently RED — the only failing test is issue-beads-check.test.ts, the same bd-DB-init 'table not found: issues' race family PAN-1903 root-causes. A red main empties the merge gate (every PR inherits the failing check), so this single flake blocks ALL shipping. PAN-1903 has a precise root cause (bd lazy-init races the first bd call) and a scoped fix (deterministic test DB init before the body runs). Highest-leverage unblock on the board.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-806",
      "rank": 10,
      "size": "L",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [
        "PAN-804"
      ],
      "why": "Epic B: work agents must never touch git (pan work done owns rebase). Critical safety.",
      "rationale": "Critical architecture epic. Work agents attempting manual rebases caused a destructive `mv .pan .claude /tmp` incident (PAN-698). The fix — strip git/rebase instructions from work prompts, own all git in `pan work done`, add shell hooks blocking destructive ops in workspaces — removes a loaded gun. Depends on Epic D (PAN-804) cleanup first.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-807",
      "rank": 11,
      "size": "L",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [
        "PAN-804"
      ],
      "why": "Epic C: pre-flight workspace sanity on spawn; stop hard-resetting local branches (data-loss risk).",
      "rationale": "Critical architecture epic. The spawn flow hard-reset a feature branch to a 2-day-old commit then committed planning artifacts — a loaded gun that would orphan unpushed work. Pre-flight checks (fetch, compare local vs remote, abort if local ahead) make the pattern unreachable. Depends on Epic D.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-804",
      "rank": 12,
      "size": "L",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic D: archaeological repo audit + pre-1.0 cleanup (dangling commits, branch drift). Execute FIRST.",
      "rationale": "Critical architecture epic, explicitly the FIRST to execute (unblocks Epics A/B/C). Cleans dangling commits, orphan branches, unpushed work, and main/origin drift so 1.0 ships on known-good state. Pre-flight cleanup with no production code changes; the foundation the other stabilization epics build on.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1454",
      "rank": 13,
      "size": "L",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "META: 9 systemic failure patterns from the 80-issue audit — substrate fixes to stop closed-but-not-shipped.",
      "rationale": "A behavior-verified audit found 39% of 80 closed issues needed action (7 not delivered, 19 missing AC items). This META catalogues 9 failure patterns (silent miss, transparent deferral, scope-creep stubs, test-plan skip…) and seeds the focused substrate fixes (PAN-1498/1499/1500/1501). High-leverage: prevents the entire class of 'closed but not actually shipped' regressions.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1936",
      "rank": 14,
      "size": "XL",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source of truth: one canonical resolver per domain (consolidate the 8+ read paths).",
      "rationale": "Encodes the 'one read door, one write door' tenet as concrete work. The same fact is read from 8+ endpoints and written from 100+ call sites with nothing enforcing agreement — the root cause of recurring state/pipeline corruption. Consolidating to one canonical resolver per domain makes drift structurally impossible. Foundational; high blast radius.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1433",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents leave host main repo in abandoned git rebase for hours (state corruption).",
      "rationale": "Critical: a conversation agent left the host's main checkout mid-rebase with conflicts for hours — the running dashboard was built from the broken intermediate state, so 'merged' code wasn't live. Git-state corruption of the shared primary worktree bypasses every pipeline safety. Must bound/halt conversation-agent git operations on the host.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 16,
      "size": "L",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: comment mediation layer to stop prompt injection via tracker comments (agents have shell).",
      "rationale": "Critical security. Agents have full host shell access and ingest raw tracker comments into their prompt context — a malicious comment can inject arbitrary shell commands (exfiltration, deletion). Already exploitable today via getTrackerContext at spawn/resume. A mediation/quarantine layer for untrusted comment text is a pre-1.0 must-have given agents run destructive ops.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1435",
      "rank": 17,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys stored plaintext in ~/.panopticon/config.yaml — leak via backups, containers, core dumps.",
      "rationale": "Security: every provider key sits plaintext in config.yaml (0644 historically). Leaks via dotfile backups/sync, container mounts, compromised agents, and crash dumps. chmod was just tightened (PAN-1915 builds further), but plaintext-at-rest remains the core risk. OS-keychain integration is the real fix.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1508",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Immediate cleanup of safe post-merge feature-* workspaces (disk + state held indefinitely).",
      "rationale": "Critical substrate bug. Post-merge workspaces linger — each holds disk (node_modules), feature branches, paused agent state dirs, and tmux RAM. Misfire dispatch paths then spawn roles onto already-merged issues, burning slots against the concurrency governor. Immediate safe cleanup of merged workspaces reclaims resources and closes the misfire surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1506",
      "rank": 19,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents missing from frontend store despite appearing in pan status (store/DB drift).",
      "rationale": "Critical substrate bug. Strike agents show in `pan status` but not in the dashboard frontend store — the store/DB has drifted from live state, so the operator can't see or manage strikes that are actually running. Same single-source-of-truth family as PAN-1936/1510.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1510",
      "rank": 20,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Newly-filed issues missing from frontend store (parallel to strike-agent invisibility).",
      "rationale": "Critical substrate bug. Newly-filed issues don't appear in the frontend store — the dashboard and live state disagree, so the operator's view is stale the moment they file work. Same read-door drift family; blocks trust in the dashboard as a source of truth.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1214",
      "rank": 21,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server crashes on UnhandledPromiseRejection when poking/killing dead agents (502).",
      "rationale": "Critical availability bug. pokeAgent/killAgent wrap async runtime methods in sync try/catch that can't catch the async rejection → UnhandledPromiseRejection crashes the whole dashboard server (502 from Traefik, port 3011 drops). A single dead-agent poke takes down the entire UI. Straightforward fix (await the promise / handle rejection).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1213",
      "rank": 22,
      "size": "M",
      "importance": "critical",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Synthesis→review-status bridge broken: deacon resets review/test to pending after rebase, PR stranded.",
      "rationale": "Critical pipeline bug. After a ship rebase the deacon patrol resets review+test to 'pending', normalizeReviewStatus clears readyForMerge, and the MERGE button never appears even though everything passed end-to-end. Work that's genuinely done can't merge — directly stalls the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 23,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after PR head moves never re-posts panopticon/review status → PR BLOCKED forever.",
      "rationale": "High-impact pipeline bug. The GitHub status post is gated on a readyForMerge false→true transition; a re-review that re-passes on a NEW head SHA is a no-op, so branch protection keeps the PR BLOCKED forever (status absent on the new commit). Requires admin override to merge. Status post must key off head SHA, not the transition.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 24,
      "size": "L",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived) + shipComplete; auto-dispatch ship on gates-green.",
      "rationale": "Architectural. readyForMerge is one boolean wearing two hats (quality-gates-green AND ship-rebased-verified), and it only flips via poller/recovery — never event-driven. A PR that genuinely passed sits unmergeable until a poller notices. Splitting into a derived gatesPassed + shipComplete and dispatching ship on gates-green removes a whole class of stuck-at-the-gate stalls.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1864",
      "rank": 25,
      "size": "M",
      "importance": "critical",
      "score": 81,
      "condition": "ok",
      "dependsOn": [
        "PAN-1861"
      ],
      "why": "Review nudge insufficient: deacon must synthesize DETERMINISTICALLY, not wait on flaky nudges.",
      "rationale": "Critical convoy-revival bug. The review 'nudge' to fire synthesis is unreliable, so a passed review never synthesizes and the PR stalls. The deacon must drive synthesis deterministically from state rather than depending on a nudge succeeding. Builds on PAN-1861 (synthesis wedge); together they fix the convoy-stall class.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1861",
      "rank": 26,
      "size": "M",
      "importance": "critical",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Convoy synthesis still wedges after PAN-1818 — parent stalls with sub-reviewers done.",
      "rationale": "Critical convoy-revival bug. Even after PAN-1818, convoy synthesis wedges: all sub-reviewers finish but the parent review session sits idle and no verdict posts, leaving the PR mergeStateStatus BLOCKED with empty reviewDecision. Directly stalls the review pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1520",
      "rank": 27,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "META: unified 'agent awaiting input' — finish AskUserQuestion (currently fabricates responses).",
      "rationale": "META consolidating the 'agent awaiting input' subsystem. The dangerous piece: AskUserQuestion is counted for the badge but its options aren't rendered and the orchestrator fabricates option #1 as the tool_result — the agent silently acts on a made-up answer. Must build the relay (mirror PermissionRequest) and kill the auto-default. Also unifies ExitPlanMode/EnterPlanMode.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1594",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook-driven agent readiness: kill 30s prompt-polling + permission-mode coupling (feedback dead-letters).",
      "rationale": "waitForReadySignal always times out (30s) for default agents — ready.json is never written and the pane-scrape fallback keys off bypass-permissions strings that never render. Every feedback-delivery resume reports messageDelivered:false and dumps the feedback into a mail/ dead-letter queue the agent never reads. Moving readiness to a hook (Pi already writes ready.json) fixes an entire class of 'agent never got the message' stalls.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1901",
      "rank": 29,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "merge.beads.driver never configured — PAN-1841 .gitattributes fix is inert; .beads still conflict-storms.",
      "rationale": "PAN-1841 declared `.beads/issues.jsonl merge=beads` in .gitattributes but nobody configures merge.beads.driver, so git ignores the attribute and falls back to conflict merge. The .beads/.pan conflict-storms the fix targeted are STILL happening on sync-main. Configuring the driver (or shipping one) makes the declared merge strategy actually take effect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed' every busy cycle.",
      "rationale": "During convoy bursts the auto-committer commits .pan dirt, but running agents re-dirty .pan/continues between its commit and `git pull --rebase`, so rebase refuses with unstaged changes — recurring error, main carries unpushed state, and humans on the primary worktree hit 'cannot pull: unstaged changes'. Fix: commit-until-clean before rebasing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 31,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents hang on Claude Code .claude/** settings-file protection — un-overridable by PreToolUse.",
      "rationale": "Class-2 split from PAN-1616. Claude Code's settings-file protection for .claude/** is a gate distinct from tool permissions and can't be auto-approved by the PreToolUse hook, so any work agent editing .claude/rules/*.md hangs indefinitely (~90 min frozen, heartbeat still 'active'). Legitimate on-task work deadlocks.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1725",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review role agents marked 'orphaned' after writing APPROVED outputs — operator sees false failures.",
      "rationale": "Review agents for PAN-1704 wrote a complete APPROVED synthesis but Cloister classified them stopped/orphaned (tmux session missing) instead of completed — the operator sees failures for work that succeeded. Orphan-detection must honor a successful written artifact before flagging failure.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1207",
      "rank": 33,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review sub-specialist panes exit cleanly but state.json stays 'running' — synthesis never fires.",
      "rationale": "Convoy sub-specialists run to completion, write reports, exit 0 — but state.json keeps reporting status=running, so the synthesis trigger never fires and no verdict posts (PR BLOCKED forever). The exit→state transition is broken; same convoy-stall family as 1861/1864.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1456",
      "rank": 34,
      "size": "L",
      "importance": "high",
      "score": 71,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Pass-3 audit incomplete — fresh-context agent must finish re-auditing 75 of 80 closed issues.",
      "rationale": "A deep audit found Pass 1/2 (Opus subagents) systematically accepted proxy evidence — 60% miss rate on the small re-audit sample (e.g. archived-conversations UI hardcodes limit=50 so 659 of 709 rows invisible). Pass-3 (GPT-5.5 + Playwright, strict original-AC) methodology works but only 5 of 80 are re-audited; 75 remain. Needs a fresh-context continuation per the HANDOFF doc — flagged needs-refinement because it's a scoped continuation, not a normal feature.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1557",
      "rank": 35,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Interactive, attachable review convoy with hook-owned completion signalling.",
      "rationale": "Restores convoy reviewers as interactive, attachable tmux sessions (not headless `claude --print`) so operators can watch/interact, with completion signalling moved to the Stop-hook (hook owns the signal, not the agent). Consolidates a cluster of review-lifecycle bugs stemming from the headless/eager-reap design.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1915",
      "rank": 36,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [
        "PAN-1435"
      ],
      "why": "API key at-rest hardening: startup perm check + OS keychain + deprecate plaintext. Builds on chmod fix.",
      "rationale": "The larger hardening around PAN-1435: startup permission checks, OS keychain (libsecret/Keychain) integration, and deprecating plaintext. The chmod fix already landed; this completes the at-rest security story. Depends on the plaintext-keys issue being addressed.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 37,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit).",
      "rationale": "A two-pass audit of the unified dashboard redesign found 32 gaps across 6 surfaces — data-binding, tab content, keyboard nav, typography, routing. The shell/primitives landed well; the binding/detail layers have the bulk of the gaps. Closing them delivers the dashboard the PRD promised.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1488",
      "rank": 38,
      "size": "S",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add required_pull_request_reviews to main branch protection (merge-gate integrity).",
      "rationale": "Without required_pull_request_reviews on main branch protection, the merge gate can be bypassed. A small, high-integrity settings change that hardens the one-way door of landing on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 39,
      "size": "M",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Coalesce review-spawn spam in session/activity feed; supersede re-reviews; keep conversations recent.",
      "rationale": "The activity feed is dominated by review-spawn noise — ~11 entries per review cycle (per spawnRun event) with no coalescing/supersede, burying the conversations that matter. Adding coalescing + per-issue supersede makes the feed useful again.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1865",
      "rank": 40,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Make Kimi runnable on claude-code harness — root-cause the CLIProxy 200k-context illusion.",
      "rationale": "Critical, hard. Kimi on claude-code deadlocks because CLIProxy advertises a false ~200k window; long sessions sail past it (the '200k-window illusion'). A $22 silent burn and a stranded critical red-main strike both came from this trap. Needs root-causing the CLIProxy window advertisement; flagged needs-refinement because the fix path is genuinely open (may require CLIProxy-side changes).",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1873",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "verifying_on_main tagged at first merge, never cleared on re-active issues — queue never drains.",
      "rationale": "Bug: verifying_on_main is set at first merge but never cleared on re-activation, so re-opened issues keep a stale label and the close-out queue never drains correctly. A label-lifecycle bug that inflates the 'awaiting close-out' surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 42,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cloister auto-resume tests fail under full parallel run, pass in isolation (test pollution family).",
      "rationale": "Same cross-file test-pollution family as the red-main CI bugs: cloister auto-resume tests pass in isolation but fail under the full parallel suite. Risks reddening main under load; fix the isolation leak rather than serializing.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 43,
      "size": "XL",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs (foundational for shared/multi-user Panopticon).",
      "rationale": "Foundational architecture for any multi-user/shared Panopticon: per-tenant workspace isolation with ACLs. Large and forward-looking, but it's the precondition for several collaboration features and for safely opening the dashboard beyond a single operator.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-262",
      "rank": 44,
      "size": "L",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations.",
      "rationale": "The post-merge lifecycle (close-out, verify-on-main, workspace cleanup, branch delete) is a tangle of non-idempotent steps that re-running partially can corrupt. Refactoring into composable idempotent operations makes recovery safe and is a substrate for PAN-1508/1873.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1498",
      "rank": 45,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [
        "PAN-1454"
      ],
      "why": "Substrate (pattern 1): require a live-code-path trace per AC in requirements review.",
      "rationale": "PAN-1454 pattern 1 (silent miss): code lands in the wrong file/path so behavior is unchanged. Fix: the requirements reviewer must emit a live code-path trace (file+function+how input reaches it) per AC and BLOCK if it can't. Catches the 'shipped artifact that doesn't actually wire up' class.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1499",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [
        "PAN-1454"
      ],
      "why": "Substrate (pattern 2): block pan done if close-out defers work without a follow-up issue.",
      "rationale": "PAN-1454 pattern 2 (transparent deferral): close-out says 'will do X later' but no follow-up issue is filed and the original closes. Fix: pan done scans for deferral language and refuses unless a follow-up PAN-NNNN is linked or the AC list is amended. Stops silent scope drops.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1618",
      "rank": 47,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when stack down.",
      "rationale": "Under autonomous operation, pan start fails hard when the workspace docker stack is down and both recoveries (rebuild, --host) are manual — so a fully-planned proposed item sits at the gate forever. The flywheel needs autonomous stack recovery so proposed work can actually start.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1193",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm: no slot-to-slot file coordination — slots independently produce overlapping/conflicting work.",
      "rationale": "Swarm slots branch independently with no file-overlap arbitration: two slots can create the same file, the first merges, the second is permanently conflicted and its work is lost; auto-advance waits on ALL slots so the whole swarm stalls. Needs per-bead files_scope enforcement and/or wave gating by dependency.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1195",
      "rank": 49,
      "size": "M",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm: parent work agent goes silent during swarm dispatch — no progress signal.",
      "rationale": "During swarm dispatch the parent work agent goes silent with no progress signal, so the operator can't tell dispatch is healthy. A swarm-observability gap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 50,
      "size": "L",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-issue slot ensemble).",
      "rationale": "Route swarm beads to the right model by difficulty/subject so a cheap model does trivial beads and a frontier model handles hard ones — the throughput lever the PAN-1249 migration proved (~12x). Foundational for cost-effective swarms.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1198",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate the container-node-modules named volume.",
      "rationale": "The init container reports '1230 packages installed' but the named volume is empty (0 entries), so the server fails at startup with 'Cannot find package effect'. Workspaces can't come up healthy; blocks container-isolated work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 52,
      "size": "L",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (Effect migration unblocks this).",
      "rationale": "A projection-cached VCS driver replaces repeated git diff/checkpoint shelling with cached reads — a broad perf win across review/verify/merge paths. Depends on the src/lib Effect migration slices landing.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1253",
      "rank": 53,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-1246"
      ],
      "why": "Flywheel: respect issue dependencies before autopicking work (don't start blocked work).",
      "rationale": "The flywheel picks by P-level and ignores declared dependencies — it would autopick downstream work whose deps aren't done, wasting capacity on code that immediately needs rework. Must consult the dependency graph (bd ready already excludes blocked) before picking.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1254",
      "rank": 54,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over the tailnet.",
      "rationale": "Publishes the dashboard (and workspace services) over Tailscale so the operator can reach them from any device on the tailnet without router config/DNS/relays. Effect-native port of a proven reference implementation; high operator-convenience.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 55,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items (~12x speedup proven).",
      "rationale": "The PAN-1249 migration proved direct parallel Agent-tool batches run ~12x faster than slot machinery for mechanical work. A fast-track tier that routes trivial mechanical beads to direct batches (amortizing slot setup) is a major throughput win for migration/refactor swarms.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 56,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync compatibility surfaces.",
      "rationale": "The canonical issue for finishing the src/lib Effect migration: PAN-1249 shipped it as an additive bridge, but legacy Promise/sync surfaces remain, so the migration isn't complete until the bridge is removed or deliberately retained. Unblocks Effect-native follow-ons (perf, routing).",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 57,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation.",
      "rationale": "Lets a conversation/agent start with a curated skill bundle (including non-globally-synced third-party skills) loaded for that one session — solves the all-or-nothing pan sync problem where ~60 skills spend every session's context budget. Good UX/lever.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 58,
      "size": "L",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (multi-provider load distribution).",
      "rationale": "Per-role model pools (round-robin/weighted/rate-limit-aware) for spreading rate-limit risk and A/B'ing models, plus a work.* subtype taxonomy. Follow-up to the catalog trim; needs its own planning cycle. Pairs with PAN-1832.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1452",
      "rank": 59,
      "size": "M",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-reviewer restart with model override (architectural mismatch with PAN-1048 fan-out).",
      "rationale": "PAN-1381 shipped Restart but per-reviewer restart is architecturally impossible post PAN-1048 (single review run fans out 4 reviewers) — clicking 'restart correctness on Haiku' restarts all 4 on Haiku. Needs per-sub-reviewer model override that fits the fan-out shape.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1525",
      "rank": 60,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer autocomplete: auto-generate from CLI tree so every pan command + flag is discoverable.",
      "rationale": "The composer's slash-command list is hand-maintained and incomplete (missing pan handoff, fork, conversations subtree; no consistent flags). Auto-generating from the CLI command tree makes every command+flag discoverable and stays correct as the CLI grows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 61,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove the claude-code-only API guard, verify Pi transcript parsers.",
      "rationale": "Pi conversations can't be forked (summary/handoff) due to a harness!=='claude-code' guard. Removing it (after verifying Pi JSONL transcript parsers) unlocks Pi summary/handoff forks. Scoped and well-specified.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 62,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host override.",
      "rationale": "Reviewers inherit allowHost from the work agent and the flywheel hardcodes allowHost:true, so flywheel-driven work silently forces every reviewer onto the host instead of the workspace container. Decouple the blanket override so isolation is the default.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1561",
      "rank": 63,
      "size": "XL",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-scoped dashboard nav: deck of tabs per project + conversations/tree column + activity feed.",
      "rationale": "Makes the project the unit you work in: selecting a project opens a deck of scoped tabs with a conversations+issue-tree column and activity feed. Large UX restructure with a full PRD; high operator-value for multi-project use.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1578",
      "rank": 64,
      "size": "XL",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code/Pi/Codex).",
      "rationale": "Adds GitHub Copilot CLI as a full harness peer — native AGENTS.md/SKILL.md/MCP, defaults to Sonnet, no ToS bar. A Copilot-subscription user could run a first-party GitHub agent loop on Claude without an Anthropic subscription/CLIProxy. Large; needs the gating-risk evaluation first.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1588",
      "rank": 65,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-800 Phase 5: eliminate the last pane-scrape thinking-detection sites (capture-pane stuck detection).",
      "rationale": "Removes the last capture-pane stuck-detection sites (parseThinkingDuration, isAgentActiveInTmux) that were missed in the earlier PAN-800 pass — brittle status-line scraping that only matched a few spinner words and couldn't parse hour-scale durations. Replacement is already hook-based; this deletes the dead/brittle code.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 66,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface 'awaiting close-out' (verifying-on-main) count in flywheel stats, pan status, dashboard headline.",
      "rationale": "The merged-but-not-closed-out queue reached 21 deep with no first-class surface. Beyond visibility, merged-unclosed issues hold resources and are a misfire-dispatch surface. Surfacing the count everywhere closes the measurement gap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 67,
      "size": "L",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable delivery path: version-stamped PTY supervisors, rolling refresh, dumb-shim primitives.",
      "rationale": "The PTY supervisor is pinned per session — a supervisor bugfix doesn't reach running agents until respawn, and nothing can tell which sessions run stale supervisors. Version-stamping + rolling refresh + server-side delivery makes supervisor fixes take effect live. PRD'd.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1791",
      "rank": 68,
      "size": "XL",
      "importance": "high",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Tiered execution: difficulty-routed bead dispatch + event-driven supervisor review.",
      "rationale": "Ambitious: a cheap durable foreman runs the bead loop; standing tier agents (cheap→frontier) kept warm by a plan-filtered commit feed step in per bead; a frontier supervisor reviews at commit boundaries. Live evidence (PAN-1788) shows frontier-quality at a fraction of cost. Potentially a differentiator — flagged needs-refinement because the architecture is large and unproven at scale.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1852",
      "rank": 69,
      "size": "L",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from eval data.",
      "rationale": "Route each work-agent issue to the cheapest capable model using benchmark-anchored eval data instead of one fixed model — a small fix runs on a small model. PRD'd; major cost lever and pairs with the model-pool/tiering cluster.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1491",
      "rank": 70,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: metric-aware prioritization — weight substrate-bug suggestions by which v1.0 criterion they hit.",
      "rationale": "Once substrate-bug provenance/telemetry (#1487) ships, the flywheel can weight suggestions by which v1.0 criterion is under threat rather than P-level+age alone. Compounding leverage for hitting v1.0 thresholds. Depends on the now-closed telemetry prerequisite being exercised.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1142",
      "rank": 71,
      "size": "M",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config (effort is task-dependent).",
      "rationale": "Effort plumbing today is gemini_thinking_level + a conversation-only localStorage picker; roles can't select effort and defaults vary silently across harnesses. A proper config surface + launcher matrix makes effort consistent and lets cheap tasks run at low effort. Benchmarks show effort is task-dependent, so this is real leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1913",
      "rank": 72,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description field: show on click, edit in dashboard, mirror into the project context layer.",
      "rationale": "Adds a human-readable description to ProjectConfig, editable from the dashboard, mirrored into the project layer (.pan/context/project.md) via pan sync. Also lifts the REPO-ARTIFACTS docs to the Mintlify site. Well-scoped; improves multi-project orientation.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1544",
      "rank": 73,
      "size": "S",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip vestigial 'ship' from the Role union and its ~10 downstream references.",
      "rationale": "PAN-1531 removed ship-role spawn machinery but kept 'ship' in the Role union for backward compat with old state.json. Nothing creates ship-role agents anymore — the type is vestigial noise. Small, mechanical type cleanup.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 74,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in-PR-scope vs whole-feature-scope; only block in-scope.",
      "rationale": "The requirements reviewer treats the whole vBRIEF AC list as in-scope per PR (180 ACs, 19 partial blockers on one PR). Classifying each AC against the PR diff stops asking the current PR to fix the whole feature; cuts synthesis-scrub noise.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1218",
      "rank": 75,
      "size": "S",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode.",
      "rationale": "Bead inspection adds 3-5 min/bead; Check 3 (compile+smoke) passed in 100% of blocked cases so it never produces the verdict. Dropping it, restricting to foundation beads, and end-of-batch mode cut the cost while keeping the value.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 76,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) not prompt-derived.",
      "rationale": "Synthesis derives 'prior cycle SHA' by reading the second-newest review dir — fragile. Persisting cycle state as structured data (cycle.json) gives reliable SHA access and structured prior-findings, so convergence gating is sound.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 77,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: emit TTS announcements on lifecycle events (start, pause, resume, report).",
      "rationale": "Operator monitoring a long flywheel run needs audible lifecycle transitions without staring at the dashboard. TTS is already wired; just emit events on start/pause/resume/finalize. Small, nice-to-have.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-605",
      "rank": 78,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reconcile CLAUDE.md prompt assembly across all agent types (dead template system, missing context).",
      "rationale": "Audit found two parallel template systems (one active, one dead/zero-references) and missing architectural context causing agent confusion. Reconciling assembly so every agent type gets consistent, correct context removes a class of agent mistakes.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1263",
      "rank": 79,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm UX: surface per-slot identity + multi-slot navigation in pipeline rows and IssueDrawer.",
      "rationale": "When a swarm dispatches N slots the dashboard shows N identical 'Work (sonnet)' rows — can't tell slots apart, see what each does, or interact with slots 2..N. Surfacing per-slot identity (bead name) makes swarms operable.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1444",
      "rank": 80,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard port lockfile + pan doctor multi-instance check (follow-up to PAN-1416).",
      "rationale": "PAN-1416 shipped the cwd guard but not the port lockfile or pan doctor check — observed two dashboards coexisting on 3011. A real lockfile + PID heartbeat + doctor check is defense-in-depth against dueling dashboards.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 81,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: Ctrl+F only finds text in currently-rendered virtualized rows.",
      "rationale": "Browser Ctrl+F can't find text in unmounted virtualized transcript rows, so searching for an earlier error/file appears to find nothing. Needs an in-page search that scans the full transcript, not just the viewport.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 82,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand (stale workspace detection).",
      "rationale": "When the devcontainer template changes, existing workspaces are pinned to the old render with no warning/migration (observed: api service bound to no port because cmd was stale). Versioning + stale detection + re-render keeps workspaces current.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-113",
      "rank": 83,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying the agent actually started.",
      "rationale": "POST /api/agents spawns pan work issue and returns immediately; if it fails the user sees 'Agent Started!' with no agent running, errors only in the in-memory activity log. Should verify readiness before reporting success.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 84,
      "size": "M",
      "importance": "medium",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan hygiene — codify the merge/commit/push state audit as a first-class CLI verb + skill + docs.",
      "rationale": "The ad-hoc git/PR/tmux hygiene check each operator writes by hand belongs as `pan hygiene` + a skill: unpushed commits, orphan branches, agent-PR-state lies, dangling work-tree. Reusable, documented.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-813",
      "rank": 85,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution.",
      "rationale": "PAN-805 root-cause fix landed with an 8-line NOTE but no automated test guarding the invariant (reset must preserve work-agent resolution/resolutionCount). Small, mechanical regression-test addition.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-49",
      "rank": 86,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require a real runtime (refactor to timer/tmux abstractions).",
      "rationale": "CloisterService tests are all describe.skip'd because service.start needs real tmux/intervals. Refactoring to inject timer/tmux abstractions lets the core orchestrator get real test coverage — currently untested.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 87,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 88,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1131",
      "rank": 89,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale idle synthesis session blocks review re-dispatch (idempotency guard can't tell 'reviewing' from 'finished-idle')",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 90,
      "size": "S",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1862",
      "rank": 91,
      "size": "L",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(review): cache-sharing review convoy — warm-parent fork, model-uniformity guard, and resumable selective re-review",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-244",
      "rank": 92,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 93,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 94,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 95,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-321",
      "rank": 96,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ephemeral merge specialist fails silently for polyrepo MYN projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 97,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 98,
      "size": "S",
      "importance": "medium",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 99,
      "size": "L",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build sometimes skips Vite frontend rebuild",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-673",
      "rank": 100,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(dashboard): virtualizer inline ref causes blank conversation page on large message lists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 101,
      "size": "S",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 102,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-890",
      "rank": 103,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conflict-resolver agent merges stale main snapshot and never pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-899",
      "rank": 104,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent CLI commands fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 105,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-928",
      "rank": 106,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "verification-runner: polyrepo workspaces fail at sync-target-branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-929",
      "rank": 107,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "review-run: polyrepo workspaces detect overlay repo instead of code repos",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 108,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 109,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 110,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1038",
      "rank": 111,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff panel always empty: conv.claudeSessionId is null for all conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 112,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 113,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 114,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 115,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 116,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 117,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 118,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 119,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 120,
      "size": "L",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1232",
      "rank": 121,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 follow-up — IssueDrawer 6 tabs as placeholders + title font + header structure + stream colors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1234",
      "rank": 122,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 follow-up — cross-cutting (Space Grotesk / keyboard shortcuts / /issues/:id route / INPUT badge / pulse keyframe / conformance...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 123,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1243",
      "rank": 124,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin hooks install: resolver fails outside repo CWD (auto-config breaks flywheel resume)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1247",
      "rank": 125,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: deacon orphan-test recovery loops dispatch_failed forever on an unhealthy workspace docker stack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1258",
      "rank": 126,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot spawn hangs silently before writeLauncherScriptAtomic when model=kimi-k2.6",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 127,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1336",
      "rank": 128,
      "size": "S",
      "importance": "medium",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm: pan swarm --auto-advance cannot advance — no slot-PR merger, slots never self-terminate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 129,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 130,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 131,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboard servers can bind the main pan.localhost port and hijack the canonical dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1434",
      "rank": 132,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-find.py reports session_file: N/A for newer conversation records (wrong column)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 133,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1439",
      "rank": 134,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recover conv-2084's in-progress PANOPTICON_PROJECT_ROOT env var work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 135,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 136,
      "size": "L",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 137,
      "size": "L",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1447",
      "rank": 138,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1194 follow-up: restore failed-merge slot UI deleted by sibling PAN-1148 merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 139,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1472",
      "rank": 140,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm inspect agents emit pan tell to parent agent ID — fails when only slot agents exist",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 141,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1559",
      "rank": 142,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphaned inspect sessions: live tmux panes with no state.json escape all reapers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1564",
      "rank": 143,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi extension path + dashboard server spawn both depend on launch cwd (fix: resolve against packageRoot + pin spawn cwd)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 144,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1570",
      "rank": 145,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost recorder silently dropped ALL cost events since 2026-05-21 (Effect-migration regression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 146,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N lin...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1582",
      "rank": 147,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff fork falls back to summary: external authoring session stalls on Write permission",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 148,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1637",
      "rank": 149,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation resume reattaches to a keep-alive corpse (no harness-liveness probe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1638",
      "rank": 150,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation DB status stays 'active' after the harness process dies",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1652",
      "rank": 151,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation title regeneration 500s on large transcripts — claude title invocation times out at 30s",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 152,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 153,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1681",
      "rank": 154,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(pipeline): test agents narrate 'tests pass' but never run pan specialists done test → strand at test=pending; no test-completion fa...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1682",
      "rank": 155,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): strike agents missing from Command Deck issue tree — resource-discovery.ts:471 tmux-prefix allowlist omits 'strike-' (9...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1688",
      "rank": 156,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "System Briefing: 'Cost today' card always $0.00 — reads orphaned cost-monitor.dailyTotal instead of cost_events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1689",
      "rank": 157,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "System Briefing: 'Paused / troubled' card inflated ~8x (~185 vs real ~24) by stale stopped sub-agent tombstones",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1718",
      "rank": 158,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate successful 'pan reload' restart-status writes from two unidentified concurrent processes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1722",
      "rank": 159,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awareness rail activity entries don't survive page load — snapshot doesn't seed recentActivity, only live events accumulate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1781",
      "rank": 160,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context-overflow recovery: claude --resume bypasses panopticon-native compact boundaries (~50% of the time) — compaction is a silent no...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1789",
      "rank": 161,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation status shows 'ended' for a live codex-harness handoff session",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1790",
      "rank": 162,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff: focus text without conv id mis-parses as conversation; help string missing codex; 500-char focus limit undocumented",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1793",
      "rank": 163,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff kickoff message is not delivered to pi-harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 164,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 165,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + aut...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1817",
      "rank": 166,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear API quota exhausted by IssueDataService polling (2500/hr ceiling hit, 84+ poll errors) — regression of the pre-safeguard tracker...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1823",
      "rank": 167,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear polling is not rate-limit-aware — no 429 backoff (secondary to PAN-1817)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 168,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flaky main CI: real-timer integration tests time out (~5s) on loaded runners — fork recovery, rollout-JSONL, heartbeat, conversation-ro...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1827",
      "rank": 169,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view blank for pi-harness sessions — resolver handles claude-code and codex only (flywheel orchestrator affected)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 170,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1833",
      "rank": 171,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi spawn checks pi-extension via process.cwd() — 'Pi extension not built' when pan start/strike is run from any non-repo-root dir",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1850",
      "rank": 172,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcripts >10MB are truncated by the initial-read cap (missing-middle live view)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1893",
      "rank": 173,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan start STILL crashes toUpperCase after sync-main conflict for gpt-5.5/claude-code agent state — PAN-1872 fix incomplete (P...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1897",
      "rank": 174,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan start workspace-prep hangs/times out (>120s) on re-entry — blocks PAN-1711, PAN-1827 (no spawn, no error)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1900",
      "rank": 175,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(flywheel): UAT candidate branch codename is non-deterministic — proliferates a new uat/* branch per assembly cycle (3 for 0614)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 176,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1956",
      "rank": 177,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug: GLM-5.2 and GLM-5.1: contextWindow set to output cap (should be input context); also verify pricing + text-only image handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1993",
      "rank": 178,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning a freshly-created issue 404s (start-planning races GitHub issue propagation)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1994",
      "rank": 179,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(pipeline): fresh plan --auto issue inherits another issue's merged/verifying-on-main/paused state (PAN-1982 got PAN-1866's)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1998",
      "rank": 180,
      "size": "S",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remodel cleanup: drop orphan observation_index + reset_markers tables from the overdeck.db migration (LOW)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2001",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(pipeline): re-running `pan plan` on an already-planned issue phantom-merges it (merged/verifying-on-main + review_status=merged, no...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 182,
      "size": "L",
      "importance": "medium",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1436",
      "rank": 183,
      "size": "S",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 184,
      "size": "S",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard event loop stalls 15-25s under load — watchdog force-restarted it 3x in 45 min",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 185,
      "size": "S",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message stil...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 186,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1888",
      "rank": 187,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(hooks): work-agent-stop-hook still reads legacy review-status.json — finish the PAN-1883 SQLite-truth migration",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-838",
      "rank": 188,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "synthesis.json contains hallucinated timestamp + sparse structure (only counts, no findings arrays)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 189,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 190,
      "size": "L",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 191,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1696",
      "rank": 192,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1775",
      "rank": 193,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility reads as 'no agent'",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2005",
      "rank": 194,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2006",
      "rank": 195,
      "size": "S",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-37",
      "rank": 196,
      "size": "L",
      "importance": "medium",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 197,
      "size": "L",
      "importance": "medium",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 198,
      "size": "S",
      "importance": "medium",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-111",
      "rank": 199,
      "size": "L",
      "importance": "medium",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support cross-machine planning state sync without cross-contamination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 200,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 201,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 202,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 203,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 204,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 205,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 206,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 207,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1494",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(docs): register docs/FLYWHEEL-VISION on panopticon-cli.com (Mintlify) — needed for public sharing",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-450",
      "rank": 209,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 210,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 211,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-456",
      "rank": 212,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Store Claude Code session IDs for agent resume after crash/restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 213,
      "size": "L",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 214,
      "size": "L",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 215,
      "size": "L",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 216,
      "size": "L",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 217,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 218,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 219,
      "size": "L",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-606",
      "rank": 220,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 221,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-608",
      "rank": 222,
      "size": "L",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Destructive Command Guard (dcg) with configurable settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 223,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 224,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 225,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 226,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 227,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 228,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 229,
      "size": "S",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 230,
      "size": "L",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-783",
      "rank": 231,
      "size": "XL",
      "importance": "medium",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents Page Redesign — Unified Multi-View Experience",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-818",
      "rank": 232,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 233,
      "size": "L",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 234,
      "size": "L",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 235,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 236,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 237,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 238,
      "size": "L",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 239,
      "size": "L",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 240,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 241,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1102",
      "rank": 242,
      "size": "L",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): real-time notification + interactive prompts when agent awaits user input",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1151",
      "rank": 243,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 244,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Push diff summary updates over /ws/rpc instead of 5s polling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 245,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1202",
      "rank": 246,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm: prune merged/completed slot state directories after wave converges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 247,
      "size": "S",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 248,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 249,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 250,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 251,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1453",
      "rank": 252,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit: 3 cheap verifications that should ride along with merges (PAN-1170, PAN-1316, PAN-457 CLI parity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 253,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 254,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 255,
      "size": "XL",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 256,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1524",
      "rank": 257,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 258,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 259,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-399",
      "rank": 260,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Release specialist — coordinated post-merge rollout and release safety",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 261,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1610",
      "rank": 262,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards, IssueDrawer)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 263,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 264,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for workflow agent model selection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 265,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 266,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 267,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 268,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 269,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 270,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "[EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1671",
      "rank": 271,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): surface pending ExitPlanMode plan as a popup modal (reuse PlanCard + /plan-action)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1672",
      "rank": 272,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 273,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1685",
      "rank": 274,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 275,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1838",
      "rank": 276,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "[research] Grok Build (xAI) coding harness — research and specify support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 277,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 278,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 279,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 280,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 281,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 282,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1955",
      "rank": 283,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue cockpit: move beads from a tab into a persistent right rail with a 'working now' highlight",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 284,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1966",
      "rank": 285,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single authoritative pipeline-membership resolver — one function for \"what's in the pipeline\" (collapse the 5 divergent views)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 286,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 287,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 288,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 289,
      "size": "XL",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1995",
      "rank": 290,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 291,
      "size": "S",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 292,
      "size": "L",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 293,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 294,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 295,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 296,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 297,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 298,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 299,
      "size": "S",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-104",
      "rank": 300,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost alerts/notifications when spending exceeds thresholds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 301,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 302,
      "size": "S",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 303,
      "size": "L",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1041",
      "rank": 304,
      "size": "S",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 305,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 306,
      "size": "XL",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-175",
      "rank": 307,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 308,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 309,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 310,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 311,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 312,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 313,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 314,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 315,
      "size": "S",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1103",
      "rank": 316,
      "size": "L",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): surface AskUserQuestion choice options in conversation view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-674",
      "rank": 317,
      "size": "L",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 318,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 319,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 320,
      "size": "XL",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-249",
      "rank": 321,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 322,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 323,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 324,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 325,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 326,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 327,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-306",
      "rank": 328,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix: merge-agent polyrepo false failures — stale refs, wrong error field, short timeout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-371",
      "rank": 329,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents tab only shows global specialists, not per-project ephemeral ones",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 330,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1555",
      "rank": 331,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs: remove/update stale swarm-runtime references after PAN-1517",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 332,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 333,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 334,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 335,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 336,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 337,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-472",
      "rank": 338,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "GET /api/costs/by-issue takes 10s — N+1 query on 353K rows × 184 issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 339,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 340,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 341,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-487",
      "rank": 342,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "VBRIEF not archived to docs/prds/completed/ after merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 343,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-552",
      "rank": 344,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code terminals should respect app light/dark mode scheme",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 345,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 346,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 347,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 348,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 349,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 350,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 351,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 352,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 353,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 354,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling o...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 355,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 356,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 357,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 358,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 359,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-656",
      "rank": 360,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs site scroll broken: dashboard CSS leaks onto panopticon-cli.com",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 361,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 362,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 363,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-683",
      "rank": 364,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(tests): shadow-state getPendingSyncCount test is environment-dependent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 365,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 366,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 367,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-727",
      "rank": 368,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 369,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 370,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 371,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 372,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 373,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 374,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 375,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 376,
      "size": "XL",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-751",
      "rank": 377,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 378,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 379,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 380,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 381,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 382,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 383,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 384,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 385,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 386,
      "size": "XL",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 387,
      "size": "XL",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-777",
      "rank": 388,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 389,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-780",
      "rank": 390,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent stuck in feedback loop when old feedback files exist but review has passed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 391,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 392,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 393,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 394,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 395,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 396,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 397,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 398,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-834",
      "rank": 399,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cleanup: legacy ~/.panopticon/heartbeats/ directory has not been written since 2026-04-22",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-835",
      "rank": 400,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace creation removes stale .planning/ from previous issue but doesn't commit deletion → PR diff includes 982 unrelated lines",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 401,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 402,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-904",
      "rank": 403,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make AI title generation model configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 404,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 405,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 406,
      "size": "L",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 407,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-948",
      "rank": 408,
      "size": "L",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement pan scope lifecycle commands",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 409,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 410,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 411,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 412,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 413,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 414,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 415,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 416,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1101",
      "rank": 417,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Permission safety hardening: CI guard, single emission chokepoint, property tests, runtime tripwire",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1115",
      "rank": 418,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inject observation context into agent prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 419,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 420,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 421,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1122",
      "rank": 422,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trim OpenAI model catalog to 5 supported models",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 423,
      "size": "L",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 424,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 425,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 426,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 427,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1147",
      "rank": 428,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-agent done flow stalls at 'push and re-request review' after addressing review feedback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 429,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 430,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 431,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 432,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 433,
      "size": "L",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 434,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1238",
      "rank": 435,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board view follow-up — + New issue column footer button (deferred from PAN-1229)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 436,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board view follow-up — + New issue column footer button (deferred from PAN-1229)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 437,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 438,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 439,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 440,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 441,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 442,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 443,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 444,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 445,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1493",
      "rank": 446,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "TEST: write hello.txt — probe for PAN-1200 Universal Context System verification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1547",
      "rank": 447,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix: @panctl/cli npm install warns on Node <22 (engine mismatch + deprecated deps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1548",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix: npx @panctl/cli shows stale placeholder message referencing v0.8.0",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 449,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 450,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 451,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 452,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1573",
      "rank": 453,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Consideration for reintroducing ability to --dangerously-skip-permissions, DO NOT act on this issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 454,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 455,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make pasted images reload-durable (persist across page reload, not just conversation switches)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1619",
      "rank": 456,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bridge host Codex auth into workspace containers + honest gpt-5.5 lock reason",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1620",
      "rank": 457,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awaiting-Merge button is clickable on a conflicting/CI-failing PR (stale blockerReasons)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1621",
      "rank": 458,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close human-only gate over-blocks operator conv-* sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1622",
      "rank": 459,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan dev restart leaves orphan dashboard servers (stale serving + multi-Deacon risk)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 460,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-appr...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 461,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 462,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 463,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 464,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1644",
      "rank": 465,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook-driven progressive conversation titling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 466,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 467,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1668",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 469,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1670",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dev): pan dev hot-reload wedges tabs on 'Reconnecting to the dashboard…' — PAN-1580 boot watchdog never fires under Vite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-592",
      "rank": 471,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit: Planning agent CLAUDE.md and STATE.md contents vs expectations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 472,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1705",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversation click stuck on Loading… for minutes during pipeline load — fat-poll request queueing collapse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1706",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): orphaned playwright-mcp headless Chromiums keep full dashboard pages open — each multiplies dashboard poll load",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1708",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(lifecycle): pan start CLI never flips spec plan.status proposed→approved — all 8 in-flight specs stuck at proposed, triggering reco...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — serv...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1726",
      "rank": 477,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(lifecycle): postMergeLifecycle did not pause the merged issue's work agent — idle agent holds a work slot and throttles all pipelin...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1729",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "test(beads): beads-scoping work.md \"-l {{ISSUE_ID_LOWER}}\" label-filter assertion fails on main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1730",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(governor): idle awaiting-test work sessions count against the PAN-1665 ceiling — pipeline livelocks when work pool alone exceeds to...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1734",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(test): request-review-nudge remote workspace HEAD test fails on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 482,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1739",
      "rank": 483,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): Command Deck issue TREE still hides strike agents — frontend FeatureItem session-type allowlist omits 'strike' (4th all...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 484,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 485,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 486,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1750",
      "rank": 487,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1751",
      "rank": 488,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1754",
      "rank": 489,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1755",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; readyForMerge only ever flips ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1762",
      "rank": 493,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2: tracer-bullet planning contract (Path A) + foreman-driven intra-issue swarms (Path B)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 494,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 495,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 496,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 498,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 499,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-713",
      "rank": 500,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1874",
      "rank": 501,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(review): per-issue override for review mode / re-review scope (extends PAN-1862 project-scope config)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1875",
      "rank": 502,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): add `pan flywheel stop` — graceful shutdown that writes the report",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1879",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(restart): pan restart silently re-applies stale boot gates; no way to re-enable deacon/resume (asymmetric flags)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 504,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1882",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(strike): strike workspaces never cleaned up — worktrees + branches pile up forever (27 / 16GB observed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1894",
      "rank": 506,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show UAT stack startup state in issue tree and issue slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 507,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1896",
      "rank": 508,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce approval friction for GitHub CLI operations in managed sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 509,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 510,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate every...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1909",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(planning): pan plan done handoff tail hangs (dashboard-notify/transition) — declares 'done' with spec only on local main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 512,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 513,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1917",
      "rank": 514,
      "size": "XL",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "/sessions page redesign: unify with conversation view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1918",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang sta...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 516,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1927",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(config): remove hardcoded model fallbacks — default/role model must come from explicit settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1928",
      "rank": 518,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lock model switching to brand-new conversations only (0 messages) — never for agents or started sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1929",
      "rank": 519,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "hazard(auto-commit): background git rebase rewrites history in the SHARED primary worktree — stop mutating the shared tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1931",
      "rank": 520,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning force-adds gitignored .pan/ state via 'git add -f' (regresses PAN-1215, violates PAN-1819)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1932",
      "rank": 521,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Schema migration downgrades user_version when DB is newer than code (=== SCHEMA_VERSION should be >=)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1934",
      "rank": 522,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "hazard: verification gate drives agents through up to 10 retry cycles on an unfixable check (no operator escalation, invisible burn)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1935",
      "rank": 523,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "pi/kimi work-agent cost not recorded in cost_events → runaway spend is invisible (no cost-based safety possible)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 524,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 525,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all bead verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 526,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector agent should resume a warm session instead of cold-spawning a new one per bead",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1953",
      "rank": 527,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design: beads rail mockup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1954",
      "rank": 528,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Beads rail: move beads to right sidebar, highlight active work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 529,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1963",
      "rank": 530,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Default to no-resume on dashboard boot; add 'Resume all' to the stopped-agents banner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 531,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 532,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 533,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 534,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1987",
      "rank": 535,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Allow renaming a registered project (display name is locked at registration)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 536,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1989",
      "rank": 537,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Replace Pi harness with ohmypi and evaluate advanced features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 538,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 539,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 540,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2007",
      "rank": 541,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Temporary: keep specialist (review/test/ship) sessions alive through the pipeline — disable PAN-1716 reaper + done-path kill",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 542,
      "size": "L",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2009",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(pi): dead pi agent can't be resumed — ready.json 30s timeout + PAN-1980 blocks fresh-launch → review stuck stopped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 544,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-826",
      "rank": 545,
      "size": "L",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation/terminal integration refactor: instant-start + parser correctness + T3Code structural alignment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 546,
      "size": "S",
      "importance": "low",
      "score": 7,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1857",
      "rank": 547,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "bug(ci): main RED — verification-gate.test.ts asserts stale 'src/dashboard/frontend' in DEFAULT_GATES.test after generic-command change...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1859",
      "rank": 548,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "bug(ci): main RED — agent-spawning.test.ts 'resumeAgent delivers continue prompt through Pi FIFO' fails (writePiCommand not called)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1880",
      "rank": 549,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "bug(ci): main RED — start-sync-main-conflict.test.ts hits process.exit(1) under CI single-fork (maxForks:1) cross-file mock pollution; ...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1698",
      "rank": 550,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "bug(ci): main is RED — model-count + schema-version + substrate-smoke test expectations stale (blocks every verify/ship/strike gate)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1783",
      "rank": 551,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "bug(ci): main is RED — Command Deck resource-strip Playwright fixture still expects old workspace title",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
    {
      "from": "PAN-1454",
      "to": "PAN-1498",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1454",
      "to": "PAN-1499",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1246",
      "to": "PAN-1253",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1435",
      "to": "PAN-1915",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-804",
      "to": "PAN-806",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-804",
      "to": "PAN-807",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1861",
      "to": "PAN-1864",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1506",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.78
    },
    {
      "from": "PAN-1510",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.78
    },
    {
      "from": "PAN-1213",
      "to": "PAN-1650",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1560",
      "to": "PAN-1650",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.65
    },
    {
      "from": "PAN-1196",
      "to": "PAN-1852",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1196",
      "to": "PAN-1791",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1311",
      "to": "PAN-1196",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1725",
      "to": "PAN-1207",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1725",
      "to": "PAN-1861",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1594",
      "to": "PAN-1520",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-1424",
      "to": "PAN-1832",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1852",
      "to": "PAN-1424",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-605",
      "to": "PAN-1913",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.45
    }
  ]
}
```
