# Backlog Sequence

_Last sequenced: 2026-06-21T03:34:13Z · model: claude-sonnet-4-5 · open: 544_


| rank | issue | size | importance | condition | depends-on | why |
|------|-------|------|------------|-----------|------------|-----|
| 1 | PAN-1908 | XL | critical | ok |  | Event-driven agent state: SQLite runtime registry + git-permanent records (big-bang). |
| 2 | PAN-1866 | XL | critical | ok |  | Backlog Sequencer — AI-ranked whole-backlog DAG with reproducible markdown truth. |
| 3 | PAN-1919 | L | critical | ok | PAN-1908 | Consolidate per-issue resume/progress state into ONE git-tracked record. |
| 4 | PAN-1832 | M | high | ok |  | Role Models: multiple models per role with weighted load-spreading. |
| 5 | PAN-1982 | L | high | ok |  | Revive convoy review as configurable opt-in (quick stays default). |
| 6 | PAN-1992 | M | high | ok | PAN-1983 | Skills: migrate all panopticon.db references to overdeck.db + re-verify. |
| 7 | PAN-2000 | M | critical | ok | PAN-1866 | RED MAIN — PAN-1866 fallout: spawn-sequencer stale assertion + health.json flakiness. |
| 8 | PAN-1903 | M | critical | ok |  | RED MAIN — create-beads.test.ts flaky 'table not found: issues' bd-DB-init race. |
| 9 | PAN-1880 | L | critical | ok |  | RED MAIN — start-sync-main-conflict.test.ts process.exit(1) under CI single-fork. |
| 10 | PAN-1859 | M | critical | ok |  | RED MAIN — agent-spawning.test.ts 'resumeAgent Pi FIFO' fails (writePiCommand). |
| 11 | PAN-1857 | S | critical | ok |  | RED MAIN — verification-gate.test.ts asserts stale src/dashboard/frontend path. |
| 12 | PAN-1698 | M | critical | ok |  | RED MAIN — model-count + schema-version + substrate-smoke expectations stale. |
| 13 | PAN-1783 | S | high | ok |  | RED MAIN — Command Deck resource-strip Playwright fixture expects old title. |
| 14 | PAN-1824 | M | high | ok |  | Flaky main CI: real-timer integration tests time out on loaded runners. |
| 15 | PAN-1710 | M | high | ok |  | CI hang — 'Clean install + server smoke test' never passes health poll. |
| 16 | PAN-1918 | M | high | ok |  | CI — full frontend vitest suite runs in no path; npm test capped to 3 files. |
| 17 | PAN-1720 | M | high | ok |  | RED — cloister auto-resume tests fail under full parallel run (test pollution). |
| 18 | PAN-1929 | M | critical | ok |  | HAZARD: background git rebase rewrites history in the SHARED primary worktree. |
| 19 | PAN-1781 | L | critical | ok |  | Context-overflow recovery: claude --resume bypasses native compact ~50% of time. |
| 20 | PAN-1508 | M | critical | ok |  | Immediate cleanup of safe post-merge feature-*/ workspaces (220GB). |
| 21 | PAN-1674 | M | critical | ok |  | TLDR .venv (~7.5G) duplicated into every workspace — 236G across 33 worktrees. |
| 22 | PAN-1934 | M | critical | ok |  | HAZARD: verification gate drives up to 10 retries on an unfixable check. |
| 23 | PAN-1817 | M | critical | ok | PAN-1823 | Linear API quota exhausted by IssueDataService polling (2500/hr hit). |
| 24 | PAN-1570 | M | critical | ok |  | Cost recorder dropped ALL cost events since 2026-05-21 (Effect-migration). |
| 25 | PAN-1935 | M | critical | ok |  | pi/kimi work-agent cost not recorded → runaway spend invisible. |
| 26 | PAN-1868 | M | critical | ok | PAN-1935, PAN-1570 | Cost-bleed circuit breaker: progress-aware, always-on runaway-spend guard. |
| 27 | PAN-1766 | M | critical | ok | PAN-1060, PAN-1627 | Work agents hang on Claude Code .claude/** settings-edit protection. |
| 28 | PAN-1060 | L | high | ok |  | Self-modify permission handling: stop the interrupt loop, keep the guard. |
| 29 | PAN-1572 | M | critical | ok | PAN-1101 | Settings permission-mode can desync — agents silently use --dangerously-skip-permissions. |
| 30 | PAN-1101 | M | high | ok |  | Permission safety hardening: CI guard, single emission chokepoint, tripwire. |
| 31 | PAN-1435 | S | high | ok |  | API keys in ~/.panopticon/config.yaml stored as plaintext. |
| 32 | PAN-1915 | M | high | ok | PAN-1435 | API key at-rest hardening: startup perm check + OS keychain + deprecate plaintext. |
| 33 | PAN-1064 | M | high | ok |  | Harden launcher generation against shell-quote injection (model/arg quoting). |
| 34 | PAN-1065 | M | high | ok |  | Validate issueId at every shell-string interpolation site (defense in depth). |
| 35 | PAN-1068 | M | high | ok | PAN-1064, PAN-1065 | PAN-1048 deferred findings: security, correctness, model-validation gaps. |
| 36 | PAN-1063 | S | medium | ok |  | Harden tts_daemon.py: bearer auth, CORS, body cap, concurrency bound. |
| 37 | PAN-1864 | L | critical | ok | PAN-1861, PAN-1982 | Review: deacon must deterministically synthesize from on-disk reports. |
| 38 | PAN-1861 | M | critical | ok | PAN-1982 | Review: synthesis wedges after PAN-1818 — parent stalls on REVIEWER_READY. |
| 39 | PAN-1830 | M | high | ok | PAN-1861 | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY. |
| 40 | PAN-1865 | L | medium | ok |  | Make Kimi runnable on claude-code — root-cause CLIProxy 200k-window illusion. |
| 41 | PAN-1454 | L | high | ok |  | META: 9 systemic failure patterns from 80-issue audit — substrate work. |
| 42 | PAN-804 | XL | high | ok |  | Epic D: archaeological audit & pre-1.0 cleanup. |
| 43 | PAN-807 | L | high | ok |  | Epic C: workspace state sanity on spawn. |
| 44 | PAN-806 | L | high | ok |  | Epic B: work agent doesn't touch git. |
| 45 | PAN-1666 | XL | high | ok | PAN-908 | EPIC: Pipeline Throughput Hardening — many work agents + slot manager + fly.io. |
| 46 | PAN-1491 | L | high | ok |  | Flywheel: metric-aware prioritization weighting substrate bugs by v1.0 criterion. |
| 47 | PAN-1988 | L | high | ok | PAN-1908 | Verdict signaling: one host-owned write door; agents journal, host owns DB. |
| 48 | PAN-1936 | L | high | ok | PAN-1988, PAN-1908 | Single source-of-truth reads — one canonical resolver per domain. |
| 49 | PAN-1983 | L | high | ok |  | Remove all panopticon.db-supporting code (legacy SQLite layer + migration). |
| 50 | PAN-1984 | M | medium | ok | PAN-1983 | Migrate/delete 18 dead panopticon.db modules referenced by ~30 tests. |
| 51 | PAN-1124 | M | high | ok |  | Decouple specs and PRDs from workspaces — write directly to main. |
| 52 | PAN-826 | XL | high | ok |  | Conversation/terminal integration refactor: instant-start + parser correctness. |
| 53 | PAN-450 | XL | medium | ok | PAN-1313 | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging. |
| 54 | PAN-1313 | L | high | ok |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync. |
| 55 | PAN-262 | L | high | ok |  | Refactor post-merge lifecycle into composable, idempotent operations. |
| 56 | PAN-1650 | L | high | ok |  | Split readyForMerge → gatesPassed (derived) + shipComplete. |
| 57 | PAN-1520 | L | high | ok | PAN-1102, PAN-1103 | META: unified 'agent awaiting input' — finish AskUserQuestion, generalize. |
| 58 | PAN-1994 | M | high | ok | PAN-1908 | Fresh plan --auto issue inherits another issue's merged/verifying state. |
| 59 | PAN-1993 | S | high | ok |  | Planning a freshly-created issue 404s (start-planning races GitHub). |
| 60 | PAN-1986 | M | high | ok |  | restartAgent: wipe stale agent-dir session pointers + refresh conv row. |
| 61 | PAN-1840 | M | medium | ok | PAN-1986 | Add 'pan switch <id>' — change running agent model/harness in one cmd. |
| 62 | PAN-1897 | M | high | ok |  | pan start workspace-prep hangs/times out (>120s) on re-entry. |
| 63 | PAN-1711 | L | high | ok |  | Dashboard event loop stalls 15-25s under load; watchdog force-restarts. |
| 64 | PAN-1901 | M | high | ok |  | Beads: merge=beads driver never configured — .beads/.pan state conflict-storms. |
| 65 | PAN-1770 | M | high | ok |  | pan-dir auto-commit rebase races live .pan/continues writes. |
| 66 | PAN-1213 | M | high | ok | PAN-1982 | Requirements reviewer: classify AC in_pr_scope vs whole_feature_scope. |
| 67 | PAN-1219 | M | medium | ok | PAN-1982 | Promote across-cycle review state to first-class data (cycle SHA, priors). |
| 68 | PAN-1066 | L | medium | ok | PAN-1982 | Complete PAN-1048 R5: retire dispatchParallelReview + specialists.ts. |
| 69 | PAN-1207 | M | high | ok | PAN-1982 | Review sub-specialists exit cleanly but state.json keeps 'running'. |
| 70 | PAN-1130 | S | high | ok | PAN-1982 | Headless review sub-reviewer normal exit misclassified as 'crashed'. |
| 71 | PAN-1131 | M | high | ok | PAN-1982 | Stale idle synthesis session blocks review re-dispatch. |
| 72 | PAN-838 | M | medium | ok | PAN-1982 | synthesis.json has hallucinated timestamp + sparse structure. |
| 73 | PAN-1862 | L | medium | ok | PAN-1982 | Cache-sharing review convoy: warm-parent fork + resumable re-review. |
| 74 | PAN-1874 | M | medium | ok | PAN-1862 | Per-issue override for review mode / re-review scope. |
| 75 | PAN-1557 | L | medium | ok | PAN-1982 | Interactive, attachable review convoy with hook-owned completion. |
| 76 | PAN-1827 | M | high | ok |  | Conversation view blank for pi-harness sessions — resolver claude/codex only. |
| 77 | PAN-1828 | S | high | ok |  | Conversation fork/handoff harness defaults ignore source — silent claude coercion. |
| 78 | PAN-1849 | S | high | ok |  | Flywheel: prioritize fixing a red main as its first duty. |
| 79 | PAN-1888 | S | high | ok |  | work-agent-stop-hook still reads legacy review-status.json. |
| 80 | PAN-1882 | S | high | ok |  | Strike workspaces never cleaned up — worktrees + branches pile up (27/16GB). |
| 81 | PAN-1879 | S | medium | ok |  | pan restart silently re-applies stale boot gates; can't re-enable deacon. |
| 82 | PAN-1873 | S | high | ok |  | verifying_on_main tagged at first merge, never cleared on re-activation. |
| 83 | PAN-1909 | S | high | ok |  | pan plan done handoff tail hangs — declares 'done' on local main only. |
| 84 | PAN-1931 | S | high | ok |  | complete-planning force-adds gitignored .pan/ state (regresses PAN-1215). |
| 85 | PAN-1907 | S | high | ok |  | Generalize ToS gate: block all non-claude-code harnesses from sub models. |
| 86 | PAN-1928 | S | high | ok |  | Lock model switching to brand-new conversations (0 messages). |
| 87 | PAN-1927 | S | medium | ok |  | config: remove hardcoded model fallbacks — model must come from settings. |
| 88 | PAN-1767 | S | medium | ok |  | Surface 'awaiting close-out' (verifying-on-main) count in stats. |
| 89 | PAN-1846 | M | high | ok |  | Unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation. |
| 90 | PAN-1386 | M | medium | ok |  | Flywheel never emits status snapshots — dashboard 'flywheel' pane blank. |
| 91 | PAN-1681 | M | high | ok |  | Test agents narrate 'tests pass' but never run pan specialists done test. |
| 92 | PAN-1027 | M | high | ok |  | Merge-status drift: deacon sets mergeStatus=merged w/o postMergeLifecycle. |
| 93 | PAN-1510 | M | critical | ok |  | Bug (critical): newly-filed issues missing from frontend store (parallel to the PAN-1506 strike-visibility bug) |
| 94 | PAN-1506 | M | critical | ok |  | Bug (critical): strike agents missing from frontend store despite appearing in /api/agents and read-model boots… |
| 95 | PAN-1214 | M | high | ok |  | Bug (high): Dashboard server crashes on UnhandledPromiseRejection from deacon poke/kill of dead agents |
| 96 | PAN-1456 | L | critical | ok |  | Bug (critical): [HANDOFF] Pass-3 audit incomplete — fresh-context agent must continue per docs/audit-2026-05-24… |
| 97 | PAN-1560 | M | high | ok |  | Bug (high): Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 98 | PAN-1499 | XS | high | ok |  | Bug (high): Substrate fix (PAN-1454 pattern 2): block pan done if close-out comment defers work without a f… |
| 99 | PAN-955 | M | high | ok |  | Bug (high): Workspace devcontainer template versioning + re-render on demand |
| 100 | PAN-578 | M | high | ok |  | Task (high): Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 101 | PAN-1193 | M | high | ok |  | Bug (high): Swarm: no slot-to-slot file coordination — slots independently produce overlapping work |
| 102 | PAN-1198 | M | high | ok |  | Bug (high): Workspace init container's bun install doesn't populate container-node-modules named volume |
| 103 | PAN-1209 | M | high | ok |  | Bug (high): PAN-1052 bead projection disagrees with bd state |
| 104 | PAN-1498 | M | high | ok |  | Bug (high): Substrate fix (PAN-1454 pattern 1): require live-code-path trace in requirements review |
| 105 | PAN-1618 | M | high | ok |  | Bug (high): Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-… |
| 106 | PAN-1725 | M | high | ok |  | Bug (high): Review role agents can be marked orphaned after writing successful outputs |
| 107 | PAN-538 | M | high | ok |  | Bug (high): npm run build sometimes skips Vite frontend rebuild |
| 108 | PAN-49 | M | high | ok |  | Bug (high): Fix CloisterService tests that require real runtime |
| 109 | PAN-113 | M | high | ok |  | Bug (high): Dashboard 'Start Agent' returns success before verifying agent actually started |
| 110 | PAN-1232 | XS | high | ok |  | Bug (high): PAN-1148 follow-up — IssueDrawer 6 tabs as placeholders + title font + header structure + strea… |
| 111 | PAN-1234 | XS | high | ok |  | Bug (high): PAN-1148 follow-up — cross-cutting (Space Grotesk / keyboard shortcuts / /issues/:id route / IN… |
| 112 | PAN-1416 | M | high | ok |  | Bug (high): Workspace-spawned dashboard servers can bind the main pan.localhost port and hijack the canonic… |
| 113 | PAN-1436 | XS | high | ok |  | Bug (high): PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 114 | PAN-1452 | XS | high | ok |  | Task (high): PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1… |
| 115 | PAN-244 | M | high | ok |  | Bug (high): Deep-wipe leaves local branch and worktree metadata behind |
| 116 | PAN-245 | M | high | ok |  | Bug (high): Ctrl+C aborts planning dialog instead of copying text |
| 117 | PAN-247 | M | high | ok |  | Bug (high): Deacon has no backoff or escalation for repeated specialist startup failures |
| 118 | PAN-304 | M | high | ok |  | Bug (high): closeLinearDirect returns stepOk even when state update never happens |
| 119 | PAN-1769 | M | high | ok |  | Bug (high): Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + t… |
| 120 | PAN-321 | M | high | ok |  | Bug (high): Ephemeral merge specialist fails silently for polyrepo MYN projects |
| 121 | PAN-324 | XS | high | ok |  | Bug (high): Agent detail pane missing Merge/Approve button |
| 122 | PAN-334 | M | high | ok |  | Bug (high): Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 123 | PAN-605 | M | high | ok |  | Bug (high): Reconcile CLAUDE.md prompt assembly across all agent types |
| 124 | PAN-673 | M | high | ok |  | Bug (high): virtualizer inline ref causes blank conversation page on large message lists |
| 125 | PAN-681 | M | high | ok |  | Bug (high): Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 126 | PAN-1445 | XS | high | ok |  | Bug (high): PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-cree… |
| 127 | PAN-1446 | XS | high | ok |  | Bug (high): PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep … |
| 128 | PAN-1447 | XS | high | ok |  | Bug (high): PAN-1194 follow-up: restore failed-merge slot UI deleted by sibling PAN-1148 merge |
| 129 | PAN-886 | M | high | ok |  | Bug (high): pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 130 | PAN-890 | M | high | ok |  | Bug (high): Conflict-resolver agent merges stale main snapshot and never pushes |
| 131 | PAN-899 | M | high | ok |  | Bug (high): Agent CLI commands fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE |
| 132 | PAN-900 | M | high | ok |  | Bug (high): Trust devroot for conversations + atomic .claude.json writes |
| 133 | PAN-928 | M | high | ok |  | Bug (high): verification-runner: polyrepo workspaces fail at sync-target-branch |
| 134 | PAN-929 | M | high | ok |  | Bug (high): review-run: polyrepo workspaces detect overlay repo instead of code repos |
| 135 | PAN-932 | M | high | ok |  | Bug (high): pan done: polyrepo uncommitted changes check + existing MR handling |
| 136 | PAN-933 | M | high | ok |  | Bug (high): Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 137 | PAN-1142 | M | high | ok |  | Enhance (high): Add reasoning effort level to per-role / per-conversation model config |
| 138 | PAN-1816 | XS | high | ok |  | Bug (high): Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent… |
| 139 | PAN-1998 | M | high | ok |  | Bug (high): Remodel cleanup: drop orphan observation_index + reset_markers tables from the overdeck.db migr… |
| 140 | PAN-1038 | M | high | ok |  | Bug (high): Conversation diff panel always empty: conv.claudeSessionId is null for all conversations |
| 141 | PAN-1042 | M | high | ok |  | Bug (high): cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 142 | PAN-1113 | M | high | ok |  | Bug (high): Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 143 | PAN-1128 | M | high | ok |  | Bug (high): Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 144 | PAN-1129 | M | high | ok |  | Bug (high): Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 145 | PAN-1149 | M | high | ok |  | Bug (high): v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model R… |
| 146 | PAN-1150 | M | high | ok |  | Bug (high): Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (… |
| 147 | PAN-1173 | M | high | ok |  | Bug (high): pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 148 | PAN-1226 | XL | high | ok |  | Bug (high): PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 149 | PAN-1240 | M | high | ok |  | Bug (high): Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 150 | PAN-1243 | M | high | ok |  | Bug (high): pan admin hooks install: resolver fails outside repo CWD (auto-config breaks flywheel resume) |
| 151 | PAN-1247 | M | high | ok |  | Bug (high): Substrate: deacon orphan-test recovery loops dispatch_failed forever on an unhealthy workspace … |
| 152 | PAN-1258 | M | high | ok |  | Bug (high): Swarm slot spawn hangs silently before writeLauncherScriptAtomic when model=kimi-k2.6 |
| 153 | PAN-1263 | M | high | ok |  | Bug (high): Swarm UX: pipeline rows and IssueDrawer don't surface per-slot identity or multi-slot navigation |
| 154 | PAN-1330 | M | high | ok |  | Bug (high): CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' pref… |
| 155 | PAN-1336 | M | high | ok |  | Bug (high): Swarm: pan swarm --auto-advance cannot advance — no slot-PR merger, slots never self-terminate |
| 156 | PAN-1392 | M | high | ok |  | Bug (high): pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also ex… |
| 157 | PAN-1433 | M | high | ok |  | Bug (high): Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 158 | PAN-1434 | M | high | ok |  | Bug (high): conv-find.py reports session_file: N/A for newer conversation records (wrong column) |
| 159 | PAN-1438 | M | high | ok |  | Bug (high): pan flywheel start launcher process orphans when orchestrator dies externally |
| 160 | PAN-1439 | M | high | ok |  | Bug (high): Recover conv-2084's in-progress PANOPTICON_PROJECT_ROOT env var work |
| 161 | PAN-1440 | XS | high | ok |  | Bug (high): Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 162 | PAN-1444 | XS | high | ok |  | Bug (high): Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 163 | PAN-1504 | L | high | ok |  | Enhance (high): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + sk… |
| 164 | PAN-546 | M | medium | ok |  | Enhance (medium): Remove claude-code-router — all providers use direct env var injection |
| 165 | PAN-1218 | M | high | ok |  | Enhance (high): Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 166 | PAN-1449 | XS | high | ok |  | Bug (high): PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates … |
| 167 | PAN-1461 | M | high | ok |  | Bug (high): Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtuali… |
| 168 | PAN-1472 | M | high | ok |  | Bug (high): Swarm inspect agents emit pan tell to parent agent ID — fails when only slot agents exist |
| 169 | PAN-1530 | S | high | ok |  | Bug (high): Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 170 | PAN-1556 | M | high | ok |  | Bug (high): Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active … |
| 171 | PAN-1559 | M | high | ok |  | Bug (high): Orphaned inspect sessions: live tmux panes with no state.json escape all reapers |
| 172 | PAN-1564 | M | high | ok |  | Bug (high): Pi extension path + dashboard server spawn both depend on launch cwd (fix: resolve against pack… |
| 173 | PAN-1565 | M | high | ok |  | Bug (high): Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume … |
| 174 | PAN-1571 | M | high | ok |  | Bug (high): Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to… |
| 175 | PAN-1582 | M | high | ok |  | Bug (high): Handoff fork falls back to summary: external authoring session stalls on Write permission |
| 176 | PAN-1624 | M | high | ok |  | Bug (high): pan handoff --author external: authored doc is socket_write-ten but never submitted — successor… |
| 177 | PAN-1637 | M | high | ok |  | Bug (high): Conversation resume reattaches to a keep-alive corpse (no harness-liveness probe) |
| 178 | PAN-1638 | M | high | ok |  | Bug (high): Conversation DB status stays 'active' after the harness process dies |
| 179 | PAN-1652 | M | high | ok |  | Bug (high): Conversation title regeneration 500s on large transcripts — claude title invocation times out a… |
| 180 | PAN-1673 | M | high | ok |  | Bug (high): Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 181 | PAN-1682 | M | high | ok |  | Bug (high): strike agents missing from Command Deck issue tree — resource-discovery.ts:471 tmux-prefix allo… |
| 182 | PAN-1688 | M | high | ok |  | Bug (high): System Briefing: 'Cost today' card always $0.00 — reads orphaned cost-monitor.dailyTotal instea… |
| 183 | PAN-1689 | M | high | ok |  | Bug (high): System Briefing: 'Paused / troubled' card inflated ~8x (~185 vs real ~24) by stale stopped sub-… |
| 184 | PAN-1718 | M | high | ok |  | Bug (high): Duplicate successful 'pan reload' restart-status writes from two unidentified concurrent proces… |
| 185 | PAN-1722 | M | high | ok |  | Bug (high): Awareness rail activity entries don't survive page load — snapshot doesn't seed recentActivity,… |
| 186 | PAN-255 | M | medium | ok |  | Enhance (medium): Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 187 | PAN-630 | M | high | ok |  | Enhance (high): Multi-tenant workspace isolation with ACLs |
| 188 | PAN-1451 | XS | high | ok |  | Task (high): PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 189 | PAN-1538 | M | high | ok |  | Enhance (high): Unblock Pi source forks — remove API guard, verify transcript parsers |
| 190 | PAN-1544 | M | high | ok |  | Task (high): Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 191 | PAN-1789 | M | high | ok |  | Bug (high): Conversation status shows 'ended' for a live codex-harness handoff session |
| 192 | PAN-1790 | M | high | ok |  | Bug (high): pan handoff: focus text without conv id mis-parses as conversation; help string missing codex; … |
| 193 | PAN-1793 | M | high | ok |  | Bug (high): pan handoff kickoff message is not delivered to pi-harness conversations |
| 194 | PAN-1795 | M | high | ok |  | Bug (high): Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring … |
| 195 | PAN-1823 | M | high | ok |  | Bug (high): Linear polling is not rate-limit-aware — no 429 backoff (secondary to PAN-1817) |
| 196 | PAN-1833 | M | high | ok |  | Bug (high): Pi spawn checks pi-extension via process.cwd() — 'Pi extension not built' when pan start/strike… |
| 197 | PAN-1850 | M | high | ok |  | Bug (high): Conversation transcripts >10MB are truncated by the initial-read cap (missing-middle live view) |
| 198 | PAN-1893 | M | high | ok |  | Bug (high): pan start STILL crashes toUpperCase after sync-main conflict for gpt-5.5/claude-code agent stat… |
| 199 | PAN-1900 | M | high | ok |  | Bug (high): UAT candidate branch codename is non-deterministic — proliferates a new uat/* branch per assemb… |
| 200 | PAN-1912 | M | high | ok |  | Bug (high): Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 201 | PAN-1956 | M | high | ok |  | Bug (high): GLM-5.2 and GLM-5.1: contextWindow set to output cap (should be input context); also verify pri… |
| 202 | PAN-813 | M | high | ok |  | Task (high): Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 203 | PAN-1195 | M | high | ok |  | Enhance (high): Swarm: parent work agent goes silent during swarm dispatch — no parent-orchestrates mode |
| 204 | PAN-1217 | M | high | ok |  | Enhance (high): Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-… |
| 205 | PAN-1224 | M | high | needs-refinement |  | Bug (high): Ensure 'ship' (or close-out) restarts the running dashboard so merged code is actually live |
| 206 | PAN-1227 | M | high | needs-refinement |  | Bug (high): Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan … |
| 207 | PAN-1246 | M | high | ok |  | Enhance (high): projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 208 | PAN-1253 | M | high | ok |  | Enhance (high): Flywheel: respect issue dependencies before autopicking work |
| 209 | PAN-1254 | M | high | ok |  | Enhance (high): Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 210 | PAN-1357 | M | high | ok |  | Enhance (high): Template conversations: load curated skill bundles into a single conversation |
| 211 | PAN-1497 | M | high | ok |  | Enhance (high): emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 212 | PAN-1525 | M | high | ok |  | Enhance (high): Composer autocomplete: expose all CLI args for every pan command |
| 213 | PAN-1558 | M | high | ok |  | Enhance (high): Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 214 | PAN-1561 | M | high | ok |  | Enhance (high): Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity f… |
| 215 | PAN-1578 | M | high | ok |  | Enhance (high): GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 216 | PAN-1588 | M | high | ok |  | Enhance (high): PAN-800 Phase 5: eliminate parseThinkingDuration / capture-pane stuck detection |
| 217 | PAN-1594 | M | high | ok |  | Enhance (high): Hook-driven agent readiness (kill prompt-polling + permission-mode coupling) |
| 218 | PAN-1115 | M | medium | ok |  | Task (medium): Inject observation context into agent prompts |
| 219 | PAN-1889 | M | high | ok |  | Enhance (high): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole e… |
| 220 | PAN-399 | M | medium | ok |  | Enhance (medium): Release specialist — coordinated post-merge rollout and release safety |
| 221 | PAN-532 | M | medium | ok |  | Enhance (medium): Per-project and per-issue model overrides for workflow agent model selection |
| 222 | PAN-537 | M | medium | ok |  | Task (medium): show changed files diff summary after each agent response in activity view |
| 223 | PAN-592 | L | medium | ok |  | Task (medium): Audit: Planning agent CLAUDE.md and STATE.md contents vs expectations |
| 224 | PAN-608 | M | medium | ok |  | Enhance (medium): Integrate Destructive Command Guard (dcg) with configurable settings |
| 225 | PAN-646 | M | medium | ok |  | Task (medium): Canceled issues: add guided Recover workflow |
| 226 | PAN-700 | M | medium | ok |  | Task (medium): Detachable terminal for conversation view — popout into OS window |
| 227 | PAN-713 | M | medium | ok |  | Task (medium): add unit tests for doneCommand and approveCommand |
| 228 | PAN-1573 | M | medium | ok |  | Task (medium): Consideration for reintroducing ability to --dangerously-skip-permissions, DO NOT act on this i… |
| 229 | PAN-1577 | M | medium | ok |  | Enhance (medium): Move a conversation to a different project (CLI + drag/drop + menu action) |
| 230 | PAN-1782 | M | medium | ok |  | Task (medium): Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompa… |
| 231 | PAN-37 | M | medium | ok |  | Enhance (medium): Support external PR selection for merge-agent |
| 232 | PAN-38 | M | medium | ok |  | Enhance (medium): Support multiple merge agents per repository |
| 233 | PAN-44 | M | medium | stale |  | Task (medium): Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 234 | PAN-47 | M | medium | stale |  | Task (medium): PRD files should be committed to feature branch, moved to completed/ on merge |
| 235 | PAN-51 | M | medium | stale |  | Task (medium): Documentation: Clarify issue tracker options beyond Linear |
| 236 | PAN-52 | M | medium | stale |  | Task (medium): Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 237 | PAN-54 | M | medium | stale |  | Task (medium): Add pan test:e2e command for full workflow integration test |
| 238 | PAN-55 | M | medium | stale |  | Task (medium): Track specialist costs with time period filtering |
| 239 | PAN-77 | XS | medium | ok |  | Enhance (medium): Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 240 | PAN-104 | M | medium | stale |  | Task (medium): Cost alerts/notifications when spending exceeds thresholds |
| 241 | PAN-106 | M | medium | stale |  | Task (medium): Cost prediction/estimation for in-progress work |
| 242 | PAN-111 | M | medium | ok |  | Enhance (medium): Support cross-machine planning state sync without cross-contamination |
| 243 | PAN-783 | XL | medium | ok |  | Enhance (medium): Agents Page Redesign — Unified Multi-View Experience |
| 244 | PAN-802 | M | medium | ok |  | Task (medium): Resume on conversation session forks instead of resuming |
| 245 | PAN-817 | M | medium | ok |  | Enhance (medium): Improve planning dialog layout and content fit |
| 246 | PAN-863 | M | medium | ok |  | Task (medium): Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees) |
| 247 | PAN-924 | S | medium | ok |  | Enhance (medium): Spike: evaluate GitNexus for Panopticon integration |
| 248 | PAN-947 | M | medium | ok |  | Enhance (medium): project management actions in unified sidebar |
| 249 | PAN-1196 | M | high | needs-refinement |  | Enhance (high): Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 250 | PAN-1311 | M | high | needs-refinement |  | Enhance (high): Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 251 | PAN-1424 | XS | high | needs-refinement |  | Enhance (high): Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 252 | PAN-146 | M | medium | stale |  | Task (medium): Refine light mode theming across all dashboard pages |
| 253 | PAN-155 | XL | medium | stale |  | Task (medium): Redesign health page with Stitch (system overview, timeline, costs) |
| 254 | PAN-175 | M | medium | stale |  | Task (medium): Pre-compact auto-save hook for agent sessions |
| 255 | PAN-176 | M | medium | stale |  | Task (medium): Hook-enforced delegation guardrails for specialist agents |
| 256 | PAN-177 | M | medium | stale |  | Task (medium): Iteration limits with escalation for autonomous agents |
| 257 | PAN-178 | M | medium | stale |  | Task (medium): Crash recovery with granular task checkpointing |
| 258 | PAN-180 | M | medium | stale |  | Task (medium): Cross-terminal file locking for concurrent agents |
| 259 | PAN-190 | M | medium | stale |  | Task (medium): Specialized reviewer prompts (industry best-practice checklists) |
| 260 | PAN-198 | L | medium | stale |  | Task (medium): Structured audit trail for agent actions |
| 261 | PAN-1040 | M | medium | ok |  | Enhance (medium): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 262 | PAN-1041 | L | medium | ok |  | Enhance (medium): Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 263 | PAN-1102 | M | medium | ok |  | Enhance (medium): real-time notification + interactive prompts when agent awaits user input |
| 264 | PAN-1103 | M | medium | ok |  | Enhance (medium): surface AskUserQuestion choice options in conversation view |
| 265 | PAN-1122 | M | medium | ok |  | Task (medium): Trim OpenAI model catalog to 5 supported models |
| 266 | PAN-1164 | M | medium | ok |  | Enhance (medium): Push diff summary updates over /ws/rpc instead of 5s polling |
| 267 | PAN-1533 | M | medium | ok |  | Task (medium): Fork-into-worktree from conversation branch chip |
| 268 | PAN-1696 | M | medium | ok |  | Task (medium): decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view |
| 269 | PAN-1775 | M | medium | ok |  | Task (medium): remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility re… |
| 270 | PAN-1776 | M | medium | ok |  | Enhance (medium): hot-updatable delivery path — version-stamped supervisors, rolling refresh, and dumb-shim primi… |
| 271 | PAN-227 | M | medium | ok |  | Task (medium): Phase gate validation — mid-implementation acceptance checks |
| 272 | PAN-228 | M | medium | ok |  | Task (medium): Shift-left post-edit diagnostics — type check after every edit |
| 273 | PAN-243 | L | medium | ok |  | Enhance (medium): Audit dashboard actions: ensure all are available via CLI |
| 274 | PAN-249 | M | medium | ok |  | Task (medium): Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 275 | PAN-252 | XS | medium | ok |  | Enhance (medium): Disable Sync with Main button when workspace is up to date |
| 276 | PAN-258 | M | medium | ok |  | Enhance (medium): Kanban board: fit all columns without horizontal scrolling |
| 277 | PAN-265 | M | medium | ok |  | Task (medium): Review skill categorization: all skills available everywhere via personal + workspace |
| 278 | PAN-271 | M | medium | ok |  | Task (medium): Auto-assign Linear project from project config when creating issues |
| 279 | PAN-277 | M | medium | ok |  | Enhance (medium): Session reasoning capture & collaborative PRD refinement |
| 280 | PAN-283 | M | medium | ok |  | Task (medium): Reset should sync workspace feature branch with latest main |
| 281 | PAN-293 | M | medium | ok |  | Enhance (medium): Project Living Memory — per-project semantic memory for agents |
| 282 | PAN-294 | M | medium | ok |  | Enhance (medium): Surface module initialization errors as system-level, not per-issue |
| 283 | PAN-297 | M | medium | ok |  | Task (medium): Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 284 | PAN-298 | M | medium | ok |  | Task (medium): Auto-detect package manager and runtime in workspace setup |
| 285 | PAN-299 | M | medium | ok |  | Task (medium): Granular session state persistence across context compaction |
| 286 | PAN-306 | M | medium | ok |  | Task (medium): merge-agent polyrepo false failures — stale refs, wrong error field, short timeout |
| 287 | PAN-752 | M | medium | ok |  | Task (medium): Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 288 | PAN-832 | M | medium | ok |  | Task (medium): state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase… |
| 289 | PAN-834 | M | medium | ok |  | Task (medium): Cleanup: legacy ~/.panopticon/heartbeats/ directory has not been written since 2026-04-22 |
| 290 | PAN-835 | M | medium | ok |  | Task (medium): Workspace creation removes stale .planning/ from previous issue but doesn't commit deletion → P… |
| 291 | PAN-927 | M | medium | ok |  | Task (medium): Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 292 | PAN-1488 | M | medium | ok |  | Enhance (medium): add required_pull_request_reviews to main branch protection |
| 293 | PAN-1547 | M | medium | ok |  | Task (medium): @panctl/cli npm install warns on Node <22 (engine mismatch + deprecated deps) |
| 294 | PAN-1610 | M | medium | ok |  | Enhance (medium): Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards,… |
| 295 | PAN-1705 | M | medium | ok |  | Task (medium): conversation click stuck on Loading… for minutes during pipeline load — fat-poll request queuei… |
| 296 | PAN-1706 | M | medium | ok |  | Task (medium): orphaned playwright-mcp headless Chromiums keep full dashboard pages open — each multiplies das… |
| 297 | PAN-1852 | M | medium | ok |  | Enhance (medium): Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmar… |
| 298 | PAN-371 | M | medium | ok |  | Task (medium): Agents tab only shows global specialists, not per-project ephemeral ones |
| 299 | PAN-1136 | M | medium | ok |  | Task (medium): Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 300 | PAN-1152 | M | medium | ok |  | Task (medium): Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 301 | PAN-1442 | XS | medium | ok |  | Enhance (medium): Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 302 | PAN-1896 | M | medium | ok |  | Task (medium): Reduce approval friction for GitHub CLI operations in managed sessions |
| 303 | PAN-1951 | M | medium | ok |  | Task (medium): Inspector agent should resume a warm session instead of cold-spawning a new one per bead |
| 304 | PAN-407 | M | medium | ok |  | Task (medium): Run Panopticon from a main workspace for development isolation |
| 305 | PAN-438 | M | medium | ok |  | Task (medium): Migrate remaining REST polling endpoints to Effect RPC |
| 306 | PAN-452 | M | medium | ok |  | Enhance (medium): Conversation input bar — mode/permissions/workspace selectors |
| 307 | PAN-454 | M | medium | ok |  | Enhance (medium): Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 308 | PAN-456 | M | medium | ok |  | Enhance (medium): Store Claude Code session IDs for agent resume after crash/restart |
| 309 | PAN-459 | M | medium | ok |  | Task (medium): Planning setup screen with SSE progress streaming |
| 310 | PAN-461 | M | medium | ok |  | Task (medium): Deep-wipe multi-step progress dialog |
| 311 | PAN-463 | M | medium | ok |  | Enhance (medium): Add Qwen 3.6+ model support |
| 312 | PAN-465 | M | medium | ok |  | Enhance (medium): Add OpenRouter as a model provider |
| 313 | PAN-466 | M | medium | ok |  | Enhance (medium): Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 314 | PAN-468 | M | medium | ok |  | Task (medium): Agent test conversations pollute production database — need test isolation |
| 315 | PAN-471 | M | medium | ok |  | Task (medium): Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 316 | PAN-472 | M | medium | ok |  | Task (medium): GET /api/costs/by-issue takes 10s — N+1 query on 353K rows × 184 issues |
| 317 | PAN-476 | M | medium | ok |  | Task (medium): Agent resume with Haiku session summary instead of claude --resume |
| 318 | PAN-480 | XS | medium | ok |  | Task (medium): Pass --effort flag when spawning planning agents via Cloister |
| 319 | PAN-483 | M | medium | ok |  | Task (medium): Unify Resume Agent UX — all entry points should show message input |
| 320 | PAN-487 | M | medium | ok |  | Task (medium): VBRIEF not archived to docs/prds/completed/ after merge |
| 321 | PAN-543 | M | medium | ok |  | Task (medium): Add confirmation dialog before applying Optimal Defaults |
| 322 | PAN-548 | M | medium | ok |  | Enhance (medium): Command Deck: preserve state across navigation including URL routing for tabs |
| 323 | PAN-552 | M | medium | ok |  | Task (medium): Claude Code terminals should respect app light/dark mode scheme |
| 324 | PAN-554 | M | medium | ok |  | Task (medium): Add kanban board deeplinks for issue URLs |
| 325 | PAN-564 | M | medium | ok |  | Task (medium): Slash menu positioned incorrectly — cut off / off-screen |
| 326 | PAN-565 | M | medium | ok |  | Task (medium): Handle CTRL-Z to undo accidental conversation archival |
| 327 | PAN-568 | M | medium | ok |  | Task (medium): Kanban: Show workspace and tmux session counts in stats |
| 328 | PAN-570 | XS | medium | ok |  | Task (medium): Show PLAN badge on costs when under a subscription/plan |
| 329 | PAN-571 | M | medium | ok |  | Task (medium): Add OpenRouter credits/plan status endpoint and UI |
| 330 | PAN-576 | M | medium | ok |  | Task (medium): Global / search should include conversations in addition to workspace features |
| 331 | PAN-589 | M | medium | ok |  | Task (medium): Review and update commands-skills.md with all available Panopticon skills |
| 332 | PAN-591 | M | medium | ok |  | Task (medium): Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 333 | PAN-603 | M | medium | ok |  | Task (medium): Plan review loop with configurable reviewer model |
| 334 | PAN-604 | M | medium | ok |  | Task (medium): Hide planning agent from workspace detail pane |
| 335 | PAN-606 | M | medium | ok |  | Enhance (medium): Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 336 | PAN-607 | M | medium | ok |  | Enhance (medium): Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 337 | PAN-613 | S | medium | ok |  | Enhance (medium): Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 338 | PAN-622 | M | medium | ok |  | Task (medium): YAML workflow DAGs: custom per-project pipeline definitions |
| 339 | PAN-624 | M | medium | ok |  | Task (medium): Loop nodes: iterative agent execution with conditional termination |
| 340 | PAN-629 | M | medium | ok |  | Enhance (medium): Workspace quotas and resource governance |
| 341 | PAN-637 | M | medium | ok |  | Enhance (medium): Direct issue kickoff (skip planning) from dashboard UI |
| 342 | PAN-654 | M | medium | ok |  | Enhance (medium): Project Setup Wizard — Dashboard UI |
| 343 | PAN-656 | M | medium | ok |  | Task (medium): Docs site scroll broken: dashboard CSS leaks onto panopticon-cli.com |
| 344 | PAN-658 | M | medium | ok |  | Task (medium): Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 345 | PAN-660 | M | medium | ok |  | Task (medium): Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 346 | PAN-663 | M | medium | ok |  | Task (medium): Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 347 | PAN-675 | M | medium | ok |  | Enhance (medium): Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 348 | PAN-678 | M | medium | ok |  | Enhance (medium): pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 349 | PAN-683 | M | medium | ok |  | Task (medium): shadow-state getPendingSyncCount test is environment-dependent |
| 350 | PAN-687 | M | medium | ok |  | Enhance (medium): Support OpenCode as alternative coding agent |
| 351 | PAN-701 | M | medium | ok |  | Task (medium): Quick-Create conversation via keystroke using Conversations-page default model |
| 352 | PAN-702 | M | medium | ok |  | Task (medium): OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 353 | PAN-709 | M | medium | ok |  | Task (medium): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detec… |
| 354 | PAN-727 | M | medium | ok |  | Task (medium): Fix orphaned work-agent start handoff after planning |
| 355 | PAN-730 | M | medium | ok |  | Task (medium): Add provider account telemetry for credits, balances, and usage |
| 356 | PAN-735 | M | medium | ok |  | Task (medium): Settings page: review and configure overridden subagent model files |
| 357 | PAN-736 | M | medium | ok |  | Task (medium): wire per-subagent model overrides from settings to Claude Code spawn env |
| 358 | PAN-738 | M | medium | ok |  | Task (medium): Add right-click fork option to conversation list |
| 359 | PAN-743 | XS | medium | ok |  | Task (medium): Add consistent new conversation icon actions in Command Deck |
| 360 | PAN-1913 | M | high | ok |  | Enhance (high): Project description: show on click, edit in dashboard, mirror into the project layer (and docum… |
| 361 | PAN-747 | M | medium | ok |  | Task (medium): Conversation list items lack accessible labels in accessibility tree |
| 362 | PAN-749 | S | medium | ok |  | Task (medium): Research and borrow best features from gstack |
| 363 | PAN-750 | XL | medium | ok |  | Task (medium): PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 364 | PAN-751 | M | medium | ok |  | Task (medium): PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 365 | PAN-762 | M | medium | ok |  | Task (medium): Settings: warn when model overrides target disabled providers |
| 366 | PAN-764 | M | medium | ok |  | Task (medium): Add quota/usage inspector for routed model providers |
| 367 | PAN-765 | M | medium | ok |  | Task (medium): Preserve trailing zeros in cost displays |
| 368 | PAN-769 | M | medium | ok |  | Task (medium): Track verification/review/test phase churn over time |
| 369 | PAN-771 | S | medium | ok |  | Task (medium): Investigate Vercel Sandbox execution backend support |
| 370 | PAN-772 | M | medium | ok |  | Task (medium): Unify terminal stack behavior across tmux sessions |
| 371 | PAN-773 | M | medium | ok |  | Task (medium): Design prompt-style overlays with model hierarchy and scoped toggles |
| 372 | PAN-774 | M | medium | ok |  | Task (medium): Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop… |
| 373 | PAN-775 | XL | medium | ok |  | Task (medium): Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 374 | PAN-777 | M | medium | ok |  | Task (medium): Inter-agent communication skill: send messages to conversation-mode agents |
| 375 | PAN-778 | M | medium | ok |  | Task (medium): Write conflict race: review-agent fails when test-agent write scope not yet released |
| 376 | PAN-780 | M | medium | ok |  | Task (medium): Agent stuck in feedback loop when old feedback files exist but review has passed |
| 377 | PAN-786 | M | medium | ok |  | Task (medium): Post planning Q\&A answers as issue comment |
| 378 | PAN-790 | M | medium | ok |  | Task (medium): Eliminate remaining TanStack Query polling — complete push-first migration |
| 379 | PAN-791 | M | medium | ok |  | Task (medium): Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 380 | PAN-793 | M | medium | ok |  | Task (medium): Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 381 | PAN-797 | S | medium | ok |  | Task (medium): Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 382 | PAN-810 | M | medium | ok |  | Task (medium): Inspector: diagnostic UI when pipeline phase is unknown |
| 383 | PAN-818 | M | medium | ok |  | Enhance (medium): Make summary optional when forking conversations |
| 384 | PAN-833 | M | medium | ok |  | Task (medium): Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 385 | PAN-853 | M | medium | ok |  | Task (medium): Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 386 | PAN-898 | L | medium | ok |  | Task (medium): Dashboard polling and WebSocket efficiency: remaining audit findings |
| 387 | PAN-901 | M | medium | ok |  | Enhance (medium): Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 388 | PAN-902 | XS | medium | ok |  | Enhance (medium): Settings: add 'Run pan sync' button to configuration menu |
| 389 | PAN-903 | M | medium | ok |  | Enhance (medium): Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 390 | PAN-904 | M | medium | ok |  | Task (medium): Make AI title generation model configurable |
| 391 | PAN-908 | M | medium | ok |  | Task (medium): Make work-agent spawn limits configurable and overridable |
| 392 | PAN-938 | M | medium | ok |  | Enhance (medium): Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 393 | PAN-943 | M | medium | ok |  | Task (medium): Add memory file review and management command |
| 394 | PAN-944 | M | medium | ok |  | Task (medium): Make vBRIEF the durable task graph source of truth |
| 395 | PAN-948 | M | medium | ok |  | Task (medium): Implement pan scope lifecycle commands |
| 396 | PAN-949 | M | medium | ok |  | Enhance (medium): add conversation for project from sidebar |
| 397 | PAN-958 | M | medium | ok |  | Enhance (medium): Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 398 | PAN-961 | M | medium | ok |  | Task (medium): Update documentation for vBRIEF v0.6 lifecycle model |
| 399 | PAN-962 | XS | medium | ok |  | Task (medium): Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 400 | PAN-1489 | M | medium | needs-refinement |  | Enhance (medium): task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 401 | PAN-984 | M | medium | ok |  | Task (medium): Evaluate context-mode MCP server as session continuity + search layer |
| 402 | PAN-1037 | M | medium | ok |  | Enhance (medium): Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 403 | PAN-1049 | S | medium | ok |  | Task (medium): Spike: evaluate Tauri v2 desktop shell |
| 404 | PAN-1051 | M | medium | ok |  | Task (medium): Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 405 | PAN-1116 | M | medium | ok |  | Task (medium): Memory: cross-project search mode |
| 406 | PAN-1117 | M | medium | ok |  | Task (medium): Memory: pinned docs (long-form doc chunking + retrieval) |
| 407 | PAN-1121 | M | medium | ok |  | Task (medium): Context bloat: agents receive oversized prompts that exceed tool limits and force immediate com… |
| 408 | PAN-1123 | M | medium | ok |  | Task (medium): Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 409 | PAN-1126 | M | medium | ok |  | Task (medium): Integrate TLDR summaries into review context manifest |
| 410 | PAN-1133 | M | medium | ok |  | Task (medium): TLDR: deacon supervision + pan doctor check + GC |
| 411 | PAN-1135 | M | medium | ok |  | Task (medium): Document the hook system in docs/HOOKS.md |
| 412 | PAN-1147 | M | medium | ok |  | Task (medium): Work-agent done flow stalls at 'push and re-request review' after addressing review feedback |
| 413 | PAN-1151 | M | medium | ok |  | Enhance (medium): Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gati… |
| 414 | PAN-1153 | M | medium | ok |  | Task (medium): Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 415 | PAN-1154 | M | medium | ok |  | Task (medium): pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 416 | PAN-1165 | M | medium | ok |  | Enhance (medium): Lightweight review path for small/trivial PRs |
| 417 | PAN-1166 | M | medium | ok |  | Task (medium): Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 418 | PAN-1202 | M | medium | ok |  | Enhance (medium): Swarm: prune merged/completed slot state directories after wave converges |
| 419 | PAN-1208 | M | medium | ok |  | Task (medium): Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 420 | PAN-1222 | M | medium | ok |  | Task (medium): Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 421 | PAN-1238 | XS | medium | ok |  | Task (medium): Board view follow-up — + New issue column footer button (deferred from PAN-1229) |
| 422 | PAN-1242 | XS | medium | ok |  | Task (medium): Board view follow-up — + New issue column footer button (deferred from PAN-1229) |
| 423 | PAN-1244 | M | medium | ok |  | Task (medium): pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 424 | PAN-1245 | M | medium | ok |  | Task (medium): Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 425 | PAN-1325 | M | medium | ok |  | Task (medium): Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 426 | PAN-1356 | M | medium | ok |  | Task (medium): Extend the memory Observation pipeline to ad-hoc conversations |
| 427 | PAN-1432 | M | medium | ok |  | Enhance (medium): Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 428 | PAN-1437 | M | medium | ok |  | Enhance (medium): pan flywheel report semantics: split read-only snapshot from run finalization |
| 429 | PAN-1443 | XS | medium | ok |  | Enhance (medium): Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 430 | PAN-1791 | M | medium | needs-refinement |  | Enhance (medium): Tiered execution: difficulty-routed bead dispatch + event-driven supervisor review (standing ti… |
| 431 | PAN-634 | M | medium | ok |  | Task (medium): Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 432 | PAN-1453 | L | medium | ok |  | Enhance (medium): Audit: 3 cheap verifications that should ride along with merges (PAN-1170, PAN-1316, PAN-457 CL… |
| 433 | PAN-1473 | L | medium | ok |  | Enhance (medium): Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative +… |
| 434 | PAN-1479 | M | medium | ok |  | Task (medium): RTK: Add telemetry to measure token savings from bash output compression |
| 435 | PAN-1480 | M | medium | ok |  | Task (medium): TLDR: 93% bypass rate — daemon/hook integration broken |
| 436 | PAN-1481 | M | medium | ok |  | Task (medium): Add cost-event telemetry for Caveman token savings |
| 437 | PAN-1482 | M | medium | ok |  | Task (medium): Token spend report should aggregate data from repo, not just local machine |
| 438 | PAN-1483 | M | medium | ok |  | Task (medium): Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 439 | PAN-1485 | M | medium | ok |  | Enhance (medium): Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurab… |
| 440 | PAN-1490 | M | medium | ok |  | Enhance (medium): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 441 | PAN-1493 | M | medium | ok |  | Task (medium): write hello.txt — probe for PAN-1200 Universal Context System verification |
| 442 | PAN-1524 | M | medium | ok |  | Enhance (medium): Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 443 | PAN-1542 | XS | medium | ok |  | Enhance (medium): Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 444 | PAN-1545 | XS | medium | ok |  | Enhance (medium): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 445 | PAN-1548 | M | medium | ok |  | Task (medium): npx @panctl/cli shows stale placeholder message referencing v0.8.0 |
| 446 | PAN-1550 | M | medium | ok |  | Task (medium): FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 447 | PAN-1552 | M | medium | ok |  | Task (medium): Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 448 | PAN-1553 | S | medium | ok |  | Task (medium): Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 449 | PAN-1581 | M | medium | ok |  | Task (medium): Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-h… |
| 450 | PAN-1592 | M | medium | ok |  | Task (medium): Composer: make pasted images reload-durable (persist across page reload, not just conversation … |
| 451 | PAN-1619 | M | medium | ok |  | Task (medium): Bridge host Codex auth into workspace containers + honest gpt-5.5 lock reason |
| 452 | PAN-1620 | XS | medium | ok |  | Task (medium): Awaiting-Merge button is clickable on a conflicting/CI-failing PR (stale blockerReasons) |
| 453 | PAN-1621 | M | medium | ok |  | Task (medium): pan close human-only gate over-blocks operator conv-* sessions |
| 454 | PAN-1622 | M | medium | ok |  | Task (medium): pan dev restart leaves orphan dashboard servers (stale serving + multi-Deacon risk) |
| 455 | PAN-1623 | M | medium | ok |  | Enhance (medium): Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 456 | PAN-1627 | M | medium | ok |  | Task (medium): Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents… |
| 457 | PAN-1640 | M | medium | ok |  | Task (medium): Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 458 | PAN-1641 | M | medium | ok |  | Task (medium): Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness |
| 459 | PAN-1643 | M | medium | ok |  | Task (medium): Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 460 | PAN-1644 | M | medium | ok |  | Task (medium): Hook-driven progressive conversation titling |
| 461 | PAN-1646 | M | medium | ok |  | Task (medium): Rabbit-hole drift detection and lift-to-new-conversation |
| 462 | PAN-1653 | M | medium | ok |  | Enhance (medium): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 463 | PAN-1654 | M | medium | ok |  | Enhance (medium): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 464 | PAN-1655 | M | medium | ok |  | Enhance (medium): Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync acc… |
| 465 | PAN-1656 | M | medium | ok |  | Enhance (medium): Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 466 | PAN-1657 | M | medium | ok |  | Enhance (medium): one-off double-check reviews with a user-specified agent/harness + settings-managed default rev… |
| 467 | PAN-1667 | M | medium | ok |  | Task (medium): unify Agents + Resources into one issue-centric holistic view |
| 468 | PAN-1668 | M | medium | ok |  | Task (medium): right-click 'restart with <model>' carries model only, never harness — can't move a review off … |
| 469 | PAN-1669 | M | medium | ok |  | Task (medium): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 470 | PAN-1670 | M | medium | ok |  | Task (medium): pan dev hot-reload wedges tabs on 'Reconnecting to the dashboard…' — PAN-1580 boot watchdog nev… |
| 471 | PAN-1671 | M | medium | ok |  | Enhance (medium): surface pending ExitPlanMode plan as a popup modal (reuse PlanCard + /plan-action) |
| 472 | PAN-1672 | M | medium | ok |  | Enhance (medium): GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window … |
| 473 | PAN-1676 | M | medium | ok |  | Enhance (medium): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 474 | PAN-1685 | L | medium | ok |  | Enhance (medium): Show model capability icons in conversation dialogs + complete per-model vision (supportsImages… |
| 475 | PAN-1691 | M | medium | ok |  | Task (medium): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands rea… |
| 476 | PAN-1708 | M | medium | ok |  | Task (medium): pan start CLI never flips spec plan.status proposed→approved — all 8 in-flight specs stuck at p… |
| 477 | PAN-1726 | M | medium | ok |  | Task (medium): postMergeLifecycle did not pause the merged issue's work agent — idle agent holds a work slot a… |
| 478 | PAN-1728 | M | medium | ok |  | Task (medium): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on… |
| 479 | PAN-1729 | XS | medium | ok |  | Task (medium): beads-scoping work.md "-l {{ISSUE_ID_LOWER}}" label-filter assertion fails on main |
| 480 | PAN-1730 | XS | medium | ok |  | Task (medium): idle awaiting-test work sessions count against the PAN-1665 ceiling — pipeline livelocks when w… |
| 481 | PAN-1734 | M | medium | ok |  | Task (medium): request-review-nudge remote workspace HEAD test fails on main |
| 482 | PAN-1735 | M | medium | ok |  | Task (medium): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 483 | PAN-1739 | M | medium | ok |  | Task (medium): Command Deck issue TREE still hides strike agents — frontend FeatureItem session-type allowlist… |
| 484 | PAN-1740 | M | medium | ok |  | Task (medium): Deacon mislabels SIGTERM workspace container restarts as crashes |
| 485 | PAN-1748 | M | medium | ok |  | Task (medium): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 486 | PAN-1750 | M | medium | ok |  | Task (medium): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-… |
| 487 | PAN-1751 | M | medium | ok |  | Task (medium): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flyw… |
| 488 | PAN-1754 | M | medium | ok |  | Task (medium): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings pa… |
| 489 | PAN-1755 | M | medium | ok |  | Task (medium): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agent… |
| 490 | PAN-1758 | M | medium | ok |  | Task (medium): ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; ready… |
| 491 | PAN-1761 | M | medium | ok |  | Task (medium): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (s… |
| 492 | PAN-1762 | M | medium | ok |  | Task (medium): Swarm v2: tracer-bullet planning contract (Path A) + foreman-driven intra-issue swarms (Path B) |
| 493 | PAN-1773 | XS | medium | ok |  | Task (medium): Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 494 | PAN-1774 | M | medium | ok |  | Task (medium): workspace server container crashloops when dist/dashboard/server.js is missing |
| 495 | PAN-43 | M | medium | stale |  | Task (medium): Add Slack and email notifications for agent events |
| 496 | PAN-1837 | M | medium | ok |  | Enhance (medium): Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 497 | PAN-1838 | S | medium | ok |  | Enhance (medium): [research] Grok Build (xAI) coding harness — research and specify support |
| 498 | PAN-1839 | M | medium | ok |  | Enhance (medium): Settings → Providers: show each provider's default harness in the collapsed row (no expand need… |
| 499 | PAN-1844 | M | medium | ok |  | Enhance (medium): Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity not… |
| 500 | PAN-1853 | M | medium | ok |  | Enhance (medium): Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tier… |
| 501 | PAN-1854 | M | medium | ok |  | Enhance (medium): Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 502 | PAN-1875 | M | medium | ok |  | Task (medium): add `pan flywheel stop` — graceful shutdown that writes the report |
| 503 | PAN-1878 | M | medium | ok |  | Task (medium): process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning p… |
| 504 | PAN-1894 | M | medium | ok |  | Task (medium): Show UAT stack startup state in issue tree and issue slide-out |
| 505 | PAN-1895 | M | medium | ok |  | Task (medium): Spawn work agents from issue workspace slide-out |
| 506 | PAN-1906 | M | medium | ok |  | Task (medium): Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 507 | PAN-1910 | M | medium | ok |  | Task (medium): fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived p… |
| 508 | PAN-1914 | XS | medium | ok |  | Task (medium): Follow-up: move /api/health/agents off agent-directory scans |
| 509 | PAN-1916 | M | medium | ok |  | Enhance (medium): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 510 | PAN-1917 | XL | medium | ok |  | Task (medium): /sessions page redesign: unify with conversation view |
| 511 | PAN-1926 | XS | medium | ok |  | Task (medium): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 512 | PAN-1932 | M | medium | ok |  | Task (medium): Schema migration downgrades user_version when DB is newer than code (=== SCHEMA_VERSION should … |
| 513 | PAN-1937 | M | medium | ok |  | Task (medium): data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) … |
| 514 | PAN-1949 | M | medium | ok |  | Task (medium): Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all bead v… |
| 515 | PAN-1953 | M | medium | ok |  | Task (medium): Design: beads rail mockup |
| 516 | PAN-1954 | M | medium | ok |  | Task (medium): Beads rail: move beads to right sidebar, highlight active work |
| 517 | PAN-1955 | M | medium | ok |  | Enhance (medium): Issue cockpit: move beads from a tab into a persistent right rail with a 'working now' highlight |
| 518 | PAN-1958 | M | medium | ok |  | Task (medium): Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + in… |
| 519 | PAN-1963 | M | medium | ok |  | Task (medium): Default to no-resume on dashboard boot; add 'Resume all' to the stopped-agents banner |
| 520 | PAN-1965 | M | medium | ok |  | Enhance (medium): Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 521 | PAN-1966 | M | medium | ok |  | Enhance (medium): Single authoritative pipeline-membership resolver — one function for "what's in the pipeline" (… |
| 522 | PAN-1967 | M | medium | ok |  | Enhance (medium): Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 523 | PAN-1968 | M | medium | ok |  | Enhance (medium): Finish local-domain rename: pan.localhost → overdeck.localhost |
| 524 | PAN-1980 | M | medium | ok |  | Task (medium): Stop session rotation on resume (behind a constant); one pipeline-membership view from all lens… |
| 525 | PAN-1985 | M | medium | ok |  | Enhance (medium): Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with… |
| 526 | PAN-1987 | M | medium | ok |  | Task (medium): Allow renaming a registered project (display name is locked at registration) |
| 527 | PAN-1989 | M | medium | ok |  | Task (medium): Replace Pi harness with ohmypi and evaluate advanced features |
| 528 | PAN-1990 | M | medium | ok |  | Task (medium): First-class workspaces and projects with per-workspace memory |
| 529 | PAN-1991 | XL | medium | ok |  | Enhance (medium): Issue cockpit redesign — incremental rollout (tracking) |
| 530 | PAN-1995 | M | medium | ok |  | Enhance (medium): infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 531 | PAN-1999 | M | medium | ok |  | Task (medium): Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 532 | PAN-241 | XL | medium | ok |  | Task (medium): Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 533 | PAN-633 | M | medium | ok |  | Task (medium): Update Cloister PRD and docs index — stale relative to implementation |
| 534 | PAN-674 | M | medium | ok |  | Task (medium): add glossary of Panopticon domain terms |
| 535 | PAN-1223 | M | medium | needs-refinement |  | Enhance (medium): Auto-update for users in the field (npm + desktop binaries) |
| 536 | PAN-1555 | M | medium | ok |  | Task (medium): remove/update stale swarm-runtime references after PAN-1517 |
| 537 | PAN-531 | M | medium | ok |  | Enhance (medium): PAN: Windows Electron support (WSL2 required) |
| 538 | PAN-623 | M | medium | ok |  | Task (medium): Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 539 | PAN-649 | M | medium | ok |  | Enhance (medium): Render Excalidraw drawings inline in Claude Code conversations |
| 540 | PAN-1469 | M | medium | ok |  | Enhance (medium): End-to-end review and consolidation of all project documentation |
| 541 | PAN-1474 | M | medium | ok |  | Task (medium): Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 542 | PAN-1494 | M | medium | ok |  | Enhance (medium): register docs/FLYWHEEL-VISION on panopticon-cli.com (Mintlify) — needed for public sharing |
| 543 | PAN-1683 | M | medium | ok |  | Task (medium): canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/C… |
| 544 | PAN-1684 | M | medium | ok |  | Enhance (medium): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |

## Rationale detail

### PAN-1908 (rank 1)

Foundational architecture change unblocking the single-source-of-truth tenet; in-pipeline and verifying-on-main. Every downstream state/read-door issue depends on this landing.

### PAN-1866 (rank 2)

The sequencer itself; in-pipeline verifying-on-main. This very run depends on it being the source of truth for backlog ranking.

### PAN-1919 (rank 3)

Retires the dual 'continues' system and folds state.json harness/model into one durable record; has PRD and in-pipeline. Directly serves the one-write-door tenet.

### PAN-1832 (rank 4)

In-pipeline verifying-on-main. Lets roles spread load across providers, reducing single-provider rate-limit stalls (a recurring review-blocker).

### PAN-1982 (rank 5)

In-pipeline. The convoy-revival cluster (PAN-1066,1213,1219,1207,1130,1131,838,1557,1861,1862,1874) all wait on this re-enabling the multi-reviewer path.

### PAN-1992 (rank 6)

In-pipeline verifying-on-main. Completes the DB rename so skills stop referencing the dead panopticon.db handle.

### PAN-2000 (rank 7)

Brand-new red-main filed from the sequencer's own landing; must go green before any sequencer-driven work is trustworthy. Sequencer-tested + worker-pool health.

### PAN-1903 (rank 8)

Flaky red-main on a DB-init race; reddens every verify/ship/strike gate. PAN-1629 follow-up; isolate the init ordering.

### PAN-1880 (rank 9)

Cross-file mock pollution empties the merge gate under maxForks:1. Hard CI blocker; needs mock isolation.

### PAN-1859 (rank 10)

Red-main; Pi resume path regressed. Blocks trustworthy resume.

### PAN-1857 (rank 11)

Stale path assertion after generic-command rename; trivial fix un-reddening main.

### PAN-1698 (rank 12)

Stale test expectations block every verify/ship/strike gate; update fixtures to current schema/model count.

### PAN-1783 (rank 13)

Red-main Playwright fixture drift; update fixture to current workspace title.

### PAN-1824 (rank 14)

Real-timer integration tests (rollout-JSONL, heartbeat, conversation-routes) flake on loaded runners; convert to fake-timer pattern per repo rule.

### PAN-1710 (rank 15)

Three consecutive 20-min timeout kills; server boots but health poll never passes on feature branches. Starves CI capacity.

### PAN-1918 (rank 16)

IssueMissionControl.test.tsx open-handle hang stalls the only gate that runs it; tests are effectively uncovered. Fix the open handle.

### PAN-1720 (rank 17)

Pass in isolation, fail parallel = test pollution reddening main; isolate shared state.

### PAN-1929 (rank 18)

One-way-door risk: auto-commit rebase mutating the shared main worktree can destroy uncommitted agent work across sessions. Stop mutating the shared tree.

### PAN-1781 (rank 19)

Compaction becomes a silent no-op and agents end /clear'd mid-work, losing context on half of overflows. High silent-damage bug.

### PAN-1508 (rank 20)

Disk-exhaustion substrate bug; safe post-merge workspaces not reaped. 220GB→free 100GB+. Blocks new workspaces via ENOSPC.

### PAN-1674 (rank 21)

Disk-full ENOSPC from per-workspace .venv duplication. Share/symlink the venv instead of copying.

### PAN-1934 (rank 22)

No operator escalation path on an unfixable check = invisible token burn. Add escalation + cap.

### PAN-1817 (rank 23)

84+ poll errors; regresses the pre-safeguard tracker-burn problem. Add backoff/cache or PAN-1823 429 handling.

### PAN-1570 (rank 24)

Silent total cost-tracking loss since the Effect migration; runaway spend invisible. Root-cause the recorder.

### PAN-1935 (rank 25)

Non-Claude-Code harnesses skip cost_events, so no cost-based safety net works. Wire cost telemetry for pi/codex/kimi.

### PAN-1868 (rank 26)

No spend ceiling exists today; a stuck agent can burn unbounded. Always-on progress-aware breaker.

### PAN-1766 (rank 27)

Un-overridable by PreToolUse hook; in-scope self-modify work wedges silently. Pair with PAN-1060.

### PAN-1060 (rank 28)

Agents editing .claude/** get trapped in a permission-dialog dismissal loop. Has PRD; per-issue allow-list + prompt-block detection.

### PAN-1572 (rank 29)

Security: resolved config disagrees with settings, agents run DSP despite 'Auto'. Pair with PAN-1101 hardening.

### PAN-1101 (rank 30)

Belt-and-suspenders after PAN-1084: grep guard, single DSP string location, launcher runtime tripwire, snapshot tests.

### PAN-1435 (rank 31)

Security: plaintext API keys at rest. Startup perm check + OS keychain.

### PAN-1915 (rank 32)

Security hardening; overlaps PAN-1435 with a fuller plan. Deprecate plaintext keys.

### PAN-1064 (rank 33)

Security: config.model concatenated unquoted into launcher.sh; metachar model id = shell injection. Validate + shellQuote.

### PAN-1065 (rank 34)

Security: issueIds interpolated into execAsync git/gh calls; one canonical assertSafeIssueId at boundaries.

### PAN-1068 (rank 35)

S1/S2 (issueId+model injection), C1-C4 ship-role correctness, R1/R2 model catalog. Batch of real gaps deferred from the role-primitive merge.

### PAN-1063 (rank 36)

Security: unauthenticated local GPU TTS surface any site can drive. Bearer token + origin allowlist + body cap.

### PAN-1864 (rank 37)

Critical review-pipeline wedge: convoy parent stalls on last REVIEWER_READY, readyForMerge never flips. Deterministic fallback synthesis.

### PAN-1861 (rank 38)

Critical: readyForMerge never flips, stranding merged-ready PRs. Root-cause the signal handoff.

### PAN-1830 (rank 39)

Review stranded despite report written; rate-limit modal eats the signal. PAN-1696-related.

### PAN-1865 (rank 40)

Lower priority / no strike: the false 200k context window deadlocks long kimi sessions. Root-cause for safety; do NOT force claude-code routing meanwhile.

### PAN-1454 (rank 41)

Architecture META: the substrate root cause behind closed-but-not-shipped issues. Drives PAN-1498/1499/1497 and the v1.0 readiness push.

### PAN-804 (rank 42)

Critical architecture epic: dead-code/legacy removal before 1.0. Unblocks PAN-1983/1984 db-retirement and stable cost/dashboard correctness.

### PAN-807 (rank 43)

Critical architecture epic: spawn-time workspace consistency. Underpins reliable pan start / resume.

### PAN-806 (rank 44)

Critical architecture epic: take git out of the work agent's hands to stop branch-drift/push hazards. Aligns with the worktree-discipline rule.

### PAN-1666 (rank 45)

Architecture epic for running many concurrent work agents safely; parents PAN-908, PAN-1730, PAN-1665 ceiling, on-demand specialists.

### PAN-1491 (rank 46)

v1.0-required: makes the flywheel weight fixes by which readiness criterion they affect. Strategic prioritization primitive.

### PAN-1988 (rank 47)

Architecture core of the single-source-of-truth tenet: one write door. PAN-1936 read-door depends on it.

### PAN-1936 (rank 48)

Collapses 280+ scattered read endpoints into one read door per domain. Depends on the write door (PAN-1988).

### PAN-1983 (rank 49)

Architecture: kills the legacy panopticon.db layer and seed-from-legacy. Unblocks PAN-1992/1984 skills migration.

### PAN-1984 (rank 50)

Follow-on cleanup to PAN-1983; remove the dead modules and their test references.

### PAN-1124 (rank 51)

Architecture: stops feature-branch .pan/specs mutations (PAN-1728 violation) and gives specs a stable home. PAN-1451/1728 depend on it.

### PAN-826 (rank 52)

Foundational architecture: underpins conversation view, terminal attach, harness parsers. Many visibility bugs trace here.

### PAN-450 (rank 53)

Architecture: finish the Effect migration for type-safe RPC/streams. Long-running; pair with PAN-438/1313.

### PAN-1313 (rank 54)

Removes the dual Promise/sync surfaces that cause the race-class bugs (DB-init, auto-resume). High substrate value.

### PAN-262 (rank 55)

Architecture (planned): post-merge lifecycle is a recurring correctness swamp (PAN-1027,1726,1873). Idempotent ops.

### PAN-1650 (rank 56)

Architecture: readyForMerge is overloaded; split into a derived gate flag and an explicit ship-complete. Depends on PAN-1048 role primitive.

### PAN-1520 (rank 57)

Architecture META absorbing PAN-1102/1103/339: one awaiting-input state across all blocking surfaces.

### PAN-1994 (rank 58)

Pipeline correctness: PAN-1982 got PAN-1866's verifying-on-main state. State bleed across freshly-planned issues.

### PAN-1993 (rank 59)

Plan --auto on a brand-new issue 404s; GitHub propagation race. Blocks fast issue kickoff.

### PAN-1986 (rank 60)

Harness/model switch leaves stale session pointers; restart is unreliable. Pair with PAN-1840 pan switch.

### PAN-1840 (rank 61)

Operator ergonomics for harness/model switch; consolidates PAN-1986/restart-with-model.

### PAN-1897 (rank 62)

Blocks PAN-1711/PAN-1827 — no spawn, no error. Workspace-prep deadlock on re-entry.

### PAN-1711 (rank 63)

Event-loop stall under load; watchdog kicks 3x in 45min. Whole UI freezes. High user impact.

### PAN-1901 (rank 64)

PAN-1841 fix inert; .gitattributes declares merge=beads but no driver wired. Bead merges conflict-storm.

### PAN-1770 (rank 65)

'rebase failed for main: GitError' every busy cycle; auto-commit races agent writes. Pipeline friction.

### PAN-1213 (rank 66)

Convoy-revival: only !-block in-PR-scope items, stopping over-broad review blocks. Substrate improvement.

### PAN-1219 (rank 67)

Convoy-revival: stop re-deriving review state from prompts; store cycle SHA + prior findings.

### PAN-1066 (rank 68)

Convoy-revival: finish the role-primitive cleanup; delete legacy review-agent/specialists modules. Reduces drift surface.

### PAN-1207 (rank 69)

Convoy-revival bug: synthesis never fires because state stuck at running. Critical for convoy reliability.

### PAN-1130 (rank 70)

Convoy-revival: spurious restarts from misclassified clean exits.

### PAN-1131 (rank 71)

Convoy-revival: idempotency guard can't tell 'reviewing' from 'finished-idle'.

### PAN-838 (rank 72)

Convoy-revival: synthesis output unreliable. Schema enforce.

### PAN-1862 (rank 73)

Convoy-revival enhancement: cuts review cost via cache sharing. Builds on PAN-1982.

### PAN-1874 (rank 74)

Extends PAN-1862 project-scope config to per-issue. Flexibility for hot spots.

### PAN-1557 (rank 75)

Convoy-revival architecture: hook-owned signalling so completion is reliable.

### PAN-1827 (rank 76)

Pi sessions render blank; flywheel orchestrator affected. Add pi to the transcript resolver.

### PAN-1828 (rank 77)

Fork silently coerces to claude-code regardless of source harness. Harness fidelity bug.

### PAN-1849 (rank 78)

Makes red-main the flywheel's top priority (+ UAT/smoke signal). Operationalizes the red-main tier above.

### PAN-1888 (rank 79)

Finish the PAN-1883 SQLite-truth migration in the stop hook; stops stale-file reads.

### PAN-1882 (rank 80)

Strike leaks worktrees/branches forever; disk + clutter. Add strike cleanup.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-06-21T03:34:13Z",
  "model": "claude-sonnet-4-5",
  "pass": "creation",
  "openCount": 544,
  "nodes": [
    {
      "issue": "PAN-1908",
      "rank": 1,
      "size": "XL",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Event-driven agent state: SQLite runtime registry + git-permanent records (big-bang).",
      "rationale": "Foundational architecture change unblocking the single-source-of-truth tenet; in-pipeline and verifying-on-main. Every downstream state/read-door issue depends on this landing.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1866",
      "rank": 2,
      "size": "XL",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer — AI-ranked whole-backlog DAG with reproducible markdown truth.",
      "rationale": "The sequencer itself; in-pipeline verifying-on-main. This very run depends on it being the source of truth for backlog ranking.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1919",
      "rank": 3,
      "size": "L",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [
        "PAN-1908"
      ],
      "why": "Consolidate per-issue resume/progress state into ONE git-tracked record.",
      "rationale": "Retires the dual 'continues' system and folds state.json harness/model into one durable record; has PRD and in-pipeline. Directly serves the one-write-door tenet.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1832",
      "rank": 4,
      "size": "M",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Role Models: multiple models per role with weighted load-spreading.",
      "rationale": "In-pipeline verifying-on-main. Lets roles spread load across providers, reducing single-provider rate-limit stalls (a recurring review-blocker).",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1982",
      "rank": 5,
      "size": "L",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Revive convoy review as configurable opt-in (quick stays default).",
      "rationale": "In-pipeline. The convoy-revival cluster (PAN-1066,1213,1219,1207,1130,1131,838,1557,1861,1862,1874) all wait on this re-enabling the multi-reviewer path.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1992",
      "rank": 6,
      "size": "M",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [
        "PAN-1983"
      ],
      "why": "Skills: migrate all panopticon.db references to overdeck.db + re-verify.",
      "rationale": "In-pipeline verifying-on-main. Completes the DB rename so skills stop referencing the dead panopticon.db handle.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-2000",
      "rank": 7,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [
        "PAN-1866"
      ],
      "why": "RED MAIN — PAN-1866 fallout: spawn-sequencer stale assertion + health.json flakiness.",
      "rationale": "Brand-new red-main filed from the sequencer's own landing; must go green before any sequencer-driven work is trustworthy. Sequencer-tested + worker-pool health.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1903",
      "rank": 8,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN — create-beads.test.ts flaky 'table not found: issues' bd-DB-init race.",
      "rationale": "Flaky red-main on a DB-init race; reddens every verify/ship/strike gate. PAN-1629 follow-up; isolate the init ordering.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1880",
      "rank": 9,
      "size": "L",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN — start-sync-main-conflict.test.ts process.exit(1) under CI single-fork.",
      "rationale": "Cross-file mock pollution empties the merge gate under maxForks:1. Hard CI blocker; needs mock isolation.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1859",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN — agent-spawning.test.ts 'resumeAgent Pi FIFO' fails (writePiCommand).",
      "rationale": "Red-main; Pi resume path regressed. Blocks trustworthy resume.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1857",
      "rank": 11,
      "size": "S",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN — verification-gate.test.ts asserts stale src/dashboard/frontend path.",
      "rationale": "Stale path assertion after generic-command rename; trivial fix un-reddening main.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1698",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN — model-count + schema-version + substrate-smoke expectations stale.",
      "rationale": "Stale test expectations block every verify/ship/strike gate; update fixtures to current schema/model count.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1783",
      "rank": 13,
      "size": "S",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED MAIN — Command Deck resource-strip Playwright fixture expects old title.",
      "rationale": "Red-main Playwright fixture drift; update fixture to current workspace title.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1824",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flaky main CI: real-timer integration tests time out on loaded runners.",
      "rationale": "Real-timer integration tests (rollout-JSONL, heartbeat, conversation-routes) flake on loaded runners; convert to fake-timer pattern per repo rule.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 15,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI hang — 'Clean install + server smoke test' never passes health poll.",
      "rationale": "Three consecutive 20-min timeout kills; server boots but health poll never passes on feature branches. Starves CI capacity.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 16,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI — full frontend vitest suite runs in no path; npm test capped to 3 files.",
      "rationale": "IssueMissionControl.test.tsx open-handle hang stalls the only gate that runs it; tests are effectively uncovered. Fix the open handle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 17,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "RED — cloister auto-resume tests fail under full parallel run (test pollution).",
      "rationale": "Pass in isolation, fail parallel = test pollution reddening main; isolate shared state.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1929",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "HAZARD: background git rebase rewrites history in the SHARED primary worktree.",
      "rationale": "One-way-door risk: auto-commit rebase mutating the shared main worktree can destroy uncommitted agent work across sessions. Stop mutating the shared tree.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1781",
      "rank": 19,
      "size": "L",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context-overflow recovery: claude --resume bypasses native compact ~50% of time.",
      "rationale": "Compaction becomes a silent no-op and agents end /clear'd mid-work, losing context on half of overflows. High silent-damage bug.",
      "gate": "ready",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1508",
      "rank": 20,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Immediate cleanup of safe post-merge feature-*/ workspaces (220GB).",
      "rationale": "Disk-exhaustion substrate bug; safe post-merge workspaces not reaped. 220GB→free 100GB+. Blocks new workspaces via ENOSPC.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 21,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) duplicated into every workspace — 236G across 33 worktrees.",
      "rationale": "Disk-full ENOSPC from per-workspace .venv duplication. Share/symlink the venv instead of copying.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1934",
      "rank": 22,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "HAZARD: verification gate drives up to 10 retries on an unfixable check.",
      "rationale": "No operator escalation path on an unfixable check = invisible token burn. Add escalation + cap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1817",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 83,
      "condition": "ok",
      "dependsOn": [
        "PAN-1823"
      ],
      "why": "Linear API quota exhausted by IssueDataService polling (2500/hr hit).",
      "rationale": "84+ poll errors; regresses the pre-safeguard tracker-burn problem. Add backoff/cache or PAN-1823 429 handling.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1570",
      "rank": 24,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost recorder dropped ALL cost events since 2026-05-21 (Effect-migration).",
      "rationale": "Silent total cost-tracking loss since the Effect migration; runaway spend invisible. Root-cause the recorder.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1935",
      "rank": 25,
      "size": "M",
      "importance": "critical",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "pi/kimi work-agent cost not recorded → runaway spend invisible.",
      "rationale": "Non-Claude-Code harnesses skip cost_events, so no cost-based safety net works. Wire cost telemetry for pi/codex/kimi.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 26,
      "size": "M",
      "importance": "critical",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-1935",
        "PAN-1570"
      ],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on runaway-spend guard.",
      "rationale": "No spend ceiling exists today; a stuck agent can burn unbounded. Always-on progress-aware breaker.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1766",
      "rank": 27,
      "size": "M",
      "importance": "critical",
      "score": 79,
      "condition": "ok",
      "dependsOn": [
        "PAN-1060",
        "PAN-1627"
      ],
      "why": "Work agents hang on Claude Code .claude/** settings-edit protection.",
      "rationale": "Un-overridable by PreToolUse hook; in-scope self-modify work wedges silently. Pair with PAN-1060.",
      "gate": "ready",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1060",
      "rank": 28,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop, keep the guard.",
      "rationale": "Agents editing .claude/** get trapped in a permission-dialog dismissal loop. Has PRD; per-issue allow-list + prompt-block detection.",
      "gate": "ready",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1572",
      "rank": 29,
      "size": "M",
      "importance": "critical",
      "score": 77,
      "condition": "ok",
      "dependsOn": [
        "PAN-1101"
      ],
      "why": "Settings permission-mode can desync — agents silently use --dangerously-skip-permissions.",
      "rationale": "Security: resolved config disagrees with settings, agents run DSP despite 'Auto'. Pair with PAN-1101 hardening.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1101",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Permission safety hardening: CI guard, single emission chokepoint, tripwire.",
      "rationale": "Belt-and-suspenders after PAN-1084: grep guard, single DSP string location, launcher runtime tripwire, snapshot tests.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1435",
      "rank": 31,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext.",
      "rationale": "Security: plaintext API keys at rest. Startup perm check + OS keychain.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-1435"
      ],
      "why": "API key at-rest hardening: startup perm check + OS keychain + deprecate plaintext.",
      "rationale": "Security hardening; overlaps PAN-1435 with a fuller plan. Deprecate plaintext keys.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 33,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model/arg quoting).",
      "rationale": "Security: config.model concatenated unquoted into launcher.sh; metachar model id = shell injection. Validate + shellQuote.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 34,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth).",
      "rationale": "Security: issueIds interpolated into execAsync git/gh calls; one canonical assertSafeIssueId at boundaries.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [
        "PAN-1064",
        "PAN-1065"
      ],
      "why": "PAN-1048 deferred findings: security, correctness, model-validation gaps.",
      "rationale": "S1/S2 (issueId+model injection), C1-C4 ship-role correctness, R1/R2 model catalog. Batch of real gaps deferred from the role-primitive merge.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 36,
      "size": "S",
      "importance": "medium",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body cap, concurrency bound.",
      "rationale": "Security: unauthenticated local GPU TTS surface any site can drive. Bearer token + origin allowlist + body cap.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1864",
      "rank": 37,
      "size": "L",
      "importance": "critical",
      "score": 69,
      "condition": "ok",
      "dependsOn": [
        "PAN-1861",
        "PAN-1982"
      ],
      "why": "Review: deacon must deterministically synthesize from on-disk reports.",
      "rationale": "Critical review-pipeline wedge: convoy parent stalls on last REVIEWER_READY, readyForMerge never flips. Deterministic fallback synthesis.",
      "gate": "ready",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1861",
      "rank": 38,
      "size": "M",
      "importance": "critical",
      "score": 68,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Review: synthesis wedges after PAN-1818 — parent stalls on REVIEWER_READY.",
      "rationale": "Critical: readyForMerge never flips, stranding merged-ready PRs. Root-cause the signal handoff.",
      "gate": "ready",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1830",
      "rank": 39,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [
        "PAN-1861"
      ],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY.",
      "rationale": "Review stranded despite report written; rate-limit modal eats the signal. PAN-1696-related.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1865",
      "rank": 40,
      "size": "L",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make Kimi runnable on claude-code — root-cause CLIProxy 200k-window illusion.",
      "rationale": "Lower priority / no strike: the false 200k context window deadlocks long kimi sessions. Root-cause for safety; do NOT force claude-code routing meanwhile.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1454",
      "rank": 41,
      "size": "L",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "META: 9 systemic failure patterns from 80-issue audit — substrate work.",
      "rationale": "Architecture META: the substrate root cause behind closed-but-not-shipped issues. Drives PAN-1498/1499/1497 and the v1.0 readiness push.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-804",
      "rank": 42,
      "size": "XL",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic D: archaeological audit & pre-1.0 cleanup.",
      "rationale": "Critical architecture epic: dead-code/legacy removal before 1.0. Unblocks PAN-1983/1984 db-retirement and stable cost/dashboard correctness.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-807",
      "rank": 43,
      "size": "L",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic C: workspace state sanity on spawn.",
      "rationale": "Critical architecture epic: spawn-time workspace consistency. Underpins reliable pan start / resume.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-806",
      "rank": 44,
      "size": "L",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic B: work agent doesn't touch git.",
      "rationale": "Critical architecture epic: take git out of the work agent's hands to stop branch-drift/push hazards. Aligns with the worktree-discipline rule.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1666",
      "rank": 45,
      "size": "XL",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [
        "PAN-908"
      ],
      "why": "EPIC: Pipeline Throughput Hardening — many work agents + slot manager + fly.io.",
      "rationale": "Architecture epic for running many concurrent work agents safely; parents PAN-908, PAN-1730, PAN-1665 ceiling, on-demand specialists.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1491",
      "rank": 46,
      "size": "L",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: metric-aware prioritization weighting substrate bugs by v1.0 criterion.",
      "rationale": "v1.0-required: makes the flywheel weight fixes by which readiness criterion they affect. Strategic prioritization primitive.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1988",
      "rank": 47,
      "size": "L",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [
        "PAN-1908"
      ],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns DB.",
      "rationale": "Architecture core of the single-source-of-truth tenet: one write door. PAN-1936 read-door depends on it.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1936",
      "rank": 48,
      "size": "L",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [
        "PAN-1988",
        "PAN-1908"
      ],
      "why": "Single source-of-truth reads — one canonical resolver per domain.",
      "rationale": "Collapses 280+ scattered read endpoints into one read door per domain. Depends on the write door (PAN-1988).",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1983",
      "rank": 49,
      "size": "L",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + migration).",
      "rationale": "Architecture: kills the legacy panopticon.db layer and seed-from-legacy. Unblocks PAN-1992/1984 skills migration.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1984",
      "rank": 50,
      "size": "M",
      "importance": "medium",
      "score": 71,
      "condition": "ok",
      "dependsOn": [
        "PAN-1983"
      ],
      "why": "Migrate/delete 18 dead panopticon.db modules referenced by ~30 tests.",
      "rationale": "Follow-on cleanup to PAN-1983; remove the dead modules and their test references.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 51,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main.",
      "rationale": "Architecture: stops feature-branch .pan/specs mutations (PAN-1728 violation) and gives specs a stable home. PAN-1451/1728 depend on it.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-826",
      "rank": 52,
      "size": "XL",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation/terminal integration refactor: instant-start + parser correctness.",
      "rationale": "Foundational architecture: underpins conversation view, terminal attach, harness parsers. Many visibility bugs trace here.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-450",
      "rank": 53,
      "size": "XL",
      "importance": "medium",
      "score": 68,
      "condition": "ok",
      "dependsOn": [
        "PAN-1313"
      ],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging.",
      "rationale": "Architecture: finish the Effect migration for type-safe RPC/streams. Long-running; pair with PAN-438/1313.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 54,
      "size": "L",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync.",
      "rationale": "Removes the dual Promise/sync surfaces that cause the race-class bugs (DB-init, auto-resume). High substrate value.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-262",
      "rank": 55,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations.",
      "rationale": "Architecture (planned): post-merge lifecycle is a recurring correctness swamp (PAN-1027,1726,1873). Idempotent ops.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1650",
      "rank": 56,
      "size": "L",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived) + shipComplete.",
      "rationale": "Architecture: readyForMerge is overloaded; split into a derived gate flag and an explicit ship-complete. Depends on PAN-1048 role primitive.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1520",
      "rank": 57,
      "size": "L",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [
        "PAN-1102",
        "PAN-1103"
      ],
      "why": "META: unified 'agent awaiting input' — finish AskUserQuestion, generalize.",
      "rationale": "Architecture META absorbing PAN-1102/1103/339: one awaiting-input state across all blocking surfaces.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1994",
      "rank": 58,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [
        "PAN-1908"
      ],
      "why": "Fresh plan --auto issue inherits another issue's merged/verifying state.",
      "rationale": "Pipeline correctness: PAN-1982 got PAN-1866's verifying-on-main state. State bleed across freshly-planned issues.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1993",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning a freshly-created issue 404s (start-planning races GitHub).",
      "rationale": "Plan --auto on a brand-new issue 404s; GitHub propagation race. Blocks fast issue kickoff.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1986",
      "rank": 60,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent: wipe stale agent-dir session pointers + refresh conv row.",
      "rationale": "Harness/model switch leaves stale session pointers; restart is unreliable. Pair with PAN-1840 pan switch.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 61,
      "size": "M",
      "importance": "medium",
      "score": 70,
      "condition": "ok",
      "dependsOn": [
        "PAN-1986"
      ],
      "why": "Add 'pan switch <id>' — change running agent model/harness in one cmd.",
      "rationale": "Operator ergonomics for harness/model switch; consolidates PAN-1986/restart-with-model.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1897",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start workspace-prep hangs/times out (>120s) on re-entry.",
      "rationale": "Blocks PAN-1711/PAN-1827 — no spawn, no error. Workspace-prep deadlock on re-entry.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 63,
      "size": "L",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard event loop stalls 15-25s under load; watchdog force-restarts.",
      "rationale": "Event-loop stall under load; watchdog kicks 3x in 45min. Whole UI freezes. High user impact.",
      "gate": "ready",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1901",
      "rank": 64,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Beads: merge=beads driver never configured — .beads/.pan state conflict-storms.",
      "rationale": "PAN-1841 fix inert; .gitattributes declares merge=beads but no driver wired. Bead merges conflict-storm.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 65,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan-dir auto-commit rebase races live .pan/continues writes.",
      "rationale": "'rebase failed for main: GitError' every busy cycle; auto-commit races agent writes. Pipeline friction.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1213",
      "rank": 66,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Requirements reviewer: classify AC in_pr_scope vs whole_feature_scope.",
      "rationale": "Convoy-revival: only !-block in-PR-scope items, stopping over-broad review blocks. Substrate improvement.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 67,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, priors).",
      "rationale": "Convoy-revival: stop re-deriving review state from prompts; store cycle SHA + prior findings.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 68,
      "size": "L",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview + specialists.ts.",
      "rationale": "Convoy-revival: finish the role-primitive cleanup; delete legacy review-agent/specialists modules. Reduces drift surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1207",
      "rank": 69,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Review sub-specialists exit cleanly but state.json keeps 'running'.",
      "rationale": "Convoy-revival bug: synthesis never fires because state stuck at running. Critical for convoy reliability.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 70,
      "size": "S",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed'.",
      "rationale": "Convoy-revival: spurious restarts from misclassified clean exits.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1131",
      "rank": 71,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Stale idle synthesis session blocks review re-dispatch.",
      "rationale": "Convoy-revival: idempotency guard can't tell 'reviewing' from 'finished-idle'.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-838",
      "rank": 72,
      "size": "M",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "synthesis.json has hallucinated timestamp + sparse structure.",
      "rationale": "Convoy-revival: synthesis output unreliable. Schema enforce.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1862",
      "rank": 73,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Cache-sharing review convoy: warm-parent fork + resumable re-review.",
      "rationale": "Convoy-revival enhancement: cuts review cost via cache sharing. Builds on PAN-1982.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1874",
      "rank": 74,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [
        "PAN-1862"
      ],
      "why": "Per-issue override for review mode / re-review scope.",
      "rationale": "Extends PAN-1862 project-scope config to per-issue. Flexibility for hot spots.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1557",
      "rank": 75,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [
        "PAN-1982"
      ],
      "why": "Interactive, attachable review convoy with hook-owned completion.",
      "rationale": "Convoy-revival architecture: hook-owned signalling so completion is reliable.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1827",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view blank for pi-harness sessions — resolver claude/codex only.",
      "rationale": "Pi sessions render blank; flywheel orchestrator affected. Add pi to the transcript resolver.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 77,
      "size": "S",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source — silent claude coercion.",
      "rationale": "Fork silently coerces to claude-code regardless of source harness. Harness fidelity bug.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1849",
      "rank": 78,
      "size": "S",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: prioritize fixing a red main as its first duty.",
      "rationale": "Makes red-main the flywheel's top priority (+ UAT/smoke signal). Operationalizes the red-main tier above.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1888",
      "rank": 79,
      "size": "S",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "work-agent-stop-hook still reads legacy review-status.json.",
      "rationale": "Finish the PAN-1883 SQLite-truth migration in the stop hook; stops stale-file reads.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1882",
      "rank": 80,
      "size": "S",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike workspaces never cleaned up — worktrees + branches pile up (27/16GB).",
      "rationale": "Strike leaks worktrees/branches forever; disk + clutter. Add strike cleanup.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1879",
      "rank": 81,
      "size": "S",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart silently re-applies stale boot gates; can't re-enable deacon.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1873",
      "rank": 82,
      "size": "S",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "verifying_on_main tagged at first merge, never cleared on re-activation.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1909",
      "rank": 83,
      "size": "S",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan done handoff tail hangs — declares 'done' on local main only.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1931",
      "rank": 84,
      "size": "S",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning force-adds gitignored .pan/ state (regresses PAN-1215).",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1907",
      "rank": 85,
      "size": "S",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block all non-claude-code harnesses from sub models.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1928",
      "rank": 86,
      "size": "S",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lock model switching to brand-new conversations (0 messages).",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1927",
      "rank": 87,
      "size": "S",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "config: remove hardcoded model fallbacks — model must come from settings.",
      "gate": "ready",
      "planning": "skip"
    },
    {
      "issue": "PAN-1767",
      "rank": 88,
      "size": "S",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface 'awaiting close-out' (verifying-on-main) count in stats.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1846",
      "rank": 89,
      "size": "M",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 90,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel never emits status snapshots — dashboard 'flywheel' pane blank.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1681",
      "rank": 91,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test agents narrate 'tests pass' but never run pan specialists done test.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 92,
      "size": "M",
      "importance": "high",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon sets mergeStatus=merged w/o postMergeLifecycle.",
      "gate": "ready",
      "planning": "auto"
    },
    {
      "issue": "PAN-1510",
      "rank": 93,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (critical): newly-filed issues missing from frontend store (parallel to the PAN-1506 strike-visibility bug)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1506",
      "rank": 94,
      "size": "M",
      "importance": "critical",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (critical): strike agents missing from frontend store despite appearing in /api/agents and read-model boots…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1214",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Dashboard server crashes on UnhandledPromiseRejection from deacon poke/kill of dead agents",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1456",
      "rank": 96,
      "size": "L",
      "importance": "critical",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (critical): [HANDOFF] Pass-3 audit incomplete — fresh-context agent must continue per docs/audit-2026-05-24…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 97,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1499",
      "rank": 98,
      "size": "XS",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Substrate fix (PAN-1454 pattern 2): block pan done if close-out comment defers work without a f…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-955",
      "rank": 99,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (high): Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1193",
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Swarm: no slot-to-slot file coordination — slots independently produce overlapping work",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1198",
      "rank": 102,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1209",
      "rank": 103,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1498",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Substrate fix (PAN-1454 pattern 1): require live-code-path trace in requirements review",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1725",
      "rank": 106,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Review role agents can be marked orphaned after writing successful outputs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 107,
      "size": "M",
      "importance": "high",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): npm run build sometimes skips Vite frontend rebuild",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 109,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1232",
      "rank": 110,
      "size": "XS",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1148 follow-up — IssueDrawer 6 tabs as placeholders + title font + header structure + strea…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1234",
      "rank": 111,
      "size": "XS",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1148 follow-up — cross-cutting (Space Grotesk / keyboard shortcuts / /issues/:id route / IN…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1416",
      "rank": 112,
      "size": "M",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Workspace-spawned dashboard servers can bind the main pan.localhost port and hijack the canonic…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 113,
      "size": "XS",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1452",
      "rank": 114,
      "size": "XS",
      "importance": "high",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (high): PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-244",
      "rank": 115,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-245",
      "rank": 116,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 117,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 118,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 119,
      "size": "M",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + t…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-321",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Ephemeral merge specialist fails silently for polyrepo MYN projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 121,
      "size": "XS",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-334",
      "rank": 122,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-605",
      "rank": 123,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Reconcile CLAUDE.md prompt assembly across all agent types",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-673",
      "rank": 124,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): virtualizer inline ref causes blank conversation page on large message lists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 125,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 126,
      "size": "XS",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-cree…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1446",
      "rank": 127,
      "size": "XS",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep …",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1447",
      "rank": 128,
      "size": "XS",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1194 follow-up: restore failed-merge slot UI deleted by sibling PAN-1148 merge",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-886",
      "rank": 129,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-890",
      "rank": 130,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conflict-resolver agent merges stale main snapshot and never pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-899",
      "rank": 131,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Agent CLI commands fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 132,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-928",
      "rank": 133,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): verification-runner: polyrepo workspaces fail at sync-target-branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-929",
      "rank": 134,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): review-run: polyrepo workspaces detect overlay repo instead of code repos",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 135,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 136,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1142",
      "rank": 137,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1816",
      "rank": 138,
      "size": "XS",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1998",
      "rank": 139,
      "size": "M",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Remodel cleanup: drop orphan observation_index + reset_markers tables from the overdeck.db migr…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1038",
      "rank": 140,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation diff panel always empty: conv.claudeSessionId is null for all conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 141,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 142,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 143,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 144,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 145,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model R…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 146,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 147,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1226",
      "rank": 148,
      "size": "XL",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1240",
      "rank": 149,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1243",
      "rank": 150,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan admin hooks install: resolver fails outside repo CWD (auto-config breaks flywheel resume)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1247",
      "rank": 151,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Substrate: deacon orphan-test recovery loops dispatch_failed forever on an unhealthy workspace …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1258",
      "rank": 152,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Swarm slot spawn hangs silently before writeLauncherScriptAtomic when model=kimi-k2.6",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1263",
      "rank": 153,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Swarm UX: pipeline rows and IssueDrawer don't surface per-slot identity or multi-slot navigation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 154,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' pref…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1336",
      "rank": 155,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Swarm: pan swarm --auto-advance cannot advance — no slot-PR merger, slots never self-terminate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 156,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also ex…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 157,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1434",
      "rank": 158,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): conv-find.py reports session_file: N/A for newer conversation records (wrong column)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 159,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1439",
      "rank": 160,
      "size": "M",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Recover conv-2084's in-progress PANOPTICON_PROJECT_ROOT env var work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 161,
      "size": "XS",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1444",
      "rank": 162,
      "size": "XS",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1504",
      "rank": 163,
      "size": "L",
      "importance": "high",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + sk…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 164,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 165,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 166,
      "size": "XS",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates …",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1461",
      "rank": 167,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtuali…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1472",
      "rank": 168,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Swarm inspect agents emit pan tell to parent agent ID — fails when only slot agents exist",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 169,
      "size": "S",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1556",
      "rank": 170,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1559",
      "rank": 171,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Orphaned inspect sessions: live tmux panes with no state.json escape all reapers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1564",
      "rank": 172,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Pi extension path + dashboard server spawn both depend on launch cwd (fix: resolve against pack…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 173,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 174,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1582",
      "rank": 175,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Handoff fork falls back to summary: external authoring session stalls on Write permission",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 176,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan handoff --author external: authored doc is socket_write-ten but never submitted — successor…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1637",
      "rank": 177,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation resume reattaches to a keep-alive corpse (no harness-liveness probe)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1638",
      "rank": 178,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation DB status stays 'active' after the harness process dies",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1652",
      "rank": 179,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation title regeneration 500s on large transcripts — claude title invocation times out a…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 180,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1682",
      "rank": 181,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): strike agents missing from Command Deck issue tree — resource-discovery.ts:471 tmux-prefix allo…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1688",
      "rank": 182,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): System Briefing: 'Cost today' card always $0.00 — reads orphaned cost-monitor.dailyTotal instea…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1689",
      "rank": 183,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): System Briefing: 'Paused / troubled' card inflated ~8x (~185 vs real ~24) by stale stopped sub-…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1718",
      "rank": 184,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Duplicate successful 'pan reload' restart-status writes from two unidentified concurrent proces…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1722",
      "rank": 185,
      "size": "M",
      "importance": "high",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Awareness rail activity entries don't survive page load — snapshot doesn't seed recentActivity,…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 186,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 187,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1451",
      "rank": 188,
      "size": "XS",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (high): PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1538",
      "rank": 189,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1544",
      "rank": 190,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (high): Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1789",
      "rank": 191,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation status shows 'ended' for a live codex-harness handoff session",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1790",
      "rank": 192,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan handoff: focus text without conv id mis-parses as conversation; help string missing codex; …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1793",
      "rank": 193,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan handoff kickoff message is not delivered to pi-harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 194,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1823",
      "rank": 195,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Linear polling is not rate-limit-aware — no 429 backoff (secondary to PAN-1817)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1833",
      "rank": 196,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Pi spawn checks pi-extension via process.cwd() — 'Pi extension not built' when pan start/strike…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1850",
      "rank": 197,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Conversation transcripts >10MB are truncated by the initial-read cap (missing-middle live view)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1893",
      "rank": 198,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): pan start STILL crashes toUpperCase after sync-main conflict for gpt-5.5/claude-code agent stat…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1900",
      "rank": 199,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): UAT candidate branch codename is non-deterministic — proliferates a new uat/* branch per assemb…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 200,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1956",
      "rank": 201,
      "size": "M",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug (high): GLM-5.2 and GLM-5.1: contextWindow set to output cap (should be input context); also verify pri…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 202,
      "size": "M",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (high): Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1195",
      "rank": 203,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Swarm: parent work agent goes silent during swarm dispatch — no parent-orchestrates mode",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1217",
      "rank": 204,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1224",
      "rank": 205,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug (high): Ensure 'ship' (or close-out) restarts the running dashboard so merged code is actually live",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 206,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug (high): Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 207,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1253",
      "rank": 208,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1254",
      "rank": 209,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 210,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 211,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1525",
      "rank": 212,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Composer autocomplete: expose all CLI args for every pan command",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1558",
      "rank": 213,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1561",
      "rank": 214,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity f…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1578",
      "rank": 215,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1588",
      "rank": 216,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): PAN-800 Phase 5: eliminate parseThinkingDuration / capture-pane stuck detection",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1594",
      "rank": 217,
      "size": "M",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Hook-driven agent readiness (kill prompt-polling + permission-mode coupling)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1115",
      "rank": 218,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Inject observation context into agent prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1889",
      "rank": 219,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole e…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-399",
      "rank": 220,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Release specialist — coordinated post-merge rollout and release safety",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-532",
      "rank": 221,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Per-project and per-issue model overrides for workflow agent model selection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 222,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-592",
      "rank": 223,
      "size": "L",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Audit: Planning agent CLAUDE.md and STATE.md contents vs expectations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-608",
      "rank": 224,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Integrate Destructive Command Guard (dcg) with configurable settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 225,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Canceled issues: add guided Recover workflow",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 226,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-713",
      "rank": 227,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1573",
      "rank": 228,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Consideration for reintroducing ability to --dangerously-skip-permissions, DO NOT act on this i…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 229,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 230,
      "size": "M",
      "importance": "medium",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompa…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 231,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Support external PR selection for merge-agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 232,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 233,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 234,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 236,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 237,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 238,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 239,
      "size": "XS",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-104",
      "rank": 240,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Cost alerts/notifications when spending exceeds thresholds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 241,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-111",
      "rank": 242,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Support cross-machine planning state sync without cross-contamination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-783",
      "rank": 243,
      "size": "XL",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Agents Page Redesign — Unified Multi-View Experience",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 244,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 245,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 246,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Workspace + branch hygiene sweep (124 feature/* branches, 28 worktrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 247,
      "size": "S",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-947",
      "rank": 248,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): project management actions in unified sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 249,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Enhance (high): Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 250,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Enhance (high): Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 251,
      "size": "XS",
      "importance": "high",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Enhance (high): Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-146",
      "rank": 252,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 253,
      "size": "XL",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-175",
      "rank": 254,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 255,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 256,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 258,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 260,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 261,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 262,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1102",
      "rank": 263,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): real-time notification + interactive prompts when agent awaits user input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1103",
      "rank": 264,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): surface AskUserQuestion choice options in conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1122",
      "rank": 265,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Trim OpenAI model catalog to 5 supported models",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Push diff summary updates over /ws/rpc instead of 5s polling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 267,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 268,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): decouple merge-train from the Flywheel — per-project pipeline feature + multi-project view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 269,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): remote (fly.io) work agents need a real session row in the issue tree — chip-only visibility re…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): hot-updatable delivery path — version-stamped supervisors, rolling refresh, and dumb-shim primi…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 272,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 273,
      "size": "L",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 275,
      "size": "XS",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-258",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 277,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 278,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 279,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 281,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 282,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 283,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 284,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 285,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-306",
      "rank": 286,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): merge-agent polyrepo false failures — stale refs, wrong error field, short timeout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 287,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-834",
      "rank": 289,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Cleanup: legacy ~/.panopticon/heartbeats/ directory has not been written since 2026-04-22",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-835",
      "rank": 290,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Workspace creation removes stale .planning/ from previous issue but doesn't commit deletion → P…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 291,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1488",
      "rank": 292,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): add required_pull_request_reviews to main branch protection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1547",
      "rank": 293,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): @panctl/cli npm install warns on Node <22 (engine mismatch + deprecated deps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1610",
      "rank": 294,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Consistent issue actions across all surfaces (Command Deck cockpit, Pipeline rows, Board cards,…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1705",
      "rank": 295,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): conversation click stuck on Loading… for minutes during pipeline load — fat-poll request queuei…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1706",
      "rank": 296,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): orphaned playwright-mcp headless Chromiums keep full dashboard pages open — each multiplies das…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 297,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmar…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-371",
      "rank": 298,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Agents tab only shows global specialists, not per-project ephemeral ones",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 299,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 300,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 301,
      "size": "XS",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1896",
      "rank": 302,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Reduce approval friction for GitHub CLI operations in managed sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 303,
      "size": "M",
      "importance": "medium",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Inspector agent should resume a warm session instead of cold-spawning a new one per bead",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 304,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 305,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 306,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 307,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-456",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Store Claude Code session IDs for agent resume after crash/restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 309,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 310,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 311,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 312,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 313,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 314,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 315,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-472",
      "rank": 316,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): GET /api/costs/by-issue takes 10s — N+1 query on 353K rows × 184 issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 317,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 318,
      "size": "XS",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-483",
      "rank": 319,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-487",
      "rank": 320,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): VBRIEF not archived to docs/prds/completed/ after merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 321,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-552",
      "rank": 323,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Claude Code terminals should respect app light/dark mode scheme",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 325,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 326,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 327,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 328,
      "size": "XS",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-571",
      "rank": 329,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 330,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 331,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 332,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 333,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 335,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 336,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 337,
      "size": "S",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-622",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 339,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 340,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 342,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-656",
      "rank": 343,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Docs site scroll broken: dashboard CSS leaks onto panopticon-cli.com",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 347,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 348,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-683",
      "rank": 349,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): shadow-state getPendingSyncCount test is environment-dependent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 350,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 351,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 352,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 353,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detec…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 354,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 355,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 356,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 357,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 358,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 359,
      "size": "XS",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1913",
      "rank": 360,
      "size": "M",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (high): Project description: show on click, edit in dashboard, mirror into the project layer (and docum…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-747",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 362,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-750",
      "rank": 363,
      "size": "XL",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-751",
      "rank": 364,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 365,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 366,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 367,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 369,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-772",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 371,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 373,
      "size": "XL",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-777",
      "rank": 374,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 375,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-780",
      "rank": 376,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Agent stuck in feedback loop when old feedback files exist but review has passed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 377,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 378,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 380,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-797",
      "rank": 381,
      "size": "S",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-810",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 383,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 384,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 385,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 386,
      "size": "L",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 387,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 388,
      "size": "XS",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-903",
      "rank": 389,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-904",
      "rank": 390,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Make AI title generation model configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 391,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 392,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 393,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 394,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-948",
      "rank": 395,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Implement pan scope lifecycle commands",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 396,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 397,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 398,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 399,
      "size": "XS",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1489",
      "rank": 400,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Enhance (medium): task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 401,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 402,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 403,
      "size": "S",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1051",
      "rank": 404,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 405,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 406,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 407,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Context bloat: agents receive oversized prompts that exceed tool limits and force immediate com…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 408,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 409,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 410,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 411,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1147",
      "rank": 412,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Work-agent done flow stalls at 'push and re-request review' after addressing review feedback",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 413,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gati…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 414,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 415,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 416,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 417,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1202",
      "rank": 418,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Swarm: prune merged/completed slot state directories after wave converges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 419,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 420,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1238",
      "rank": 421,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Board view follow-up — + New issue column footer button (deferred from PAN-1229)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1242",
      "rank": 422,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Board view follow-up — + New issue column footer button (deferred from PAN-1229)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1244",
      "rank": 423,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 424,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 425,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 426,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 427,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 428,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 429,
      "size": "XS",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1791",
      "rank": 430,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Enhance (medium): Tiered execution: difficulty-routed bead dispatch + event-driven supervisor review (standing ti…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 431,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1453",
      "rank": 432,
      "size": "L",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Audit: 3 cheap verifications that should ride along with merges (PAN-1170, PAN-1316, PAN-457 CL…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 433,
      "size": "L",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative +…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 434,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 435,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 436,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 437,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 438,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 439,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurab…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 440,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1493",
      "rank": 441,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): write hello.txt — probe for PAN-1200 Universal Context System verification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 442,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 443,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1545",
      "rank": 444,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1548",
      "rank": 445,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): npx @panctl/cli shows stale placeholder message referencing v0.8.0",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 446,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 447,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 448,
      "size": "S",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1581",
      "rank": 449,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-h…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 450,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Composer: make pasted images reload-durable (persist across page reload, not just conversation …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1619",
      "rank": 451,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Bridge host Codex auth into workspace containers + honest gpt-5.5 lock reason",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1620",
      "rank": 452,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Awaiting-Merge button is clickable on a conflicting/CI-failing PR (stale blockerReasons)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1621",
      "rank": 453,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): pan close human-only gate over-blocks operator conv-* sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1622",
      "rank": 454,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): pan dev restart leaves orphan dashboard servers (stale serving + multi-Deacon risk)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 455,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 456,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 457,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 458,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Local model support via Ollama sidecar (Gemma 4 12B) for the Pi harness",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 459,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1644",
      "rank": 460,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Hook-driven progressive conversation titling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 461,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 462,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 463,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 464,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync acc…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 465,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 466,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): one-off double-check reviews with a user-specified agent/harness + settings-managed default rev…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 467,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 468,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): right-click 'restart with <model>' carries model only, never harness — can't move a review off …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 469,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1670",
      "rank": 470,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): pan dev hot-reload wedges tabs on 'Reconnecting to the dashboard…' — PAN-1580 boot watchdog nev…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1671",
      "rank": 471,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): surface pending ExitPlanMode plan as a popup modal (reuse PlanCard + /plan-action)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 472,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 473,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 474,
      "size": "L",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Show model capability icons in conversation dialogs + complete per-model vision (supportsImages…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 475,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands rea…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1708",
      "rank": 476,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): pan start CLI never flips spec plan.status proposed→approved — all 8 in-flight specs stuck at p…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1726",
      "rank": 477,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): postMergeLifecycle did not pause the merged issue's work agent — idle agent holds a work slot a…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 478,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1729",
      "rank": 479,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): beads-scoping work.md \"-l {{ISSUE_ID_LOWER}}\" label-filter assertion fails on main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1730",
      "rank": 480,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): idle awaiting-test work sessions count against the PAN-1665 ceiling — pipeline livelocks when w…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1734",
      "rank": 481,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): request-review-nudge remote workspace HEAD test fails on main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 482,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1739",
      "rank": 483,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Command Deck issue TREE still hides strike agents — frontend FeatureItem session-type allowlist…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 484,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 485,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 486,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 487,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flyw…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 488,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings pa…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 489,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agent…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 490,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): ship lane cannot converge on a continuously-moving main — 37 re-dispatches for one issue; ready…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 491,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (s…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1762",
      "rank": 492,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Swarm v2: tracer-bullet planning contract (Path A) + foreman-driven intra-issue swarms (Path B)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 493,
      "size": "XS",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1774",
      "rank": 494,
      "size": "M",
      "importance": "medium",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 495,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "stale",
      "dependsOn": [],
      "why": "Task (medium): Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 496,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1838",
      "rank": 497,
      "size": "S",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): [research] Grok Build (xAI) coding harness — research and specify support",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1839",
      "rank": 498,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Settings → Providers: show each provider's default harness in the collapsed row (no expand need…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 499,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity not…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 500,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tier…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 501,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1875",
      "rank": 502,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): add `pan flywheel stop` — graceful shutdown that writes the report",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 503,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning p…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1894",
      "rank": 504,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Show UAT stack startup state in issue tree and issue slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 505,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 506,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 507,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived p…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 508,
      "size": "XS",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1916",
      "rank": 509,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1917",
      "rank": 510,
      "size": "XL",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): /sessions page redesign: unify with conversation view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1926",
      "rank": 511,
      "size": "XS",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1932",
      "rank": 512,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Schema migration downgrades user_version when DB is newer than code (=== SCHEMA_VERSION should …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 513,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 514,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all bead v…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1953",
      "rank": 515,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Design: beads rail mockup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1954",
      "rank": 516,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Beads rail: move beads to right sidebar, highlight active work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1955",
      "rank": 517,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Issue cockpit: move beads from a tab into a persistent right rail with a 'working now' highlight",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 518,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + in…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1963",
      "rank": 519,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Default to no-resume on dashboard boot; add 'Resume all' to the stopped-agents banner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 520,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1966",
      "rank": 521,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Single authoritative pipeline-membership resolver — one function for \"what's in the pipeline\" (…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 522,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 523,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1980",
      "rank": 524,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Stop session rotation on resume (behind a constant); one pipeline-membership view from all lens…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 525,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1987",
      "rank": 526,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Allow renaming a registered project (display name is locked at registration)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1989",
      "rank": 527,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Replace Pi harness with ohmypi and evaluate advanced features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 528,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): First-class workspaces and projects with per-workspace memory",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 529,
      "size": "XL",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Issue cockpit redesign — incremental rollout (tracking)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1995",
      "rank": 530,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 531,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 532,
      "size": "XL",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-633",
      "rank": 533,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 534,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1223",
      "rank": 535,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Enhance (medium): Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1555",
      "rank": 536,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): remove/update stale swarm-runtime references after PAN-1517",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 537,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 538,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 539,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 540,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 541,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1494",
      "rank": 542,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): register docs/FLYWHEEL-VISION on panopticon-cli.com (Mintlify) — needed for public sharing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 543,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task (medium): canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/C…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 544,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enhance (medium): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
    {
      "from": "PAN-2000",
      "to": "PAN-1866",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1994",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1994",
      "to": "PAN-1866",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1992",
      "to": "PAN-1983",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1984",
      "to": "PAN-1983",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1451",
      "to": "PAN-1124",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1728",
      "to": "PAN-1124",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1444",
      "to": "PAN-1416",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1443",
      "to": "PAN-487",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1424",
      "to": "PAN-1122",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1988",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1910",
      "to": "PAN-1908",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1893",
      "to": "PAN-1491",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1864",
      "to": "PAN-1861",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1864",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1861",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1830",
      "to": "PAN-1861",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1862",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1874",
      "to": "PAN-1862",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1213",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1219",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1207",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1130",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1131",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-838",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1557",
      "to": "PAN-1982",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1498",
      "to": "PAN-1454",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1499",
      "to": "PAN-1454",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1817",
      "to": "PAN-1823",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1935",
      "to": "PAN-1570",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1868",
      "to": "PAN-1935",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1868",
      "to": "PAN-1570",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1572",
      "to": "PAN-1101",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1068",
      "to": "PAN-1064",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1068",
      "to": "PAN-1065",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1766",
      "to": "PAN-1060",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1766",
      "to": "PAN-1627",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1520",
      "to": "PAN-1102",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1520",
      "to": "PAN-1103",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1103",
      "to": "PAN-1102",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-450",
      "to": "PAN-1313",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1840",
      "to": "PAN-1986",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1919",
      "to": "PAN-1908",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1988",
      "to": "PAN-1908",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1936",
      "to": "PAN-1908",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1994",
      "to": "PAN-1908",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-804",
      "to": "PAN-1983",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-804",
      "to": "PAN-1984",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-806",
      "to": "PAN-1929",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1666",
      "to": "PAN-908",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1730",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1454",
      "to": "PAN-804",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-262",
      "to": "PAN-1027",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-262",
      "to": "PAN-1873",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1650",
      "to": "PAN-1861",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1313",
      "to": "PAN-1903",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1313",
      "to": "PAN-1720",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1674",
      "to": "PAN-1508",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-826",
      "to": "PAN-1827",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1824",
      "to": "PAN-1710",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-1908",
      "to": "PAN-1994",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1908",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1908",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1908",
      "to": "PAN-1124",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1866",
      "to": "PAN-1994",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1866",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1866",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1866",
      "to": "PAN-1124",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1919",
      "to": "PAN-1994",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1919",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1919",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1919",
      "to": "PAN-1124",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1832",
      "to": "PAN-1994",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1832",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1832",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1832",
      "to": "PAN-1124",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1982",
      "to": "PAN-1994",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1982",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1982",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1982",
      "to": "PAN-1124",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1992",
      "to": "PAN-1994",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1992",
      "to": "PAN-1936",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1992",
      "to": "PAN-1988",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-1992",
      "to": "PAN-1124",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    }
  ]
}
```
