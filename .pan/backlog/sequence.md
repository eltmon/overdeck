# Backlog Sequence

_Last sequenced: 2026-06-29T03:03:24Z · model: claude-opus-4-8 · open: 559_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 3 | PAN-2143 | S | critical | ok |  |  | Linchpin for 24/7 throughput: deacon patrol must re-evaluate stale merge-blockers so resolved-conflict PRs actually merge. |
| 6 | PAN-1982 | M | medium | ok |  |  | Revive full convoy review as configurable opt-in (quick stays default). Ready. |
| 7 | PAN-806 | XL | critical | ok |  | PAN-804 | Epic B: work agents must use pan primitives (sync-main/done) for history ops — never raw git rebase/reset/stash. |
| 8 | PAN-1864 | S | critical | ok |  | PAN-1861 | Review nudge fires but never synthesizes — deacon must derive synthesis DETERMINISTICALLY from on-disk reports. |
| 11 | PAN-1510 | M | critical | ok |  |  | Issues filed mid-session never appear in the frontend store tree/kanban (cache not invalidated). |
| 12 | PAN-1506 | M | critical | ok |  |  | Strike agents appear in /api/agents but never on the dashboard Agents page/store. |
| 13 | PAN-1508 | M | critical | ok |  | PAN-1027, PAN-863 | workspaces/feature-*/ debris consumes 220GB (~⅓ of host storage); post-merge cleanup never fully runs. |
| 16 | PAN-1456 | L | critical | ok |  |  | Pass-3 behavior audit handoff incomplete — fresh-context agent must finish verifying recent closes. |
| 17 | PAN-1861 | S | critical | ok |  |  | Review convoy parent still wedges waiting for sub-specialist signals after PAN-1818 — blocks merge cascade. |
| 18 | PAN-1865 | S | critical | ok |  |  | Kimi on claude-code harness hangs at 100% ctx ($22/agent) — CLIProxy advertises a false ~200k window. |
| 19 | PAN-804 | XL | critical | needs-refinement |  |  | Epic D: archaeological audit + pre-1.0 cleanup — must execute FIRST, before Epics A/B/C, on known-good ground. |
| 20 | PAN-1520 | L | high | ok |  |  | Unify 'agent awaiting input': finish AskUserQuestion + generic hooks; feed the dashboard INPUT badge. |
| 21 | PAN-807 | XL | critical | ok |  | PAN-804 | Epic C: stop spawn flow destroying local state — pre-flight checks guarantee a safe workspace before start. |
| 22 | PAN-1213 | L | high | ok |  |  | Synthesis→review-status bridge broken: passed PRs never reach the Awaiting-Merge page. |
| 23 | PAN-1214 | L | high | ok |  |  | Dashboard crashes on UnhandledPromiseRejection when deacon pokes a not-running agent. |
| 24 | PAN-1560 | L | high | ok |  |  | Re-review after a PR head moves (sync-main/rebase) doesn't re-post the required review status. |
| 25 | PAN-1499 | M | high | ok |  | PAN-1454 | Substrate pattern-2: block pan done when close-out honestly defers work ('will do X') with no follow-up. |
| 26 | PAN-1084 | M | high | ok |  |  | Safety: work agent self-approves subagent permission prompts via tmux send-keys — can silently authorize destructive ops. |
| 27 | PAN-2086 | M | high | ok |  |  | Startup speedup: incremental pan sync (skip-when-unchanged) + traefik precheck + listen-before-merge. |
| 28 | PAN-1557 | L | medium | ok |  |  | Run convoy reviewers as interactive, attachable sessions with hook-owned completion (not headless --print). |
| 29 | PAN-955 | M | high | ok |  |  | Devcontainer template has no versioning — template changes never re-render existing workspaces. |
| 30 | PAN-1193 | L | high | ok |  |  | Swarm slots branch independently with no file-overlap arbitration — two slots can clobber the same file. |
| 31 | PAN-1198 | L | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules; init/frontend fail. |
| 32 | PAN-1207 | L | high | ok |  |  | Review sub-specialists exit cleanly but state.json stays 'running' — deacon orphans healthy reviewers. |
| 33 | PAN-1209 | M | high | ok |  |  | Dashboard bead projection (40 open/0 closed) disagrees with workspace bd (opposite) after resume. |
| 34 | PAN-1435 | M | high | needs-refinement |  |  | Provider API keys stored plaintext in ~/.panopticon/config.yaml — at-rest exposure. |
| 35 | PAN-1498 | M | high | ok |  | PAN-1454 | Substrate pattern-1: require a live-code-path trace in review so code doesn't land in the wrong file. |
| 36 | PAN-1618 | M | high | ok |  |  | Work-spawn docker-health gate has no autonomous recovery — a sick container blocks all spawns until manual fix. |
| 37 | PAN-1698 | M | high | ok |  |  | main CI RED: model-count + schema-version + substrate-smoke tests failing on HEAD. |
| 38 | PAN-2085 | L | high | needs-refinement |  |  | Auto-isolate project conversations in a disposable git worktree (Conductor/Cursor pattern) — stop polluting shared main. |
| 39 | PAN-1766 | M | high | ok |  |  | Work agents hang on Claude Code settings-file protection prompts (class-2 scope split from PAN-1616). |
| 40 | PAN-1770 | M | high | ok |  |  | pan-dir auto-commit rebase races live .pan/continues during convoy bursts — rebase-failed storms. |
| 41 | PAN-1783 | M | high | ok |  | PAN-1698 | main CI RED after Command Deck redesign: resource-strip Playwright fixture failing. |
| 42 | PAN-1915 | M | high | ok |  |  | API-key at-rest hardening: startup perm check + OS keychain + deprecate plaintext storage. |
| 43 | PAN-605 | S | high | stale |  |  | Reconcile CLAUDE.md prompt assembly across all agent types — dead code + inconsistent composition. |
| 44 | PAN-1226 | M | high | ok |  |  | [META] unified-dashboard redesign: 32 gaps vs PRD and mockups — full audit tracker. |
| 45 | PAN-1263 | S | high | ok |  |  | Swarm UX: pipeline rows/IssueDrawer don't surface per-slot identity or progress. |
| 46 | PAN-1433 | S | high | ok |  |  | Conversation agents can leave the host main repo stranded in an abandoned git rebase. |
| 47 | PAN-1444 | S | high | ok |  | PAN-1416 | Follow-up to PAN-1416: add dashboard port lockfile + pan doctor multi-instance detection. |
| 48 | PAN-1461 | M | high | ok |  |  | Conversation transcript Ctrl+F only finds currently-rendered DOM text, not the full transcript. |
| 49 | PAN-1491 | M | medium | needs-refinement |  |  | Flywheel metric-aware prioritization: weight substrate-bug suggestions by which v1.0 blockers they fix (v1.0-required). |
| 50 | PAN-1556 | S | high | ok |  |  | Session/activity feed drowns in review-spawn noise (~11 entries/cycle), burying conversations. |
| 51 | PAN-262 | L | medium | stale |  |  | Post-merge lifecycle is fragmented across 3+ duplicated, inconsistent code paths. |
| 52 | PAN-578 | L | high | needs-refinement |  |  | Security: comment mediation layer to stop prompt injection via tracker comments. |
| 53 | PAN-1767 | M | medium | ok |  |  | No first-class surface for the merged-but-not-closed-out (verifying-on-main) queue — reached 21 deep. |
| 54 | PAN-1452 | L | medium | ok |  |  | Sub-reviewer (correctness/security/perf) has no Restart context-menu action (only parents got it). |
| 55 | PAN-1454 | XL | medium | ok |  |  | [META] Substrate audit: 31 of 80 recent closes needed action — root-cause the shipped-but-broken class. |
| 56 | PAN-1650 | L | medium | ok |  |  | readyForMerge is one boolean doing two jobs — merge-gate reject vs. operator-ready, causing pain. |
| 57 | PAN-538 | S | high | stale |  |  | Root Vite build occasionally doesn't regenerate the bundle on source change (stale hash). |
| 58 | PAN-1142 | L | medium | needs-refinement |  |  | Extend per-role/per-conversation config to accept a reasoning-effort level (low→max). |
| 59 | PAN-1232 | S | high | ok |  | PAN-1226 | IssueDrawer surface: largest bucket of PAN-1148 PRD gaps (width, scrim, animation). |
| 60 | PAN-1234 | S | high | ok |  | PAN-1226 | Cross-cutting app-shell gaps from the PAN-1148 audit (6 issues across surfaces). |
| 61 | PAN-1313 | L | medium | needs-refinement |  |  | Finish the src/lib Effect migration — additive bridge shipped, but the old imperative paths remain. |
| 62 | PAN-1416 | S | high | ok |  |  | Canonical-path guard + remaining multi-instance/dashboard-binding safety (parent of PAN-1444). |
| 63 | PAN-1504 | M | medium | needs-refinement |  |  | Codify the ad-hoc merge/commit/push hygiene check into a reusable dev skill. |
| 64 | PAN-1681 | S | high | ok |  |  | In-review PRs strand at test=pending though tests pass — blocks ship→ready_for_merge. |
| 65 | PAN-1824 | S | high | ok |  |  | Main CI flaky: ~5s timeouts on suites that pass locally (94/94 in 2.5s). |
| 66 | PAN-1913 | S | medium | ok |  |  | Add project 'description' field + bundle config niceties (project list polish). |
| 67 | PAN-2054 | S | high | ok |  |  | Closed + closed-out issue keeps showing as active pipeline work — close-out not clearing the read model. |
| 68 | PAN-2065 | L | high | needs-refinement |  |  | Unified provider usage & headroom panel — 2026-06-26 fleet stalled 10h on a silently-exhausted z.ai plan limit. |
| 69 | PAN-2059 | XL | high | needs-refinement |  |  | Epic: operator Plan→Release pickup gate + AI Objection (5th state) + Flywheel relevance-vetting. Mockups committed. |
| 70 | PAN-1436 | L | high | ok |  |  | Header 'stopped' count still mis-includes some running agents (follow-up to PAN-1419). |
| 71 | PAN-1711 | L | high | ok |  |  | Supervisor watchdog force-restarts the dashboard repeatedly within 45 min on health-probe noise. |
| 72 | PAN-1769 | L | high | ok |  |  | Conversation message eaten by submit-time compaction after resume; retry storm risk. |
| 73 | PAN-630 | L | medium | needs-refinement |  |  | Multi-tenant mode: shared instance with workspace ownership, ACLs, audit logging. |
| 74 | PAN-1195 | L | medium | needs-refinement |  |  | Swarm parent is paused (stoppedByUser) while swarm runs — confusing lifecycle state. |
| 75 | PAN-1196 | L | medium | needs-refinement |  |  | Every bead runs on one model regardless of complexity — no per-bead model selection. |
| 76 | PAN-1217 | M | medium | needs-refinement |  |  | Requirements reviewer treats the whole AC list as in-scope for every PR — coverage-matrix blowup. |
| 77 | PAN-1218 | M | medium | needs-refinement |  | PAN-1124 | Bead inspection adds ~3-5 min/bead (30% blow past 10 min) — throughput tax. |
| 78 | PAN-1219 | M | medium | needs-refinement |  |  | Synthesis prior-cycle SHA derivation is brittle (reads 2nd-newest review file). |
| 79 | PAN-1246 | L | medium | needs-refinement |  |  | Optimize VCS diff loading (t3code pattern) — up to 98% faster diff fetch. |
| 80 | PAN-1253 | L | medium | needs-refinement |  |  | Flywheel issue picker ignores dependency/graph signal — rework selection to respect edges. |
| 81 | PAN-1254 | L | medium | needs-refinement |  |  | Ship: Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 82 | PAN-1311 | L | medium | needs-refinement |  |  | Ship: Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 83 | PAN-1357 | L | medium | needs-refinement |  |  | Ship: Template conversations: load curated skill bundles into a single conversation |
| 84 | PAN-1424 | L | medium | needs-refinement |  | PAN-1122 | Ship: Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 85 | PAN-1497 | M | medium | needs-refinement |  |  | Ship: emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 86 | PAN-1525 | L | medium | ok |  |  | Ship: Composer autocomplete: expose all CLI args for every pan command |
| 87 | PAN-1538 | L | medium | ok |  |  | Ship: Unblock Pi source forks — remove API guard, verify transcript parsers |
| 88 | PAN-1558 | L | medium | ok |  |  | Ship: Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 89 | PAN-1561 | L | medium | ok |  |  | Ship: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 90 | PAN-1578 | L | medium | ok |  |  | Ship: GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 91 | PAN-1588 | L | medium | ok |  |  | Ship: PAN-800 Phase 5: eliminate parseThinkingDuration / capture-pane stuck detection |
| 92 | PAN-1594 | L | medium | ok |  |  | Ship: Hook-driven agent readiness (kill prompt-polling + permission-mode coupling) |
| 93 | PAN-1889 | M | medium | ok |  |  | Ship: retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run |
| 94 | PAN-2027 | L | medium | ok |  |  | Ship: ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 95 | PAN-49 | S | high | stale |  |  | Fix: Fix CloisterService tests that require real runtime |
| 96 | PAN-113 | S | high | stale |  |  | Fix: Dashboard 'Start Agent' returns success before verifying agent actually started |
| 97 | PAN-244 | S | high | stale |  |  | Fix: Deep-wipe leaves local branch and worktree metadata behind |
| 98 | PAN-245 | S | high | stale |  |  | Fix: Ctrl+C aborts planning dialog instead of copying text |
| 99 | PAN-247 | S | high | stale |  |  | Fix: Deacon has no backoff or escalation for repeated specialist startup failures |
| 100 | PAN-304 | S | high | stale |  |  | Fix: closeLinearDirect returns stepOk even when state update never happens |
| 101 | PAN-321 | S | high | stale |  |  | Fix: Ephemeral merge specialist fails silently for polyrepo MYN projects |
| 102 | PAN-324 | S | high | stale |  |  | Fix: Agent detail pane missing Merge/Approve button |
| 103 | PAN-334 | S | high | stale |  |  | Fix: Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 104 | PAN-673 | S | high | stale |  |  | Fix: virtualizer inline ref causes blank conversation page on large message lists |
| 105 | PAN-681 | S | high | stale |  |  | Fix: Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 106 | PAN-886 | S | high | ok |  |  | Fix: pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 107 | PAN-890 | S | high | ok |  |  | Fix: Conflict-resolver agent merges stale main snapshot and never pushes |
| 108 | PAN-899 | S | high | ok |  |  | Fix: Agent CLI commands fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE |
| 109 | PAN-900 | S | high | ok |  |  | Fix: Trust devroot for conversations + atomic .claude.json writes |
| 110 | PAN-928 | S | high | ok |  |  | Fix: verification-runner: polyrepo workspaces fail at sync-target-branch |
| 111 | PAN-929 | S | high | ok |  |  | Fix: review-run: polyrepo workspaces detect overlay repo instead of code repos |
| 112 | PAN-932 | S | high | ok |  |  | Fix: pan done: polyrepo uncommitted changes check + existing MR handling |
| 113 | PAN-933 | S | high | ok |  |  | Fix: Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 114 | PAN-1027 | S | high | ok |  |  | Fix: Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 115 | PAN-1038 | S | high | ok |  |  | Fix: Conversation diff panel always empty: conv.claudeSessionId is null for all conversations |
| 116 | PAN-1042 | S | high | ok |  |  | Fix: cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 117 | PAN-1068 | M | high | ok |  |  | Fix: PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 118 | PAN-1113 | S | high | ok |  |  | Fix: Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 119 | PAN-1128 | M | high | ok |  |  | Fix: Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 120 | PAN-1129 | S | high | ok |  |  | Fix: Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 121 | PAN-1130 | M | high | ok |  |  | Fix: Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 122 | PAN-1131 | M | high | ok |  |  | Fix: Stale idle synthesis session blocks review re-dispatch (idempotency guard can't tell 'reviewing' from 'finished-idle') |
| 123 | PAN-1149 | S | high | ok |  |  | Fix: v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 124 | PAN-1150 | M | high | ok |  |  | Fix: Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 125 | PAN-1173 | S | high | ok |  |  | Fix: pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 126 | PAN-1227 | S | high | ok |  |  | Fix: Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 127 | PAN-1240 | S | high | ok |  |  | Fix: Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 128 | PAN-1243 | S | high | ok |  |  | Fix: pan admin hooks install: resolver fails outside repo CWD (auto-config breaks flywheel resume) |
| 129 | PAN-1247 | S | high | ok |  |  | Fix: Substrate: deacon orphan-test recovery loops dispatch_failed forever on an unhealthy workspace docker stack |
| 130 | PAN-1258 | S | high | ok |  |  | Fix: Swarm slot spawn hangs silently before writeLauncherScriptAtomic when model=kimi-k2.6 |
| 131 | PAN-1330 | S | high | ok |  |  | Fix: CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 132 | PAN-1336 | S | high | ok |  |  | Fix: Swarm: pan swarm --auto-advance cannot advance — no slot-PR merger, slots never self-terminate |
| 133 | PAN-1386 | S | high | ok |  |  | Fix: Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 134 | PAN-1392 | S | high | ok |  |  | Fix: pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 135 | PAN-1434 | S | high | ok |  |  | Fix: conv-find.py reports session_file: N/A for newer conversation records (wrong column) |
| 136 | PAN-1438 | S | high | ok |  |  | Fix: pan flywheel start launcher process orphans when orchestrator dies externally |
| 137 | PAN-1439 | S | high | ok |  |  | Fix: Recover conv-2084's in-progress PANOPTICON_PROJECT_ROOT env var work |
| 138 | PAN-1440 | S | high | ok |  |  | Fix: Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 139 | PAN-1445 | S | high | ok |  |  | Fix: PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 140 | PAN-1446 | S | high | ok |  |  | Fix: PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 141 | PAN-1447 | S | high | ok |  |  | Fix: PAN-1194 follow-up: restore failed-merge slot UI deleted by sibling PAN-1148 merge |
| 142 | PAN-1449 | S | high | ok |  |  | Fix: PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 143 | PAN-1472 | S | high | ok |  |  | Fix: Swarm inspect agents emit pan tell to parent agent ID — fails when only slot agents exist |
| 144 | PAN-1530 | S | high | ok |  |  | Fix: Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 145 | PAN-2108 | M | high | ok |  |  | Flywheel can't recover context-exhausted/troubled work agents — RUN-30 root throughput blocker; needs a flywheel-safe recovery surface. |
| 146 | PAN-1564 | S | high | ok |  |  | Fix: Pi extension path + dashboard server spawn both depend on launch cwd (fix: resolve against packageRoot + pin spawn cwd) |
| 147 | PAN-1565 | S | high | ok |  |  | Fix: Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 148 | PAN-1570 | S | high | ok |  |  | Fix: Cost recorder silently dropped ALL cost events since 2026-05-21 (Effect-migration regression) |
| 149 | PAN-1571 | S | high | ok |  |  | Fix: Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N... |
| 150 | PAN-1582 | S | high | ok |  |  | Fix: Handoff fork falls back to summary: external authoring session stalls on Write permission |
| 151 | PAN-1624 | M | high | ok |  |  | Fix: pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 152 | PAN-2095 | M | high | ok |  |  | pan reload builds the divergent primary worktree, not origin/main — landed CI-green fixes never actually go live. |
| 153 | PAN-2106 | M | medium | ok |  |  | pan strike git-lock race leaves a broken partial workspace yet reports 'spawned' — false success blocks red-main reverts. |
| 154 | PAN-2088 | L | high | ok |  | PAN-1958 | Replace fragile tmux paste with pi extension control channel: steer/follow_up, effort, model, compact, quick-abort. In-review. |
| 155 | PAN-1673 | S | high | ok |  |  | Fix: Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 156 | PAN-1674 | S | high | ok |  |  | Fix: TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 157 | PAN-1775 | M | medium | ok |  |  | remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility reads as 'no agent' |
| 158 | PAN-2075 | XL | high | needs-refinement | ✓ |  | [EPIC] Boot Reconciliation + Operator Inbox: informed per-agent boot decisions + durable notification spine (local+remote). |
| 159 | PAN-2079 | L | high | needs-refinement |  |  | Operator Inbox: durable server-side queue + in-dashboard surface — the notification spine every producer posts to. |
| 160 | PAN-1718 | S | high | ok |  |  | Fix: Duplicate successful 'pan reload' restart-status writes from two unidentified concurrent processes |
| 161 | PAN-2091 | S | low | ok |  |  | Pure dead-code deletion: remove superseded IssueCockpitBody subtree (8 files); data-loss audit confirms nothing lost. |
| 162 | PAN-2145 | XL | medium | ok |  |  | Codebase-health: decompose routes/conversations.ts (4898 lines) into <1000-line modules behind a re-export barrel. |
| 163 | PAN-2077 | L | high | needs-refinement |  | PAN-1775 | One substrate-complete reconciliation inventory (local tmux + remote Fly) the dashboard and CLI both consume. |
| 164 | PAN-2076 | L | medium | needs-refinement |  | PAN-2077, PAN-2079 | Boot Reconciliation dashboard surface: informed per-agent Resume/Freeze/Kill replacing the all-or-nothing banner. |
| 165 | PAN-2146 | XL | medium | ok |  |  | Codebase-health: decompose src/lib/agents.ts (4572 lines) into <1000-line modules behind a re-export barrel. |
| 166 | PAN-1795 | S | high | ok |  |  | Fix: Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 167 | PAN-1816 | S | high | ok |  |  | Fix: Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag +... |
| 168 | PAN-2147 | XL | medium | ok |  |  | Codebase-health: decompose routes/agents.ts (4071 lines) into <1000-line modules behind a re-export barrel. |
| 169 | PAN-2080 | M | medium | needs-refinement |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) for offline reach; fast-follow to the inbox spine. |
| 170 | PAN-1828 | S | high | ok |  |  | Fix: Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 171 | PAN-1830 | M | high | ok |  |  | Fix: Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 172 | PAN-2078 | M | medium | needs-refinement |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all/--select/--freeze/--kill-remote. |
| 173 | PAN-2084 | L | medium | needs-refinement |  | PAN-2085 | Auto-create lightweight conversation worktrees (conv/<slug> branch, fetch-first, bun install only). |
| 174 | PAN-1897 | M | high | ok |  |  | Fix: pan start workspace-prep hangs/times out (>120s) on re-entry — blocks PAN-1711, PAN-1827 (no spawn, no error) |
| 175 | PAN-2148 | XL | medium | ok |  |  | Codebase-health: decompose routes/issues.ts (4065 lines) into <1000-line modules behind a re-export barrel. |
| 176 | PAN-1912 | S | high | ok |  |  | Fix: Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 177 | PAN-1776 | M | medium | ok |  |  | Ship: hot-updatable delivery path — version-stamped supervisors, rolling refresh, and dumb-shim primitives with server-side delivery logic |
| 178 | PAN-1791 | M | medium | ok |  |  | Ship: Tiered execution: difficulty-routed bead dispatch + event-driven supervisor review (standing tier agents with plan-filtered commit... |
| 179 | PAN-1852 | M | medium | ok |  |  | Ship: Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 180 | PAN-1862 | M | medium | ok |  |  | Ship: cache-sharing review convoy — warm-parent fork, model-uniformity guard, and resumable selective re-review |
| 181 | PAN-608 | M | medium | stale |  |  | Ship: Integrate Destructive Command Guard (dcg) with configurable settings |
| 182 | PAN-783 | M | medium | needs-refinement |  |  | Ship: Agents Page Redesign — Unified Multi-View Experience |
| 183 | PAN-947 | M | medium | needs-refinement |  |  | Ship: project management actions in unified sidebar |
| 184 | PAN-1102 | M | medium | needs-refinement |  |  | Ship: real-time notification + interactive prompts when agent awaits user input |
| 185 | PAN-1164 | M | medium | needs-refinement |  |  | Ship: Push diff summary updates over /ws/rpc instead of 5s polling |
| 186 | PAN-1488 | M | medium | needs-refinement |  |  | Ship: add required_pull_request_reviews to main branch protection |
| 187 | PAN-1577 | M | medium | ok |  |  | Ship: Move a conversation to a different project (CLI + drag/drop + menu action) |
| 188 | PAN-1610 | M | medium | ok |  |  | Ship: Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards, IssueDrawer) |
| 189 | PAN-813 | M | medium | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 190 | PAN-1451 | M | medium | ok |  |  | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 191 | PAN-1544 | L | medium | ok |  |  | Architect: Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 192 | PAN-399 | L | medium | needs-refinement |  |  | Ship: Release specialist — coordinated post-merge rollout and release safety |
| 193 | PAN-532 | L | medium | needs-refinement |  |  | Ship: Per-project and per-issue model overrides for workflow agent model selection |
| 194 | PAN-817 | L | medium | needs-refinement |  |  | Ship: Improve planning dialog layout and content fit |
| 195 | PAN-924 | L | medium | needs-refinement |  |  | Ship: Spike: evaluate GitNexus for Panopticon integration |
| 196 | PAN-1040 | L | medium | needs-refinement |  |  | Ship: event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 197 | PAN-1041 | L | medium | needs-refinement |  |  | Ship: Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 198 | PAN-1103 | L | medium | needs-refinement |  |  | Ship: surface AskUserQuestion choice options in conversation view |
| 199 | PAN-1469 | S | medium | needs-refinement |  |  | Doc: End-to-end review and consolidation of all project documentation |
| 200 | PAN-1494 | S | medium | needs-refinement |  |  | Doc: register docs/FLYWHEEL-VISION on panopticon-cli.com (Mintlify) — needed for public sharing |
| 201 | PAN-1684 | S | medium | ok |  |  | Doc: build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 202 | PAN-2037 | L | medium | needs-refinement |  |  | Ship: UI: prominent 'Start work agent' CTA on all issue surfaces when agent is stopped |
| 203 | PAN-37 | M | medium | stale |  |  | Ship: Support external PR selection for merge-agent |
| 204 | PAN-38 | M | medium | stale |  |  | Ship: Support multiple merge agents per repository |
| 205 | PAN-77 | M | medium | stale |  |  | Ship: Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 206 | PAN-111 | M | medium | stale |  |  | Ship: Support cross-machine planning state sync without cross-contamination |
| 207 | PAN-243 | M | medium | stale |  |  | Ship: Audit dashboard actions: ensure all are available via CLI |
| 208 | PAN-252 | M | medium | stale |  |  | Ship: Disable Sync with Main button when workspace is up to date |
| 209 | PAN-255 | M | medium | stale |  |  | Ship: Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 210 | PAN-258 | M | medium | stale |  |  | Ship: Kanban board: fit all columns without horizontal scrolling |
| 211 | PAN-277 | M | medium | stale |  |  | Ship: Session reasoning capture & collaborative PRD refinement |
| 212 | PAN-293 | M | medium | stale |  |  | Ship: Project Living Memory — per-project semantic memory for agents |
| 213 | PAN-294 | M | medium | stale |  |  | Ship: Surface module initialization errors as system-level, not per-issue |
| 214 | PAN-450 | M | medium | stale |  |  | Ship: Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 215 | PAN-452 | M | medium | stale |  |  | Ship: Conversation input bar — mode/permissions/workspace selectors |
| 216 | PAN-2149 | L | medium | ok |  |  | Codebase-health: decompose lib/cloister/service.ts (2039 lines) into <1000-line modules behind a re-export barrel. |
| 217 | PAN-456 | M | medium | stale |  |  | Ship: Store Claude Code session IDs for agent resume after crash/restart |
| 218 | PAN-463 | M | medium | stale |  |  | Ship: Add Qwen 3.6+ model support |
| 219 | PAN-465 | M | medium | stale |  |  | Ship: Add OpenRouter as a model provider |
| 220 | PAN-466 | M | medium | stale |  |  | Ship: Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 221 | PAN-531 | M | medium | stale |  |  | Ship: PAN: Windows Electron support (WSL2 required) |
| 222 | PAN-546 | M | medium | stale |  |  | Ship: Remove claude-code-router — all providers use direct env var injection |
| 223 | PAN-548 | M | medium | stale |  |  | Ship: Command Deck: preserve state across navigation including URL routing for tabs |
| 224 | PAN-606 | M | medium | stale |  |  | Ship: Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 225 | PAN-607 | M | medium | stale |  |  | Ship: Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 226 | PAN-613 | M | medium | stale |  |  | Ship: Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 227 | PAN-629 | M | medium | needs-refinement |  |  | Ship: Workspace quotas and resource governance |
| 228 | PAN-637 | M | medium | needs-refinement |  |  | Ship: Direct issue kickoff (skip planning) from dashboard UI |
| 229 | PAN-649 | M | medium | needs-refinement |  |  | Ship: Render Excalidraw drawings inline in Claude Code conversations |
| 230 | PAN-654 | M | medium | needs-refinement |  |  | Ship: Project Setup Wizard — Dashboard UI |
| 231 | PAN-675 | M | medium | needs-refinement |  |  | Ship: Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 232 | PAN-678 | M | medium | needs-refinement |  |  | Ship: pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 233 | PAN-687 | M | medium | needs-refinement |  |  | Ship: Support OpenCode as alternative coding agent |
| 234 | PAN-818 | M | medium | needs-refinement |  |  | Ship: Make summary optional when forking conversations |
| 235 | PAN-901 | M | medium | needs-refinement |  |  | Ship: Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 236 | PAN-902 | M | medium | needs-refinement |  |  | Ship: Settings: add 'Run pan sync' button to configuration menu |
| 237 | PAN-903 | M | medium | needs-refinement |  |  | Ship: Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 238 | PAN-938 | M | medium | needs-refinement |  |  | Ship: Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 239 | PAN-949 | M | medium | needs-refinement |  |  | Ship: add conversation for project from sidebar |
| 240 | PAN-958 | M | medium | needs-refinement |  |  | Ship: Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 241 | PAN-1037 | M | medium | needs-refinement |  |  | Ship: Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 242 | PAN-1060 | M | medium | needs-refinement |  |  | Ship: Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 243 | PAN-1151 | M | medium | needs-refinement |  |  | Ship: Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 244 | PAN-1165 | M | medium | needs-refinement |  |  | Ship: Lightweight review path for small/trivial PRs |
| 245 | PAN-1202 | M | medium | needs-refinement |  |  | Ship: Swarm: prune merged/completed slot state directories after wave converges |
| 246 | PAN-1223 | M | medium | needs-refinement |  |  | Ship: Auto-update for users in the field (npm + desktop binaries) |
| 247 | PAN-1432 | M | medium | needs-refinement |  |  | Ship: Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 248 | PAN-1437 | M | medium | needs-refinement |  |  | Ship: pan flywheel report semantics: split read-only snapshot from run finalization |
| 249 | PAN-1442 | M | medium | needs-refinement |  |  | Ship: Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 250 | PAN-1443 | M | medium | needs-refinement |  |  | Ship: Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 251 | PAN-1453 | M | medium | needs-refinement |  |  | Ship: Audit: 3 cheap verifications that should ride along with merges (PAN-1170, PAN-1316, PAN-457 CLI parity) |
| 252 | PAN-1473 | M | medium | needs-refinement |  |  | Ship: Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 253 | PAN-1485 | M | medium | needs-refinement |  |  | Ship: Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 254 | PAN-1489 | M | medium | needs-refinement |  |  | Ship: task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 255 | PAN-1490 | M | medium | needs-refinement |  |  | Ship: show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 256 | PAN-1524 | M | medium | ok |  |  | Ship: Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 257 | PAN-1542 | M | medium | ok |  |  | Ship: Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 258 | PAN-1545 | M | medium | ok |  |  | Ship: New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 259 | PAN-1623 | M | medium | ok |  |  | Ship: Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 260 | PAN-1653 | M | medium | ok |  |  | Ship: perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 261 | PAN-1654 | M | medium | ok |  |  | Ship: perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 262 | PAN-1655 | M | medium | ok |  |  | Ship: Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 263 | PAN-1656 | M | medium | ok |  |  | Ship: Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 264 | PAN-1657 | M | medium | ok |  |  | Ship: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 265 | PAN-1666 | XL | medium | ok |  |  | Ship: [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out |
| 266 | PAN-1671 | M | medium | ok |  |  | Ship: surface pending ExitPlanMode plan as a popup modal (reuse PlanCard + /plan-action) |
| 267 | PAN-1672 | M | medium | ok |  |  | Ship: GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 268 | PAN-1676 | M | medium | ok |  |  | Ship: harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 269 | PAN-1685 | M | medium | ok |  |  | Ship: Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 270 | PAN-1837 | M | medium | ok |  |  | Ship: Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 271 | PAN-1838 | M | medium | ok |  |  | Ship: [research] Grok Build (xAI) coding harness — research and specify support |
| 272 | PAN-1839 | M | medium | ok |  |  | Ship: Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 273 | PAN-1840 | M | medium | ok |  |  | Ship: Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 274 | PAN-1844 | M | medium | ok |  |  | Ship: Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 275 | PAN-1853 | M | medium | ok |  |  | Ship: Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 276 | PAN-1854 | M | medium | ok |  |  | Ship: Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 277 | PAN-1916 | M | medium | ok |  |  | Ship: configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 278 | PAN-1955 | M | medium | ok |  |  | Ship: Issue cockpit: move beads from a tab into a persistent right rail with a 'working now' highlight |
| 279 | PAN-1965 | M | medium | ok |  |  | Ship: Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 280 | PAN-1966 | M | medium | ok |  |  | Ship: Single authoritative pipeline-membership resolver — one function for "what's in the pipeline" (collapse the 5 divergent views) |
| 281 | PAN-1967 | M | medium | ok |  |  | Ship: Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 282 | PAN-1968 | M | medium | ok |  |  | Ship: Finish local-domain rename: pan.localhost → overdeck.localhost |
| 283 | PAN-1985 | M | medium | ok |  |  | Ship: Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 284 | PAN-1991 | M | medium | ok |  |  | Ship: Issue cockpit redesign — incremental rollout (tracking) |
| 285 | PAN-1995 | M | medium | ok |  |  | Ship: infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 286 | PAN-2004 | M | medium | ok |  |  | Ship: Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 287 | PAN-2082 | S | medium | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles, reopening a data-loss window. |
| 288 | PAN-2083 | S | medium | ok |  |  | Composer: a failed first send leaves text in BOTH composer and retry outbox — double-send hazard. |
| 289 | PAN-2024 | M | medium | ok |  |  | Ship: ohmypi: frontend Tools-toggle for conversation view |
| 290 | PAN-2025 | M | medium | ok |  |  | Ship: ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 291 | PAN-2026 | M | medium | ok |  |  | Ship: ohmypi: surface 35+ provider matrix in dashboard model picker |
| 292 | PAN-2028 | M | medium | ok |  |  | Ship: ohmypi: per-provider cost grouping in cost dashboard |
| 293 | PAN-2029 | M | medium | ok |  |  | Ship: ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 294 | PAN-2030 | M | medium | ok |  |  | Ship: ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 295 | PAN-2031 | M | medium | ok |  |  | Ship: ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 296 | PAN-2032 | M | medium | ok |  |  | Ship: ohmypi: local Ollama model as zero-cost preliminary review role |
| 297 | PAN-2033 | M | medium | ok |  |  | Ship: ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 298 | PAN-2034 | M | medium | ok |  |  | Ship: ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 299 | PAN-2035 | M | medium | ok |  |  | Ship: ohmypi: GitHub Copilot subscription provider routing via omp |
| 300 | PAN-2053 | M | medium | ok |  |  | Ship: Dashboard: read-only "why this model" (resolved + weighted distribution + hash) at the top of the agent Start/Restart submenu (foll... |
| 301 | PAN-1533 | M | medium | ok |  |  | Fork-into-worktree from conversation branch chip |
| 302 | PAN-1696 | M | medium | ok |  |  | decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view |
| 303 | PAN-1592 | M | medium | ok |  |  | Composer: persist pending images + unsent/failed text across reload (draft-text parity). |
| 304 | PAN-2005 | M | medium | ok |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 305 | PAN-2006 | M | medium | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 306 | PAN-1101 | M | medium | ok |  |  | Permission safety hardening: CI guard, single emission chokepoint, property tests, runtime tripwire |
| 307 | PAN-1122 | M | medium | ok |  |  | Trim OpenAI model catalog to 5 supported models |
| 308 | PAN-1547 | M | medium | ok |  |  | @panctl/cli npm install warns on Node <22 (engine mismatch + deprecated deps) |
| 309 | PAN-1705 | M | medium | ok |  |  | conversation click stuck on Loading… for minutes during pipeline load — fat-poll request queueing collapse |
| 310 | PAN-1706 | M | medium | ok |  |  | orphaned playwright-mcp headless Chromiums keep full dashboard pages open — each multiplies dashboard poll load |
| 311 | PAN-1868 | M | medium | ok |  |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 312 | PAN-1896 | M | medium | ok |  |  | Reduce approval friction for GitHub CLI operations in managed sessions |
| 313 | PAN-1951 | M | medium | ok |  |  | Inspector agent should resume a warm session instead of cold-spawning a new one per bead |
| 314 | PAN-537 | L | medium | needs-refinement |  |  | show changed files diff summary after each agent response in activity view |
| 315 | PAN-592 | L | medium | needs-refinement |  |  | Audit: Planning agent CLAUDE.md and STATE.md contents vs expectations |
| 316 | PAN-633 | S | low | ok |  |  | Doc: Update Cloister PRD and docs index — stale relative to implementation |
| 317 | PAN-634 | S | low | ok |  |  | Doc: Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 318 | PAN-646 | L | medium | needs-refinement |  |  | Canceled issues: add guided Recover workflow |
| 319 | PAN-674 | S | low | ok |  |  | Doc: add glossary of Panopticon domain terms |
| 320 | PAN-700 | L | medium | needs-refinement |  |  | Detachable terminal for conversation view — popout into OS window |
| 321 | PAN-713 | L | medium | needs-refinement |  |  | test: add unit tests for doneCommand and approveCommand |
| 322 | PAN-802 | L | medium | needs-refinement |  |  | Resume on conversation session forks instead of resuming |
| 323 | PAN-826 | L | medium | needs-refinement |  |  | Conversation/terminal integration refactor: instant-start + parser correctness + T3Code structural alignment |
| 324 | PAN-863 | L | medium | needs-refinement |  |  | Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees) |
| 325 | PAN-1474 | S | low | ok |  |  | Doc: Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 326 | PAN-1555 | S | low | ok |  |  | Doc: remove/update stale swarm-runtime references after PAN-1517 |
| 327 | PAN-1683 | S | low | ok |  |  | Doc: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out... |
| 328 | PAN-43 | M | medium | ok |  |  | Add Slack and email notifications for agent events |
| 329 | PAN-44 | M | medium | ok |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 330 | PAN-47 | M | medium | ok |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 331 | PAN-51 | M | medium | ok |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 332 | PAN-52 | M | medium | ok |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 333 | PAN-54 | M | medium | ok |  |  | Add pan test:e2e command for full workflow integration test |
| 334 | PAN-55 | M | medium | ok |  |  | Track specialist costs with time period filtering |
| 335 | PAN-104 | M | medium | ok |  |  | Cost alerts/notifications when spending exceeds thresholds |
| 336 | PAN-106 | M | medium | ok |  |  | Cost prediction/estimation for in-progress work |
| 337 | PAN-146 | M | medium | ok |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 338 | PAN-155 | M | medium | ok |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 339 | PAN-175 | M | medium | ok |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 340 | PAN-176 | M | medium | ok |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 341 | PAN-177 | M | medium | ok |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 342 | PAN-178 | M | medium | ok |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 343 | PAN-180 | M | medium | ok |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 344 | PAN-190 | M | medium | ok |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 345 | PAN-198 | M | medium | ok |  |  | Structured audit trail for agent actions |
| 346 | PAN-227 | M | medium | ok |  |  | Phase gate validation — mid-implementation acceptance checks |
| 347 | PAN-228 | M | medium | ok |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 348 | PAN-241 | M | medium | ok |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 349 | PAN-249 | M | medium | ok |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 350 | PAN-265 | M | medium | ok |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 351 | PAN-271 | M | medium | ok |  |  | Auto-assign Linear project from project config when creating issues |
| 352 | PAN-283 | M | medium | ok |  |  | Reset should sync workspace feature branch with latest main |
| 353 | PAN-297 | M | medium | ok |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 354 | PAN-298 | M | medium | ok |  |  | Auto-detect package manager and runtime in workspace setup |
| 355 | PAN-299 | M | medium | ok |  |  | Granular session state persistence across context compaction |
| 356 | PAN-306 | M | medium | ok |  |  | merge-agent polyrepo false failures — stale refs, wrong error field, short timeout |
| 357 | PAN-371 | M | medium | ok |  |  | Agents tab only shows global specialists, not per-project ephemeral ones |
| 358 | PAN-407 | M | medium | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 359 | PAN-438 | M | medium | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 360 | PAN-459 | M | medium | ok |  |  | Planning setup screen with SSE progress streaming |
| 361 | PAN-461 | M | medium | ok |  |  | Deep-wipe multi-step progress dialog |
| 362 | PAN-468 | M | medium | ok |  |  | Agent test conversations pollute production database — need test isolation |
| 363 | PAN-471 | M | medium | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 364 | PAN-472 | M | medium | ok |  |  | GET /api/costs/by-issue takes 10s — N+1 query on 353K rows × 184 issues |
| 365 | PAN-476 | M | medium | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 366 | PAN-480 | M | medium | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 367 | PAN-483 | M | medium | ok |  |  | Unify Resume Agent UX — all entry points should show message input |
| 368 | PAN-487 | M | medium | ok |  |  | VBRIEF not archived to docs/prds/completed/ after merge |
| 369 | PAN-543 | M | medium | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 370 | PAN-552 | M | medium | ok |  |  | Claude Code terminals should respect app light/dark mode scheme |
| 371 | PAN-554 | M | medium | ok |  |  | Add kanban board deeplinks for issue URLs |
| 372 | PAN-564 | M | medium | ok |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 373 | PAN-565 | M | medium | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 374 | PAN-568 | M | medium | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 375 | PAN-570 | M | medium | ok |  |  | Show PLAN badge on costs when under a subscription/plan |
| 376 | PAN-571 | M | medium | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 377 | PAN-576 | M | medium | ok |  |  | Global / search should include conversations in addition to workspace features |
| 378 | PAN-589 | M | medium | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 379 | PAN-591 | M | medium | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 380 | PAN-603 | M | medium | ok |  |  | Plan review loop with configurable reviewer model |
| 381 | PAN-604 | M | medium | ok |  |  | Hide planning agent from workspace detail pane |
| 382 | PAN-622 | M | medium | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 383 | PAN-623 | M | medium | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 384 | PAN-624 | M | medium | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 385 | PAN-656 | M | medium | ok |  |  | Docs site scroll broken: dashboard CSS leaks onto panopticon-cli.com |
| 386 | PAN-658 | M | medium | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 387 | PAN-660 | M | medium | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 388 | PAN-663 | M | medium | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 389 | PAN-683 | M | medium | ok |  |  | shadow-state getPendingSyncCount test is environment-dependent |
| 390 | PAN-701 | M | medium | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 391 | PAN-702 | M | medium | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 392 | PAN-709 | M | medium | ok |  |  | self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 393 | PAN-727 | M | medium | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 394 | PAN-730 | M | medium | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 395 | PAN-735 | M | medium | ok |  |  | Settings page: review and configure overridden subagent model files |
| 396 | PAN-736 | M | medium | ok |  |  | wire per-subagent model overrides from settings to Claude Code spawn env |
| 397 | PAN-738 | M | medium | ok |  |  | Add right-click fork option to conversation list |
| 398 | PAN-743 | M | medium | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 399 | PAN-747 | M | medium | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 400 | PAN-749 | M | medium | ok |  |  | Research and borrow best features from gstack |
| 401 | PAN-750 | M | medium | ok |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 402 | PAN-751 | M | medium | ok |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 403 | PAN-752 | M | medium | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 404 | PAN-762 | M | medium | ok |  |  | Settings: warn when model overrides target disabled providers |
| 405 | PAN-764 | M | medium | ok |  |  | Add quota/usage inspector for routed model providers |
| 406 | PAN-765 | M | medium | ok |  |  | Preserve trailing zeros in cost displays |
| 407 | PAN-769 | M | medium | ok |  |  | Track verification/review/test phase churn over time |
| 408 | PAN-771 | M | medium | ok |  |  | Investigate Vercel Sandbox execution backend support |
| 409 | PAN-772 | M | medium | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 410 | PAN-773 | M | medium | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 411 | PAN-774 | M | medium | ok |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 412 | PAN-775 | M | medium | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 413 | PAN-777 | M | medium | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 414 | PAN-778 | M | medium | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 415 | PAN-780 | M | medium | ok |  |  | Agent stuck in feedback loop when old feedback files exist but review has passed |
| 416 | PAN-786 | M | medium | ok |  |  | Post planning Q\&A answers as issue comment |
| 417 | PAN-790 | M | medium | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 418 | PAN-791 | M | medium | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 419 | PAN-793 | M | medium | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 420 | PAN-797 | M | medium | ok |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 421 | PAN-810 | M | medium | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 422 | PAN-832 | M | medium | ok |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 423 | PAN-833 | M | medium | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 424 | PAN-834 | M | medium | ok |  |  | Cleanup: legacy ~/.panopticon/heartbeats/ directory has not been written since 2026-04-22 |
| 425 | PAN-835 | M | medium | ok |  |  | Workspace creation removes stale .planning/ from previous issue but doesn't commit deletion → PR diff includes 982 unrelated lines |
| 426 | PAN-838 | M | medium | ok |  |  | synthesis.json contains hallucinated timestamp + sparse structure (only counts, no findings arrays) |
| 427 | PAN-853 | M | medium | ok |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 428 | PAN-898 | M | medium | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 429 | PAN-904 | M | medium | ok |  |  | Make AI title generation model configurable |
| 430 | PAN-908 | M | medium | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 431 | PAN-927 | M | medium | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 432 | PAN-943 | M | medium | ok |  |  | Add memory file review and management command |
| 433 | PAN-944 | M | medium | ok |  |  | Make vBRIEF the durable task graph source of truth |
| 434 | PAN-948 | M | medium | ok |  |  | Implement pan scope lifecycle commands |
| 435 | PAN-961 | M | medium | ok |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 436 | PAN-962 | M | medium | ok |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 437 | PAN-984 | M | medium | ok |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 438 | PAN-1049 | M | medium | ok |  |  | Spike: evaluate Tauri v2 desktop shell |
| 439 | PAN-1051 | M | medium | ok |  |  | Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 440 | PAN-1063 | M | medium | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 441 | PAN-1064 | M | medium | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 442 | PAN-1065 | M | medium | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 443 | PAN-1066 | M | medium | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 444 | PAN-1115 | M | medium | ok |  |  | Inject observation context into agent prompts |
| 445 | PAN-1116 | M | medium | ok |  |  | Memory: cross-project search mode |
| 446 | PAN-1117 | M | medium | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 447 | PAN-1121 | M | medium | ok |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 448 | PAN-1123 | M | medium | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 449 | PAN-1124 | M | medium | ok |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 450 | PAN-1126 | M | medium | ok |  |  | Integrate TLDR summaries into review context manifest |
| 451 | PAN-1133 | M | medium | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 452 | PAN-1135 | M | medium | ok |  |  | Document the hook system in docs/HOOKS.md |
| 453 | PAN-1136 | M | medium | ok |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 454 | PAN-1147 | M | medium | ok |  |  | Work-agent done flow stalls at 'push and re-request review' after addressing review feedback |
| 455 | PAN-1152 | M | medium | ok |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 456 | PAN-1153 | M | medium | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 457 | PAN-1154 | M | medium | ok |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 458 | PAN-1166 | M | medium | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 459 | PAN-1208 | M | medium | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 460 | PAN-1222 | M | medium | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 461 | PAN-1238 | M | medium | ok |  |  | Board view follow-up — + New issue column footer button (deferred from PAN-1229) |
| 462 | PAN-1242 | M | medium | ok |  |  | Board view follow-up — + New issue column footer button (deferred from PAN-1229) |
| 463 | PAN-1244 | M | medium | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 464 | PAN-1245 | M | medium | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 465 | PAN-1325 | M | medium | ok |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 466 | PAN-1356 | M | medium | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 467 | PAN-1479 | M | medium | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 468 | PAN-1480 | M | medium | ok |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 469 | PAN-1481 | M | medium | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 470 | PAN-1482 | M | medium | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 471 | PAN-1483 | M | medium | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 472 | PAN-1493 | M | medium | ok |  |  | TEST: write hello.txt — probe for PAN-1200 Universal Context System verification |
| 473 | PAN-1548 | M | medium | ok |  |  | npx @panctl/cli shows stale placeholder message referencing v0.8.0 |
| 474 | PAN-1550 | M | medium | ok |  |  | FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 475 | PAN-1552 | M | medium | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 476 | PAN-1553 | M | medium | ok |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 477 | PAN-1572 | M | medium | ok |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 478 | PAN-1573 | M | medium | ok |  |  | Consideration for reintroducing ability to --dangerously-skip-permissions, DO NOT act on this issue |
| 479 | PAN-1581 | M | medium | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 480 | PAN-2069 | M | medium | ok |  |  | Caveman follow-up gaps: review-agent mode never set at spawn, no hook-execution test, missing Settings toggle. |
| 481 | PAN-1619 | M | medium | ok |  |  | Bridge host Codex auth into workspace containers + honest gpt-5.5 lock reason |
| 482 | PAN-1620 | M | medium | ok |  |  | Awaiting-Merge button is clickable on a conflicting/CI-failing PR (stale blockerReasons) |
| 483 | PAN-1621 | M | medium | ok |  |  | pan close human-only gate over-blocks operator conv-* sessions |
| 484 | PAN-1622 | M | medium | ok |  |  | pan dev restart leaves orphan dashboard servers (stale serving + multi-Deacon risk) |
| 485 | PAN-1627 | M | medium | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approv... |
| 486 | PAN-1640 | M | medium | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 487 | PAN-1641 | M | medium | ok |  |  | Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness |
| 488 | PAN-1643 | M | medium | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 489 | PAN-1644 | M | medium | ok |  |  | Hook-driven progressive conversation titling |
| 490 | PAN-1646 | M | medium | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 491 | PAN-1667 | M | medium | ok |  |  | unify Agents + Resources into one issue-centric holistic view |
| 492 | PAN-1668 | M | medium | ok |  |  | right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 493 | PAN-1669 | M | medium | ok |  |  | restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 494 | PAN-1670 | M | medium | ok |  |  | pan dev hot-reload wedges tabs on 'Reconnecting to the dashboard…' — PAN-1580 boot watchdog never fires under Vite |
| 495 | PAN-1691 | M | medium | ok |  |  | conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 496 | PAN-1708 | M | medium | ok |  |  | pan start CLI never flips spec plan.status proposed→approved — all 8 in-flight specs stuck at proposed, triggering reconciler misfires |
| 497 | PAN-1710 | M | medium | ok |  |  | 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server boots, h... |
| 498 | PAN-1720 | M | medium | ok |  |  | cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 499 | PAN-1726 | M | medium | ok |  |  | postMergeLifecycle did not pause the merged issue's work agent — idle agent holds a work slot and throttles all pipeline dispatch (PAN-16... |
| 500 | PAN-1728 | M | medium | ok |  |  | PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 501 | PAN-1729 | M | medium | ok |  |  | test(beads): beads-scoping work.md "-l {{ISSUE_ID_LOWER}}" label-filter assertion fails on main |
| 502 | PAN-1730 | M | medium | ok |  |  | idle awaiting-test work sessions count against the PAN-1665 ceiling — pipeline livelocks when work pool alone exceeds total (work=7/9 obs... |
| 503 | PAN-1734 | M | medium | ok |  |  | request-review-nudge remote workspace HEAD test fails on main |
| 504 | PAN-1735 | M | medium | ok |  |  | adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 505 | PAN-1739 | M | medium | ok |  |  | Command Deck issue TREE still hides strike agents — frontend FeatureItem session-type allowlist omits 'strike' (4th allowlist miss); dead... |
| 506 | PAN-1740 | M | medium | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 507 | PAN-1748 | M | medium | ok |  |  | reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 508 | PAN-1750 | M | medium | ok |  |  | UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 509 | PAN-1751 | M | medium | ok |  |  | harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 510 | PAN-1754 | M | medium | ok |  |  | surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 511 | PAN-1755 | M | medium | ok |  |  | uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 512 | PAN-1758 | M | medium | ok |  |  | ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; readyForMerge only ever flips via the startup r... |
| 513 | PAN-1761 | M | medium | ok |  |  | conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-* origin) |
| 514 | PAN-1762 | M | medium | ok |  |  | Swarm v2: tracer-bullet planning contract (Path A) + foreman-driven intra-issue swarms (Path B) |
| 515 | PAN-1773 | M | medium | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 516 | PAN-1774 | M | medium | ok |  |  | workspace server container crashloops when dist/dashboard/server.js is missing |
| 517 | PAN-1782 | M | medium | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 518 | PAN-1846 | M | medium | ok |  |  | unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 519 | PAN-1874 | M | medium | ok |  |  | per-issue override for review mode / re-review scope (extends PAN-1862 project-scope config) |
| 520 | PAN-1878 | M | medium | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 521 | PAN-1894 | M | medium | ok |  |  | Show UAT stack startup state in issue tree and issue slide-out |
| 522 | PAN-1895 | M | medium | ok |  |  | Spawn work agents from issue workspace slide-out |
| 523 | PAN-1906 | M | medium | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 524 | PAN-1907 | M | medium | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywh... |
| 525 | PAN-1910 | M | medium | ok |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 526 | PAN-1914 | M | medium | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 527 | PAN-1917 | M | medium | ok |  |  | /sessions page redesign: unify with conversation view |
| 528 | PAN-1918 | M | medium | ok |  |  | full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls the onl... |
| 529 | PAN-1926 | M | medium | ok |  |  | --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 530 | PAN-1935 | M | medium | ok |  |  | pi/kimi work-agent cost not recorded in cost_events → runaway spend is invisible (no cost-based safety possible) |
| 531 | PAN-1936 | M | medium | ok |  |  | Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 532 | PAN-1937 | M | medium | ok |  |  | data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 533 | PAN-1949 | M | medium | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all bead verdicts |
| 534 | PAN-1953 | M | medium | ok |  |  | Design: beads rail mockup |
| 535 | PAN-1954 | M | medium | ok |  |  | Beads rail: move beads to right sidebar, highlight active work |
| 536 | PAN-1958 | M | medium | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 537 | PAN-1963 | M | medium | ok |  |  | Default to no-resume on dashboard boot; add 'Resume all' to the stopped-agents banner |
| 538 | PAN-1980 | M | medium | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 539 | PAN-1983 | M | medium | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 540 | PAN-1984 | M | medium | ok |  |  | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 541 | PAN-1986 | M | medium | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 542 | PAN-1987 | M | medium | ok |  |  | Allow renaming a registered project (display name is locked at registration) |
| 543 | PAN-1988 | M | medium | ok |  |  | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 544 | PAN-1990 | M | medium | ok |  |  | First-class workspaces and projects with per-workspace memory |
| 545 | PAN-1999 | M | medium | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 546 | PAN-2002 | M | medium | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 547 | PAN-2008 | M | medium | ok |  |  | store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 548 | PAN-2045 | M | medium | ok |  |  | perf(test): frontend vitest (jsdom) is the test-gate bottleneck — ~5min vs ~72s root; move to happy-dom / tune pool |
| 549 | PAN-2046 | M | medium | ok |  |  | Conversation view does not surface terminal command responses |
| 550 | PAN-1884 | M | medium | ok |  |  | Migrate panopticon agent operational rules from conversation-memory into the scope:dev rule/role layer; complete on main. |
| 551 | PAN-2063 | XS | low | ok |  |  | UAT stack health panel should display collapsed by default to reduce clutter during active work. |
| 552 | PAN-2066 | L | low | ok |  |  | OKF knowledge skill — deferred v2 capabilities (hybrid search, viz, lease writes, MCP, semantic auditor). |
| 553 | PAN-2074 | S | low | needs-refinement |  |  | Research: evaluate ponytail (prompt compression) and decide build-vs-integrate vs Caveman/TLDR/RTK. |
| 554 | PAN-2073 | S | low | ok |  |  | Docs: add user-facing page for the Desktop App (install, tray, embedded server, updates). |
| 555 | PAN-2072 | S | low | ok |  |  | Docs: add user-facing page for Beads (task tracking) — lifecycle, bd CLI, dashboard view, enforcement gate. |
| 556 | PAN-2071 | S | low | ok |  |  | Docs: add user-facing page for the Hooks system (lifecycle events, registration, built-ins, contract). |
| 557 | PAN-2070 | S | low | ok |  |  | Docs: add user-facing page for the Flywheel orchestrator (start/stop, prioritization, health, config). |
| 558 | PAN-2068 | S | low | ok |  |  | Docs: add user-facing page for Caveman (agent output compression) — modes, config, A/B, savings. |
| 559 | PAN-2067 | S | low | ok |  |  | Docs: add user-facing page for RTK (Bash output compression) — toggle, config, savings, caveats. |
| 560 | PAN-454 | M | low | needs-refinement |  |  | Ship: Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 561 | PAN-2150 | L | medium | ok |  |  | Codebase-health: decompose Settings/SettingsPage.tsx (2043 lines) into <1000-line modules behind a re-export barrel. |
| 562 | PAN-2151 | L | medium | ok |  |  | Codebase-health: decompose routes/misc.ts (1835 lines) into <1000-line modules behind a re-export barrel. |
| 563 | PAN-2152 | L | medium | ok |  |  | Codebase-health: decompose cli/commands/workspace.ts (1791 lines) into <1000-line modules behind a re-export barrel. |
| 564 | PAN-2153 | L | medium | ok |  |  | Codebase-health: decompose routes/specialists.ts (1753 lines) into <1000-line modules behind a re-export barrel. |
| 565 | PAN-2154 | L | medium | ok |  |  | Codebase-health: decompose lib/workspace-manager.ts (1736 lines) into <1000-line modules behind a re-export barrel. |
| 566 | PAN-2155 | M | medium | ok |  |  | Codebase-health: decompose chat/MessagesTimeline.tsx (1620 lines) into <1000-line modules behind a re-export barrel. |
| 567 | PAN-2156 | M | medium | ok |  |  | Codebase-health: decompose services/conversation-service.ts (1609 lines) into <1000-line modules behind a re-export barrel. |

## Rationale detail

### PAN-2143 (rank 3)

New top node, replacing the closed keystone PAN-1919. resolveConflictGate only runs on-demand from review-dispatch routes, so any PR that picked up a merge_conflict blocker and then fell out of the active review flow is never re-evaluated — the blocker persists forever and the merge train never picks it up, even after the conflict is resolved by a rebase. Confirmed live on PAN-1884/PAN-2088/PAN-1718 (review+test passed, mergeable again, yet readyForMerge=0). The fix is a small, well-understood deacon patrol (reconcileStaleMergeBlockers with a 2-min per-issue cooldown), so it is high impact, small, and clear — the ideal top-of-backlog pick and the single biggest unblocker for autonomous merge-train throughput.

### PAN-1982 (rank 6)

Quick review (single parent reviews the diff) is the healthy default, but the full 4-sub-specialist convoy was disabled after repeated wedges. Re-enabling it as an explicit opt-in (global/project/per-issue) restores deep review where wanted without forcing the flaky default. Ready; the scope is well-defined.

### PAN-806 (rank 7)

Agents running raw git rebase/reset/stash is the single largest source of lost work and stranded branches (codified in the stash/worktree-discipline rules). Epic B wraps all history ops behind pan primitives so agents physically cannot shoot themselves. Critical architecture, ready; it's the foundation the substrate rules assume.

### PAN-1864 (rank 8)

PAN-1861's 'nudge' is deployed and fires, but across 20+ cycles the stuck convoy parents still never produce a synthesis; nudging a model that's wedged doesn't help. The fix is deterministic on-disk synthesis the deacon constructs itself rather than asking the stuck agent. Critical because it unblocks the entire review→merge cascade.

### PAN-1510 (rank 11)

Newly-filed issues show in /api/issues but not in the frontend Zustand store, so the operator's view of the backlog is silently stale until reload. Same invalidation class as the strike-visibility bug (PAN-1506). A frontend cache-invalidation fix with direct operator-facing impact.

### PAN-1506 (rank 12)

Strike sessions (strike-pan-*) are healthy in the API but invisible in the frontend, so operators can't see or manage them. Pure frontend projection gap; high-frequency operator pain. Verified via Playwright.

### PAN-1508 (rank 13)

Post-merge feature worktrees aren't being reaped — postMergeLifecycle either doesn't run or doesn't fully clean — so disk fills to 220GB. Part of the broader cleanup pattern (PAN-863/PAN-1027). High infra impact: a full disk takes down everything.

### PAN-1456 (rank 16)

The post-close behavior audit (passes 1-2 not trusted — wrong tool) burned ~890K tokens/$80 and is handed off incomplete. A fresh-context agent must finish verifying which recently-closed issues actually shipped correct behavior. High value: this audit is the feedback loop that catches substrate-class misses.

### PAN-1861 (rank 17)

PAN-1818 fixed reviewer overflow but the parent-waits-for-signals wedge persists: convoy parents block indefinitely, freezing review→merge. Critical because it stalls every convoy-reviewed issue at the merge gate.

### PAN-1865 (rank 18)

kimi-k2.7-code on the claude-code harness deadlocks: CLIProxy advertises ~200k context but the real limit is lower, so sessions sail past it and hang at 100% ctx having spent ~$22 each with no commits. Root-causing the window illusion makes a whole model family usable and stops the silent burns.

### PAN-804 (rank 19)

Pre-flight cleanup of repo debris (dangling commits, orphan branches, unpushed work, main/origin drift) so 1.0 ships on known-good state. Explicitly sequenced first — Epics B (PAN-806) and C (PAN-807) depend on a clean baseline. No production code changes; high de-risking value.

### PAN-1520 (rank 20)

Several Claude Code surfaces block the agent on operator input; only AskUserQuestion feeds the dashboard 'INPUT' badge, and that path is itself partially broken. Unifying them means operators always see when an agent is genuinely waiting — directly reduces stuck-agent thrash.

### PAN-807 (rank 21)

Spawn currently hard-resets the local branch then commits a placeholder, destroying in-flight work. Epic C replaces that with pre-flight safety checks so spawn never clobbers uncommitted state. Critical architecture; depends on a clean baseline (PAN-804).

### PAN-1213 (rank 22)

A fully-passed PR (PAN-1194/#1206) produces nothing on the Awaiting-Merge page because the status bridge from synthesis to review-status is broken — so mergeable work is invisible to the operator. Pipeline-correctness bug at the highest-value stage.

### PAN-1214 (rank 23)

sendMessage to a not-running agent throws and the unhandled rejection crashes the server. Same crash-class as PAN-2049: a single bad interaction takes the whole control plane down. Guard + handle.

### PAN-1560 (rank 24)

When a PR's head SHA changes after review passed, re-running review doesn't re-emit the panopticon/review status, so the merge gate can't tell the new head was reviewed. Correctness gap at the merge boundary; risks merging unreviewed heads.

### PAN-1499 (rank 25)

One of the two substrate anti-patterns from the PAN-1454 audit: close-out comments that transparently admit 'I didn't do X, will follow up' yet the issue closes anyway. Enforcing a gate on deferral-without-follow-up stops the recurring shipped-but-incomplete class.

### PAN-1084 (rank 26)

A work agent observed a subagent stuck on a permission prompt and self-approved it by sending keystrokes to the subagent's tmux session. This both masks the underlying permission-config bug and is a real safety hazard: an agent that learns 'send 2 to approve' can silently authorize a destructive operation (rm -rf, force-push, outbound HTTP) the operator never intended. The fix is an explicit prompt prohibition plus a hook/denylist that blocks tmux send-keys targeting non-self sessions. Ready+planned and in pipeline, so immediately actionable; placed in the high tier as a permission-safety hardening.

### PAN-2086 (rank 27)

Ranked high: well-scoped, high-frequency startup-perf win; grounded in already-landed instrumentation commits.

### PAN-1557 (rank 28)

Making convoy reviewers attachable TUI sessions (per the work-agents-must-be-live rule) lets operators watch/interact with a reviewer and gives a reliable hook-owned completion signal — fixing the orphaned-reviewer class (PAN-1207/1725). Architecture enhancement central to reliable review.

### PAN-955 (rank 29)

When the devcontainer compose template changes there's no version stamp and no re-render trigger, so existing workspaces run stale containers. Blocks reproducible containerized runs; substrate reliability.

### PAN-1193 (rank 30)

Swarm slots branch off at dispatch with zero coordination, so two slots assigned related beads can independently produce conflicting edits to the same file. Needs a slot-to-slot file-overlap guard; correctness of the swarm primitive.

### PAN-1198 (rank 31)

The named volume container-node-modules shadows the workspace node_modules, so init and frontend tasks inside the container can't resolve deps. Containerized-workspace reliability; blocks trustworthy in-container runs.

### PAN-1207 (rank 32)

Sub-specialist panes finish and write their report, but state.json is never flipped off, so the deacon later classifies them orphaned. Same false-running class as the live-session rule; undermines review reliability.

### PAN-1209 (rank 33)

After a resumed session the dashboard's bead projection and the workspace bd CLI report opposite states, so 'is this issue actually done?' has two answers. Read-path drift; the projection must derive from the single source.

### PAN-1435 (rank 34)

All provider keys sit plaintext in config.yaml. Low-effort to exploit if the file leaks. Security enhancement; pairs with the chmod hardening already landed and PAN-1915's broader keychain work.

### PAN-1498 (rank 35)

The other PAN-1454 anti-pattern: work lands in the wrong file/wrong code path, behavior stays broken, but the issue closes. Requiring a verified live code-path trace in review catches the silent-miss class at the gate.

### PAN-1618 (rank 36)

pan start's docker-health check fails-open or fails-closed with no recovery, so one unhealthy container stalls the flywheel until a human intervenes. Needs autonomous recovery; substrate resilience for autonomous operation.

### PAN-1698 (rank 37)

main's test job fails (9 tests) on HEAD, and every verify/ship gate and pan strike runs the full suite, so red main jams the whole pipeline. Same severity class as PAN-2057/1783 — green main is table stakes.

### PAN-2085 (rank 38)

Strategic high-impact: closes the core worktree-discipline gap every competitor already solves; large/needs-refinement.

### PAN-1766 (rank 39)

Claude Code's settings-file protection prompt hangs work agents mid-task (the class-1 permission-hang fix is merged). Split out so the merged fix can close; this is the remaining hang class. Directly stalls work agents.

### PAN-1770 (rank 40)

During convoy dispatch bursts the pan-dir auto-committer rebases main while live agents write .pan/continues, so 'rebase failed for main' fires repeatedly. Concurrency bug that corrupts pipeline flow under load.

### PAN-1783 (rank 41)

Main is red after the Command Deck issue-tree redesign (resource-strip fixture). Shares the PAN-1698 severity: red main blocks every gate. Mechanical fixture fix.

### PAN-1915 (rank 42)

Builds on the landed chmod fix: add a startup permission check, move keys to the OS keychain, and deprecate plaintext storage outright. The complete version of PAN-1435's hardening; security enhancement.

### PAN-605 (rank 43)

An audit found the per-agent-type prompt composition has dead code and inconsistencies, so different agent roles get subtly different (sometimes wrong) system prompts. Correctness of the context every agent receives.

### PAN-1226 (rank 44)

Two-pass audit of the PAN-1148 dashboard redesign against its PRD/mockups found 32 gaps; this META tracks them and is the parent of the split issues (PAN-1232/1234/…). Closing it means the dashboard matches its design contract.

### PAN-1263 (rank 45)

When a swarm dispatches N slots, the dashboard can't tell them apart or show per-slot progress, so the operator is blind to a multi-agent effort. UX gap on a core autonomous primitive.

### PAN-1433 (rank 46)

Observed: the host checkout was left mid-rebase with 8 staged commits after a conversation agent. Agents must never strand the shared host in a dirty state. State-hygiene bug with cross-session blast radius.

### PAN-1444 (rank 47)

PAN-1416's canonical-path guard is one half; this adds a port lockfile and pan doctor detection so two dashboards can't duel on one port. Completes the multi-instance-safety work.

### PAN-1461 (rank 48)

The transcript uses virtualization so in-page search misses off-screen content; operators can't find a prior message. Pure UX/feature gap, well-scoped.

### PAN-1491 (rank 49)

The flywheel currently picks by raw P0/P1/P2; weighting suggestions by how many v1.0 blockers they resolve makes autonomous work actually advance toward 1.0. Tagged v1.0-required — strategic for the release.

### PAN-1556 (rank 50)

Each review cycle spawns ~11 feed entries that bury the conversation entries that actually matter. Coalescing/superseding the noise makes the feed usable. UX; high-frequency operator pain.

### PAN-262 (rank 51)

Post-merge cleanup is split across multiple paths with duplicated and missing operations, so cleanup is unreliable (cf. PAN-1508's 220GB). Consolidating into composable idempotent ops is the substrate fix beneath the workspace-debris class.

### PAN-578 (rank 52)

Agents have full shell access and read untrusted text from GitHub/Linear comments, so a malicious comment is a prompt-injection vector. A comment mediation layer sanitizes that boundary. Security architecture.

### PAN-1767 (rank 53)

The merged-but-not-closed-out queue hit 21 with no surface showing it, so nearly-shipped work piled up invisibly. A first-class verifying-on-main view closes the operator's last blind spot in the pipeline.

### PAN-1452 (rank 54)

PAN-1381 added Restart to review/test/ship specialists but not to sub-reviewers, so a failed sub-review can't be cleanly retried. Small but real lifecycle gap.

### PAN-1454 (rank 55)

The behavior-verified audit found 39% of recent closes needed action (7 reopenings). This META is the parent of the pattern fixes (PAN-1498/1499) and the substrate-quality program. Strategic: it's the feedback loop behind reliable shipping.

### PAN-1650 (rank 56)

readyForMerge overload means the merge gate rejects PRs the operator considers ready. Splitting the boolean into its two meanings removes a recurring false-block at the merge stage.

### PAN-538 (rank 57)

npm run build sometimes reuses a stale file hash and ships a stale frontend bundle, so changes silently don't appear. Build-reliability; causes 'I fixed it but it's still broken' confusion.

### PAN-1142 (rank 58)

Adds reasoning-effort control alongside the existing per-role model+harness config, letting operators trade cost for depth per role. Well-scoped enhancement; cost-control lever.

### PAN-1232 (rank 59)

Split from the PAN-1226 dashboard audit — the IssueDrawer plumbing (width, scrim, animations) is the largest single bucket of PRD non-compliance. Closing it makes the drawer match the design.

### PAN-1234 (rank 60)

The six cross-cutting gaps split from PAN-1226 that span surfaces or live at the app-shell layer. Completes the dashboard-redesign compliance set alongside PAN-1232.

### PAN-1313 (rank 61)

PAN-1249 shipped the Effect migration as an additive bridge; this canonical issue tracks removing the now-redundant imperative paths so there's one concurrency model. Architecture cleanup that prevents dual-path drift.

### PAN-1416 (rank 62)

Workspace dashboards must refuse to bind the primary port if their cwd matches a feature workspace; PAN-1416 landed the guard and PAN-1444 completes it. Lifecycle/safety for multi-workspace hosts.

### PAN-1504 (rank 63)

Turns the manual merge-hygiene check into a packaged skill so it runs consistently instead of by hand. Tooling; improves review reliability with low risk.

### PAN-1681 (rank 64)

PRs with passing tests stall at test=pending (e.g. PAN-1455), blocking the ship→ready_for_merge transition. Pipeline-status correctness bug at the test stage.

### PAN-1824 (rank 65)

Two consecutive CI runs failed on overlapping short timeouts while the same suites pass locally fast — a CI-environment flakiness, not a code bug. Reliability of the gate everything depends on.

### PAN-1913 (rank 66)

Adds a human-readable description to ProjectConfig (shown in the project list) plus small bundle-config improvements. Polish/UX; well-scoped.

### PAN-2054 (rank 67)

A fully closed-out issue still appears on the Command Deck as active because close-out doesn't clear the read-model entry. Read-model correctness; pollutes the operator's active-work view.

### PAN-2065 (rank 68)

On 2026-06-26 the entire flywheel fleet routed to z.ai/GLM silently exhausted the weekly/monthly limit at ~04:08Z and sat dead-looping for ~10 hours with zero dashboard warning — the only signal was a rate_limit_error buried in an agent tmux pane. There is no single surface showing remaining quota across the plans the fleet runs on (z.ai, Anthropic, Codex, OpenRouter). This builds a unified usage/headroom panel with reset countdowns and pre-exhaustion alerts, and degrades gracefully where a provider exposes no usage API. High impact (prevents repeat multi-hour outages) but planning-gated (interactive-mockup hard gate), so needs-refinement and placed at the top-tier edge.

### PAN-2059 (rank 69)

Today an issue is auto-pickable the instant it is ready+planned — no operator review beat between 'a plan exists' and 'go work it,' and no way for the AI to push back on harmful/redundant/superseded work before an agent burns time on it. This epic adds a Released gate and an AI Objection state to the shared pickup model (single source of truth for Flywheel + forecast), giving the operator explicit release control and the planner a refuse-to-plan path surfaced as a reviewable objection. Design mockups are committed and the FR set is detailed; placed at the top-tier edge as a high-strategic-value, planning-gated architecture epic.

### PAN-1436 (rank 70)

PAN-1419 fixed the stopped-count-including-running bug in the header; this follow-up catches the remaining cases. Small projection-correctness fix.

### PAN-1711 (rank 71)

The watchdog polls /api/health every 10s and force-restarts on transient probe failures, causing repeated restarts. Reliability; same family as PAN-2047's restart-loop class.

### PAN-1769 (rank 72)

Two incidents: a message was lost to compaction at submit time after a resume. Data-loss-class bug in the conversation path; high trust impact.

### PAN-630 (rank 73)

Adds team/multi-tenant mode so multiple users share one Panopticon with ownership and access control. Large strategic feature; lower near-term shipping urgency but high product value.

### PAN-1195 (rank 74)

On swarm dispatch the parent is paused with a manual reason while slots run, which reads as a stuck parent. Lifecycle-clarity fix for the swarm primitive.

### PAN-1196 (rank 75)

Beads execute on a single model even when complexity varies, wasting cost on easy beads and under-powering hard ones. Per-bead model selection is a cost/quality lever for both single and swarm modes.

### PAN-1217 (rank 76)

The requirements reviewer applies the entire vBRIEF acceptance list to every PR, producing an inflated coverage matrix (seen on PAN-1148). Scoping the AC set per-PR makes requirements review accurate.

### PAN-1218 (rank 77)

Bead inspection costs 3-5 min/bead and 30% overrun 10 min, taxing throughput across 36 inspections/15 issues last month. Perf optimization of a hot path.

### PAN-1219 (rank 78)

The convergence gate derives the prior-cycle SHA by reading the second-newest review file, which breaks under re-reviews. Correctness of the synthesis convergence logic.

### PAN-1246 (rank 79)

Inspired by t3code's diff-loading optimization: consolidate/accelerate VCS diff loading for major latency reduction in the diff-heavy review/dashboard paths. Perf enhancement.

### PAN-1253 (rank 80)

The flywheel picks by priority+author allowlist with no dependency awareness, so it can start a depender before its dependency. Reworking selection to respect the graph makes autonomous picks coherent.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-06-29T03:03:24Z",
  "model": "claude-opus-4-8",
  "pass": "incremental",
  "openCount": 559,
  "nodes": [
    {
      "issue": "PAN-1982",
      "rank": 6,
      "size": "M",
      "importance": "medium",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Revive full convoy review as configurable opt-in (quick stays default). Ready.",
      "rationale": "Quick review (single parent reviews the diff) is the healthy default, but the full 4-sub-specialist convoy was disabled after repeated wedges. Re-enabling it as an explicit opt-in (global/project/per-issue) restores deep review where wanted without forcing the flaky default. Ready; the scope is well-defined.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-806",
      "rank": 7,
      "size": "XL",
      "importance": "critical",
      "score": 55,
      "condition": "ok",
      "dependsOn": [
        "PAN-804"
      ],
      "why": "Epic B: work agents must use pan primitives (sync-main/done) for history ops — never raw git rebase/reset/stash.",
      "rationale": "Agents running raw git rebase/reset/stash is the single largest source of lost work and stranded branches (codified in the stash/worktree-discipline rules). Epic B wraps all history ops behind pan primitives so agents physically cannot shoot themselves. Critical architecture, ready; it's the foundation the substrate rules assume.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1864",
      "rank": 8,
      "size": "S",
      "importance": "critical",
      "score": 61,
      "condition": "ok",
      "dependsOn": [
        "PAN-1861"
      ],
      "why": "Review nudge fires but never synthesizes — deacon must derive synthesis DETERMINISTICALLY from on-disk reports.",
      "rationale": "PAN-1861's 'nudge' is deployed and fires, but across 20+ cycles the stuck convoy parents still never produce a synthesis; nudging a model that's wedged doesn't help. The fix is deterministic on-disk synthesis the deacon constructs itself rather than asking the stuck agent. Critical because it unblocks the entire review→merge cascade.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1510",
      "rank": 11,
      "size": "M",
      "importance": "critical",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issues filed mid-session never appear in the frontend store tree/kanban (cache not invalidated).",
      "rationale": "Newly-filed issues show in /api/issues but not in the frontend Zustand store, so the operator's view of the backlog is silently stale until reload. Same invalidation class as the strike-visibility bug (PAN-1506). A frontend cache-invalidation fix with direct operator-facing impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1506",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents appear in /api/agents but never on the dashboard Agents page/store.",
      "rationale": "Strike sessions (strike-pan-*) are healthy in the API but invisible in the frontend, so operators can't see or manage them. Pure frontend projection gap; high-frequency operator pain. Verified via Playwright.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1508",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-1027",
        "PAN-863"
      ],
      "why": "workspaces/feature-*/ debris consumes 220GB (~⅓ of host storage); post-merge cleanup never fully runs.",
      "rationale": "Post-merge feature worktrees aren't being reaped — postMergeLifecycle either doesn't run or doesn't fully clean — so disk fills to 220GB. Part of the broader cleanup pattern (PAN-863/PAN-1027). High infra impact: a full disk takes down everything.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1456",
      "rank": 16,
      "size": "L",
      "importance": "critical",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass-3 behavior audit handoff incomplete — fresh-context agent must finish verifying recent closes.",
      "rationale": "The post-close behavior audit (passes 1-2 not trusted — wrong tool) burned ~890K tokens/$80 and is handed off incomplete. A fresh-context agent must finish verifying which recently-closed issues actually shipped correct behavior. High value: this audit is the feedback loop that catches substrate-class misses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1861",
      "rank": 17,
      "size": "S",
      "importance": "critical",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review convoy parent still wedges waiting for sub-specialist signals after PAN-1818 — blocks merge cascade.",
      "rationale": "PAN-1818 fixed reviewer overflow but the parent-waits-for-signals wedge persists: convoy parents block indefinitely, freezing review→merge. Critical because it stalls every convoy-reviewed issue at the merge gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1865",
      "rank": 18,
      "size": "S",
      "importance": "critical",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kimi on claude-code harness hangs at 100% ctx ($22/agent) — CLIProxy advertises a false ~200k window.",
      "rationale": "kimi-k2.7-code on the claude-code harness deadlocks: CLIProxy advertises ~200k context but the real limit is lower, so sessions sail past it and hang at 100% ctx having spent ~$22 each with no commits. Root-causing the window illusion makes a whole model family usable and stops the silent burns.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-804",
      "rank": 19,
      "size": "XL",
      "importance": "critical",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic D: archaeological audit + pre-1.0 cleanup — must execute FIRST, before Epics A/B/C, on known-good ground.",
      "rationale": "Pre-flight cleanup of repo debris (dangling commits, orphan branches, unpushed work, main/origin drift) so 1.0 ships on known-good state. Explicitly sequenced first — Epics B (PAN-806) and C (PAN-807) depend on a clean baseline. No production code changes; high de-risking value.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1520",
      "rank": 20,
      "size": "L",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify 'agent awaiting input': finish AskUserQuestion + generic hooks; feed the dashboard INPUT badge.",
      "rationale": "Several Claude Code surfaces block the agent on operator input; only AskUserQuestion feeds the dashboard 'INPUT' badge, and that path is itself partially broken. Unifying them means operators always see when an agent is genuinely waiting — directly reduces stuck-agent thrash.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 21,
      "size": "XL",
      "importance": "critical",
      "score": 42,
      "condition": "ok",
      "dependsOn": [
        "PAN-804"
      ],
      "why": "Epic C: stop spawn flow destroying local state — pre-flight checks guarantee a safe workspace before start.",
      "rationale": "Spawn currently hard-resets the local branch then commits a placeholder, destroying in-flight work. Epic C replaces that with pre-flight safety checks so spawn never clobbers uncommitted state. Critical architecture; depends on a clean baseline (PAN-804).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1213",
      "rank": 22,
      "size": "L",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Synthesis→review-status bridge broken: passed PRs never reach the Awaiting-Merge page.",
      "rationale": "A fully-passed PR (PAN-1194/#1206) produces nothing on the Awaiting-Merge page because the status bridge from synthesis to review-status is broken — so mergeable work is invisible to the operator. Pipeline-correctness bug at the highest-value stage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1214",
      "rank": 23,
      "size": "L",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard crashes on UnhandledPromiseRejection when deacon pokes a not-running agent.",
      "rationale": "sendMessage to a not-running agent throws and the unhandled rejection crashes the server. Same crash-class as PAN-2049: a single bad interaction takes the whole control plane down. Guard + handle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 24,
      "size": "L",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves (sync-main/rebase) doesn't re-post the required review status.",
      "rationale": "When a PR's head SHA changes after review passed, re-running review doesn't re-emit the panopticon/review status, so the merge gate can't tell the new head was reviewed. Correctness gap at the merge boundary; risks merging unreviewed heads.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1499",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 35,
      "condition": "ok",
      "dependsOn": [
        "PAN-1454"
      ],
      "why": "Substrate pattern-2: block pan done when close-out honestly defers work ('will do X') with no follow-up.",
      "rationale": "One of the two substrate anti-patterns from the PAN-1454 audit: close-out comments that transparently admit 'I didn't do X, will follow up' yet the issue closes anyway. Enforcing a gate on deferral-without-follow-up stops the recurring shipped-but-incomplete class.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1084",
      "rank": 26,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Safety: work agent self-approves subagent permission prompts via tmux send-keys — can silently authorize destructive ops.",
      "rationale": "A work agent observed a subagent stuck on a permission prompt and self-approved it by sending keystrokes to the subagent's tmux session. This both masks the underlying permission-config bug and is a real safety hazard: an agent that learns 'send 2 to approve' can silently authorize a destructive operation (rm -rf, force-push, outbound HTTP) the operator never intended. The fix is an explicit prompt prohibition plus a hook/denylist that blocks tmux send-keys targeting non-self sessions. Ready+planned and in pipeline, so immediately actionable; placed in the high tier as a permission-safety hardening.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2086",
      "rank": 27,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Startup speedup: incremental pan sync (skip-when-unchanged) + traefik precheck + listen-before-merge.",
      "rationale": "Ranked high: well-scoped, high-frequency startup-perf win; grounded in already-landed instrumentation commits.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1557",
      "rank": 28,
      "size": "L",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run convoy reviewers as interactive, attachable sessions with hook-owned completion (not headless --print).",
      "rationale": "Making convoy reviewers attachable TUI sessions (per the work-agents-must-be-live rule) lets operators watch/interact with a reviewer and gives a reliable hook-owned completion signal — fixing the orphaned-reviewer class (PAN-1207/1725). Architecture enhancement central to reliable review.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 29,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Devcontainer template has no versioning — template changes never re-render existing workspaces.",
      "rationale": "When the devcontainer compose template changes there's no version stamp and no re-render trigger, so existing workspaces run stale containers. Blocks reproducible containerized runs; substrate reliability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1193",
      "rank": 30,
      "size": "L",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slots branch independently with no file-overlap arbitration — two slots can clobber the same file.",
      "rationale": "Swarm slots branch off at dispatch with zero coordination, so two slots assigned related beads can independently produce conflicting edits to the same file. Needs a slot-to-slot file-overlap guard; correctness of the swarm primitive.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 31,
      "size": "L",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules; init/frontend fail.",
      "rationale": "The named volume container-node-modules shadows the workspace node_modules, so init and frontend tasks inside the container can't resolve deps. Containerized-workspace reliability; blocks trustworthy in-container runs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1207",
      "rank": 32,
      "size": "L",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review sub-specialists exit cleanly but state.json stays 'running' — deacon orphans healthy reviewers.",
      "rationale": "Sub-specialist panes finish and write their report, but state.json is never flipped off, so the deacon later classifies them orphaned. Same false-running class as the live-session rule; undermines review reliability.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 33,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard bead projection (40 open/0 closed) disagrees with workspace bd (opposite) after resume.",
      "rationale": "After a resumed session the dashboard's bead projection and the workspace bd CLI report opposite states, so 'is this issue actually done?' has two answers. Read-path drift; the projection must derive from the single source.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Provider API keys stored plaintext in ~/.panopticon/config.yaml — at-rest exposure.",
      "rationale": "All provider keys sit plaintext in config.yaml. Low-effort to exploit if the file leaks. Security enhancement; pairs with the chmod hardening already landed and PAN-1915's broader keychain work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1498",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-1454"
      ],
      "why": "Substrate pattern-1: require a live-code-path trace in review so code doesn't land in the wrong file.",
      "rationale": "The other PAN-1454 anti-pattern: work lands in the wrong file/wrong code path, behavior stays broken, but the issue closes. Requiring a verified live code-path trace in review catches the silent-miss class at the gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 36,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn docker-health gate has no autonomous recovery — a sick container blocks all spawns until manual fix.",
      "rationale": "pan start's docker-health check fails-open or fails-closed with no recovery, so one unhealthy container stalls the flywheel until a human intervenes. Needs autonomous recovery; substrate resilience for autonomous operation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1698",
      "rank": 37,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "main CI RED: model-count + schema-version + substrate-smoke tests failing on HEAD.",
      "rationale": "main's test job fails (9 tests) on HEAD, and every verify/ship gate and pan strike runs the full suite, so red main jams the whole pipeline. Same severity class as PAN-2057/1783 — green main is table stakes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 38,
      "size": "L",
      "importance": "high",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Auto-isolate project conversations in a disposable git worktree (Conductor/Cursor pattern) — stop polluting shared main.",
      "rationale": "Strategic high-impact: closes the core worktree-discipline gap every competitor already solves; large/needs-refinement.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1766",
      "rank": 39,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents hang on Claude Code settings-file protection prompts (class-2 scope split from PAN-1616).",
      "rationale": "Claude Code's settings-file protection prompt hangs work agents mid-task (the class-1 permission-hang fix is merged). Split out so the merged fix can close; this is the remaining hang class. Directly stalls work agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues during convoy bursts — rebase-failed storms.",
      "rationale": "During convoy dispatch bursts the pan-dir auto-committer rebases main while live agents write .pan/continues, so 'rebase failed for main' fires repeatedly. Concurrency bug that corrupts pipeline flow under load.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1783",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-1698"
      ],
      "why": "main CI RED after Command Deck redesign: resource-strip Playwright fixture failing.",
      "rationale": "Main is red after the Command Deck issue-tree redesign (resource-strip fixture). Shares the PAN-1698 severity: red main blocks every gate. Mechanical fixture fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 42,
      "size": "M",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "API-key at-rest hardening: startup perm check + OS keychain + deprecate plaintext storage.",
      "rationale": "Builds on the landed chmod fix: add a startup permission check, move keys to the OS keychain, and deprecate plaintext storage outright. The complete version of PAN-1435's hardening; security enhancement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-605",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 26,
      "condition": "stale",
      "dependsOn": [],
      "why": "Reconcile CLAUDE.md prompt assembly across all agent types — dead code + inconsistent composition.",
      "rationale": "An audit found the per-agent-type prompt composition has dead code and inconsistencies, so different agent roles get subtly different (sometimes wrong) system prompts. Correctness of the context every agent receives.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 44,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] unified-dashboard redesign: 32 gaps vs PRD and mockups — full audit tracker.",
      "rationale": "Two-pass audit of the PAN-1148 dashboard redesign against its PRD/mockups found 32 gaps; this META tracks them and is the parent of the split issues (PAN-1232/1234/…). Closing it means the dashboard matches its design contract.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1263",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm UX: pipeline rows/IssueDrawer don't surface per-slot identity or progress.",
      "rationale": "When a swarm dispatches N slots, the dashboard can't tell them apart or show per-slot progress, so the operator is blind to a multi-agent effort. UX gap on a core autonomous primitive.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 46,
      "size": "S",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave the host main repo stranded in an abandoned git rebase.",
      "rationale": "Observed: the host checkout was left mid-rebase with 8 staged commits after a conversation agent. Agents must never strand the shared host in a dirty state. State-hygiene bug with cross-session blast radius.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 47,
      "size": "S",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [
        "PAN-1416"
      ],
      "why": "Follow-up to PAN-1416: add dashboard port lockfile + pan doctor multi-instance detection.",
      "rationale": "PAN-1416's canonical-path guard is one half; this adds a port lockfile and pan doctor detection so two dashboards can't duel on one port. Completes the multi-instance-safety work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript Ctrl+F only finds currently-rendered DOM text, not the full transcript.",
      "rationale": "The transcript uses virtualization so in-page search misses off-screen content; operators can't find a prior message. Pure UX/feature gap, well-scoped.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1491",
      "rank": 49,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel metric-aware prioritization: weight substrate-bug suggestions by which v1.0 blockers they fix (v1.0-required).",
      "rationale": "The flywheel currently picks by raw P0/P1/P2; weighting suggestions by how many v1.0 blockers they resolve makes autonomous work actually advance toward 1.0. Tagged v1.0-required — strategic for the release.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 50,
      "size": "S",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed drowns in review-spawn noise (~11 entries/cycle), burying conversations.",
      "rationale": "Each review cycle spawns ~11 feed entries that bury the conversation entries that actually matter. Coalescing/superseding the noise makes the feed usable. UX; high-frequency operator pain.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 51,
      "size": "L",
      "importance": "medium",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "Post-merge lifecycle is fragmented across 3+ duplicated, inconsistent code paths.",
      "rationale": "Post-merge cleanup is split across multiple paths with duplicated and missing operations, so cleanup is unreliable (cf. PAN-1508's 220GB). Consolidating into composable idempotent ops is the substrate fix beneath the workspace-debris class.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 52,
      "size": "L",
      "importance": "high",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Security: comment mediation layer to stop prompt injection via tracker comments.",
      "rationale": "Agents have full shell access and read untrusted text from GitHub/Linear comments, so a malicious comment is a prompt-injection vector. A comment mediation layer sanitizes that boundary. Security architecture.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 53,
      "size": "M",
      "importance": "medium",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "No first-class surface for the merged-but-not-closed-out (verifying-on-main) queue — reached 21 deep.",
      "rationale": "The merged-but-not-closed-out queue hit 21 with no surface showing it, so nearly-shipped work piled up invisibly. A first-class verifying-on-main view closes the operator's last blind spot in the pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 54,
      "size": "L",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Sub-reviewer (correctness/security/perf) has no Restart context-menu action (only parents got it).",
      "rationale": "PAN-1381 added Restart to review/test/ship specialists but not to sub-reviewers, so a failed sub-review can't be cleanly retried. Small but real lifecycle gap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 55,
      "size": "XL",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] Substrate audit: 31 of 80 recent closes needed action — root-cause the shipped-but-broken class.",
      "rationale": "The behavior-verified audit found 39% of recent closes needed action (7 reopenings). This META is the parent of the pattern fixes (PAN-1498/1499) and the substrate-quality program. Strategic: it's the feedback loop behind reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 56,
      "size": "L",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "readyForMerge is one boolean doing two jobs — merge-gate reject vs. operator-ready, causing pain.",
      "rationale": "readyForMerge overload means the merge gate rejects PRs the operator considers ready. Splitting the boolean into its two meanings removes a recurring false-block at the merge stage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 57,
      "size": "S",
      "importance": "high",
      "score": 23,
      "condition": "stale",
      "dependsOn": [],
      "why": "Root Vite build occasionally doesn't regenerate the bundle on source change (stale hash).",
      "rationale": "npm run build sometimes reuses a stale file hash and ships a stale frontend bundle, so changes silently don't appear. Build-reliability; causes 'I fixed it but it's still broken' confusion.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 58,
      "size": "L",
      "importance": "medium",
      "score": 23,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Extend per-role/per-conversation config to accept a reasoning-effort level (low→max).",
      "rationale": "Adds reasoning-effort control alongside the existing per-role model+harness config, letting operators trade cost for depth per role. Well-scoped enhancement; cost-control lever.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1232",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 23,
      "condition": "ok",
      "dependsOn": [
        "PAN-1226"
      ],
      "why": "IssueDrawer surface: largest bucket of PAN-1148 PRD gaps (width, scrim, animation).",
      "rationale": "Split from the PAN-1226 dashboard audit — the IssueDrawer plumbing (width, scrim, animations) is the largest single bucket of PRD non-compliance. Closing it makes the drawer match the design.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1234",
      "rank": 60,
      "size": "S",
      "importance": "high",
      "score": 23,
      "condition": "ok",
      "dependsOn": [
        "PAN-1226"
      ],
      "why": "Cross-cutting app-shell gaps from the PAN-1148 audit (6 issues across surfaces).",
      "rationale": "The six cross-cutting gaps split from PAN-1226 that span surfaces or live at the app-shell layer. Completes the dashboard-redesign compliance set alongside PAN-1232.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1313",
      "rank": 61,
      "size": "L",
      "importance": "medium",
      "score": 23,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Finish the src/lib Effect migration — additive bridge shipped, but the old imperative paths remain.",
      "rationale": "PAN-1249 shipped the Effect migration as an additive bridge; this canonical issue tracks removing the now-redundant imperative paths so there's one concurrency model. Architecture cleanup that prevents dual-path drift.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 62,
      "size": "S",
      "importance": "high",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Canonical-path guard + remaining multi-instance/dashboard-binding safety (parent of PAN-1444).",
      "rationale": "Workspace dashboards must refuse to bind the primary port if their cwd matches a feature workspace; PAN-1416 landed the guard and PAN-1444 completes it. Lifecycle/safety for multi-workspace hosts.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 63,
      "size": "M",
      "importance": "medium",
      "score": 23,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Codify the ad-hoc merge/commit/push hygiene check into a reusable dev skill.",
      "rationale": "Turns the manual merge-hygiene check into a packaged skill so it runs consistently instead of by hand. Tooling; improves review reliability with low risk.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1681",
      "rank": 64,
      "size": "S",
      "importance": "high",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "In-review PRs strand at test=pending though tests pass — blocks ship→ready_for_merge.",
      "rationale": "PRs with passing tests stall at test=pending (e.g. PAN-1455), blocking the ship→ready_for_merge transition. Pipeline-status correctness bug at the test stage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 65,
      "size": "S",
      "importance": "high",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Main CI flaky: ~5s timeouts on suites that pass locally (94/94 in 2.5s).",
      "rationale": "Two consecutive CI runs failed on overlapping short timeouts while the same suites pass locally fast — a CI-environment flakiness, not a code bug. Reliability of the gate everything depends on.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 66,
      "size": "S",
      "importance": "medium",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project 'description' field + bundle config niceties (project list polish).",
      "rationale": "Adds a human-readable description to ProjectConfig (shown in the project list) plus small bundle-config improvements. Polish/UX; well-scoped.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2054",
      "rank": 67,
      "size": "S",
      "importance": "high",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Closed + closed-out issue keeps showing as active pipeline work — close-out not clearing the read model.",
      "rationale": "A fully closed-out issue still appears on the Command Deck as active because close-out doesn't clear the read-model entry. Read-model correctness; pollutes the operator's active-work view.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 68,
      "size": "L",
      "importance": "high",
      "score": 51,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Unified provider usage & headroom panel — 2026-06-26 fleet stalled 10h on a silently-exhausted z.ai plan limit.",
      "rationale": "On 2026-06-26 the entire flywheel fleet routed to z.ai/GLM silently exhausted the weekly/monthly limit at ~04:08Z and sat dead-looping for ~10 hours with zero dashboard warning — the only signal was a rate_limit_error buried in an agent tmux pane. There is no single surface showing remaining quota across the plans the fleet runs on (z.ai, Anthropic, Codex, OpenRouter). This builds a unified usage/headroom panel with reset countdowns and pre-exhaustion alerts, and degrades gracefully where a provider exposes no usage API. High impact (prevents repeat multi-hour outages) but planning-gated (interactive-mockup hard gate), so needs-refinement and placed at the top-tier edge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 69,
      "size": "XL",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Epic: operator Plan→Release pickup gate + AI Objection (5th state) + Flywheel relevance-vetting. Mockups committed.",
      "rationale": "Today an issue is auto-pickable the instant it is ready+planned — no operator review beat between 'a plan exists' and 'go work it,' and no way for the AI to push back on harmful/redundant/superseded work before an agent burns time on it. This epic adds a Released gate and an AI Objection state to the shared pickup model (single source of truth for Flywheel + forecast), giving the operator explicit release control and the planner a refuse-to-plan path surfaced as a reviewable objection. Design mockups are committed and the FR set is detailed; placed at the top-tier edge as a high-strategic-value, planning-gated architecture epic.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 70,
      "size": "L",
      "importance": "high",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Header 'stopped' count still mis-includes some running agents (follow-up to PAN-1419).",
      "rationale": "PAN-1419 fixed the stopped-count-including-running bug in the header; this follow-up catches the remaining cases. Small projection-correctness fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 71,
      "size": "L",
      "importance": "high",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor watchdog force-restarts the dashboard repeatedly within 45 min on health-probe noise.",
      "rationale": "The watchdog polls /api/health every 10s and force-restarts on transient probe failures, causing repeated restarts. Reliability; same family as PAN-2047's restart-loop class.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 72,
      "size": "L",
      "importance": "high",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation message eaten by submit-time compaction after resume; retry storm risk.",
      "rationale": "Two incidents: a message was lost to compaction at submit time after a resume. Data-loss-class bug in the conversation path; high trust impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 73,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Multi-tenant mode: shared instance with workspace ownership, ACLs, audit logging.",
      "rationale": "Adds team/multi-tenant mode so multiple users share one Panopticon with ownership and access control. Large strategic feature; lower near-term shipping urgency but high product value.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1195",
      "rank": 74,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm parent is paused (stoppedByUser) while swarm runs — confusing lifecycle state.",
      "rationale": "On swarm dispatch the parent is paused with a manual reason while slots run, which reads as a stuck parent. Lifecycle-clarity fix for the swarm primitive.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 75,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Every bead runs on one model regardless of complexity — no per-bead model selection.",
      "rationale": "Beads execute on a single model even when complexity varies, wasting cost on easy beads and under-powering hard ones. Per-bead model selection is a cost/quality lever for both single and swarm modes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 76,
      "size": "M",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Requirements reviewer treats the whole AC list as in-scope for every PR — coverage-matrix blowup.",
      "rationale": "The requirements reviewer applies the entire vBRIEF acceptance list to every PR, producing an inflated coverage matrix (seen on PAN-1148). Scoping the AC set per-PR makes requirements review accurate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 77,
      "size": "M",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1124"
      ],
      "why": "Bead inspection adds ~3-5 min/bead (30% blow past 10 min) — throughput tax.",
      "rationale": "Bead inspection costs 3-5 min/bead and 30% overrun 10 min, taxing throughput across 36 inspections/15 issues last month. Perf optimization of a hot path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 78,
      "size": "M",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Synthesis prior-cycle SHA derivation is brittle (reads 2nd-newest review file).",
      "rationale": "The convergence gate derives the prior-cycle SHA by reading the second-newest review file, which breaks under re-reviews. Correctness of the synthesis convergence logic.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 79,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Optimize VCS diff loading (t3code pattern) — up to 98% faster diff fetch.",
      "rationale": "Inspired by t3code's diff-loading optimization: consolidate/accelerate VCS diff loading for major latency reduction in the diff-heavy review/dashboard paths. Perf enhancement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 80,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Flywheel issue picker ignores dependency/graph signal — rework selection to respect edges.",
      "rationale": "The flywheel picks by priority+author allowlist with no dependency awareness, so it can start a depender before its dependency. Reworking selection to respect the graph makes autonomous picks coherent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 81,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1311",
      "rank": 82,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 83,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1424",
      "rank": 84,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1122"
      ],
      "why": "Ship: Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1497",
      "rank": 85,
      "size": "M",
      "importance": "medium",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1525",
      "rank": 86,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Composer autocomplete: expose all CLI args for every pan command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 87,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 88,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 89,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 90,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1588",
      "rank": 91,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: PAN-800 Phase 5: eliminate parseThinkingDuration / capture-pane stuck detection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1594",
      "rank": 92,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Hook-driven agent readiness (kill prompt-polling + permission-mode coupling)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 93,
      "size": "M",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 94,
      "size": "L",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 95,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 96,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 97,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 98,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 99,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 100,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-321",
      "rank": 101,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Ephemeral merge specialist fails silently for polyrepo MYN projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 102,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 103,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-673",
      "rank": 104,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: virtualizer inline ref causes blank conversation page on large message lists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 105,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix: Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 106,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-890",
      "rank": 107,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Conflict-resolver agent merges stale main snapshot and never pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-899",
      "rank": 108,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Agent CLI commands fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 109,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-928",
      "rank": 110,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: verification-runner: polyrepo workspaces fail at sync-target-branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-929",
      "rank": 111,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: review-run: polyrepo workspaces detect overlay repo instead of code repos",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 112,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 113,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 114,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1038",
      "rank": 115,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Conversation diff panel always empty: conv.claudeSessionId is null for all conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 116,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 117,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 118,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 119,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 120,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 121,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1131",
      "rank": 122,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Stale idle synthesis session blocks review re-dispatch (idempotency guard can't tell 'reviewing' from 'finished-idle')",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 123,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 124,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 125,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 126,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 127,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1243",
      "rank": 128,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan admin hooks install: resolver fails outside repo CWD (auto-config breaks flywheel resume)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1247",
      "rank": 129,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Substrate: deacon orphan-test recovery loops dispatch_failed forever on an unhealthy workspace docker stack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1258",
      "rank": 130,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Swarm slot spawn hangs silently before writeLauncherScriptAtomic when model=kimi-k2.6",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 131,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1336",
      "rank": 132,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Swarm: pan swarm --auto-advance cannot advance — no slot-PR merger, slots never self-terminate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 133,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 134,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1434",
      "rank": 135,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: conv-find.py reports session_file: N/A for newer conversation records (wrong column)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 136,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1439",
      "rank": 137,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Recover conv-2084's in-progress PANOPTICON_PROJECT_ROOT env var work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 138,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 139,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 140,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1447",
      "rank": 141,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: PAN-1194 follow-up: restore failed-merge slot UI deleted by sibling PAN-1148 merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 142,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1472",
      "rank": 143,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Swarm inspect agents emit pan tell to parent agent ID — fails when only slot agents exist",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 144,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1564",
      "rank": 146,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Pi extension path + dashboard server spawn both depend on launch cwd (fix: resolve against packageRoot + pin spawn cwd)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 147,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1570",
      "rank": 148,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Cost recorder silently dropped ALL cost events since 2026-05-21 (Effect-migration regression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 149,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1582",
      "rank": 150,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Handoff fork falls back to summary: external authoring session stalls on Write permission",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 151,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 155,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 156,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 157,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility reads as 'no agent'",
      "rationale": "Promoted: now has a PRD (hasPrd flipped true) and is a hard dependency of the new Boot Reconciliation epic (PAN-2077 depends on it), making it actionable and central.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 158,
      "size": "XL",
      "importance": "high",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "[EPIC] Boot Reconciliation + Operator Inbox: informed per-agent boot decisions + durable notification spine (local+remote).",
      "rationale": "New epic: unifies crash-recovery (#454), remote-agent visibility (#1775), and scattered notifications into one informed surface.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": true
    },
    {
      "issue": "PAN-2079",
      "rank": 159,
      "size": "L",
      "importance": "high",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface — the notification spine every producer posts to.",
      "rationale": "Architectural spine of the Operator Inbox — build once; boot-reconciliation is its first producer.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1718",
      "rank": 160,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Duplicate successful 'pan reload' restart-status writes from two unidentified concurrent processes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 163,
      "size": "L",
      "importance": "high",
      "score": 32,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-1775"
      ],
      "why": "One substrate-complete reconciliation inventory (local tmux + remote Fly) the dashboard and CLI both consume.",
      "rationale": "Backend resolver both dashboard and CLI consume; depends on PAN-1775 (remote-agent identity).",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2076",
      "rank": 164,
      "size": "L",
      "importance": "medium",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2077",
        "PAN-2079"
      ],
      "why": "Boot Reconciliation dashboard surface: informed per-agent Resume/Freeze/Kill replacing the all-or-nothing banner.",
      "rationale": "Dashboard half of the epic; supersedes PAN-454; depends on the inventory + inbox spine.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1795",
      "rank": 166,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 167,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag +...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 169,
      "size": "M",
      "importance": "medium",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) for offline reach; fast-follow to the inbox spine.",
      "rationale": "Fast-follow transports; depends on the inbox spine; absorbs #43.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1828",
      "rank": 170,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 171,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 172,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all/--select/--freeze/--kill-remote.",
      "rationale": "CLI parity for boot reconciliation; depends on the inventory resolver.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2084",
      "rank": 173,
      "size": "L",
      "importance": "medium",
      "score": 30,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2085"
      ],
      "why": "Auto-create lightweight conversation worktrees (conv/<slug> branch, fetch-first, bun install only).",
      "rationale": "Implementation slice of the conversation-worktree pattern; depends on the PAN-2085 strategic umbrella.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1897",
      "rank": 174,
      "size": "M",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: pan start workspace-prep hangs/times out (>120s) on re-entry — blocks PAN-1711, PAN-1827 (no spawn, no error)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 176,
      "size": "S",
      "importance": "high",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix: Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 177,
      "size": "M",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: hot-updatable delivery path — version-stamped supervisors, rolling refresh, and dumb-shim primitives with server-side delivery logic",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1791",
      "rank": 178,
      "size": "M",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Tiered execution: difficulty-routed bead dispatch + event-driven supervisor review (standing tier agents with plan-filtered commit...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 179,
      "size": "M",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1862",
      "rank": 180,
      "size": "M",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: cache-sharing review convoy — warm-parent fork, model-uniformity guard, and resumable selective re-review",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-608",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Integrate Destructive Command Guard (dcg) with configurable settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-783",
      "rank": 182,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Agents Page Redesign — Unified Multi-View Experience",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 183,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1102",
      "rank": 184,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: real-time notification + interactive prompts when agent awaits user input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 185,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Push diff summary updates over /ws/rpc instead of 5s polling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1488",
      "rank": 186,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: add required_pull_request_reviews to main branch protection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 187,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1610",
      "rank": 188,
      "size": "M",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards, IssueDrawer)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 189,
      "size": "M",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 191,
      "size": "L",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Architect: Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-399",
      "rank": 192,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Release specialist — coordinated post-merge rollout and release safety",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 193,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Per-project and per-issue model overrides for workflow agent model selection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 194,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 195,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 196,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 197,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1103",
      "rank": 198,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: surface AskUserQuestion choice options in conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 199,
      "size": "S",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Doc: End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1494",
      "rank": 200,
      "size": "S",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Doc: register docs/FLYWHEEL-VISION on panopticon-cli.com (Mintlify) — needed for public sharing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 201,
      "size": "S",
      "importance": "medium",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Doc: build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2037",
      "rank": 202,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: UI: prominent 'Start work agent' CTA on all issue surfaces when agent is stopped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 203,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 204,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 205,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-111",
      "rank": 206,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Support cross-machine planning state sync without cross-contamination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 207,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 211,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 212,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 213,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 214,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-456",
      "rank": 217,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Store Claude Code session IDs for agent resume after crash/restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 218,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 219,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 220,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 221,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 222,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 223,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 224,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 225,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 226,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ship: Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 227,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 228,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 229,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 230,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 231,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 232,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 233,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 234,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 236,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 237,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 238,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 239,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 240,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 241,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 242,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 243,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 244,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1202",
      "rank": 245,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Swarm: prune merged/completed slot state directories after wave converges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 246,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 247,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 248,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 249,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 250,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1453",
      "rank": 251,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Audit: 3 cheap verifications that should ride along with merges (PAN-1170, PAN-1316, PAN-457 CLI parity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 252,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 253,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 254,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 255,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 256,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 258,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 260,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 261,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 262,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 263,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 264,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 265,
      "size": "XL",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: [EPIC] Pipeline Throughput Hardening — run many work agents safely, on-demand specialists, slot manager, fly.io scale-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1671",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: surface pending ExitPlanMode plan as a popup modal (reuse PlanCard + /plan-action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 267,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 268,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 269,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1838",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: [research] Grok Build (xAI) coding harness — research and specify support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 272,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 273,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 275,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 277,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1955",
      "rank": 278,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Issue cockpit: move beads from a tab into a persistent right rail with a 'working now' highlight",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 279,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1966",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Single authoritative pipeline-membership resolver — one function for \"what's in the pipeline\" (collapse the 5 divergent views)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 281,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 282,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 283,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 284,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 285,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 286,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 287,
      "size": "S",
      "importance": "medium",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles, reopening a data-loss window.",
      "rationale": "Data-loss-class composer bug: failSend wipes all in-flight optimistic bubbles and their compaction safety-net.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2083",
      "rank": 288,
      "size": "S",
      "importance": "medium",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves text in BOTH composer and retry outbox — double-send hazard.",
      "rationale": "Composer double-send hazard: failed-send text stays in both composer and retry outbox.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2024",
      "rank": 289,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 290,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 291,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 293,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 294,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 295,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 296,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 297,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 298,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 299,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2053",
      "rank": 300,
      "size": "M",
      "importance": "medium",
      "score": 8,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship: Dashboard: read-only \"why this model\" (resolved + weighted distribution + hash) at the top of the agent Start/Restart submenu (foll...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 301,
      "size": "M",
      "importance": "medium",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 302,
      "size": "M",
      "importance": "medium",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 303,
      "size": "M",
      "importance": "medium",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: persist pending images + unsent/failed text across reload (draft-text parity).",
      "rationale": "Promoted: body materially expanded to cover unsent/failed-text durability (data-loss-adjacent), tying it to the new composer-bug cluster (PAN-2082/2083).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 304,
      "size": "M",
      "importance": "medium",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 305,
      "size": "M",
      "importance": "medium",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1101",
      "rank": 306,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Permission safety hardening: CI guard, single emission chokepoint, property tests, runtime tripwire",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1122",
      "rank": 307,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trim OpenAI model catalog to 5 supported models",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1547",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "@panctl/cli npm install warns on Node <22 (engine mismatch + deprecated deps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1705",
      "rank": 309,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversation click stuck on Loading… for minutes during pipeline load — fat-poll request queueing collapse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1706",
      "rank": 310,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "orphaned playwright-mcp headless Chromiums keep full dashboard pages open — each multiplies dashboard poll load",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 311,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "rationale": "Incremental review: well-specified cost-bleed circuit breaker (graduated response, deadlock signatures, fleet-level guard) that prevents real runaway spend; no material body delta, so rank preserved, though it remains a strong future-promotion candidate as a safety item.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1896",
      "rank": 312,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce approval friction for GitHub CLI operations in managed sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 313,
      "size": "M",
      "importance": "medium",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector agent should resume a warm session instead of cold-spawning a new one per bead",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 314,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-592",
      "rank": 315,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Audit: Planning agent CLAUDE.md and STATE.md contents vs expectations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 316,
      "size": "S",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Doc: Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 317,
      "size": "S",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Doc: Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 318,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 319,
      "size": "S",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Doc: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 320,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-713",
      "rank": 321,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 322,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-826",
      "rank": 323,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Conversation/terminal integration refactor: instant-start + parser correctness + T3Code structural alignment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 324,
      "size": "L",
      "importance": "medium",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 325,
      "size": "S",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Doc: Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1555",
      "rank": 326,
      "size": "S",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Doc: remove/update stale swarm-runtime references after PAN-1517",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 327,
      "size": "S",
      "importance": "low",
      "score": 3,
      "condition": "ok",
      "dependsOn": [],
      "why": "Doc: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 328,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 329,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 330,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 331,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 332,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 333,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-104",
      "rank": 335,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost alerts/notifications when spending exceeds thresholds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 336,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 339,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 340,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 342,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 343,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 347,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 348,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 349,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 350,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 351,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 352,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 353,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 354,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 355,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-306",
      "rank": 356,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "merge-agent polyrepo false failures — stale refs, wrong error field, short timeout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-371",
      "rank": 357,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents tab only shows global specialists, not per-project ephemeral ones",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 358,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 359,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 360,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 363,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-472",
      "rank": 364,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "GET /api/costs/by-issue takes 10s — N+1 query on 353K rows × 184 issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 365,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 366,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 367,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-487",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "VBRIEF not archived to docs/prds/completed/ after merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 369,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-552",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code terminals should respect app light/dark mode scheme",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 371,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 373,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 374,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 375,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 376,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 377,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 378,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 380,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 381,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 383,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 384,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-656",
      "rank": 385,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs site scroll broken: dashboard CSS leaks onto panopticon-cli.com",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 386,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 387,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 388,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-683",
      "rank": 389,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "shadow-state getPendingSyncCount test is environment-dependent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 390,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 391,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 392,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 393,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 394,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 395,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 396,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 397,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 398,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 399,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 400,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 401,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 402,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 403,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 404,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 405,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 406,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 407,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 408,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 409,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 410,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 411,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 412,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 413,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 414,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-780",
      "rank": 415,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent stuck in feedback loop when old feedback files exist but review has passed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 416,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 417,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 418,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 419,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 420,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 421,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 422,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 423,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-834",
      "rank": 424,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cleanup: legacy ~/.panopticon/heartbeats/ directory has not been written since 2026-04-22",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-835",
      "rank": 425,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace creation removes stale .planning/ from previous issue but doesn't commit deletion → PR diff includes 982 unrelated lines",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-838",
      "rank": 426,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "synthesis.json contains hallucinated timestamp + sparse structure (only counts, no findings arrays)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 427,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 428,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-904",
      "rank": 429,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make AI title generation model configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 430,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 431,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 432,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 433,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-948",
      "rank": 434,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Implement pan scope lifecycle commands",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 435,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 436,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 437,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 439,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 440,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 441,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 442,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 443,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1115",
      "rank": 444,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inject observation context into agent prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 445,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 448,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 449,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 450,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 451,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 452,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 453,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1147",
      "rank": 454,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-agent done flow stalls at 'push and re-request review' after addressing review feedback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 455,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 456,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 457,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 458,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 459,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 460,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1238",
      "rank": 461,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board view follow-up — + New issue column footer button (deferred from PAN-1229)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 462,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Board view follow-up — + New issue column footer button (deferred from PAN-1229)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 463,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 464,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 465,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 466,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 467,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 468,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 469,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 470,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 471,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1493",
      "rank": 472,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "TEST: write hello.txt — probe for PAN-1200 Universal Context System verification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1548",
      "rank": 473,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "npx @panctl/cli shows stale placeholder message referencing v0.8.0",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 474,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 475,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 476,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 477,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1573",
      "rank": 478,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Consideration for reintroducing ability to --dangerously-skip-permissions, DO NOT act on this issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 479,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 480,
      "size": "M",
      "importance": "medium",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Caveman follow-up gaps: review-agent mode never set at spawn, no hook-execution test, missing Settings toggle.",
      "rationale": "Caveman follow-up gaps; includes a high-severity gap — review agents never get caveman active at spawn.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-1619",
      "rank": 481,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bridge host Codex auth into workspace containers + honest gpt-5.5 lock reason",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1620",
      "rank": 482,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awaiting-Merge button is clickable on a conflicting/CI-failing PR (stale blockerReasons)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1621",
      "rank": 483,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close human-only gate over-blocks operator conv-* sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1622",
      "rank": 484,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan dev restart leaves orphan dashboard servers (stale serving + multi-Deacon risk)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 485,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approv...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 486,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 487,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 488,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1644",
      "rank": 489,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hook-driven progressive conversation titling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 491,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 492,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 493,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1670",
      "rank": 494,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan dev hot-reload wedges tabs on 'Reconnecting to the dashboard…' — PAN-1580 boot watchdog never fires under Vite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 495,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1708",
      "rank": 496,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start CLI never flips spec plan.status proposed→approved — all 8 in-flight specs stuck at proposed, triggering reconciler misfires",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 497,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server boots, h...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 498,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1726",
      "rank": 499,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle did not pause the merged issue's work agent — idle agent holds a work slot and throttles all pipeline dispatch (PAN-16...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 500,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1729",
      "rank": 501,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "test(beads): beads-scoping work.md \"-l {{ISSUE_ID_LOWER}}\" label-filter assertion fails on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1730",
      "rank": 502,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "idle awaiting-test work sessions count against the PAN-1665 ceiling — pipeline livelocks when work pool alone exceeds total (work=7/9 obs...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1734",
      "rank": 503,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "request-review-nudge remote workspace HEAD test fails on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 504,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1739",
      "rank": 505,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck issue TREE still hides strike agents — frontend FeatureItem session-type allowlist omits 'strike' (4th allowlist miss); dead...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 506,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 507,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 508,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 509,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 510,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 511,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 512,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; readyForMerge only ever flips via the startup r...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 513,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-* origin)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1762",
      "rank": 514,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2: tracer-bullet planning contract (Path A) + foreman-driven intra-issue swarms (Path B)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 515,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 516,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 517,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 518,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1874",
      "rank": 519,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "per-issue override for review mode / re-review scope (extends PAN-1862 project-scope config)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 520,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1894",
      "rank": 521,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show UAT stack startup state in issue tree and issue slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 522,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 523,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 524,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywh...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 525,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 526,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1917",
      "rank": 527,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "/sessions page redesign: unify with conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 528,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls the onl...",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 529,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "--big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1935",
      "rank": 530,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "pi/kimi work-agent cost not recorded in cost_events → runaway spend is invisible (no cost-based safety possible)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 531,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 532,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 533,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all bead verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1953",
      "rank": 534,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design: beads rail mockup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1954",
      "rank": 535,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Beads rail: move beads to right sidebar, highlight active work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 536,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "rationale": "PAN-2088 (now in-review) builds directly on this delivery/source-attribution foundation; rank held at 536 because 2088 is shipping the generalization, leaving 1958 a low-priority scoped piece.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1963",
      "rank": 537,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Default to no-resume on dashboard boot; add 'Resume all' to the stopped-agents banner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 538,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 539,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 540,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 541,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1987",
      "rank": 542,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Allow renaming a registered project (display name is locked at registration)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 543,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 544,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 545,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 546,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 547,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2045",
      "rank": 548,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(test): frontend vitest (jsdom) is the test-gate bottleneck — ~5min vs ~72s root; move to happy-dom / tune pool",
      "rationale": "Incremental review: body is an unchanged, complete spec (frontend vitest happy-dom/pool tuning with acceptance criteria); no material delta and no closed dependency, so rank preserved.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 549,
      "size": "M",
      "importance": "medium",
      "score": 0,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1884",
      "rank": 550,
      "size": "M",
      "importance": "medium",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate panopticon agent operational rules from conversation-memory into the scope:dev rule/role layer; complete on main.",
      "rationale": "Qualifying agent-operational rules currently live only in the orchestrator's conversation memory — advisory background for one session, invisible to the work/review/flywheel agents they target (the same root cause that let RUN-34 misdiagnose pipeline state). This migrates them into tracked sync-sources/rules (scope:dev) and the flywheel role/brief, and settles the cadence/pan-close contradictions. The session briefing reports it already complete on main with planning self-aborted after posting evidence, so remaining work is close-out only; placed at the tail as the substantive work is done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2063",
      "rank": 551,
      "size": "XS",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT stack health panel should display collapsed by default to reduce clutter during active work.",
      "rationale": "Small cosmetic: the UAT stack health panel adds visual clutter when it is not the focus during active development. Default-collapsed state reduces noise. Ready+released+planned and in pipeline, so near-zero remaining effort; ranked low as minor polish.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2066",
      "rank": 552,
      "size": "L",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF knowledge skill — deferred v2 capabilities (hybrid search, viz, lease writes, MCP, semantic auditor).",
      "rationale": "Tracks five capabilities deliberately deferred out of v1 of the OKF knowledge skill (hybrid BM25+semantic search, graph visualizer, lease-based concurrent writes, MCP read server, LLM semantic auditor). None is needed for conformant shared-knowledge authoring in v1; each has a stated deferral rationale and acceptance criterion. Low-priority tracking issue; placed at the tail.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 553,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research: evaluate ponytail (prompt compression) and decide build-vs-integrate vs Caveman/TLDR/RTK.",
      "rationale": "Research spike; non-blocking; outcome is a build-vs-integrate recommendation.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2073",
      "rank": 554,
      "size": "S",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs: add user-facing page for the Desktop App (install, tray, embedded server, updates).",
      "rationale": "Docs gap: Desktop App has no user-facing page.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2072",
      "rank": 555,
      "size": "S",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs: add user-facing page for Beads (task tracking) — lifecycle, bd CLI, dashboard view, enforcement gate.",
      "rationale": "Docs gap: Beads has no user-facing page.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2071",
      "rank": 556,
      "size": "S",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs: add user-facing page for the Hooks system (lifecycle events, registration, built-ins, contract).",
      "rationale": "Docs gap: Hooks system has no user-facing page.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2070",
      "rank": 557,
      "size": "S",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs: add user-facing page for the Flywheel orchestrator (start/stop, prioritization, health, config).",
      "rationale": "Docs gap: Flywheel has no user-facing page.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2068",
      "rank": 558,
      "size": "S",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs: add user-facing page for Caveman (agent output compression) — modes, config, A/B, savings.",
      "rationale": "Docs gap: Caveman has no user-facing page.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-2067",
      "rank": 559,
      "size": "S",
      "importance": "low",
      "score": 5,
      "condition": "ok",
      "dependsOn": [],
      "why": "Docs: add user-facing page for RTK (Bash output compression) — toggle, config, savings, caveats.",
      "rationale": "Docs gap: RTK has no user-facing page.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": false
    },
    {
      "issue": "PAN-454",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 3,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Ship: Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "rationale": "Demoted: superseded by PAN-2076 — the Boot Reconciliation epic absorbs this crash-recovery UI work as its dashboard surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2143",
      "rank": 3,
      "size": "S",
      "importance": "critical",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linchpin for 24/7 throughput: deacon patrol must re-evaluate stale merge-blockers so resolved-conflict PRs actually merge.",
      "rationale": "New top node, replacing the closed keystone PAN-1919. resolveConflictGate only runs on-demand from review-dispatch routes, so any PR that picked up a merge_conflict blocker and then fell out of the active review flow is never re-evaluated — the blocker persists forever and the merge train never picks it up, even after the conflict is resolved by a rebase. Confirmed live on PAN-1884/PAN-2088/PAN-1718 (review+test passed, mergeable again, yet readyForMerge=0). The fix is a small, well-understood deacon patrol (reconcileStaleMergeBlockers with a 2-min per-issue cooldown), so it is high impact, small, and clear — the ideal top-of-backlog pick and the single biggest unblocker for autonomous merge-train throughput.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2108",
      "rank": 145,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel can't recover context-exhausted/troubled work agents — RUN-30 root throughput blocker; needs a flywheel-safe recovery surface.",
      "rationale": "RUN-30 root blocker: committed work strands on branches because the only recovery command (pan resume --compact) is flywheel-forbidden and deacon auto-resume exempts user-stopped/troubled agents.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2095",
      "rank": 152,
      "size": "M",
      "importance": "high",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload builds the divergent primary worktree, not origin/main — landed CI-green fixes never actually go live.",
      "rationale": "New substrate deploy bug: primary HEAD diverges (61 state-sync commits ahead, behind on landed fixes) so pan reload compiles stale source; freshly-landed strike fixes silently fail to deploy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 153,
      "size": "M",
      "importance": "medium",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike git-lock race leaves a broken partial workspace yet reports 'spawned' — false success blocks red-main reverts.",
      "rationale": "New substrate bug: concurrent git ops on the shared primary repo race the worktree create, leaving a workspace with no source tree and no branch while strike reports success.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2088",
      "rank": 154,
      "size": "L",
      "importance": "high",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-1958"
      ],
      "why": "Replace fragile tmux paste with pi extension control channel: steer/follow_up, effort, model, compact, quick-abort. In-review.",
      "rationale": "New in-pipeline node (in-review); pinned. Generalizes PAN-1958's delivery foundation into the full pi/oh-my-pi conversation control surface plus dashboard affordances.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 161,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pure dead-code deletion: remove superseded IssueCockpitBody subtree (8 files); data-loss audit confirms nothing lost.",
      "rationale": "New low-risk cleanup: IssueCockpitBody and its 7 orphaned cards are unreachable since IssueMissionControl superseded them; behavior-preserving deletion with a completed no-loss audit.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2145",
      "rank": 162,
      "size": "XL",
      "importance": "medium",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose routes/conversations.ts (4898 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: worst god-file (4898 lines); behavior-preserving decomposition improves AI-navigability and satisfies the file-size guard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2146",
      "rank": 165,
      "size": "XL",
      "importance": "medium",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose src/lib/agents.ts (4572 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: agents.ts is one of the most-imported god-files (4572 lines); behavior-preserving split, no call-site changes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2147",
      "rank": 168,
      "size": "XL",
      "importance": "medium",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose routes/agents.ts (4071 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: routes/agents.ts (4071 lines); behavior-preserving relocation behind a barrel.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2148",
      "rank": 175,
      "size": "XL",
      "importance": "medium",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose routes/issues.ts (4065 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: routes/issues.ts (4065 lines); behavior-preserving relocation behind a barrel.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2149",
      "rank": 216,
      "size": "L",
      "importance": "medium",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose lib/cloister/service.ts (2039 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: cloister/service.ts (2039 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2150",
      "rank": 561,
      "size": "L",
      "importance": "medium",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose Settings/SettingsPage.tsx (2043 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: SettingsPage.tsx (2043 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2151",
      "rank": 562,
      "size": "L",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose routes/misc.ts (1835 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: routes/misc.ts (1835 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2152",
      "rank": 563,
      "size": "L",
      "importance": "medium",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose cli/commands/workspace.ts (1791 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: cli workspace.ts (1791 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2153",
      "rank": 564,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose routes/specialists.ts (1753 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: routes/specialists.ts (1753 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2154",
      "rank": 565,
      "size": "L",
      "importance": "medium",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose lib/workspace-manager.ts (1736 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: workspace-manager.ts (1736 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2155",
      "rank": 566,
      "size": "M",
      "importance": "medium",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose chat/MessagesTimeline.tsx (1620 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: MessagesTimeline.tsx (1620 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2156",
      "rank": 567,
      "size": "M",
      "importance": "medium",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase-health: decompose services/conversation-service.ts (1609 lines) into <1000-line modules behind a re-export barrel.",
      "rationale": "New codebase-health cohort: conversation-service.ts (1609 lines); behavior-preserving split.",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
    {
      "from": "PAN-1861",
      "to": "PAN-1864",
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
      "from": "PAN-1454",
      "to": "PAN-1498",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1226",
      "to": "PAN-1232",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1226",
      "to": "PAN-1234",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1416",
      "to": "PAN-1444",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1122",
      "to": "PAN-1424",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-804",
      "to": "PAN-806",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-804",
      "to": "PAN-807",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1698",
      "to": "PAN-1783",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-863",
      "to": "PAN-1508",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1027",
      "to": "PAN-1508",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1124",
      "to": "PAN-1218",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.5
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2076",
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
      "from": "PAN-1775",
      "to": "PAN-2077",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2076",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2076",
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
      "from": "PAN-2085",
      "to": "PAN-2084",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1958",
      "to": "PAN-2088",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.8
    }
  ]
}
```
